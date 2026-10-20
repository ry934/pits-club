import { EloResult, ratingAt, standings, Standing } from '../stats';
import { resolveTake, TakeOutcome, TakeRule } from '../takes';
import { Race, SETTINGS } from '../types';

/**
 * Les faits d'une session, calculés une fois et partagés par la bibliothèque de phrases et par la plume IA.
 * Rien d'inventé : tout vient des courses et des Takes.
 */

export type LiveTake = {
  id: string; author: string; text: string; rule: TakeRule | null; label: string | null;
  probability: number | null; points: number | null; status: 'pending' | TakeOutcome; revealed: boolean;
  /** Validation effective (décision admin, sinon IA). Absente = validé (anciens Takes). */
  validation?: TakeValidation;
};

export type TakeValidation = 'draft' | 'validated' | 'refused';

export type TakeVerdict = TakeOutcome | 'manual';

/**
 * Verdict d'un Take : forcé par un admin, sinon annulé s'il a été refusé, sinon calculé sur les courses, sinon à arbitrer
 * (règle absente ou brouillon que l'IA n'a pas pu analyser).
 */
export function takeVerdict(t: LiveTake, dayRaces: Race[]): TakeVerdict {
  if (t.status !== 'pending') return t.status;
  if (t.validation === 'refused') return 'void';
  if (!t.rule || t.validation === 'draft') return 'manual';
  return resolveTake(t.rule, dayRaces);
}

export type SessionFacts = {
  day: string;
  races: number;
  minutes: number;
  start: Date; end: Date;
  table: (Standing & { lasts: number })[];
  mvp: Standing;
  flop: Standing & { lasts: number };
  gapTop2: number | null;
  winStreak: { name: string; n: number } | null;
  lossStreak: { name: string; n: number } | null;
  upset: { name: string; beat: string; gap: number } | null;
  eloUp: { name: string; delta: number } | null;
  eloDown: { name: string; delta: number } | null;
  perfect: string | null;                    // a gagné toutes ses courses (au moins 4)
  winless: string[];                          // au moins 5 courses, zéro victoire
  takes: { take: LiveTake; verdict: TakeVerdict }[];
  scenario: 'domination' | 'serre' | 'spirale' | 'marathon' | 'courte' | 'standard';
};

export function sessionFacts(day: string, all: Race[], elo: EloResult, takes: LiveTake[] = []): SessionFacts | null {
  const races = all.filter((r) => r.day === day);
  if (!races.length) return null;
  const st = standings(races).map((s) => ({ ...s, lasts: s.places[3] }));
  const mvp = st[0];
  const flop = [...st].sort((a, b) => b.avg - a.avg || b.lasts - a.lasts)[0];

  // séries dans la session (sur les courses de chaque pilote)
  let winStreak: SessionFacts['winStreak'] = null, lossStreak: SessionFacts['lossStreak'] = null;
  for (const s of st) {
    let w = 0, l = 0, bw = 0, bl = 0;
    for (const r of races) {
      if (!r.p.includes(s.name)) continue;
      w = r.p[0] === s.name ? w + 1 : 0; l = r.p[3] === s.name ? l + 1 : 0;
      bw = Math.max(bw, w); bl = Math.max(bl, l);
    }
    if (bw >= 3 && (!winStreak || bw > winStreak.n)) winStreak = { name: s.name, n: bw };
    if (bl >= 3 && (!lossStreak || bl > lossStreak.n)) lossStreak = { name: s.name, n: bl };
  }

  // plus grosse surprise : vainqueur le moins bien coté de sa course, avec le plus gros écart
  let upset: SessionFacts['upset'] = null;
  for (const r of races) {
    const pre = elo.before[r.id];
    if (!pre) continue;
    const fav = pre.indexOf(Math.max(...pre));
    const gap = pre[fav] - pre[0];
    if (pre[0] === Math.min(...pre) && gap >= 60 && (!upset || gap > upset.gap)) upset = { name: r.p[0], beat: r.p[fav], gap: Math.round(gap) };
  }

  const moves = st.map((s) => ({ name: s.name, delta: ratingAt(elo, s.name, day) - ratingAt(elo, s.name, day, true) }));
  const up = [...moves].sort((a, b) => b.delta - a.delta)[0];
  const down = [...moves].sort((a, b) => a.delta - b.delta)[0];
  const perfect = st.find((s) => s.races >= 4 && s.wins === s.races)?.name ?? null;
  const winless = st.filter((s) => s.races >= 5 && s.wins === 0).map((s) => s.name);
  const gapTop2 = st.length > 1 ? st[1].avg - st[0].avg : null;

  const scenario: SessionFacts['scenario'] =
    races.length >= 6 && mvp.wins / mvp.races >= 0.5 ? 'domination'
      : gapTop2 !== null && gapTop2 <= 0.12 && races.length >= 6 ? 'serre'
        : lossStreak && lossStreak.n >= 4 ? 'spirale'
          : races.length >= 25 ? 'marathon'
            : races.length < 8 ? 'courte' : 'standard';

  return {
    day, races: races.length, minutes: Math.round(races.length * SETTINGS.raceMinutes),
    start: races[0].ts, end: races.at(-1)!.ts,
    table: st, mvp, flop, gapTop2, winStreak, lossStreak, upset,
    eloUp: up && up.delta >= 8 ? { name: up.name, delta: Math.round(up.delta) } : null,
    eloDown: down && down.delta <= -8 ? { name: down.name, delta: Math.round(down.delta) } : null,
    perfect, winless,
    takes: takes.map((t) => ({ take: t, verdict: takeVerdict(t, races) })),
    scenario,
  };
}
