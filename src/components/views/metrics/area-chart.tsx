"use client";

import { useEffect, useRef, useState } from "react";

export interface SeriesPoint {
  t: number;
  label: string;
  value: number;
}

const H = 210;
const PAD_T = 12;
const PAD_B = 26;
const PAD_L = 52;
const PAD_R = 12;
const PLOT_H = H - PAD_T - PAD_B;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

// Single-series area+line rendered at the measured pixel width (no viewBox
// scaling, so text/dots aren't distorted). Pointer x maps 1:1 to data.
export function AreaChart({
  points,
  format,
  unit,
  color = "var(--brand)",
}: {
  points: readonly SeriesPoint[];
  format: (n: number) => string;
  unit: string;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(840);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw && cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  if (n === 0) return <div className="mx-area" ref={ref}><div className="mx-area-empty">no activity in range</div></div>;

  const plotW = Math.max(40, w - PAD_L - PAD_R);
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const x = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_T + PLOT_H - (v / max) * PLOT_H;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${(PAD_T + PLOT_H).toFixed(1)} L${x(0).toFixed(1)} ${(PAD_T + PLOT_H).toFixed(1)} Z`;
  const gridVals = [1, 0.75, 0.5, 0.25, 0].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 90))));

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const idx = Math.round((((e.clientX - rect.left) - PAD_L) / plotW) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, idx)));
  };

  const hp = hi != null ? points[hi] : null;

  return (
    <div className="mx-area" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg width={w} height={H} className="mx-area-svg" role="img" aria-label="Activity over time">
        <defs>
          <linearGradient id="mx-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={w - PAD_R} y1={y(v)} y2={y(v)} className="mx-area-grid" />
            <text x={PAD_L - 8} y={y(v) + 3} className="mx-area-ylabel">{format(v)}</text>
          </g>
        ))}
        <path d={area} fill="url(#mx-area-grad)" />
        <path d={line} className="mx-area-line" fill="none" style={{ stroke: color }} />
        {points.map((p, i) => (i % labelEvery === 0 || i === n - 1) ? (
          <text key={p.t} x={x(i)} y={H - 8} className="mx-area-xlabel">{p.label}</text>
        ) : null)}
        {hp && <line x1={x(hi!)} x2={x(hi!)} y1={PAD_T} y2={PAD_T + PLOT_H} className="mx-area-cross" />}
        {hp && <circle cx={x(hi!)} cy={y(hp.value)} r={3.5} className="mx-area-dot" style={{ fill: color }} />}
      </svg>
      {hp && (
        <div className="mx-area-tip" style={{ left: x(hi!) }}>
          <span className="d">{hp.label}</span>
          <span className="v">{format(hp.value)}{unit ? ` ${unit}` : ""}</span>
        </div>
      )}
    </div>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  unit: string;
  format: (n: number) => string;
  points: readonly SeriesPoint[];
}

// Several series overlaid on one plot. Each is normalized to its own max so the
// shapes stay comparable despite wildly different units (cost in $, output in
// millions of tokens, session counts under ~50). The Y grid is therefore
// relative (0..100%); the crosshair tooltip reports each series' real value.
// All series must share the same x buckets (same length / labels).
export function MultiAreaChart({ series }: { series: readonly ChartSeries[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(840);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw && cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const base = series[0]?.points ?? [];
  const n = base.length;
  if (n === 0 || series.length === 0) {
    return <div className="mx-area" ref={ref}><div className="mx-area-empty">no activity in range</div></div>;
  }

  const plotW = Math.max(40, w - PAD_L - PAD_R);
  const x = (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yRel = (frac: number) => PAD_T + PLOT_H - frac * PLOT_H;

  const norm = series.map((s) => ({ ...s, max: niceMax(Math.max(...s.points.map((p) => p.value))) }));
  const pathFor = (s: (typeof norm)[number]) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${yRel(p.value / s.max).toFixed(1)}`).join(" ");

  const gridFracs = [1, 0.75, 0.5, 0.25, 0];
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 90))));

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const idx = Math.round((((e.clientX - rect.left) - PAD_L) / plotW) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <div className="mx-area" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg width={w} height={H} className="mx-area-svg" role="img" aria-label="Activity over time">
        {gridFracs.map((f, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={w - PAD_R} y1={yRel(f)} y2={yRel(f)} className="mx-area-grid" />
            <text x={PAD_L - 8} y={yRel(f) + 3} className="mx-area-ylabel">{Math.round(f * 100)}%</text>
          </g>
        ))}
        {norm.map((s) => (
          <path key={`l-${s.key}`} d={pathFor(s)} fill="none" className="mx-multi-line" style={{ stroke: s.color }} />
        ))}
        {base.map((p, i) => (i % labelEvery === 0 || i === n - 1) ? (
          <text key={p.t} x={x(i)} y={H - 8} className="mx-area-xlabel">{p.label}</text>
        ) : null)}
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={PAD_T} y2={PAD_T + PLOT_H} className="mx-area-cross" />}
        {hi != null && norm.map((s) => (
          <circle key={`d-${s.key}`} cx={x(hi)} cy={yRel((s.points[hi]?.value ?? 0) / s.max)} r={3.2} className="mx-multi-dot" style={{ fill: s.color }} />
        ))}
      </svg>
      {hi != null && (
        <div className="mx-area-tip mx-multi-tip" style={{ left: x(hi) }}>
          <span className="d">{base[hi]?.label}</span>
          {norm.map((s) => (
            <span key={`t-${s.key}`} className="row">
              <span className="dot" style={{ background: s.color }} />
              <span className="k">{s.label}</span>
              <span className="v" style={{ color: s.color }}>{s.format(s.points[hi]?.value ?? 0)}{s.unit ? ` ${s.unit}` : ""}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
