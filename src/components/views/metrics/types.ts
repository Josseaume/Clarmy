import type { ProviderId } from "../../../lib/shared/providers.ts";

export interface SessionRow {
  readonly id: string;
  readonly provider: ProviderId;
  readonly cwd: string;
  readonly project: string;
  readonly model: string;
  readonly rawModel: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly day: string | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  readonly toolUses: number;
  readonly messages: number;
  readonly cost: number;
  readonly state: "done" | "error" | "ongoing";
  // Per-day breakdown by message timestamp (cost `c`, output tokens `o`), so
  // multi-day sessions attribute spend to the day it actually happened rather
  // than dumping it all on the end date.
  readonly daily: Record<string, { c: number; o: number }>;
  // Per-model slices (cost/tokens attributed to the model of each record, so
  // workflow subagents on a different model than the session land correctly).
  // Optional for backward compatibility with older cached payloads.
  readonly models?: Record<string, { cost: number; input: number; output: number; cacheRead: number }>;
}

export interface MetricsPayload {
  readonly generatedAt: number;
  readonly liveSessions: number;
  readonly liveByProvider?: Partial<Record<ProviderId, number>>;
  readonly sessions: readonly SessionRow[];
}

export type RangeKey = "7d" | "30d" | "90d" | "1y" | "all";

export const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: null,
};

export interface Filters {
  readonly range: RangeKey;
  readonly providers: readonly string[]; // ProviderId[]
  readonly projects: readonly string[]; // cwd[]
  readonly models: readonly string[];
}

export type HeatMetric = "sessions" | "cost" | "output";

export interface Totals {
  sessions: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  toolUses: number;
  messages: number;
  done: number;
  error: number;
}

export interface GroupRow {
  readonly key: string;
  readonly label: string;
  readonly sub?: string;
  sessions: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  toolUses: number;
  lastRunAt: number;
}

export interface DayBucket {
  sessions: number;
  cost: number;
  output: number;
  toolUses: number;
  input: number;
  cacheRead: number;
  cacheCreate: number;
  messages: number;
}
