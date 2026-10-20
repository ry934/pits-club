import { useMemo } from 'react';
import { Avatar, Avg, Cote, CountUp, Empty, Panel, PlacesBar, PlayerTag, Pos, Section, Stat } from '../components/ui';
import { Emblem } from '../components/Emblem';
import { BADGE } from '../lib/badges';
import { href } from '../router';
import { useStore } from '../store';
import { dayKey, fmtDay, fmtDuration, fmtTime, ratingAt, sessionState, sessionSummary } from '../lib/stats';
import { CloseSessionButton } from './Profil';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function Session({ day: dayParam, afterTable }: { day?: string; afterTable?: React.ReactNode }) {
  const { byDay, dayList, elo, closedDays, runs, badges, player } = useStore();
  const L = (n: string) => player(n).displayName ?? n;
  const day = dayParam && byDay.has(dayParam) ? dayParam : dayList.at(-1);
  const s = useMemo(() => (day ? sessionSummary(day, byDay.get(day)!, elo) : null), [day, byDay, elo]);
  if (!day || !s) return <Empty>Aucune course pour l'instant. Les résultats apparaîtront dès la première réponse au formulaire.</Empty>;
  const today = dayKey(new Date());
  const isToday = day === today;
  const noneToday = !dayParam && !isToday;
  const idx = dayList.indexOf(day);
  const prev = dayList[idx - 1], next = dayList[idx + 1];
  const state = sessionState(day, s.races, closedDays);
  const surp = s.surperf[0];
  const firstId = s.races[0].id, lastId = s.races.at(-1)!.id;
  const hot = runs.filter((r) => r.end.id >= firstId && r.end.id <= lastId && r.length >= 3).sort((a, b) => b.length - a.length)[0];
  const unlocked = badges.events.filter((e) => e.day === day);

  return (
    <>
      {noneToday && <p className="hint" style={{ margin: 0 }}>Pas encore de course aujourd'hui : voici la dernière session.</p>}
      <header className="session-head">
        {prev ? <a className="iconbtn" href={href('stats', 'session', prev)} aria-label="Session précédente">‹</a> : <span className="iconbtn off">‹</span>}
        <div className="grow">
          <span className={`state state-${state}`}>{state === 'live' ? 'En course' : isToday ? 'Session du jour · terminée' : 'Drapeau à damier'}</span>
          <h2 style={{ margin: 0 }}>{cap(fmtDay(day))}</h2>
          <span className="muted">{fmtTime(s.start)} à {fmtTime(s.end)}, {s.players.length} pilotes</span>
        </div>
        {next ? <a className="iconbtn" href={href('stats', 'session', next)} aria-label="Session suivante">›</a> : <span className="iconbtn off">›</span>}
      </header>
      {!isToday && dayList.includes(today) && <div><a className="btn btn-sm" href={href('stats', 'session', today)}>Revenir à la session du jour</a></div>}
      {state === 'live' && <div className="btn-row"><CloseSessionButton day={day} /></div>}

      <div className="kpis">
        <Panel><Stat label="Courses" value={<CountUp value={s.races.length} />} /></Panel>
        <Panel><Stat label="Temps de jeu" value={fmtDuration(s.minutes)} sub="≈ 2,77 min par course" /></Panel>
        <Panel><Stat label="MVP" tone="gold" value={L(s.mvp.name)} sub={`${s.mvp.wins} victoires sur ${s.mvp.races}`} /></Panel>
        {s.flop && <Panel><Stat label="Lanterne rouge" tone="bad" value={L(s.flop.name)} sub={`${s.flop.places[3]} fois 4e`} /></Panel>}
        {surp && surp.gain > 0.5 && <Panel><Stat label="Surperformance" tone="good" value={L(surp.name)} sub={`+${surp.gain.toFixed(1).replace('.', ',')} places vs sa cote`} /></Panel>}
        {hot && <Panel><Stat label={hot.kind === 'win' ? 'Série' : 'Spirale'} tone={hot.kind === 'win' ? 'good' : 'bad'} value={L(hot.name)} sub={`${hot.length} ${hot.kind === 'win' ? 'victoires' : 'fois 4e'} d'affilée`} /></Panel>}
      </div>

      <div className="podium" aria-label="Podium du jour">
        {[1, 0, 2].map((i) => s.table[i] && (
          <a key={i} className={`step step-${i + 1}`} href={href('stats', 'pilote', s.table[i].name)}>
            <Avatar name={s.table[i].name} size={i === 0 ? 60 : 46} />
            <span className="step-name">{L(s.table[i].name)}</span>
            <span className="step-avg num"><CountUp value={s.table[i].avg} decimals={2} /></span>
            <span className="step-block"><span className="step-rank">{i + 1}</span></span>
          </a>
        ))}
      </div>

      <Section title={isToday ? "Classement du jour" : "Classement de la session"} aside={<span className="hint">nombre de fois à chaque place</span>}>
        <div className="table-wrap">
          <table className="table session-table">
            <thead><tr><th>#</th><th>Pilote</th><th className="r">Moy.</th><th className="r hide-sm" title="Cote Elo en fin de session, et ce qu'elle a gagné ou perdu dans la journée">Cote</th><th className="r hide-sm">Courses</th><th className="r pl-h"><Pos n={1} /></th><th className="r pl-h"><Pos n={2} /></th><th className="r pl-h"><Pos n={3} /></th><th className="r pl-h"><Pos n={4} /></th><th className="hide-sm">Répartition</th><th className="r hide-sm" title="Places gagnées par rapport à la position attendue selon la cote">Vs cote</th></tr></thead>
            <tbody>
              {s.table.map((r) => {
                const g = s.surperf.find((x) => x.name === r.name)!.gain;
                return (
                  <tr key={r.name}>
                    <td className="rank">{r.rank}</td>
                    <td><PlayerTag name={r.name} /></td>
                    <td className="r"><Avg v={r.avg} /></td>
                    <td className="r hide-sm"><Cote v={ratingAt(elo, r.name, day)} delta={ratingAt(elo, r.name, day) - ratingAt(elo, r.name, day, true)} /></td>
                    <td className="r num hide-sm">{r.races}</td>
                    {r.places.map((n, k) => <td key={k} className={`r num pl-count ${n === 0 ? 'zero' : ''}`}>{n}</td>)}
                    <td className="hide-sm" style={{ minWidth: 110 }}><PlacesBar places={r.places} total={r.races} /></td>
                    <td className={`r num hide-sm ${g > 0.5 ? 'good' : g < -0.5 ? 'bad' : ''}`}>{g > 0 ? '+' : ''}{g.toFixed(1).replace('.', ',')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {afterTable}

      {unlocked.length > 0 && (
        <Section title="Trophées débloqués ce jour-là">
          <div className="badge-strip">
            {unlocked.map((e, k) => (
              <a key={k} href={`#/trophees`} title={BADGE[e.badge].condition}>
                <Emblem badge={BADGE[e.badge]} size={52} />
                <b style={{ color: 'var(--white)' }}>{BADGE[e.badge].name}</b>{e.player}
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section title="Feuille de course" aside={<span className="hint">{s.races.length} saisies</span>}>
        <ol className="racelog">
          {[...s.races].reverse().map((r, k) => (
            <li key={r.id}>
              <span className="racelog-n num">{s.races.length - k}</span>
              <span className="racelog-t num">{fmtTime(r.ts)}</span>
              <span className="racelog-p">{r.p.map((n, i) => <span key={n} className="racelog-entry"><Pos n={i + 1} />{n === 'Other' ? <span className="muted">Ancien joueur</span> : <a href={href('stats', 'pilote', n)}>{player(n).displayName ?? n}</a>}</span>)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
