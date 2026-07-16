import type Phaser from "phaser";
import { AGENT_PERSONAS, AGENT_SHEET, quipFor, quipStyle, spriteForProvider, type AgentSprite } from "./agents";
import { findPath } from "./pathfind";
import { codexSlouchTween, PersonaFxController } from "./persona-fx";
import { STATE_TINT, TILE, type CharMode, type Dir, type SessionLite, type Spot } from "./types";

const WALK_SPEED = 56;
const FRAME: Record<Dir, number> = { down: 0, up: 7, right: 14, left: 14 };

export type OfficeTheme = "dark" | "light";

/** Resolved theme from <html data-theme>; the attribute always carries "dark" | "light". */
export function resolveTheme(): OfficeTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
    ? "light" : "dark";
}

/** Every theme-dependent color in the office world, in one place. */
export function themeColors(theme: OfficeTheme) {
  const dark = theme === "dark";
  return {
    tagColor: dark ? "#EDE9E0" : "#2B2926",
    tagBg: dark ? "rgba(31,30,28,0.78)" : "rgba(245,242,236,0.82)",
    shadowAlpha: dark ? 0.35 : 0.18,
    zoneLabelBg: dark ? "rgba(20,18,16,0.55)" : "rgba(245,242,236,0.65)",
  } as const;
}

export class Character {
  readonly id: string;
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly tag: Phaser.GameObjects.Text;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private theme: OfficeTheme;
  private dot!: Phaser.GameObjects.Arc;
  private aura!: Phaser.GameObjects.Ellipse;
  private readonly spriteKey: string;
  private readonly scene: Phaser.Scene;
  private readonly blocked: () => ReadonlySet<string>;
  private readonly mini: boolean;
  private readonly personaFx: PersonaFxController;

