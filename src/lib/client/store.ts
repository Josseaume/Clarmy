"use client";

import { create } from "zustand";
import type { SessionSnapshot, SessionEvent } from "../shared/types";
import type { QuotasResponse } from "../shared/quota";
import { maybeNotifyTransition } from "./notify";
import { coerceProviderId, DEFAULT_PROVIDER, PROVIDER_IDS, type ProviderId } from "../shared/providers";
import {
  buildAccentTokens,
  getMonoFontOption,
  getUiFontOption,
  resolveThemePreference,
  type ThemeMode,
} from "./theme-settings";
import { DEFAULT_TWEAKS, loadTweaks, normalizeTweaks, persistTweaks, type Tweaks } from "./tweaks-storage";

export { DEFAULT_TWEAKS, type Tweaks };

interface CockpitState {
  sessions: Record<string, SessionSnapshot>;
  order: string[];
  connected: boolean;
  tweaksOpen: boolean;
  cmdkOpen: boolean;
  approvalFor: SessionSnapshot | null;
  tweaks: Tweaks;
  // Concrete theme currently applied to <html data-theme>. Derived from
  // tweaks.theme by applyTweaks (and the OS listener when the preference is
  // "system"). Consumers needing a real color mode read this, never tweaks.theme.
  resolvedTheme: ThemeMode;
  // Active provider: the default for the New session form + the metrics view.
  // Always kept inside visibleProviders.
  provider: ProviderId;
  // Which providers' sessions the dashboard/sidebar show at once (multi-select).
  visibleProviders: ProviderId[];

  setProvider: (p: ProviderId) => void;
  toggleProvider: (p: ProviderId) => void;
  setTweaks: (patch: Partial<Tweaks>) => void;
  setTweaksOpen: (open: boolean) => void;
  setCmdkOpen: (open: boolean) => void;
  setApprovalFor: (s: SessionSnapshot | null) => void;
  setConnected: (c: boolean) => void;

  hydrateSessions: (list: readonly SessionSnapshot[]) => void;
  applyEvent: (e: SessionEvent) => void;
  // Bumped by the ws client on metrics.dirty; metrics consumers refetch on it.
  metricsVersion: number;
  bumpMetrics: () => void;
  // Latest quota snapshot pushed over WS; null until the first push lands.
  quotas: QuotasResponse | null;
  setQuotas: (q: QuotasResponse) => void;
}

const initialTweaks = loadTweaks();

export const useCockpit = create<CockpitState>((set, get) => ({
  sessions: {},
  order: [],
  connected: false,
  tweaksOpen: false,
  cmdkOpen: false,
  approvalFor: null,
  tweaks: initialTweaks,
  resolvedTheme: resolveThemePreference(initialTweaks.theme),
  provider: loadProvider(),
  visibleProviders: loadVisibleProviders(),
  metricsVersion: 0,
  bumpMetrics: () => set((s) => ({ metricsVersion: s.metricsVersion + 1 })),
  quotas: null,
  setQuotas: (q) => set({ quotas: q }),

  // Picking an active provider (e.g. spawning a session for it) also makes it
  // visible, so the new tile is never hidden by the current filter.
  setProvider: (p) => {
    persistProvider(p);
    const { visibleProviders } = get();
    const next = visibleProviders.includes(p)
      ? visibleProviders
      : PROVIDER_IDS.filter((id) => visibleProviders.includes(id) || id === p);
    if (next !== visibleProviders) persistVisibleProviders(next);
    set({ provider: p, visibleProviders: next });
  },

  // Toggle one provider in/out of the visible set. Never empties it, and keeps
  // the active provider valid (inside the set); enabling one makes it active.
  toggleProvider: (p) => {
    const s = get();
    const has = s.visibleProviders.includes(p);
    if (has && s.visibleProviders.length === 1) return; // keep at least one
    let visibleProviders: ProviderId[];
    let provider = s.provider;
    if (has) {
      visibleProviders = s.visibleProviders.filter((x) => x !== p);
      if (provider === p) provider = visibleProviders[0]!;
    } else {
      visibleProviders = PROVIDER_IDS.filter((x) => s.visibleProviders.includes(x) || x === p);
      provider = p;
    }
    persistVisibleProviders(visibleProviders);
    persistProvider(provider);
    set({ visibleProviders, provider });
  },

  setTweaks: (patch) => {
    const next = normalizeTweaks({ ...get().tweaks, ...patch });
    persistTweaks(next);
    applyTweaks(next);
    set({ tweaks: next });
  },
  setTweaksOpen: (o) => set({ tweaksOpen: o }),
  setCmdkOpen: (o) => set({ cmdkOpen: o }),
  setApprovalFor: (s) => set({ approvalFor: s }),
  setConnected: (c) => set({ connected: c }),

  hydrateSessions: (list) => {
    const sessions: Record<string, SessionSnapshot> = {};
    const order: string[] = [];
    for (const s of list) { sessions[s.id] = s; order.push(s.id); }
    set({ sessions, order });
  },

  applyEvent: (event) => {
    const { sessions, order } = get();
    if (event.kind === "init") {
      const { snapshot } = event;
      maybeNotifyTransition(sessions[snapshot.id], snapshot);
      set({
        sessions: { ...sessions, [snapshot.id]: snapshot },
        order: order.includes(snapshot.id) ? order : [...order, snapshot.id],
      });
      return;
    }
    if (event.kind === "gone") {
      if (!sessions[event.id]) return;
      const next = { ...sessions };
      delete next[event.id];
      set({ sessions: next, order: order.filter((id) => id !== event.id) });
      return;
    }
    if (event.kind === "patch") {
      const existing = sessions[event.id];
      if (!existing) return;
      const next = { ...existing, ...event.patch };
      maybeNotifyTransition(existing, next);
      set({ sessions: { ...sessions, [event.id]: next } });
      return;
    }
    if (event.kind === "log") {
      const existing = sessions[event.id];
      if (!existing) return;
      const logs = existing.logs.slice();
      logs.push(event.line);
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      set({ sessions: { ...sessions, [event.id]: { ...existing, logs } } });
    }
  },
}));

