import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { href } from '../router';
import { useStore } from '../store';
import { fmtAvg } from '../lib/stats';

export function initials(name: string) {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const { player, crown } = useStore();
  const p = player(name);
  const [broken, setBroken] = useState(false);
  const photo = p.avatarUrl && !broken;
  const av = (
    <span className={`avatar ${photo ? 'has-photo' : ''}`} style={{ '--c': p.color, width: size, height: size, fontSize: size * 0.4 } as CSSProperties} aria-hidden="true">
      {photo ? <img src={p.avatarUrl} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
  const mark = name === crown.leader ? 'crown' : name === crown.last ? 'cloud' : null;
  if (!mark || size < 22) return av;
  return (
    <span className={`av-wrap av-${mark}`} style={{ '--s': `${size}px` } as CSSProperties} title={mark === 'crown' ? 'Leader du mois' : 'Lanterne rouge du mois'}>
      {av}
      {mark === 'crown' ? (
        <svg className="av-mark" viewBox="0 0 32 22" aria-hidden="true"><path d="M2 20 L4 6 L11 12 L16 2 L21 12 L28 6 L30 20 Z" /><circle cx="4" cy="5" r="2.2" /><circle cx="16" cy="2.2" r="2.2" /><circle cx="28" cy="5" r="2.2" /></svg>
      ) : (
        <svg className="av-mark" viewBox="0 0 36 24" aria-hidden="true"><path d="M9 20a7 7 0 0 1-.6-14A9 9 0 0 1 25 5.5 6.5 6.5 0 0 1 27.5 20Z" /><path className="rain" d="M12 22l-1 2M18 22l-1 2M24 22l-1 2" /></svg>
      )}
    </span>
  );
}

export function PlayerTag({ name, link = true, sub, size }: { name: string; link?: boolean; sub?: ReactNode; size?: number }) {
  const { player } = useStore();
  const p = player(name);
  const inner = (
    <>
      <Avatar name={name} size={size} />
      <span className="ptag-text">
        <span className="ptag-name">{p.displayName ?? name}</span>
        {sub && <span className="ptag-sub">{sub}</span>}
      </span>
    </>
  );
  return link ? <a className="ptag" href={href('stats', 'pilote', name)}>{inner}</a> : <span className="ptag">{inner}</span>;
}

export const Pos = ({ n }: { n: number }) => <span className={`pos pos-${n}`}>P{n}</span>;

export function PlacesBar({ places, total }: { places: number[]; total: number }) {
  return (
    <span className="places" role="img" aria-label={places.map((p, i) => `P${i + 1} : ${p}`).join(', ')}>
      {places.map((p, i) => p > 0 && <span key={i} className={`pl pl-${i + 1}`} style={{ flexGrow: p / total }} />)}
    </span>
  );
}

/** Forme récente : une barre par course, couleur de la place. */
export function FormChips({ positions }: { positions: number[] }) {
  return (
    <span className="form-chips" role="img" aria-label={`Dernières places : ${positions.join(', ')}`}>
      {positions.map((p, i) => <i key={i} className={`pl-${p}`} />)}
    </span>
  );
}

export function Delta({ delta, isNew }: { delta: number | null; isNew?: boolean }) {
  if (isNew) return <span className="delta new">NEW</span>;
  if (delta === null) return <span className="delta">–</span>;
  if (delta === 0) return <span className="delta">=</span>;
  return <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>;
}

export const Avg = ({ v }: { v: number }) => <span className="num">{fmtAvg(v)}</span>;

/** Cote Elo arrondie, avec l'évolution sur la période si fournie. */
export function Cote({ v, delta }: { v: number; delta?: number }) {
  const d = delta === undefined ? 0 : Math.round(delta);
  return (
    <span className="cote num" title="Cote Elo (départ à 1500)">
      {Math.round(v)}
      {delta !== undefined && d !== 0 && <small className={d > 0 ? 'good' : 'bad'}>{d > 0 ? '+' : '−'}{Math.abs(d)}</small>}
    </span>
  );
}

export function Stat({ label, value, sub, tone, xl }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; xl?: boolean }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className={`stat-value ${xl ? 'xl' : ''} ${tone ?? ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Panel({ children, className = '', hud, title, aside, as = 'div' }: {
  children: ReactNode; className?: string; hud?: 'cyan' | 'yellow' | 'red' | 'purple' | 'green'; title?: string; aside?: ReactNode; as?: 'div' | 'section';
}) {
  const Tag = as;
  const hc = hud ? `hud ${hud !== 'cyan' ? 'hud-' + hud : ''}` : '';
  return (
    <Tag className={`panel ${hc} ${className}`}>
      {(title || aside) && (
        <div className="panel-head">
          {title && <span className="label">{title}</span>}
          {aside}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-head">
        <h2 className="label">{title}</h2>
        {aside && <div>{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

export function MockNotice({ children }: { children: ReactNode }) {
  return <div className="notice" role="note"><b>Prototype</b><span>{children}</span></div>;
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Compteur animé (une seule fois à l'affichage), désactivé si mouvement réduit. */
export function CountUp({ value, decimals = 0, duration = 700 }: { value: number; decimals?: number; duration?: number }) {
  const [v, setV] = useState(reduceMotion() ? value : 0);
  const shown = useRef(v);   // repart de la valeur affichée : 13 → 14 ne redescend pas à 0 en direct
  useEffect(() => {
    if (reduceMotion()) { setV(value); shown.current = value; return; }
    let raf = 0; const t0 = performance.now(); const from = shown.current;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / duration));
      const x = from + (value - from) * (1 - Math.pow(1 - k, 3));
      shown.current = x; setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num">{v.toFixed(decimals).replace('.', ',').replace(/^-(0[,0]*)$/, '$1')}</span>;
}

export function Crown() {
  return (
    <svg className="crown" viewBox="0 0 40 24" aria-hidden="true">
      <path d="M3 21h34l2-15-10 7-9-11-9 11L1 6z" fill="currentColor" />
      <rect x="3" y="21" width="34" height="3" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true">
      <path d="M6 2h26v24l-6 6H2V6z" fill="#191d32" stroke="#28e7ff" strokeWidth="1.5" />
      <g fill="#f4f7ff">
        <rect x="8" y="8" width="5" height="5" /><rect x="18" y="8" width="5" height="5" />
        <rect x="13" y="13" width="5" height="5" /><rect x="23" y="13" width="5" height="5" />
        <rect x="8" y="18" width="5" height="5" /><rect x="18" y="18" width="5" height="5" />
      </g>
      <path d="M6 28l20-20" stroke="#ffd84d" strokeWidth="2" />
    </svg>
  );
}
