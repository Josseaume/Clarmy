import type { DayBucket, Filters, GroupRow, RangeKey, SessionRow, Totals } from "./types.ts";
import { RANGE_DAYS } from "./types.ts";
import { providerMeta } from "../../../lib/shared/providers.ts";

const DAY_MS = 86_400_000;

export function rangeStartMs(range: RangeKey, now: number): number | null {
  const days = RANGE_DAYS[range];
  return days == null ? null : now - days * DAY_MS;
}

function matchPM(r: SessionRow, f: Filters): boolean {
  if (f.providers.length && !f.providers.includes(r.provider)) return false;
  if (f.projects.length && !f.projects.includes(r.cwd)) return false;
  if (f.models.length) {
    const used = r.models && Object.keys(r.models).length > 0 ? Object.keys(r.models) : [r.model];
    if (!f.models.some((m) => used.includes(m))) return false;
  }
  return true;
}

export function filterRows(rows: readonly SessionRow[], f: Filters, now: number): SessionRow[] {
  const start = rangeStartMs(f.range, now);
  return rows.filter((r) => matchPM(r, f) && (start == null || r.endedAt >= start));
}

function windowRows(rows: readonly SessionRow[], f: Filters, from: number, to: number): SessionRow[] {
  return rows.filter((r) => matchPM(r, f) && r.endedAt >= from && r.endedAt < to);
}

export function emptyTotals(): Totals {
  return { sessions: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, toolUses: 0, messages: 0, done: 0, error: 0 };
}

export function computeTotals(rows: readonly SessionRow[]): Totals {
  const t = emptyTotals();
  for (const r of rows) {
    t.sessions++;
    t.cost += r.cost;
    t.input += r.input;
    t.output += r.output;
    t.cacheRead += r.cacheRead;
    t.cacheCreate += r.cacheCreate;
    t.toolUses += r.toolUses;
    t.messages += r.messages;
    if (r.state === "done") t.done++;
    else if (r.state === "error") t.error++;
  }
  return t;
}

export interface Deltas {
  sessions: number;
  cost: number;
  output: number;
  toolUses: number;
}

// Percent change of the current window vs the immediately preceding window of
// equal length. Null for the "all" range (no prior period to compare).
export function computeDeltas(rows: readonly SessionRow[], f: Filters, now: number): Deltas | null {
  const days = RANGE_DAYS[f.range];
  if (days == null) return null;
  const span = days * DAY_MS;
  const cur = computeTotals(windowRows(rows, f, now - span, now + 1));
  const prev = computeTotals(windowRows(rows, f, now - 2 * span, now - span));
  const pct = (c: number, p: number) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);
  return {
    sessions: pct(cur.sessions, prev.sessions),
    cost: pct(cur.cost, prev.cost),
    output: pct(cur.output, prev.output),
    toolUses: pct(cur.toolUses, prev.toolUses),
  };
}

function group(rows: readonly SessionRow[], keyOf: (r: SessionRow) => string, labelOf: (r: SessionRow) => string, subOf?: (r: SessionRow) => string): GroupRow[] {
  const by = new Map<string, GroupRow>();
  for (const r of rows) {
    const key = keyOf(r);
    let g = by.get(key);
    if (!g) {
      g = { key, label: labelOf(r), sub: subOf?.(r), sessions: 0, cost: 0, input: 0, output: 0, cacheRead: 0, toolUses: 0, lastRunAt: 0 };
      by.set(key, g);
    }
    g.sessions++;
    g.cost += r.cost;
    g.input += r.input;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
    g.toolUses += r.toolUses;
    if (r.endedAt > g.lastRunAt) g.lastRunAt = r.endedAt;
  }
  return Array.from(by.values()).sort((a, b) => b.cost - a.cost);
}

export function perProject(rows: readonly SessionRow[]): GroupRow[] {
  return group(rows, (r) => r.cwd, (r) => r.project, (r) => r.cwd);
}

export function perProvider(rows: readonly SessionRow[]): GroupRow[] {
  return group(rows, (r) => r.provider, (r) => providerMeta(r.provider).label);
}

