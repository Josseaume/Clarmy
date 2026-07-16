# Multi-provider CLIs

Cockpit pilots several agent CLIs side by side: **Claude** (Anthropic
`claude`), **Codex** (OpenAI `codex`), **Grok** (xAI `grok`), and **opencode**
(SST `opencode`). The active provider is a topbar switch; sessions and metrics
are counted strictly per provider, never mixed.

## Concepts

- `ProviderId = "claude" | "codex" | "grok" | "opencode"` lives in
  `src/lib/shared/providers.ts` (client-safe: label, vendor, binary name, home
  dir, accent). `DEFAULT_PROVIDER` is `claude`.
- The model registry (`src/lib/shared/models.ts`) is per-provider: each
  `ModelSpec` carries `provider`, and helpers (`modelsForProvider`,
  `defaultModelFor`, `providerOfModel`) scope lookups. Model ids stay globally
  unique so a single `ModelId` recovers its provider.
- `SpawnConfig` and `SessionSnapshot` carry `provider`. It is persisted
  (`session-store.ts`, `cron-types.ts`) and round-trips through the WS protocol.

## The driver contract

Server-side behaviour lives behind `CliDriver` (`src/lib/providers/types.ts`).
One driver per provider, resolved by `getDriver(provider)`
(`src/lib/providers/registry.ts`):

| Member | Responsibility |
| --- | --- |
| `findCli()` | absolute binary path or null (honours `<PROVIDER>_CLI_PATH`) |
| `buildArgs(cfg, effort)` | argv for the spawn |
| `promptDelivery` | `"type"` pastes the prompt into the TTY (Claude); `"arg"` embeds it in argv (Codex/Grok/opencode) |
| `effortInArgs` / `effortSlash` | whether effort is a launch flag, and the runtime slash command (or null) to change it live |
| `createTailer(cwd, startedAt, onPatch)` | live metrics watcher emitting `TailPatch` |
| `scanSessions()` | historical sessions as `ProviderSession[]` for `/api/metrics` |

`PtyRunner` is fully provider-agnostic: it asks the driver for the cli path,
argv, env extras, prompt/effort delivery and tailer. `/api/metrics` calls
`scanAllProviders()` and tags every row with its provider; the client filters to
the active provider before aggregating.

## Per-provider specifics

### Claude (`~/.claude`)
Wraps the existing `claude-code/` code. `--model`, `--effort` (low..max as a
flag, `ultracode` via the `/effort` slash command), `--permission-mode` /
`--dangerously-skip-permissions`. Live + historical metrics from the JSONL under
`~/.claude/projects/`.

### Codex (`~/.codex`, override `CODEX_HOME`)
Driven interactively: `codex -m <model> -c model_reasoning_effort=<low|medium|
high> --ask-for-approval <policy> --sandbox <mode>` (or
`--dangerously-bypass-approvals-and-sandbox` for skip-perms). Effort is a launch
config override and cannot change on a live session. Resume via
`codex resume <id>`.

History + live metrics parse the rollout JSONL at
`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`. Each line is
`{ timestamp, type, payload }`; token usage is the **last** `event_msg` of inner
type `token_count` (`info.total_token_usage` is cumulative, so we never sum).
`input_tokens` includes cached input, so billable input is
`input_tokens - cached_input_tokens`; `output_tokens + reasoning_output_tokens`
is billed as output.

### Grok (`~/.grok`)
Driven interactively: `grok --no-alt-screen -m <model> --reasoning-effort
<low|medium|high> [--permission-mode auto | --always-approve] "<prompt>"`.

- **`--no-alt-screen` is mandatory.** By default the `grok` TUI renders
  fullscreen on the terminal's alternate screen, which freezes xterm.js history
  replay in Cockpit's PTY. `--no-alt-screen` forces inline rendering
  per-invocation without persisting anything. Do **not** use `--minimal` or
  `--fullscreen`: those flags are sticky (written to `~/.grok/config.toml`) and
  would silently change the user's own `grok` sessions.
- **Single model: `grok-4.5`**, with reasoning effort delivered as the
  `--reasoning-effort low|medium|high` launch flag (no known slash command to
  change it live). Model ids should be re-verified with `grok models` on every
  CLI version bump — the catalog has churned before (grok-cli v0.2.x dropped
  the earlier coding models).
- **Auth is `grok login`** (OIDC token that expires). When the token is stale
  the TUI parks on its login screen, so a piloted session that seems stuck
  right after spawn usually just needs a fresh `grok login` in a terminal.
- Resume re-opens a prior session via `-r <id>` (no prompt is sent on resume,
  matching the Codex/opencode drivers).

## Pricing

`claude-code/pricing.ts` is provider-neutral. Fallback per-token prices for
non-Anthropic models were added, plus substring matches; LiteLLM overrides
them when reachable.

## Adding a provider

1. Add a `ProviderMeta` to `PROVIDERS` and the `ProviderId` union.
2. Add its `ModelSpec`s (with `provider`) to `MODELS`.
3. Implement a `CliDriver` under `src/lib/providers/<id>/` and register it in
   `registry.ts`.
4. Add fallback pricing entries if the vendor is not in LiteLLM.

The topbar, store, dashboard, new-session form and metrics view need no changes:
they iterate `PROVIDERS` and scope by the active `provider`.

## Status of the Codex driver

`codex` was **not installed** in the build environment, so its flags, paths and
transcript format are implemented from the vendor's published docs and source
(verified by research, high confidence). It degrades gracefully: a missing home
dir yields an empty scan, and an absent binary yields a clear "install / set
`<PROVIDER>_CLI_PATH`" error at spawn. Verify the flags against the installed
build and adjust `buildArgs` if the vendor changed them.

## Local checks

`pnpm typecheck` is the reliable gate and passes. `pnpm test` and `pnpm build`
currently fail in this container for an unrelated reason: the shared
`node_modules` is missing the linux-arm64 native binaries for `rollup`
(vitest) and `lightningcss` (Tailwind v4 build). Reinstall dependencies on the
target arch to run those.
