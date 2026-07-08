import { createLogger } from "../../src/lib/util/logger.ts";

const log = createLogger("grok");

export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_IMAGE_MODEL_QUALITY = "grok-imagine-image-quality";
export const DEFAULT_IMAGE_MODEL_STANDARD = "grok-imagine-image";
export const DEFAULT_TEXT_MODEL = "grok-4.3";

// Thrown for every failure path so callers can show one friendly message.
// status 0 means "client-side / network", >0 mirrors the HTTP status.
export class GrokApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GrokApiError";
  }
}

export function resolveApiKey(explicit?: string): string {
  // `||` (not `??`) so an empty-string env var counts as missing.
  const key = explicit || process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!key) {
    throw new GrokApiError(
      0,
      "Missing XAI_API_KEY. Export it or add it to .env (see .env.example).",
    );
  }
  return key;
}

export interface GrokClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
}

function truncate(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Low-level xAI client: auth, base URL, JSON POST with backoff retry on
// 429 / 5xx. Higher-level shaping (image/judge/chat) lives in sibling modules.
export class GrokClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: GrokClientOptions = {}) {
    this.apiKey = resolveApiKey(opts.apiKey);
    this.baseUrl = (opts.baseUrl ?? process.env.XAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries) {
          log.warn(`network error on ${path}, retrying`, { attempt });
          await this.backoff(attempt);
          continue;
        }
        throw new GrokApiError(0, `Network error calling ${path}: ${String(err)}`);
      }

      if (res.ok) return (await res.json()) as T;

      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        log.warn(`xAI ${res.status} on ${path}, retrying`, { attempt });
        await this.backoff(attempt, res);
        continue;
      }
      throw new GrokApiError(res.status, `xAI ${res.status} on ${path}: ${truncate(text)}`, text);
    }
    throw new GrokApiError(0, `Exhausted retries on ${path}: ${String(lastErr)}`);
  }

  private async backoff(attempt: number, res?: Response): Promise<void> {
    const retryAfter = res?.headers.get("retry-after");
    const ms = retryAfter && Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000
      : this.retryBaseMs * 2 ** attempt;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}

export function resolveImageModel(flag?: string): string {
  if (flag === "standard") return process.env.GROK_IMAGE_MODEL_STANDARD ?? DEFAULT_IMAGE_MODEL_STANDARD;
  if (flag === "quality") return process.env.GROK_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL_QUALITY;
  if (flag) return flag; // raw model id passthrough
  return process.env.GROK_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL_QUALITY;
}

export function resolveTextModel(flag?: string): string {
  return flag ?? process.env.GROK_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
}
