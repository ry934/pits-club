import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { AvgBars, TrendChart } from '../components/charts';
import { Emblem } from '../components/Emblem';
import { Heatmap } from '../components/Heatmap';
import { BADGES, Holding } from '../lib/badges';
import { Session } from './Session';
import { Rivalites } from './Rivalites';
import { Avg, Avatar, Cote, Delta, Empty, Panel, PlacesBar, PlayerTag, Pos, Section, Stat } from '../components/ui';
import { useAuth } from '../auth';
import { H2HRow, playerSheet, PlayerSheet, Trend, TREND_BEFORE, TREND_RECENT, trendOf } from '../lib/sheet';
import { useStore } from '../store';
import {
  dayKey, fmtAvg, fmtDay, fmtDuration, fmtMonth, fmtShort, monthKey, parseLocal, Period, PERIOD_LABELS, PeriodKind,
  periodOf, playerProfile, previousPeriod, nextPeriod, rankedWithEvolution, ratingAt, records, Run, standings, fmtTime, WEEKDAYS,
} from '../lib/stats';
import { Race } from '../lib/types';
import { href } from '../router';

type Tab = 'classement' | 'pilote' | 'session' | 'duels' | 'records';
const TABS: { key: Tab; label: string }[] = [
  { key: 'classement', label: 'Classement' }, { key: 'pilote', label: 'Pilote' }, { key: 'session', label: 'Session' },
  { key: 'duels', label: 'Duels' }, { key: 'records', label: 'Records' },
];
/** Anciens onglets, pour que les vieux liens tombent au bon endroit. */
const OLD_TABS: Record<string, Tab> = { sessions: 'session', tendances: 'classement', rivalites: 'duels' };

function readPref<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function writePref(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponible */ } }

export function Stats({ tab: tabParam, arg, arg2 }: { tab?: string; arg?: string; arg2?: string }) {
  const tab = (TABS.find((t) => t.key === tabParam)?.key ?? OLD_TABS[tabParam ?? ''] ?? 'classement') as Tab;
  const { me } = useAuth();
  const { dayList } = useStore();
  const tabHref = (t: Tab) => t === 'pilote' ? href('stats', 'pilote', ...(tab === 'pilote' && arg ? [arg] : me ? [me] : []))
    : t === 'session' ? href('stats', 'session', ...(dayList.includes(dayKey(new Date())) ? [dayKey(new Date())] : [])) : href('stats', t);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Statistiques</h1>
        <nav className="tabs-line" aria-label="Rubriques des statistiques">
          {TABS.map((t) => (
            <a key={t.key} href={tabHref(t.key)} aria-current={t.key === tab ? 'page' : undefined} className={t.key === tab ? 'on' : ''}>{t.label}</a>
          ))}
        </nav>
      </header>
      {tab === 'classement' && <Classement />}
      {tab === 'pilote' && <PiloteTab name={arg} key={arg ?? ''} />}
      {tab === 'session' && <SessionTab day={arg} />}
      {tab === 'duels' && <Rivalites a={arg} b={arg2} />}
      {tab === 'records' && <Records />}
    </div>
  );
}

function SessionTab({ day }: { day?: string }) {
  const { me } = useAuth();
  const { byDay, dayList } = useStore();
  const shown = day && byDay.has(day) ? day : dayList.at(-1);
  return (
    <>
      <Session day={day} afterTable={<Heatmap me={me} selected={shown} title="Retrouver une session" hint="Clique sur un jour pour ouvrir sa session. Le jour affiché est cerclé de blanc." />} />
    </>
  );
}

// ------------------------------------------------------------ Championship

function TrendBadge({ t }: { t: Trend | null }) {
  if (!t) return <span className="muted" title={`Pas assez de courses (il en faut ${TREND_RECENT + 10})`}>–</span>;
  const arrow = { up2: '▲▲', up: '▲', flat: '▬', down: '▼', down2: '▼▼' }[t.level];
  return (
    <span className={`trend trend-${t.level}`} title={`${fmtAvg(t.recent)} sur les ${TREND_RECENT} dernières courses, contre ${fmtAvg(t.before)} sur les ${TREND_BEFORE} précédentes`}>
      <i aria-hidden="true">{arrow}</i>{t.label}
    </span>
  );
}


