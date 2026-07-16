import { watch, existsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { scanAllProviders } from "./scan-all.ts";
import { scanAll, aggregateUsage, type CCSession, type UsageTotals } from "../claude-code/history.ts";
import { refreshPricing } from "../claude-code/pricing.ts";
import { projectsDir } from "../claude-code/paths.ts";
import { codexSessionsDir } from "./codex/paths.ts";
import { computeRows, type MetricsRow } from "./metrics-rows.ts";
import { mergeHistory, type HistorySession } from "./history-merge.ts";
import { createLogger } from "../util/logger.ts";

export type { MetricsRow } from "./metrics-rows.ts";
export type { HistorySession } from "./history-merge.ts";

// Claude session minus its usage records: enough for the history and projects
// pages, cheap to structured-clone out of the worker.
export type LightSession = Omit<CCSession, "usage">;
export type PerCwdEntry = [string, UsageTotals & { costUsd: number }];

const log = createLogger("metrics-index");

const DEBOUNCE_MS = 1_500;
const FALLBACK_TTL_MS = 60_000;   // safety net when fs.watch is unavailable
const WORKER_TIMEOUT_MS = 120_000;

// The store is shared across BOTH module graphs (server.ts's node graph and
// Next's compiled route graph) via globalThis, like the SessionManager.
class MetricsIndex {
  private rows: MetricsRow[] | null = null;
  private light: LightSession[] | null = null;
  private historyRows: HistorySession[] = [];
  private perCwd: PerCwdEntry[] = [];
  private generatedAt = 0;
  private dirty = true;
  private building: Promise<MetricsRow[]> | null = null;
  private watchers: FSWatcher[] = [];
  private watching = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  // Cached rows, rebuilt only when transcripts changed. Concurrent callers
  // share one in-flight build. Stale-while-revalidate: once we have ANY rows,
  // requests never wait on a rebuild; they get the previous snapshot and the
  // WS metrics.dirty push makes clients refetch when the fresh one lands.
  async payload(): Promise<{ generatedAt: number; rows: MetricsRow[] }> {
    const stale = !this.watching && Date.now() - this.generatedAt > FALLBACK_TTL_MS;
    if (this.rows && !this.dirty && !stale) {
      return { generatedAt: this.generatedAt, rows: this.rows };
    }
    if (!this.building) {
      this.building = this.build().finally(() => { this.building = null; });
    }
    if (this.rows) {
      return { generatedAt: this.generatedAt, rows: this.rows };
    }
    const rows = await this.building;
    return { generatedAt: this.generatedAt, rows };
  }

  // Light claude sessions for /api/history and /api/projects, same lifecycle
  // and stale-while-revalidate semantics as payload().
  async sessions(): Promise<{ generatedAt: number; sessions: LightSession[]; perCwd: PerCwdEntry[] }> {
    await this.payload();
    return { generatedAt: this.generatedAt, sessions: this.light ?? [], perCwd: this.perCwd };
  }

  // Cross-provider history rows for /api/history (claude + grok + codex),
  // same stale-while-revalidate lifecycle as payload().
  async history(): Promise<{ generatedAt: number; sessions: HistorySession[] }> {
    await this.payload();
    return { generatedAt: this.generatedAt, sessions: this.historyRows };
  }

  // Notify when the index went dirty (debounced); ws-server fans this out so
  // clients refetch instead of polling.
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Recursive fs.watch on every provider's transcript root. macOS and Windows
  // support recursive natively; on platforms that throw we fall back to the
  // payload() TTL. Never crashes the server.
  startWatching(): void {
    if (this.watching) return;
    const roots = [projectsDir(), codexSessionsDir()];
    for (const root of roots) {
      try {
        const w = watch(root, { recursive: true, persistent: false }, (_e, file) => {
          if (file && !String(file).endsWith(".jsonl") && !String(file).endsWith(".json")) return;
          this.markDirty();
        });
        w.on("error", (err) => log.warn("watcher error", { root, err: String(err) }));
        this.watchers.push(w);
      } catch (err) {
        log.warn("fs.watch unavailable; falling back to TTL", { root, err: String(err) });
      }
    }
    this.watching = this.watchers.length > 0;
    log.info("metrics index watching", { roots: this.watchers.length });
  }

  stopWatching(): void {
    for (const w of this.watchers) { try { w.close(); } catch { /* ignore */ } }
    this.watchers = [];
    this.watching = false;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    disposeWorker();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      // Rebuild proactively so the next request is served hot, then notify.
      void this.payload().then(() => {
        for (const cb of this.listeners) { try { cb(); } catch { /* listener owns its errors */ } }
      });
    }, DEBOUNCE_MS);
  }

  private async build(): Promise<MetricsRow[]> {
    const t0 = Date.now();
    let rows: MetricsRow[];
    let light: LightSession[];
    let history: HistorySession[];
    let perCwd: PerCwdEntry[];
    let via = "worker";
    try {
      const r = await buildInWorker();
      rows = r.rows;
      light = r.sessions;
      history = r.history;
      perCwd = r.perCwd;
    } catch (err) {
      // The scanners are synchronous; this blocks the loop for the duration of
      // the scan, so the worker is strongly preferred. Keep the fallback so a
      // broken worker path degrades to slow, never to broken.
      via = "sync";
      log.warn("worker build failed; building inline", { err: String(err) });
      await refreshPricing().catch(() => { /* fallback table */ });
      const providerSessions = scanAllProviders();
      rows = computeRows(providerSessions);
      const full = scanAll();
      light = full.map(({ usage: _usage, ...rest }) => rest);
      history = mergeHistory(full, providerSessions);
      perCwd = [...aggregateUsage(full).perCwd.entries()];
    }
    this.rows = rows;
    this.light = light;
    this.historyRows = history;
    this.perCwd = perCwd;
    this.generatedAt = Date.now();
    this.dirty = false;
    log.info("metrics index rebuilt", { rows: rows.length, ms: Date.now() - t0, via });
    return rows;
  }
}

