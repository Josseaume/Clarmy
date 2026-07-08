import { z } from "zod";
import { GrokClient, resolveImageModel } from "./client.ts";
import { ensureDir, saveImageVariant, slugify, variantLabel, writeJson } from "./io.ts";
import { join } from "node:path";

const ImageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().optional(),
        url: z.string().optional(),
        revised_prompt: z.string().optional(),
      }),
    )
    .min(1),
});

export interface ImageArgs {
  prompt: string;
  n: number;
  out: string;
  name?: string;
  model?: string;
  dryRun: boolean;
  json: boolean;
}

export interface ImageVariant {
  label: string;
  path: string;
  revisedPrompt?: string;
}

export interface ImageResult {
  prompt: string;
  model: string;
  out: string;
  variants: ImageVariant[];
}

// Generate `n` image variants for one prompt and save them as
// <slug>-var-a.png … under `out`. Returns paths + revised prompts.
export async function runImage(args: ImageArgs): Promise<ImageResult> {
  const model = resolveImageModel(args.model);
  const n = Math.min(Math.max(1, args.n), 10);
  const slug = slugify(args.name ?? args.prompt);
  const body = { model, prompt: args.prompt, n, response_format: "b64_json" as const };

  if (args.dryRun) {
    const variants: ImageVariant[] = Array.from({ length: n }, (_, i) => ({
      label: variantLabel(i),
      path: join(args.out, `${slug}-var-${variantLabel(i)}.png`),
    }));
    return { prompt: args.prompt, model, out: args.out, variants };
  }

  const client = new GrokClient();
  const raw = await client.postJson<unknown>("/images/generations", body);
  const parsed = ImageResponseSchema.parse(raw);

  await ensureDir(args.out);
  const variants: ImageVariant[] = [];
  for (let i = 0; i < parsed.data.length; i++) {
    const datum = parsed.data[i];
    if (!datum) continue;
    const label = variantLabel(i);
    const fileName = `${slug}-var-${label}.png`;
    const path = await saveImageVariant(args.out, fileName, datum);
    variants.push({ label, path, revisedPrompt: datum.revised_prompt });
  }

  await writeJson(join(args.out, "variants.json"), {
    prompt: args.prompt,
    model,
    variants,
  });

  return { prompt: args.prompt, model, out: args.out, variants };
}

export function printImageResult(result: ImageResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Generated ${result.variants.length} variant(s) with ${result.model}:\n`);
  for (const v of result.variants) {
    process.stdout.write(`  ${v.label}: ${v.path}\n`);
  }
}
