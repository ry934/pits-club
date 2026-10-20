import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { currentSeason, Season } from '../lib/season';
import { discover, fx, FxEvent, SECRETS } from '../lib/secrets';
import { play, unlock } from '../lib/sfx';
import { useStore } from '../store';
import { Avatar } from './ui';

/**
 * Couche d'effets posée au-dessus de l'app : thèmes de saison, inclinaison des cartes au survol,
 * easter eggs (clavier, logo) et leurs animations. Rien ici ne bloque les clics (pointer-events: none).
 */

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
const TILT = '.pilot-card, .badge-strip a, .kpis > .panel, .picker-chip, .board li, .hero-stats .stat';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const soundOn = () => { try { return localStorage.getItem('mk.liveSound') === '1'; } catch { return false; } };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

type Toast = { id: number; title: string; sub: string };
type Anim = { id: number; e: FxEvent };

export function Fx() {
  const { activeNames, player } = useStore();
  const { me } = useAuth();
  const season = useMemo<Season>(() => currentSeason(), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [anims, setAnims] = useState<Anim[]>([]);
  const seq = useRef(0);

  // ---------------------------------------------------------------- saison
  useEffect(() => {
    if (season) document.documentElement.dataset.season = season; else delete document.documentElement.dataset.season;
  }, [season]);

  // ---------------------------------------------------------------- inclinaison des cartes au survol
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover)').matches) return;
    let cur: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.classList.remove('tilting'); } };
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(TILT) as HTMLElement | null;
      if (el !== cur) { reset(cur); cur = el; }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.classList.add('tilting');
      el.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(0)}%`);
      el.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(0)}%`);
    };
    const leave = () => { reset(cur); cur = null; };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerleave', leave);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
  }, []);

  // ---------------------------------------------------------------- bus d'effets
  useEffect(() => {
    const onFx = (ev: Event) => {
      const e = (ev as CustomEvent<FxEvent>).detail;
      if (e.type === 'mirror') {
        document.documentElement.classList.add('mirror');
        window.setTimeout(() => document.documentElement.classList.remove('mirror'), 30000);
        return;
      }
      if (e.type === 'toast') { const id = ++seq.current; setToasts((t) => [...t, { id, title: e.text, sub: '' }]); window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800); return; }
      const id = ++seq.current;
      setAnims((a) => [...a, { id, e }]);
      window.setTimeout(() => setAnims((a) => a.filter((x) => x.id !== id)), e.type === 'dice' ? 4200 : 3600);
    };
    const onSecret = (ev: Event) => {
      const { id: sid, count } = (ev as CustomEvent<{ id: string; count: number }>).detail;
      const s = SECRETS.find((x) => x.id === sid);
      const id = ++seq.current;
      setToasts((t) => [...t, { id, title: s?.name ?? 'Secret', sub: `Secret trouvé · ${count}/${SECRETS.length}` }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
      if (soundOn()) { unlock(); play('sparkle'); }
    };
    window.addEventListener('mk:fx', onFx);
    window.addEventListener('mk:secret', onSecret);
    return () => { window.removeEventListener('mk:fx', onFx); window.removeEventListener('mk:secret', onSecret); };
  }, []);

  // ---------------------------------------------------------------- clavier : Konami, prénoms, « boom »
  const names = useMemo(() => activeNames.flatMap((n) => [n, player(n).displayName ?? n].map((v) => ({ key: norm(v), name: n }))).filter((x) => x.key.length >= 3), [activeNames, player]);
  const kb = useRef({ keys: [] as string[], buf: '', last: 0 });
  useEffect(() => {
    const st = kb.current;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      st.keys = [...st.keys, k].slice(-KONAMI.length);
      if (st.keys.join() === KONAMI.join()) { st.keys = []; fx({ type: 'mirror' }); discover('konami'); return; }
      if (k.length !== 1) return;
      const now = Date.now();
      if (now - st.last > 2500) st.buf = '';
      st.last = now;
      st.buf = (st.buf + norm(k)).slice(-24);
      const buf = st.buf;
      if (buf.endsWith('boom')) {
        st.buf = '';
        const row = document.querySelector('.classement-table tbody tr') as HTMLElement | null;
        if (row) { fx({ type: 'boom', target: row.getBoundingClientRect() }); discover('boom'); window.setTimeout(() => { row.classList.add('hit'); window.setTimeout(() => row.classList.remove('hit'), 1400); }, 900); }
        return;
      }
      const hit = names.find((x) => buf.endsWith(x.key));
      if (hit) { st.buf = ''; fx({ type: 'lap', name: hit.name }); discover('name'); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [names]);

  // ---------------------------------------------------------------- logo cliqué 7 fois
  useEffect(() => {
    let n = 0, t = 0;
    const click = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.brand, .mobile-brand, .live-brand')) return;
      const now = Date.now();
      n = now - t < 1500 ? n + 1 : 1;
      t = now;
      if (n >= 7) { n = 0; fx({ type: 'kart' }); discover('logo'); }
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);

  return (
    <>
      {season && <SeasonLayer season={season} />}
      <div className="fx-layer" aria-hidden="true">
        {anims.map(({ id, e }) => <FxAnim key={id} e={e} me={me} />)}
      </div>
      <div className="fx-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="fx-toast"><span className="fx-toast-star" aria-hidden="true">✦</span><span><b>{t.title}</b>{t.sub && <small>{t.sub}</small>}</span></div>
        ))}
      </div>
    </>
  );
}