  mode: CharMode = "stand";
  col: number;
  row: number;
  session: SessionLite;
  private dir: Dir = "down";
  private path: Array<{ col: number; row: number }> = [];
  private moveProgress = 0;
  private from: { x: number; y: number } | null = null;
  private onArrive: (() => void) | null = null;
  private hovered = false;
  private bubbleTween: Phaser.Tweens.Tween | null = null;
  private swayTween: Phaser.Tweens.Tween | null = null;
  private codexSlouch: Phaser.Tweens.Tween | null = null;
  private halo: Phaser.GameObjects.Ellipse | null = null;
  private haloTween: Phaser.Tweens.Tween | null = null;
  private quip: Phaser.GameObjects.Text | null = null;
  private quipTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    session: SessionLite,
    spawn: Spot,
    blocked: () => ReadonlySet<string>,
    mini = false,
  ) {
    this.scene = scene;
    this.id = session.id;
    this.session = session;
    this.mini = mini;
    const agent = spriteForProvider(session.provider);
    const sheetMeta = AGENT_SHEET[agent];
    this.spriteKey = `agent_${agent}`;
    this.blocked = blocked;
    this.col = spawn.col;
    this.row = spawn.row;
    this.personaFx = new PersonaFxController(scene, agent, this.container = scene.add.container(0, 0));

    this.sprite = scene.add.sprite(0, 0, this.spriteKey, FRAME.down + 1)
      .setOrigin(0.5, 1).setScale(mini ? sheetMeta.displayScale * 0.58 : sheetMeta.displayScale);
    this.theme = resolveTheme();
    const colors = themeColors(this.theme);
    const tagY = Math.round(-sheetMeta.frameHeight * sheetMeta.displayScale - 10);
    this.tag = scene.add.text(0, tagY, displayName(session), {
      fontFamily: "monospace", fontSize: "6.5px",
      color: colors.tagColor,
      backgroundColor: colors.tagBg,
      padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1).setResolution(4);
    // State is shown via the aura + label; the on-body dot read as an ugly grey
    // spot on the sprite, so it stays hidden.
    this.dot = scene.add.circle(0, -18, 2, 0x8a857c, 1).setVisible(false);
    this.aura = scene.add.ellipse(0, -1, 18, 8, 0x8a857c, 0).setVisible(false);
    this.halo = scene.add.ellipse(0, -2, 22, 10, 0xd97757, 0.0).setVisible(false);
    this.container.setPosition(spawn.col * TILE + TILE / 2, spawn.row * TILE + TILE);
    this.shadow = scene.add.ellipse(0, -1, 14, 5, 0x000000, colors.shadowAlpha);
    this.container.add([this.halo, this.shadow, this.aura, this.sprite, this.dot, this.tag]);
    if (mini) this.container.setScale(0.7);
    this.container.setAlpha(0);
    scene.tweens.add({ targets: this.container, alpha: 1, duration: 350 });
    this.face(spawn.face);
  }

  /** Re-tint every theme-dependent piece (name tag, shadow, quip) in place. */
  applyTheme(theme: OfficeTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    const colors = themeColors(theme);
    this.tag.setColor(colors.tagColor).setBackgroundColor(colors.tagBg);
    this.shadow.setFillStyle(0x000000, colors.shadowAlpha);
    if (this.quip) {
      const style = quipStyle(spriteForProvider(this.session.provider), theme === "dark");
      this.quip.setColor(style.color)
        .setBackgroundColor(style.backgroundColor)
        .setFontStyle(style.fontStyle ?? "normal");
    }
  }

  goTo(spot: Spot, mode: CharMode): void {
    const path = findPath(this.col, this.row, spot.col, spot.row, this.blocked());
    this.clearEffects();
    if (!path || path.length === 0) {
      this.col = spot.col; this.row = spot.row;
      this.container.setPosition(spot.col * TILE + TILE / 2, spot.row * TILE + TILE);
      this.arrive(mode, spot.face);
      return;
    }
    this.path = path;
    this.moveProgress = 0;
    this.from = { x: this.container.x, y: this.container.y };
    this.mode = "walk";
    this.onArrive = () => this.arrive(mode, spot.face);
  }

  setMode(mode: CharMode, face?: Dir): void {
    this.clearEffects();
    this.arrive(mode, face ?? this.dir);
  }

  private arrive(mode: CharMode, face: Dir): void {
    this.mode = mode;
    this.face(face);
    const sk = this.spriteKey;
    this.applyIndicator();
    this.refreshQuip();
    switch (mode) {
      case "sit_type": this.sprite.play(`${sk}-type-${this.animDir()}`); break;
      case "sit_read": case "lounge": case "spectate": this.sprite.play(`${sk}-read-${this.animDir()}`); break;
      case "use_tool": this.sprite.play(`${sk}-read-${this.animDir()}`); break;
      case "alert":
        this.sprite.stop();
        this.sprite.setFrame(FRAME[this.animDir()] + 1);
        break;
      case "dizzy":
        this.sprite.setAngle(-6);
        this.sprite.stop();
        this.sprite.setFrame(FRAME[this.animDir()] + 1);
        this.swayTween = this.scene.tweens.add({
          targets: this.sprite, angle: { from: -8, to: -3 },
          duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut",
        });
        break;
      case "celebrate":
        this.sprite.stop();
        this.sprite.setFrame(FRAME[this.animDir()] + 1);
        this.scene.tweens.add({
          targets: this.sprite, y: -5, duration: 170, yoyo: true, repeat: 3, ease: "Quad.out",
          onComplete: () => { this.sprite.y = 0; },
        });
        break;
      default:
        this.sprite.stop();
        this.sprite.setFrame(FRAME[this.animDir()] + 1);
    }
    if (!this.mini) this.applyPersona(mode);
  }

  private applyPersona(mode: CharMode): void {
    this.codexSlouch?.remove();
    this.codexSlouch = null;
    this.personaFx.apply(mode, this.session.state);
    if (spriteForProvider(this.session.provider) === "codex" && mode === "spectate") {
      this.codexSlouch = codexSlouchTween(this.scene, this.sprite, true);
    }
  }

  private applyIndicator(): void {
    const state = this.session.state;
    const tint = STATE_TINT[state] ?? 0x8a857c;
    this.bubbleTween?.remove();
    this.bubbleTween = null;
    this.dot.setFillStyle(tint, 1).setAlpha(1);
    this.aura.setFillStyle(tint, 0.16).setVisible(state !== "idle");
    if (state === "approval") {
      this.bubbleTween = this.scene.tweens.add({
        targets: [this.dot, this.aura], alpha: { from: 1, to: 0.3 },
        duration: 850, yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
    } else if (state === "done") {
      this.aura.setAlpha(0.5);
      this.scene.tweens.add({ targets: this.aura, alpha: 0.14, duration: 1200, ease: "Quad.out" });
    }
  }

  update(dtMs: number): void {
    if (!this.mini) this.personaFx.tick(dtMs, this.mode, this.session.state);
    if (this.mode !== "walk") return;
    const step = this.path[0];
    if (!step || !this.from) { this.onArrive?.(); return; }
    this.moveProgress += (WALK_SPEED * dtMs) / 1000 / TILE;
    const tx = step.col * TILE + TILE / 2;
    const ty = step.row * TILE + TILE;
    this.face(dirBetween(this.from.x, this.from.y, tx, ty));
    if (this.sprite.anims.currentAnim?.key !== `${this.spriteKey}-walk-${this.animDir()}`) {
      this.sprite.play(`${this.spriteKey}-walk-${this.animDir()}`);
    }
    const t = Math.min(1, this.moveProgress);
    this.container.setPosition(this.from.x + (tx - this.from.x) * t, this.from.y + (ty - this.from.y) * t);
    if (t >= 1) {
      this.col = step.col; this.row = step.row;
      this.path.shift();
      this.moveProgress = 0;
      this.from = { x: tx, y: ty };
      if (this.path.length === 0) {
        const done = this.onArrive;
        this.onArrive = null;
        done?.();
      }
    }
    this.container.setDepth(this.container.y);
  }

  setLabelVisible(visible: boolean): void { this.tag.setVisible(visible || this.hovered); }
  setHovered(h: boolean): void { this.hovered = h; if (h) this.tag.setVisible(true); }
  setTagOffset(extra: number): void {
    const agent: AgentSprite = spriteForProvider(this.session.provider);
    const meta = AGENT_SHEET[agent];
    const base = Math.round(-meta.frameHeight * meta.displayScale - 10);
    this.tag.setY(base - extra);
    if (this.quip) this.quip.setY(base - 16 - extra);
  }

  setPromptVisible(show: boolean): void {
    const prompt = this.session.prompt?.trim();
    const name = displayName(this.session);
    this.tag.setText(show && prompt ? `${name}\n${truncate(prompt, 34)}` : name);
  }

  setQuipVisible(show: boolean): void {
    if (!show) { this.quip?.setVisible(false); return; }
    this.refreshQuip();
    this.quip?.setVisible(true);
  }

  private refreshQuip(): void {
    const agent = spriteForProvider(this.session.provider);
    const line = quipFor(agent, this.session.state, this.session.id);
    if (!line) { this.quip?.setVisible(false); return; }
    const style = quipStyle(agent, this.theme === "dark");
    if (!this.quip) {
      this.quip = this.scene.add.text(0, -42, line, {
        fontFamily: "monospace", fontSize: "5.5px",
        color: style.color, backgroundColor: style.backgroundColor,
        fontStyle: style.fontStyle ?? "normal",
        padding: { x: 3, y: 2 }, align: "center", wordWrap: { width: 72 },
      }).setOrigin(0.5, 1).setResolution(4);
      this.container.add(this.quip);
      this.quipTween = this.scene.tweens.add({
        targets: this.quip, alpha: { from: 0.55, to: 1 },
        duration: 1400, yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
    } else {
      this.quip.setText(line).setColor(style.color)
        .setBackgroundColor(style.backgroundColor)
        .setFontStyle(style.fontStyle ?? "normal");
    }
  }

  setSelected(on: boolean): void {
    if (!this.halo) return;
    this.haloTween?.remove();
    this.haloTween = null;
    if (on) {
      this.halo.setVisible(true).setFillStyle(0xd97757, 0.4);
      this.haloTween = this.scene.tweens.add({
        targets: this.halo, fillAlpha: { from: 0.42, to: 0.18 },
        scaleX: { from: 1, to: 1.25 }, scaleY: { from: 1, to: 1.25 },
        duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
    } else {
      this.halo.setVisible(false);
    }
  }

  setDimmed(dim: boolean): void {
    this.scene.tweens.add({ targets: this.container, alpha: dim ? 0.45 : 1, duration: 200 });
  }

  fadeOutAndDestroy(onDone: () => void): void {
    this.clearEffects();
    this.scene.tweens.add({
      targets: this.container, alpha: 0, duration: 300,
      onComplete: () => { this.container.destroy(); onDone(); },
    });
  }

  private clearEffects(): void {
    this.bubbleTween?.remove(); this.bubbleTween = null;
    this.quipTween?.remove(); this.quipTween = null;
    this.swayTween?.remove(); this.swayTween = null;
    this.codexSlouch?.remove(); this.codexSlouch = null;
    this.sprite.setAngle(0).setY(0);
    this.dot.setAlpha(1);
    this.aura.setAlpha(0.16);
    if (!this.mini) this.personaFx.clear();
  }

  private face(dir: Dir): void {
    this.dir = dir;
    this.sprite.setFlipX(dir === "left");
  }

  private animDir(): "down" | "up" | "right" {
    return this.dir === "left" ? "right" : this.dir;
  }
}

function dirBetween(x0: number, y0: number, x1: number, y1: number): Dir {
  if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) return x1 > x0 ? "right" : "left";
  return y1 > y0 ? "down" : "up";
}

function displayName(s: SessionLite): string {
  const persona = AGENT_PERSONAS[spriteForProvider(s.provider)];
  return `${persona.label} · ${truncate(s.project || s.name || s.id, 12)}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}