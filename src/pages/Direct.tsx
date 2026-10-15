import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { LapChart } from '../components/charts';
import { Avatar, BrandMark, CountUp } from '../components/ui';
import { liveFeed, liveTable, nextRaceOdds } from '../lib/live';
import { dayKey, fmtAvg, fmtDay, fmtDuration, fmtTime, sessionState } from '../lib/stats';
import { SETTINGS } from '../lib/types';
import { useStore } from '../store';

/**
 * Mode direct : écran plein cadre à laisser ouvert pendant la session (télé, écran partagé),
 * façon consultant de Grand Prix. Se met à jour tout seul à chaque réponse au formulaire.
 */
export function Direct() {
  const { byDay, dayList, closedDays, elo, player, sync } = useStore();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const today = dayKey(now);
  const day = byDay.has(today) ? today : dayList.at(-1);
  const races = day ? byDay.get(day)! : [];
  const state = day ? sessionState(day, races, closedDays, now) : 'closed';
  const label = (n: string) => player(n).displayName ?? n;

  const table = useMemo(() => liveTable(races), [races]);
  const feed = useMemo(() => liveFeed(races, elo, label).slice(0, 14), [races, elo, player]);
  const last = races.at(-1);
  const odds = useMemo(() => (last ? nextRaceOdds([...last.p], elo) : []), [last, elo]);

  // flash à l'arrivée d'une nouvelle course
  const lastId = useRef(last?.id);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (last && lastId.current !== undefined && last.id !== lastId.current) {
      setFresh(true);
      const t = setTimeout(() => setFresh(false), 6000);
      lastId.current = last.id;
      return () => clearTimeout(t);
    }
    lastId.current = last?.id;
  }, [last?.id]);

  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {});
  };

  if (!day || !last) {
    return (
      <div className="live">
        <LiveTop state="closed" now={now} count={0} sync={sync} onFull={fullscreen} />
        <div className="live-empty"><p>Aucune course pour l'instant. L'écran s'animera dès la première réponse au formulaire.</p></div>
      </div>
    );
  }

  const isToday = day === today;
  const leader = table[0];
  const idle = Math.round((now.getTime() - last.ts.getTime()) / 60000);

  return (
    <div className={`live ${fresh ? 'is-fresh' : ''}`}>
      <LiveTop state={state} now={now} count={races.length} sync={sync} onFull={fullscreen}
        sub={isToday ? `${fmtTime(races[0].ts)} – ${fmtTime(last.ts)} · ${fmtDuration(races.length * SETTINGS.raceMinutes)} de jeu` : `Dernière session : ${fmtDay(day)}`} />

      <div className="live-grid">
        <section className="live-panel live-board" aria-label="Classement de la session">
          <header className="live-h"><span>Classement de la session</span><span className="hint">moyenne · écart · 5 dernières</span></header>
          <ol className="live-rows">
            {table.map((r) => (
              <li key={r.name} className={`live-row ${r.rank === 1 ? 'is-lead' : ''}`} style={{ '--c': player(r.name).color } as CSSProperties}>
                <span className="live-rank num">{r.rank}</span>
                <span className={`live-move ${r.move > 0 ? 'up' : r.move < 0 ? 'down' : ''}`} aria-label={r.move ? `${r.move > 0 ? '+' : ''}${r.move} place(s)` : 'stable'}>
                  {r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–'}
                </span>
                <Avatar name={r.name} size={44} />
                <span className="live-name">
                  <b>{label(r.name)}</b>
                  <span className="hint">{r.races} courses · {r.wins} vict.{r.streak ? (r.streak.kind === 'win' ? ` · série ${r.streak.n}` : ` · ${r.streak.n}× 4e`) : ''}</span>
                </span>
                <span className="live-last5">{r.last5.map((p, i) => <i key={i} className={`lp lp-${p}`}>{p}</i>)}</span>
                <span className="live-avg num">{fmtAvg(r.avg)}</span>
                <span className="live-gap num">{r.rank === 1 ? 'Leader' : `+${fmtAvg(r.gap)}`}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`live-panel live-race ${fresh ? 'flash' : ''}`} aria-label="Dernière course">
          <header className="live-h">
            <span>{fresh ? 'Nouvelle course' : 'Dernière course'} · n°{races.length}</span>
            <span className="hint">{fmtTime(last.ts)}{isToday && state === 'live' ? ` · il y a ${idle < 1 ? 'moins d’1' : idle} min` : ''}</span>
          </header>
          <ol className="live-result">
            {last.p.map((n, i) => (
              <li key={n} className={`p${i + 1}`} style={{ '--c': player(n).color } as CSSProperties}>
                <span className="live-pos">P{i + 1}</span><Avatar name={n} size={36} /><b>{label(n)}</b>
              </li>
            ))}
          </ol>
        </section>

        <section className="live-panel live-odds" aria-label="Cote de la prochaine course">
          <header className="live-h"><span>Course suivante · cote de victoire</span><span className="hint">selon l'Elo, même grille</span></header>
          <ul className="live-oddlist">
            {odds.map((o) => (
              <li key={o.name} style={{ '--c': player(o.name).color, '--w': `${Math.round(o.p * 100)}%` } as CSSProperties}>
                <span className="live-oddname">{label(o.name)}</span>
                <span className="live-oddbar"><i /></span>
                <span className="num">{Math.round(o.p * 100)} %</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="live-panel live-feed" aria-label="Fil du direct">
          <header className="live-h"><span>Fil du direct</span><span className="hint">{leader ? `${label(leader.name)} mène avec ${fmtAvg(leader.avg)}` : ''}</span></header>
          <ul className="live-events">
            {feed.map((e, i) => (
              <li key={`${e.n}-${e.kind}-${e.who}`} className={`ev ev-${e.kind} ${i === 0 && fresh ? 'new' : ''}`}>
                <span className="ev-n num">C{e.n}</span><span className="ev-t">{e.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="live-panel live-chart" aria-label="Positions course par course">
          <header className="live-h"><span>Race history</span><span className="hint">position de chaque pilote, course par course</span></header>
          <LapChart races={races} fill />
        </section>
      </div>
    </div>
  );
}

function LiveTop({ state, now, count, sub, sync, onFull }: {
  state: 'live' | 'closed'; now: Date; count: number; sub?: string;
  sync: { mode: string; checkedAt: Date | null }; onFull: () => void;
}) {
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0'), ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <header className="live-top">
      <a className="live-brand" href="#/" title="Retour au paddock"><BrandMark /><span className="brand-name">Pits Club</span></a>
      <span className={`live-pill ${state === 'live' ? 'on' : ''}`}>{state === 'live' ? 'En direct' : 'Hors course'}</span>
      <span className="live-sub">{sub}</span>
      <span className="live-count"><span className="label">Courses</span><b className="num"><CountUp value={count} /></b></span>
      <span className="live-clock num">{hh}:{mm}<small>:{ss}</small></span>
      <span className={`live-sync ${sync.mode}`} title={sync.checkedAt ? `Dernière vérification ${fmtTime(sync.checkedAt)}` : ''}>
        {sync.mode === 'realtime' ? 'Temps réel' : sync.mode === 'polling' ? 'Actualisation auto' : 'Démo'}
      </span>
      <button type="button" className="btn btn-sm live-full" onClick={onFull}>Plein écran</button>
      <a className="btn btn-sm" href="#/">Quitter</a>
    </header>
  );
}
