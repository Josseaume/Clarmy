import type { ProviderId } from "@/lib/shared/types";
import { TILE, key, type Desk, type Spot } from "./types";

// AI Headquarters: FOUR self-contained provider bases, one per quadrant, split
// by central aisles. No shared desks — each provider spawns, works and idles
// only inside its own base, so nobody encroaches on another's territory.
// Grok = gothic (NW), Claude = library (NE), OpenCode = grand salon (SW),
// Codex/Copilot = spectator lounge (SE).

export const COLS = 40;
export const ROWS = 24;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

export interface Decor {
  readonly frame: string;
  readonly col: number;
  readonly row: number;
  readonly block?: boolean;
  readonly tall?: boolean;
  readonly floor?: boolean;
}

// A desk pod: 3 columns × 2 rows = 6 desks. Seat sits one tile below the PC.
function pod(cols: readonly number[], rows: readonly number[], start: number): Desk[] {
  const out: Desk[] = [];
  let id = start;
  for (const r of rows) for (const c of cols) {
    out.push({ id: id++, seat: { col: c, row: r + 1, face: "up" }, pcCol: c, pcRow: r });
  }
  return out;
}

// Only the four themed bases have desks. Providers without a base fall back to
// the shared DESKS pool + claude visuals at the call sites, so this stays
// Partial rather than inventing a fifth quadrant.
export const DESKS_BY_PROVIDER: Partial<Record<ProviderId, Desk[]>> = {
  grok: pod([4, 9, 14], [4, 7], 0),
  claude: pod([24, 29, 34], [4, 7], 100),
  opencode: pod([4, 9, 14], [15, 18], 200),
  codex: pod([24, 29, 34], [15, 18], 300),
};

export const DESKS: Desk[] = Object.values(DESKS_BY_PROVIDER).flat();

// Idle: stand facing the camera (down), at the front of the provider's base.
export const IDLE_SPOTS: Partial<Record<ProviderId, Spot[]>> = {
  grok: [{ col: 4, row: 10, face: "down" }, { col: 9, row: 10, face: "down" }, { col: 14, row: 10, face: "down" }],
  claude: [{ col: 24, row: 10, face: "down" }, { col: 29, row: 10, face: "down" }, { col: 34, row: 10, face: "down" }],
  opencode: [{ col: 4, row: 21, face: "down" }, { col: 9, row: 21, face: "down" }, { col: 14, row: 21, face: "down" }],
  codex: [{ col: 24, row: 21, face: "down" }, { col: 29, row: 21, face: "down" }, { col: 34, row: 21, face: "down" }],
};

// Each provider walks in from the aisle edge of its own base.
export const SPAWN_BY_PROVIDER: Partial<Record<ProviderId, Spot>> = {
  grok: { col: 9, row: 10, face: "down" },
  claude: { col: 29, row: 10, face: "down" },
  opencode: { col: 9, row: 13, face: "down" },
  codex: { col: 29, row: 13, face: "down" },
};

export interface ZoneLabel {
  readonly text: string;
  readonly col: number;
  readonly row: number;
  readonly color: string;
}

export const ZONE_LABELS: readonly ZoneLabel[] = [
  { text: "NÉCROPOLIS", col: 2, row: 1, color: "#9B7CFF" },
  { text: "BIBLIOTHÈQUE", col: 30, row: 1, color: "#D97757" },
  { text: "GRAND SALON", col: 2, row: 12, color: "#E8B339" },
  { text: "ZONE DÉGOUT", col: 30, row: 12, color: "#10A37F" },
];

// Themed decor on each base's back wall (row 2 for top bases, row 13 for bottom),
// kept off desk/seat/idle/spawn cells.
export const DECOR: Decor[] = [
  // ── Grok gothic base (NW) ──
  { frame: "GOTHIC_RUG", col: 8, row: 6, floor: true },
  { frame: "GOTHIC_RUG", col: 9, row: 6, floor: true },
  { frame: "GOTHIC_ALTAR", col: 2, row: 2, block: true, tall: true },
  { frame: "SKULL_CANDLE", col: 6, row: 2, block: true, tall: true },
  { frame: "SKULL_CANDLE", col: 11, row: 2, block: true, tall: true },
  { frame: "PLANT", col: 16, row: 2, block: true, tall: true },
  { frame: "SMALL_TABLE", col: 17, row: 5, block: true },

  // ── Claude library base (NE) ──
  { frame: "RUG_WOOD", col: 28, row: 6, floor: true },
  { frame: "RUG_WOOD", col: 29, row: 6, floor: true },
  { frame: "DOUBLE_BOOKSHELF", col: 22, row: 2, block: true, tall: true },
  { frame: "BOOKSHELF_FANCY", col: 26, row: 2, block: true, tall: true },
  { frame: "WHITEBOARD", col: 31, row: 2, block: true, tall: true },
  { frame: "CLOCK", col: 36, row: 2, block: true, tall: true },
  { frame: "LIBRARY_LAMP", col: 37, row: 5, block: true, tall: true },

  // ── OpenCode base (SW) — knight decor kept as neutral set dressing ──
  { frame: "STONE_FLOOR", col: 8, row: 16, floor: true },
  { frame: "STONE_FLOOR", col: 9, row: 16, floor: true },
  { frame: "KNIGHT_BANNER", col: 2, row: 13, block: true, tall: true },
  { frame: "ARMOR_STAND", col: 6, row: 13, block: true, tall: true },
  { frame: "KNIGHT_BANNER", col: 11, row: 13, block: true, tall: true },
  { frame: "CUSHIONED_BENCH", col: 16, row: 14, block: true },
  { frame: "COFFEE_TABLE", col: 17, row: 17, block: true },

  // ── Codex spectator lounge base (SE) ──
  { frame: "TV_SCREEN", col: 22, row: 13, block: true, tall: true },
  { frame: "POSTER_DEEPSEEK", col: 26, row: 13, block: true, tall: true },
  { frame: "POSTER_QWEN", col: 31, row: 13, block: true, tall: true },
  { frame: "POSTER_KIMI", col: 36, row: 13, block: true, tall: true },
  { frame: "SPECTATOR_CHAIR", col: 22, row: 16, block: true, tall: true },
  { frame: "POPCORN", col: 37, row: 17, block: true },
  { frame: "LARGE_PLANT", col: 37, row: 14, block: true, tall: true },
];

export function buildBlocked(): Set<string> {
  const blocked = new Set<string>();
  for (let c = 0; c < COLS; c += 1) { blocked.add(key(c, 0)); blocked.add(key(c, ROWS - 1)); }
  for (let r = 0; r < ROWS; r += 1) { blocked.add(key(0, r)); blocked.add(key(COLS - 1, r)); }
  for (const d of DECOR) if (d.block) blocked.add(key(d.col, d.row));
  for (const d of DESKS) blocked.add(key(d.pcCol, d.pcRow));
  return blocked;
}
