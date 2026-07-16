#!/usr/bin/env node
// clarmy: one command to run the cockpit.
//
//   clarmy            build if stale, start as a daemon, open the browser
//   clarmy start      same, without opening the browser
//   clarmy dev        foreground dev server (hot reload)
//   clarmy stop       stop the daemon
//   clarmy restart    stop + start
//   clarmy status     pid / port / health
//   clarmy logs       tail the daemon log
//
// State lives in ~/.claude/cockpit/ (clarmy.pid, clarmy.log). The production
// build is reused until the git tree changes (stamp in .next/.clarmy-stamp).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.COCKPIT_PORT ?? process.env.PORT ?? 3010);
const DIR = join(homedir(), ".claude", "cockpit");
const PID_FILE = join(DIR, "clarmy.pid");
const LOG_FILE = join(DIR, "clarmy.log");
const STAMP_FILE = join(ROOT, ".next", ".clarmy-stamp");

const cmd = process.argv[2] ?? "up";

function sh(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function treeStamp() {
  const head = sh("git", ["rev-parse", "HEAD"]).out;
  const dirty = sh("git", ["status", "--porcelain"]).out;
  return createHash("sha256").update(head + "\n" + dirty).digest("hex").slice(0, 16);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 && pidAlive(pid) ? pid : null;
  } catch { return null; }
}

async function healthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

function buildIfStale() {
  const stamp = treeStamp();
  const prev = existsSync(STAMP_FILE) ? readFileSync(STAMP_FILE, "utf8").trim() : "";
  if (prev === stamp && existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    console.log("· build up to date");
    return;
  }
  console.log("· building (tree changed)…");
  const r = spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) { console.error("build failed"); process.exit(1); }
  writeFileSync(STAMP_FILE, stamp + "\n");
}

async function start({ open }) {
  if (readPid()) {
    console.log(`· already running (pid ${readPid()}) → http://localhost:${PORT}`);
    if (open) openBrowser();
    return;
  }
  buildIfStale();
  mkdirSync(DIR, { recursive: true });
  const fd = (await import("node:fs")).openSync(LOG_FILE, "a");
  const child = spawn("node", ["--experimental-transform-types", "server.ts"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", COCKPIT_PORT: String(PORT) },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid) + "\n");
  process.stdout.write(`· starting (pid ${child.pid}) `);
  for (let i = 0; i < 40; i++) {
    if (await healthy()) {
      console.log(`\n✓ clarmy up → http://localhost:${PORT}`);
      if (open) openBrowser();
      return;
    }
    if (!pidAlive(child.pid)) break;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`\n✗ failed to come up; see ${LOG_FILE}`);
  process.exit(1);
}

function stop() {
  const pid = readPid();
  if (!pid) { console.log("· not running"); rmSync(PID_FILE, { force: true }); return; }
  process.kill(pid, "SIGTERM");
  console.log(`✓ stopped (pid ${pid})`);
  rmSync(PID_FILE, { force: true });
}

function openBrowser() {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [`http://localhost:${PORT}`], { stdio: "ignore", detached: true }).unref();
}

async function status() {
  const pid = readPid();
  const ok = await healthy();
  console.log(`pid     ${pid ?? "not running"}`);
  console.log(`port    ${PORT}`);
  console.log(`health  ${ok ? "ok" : "down"}`);
  console.log(`logs    ${LOG_FILE}`);
}

// Environment diagnostics for first-run and bug reports. Read-only.
async function doctor() {
  const rows = [];
  const check = (name, ok, note) => rows.push([ok === true ? "✓" : ok === false ? "✗" : "△", name, note]);

  const major = Number(process.versions.node.split(".")[0]);
  check("node >= 22", major >= 22, `v${process.versions.node}`);
  check("pnpm", sh("pnpm", ["--version"]).code === 0, sh("pnpm", ["--version"]).out || "not found");

  for (const cli of ["claude", "codex", "grok"]) {
    const r = sh("which", [cli]);
    check(`${cli} CLI`, r.code === 0 ? true : null, r.code === 0 ? r.out : "not installed (optional)");
  }

  const projects = join(homedir(), ".claude", "projects");
  check("transcripts", existsSync(projects), projects);

  let retention = null;
  try {
    const s = JSON.parse(readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"));
    const days = typeof s.cleanupPeriodDays === "number" ? s.cleanupPeriodDays : 30;
    retention = days >= 3650;
    check("history persistent", retention, `cleanupPeriodDays=${days}${retention ? "" : " (fix in Settings)"}`);
  } catch {
    check("history persistent", false, "settings.json unreadable; default 30d cleanup");
  }

  check("mcp key", existsSync(join(DIR, "mcp.key")), join(DIR, "mcp.key"));
  check("prod build", existsSync(join(ROOT, ".next", "BUILD_ID")), existsSync(join(ROOT, ".next", "BUILD_ID")) ? "ready" : "run: clarmy start (builds automatically)");

  const up = await healthy();
  check(`daemon :${PORT}`, up ? true : null, up ? "healthy" : "not running");

  const w = Math.max(...rows.map(([, n]) => n.length));
  for (const [icon, name, note] of rows) console.log(` ${icon} ${name.padEnd(w + 2)} ${note}`);
  const bad = rows.filter(([i]) => i === "✗").length;
  console.log(bad ? `\n${bad} issue(s) need attention` : "\nall good · clarmy is ready");
}

switch (cmd) {
  case "up":
  case undefined:
    await start({ open: true }); break;
  case "start":
    await start({ open: false }); break;
  case "stop":
    stop(); break;
  case "restart":
    stop(); await start({ open: false }); break;
  case "status":
    await status(); break;
  case "doctor":
    await doctor(); break;
  case "logs":
    spawn("tail", ["-f", LOG_FILE], { stdio: "inherit" }); break;
  case "dev":
    spawnSync("pnpm", ["dev"], { cwd: ROOT, stdio: "inherit" }); break;
  default:
    console.log("usage: clarmy [start|stop|restart|status|logs|doctor|dev]");
    process.exit(2);
}