/** La course à la moyenne : chaque pilote est un kart placé sur une piste qui va de 4 (départ) à 1 (arrivée). */
function AvgRace({ rows, who, onPick }: { rows: { name: string; avg: number; races: number }[]; who: string; onPick: (n: string) => void }) {
  const { player } = useStore();
  const [zoom, setZoom] = useState(true);
  const [go, setGo] = useState(false);
  useEffect(() => { setGo(false); const t = setTimeout(() => setGo(true), 60); return () => clearTimeout(t); }, [rows.length, zoom]);
  if (rows.length < 2) return null;
  const avgs = rows.map((r) => r.avg);
  const lo = zoom ? Math.max(1, Math.floor((Math.min(...avgs) - 0.15) * 4) / 4) : 1;   // meilleur (droite)
  const hi = zoom ? Math.min(4, Math.ceil((Math.max(...avgs) + 0.15) * 4) / 4) : 4;    // moins bon (gauche)
  const x = (v: number) => ((hi - v) / (hi - lo)) * 100;
  const step = hi - lo > 1.5 ? 0.5 : 0.25;
  const ticks: number[] = [];
  for (let v = hi; v >= lo - 1e-9; v -= step) ticks.push(Math.round(v * 100) / 100);
  const zone = (a: number, b: number) => ({ left: `${x(Math.min(hi, a))}%`, width: `${Math.max(0, x(Math.max(lo, b)) - x(Math.min(hi, a)))}%` });
  const leader = rows[0];
  return (
    <Panel hud="yellow" title="La course à la moyenne" className="avg-race" aside={
      <div className="seg seg-sm" role="group" aria-label="Échelle">
        <button className={zoom ? 'on' : ''} onClick={() => setZoom(true)}>Zoom</button>
        <button className={!zoom ? 'on' : ''} onClick={() => setZoom(false)}>1 à 4</button>
      </div>
    }>
      <div className="ar">
        <div className="ar-axis">
          <span className="ar-axis-l">◀ moins bon</span>
          <div className="ar-ticks">{ticks.map((t) => <span key={t} style={{ left: `${x(t)}%` }}>{fmtAvg(t).replace(/,?0+$/, '').replace(/,$/, '') || '0'}</span>)}</div>
          <span className="ar-axis-r">meilleur ▶</span>
        </div>
        <div className="ar-track">
          <div className="ar-zones" aria-hidden="true">
            <i className="z-red" style={zone(4, 3)} /><i className="z-mid" style={zone(3, 2)} /><i className="z-green" style={zone(2, 1)} />
            {ticks.map((t) => <b key={t} style={{ left: `${x(t)}%` }} />)}
            {2.5 <= hi && 2.5 >= lo && <em style={{ left: `${x(2.5)}%` }}><span title="Moyenne qu'on obtiendrait si les places étaient tirées au sort">hasard 2,5</span></em>}
            {lo <= 1.001 && <u />}
          </div>
          {rows.map((r, i) => {
            const pos = x(r.avg);
            const c = player(r.name).color;
            const sel = r.name === who;
            return (
              <button key={r.name} type="button" className={`ar-lane ${sel ? 'sel' : ''}`} onClick={() => onPick(r.name)} style={{ '--c': c, '--x': go ? pos : 0, transitionDelay: `${i * 60}ms` } as CSSProperties}
                aria-label={`${player(r.name).displayName ?? r.name} : ${fmtAvg(r.avg)} de moyenne, ${i + 1}e`}>
                <span className="ar-rank num">{i + 1}</span>
                <span className="ar-trail" style={{ transitionDelay: `${i * 60}ms` }} />
                <span className={`ar-kart ${pos < 28 ? 'ar-right' : ''}`} style={{ transitionDelay: `${i * 60}ms` }}>
                  <span className="ar-tag"><b>{player(r.name).displayName ?? r.name}</b><span className="num">{fmtAvg(r.avg)}</span></span>
                  <span className="ar-pilot"><Avatar name={r.name} size={30} />{i === 0 && <span className="ar-crown" aria-hidden="true">★</span>}</span>
                </span>
              </button>
            );
          })}
        </div>
        <span className="hint">Chaque pilote avance vers la ligne d'arrivée selon sa place moyenne sur la période. {leader ? `${player(leader.name).displayName ?? leader.name} mène la course.` : ''} Clique sur un kart pour afficher sa fiche. <a className="link" href="#lexique" onClick={(e) => { e.preventDefault(); openLexique('hasard'); }}>Que veut dire « hasard 2,5 » ?</a></span>
      </div>
    </Panel>
  );
}


