import { useMemo } from 'react';
import { DuelBars } from '../components/charts';
import { Avatar, Empty, Panel, PlayerTag, Pos, Section, Stat } from '../components/ui';
import { href } from '../router';
import { useStore } from '../store';
import { duel, fmtAvg, fmtMonth, fmtPct, fmtShort, headToHead, recentRivals } from '../lib/stats';

export function Rivalites({ a: aParam, b: bParam }: { a?: string; b?: string }) {
  const { races, activeNames, player, elo, lastSeen } = useStore();
  const options = [...new Set([...activeNames, ...lastSeen.keys()])].filter((n) => n !== 'Other');
  const byRating = [...activeNames].sort((x, y) => (elo.rating.get(y) ?? 0) - (elo.rating.get(x) ?? 0));
  const a = aParam && options.includes(aParam) ? aParam : byRating[0];
  const b = bParam && options.includes(bParam) && bParam !== a ? bParam : byRating.find((n) => n !== a)!;
  const d = useMemo(() => duel(a, b, races, elo), [a, b, races, elo]);
  const refDay = races.at(-1)!.day;
  const h2hA = useMemo(() => headToHead(races, a, lastSeen, refDay), [a, races, lastSeen, refDay]);
  const h2hB = useMemo(() => headToHead(races, b, lastSeen, refDay), [b, races, lastSeen, refDay]);
  const go = (x: string, y: string) => { window.location.hash = href('stats', 'duels', x, y); };
  const ca = player(a).color, cb = player(b).color;
  const n = d.shared.length;
  const recentOf = (name: string) => races.filter((r) => r.p.includes(name)).slice(-10).map((r) => r.p.indexOf(name) + 1);
  const avgOf = (ps: number[]) => ps.reduce((s, x) => s + x, 0) / Math.max(1, ps.length);
  const ra = recentOf(a), rb = recentOf(b);

  const indicator = (name: string, _list: typeof h2hA) => {
    // rivalités du moment : dernières courses du pilote, les absents en sortent d'eux-mêmes
    const { nemesis: nem, victim: vic, window } = recentRivals(races, name);
    return (
      <Panel title={`Indicateurs · ${name}`} aside={<span className="hint">sur ses {window} dernières courses</span>}>
        <div className="stack">
          {nem && <span>Némésis : <a className="bad" href={href('stats', 'duels', name, nem.opp)}><b>{nem.opp}</b></a> <span className="muted">({fmtPct(nem.pct)} devant)</span></span>}
          {vic && <span>Rival le plus dominé : <a className="good" href={href('stats', 'duels', name, vic.opp)}><b>{vic.opp}</b></a> <span className="muted">({fmtPct(vic.pct)} devant)</span></span>}
          {!nem && !vic && <span className="muted">Pas de rivalité marquée sur les dernières courses.</span>}
        </div>
      </Panel>
    );
  };

  return (
    <>
      <div className="duel-pick">
        <select id="duel-a" aria-label="Premier pilote" value={a} onChange={(e) => go(e.target.value, e.target.value === b ? a : b)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="iconbtn" onClick={() => go(b, a)} aria-label="Inverser les pilotes">⇄</button>
        <select id="duel-b" aria-label="Second pilote" value={b} onChange={(e) => go(e.target.value === a ? b : a, e.target.value)}>
          {options.filter((o) => o !== a).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {n === 0 ? <Empty>{a} et {b} n'ont jamais couru ensemble.</Empty> : (
        <>
          <div className="chamfer-frame">
            <div className="scoreboard chamfer">
              <a className="sb-side" href={href('stats', 'pilote', a)}><Avatar name={a} size={64} /><span className="sb-name" style={{ color: ca }}>{a}</span></a>
              <div className="sb-score"><span>{d.aheadA}</span><span className="sb-sep">VS</span><span>{n - d.aheadA}</span></div>
              <a className="sb-side" href={href('stats', 'pilote', b)}><Avatar name={b} size={64} /><span className="sb-name" style={{ color: cb }}>{b}</span></a>
              <div className="sb-bar" aria-hidden="true"><span style={{ width: `${(d.aheadA / n) * 100}%`, background: ca }} /><span style={{ flex: 1, background: cb }} /></div>
              <span className="sb-hint hint">{a} finit devant dans {d.aheadA} des {n} courses disputées ensemble</span>
            </div>
          </div>

          <div className="kpis">
            <Panel hud="purple"><Stat label="Prochain duel" tone="violet" value={fmtPct(d.probA)} sub={`chances pour ${a}, d'après les cotes`} /></Panel>
            <Panel><Stat label="Moyenne ensemble" value={<span className="num">{fmtAvg(d.avgA)} / {fmtAvg(d.avgB)}</span>} sub={`${a} / ${b}`} /></Panel>
            <Panel hud="yellow"><Stat label="Plus longue domination" tone="gold" value={d.bestRunA >= d.bestRunB ? `${a} · ${d.bestRunA}` : `${b} · ${d.bestRunB}`} sub="courses d'affilée devant l'autre" /></Panel>
            {d.currentRun && <Panel hud="green"><Stat label="Dynamique actuelle" tone="good" value={`${d.currentRun.who} · ${d.currentRun.length}`} sub="courses d'affilée devant" /></Panel>}
          </div>

          <Section title="Forme récente" aside={<span className="hint">10 dernières courses de chacun</span>}>
            <Panel>
              <div className="form-compare">
                <PlayerTag name={a} /><span className="row-chips">{ra.map((p, i) => <Pos key={i} n={p} />)}<span className="num muted" style={{ marginLeft: 8 }}>{fmtAvg(avgOf(ra))}</span></span>
                <PlayerTag name={b} /><span className="row-chips">{rb.map((p, i) => <Pos key={i} n={p} />)}<span className="num muted" style={{ marginLeft: 8 }}>{fmtAvg(avgOf(rb))}</span></span>
              </div>
            </Panel>
          </Section>

          {d.monthly.length > 1 && (
            <Section title="Historique de la rivalité" aside={<span className="hint">part des courses où {a} finit devant, par mois</span>}>
              <Panel><DuelBars colorA={ca} colorB={cb} rows={d.monthly.slice(-12).map((m) => ({ label: fmtMonth(m.month, true), pct: m.aheadA / m.shared, n: m.shared }))} /></Panel>
            </Section>
          )}

          <div className="grid grid-2">{indicator(a, h2hA)}{indicator(b, h2hB)}</div>

          <Section title="Derniers affrontements">
            <ol className="racelog">
              {d.shared.slice(-8).reverse().map((r) => (
                <li key={r.id} style={{ borderLeftColor: r.p.indexOf(a) < r.p.indexOf(b) ? ca : cb }}>
                  <a className="racelog-t num" href={href('stats', 'session', r.day)}>{fmtShort(r.day)}</a>
                  <span className="racelog-p">
                    <span className="racelog-entry"><Pos n={r.p.indexOf(a) + 1} />{a}</span>
                    <span className="racelog-entry"><Pos n={r.p.indexOf(b) + 1} />{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Matrix />
    </>
  );
}

/** Matrice des face-à-face : % de courses où la ligne finit devant la colonne. */
function Matrix() {
  const { races, activeNames, lastSeen } = useStore();
  const refDay = races.at(-1)!.day;
  const names = activeNames.filter((n) => lastSeen.has(n));
  const table = useMemo(() => new Map(names.map((n) => [n, new Map(headToHead(races, n, lastSeen, refDay).map((h) => [h.opp, h]))])), [races, names.join(), lastSeen, refDay]);
  const color = (pct: number) => {
    const v = (pct - 0.5) * 2;
    return v >= 0 ? `rgba(73, 245, 161, ${0.12 + v * 0.6})` : `rgba(255, 64, 87, ${0.12 - v * 0.6})`;
  };
  return (
    <Section title="Matrice des rivalités" aside={<span className="hint">ligne devant colonne · 10 courses communes min.</span>}>
      <div className="table-wrap" style={{ padding: 8 }}>
        <table className="matrix">
          <thead><tr><th />{names.map((n) => <th key={n} scope="col">{n.slice(0, 4)}</th>)}</tr></thead>
          <tbody>
            {names.map((r) => (
              <tr key={r}>
                <th className="row" scope="row">{r}</th>
                {names.map((c) => {
                  if (r === c) return <td key={c} className="self" />;
                  const h = table.get(r)?.get(c);
                  return (
                    <td key={c} style={{ background: h ? color(h.pct) : 'transparent' }}>
                      {h ? <a href={href('stats', 'duels', r, c)} title={`${r} devant ${c} : ${fmtPct(h.pct)} sur ${h.shared} courses`}>{Math.round(h.pct * 100)}</a> : <span className="muted">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

