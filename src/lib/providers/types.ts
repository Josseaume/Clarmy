import type { Effort, ModelId, SpawnConfig, TodoItem, ProviderId } from "../shared/types.ts";

// A delta of live session metrics, emitted by a provider tailer as it reads the
// CLI's on-disk transcript. Shared by every provider so PtyRunner consumes one
// shape regardless of vendor. (Moved here from claude-code/session-tailer so
// other providers' tailers can depend on it without importing Claude code.)
export interface TailPatch {
  readonly cost?: number;
  readonly tool?: string | null;
  readonly toolsUsed?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  readonly subagents?: number;
  readonly model?: ModelId;
  readonly resumeSessionId?: string;
  readonly todoList?: readonly TodoItem[];
  readonly todos?: number;
  readonly todosDone?: number;
}

// A live transcript watcher. start() begins polling the vendor's history dir,
// stop() releases timers. Patches flow out through the onPatch passed to the
// driver's createTailer().
export interface LiveTailer {
  start(): void;
  stop(): void;
}

// One usage record extracted from a transcript, normalised across vendors so the
// metrics route can dedup + price uniformly. `key` dedups replayed records
// (resumed transcripts replay prior turns); null when no stable id exists.
export interface ProviderUsageRecord {
  readonly key: string | null;
  readonly ts: number;
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreate5mTokens: number;
  readonly cacheCreate1hTokens: number;
}

// One historical session, normalised across vendors. The metrics route turns
// these into SessionRows (one per session) and aggregates client-side, keeping
// each provider's numbers strictly separate.
export interface ProviderSession {
  readonly provider: ProviderId;
  readonly id: string;
  readonly cwd: string;
  readonly project: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly model?: string;
  // Best-effort first user prompt / session title, used as the history label.
  readonly firstPrompt?: string;
  readonly messageCount: number;
  readonly toolUses: number;
  readonly state: "done" | "error" | "ongoing";
  readonly usage: readonly ProviderUsageRecord[];
}

// How the initial prompt reaches the CLI. "type" pastes it into the TTY after
// the banner appears (Claude); "arg" embeds it in argv so no typing is needed
// (Codex, whose TUI we do not drive keystroke-by-keystroke).
export type PromptDelivery = "type" | "arg";

// The server-side contract for one CLI vendor: how to find the binary, how to
// turn a SpawnConfig into argv + env, how effort is delivered, and how to read
// its transcripts for live + historical metrics.
export interface CliDriver {
  readonly id: ProviderId;
  readonly promptDelivery: PromptDelivery;

  // Absolute path to the binary, or null when not installed.
  findCli(): string | null;

  // argv for the spawn. Includes the prompt when promptDelivery === "arg";
  // excludes it when "type" (PtyRunner pastes it post-banner). `effort` is
  // already coerced to a level the model supports (or null).
  buildArgs(cfg: SpawnConfig, effort: Effort | null): string[];

  // Extra env vars merged onto the child PATH/TERM env.
  envExtras(cfg: SpawnConfig): Record<string, string>;

  // argv to load cockpit's per-session MCP config file at launch. Claude takes
  // `--mcp-config <path>`; codex/grok accept MCP servers only via their own
  // subcommand/settings and reject an unknown launch flag, so they return []
  // (the file is cleaned up when unused).
  mcpConfigArgs(path: string): string[];

  // True when buildArgs already delivered this effort as a flag, so the runner
  // need not also send a launch-time slash command.
  effortInArgs(effort: Effort): boolean;

  // Slash command to set/upgrade effort at runtime, or null when the vendor
  // cannot change effort on a live session.
  effortSlash(effort: Effort): string | null;

  // Live metrics watcher for one running session.
  createTailer(cwd: string, startedAt: number, onPatch: (p: TailPatch) => void): LiveTailer;

  // All historical sessions for this provider (empty when the CLI was never
  // run / its home dir is absent).
  scanSessions(): ProviderSession[];
}