/** Ouvre le lexique et fait défiler jusqu'à une entrée. */
function openLexique(entry?: string) {
  const d = document.getElementById('lexique') as HTMLDetailsElement | null;
  if (!d) return;
  d.open = true;
  const target = (entry && document.getElementById(`lex-${entry}`)) || d;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (entry) { target.classList.add('lex-flash'); setTimeout(() => target.classList.remove('lex-flash'), 1600); }
}

function Lexique() {
  return (
    <details className="panel lexique" id="lexique">
      <summary><span className="label">Lexique</span><b>Comment lire ces chiffres</b><span className="hint">Tendance, hasard 2,5, cote, position moyenne</span></summary>
      <div className="lex-grid">
        <section id="lex-tendance">
          <h3>Tendance actuelle</h3>
          <p>Elle dit si un pilote est en train de s'améliorer ou de baisser, indépendamment de son niveau habituel.</p>
          <p><b>Calcul :</b> on prend sa position moyenne sur ses <b>{TREND_RECENT} dernières courses</b> et on la compare à sa moyenne sur les <b>{TREND_BEFORE} courses d'avant</b> (jusqu'à la fin de la période affichée). L'indice est la différence : moyenne d'avant moins moyenne récente. Positif, le pilote finit plus haut qu'avant.</p>
          <table className="table compact lex-table">
            <tbody>
              <tr><td><span className="trend trend-up2"><i>▲▲</i>Forte progression</span></td><td>au moins 0,5 place gagnée</td></tr>
              <tr><td><span className="trend trend-up"><i>▲</i>En progression</span></td><td>de 0,25 à 0,5 place gagnée</td></tr>
              <tr><td><span className="trend trend-flat"><i>▬</i>Stable</span></td><td>moins de 0,25 place d'écart</td></tr>
              <tr><td><span className="trend trend-down"><i>▼</i>En régression</span></td><td>de 0,25 à 0,5 place perdue</td></tr>
              <tr><td><span className="trend trend-down2"><i>▼▼</i>En chute</span></td><td>au moins 0,5 place perdue</td></tr>
            </tbody>
          </table>
          <p className="hint">Exemple : 2,10 sur les 10 dernières courses contre 2,45 avant, soit +0,35 : « en progression ». Il faut au moins {TREND_RECENT + 10} courses pour afficher une tendance. Sous 0,25 place, l'écart vient le plus souvent du hasard d'une petite série.</p>
        </section>
        <section id="lex-hasard">
          <h3>Hasard 2,5</h3>
          <p>C'est la position moyenne qu'obtiendrait un pilote si les places de chaque course étaient <b>tirées au sort</b> : une chance sur quatre d'être 1er, 2e, 3e ou 4e, soit (1 + 2 + 3 + 4) ÷ 4 = <b>2,5</b>.</p>
          <p>À gauche de la ligne pointillée (au-dessus de 2,5), un pilote fait moins bien que le hasard ; à droite (en dessous de 2,5), il fait mieux. Même idée pour les pourcentages de la fiche : 25 % de victoires, 50 % de top 2 et 25 % de dernières places, c'est ce que donnerait le tirage au sort.</p>
        </section>
        <section id="lex-position">
          <h3>Position moyenne</h3>
          <p>La moyenne des places obtenues, de 1 (toujours premier) à 4 (toujours dernier). Plus elle est basse, mieux c'est. Les places sont celles du groupe de 4 joueurs humains, pas le rang affiché par le jeu.</p>
        </section>
        <section id="lex-cote">
          <h3>Cote</h3>
          <p>Un indice de niveau inspiré des échecs (Elo), départ à 1500. Après chaque course, chaque pilote gagne ou perd des points contre chacun des 3 autres, d'autant plus que le résultat est inattendu : battre un pilote mieux coté rapporte plus que battre un pilote moins bien coté. Le chiffre en couleur à côté est le gain ou la perte sur la période.</p>
        </section>
      </div>
    </details>
  );
}

type Kind = PeriodKind | 'custom';
const KINDS: PeriodKind[] = ['day', 'week', 'month', 'year', 'all'];

