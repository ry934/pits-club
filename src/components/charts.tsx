import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fmtAvg, fmtTime } from '../lib/stats';
import { Race } from '../lib/types';
import { initials } from './ui';

/** Tour par tour : position de chaque pilote à chaque course de la session. */
export function LapChart({ races }: { races: Race[] }) {
  const { player } = useStore();
  const step = 34, left = 34, right = 44, top = 18, row = 38;
  const w = left + right + Math.max(1, races.length - 1) * step;
  const h = top * 2 + row * 3 + 18;
  const x = (i: number) => left + i * step;
  const y = (pos: number) => top + (pos - 1) * row;
  const names = [...new Set(races.flatMap((r) => r.p))];
  const series = names.map((name) => {
    const pts = races.map((r, i) => ({ i, pos: r.p.indexOf(name) + 1 }));
    let d = '';
    pts.forEach((p, k) => {
      if (!p.pos) return;
      const prev = pts[k - 1];
      d += `${prev && prev.pos ? 'L' : 'M'}${x(p.i)} ${y(p.pos)}`;
    });
    const last = [...pts].reverse().find((p) => p.pos);
    return { name, d, pts, last, color: player(name).color };
  });
  const labelEvery = races.length > 24 ? 5 : races.length > 12 ? 2 : 1;
  return (
    <div className="chart-scroll">
      <svg className="lapchart" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Positions de chaque pilote course après course">
        {[1, 2, 3, 4].map((p) => (
          <g key={p}>
            <line x1={left - 8} x2={w - right + 8} y1={y(p)} y2={y(p)} className="grid" />
            <text x={8} y={y(p) + 4} className={`axis pos-txt-${p}`}>P{p}</text>
          </g>
        ))}
        {races.map((r, i) => i % labelEvery === 0 && (
          <text key={r.id} x={x(i)} y={h - 4} className="axis" textAnchor="middle">{i + 1}</text>
        ))}
        {series.map((s) => (
          <g key={s.name} className="lap-series">
            <path d={s.d} stroke={s.color} />
            {s.pts.map((p) => p.pos > 0 && <circle key={p.i} cx={x(p.i)} cy={y(p.pos)} r={3.2} fill={s.color} />)}
          </g>
        ))}
        {series.filter((s) => s.last).map((s) => (
          <g key={s.name + '-end'} transform={`translate(${x(s.last!.i) + 14} ${y(s.last!.pos)})`}>
            <circle r={10} fill={s.color} />
            <text y={3.5} textAnchor="middle" className="end-label">{initials(s.name)}</text>
          </g>
        ))}
        <title>{races.length} courses, de {fmtTime(races[0].ts)} à {fmtTime(races.at(-1)!.ts)}</title>
      </svg>
    </div>
  );
}

type Pt = { label: string; value: number };

/** Courbe simple avec aire, grille légère et dernier point mis en avant. */
export function LineChart({ points, color, min, max, invert, format, height = 150, ticks }: {
  points: Pt[]; color: string; min?: number; max?: number; invert?: boolean;
  format: (v: number) => string; height?: number; ticks?: number[];
}) {
  const [ref, w] = useWidth(640);
  if (points.length < 2) return null;
  const h = height, l = 44, r = 14, t = 12, b = 26;
  const lo = min ?? Math.min(...points.map((p) => p.value));
  const hi = max ?? Math.max(...points.map((p) => p.value));
  const span = hi - lo || 1;
  const X = (i: number) => l + (i / (points.length - 1)) * (w - l - r);
  const Y = (v: number) => {
    const k = (v - lo) / span;
    return t + (invert ? k : 1 - k) * (h - t - b);
  };
  const tickVals = ticks ?? [lo, lo + span / 2, hi];
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join('');
  const base = invert ? t : h - b;
  const area = `${d}L${X(points.length - 1)} ${h - b}L${X(0)} ${h - b}Z`;
  const areaInv = `${d}L${X(points.length - 1)} ${t}L${X(0)} ${t}Z`;
  const last = points.at(-1)!;
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <div ref={ref} className="linechart-wrap"><svg className="linechart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`De ${format(points[0].value)} à ${format(last.value)}`}>
      {tickVals.map((v) => (
        <g key={v}>
          <line x1={l} x2={w - r} y1={Y(v)} y2={Y(v)} className="grid" />
          <text x={l - 8} y={Y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
        </g>
      ))}
      <path d={invert ? areaInv : area} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={X(points.length - 1)} cy={Y(last.value)} r={4.5} fill={color} stroke="var(--bg)" strokeWidth={2} />
      {labelIdx.map((i, k) => (
        <text key={k} x={X(i)} y={h - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} className="axis">{points[i].label}</text>
      ))}
      <line x1={l} x2={w - r} y1={base} y2={base} className="grid" opacity={0} />
    </svg></div>
  );
}

/** Barres horizontales de position moyenne (1 = meilleur, barre plus longue). */
export function AvgBars({ rows, color }: { rows: { label: string; avg: number; n: number }[]; color: string }) {
  return (
    <div className="avgbars">
      {rows.map((r) => (
        <div key={r.label} className="avgbar">
          <span className="avgbar-label">{r.label}</span>
          <span className="avgbar-track">
            <span className="avgbar-fill" style={{ width: `${((4 - r.avg) / 3) * 100}%`, background: color }} />
          </span>
          <span className="avgbar-val num">{fmtAvg(r.avg)}</span>
          <span className="avgbar-n">{r.n} c.</span>
        </div>
      ))}
    </div>
  );
}

/** Part des duels gagnés par A, mois par mois, autour de 50 %. */
export function DuelBars({ rows, colorA, colorB }: { rows: { label: string; pct: number; n: number }[]; colorA: string; colorB: string }) {
  return (
    <div className="duelbars">
      {rows.map((r) => {
        const v = r.pct - 0.5;
        return (
          <div key={r.label} className="duelbar">
            <span className="duelbar-label">{r.label}</span>
            <span className="duelbar-track">
              <span className="duelbar-fill" style={{ background: v >= 0 ? colorA : colorB, width: `${Math.max(Math.abs(v) * 100, 0.8)}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
            </span>
            <span className="duelbar-val num">{Math.round(r.pct * 100)} %</span>
            <span className="duelbar-n">{r.n} c.</span>
          </div>
        );
      })}
    </div>
  );
}

function useWidth(initial: number): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
