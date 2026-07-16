import { DEFAULT_PROVIDER, type ProviderId } from "./providers.ts";

export const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;
export type Effort = typeof ALL_EFFORTS[number];

export interface ModelSpec {
  readonly id: string;
  readonly provider: ProviderId;
  readonly apiId: string;
  readonly label: string;
  readonly tagline: string;
  readonly aliasFrom: readonly string[];
  readonly effortLevels: readonly Effort[];
  readonly defaultEffort: Effort | null;
}

// Model ids stay globally unique across providers so a single ModelId string is
// enough to recover its provider. effortLevels capture what each vendor's CLI
// actually exposes: Claude has a six-step ladder, Codex a reasoning-effort
// triple.
export const MODELS: readonly ModelSpec[] = [
  // ---- Anthropic / Claude -------------------------------------------------
  {
    id: "mythos",
    provider: "claude",
    // UI label is "Mythos" (vanity); the real API model stays claude-fable-5.
    apiId: "claude-fable-5",
    label: "Mythos",
    tagline: "most capable, newest",
    aliasFrom: ["claude-fable-5"],
    // Same reasoning-effort ladder as Opus (incl. cockpit's runtime ultracode).
    effortLevels: ["low", "medium", "high", "xhigh", "max", "ultracode"],
    defaultEffort: "xhigh",
  },
  {
    id: "opus-4.8",
    provider: "claude",
    apiId: "claude-opus-4-8",
    label: "Opus 4.8",
    tagline: "newest, deepest reasoning",
    aliasFrom: [
      "claude-opus-4-8",
      // Folded in from the retired Opus 4.7 entry so older sessions and history
      // that reference these api ids still resolve to the current Opus.
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
    ],
    effortLevels: ["low", "medium", "high", "xhigh", "max", "ultracode"],
    defaultEffort: "xhigh",
  },
  {
    id: "sonnet-4.6",
    provider: "claude",
    apiId: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    tagline: "balanced",
    aliasFrom: [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4",
    ],
    effortLevels: ["low", "medium", "high", "max"],
    defaultEffort: "high",
  },
  {
    id: "haiku-4.5",
    provider: "claude",
    apiId: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    tagline: "fastest",
    aliasFrom: [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
    ],
    effortLevels: [],
    defaultEffort: null,
  },

  // ---- OpenAI / Codex -----------------------------------------------------
  // Codex exposes reasoning effort via `-c model_reasoning_effort=<level>`. The
  // selectable models + their effort ladder are taken verbatim from
  // `codex debug models` (visibility:list) on codex-cli v0.135.
  {
    id: "gpt-5.5",
    provider: "codex",
    apiId: "gpt-5.5",
    label: "GPT-5.5",
    tagline: "newest, strongest agentic coding",
    aliasFrom: ["gpt-5.5", "gpt-5-codex"],
    effortLevels: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.4",
    provider: "codex",
    apiId: "gpt-5.4",
    label: "GPT-5.4",
    tagline: "strong reasoning + agentic",
    aliasFrom: ["gpt-5.4", "gpt-5"],
    effortLevels: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.4-mini",
    provider: "codex",
    apiId: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    tagline: "fast, efficient",
    aliasFrom: ["gpt-5.4-mini", "o4-mini"],
    effortLevels: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.3-codex",
    provider: "codex",
    apiId: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    tagline: "coding-tuned",
    aliasFrom: ["gpt-5.3-codex"],
    effortLevels: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.2",
    provider: "codex",
    apiId: "gpt-5.2",
    label: "GPT-5.2",
    tagline: "prior generation",
    aliasFrom: ["gpt-5.2"],
    effortLevels: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },

  // ---- xAI / Grok ---------------------------------------------------------
  // The Grok CLI (`grok`) pilots xAI coding models through
  // cli-chat-proxy.grok.com. On grok-cli v0.2.101 the catalog
  // (models_cache.json) exposes a single model, grok-4.5, which reports
  // supports_reasoning_effort=true, driven via the CLI's --effort flag.
  // Retired ids (grok-build, grok-composer-*) alias here so existing history
  // keeps resolving.
  {
    id: "grok-4.5",
    provider: "grok",
    apiId: "grok-4.5",
    label: "Grok 4.5",
    tagline: "xAI's latest coding model",
    aliasFrom: ["grok-4.5", "grok-build", "grok-composer-2.5-fast", "grok-composer"],
    effortLevels: ["low", "medium", "high"],
    defaultEffort: "high",
  },

  // ---- SST / opencode -----------------------------------------------------
  // opencode is model-agnostic: `-m provider/model` routes to whatever the user
  // has authed plus opencode's own free "zen" tier. The model id IS the `-m`
  // arg (id === apiId === "provider/model"), so dynamically discovered models
  // (see opencode/models.ts + modelBelongsToProvider) spawn without a catalog
  // entry. The stable zen models below give a valid default + history aliasing
  // before discovery runs. No reasoning-effort flag we drive (opencode exposes
  // --variant; left as future work), so effortLevels stays empty.
  {
    id: "opencode/north-mini-code-free",
    provider: "opencode",
    apiId: "opencode/north-mini-code-free",
    label: "North Mini Code (free)",
    tagline: "opencode zen, coding-tuned, no auth",
    aliasFrom: ["opencode/north-mini-code-free"],
    effortLevels: [],
    defaultEffort: null,
  },
  {
    id: "opencode/deepseek-v4-flash-free",
    provider: "opencode",
    apiId: "opencode/deepseek-v4-flash-free",
    label: "DeepSeek V4 Flash (free)",
    tagline: "opencode zen, fast, no auth",
    aliasFrom: ["opencode/deepseek-v4-flash-free"],
    effortLevels: [],
    defaultEffort: null,
  },
  {
    id: "opencode/mimo-v2.5-free",
    provider: "opencode",
    apiId: "opencode/mimo-v2.5-free",
    label: "MiMo v2.5 (free)",
    tagline: "opencode zen, no auth",
    aliasFrom: ["opencode/mimo-v2.5-free"],
    effortLevels: [],
    defaultEffort: null,
  },
  {
    id: "opencode/nemotron-3-ultra-free",
    provider: "opencode",
    apiId: "opencode/nemotron-3-ultra-free",
    label: "Nemotron 3 Ultra (free)",
    tagline: "opencode zen, no auth",
    aliasFrom: ["opencode/nemotron-3-ultra-free"],
    effortLevels: [],
    defaultEffort: null,
  },
  {
    id: "opencode/big-pickle",
    provider: "opencode",
    apiId: "opencode/big-pickle",
    label: "Big Pickle",
    tagline: "opencode zen flagship",
    aliasFrom: ["opencode/big-pickle"],
    effortLevels: [],
    defaultEffort: null,
  },
];

