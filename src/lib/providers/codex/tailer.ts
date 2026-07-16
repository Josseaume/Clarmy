import { openSync, readSync, closeSync, statSync } from "node:fs";
import { createLogger } from "../../util/logger.ts";
import { estimateCost, refreshPricing } from "../../claude-code/pricing.ts";
import { modelFromApiId } from "../../shared/models.ts";
import type { ModelId } from "../../shared/types.ts";
import type { LiveTailer, TailPatch } from "../types.ts";
import { listRolloutFiles } from "./paths.ts";
import {
  parseRolloutLine, tokenUsageFrom, isFunctionCall, isFunctionResult,
  functionCallName, sessionMetaCwd, sessionMetaId, turnContextModel,
  type CodexTokenUsage,
} from "./rollout.ts";

const log = createLogger("codex-tailer");
const POLL_MS = 2_000;

// Watches the Codex rollout JSONL for one live session and emits running metrics
// (tokens, cost, tool count, current tool). Token usage in token_count events is
// cumulative, so we keep the latest rather than summing.
export class CodexTailer implements LiveTailer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private file: string | null = null;
  private offset = 0;
  private stopped = false;
  private toolsUsed = 0;
  private tool: string | null = null;
  private model: ModelId | undefined;
  private rawModel: string | undefined;
  private resumeSessionId: string | undefined;
  private usage: CodexTokenUsage | null = null;
  private lastEmitted: TailPatch = {};

  constructor(
    private readonly cwd: string,
    private readonly startedAt: number,
    private readonly onPatch: (p: TailPatch) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    void refreshPricing().catch(() => { /* fallback prices */ });
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.stopped) return;
    if (!this.file) this.file = this.findFile();
    if (!this.file) return;
    let size = 0;
    try { size = statSync(this.file).size; } catch { this.file = null; return; }
    if (size <= this.offset) return;
    const buf = readFromOffset(this.file, this.offset);
    if (!buf || buf.length === 0) return;
    // Consume whole lines only, counting bytes on the raw buffer so the offset
    // never drifts on multi-byte characters or lands mid-character. The partial
    // tail past the last newline is re-read on the next tick.
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline < 0) return;
    this.offset += lastNewline + 1;
    const parts = buf.toString("utf8", 0, lastNewline).split("\n");
    let changed = false;
    for (const raw of parts) if (this.apply(raw)) changed = true;
    if (changed) this.emit();
  }

  // Resolve the rollout file for this cwd: newest rollout whose session_meta.cwd
  // matches and that was created around/after our start time.
  private findFile(): string | null {
    const files = listRolloutFiles(this.startedAt - 60_000).sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of files) {
      if (headCwd(f.path) === this.cwd) return f.path;
    }
    return null;
  }

  private apply(raw: string): boolean {
    const line = parseRolloutLine(raw);
    if (!line) return false;
    let changed = false;
    const sid = sessionMetaId(line);
    if (sid && sid !== this.resumeSessionId) { this.resumeSessionId = sid; changed = true; }
    const m = turnContextModel(line);
    if (m) {
      this.rawModel = m;
      const alias = modelFromApiId(m);
      if (alias && alias !== this.model) { this.model = alias; changed = true; }
    }
    if (isFunctionCall(line)) {
      this.toolsUsed++;
      const name = functionCallName(line);
      if (name && name !== this.tool) this.tool = name;
      changed = true;
    } else if (isFunctionResult(line) && this.tool !== null) {
      this.tool = null;
      changed = true;
    }
    const usage = tokenUsageFrom(line.payload);
    if (usage) { this.usage = usage; changed = true; }
    return changed;
  }

  private emit(): void {
    const cost = this.usage
      ? estimateCost(this.rawModel ?? this.model ?? "", {
          input: Math.max(0, this.usage.inputTokens - this.usage.cachedInputTokens),
          output: this.usage.outputTokens + this.usage.reasoningOutputTokens,
          cacheRead: this.usage.cachedInputTokens,
        })
      : 0;
    const patch: TailPatch = {
      cost,
      tool: this.tool,
      toolsUsed: this.toolsUsed,
      inputTokens: this.usage ? Math.max(0, this.usage.inputTokens - this.usage.cachedInputTokens) : 0,
      outputTokens: this.usage ? this.usage.outputTokens + this.usage.reasoningOutputTokens : 0,
      contextTokens: this.usage && this.usage.lastInputTokens > 0 ? this.usage.lastInputTokens : undefined,
      contextWindow: this.usage && this.usage.contextWindow > 0 ? this.usage.contextWindow : undefined,
      model: this.model,
      resumeSessionId: this.resumeSessionId,
    };
    const diff: TailPatch = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof TailPatch)[]) {
      if (patch[k] === undefined) continue;
      if (patch[k] !== this.lastEmitted[k]) { (diff as Record<string, unknown>)[k] = patch[k]; any = true; }
    }
    if (!any) return;
    this.lastEmitted = patch;
    log.debug("codex tailer emit", { cost, toolsUsed: this.toolsUsed, tool: this.tool });
    this.onPatch(diff);
  }
}

function headCwd(path: string): string | null {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString("utf8", 0, n);
    for (const raw of head.split("\n")) {
      const line = parseRolloutLine(raw);
      if (!line) continue;
      const cwd = sessionMetaCwd(line);
      if (cwd) return cwd;
    }
  } catch { /* ignore */ }
  finally { if (fd >= 0) try { closeSync(fd); } catch { /* ignore */ } }
  return null;
}

function readFromOffset(path: string, offset: number): Buffer | null {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const st = statSync(path);
    const remaining = Math.max(0, st.size - offset);
    if (remaining === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(remaining);
    const read = readSync(fd, buf, 0, remaining, offset);
    return buf.subarray(0, read);
  } catch { return null; }
  finally { if (fd >= 0) try { closeSync(fd); } catch { /* ignore */ } }
}
