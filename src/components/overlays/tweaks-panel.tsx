"use client";

import { useEffect, useState } from "react";
import { useCockpit, type Tweaks } from "@/lib/client/store";
import { ACCENT_PRESETS, MONO_FONT_OPTIONS, UI_FONT_OPTIONS, normalizeHexColor } from "@/lib/client/theme-settings";

export function TweaksPanel() {
  const open = useCockpit((s) => s.tweaksOpen);
  const setOpen = useCockpit((s) => s.setTweaksOpen);
  const tweaks = useCockpit((s) => s.tweaks);
  // Concrete value so one segment stays highlighted when the preference is
  // "system" (only the settings page exposes the 3-way choice).
  const resolvedTheme = useCockpit((s) => s.resolvedTheme);
  const setTweaks = useCockpit((s) => s.setTweaks);
  const accentValue = normalizeHexColor(tweaks.accent) ?? "#d97757";
  const [accentDraft, setAccentDraft] = useState(accentValue);

  useEffect(() => {
    setAccentDraft(accentValue);
  }, [accentValue]);

  if (!open) return null;

  const set = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => setTweaks({ [k]: v } as Partial<Tweaks>);
  const commitAccent = (value: string) => {
    const next = normalizeHexColor(value);
    if (next) set("accent", next);
  };

  return (
    <div className="tweaks-panel" role="dialog" aria-label="Tweaks">
      <div className="tw-head">
        <div>
          <h4>Tweaks</h4>
          <span>Visual system</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close tweaks">x</button>
      </div>

      <section className="tw-section">
        <div className="tw-section-title">Appearance</div>
        <div className="tw-row">
          <div className="lbl">Theme</div>
          <div className="seg">
            {(["dark", "light"] as const).map((v) => (
              <button key={v} className={resolvedTheme === v ? "on" : ""} onClick={() => set("theme", v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="tw-row">
          <div className="lbl">Density</div>
          <div className="seg">
            {(["compact", "default", "cozy"] as const).map((v) => (
              <button key={v} className={tweaks.density === v ? "on" : ""} onClick={() => set("density", v)}>{v}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="tw-section">
        <div className="tw-section-title">Fonts</div>
        <div className="tw-row">
          <div className="lbl">Interface</div>
          <div className="font-list">
            {UI_FONT_OPTIONS.map((font) => (
              <button
                key={font.key}
                className={tweaks.uiFont === font.key ? "font-option on" : "font-option"}
                onClick={() => set("uiFont", font.key)}
                style={{ fontFamily: font.stack }}
              >
                <span className="font-name">{font.label}</span>
                <span className="font-sample">{font.sample}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tw-row">
          <div className="lbl">Terminal</div>
          <div className="font-list mono-font-list">
            {MONO_FONT_OPTIONS.map((font) => (
              <button
                key={font.key}
                className={tweaks.monoFont === font.key ? "font-option on" : "font-option"}
                onClick={() => set("monoFont", font.key)}
                style={{ fontFamily: font.stack }}
              >
                <span className="font-name">{font.label}</span>
                <span className="font-sample">{font.sample}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="tw-section">
        <div className="tw-section-title">Accent</div>
        <div className="accent-editor">
          <label className="color-pick" aria-label="Custom accent">
            <span className="color-pick-swatch" style={{ background: accentValue }} />
            <input type="color" value={accentValue} onChange={(event) => commitAccent(event.target.value)} />
          </label>
          <input
            className="hex-input"
            value={accentDraft}
            spellCheck={false}
            maxLength={7}
            onBlur={() => setAccentDraft(accentValue)}
            onChange={(event) => {
              const next = event.target.value;
              setAccentDraft(next);
              commitAccent(next);
            }}
            aria-label="Accent hex"
          />
        </div>
        <div className="accents">
          {ACCENT_PRESETS.map((accent) => (
            <button
              key={accent.key}
              className={accentValue === accent.key ? "on" : ""}
              style={{ background: accent.key }}
              onClick={() => commitAccent(accent.key)}
              title={accent.label}
              aria-label={accent.label}
            />
          ))}
        </div>
      </section>

      <section className="tw-section last">
        <div className="tw-section-title">Layout</div>
        <div className="tw-row">
          <div className="lbl">Grid columns</div>
          <div className="seg">
            {([2, 3, 4] as const).map((v) => (
              <button key={v} className={tweaks.cols === v ? "on" : ""} onClick={() => set("cols", v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="tw-row">
          <div className="lbl">Tile variant</div>
          <div className="seg">
            {(["card", "strip"] as const).map((v) => (
              <button key={v} className={tweaks.tileVariant === v ? "on" : ""} onClick={() => set("tileVariant", v)}>{v}</button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
