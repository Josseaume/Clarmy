# Grok connector + A/B game-art skill — Design

Date: 2026-06-14
Status: approved (user gave blanket approval — "je te fais confiance")

## Goal

Let Claude Code generate game assets end-to-end by (1) calling Grok (xAI) through a
small CLI **connector**, and (2) orchestrating an **A/B testing** image workflow via a
skill. Purpose: build entire games (generic asset generator, not tied to one game).

## Decisions (from brainstorming)

- **Connector form:** CLI script run via Bash (not MCP server, not Next API route).
- **Grok capabilities exposed:** image generation + vision judging + chat.
- **A/B selection:** vision judge ranks variants, then user confirms ("auto + confirmation").
- **Asset target:** generic — `sprite | background | tileset | ui | icon`, configurable output dir.

## xAI API surface (verified 2026-06-14)

- Base: `https://api.x.ai/v1`, OpenAI-compatible. Auth: `Authorization: Bearer $XAI_API_KEY`.
- Image: `POST /v1/images/generations` — body `{ model, prompt, n, response_format }`.
  - Models: `grok-imagine-image` (standard), `grok-imagine-image-quality` (HQ).
  - `n` up to 10. `response_format`: `url` | `b64_json`. Response: `data[].b64_json|url`, `data[].revised_prompt`.
- Vision (judge): `POST /v1/chat/completions`, model `grok-4.3`, message content parts
  `{type:"text"}` + `{type:"image_url", image_url:{url:"data:image/png;base64,…"}}`.
- Chat: `POST /v1/chat/completions`, model `grok-4.3`.

## Architecture

```
Claude Code ──Bash──> CLI `grok` (TS) ──HTTP──> xAI API
     │                  image / judge / chat
     └─ Skill `generate-game-art` ── orchestrates A/B (calls CLI, confirms, saves)
```

The CLI is the low-level connector (raw API). The skill is high-level (prompt → N variants
→ judge → confirm → save). Clean split: CLI runs standalone and its `client.ts` is importable
by the app later; the skill holds no HTTP logic.

## Component 1 — CLI connector (`scripts/grok/`)

TypeScript, run with `node --experimental-transform-types` (same runtime as `pnpm dev`).
Files < 300 lines. Conventions: zod for input, no `any`, `createLogger("grok")`.

| File | Responsibility |
|---|---|
| `cli.ts` | arg parsing + subcommand dispatch (entry) |
| `client.ts` | xAI HTTP client: auth, base URL, retry on 429/5xx, error mapping |
| `image.ts` | `grok image` — generate N variants, save PNGs |
| `judge.ts` | `grok judge` — vision: score/rank images → JSON verdict (zod-validated) |
| `chat.ts` | `grok chat` — text completion |
| `io.ts` | variant naming (`var-a/b/c…`), PNG write, read images → data URLs |

`package.json` alias `"grok"` → `node --experimental-transform-types scripts/grok/cli.ts`.

Subcommands:
- `pnpm grok image --prompt "…" --n 4 --out <dir> [--model quality|standard] [--dry-run]`
- `pnpm grok judge --dir <dir> --criteria "…" [--json]` → `{ ranking:[{variant,score,reasons}], winner }`
- `pnpm grok chat --prompt "…" [--json]` → text

Common flags: `--dry-run` (validate args, no API spend), `--json` (machine output).

## Component 2 — Skill (`.claude/skills/generate-game-art/`)

Generic, asset-type aware. `SKILL.md` + `references/rubrics.md` (per-type judge criteria).

Workflow:
1. **Brief:** asset type, description, style, output dir, variant count (default 4).
2. **Prompt:** optionally refine via `grok chat` for style consistency.
3. **Generate:** `grok image --n 4` → variants into an `_ab/` folder.
4. **Judge:** `grok judge` with the per-type rubric.
5. **Confirm (auto + confirmation):** skill reads the top images, presents ranking via
   `AskUserQuestion`; user validates or overrides.
6. **Save:** winner → target dir with final name; variants + `ranking.json` archived in `_ab/`.
7. **Reroll:** if nothing fits, rerun with an adjusted prompt.

**Scope boundary (YAGNI):** the skill produces *source art*. Turning art into Phaser-ready
spritesheets/atlases stays the job of the existing PIL scripts (`pack-office-atlas.py`).
Handoff is a future option, not built now.

## Config, errors, tests

- **Config:** `.env.example` gains `XAI_API_KEY` (+ optional `XAI_BASE_URL`,
  `GROK_IMAGE_MODEL`, `GROK_TEXT_MODEL`). `.claude/settings.local.json` gains
  `Bash(pnpm grok *)` permission.
- **Errors:** missing key → clear message; 401/429/5xx → status + message, backoff retry on
  429/5xx; judge JSON parse failure → fallback to manual pick.
- **Tests:** vitest units on `client.ts` (request building, mocked `fetch`) and `judge.ts`
  (zod parsing of verdict). No real network in tests; `--dry-run` covers arg validation.

## Implementation plan

1. `client.ts` (+ test) — fetch wrapper, auth, retry, error mapping.
2. `io.ts` — naming + PNG write + image→data-URL read.
3. `image.ts`, `judge.ts` (+ test), `chat.ts` — subcommand logic.
4. `cli.ts` — arg parse + dispatch + `--dry-run`/`--json`.
5. `package.json` script, `.env.example`, `.claude/settings.local.json`.
6. Skill `SKILL.md` + `references/rubrics.md`.
7. Verify: `pnpm typecheck` + `pnpm test`.
