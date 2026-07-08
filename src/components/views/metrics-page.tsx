"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Filters, HeatMetric, MetricsPayload, RangeKey } from "./metrics/types.ts";
import {
  buildSeries, computeDeltas, computeTotals, dataSpan, filterRows,
  perDay, perModel, perProject, perProvider, rangeStartMs, topSlices,
  type SeriesMetric,
} from "./metrics/aggregate.ts";
import { fmtCost, fmtCostFull, fmtDay, fmtInt, fmtTokens } from "./metrics/format.ts";
import { FilterBar } from "./metrics/filter-bar.tsx";
import { StatGrid, type StatDef } from "./metrics/stat-cards.tsx";
import { Heatmap } from "./metrics/heatmap.tsx";
import { Donut } from "./metrics/donut.tsx";
import { MultiAreaChart, type ChartSeries } from "./metrics/area-chart.tsx";
import { GroupTable } from "./metrics/tables.tsx";
import { useCockpit } from "@/lib/client/store";
import { providerMeta } from "@/lib/shared/providers";

const HEAT_OPTS: { k: HeatMetric; label: string }[] = [
  { k: "sessions", label: "sessions" },
  { k: "cost", label: "cost" },
  { k: "output", label: "output" },
];
// Variables the user can plot on the over-time chart. Colors are a validated
// categorical palette (dataviz skill) exposed as CSS vars in metrics.css, in a
// fixed CVD-safe order — never cycle or reassign by rank. The chart normalizes
// each series to its own max, so mixing $ / tokens / counts stays comparable.
interface SeriesDef { key: SeriesMetric; label: string; color: string; unit: string; format: (n: number) => string }
const OVER_TIME_METRICS: SeriesDef[] = [
  { key: "cost", label: "cost", color: "var(--mx-s-cost)", unit: "", format: fmtCost },
  { key: "output", label: "output", color: "var(--mx-s-output)", unit: "tok", format: fmtTokens },
  { key: "sessions", label: "sessions", color: "var(--mx-s-sessions)", unit: "", format: fmtInt },
  { key: "toolUses", label: "tool calls", color: "var(--mx-s-tools)", unit: "", format: fmtInt },
  { key: "input", label: "input", color: "var(--mx-s-input)", unit: "tok", format: fmtTokens },
  { key: "cacheRead", label: "cache read", color: "var(--mx-s-cache-read)", unit: "tok", format: fmtTokens },
  { key: "cacheCreate", label: "cache create", color: "var(--mx-s-cache-create)", unit: "tok", format: fmtTokens },
  { key: "messages", label: "messages", color: "var(--mx-s-messages)", unit: "", format: fmtInt },
];

