import { FlaggedRace, Race, RawRace, ReplacedRace, SETTINGS } from './types';

// ---------------------------------------------------------------- nettoyage

export function parseLocal(iso: string): Date {
  const [d, t = '00:00:00'] = iso.replace(' ', 'T').split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mm, ss || 0);
}

/** Doublons < 60 s : la saisie la plus récente remplace l'autre. Nom en double : course écartée. */
export function cleanRaces(raw: RawRace[]): { races: Race[]; flagged: FlaggedRace[]; replaced: ReplacedRace[] } {
  const sorted = [...raw]
    .map((r) => ({ ...r, ts: r.ts.replace(' ', 'T') }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const kept: RawRace[] = [];
  const replaced: ReplacedRace[] = [];
  for (const r of sorted) {
    const prev = kept.at(-1);
    if (prev && (parseLocal(r.ts).getTime() - parseLocal(prev.ts).getTime()) / 1000 < SETTINGS.dedupeSeconds) {
      replaced.push({ replaced: prev, by: r });
      kept[kept.length - 1] = r;
    } else kept.push(r);
  }
  const races: Race[] = [];
  const flagged: FlaggedRace[] = [];
  for (const r of kept) {
    if (new Set(r.p).size < 4) { flagged.push({ ...r, reason: 'duplicate-name' }); continue; }
    races.push({ id: races.length, ts: parseLocal(r.ts), iso: r.ts, day: r.ts.slice(0, 10), p: r.p, src: r.src });
  }
  return { races, flagged, replaced };
}

// ---------------------------------------------------------------- dates et périodes

export type PeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year' | 'all';
export const PERIOD_LABELS: Record<PeriodKind, string> = {
  day: 'Jour', week: 'Semaine', month: 'Mois', quarter: 'Trimestre', semester: 'Semestre', year: 'Année', all: 'All time',
};
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (day: string) => day.slice(0, 7);
export function fmtDay(day: string, withYear = true) {
  const d = parseLocal(day);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}
export function fmtShort(day: string) {
  const d = parseLocal(day);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
export function fmtMonth(month: string, short = false) {
  const [y, m] = month.split('-').map(Number);
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}
export const fmtTime = (d: Date) => `${pad(d.getHours())}h${pad(d.getMinutes())}`;
export const fmtAvg = (n: number) => n.toFixed(2).replace('.', ',');
export const fmtPct = (n: number) => `${Math.round(n * 100)} %`;
export function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h} h ${pad(m)}` : `${m} min`;
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export type Period = { kind: PeriodKind; start: string; end: string; label: string; key: string };

/** Bornes [start, end[ en jours AAAA-MM-JJ. Pour « jour », ref doit être un jour joué. */
export function periodOf(kind: PeriodKind, ref: string): Period {
  const month = monthKey(ref);
  const [y, m] = month.split('-').map(Number);
  const span = (startMonth: string, n: number, label: string): Period => ({
    kind, start: `${startMonth}-01`, end: `${addMonths(startMonth, n)}-01`, label, key: startMonth,
  });
  switch (kind) {
    case 'day': return { kind, start: ref, end: ref + '~', label: fmtDay(ref), key: ref };
    case 'week': {
      const d = parseLocal(ref);
      const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const nextMon = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
      const fri = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 4);
      const same = mon.getMonth() === fri.getMonth();
      const label = `Semaine du ${mon.getDate()}${same ? '' : ' ' + MONTHS[mon.getMonth()]} au ${fri.getDate()} ${MONTHS[fri.getMonth()]} ${fri.getFullYear()}`;
      return { kind, start: dayKey(mon), end: dayKey(nextMon), label, key: dayKey(mon) };
    }
    case 'month': return span(month, 1, fmtMonth(month));
    case 'quarter': { const q = Math.floor((m - 1) / 3); return span(`${y}-${pad(q * 3 + 1)}`, 3, `T${q + 1} ${y}`); }
    case 'semester': { const s = m <= 6 ? 0 : 1; return span(`${y}-${pad(s * 6 + 1)}`, 6, `S${s + 1} ${y}`); }
    case 'year': return span(`${y}-01`, 12, String(y));
    case 'all': return { kind, start: '0000', end: '9999', label: 'Depuis le début', key: 'all' };
  }
}

export function previousPeriod(p: Period, days: string[]): Period | null {
  if (p.kind === 'all') return null;
  if (p.kind === 'day') {
    const i = days.indexOf(p.start);
    return i > 0 ? periodOf('day', days[i - 1]) : null;
  }
  const prevDay = days.filter((d) => d < p.start).at(-1);
  return prevDay ? periodOf(p.kind, prevDay) : null;
}

export function nextPeriod(p: Period, days: string[]): Period | null {
  if (p.kind === 'all') return null;
  const nextDay = days.find((d) => d >= p.end);
  return nextDay ? periodOf(p.kind, nextDay) : null;
}

export const inPeriod = (races: Race[], p: Period) => races.filter((r) => r.day >= p.start && r.day < p.end);

// ---------------------------------------------------------------- classements

export type Standing = {
  name: string; races: number; sum: number; avg: number; wins: number;
  places: [number, number, number, number]; rank: number;
};

export function standings(races: Race[]): Standing[] {
  const m = new Map<string, Standing>();
  for (const r of races) {
    r.p.forEach((name, i) => {
      let s = m.get(name);
      if (!s) { s = { name, races: 0, sum: 0, avg: 0, wins: 0, places: [0, 0, 0, 0], rank: 0 }; m.set(name, s); }
      s.races++; s.sum += i + 1; s.places[i]++; if (i === 0) s.wins++;
    });
  }
  const list = [...m.values()];
  list.forEach((s) => (s.avg = s.sum / s.races));
  list.sort((a, b) => a.avg - b.avg || b.wins - a.wins || b.races - a.races);
  list.forEach((s, i) => (s.rank = i + 1));
  return list;
}

export type RankedRow = Standing & { delta: number | null; isNew: boolean };

export function rankedWithEvolution(cur: Standing[], prev: Standing[] | null): RankedRow[] {
  const prevRank = new Map(prev?.map((s) => [s.name, s.rank]) ?? []);
  return cur.map((s) => {
    const pr = prevRank.get(s.name);
    return { ...s, delta: prev && pr ? pr - s.rank : null, isNew: !!prev && !pr };
  });
}

// ---------------------------------------------------------------- séries

export type Run = { name: string; kind: 'win' | 'last'; length: number; start: Race; end: Race; ongoing: boolean };

export function allRuns(races: Race[]): Run[] {
  const runs: Run[] = [];
  const cur = new Map<string, { win?: Run; last?: Run }>();
  const lastRaceOf = new Map<string, number>();
  for (const r of races) {
    r.p.forEach((name, i) => {
      lastRaceOf.set(name, r.id);
      if (name === 'Other') return;
      const c = cur.get(name) ?? {};
      for (const kind of ['win', 'last'] as const) {
        const hit = kind === 'win' ? i === 0 : i === 3;
        if (hit) {
          if (c[kind]) { c[kind]!.length++; c[kind]!.end = r; }
          else { c[kind] = { name, kind, length: 1, start: r, end: r, ongoing: false }; runs.push(c[kind]!); }
        } else c[kind] = undefined;
      }
      cur.set(name, c);
    });
  }
  for (const run of runs) run.ongoing = lastRaceOf.get(run.name) === run.end.id;
  return runs;
}

export function topRuns(runs: Run[], kind: Run['kind'], n = 5) {
  return runs.filter((r) => r.kind === kind)
    .sort((a, b) => b.length - a.length || a.start.id - b.start.id).slice(0, n);
}

// ---------------------------------------------------------------- journées

export type PlayerDay = { name: string; day: string; races: number; avg: number; wins: number; lasts: number };

export function playerDays(races: Race[]): PlayerDay[] {
  const m = new Map<string, PlayerDay & { sum: number }>();
  for (const r of races) r.p.forEach((name, i) => {
    const k = name + '|' + r.day;
    let d = m.get(k);
    if (!d) { d = { name, day: r.day, races: 0, avg: 0, wins: 0, lasts: 0, sum: 0 }; m.set(k, d); }
    d.races++; d.sum += i + 1; if (i === 0) d.wins++; if (i === 3) d.lasts++;
  });
  return [...m.values()].map((d) => ({ ...d, avg: d.sum / d.races }));
}

export function groupByDay(races: Race[]): Map<string, Race[]> {
  const m = new Map<string, Race[]>();
  for (const r of races) { const a = m.get(r.day); a ? a.push(r) : m.set(r.day, [r]); }
  return m;
}

// ---------------------------------------------------------------- Elo multijoueur

export type EloResult = {
  rating: Map<string, number>;
  before: number[][];                 // cotes des 4 joueurs avant chaque course (index = race.id)
  dayRating: Map<string, { day: string; rating: number }[]>; // cote en fin de journée
};

export const winProb = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400));

export function computeElo(races: Race[]): EloResult {
  const R = new Map<string, number>();
  const get = (n: string) => R.get(n) ?? SETTINGS.eloStart;
  const before: number[][] = [];
  const dayRating = new Map<string, { day: string; rating: number }[]>();
  for (const r of races) {
    const pre = r.p.map(get);
    before[r.id] = pre;
    const delta = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const d = SETTINGS.eloK * (1 - winProb(pre[i], pre[j]));
      delta[i] += d; delta[j] -= d;
    }
    r.p.forEach((n, i) => {
      const v = pre[i] + delta[i] / 3;
      R.set(n, v);
      const h = dayRating.get(n) ?? [];
      if (h.at(-1)?.day === r.day) h[h.length - 1].rating = v; else h.push({ day: r.day, rating: v });
      dayRating.set(n, h);
    });
  }
  return { rating: R, before, dayRating };
}

/** Cote d'un pilote à la fin d'une journée donnée (ou avant cette journée si strict), sinon cote actuelle. */
export function ratingAt(elo: EloResult, name: string, day?: string, strict = false): number {
  const h = elo.dayRating.get(name);
  if (!h?.length) return SETTINGS.eloStart;
  if (!day) return elo.rating.get(name) ?? h.at(-1)!.rating;
  let v = SETTINGS.eloStart;
  for (const x of h) { if (strict ? x.day < day : x.day <= day) v = x.rating; else break; }
  return v;
}

/** Position attendue de chaque joueur d'une course, d'après les cotes avant la course. */
export function expectedPositions(pre: number[]): number[] {
  return pre.map((ri, i) => 1 + pre.reduce((s, rj, j) => (j === i ? s : s + (1 - winProb(ri, rj))), 0));
}

// ---------------------------------------------------------------- récap de session

export type SessionSummary = {
  day: string; races: Race[]; table: Standing[]; start: Date; end: Date; minutes: number;
  mvp: Standing; flop: Standing | null;
  surperf: { name: string; gain: number }[];   // positions gagnées vs attendu, total sur la session
  players: string[];
};

export function sessionSummary(day: string, dayRaces: Race[], elo: EloResult): SessionSummary {
  const table = standings(dayRaces);
  const lasts = [...table].sort((a, b) => b.places[3] - a.places[3] || b.avg - a.avg);
  const gain = new Map<string, number>();
  for (const r of dayRaces) {
    const exp = expectedPositions(elo.before[r.id]);
    r.p.forEach((n, i) => gain.set(n, (gain.get(n) ?? 0) + exp[i] - (i + 1)));
  }
  const surperf = [...gain].map(([name, g]) => ({ name, gain: g })).sort((a, b) => b.gain - a.gain);
  return {
    day, races: dayRaces, table,
    start: dayRaces[0].ts, end: dayRaces.at(-1)!.ts,
    minutes: dayRaces.length * SETTINGS.raceMinutes,
    mvp: table[0], flop: lasts[0]?.places[3] ? lasts[0] : null,
    surperf, players: table.map((s) => s.name),
  };
}

export function sessionState(day: string, dayRaces: Race[], closed: Set<string>, now = new Date()): 'live' | 'closed' {
  if (closed.has(day) || day !== dayKey(now)) return 'closed';
  const idle = (now.getTime() - dayRaces.at(-1)!.ts.getTime()) / 60000;
  return idle < SETTINGS.sessionIdleMinutes ? 'live' : 'closed';
}

// ---------------------------------------------------------------- face-à-face

export type H2H = { opp: string; shared: number; ahead: number; pct: number; lastSeen: string };

export function headToHead(races: Race[], name: string, lastSeen: Map<string, string>, refDay: string): H2H[] {
  const m = new Map<string, { shared: number; ahead: number }>();
  for (const r of races) {
    const i = r.p.indexOf(name);
    if (i < 0) continue;
    r.p.forEach((o, j) => {
      if (j === i) return;
      const s = m.get(o) ?? { shared: 0, ahead: 0 };
      s.shared++; if (i < j) s.ahead++;
      m.set(o, s);
    });
  }
  const limit = parseLocal(refDay).getTime() - SETTINGS.hideOpponentAfterDays * 864e5;
  return [...m].map(([opp, s]) => ({ opp, ...s, pct: s.ahead / s.shared, lastSeen: lastSeen.get(opp) ?? '' }))
    .filter((h) => h.shared >= SETTINGS.minSharedH2H && parseLocal(h.lastSeen).getTime() >= limit && h.opp !== 'Other')
    .sort((a, b) => b.pct - a.pct);
}

/**
 * Rivalités du moment : face-à-face calculés sur les N dernières courses du pilote seulement.
 * Un adversaire qui ne vient plus sort tout seul de la fenêtre ; l'historique complet reste dans headToHead.
 * Némésis = celui qui finit le plus souvent devant (moins de 50 % de duels gagnés),
 * victime = celui qu'on bat le plus souvent (plus de 50 %).
 */
export type Rivals = { h2h: H2H[]; nemesis: H2H | null; victim: H2H | null; window: number };

export function recentRivals(races: Race[], name: string, window = SETTINGS.rivalryWindow, minShared = SETTINGS.minSharedRecent): Rivals {
  const mine = races.filter((r) => r.p.includes(name)).slice(-window);
  const m = new Map<string, { shared: number; ahead: number; lastSeen: string }>();
  for (const r of mine) {
    const i = r.p.indexOf(name);
    r.p.forEach((o, j) => {
      if (j === i || o === 'Other') return;
      const s = m.get(o) ?? { shared: 0, ahead: 0, lastSeen: '' };
      s.shared++; if (i < j) s.ahead++; s.lastSeen = r.day;
      m.set(o, s);
    });
  }
  const h2h = [...m].map(([opp, s]) => ({ opp, ...s, pct: s.ahead / s.shared }))
    .filter((h) => h.shared >= minShared)
    .sort((a, b) => b.pct - a.pct || b.shared - a.shared);
  const low = [...h2h].sort((a, b) => a.pct - b.pct || b.shared - a.shared)[0];
  const nemesis = low && low.pct < 0.5 ? low : null;
  const victim = h2h[0] && h2h[0].pct > 0.5 && h2h[0] !== nemesis ? h2h[0] : null;
  return { h2h, nemesis, victim, window: mine.length };
}

export function lastSeenMap(races: Race[]) {
  const m = new Map<string, string>();
  for (const r of races) r.p.forEach((n) => m.set(n, r.day));
  return m;
}

// ---------------------------------------------------------------- fiche joueur

export type PlayerProfile = {
  name: string; all: Standing | null; month: Standing | null; monthLabel: string;
  form: { avg: number; races: number } | null; formDelta: number | null;
  weekdays: { day: number; avg: number; races: number }[];
  h2h: H2H[]; nemesis: H2H | null; victim: H2H | null; rivalsWindow: number;
  current: Run | null; bestWin: Run | null; bestLast: Run | null;
  bestDay: PlayerDay | null; worstDay: PlayerDay | null; biggestDay: PlayerDay | null;
  rating: number; ratingRank: number; ratingHistory: { day: string; rating: number }[];
  monthly: { month: string; avg: number; races: number }[];
  recentDays: PlayerDay[]; lastRaces: { race: Race; pos: number }[];
  firstDay: string; lastDay: string; minutes: number;
};

export function playerProfile(
  name: string, races: Race[], elo: EloResult, runs: Run[], days: PlayerDay[], activeNames: string[],
): PlayerProfile {
  const mine = races.filter((r) => r.p.includes(name));
  const all = standings(mine).find((s) => s.name === name) ?? null;
  const lastDay = mine.at(-1)?.day ?? '';
  const refMonth = monthKey(races.at(-1)?.day ?? lastDay);
  const month = standings(mine.filter((r) => monthKey(r.day) === refMonth)).find((s) => s.name === name) ?? null;
  const recent = mine.slice(-SETTINGS.formWindow);
  const formAvg = recent.length ? recent.reduce((s, r) => s + r.p.indexOf(name) + 1, 0) / recent.length : 0;
  const wd = new Map<number, { sum: number; n: number }>();
  for (const r of mine) {
    const k = r.ts.getDay(); const w = wd.get(k) ?? { sum: 0, n: 0 };
    w.sum += r.p.indexOf(name) + 1; w.n++; wd.set(k, w);
  }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].filter((d) => (wd.get(d)?.n ?? 0) >= SETTINGS.minRacesWeekday)
    .map((d) => ({ day: d, avg: wd.get(d)!.sum / wd.get(d)!.n, races: wd.get(d)!.n }));
  const h2h = headToHead(races, name, lastSeenMap(races), races.at(-1)?.day ?? lastDay);
  const rivals = recentRivals(races, name);
  const myRuns = runs.filter((r) => r.name === name);
  const best = (k: Run['kind']) => myRuns.filter((r) => r.kind === k).sort((a, b) => b.length - a.length || b.start.id - a.start.id)[0] ?? null;
  const current = myRuns.filter((r) => r.ongoing).sort((a, b) => b.length - a.length)[0] ?? null;
  const myDays = days.filter((d) => d.name === name);
  const eligible = myDays.filter((d) => d.races >= SETTINGS.minRacesDayRecord);
  const ratings = activeNames.map((n) => elo.rating.get(n) ?? SETTINGS.eloStart).sort((a, b) => b - a);
  const rating = elo.rating.get(name) ?? SETTINGS.eloStart;
  const mm = new Map<string, { sum: number; n: number }>();
  for (const r of mine) { const k = monthKey(r.day); const v = mm.get(k) ?? { sum: 0, n: 0 }; v.sum += r.p.indexOf(name) + 1; v.n++; mm.set(k, v); }
  return {
    name, all, month, monthLabel: fmtMonth(refMonth),
    form: recent.length ? { avg: formAvg, races: recent.length } : null,
    formDelta: all && recent.length >= 10 ? all.avg - formAvg : null,
    weekdays, h2h,
    nemesis: rivals.nemesis, victim: rivals.victim, rivalsWindow: rivals.window,
    current: current && current.length >= 2 ? current : null,
    bestWin: best('win'), bestLast: best('last'),
    bestDay: [...eligible].sort((a, b) => a.avg - b.avg || b.races - a.races)[0] ?? null,
    worstDay: [...eligible].sort((a, b) => b.avg - a.avg || b.races - a.races)[0] ?? null,
    biggestDay: [...myDays].sort((a, b) => b.races - a.races)[0] ?? null,
    rating, ratingRank: ratings.indexOf(rating) + 1,
    ratingHistory: elo.dayRating.get(name) ?? [],
    monthly: [...mm].map(([month, v]) => ({ month, avg: v.sum / v.n, races: v.n })),
    recentDays: myDays.slice(-8).reverse(),
    lastRaces: mine.slice(-12).reverse().map((race) => ({ race, pos: race.p.indexOf(name) + 1 })),
    firstDay: mine[0]?.day ?? '', lastDay,
    minutes: (all?.races ?? 0) * SETTINGS.raceMinutes,
  };
}

// ---------------------------------------------------------------- duel

export type Duel = {
  a: string; b: string; shared: Race[]; aheadA: number;
  avgA: number; avgB: number; probA: number;
  monthly: { month: string; aheadA: number; shared: number }[];
  bestRunA: number; bestRunB: number; currentRun: { who: string; length: number } | null;
};

export function duel(a: string, b: string, races: Race[], elo: EloResult): Duel {
  const shared = races.filter((r) => r.p.includes(a) && r.p.includes(b));
  let aheadA = 0, sa = 0, sb = 0, run = 0, runWho = '', bestA = 0, bestB = 0;
  const mm = new Map<string, { aheadA: number; shared: number }>();
  for (const r of shared) {
    const ia = r.p.indexOf(a), ib = r.p.indexOf(b);
    sa += ia + 1; sb += ib + 1;
    const w = ia < ib ? a : b;
    if (w === a) aheadA++;
    run = w === runWho ? run + 1 : 1; runWho = w;
    if (w === a) bestA = Math.max(bestA, run); else bestB = Math.max(bestB, run);
    const k = monthKey(r.day); const v = mm.get(k) ?? { aheadA: 0, shared: 0 };
    v.shared++; if (w === a) v.aheadA++; mm.set(k, v);
  }
  const ra = elo.rating.get(a) ?? SETTINGS.eloStart, rb = elo.rating.get(b) ?? SETTINGS.eloStart;
  return {
    a, b, shared, aheadA,
    avgA: shared.length ? sa / shared.length : 0, avgB: shared.length ? sb / shared.length : 0,
    probA: winProb(ra, rb),
    monthly: [...mm].map(([month, v]) => ({ month, ...v })),
    bestRunA: bestA, bestRunB: bestB,
    currentRun: run >= 2 ? { who: runWho, length: run } : null,
  };
}

// ---------------------------------------------------------------- records

export function records(races: Race[], runs: Run[], days: PlayerDay[]) {
  const eligible = days.filter((d) => d.races >= SETTINGS.minRacesDayRecord && d.name !== 'Other');
  const byDay = [...groupByDay(races)].map(([day, rs]) => ({ day, races: rs.length, minutes: rs.length * SETTINGS.raceMinutes }));
  return {
    winRuns: topRuns(runs, 'win'),
    lastRuns: topRuns(runs, 'last'),
    bestDays: [...eligible].sort((a, b) => a.avg - b.avg || (a.day < b.day ? -1 : 1)).slice(0, 5),
    worstDays: [...eligible].sort((a, b) => b.avg - a.avg || (a.day < b.day ? -1 : 1)).slice(0, 5),
    mostWins: [...days].filter((d) => d.name !== 'Other').sort((a, b) => b.wins - a.wins || (a.day < b.day ? -1 : 1)).slice(0, 5),
    mostLasts: [...days].filter((d) => d.name !== 'Other').sort((a, b) => b.lasts - a.lasts || (a.day < b.day ? -1 : 1)).slice(0, 5),
    biggestDays: byDay.sort((a, b) => b.races - a.races || (a.day < b.day ? -1 : 1)).slice(0, 5),
    totals: { races: races.length, days: byDay.length, minutes: races.length * SETTINGS.raceMinutes, first: races[0]?.day, last: races.at(-1)?.day },
  };
}
