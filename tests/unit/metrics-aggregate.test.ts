import { describe, expect, it } from "vitest";
import { buildSeries, perDay, type SeriesMetric } from "@/components/views/metrics/aggregate.ts";
import type { SessionRow } from "@/components/views/metrics/types.ts";

// Minimal row factory: only the fields perDay/buildSeries read matter, the rest
// are inert defaults so the object still satisfies SessionRow.
function row(over: Partial<SessionRow>): SessionRow {
  return {
    id: "s", provider: "claude", cwd: "/p", project: "p", model: "m", rawModel: null,
    startedAt: 0, endedAt: 0, day: null,
    input: 0, output: 0, cacheRead: 0, cacheCreate: 0, toolUses: 0, messages: 0, cost: 0,
    state: "done", daily: {},
    ...over,
  };
}

const DAY = "2026-07-01";
const dayMs = Date.parse(`${DAY}T00:00:00Z`);
const val = (rows: SessionRow[], m: SeriesMetric): number | undefined =>
  buildSeries(perDay(rows), m, dayMs, dayMs)[0]?.value;

describe("metrics over-time aggregation — new variables", () => {
  it("perDay accumulates input/cache/messages/tools on the session end day", () => {
    const days = perDay([
      row({ day: DAY, input: 100, cacheRead: 200, cacheCreate: 30, messages: 8, toolUses: 5 }),
      row({ day: DAY, input: 50, cacheRead: 10, cacheCreate: 5, messages: 2, toolUses: 1 }),
    ]);
    const b = days.get(DAY)!;
    expect(b.input).toBe(150);
    expect(b.cacheRead).toBe(210);
    expect(b.cacheCreate).toBe(35);
    expect(b.messages).toBe(10);
    expect(b.toolUses).toBe(6);
    expect(b.sessions).toBe(2);
  });

  it("buildSeries plots every new variable from the day bucket", () => {
    const rows = [row({ day: DAY, input: 100, cacheRead: 200, cacheCreate: 30, messages: 8 })];
    expect(val(rows, "input")).toBe(100);
    expect(val(rows, "cacheRead")).toBe(200);
    expect(val(rows, "cacheCreate")).toBe(30);
    expect(val(rows, "messages")).toBe(8);
  });

  it("cost and output still come from the per-message daily breakdown, not the row totals", () => {
    // r.cost/r.output are the whole-session totals; the day series must use the
    // finer per-message `daily` split so multi-day sessions attribute correctly.
    const rows = [row({ day: DAY, cost: 999, output: 999, daily: { [DAY]: { c: 2.5, o: 40 } } })];
    expect(val(rows, "cost")).toBe(2.5);
    expect(val(rows, "output")).toBe(40);
  });

  it("a variable with no data reports zero for the day", () => {
    const rows = [row({ day: DAY, input: 100 })];
    expect(val(rows, "messages")).toBe(0);
  });
});
