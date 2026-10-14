import { useMemo } from 'react';
import { LapChart } from '../components/charts';
import { Avg, Badge, Empty, PlacesBar, PlayerTag, Pos, Section, Tile } from '../components/ui';
import { href } from '../router';
import { useStore } from '../store';
import { fmtDay, fmtDuration, fmtTime, sessionState, sessionSummary } from '../lib/stats';
import { CloseSessionButton } from './Profil';

export function Grille({ day: dayParam }: { day?: string }) {
  const store = useStore();
  const { byDay, dayList, elo, closedDays, runs } = store;
  const day = dayParam && byDay.has(dayParam) ? dayParam : dayList.at(-1);
  const idx = day ? dayList.indexOf(day) : -1;
  const s = useMemo(() => (day ? sessionSummary(day, byDay.get(day)!, elo) : null), [day, byDay, elo]);
  if (!day || !s) return <Empty>Aucune course pour l'instant. Les résultats apparaîtront ici dès la première réponse au formulaire.</Empty>;

  const state = sessionState(day, s.races, closedDays);
  const prev = dayList[idx - 1], next = dayList[idx + 1];
  const surpBest = s.surperf[0];
  const lastRaceId = s.races.at(-1)!.id;
  const hot = runs.filter((r) => r.ongoing && r.end.id >= s.races[0].id && r.end.id <= lastRaceId && r.length >= 3)
    .sort((a, b) => b.length - a.length)[0];

  return (
    <div className="page">
      <header className="session-head">
        <div className="session-nav">
          {prev ? <a className="navbtn" href={href('grille', prev)} aria-label="Session précédente">‹</a> : <span className="navbtn off">‹</span>}
          <div className="session-title">
            <span className={`state state-${state}`}>{state === 'live' ? 'En course' : 'Drapeau à damier'}</span>
            <h1>{fmtDay(day)}</h1>
            <p className="session-meta">
              <b>{s.races.length}</b> courses · {fmtTime(s.start)} → {fmtTime(s.end)} · ≈ {fmtDuration(s.minutes)} de jeu · {s.players.length} pilotes
            </p>
          </div>
          {next ? <a className="navbtn" href={href('grille', next)} aria-label="Session suivante">›</a> : <span className="navbtn off">›</span>}
        </div>
        {state === 'live' && <CloseSessionButton day={day} />}
      </header>

      <div className="podium" aria-label="Podium du jour">
        {[1, 0, 2].map((i) => s.table[i] && (
          <a key={i} className={`step step-${i + 1}`} href={href('pilote', s.table[i].name)}>
            <Badge name={s.table[i].name} size={i === 0 ? 56 : 44} />
            <span className="step-name">{s.table[i].name}</span>
            <span className="step-avg num">{s.table[i].avg.toFixed(2).replace('.', ',')}</span>
            <span className="step-block"><span className="step-rank">{i + 1}</span></span>
          </a>
        ))}
      </div>

      <div className="tiles">
        <Tile label="MVP" tone="accent" value={<PlayerTag name={s.mvp.name} />} sub={`${s.mvp.wins} victoire${s.mvp.wins > 1 ? 's' : ''} sur ${s.mvp.races}`} />
        {s.flop && <Tile label="Lanterne rouge" tone="bad" value={<PlayerTag name={s.flop.name} />} sub={`${s.flop.places[3]} fois 4e sur ${s.flop.races}`} />}
        {surpBest && surpBest.gain > 0.5 && (
          <Tile label="Surperformance" tone="good" value={<PlayerTag name={surpBest.name} />}
            sub={`+${surpBest.gain.toFixed(1).replace('.', ',')} places vs sa cote`} />
        )}
        {hot && (
          <Tile label={hot.kind === 'win' ? 'Série en cours' : 'Spirale en cours'} tone={hot.kind === 'win' ? 'good' : 'bad'}
            value={<PlayerTag name={hot.name} />} sub={`${hot.length} ${hot.kind === 'win' ? 'victoires' : 'dernières places'} d'affilée`} />
        )}
      </div>

      <Section title="Course par course" aside={<span className="hint">positions du groupe, 1 à 4</span>}>
        <LapChart races={s.races} />
      </Section>

      <Section title="Classement du jour">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Pilote</th><th className="r">Moy.</th><th className="r">Courses</th><th>Places</th><th className="r" title="Places gagnées par rapport à la position attendue selon la cote">Vs cote</th></tr></thead>
            <tbody>
              {s.table.map((r) => {
                const g = s.surperf.find((x) => x.name === r.name)!.gain;
                return (
                  <tr key={r.name}>
                    <td className="rank">{r.rank}</td>
                    <td><PlayerTag name={r.name} /></td>
                    <td className="r"><Avg v={r.avg} /></td>
                    <td className="r num">{r.races}</td>
                    <td className="places-cell"><PlacesBar places={r.places} total={r.races} /><span className="places-txt num">{r.places.join(' · ')}</span></td>
                    <td className={`r num ${g > 0.5 ? 'good' : g < -0.5 ? 'bad' : ''}`}>{g > 0 ? '+' : ''}{g.toFixed(1).replace('.', ',')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Feuille de course" aside={<span className="hint">{s.races.length} saisies</span>}>
        <ol className="racelog">
          {[...s.races].reverse().map((r, k) => (
            <li key={r.id}>
              <span className="racelog-n num">{s.races.length - k}</span>
              <span className="racelog-t num">{fmtTime(r.ts)}</span>
              <span className="racelog-p">
                {r.p.map((n, i) => <span key={n} className="racelog-entry"><Pos n={i + 1} /><a href={href('pilote', n)}>{n}</a></span>)}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
