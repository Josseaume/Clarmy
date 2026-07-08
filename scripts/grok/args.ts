// Pure CLI arg helpers — kept separate from cli.ts so importing them never
// triggers the CLI's main() side effect.

// Tiny flag parser: supports --key value, --key=value, and boolean --flag.
export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined || !a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function strFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export function boolFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}
