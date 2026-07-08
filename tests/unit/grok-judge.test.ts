import { describe, it, expect } from "vitest";
import { extractJson, parseVerdict } from "../../scripts/grok/judge.ts";
import { parseFlags } from "../../scripts/grok/args.ts";

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON wrapped in prose / code fences", () => {
    const raw = "Here is the verdict:\n```json\n{\"winner\":\"a\"}\n```\nDone.";
    expect(extractJson(raw)).toEqual({ winner: "a" });
  });

  it("throws when there is no JSON object", () => {
    expect(() => extractJson("no json here")).toThrowError();
  });
});

describe("parseVerdict", () => {
  it("validates a well-formed verdict", () => {
    const raw = JSON.stringify({
      ranking: [
        { variant: "b", score: 9, reasons: "cleanest silhouette" },
        { variant: "a", score: 6, reasons: "muddy palette" },
      ],
      winner: "b",
    });
    const v = parseVerdict(raw);
    expect(v.winner).toBe("b");
    expect(v.ranking[0]?.variant).toBe("b");
  });

  it("rejects a malformed verdict", () => {
    expect(() => parseVerdict('{"ranking":[],"winner":1}')).toThrowError();
  });
});

describe("parseFlags", () => {
  it("handles --key value, --key=value, and boolean --flag", () => {
    const flags = parseFlags(["--prompt", "a cat", "--n=4", "--dry-run", "--out", "x/y"]);
    expect(flags).toEqual({ prompt: "a cat", n: "4", "dry-run": true, out: "x/y" });
  });
});
