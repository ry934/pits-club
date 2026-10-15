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