/** Filtre de période commun au classement et à la fiche pilote (le choix est mémorisé). */
function usePeriod() {
  const { races, dayList } = useStore();
  const last = dayList.at(-1)!;
  const [kind, setKindRaw] = useState<Kind>(() => { const k = readPref<Kind>('mk.period', 'month'); return k === 'custom' || KINDS.includes(k as PeriodKind) ? k : 'month'; });
  const [period, setPeriod] = useState<Period>(() => periodOf(kind === 'custom' ? 'month' : kind, last));
  const [from, setFrom] = useState(() => dayKey(new Date(parseLocal(last).getTime() - 30 * 864e5)));
  const [to, setTo] = useState(last);
  const setKind = (k: Kind) => { setKindRaw(k); writePref('mk.period', k); if (k !== 'custom') setPeriod(periodOf(k, last)); };
  const eff: Period = kind === 'custom' ? { kind: 'all', start: from, end: to + '~', label: `Du ${fmtShort(from)} au ${fmtShort(to)}`, key: from + to } : period;
  const prev = kind === 'custom' ? null : previousPeriod(period, dayList);
  const next = kind === 'custom' ? null : nextPeriod(period, dayList);
  const filter = (p: Period | null) => (p ? races.filter((r) => r.day >= p.start && r.day < p.end) : []);
  const cur = useMemo(() => filter(eff), [races, eff.key]);
  const prevRaces = useMemo(() => (prev ? filter(prev) : null), [races, prev?.key]);
  const startDay = eff.kind === 'all' && kind !== 'custom' ? undefined : eff.start;
  const bar = (extra?: React.ReactNode) => (
    <Panel>
      <div className="stack">
        <div className="seg" role="tablist" aria-label="Période">
          {KINDS.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>{PERIOD_LABELS[k]}</button>)}
          <button className={kind === 'custom' ? 'on' : ''} onClick={() => setKind('custom')}>Dates</button>
        </div>
        <div className="filters">
          {kind === 'custom' ? (
            <>
              <label className="field"><span>Du</span><input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span>Au</span><input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          ) : kind === 'all' ? null : (
            <div className="session-head" style={{ minWidth: 240 }}>
              <button className="iconbtn" disabled={!prev} onClick={() => prev && setPeriod(prev)} aria-label="Période précédente">‹</button>
              <div className="grow" style={{ alignItems: 'center' }}><b style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', textTransform: 'capitalize', textAlign: 'center' }}>{period.label}</b></div>
              <button className="iconbtn" disabled={!next} onClick={() => next && setPeriod(next)} aria-label="Période suivante">›</button>
            </div>
          )}
          {extra}
        </div>
        <span className="hint">{cur.length} courses sur la période{kind === 'all' ? ' (depuis le début)' : ''}</span>
      </div>
    </Panel>
  );
  return { eff, prev, cur, prevRaces, endDay: cur.at(-1)?.day, startDay, bar };
}