export type ModelId = string;

export const MODEL_IDS: readonly string[] = MODELS.map((m) => m.id);

const BY_ID = new Map<string, ModelSpec>(MODELS.map((m) => [m.id, m]));
const BY_API_ID = new Map<string, ModelSpec>();
for (const m of MODELS) {
  BY_API_ID.set(m.apiId, m);
  for (const a of m.aliasFrom) BY_API_ID.set(a, m);
}

const BY_PROVIDER = new Map<ProviderId, ModelSpec[]>();
for (const m of MODELS) {
  const list = BY_PROVIDER.get(m.provider) ?? [];
  list.push(m);
  BY_PROVIDER.set(m.provider, list);
}

export function modelsForProvider(provider: ProviderId): readonly ModelSpec[] {
  return BY_PROVIDER.get(provider) ?? [];
}

export function modelIdsForProvider(provider: ProviderId): readonly string[] {
  return modelsForProvider(provider).map((m) => m.id);
}

export function defaultModelFor(provider: ProviderId): string {
  return modelsForProvider(provider)[0]?.id ?? MODELS[0]!.id;
}

export function providerOfModel(id: string | null | undefined): ProviderId | null {
  if (!id) return null;
  return BY_ID.get(id)?.provider ?? null;
}

// opencode model ids are "provider/model" strings routed by the opencode CLI,
// most of which are discovered at runtime (see opencode/models.ts) and never
// land in the static catalog. Accept any single-slash "a/b" id for opencode.
const OPENCODE_MODEL_RE = /^[^/\s]+\/[^/\s]+$/;

export function isOpenCodeModelId(id: string | null | undefined): boolean {
  return typeof id === "string" && OPENCODE_MODEL_RE.test(id);
}

// True when `modelId` is a legal choice for `provider`: either a static catalog
// model whose provider matches, or (for opencode) any "provider/model" id, since
// opencode's selectable models are dynamic and not all catalogued.
export function modelBelongsToProvider(provider: ProviderId, modelId: string): boolean {
  const known = providerOfModel(modelId);
  if (known) return known === provider;
  return provider === "opencode" && isOpenCodeModelId(modelId);
}

export const DEFAULT_MODEL_ID: string = defaultModelFor(DEFAULT_PROVIDER);

export function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && BY_ID.has(v);
}

export function modelMeta(id: string | null | undefined): ModelSpec | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function modelFromApiId(apiId: string | null | undefined): ModelId | null {
  if (!apiId) return null;
  const direct = BY_API_ID.get(apiId);
  if (direct) return direct.id;
  const lower = apiId.toLowerCase();
  for (const m of MODELS) {
    if (lower.includes(m.apiId)) return m.id;
    for (const a of m.aliasFrom) if (lower.includes(a)) return m.id;
  }
  return null;
}

export function apiIdFor(id: string): string | null {
  return BY_ID.get(id)?.apiId ?? null;
}

export function effortLevelsFor(id: string): readonly Effort[] {
  return BY_ID.get(id)?.effortLevels ?? [];
}

export function defaultEffortFor(id: string): Effort | null {
  return BY_ID.get(id)?.defaultEffort ?? null;
}

export function coerceEffortFor(id: string, wanted: Effort | null | undefined): Effort | null {
  const levels = effortLevelsFor(id);
  if (levels.length === 0) return null;
  if (wanted && levels.includes(wanted)) return wanted;
  return defaultEffortFor(id);
}

export function modelSupportsEffortFor(id: string): boolean {
  return effortLevelsFor(id).length > 0;
}

// Max context window per model, for the live context meter (denominator). Codex
// reports its own `model_context_window` in token_count events, so its entries
// are only a fallback before that arrives; Claude has no live window signal,
// so the registry value is authoritative. 0 / absent = unknown (the UI hides
// the meter).
const CONTEXT_WINDOWS: Record<string, number> = {
  "mythos": 1_000_000,
  "opus-4.8": 1_000_000,
  "sonnet-4.6": 1_000_000,
  "haiku-4.5": 200_000,
  "grok-4.5": 500_000,
};

export function contextWindowFor(id: string): number {
  return CONTEXT_WINDOWS[id] ?? 0;
}
