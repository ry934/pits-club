/**
 * DONNÉES SIMULÉES — Takes.
 * Les Takes réels (comptes, confidentialité avant 13h, reformulation IA) arrivent au lot 2.
 * Ici, des Takes fictifs sont générés pour les dernières sessions réelles, puis résolus
 * contre les vrais résultats : seule la saisie est inventée, pas les issues.
 */
import { estimateProbability, pointsFor, resolveTake, ruleLabel, seedOf, TakeOutcome, TakeRule } from '../lib/takes';
import { EloResult } from '../lib/stats';
import { Race } from '../lib/types';

export type MockTake = {
  id: string; day: string; author: string; text: string; rule: TakeRule; label: string;
  probability: number; points: number; outcome: TakeOutcome;
};

function rng(seed: number) {
  let s = seed || 1;
  const next = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next(); next();
  return next;
}

export function ratingsAt(elo: EloResult, day: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [name, hist] of elo.dayRating) {
    let v = 1500;
    for (const h of hist) { if (h.day >= day) break; v = h.rating; }
    m.set(name, v);
  }
  return m;
}

function phrase(rule: TakeRule, r: () => number): string {
  const one = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  switch (rule.kind) {
    case 'duel': return one([`${rule.a} va finir devant ${rule.b}, c'est écrit.`, `Aujourd'hui ${rule.a} met ${rule.b} dans le rétro.`, `${rule.b} va souffrir face à ${rule.a}.`]);
    case 'avg-better': return one([`${rule.p} sous les ${String(rule.x).replace('.', ',')} de moyenne aujourd'hui.`, `Grosse session pour ${rule.p}, je le sens.`]);
    case 'avg-worse': return one([`${rule.p} ne fera pas mieux que ${String(rule.x).replace('.', ',')}.`, `Journée galère pour ${rule.p}.`]);
    case 'wins-min': return `${rule.p} gagne au moins ${rule.n} courses.`;
    case 'no-win': return one([`${rule.p} ne gagnera pas une seule course.`, `Zéro victoire pour ${rule.p}, pari tenu.`]);
    case 'best-of-day': return `${rule.p} termine meilleur du jour.`;
    case 'win-streak': return `${rule.p} enchaîne ${rule.n} victoires d'affilée.`;
    case 'volume': return `On dépasse les ${rule.n} courses aujourd'hui.`;
  }
}

function randomRule(author: string, lineup: string[], r: () => number): TakeRule {
  const others = lineup.filter((p) => p !== author);
  const one = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const p = r() < 0.4 ? author : one(others);
  switch (Math.floor(r() * 8)) {
    case 0: case 1: { const a = r() < 0.5 ? author : one(others); return { kind: 'duel', a, b: one(lineup.filter((x) => x !== a)) }; }
    case 2: return { kind: 'avg-better', p, x: one([2, 2.25, 2.5]) };
    case 3: return { kind: 'avg-worse', p: one(others), x: one([2.75, 3, 3.25]) };
    case 4: return { kind: 'wins-min', p, n: one([2, 3, 4]) };
    case 5: return { kind: 'no-win', p: one(others) };
    case 6: return r() < 0.5 ? { kind: 'best-of-day', p } : { kind: 'win-streak', p, n: one([2, 3]) };
    default: return { kind: 'volume', n: one([10, 12, 15]) };
  }
}

/** Takes fictifs des `nDays` dernières sessions, résolus contre les vrais résultats. */
export function mockTakeHistory(byDay: Map<string, Race[]>, elo: EloResult, nDays = 20): MockTake[] {
  const days = [...byDay.keys()].slice(-nDays);
  const avgRaces = days.reduce((s, d) => s + byDay.get(d)!.length, 0) / Math.max(1, days.length);
  const out: MockTake[] = [];
  for (const day of days) {
    const rs = byDay.get(day)!;
    const lineup = [...new Set(rs.flatMap((r) => r.p))].filter((p) => p !== 'Other');
    if (lineup.length < 4) continue;
    const ratings = ratingsAt(elo, day);
    for (const author of lineup) {
      const r = rng(seedOf(author + day));
      if (r() < 0.2) continue; // tout le monde ne poste pas
      // Un vrai joueur poste rarement un pari perdu d'avance : on garde le premier Take plausible (20 à 85 %).
      let rule = randomRule(author, lineup, r);
      let probability = estimateProbability(rule, lineup, ratings, avgRaces, 200, seedOf(day + author));
      for (let k = 0; k < 4 && (probability < 0.2 || probability > 0.85); k++) {
        rule = randomRule(author, lineup, r);
        probability = estimateProbability(rule, lineup, ratings, avgRaces, 200, seedOf(day + author + k));
      }
      out.push({
        id: `${day}-${author}`, day, author, text: phrase(rule, r), rule, label: ruleLabel(rule),
        probability, points: pointsFor(probability), outcome: resolveTake(rule, rs),
      });
    }
  }
  return out;
}

export type TakeLeader = { name: string; points: number; played: number; won: number; lost: number; recent: TakeOutcome[] };

export function takeLeaderboard(takes: MockTake[]): TakeLeader[] {
  const m = new Map<string, TakeLeader>();
  for (const t of takes) {
    const l = m.get(t.author) ?? { name: t.author, points: 0, played: 0, won: 0, lost: 0, recent: [] };
    if (t.outcome !== 'void') l.played++;
    if (t.outcome === 'won') { l.won++; l.points += t.points; }
    if (t.outcome === 'lost') l.lost++;
    l.recent.push(t.outcome);
    m.set(t.author, l);
  }
  return [...m.values()].map((l) => ({ ...l, recent: l.recent.slice(-8) })).sort((a, b) => b.points - a.points);
}