function FxAnim({ e, me }: { e: FxEvent; me: string | null }) {
  const { player } = useStore();
  if (e.type === 'kart') {
    const c = me ? player(me).color : 'var(--cyan)';
    return (
      <div className="fx-kart" style={{ '--c': c } as CSSProperties}>
        <span className="fx-trail" />
        <svg viewBox="0 0 64 34" className="fx-kart-svg">
          <rect x="6" y="10" width="44" height="12" rx="4" fill={c} />
          <path d="M18 10 L26 2 L36 2 L40 10 Z" fill={c} opacity="0.8" />
          <rect x="48" y="12" width="12" height="6" rx="2" fill="#fff" opacity="0.85" />
          <circle cx="16" cy="25" r="7" fill="#101321" stroke="#fff" strokeWidth="2" /><circle cx="44" cy="25" r="7" fill="#101321" stroke="#fff" strokeWidth="2" />
        </svg>
      </div>
    );
  }
  if (e.type === 'lap') {
    return (
      <div className="fx-lap" style={{ '--c': player(e.name).color } as CSSProperties}>
        <span className="fx-lap-runner"><Avatar name={e.name} size={64} /><b>{player(e.name).displayName ?? e.name} !</b></span>
      </div>
    );
  }
  if (e.type === 'boom') {
    const r = e.target;
    return (
      <div className="fx-boom" style={{ '--tx': `${r.left + 120}px`, '--ty': `${r.top + r.height / 2}px` } as CSSProperties}>
        <span className="fx-missile"><i /></span>
        <span className="fx-blast" />
      </div>
    );
  }
  if (e.type === 'dice') return <Dice />;
  return null;
}

function Dice() {
  const [face, setFace] = useState(1);
  const [done, setDone] = useState(false);
  const final = useMemo(() => 1 + Math.floor(Math.random() * 4), []);
  useEffect(() => {
    let k = 0;
    const t = window.setInterval(() => {
      k++;
      setFace(1 + Math.floor(Math.random() * 4));
      if (k > 14) { window.clearInterval(t); setFace(final); setDone(true); }
    }, 90);
    return () => window.clearInterval(t);
  }, [final]);
  return (
    <div className="fx-dice">
      <span className={`fx-die pl-${face} ${done ? 'done' : ''}`}>P{face}</span>
      {done && <b>Le hasard a parlé : P{final} pour ta prochaine course.</b>}
    </div>
  );
}

/** Décor de saison, discret et en bordure d'écran. */
function SeasonLayer({ season }: { season: NonNullable<Season> }) {
  const flakes = useMemo(() => Array.from({ length: 36 }, () => ({ l: Math.random() * 100, d: 8 + Math.random() * 10, s: 2 + Math.random() * 4, delay: -Math.random() * 18 })), []);
  if (season === 'avril') return null;
  if (season === 'noel') {
    return (
      <div className="season-layer season-snow" aria-hidden="true">
        {flakes.map((f, i) => <i key={i} style={{ left: `${f.l}%`, width: f.s, height: f.s, animationDuration: `${f.d}s`, animationDelay: `${f.delay}s` }} />)}
      </div>
    );
  }
  return (
    <div className="season-layer season-halloween" aria-hidden="true">
      <svg className="sh-web" viewBox="0 0 120 120">
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M120 0 L0 120 M120 0 L40 120 M120 0 L0 60 M120 0 L80 120 M120 0 L0 20" />
          <path d="M100 0 Q104 16 120 20 M78 0 Q86 34 120 42 M54 0 Q66 54 120 66 M30 0 Q46 74 120 90" />
        </g>
        <line x1="96" y1="0" x2="96" y2="46" stroke="currentColor" strokeWidth="0.8" /><circle cx="96" cy="50" r="4" fill="currentColor" />
      </svg>
      {[0, 1, 2].map((i) => (
        <svg key={i} className={`sh-bat sh-bat-${i}`} viewBox="0 0 60 26"><path d="M30 8c2-4 5-4 6-1 4-6 12-7 24-3-6 1-9 6-9 11-4-4-8-3-10 1-2-3-4-4-5-1h-12c-1-3-3-2-5 1-2-4-6-5-10-1 0-5-3-10-9-11 12-4 20-3 24 3 1-3 4-3 6 1z" fill="currentColor" /></svg>
      ))}
      <svg className="sh-pumpkin" viewBox="0 0 64 56">
        <path d="M30 10c0-6 4-9 8-9-3 3-4 6-4 9z" fill="#3fa34d" />
        <ellipse cx="20" cy="33" rx="14" ry="20" fill="#e8741b" /><ellipse cx="44" cy="33" rx="14" ry="20" fill="#e8741b" /><ellipse cx="32" cy="33" rx="13" ry="22" fill="#ff8a24" />
        <path d="M20 28l6-6 4 6zM34 28l6-6 4 6z" fill="#2a1500" /><path d="M18 40c6 6 22 6 28 0l-4 5-4-3-6 4-6-4-4 3z" fill="#2a1500" />
      </svg>
    </div>
  );
}
