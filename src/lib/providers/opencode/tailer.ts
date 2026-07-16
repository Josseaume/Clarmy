import { realpathSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../util/logger.ts";
import { modelFromApiId } from "../../shared/models.ts";
import { estimateCost } from "../../claude-code/pricing.ts";
import type { ModelId, TodoItem } from "../../shared/types.ts";
import type { LiveTailer, TailPatch } from "../types.ts";
import { withDb, queryAll, num, str } from "./db.ts";

const log = createLogger("opencode-tailer");
const POLL_MS = 2_000;

// Watches the opencode SQLite DB for one live session and emits running metrics.
// opencode aggregates cost + tokens onto the `session` row as it goes, so we just
// re-read that row (plus the latest tool part + todo rows) each tick. The session
// is matched by cwd until we learn its id, then locked to the id.
export class OpenCodeTailer implements LiveTailer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sessionId: string | null = null;
  private readonly cwds: string[];
  private lastEmitted: TailPatch = {};

  constructor(
    cwd: string,
    private readonly startedAt: number,
    private readonly onPatch: (p: TailPatch) => void,
  ) {
    // opencode stores the realpath (e.g. /private/tmp for /tmp), so match both.
    let real = cwd;
    try { real = realpathSync(cwd); } catch { /* keep cwd */ }
    this.cwds = real === cwd ? [cwd] : [cwd, real];
  }

  start(): void {
    if (this.timer) return;
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
    const patch = withDb<TailPatch | null>((db) => {
      const id = this.resolveSessionId(db);
      if (!id) return null;
      const row = queryAll(
        db,
        "SELECT cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model FROM session WHERE id = ?",
        id,
      )[0];
      if (!row) return null;
      const raw = str(row.model);
      const model = resolveModel(raw);
      const input = num(row.tokens_input);
      const output = num(row.tokens_output) + num(row.tokens_reasoning);
      const cacheRead = num(row.tokens_cache_read);
      const cacheCreate = num(row.tokens_cache_write);
      // opencode records $0 on disk for subscription plans (zai-coding-plan), so
      // estimate cost from tokens like the history/metrics path instead of
      // trusting row.cost; fall back to row.cost if the estimate is zero.
      const estimated = estimateCost(modelApiId(raw), { input, output, cacheRead, cacheCreate5m: cacheCreate, cacheCreate1h: 0 });
      const toolsUsed = num(
        queryAll(db, "SELECT COUNT(*) c FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'", id)[0]?.c,
      );
      const todoList = readTodos(db, id);
      const done = todoList.filter((t) => t.status === "done").length;
      return {
        cost: estimated > 0 ? estimated : num(row.cost),
        inputTokens: input,
        outputTokens: output,
        toolsUsed,
        tool: currentTool(db, id),
        // Surface the opencode session id so the orchestrator can persist it and
        // resume this session later (live tile + restart restore).
        resumeSessionId: id,
        ...(model ? { model } : {}),
        ...(todoList.length ? { todoList, todos: todoList.length, todosDone: done } : {}),
      } satisfies TailPatch;
    }, null);
    if (patch) this.emit(patch);
  }

  // Newest session under our cwd created around/after our start, then locked.
  private resolveSessionId(db: DatabaseSync): string | null {
    if (this.sessionId) return this.sessionId;
    const where = this.cwds.map(() => "directory = ?").join(" OR ");
    const rows = queryAll(
      db,
      `SELECT id FROM session WHERE (${where}) AND time_created >= ? ORDER BY time_created DESC LIMIT 1`,
      ...this.cwds,
      this.startedAt - 60_000,
    );
    const id = str(rows[0]?.id);
    if (id) this.sessionId = id;
    return this.sessionId;
  }

  private emit(patch: TailPatch): void {
    const diff: TailPatch = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof TailPatch)[]) {
      if (patch[k] === undefined) continue;
      if (k === "todoList") {
        if (JSON.stringify(patch[k]) !== JSON.stringify(this.lastEmitted[k])) {
          (diff as Record<string, unknown>)[k] = patch[k]; any = true;
        }
        continue;
      }
      if (patch[k] !== this.lastEmitted[k]) { (diff as Record<string, unknown>)[k] = patch[k]; any = true; }
    }
    if (!any) return;
    this.lastEmitted = patch;
    log.debug("opencode tailer emit", { cost: patch.cost, toolsUsed: patch.toolsUsed, tool: patch.tool });
    this.onPatch(diff);
  }
}

// The most recent tool part whose state has not settled = the tool running now.
function currentTool(db: DatabaseSync, id: string): string | null {
  const row = queryAll(
    db,
    "SELECT data FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool' ORDER BY time_updated DESC LIMIT 1",
    id,
  )[0];
  if (!row) return null;
  try {
    const p = JSON.parse(str(row.data) ?? "{}") as { tool?: unknown; state?: { status?: unknown } };
    const status = p.state?.status;
    if (status === "completed" || status === "error") return null;
    return typeof p.tool === "string" ? p.tool : null;
  } catch { return null; }
}

function readTodos(db: DatabaseSync, id: string): TodoItem[] {
  const rows = queryAll(db, "SELECT content, status FROM todo WHERE session_id = ? ORDER BY position", id);
  return rows.map((r) => ({ text: str(r.content) ?? "", status: mapTodoStatus(str(r.status)) }));
}

function mapTodoStatus(s: string | undefined): TodoItem["status"] {
  if (s === "completed" || s === "done") return "done";
  if (s === "in_progress" || s === "active") return "active";
  return "todo";
}

function resolveModel(raw: string | undefined): ModelId | undefined {
  if (!raw) return undefined;
  try {
    const m = JSON.parse(raw) as { id?: unknown; providerID?: unknown };
    if (typeof m.providerID === "string" && typeof m.id === "string") {
      const apiId = `${m.providerID}/${m.id}`;
      return modelFromApiId(apiId) ?? apiId;
    }
  } catch { /* not JSON */ }
  return modelFromApiId(raw) ?? raw;
}

// The raw "providerID/id" api id (e.g. "zai-coding-plan/glm-5.2"), used for cost
// estimation so pricing matches the uncatalogued opencode model ids directly.
function modelApiId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const m = JSON.parse(raw) as { id?: unknown; providerID?: unknown };
    if (typeof m.providerID === "string" && typeof m.id === "string") return `${m.providerID}/${m.id}`;
  } catch { /* not JSON */ }
  return raw;
}
