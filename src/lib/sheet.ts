import { EloResult, monthKey, playerDays, ratingAt, standings, Standing } from './stats';
import { Race, SETTINGS } from './types';

/**
 * Fiche joueur (reprise de l'onglet « Fiche joueur » du Google Sheet) et indice de tendance.
 * Tout est calculé sur les courses de la période choisie, sauf l'évolution mensuelle (12 mois glissants)
 * et la tendance (dernières courses jusqu'à la fin de la période).
 */

export type Trend = {
  level: 'up2' | 'up' | 'flat' | 'down' | 'down2';
  label: string;
  recent: number;   // moyenne des 10 dernières courses
  before: number;   // moyenne des 30 courses précédentes
  delta: number;    // > 0 = mieux (la moyenne baisse)
};

export const TREND_RECENT = 10;
export const TREND_BEFORE = 30;

/** Tendance actuelle : 10 dernières courses comparées aux 30 d'avant, jusqu'à `endDay` inclus. */
export function trendOf(name: string, races: Race[], endDay?: string): Trend | null {
  const mine = races.filter((r) => r.p.includes(name) && (!endDay || r.day <= endDay));
  if (mine.length < TREND_RECENT + 10) return null;
  const pos = (r: Race) => r.p.indexOf(name) + 1;
  const recentRaces = mine.slice(-TREND_RECENT);
  const beforeRaces = mine.slice(-(TREND_RECENT + TREND_BEFORE), -TREND_RECENT);
  const recent = recentRaces.reduce((s, r) => s + pos(r), 0) / recentRaces.length;
  const before = beforeRaces.reduce((s, r) => s + pos(r), 0) / beforeRaces.length;
  const delta = before - recent;
  const level: Trend['level'] = delta >= 0.5 ? 'up2' : delta >= 0.25 ? 'up' : delta <= -0.5 ? 'down2' : delta <= -0.25 ? 'down' : 'flat';
  const label = { up2: 'Forte progression', up: 'En progression', flat: 'Stable', down: 'En régression', down2: 'En chute' }[level];
  return { level, label, recent, before, delta };
}

export type H2HRow = { opp: string; shared: number; ahead: number; behind: number; pct: number; verdict: 'nemesis' | 'victim' | 'ahead' | 'behind' | 'even' };

export type PlayerSheet = {
  name: string;
  races: number; days: number;
  st: Standing; rank: number; field: number;
  pctWin: number; pctTop2: number; pctLast: number;
  rating: number; ratingDelta: number | null;
  bestWinRun: number; noLastRun: number; bestLastRun: number; currentWinRun: number;
  bestDay: { day: string; avg: number; races: number } | null;
  worstDay: { day: string; avg: number; races: number } | null;
  recent: { race: Race; pos: number }[]; recentAvg: number | null;
  weekdays: { day: number; races: number; avg: number | null }[];
  monthly: { month: string; races: number; avg: number | null }[];
  h2h: H2HRow[];
  nemesis: H2HRow | null; victim: H2HRow | null;
};

/**
 * @param period courses de la période (toutes, pas seulement celles du joueur)
 * @param all    toutes les courses (pour l'évolution mensuelle)
 * @param start  premier jour de la période (pour l'évolution de cote), facultatif
 */
