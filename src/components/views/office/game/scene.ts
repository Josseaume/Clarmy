import type * as PhaserNamespace from "phaser";
import type { ProviderId } from "@/lib/shared/types";
import { AGENT_SHEET, type AgentSprite } from "./agents";
import {
  buildBlocked, DECOR, DESKS, DESKS_BY_PROVIDER, SPAWN_BY_PROVIDER, WORLD_H, WORLD_W, ZONE_LABELS,
} from "./layout";
import { Character, resolveTheme, themeColors, type OfficeTheme } from "./character";
import { applyState, hash } from "./behavior";
import { TILE, type Desk, type SessionLite } from "./types";

const AGENT_SPRITES: readonly AgentSprite[] = ["grok", "claude", "codex"];

/**
 * Pre-HD on-grid width (px at TILE=16) each décor frame must occupy: the
 * Josseaume/last-pull look. The working-tree atlas ships the same art at 2-16×
 * resolution for crisp pixels, with mixed ratios per frame, so a single scale
 * cannot fit them all. We scale each frame down to this width at render time,
 * reading its real frame size from the texture (aspect ratio is preserved).
 */
const DECOR_W: Record<string, number> = {
  DESK_FRONT: 48, DESK_SIDE: 16,
  PC_FRONT_OFF: 16, PC_FRONT_ON_1: 16, PC_FRONT_ON_2: 16, PC_FRONT_ON_3: 16,
  GOTHIC_RUG: 16, GOTHIC_ALTAR: 16, SKULL_CANDLE: 16, PLANT: 16, COFFEE: 16,
  SMALL_TABLE: 32, RUG_WOOD: 16, BOOKSHELF: 32, BOOKSHELF_FANCY: 16,
  DOUBLE_BOOKSHELF: 32, LIBRARY_LAMP: 16, WHITEBOARD: 32, CLOCK: 16, CACTUS: 16,
  STONE_FLOOR: 16, KNIGHT_BANNER: 16, ARMOR_STAND: 16, CUSHIONED_BENCH: 16,
  CUSHIONED_CHAIR_BACK: 16, CUSHIONED_CHAIR_FRONT: 16, WOODEN_CHAIR_FRONT: 16,
  COFFEE_TABLE: 32, SOFA_FRONT: 32, TV_SCREEN: 16, BIN: 16, POPCORN: 16,
  LARGE_PLANT: 32, SPECTATOR_CHAIR: 16,
  POSTER_DEEPSEEK: 16, POSTER_QWEN: 16, POSTER_KIMI: 16,
};

