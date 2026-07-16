import { createLogger } from "../util/logger.ts";

const log = createLogger("cc-pricing");

export interface Pricing {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreate5m: number;
  readonly cacheCreate1h: number;
}

export interface Usage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheCreate5m?: number;
  readonly cacheCreate1h?: number;
}

const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const TTL_MS = 60 * 60 * 1000;

const FALLBACK_PER_TOKEN: Record<string, Pricing> = {
  "claude-fable-5":             { input: 10e-6,   output: 50e-6,   cacheRead: 1e-6,    cacheCreate5m: 12.5e-6,  cacheCreate1h: 20e-6 },
  "claude-opus-4-8":            { input: 5e-6,    output: 25e-6,   cacheRead: 5e-7,    cacheCreate5m: 6.25e-6,  cacheCreate1h: 10e-6 },
  "claude-opus-4-7":            { input: 5e-6,    output: 25e-6,   cacheRead: 5e-7,    cacheCreate5m: 6.25e-6,  cacheCreate1h: 10e-6 },
  "claude-opus-4-6":            { input: 5e-6,    output: 25e-6,   cacheRead: 5e-7,    cacheCreate5m: 6.25e-6,  cacheCreate1h: 10e-6 },
  "claude-opus-4-5":            { input: 5e-6,    output: 25e-6,   cacheRead: 5e-7,    cacheCreate5m: 6.25e-6,  cacheCreate1h: 10e-6 },
  "claude-opus-4-5-20251101":   { input: 5e-6,    output: 25e-6,   cacheRead: 5e-7,    cacheCreate5m: 6.25e-6,  cacheCreate1h: 10e-6 },
  "claude-opus-4-1":            { input: 15e-6,   output: 75e-6,   cacheRead: 1.5e-6,  cacheCreate5m: 18.75e-6, cacheCreate1h: 30e-6 },
  "claude-opus-4":              { input: 15e-6,   output: 75e-6,   cacheRead: 1.5e-6,  cacheCreate5m: 18.75e-6, cacheCreate1h: 30e-6 },
  "claude-sonnet-4-6":          { input: 3e-6,    output: 15e-6,   cacheRead: 3e-7,    cacheCreate5m: 3.75e-6,  cacheCreate1h: 6e-6  },
  "claude-sonnet-4-5":          { input: 3e-6,    output: 15e-6,   cacheRead: 3e-7,    cacheCreate5m: 3.75e-6,  cacheCreate1h: 6e-6  },
  "claude-sonnet-4-5-20250929": { input: 3e-6,    output: 15e-6,   cacheRead: 3e-7,    cacheCreate5m: 3.75e-6,  cacheCreate1h: 6e-6  },
  "claude-sonnet-4":            { input: 3e-6,    output: 15e-6,   cacheRead: 3e-7,    cacheCreate5m: 3.75e-6,  cacheCreate1h: 6e-6  },
  "claude-haiku-4-5":           { input: 1e-6,    output: 5e-6,    cacheRead: 1e-7,    cacheCreate5m: 1.25e-6,  cacheCreate1h: 2e-6  },
  "claude-haiku-4-5-20251001":  { input: 1e-6,    output: 5e-6,    cacheRead: 1e-7,    cacheCreate5m: 1.25e-6,  cacheCreate1h: 2e-6  },
  "claude-3-5-haiku":           { input: 0.8e-6,  output: 4e-6,    cacheRead: 8e-8,    cacheCreate5m: 1e-6,     cacheCreate1h: 1.6e-6 },
  // OpenAI Codex models (public list prices; cached input billed at cacheRead).
  "gpt-5-codex":                { input: 1.25e-6, output: 10e-6,   cacheRead: 1.25e-7,  cacheCreate5m: 1.25e-6,  cacheCreate1h: 1.25e-6 },
  "gpt-5":                      { input: 1.25e-6, output: 10e-6,   cacheRead: 1.25e-7,  cacheCreate5m: 1.25e-6,  cacheCreate1h: 1.25e-6 },
  "o4-mini":                    { input: 1.1e-6,  output: 4.4e-6,  cacheRead: 2.75e-7,  cacheCreate5m: 1.1e-6,   cacheCreate1h: 1.1e-6  },
  // xAI Grok. The CLI's models run through a subscription proxy with no
  // published per-token price, so these are best-effort list rates from xAI's
  // grok-4 API tier (input/output, cached input at ~1/4). grok-build and
  // grok-composer-2.5-fast are retired ids kept for historical sessions.
  // Usage is reconstructed (see providers/grok), not billed, so cost is an estimate.
  "grok-4.5":                   { input: 3e-6,    output: 15e-6,   cacheRead: 7.5e-7,   cacheCreate5m: 3e-6,     cacheCreate1h: 3e-6    },
  "grok-build":                 { input: 3e-6,    output: 15e-6,   cacheRead: 7.5e-7,   cacheCreate5m: 3e-6,     cacheCreate1h: 3e-6    },
  "grok-composer-2.5-fast":     { input: 1e-6,    output: 5e-6,    cacheRead: 2.5e-7,   cacheCreate5m: 1e-6,     cacheCreate1h: 1e-6    },
  // z.ai GLM, reached through opencode's zai-coding-plan. That plan is a flat
  // subscription and reports $0 per call on disk, so cost is estimated from
  // user-supplied list rates: a flagship tier and a ~1/3-cheaper air/turbo tier.
  "zai-glm":                    { input: 1.4e-6,  output: 4.4e-6,  cacheRead: 2.6e-7,   cacheCreate5m: 1.4e-6,   cacheCreate1h: 1.4e-6  },
  "zai-glm-air":                { input: 0.93e-6, output: 2.93e-6, cacheRead: 1.73e-7,  cacheCreate5m: 0.93e-6,  cacheCreate1h: 0.93e-6 },
};

