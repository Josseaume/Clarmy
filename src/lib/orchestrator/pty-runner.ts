import { spawn as ptySpawn, type IPty } from "node-pty";
import { createLogger } from "../util/logger.ts";
import { getDriver } from "../providers/registry.ts";
import { providerMeta } from "../shared/providers.ts";
import type { CliDriver, LiveTailer, TailPatch } from "../providers/types.ts";
import { initialSnapshot } from "./state-machine.ts";
import type { EventBus } from "./events.ts";
import type { Effort, ModelId, SessionSnapshot, SpawnConfig } from "../shared/types.ts";
import { coerceEffort } from "../shared/types.ts";
import { modelSupportsEffortFor } from "../shared/models.ts";
import { writeSessionMcpConfig, removeSessionMcpConfig } from "../mcp/config.ts";

const log = createLogger("pty");

const HIST_BYTES = 256 * 1024;

type DataListener = (data: Buffer) => void;
type ExitListener = (exitCode: number) => void;

export class PtyRunner {
  private readonly pty: IPty;
  private readonly history: Buffer[] = [];
  private historySize = 0;
  private readonly dataListeners = new Set<DataListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private snapshot: SessionSnapshot;
  private exitCode: number | null = null;
  private cols = 120;
  private rows = 36;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDataAt = 0;
  private readonly idleDelayMs = 2000;
  private effort: Effort | null;
  private readonly tailer: LiveTailer;
  private readonly driver: CliDriver;

  constructor(
    public readonly id: string,
    private readonly bus: EventBus,
    private readonly config: SpawnConfig,
  ) {
    const driver = getDriver(config.provider);
    this.driver = driver;
    const meta = providerMeta(config.provider);
    const cli = driver.findCli();
    if (!cli) {
      throw new Error(
        `${meta.label} CLI not found. Set ${config.provider.toUpperCase()}_CLI_PATH in .env.local, or install the "${meta.binary}" binary so it lives at ~/.local/bin/${meta.binary}, /usr/local/bin/${meta.binary}, or /opt/homebrew/bin/${meta.binary}.`,
      );
    }

    this.effort = coerceEffort(config.model, config.effort ?? null);
    // Inject the cockpit MCP server so this session can reach its peers, the
    // fleet summary and the control plane. Only drivers that accept an MCP config
    // launch flag (Claude) consume it; the rest reject unknown flags, so we hand
    // the written path to the driver and clean it up when it goes unused.
    const mcpPath = writeSessionMcpConfig(id);
    const mcpArgs = mcpPath ? driver.mcpConfigArgs(mcpPath) : [];
    if (mcpPath && mcpArgs.length === 0) removeSessionMcpConfig(id);
    const args = [...driver.buildArgs(config, this.effort), ...mcpArgs];
    const childPath = buildChildPath(process.env.PATH);
    const startedAt = Date.now();
    this.snapshot = initialSnapshot({
      type: "system.init",
      id,
      provider: config.provider,
      project: config.project,
      name: config.name,
      model: config.model,
      startedAt,
      cwd: config.cwd,
      branch: config.branch,
      prompt: config.prompt,
      effort: this.effort ?? undefined,
    });
    this.tailer = driver.createTailer(config.cwd, startedAt, (p) => this.applyTailPatch(p));

    log.info("pty spawn", { id, provider: config.provider, cli, cwd: config.cwd, args });
    let spawned: IPty;
    try {
      spawned = ptySpawn(cli, args, {
        name: "xterm-256color",
        cols: this.cols,
        rows: this.rows,
        cwd: config.cwd,
        env: {
          ...process.env,
          PATH: childPath,
          TERM: "xterm-256color",
          FORCE_COLOR: "3",
          COLORTERM: "truecolor",
          ...driver.envExtras(config),
          // Injected secrets win last so a cron's chosen keys reach the session.
          ...(config.env ?? {}),
        },
      });
    } catch (err) {
      throw new Error(
        `Failed to spawn ${meta.label} CLI at ${cli}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Verify the binary is executable (\`ls -l ${cli}\`) and runnable in your shell.`,
      );
    }
    this.pty = spawned;

    // "arg" providers carry the prompt + effort in argv, so nothing is typed in.
    let promptSent = driver.promptDelivery === "arg" || !(config.prompt && !config.resumeSessionId);
    let effortApplied = !this.effort || driver.effortInArgs(this.effort) || driver.effortSlash(this.effort) === null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let promptTimer: ReturnType<typeof setTimeout> | null = null;

    const sendInitialPrompt = (): void => {
      if (promptSent) return;
      if (this.exitCode !== null) return;
      promptSent = true;
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      const writePrompt = (): void => {
        if (this.exitCode !== null) return;
        // Bracketed paste so embedded newlines don't submit the prompt line-by-line.
        this.pty.write("\x1b[200~");
        this.pty.write(config.prompt);
        this.pty.write("\x1b[201~");
        setTimeout(() => { if (this.exitCode === null) this.pty.write("\r"); }, 80);
      };
      const slash = this.effort ? driver.effortSlash(this.effort) : null;
      if (!effortApplied && slash) {
        effortApplied = true;
        this.pty.write(`${slash}\r`);
        promptTimer = setTimeout(writePrompt, 250);
      } else {
        writePrompt();
      }
    };

    const applyEffortViaSlash = (): void => {
      if (effortApplied || this.exitCode !== null || !this.effort) return;
      const slash = driver.effortSlash(this.effort);
      effortApplied = true;
      if (slash) this.pty.write(`${slash}\r`);
    };

    this.pty.onData((data) => {
      const buf = Buffer.from(data, "utf8");
      this.lastDataAt = Date.now();
      this.markRunning();
      this.scheduleIdle();
      this.pushHistory(buf);
      if (!promptSent) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(sendInitialPrompt, 400);
      } else if (!effortApplied) {
        // Resume / no-prompt case: upgrade effort once banner appears.
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(applyEffortViaSlash, 400);
      }
      for (const l of this.dataListeners) {
        try { l(buf); } catch { /* ignore */ }
      }
    });