// Builds run in ONE persistent worker thread: the synchronous transcript scan
// never blocks the event loop, and because the worker survives across builds
// the scanners' per-file mtime caches stay warm; only the first build is a
// full cold parse, later ones re-read just the changed files. The worker file
// is resolved from the repo root (the process always boots from there via
// server.ts / bin/clarmy), not via import.meta.url, which would point inside
// Next's compiled bundle. A crashed or timed-out worker is dropped and
// respawned on the next build.
interface BuildResult { readonly rows: MetricsRow[]; readonly sessions: LightSession[]; readonly history: HistorySession[]; readonly perCwd: PerCwdEntry[] }

interface PendingBuild {
  readonly resolve: (r: BuildResult) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, PendingBuild>();

function failAll(err: Error): void {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
  pending.clear();
}

function disposeWorker(): void {
  failAll(new Error("worker disposed"));
  if (worker) { void worker.terminate(); worker = null; }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const entry = join(process.cwd(), "src", "lib", "providers", "metrics-build-worker.ts");
  if (!existsSync(entry)) throw new Error(`worker entry missing: ${entry}`);
  const w = new Worker(entry);
  w.unref(); // never hold the process open
  w.on("message", (msg: { seq: number; ok: boolean; rows?: MetricsRow[]; sessions?: LightSession[]; history?: HistorySession[]; perCwd?: PerCwdEntry[]; error?: string }) => {
    const p = pending.get(msg.seq);
    if (!p) return;
    pending.delete(msg.seq);
    clearTimeout(p.timer);
    if (msg.ok && msg.rows) p.resolve({ rows: msg.rows, sessions: msg.sessions ?? [], history: msg.history ?? [], perCwd: msg.perCwd ?? [] });
    else p.reject(new Error(msg.error ?? "worker build failed"));
  });
  w.on("error", (err) => { failAll(err instanceof Error ? err : new Error(String(err))); worker = null; });
  w.on("exit", () => { failAll(new Error("worker exited")); worker = null; });
  worker = w;
  return w;
}

function buildInWorker(): Promise<BuildResult> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      disposeWorker(); // a wedged worker is replaced on the next build
      reject(new Error("worker build timed out"));
    }, WORKER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "build", seq: id });
  });
}

interface Holder { __cockpitMetricsIndex?: MetricsIndex }

export function getMetricsIndex(): MetricsIndex {
  const g = globalThis as unknown as Holder;
  if (!g.__cockpitMetricsIndex) g.__cockpitMetricsIndex = new MetricsIndex();
  return g.__cockpitMetricsIndex;
}
