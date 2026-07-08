import { GrokApiError } from "./client.ts";
import { boolFlag as bool, parseFlags, strFlag as str } from "./args.ts";
import { printImageResult, runImage } from "./image.ts";
import { printJudgeResult, runJudge } from "./judge.ts";
import { printChatResult, runChat } from "./chat.ts";

function required(flags: Record<string, string | boolean>, key: string): string {
  const v = str(flags, key);
  if (v === undefined) throw new GrokApiError(0, `Missing required flag --${key}`);
  return v;
}

const HELP = `grok — xAI connector for Claude Code

Usage:
  pnpm grok image --prompt "<text>" --out <dir> [--n 4] [--name <slug>] [--model quality|standard]
  pnpm grok judge --dir <dir> --criteria "<text>" [--model <id>]
  pnpm grok chat  --prompt "<text>" [--system "<text>"] [--model <id>]

Common flags:
  --dry-run   validate args and print the planned request, no API spend
  --json      machine-readable JSON output
  --help      show this help

Env: XAI_API_KEY (required), XAI_BASE_URL, GROK_IMAGE_MODEL, GROK_TEXT_MODEL (optional)`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!command || command === "--help" || bool(flags, "help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const dryRun = bool(flags, "dry-run");
  const json = bool(flags, "json");

  switch (command) {
    case "image": {
      const result = await runImage({
        prompt: required(flags, "prompt"),
        out: required(flags, "out"),
        n: Number(str(flags, "n") ?? 4),
        name: str(flags, "name"),
        model: str(flags, "model"),
        dryRun,
        json,
      });
      printImageResult(result, json);
      break;
    }
    case "judge": {
      const result = await runJudge({
        dir: required(flags, "dir"),
        criteria: required(flags, "criteria"),
        model: str(flags, "model"),
        dryRun,
        json,
      });
      printJudgeResult(result, json);
      break;
    }
    case "chat": {
      const result = await runChat({
        prompt: required(flags, "prompt"),
        system: str(flags, "system"),
        model: str(flags, "model"),
        dryRun,
        json,
      });
      printChatResult(result, json);
      break;
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}\n`);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  if (err instanceof GrokApiError) {
    process.stderr.write(`grok: ${err.message}\n`);
  } else {
    process.stderr.write(`grok: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = 1;
});
