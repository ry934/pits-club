import { CSSProperties, useMemo } from 'react';
import { Avatar, Avg, FormChips, Panel, Stat } from '../components/ui';
import { horoscope } from '../lib/daily';
import { greeting } from '../lib/greeting';
import { dayKey, fmtAvg, fmtDay, fmtMonth, fmtShort, headToHead, monthKey, standings } from '../lib/stats';
import { href } from '../router';
import { useStore } from '../store';

/** Haut de page personnel : accueil chambreur, journée, saison, forme et horoscope du pilote connecté. */
export function MyPaddock({ name }: { name: string }) {
  const { races, player, lastSeen } = useStore();
  const p = player(name);
  const display = p.displayName ?? name;
  const now = new Date();
  const today = dayKey(now);
  const hello = useMemo(() => greeting(name, display, races, now), [name, display, races, today]);
  const astro = useMemo(() => horoscope(name, races, today), [name, races, today]);
  const mine = useMemo(() => races.filter((r) => r.p.includes(name)), [races, name]);

  const todayRaces = races.filter((r) => r.day === today);
  const todayTable = standings(todayRaces);
  const meToday = todayTable.find((t) => t.name === name);
  const lastDay = mine.at(-1)?.day;
  const lastTable = lastDay ? standings(races.filter((r) => r.day === lastDay)) : [];
  const meLast = lastTable.find((t) => t.name === name);

  const refMonth = monthKey(today);
  const season = standings(races.filter((r) => monthKey(r.day) === refMonth));
  const meSeason = season.find((s) => s.name === name);
  const all = standings(mine).find((s) => s.name === name);
  const recent = mine.slice(-20);
  const form = recent.length ? recent.reduce((s, r) => s + r.p.indexOf(name) + 1, 0) / recent.length : null;
  const nem = useMemo(() => [...headToHead(races, name, lastSeen, races.at(-1)?.day ?? today)].sort((a, b) => a.pct - b.pct)[0], [races, name, lastSeen, today]);

  return (
    <>
      <div className="chamfer-frame">
        <section className="hero chamfer me-hero" style={{ '--c': p.color } as CSSProperties}>
          <span className="speed" aria-hidden="true" />
          <div className="hero-avatar"><Avatar name={name} size={96} /></div>
          <div className="hero-body">
            <span className="label cyan">Ton paddock · {fmtDay(today, false)}</span>
            <p className="me-hello">{hello}</p>
            <a className="link" href={href('pilote', name)}>Voir ma fiche complète</a>
          </div>
        </section>
      </div>

      <div className="kpis">
        <Panel hud="cyan">
          {meToday
            ? <Stat label="Aujourd'hui" value={<>{meToday.rank}<span className="muted" style={{ fontSize: '0.55em' }}> / {todayTable.length}</span></>} sub={`${fmtAvg(meToday.avg)} de moyenne · ${meToday.races} courses · ${meToday.wins} vict.`} />
            : <Stat label="Aujourd'hui" value="À jouer" sub={meLast ? `Dernière session le ${fmtShort(lastDay!)} : ${meLast.rank}e sur ${lastTable.length}` : 'Pas encore de course'} />}
        </Panel>
        <Panel hud="yellow">
          {meSeason
            ? <Stat label={`Saison ${fmtMonth(refMonth)}`} tone={meSeason.rank === 1 ? 'gold' : ''} value={<>{meSeason.rank}<span className="muted" style={{ fontSize: '0.55em' }}> / {season.length}</span></>} sub={`${fmtAvg(meSeason.avg)} de moyenne · ${meSeason.races} courses`} />
            : <Stat label={`Saison ${fmtMonth(refMonth)}`} value="–" sub="Pas encore couru ce mois-ci" />}
        </Panel>
        <Panel>
          <Stat label="Forme · 20 courses" tone={form !== null && all ? (form < all.avg - 0.15 ? 'good' : form > all.avg + 0.15 ? 'bad' : '') : ''}
            value={form !== null ? <Avg v={form} /> : '–'} sub={all ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>all time {fmtAvg(all.avg)} <FormChips positions={mine.slice(-8).map((r) => r.p.indexOf(name) + 1)} /></span> : undefined} />
        </Panel>
        {nem && (
          <Panel hud="red">
            <Stat label="Ta némésis" tone="bad" value={nem.opp} sub={`tu ne finis devant que ${Math.round(nem.pct * 100)} % du temps`} />
          </Panel>
        )}
      </div>

      <Panel hud="purple" title="Ton horoscope du jour" className="horoscope">
        <div className="stack">
          <span className="sign">Signe : {astro.sign}</span>
          <ul>{astro.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <span className="hint">Place porte-bonheur : P{astro.lucky}.</span>
        </div>
      </Panel>
    </>
  );
}
