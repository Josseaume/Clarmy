// The set of CLI agent providers cockpit can pilot. Each is a separate vendor
// binary with its own flags, transcript format and on-disk history layout. The
// metadata here is client-safe (no node imports) so the topbar, store and forms
// can render provider chips; the server-side driver (flags + transcript parser)
// lives in src/lib/providers/<id>.
export const PROVIDER_IDS = ["claude", "codex", "grok", "opencode"] as const;
export type ProviderId = typeof PROVIDER_IDS[number];

export const DEFAULT_PROVIDER: ProviderId = "claude";

export interface ProviderMeta {
  readonly id: ProviderId;
  readonly label: string;
  readonly vendor: string;
  // Default binary name; the server driver resolves the absolute path and
  // honours a <PROVIDER>_CLI_PATH env override.
  readonly binary: string;
  // Home/config dir relative to the user's home directory (no leading slash).
  readonly homeDir: string;
  // Accent hex used for the provider chip + tints. Falls back to the theme
  // accent token when a provider is the active brand.
  readonly accent: string;
  readonly tagline: string;
}

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude",
    vendor: "Anthropic",
    binary: "claude",
    homeDir: ".claude",
    accent: "#d97757",
    tagline: "Anthropic Claude Code",
  },
  {
    id: "codex",
    label: "Codex",
    vendor: "OpenAI",
    binary: "codex",
    homeDir: ".codex",
    accent: "#10a37f",
    tagline: "OpenAI Codex CLI",
  },
  {
    id: "grok",
    label: "Grok",
    vendor: "xAI",
    binary: "grok",
    homeDir: ".grok",
    accent: "#9b7cff",
    tagline: "xAI Grok CLI",
  },
  {
    id: "opencode",
    label: "OpenCode",
    vendor: "SST",
    binary: "opencode",
    homeDir: ".opencode",
    accent: "#e8b339",
    tagline: "SST opencode CLI",
  },
];

const BY_ID = new Map<ProviderId, ProviderMeta>(PROVIDERS.map((p) => [p.id, p]));

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && BY_ID.has(v as ProviderId);
}

export function providerMeta(id: ProviderId): ProviderMeta {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_PROVIDER)!;
}

export function coerceProviderId(v: unknown): ProviderId {
  return isProviderId(v) ? v : DEFAULT_PROVIDER;
}
