import { EloResult, standings, Standing } from './stats';
import { Race } from './types';

/**
 * Calculs du mode direct (écran « consultant » pendant la session) :
 * classement avec évolution, fil d'événements, cote de la prochaine course.
 */

export type LiveRow = Standing & { move: number; gap: number; last5: number[]; streak: { kind: 'win' | 'last'; n: number } | null };

export function liveTable(dayRaces: Race[]): LiveRow[] {
  const now = standings(dayRaces);
  const before = new Map(standings(dayRaces.slice(0, -1)).map((s) => [s.name, s.rank]));
  const leader = now[0]?.avg ?? 0;
  return now.map((s) => {
    const mine = dayRaces.filter((r) => r.p.includes(s.name)).map((r) => r.p.indexOf(s.name) + 1);
    let w = 0, l = 0;
    for (let i = mine.length - 1; i >= 0 && mine[i] === 1; i--) w++;
    for (let i = mine.length - 1; i >= 0 && mine[i] === 4; i--) l++;
    const prev = before.get(s.name);
    return {
      ...s,
      move: prev === undefined ? 0 : prev - s.rank,
      gap: s.avg - leader,
      last5: mine.slice(-5),
      streak: w >= 2 ? { kind: 'win', n: w } : l >= 2 ? { kind: 'last', n: l } : null,
    };
  });
}

export type LiveEvent = { n: number; ts: Date; kind: 'win' | 'lead' | 'streak' | 'spiral' | 'upset' | 'first' | 'join'; text: string; who: string };

/** Fil du direct, du plus récent au plus ancien. */
export function liveFeed(dayRaces: Race[], elo: EloResult, label: (n: string) => string = (n) => n): LiveEvent[] {
  const out: LiveEvent[] = [];
  const seen = new Set<string>();
  const wins = new Map<string, number>();
  const winRun = new Map<string, number>(), lastRun = new Map<string, number>();
  let leader: string | null = null;
  dayRaces.forEach((r, k) => {
    const n = k + 1, ts = r.ts, [w] = r.p, last = r.p[3];
    for (const p of r.p) if (!seen.has(p)) { if (k > 0) out.push({ n, ts, kind: 'join', who: p, text: `${label(p)} entre sur la piste.` }); seen.add(p); }
    const pre = elo.before[r.id];
    const wi = pre ? pre[0] : 0;
    const fav = pre ? Math.max(...pre) : 0;
    const prevWins = wins.get(w) ?? 0;
    wins.set(w, prevWins + 1);
    if (pre && fav - wi >= 60 && wi === Math.min(...pre)) out.push({ n, ts, kind: 'upset', who: w, text: `Coup de théâtre : ${label(w)}, outsider de la course, s'impose.` });
    else if (prevWins === 0) out.push({ n, ts, kind: 'first', who: w, text: k === 0 ? `${label(w)} remporte la première course du jour.` : `Première victoire du jour pour ${label(w)}.` });
    else out.push({ n, ts, kind: 'win', who: w, text: `${label(w)} gagne la course ${n} (${prevWins + 1}e victoire du jour).` });
    for (const p of r.p) {
      const wr = p === w ? (winRun.get(p) ?? 0) + 1 : 0;
      const lr = p === last ? (lastRun.get(p) ?? 0) + 1 : 0;
      winRun.set(p, wr); lastRun.set(p, lr);
      if (wr >= 3) out.push({ n, ts, kind: 'streak', who: p, text: `${label(p)} enchaîne ${wr} victoires d'affilée.` });
      if (lr >= 3) out.push({ n, ts, kind: 'spiral', who: p, text: `${label(p)} : ${lr} fois 4e de suite, la spirale continue.` });
    }
    // leader : parmi ceux qui ont couru au moins 3 fois
    const table = standings(dayRaces.slice(0, n)).filter((s) => s.races >= 3);
    const top = table[0]?.name ?? null;
    if (top && top !== leader) {
      if (leader) out.push({ n, ts, kind: 'lead', who: top, text: `Changement en tête : ${label(top)} passe devant ${label(leader)}.` });
      else if (n > 3) out.push({ n, ts, kind: 'lead', who: top, text: `${label(top)} prend la tête de la session.` });
      leader = top;
    }
  });
  return out.reverse();
}

