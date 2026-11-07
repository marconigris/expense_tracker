"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";

export type WealthPoint = { month: string; cash: number; stocks: number; loans: number; properties: number; debt: number; total: number };

const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 48 };
const MONTH = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`));

/** Round tick step (1, 2 or 5 × 10^n) giving about four gridlines. */
function ticks(min: number, max: number) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
}

function compact(n: number, currency: string) {
  const symbol = currency === "EUR" ? "€" : "$";
  const abs = Math.abs(n);
  const text = abs >= 1_000_000 ? `${+(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${Math.round(abs / 1000)}K` : `${abs}`;
  return `${n < 0 ? "−" : ""}${symbol}${text}`;
}

/** Net worth per month for one currency: a single line, crosshair tooltip with the breakdown. */
export function WealthChart({ currency, points }: { currency: string; points: WealthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so axis text keeps its size on a phone and on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const values = points.map((p) => p.total);
  const grid = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const [lo, hi] = [grid[0], grid[grid.length - 1]];
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * innerH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.total)}`).join(" ");
  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64)));
  const active = hover == null ? points.length - 1 : hover;
  const shown = points[active];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  }

  return <figure className="rounded-xl border border-line bg-card p-4">
    <figcaption className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-medium">Patrimonio en {currency}</span>
      {shown && <span className="tabular-nums text-muted">{monthLabel(shown.month)} · <span className="font-medium text-fg">{formatMoney(shown.total, currency)}</span></span>}
    </figcaption>
    <div ref={box} className="mt-2"><svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full touch-none select-none" role="img"
      aria-label={`Patrimonio mensual en ${currency}`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
      {grid.map((g) => <g key={g}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
        <text x={PAD.left - 8} y={y(g)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">{compact(g, currency)}</text>
      </g>)}
      {points.map((p, i) => (points.length - 1 - i) % labelEvery === 0 &&
        <text key={p.month} x={x(i)} y={H - 8} textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--muted)">{monthLabel(p.month)}</text>)}
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} opacity={0.5} />}
      {points.length > 1 && <path d={path} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {shown && <circle cx={x(active)} cy={y(shown.total)} r={5} fill="var(--chart)" stroke="var(--card)" strokeWidth={2} />}
    </svg></div>
    {shown && <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-muted sm:grid-cols-2">
      {([["Banco / Cash", shown.cash], ["Stocks / Fondos / Crypto", shown.stocks], ["Préstamos a cobrar", shown.loans], ["Propiedades y autos", shown.properties], ["Le debés a papá", -shown.debt]] as const)
        .map(([label, v]) => <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd className="tabular-nums text-fg">{formatMoney(v, currency)}</dd></div>)}
    </dl>}
    
  </figure>;
}
