"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useCockpit } from "@/lib/client/store";
import { STATE_META } from "../shell/state-meta";

export function CommandPalette() {
  const open = useCockpit((s) => s.cmdkOpen);
  const setOpen = useCockpit((s) => s.setCmdkOpen);
  const sessions = useCockpit((s) => s.sessions);
  const order = useCockpit((s) => s.order);
  const resolvedTheme = useCockpit((s) => s.resolvedTheme);
  const setTweaks = useCockpit((s) => s.setTweaks);
  const router = useRouter();

  const sessionItems = useMemo(() =>
    order.map((id) => sessions[id]).filter((v): v is NonNullable<typeof v> => Boolean(v)),
    [order, sessions],
  );

  if (!open) return null;

  const run = (fn: () => void) => { fn(); setOpen(false); };
  const toggleTheme = () => setTweaks({ theme: resolvedTheme === "dark" ? "light" : "dark" });

  return (
    <div className="overlay" onClick={() => setOpen(false)} role="dialog" aria-label="Command palette">
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <Command label="Command Menu" loop>
          <Command.Input className="cmdk-input" placeholder="Search sessions, run a command…" autoFocus />
          <Command.List className="cmdk-list">
            <Command.Empty><div className="cmdk-empty">No matches</div></Command.Empty>

            {sessionItems.length > 0 && (
              <Command.Group heading="Sessions" className="cmdk-group">
                <div className="cmdk-group-label">Sessions</div>
                {sessionItems.map((s) => (
                  <Command.Item
                    key={s.id}
                    value={`session ${s.project} ${s.name} ${s.id}`}
                    className="cmdk-row"
                    onSelect={() => run(() => router.push(`/focus/${s.id}`))}
                  >
                    <span className="sdot" style={{ background: STATE_META[s.state].color }} />
                    <span className="name">{s.project} · {s.name}</span>
                    <span className="sub">{s.id}</span>
                    <span className="arrow">→ open</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Navigate" className="cmdk-group">
              <div className="cmdk-group-label">Navigate</div>
              <Command.Item className="cmdk-row" value="dashboard" onSelect={() => run(() => router.push("/"))}>
                <span className="ico">▦</span><span className="name">Dashboard</span><span className="arrow">→</span>
              </Command.Item>
              <Command.Item className="cmdk-row" value="new session" onSelect={() => run(() => router.push("/new"))}>
                <span className="ico">+</span><span className="name">New session</span><span className="sub">⌘N</span><span className="arrow">↵</span>
              </Command.Item>
              <Command.Item className="cmdk-row" value="mcp servers" onSelect={() => run(() => router.push("/mcp"))}>
                <span className="ico">◈</span><span className="name">MCP servers</span><span className="arrow">→</span>
              </Command.Item>
              <Command.Item className="cmdk-row" value="theme ab compare" onSelect={() => run(() => router.push("/theme-ab"))}>
                <span className="ico">◐</span><span className="name">Theme A/B</span><span className="arrow">→</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Theme" className="cmdk-group">
              <div className="cmdk-group-label">Theme</div>
              <Command.Item className="cmdk-row" value="toggle dark light theme" onSelect={() => run(toggleTheme)}>
                <span className="ico">◐</span><span className="name">Toggle dark / light</span><span className="sub">⌘⇧L</span><span className="arrow">↵</span>
              </Command.Item>
              <Command.Item className="cmdk-row" value="density compact" onSelect={() => run(() => setTweaks({ density: "compact" }))}>
                <span className="ico">—</span><span className="name">Density: compact</span><span className="arrow">↵</span>
              </Command.Item>
              <Command.Item className="cmdk-row" value="density cozy" onSelect={() => run(() => setTweaks({ density: "cozy" }))}>
                <span className="ico">≡</span><span className="name">Density: cozy</span><span className="arrow">↵</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="cmdk-foot">
            <span><span className="kbd">↑↓</span>navigate</span>
            <span><span className="kbd">↵</span>run</span>
            <span><span className="kbd">esc</span>close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
