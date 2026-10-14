import { ReactNode } from 'react';
import { href } from '../router';
import { useStore } from '../store';
import { fmtAvg } from '../lib/stats';

export function initials(name: string) {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function Badge({ name, size = 28 }: { name: string; size?: number }) {
  const { player } = useStore();
  const c = player(name).color;
  return (
    <span className="badge" style={{ '--c': c, width: size, height: size, fontSize: size * 0.4 } as React.CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function PlayerTag({ name, link = true, sub }: { name: string; link?: boolean; sub?: ReactNode }) {
  const { player } = useStore();
  const p = player(name);
  const inner = (
    <>
      <Badge name={name} />
      <span className="ptag-text">
        <span className="ptag-name">{p.displayName ?? name}</span>
        {sub && <span className="ptag-sub">{sub}</span>}
      </span>
    </>
  );
  return link ? <a className="ptag" href={href('pilote', name)}>{inner}</a> : <span className="ptag">{inner}</span>;
}

export function Pos({ n }: { n: number }) {
  return <span className={`pos pos-${n}`}>P{n}</span>;
}

export function PlacesBar({ places, total }: { places: number[]; total: number }) {
  return (
    <span className="places" role="img" aria-label={places.map((p, i) => `P${i + 1} : ${p}`).join(', ')}>
      {places.map((p, i) => p > 0 && <span key={i} className={`pl pl-${i + 1}`} style={{ flexGrow: p / total }} />)}
    </span>
  );
}

export function Delta({ delta, isNew }: { delta: number | null; isNew?: boolean }) {
  if (isNew) return <span className="delta new">NEW</span>;
  if (delta === null) return <span className="delta">–</span>;
  if (delta === 0) return <span className="delta same">=</span>;
  return <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>;
}

export function Avg({ v }: { v: number }) {
  return <span className="num">{fmtAvg(v)}</span>;
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'accent' }) {
  return (
    <div className={`tile ${tone ? 'tone-' + tone : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <h2>{title}</h2>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
