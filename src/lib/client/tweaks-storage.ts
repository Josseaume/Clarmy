"use client";

import {
  coerceMonoFontKey,
  coerceUiFontKey,
  normalizeHexColor,
  type MonoFontKey,
  type ThemePreference,
  type UiFontKey,
} from "./theme-settings";

export interface Tweaks {
  theme: ThemePreference;
  density: "compact" | "default" | "cozy";
  cols: 2 | 3 | 4;
  accent: string;
  uiFont: UiFontKey;
  monoFont: MonoFontKey;
  tileVariant: "card" | "strip";
}

export const DEFAULT_TWEAKS: Tweaks = {
  theme: "dark",
  density: "default",
  cols: 3,
  accent: "#d97757",
  uiFont: "inter",
  monoFont: "jetbrains",
  tileVariant: "card",
};

const TWEAKS_KEY = "cockpit.tweaks";

export function loadTweaks(): Tweaks {
  if (typeof window === "undefined") return DEFAULT_TWEAKS;
  try {
    const raw = window.localStorage.getItem(TWEAKS_KEY);
    const tweaks = raw ? normalizeTweaks(JSON.parse(raw) as unknown) : DEFAULT_TWEAKS;
    return migrateLegacyTheme(tweaks);
  } catch { return DEFAULT_TWEAKS; }
}

export function persistTweaks(t: Tweaks): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
}

// The settings page used to persist its own theme under "cockpit:theme". Fold
// that value into tweaks.theme once, then delete the retired key so
// "cockpit.tweaks" stays the single source of truth.
function migrateLegacyTheme(tweaks: Tweaks): Tweaks {
  try {
    const legacy = window.localStorage.getItem("cockpit:theme");
    if (legacy === null) return tweaks;
    window.localStorage.removeItem("cockpit:theme");
    if (legacy !== "dark" && legacy !== "light" && legacy !== "system") return tweaks;
    const next: Tweaks = { ...tweaks, theme: legacy };
    persistTweaks(next);
    return next;
  } catch { return tweaks; }
}

export function normalizeTweaks(value: unknown): Tweaks {
  if (!isRecord(value)) return DEFAULT_TWEAKS;
  const theme =
    value.theme === "light" || value.theme === "dark" || value.theme === "system"
      ? value.theme
      : DEFAULT_TWEAKS.theme;
  const density =
    value.density === "compact" || value.density === "default" || value.density === "cozy"
      ? value.density
      : DEFAULT_TWEAKS.density;
  const cols = value.cols === 2 || value.cols === 3 || value.cols === 4 ? value.cols : DEFAULT_TWEAKS.cols;
  const accent = typeof value.accent === "string" ? normalizeHexColor(value.accent) ?? DEFAULT_TWEAKS.accent : DEFAULT_TWEAKS.accent;
  const tileVariant = value.tileVariant === "strip" || value.tileVariant === "card" ? value.tileVariant : DEFAULT_TWEAKS.tileVariant;

  return {
    theme,
    density,
    cols,
    accent,
    uiFont: coerceUiFontKey(value.uiFont),
    monoFont: coerceMonoFontKey(value.monoFont),
    tileVariant,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