/** Probabilité de victoire à la prochaine course (Bradley-Terry sur la cote Elo actuelle). */
export function nextRaceOdds(names: string[], elo: EloResult) {
  const s = names.map((n) => 10 ** ((elo.rating.get(n) ?? 1500) / 400));
  const tot = s.reduce((a, b) => a + b, 0);
  return names.map((name, i) => ({ name, p: s[i] / tot, rating: elo.rating.get(name) ?? 1500 })).sort((a, b) => b.p - a.p);
}

/** Un moment fort à célébrer à l'écran (et au son) en mode direct. */
export type Moment = {
  id: string; tone: 'gold' | 'red' | 'purple' | 'cyan'; sound: 'fanfare' | 'sad' | 'sparkle' | 'swoosh';
  kicker: string; title: string; who: string; badge?: string;
};

const WIN_MILESTONES: Record<number, string> = { 3: 'Hat trick !', 5: 'Main pleine !', 7: 'Intouchable', 10: 'Dix sur la journée' };
const LAST_MILESTONES: Record<number, string> = { 3: 'Lanterne rouge', 5: 'Abonné à la 4e place', 7: 'Record de générosité' };
const ord = (n: number) => (n === 1 ? '1re' : `${n}e`);

/**
 * Les moments forts déclenchés par la dernière course de la journée : paliers de victoires et de 4e places,
 * séries, changement de leader, exploit d'outsider. Les pilotes de `optout` ne sont jamais chambrés.
 */
export function raceMoments(dayRaces: Race[], elo: EloResult, label: (n: string) => string = (n) => n, optout: string[] = []): Moment[] {
  const r = dayRaces.at(-1);
  if (!r) return [];
  const n = dayRaces.length;
  const out: Moment[] = [];
  const [w] = r.p, last = r.p[3];
  const count = (name: string, pos: number) => dayRaces.filter((x) => x.p[pos] === name).length;
  const run = (name: string, pos: number) => { let k = 0; for (let i = n - 1; i >= 0 && dayRaces[i].p[pos] === name; i--) k++; return k; };

  const wr = run(w, 0), wc = count(w, 0);
  if (wr >= 3) out.push({ id: `${r.id}-wrun`, tone: 'gold', sound: 'fanfare', who: w, kicker: wr === 3 ? 'Hat trick !' : 'Série en cours', title: `${label(w)} enchaîne ${wr} victoires d'affilée` });
  else if (WIN_MILESTONES[wc]) out.push({ id: `${r.id}-wc`, tone: 'gold', sound: 'fanfare', who: w, kicker: WIN_MILESTONES[wc], title: `${ord(wc)} victoire du jour pour ${label(w)}` });

  if (last && !optout.includes(last)) {
    const lr = run(last, 3), lc = count(last, 3);
    if (lr >= 3) out.push({ id: `${r.id}-lrun`, tone: 'red', sound: 'sad', who: last, kicker: 'La spirale', title: `${label(last)} : ${lr} fois 4e de suite` });
    else if (LAST_MILESTONES[lc]) out.push({ id: `${r.id}-lc`, tone: 'red', sound: 'sad', who: last, kicker: LAST_MILESTONES[lc], title: `${ord(lc)} 4e place pour ${label(last)}` });
  }

  for (const e of liveFeed(dayRaces, elo, label)) {
    if (e.n !== n) break;
    if (e.kind === 'upset') out.push({ id: `${r.id}-upset`, tone: 'purple', sound: 'swoosh', who: e.who, kicker: 'Coup de théâtre', title: `${label(e.who)}, l'outsider, s'impose` });
    if (e.kind === 'lead') out.push({ id: `${r.id}-lead`, tone: 'cyan', sound: 'swoosh', who: e.who, kicker: 'Changement en tête', title: `${label(e.who)} prend la tête de la session` });
  }
  return out;
}
