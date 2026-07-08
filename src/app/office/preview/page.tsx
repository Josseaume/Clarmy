"use client";

import { useEffect, useRef, useState } from "react";

const SHEET = "/office/characters/agent_grok.png";
const FW = 64;
const FH = 128;
const COLS = 7;
const ZOOMS = [8, 12, 16, 20] as const;

/** Validation page — native pixel-art preview before in-game scale. */
export default function OfficeSpritePreviewPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(12);
  const [frame, setFrame] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = SHEET;
    img.onload = () => {
      const col = frame % COLS;
      const row = Math.floor(frame / COLS);
      const sw = FW;
      const sh = FH;
      const sx = col * FW;
      const sy = row * FH;
      canvas.width = sw * zoom;
      canvas.height = sh * zoom;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    };
  }, [frame, zoom]);

  return (
    <div className="office-preview">
      <header className="office-preview-head">
        <h1>Grok / Ani — validation pixel art</h1>
        <p>Frame {frame} · zoom ×{zoom} · source {FW}×{FH}px</p>
      </header>
      <div className="office-preview-stage">
        <canvas ref={canvasRef} className="office-preview-canvas" />
      </div>
      <div className="office-preview-controls">
        <label>
          Zoom
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value) as (typeof ZOOMS)[number])}>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>×{z}</option>
            ))}
          </select>
        </label>
        <label>
          Frame
          <input type="range" min={0} max={20} value={frame} onChange={(e) => setFrame(Number(e.target.value))} />
        </label>
        <a href="/office">← retour office</a>
      </div>
      <div className="office-preview-compare">
        <figure className="office-preview-ref">
          <figcaption>Référence Ani.png</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/office/ani-reference.png" alt="Ani reference" className="office-preview-ref-img" />
        </figure>
        <div className="office-preview-grid">
          {ZOOMS.map((z) => (
            <PreviewThumb key={z} zoom={z} frame={frame} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewThumb({ zoom, frame }: { zoom: number; frame: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = SHEET;
    img.onload = () => {
      const col = frame % COLS;
      const row = Math.floor(frame / COLS);
      canvas.width = FW * zoom;
      canvas.height = FH * zoom;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, col * FW, row * FH, FW, FH, 0, 0, canvas.width, canvas.height);
    };
  }, [zoom, frame]);
  return (
    <figure className="office-preview-thumb">
      <figcaption>×{zoom}</figcaption>
      <canvas ref={ref} />
    </figure>
  );
}