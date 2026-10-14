import { useMemo } from 'react';
import { Avg, PlayerTag, Section, Tile } from '../components/ui';
import { href } from '../router';
import { useStore } from '../store';
import { fmtDuration, fmtShort, records, Run } from '../lib/stats';

function runDates(r: Run) {
  return r.start.day === r.end.day ? fmtShort(r.start.day) : `${fmtShort(r.start.day)} → ${fmtShort(r.end.day)}`;
}

function Board({ title, rows }: { title: string; rows: { key: string; who?: string; value: React.ReactNode; when: string; whenDay?: string }[] }) {
  return (
    <div className="board">
      <h3>{title}</h3>
      <ol>
        {rows.map((r, i) => (
          <li key={r.key} className={i === 0 ? 'first' : ''}>
            <span className="board-rank num">{i + 1}</span>
            <span className="board-who">{r.who ? <PlayerTag name={r.who} /> : <a href={href('grille', r.whenDay!)}>{r.when}</a>}</span>
            <span className="board-val">{r.value}</span>
            {r.who && <a className="board-when" href={r.whenDay ? href('grille', r.whenDay) : undefined}>{r.when}</a>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Records() {
  const { races, runs, days, flagged, replaced } = useStore();
  const rec = useMemo(() => records(races, runs, days), [races, runs, days]);
  return (
    <div className="page">
      <header className="page-head"><h1>Records</h1></header>
      <div className="tiles">
        <Tile label="Courses" value={<span className="num">{rec.totals.races}</span>} sub={`depuis le ${fmtShort(rec.totals.first!)}`} />
        <Tile label="Sessions" value={<span className="num">{rec.totals.days}</span>} />
        <Tile label="Temps de jeu" value={fmtDuration(rec.totals.minutes)} sub="≈ 2,77 min par course" />
      </div>
      <div className="boards">
        <Board title="Victoires d'affilée" rows={rec.winRuns.map((r) => ({ key: r.name + r.start.id, who: r.name, value: <b className="num">{r.length}</b>, when: runDates(r), whenDay: r.start.day }))} />
        <Board title="Dernières places d'affilée" rows={rec.lastRuns.map((r) => ({ key: r.name + r.start.id, who: r.name, value: <b className="num">{r.length}</b>, when: runDates(r), whenDay: r.start.day }))} />
        <Board title="Meilleures journées" rows={rec.bestDays.map((d) => ({ key: d.name + d.day, who: d.name, value: <><Avg v={d.avg} /> <span className="hint">({d.races})</span></>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board title="Pires journées" rows={rec.worstDays.map((d) => ({ key: d.name + d.day, who: d.name, value: <><Avg v={d.avg} /> <span className="hint">({d.races})</span></>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board title="Plus de victoires en un jour" rows={rec.mostWins.map((d) => ({ key: d.name + d.day, who: d.name, value: <span className="num"><b>{d.wins}</b> / {d.races}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board title="Plus de 4e places en un jour" rows={rec.mostLasts.map((d) => ({ key: d.name + d.day, who: d.name, value: <span className="num"><b>{d.lasts}</b> / {d.races}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board title="Plus grosses sessions" rows={rec.biggestDays.map((d) => ({ key: d.day, value: <span className="num"><b>{d.races}</b> courses · {fmtDuration(d.minutes)}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
      </div>
      <p className="footnote">Records de journée : minimum 5 courses dans la journée. Les séries suivent l'ordre chronologique, même à cheval sur plusieurs sessions.</p>

      <Section title="Saisies à corriger" aside={<span className="hint">{flagged.length} courses écartées · {replaced.length} doubles saisies fusionnées</span>}>
        {flagged.length === 0 ? <p className="hint">Rien à corriger.</p> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Date</th><th>Saisie</th><th>Problème</th></tr></thead>
              <tbody>
                {[...flagged].reverse().map((f) => (
                  <tr key={f.ts}>
                    <td className="num">{fmtShort(f.ts.slice(0, 10))} {f.ts.slice(11, 16).replace(':', 'h')}</td>
                    <td>{f.p.join(' · ')}</td>
                    <td className="bad">{f.p.find((n, i) => f.p.indexOf(n) !== i)} saisi deux fois</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="footnote">Une course où le même nom apparaît deux fois est exclue des stats. Corrige la ligne dans le Sheet : elle sera reprise à la synchro suivante. Deux saisies à moins de 60 secondes d'écart : seule la seconde est gardée.</p>
      </Section>
    </div>
  );
}
