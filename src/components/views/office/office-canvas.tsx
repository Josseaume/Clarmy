"use client";

import { useEffect, useRef, useState } from "react";
import { useCockpit } from "@/lib/client/store";
import { loadPhaser } from "./phaser-boot";
import type { OfficeSceneInstance } from "./game/scene";
import type { SessionLite } from "./game/types";

type BootPhase = "loading" | "ready" | "error";

// Mounts the Phaser game and bridges the cockpit store into it. Phaser itself
// is fetched from /public/office/phaser.esm.min.js so webpack never compiles a
// multi-megabyte chunk on first visit.
export function OfficeCanvas({
  onSelect,
  selectedId,
  showPrompts,
  recenterKey,
}: {
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  showPrompts: boolean;
  recenterKey: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<OfficeSceneInstance | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<BootPhase>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || gameRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const [Phaser, { createOfficeScene }] = await Promise.all([
          loadPhaser(),
          import("./game/scene"),
        ]);
        if (cancelled) return;

        const OfficeScene = createOfficeScene(Phaser);
        const scene = new OfficeScene();
        const game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host,
          pixelArt: true,
          roundPixels: true,
          transparent: true,
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: "100%",
            height: "100%",
          },
          scene,
          banner: false,
        });
        gameRef.current = game;
        sceneRef.current = scene;
        (window as unknown as { __officeScene?: unknown }).__officeScene = scene;

        const push = () => {
          const { sessions } = useCockpit.getState();
          const list: SessionLite[] = Object.values(sessions).map((s) => ({
            id: s.id, provider: s.provider, state: s.state, name: s.name, project: s.project,
            prompt: s.prompt, subagents: s.subagents,
          }));
          scene.setSessions(list);
          (window as unknown as { __officeSessionIds?: string[] }).__officeSessionIds = list.map((x) => x.id);
        };
        game.events.once("office-ready", () => {
          if (!cancelled) setPhase("ready");
          push();
        });
        game.events.on("select", onSelect);
        const unsub = useCockpit.subscribe((st, prev) => {
          if (st.sessions !== prev.sessions) push();
        });

        const onVisibility = () => {
          if (document.hidden) game.loop.sleep();
          else game.loop.wake();
        };
        document.addEventListener("visibilitychange", onVisibility);

        const onResize = () => { game.scale.refresh(); };
        const ro = new ResizeObserver(onResize);
        ro.observe(host);

        teardownRef.current = () => {
          ro.disconnect();
          document.removeEventListener("visibilitychange", onVisibility);
          unsub();
          game.events.off("select", onSelect);
          game.destroy(true);
          gameRef.current = null;
          sceneRef.current = null;
        };
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "office boot failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      teardownRef.current?.();
      teardownRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sceneRef.current?.setShowPrompts(showPrompts); }, [showPrompts]);
  useEffect(() => { sceneRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => {
    (window as unknown as { __officeSelect?: (id: string | null) => void }).__officeSelect = onSelect;
    return () => { delete (window as unknown as { __officeSelect?: unknown }).__officeSelect; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (recenterKey > 0) sceneRef.current?.recenter(); }, [recenterKey]);

  if (phase === "error") {
    return (
      <div className="office-loading">
        <span className="office-loading-title">office failed to boot</span>
        <span className="office-loading-hint">{error ?? "unknown error"}</span>
      </div>
    );
  }

  return (
    <>
      {phase === "loading" && (
        <div className="office-loading">
          <span className="office-loading-title">booting the office…</span>
          <span className="office-loading-hint">loading Phaser + pixel assets</span>
        </div>
      )}
      <div ref={hostRef} className="office-canvas" style={phase === "loading" ? { visibility: "hidden" } : undefined} />
    </>
  );
}