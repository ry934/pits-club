import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Avatar, CountUp, Crown, Empty, FormChips, Panel, PlayerTag, Section } from '../components/ui';
import { Emblem } from '../components/Emblem';
import { BADGE, RARITY_LABEL } from '../lib/badges';
import { dailyChallenge, horoscope, nextDeadline, rivalryOfTheDay } from '../lib/daily';
import { dayKey, fmtAvg, fmtDay, fmtMonth, fmtShort, fmtTime, monthKey, sessionSummary, standings } from '../lib/stats';
import { href } from '../router';
import { useStore } from '../store';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function Countdown({ to }: { to: Date }) {
  const now = useNow();
  const s = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 1000));
  const parts = [[Math.floor(s / 3600), 'h'], [Math.floor((s % 3600) / 60), 'min'], [s % 60, 's']] as const;
  return (
    <div className="countdown" role="timer" aria-label={`Clôture dans ${parts[0][0]} heures ${parts[1][0]} minutes`}>
      {parts.map(([v, u]) => <div key={u} className="cd"><b>{pad(v)}</b><span>{u}</span></div>)}
    </div>
  );
}

export function Paddock() {
  const { races, byDay, dayList, elo, activeNames, player, badges } = useStore();
  const today = dayKey(new Date());
  const lastDay = dayList.at(-1)!;
  const month = monthKey(lastDay);
  const season = useMemo(() => standings(races.filter((r) => monthKey(r.day) === month)).filter((s) => s.races >= 10), [races, month]);
  const leader = season[0];
  const second = season[1];
  const last = useMemo(() => sessionSummary(lastDay, byDay.get(lastDay)!, elo), [lastDay, byDay, elo]);
  const allTime = useMemo(() => standings(races).filter((s) => activeNames.includes(s.name)), [races, activeNames]);
  const [astroFor, setAstroFor] = useState(() => activeNames[0]);
  const astro = useMemo(() => horoscope(astroFor, races, today), [astroFor, races, today]);
  const rivalry = useMemo(() => rivalryOfTheDay(races, activeNames, today), [races, activeNames, today]);
  const challenge = useMemo(() => dailyChallenge(today, races, byDay.get(today) ?? []), [today, races, byDay]);
  const deadline = useMemo(() => nextDeadline(), []);
  const feed = useMemo(() => [...badges.events].reverse().filter((e) => BADGE[e.badge].rarity !== 'common').slice(0, 7), [badges]);

  return (
    <div className="page">
      {leader && (
        <div className="chamfer-frame">
          <section className="hero chamfer" style={{ '--c': player(leader.name).color } as CSSProperties}>
            <span className="speed" aria-hidden="true" />
            <span className="hero-ribbon" aria-hidden="true" />
            <div className="hero-avatar"><Crown /><Avatar name={leader.name} size={112} /></div>
            <div className="hero-body">
              <span className="label gold">Championship · saison {fmtMonth(month)}</span>
              <a className="hero-name" href={href('pilote', leader.name)}>{leader.name}</a>
              <span className="muted">Leader du mois, {second ? `${fmtAvg(second.avg - leader.avg)} d'avance sur ${second.name}` : 'seul en tête'}.</span>
              <div className="hero-stats">
                <div className="stat"><span className="label">Moyenne</span><span className="stat-value gold"><CountUp value={leader.avg} decimals={2} /></span></div>
                <div className="stat"><span className="label">Victoires</span><span className="stat-value"><CountUp value={leader.wins} /></span></div>
                <div className="stat"><span className="label">Courses</span><span className="stat-value"><CountUp value={leader.races} /></span></div>
                <div className="stat"><span className="label">Taux de victoire</span><span className="stat-value"><CountUp value={(leader.wins / leader.races) * 100} /> %</span></div>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="grid grid-paddock">
        <div className="stack">
          <Panel hud="cyan" title="Dernière session" aside={<a className="link" href={href('session', lastDay)}>Voir la session</a>}>
            <div className="stack">
              <div>
                <h2 style={{ textTransform: 'none' }}>{fmtDay(lastDay)}</h2>
                <span className="muted">{last.races.length} courses, {fmtTime(last.start)} à {fmtTime(last.end)}, {last.players.length} pilotes</span>
              </div>
              <div className="session-card-podium">
                {last.table.slice(0, 3).map((s, i) => (
                  <div key={s.name} className="mini-step" style={{ '--pc': `var(--p${i + 1})` } as CSSProperties}>
                    <span className="label" style={{ color: `var(--p${i + 1})` }}>P{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex' }}><PlayerTag name={s.name} size={26} /></span>
                    <span className="num muted">{fmtAvg(s.avg)} · {s.wins} vict.</span>
                  </div>
                ))}
              </div>
              {last.flop && <span className="muted">Lanterne rouge : <b className="bad">{last.flop.name}</b>, {last.flop.places[3]} fois 4e.</span>}
            </div>
          </Panel>

          <Section title="Pilotes" aside={<span className="hint">rang all time · moyenne · % de victoires · 5 dernières</span>}>
            <div className="pilot-cards">
              {allTime.map((s, i) => {
                const recent = races.filter((r) => r.p.includes(s.name)).slice(-5).map((r) => r.p.indexOf(s.name) + 1);
                return (
                  <a key={s.name} className="pilot-card" href={href('pilote', s.name)} style={{ '--c': player(s.name).color } as CSSProperties}>
                    <Avatar name={s.name} size={38} />
                    <span className="ptag-name" style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>{s.name}</span>
                    <span className="pc-rank">{i + 1}</span>
                    <span className="pc-meta"><b>{fmtAvg(s.avg)}</b><b>{Math.round((s.wins / s.races) * 100)} %</b><FormChips positions={recent} /></span>
                  </a>
                );
              })}
            </div>
          </Section>

          <Panel hud="yellow" title="Derniers exploits" aside={<a className="link" href="#/trophees">Tous les trophées</a>}>
            {feed.length === 0 ? <Empty>Aucun trophée pour l'instant.</Empty> : (
              <ul className="feed">
                {feed.map((e, k) => (
                  <li key={k} className={e.day === lastDay ? 'fresh' : ''}>
                    <Emblem badge={BADGE[e.badge]} size={36} />
                    <span>
                      <b>{e.player}</b> débloque <b className={`rc-${BADGE[e.badge].family === 'infamie' ? 'infamy' : BADGE[e.badge].rarity}`} style={{ color: 'var(--rc)' }}>{BADGE[e.badge].name}</b>
                      <span className="sub-num">{RARITY_LABEL[BADGE[e.badge].rarity]}{e.detail ? ` · ${e.detail}` : ''}</span>
                    </span>
                    <a className="hint" href={href('session', e.day)}>{fmtShort(e.day)}</a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel hud="purple" title="Takes du jour" className="glow-edge">
            <div className="stack">
              <span className="muted">Clôture des Takes le {fmtDay(dayKey(deadline), false)} à 13h00</span>
              <Countdown to={deadline} />
              <a className="btn btn-purple" href="#/takes">Préparer mon Take</a>
            </div>
          </Panel>

          <Panel hud="purple" title="Horoscope du jour" className="horoscope" aside={
            <select id="astro-player" aria-label="Pilote" value={astroFor} onChange={(e) => setAstroFor(e.target.value)}>
              {activeNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          }>
            <div className="stack">
              <span className="sign">Signe : {astro.sign}</span>
              <ul>{astro.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <span className="hint">Place porte-bonheur : P{astro.lucky}. Version provisoire calculée sur tes stats ; la plume de l'IA arrive au lot 3.</span>
            </div>
          </Panel>

          {rivalry && (
            <Panel hud="red" title="Rivalité du jour" aside={<a className="link" href={href('rivalites', rivalry.a, rivalry.b)}>Duel</a>}>
              <div className="stack">
                <div className="vs">
                  <div className="vs-side"><Avatar name={rivalry.a} size={44} /><b>{rivalry.a}</b><span className="num">{Math.round(rivalry.pct * 100)} %</span></div>
                  <span className="vs-mark">VS</span>
                  <div className="vs-side"><Avatar name={rivalry.b} size={44} /><b>{rivalry.b}</b><span className="num">{Math.round((1 - rivalry.pct) * 100)} %</span></div>
                </div>
                <div className="duel-meter" aria-hidden="true">
                  <span style={{ width: `${rivalry.pct * 100}%`, background: player(rivalry.a).color }} />
                  <span style={{ flex: 1, background: player(rivalry.b).color }} />
                </div>
                <span className="hint">{rivalry.shared} courses ensemble sur 90 jours. Le duel le plus serré du moment.</span>
              </div>
            </Panel>
          )}

          <Panel hud="green" title="Défi du jour">
            <div className="stack">
              <h3>{challenge.title}</h3>
              <span className="muted">{challenge.detail}</span>
              {challenge.results ? (
                <div className="challenge-results">
                  {challenge.results.map((r) => <span key={r.name} className={r.done ? 'ok' : ''}>{r.done ? '✓' : '·'} {r.name} <b className="num">{r.value}</b></span>)}
                </div>
              ) : <span className="hint">À jouer lors de la prochaine session.</span>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
