"use client";

export type ThemeMode = "dark" | "light";
// User-facing preference: "system" follows the OS via prefers-color-scheme.
// The <html data-theme> attribute always carries the RESOLVED ThemeMode.
export type ThemePreference = ThemeMode | "system";
export type UiFontKey = "inter" | "geist" | "ibm-plex-sans" | "system";
export type MonoFontKey = "jetbrains" | "geist-mono" | "ibm-plex-mono" | "system-mono";

export interface FontOption<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly sample: string;
  readonly stack: string;
}

export const UI_FONT_OPTIONS: readonly FontOption<UiFontKey>[] = [
  {
    key: "inter",
    label: "Inter",
    sample: "Control surface",
    stack: "var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
  {
    key: "geist",
    label: "Geist",
    sample: "Session cockpit",
    stack: "var(--font-geist), var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
  {
    key: "ibm-plex-sans",
    label: "IBM Plex Sans",
    sample: "Dense operator UI",
    stack: "var(--font-ibm-plex-sans), var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
  {
    key: "system",
    label: "System",
    sample: "Native desktop",
    stack: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
];

export const MONO_FONT_OPTIONS: readonly FontOption<MonoFontKey>[] = [
  {
    key: "jetbrains",
    label: "JetBrains Mono",
    sample: "fn run --watch",
    stack: "var(--font-jetbrains-mono), ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, monospace",
  },
  {
    key: "geist-mono",
    label: "Geist Mono",
    sample: "$ pnpm dev",
    stack: "var(--font-geist-mono), var(--font-jetbrains-mono), ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, monospace",
  },
  {
    key: "ibm-plex-mono",
    label: "IBM Plex Mono",
    sample: "status: open",
    stack: "var(--font-ibm-plex-mono), var(--font-jetbrains-mono), ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, monospace",
  },
  {
    key: "system-mono",
    label: "System Mono",
    sample: "tail -f log",
    stack: "ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, monospace",
  },
];

export const ACCENT_PRESETS = [
  { key: "#d97757", label: "Clay" },
  { key: "#4a9eff", label: "Signal" },
  { key: "#14b8a6", label: "Teal" },
  { key: "#a78bfa", label: "Violet" },
  { key: "#f59e0b", label: "Amber" },
  { key: "#e5e5e5", label: "Mono" },
] as const;

const DEFAULT_ACCENT = "#d97757";
const DARK_TEXT = "#0a0a0a";
const LIGHT_TEXT = "#ffffff";
const DARK_SURFACE = "#141414";
const LIGHT_SURFACE = "#ffffff";
const MIN_ACCENT_CONTRAST = 3;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface AccentTokens {
  readonly source: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentForeground: string;
  readonly accentSoft: string;
  readonly accentMuted: string;
  readonly accentBorder: string;
  readonly accentRing: string;
  readonly accentGlow: string;
}

export interface TerminalTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

export function resolveThemePreference(pref: ThemePreference): ThemeMode {
  if (pref !== "system") return pref;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function coerceUiFontKey(value: unknown): UiFontKey {
  return UI_FONT_OPTIONS.some((option) => option.key === value) ? value as UiFontKey : "inter";
}

export function coerceMonoFontKey(value: unknown): MonoFontKey {
  return MONO_FONT_OPTIONS.some((option) => option.key === value) ? value as MonoFontKey : "jetbrains";
}

export function getUiFontOption(key: UiFontKey): FontOption<UiFontKey> {
  return UI_FONT_OPTIONS.find((option) => option.key === key) ?? UI_FONT_OPTIONS[0]!;
}

export function getMonoFontOption(key: MonoFontKey): FontOption<MonoFontKey> {
  return MONO_FONT_OPTIONS.find((option) => option.key === key) ?? MONO_FONT_OPTIONS[0]!;
}

export function normalizeHexColor(value: string): string | null {
  const parsed = parseHexColor(value);
  return parsed ? rgbToHex(parsed) : null;
}

export function buildAccentTokens(value: string, theme: ThemeMode): AccentTokens {
  const source = normalizeHexColor(value) ?? DEFAULT_ACCENT;
  const accent = ensureThemeContrast(source, theme);
  const rgb = parseHexColor(accent) ?? parseHexColor(DEFAULT_ACCENT)!;
  const black = parseHexColor("#000000")!;
  const hover = rgbToHex(mixRgb(rgb, black, theme === "light" ? 0.12 : 0.1));
  const darkContrast = contrastRatio(rgb, parseHexColor(DARK_TEXT)!);
  const lightContrast = contrastRatio(rgb, parseHexColor(LIGHT_TEXT)!);
  const alpha = theme === "light"
    ? { soft: 0.09, muted: 0.13, border: 0.34, ring: 0.18, glow: 0.26 }
    : { soft: 0.12, muted: 0.18, border: 0.38, ring: 0.24, glow: 0.42 };

  return {
    source,
    accent,
    accentHover: hover,
    accentForeground: darkContrast >= lightContrast ? DARK_TEXT : LIGHT_TEXT,
    accentSoft: rgba(rgb, alpha.soft),
    accentMuted: rgba(rgb, alpha.muted),
    accentBorder: rgba(rgb, alpha.border),
    accentRing: rgba(rgb, alpha.ring),
    accentGlow: rgba(rgb, alpha.glow),
  };
}

export function getTerminalTheme(theme: ThemeMode, accent: string): TerminalTheme {
  const tokens = buildAccentTokens(accent, theme);
  if (theme === "dark") {
    return {
      background: "#0a0a0a",
      foreground: "#ededed",
      cursor: tokens.accent,
      cursorAccent: "#0a0a0a",
      selectionBackground: "#3b3b3b",
      black: "#1a1a1a",
      red: "#ef4444",
      green: "#22c55e",
      yellow: "#f5a524",
      blue: "#4a9eff",
      magenta: "#a78bfa",
      cyan: "#22d3ee",
      white: "#ededed",
      brightBlack: "#4b4b4b",
      brightRed: "#f87171",
      brightGreen: "#4ade80",
      brightYellow: "#fbbf24",
      brightBlue: "#60a5fa",
      brightMagenta: "#c4b5fd",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    };
  }

  return {
    background: "#fbfaf6",
    foreground: "#282620",
    cursor: tokens.accent,
    cursorAccent: "#fbfaf6",
    selectionBackground: "#d9d4c7",
    black: "#2a2823",
    red: "#b4232f",
    green: "#19733f",
    yellow: "#946200",
    blue: "#245fa8",
    magenta: "#7048a8",
    cyan: "#0f6b78",
    white: "#efede5",
    brightBlack: "#7d786d",
    brightRed: "#d73545",
    brightGreen: "#21884d",
    brightYellow: "#ad7607",
    brightBlue: "#2d72c7",
    brightMagenta: "#8658c7",
    brightCyan: "#168293",
    brightWhite: "#ffffff",
  };
}

function parseHexColor(value: string): Rgb | null {
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return {
      r: parseInt(`${hex.charAt(0)}${hex.charAt(0)}`, 16),
      g: parseInt(`${hex.charAt(1)}${hex.charAt(1)}`, 16),
      b: parseInt(`${hex.charAt(2)}${hex.charAt(2)}`, 16),
    };
  }
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function ensureThemeContrast(value: string, theme: ThemeMode): string {
  const accent = parseHexColor(value) ?? parseHexColor(DEFAULT_ACCENT)!;
  const surface = parseHexColor(theme === "light" ? LIGHT_SURFACE : DARK_SURFACE)!;
  const target = parseHexColor(theme === "light" ? "#000000" : "#ffffff")!;
  if (contrastRatio(accent, surface) >= MIN_ACCENT_CONTRAST) return rgbToHex(accent);

  for (let step = 1; step <= 18; step += 1) {
    const mixed = mixRgb(accent, target, step * 0.045);
    if (contrastRatio(mixed, surface) >= MIN_ACCENT_CONTRAST) return rgbToHex(mixed);
  }
  return rgbToHex(mixRgb(accent, target, 0.84));
}

function mixRgb(a: Rgb, b: Rgb, amountOfB: number): Rgb {
  const t = clamp(amountOfB, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function rgbToHex(rgb: Rgb): string {
  return `#${toHexChannel(rgb.r)}${toHexChannel(rgb.g)}${toHexChannel(rgb.b)}`;
}

function toHexChannel(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(rgb: Rgb): number {
  const r = linearChannel(rgb.r / 255);
  const g = linearChannel(rgb.g / 255);
  const b = linearChannel(rgb.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linearChannel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
