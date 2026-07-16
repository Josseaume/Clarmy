"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelId } from "@/lib/shared/types";
import { modelFromApiId, defaultModelFor, providerOfModel, isOpenCodeModelId } from "@/lib/shared/models";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/shared/providers";

interface CCSessionRow {
  provider: ProviderId;
  id: string; file: string; cwd: string; project: string; branch?: string;
  startedAt: number; endedAt: number; durationMs: number;
  model?: string; firstPrompt: string; messageCount: number; toolUses: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number;
  state: "done" | "error" | "ongoing"; version?: string;
}

type Filter = "all" | "done" | "error";

// A row is resumable only when we know a real working directory to launch the
// CLI in; everything with an absolute/home path can be resumed.
function canResume(cwd: string): boolean {
  return cwd.startsWith("/") || cwd.startsWith("~");
}

const COLS = "76px minmax(240px, 2fr) 120px 100px 56px 76px 76px 66px 90px";
const CHIP: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10.5, transition: "color .25s, text-shadow .25s" };
const ERR_CHIP: React.CSSProperties = { color: "var(--state-error)", background: "rgba(239,68,68,0.08)", boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.2)", transition: "filter .2s" };

export function HistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CCSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [project, setProject] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumeErr, setResumeErr] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  const resume = async (r: CCSessionRow) => {
    setResumingId(r.id); setResumeErr(null);
    try {
      // The spawn API requires a model that belongs to the row's provider; fall
      // back to that provider's default when the transcript model is unknown or
      // (for cross-provider rows) belongs to a different vendor.
      const fromApi = r.model ? modelFromApiId(r.model) : null;
      // opencode routes to uncatalogued "provider/model" ids that modelFromApiId
      // can't map; keep the raw id so the resumed session stays on its model
      // instead of snapping to the opencode default.
      const model: ModelId = (r.provider === "opencode" && r.model && isOpenCodeModelId(r.model))
        ? (r.model as ModelId)
        : (fromApi && providerOfModel(fromApi) === r.provider)
          ? fromApi : defaultModelFor(r.provider);
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: r.provider, project: r.project, cwd: r.cwd,
          name: `resume · ${r.firstPrompt.slice(0, 60) || r.id}`,
          model, prompt: "", allowedTools: [], approvalMode: "prompt",
          branch: r.branch, resumeSessionId: r.id,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.push("/");
    } catch (e) { setResumeErr((e as Error).message); setResumingId(null); }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/history?limit=all`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { sessions: CCSessionRow[] };
      setRows(j.sessions); setErr(null); setFlashKey((k) => k + 1);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 30_000); return () => clearInterval(id); }, []);

  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.project);
    return Array.from(s).sort();
  }, [rows]);

  const providerCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.provider] = (m[r.provider] ?? 0) + 1;
    return m;
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filter !== "all" && r.state !== filter) return false;
    if (providerFilter !== "all" && r.provider !== providerFilter) return false;
    if (project && r.project !== project) return false;
    if (!q) return true;
    const qq = q.toLowerCase();
    return r.project.toLowerCase().includes(qq)
      || r.cwd.toLowerCase().includes(qq)
      || r.firstPrompt.toLowerCase().includes(qq)
      || (r.branch?.toLowerCase().includes(qq) ?? false);
  });

  const counts = {
    all: rows.length,
    done: rows.filter((r) => r.state === "done").length,
    error: rows.filter((r) => r.state === "error").length,
    ongoing: rows.filter((r) => r.state === "ongoing").length,
  };
  const totalTokens = rows.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  const maxTokens = Math.max(1, ...rows.map((r) => r.inputTokens + r.outputTokens));
  const chipStyle = (active: boolean): React.CSSProperties => active
    ? { ...CHIP, color: "color-mix(in srgb, var(--brand) 70%, var(--fg))", textShadow: "0 0 8px color-mix(in srgb, var(--brand) 30%, transparent)" }
    : { ...CHIP, color: "var(--fg-muted)" };

  return (
    <div className="cfg-shell metrics-shell">
      <div className="cfg-header">
        <div>
          <h1>History</h1>
          <p className="sub">
            {rows.length} sessions across Claude, Grok &amp; Codex. Sourced from each CLI&apos;s local history (<code>~/.claude</code>, <code>~/.grok</code>, <code>~/.codex</code>).
          </p>
        </div>
        <div className="right">
          <button className={`btn btn-refresh${refreshing ? " is-spinning" : ""}`} onClick={() => void refresh()} disabled={loading} aria-label="Refresh history">
            <RefreshIcon /><span>Refresh</span>
          </button>
        </div>
      </div>

      {!rows.length && loading && (
        <div className="stat-grid">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="metric-skel" />)}
        </div>
      )}

      {rows.length > 0 && (
        <div className="stat-grid">
          <StatCard flashKey={flashKey} label="Sessions" value={counts.all} format={fmtInt} foot={`${counts.ongoing} ongoing · ${counts.done} done · ${counts.error} error`} accent />
          <StatCard flashKey={flashKey} label="Completed" value={counts.done} format={fmtInt} foot="state = done" />
          <StatCard flashKey={flashKey} label="Errors" value={counts.error} format={fmtInt} foot="state = error" />
          <StatCard flashKey={flashKey} label="Total tokens" value={totalTokens} format={fmtTokens} foot="input + output across all runs" />
        </div>
      )}

      <h3 className="metric-h">Filter · search</h3>

      <div className="history-filter-bar">
        <div className="filter-tokens">
          <FilterToken label="all" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <span className="filter-sep" aria-hidden>·</span>
          <FilterToken label="done" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} />
          <span className="filter-sep" aria-hidden>·</span>
          <FilterToken label="error" count={counts.error} active={filter === "error"} onClick={() => setFilter("error")} />
        </div>
        <span className="filter-sep" aria-hidden>·</span>
        <div className="filter-tokens" role="group" aria-label="Filter by agent">
          <ProviderToken label="all agents" active={providerFilter === "all"} onClick={() => setProviderFilter("all")} count={rows.length} />
          {PROVIDERS.filter((p) => providerCounts[p.id]).map((p) => (
            <ProviderToken key={p.id} label={p.label} accent={p.accent} count={providerCounts[p.id] ?? 0}
              active={providerFilter === p.id} onClick={() => setProviderFilter(providerFilter === p.id ? "all" : p.id)} />
          ))}
        </div>
        <select className="filter-project-dd" value={project ?? ""} onChange={(e) => setProject(e.target.value || null)} aria-label="Filter by project">
          <option value="">all projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="Filter project · prompt · branch…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ marginLeft: "auto", width: 280, height: 32, padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11.5, color: "var(--fg)", transition: "border-color .2s, box-shadow .2s" }} />
        {err && <span style={{ fontSize: 11, color: "var(--state-error)" }}>{err}</span>}
      </div>

      {resumeErr && <div style={{ color: "var(--state-error)", fontSize: 11.5, marginBottom: 10 }}>Resume failed: {resumeErr}</div>}

      <h3 className="metric-h">Sessions · most recent first</h3>

      <div className="table-scroll">
        <div className="tools-table" style={{ minWidth: 960 }}>
          <div className="trow head" style={{ gridTemplateColumns: COLS }}>
            <span>agent</span>
            <span>prompt · project</span>
            <span>model</span>
            <span data-col="branch">branch</span>
            <span style={{ textAlign: "right" }}>msgs</span>
            <span style={{ textAlign: "right" }}>tokens</span>
            <span style={{ textAlign: "right" }}>when</span>
            <span style={{ textAlign: "right" }}>state</span>
            <span style={{ textAlign: "right" }}>action</span>
          </div>
          {loading && rows.length === 0 && (
            <div className="trow" style={{ gridTemplateColumns: "1fr", color: "var(--fg-muted)", justifyContent: "center" }}>
              <span style={{ textAlign: "center" }}>Scanning your Claude Code sessions…</span>
            </div>
          )}
          {!loading && filtered.slice(0, 400).map((r, i) => {
            const busy = resumingId === r.id;
            const tokens = r.inputTokens + r.outputTokens;
            const t = tokens / maxTokens;
            const isHov = hoverRow === r.file;
            return (
              <div key={r.file} className="trow m-row"
                onMouseEnter={() => setHoverRow(r.file)}
                onMouseLeave={() => setHoverRow((h) => (h === r.file ? null : h))}
                style={{ gridTemplateColumns: COLS, animation: "metric-rise .45s cubic-bezier(.2,.7,.2,1) both", animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <ProviderBadge provider={r.provider} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, maxWidth: 400 }}>
                  <span className="tname cell-ellipsis" title={r.firstPrompt}>{r.firstPrompt}</span>
                  <span className="tdesc cell-ellipsis" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }} title={`${r.project} · ${r.cwd}`}>{r.project} · {fmtDuration(r.durationMs)}</span>
                </span>
                <span className="tdesc cell-ellipsis" title={r.model ?? "—"} style={chipStyle(isHov)}>{r.model ?? "—"}</span>
                <span className="tdesc cell-ellipsis" data-col="branch" title={r.branch ?? "—"} style={chipStyle(isHov)}>{r.branch ?? "—"}</span>
                <span className="ncalls">{r.messageCount}</span>
                <span className="ncalls" style={{ textAlign: "right" }}>
                  <span className="m-cost" style={{ ["--t" as string]: `${t}` } as React.CSSProperties}>
                    <span>{fmtTokens(tokens)}</span>
                  </span>
                </span>
                <span className="ncalls">{fmtRel(r.endedAt)}</span>
                <span className={`tperm ${r.state === "done" ? "" : "ask"}`}
                  style={r.state === "error" ? { ...ERR_CHIP, filter: isHov ? "brightness(1.15)" : undefined } : { transition: "filter .2s", filter: isHov ? "brightness(1.15)" : undefined }}>
                  {r.state}
                </span>
                <button className="btn" disabled={busy || !canResume(r.cwd)} onClick={(e) => { e.stopPropagation(); void resume(r); }}
                  title={canResume(r.cwd) ? `${r.provider} resume ${r.id}` : "cannot resume: no known working directory for this session"}
                  style={{ justifySelf: "end", padding: "3px 10px", fontSize: 10.5, opacity: (busy || !canResume(r.cwd)) ? 0.4 : 1, transition: "border-color .2s, color .2s" }}>
                  {busy ? "…" : "↺ resume"}
                </button>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="trow" style={{ gridTemplateColumns: "1fr", color: "var(--fg-muted)", justifyContent: "center" }}>
              <span style={{ textAlign: "center" }}>No sessions match these filters.</span>
            </div>
          )}
        </div>
      </div>
      {filtered.length > 400 && (
        <p style={{ textAlign: "center", color: "var(--fg-muted)", fontSize: 11, marginTop: 10 }}>Showing 400 of {filtered.length} — narrow filters to see more.</p>
      )}
    </div>
  );
}

function StatCard({ label, value, format, foot, accent = false, flashKey }: { label: string; value: number; format: (n: number) => string; foot: string; accent?: boolean; flashKey: number }) {
  return (
    <div className={`metric-card${accent ? " is-accent" : ""}`}>
      <div className="mc-glow" />
      <div className="mc-sheen" key={flashKey} />
      <div className="mc-label">{label}</div>
      <div className="mc-value"><AnimatedNumber value={value} format={format} /></div>
      <div className="mc-foot" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{foot}</div>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: ProviderId }) {
  const meta = providerMeta(provider);
  return (
    <span title={`${meta.label} · ${meta.vendor}`} style={{
      justifySelf: "start", alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 9.5, lineHeight: 1.4,
      color: meta.accent, background: `color-mix(in srgb, ${meta.accent} 13%, transparent)`,
      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.accent} 34%, transparent)`, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.accent, boxShadow: `0 0 5px ${meta.accent}` }} />
      {meta.label}
    </span>
  );
}

function ProviderToken({ active, label, count, accent, onClick }: { active: boolean; label: string; count: number; accent?: string; onClick: () => void }) {
  return (
    <button className={`filter-token${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active} title={`${label} · ${count}`}
      style={active && accent ? { color: accent, borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` } : undefined}>
      {accent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, marginRight: 5, display: "inline-block" }} />}
      <span className="filter-count">{count}</span>
      <span className="filter-label">{label}</span>
    </button>
  );
}

function FilterToken({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button className={`filter-token${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active} title={`${label} · ${count}`}>
      <span className="filter-count">{count}</span>
      <span className="filter-label">{label}</span>
    </button>
  );
}

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const start = prevRef.current;
    const delta = value - start;
    if (Math.abs(delta) < 1e-9) { setDisplay(value); return; }
    const t0 = performance.now(); const dur = 850; let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setDisplay(start + delta * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else prevRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(display)}</>;
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

function fmtInt(n: number): string { return Math.round(n).toLocaleString(); }

function fmtDuration(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtRel(t: number): string {
  if (!t) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}