export function MetricsPage() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const visibleProviders = useCockpit((s) => s.visibleProviders);
  const metricsVersion = useCockpit((s) => s.metricsVersion);
  const [filters, setFilters] = useState<Filters>({ range: "all", providers: [], projects: [], models: [] });
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("sessions");
  const [overMetrics, setOverMetrics] = useState<SeriesMetric[]>(["cost"]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as MetricsPayload;
      setPayload(j);
      setNow(Date.now());
      setErr(null);
      setFlashKey((k) => k + 1);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  };

  // Refetch when the server signals fresh data over WS (metrics.dirty);
  // the slow interval is only a fallback for dropped sockets.
  useEffect(() => { void refresh(); }, [metricsVersion]);
  useEffect(() => { const id = setInterval(() => void refresh(), 60_000); return () => clearInterval(id); }, []);

  // Aggregate across every provider toggled on in the top bar, so selecting
  // several (Claude + Codex + Grok …) sums their cost/tokens into one map.
  const rows = useMemo(
    () => (payload?.sessions ?? []).filter((r) => visibleProviders.includes(r.provider)),
    [payload, visibleProviders],
  );

  const view = useMemo(() => {
    const filtered = filterRows(rows, filters, now);
    const totals = computeTotals(filtered);
    const deltas = computeDeltas(rows, filters, now);
    const providers = perProvider(filtered);
    const projects = perProject(filtered);
    const models = perModel(filtered);
    const days = perDay(filtered);
    const span = dataSpan(rows);
    const from = rangeStartMs(filters.range, now) ?? span?.first ?? now;
    const costByProvider = topSlices(providers, 6, (g) => g.cost);
    const costByProject = topSlices(projects, 8, (g) => g.cost);
    const costByModel = topSlices(models, 8, (g) => g.cost);
    return { filtered, totals, deltas, providers, projects, models, days, from, costByProvider, costByProject, costByModel, span };
  }, [rows, filters, now]);

  const allProviders = useMemo(() => perProvider(rows).map((g) => ({ key: g.key, label: g.label })), [rows]);
  const allProjects = useMemo(() => perProject(rows).map((g) => ({ key: g.key, label: g.label, sub: g.sub })), [rows]);
  const allModels = useMemo(() => perModel(rows).map((g) => ({ key: g.key, label: g.label })), [rows]);

  const spanLabel = view.span
    ? `${fmtDay(new Date(view.span.first).toISOString().slice(0, 10))} → now`
    : "no data";

  const stats: StatDef[] = useMemo(() => {
    const t = view.totals;
    const d = view.deltas;
    const live = visibleProviders.reduce((n, p) => n + (payload?.liveByProvider?.[p] ?? 0), 0);
    return [
      { key: "sessions", label: "Sessions", value: t.sessions, format: fmtInt, foot: `${live} live · ${t.done} done · ${t.error} error`, delta: d?.sessions, deltaGood: "up" },
      { key: "cost", label: "Est. cost", value: t.cost, format: fmtCostFull, foot: `public list prices`, delta: d?.cost, deltaGood: "down", accent: true },
      { key: "output", label: "Output tokens", value: t.output, format: fmtTokens, foot: `${fmtTokens(t.input)} input`, delta: d?.output, deltaGood: "up" },
      { key: "cache", label: "Cache read", value: t.cacheRead, format: fmtTokens, foot: `${fmtTokens(t.cacheCreate)} cache create`, deltaGood: "up" },
      { key: "tools", label: "Tool calls", value: t.toolUses, format: fmtInt, foot: `${fmtInt(t.messages)} messages`, delta: d?.toolUses, deltaGood: "up" },
    ];
  }, [view.totals, view.deltas, payload?.liveByProvider, visibleProviders]);

  const activeProjects = useMemo(() => new Set(filters.projects), [filters.projects]);
  const toggleProject = (cwd: string) =>
    setFilters((f) => ({ ...f, projects: f.projects.includes(cwd) ? f.projects.filter((x) => x !== cwd) : [...f.projects, cwd] }));

  const activeProviders = useMemo(() => new Set(filters.providers), [filters.providers]);
  const toggleProvider = (id: string) =>
    setFilters((f) => ({ ...f, providers: f.providers.includes(id) ? f.providers.filter((x) => x !== id) : [...f.providers, id] }));

  // Toggle a variable on the over-time chart; never let the last one turn off so
  // the chart always has at least one series to draw.
  const toggleOverMetric = (k: SeriesMetric) =>
    setOverMetrics((cur) => cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k]);

  // A normalized series per toggled-on variable, in the registry's fixed order
  // (colors stay bound to the variable, not to its rank in the selection).
  const overTime: ChartSeries[] = useMemo(
    () => OVER_TIME_METRICS
      .filter((m) => overMetrics.includes(m.key))
      .map((m) => ({ key: m.key, label: m.label, color: m.color, unit: m.unit, format: m.format, points: buildSeries(view.days, m.key, view.from, now) })),
    [overMetrics, view.days, view.from, now],
  );

  const provLabel = visibleProviders.length === 1 && visibleProviders[0]
    ? providerMeta(visibleProviders[0]).label
    : `${visibleProviders.length} providers`;

  return (
    <div className="mx-shell">
      <div className="mx-header">
        <div>
          <h1>Metrics · {provLabel}</h1>
          <p className="sub">All-time usage across {provLabel}. Toggle providers in the top bar to combine them. Filter by range, project or model. Refreshes every 15s.</p>
        </div>
        <button className={`btn btn-refresh${refreshing ? " is-spinning" : ""}`} onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
          <RefreshIcon /><span>Refresh</span>
        </button>
      </div>

      {err && <div className="mx-err">{err}</div>}
      {!payload && loading && <div className="mx-stat-grid">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="mx-skel" />)}</div>}

      {payload && (
        <>
          <FilterBar
            range={filters.range}
            onRange={(r: RangeKey) => setFilters((f) => ({ ...f, range: r }))}
            providerOpts={allProviders}
            selectedProviders={filters.providers}
            onProviders={(v) => setFilters((f) => ({ ...f, providers: v }))}
            projectOpts={allProjects}
            selectedProjects={filters.projects}
            onProjects={(v) => setFilters((f) => ({ ...f, projects: v }))}
            modelOpts={allModels}
            selectedModels={filters.models}
            onModels={(v) => setFilters((f) => ({ ...f, models: v }))}
            spanLabel={spanLabel}
            onClear={() => setFilters({ range: "all", providers: [], projects: [], models: [] })}
          />

          <StatGrid stats={stats} flashKey={flashKey} />

          <section className="mx-card mx-wide">
            <div className="mx-card-h">
              <span>Activity calendar</span>
              <Toggle opts={HEAT_OPTS} value={heatMetric} onChange={setHeatMetric} />
            </div>
            <Heatmap bucket={view.days} metric={heatMetric} from={view.from} to={now} />
          </section>

          <section className="mx-card mx-wide">
            <div className="mx-card-h">
              <span>Over time</span>
              <span className="mx-h-sub">pick one or more variables to plot</span>
            </div>
            <MetricPicker defs={OVER_TIME_METRICS} active={overMetrics} onToggle={toggleOverMetric} />
            <MultiAreaChart series={overTime} />
          </section>

          <div className="mx-donuts">
            <Donut title="Cost by provider" slices={view.costByProvider} total={view.totals.cost} format={fmtCostFull} centerLabel={fmtCost(view.totals.cost)} />
            <Donut title="Cost by project" slices={view.costByProject} total={view.totals.cost} format={fmtCostFull} centerLabel={fmtCost(view.totals.cost)} />
            <Donut title="Cost by model" slices={view.costByModel} total={view.totals.cost} format={fmtCostFull} centerLabel={fmtCost(view.totals.cost)} />
          </div>

          <section className="mx-card mx-wide">
            <div className="mx-card-h"><span>Per provider</span><span className="mx-h-sub">click a row to filter</span></div>
            <GroupTable rows={view.providers} kind="provider" activeKeys={activeProviders} onToggle={toggleProvider} />
          </section>

          <section className="mx-card mx-wide">
            <div className="mx-card-h"><span>Per project</span><span className="mx-h-sub">click a row to filter</span></div>
            <GroupTable rows={view.projects} kind="project" activeKeys={activeProjects} onToggle={toggleProject} />
          </section>

          <section className="mx-card mx-wide">
            <div className="mx-card-h"><span>Per model</span></div>
            <GroupTable rows={view.models} kind="model" />
          </section>
        </>
      )}
    </div>
  );
}

function Toggle<T extends string>({ opts, value, onChange }: { opts: { k: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mx-toggle" role="radiogroup">
      {opts.map((o) => (
        <button key={o.k} role="radio" aria-checked={value === o.k} className={value === o.k ? "on" : ""} onClick={() => onChange(o.k)}>{o.label}</button>
      ))}
    </div>
  );
}

// Chips double as an interactive legend: each shows its series color, click to
// add/remove it from the plot. Active chips tint to their own color; ≥1 stays on.
function MetricPicker({ defs, active, onToggle }: { defs: SeriesDef[]; active: SeriesMetric[]; onToggle: (k: SeriesMetric) => void }) {
  return (
    <div className="mx-metric-pick" role="group" aria-label="Variables to plot over time">
      {defs.map((d) => {
        const on = active.includes(d.key);
        return (
          <button
            key={d.key}
            type="button"
            className={`mx-metric-chip${on ? " on" : ""}`}
            aria-pressed={on}
            style={{ ["--chip-c" as string]: d.color } as CSSProperties}
            onClick={() => onToggle(d.key)}
          >
            <span className="dot" />{d.label}
          </button>
        );
      })}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" />
    </svg>
  );
}