const UNKNOWN: Pricing = { input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 };

let cachedPricing: Record<string, Pricing> | null = null;
let cacheAt = 0;
let inflight: Promise<Record<string, Pricing>> | null = null;

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
}

async function fetchLiteLLM(): Promise<Record<string, Pricing>> {
  const res = await fetch(LITELLM_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`litellm ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  const out: Record<string, Pricing> = {};
  for (const [name, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const e = v as LiteLLMEntry;
    if (typeof e.input_cost_per_token !== "number" || typeof e.output_cost_per_token !== "number") continue;
    const cache5m = typeof e.cache_creation_input_token_cost === "number" ? e.cache_creation_input_token_cost : 0;
    out[name] = {
      input: e.input_cost_per_token,
      output: e.output_cost_per_token,
      cacheRead: typeof e.cache_read_input_token_cost === "number" ? e.cache_read_input_token_cost : 0,
      cacheCreate5m: cache5m,
      cacheCreate1h: typeof e.cache_creation_input_token_cost_above_1hr === "number" ? e.cache_creation_input_token_cost_above_1hr : cache5m,
    };
  }
  return out;
}

export async function refreshPricing(force = false): Promise<Record<string, Pricing>> {
  if (!force && cachedPricing && Date.now() - cacheAt < TTL_MS) return cachedPricing;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fresh = await fetchLiteLLM();
      cachedPricing = { ...FALLBACK_PER_TOKEN, ...fresh };
      cacheAt = Date.now();
      log.info("pricing refreshed", { models: Object.keys(cachedPricing).length });
      return cachedPricing;
    } catch (err) {
      log.warn("pricing fetch failed; using fallback", { err: String(err) });
      cachedPricing = { ...FALLBACK_PER_TOKEN };
      cacheAt = Date.now();
      return cachedPricing;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function pricingSync(model: string | undefined | null): Pricing {
  const table = cachedPricing ?? FALLBACK_PER_TOKEN;
  if (!model) return UNKNOWN;
  if (table[model]) return table[model];
  const lower = model.toLowerCase();
  const match = Object.keys(table).find((k) => lower.includes(k) || k.includes(lower));
  if (match) return table[match]!;
  if (lower.includes("fable")) return table["claude-fable-5"] ?? UNKNOWN;
  if (lower.includes("opus-4-8")) return table["claude-opus-4-8"] ?? UNKNOWN;
  if (lower.includes("opus-4-7") || lower.includes("opus-4-6")) return table["claude-opus-4-7"] ?? UNKNOWN;
  if (lower.includes("opus")) return table["claude-opus-4-1"] ?? UNKNOWN;
  if (lower.includes("sonnet")) return table["claude-sonnet-4-6"] ?? UNKNOWN;
  if (lower.includes("haiku")) return table["claude-haiku-4-5"] ?? UNKNOWN;
  if (lower.includes("codex")) return table["gpt-5-codex"] ?? UNKNOWN;
  if (lower.includes("o4-mini")) return table["o4-mini"] ?? UNKNOWN;
  if (lower.includes("gpt-5") || lower.startsWith("gpt")) return table["gpt-5"] ?? UNKNOWN;
  if (lower.includes("composer")) return table["grok-composer-2.5-fast"] ?? UNKNOWN;
  if (lower.includes("grok")) return table["grok-build"] ?? UNKNOWN;
  if (lower.includes("glm") || lower.includes("zai")) {
    if (lower.includes("air") || lower.includes("turbo")) return table["zai-glm-air"] ?? UNKNOWN;
    return table["zai-glm"] ?? UNKNOWN;
  }
  return UNKNOWN;
}

export function priceFor(model: string | undefined | null): Pricing {
  return pricingSync(model);
}

export function estimateCost(model: string | undefined | null, u: Usage): number {
  const p = pricingSync(model);
  return (u.input ?? 0) * p.input
    + (u.output ?? 0) * p.output
    + (u.cacheRead ?? 0) * p.cacheRead
    + (u.cacheCreate5m ?? 0) * p.cacheCreate5m
    + (u.cacheCreate1h ?? 0) * p.cacheCreate1h;
}