    this.pty.onExit(({ exitCode }) => {
      this.exitCode = exitCode;
      this.tailer.stop();
      removeSessionMcpConfig(this.id);
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      if (promptTimer) { clearTimeout(promptTimer); promptTimer = null; }
      log.info("pty exit", { id, exitCode });
      const prevState = this.snapshot.state;
      this.snapshot = { ...this.snapshot, state: exitCode === 0 ? "done" : "error", endedAt: Date.now(), durationMs: Date.now() - this.snapshot.startedAt, error: exitCode !== 0 ? `exited with code ${exitCode}` : undefined };
      this.bus.emit({ kind: "transition", at: Date.now(), id: this.id, from: prevState, to: this.snapshot.state });
      this.bus.emit({ kind: "patch", at: Date.now(), id: this.id, patch: { state: this.snapshot.state, endedAt: this.snapshot.endedAt, durationMs: this.snapshot.durationMs, error: this.snapshot.error } });
      this.bus.emit({ kind: "gone", at: Date.now(), id: this.id });
      for (const l of this.exitListeners) {
        try { l(exitCode); } catch { /* ignore */ }
      }
    });

    // Fallback: if CLI never prints a banner within 3s, send anyway.
    if (!promptSent) {
      fallbackTimer = setTimeout(sendInitialPrompt, 3000);
    }
  }

  getSnapshot(): SessionSnapshot { return this.snapshot; }

  getEffort(): Effort | null { return this.effort; }

  setEffort(next: Effort): void {
    if (this.exitCode !== null) return;
    const coerced = coerceEffort(this.config.model, next);
    if (!coerced) return; // model has no effort support
    if (coerced === this.effort) return;
    const slash = this.driver.effortSlash(coerced);
    if (!slash) return; // provider cannot change effort on a live session
    this.effort = coerced;
    this.snapshot = { ...this.snapshot, effort: coerced };
    const now = Date.now();
    this.bus.emit({ kind: "patch", at: now, id: this.id, patch: { effort: coerced } });
    this.pty.write(`${slash}\r`);
  }

  start(): void {
    this.bus.emit({ kind: "init", at: Date.now(), snapshot: this.snapshot });
    this.tailer.start();
  }

  private applyTailPatch(p: TailPatch): void {
    if (this.exitCode !== null) return;
    const patch: Partial<SessionSnapshot> = {};
    let changed = false;
    const keys: (keyof TailPatch & keyof SessionSnapshot)[] = [
      "cost", "toolsUsed", "inputTokens", "outputTokens", "contextTokens", "contextWindow", "subagents", "model", "resumeSessionId", "todoList", "todos", "todosDone",
    ];
    for (const k of keys) {
      if (p[k] === undefined) continue;
      if (this.snapshot[k] !== p[k]) {
        (patch as Record<string, unknown>)[k as string] = p[k];
        changed = true;
      }
    }
    if (p.tool !== undefined && p.tool !== this.snapshot.tool) {
      (patch as Record<string, unknown>).tool = p.tool;
      changed = true;
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.bus.emit({ kind: "patch", at: Date.now(), id: this.id, patch });
  }

  write(data: string | Buffer): void {
    if (this.exitCode !== null) return;
    if (typeof data === "string") this.pty.write(data);
    else this.pty.write(data.toString("utf8"));
  }

  resize(cols: number, rows: number): void {
    if (this.exitCode !== null) return;
    const c = Math.max(20, Math.min(500, Math.floor(cols)));
    const r = Math.max(5,  Math.min(200, Math.floor(rows)));
    if (c === this.cols && r === this.rows) return;
    this.cols = c; this.rows = r;
    try { this.pty.resize(c, r); } catch (err) { log.error("resize failed", { err: String(err) }); }
  }

  async kill(): Promise<void> {
    if (this.exitCode !== null) return;
    this.tailer.stop();
    removeSessionMcpConfig(this.id);
    try { this.pty.kill(); } catch { /* ignore */ }
  }

  resolveApproval(_toolUseId: string, _allow: boolean): boolean {
    return false;
  }

  onData(cb: DataListener): () => void {
    this.dataListeners.add(cb);
    return () => { this.dataListeners.delete(cb); };
  }

  onExit(cb: ExitListener): () => void {
    if (this.exitCode !== null) { cb(this.exitCode); return () => { /* noop */ }; }
    this.exitListeners.add(cb);
    return () => { this.exitListeners.delete(cb); };
  }

  getHistory(): Buffer {
    return Buffer.concat(this.history);
  }

  getExitCode(): number | null { return this.exitCode; }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.markIdle(), this.idleDelayMs);
  }

  private markIdle(): void {
    if (this.exitCode !== null) return;
    if (this.snapshot.state === "idle") return;
    const from = this.snapshot.state;
    this.snapshot = { ...this.snapshot, state: "idle", tool: null };
    const now = Date.now();
    this.bus.emit({ kind: "transition", at: now, id: this.id, from, to: "idle" });
    this.bus.emit({ kind: "patch", at: now, id: this.id, patch: { state: "idle", tool: null } });
  }

  private markRunning(): void {
    if (this.exitCode !== null) return;
    if (this.snapshot.state === "running") return;
    const from = this.snapshot.state;
    this.snapshot = { ...this.snapshot, state: "running" };
    const now = Date.now();
    this.bus.emit({ kind: "transition", at: now, id: this.id, from, to: "running" });
    this.bus.emit({ kind: "patch", at: now, id: this.id, patch: { state: "running" } });
  }

  private pushHistory(buf: Buffer): void {
    this.history.push(buf);
    this.historySize += buf.length;
    while (this.historySize > HIST_BYTES && this.history.length > 1) {
      const dropped = this.history.shift();
      if (dropped) this.historySize -= dropped.length;
    }
  }
}

function buildChildPath(parent: string | undefined): string {
  const home = process.env.HOME ?? "";
  const extras = [
    home ? `${home}/.local/bin` : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of [...extras, ...(parent ? parent.split(":") : [])]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    parts.push(p);
  }
  return parts.join(":");
}

export function modelSupportsEffort(model: ModelId): boolean {
  return modelSupportsEffortFor(model);
}
