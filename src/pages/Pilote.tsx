import { CSSProperties, useMemo } from 'react';
import { AvgBars, TrendChart } from '../components/charts';
import { Emblem } from '../components/Emblem';
import { Avatar, Avg, Empty, Panel, PlayerTag, Pos, Section, Stat } from '../components/ui';
import { BADGES } from '../lib/badges';
import { fmtAvg, fmtDuration, fmtMonth, fmtPct, fmtShort, playerProfile, WEEKDAYS } from '../lib/stats';
import { SETTINGS } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store';

export function Pilote({ name }: { name: string }) {
  const { races, elo, runs, days, activeNames, player, badges } = useStore();
  const p = player(name);
  const prof = useMemo(() => playerProfile(name, races, elo, runs, days, activeNames), [name, races, elo, runs, days, activeNames]);
  if (!prof.all) return <div className="page"><Empty>Aucune course trouvée pour {name}.</Empty></div>;
  const a = prof.all;
  const rating = prof.ratingHistory.slice(-60);
  const monthly = prof.monthly.slice(-12);
  const held = badges.held.get(name);
  const formTone = prof.formDelta === null ? '' : prof.formDelta > 0.15 ? 'good' : prof.formDelta < -0.15 ? 'bad' : '';

  return (
    <div className="page">
      <div className="chamfer-frame">
        <header className="pilot-head chamfer" style={{ '--c': p.color } as CSSProperties}>
          <Avatar name={name} size={84} />
          <div>
            <span className="label">{p.active ? 'Pilote actif' : 'Ancien pilote'} · depuis le {fmtShort(prof.firstDay)}</span>
            <h1>{p.displayName ?? name}</h1>
            <span className="muted">{a.races} courses · ≈ {fmtDuration(prof.minutes)} de jeu · {held?.size ?? 0} trophées · dernière course le {fmtShort(prof.lastDay)}</span>
          </div>
        </header>
      </div>

      <div className="kpis">
        <Panel hud="yellow"><Stat label="Moyenne all time" tone="gold" value={<Avg v={a.avg} />} sub={`${a.wins} victoires · ${fmtPct(a.wins / a.races)}`} /></Panel>
        <Panel><Stat label={`Saison ${prof.monthLabel}`} value={prof.month ? <Avg v={prof.month.avg} /> : '–'} sub={prof.month ? `${prof.month.races} courses` : 'pas encore couru ce mois-ci'} /></Panel>
        <Panel><Stat label="Forme · 20 courses" tone={formTone} value={prof.form ? <Avg v={prof.form.avg} /> : '–'} sub={prof.formDelta === null ? 'pas assez de courses' : prof.formDelta > 0 ? 'mieux que d\'habitude' : 'moins bien que d\'habitude'} /></Panel>
        <Panel><Stat label="Cote" tone="cyan" value={<span className="num">{Math.round(prof.rating)}</span>} sub={p.active ? `${prof.ratingRank}e cote du groupe` : 'cote figée'} /></Panel>
      </div>

      {held && held.size > 0 && (
        <Section title="Trophées" aside={<a className="link" href="#/trophees">Galerie</a>}>
          <div className="badge-strip">
            {BADGES.filter((b) => held.has(b.id)).map((b) => (
              <a key={b.id} href="#/trophees" title={`${b.condition} Débloqué le ${fmtShort(held.get(b.id)!.first)}.`}>
                <Emblem badge={b} size={54} />
                <b style={{ color: 'var(--white)' }}>{b.name}</b>
                <span>×{held.get(b.id)!.count}</span>
              </a>
            ))}
          </div>
        </Section>
      )}

      <div className="grid grid-2">
        <Panel title="Répartition des places">
          <div className="dist">
            {a.places.map((n, i) => (
              <div key={i} className="dist-col">
                <span className="dist-bar-wrap"><span className={`dist-bar pl-${i + 1}`} style={{ height: `${(n / Math.max(...a.places)) * 100}%` }} /></span>
                <Pos n={i + 1} /><span className="num">{n}</span><span className="hint">{fmtPct(n / a.races)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Séries">
          <div className="stack">
            <Stat label="En cours" tone={prof.current ? (prof.current.kind === 'win' ? 'good' : 'bad') : ''}
              value={prof.current ? `${prof.current.length} ${prof.current.kind === 'win' ? 'victoires' : 'fois 4e'}` : 'Aucune'} />
            <div className="grid grid-2">
              <Stat label="Record de victoires" tone="gold" value={prof.bestWin ? `${prof.bestWin.length}` : '–'} sub={prof.bestWin ? `le ${fmtShort(prof.bestWin.start.day)}` : undefined} />
              <Stat label="Pire série de 4e" tone="bad" value={prof.bestLast ? `${prof.bestLast.length}` : '–'} sub={prof.bestLast ? `le ${fmtShort(prof.bestLast.start.day)}` : undefined} />
              {prof.bestDay && <Stat label="Meilleure journée" tone="gold" value={<Avg v={prof.bestDay.avg} />} sub={`${fmtShort(prof.bestDay.day)}, ${prof.bestDay.races} courses`} />}
              {prof.worstDay && <Stat label="Pire journée" tone="bad" value={<Avg v={prof.worstDay.avg} />} sub={`${fmtShort(prof.worstDay.day)}, ${prof.worstDay.races} courses`} />}
            </div>
          </div>
        </Panel>
      </div>

      {(prof.nemesis || prof.victim) && (
        <Section title="Rivalités" aside={<span className="hint">{SETTINGS.minSharedH2H} courses ensemble minimum</span>}>
          <div className="rivals">
            {prof.nemesis && (
              <a href={href('rivalites', name, prof.nemesis.opp)}><Panel hud="red" className="rival">
                <span className="label bad">Némésis</span><PlayerTag name={prof.nemesis.opp} link={false} />
                <span>{name} ne finit devant que <b>{fmtPct(prof.nemesis.pct)}</b> du temps ({prof.nemesis.shared} courses).</span>
              </Panel></a>
            )}
            {prof.victim && (
              <a href={href('rivalites', name, prof.victim.opp)}><Panel hud="green" className="rival">
                <span className="label good">Victime favorite</span><PlayerTag name={prof.victim.opp} link={false} />
                <span>{name} finit devant <b>{fmtPct(prof.victim.pct)}</b> du temps ({prof.victim.shared} courses).</span>
              </Panel></a>
            )}
          </div>
        </Section>
      )}

      <div className="grid grid-2">
        {monthly.length > 2 && (
          <Panel hud="cyan" title="Moyenne par mois" aside={<span className="hint">plus haut = meilleur</span>}>
            <TrendChart labels={monthly.map((m) => fmtMonth(m.month, true))} best
              series={[{ name, color: 'var(--cyan)', values: monthly.map((m) => m.avg), counts: monthly.map((m) => m.races) }]}
              min={1} max={4} invert ticks={[1, 2, 3, 4]} format={(v) => (Number.isInteger(v) ? String(v) : fmtAvg(v))} />
          </Panel>
        )}
        {rating.length > 2 && (
          <Panel hud="cyan" title="Évolution de la cote" aside={<span className="hint">{rating.length} dernières sessions</span>}>
            <TrendChart labels={rating.map((r) => fmtShort(r.day))} best
              series={[{ name: 'Cote', color: 'var(--cyan)', values: rating.map((r) => r.rating) }]} format={(v) => String(Math.round(v))} />
          </Panel>
        )}
      </div>

      {prof.weekdays.length > 0 && (
        <Panel title="Selon le jour" aside={<span className="hint">position moyenne · meilleur jour en jaune</span>}>
          <AvgBars rows={prof.weekdays.map((w) => ({ label: WEEKDAYS[w.day], avg: w.avg, n: w.races }))} />
        </Panel>
      )}

      <Section title="Dernières courses">
        <div className="last-races">
          {prof.lastRaces.map(({ race, pos }) => <a key={race.id} href={href('session', race.day)} title={fmtShort(race.day)}><Pos n={pos} /></a>)}
        </div>
      </Section>
    </div>
  );
}
