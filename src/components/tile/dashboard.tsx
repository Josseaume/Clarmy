"use client";

import { useCockpit } from "@/lib/client/store";
import { providerMeta } from "@/lib/shared/providers";
import { Tile } from "./tile";

export function Dashboard() {
  const sessions = useCockpit((s) => s.sessions);
  const order = useCockpit((s) => s.order);
  const cols = useCockpit((s) => s.tweaks.cols);
  const visibleProviders = useCockpit((s) => s.visibleProviders);

  // Show every visible provider's sessions side by side (claude + codex + …).
  const list = order
    .map((id) => sessions[id])
    .filter((v): v is NonNullable<typeof v> => Boolean(v) && visibleProviders.includes(v!.provider));

  if (list.length === 0) {
    const labels = visibleProviders.map((p) => providerMeta(p).label).join(", ");
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", fontSize: 13 }}>
        No {labels} sessions yet. Click <strong style={{ color: "var(--fg)" }}>New session</strong> to spawn one.
      </div>
    );
  }

  return (
    <div className="grid" style={{ ["--cols" as string]: String(cols) }}>
      {list.map((s) => <Tile key={s.id} s={s} />)}
    </div>
  );
}
