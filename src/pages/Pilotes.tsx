import { useMemo } from 'react';
import { AvgBars, LineChart } from '../components/charts';
import { Avg, Badge, Empty, PlacesBar, PlayerTag, Pos, Section, Tile } from '../components/ui';
import { href } from '../router';
import { useStore } from '../store';
import { fmtAvg, fmtDuration, fmtMonth, fmtPct, fmtShort, playerProfile, standings, WEEKDAYS } from '../lib/stats';
import { SETTINGS } from '../lib/types';

export function Pilotes() {
  const { races, players, elo, runs, lastSeen } = useStore();
  const all = useMemo(() => new Map(standings(races).map((s) => [s.name, s])), [races]);
  const withRaces = players.filter((p) => all.has(p.name));
  const active = withRaces.filter((p) => p.active).sort((a, b) => all.get(a.name)!.avg - all.get(b.name)!.avg);
  const former = withRaces.filter((p) => !p.active).sort((a, b) => all.get(b.name)!.races - all.get(a.name)!.races);
  const card = (name: string) => {
    const s = all.get(name)!;
    const cur = runs.find((r) => r.name === name && r.ongoing && r.length >= 2);
    return (
      <a key={name} className="pilot-card" href={href('pilote', name)} style={{ '--c': players.find((p) => p.name === name)?.color } as React.CSSProperties}>
        <Badge name={name} size={44} />
        <span className="pilot-card-body">
          <span className="pilot-card-name">{name}</span>
          <span className="pilot-card-meta"><b className="num">{fmtAvg(s.avg)}</b> de moyenne · {s.races} courses</span>
          <span className="pilot-card-meta">Cote <b className="num">{Math.round(elo.rating.get(name) ?? SETTINGS.eloStart)}</b>{cur && <> · {cur.kind === 'win' ? `${cur.length} victoires de suite` : `${cur.length} fois 4e de suite`}</>}</span>
        </span>
        <PlacesBar places={s.places} total={s.races} />
        <span className="hint">vu le {fmtShort(lastSeen.get(name)!)}</span>
      </a>
    );
  };
  return (
    <div className="page">
      <header className="page-head"><h1>Pilotes</h1></header>
      <div className="pilot-grid">{active.map((p) => card(p.name))}</div>
      {former.length > 0 && (
        <Section title="Anciens pilotes">
          <div className="pilot-grid">{former.map((p) => card(p.name))}</div>
        </Section>
      )}
    </div>
  );
}

