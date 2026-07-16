import type { ProviderId } from "@/lib/shared/types";
import type { SessionState } from "@/lib/shared/types";

export type AgentSprite = "grok" | "claude" | "codex";

export interface AgentSheetMeta {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly displayScale: number;
}

/** Grok/Anni native 128×256; displayScale = legacy 32×1.35 / 256 ≈ same footprint as 16×32 agents. */
export const AGENT_SHEET: Record<AgentSprite, AgentSheetMeta> = {
  // Anni: 512px HD master kept as agent_grok_hd.png; in-game sheet downsampled
  // (LANCZOS) to 44×88 so she renders crisp at the other agents' footprint.
  grok: { frameWidth: 44, frameHeight: 88, displayScale: 0.5 },
  // Claude = Clawd blob, baked square (48×48, blob bottom-anchored with top margin)
  // by scripts/gen-clawd-sprite.py so it always displays clean, never cut by desks.
  claude: { frameWidth: 48, frameHeight: 48, displayScale: 0.7 },
  codex: { frameWidth: 16, frameHeight: 32, displayScale: 1.35 },
};

export interface AgentPersona {
  readonly sprite: AgentSprite;
  readonly label: string;
  readonly tagline: string;
}

export const AGENT_PERSONAS: Record<AgentSprite, AgentPersona> = {
  grok: {
    sprite: "grok",
    label: "Grok",
    tagline: "Anni — gothique élancée, regard dominateur",
  },
  claude: {
    sprite: "claude",
    label: "Claude",
    tagline: "nerd classe, lunettes, cravate serrée",
  },
  codex: {
    sprite: "codex",
    label: "Copilot",
    tagline: "regarde les IA chinoises le fumer",
  },
};

// opencode has no dedicated sprite yet, so spriteForProvider falls it back to the
// claude persona below; keep this Partial rather than forcing a placeholder.
const PROVIDER_SPRITE: Partial<Record<ProviderId, AgentSprite>> = {
  grok: "grok",
  claude: "claude",
  codex: "codex",
};

export function spriteForProvider(provider: ProviderId): AgentSprite {
  return PROVIDER_SPRITE[provider] ?? "claude";
}

// Flavor lines keyed by sprite + state. Codex is self-deprecating.
const QUIPS: Record<AgentSprite, Partial<Record<SessionState, readonly string[]>>> = {
  grok: {
    running: ["…le code murmure sous la lune.", "encore une nuit, encore un refactor."],
    tool_use: ["j'ouvre les archives interdites.", "grep dans les ténèbres…"],
    idle: ["*fume et fixe le vide*", "*fixe le vide avec mélancolie*", "le café est froid. parfait."],
    approval: ["…tu oses m'interrompre ?", "j'attends ton consentement, mortel."],
    error: ["même les ombres ont des segfaults.", "…c'était prévu dans la prophétie."],
    done: ["terminé. retourne dans le néant.", "une victoire silencieuse."],
  },
  claude: {
    running: ["focus mode: activé.", "un test de plus, puis un autre."],
    tool_use: ["consultation méthodique en cours.", "je vérifie deux fois."],
    idle: ["*relit la doc Anthropic*", "pause café ? non, pas encore."],
    approval: ["permission requise — procédure standard.", "j'attends ta validation."],
    error: ["intéressant. je note l'erreur.", "hm. cas limite détecté."],
    done: ["livré. proprement.", "mission accomplie, comme prévu."],
  },
  codex: {
    running: ["ok ok je code…", "j'essaie de suivre le rythme."],
    tool_use: ["euh… je regarde comment ils font.", "copier-coller intelligent ?"],
    idle: [
      "DeepSeek est en train de me fumer…",
      "Qwen vient de sortir un truc de ouf.",
      "pourquoi Kimi est plus rapide que moi ?",
      "*regarde les posters en soupirant*",
      "encore un benchmark où je suis dernier…",
    ],
    approval: ["…ils auraient pas demandé ça.", "j'ai besoin d'un OK chef."],
    error: ["encore raté. classique.", "bon bah eux ils auraient réussi."],
    done: ["enfin. pas mal… pour moi.", "terminé ! (les Chinois l'auraient fait en 2min)"],
  },
};

export function quipFor(sprite: AgentSprite, state: SessionState, seed: string): string | null {
  const lines = QUIPS[sprite][state];
  if (!lines?.length) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = ((h << 5) - h + seed.charCodeAt(i)) >>> 0;
  return lines[h % lines.length] ?? null;
}

export interface QuipStyle {
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontStyle?: string;
}

export function quipStyle(sprite: AgentSprite, dark: boolean): QuipStyle {
  switch (sprite) {
    case "grok":
      return {
        color: dark ? "#C4B0FF" : "#4A2868",
        backgroundColor: dark ? "rgba(26,16,32,0.82)" : "rgba(232,223,240,0.92)",
        fontStyle: "italic",
      };
    case "codex":
      return {
        color: dark ? "#8AC4A8" : "#2A5840",
        backgroundColor: dark ? "rgba(18,28,24,0.82)" : "rgba(216,240,228,0.92)",
      };
    default:
      return {
        color: dark ? "#C4BDB2" : "#5A554E",
        backgroundColor: dark ? "rgba(20,18,16,0.72)" : "rgba(250,247,242,0.88)",
      };
  }
}