export function playerSheet(name: string, period: Race[], all: Race[], elo: EloResult, start?: string): PlayerSheet | null {
  const mine = period.filter((r) => r.p.includes(name));
  if (!mine.length) return null;
  const table = standings(period).filter((s) => s.name !== 'Other');
  const st = table.find((s) => s.name === name)!;
  const pos = (r: Race) => r.p.indexOf(name) + 1;
  const endDay = mine.at(-1)!.day;

  // séries sur la période
  let w = 0, nl = 0, l = 0, bw = 0, bnl = 0, bl = 0;
  for (const r of mine) {
    const p = pos(r);
    w = p === 1 ? w + 1 : 0; nl = p !== 4 ? nl + 1 : 0; l = p === 4 ? l + 1 : 0;
    bw = Math.max(bw, w); bnl = Math.max(bnl, nl); bl = Math.max(bl, l);
  }
  // série de victoires en cours (sur toutes les courses jusqu'à la fin de la période)
  const upToEnd = all.filter((r) => r.p.includes(name) && r.day <= endDay);
  let cur = 0;
  for (let i = upToEnd.length - 1; i >= 0 && pos(upToEnd[i]) === 1; i--) cur++;

  const days = playerDays(mine).filter((d) => d.name === name);
  const eligible = days.filter((d) => d.races >= SETTINGS.minRacesDayRecord);
  const best = [...eligible].sort((a, b) => a.avg - b.avg || b.races - a.races)[0];
  const worst = [...eligible].sort((a, b) => b.avg - a.avg || b.races - a.races)[0];

  const recentRaces = upToEnd.slice(-10);
  const wd = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const rs = mine.filter((r) => r.ts.getDay() === d);
    return { day: d, races: rs.length, avg: rs.length ? rs.reduce((s, r) => s + pos(r), 0) / rs.length : null };
  });

  // 12 mois glissants jusqu'au mois de fin de période
  const endMonth = monthKey(endDay);
  const months: string[] = [];
  { const [y, m] = endMonth.split('-').map(Number); for (let i = 11; i >= 0; i--) { const d = new Date(y, m - 1 - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); } }
  const monthly = months.map((mo) => {
    const rs = all.filter((r) => monthKey(r.day) === mo && r.p.includes(name));
    return { month: mo, races: rs.length, avg: rs.length ? rs.reduce((s, r) => s + pos(r), 0) / rs.length : null };
  });

  // face-à-face sur la période
  const m = new Map<string, { shared: number; ahead: number }>();
  for (const r of mine) {
    const me = pos(r);
    r.p.forEach((o, i) => {
      if (o === name || o === 'Other') return;
      const e = m.get(o) ?? { shared: 0, ahead: 0 };
      e.shared++; if (me < i + 1) e.ahead++;
      m.set(o, e);
    });
  }
  const min = SETTINGS.minSharedH2H;
  const rows: H2HRow[] = [...m].map(([opp, e]) => {
    const pct = e.ahead / e.shared;
    return { opp, shared: e.shared, ahead: e.ahead, behind: e.shared - e.ahead, pct, verdict: (pct > 0.55 ? 'ahead' : pct < 0.45 ? 'behind' : 'even') as H2HRow['verdict'] };
  }).filter((r) => r.shared >= 3).sort((a, b) => a.pct - b.pct);
  const qualified = rows.filter((r) => r.shared >= min);
  const nemesis = qualified.length ? qualified[0] : null;
  const victim = qualified.length ? qualified.at(-1)! : null;
  if (nemesis && nemesis.pct < 0.5) nemesis.verdict = 'nemesis';
  if (victim && victim.pct > 0.5 && victim !== nemesis) victim.verdict = 'victim';

  const ratingEnd = ratingAt(elo, name, endDay);
  return {
    name, races: mine.length, days: days.length,
    st, rank: table.findIndex((s) => s.name === name) + 1, field: table.length,
    pctWin: st.places[0] / st.races, pctTop2: (st.places[0] + st.places[1]) / st.races, pctLast: st.places[3] / st.races,
    rating: ratingEnd, ratingDelta: start ? ratingEnd - ratingAt(elo, name, start, true) : null,
    bestWinRun: bw, noLastRun: bnl, bestLastRun: bl, currentWinRun: cur,
    bestDay: best ? { day: best.day, avg: best.avg, races: best.races } : null,
    worstDay: worst ? { day: worst.day, avg: worst.avg, races: worst.races } : null,
    recent: recentRaces.map((race) => ({ race, pos: pos(race) })),
    recentAvg: recentRaces.length ? recentRaces.reduce((s, r) => s + pos(r), 0) / recentRaces.length : null,
    weekdays: wd, monthly, h2h: rows,
    nemesis: nemesis?.verdict === 'nemesis' ? nemesis : null,
    victim: victim?.verdict === 'victim' ? victim : null,
  };
}
