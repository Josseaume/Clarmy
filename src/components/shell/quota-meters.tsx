"use client";

import { useEffect, useState } from "react";
import type { ProviderQuota, QuotaWindow, QuotasResponse } from "@/lib/shared/quota";
import { AsciiBar } from "./ascii-bar";
import { useCockpit } from "@/lib/client/store";

type Level = "ok" | "warn" | "crit";

function levelFor(pct: number | null): Level {
  if (pct === null) return "ok";
  if (pct >= 90) return "crit";
  if (pct >= 75) return "warn";
  return "ok";
}

function fmtReset(ms: number | null): string | null {
  if (ms === null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return "resets now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m > 0 ? `${h}h${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24}h`;
}

// Absolute reset moment in the viewer's local timezone, e.g. "Thu 29 May 14:20".
function fmtResetAt(ms: number | null): string | null {
  if (ms === null) return null;
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function WindowLine({ w }: { w: QuotaWindow }) {
  const at = fmtResetAt(w.resetsAt);
  const rel = fmtReset(w.resetsAt);
  const title = at ? `${w.label} · resets ${at}${rel ? ` (${rel})` : ""}` : w.label;
  return (
    <div className="quota-wline" title={title}>
      <span className="quota-wlabel">{w.label}</span>
      <AsciiBar pct={w.usedPercent} cells={11} tone={levelFor(w.usedPercent)} size="sm" />
      <span className="quota-wpct">{Math.round(w.usedPercent)}%</span>
    </div>
  );
}

function windowResetLine(w: QuotaWindow): string {
  const at = fmtResetAt(w.resetsAt);
  const rel = fmtReset(w.resetsAt);
  const head = `${w.label} ${Math.round(w.usedPercent)}%`;
  return at ? `${head} · resets ${at}${rel ? ` (${rel})` : ""}` : head;
}

function QuotaMeter({ q }: { q: ProviderQuota }) {
  const pct = q.usedPercent;
  const hasWindows = q.windows.length > 0;
  // Hovering anywhere on the row reveals when each window rolls over, so the
  // reset time is discoverable without having to hit the thin per-window bars.
  const headTitle = hasWindows
    ? q.windows.map(windowResetLine).join("\n")
    : q.detail ?? undefined;

  return (
    <div className="quota-row" data-state={q.state}>
      <div className="quota-head" title={headTitle}>
        <span className="quota-name">
          {q.label}
          {q.plan && <em>{q.plan}</em>}
        </span>
        <span className="quota-pct">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
      </div>
      {hasWindows
        ? q.windows.map((w) => <WindowLine key={w.label} w={w} />)
        : pct !== null
          ? <AsciiBar pct={pct} cells={16} tone={levelFor(pct)} size="sm" />
          : null}
      {q.detail && !hasWindows && (
        <div className="quota-cap" title={q.detail}>{q.detail}</div>
      )}
    </div>
  );
}

function SkeletonRow({ name }: { name: string }) {
  return (
    <div className="quota-row" data-state="loading">
      <div className="quota-head">
        <span className="quota-name">{name}</span>
        <span className="quota-pct">··</span>
      </div>
      <AsciiBar pct={null} cells={16} tone="ok" size="sm" />
    </div>
  );
}

const PLACEHOLDER = ["Claude", "Codex"];

export function QuotaMeters() {
  // Live snapshots arrive over WS (quotas.update); the fetch covers the first
  // paint before the socket delivers, and a slow timer covers dropped sockets.
  const pushed = useCockpit((s) => s.quotas);
  // null = still loading the first response; [] = loaded but nothing to show.
  const [fetched, setFetched] = useState<readonly ProviderQuota[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/quotas", { cache: "no-store" });
        if (!alive) return;
        if (!res.ok) throw new Error(`status ${res.status}`);
        const j = (await res.json()) as QuotasResponse;
        if (!alive) return;
        setFetched(j.providers ?? []);
        setFailed(false);
      } catch {
        if (!alive) return;
        setFailed(true);
        setFetched((prev) => prev ?? []);
      }
    };
    void load();
    const id = setInterval(load, 300_000); // fallback only; WS drives updates
    return () => { alive = false; clearInterval(id); };
  }, []);

  const providers = pushed ? pushed.providers : fetched;

  // Always render the section so the gauges never silently vanish.
  return (
    <div className="quota-group" data-testid="quota-group">
      <div className="nav-label">Quotas</div>
      {providers === null
        ? PLACEHOLDER.map((n) => <SkeletonRow key={n} name={n} />)
        : providers.length > 0
          ? providers.map((q) => <QuotaMeter key={q.provider} q={q} />)
          : (
            <div className="quota-row" data-state="error">
              <div className="quota-cap">{failed ? "usage unavailable" : "no usage data"}</div>
            </div>
          )}
    </div>
  );
}
