import { useMemo } from 'react';
import { DuelBars } from '../components/charts';
import { Badge, Empty, Pos, Section, Tile } from '../components/ui';
import { href } from '../router';
import { useStore } from '../store';
import { duel, fmtAvg, fmtMonth, fmtPct, fmtShort } from '../lib/stats';

export function Duel({ a: aParam, b: bParam }: { a?: string; b?: string }) {
  const { races, activeNames, player, elo, lastSeen } = useStore();
  const options = [...new Set([...activeNames, ...lastSeen.keys()])].filter((n) => n !== 'Other');
  const byRating = [...activeNames].sort((x, y) => (elo.rating.get(y) ?? 0) - (elo.rating.get(x) ?? 0));
  const a = aParam && options.includes(aParam) ? aParam : byRating[0];
  const b = bParam && options.includes(bParam) && bParam !== a ? bParam : byRating.find((n) => n !== a)!;
  const d = useMemo(() => duel(a, b, races, elo), [a, b, races, elo]);
  const go = (x: string, y: string) => { window.location.hash = href('duel', x, y); };
  const ca = player(a).color, cb = player(b).color;
  const n = d.shared.length;

  return (
    <div className="page">
      <header className="page-head"><h1>Duel</h1></header>
      <div className="duel-pick">
        <select id="duel-a" aria-label="Premier pilote" value={a} onChange={(e) => go(e.target.value, e.target.value === b ? a : b)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="swap" onClick={() => go(b, a)} aria-label="Inverser">⇄</button>
        <select id="duel-b" aria-label="Second pilote" value={b} onChange={(e) => go(e.target.value === a ? b : a, e.target.value)}>
          {options.filter((o) => o !== a).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {n === 0 ? <Empty>{a} et {b} n'ont jamais couru ensemble.</Empty> : (
        <>
          <div className="scoreboard" style={{ '--ca': ca, '--cb': cb } as React.CSSProperties}>
            <a className="sb-side" href={href('pilote', a)}><Badge name={a} size={48} /><span className="sb-name">{a}</span></a>
            <div className="sb-score">
              <span className="num">{d.aheadA}</span><span className="sb-sep">–</span><span className="num">{n - d.aheadA}</span>
            </div>
            <a className="sb-side" href={href('pilote', b)}><Badge name={b} size={48} /><span className="sb-name">{b}</span></a>
            <div className="sb-bar" aria-hidden="true"><span style={{ width: `${(d.aheadA / n) * 100}%` }} /></div>
            <span className="sb-hint hint">{a} devant {d.aheadA} fois sur {n} courses ensemble</span>
          </div>

          <div className="tiles">
            <Tile label="Prochain duel" value={`${fmtPct(d.probA)} pour ${a}`} sub="probabilité d'après les cotes" tone="accent" />
            <Tile label="Moyenne quand ils courent ensemble" value={<span className="num">{fmtAvg(d.avgA)} / {fmtAvg(d.avgB)}</span>} sub={`${a} / ${b}`} />
            <Tile label="Plus longue domination" value={d.bestRunA >= d.bestRunB ? `${a} · ${d.bestRunA}` : `${b} · ${d.bestRunB}`} sub="courses d'affilée devant l'autre" />
            {d.currentRun && <Tile label="En ce moment" value={`${d.currentRun.who} · ${d.currentRun.length}`} sub="courses d'affilée devant" tone="good" />}
          </div>

          {d.monthly.length > 1 && (
            <Section title="Mois par mois" aside={<span className="hint">part des courses où {a} finit devant</span>}>
              <DuelBars colorA={ca} colorB={cb} rows={d.monthly.slice(-12).map((m) => ({ label: fmtMonth(m.month, true), pct: m.aheadA / m.shared, n: m.shared }))} />
            </Section>
          )}

          <Section title="Derniers affrontements">
            <ol className="racelog">
              {d.shared.slice(-10).reverse().map((r) => (
                <li key={r.id}>
                  <span className="racelog-t num">{fmtShort(r.day)}</span>
                  <span className="racelog-p">
                    <span className="racelog-entry"><Pos n={r.p.indexOf(a) + 1} /><span>{a}</span></span>
                    <span className="racelog-entry"><Pos n={r.p.indexOf(b) + 1} /><span>{b}</span></span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </div>
  );
}
