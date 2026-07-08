import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

// a, b, c … z. We cap variant count at 10 so single letters always suffice.
export function variantLabel(index: number): string {
  return String.fromCharCode(97 + index);
}

// Kebab slug for filenames, derived from a free-text prompt or explicit name.
export function slugify(input: string, fallback = "asset"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// Persist one generated variant. xAI returns either b64_json or a url; handle
// both. Returns the absolute file path written.
export async function saveImageVariant(
  dir: string,
  fileName: string,
  variant: { b64_json?: string; url?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  await ensureDir(dir);
  const path = join(dir, fileName);
  if (variant.b64_json) {
    await writeFile(path, Buffer.from(variant.b64_json, "base64"));
    return path;
  }
  if (variant.url) {
    const res = await fetchImpl(variant.url);
    if (!res.ok) throw new Error(`Failed to download variant: ${res.status} ${variant.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buf);
    return path;
  }
  throw new Error("Variant has neither b64_json nor url");
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

// Read an image file and return an OpenAI-style data URL for vision input.
export async function readImageAsDataUrl(path: string): Promise<string> {
  const buf = await readFile(path);
  return `data:${mimeFor(path)};base64,${buf.toString("base64")}`;
}

// Sorted list of image files directly inside `dir` (non-recursive).
export async function listImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((e) => IMAGE_EXTS.has(extname(e).toLowerCase()))
    .sort()
    .map((e) => join(dir, e));
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function fileLabel(path: string): string {
  return basename(path);
}
