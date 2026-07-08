import { z } from "zod";
import { GrokClient, resolveTextModel } from "./client.ts";

const ChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export interface ChatArgs {
  prompt: string;
  system?: string;
  model?: string;
  dryRun: boolean;
  json: boolean;
}

export interface ChatResult {
  model: string;
  text: string;
}

// One-shot text completion — used by the skill to refine art prompts and for
// game-design ideation.
export async function runChat(args: ChatArgs): Promise<ChatResult> {
  const model = resolveTextModel(args.model);
  if (args.dryRun) return { model, text: "[dry-run] no request sent" };

  const messages: { role: string; content: string }[] = [];
  if (args.system) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: args.prompt });

  const client = new GrokClient();
  const raw = await client.postJson<unknown>("/chat/completions", { model, messages });
  const chat = ChatResponseSchema.parse(raw);
  return { model, text: chat.choices[0]!.message.content };
}

export function printChatResult(result: ChatResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.text}\n`);
}
