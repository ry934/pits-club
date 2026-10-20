import { fmtAvg, standings } from './stats';
import { Race } from './types';

/** Règle structurée d'un Take : ce que l'IA produira à partir du texte libre (lot 2). */
export type TakeRule =
  | { kind: 'duel'; a: string; b: string }                       // a finit devant b (moyenne du jour)
  | { kind: 'avg-better'; p: string; x: number }                 // moyenne du jour de p < x
  | { kind: 'avg-worse'; p: string; x: number }                  // moyenne du jour de p > x
  | { kind: 'wins-min'; p: string; n: number }                   // au moins n victoires
  | { kind: 'no-win'; p: string }                                // aucune victoire
  | { kind: 'best-of-day'; p: string }                           // meilleur du jour
  | { kind: 'win-streak'; p: string; n: number }                 // n victoires d'affilée dans la session
  | { kind: 'volume'; n: number };                               // au moins n courses dans la session

export type TakeOutcome = 'won' | 'lost' | 'void';

export const RULE_KINDS: { kind: TakeRule['kind']; label: string }[] = [
  { kind: 'duel', label: 'Duel : X finit devant Y' },
  { kind: 'avg-better', label: 'Moyenne meilleure que…' },
  { kind: 'avg-worse', label: 'Moyenne moins bonne que…' },
  { kind: 'wins-min', label: 'Au moins N victoires' },
  { kind: 'no-win', label: 'Aucune victoire' },
  { kind: 'best-of-day', label: 'Meilleur du jour' },
  { kind: 'win-streak', label: 'Série de victoires' },
  { kind: 'volume', label: 'Nombre de courses' },
];

/** Phrase lisible de la règle ; `L` traduit un nom interne en pseudo affiché (par défaut, le nom tel quel). */
export function ruleLabel(r: TakeRule, L: (name: string) => string = (n) => n): string {
  switch (r.kind) {
    case 'duel': return `${L(r.a)} finit devant ${L(r.b)}`;
    case 'avg-better': return `${L(r.p)} fait mieux que ${fmtAvg(r.x)} de moyenne`;
    case 'avg-worse': return `${L(r.p)} fait moins bien que ${fmtAvg(r.x)} de moyenne`;
    case 'wins-min': return `${L(r.p)} gagne au moins ${r.n} course${r.n > 1 ? 's' : ''}`;
    case 'no-win': return `${L(r.p)} ne gagne aucune course`;
    case 'best-of-day': return `${L(r.p)} termine meilleur du jour`;
    case 'win-streak': return `${L(r.p)} enchaîne ${r.n} victoires d'affilée`;
    case 'volume': return `Au moins ${r.n} courses dans la session`;
  }
}

export const rulePlayers = (r: TakeRule): string[] =>
  r.kind === 'duel' ? [r.a, r.b] : r.kind === 'volume' ? [] : [r.p];

const MIN_RACES = 3;

/** Résolution déterministe sur les courses de la session (sans IA). */
export function resolveTake(rule: TakeRule, dayRaces: Race[]): TakeOutcome {
  if (!dayRaces.length) return 'void';
  if (rule.kind === 'volume') return dayRaces.length >= rule.n ? 'won' : 'lost';
  const table = standings(dayRaces);
  const row = (n: string) => table.find((t) => t.name === n);
  for (const n of rulePlayers(rule)) if ((row(n)?.races ?? 0) < MIN_RACES) return 'void';
  const ok = (b: boolean): TakeOutcome => (b ? 'won' : 'lost');
  switch (rule.kind) {
    case 'duel': return ok(row(rule.a)!.avg < row(rule.b)!.avg);
    case 'avg-better': return ok(row(rule.p)!.avg < rule.x);
    case 'avg-worse': return ok(row(rule.p)!.avg > rule.x);
    case 'wins-min': return ok(row(rule.p)!.wins >= rule.n);
    case 'no-win': return ok(row(rule.p)!.wins === 0);
    case 'best-of-day': return ok(table[0].name === rule.p);
    case 'win-streak': {
      let run = 0, bestRun = 0;
      for (const r of dayRaces) { if (!r.p.includes(rule.p)) continue; run = r.p[0] === rule.p ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
      return ok(bestRun >= rule.n);
    }
  }
}

// ------------------------------------------------------------ cote par simulation

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Probabilité estimée : on rejoue la session N fois. À chaque course, 4 pilotes tirés parmi les présents
 * (avec rotation des manettes), ordre tiré selon les cotes (modèle de Plackett-Luce calé sur l'Elo).
 */
export function estimateProbability(rule: TakeRule, lineup: string[], ratings: Map<string, number>, racesPerSession: number, sims = 1200, seed = 1): number {
  const rnd = mulberry32(seed);
  const players = [...new Set([...lineup, ...rulePlayers(rule)])];
  if (players.length < 4) return 0.5;
  const strength = new Map(players.map((p) => [p, 10 ** ((ratings.get(p) ?? 1500) / 400)]));
  let won = 0, counted = 0;
  for (let s = 0; s < sims; s++) {
    const nRaces = Math.max(3, Math.round(racesPerSession + (rnd() - 0.5) * racesPerSession * 0.6));
    const sim: Race[] = [];
    for (let k = 0; k < nRaces; k++) {
      const pool = [...players];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const seat = pool.slice(0, 4);
      const order: string[] = [];
      while (seat.length) {
        const tot = seat.reduce((a, p) => a + strength.get(p)!, 0);
        let x = rnd() * tot, idx = 0;
        while ((x -= strength.get(seat[idx])!) > 0 && idx < seat.length - 1) idx++;
        order.push(seat.splice(idx, 1)[0]);
      }
      sim.push({ id: k, ts: new Date(0), iso: '', day: 'sim', p: order as Race['p'], src: 'app' });
    }
    const out = resolveTake(rule, sim);
    if (out === 'void') continue;
    counted++; if (out === 'won') won++;
  }
  return counted ? won / counted : 0.5;
}

/** Gain si le Take passe : 10 ÷ probabilité, plafonné à 100 points. */
export const pointsFor = (p: number) => Math.min(100, Math.max(10, Math.round(10 / Math.max(p, 0.01))));
