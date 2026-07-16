import type { Effort, SpawnConfig } from "../../shared/types.ts";
import { apiIdFor } from "../../shared/models.ts";
import { resolveCliPath } from "../cli-path.ts";
import type { CliDriver, LiveTailer, ProviderSession, TailPatch } from "../types.ts";
import { GrokTailer } from "./tailer.ts";
import { scanGrok } from "./history.ts";

// Grok is driven as its interactive TUI, forced inline via --no-alt-screen:
// its default alternate-screen mode freezes xterm.js history replay in
// Cockpit's PTY, and the --minimal/--fullscreen flags are sticky (persisted to
// ~/.grok/config.toml) so they must never be used. The prompt is passed as a
// positional arg (we do not type into its TUI), the model via -m, approval via
// --permission-mode / --always-approve, and reasoning effort via
// --reasoning-effort (grok-4.5 supports low/medium/high). Resume re-opens a
// prior session by id.
export const grokDriver: CliDriver = {
  id: "grok",
  promptDelivery: "arg",

  findCli() {
    return resolveCliPath("grok", process.env.GROK_CLI_PATH);
  },

  buildArgs(cfg: SpawnConfig, effort: Effort | null): string[] {
    // Per-invocation inline rendering; nothing is persisted (unlike --minimal).
    const args: string[] = ["--no-alt-screen"];
    const model = apiIdFor(cfg.model);
    if (model) args.push("-m", model);
    if (effort) args.push("--reasoning-effort", effort);
    if (cfg.resumeSessionId) {
      args.push("-r", cfg.resumeSessionId);
    }
    if (cfg.dangerouslySkipPermissions) {
      args.push("--always-approve");
    } else if (cfg.approvalMode === "auto") {
      args.push("--permission-mode", "auto");
    }
    // strict / prompt: leave default so the TUI asks for approval interactively.
    if (!cfg.resumeSessionId && cfg.prompt) args.push(cfg.prompt);
    return args;
  },

  envExtras() {
    return {};
  },

  mcpConfigArgs(): string[] {
    return []; // Grok manages MCP via `grok mcp` / settings, not a launch flag.
  },

  effortInArgs(): boolean {
    return true; // buildArgs delivers effort via --reasoning-effort.
  },

  effortSlash(): string | null {
    return null; // No known slash command to change effort on a live session.
  },

  createTailer(cwd: string, startedAt: number, onPatch: (p: TailPatch) => void): LiveTailer {
    return new GrokTailer(cwd, startedAt, onPatch);
  },

  scanSessions(): ProviderSession[] {
    return scanGrok();
  },
};