const PROVIDER_KEY = "cockpit.provider";

function loadProvider(): ProviderId {
  if (typeof window === "undefined") return DEFAULT_PROVIDER;
  try { return coerceProviderId(window.localStorage.getItem(PROVIDER_KEY)); }
  catch { return DEFAULT_PROVIDER; }
}

function persistProvider(p: ProviderId): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PROVIDER_KEY, p); } catch { /* ignore */ }
}

const VISIBLE_KEY = "cockpit.visibleProviders";

function loadVisibleProviders(): ProviderId[] {
  if (typeof window === "undefined") return [...PROVIDER_IDS];
  try {
    const raw = window.localStorage.getItem(VISIBLE_KEY);
    if (!raw) return [...PROVIDER_IDS];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [...PROVIDER_IDS];
    // Keep canonical order + drop anything unknown; never return empty.
    const valid = PROVIDER_IDS.filter((id) => arr.includes(id));
    return valid.length > 0 ? valid : [...PROVIDER_IDS];
  } catch { return [...PROVIDER_IDS]; }
}

function persistVisibleProviders(v: readonly ProviderId[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(VISIBLE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

// Listens for OS color-scheme changes so a "system" preference follows the OS
// live. Bound once at module scope; events are ignored while the preference is
// an explicit "dark"/"light".
let systemThemeListenerBound = false;

function ensureSystemThemeListener(): void {
  if (systemThemeListenerBound) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  systemThemeListenerBound = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { tweaks } = useCockpit.getState();
    if (tweaks.theme === "system") applyTweaks(tweaks);
  });
}

// Single writer of <html data-theme> after boot (the inline script in
// layout.tsx writes it once before hydration). The attribute always carries
// the RESOLVED "dark" | "light" — never "system".
export function applyTweaks(t: Tweaks): void {
  if (typeof document === "undefined") return;
  const resolved = resolveThemePreference(t.theme);
  if (t.theme === "system") ensureSystemThemeListener();
  const root = document.documentElement;
  const accent = buildAccentTokens(t.accent, resolved);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-density", t.density);
  root.setAttribute("data-ui-font", t.uiFont);
  root.setAttribute("data-mono-font", t.monoFont);
  root.style.setProperty("--font-sans", getUiFontOption(t.uiFont).stack);
  root.style.setProperty("--font-mono", getMonoFontOption(t.monoFont).stack);
  root.style.setProperty("--accent-source", accent.source);
  root.style.setProperty("--accent", accent.accent);
  root.style.setProperty("--accent-hover", accent.accentHover);
  root.style.setProperty("--accent-foreground", accent.accentForeground);
  root.style.setProperty("--accent-soft", accent.accentSoft);
  root.style.setProperty("--accent-muted", accent.accentMuted);
  root.style.setProperty("--accent-border", accent.accentBorder);
  root.style.setProperty("--accent-ring", accent.accentRing);
  root.style.setProperty("--accent-glow", accent.accentGlow);
  root.style.setProperty("--brand", accent.accent);
  root.style.setProperty("--brand-hover", accent.accentHover);
  if (useCockpit.getState().resolvedTheme !== resolved) {
    useCockpit.setState({ resolvedTheme: resolved });
  }
}