// The office scene. Sessions flow in one direction: the React bridge calls
// setSessions(); the scene converges characters toward that truth. Clicking a
// character emits "select" with the session id (React renders the inspector).
export function createOfficeScene(P: typeof import("phaser")) {
  class OfficeScene extends P.Scene {
  private chars = new Map<string, Character>();
  private minis = new Map<string, Character[]>();
  private deskOf = new Map<string, Desk>();
  private freeDesks: Partial<Record<ProviderId, Desk[]>> = {
    grok: [...(DESKS_BY_PROVIDER.grok ?? [])], claude: [...(DESKS_BY_PROVIDER.claude ?? [])],
    opencode: [...(DESKS_BY_PROVIDER.opencode ?? [])], codex: [...(DESKS_BY_PROVIDER.codex ?? [])],
  };
  private pcs = new Map<number, PhaserNamespace.GameObjects.Sprite>();
  private blocked = buildBlocked();
  private pending: SessionLite[] | null = null;
  private created = false;
  private showPrompts = false;
  private selectedId: string | null = null;
  private charClicked = false;
  private lastLabelPass = 0;
  private theme: OfficeTheme = resolveTheme();
  private bg: PhaserNamespace.GameObjects.Image | null = null;
  private zoneLabels: PhaserNamespace.GameObjects.Text[] = [];

  constructor() {
    super("office");
  }

  preload(): void {
    this.load.image("office-bg-dark", "/office/office-bg-dark.png");
    this.load.image("office-bg-light", "/office/office-bg-light.png");
    this.load.atlas("decor", "/office/atlas.png", "/office/atlas.json");
    for (const id of AGENT_SPRITES) {
      const sheet = AGENT_SHEET[id];
      this.load.spritesheet(`agent_${id}`, `/office/characters/agent_${id}.png`, {
        frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight,
      });
    }
  }

  create(): void {
    this.createAnims();
    this.drawRoom();
    this.drawZoneLabels();
    this.startAmbience();
    this.setupCamera();
    this.created = true;
    if (this.pending) { this.syncSessions(this.pending); this.pending = null; }
    this.game.events.emit("office-ready");
  }

  // ── public API (called from the React bridge) ──────────────────────────
  setSessions(sessions: SessionLite[]): void {
    // scene.isActive() is false while create() runs, so a hand-rolled flag
    // decides; pending holds the latest list until the world exists.
    if (!this.created) { this.pending = sessions; return; }
    this.syncSessions(sessions);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const [cid, ch] of this.chars) {
      ch.setSelected(cid === id);
      ch.setDimmed(id !== null && cid !== id);
    }
    for (const list of this.minis.values()) for (const m of list) m.setDimmed(id !== null);
    const target = id ? this.chars.get(id) : null;
    if (target) this.cameras.main.pan(target.container.x, target.container.y, 350, "Quad.easeOut");
  }

  setShowPrompts(show: boolean): void {
    this.showPrompts = show;
    for (const ch of this.chars.values()) ch.setPromptVisible(show);
  }

  /** Re-theme the world in place: background texture, zone labels, characters. */
  applyTheme(theme: OfficeTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (!this.created) return; // create() reads this.theme when it runs
    this.bg?.setTexture(`office-bg-${theme}`);
    const colors = themeColors(theme);
    for (const label of this.zoneLabels) label.setBackgroundColor(colors.zoneLabelBg);
    for (const ch of this.chars.values()) ch.applyTheme(theme);
    for (const list of this.minis.values()) for (const m of list) m.applyTheme(theme);
  }

  recenter(): void {
    const cam = this.cameras.main;
    cam.pan(WORLD_W / 2, WORLD_H / 2, 300, "Quad.easeOut");
  }

  update(time: number, delta: number): void {
    for (const ch of this.chars.values()) {
      ch.update(delta);
      ch.container.setDepth(ch.container.y);
    }
    for (const list of this.minis.values()) for (const m of list) {
      m.update(delta);
      m.container.setDepth(m.container.y);
    }
    if (time - this.lastLabelPass > 300) {
      this.lastLabelPass = time;
      this.layoutLabels();
    }
  }

  // Labels: hidden when zoomed out (state dot remains), and never overlapping;
  // close neighbours get stacked vertical offsets.
  private layoutLabels(): void {
    const visible = this.cameras.main.zoom >= 2.05;
    const list = [...this.chars.values()].sort((a, b) => a.container.x - b.container.x);
    for (let i = 0; i < list.length; i += 1) {
      const ch = list[i]!;
      ch.setLabelVisible(visible);
      ch.setQuipVisible(visible);
      let stack = 0;
      for (let j = 0; j < i; j += 1) {
        const other = list[j]!;
        if (Math.abs(other.container.x - ch.container.x) < 34
          && Math.abs(other.container.y - ch.container.y) < 30) stack += 1;
      }
      ch.setTagOffset(stack * 9);
    }
  }

  // ── sync ───────────────────────────────────────────────────────────────
  private syncSessions(sessions: SessionLite[]): void {
    const seen = new Set<string>();
    for (const s of sessions) {
      seen.add(s.id);
      const existing = this.chars.get(s.id);
      if (!existing) this.spawn(s);
      else {
        const prevState = existing.session.state;
        existing.session = s;
        existing.setPromptVisible(this.showPrompts);
        if (prevState !== s.state) this.applyBehavior(existing, s);
        this.syncMinis(existing, s);
      }
    }
    for (const [id, ch] of this.chars) {
      if (seen.has(id)) continue;
      this.despawn(id, ch);
    }
  }

  private spawn(s: SessionLite): void {
    const own = DESKS_BY_PROVIDER[s.provider] ?? DESKS;
    const desk = (this.freeDesks[s.provider] ?? []).shift() ?? own[hash(s.id) % own.length]!;
    this.deskOf.set(s.id, desk);
    const door = SPAWN_BY_PROVIDER[s.provider] ?? SPAWN_BY_PROVIDER.claude!;
    const ch = new Character(this, s, door, () => this.blocked);
    ch.sprite.setInteractive({ useHandCursor: true });
    ch.sprite.on("pointerdown", () => { this.charClicked = true; this.game.events.emit("select", s.id); });
    ch.sprite.on("pointerover", () => ch.setHovered(true));
    ch.sprite.on("pointerout", () => ch.setHovered(false));
    ch.setPromptVisible(this.showPrompts);
    this.chars.set(s.id, ch);
    if (this.selectedId !== null) ch.setDimmed(s.id !== this.selectedId);
    this.applyBehavior(ch, s);
    this.syncMinis(ch, s);
  }

  private despawn(id: string, ch: Character): void {
    this.chars.delete(id);
    const desk = this.deskOf.get(id);
    if (desk) { (this.freeDesks[ch.session.provider] ?? []).unshift(desk); this.deskOf.delete(id); this.setPc(desk, false); }
    for (const m of this.minis.get(id) ?? []) m.fadeOutAndDestroy(() => { /* gone */ });
    this.minis.delete(id);
    ch.fadeOutAndDestroy(() => { /* gone */ });
  }

  private applyBehavior(ch: Character, s: SessionLite): void {
    const desk = this.deskOf.get(s.id)!;
    this.setPc(desk, s.state === "running" || s.state === "tool_use");
    applyState(ch, s.state, desk, Math.random);
  }

  // Subagents used to render as a pile of mini characters next to the parent;
  // that stacked 3+ duplicate sprites on one desk and read as a mess, so it is
  // disabled — one clean sprite per session. (Re-enable by raising the cap.)
  private syncMinis(parent: Character, s: SessionLite): void {
    const want = 0;
    const list = this.minis.get(s.id) ?? [];
    while (list.length < want) {
      const desk = this.deskOf.get(s.id)!;
      const i = list.length;
      const spot = { col: desk.seat.col + (i === 0 ? -1 : 1), row: desk.seat.row + (i === 2 ? 1 : 0), face: "down" as const };
      const mini = new Character(this, { ...s, id: `${s.id}:sub${i}` }, spot, () => this.blocked, true);
      mini.setPromptVisible(false);
      mini.setMode("sit_read");
      list.push(mini);
    }
    while (list.length > want) list.pop()!.fadeOutAndDestroy(() => { /* gone */ });
    this.minis.set(s.id, list);
  }

  private setPc(desk: Desk, on: boolean): void {
    const pc = this.pcs.get(desk.id);
    if (!pc) return;
    if (on) pc.play("pc-on", true);
    else { pc.stop(); pc.setFrame("PC_FRONT_OFF"); }
  }

  // ── world building ─────────────────────────────────────────────────────
  private createAnims(): void {
    for (const id of AGENT_SPRITES) {
      const sheet = `agent_${id}`;
      for (const [dir, base] of [["down", 0], ["up", 7], ["right", 14]] as const) {
        this.anims.create({
          key: `${sheet}-walk-${dir}`,
          frames: [base, base + 1, base + 2, base + 1].map((f) => ({ key: sheet, frame: f })),
          frameRate: 7, repeat: -1,
        });
        this.anims.create({
          key: `${sheet}-type-${dir}`,
          frames: [base + 3, base + 4].map((f) => ({ key: sheet, frame: f })),
          frameRate: 3.3, repeat: -1,
        });
        this.anims.create({
          key: `${sheet}-read-${dir}`,
          frames: [base + 5, base + 6].map((f) => ({ key: sheet, frame: f })),
          frameRate: 1.6, repeat: -1,
        });
      }
    }
    this.anims.create({
      key: "pc-on",
      frames: ["PC_FRONT_ON_1", "PC_FRONT_ON_2", "PC_FRONT_ON_3"].map((f) => ({ key: "decor", frame: f })),
      frameRate: 2.5, repeat: -1,
    });
  }

  /** Scale that brings an HD atlas frame back to its pre-HD on-grid width. */
  private decorScale(frame: string): number {
    const target = DECOR_W[frame] ?? TILE;
    const real = this.textures.getFrame("decor", frame)?.width || target;
    return target / real;
  }

  private addDecor(x: number, y: number, frame: string, depth: number): PhaserNamespace.GameObjects.Image {
    return this.add.image(x, y, "decor", frame).setOrigin(0).setScale(this.decorScale(frame)).setDepth(depth);
  }

  private drawRoom(): void {
    this.bg = this.add.image(0, 0, `office-bg-${this.theme}`).setOrigin(0).setDepth(-12);
    for (const d of DECOR) {
      const y = d.floor ? d.row * TILE : (d.tall ? d.row * TILE - TILE : d.row * TILE);
      const depth = d.floor ? -9.5 : d.row * TILE + TILE - 0.1;
      this.addDecor(d.col * TILE, y, d.frame, depth);
    }
    for (const desk of DESKS) {
      this.addDecor(desk.pcCol * TILE, desk.pcRow * TILE, "DESK_FRONT", desk.pcRow * TILE + TILE - 0.2);
      const pc = this.add.sprite(desk.pcCol * TILE, desk.pcRow * TILE - TILE, "decor", "PC_FRONT_OFF")
        .setOrigin(0).setScale(this.decorScale("PC_FRONT_OFF")).setDepth(desk.pcRow * TILE + TILE - 0.1);
      this.pcs.set(desk.id, pc);
      this.addDecor(desk.seat.col * TILE, desk.seat.row * TILE, "CUSHIONED_CHAIR_BACK", desk.seat.row * TILE + TILE - 0.2);
    }
  }

  private drawZoneLabels(): void {
    const colors = themeColors(this.theme);
    for (const z of ZONE_LABELS) {
      const label = this.add.text(z.col * TILE, z.row * TILE, z.text, {
        fontFamily: "monospace", fontSize: "5px", color: z.color,
        backgroundColor: colors.zoneLabelBg,
        padding: { x: 2, y: 1 },
      }).setOrigin(0).setResolution(4).setDepth(2).setAlpha(0.7);
      this.zoneLabels.push(label);
      this.tweens.add({ targets: label, alpha: { from: 0.45, to: 0.85 }, duration: 2_400, yoyo: true, repeat: -1 });
    }
  }

  private startAmbience(): void {
    const zones: Array<{ x: number; y: number; r: number; color: number; depth: number }> = [
      { x: 4 * TILE, y: 4 * TILE, r: 18, color: 0x9b7cff, depth: 3 },   // Nécropolis
      { x: 35 * TILE, y: 4 * TILE, r: 16, color: 0xd97757, depth: 3 },   // Bibliothèque
      { x: 4 * TILE, y: 19 * TILE, r: 14, color: 0xe8b339, depth: 3 },  // Grand Salon
      { x: 34 * TILE, y: 18 * TILE, r: 20, color: 0x10a37f, depth: 2 },  // Zone Dégout
    ];
    for (const z of zones) {
      const glow = this.add.circle(z.x, z.y, z.r, z.color, 0.1).setDepth(z.depth);
      this.tweens.add({
        targets: glow, alpha: { from: 0.04, to: 0.18 },
        scale: { from: 0.85, to: 1.25 }, duration: 2_000 + z.r * 40,
        yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
    }
    // TV flicker in the spectator lounge
    const tvFlicker = this.add.rectangle(31 * TILE + 8, 15 * TILE, 56, 28, 0x4796e3, 0.04).setDepth(2);
    this.tweens.add({ targets: tvFlicker, alpha: { from: 0.01, to: 0.1 }, duration: 1_400,
      yoyo: true, repeat: -1, ease: "Steps(3)" });
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(-TILE * 2, -TILE * 3, WORLD_W + TILE * 4, WORLD_H + TILE * 5);
    const fit = Math.min(cam.width / (WORLD_W + TILE * 2), cam.height / (WORLD_H + TILE * 4));
    // bias toward closeness: personas are 16×32 and labels show from zoom 2.05
    cam.setZoom(Math.max(2.4, Math.min(3.4, fit * 1.35)));
    cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    this.input.on("pointermove", (p: PhaserNamespace.Input.Pointer) => {
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    // click on empty space (no drag, no character) closes the terminal panel
    this.input.on("pointerup", (p: PhaserNamespace.Input.Pointer) => {
      const dragged = P.Math.Distance.Between(p.downX, p.downY, p.upX, p.upY) > 5;
      if (!dragged && !this.charClicked) this.game.events.emit("select", null);
      this.charClicked = false;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(P.Math.Clamp(cam.zoom - dy * 0.0015, 1.2, 5));
    });
  }
  }
  return OfficeScene;
}

export type OfficeSceneInstance = InstanceType<ReturnType<typeof createOfficeScene>>;
