import type { ProviderId } from "../shared/types.ts";
import type { CliDriver } from "./types.ts";
import { claudeDriver } from "./claude/driver.ts";
import { codexDriver } from "./codex/driver.ts";
import { grokDriver } from "./grok/driver.ts";
import { opencodeDriver } from "./opencode/driver.ts";

const DRIVERS: Record<ProviderId, CliDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  grok: grokDriver,
  opencode: opencodeDriver,
};

export function getDriver(provider: ProviderId): CliDriver {
  return DRIVERS[provider] ?? claudeDriver;
}

export function allDrivers(): readonly CliDriver[] {
  return Object.values(DRIVERS);
}
