"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ApprovalMode, ModelId } from "@/lib/shared/types";
import { MODELS as MODEL_REGISTRY, DEFAULT_MODEL_ID } from "@/lib/shared/models";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Segmented } from "@/components/ui/segmented";
import { MoonIcon, SunIcon, MonitorIcon, EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { notificationsEnabled, setNotificationsEnabled } from "@/lib/client/notify";
import { useCockpit } from "@/lib/client/store";
import type { ThemePreference } from "@/lib/client/theme-settings";

type Tab = "general" | "models" | "approvals" | "telemetry";

const TABS: { id: Tab; label: string; ico: string; desc: string }[] = [
  { id: "general",   label: "General",   ico: "◐", desc: "Theme, runtime, notify" },
  { id: "models",    label: "Models",    ico: "◆", desc: "Default & provider"    },
  { id: "approvals", label: "Approvals", ico: "✓", desc: "Tool gating rules"     },
  { id: "telemetry", label: "Telemetry", ico: "◉", desc: "Local logs & redact"   },
];

const DEFAULT_ALLOW = `Read
Grep
Glob
TodoWrite
Bash(ls*)
Bash(git status)
Bash(git diff*)
Bash(pnpm typecheck)`;

const DEFAULT_DENY = `Bash(rm -rf*)
Bash(git push --force*)
Bash(git reset --hard*)`;

function countRules(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

const cardStyle: CSSProperties = { padding: 0, borderRadius: 8 };
const rowStyle: CSSProperties = { position: "relative", padding: "6px 0" };
const riseOf = (i: number): CSSProperties => ({ animation: "metric-rise .5s cubic-bezier(.2,.7,.2,1) both", animationDelay: `${i * 40}ms` });

interface RetentionState { cleanupPeriodDays: number; persistent: boolean }

// Claude Code prunes transcripts after cleanupPeriodDays (default 30). All of
// CLARMY's history and metrics come from those files, so surface a one-click
// fix whenever the user's retention is still finite.
function RetentionBanner() {
  const [state, setState] = useState<RetentionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [justFixed, setJustFixed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/retention", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setState(j as RetentionState); })
      .catch(() => { /* banner just stays hidden */ });
    return () => { alive = false; };
  }, []);

  const fix = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/retention", { method: "POST" });
      if (res.ok) {
        const j = await res.json() as RetentionState;
        setState(j);
        setJustFixed(true);
      }
    } catch { /* keep the button */ }
    finally { setBusy(false); }
  };

  if (!state) return null;
  if (state.persistent && !justFixed) return null;
  if (justFixed) {
    return (
      <div className="retention-banner ok" role="status">
        <span className="rb-ico">✓</span>
        <span className="rb-text">Claude Code history is now persistent ({state.cleanupPeriodDays.toLocaleString()} days retention).</span>
      </div>
    );
  }
  return (
    <div className="retention-banner" role="alert">
      <span className="rb-ico">▲</span>
      <span className="rb-text">
        Claude Code deletes transcripts after <strong>{state.cleanupPeriodDays} days</strong>.
        CLARMY's history, metrics and costs are built from them and will silently erode.
      </span>
      <button className="btn primary rb-btn" onClick={() => void fix()} disabled={busy}>
        {busy ? "Applying…" : "Make history persistent"}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  const [defaultModel, setDefaultModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [defaultApproval, setDefaultApproval] = useState<ApprovalMode>("prompt");
  const [maxParallel, setMaxParallel] = useState(6);
  // Theme is owned by the cockpit store (single engine); this page only reads
  // tweaks.theme and writes through setTweaks — no local state, no direct
  // data-theme writes. `hydrated` avoids an SSR/client mismatch on the segment
  // since the persisted preference is only known on the client.
  const theme = useCockpit((s) => s.tweaks.theme);
  const setTweaks = useCockpit((s) => s.setTweaks);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const setTheme = (v: ThemePreference) => setTweaks({ theme: v });
  const [telemetry, setTelemetry] = useState(true);
  const [notifications, setNotifications] = useState(true);
  useEffect(() => { setNotifications(notificationsEnabled()); }, []);
  const [allowList, setAllowList] = useState(DEFAULT_ALLOW);
  const [denyList, setDenyList] = useState(DEFAULT_DENY);
  const [dirty, setDirty] = useState(false);
  const [hoverTab, setHoverTab] = useState<Tab | null>(null);
  const [revealKey, setRevealKey] = useState(false);

  const mark = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const onSave = () => setDirty(false);
  const onReset = () => {
    setDefaultModel(DEFAULT_MODEL_ID); setDefaultApproval("prompt"); setMaxParallel(6);
    setTheme("dark"); setTelemetry(true); setNotifications(true);
    setAllowList(DEFAULT_ALLOW); setDenyList(DEFAULT_DENY); setDirty(false);
  };

  const saveStyle: CSSProperties = {
    transition: "box-shadow .3s",
    boxShadow: dirty ? "0 0 0 1px color-mix(in srgb, var(--brand) 55%, transparent), 0 0 22px -4px color-mix(in srgb, var(--brand) 60%, transparent)" : undefined,
  };

  let i = 0;
  const rise = () => riseOf(i++);

  return (
    <div className="settings-shell">
      <div className="settings-header">
        <div>
          <h1>Settings</h1>
          <p className="sub">Per-user preferences for Cockpit. These apply to every new session you spawn from this machine.</p>
        </div>
        <div className="right">
          {dirty && <span className="settings-dirty">Unsaved</span>}
          <button className="btn btn-refresh" onClick={onReset} aria-label="Reset to defaults">
            <RefreshIcon /><span>Reset to defaults</span>
          </button>
          <button className="btn primary" onClick={onSave} aria-disabled={!dirty} disabled={!dirty} style={saveStyle}>Save changes</button>
        </div>
      </div>

      <RetentionBanner />

      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => {
            const active = tab === t.id;
            const hov = hoverTab === t.id;
            return (
              <button
                key={t.id}
                className={`settings-nav-item ${active ? "active" : ""}`}
                onClick={() => setTab(t.id)}
                onMouseEnter={() => setHoverTab(t.id)}
                onMouseLeave={() => setHoverTab(null)}
                style={{ position: "relative", background: !active && hov ? "color-mix(in srgb, var(--brand) 6%, transparent)" : undefined, transition: "background .2s, color .2s, border-color .2s" }}
              >
                <span className="ico">{t.ico}</span>
                <span className="lbl">{t.label}</span>
                <span className="desc">{t.desc}</span>
                <span aria-hidden style={{ position: "absolute", left: 10, right: 10, bottom: 4, height: 1.5, background: "linear-gradient(90deg, transparent, var(--brand), transparent)", transform: `scaleX(${active ? 1 : 0})`, transformOrigin: "center", transition: "transform .35s cubic-bezier(.2,.7,.2,1)", pointerEvents: "none" }} />
              </button>
            );
          })}
        </nav>

        <div key={tab} className="settings-panel" style={{ animation: "metric-rise .3s cubic-bezier(.2,.7,.2,1) both" }}>
          {tab === "general" && (
            <>
              <div className="settings-panel-head" style={rise()}><h2>General</h2><p className="lede">Appearance, concurrency, and notifications.</p></div>
              <Section title="Appearance" style={rise()}>
                <div className="field-grid">
                  <div className="k">Theme</div>
                  <div className="v" style={rowStyle}>
                    <Segmented
                      ariaLabel="Theme"
                      value={hydrated ? theme : "dark"}
                      onChange={(v) => mark(setTheme)(v)}
                      options={[
                        { value: "dark",   label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><MoonIcon /> Dark</span>,   title: "Dark theme" },
                        { value: "light",  label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><SunIcon /> Light</span>,  title: "Light theme" },
                        { value: "system", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><MonitorIcon /> System</span>, title: "Follow system preference" },
                      ]}
                    />
                    <div className="hint" style={{ marginTop: 8 }}>Shared with the topbar toggle and tweaks panel. System follows your OS preference live.</div>
                  </div>
                </div>
              </Section>
              <Section title="Runtime" style={rise()}>
                <div className="field-grid">
                  <div className="k">Max parallel sessions</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><input type="number" min={1} max={24} value={maxParallel} onChange={(e) => mark(setMaxParallel)(Number(e.target.value))} style={{ maxWidth: 120 }} /></FocusInput>
                    <div className="hint">Hard cap on concurrent SDK generators. Extra launches queue.</div>
                  </div>
                </div>
              </Section>
              <Section title="Notifications" style={rise()}>
                <div className="field-grid">
                  <div className="k">Desktop notifications</div>
                  <div className="v" style={rowStyle}>
                    <ToggleSwitch checked={notifications} onChange={(v) => { setNotificationsEnabled(v); mark(setNotifications)(v); }} label="Desktop notifications" />
                    <div className="hint">Notify on pending approvals and session errors while Cockpit is in the background.</div>
                  </div>
                  <div className="k">Command palette</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><input defaultValue="⌘K" readOnly style={{ maxWidth: 120, fontFamily: "var(--font-mono)" }} /></FocusInput>
                  </div>
                </div>
              </Section>
            </>
          )}

          {tab === "models" && (
            <>
              <div className="settings-panel-head" style={rise()}><h2>Models</h2><p className="lede">Default model and provider routing for new sessions.</p></div>
              <Section title="Default" style={rise()}>
                <div className="field-grid">
                  <div className="k">Default model</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput>
                      <select
                        value={defaultModel}
                        onChange={(e) => mark(setDefaultModel)(e.target.value as ModelId)}
                        style={{ minWidth: 220 }}
                      >
                        {MODEL_REGISTRY.map((m) => (
                          <option key={m.id} value={m.id}>{m.id} : {m.tagline}</option>
                        ))}
                      </select>
                    </FocusInput>
                    <div className="hint">Applied to new sessions. Existing sessions keep their original model.</div>
                  </div>
                </div>
              </Section>

              <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "24px 0" }} />

              <Section title="Provider" style={rise()}>
                <div className="field-grid">
                  <div className="k">ANTHROPIC_API_KEY</div>
                  <div className="v" style={rowStyle}>
                    <div style={{ display: "inline-flex", alignItems: "stretch", gap: 6 }}>
                      <FocusInput>
                        <input
                          defaultValue="sk-ant-api03-aX8k2LmN9vQzR4tY7wHcE3bJ5dF1gK6sA2nP0oU8iZ7xC9mV"
                          type={revealKey ? "text" : "password"}
                          style={{ fontFamily: "var(--font-mono)", minWidth: 320 }}
                          onChange={() => setDirty(true)}
                        />
                      </FocusInput>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRevealKey((v) => !v)}
                        aria-label={revealKey ? "Hide API key" : "Reveal API key"}
                        title={revealKey ? "Hide" : "Reveal"}
                        style={{ padding: "0 10px", display: "inline-flex", alignItems: "center" }}
                      >
                        {revealKey ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <div className="hint">Read from the environment at boot. Changing requires a restart.</div>
                  </div>
                  <div className="k">Base URL</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><input defaultValue="https://api.anthropic.com" style={{ fontFamily: "var(--font-mono)", minWidth: 320 }} onChange={() => setDirty(true)} /></FocusInput>
                    <div className="hint">Override to route requests through a proxy or gateway.</div>
                  </div>
                  <div className="k">Fallback routing</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput>
                      <select defaultValue="auto" onChange={() => setDirty(true)} style={{ minWidth: 320 }}>
                        <option value="auto">auto — retry on rate-limit with smaller model</option>
                        <option value="strict">strict — fail fast, never downgrade</option>
                      </select>
                    </FocusInput>
                    <div className="hint">How Cockpit handles 429 rate-limits.</div>
                  </div>
                </div>
              </Section>
            </>
          )}

          {tab === "approvals" && (
            <>
              <div className="settings-panel-head" style={rise()}><h2>Approvals</h2><p className="lede">How Cockpit prompts you before running tools.</p></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginBottom: 14, ...rise() }}>
                <MiniStat label="Allow rules" value={countRules(allowList)} />
                <MiniStat label="Deny rules" value={countRules(denyList)} tone="error" />
              </div>
              <Section title="Mode" style={rise()}>
                <div className="field-grid">
                  <div className="k">Default mode</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><select value={defaultApproval} onChange={(e) => mark(setDefaultApproval)(e.target.value as ApprovalMode)}>
                      <option value="auto">auto — run all tools without asking</option>
                      <option value="prompt">prompt — ask before destructive tools</option>
                      <option value="strict">strict — ask for every tool call</option>
                    </select></FocusInput>
                  </div>
                </div>
              </Section>
              <Section title="Auto-approve" head={<span className="count">{countRules(allowList)} rules</span>} style={rise()}>
                <div className="rule-editor">
                  <div className="rule-editor-head"><span className="rcount">allow</span><span className="spacer" /><button className="r-add" type="button">+ add rule</button></div>
                  <FocusInput><textarea rows={6} value={allowList} onChange={(e) => mark(setAllowList)(e.target.value)} /></FocusInput>
                </div>
                <div className="hint" style={{ fontSize: 10.5, color: "var(--fg-muted)", marginTop: 6 }}>One rule per line. Use <code>Tool(arg-glob)</code> for scoped matchers.</div>
              </Section>
              <Section title="Deny" head={<span className="count">{countRules(denyList)} rules</span>} style={rise()}>
                <div className="rule-editor">
                  <div className="rule-editor-head"><span className="rcount" style={{ color: "var(--state-error)" }}>deny</span><span className="spacer" /><button className="r-add" type="button">+ add rule</button></div>
                  <FocusInput><textarea rows={4} value={denyList} onChange={(e) => mark(setDenyList)(e.target.value)} /></FocusInput>
                </div>
              </Section>
            </>
          )}

          {tab === "telemetry" && (
            <>
              <div className="settings-panel-head" style={rise()}><h2>Telemetry</h2><p className="lede">What Cockpit records about your sessions. Nothing leaves your machine.</p></div>
              <Section title="Storage" style={rise()}>
                <div className="field-grid">
                  <div className="k">Local session logs</div>
                  <div className="v" style={rowStyle}>
                    <ToggleSwitch checked={telemetry} onChange={(v) => mark(setTelemetry)(v)} label="Local session logs" />
                    <div className="hint">Persist WS patches to <code>.cockpit/sessions/*.jsonl</code> for replay.</div>
                  </div>
                  <div className="k">Retention</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><select defaultValue="30d" onChange={() => setDirty(true)}>
                      <option value="7d">7 days</option><option value="30d">30 days</option><option value="forever">keep forever</option>
                    </select></FocusInput>
                  </div>
                </div>
              </Section>
              <Section title="Privacy" style={rise()}>
                <div className="field-grid">
                  <div className="k">Redact secrets</div>
                  <div className="v" style={rowStyle}>
                    <FocusInput><select defaultValue="on" onChange={() => setDirty(true)}>
                      <option value="on">on — mask env, tokens, passwords</option>
                      <option value="off">off — store raw (dangerous)</option>
                    </select></FocusInput>
                  </div>
                </div>
              </Section>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function Section({ title, head, children, style }: { title: string; head?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="settings-section metric-card" style={{ ...cardStyle, ...style }}>
      <div className="mc-glow" />
      <header className="settings-section-head" style={{ position: "relative" }}>
        <h3 className="metric-h" style={{ margin: 0, flex: "0 0 auto" }}>{title}</h3>
        {head}
      </header>
      <div className="settings-section-body" style={{ position: "relative" }}>{children}</div>
    </section>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "error" }) {
  const err = tone === "error";
  const c = err ? { color: "var(--state-error)" } : undefined;
  return (
    <div className="metric-card" style={{ padding: "12px 14px", borderColor: err ? "color-mix(in srgb, var(--state-error) 38%, var(--border))" : undefined }}>
      <div className="mc-glow" />
      <div className="mc-label" style={c}>{label}</div>
      <div className="mc-value" style={c}><AnimatedNumber value={value} /></div>
      <div className="mc-foot">{value === 1 ? "rule" : "rules"} configured</div>
    </div>
  );
}

function FocusInput({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <span
      style={{ display: "inline-block", borderRadius: 6, transition: "box-shadow .2s", boxShadow: focus ? "0 0 0 1px color-mix(in srgb, var(--brand) 55%, transparent), 0 0 14px -4px color-mix(in srgb, var(--brand) 50%, transparent)" : undefined }}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={() => setFocus(false)}
    >
      {children}
    </span>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" />
    </svg>
  );
}


function AnimatedNumber({ value }: { value: number }) {
  const [d, setD] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const s = prev.current, dt = value - s;
    if (Math.abs(dt) < 1e-9) { setD(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      setD(s + dt * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(d).toLocaleString()}</>;
}
