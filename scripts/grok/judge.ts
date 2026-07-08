import { z } from "zod";
import { GrokClient, resolveTextModel } from "./client.ts";
import { fileLabel, listImages, readImageAsDataUrl, variantLabel, writeJson } from "./io.ts";
import { join } from "node:path";

export const VerdictSchema = z.object({
  ranking: z
    .array(
      z.object({
        variant: z.string(),
        score: z.number(),
        reasons: z.string(),
      }),
    )
    .min(1),
  winner: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

const ChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

// Models sometimes wrap JSON in prose or ``` fences despite json_object mode.
// Be tolerant: try a direct parse, then fall back to the outermost braces.
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("No JSON object found in judge response");
  }
}

export function parseVerdict(raw: string): Verdict {
  return VerdictSchema.parse(extractJson(raw));
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function rubric(criteria: string, labels: string[]): string {
  return [
    "You are an art director scoring game-art variants for an A/B test.",
    `There are ${labels.length} variants, labelled: ${labels.join(", ")}.`,
    "Score each variant 0-10 against these criteria:",
    criteria,
    "",
    "Return ONLY a JSON object, no prose, of the exact shape:",
    '{"ranking":[{"variant":"a","score":8.5,"reasons":"..."}],"winner":"a"}',
    "Order `ranking` best-first. `winner` must be the top variant\'s label.",
  ].join("\n");
}

export interface JudgeArgs {
  dir: string;
  criteria: string;
  model?: string;
  dryRun: boolean;
  json: boolean;
}

export interface JudgeResult {
  dir: string;
  images: { label: string; path: string }[];
  verdict: Verdict | null;
}

export async function runJudge(args: JudgeArgs): Promise<JudgeResult> {
  const paths = await listImages(args.dir);
  if (paths.length === 0) throw new Error(`No images found in ${args.dir}`);

  const images = paths.map((p, i) => ({ label: variantLabel(i), path: p }));
  const labels = images.map((i) => i.label);

  if (args.dryRun) {
    return { dir: args.dir, images, verdict: null };
  }

  const content: ContentPart[] = [{ type: "text", text: rubric(args.criteria, labels) }];
  for (const img of images) {
    content.push({ type: "text", text: `Variant ${img.label} (${fileLabel(img.path)}):` });
    content.push({ type: "image_url", image_url: { url: await readImageAsDataUrl(img.path) } });
  }

  const client = new GrokClient();
  const raw = await client.postJson<unknown>("/chat/completions", {
    model: resolveTextModel(args.model),
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
  });
  const chat = ChatResponseSchema.parse(raw);
  const verdict = parseVerdict(chat.choices[0]!.message.content);

  await writeJson(join(args.dir, "ranking.json"), { images, verdict });
  return { dir: args.dir, images, verdict };
}

export function printJudgeResult(result: JudgeResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result.verdict) {
    process.stdout.write(`Would judge ${result.images.length} image(s) in ${result.dir}\n`);
    return;
  }
  process.stdout.write(`Ranking (winner: ${result.verdict.winner}):\n`);
  for (const r of result.verdict.ranking) {
    process.stdout.write(`  ${r.variant}: ${r.score}/10 — ${r.reasons}\n`);
  }
}
