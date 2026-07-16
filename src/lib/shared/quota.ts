// Shared quota types. Imported by the /api/quotas route (server) and the
// quota-meters sidebar island (client), so the WS-style contract is checked at
// both ends. No runtime imports here: types only.

export type QuotaProvider = "claude" | "codex" | "grok";

// ok        : live usage measured, gauge is meaningful
// unconfigured: provider not installed / no local data source
// unknown   : source present but no usable usage reading yet
// error     : reading the source threw
export type QuotaState = "ok" | "unconfigured" | "unknown" | "error";

export interface QuotaWindow {
  // Short human label for the window, e.g. "5h", "Weekly", "Day".
  readonly label: string;
  // 0-100, clamped.
  readonly usedPercent: number;
  readonly windowMinutes: number;
  // Epoch ms when this window rolls over, or null when not derivable.
  readonly resetsAt: number | null;
}

export interface ProviderQuota {
  readonly provider: QuotaProvider;
  readonly label: string;
  readonly state: QuotaState;
  // Plan/tier label when known, e.g. "Max 20x", "Plus".
  readonly plan: string | null;
  // Headline gauge value (the binding window). null when not measurable.
  readonly usedPercent: number | null;
  // Per-window breakdown for richer rendering.
  readonly windows: readonly QuotaWindow[];
  // One-line caption shown under the bar (figures or a hint).
  readonly detail: string | null;
  // Where the reading came from, for debugging/tooltips.
  readonly source: string;
  // Epoch ms of the underlying measurement, or null.
  readonly asOf: number | null;
}

export interface QuotasResponse {
  readonly generatedAt: number;
  readonly providers: readonly ProviderQuota[];
}
