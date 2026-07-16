"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalMode, Effort, ModelId, ProviderId } from "@/lib/shared/types";
import { defaultModelFor, effortLevelsFor, defaultEffortFor, modelBelongsToProvider } from "@/lib/shared/models";
import { DEFAULT_PROVIDER, PROVIDERS, coerceProviderId } from "@/lib/shared/providers";
import { useCockpit } from "@/lib/client/store";
import { ProjectSelector, type ProjectOption } from "./project-selector";
import { ModelPicker } from "./model-picker";

const BUILTIN_TOOLS = ["Bash", "Read", "Edit", "Write", "Grep", "TodoWrite"];
const EXTRA_TOOLS = ["Glob", "WebFetch", "WebSearch", "Task"];

const LS_KEY = "cockpit.newSession.prefs.v1";
type Prefs = { provider?: ProviderId; model?: ModelId; effort?: Effort; skipPerms?: boolean };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Prefs;
  } catch { return {}; }
}

function savePrefs(p: Prefs): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function NewSessionView() {
  const router = useRouter();
  const search = useSearchParams();
  const initialCwd = search.get("cwd") ?? "";
  const initialPrompt = search.get("prompt") ?? "";
  const autolaunch = search.get("autolaunch") === "1";

  const setStoreProvider = useCockpit((s) => s.setProvider);
  // Prefs live in localStorage, which the server can't read: SSR and the first
  // client render must both show the defaults, so persisted prefs are applied
  // in the post-mount effect below rather than in the initial state.
  const [provider, setProviderState] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [model, setModel] = useState<ModelId>(() => defaultModelFor(DEFAULT_PROVIDER));
  const [effort, setEffort] = useState<Effort | null>(() => {
    const m = defaultModelFor(DEFAULT_PROVIDER);
    return effortLevelsFor(m).length === 0 ? null : defaultEffortFor(m);
  });
  const prefsHydrated = useRef(false);

  // Switching provider keeps the topbar in sync and snaps the model to one the
  // provider actually offers.
  const onProvider = (p: ProviderId) => {
    setProviderState(p);
    setStoreProvider(p);
  };

  useEffect(() => {
    setModel((cur) => (modelBelongsToProvider(provider, cur) ? cur : defaultModelFor(provider)));
  }, [provider]);

  useEffect(() => {
    const levels = effortLevelsFor(model);
    if (levels.length === 0) { setEffort(null); return; }
    setEffort((cur) => (cur && levels.includes(cur) ? cur : defaultEffortFor(model)));
  }, [model]);
  const [tools, setTools] = useState<string[]>([...BUILTIN_TOOLS]);
  const [project, setProject] = useState("");
  const [cwd, setCwd] = useState(initialCwd);
  const [cwdMissing, setCwdMissing] = useState(false);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [approval, setApproval] = useState<ApprovalMode>("prompt");
  const [autoMode, setAutoMode] = useState(false);
  const [skipPerms, setSkipPerms] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [customBranch, setCustomBranch] = useState(false);
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitCurrent, setGitCurrent] = useState<string | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitReason, setGitReason] = useState<string | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState(autolaunch && Boolean(initialPrompt));

  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  useEffect(() => {
    // Declared before the hydration effect so the mount run is skipped and the
    // pre-hydration defaults never overwrite the stored prefs.
    if (!prefsHydrated.current) return;
    savePrefs({ provider, model, effort: effort ?? undefined, skipPerms });
  }, [provider, model, effort, skipPerms]);

  useEffect(() => {
    const prefs = loadPrefs();
    const p = coerceProviderId(prefs.provider ?? useCockpit.getState().provider);
    const m = prefs.model && modelBelongsToProvider(p, prefs.model)
      ? prefs.model
      : defaultModelFor(p);
    setProviderState(p);
    setModel(m);
    const levels = effortLevelsFor(m);
    const wanted = prefs.effort;
    setEffort(levels.length === 0 ? null : wanted && levels.includes(wanted) ? wanted : defaultEffortFor(m));
    setSkipPerms(prefs.skipPerms ?? false);
    prefsHydrated.current = true;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { projects: ProjectOption[] };
        const sorted = j.projects.slice().sort((a, b) => {
          const la = a.lastRunAt ?? 0;
          const lb = b.lastRunAt ?? 0;
          if (lb !== la) return lb - la;
          return b.sessions - a.sessions;
        });
        setProjects(sorted);
        if (initialCwd) {
          const match = sorted.find((p) => p.cwd === initialCwd);
          if (match) {
            setProject(match.name);
            setBranch(match.branches[0] ?? "main");
          }
        } else if (!project && sorted[0]) {
          setProject(sorted[0].name);
          setCwd(sorted[0].cwd);
          setBranch(sorted[0].branches[0] ?? "main");
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const selected = useMemo<ProjectOption | null>(
    () => projects.find((p) => p.name === project && p.cwd === cwd) ?? null,
    [projects, project, cwd],
  );

  useEffect(() => {
    if (!cwd) { setGitBranches([]); setGitCurrent(null); setGitReason(null); return; }
    const ac = new AbortController();
    setGitLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`, { signal: ac.signal });
        if (!res.ok) return;
        const j = (await res.json()) as {
          branches: { name: string; lastCommitAt: number }[];
          current: string | null;
          reason?: string;
        };
        setGitBranches(j.branches.map((b) => b.name));
        setGitCurrent(j.current);
        setGitReason(j.reason ?? null);
        if (j.current && !customBranch) setBranch(j.current);
      } catch { /* aborted */ }
      finally { setGitLoading(false); }
    })();
    return () => ac.abort();
  }, [cwd]);

  const onPick = (p: ProjectOption) => {
    setProject(p.name);
    setCwd(p.cwd);
    setBranch(p.branches[0] ?? "main");
    setCustomBranch(false);
    setCwdMissing(false);
  };

  const onCustom = (nm: string) => {
    setProject(nm);
    setCwd("");
    setBranch("main");
    setCustomBranch(false);
  };

  const validateCwd = async () => {
    if (!cwd.trim()) { setCwdMissing(false); return; }
    try {
      const res = await fetch(`/api/fs/exists?path=${encodeURIComponent(cwd)}`);
      if (!res.ok) { setCwdMissing(false); return; }
      const j = (await res.json()) as { exists: boolean; isDirectory: boolean };
      setCwdMissing(!(j.exists && j.isDirectory));
    } catch { setCwdMissing(false); }
  };

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of gitBranches) set.add(b);
    for (const b of selected?.branches ?? []) set.add(b);
    return Array.from(set);
  }, [gitBranches, selected]);

  const toggleTool = (t: string) =>
    setTools((xs) => xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]);

  const submit = async () => {
    if (!project.trim() || !cwd.trim() || !prompt.trim()) {
      setErr("Project, cwd and prompt are required.");
      return;
    }
    if (cwdMissing) {
      setErr("Project dir does not exist on disk.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          project, cwd, name: name || prompt.split("\n")[0]!.slice(0, 60), model,
          allowedTools: tools,
          approvalMode: skipPerms ? "auto" : autoMode ? "auto" : approval,
          dangerouslySkipPermissions: skipPerms,
          branch, prompt,
          ...(effort ? { effort } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.push("/");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setPendingLaunch(false);
    }
  };

  // Keyboard/auto-launch effects capture submit via a ref so they always call
  // the latest closure (submit reads far more state than the effect deps track).
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!pendingLaunch) return;
    if (!project.trim() || !cwd.trim() || !prompt.trim()) return;
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingLaunch(false);
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => { void submitRef.current(); }, 500);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [pendingLaunch, project, cwd, prompt, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!busy) void submitRef.current();
      } else if (e.key === "Escape" && !pendingLaunch) {
        router.push("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, pendingLaunch, router]);

  return (
    <div className="new-session-view">
      <h1>New session</h1>
      <p className="lede">Spawn an agent CLI session in a project directory. Pick the provider (Claude, Codex, Grok or OpenCode), then approve tool calls individually or let a set of them run unattended.</p>

      <div className="form-card">
        <div className="form-section">
          <h4>Workspace</h4>
          <div className="form-row">
            <label>Project</label>
            <div className="ctrl">
              <ProjectSelector
                projects={projects}
                value={project}
                selected={selected}
                onPick={onPick}
                onCustom={onCustom}
              />
              {projects.length === 0 && (
                <div className="hint" style={{ fontSize: 10.5, color: "var(--fg-muted)", marginTop: 6 }}>
                  No saved projects yet — create a custom one, or add it in <a href="/projects" style={{ color: "var(--brand)" }}>Projects</a>.
                </div>
              )}
            </div>
          </div>
          <div className="form-row">
            <label>Project dir</label>
            <div className="ctrl">
              <input
                value={cwd}
                onChange={(e) => { setCwd(e.target.value); setCwdMissing(false); }}
                onBlur={validateCwd}
                placeholder="/Users/me/code/acme-api"
              />
              {cwdMissing && (
                <div className="field-error">path does not exist on disk</div>
              )}
            </div>
          </div>
          <div className="form-row">
            <label>Branch</label>
            <div className="ctrl">
              {branchOptions.length > 0 && !customBranch ? (
                <select
                  value={branch}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") { setCustomBranch(true); return; }
                    setBranch(e.target.value);
                  }}
                >
                  {branchOptions.map((b) => (
                    <option key={b} value={b}>{b === gitCurrent ? `⎇ ${b} · current` : `⎇ ${b}`}</option>
                  ))}
                  <option value="__custom__">+ custom…</option>
                </select>
              ) : (
                <input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  onBlur={() => { if (branchOptions.includes(branch)) setCustomBranch(false); }}
                />
              )}
              <div className="branch-hint">
                {gitLoading && <span>reading git…</span>}
                {!gitLoading && gitReason === "not-a-repo" && <span>not a git repo — type a name above</span>}
                {!gitLoading && gitReason === "missing" && <span>cwd not found</span>}
                {!gitLoading && !gitReason && gitBranches.length > 0 && (
                  <span>{gitBranches.length} live branch{gitBranches.length > 1 ? "es" : ""} · current = {gitCurrent ?? "?"}</span>
                )}
              </div>
            </div>
          </div>
          <div className="form-row">
            <label>Session name</label>
            <div className="ctrl"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="refactor auth middleware" /></div>
          </div>
        </div>

        <div className="form-section">
          <h4>Model</h4>
          <div className="form-row">
            <label>Provider</label>
            <div className="ctrl">
              <div className="model-segment" role="radiogroup" aria-label="Provider">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={provider === p.id}
                    className={provider === p.id ? "on" : ""}
                    onClick={() => onProvider(p.id)}
                    title={p.tagline}
                  >{p.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="form-row">
            <label>Model</label>
            <div className="ctrl">
              <ModelPicker provider={provider} model={model} onModel={setModel} />
            </div>
          </div>
          <div className="form-row">
            <label>Effort</label>
            <div className="ctrl">
              {effortLevelsFor(model).length === 0 ? (
                <div className="effort-note">effort not supported on {model}</div>
              ) : (
                <div className="model-segment" role="radiogroup" aria-label="Effort">
                  {effortLevelsFor(model).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      role="radio"
                      aria-checked={effort === lvl}
                      className={effort === lvl ? "on" : ""}
                      onClick={() => setEffort(lvl)}
                    >{lvl}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h4>Allowed tools</h4>
          <div className="form-row">
            <label>Tools</label>
            <div className="ctrl">
              <div className="tool-grid">
                <div className="tool-group-label">Built-in</div>
                {BUILTIN_TOOLS.map((t) => {
                  const on = tools.includes(t);
                  return (
                    <label key={t} className={`tool-row ${on ? "" : "off"}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleTool(t)} />
                      <span className="tool-name">{t}</span>
                    </label>
                  );
                })}
                <div className="tool-group-label">Extra</div>
                {EXTRA_TOOLS.map((t) => {
                  const on = tools.includes(t);
                  return (
                    <label key={t} className={`tool-row ${on ? "" : "off"}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleTool(t)} />
                      <span className="tool-name">{t}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="form-row">
            <label>Approval</label>
            <div className="ctrl">
              <select
                value={approval}
                onChange={(e) => setApproval(e.target.value as ApprovalMode)}
                disabled={autoMode || skipPerms}
                style={autoMode || skipPerms ? { opacity: 0.5 } : undefined}
              >
                <option value="prompt">prompt — ask before destructive tools</option>
                <option value="strict">strict — ask for every tool call</option>
                <option value="auto">auto — run all tools without asking</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <label>Auto mode</label>
            <div className="ctrl">
              <label
                className={`toggle-row ${skipPerms ? "disabled" : ""}`}
                title="Accept every tool call — equivalent to --permission-mode acceptEdits"
              >
                <input
                  type="checkbox"
                  checked={autoMode}
                  disabled={skipPerms}
                  onChange={(e) => setAutoMode(e.target.checked)}
                  style={{ accentColor: "var(--brand)" }}
                />
                <span className="toggle-text">
                  <span className="toggle-title">Accept every tool call</span>
                </span>
              </label>
            </div>
          </div>
          <div className="form-row">
            <label className={skipPerms ? "label-danger" : undefined}>Skip perms</label>
            <div className="ctrl">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={skipPerms}
                  onChange={(e) => setSkipPerms(e.target.checked)}
                  style={{ accentColor: "var(--state-error)" }}
                />
                <span className="toggle-text">
                  <span className={`toggle-title ${skipPerms ? "toggle-danger" : ""}`}>dangerously-skip-permissions</span>
                  {skipPerms && <span className="inline-warn-badge">⚠ unsandboxed</span>}
                </span>
              </label>
              {skipPerms && (
                <div className="danger-banner">
                  <code>rm -rf</code>, <code>git push --force</code>, and network calls run without asking. Use only in sandboxed envs.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h4>Initial prompt</h4>
          <div className="form-row">
            <label>Prompt</label>
            <div className="ctrl">
              <textarea ref={promptRef} rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="form-foot">
          <span className="hint">
            {err ? <span style={{ color: "var(--state-error)" }}>{err}</span>
             : pendingLaunch ? <span style={{ color: "var(--brand)" }}>auto-launching… press esc to cancel</span>
             : "⌘↵ to launch · esc to cancel"}
          </span>
          <button className="btn ghost" onClick={() => { setPendingLaunch(false); router.push("/"); }}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy && <span className="spinner-dot" />}
            {busy ? "Launching…" : "Launch session"}
          </button>
        </div>
      </div>
    </div>
  );
}
