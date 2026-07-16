"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCockpit } from "@/lib/client/store";
import { ClaudeIcon, CodexIcon, GrokIcon, OpenCodeIcon, type ProviderIcon } from "./provider-icons";
import { PROVIDERS } from "@/lib/shared/providers";
import type { ProviderId } from "@/lib/shared/types";

// Icon-only provider chips in the header. Mono variants follow `currentColor`,
// so every glyph renders in one uniform color (CSS-driven), not its brand hue.
const PROVIDER_ICON: Record<ProviderId, ProviderIcon> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
};

function titleFor(pathname: string): string {
  if (pathname === "/") return "Sessions · dashboard";
  if (pathname.startsWith("/focus/")) return "Sessions · focus";
  if (pathname === "/new") return "Sessions · new";
  if (pathname === "/mcp") return "Config · MCP servers";
  if (pathname === "/theme-ab") return "Theme A/B";
  return "Cockpit";
}

interface MetricsPayload {
  sessions: Array<{ provider: ProviderId; daily: Record<string, { c: number }> }>;
}

function fmtCost(n: number): string {
  if (!n) return "$0.00";
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function Topbar() {
  const pathname = usePathname();
  const sessions = useCockpit((s) => s.sessions);
  const setTweaks = useCockpit((s) => s.setTweaks);
  const setCmdkOpen = useCockpit((s) => s.setCmdkOpen);
  const visibleProviders = useCockpit((s) => s.visibleProviders);
  const toggleProvider = useCockpit((s) => s.toggleProvider);
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/metrics", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as MetricsPayload;
        if (!alive) return;
        setPayload(j);
      } catch {}
    };
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayCost = payload
    ? payload.sessions.reduce((a, r) => a + (visibleProviders.includes(r.provider) ? (r.daily?.[today]?.c ?? 0) : 0), 0)
    : null;
  const count = Object.values(sessions).filter((s) => visibleProviders.includes(s.provider)).length;

  // Only chip the providers that actually have live sessions right now (e.g.
  // Claude + Grok), so the filter row reflects what's running instead of always
  // listing every vendor. Gated on `mounted` to avoid a hydration mismatch
  // (server has no session state) and falls back to all providers when nothing
  // is running yet, so the row never goes empty.
  const activeProviderIds = new Set(Object.values(sessions).map((s) => s.provider));
  const shownProviders = mounted && activeProviderIds.size > 0
    ? PROVIDERS.filter((p) => activeProviderIds.has(p.id))
    : PROVIDERS;

  return (
    <header className="topbar">
      <div className="title">
        <strong>{titleFor(pathname)}</strong>
      </div>
      <div className="provider-tabs" role="group" aria-label="Providers to display">
        {shownProviders.map((p) => {
          // Multi-select: every visible provider's sessions show on the dashboard
          // at once. The button toggles its provider in/out of that set.
          const on = mounted && visibleProviders.includes(p.id);
          const Ico = PROVIDER_ICON[p.id];
          return (
          <button
            key={p.id}
            suppressHydrationWarning
            aria-pressed={on}
            aria-label={p.label}
            className={`provider-tab${on ? " on" : ""}`}
            style={{ ["--provider-accent" as string]: p.accent }}
            onClick={() => toggleProvider(p.id)}
            title={`${p.tagline} — click to show/hide`}
          >
            <Ico size={18} color="currentColor" />
          </button>
          );
        })}
      </div>
      <div className="meta">
        <span><span className="k">sessions</span><span className="v">{count}</span></span>
        <span><span className="k">cost today</span><span className="v">{todayCost === null ? "…" : fmtCost(todayCost)}</span></span>
        <button className="cmdk-trigger" onClick={() => setCmdkOpen(true)}>
          <span>Search or run a command</span>
          <span className="kbd">⌘K</span>
        </button>
        {/* Active segment is CSS-driven from html[data-theme] (see globals.css),
            so it is correct on first paint — no mounted gate, no hydration
            mismatch. Clicking always writes an explicit dark/light preference. */}
        <div className="theme-toggle" role="tablist">
          <button className="theme-opt-dark" onClick={() => setTweaks({ theme: "dark" })}>dark</button>
          <button className="theme-opt-light" onClick={() => setTweaks({ theme: "light" })}>light</button>
        </div>
      </div>
    </header>
  );
}
