import type Phaser from "phaser";
import type { SessionState } from "@/lib/shared/types";
import type { AgentSprite } from "./agents";
import type { CharMode } from "./types";

// Per-provider overlay effects: smoke, sword slash, glasses glint, sweat, etc.
// Lives beside the sprite inside the character container; cleared on walk/state change.

interface FxHandles {
  objects: Phaser.GameObjects.GameObject[];
  tweens: Phaser.Tweens.Tween[];
  timers: Phaser.Time.TimerEvent[];
}

export class PersonaFxController {
  private readonly handles: FxHandles = { objects: [], tweens: [], timers: [] };
  private smokeAcc = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprite: AgentSprite,
    private readonly container: Phaser.GameObjects.Container,
  ) {}

  apply(mode: CharMode, state: SessionState): void {
    this.clear();
    switch (this.sprite) {
      case "grok": this.applyGrok(mode, state); break;
      case "claude": this.applyClaude(mode, state); break;
      case "codex": this.applyCodex(mode, state); break;
    }
  }

  tick(_dtMs: number, _mode: CharMode, _state: SessionState): void {
    /* Grok/Ani: ambient handled in applyGrok */
  }

  clear(): void {
    for (const t of this.handles.timers) t.remove();
    for (const tw of this.handles.tweens) tw.remove();
    for (const o of this.handles.objects) o.destroy();
    this.handles.timers = [];
    this.handles.tweens = [];
    this.handles.objects = [];
    this.smokeAcc = 0;
  }

  // ── Grok/Ani: violet aura + heart glint on the HD sprite ─────────────────
  private applyGrok(mode: CharMode, state: SessionState): void {
    const aura = this.scene.add.ellipse(0, -4, 28, 12, 0x9b7cff, 0.1);
    this.track(aura);
    this.container.addAt(aura, 0);
    this.tween(aura, { fillAlpha: { from: 0.06, to: 0.22 }, scaleX: 1.12, scaleY: 1.12 },
      1_400, -1, true);

    if (mode === "sit_type" || state === "running") {
      const heart = this.scene.add.circle(2, -22, 1.5, 0xc84868, 0.9);
      this.track(heart);
      this.container.add(heart);
      this.tween(heart, { alpha: { from: 0.4, to: 1 } }, 900, -1, true);
    }
    if (state === "approval") {
      const mark = this.scene.add.text(8, -48, "!", {
        fontFamily: "monospace", fontSize: "8px", color: "#9B7CFF",
      }).setOrigin(0.5).setResolution(4);
      this.track(mark);
      this.container.add(mark);
      this.tween(mark, { y: -52, alpha: { from: 1, to: 0.4 } }, 700, -1, true);
    }
  }

  // ── Claude: glasses glint while typing ───────────────────────────────────
  private applyClaude(mode: CharMode, state: SessionState): void {
    if (mode !== "sit_type" && state !== "running") return;
    const glint = this.scene.add.rectangle(3, -27, 3, 1, 0xede9e0, 0.9);
    this.track(glint);
    this.container.add(glint);
    const flash = () => {
      glint.setAlpha(0);
      this.tween(glint, { alpha: 0.95, scaleX: 2 }, 80, 0, false, () => {
        this.tween(glint, { alpha: 0 }, 220, 0, false);
      });
    };
    flash();
    const timer = this.scene.time.addEvent({ delay: 2_800, loop: true, callback: flash });
    this.handles.timers.push(timer);
  }

  // ── Codex/Copilot: slouch + defeat smoke + sweat on error ────────────────
  private applyCodex(mode: CharMode, state: SessionState): void {
    if (mode === "spectate" || (state === "idle" && mode !== "sit_type")) {
      const timer = this.scene.time.addEvent({
        delay: 3_500, loop: true,
        callback: () => this.puffSmoke(8, -18, 0x10a37f, 0.25),
      });
      this.handles.timers.push(timer);
      const sigh = this.scene.add.text(-10, -38, "…", {
        fontFamily: "monospace", fontSize: "7px", color: "#8A857C",
      }).setOrigin(0.5).setResolution(4);
      this.track(sigh);
      this.container.add(sigh);
      this.tween(sigh, { alpha: { from: 0.2, to: 0.9 }, y: -42 }, 1_400, -1, true);
    }
    if (state === "error" || mode === "dizzy") {
      const drop = this.scene.add.circle(5, -28, 2, 0x4796e3, 0.85);
      this.track(drop);
      this.container.add(drop);
      this.tween(drop, { y: -18, alpha: 0 }, 900, -1);
    }
    if (state === "running") {
      const timer = this.scene.time.addEvent({
        delay: 4_200, loop: true,
        callback: () => this.puffSmoke(-6, -20, 0x8a857c, 0.2),
      });
      this.handles.timers.push(timer);
    }
  }

  private puffSmoke(x: number, y: number, color: number, alpha: number): void {
    const puff = this.scene.add.circle(x, y, 2, color, alpha);
    this.track(puff);
    this.container.add(puff);
    this.tween(puff, { y: y - 10, x: x + 2, scale: 1.8, alpha: 0 }, 1_400, 0, false, () => {
      const idx = this.handles.objects.indexOf(puff);
      if (idx >= 0) this.handles.objects.splice(idx, 1);
      puff.destroy();
    });
  }

  private track(obj: Phaser.GameObjects.GameObject): void {
    this.handles.objects.push(obj);
  }

  private tween(
    targets: object,
    props: Record<string, unknown>,
    duration: number,
    repeat = 0,
    yoyo = false,
    onComplete?: () => void,
  ): void {
    const tw = this.scene.tweens.add({
      targets, duration, repeat, yoyo, ease: "Sine.inOut",
      ...props,
      onComplete,
    });
    this.handles.tweens.push(tw);
  }
}

/** Codex slouches while spectating — applied to the sprite, not an overlay. */
export function codexSlouchTween(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  on: boolean,
): Phaser.Tweens.Tween | null {
  if (!on) {
    sprite.setAngle(0).setY(0);
    return null;
  }
  return scene.tweens.add({
    targets: sprite, angle: 4, y: 2,
    duration: 800, yoyo: true, repeat: -1, ease: "Sine.inOut",
  });
}