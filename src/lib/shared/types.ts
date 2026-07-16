import {
  effortLevelsFor,
  defaultEffortFor,
  coerceEffortFor,
  type Effort as EffortBase,
  type ModelId as ModelIdBase,
} from "./models.ts";
import type { ProviderId } from "./providers.ts";

export type { ProviderId } from "./providers.ts";

export type SessionState =
  | "idle"
  | "running"
  | "tool_use"
  | "approval"
  | "error"
  | "done";

export type ModelId = ModelIdBase;

export type ApprovalMode = "auto" | "prompt" | "strict";

export type Effort = EffortBase;

export function effortLevelsByModel(model: ModelId): readonly Effort[] {
  return effortLevelsFor(model);
}

export function defaultEffort(model: ModelId): Effort | null {
  return defaultEffortFor(model);
}

export function coerceEffort(model: ModelId, wanted: Effort | null | undefined): Effort | null {
  return coerceEffortFor(model, wanted);
}

export type LogKind = "plain" | "gt" | "muted" | "ok" | "warn";

export interface LogLine {
  readonly t: LogKind;
  readonly v: string;
}

export interface TodoItem {
  readonly status: "done" | "active" | "todo";
  readonly text: string;
}

export interface DiffRow {
  readonly type: "add" | "del" | "ctx";
  readonly ln: string;
  readonly txt: string;
}

export interface PendingApproval {
  readonly toolUseId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly destructive: boolean;
}

export interface SessionSnapshot {
  readonly id: string;
  readonly provider: ProviderId;
  readonly project: string;
  readonly name: string;
  readonly model: ModelId;
  readonly state: SessionState;
  readonly tool: string | null;
  readonly elapsed: string;
  readonly toolsUsed: number;
  readonly todos: number;
  readonly todosDone: number;
  readonly cost: number;
  readonly startedAt: number;
  readonly logs: readonly LogLine[];
  readonly cwd?: string;
  readonly branch?: string;
  readonly prompt?: string;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  // Current context-window occupancy (size of the latest request prompt) and the
  // model's max window, for the live context meter. Optional: providers whose
  // transcripts expose no token data leave these unset.
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  // Number of subagent transcripts observed for this session (live tailer).
  readonly subagents?: number;
  readonly todoList?: readonly TodoItem[];
  readonly editPath?: string;
  readonly diff?: readonly DiffRow[];
  readonly approval?: PendingApproval;
  readonly error?: string;
  readonly retryIn?: number;
  readonly summary?: string;
  readonly artifacts?: readonly string[];
  readonly resumeSessionId?: string;
  readonly effort?: Effort;
}


export interface SpawnConfig {
  readonly provider: ProviderId;
  readonly project: string;
  readonly cwd: string;
  readonly name: string;
  readonly model: ModelId;
  readonly prompt: string;
  readonly allowedTools: readonly string[];
  readonly approvalMode: ApprovalMode;
  readonly branch?: string;
  readonly dangerouslySkipPermissions?: boolean;
  readonly resumeSessionId?: string;
  readonly effort?: Effort;
  // Names of stored secrets to inject as env vars into the spawned session.
  readonly secretKeys?: readonly string[];
  // Resolved env values (decrypted from `secretKeys` at spawn time). Never
  // persisted to disk; only held in memory for the pty env merge.
  readonly env?: Readonly<Record<string, string>>;
}

export type SessionEvent =
  | { kind: "init"; at: number; snapshot: SessionSnapshot }
  | { kind: "patch"; at: number; id: string; patch: Partial<SessionSnapshot> }
  | { kind: "log"; at: number; id: string; line: LogLine }
  | { kind: "transition"; at: number; id: string; from: SessionState; to: SessionState }
  | { kind: "gone"; at: number; id: string };