function Classement() {
  const { races, player, elo } = useStore();
  const { eff, prev, cur, prevRaces, endDay, startDay, bar } = usePeriod();
  const [activeOnly, setActiveOnly] = useState<boolean>(() => readPref('mk.activeOnly', true));
  const rows = useMemo(() => rankedWithEvolution(standings(cur), prevRaces ? standings(prevRaces) : null), [cur, prevRaces]);
  const shown = rows.filter((r) => (!activeOnly || player(r.name).active) && r.name !== 'Other');
  const pick = (n: string) => { window.location.hash = href('stats', 'pilote', n); };

  return (
    <>
      {bar(
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
          <input id="active-only" type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); writePref('mk.activeOnly', e.target.checked); }} style={{ accentColor: 'var(--cyan)', width: 18, height: 18 }} />
          <span style={{ letterSpacing: '0.08em' }}>Actifs uniquement</span>
        </label>,
      )}

      <Section title={`Classement · ${eff.label}`}>
        {shown.length === 0 ? <Empty>Aucune course sur cette période.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th className="hide-sm"></th><th>Pilote</th><th className="r">Moy.</th>
                  <th className="r" title="Cote Elo en fin de période, et son évolution sur la période">Cote</th><th className="r">Courses</th>
                  <th className="r hide-sm">Podium</th>
                  <th className="hide-sm" title={`${TREND_RECENT} dernières courses comparées aux ${TREND_BEFORE} précédentes, à la fin de la période`}><button type="button" className="th-help" onClick={(e) => { e.stopPropagation(); openLexique('tendance'); }}>Tendance <span aria-hidden="true">?</span></button></th>{[1, 2, 3, 4].map((k) => <th key={k} className="r pl-h hide-sm" title={`Part des courses terminées ${k === 1 ? '1er' : `${k}e`}`}><Pos n={k} /></th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.name} onClick={() => pick(r.name)} style={{ cursor: 'pointer' }}>
                    <td className="rank">{i + 1}</td>
                    <td className="hide-sm"><Delta delta={r.delta} isNew={r.isNew} /></td>
                    <td><PlayerTag name={r.name} link={false} sub={player(r.name).active ? undefined : 'ancien'} /></td>
                    <td className="r"><b><Avg v={r.avg} /></b></td>
                    <td className="r"><Cote v={ratingAt(elo, r.name, endDay)} delta={startDay ? ratingAt(elo, r.name, endDay) - ratingAt(elo, r.name, startDay, true) : undefined} /></td>
                    <td className="r num">{r.races}</td>
                    <td className="r num hide-sm">{Math.round(((r.places[0] + r.places[1] + r.places[2]) / r.races) * 100)} %</td>
                    <td className="hide-sm"><TrendBadge t={trendOf(r.name, races, endDay)} /></td>
                    {r.places.map((n, k) => <td key={k} className={`r num hide-sm pl-pct pl-pct-${k + 1}`}>{Math.round((n / r.races) * 100)} %</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <AvgRace rows={shown} who="" onPick={pick} />

      <p className="hint">Tri : moyenne, puis victoires, puis courses. Clique sur un pilote pour ouvrir sa fiche.{prev ? ` ▲▼ : évolution de place par rapport à ${prev.label}.` : ''} <a className="link" href="#lexique" onClick={(e) => { e.preventDefault(); openLexique(); }}>Comment lire ces chiffres</a></p>

      <Lexique />
    </>
  );
}

function PiloteTab({ name }: { name?: string }) {
  const { races, elo, runs, days, activeNames, lastSeen, player, badges } = useStore();
  const { me } = useAuth();
  const known = (n?: string) => !!n && (activeNames.includes(n) || lastSeen.has(n));
  const who = known(name) ? name! : me ?? activeNames[0] ?? '';
  const go = (n: string) => { window.location.hash = href('stats', 'pilote', n); };
  const { eff, cur, endDay, startDay, bar } = usePeriod();
  const sheet = useMemo(() => (who ? playerSheet(who, cur, races, elo, startDay) : null), [who, cur, races, elo, startDay]);
  const prof = useMemo(() => playerProfile(who, races, elo, runs, days, activeNames), [who, races, elo, runs, days, activeNames]);
  const others = [...lastSeen.keys()].filter((n) => n !== 'Other' && !activeNames.includes(n)).sort();
  const held = badges.held.get(who);

  return (
    <>
      <div className="picker" role="radiogroup" aria-label="Pilote affiché">
        {activeNames.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={who === n} className={`picker-chip ${who === n ? 'on' : ''}`} onClick={() => go(n)}>
            <Avatar name={n} size={26} /><span>{player(n).displayName ?? n}</span>{n === me && <small>moi</small>}
          </button>
        ))}
        {others.length > 0 && (
          <select aria-label="Ancien pilote" value={others.includes(who) ? who : ''} onChange={(e) => e.target.value && go(e.target.value)}>
            <option value="">Anciens pilotes…</option>
            {others.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {me && who !== me && <button type="button" className="btn btn-sm" onClick={() => go(me)}>Revenir à moi</button>}
      </div>

      {bar()}

      {sheet ? <SheetView s={sheet} periodLabel={eff.label} trend={trendOf(who, races, endDay)} prof={prof} held={held} /> : (
        <Panel><p className="muted" style={{ margin: 0 }}>{player(who).displayName ?? who} n'a pas couru sur cette période. Choisis une autre période ou un autre pilote.</p></Panel>
      )}

      <Lexique />
    </>
  );
}

const pctTxt = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const VERDICT: Record<H2HRow['verdict'], string> = { nemesis: 'Némésis', victim: 'Victime', ahead: 'Devant', behind: 'Derrière', even: 'Équilibré' };

function SheetView({ s, periodLabel, trend, prof, held }: { s: PlayerSheet; periodLabel: string; trend: Trend | null; prof: ReturnType<typeof playerProfile>; held?: Map<string, Holding> }) {
  const { player } = useStore();
  const p = player(s.name);
  const maxPlace = Math.max(...s.st.places);
  const rating = prof.ratingHistory.slice(-60);
  return (
    <div className="sheet">
      <div className="chamfer-frame">
        <header className="pilot-head chamfer sheet-head" style={{ '--c': p.color } as CSSProperties}>
          <Avatar name={s.name} size={64} />
          <div className="grow">
            <span className="label">Fiche pilote · <span style={{ textTransform: 'capitalize' }}>{periodLabel}</span></span>
            <h2>{p.displayName ?? s.name}</h2>
            <span className="muted">{s.races} courses sur {s.days} jour{s.days > 1 ? 's' : ''} de jeu · {s.rank}e sur {s.field}</span>
            {prof.all && <span className="hint">{p.active ? 'Pilote actif' : 'Ancien pilote'} depuis le {fmtShort(prof.firstDay)} · {prof.all.races} courses au total · ≈ {fmtDuration(prof.minutes)} de jeu</span>}
          </div>
        </header>
      </div>

      <div className="kpis sheet-kpis">
        <Panel hud="yellow"><Stat label="Position moyenne" tone="gold" value={<Avg v={s.st.avg} />} sub={`${s.rank}e sur ${s.field} pilotes`} /></Panel>
        <Panel><Stat label="Victoires" tone={s.pctWin > 0.25 ? 'good' : ''} value={<span className="num">{s.st.wins}</span>} sub={`${pctTxt(s.pctWin)} · hasard 25 %`} /></Panel>
        <Panel><Stat label="Top 2" tone={s.pctTop2 > 0.5 ? 'good' : 'bad'} value={<span className="num">{pctTxt(s.pctTop2)}</span>} sub="hasard 50 %" /></Panel>
        <Panel><Stat label="Dernier" tone={s.pctLast < 0.25 ? 'good' : 'bad'} value={<span className="num">{pctTxt(s.pctLast)}</span>} sub="hasard 25 %" /></Panel>
        <Panel><Stat label="Cote" tone="cyan" value={<Cote v={s.rating} delta={s.ratingDelta ?? undefined} />} sub="fin de période" /></Panel>
        <Panel hud={trend && trend.delta > 0.25 ? 'green' : trend && trend.delta < -0.25 ? 'red' : undefined}>
          <Stat label="Tendance actuelle" value={<TrendBadge t={trend} />} sub={trend ? `${fmtAvg(trend.recent)} sur ${TREND_RECENT} courses vs ${fmtAvg(trend.before)} avant` : 'pas assez de courses'} />
        </Panel>
      </div>

      {held && held.size > 0 && (
        <Section title={`Trophées · ${held.size}`} aside={<a className="link" href="#/trophees">Galerie</a>}>
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
          <table className="table compact">
            <thead><tr><th>Place</th><th className="r">Nb</th><th className="r">%</th><th>Répartition</th></tr></thead>
            <tbody>
              {s.st.places.map((n, i) => (
                <tr key={i}>
                  <td><Pos n={i + 1} /></td>
                  <td className="r num">{n}</td>
                  <td className="r num">{pctTxt(n / s.st.races)}</td>
                  <td style={{ width: '45%' }}><span className="hbar"><i className={`pl-${i + 1}`} style={{ width: `${maxPlace ? (n / maxPlace) * 100 : 0}%` }} /></span></td>
                </tr>
              ))}
              <tr className="total"><td>Total</td><td className="r num">{s.st.races}</td><td className="r num">100 %</td><td /></tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Séries et records">
          <ul className="kv">
            <li><span>Meilleure série de victoires</span><b className="num">{s.bestWinRun}</b></li>
            <li><span>Plus longue série sans dernière place</span><b className="num">{s.noLastRun}</b></li>
            <li><span>Plus longue série de dernières places</span><b className="num">{s.bestLastRun}</b></li>
            <li><span>Série de victoires en cours</span><b className="num">{s.currentWinRun}</b></li>
            <li><span>Meilleure journée</span><b className="num">{s.bestDay ? <>{fmtAvg(s.bestDay.avg)} <small>{fmtShort(s.bestDay.day)}</small></> : '–'}</b></li>
            <li><span>Pire journée</span><b className="num">{s.worstDay ? <>{fmtAvg(s.worstDay.avg)} <small>{fmtShort(s.worstDay.day)}</small></> : '–'}</b></li>
          </ul>
          <span className="hint">Journées : 5 courses minimum.</span>
        </Panel>
      </div>

      <Panel title={`Forme récente · ${s.recent.length} dernières courses`} aside={s.recentAvg !== null ? <span className="hint">moy. <b className="num" style={{ color: 'var(--white)' }}>{fmtAvg(s.recentAvg)}</b></span> : undefined}>
        <div className="form-strip">
          <span className="hint">ancien</span>
          {s.recent.map(({ race, pos }) => (
            <a key={race.id} href={href('stats', 'session', race.day)} className={`form-cell pl-${pos}`} title={`${fmtShort(race.day)} · ${fmtTime(race.ts)}`}>
              <b>{pos}</b><small>{fmtShort(race.day).replace(/\s\d{4}$/, '')}</small>
            </a>
          ))}
          <span className="hint">récent</span>
        </div>
      </Panel>

      <div className="grid grid-2">
        <Panel title="Par jour de la semaine">
          {s.weekdays.some((w) => w.races) ? (
            <AvgBars rows={s.weekdays.filter((w) => w.races && w.avg !== null).map((w) => ({ label: WEEKDAYS[w.day], avg: w.avg!, n: w.races }))} />
          ) : <Empty>Aucune course.</Empty>}
        </Panel>
        {rating.length > 2 ? (
          <Panel hud="cyan" title="Évolution de la cote" aside={<span className="hint">{rating.length} dernières sessions jouées · all time</span>}>
            <TrendChart labels={rating.map((r) => fmtShort(r.day))} best height={200}
              series={[{ name: 'Cote', color: p.color, values: rating.map((r) => r.rating) }]} format={(v) => String(Math.round(v))} />
          </Panel>
        ) : <Panel title="Évolution de la cote"><Empty>Pas encore assez de sessions.</Empty></Panel>}
      </div>

      <Panel title={`Face-à-face · ${p.displayName ?? s.name} contre chaque adversaire`} aside={<span className="hint">Némésis et victime : 10 courses communes minimum</span>}>
        {prof && (prof.nemesis || prof.victim) && (
          <div className="h2h-callouts">
            {prof.nemesis && <span className="bad"><b>Némésis du moment</b> · {player(prof.nemesis.opp).displayName ?? prof.nemesis.opp} finit devant dans {Math.round((1 - prof.nemesis.pct) * 100)} % des duels sur les {prof.rivalsWindow} dernières courses ({prof.nemesis.shared - prof.nemesis.ahead} sur {prof.nemesis.shared})</span>}
            {prof.victim && <span className="good"><b>Victime du moment</b> · devant {player(prof.victim.opp).displayName ?? prof.victim.opp} dans {Math.round(prof.victim.pct * 100)} % des duels sur les {prof.rivalsWindow} dernières courses ({prof.victim.ahead} sur {prof.victim.shared})</span>}
          </div>
        )}
        {(s.nemesis || s.victim) && (
          <div className="h2h-callouts">
            {s.nemesis && <span className="bad"><b>Némésis · {periodLabel}</b> · {player(s.nemesis.opp).displayName ?? s.nemesis.opp} finit devant dans {Math.round((1 - s.nemesis.pct) * 100)} % des duels ({s.nemesis.behind} sur {s.nemesis.shared})</span>}
            {s.victim && <span className="good"><b>Victime favorite · {periodLabel}</b> · devant {player(s.victim.opp).displayName ?? s.victim.opp} dans {Math.round(s.victim.pct * 100)} % des duels ({s.victim.ahead} sur {s.victim.shared})</span>}
          </div>
        )}
        {s.h2h.length === 0 ? <Empty>Pas assez de courses en commun sur cette période.</Empty> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Adversaire</th><th className="r">Communes</th><th className="r">Devant</th><th className="r hide-sm">Derrière</th><th className="r">Bilan</th><th className="r">% duels</th><th className="hide-sm" style={{ minWidth: 160 }}>Il domine · tu domines</th><th>Verdict</th></tr></thead>
              <tbody>
                {[...s.h2h].reverse().map((r) => (
                  <tr key={r.opp}>
                    <td><a href={href('stats', 'duels', s.name, r.opp)}><PlayerTag name={r.opp} link={false} size={24} /></a></td>
                    <td className="r num">{r.shared}</td>
                    <td className="r num good">{r.ahead}</td>
                    <td className="r num bad hide-sm">{r.behind}</td>
                    <td className={`r num ${r.ahead >= r.behind ? 'good' : 'bad'}`}>{r.ahead - r.behind > 0 ? '+' : ''}{r.ahead - r.behind}</td>
                    <td className="r num">{Math.round(r.pct * 100)} %</td>
                    <td className="hide-sm"><span className="dbar"><i className={r.pct >= 0.5 ? 'pos' : 'neg'} style={{ width: `${Math.abs(r.pct - 0.5) * 100}%`, [r.pct >= 0.5 ? 'left' : 'right']: '50%' } as CSSProperties} /></span></td>
                    <td><span className={`verdict v-${r.verdict}`}>{VERDICT[r.verdict]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------ Records

function runDates(r: Run) {
  return r.start.day === r.end.day ? fmtShort(r.start.day) : `${fmtShort(r.start.day)} → ${fmtShort(r.end.day)}`;
}

function Board({ title, rows, hud }: { title: string; hud?: 'yellow' | 'red'; rows: { key: string; who?: string; value: React.ReactNode; when: string; whenDay: string }[] }) {
  return (
    <Panel hud={hud} title={title} className="board">
      <ol>
        {rows.map((r, i) => (
          <li key={r.key} className={i === 0 ? 'first' : ''}>
            <span className="board-rank">{i + 1}</span>
            <span className="board-who">{r.who ? <PlayerTag name={r.who} size={26} /> : <a href={href('stats', 'session', r.whenDay)}>{r.when}</a>}</span>
            <span className="board-val">{r.value}</span>
            {r.who && <a className="board-when" href={href('stats', 'session', r.whenDay)}>{r.when}</a>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Records() {
  const { races, runs, days, flagged, replaced, player } = useStore();
  const rec = useMemo(() => records(races, runs, days), [races, runs, days]);
  return (
    <>
      <div className="kpis">
        <Panel><Stat label="Courses" value={<span className="num">{rec.totals.races}</span>} sub={`depuis le ${fmtShort(rec.totals.first!)}`} /></Panel>
        <Panel><Stat label="Sessions" value={<span className="num">{rec.totals.days}</span>} /></Panel>
        <Panel><Stat label="Temps de jeu" value={fmtDuration(rec.totals.minutes)} sub="≈ 2,77 min par course" /></Panel>
      </div>
      <div className="boards">
        <Board hud="yellow" title="Victoires d'affilée" rows={rec.winRuns.map((r) => ({ key: r.name + r.start.id, who: r.name, value: <b className="num">{r.length}</b>, when: runDates(r), whenDay: r.start.day }))} />
        <Board hud="red" title="Dernières places d'affilée" rows={rec.lastRuns.map((r) => ({ key: r.name + r.start.id, who: r.name, value: <b className="num">{r.length}</b>, when: runDates(r), whenDay: r.start.day }))} />
        <Board hud="yellow" title="Meilleures journées" rows={rec.bestDays.map((d) => ({ key: d.name + d.day, who: d.name, value: <><b><Avg v={d.avg} /></b> <span className="hint">({d.races})</span></>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board hud="red" title="Pires journées" rows={rec.worstDays.map((d) => ({ key: d.name + d.day, who: d.name, value: <><b><Avg v={d.avg} /></b> <span className="hint">({d.races})</span></>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board hud="yellow" title="Plus de victoires en un jour" rows={rec.mostWins.map((d) => ({ key: d.name + d.day, who: d.name, value: <span className="num"><b>{d.wins}</b> / {d.races}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board hud="red" title="Plus de 4e places en un jour" rows={rec.mostLasts.map((d) => ({ key: d.name + d.day, who: d.name, value: <span className="num"><b>{d.lasts}</b> / {d.races}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
        <Board title="Plus grosses sessions" rows={rec.biggestDays.map((d) => ({ key: d.day, value: <span className="num"><b>{d.races}</b> courses · {fmtDuration(d.minutes)}</span>, when: fmtShort(d.day), whenDay: d.day }))} />
      </div>
      <p className="hint">Records de journée : 5 courses minimum dans la journée. Les séries suivent l'ordre chronologique, même à cheval sur plusieurs sessions.</p>
      <Section title="Saisies à corriger" aside={<span className="hint">{flagged.length} courses écartées · {replaced.length} doubles saisies fusionnées</span>}>
        {flagged.length === 0 ? <p className="hint">Rien à corriger.</p> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Date</th><th>Saisie</th><th>Problème</th></tr></thead>
              <tbody>
                {[...flagged].reverse().map((f) => (
                  <tr key={f.ts}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtShort(f.ts.slice(0, 10))} {f.ts.slice(11, 16).replace(':', 'h')}</td>
                    <td>{f.p.map((n) => player(n).displayName ?? n).join(' · ')}</td>
                    <td className="bad">{(() => { const d = f.p.find((n, i) => f.p.indexOf(n) !== i)!; return d === 'Other' ? 'Nom saisi deux fois' : `${player(d).displayName ?? d} saisi deux fois`; })()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Une course avec le même nom deux fois est exclue des stats : corrige la ligne dans le Sheet, elle sera reprise à la synchro suivante. Deux saisies à moins de 60 secondes : seule la seconde compte.</p>
      </Section>
    </>
  );
}
