import { describe, it, expect, vi, afterEach } from "vitest";
import { GrokApiError, GrokClient, resolveApiKey } from "../../scripts/grok/client.ts";

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

afterEach(() => vi.unstubAllEnvs());

describe("resolveApiKey", () => {
  it("returns an explicit key", () => {
    expect(resolveApiKey("xai-123")).toBe("xai-123");
  });

  it("throws when no key is available", () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("GROK_API_KEY", "");
    expect(() => resolveApiKey()).toThrowError(GrokApiError);
  });
});

describe("GrokClient.postJson", () => {
  it("sends auth + parses the JSON body on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { ok: true }));
    const client = new GrokClient({ apiKey: "xai-123", baseUrl: "https://x/v1", fetchImpl });

    const out = await client.postJson<{ ok: boolean }>("/chat/completions", { a: 1 });

    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://x/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer xai-123",
      "content-type": "application/json",
    });
  });

  it("retries on 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(429, "slow down"))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const client = new GrokClient({ apiKey: "k", fetchImpl, retryBaseMs: 0 });

    const out = await client.postJson<{ ok: boolean }>("/images/generations", {});

    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401 and surfaces the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(401, "bad key"));
    const client = new GrokClient({ apiKey: "k", fetchImpl, retryBaseMs: 0 });

    await expect(client.postJson("/chat/completions", {})).rejects.toMatchObject({
      name: "GrokApiError",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(500, "boom"));
    const client = new GrokClient({ apiKey: "k", fetchImpl, maxRetries: 2, retryBaseMs: 0 });

    await expect(client.postJson("/chat/completions", {})).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