export function Pilote({ name }: { name: string }) {
  const store = useStore();
  const { races, elo, runs, days, activeNames, player } = store;
  const p = player(name);
  const prof = useMemo(() => playerProfile(name, races, elo, runs, days, activeNames), [name, races, elo, runs, days, activeNames]);
  if (!prof.all) return <div className="page"><Empty>Aucune course trouvée pour {name}.</Empty></div>;
  const a = prof.all;
  const ratingPts = prof.ratingHistory.slice(-90).map((r) => ({ label: fmtShort(r.day), value: r.rating }));
  const monthly = prof.monthly.slice(-12).map((m) => ({ label: fmtMonth(m.month, true), value: m.avg }));
  const formTone = prof.formDelta === null ? undefined : prof.formDelta > 0.15 ? 'good' : prof.formDelta < -0.15 ? 'bad' : undefined;

  return (
    <div className="page" style={{ '--c': p.color } as React.CSSProperties}>
      <header className="pilot-head">
        <Badge name={name} size={72} />
        <div>
          <p className="eyebrow">{p.active ? 'Pilote actif' : 'Ancien pilote'} · depuis le {fmtShort(prof.firstDay)}</p>
          <h1>{p.displayName ?? name}</h1>
          <p className="session-meta">{a.races} courses · ≈ {fmtDuration(prof.minutes)} de jeu · dernière course le {fmtShort(prof.lastDay)}</p>
        </div>
      </header>

      <div className="tiles">
        <Tile label="Moyenne all time" value={<Avg v={a.avg} />} sub={`${a.wins} victoires · ${fmtPct(a.wins / a.races)}`} />
        <Tile label={`Moyenne ${prof.monthLabel}`} value={prof.month ? <Avg v={prof.month.avg} /> : '–'} sub={prof.month ? `${prof.month.races} courses` : 'pas encore couru ce mois-ci'} />
        <Tile label="Forme" tone={formTone} value={prof.form ? <Avg v={prof.form.avg} /> : '–'}
          sub={prof.formDelta === null ? `${prof.form?.races ?? 0} dernières courses` : `${SETTINGS.formWindow} dernières courses, ${prof.formDelta > 0 ? 'mieux' : 'moins bien'} que d'habitude`} />
        <Tile label="Cote" value={<span className="num">{Math.round(prof.rating)}</span>} sub={p.active ? `${prof.ratingRank}e cote du groupe` : 'cote figée'} />
      </div>

      <Section title="Répartition des places">
        <div className="dist">
          {a.places.map((n, i) => (
            <div key={i} className="dist-col">
              <span className="dist-bar-wrap"><span className={`dist-bar pl-${i + 1}`} style={{ height: `${(n / Math.max(...a.places)) * 100}%` }} /></span>
              <Pos n={i + 1} />
              <span className="num">{n}</span>
              <span className="hint">{fmtPct(n / a.races)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Séries">
        <div className="tiles">
          <Tile label="En cours" tone={prof.current ? (prof.current.kind === 'win' ? 'good' : 'bad') : undefined}
            value={prof.current ? `${prof.current.length} ${prof.current.kind === 'win' ? 'victoires' : 'fois 4e'}` : 'Aucune'}
            sub={prof.current ? `depuis le ${fmtShort(prof.current.start.day)}` : 'pas de série de 2 ou plus'} />
          <Tile label="Record de victoires" value={prof.bestWin ? `${prof.bestWin.length} d'affilée` : '–'} sub={prof.bestWin ? `le ${fmtShort(prof.bestWin.start.day)}` : undefined} />
          <Tile label="Pire série de 4e places" value={prof.bestLast ? `${prof.bestLast.length} d'affilée` : '–'} sub={prof.bestLast ? `le ${fmtShort(prof.bestLast.start.day)}` : undefined} />
          {prof.bestDay && <Tile label="Meilleure journée" value={<Avg v={prof.bestDay.avg} />} sub={`${fmtShort(prof.bestDay.day)}, ${prof.bestDay.races} courses`} />}
        </div>
      </Section>

      {(prof.nemesis || prof.victim) && (
        <Section title="Rivalités" aside={<span className="hint">min. {SETTINGS.minSharedH2H} courses ensemble</span>}>
          <div className="rivals">
            {prof.nemesis && (
              <a className="rival bad" href={href('duel', name, prof.nemesis.opp)}>
                <span className="eyebrow">Némésis</span>
                <PlayerTag name={prof.nemesis.opp} link={false} />
                <span>{name} ne finit devant que <b>{fmtPct(prof.nemesis.pct)}</b> du temps ({prof.nemesis.shared} courses)</span>
              </a>
            )}
            {prof.victim && (
              <a className="rival good" href={href('duel', name, prof.victim.opp)}>
                <span className="eyebrow">Victime favorite</span>
                <PlayerTag name={prof.victim.opp} link={false} />
                <span>{name} finit devant <b>{fmtPct(prof.victim.pct)}</b> du temps ({prof.victim.shared} courses)</span>
              </a>
            )}
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Adversaire</th><th className="r">Ensemble</th><th className="r">Devant</th><th></th></tr></thead>
              <tbody>
                {prof.h2h.map((h) => (
                  <tr key={h.opp}>
                    <td><PlayerTag name={h.opp} /></td>
                    <td className="r num">{h.shared}</td>
                    <td className={`r num ${h.pct >= 0.55 ? 'good' : h.pct <= 0.45 ? 'bad' : ''}`}>{fmtPct(h.pct)}</td>
                    <td className="r"><a className="link" href={href('duel', name, h.opp)}>Duel ›</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {prof.weekdays.length > 0 && (
        <Section title="Selon le jour" aside={<span className="hint">position moyenne</span>}>
          <AvgBars color={p.color} rows={prof.weekdays.map((w) => ({ label: WEEKDAYS[w.day], avg: w.avg, n: w.races }))} />
        </Section>
      )}

      {ratingPts.length > 2 && (
        <Section title="Évolution de la cote" aside={<span className="hint">{ratingPts.length} dernières journées</span>}>
          <LineChart points={ratingPts} color={p.color} format={(v) => String(Math.round(v))} />
        </Section>
      )}

      {monthly.length > 2 && (
        <Section title="Moyenne par mois" aside={<span className="hint">plus haut = meilleur</span>}>
          <LineChart points={monthly} color={p.color} min={1} max={4} invert ticks={[1, 2, 3, 4]} format={(v) => fmtAvg(v).replace(',00', '')} />
        </Section>
      )}

      <Section title="Dernières courses">
        <div className="last-races">
          {prof.lastRaces.map(({ race, pos }) => <a key={race.id} href={href('grille', race.day)} title={fmtShort(race.day)}><Pos n={pos} /></a>)}
        </div>
      </Section>
    </div>
  );
}
