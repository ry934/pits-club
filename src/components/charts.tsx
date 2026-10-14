import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fmtAvg, fmtTime } from '../lib/stats';
import { Race } from '../lib/types';
import { initials } from './ui';

function useWidth(initial: number): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Tour par tour : position de chaque pilote à chaque course, avec détail au survol. */
export function LapChart({ races }: { races: Race[] }) {
  const { player } = useStore();
  const [hover, setHover] = useState<number | null>(null);
  const step = 36, left = 34, right = 40, top = 18, row = 40;
  const w = left + right + Math.max(1, races.length - 1) * step;
  const h = top * 2 + row * 3 + 18;
  const x = (i: number) => left + i * step;
  const y = (pos: number) => top + (pos - 1) * row;
  const names = [...new Set(races.flatMap((r) => r.p))];
  const series = names.map((name) => {
    const pts = races.map((r, i) => ({ i, pos: r.p.indexOf(name) + 1 }));
    let d = '';
    pts.forEach((p, k) => { if (p.pos) d += `${pts[k - 1]?.pos ? 'L' : 'M'}${x(p.i)} ${y(p.pos)}`; });
    const last = [...pts].reverse().find((p) => p.pos);
    return { name, d, pts, last, color: player(name).color };
  });
  const every = races.length > 24 ? 5 : races.length > 12 ? 2 : 1;
  const hr = hover !== null ? races[hover] : null;
  return (
    <div className="chart chart-scroll" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Positions course par course, ${races.length} courses`}>
        {[1, 2, 3, 4].map((p) => (
          <g key={p}>
            <line x1={left - 8} x2={w - right + 8} y1={y(p)} y2={y(p)} className="grid-line" />
            <text x={6} y={y(p) + 4} className="axis" style={{ fill: `var(--p${p})` }}>P{p}</text>
          </g>
        ))}
        {races.map((r, i) => i % every === 0 && <text key={r.id} x={x(i)} y={h - 4} className="axis" textAnchor="middle">{i + 1}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top - 10} y2={y(4) + 10} className="cursor" />}
        {series.map((s) => (
          <g key={s.name} opacity={hr && !hr.p.includes(s.name) ? 0.25 : 1}>
            <path d={s.d} stroke={s.color} className="series" />
            {s.pts.map((p) => p.pos > 0 && <circle key={p.i} cx={x(p.i)} cy={y(p.pos)} r={3.4} fill={s.color} />)}
          </g>
        ))}
        {series.filter((s) => s.last).map((s) => (
          <g key={s.name + '-end'} transform={`translate(${x(s.last!.i) + 16} ${y(s.last!.pos)})`}>
            <rect x={-11} y={-9} width={22} height={18} fill={s.color} />
            <text y={4} textAnchor="middle" style={{ fill: '#fff', font: '700 9px var(--font-display)' }}>{initials(s.name)}</text>
          </g>
        ))}
        {races.map((r, i) => (
          <rect key={'h' + r.id} className="hit" x={x(i) - step / 2} y={0} width={step} height={h}
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {hr && hover !== null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, w - 170), top: 8 }}>
          <div className="tt-title">Course {hover + 1} · {fmtTime(hr.ts)}</div>
          {hr.p.map((n, k) => <div key={n} className="tt-row"><span>P{k + 1}</span><b>{n}</b></div>)}
        </div>
      )}
    </div>
  );
}

export type Series = { name: string; color: string; values: (number | null)[]; counts?: (number | null)[] };

/**
 * Courbes de tendance avec curseur et infobulle. `invert` : 1 en haut (positions).
 * `best` : met en jaune le meilleur point de la première série (record personnel).
 */
export function TrendChart({ labels, series, min, max, invert, format, height = 220, ticks, best, unit }: {
  labels: string[]; series: Series[]; min?: number; max?: number; invert?: boolean;
  format: (v: number) => string; height?: number; ticks?: number[]; best?: boolean; unit?: string;
}) {
  const [ref, w] = useWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (labels.length < 2) return null;
  const h = height, l = 46, r = 16, t = 14, b = 28;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = min ?? Math.min(...vals), hi = max ?? Math.max(...vals), span = hi - lo || 1;
  const X = (i: number) => l + (i / (labels.length - 1)) * (w - l - r);
  const Y = (v: number) => t + (invert ? (v - lo) / span : 1 - (v - lo) / span) * (h - t - b);
  const tickVals = ticks ?? [lo, lo + span / 2, hi];
  const path = (vs: (number | null)[]) => {
    let d = '';
    vs.forEach((v, i) => { if (v !== null) d += `${i && vs[i - 1] !== null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; });
    return d;
  };
  const first = series[0];
  let bestIdx = -1;
  if (best && first) {
    first.values.forEach((v, i) => {
      if (v === null) return;
      const cur = bestIdx >= 0 ? first.values[bestIdx]! : null;
      if (cur === null || (invert ? v < cur : v > cur)) bestIdx = i;
    });
  }
  const labelIdx = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])];
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = (e.target as SVGRectElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (w - l - r);
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round((px / (w - l - r)) * (labels.length - 1)))));
  };
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={series.map((s) => `${s.name} : ${s.values.filter((v) => v !== null).map((v) => format(v!)).join(', ')}`).join(' ; ')}>
        {tickVals.map((v) => (
          <g key={v}>
            <line x1={l} x2={w - r} y1={Y(v)} y2={Y(v)} className="grid-line" />
            <text x={l - 8} y={Y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
          </g>
        ))}
        {labelIdx.map((i, k) => (
          <text key={i} x={X(i)} y={h - 8} textAnchor={k === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} className="axis">{labels[i]}</text>
        ))}
        {series.length === 1 && (
          <path d={`${path(first.values)}L${X(labels.length - 1)} ${invert ? t : h - b}L${X(first.values.findIndex((v) => v !== null))} ${invert ? t : h - b}Z`} fill={first.color} opacity={0.1} />
        )}
        {series.map((s) => <path key={s.name} d={path(s.values)} stroke={s.color} className="series" />)}
        {series.map((s) => {
          const i = s.values.map((v, k) => (v !== null ? k : -1)).filter((k) => k >= 0).at(-1);
          return i !== undefined && <circle key={s.name + 'end'} cx={X(i)} cy={Y(s.values[i]!)} r={4.5} fill={s.color} stroke="#101321" strokeWidth={2} />;
        })}
        {bestIdx >= 0 && (
          <g>
            <circle cx={X(bestIdx)} cy={Y(first.values[bestIdx]!)} r={6} fill="none" stroke="var(--yellow)" strokeWidth={2} />
            <text x={X(bestIdx)} y={Y(first.values[bestIdx]!) + (invert ? -12 : -12)} textAnchor="middle" className="axis" style={{ fill: 'var(--yellow)' }}>record</text>
          </g>
        )}
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={t} y2={h - b} className="cursor" />
            {series.map((s) => s.values[hover] !== null && <circle key={s.name} cx={X(hover)} cy={Y(s.values[hover]!)} r={4} fill={s.color} />)}
          </g>
        )}
        <rect className="hit" x={l} y={0} width={w - l - r} height={h} onMouseMove={onMove} onClick={onMove} />
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(0, X(hover) - 70), w - 170), top: 4 }}>
          <div className="tt-title">{labels[hover]}</div>
          {series.filter((s) => s.values[hover] !== null).map((s) => (
            <div key={s.name} className="tt-row">
              <span style={{ color: s.color }}>{s.name}</span>
              <b className="num">{format(s.values[hover]!)}{unit ?? ''}{s.counts?.[hover] ? <span className="muted"> · {s.counts[hover]} c.</span> : null}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barres de position moyenne (1 = meilleur, barre plus longue). Le meilleur est en jaune. */
export function AvgBars({ rows }: { rows: { label: string; avg: number; n: number }[] }) {
  const bestAvg = Math.min(...rows.map((r) => r.avg));
  return (
    <div className="avgbars">
      {rows.map((r) => (
        <div key={r.label} className="avgbar">
          <span className="avgbar-label">{r.label}</span>
          <span className="avgbar-track"><span className={`avgbar-fill ${r.avg === bestAvg ? 'best' : ''}`} style={{ width: `${((4 - r.avg) / 3) * 100}%` }} /></span>
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
