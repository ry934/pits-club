import { useMemo } from 'react';
import { LapChart } from '../components/charts';
import { Avatar, Avg, Cote, CountUp, Empty, Panel, PlacesBar, PlayerTag, Pos, Section, Stat } from '../components/ui';
import { Emblem } from '../components/Emblem';
import { BADGE } from '../lib/badges';
import { href } from '../router';
import { useStore } from '../store';
import { fmtDay, fmtDuration, fmtTime, ratingAt, sessionState, sessionSummary } from '../lib/stats';
import { CloseSessionButton } from './Profil';

export function Session({ day: dayParam }: { day?: string }) {
  const { byDay, dayList, elo, closedDays, runs, badges, player } = useStore();
  const L = (n: string) => player(n).displayName ?? n;
  const day = dayParam && byDay.has(dayParam) ? dayParam : dayList.at(-1);
  const s = useMemo(() => (day ? sessionSummary(day, byDay.get(day)!, elo) : null), [day, byDay, elo]);
  if (!day || !s) return <Empty>Aucune course pour l'instant. Les résultats apparaîtront dès la première réponse au formulaire.</Empty>;
  const idx = dayList.indexOf(day);
  const prev = dayList[idx - 1], next = dayList[idx + 1];
  const state = sessionState(day, s.races, closedDays);
  const surp = s.surperf[0];
  const firstId = s.races[0].id, lastId = s.races.at(-1)!.id;
  const hot = runs.filter((r) => r.end.id >= firstId && r.end.id <= lastId && r.length >= 3).sort((a, b) => b.length - a.length)[0];
  const unlocked = badges.events.filter((e) => e.day === day);

  return (
    <div className="page">
      <header className="session-head">
        {prev ? <a className="iconbtn" href={href('session', prev)} aria-label="Session précédente">‹</a> : <span className="iconbtn off">‹</span>}
        <div className="grow">
          <span className={`state state-${state}`}>{state === 'live' ? 'En course' : 'Drapeau à damier'}</span>
          <h1 style={{ textTransform: 'capitalize' }}>{fmtDay(day)}</h1>
          <span className="muted">{fmtTime(s.start)} à {fmtTime(s.end)}, {s.players.length} pilotes</span>
        </div>
        {next ? <a className="iconbtn" href={href('session', next)} aria-label="Session suivante">›</a> : <span className="iconbtn off">›</span>}
      </header>
      <div className="btn-row">
        {day === dayList.at(-1) && <a className={`btn ${state === 'live' ? 'btn-primary' : ''} live-link`} href="#/direct">Mode direct</a>}
        {state === 'live' && <CloseSessionButton day={day} />}
      </div>

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
          <a key={i} className={`step step-${i + 1}`} href={href('pilote', s.table[i].name)}>
            <Avatar name={s.table[i].name} size={i === 0 ? 60 : 46} />
            <span className="step-name">{L(s.table[i].name)}</span>
            <span className="step-avg num"><CountUp value={s.table[i].avg} decimals={2} /></span>
            <span className="step-block"><span className="step-rank">{i + 1}</span></span>
          </a>
        ))}
      </div>

      <Panel hud="cyan" title="Race history · course par course" aside={<span className="hint">survole une course pour le détail</span>}>
        <LapChart races={s.races} />
      </Panel>

      <Section title="Classement du jour">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Pilote</th><th className="r">Moy.</th><th className="r" title="Cote Elo en fin de session, et ce qu'elle a gagné ou perdu dans la journée">Cote</th><th className="r">Courses</th><th>Places</th><th className="r" title="Places gagnées par rapport à la position attendue selon la cote">Vs cote</th></tr></thead>
            <tbody>
              {s.table.map((r) => {
                const g = s.surperf.find((x) => x.name === r.name)!.gain;
                return (
                  <tr key={r.name}>
                    <td className="rank">{r.rank}</td>
                    <td><PlayerTag name={r.name} /></td>
                    <td className="r"><Avg v={r.avg} /></td>
                    <td className="r"><Cote v={ratingAt(elo, r.name, day)} delta={ratingAt(elo, r.name, day) - ratingAt(elo, r.name, day, true)} /></td>
                    <td className="r num">{r.races}</td>
                    <td style={{ minWidth: 110 }}><PlacesBar places={r.places} total={r.races} /><span className="sub-num num">{r.places.join(' · ')}</span></td>
                    <td className={`r num ${g > 0.5 ? 'good' : g < -0.5 ? 'bad' : ''}`}>{g > 0 ? '+' : ''}{g.toFixed(1).replace('.', ',')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

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
              <span className="racelog-p">{r.p.map((n, i) => <span key={n} className="racelog-entry"><Pos n={i + 1} />{n === 'Other' ? <span className="muted">Ancien joueur</span> : <a href={href('pilote', n)}>{player(n).displayName ?? n}</a>}</span>)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
