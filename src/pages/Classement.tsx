import { useMemo, useState } from 'react';
import { Avg, Badge, Delta, Empty, PlacesBar, PlayerTag } from '../components/ui';
import { useStore } from '../store';
import {
  inPeriod, nextPeriod, Period, PERIOD_LABELS, PeriodKind, periodOf, previousPeriod, rankedWithEvolution, standings,
} from '../lib/stats';
import { href } from '../router';

const KINDS: PeriodKind[] = ['day', 'month', 'quarter', 'semester', 'year', 'all'];

function readPref<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
}
function writePref(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ }
}

export function Classement() {
  const { races, dayList, player } = useStore();
  const [kind, setKindRaw] = useState<PeriodKind>(() => readPref('mk.period', 'month'));
  const [activeOnly, setActiveOnlyRaw] = useState<boolean>(() => readPref('mk.activeOnly', true));
  const [period, setPeriod] = useState<Period>(() => periodOf(kind, dayList.at(-1) ?? '2026-01-01'));
  const setKind = (k: PeriodKind) => { setKindRaw(k); writePref('mk.period', k); setPeriod(periodOf(k, dayList.at(-1)!)); };
  const setActiveOnly = (v: boolean) => { setActiveOnlyRaw(v); writePref('mk.activeOnly', v); };

  const prev = previousPeriod(period, dayList);
  const next = nextPeriod(period, dayList);
  const rows = useMemo(() => {
    const cur = standings(inPeriod(races, period));
    const before = prev ? standings(inPeriod(races, prev)) : null;
    return rankedWithEvolution(cur, before);
  }, [races, period, prev?.key]);
  const shown = rows.filter((r) => !activeOnly || player(r.name).active);
  const total = inPeriod(races, period).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Classement</h1>
        <div className="segmented" role="tablist" aria-label="Période">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>{PERIOD_LABELS[k]}</button>
          ))}
        </div>
        <div className="period-nav">
          <button className="navbtn" disabled={!prev} onClick={() => prev && setPeriod(prev)} aria-label="Période précédente">‹</button>
          <div className="period-label">
            <span className="period-name">{period.label}</span>
            <span className="hint">{total} courses</span>
          </div>
          <button className="navbtn" disabled={!next} onClick={() => next && setPeriod(next)} aria-label="Période suivante">›</button>
        </div>
      </header>

      {shown.length === 0 ? <Empty>Pas de course sur cette période.</Empty> : (
        <>
          <div className="podium podium-compact">
            {[1, 0, 2].map((i) => shown[i] && (
              <a key={i} className={`step step-${i + 1}`} href={href('pilote', shown[i].name)}>
                <Badge name={shown[i].name} size={i === 0 ? 52 : 40} />
                <span className="step-name">{shown[i].name}</span>
                <span className="step-avg num">{shown[i].avg.toFixed(2).replace('.', ',')}</span>
                <span className="step-block"><span className="step-rank">{i + 1}</span></span>
              </a>
            ))}
          </div>

          <label className="toggle">
            <input id="active-only" type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            <span>Pilotes actifs uniquement</span>
          </label>

          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th></th><th>Pilote</th><th className="r">Moy.</th><th className="r">Courses</th><th className="r">Vict.</th><th>Places</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.name}>
                    <td className="rank">{i + 1}</td>
                    <td><Delta delta={r.delta} isNew={r.isNew} /></td>
                    <td><PlayerTag name={r.name} sub={player(r.name).active ? undefined : 'ancien'} /></td>
                    <td className="r"><Avg v={r.avg} /></td>
                    <td className="r num">{r.races}</td>
                    <td className="r num">{r.wins}</td>
                    <td className="places-cell"><PlacesBar places={r.places} total={r.races} /><span className="places-txt num">{Math.round((r.wins / r.races) * 100)} % de 1res</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">Tri : meilleure position moyenne, puis plus de victoires, puis plus de courses. ▲▼ = places gagnées ou perdues par rapport à {prev ? prev.label : 'la période précédente'}.</p>
        </>
      )}
    </div>
  );
}