export function perModel(rows: readonly SessionRow[]): GroupRow[] {
  // Aggregate from the per-record model slices so subagent spend lands on the
  // model that actually ran (fable readers under an opus session, etc.). A
  // session counts once under every model it used; tool uses stay on its main
  // model since records do not attribute them.
  const by = new Map<string, GroupRow>();
  const get = (label: string): GroupRow => {
    let g = by.get(label);
    if (!g) {
      g = { key: label, label, sessions: 0, cost: 0, input: 0, output: 0, cacheRead: 0, toolUses: 0, lastRunAt: 0 };
      by.set(label, g);
    }
    return g;
  };
  for (const r of rows) {
    const slices = r.models && Object.keys(r.models).length > 0
      ? r.models
      : { [r.model]: { cost: r.cost, input: r.input, output: r.output, cacheRead: r.cacheRead } };
    for (const [label, sl] of Object.entries(slices)) {
      const g = get(label);
      g.sessions++;
      g.cost += sl.cost;
      g.input += sl.input;
      g.output += sl.output;
      g.cacheRead += sl.cacheRead;
      if (r.endedAt > g.lastRunAt) g.lastRunAt = r.endedAt;
    }
    get(r.model).toolUses += r.toolUses;
  }
  return Array.from(by.values()).sort((a, b) => b.cost - a.cost);
}

export function perDay(rows: readonly SessionRow[]): Map<string, DayBucket> {
  const m = new Map<string, DayBucket>();
  const get = (d: string): DayBucket => {
    let b = m.get(d);
    if (!b) { b = { sessions: 0, cost: 0, output: 0, toolUses: 0, input: 0, cacheRead: 0, cacheCreate: 0, messages: 0 }; m.set(d, b); }
    return b;
  };
  for (const r of rows) {
    // Cost / output by the day each message happened (matches ccusage-style
    // per-day accounting), not the session's end date.
    for (const [day, e] of Object.entries(r.daily)) {
      const b = get(day);
      b.cost += e.c;
      b.output += e.o;
    }
    // A session and its tools count once, on the day it ended. Input/cache/
    // messages have no per-message-day breakdown in `r.daily` (only cost/output
    // do), so they land on the end day too — consistent with sessions/tools.
    if (r.day) {
      const b = get(r.day);
      b.sessions++;
      b.toolUses += r.toolUses;
      b.input += r.input;
      b.cacheRead += r.cacheRead;
      b.cacheCreate += r.cacheCreate;
      b.messages += r.messages;
    }
  }
  return m;
}

export function dataSpan(rows: readonly SessionRow[]): { first: number; last: number } | null {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const r of rows) {
    if (r.endedAt && r.endedAt < first) first = r.endedAt;
    if (r.endedAt > last) last = r.endedAt;
  }
  if (last === 0) return null;
  return { first: Number.isFinite(first) ? first : last, last };
}

function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortLabel(key: string): string {
  const mo = Number(key.slice(5, 7)) - 1;
  const d = Number(key.slice(8, 10));
  return `${SHORT_MONTHS[mo]} ${d}`;
}

export type SeriesMetric = "cost" | "output" | "sessions" | "toolUses" | "input" | "cacheRead" | "cacheCreate" | "messages";

export interface SeriesPoint { t: number; label: string; value: number }

// Continuous time series over [from, to], gap-filled. Daily buckets up to ~92
// days, then weekly so the axis stays legible over long spans.
export function buildSeries(buckets: Map<string, import("./types.ts").DayBucket>, metric: SeriesMetric, from: number, to: number): SeriesPoint[] {
  const startKey = dayKeyUTC(from);
  const endKey = dayKeyUTC(to);
  const days: string[] = [];
  let cur = startKey;
  for (let i = 0; i < 800 && cur <= endKey; i++) { days.push(cur); cur = addDaysKey(cur, 1); }
  // Every SeriesMetric name is a numeric DayBucket field, so index straight in.
  const valueOf = (k: string): number => buckets.get(k)?.[metric] ?? 0;
  const weekly = days.length > 92;
  const points: SeriesPoint[] = [];
  if (!weekly) {
    for (const k of days) points.push({ t: Date.parse(`${k}T00:00:00Z`), label: shortLabel(k), value: valueOf(k) });
  } else {
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0]!;
      let v = 0;
      for (const k of chunk) v += valueOf(k);
      points.push({ t: Date.parse(`${first}T00:00:00Z`), label: shortLabel(first), value: v });
    }
  }
  return points;
}

// Donut slices: top N groups by cost, rest folded into "other".
export interface Slice { key: string; label: string; value: number }

export function topSlices(groups: readonly GroupRow[], n: number, valueOf: (g: GroupRow) => number): Slice[] {
  const sorted = [...groups].sort((a, b) => valueOf(b) - valueOf(a)).filter((g) => valueOf(g) > 0);
  const head = sorted.slice(0, n).map((g) => ({ key: g.key, label: g.label, value: valueOf(g) }));
  const rest = sorted.slice(n);
  if (rest.length) {
    const sum = rest.reduce((a, g) => a + valueOf(g), 0);
    if (sum > 0) head.push({ key: "__other__", label: `+${rest.length} other`, value: sum });
  }
  return head;
}
