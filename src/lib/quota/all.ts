import { getClaudeQuota } from "./claude.ts";
import { getCodexQuota } from "./codex.ts";
import { getGrokQuota } from "./grok.ts";
import type { ProviderQuota, QuotasResponse } from "../shared/quota.ts";

// One snapshot of every provider's usage windows. Shared by the /api/quotas
// route and the ws-server's periodic push. Each reader degrades to a stub on
// its own (and getClaudeQuota has its own freshness cache + backoff), so this
// is cheap to call and never throws as a whole.
export async function buildQuotas(): Promise<QuotasResponse> {
  const [claude, codex, grok] = await Promise.all([
    getClaudeQuota(),
    Promise.resolve().then(getCodexQuota),
    Promise.resolve().then(getGrokQuota),
  ]);
  // grok is null when it has no signal to show (no sessions / no tool calls), so
  // its row is omitted entirely rather than rendered empty.
  const providers = [claude, codex, grok].filter(
    (q): q is ProviderQuota => q !== null,
  );
  return { generatedAt: Date.now(), providers };
}
