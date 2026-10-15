import { useEffect, useMemo, useRef, useState } from 'react';
import { dayKey, fmtAvg, parseLocal, standings } from '../lib/stats';
import { href } from '../router';
import { useStore } from '../store';
import { Panel } from './ui';

/**
 * Activité du paddock, façon « contribution graph » de GitHub : une case par jour ouvré (lundi à vendredi),
 * une colonne par semaine, l'intensité suit le nombre de courses. Survol ou focus : le détail du jour.
 */

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

type Cell = { day: string; date: Date; count: number; future: boolean; info?: string };

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function Heatmap({ me }: { me: string | null }) {
  const { byDay, dayList, player } = useStore();
  const years = useMemo(() => [...new Set(dayList.map((d) => d.slice(0, 4)))].reverse(), [dayList]);
  const [range, setRange] = useState<string>('12m');
  const [mine, setMine] = useState(false);
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number; arrow: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayKey = dayKey(today);
  const { start, end } = useMemo(() => {
    if (range === '12m') { const s = mondayOf(today); s.setDate(s.getDate() - 7 * 52); return { start: s, end: today }; }
    const y = Number(range);
    return { start: mondayOf(new Date(y, 0, 1)), end: new Date(y, 11, 31) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, todayKey]);

  const weeks = useMemo(() => {
    const out: Cell[][] = [];
    const d = new Date(start);
    while (d <= end) {
      const col: Cell[] = [];
      for (let i = 0; i < 7; i++) {
        if (i < 5) {
          const key = dayKey(d);
          const rs = byDay.get(key) ?? [];
          const pool = mine && me ? rs.filter((r) => r.p.includes(me)) : rs;
          let info: string | undefined;
          if (pool.length) {
            if (mine && me) {
              const avg = pool.reduce((s, r) => s + r.p.indexOf(me) + 1, 0) / pool.length;
              info = `ta moyenne ${fmtAvg(avg)} · ${pool.filter((r) => r.p[0] === me).length} victoire(s)`;
            } else {
              const top = standings(rs)[0];
              info = top ? `meilleur du jour : ${player(top.name).displayName ?? top.name} (${fmtAvg(top.avg)})` : undefined;
            }
          }
          const outOfYear = range !== '12m' && d.getFullYear() !== Number(range);
          col.push({ day: key, date: new Date(d), count: outOfYear ? -1 : pool.length, future: key > todayKey, info });
        }
        d.setDate(d.getDate() + 1);
      }
      out.push(col);
    }
    return out;
  }, [start, end, byDay, mine, me, range, todayKey, player]);

  const cells = weeks.flat().filter((c) => c.count >= 0 && !c.future);
  const counts = cells.map((c) => c.count).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => counts.length ? counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] : 0;
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8);
  const level = (n: number) => (n <= 0 ? 0 : n <= t1 ? 1 : n <= t2 ? 2 : n <= t3 ? 3 : 4);

  // synthèse
  const total = counts.reduce((a, b) => a + b, 0);
  const played = counts.length;
  let streak = 0, best = 0;
  for (const c of cells) { streak = c.count > 0 ? streak + 1 : 0; best = Math.max(best, streak); }
  const record = cells.reduce<Cell | null>((m, c) => (c.count > (m?.count ?? 0) ? c : m), null);

  // libellés de mois : au-dessus de la première semaine qui contient le 1er… ou le premier jour ouvré du mois
  const monthLabels = weeks.map((w, i) => {
    const first = w.find((c) => c.count >= 0);
    if (!first) return '';
    const m = first.date.getMonth();
    const prev = weeks[i - 1]?.find((c) => c.count >= 0)?.date.getMonth();
    return i === 0 || m !== prev ? MONTHS[m] : '';
  });

  useEffect(() => { const s = scroller.current; if (s) s.scrollLeft = s.scrollWidth; }, [range, weeks.length]);

  const show = (cell: Cell, el: HTMLElement) => {
    const w = wrap.current!.getBoundingClientRect(), r = el.getBoundingClientRect();
    const raw = r.left - w.left + r.width / 2;
    const x = Math.min(Math.max(raw, 115), w.width - 115);   // l'infobulle reste dans le cadre
    setTip({ cell, x, y: r.top - w.top, arrow: raw - x });
  };

  return (
    <Panel hud="cyan" title="Activité du paddock" className="heat-panel" aside={
      <div className="heat-controls">
        {me && (
          <div className="seg seg-sm" role="group" aria-label="Courses comptées">
            <button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Tout le monde</button>
            <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Moi</button>
          </div>
        )}
        <select aria-label="Période" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="12m">12 derniers mois</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    }>
      <div className="heat" ref={wrap} onMouseLeave={() => setTip(null)}>
        <div className="heat-scroll" ref={scroller}>
          <div className="heat-grid" style={{ gridTemplateColumns: `28px repeat(${weeks.length}, var(--hc))` }}>
            <span />
            {monthLabels.map((m, i) => <span key={i} className="heat-month">{m}</span>)}
            {DAYS.map((d, row) => (
              <FragmentRow key={d} label={row % 2 === 0 ? d : ''} cells={weeks.map((w) => w[row])} level={level} todayKey={todayKey} onShow={show} onHide={() => setTip(null)} />
            ))}
          </div>
        </div>
        {tip && (
          <div className="heat-tip" style={{ left: tip.x, top: tip.y, '--arrow': `${tip.arrow}px` } as React.CSSProperties} role="tooltip">
            <b>{tip.cell.count > 0 ? `${tip.cell.count} course${tip.cell.count > 1 ? 's' : ''}` : tip.cell.future ? 'À venir' : 'Pas de course'}</b>
            <span>{LONG.format(tip.cell.date)}</span>
            {tip.cell.info && <span className="heat-tip-info">{tip.cell.info}</span>}
          </div>
        )}
        <div className="heat-foot">
          <span className="heat-sum">
            <b className="num">{total}</b> courses · <b className="num">{played}</b> jours joués
            {cells.length ? <> · <b className="num">{Math.round((played / cells.length) * 100)} %</b> des jours ouvrés</> : null}
            {best > 1 && <> · série record <b className="num">{best}</b> jours d'affilée</>}
            {record && <> · record <b className="num">{record.count}</b> le {record.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</>}
          </span>
          <span className="heat-legend" aria-hidden="true">Moins<i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />Plus</span>
        </div>
      </div>
    </Panel>
  );
}

function FragmentRow({ label, cells, level, todayKey, onShow, onHide }: {
  label: string; cells: Cell[]; level: (n: number) => number; todayKey: string;
  onShow: (c: Cell, el: HTMLElement) => void; onHide: () => void;
}) {
  return (
    <>
      <span className="heat-day">{label}</span>
      {cells.map((c) => {
        if (c.count < 0) return <span key={c.day} className="heat-cell void" aria-hidden="true" />;
        const cls = `heat-cell l${c.future ? 'f' : level(c.count)} ${c.day === todayKey ? 'today' : ''}`;
        const label = `${LONG.format(parseLocal(c.day))} : ${c.count > 0 ? `${c.count} courses` : 'pas de course'}`;
        const events = { onMouseEnter: (e: React.MouseEvent<HTMLElement>) => onShow(c, e.currentTarget), onFocus: (e: React.FocusEvent<HTMLElement>) => onShow(c, e.currentTarget), onBlur: onHide };
        return c.count > 0
          ? <a key={c.day} className={cls} href={href('session', c.day)} aria-label={label} {...events} />
          : <span key={c.day} className={cls} aria-label={label} {...events} />;
      })}
    </>
  );
}
