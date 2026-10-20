import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { cleanRaces, computeElo, groupByDay } from './stats';
import { liveFeed, liveTable, nextRaceOdds, raceMoments } from './live';
import { RawRace } from './types';

const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d, s]) => ({
  ts, p: [a, b, c, d], src: s === 'a' ? 'archive' : 'form',
}));
const { races } = cleanRaces(raw);
const elo = computeElo(races);
const byDay = groupByDay(races);

describe('mode direct', () => {
  it('classe la session du 31/07/2026 et calcule écarts et évolutions', () => {
    const day = byDay.get('2026-07-31')!;
    const t = liveTable(day);
    expect(t[0].gap).toBe(0);
    expect(t.every((r, i) => i === 0 || r.gap >= 0)).toBe(true);
    expect(t.reduce((s, r) => s + r.races, 0)).toBe(day.length * 4);
  });
  it('produit un fil avec une victoire par course au minimum', () => {
    const day = byDay.get('2026-07-31')!;
    const f = liveFeed(day, elo);
    expect(f.filter((e) => ['win', 'first', 'upset'].includes(e.kind)).length).toBe(day.length);
    expect(f[0].n).toBe(day.length);
  });
  it('cote : probabilités qui somment à 1', () => {
    const o = nextRaceOdds(['Paul', 'Charlie', 'Camille', 'Ayann'], elo);
    expect(o.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 6);
  });
});

describe('moments forts du direct', () => {
  const mk = (id: number, p: string[]) => ({ id, ts: new Date(2026, 9, 20, 13, id), day: '2026-10-20', p }) as unknown as (typeof races)[number];
  const day = [mk(1, ['A', 'B', 'C', 'D']), mk(2, ['A', 'C', 'B', 'D']), mk(3, ['B', 'A', 'C', 'D']), mk(4, ['A', 'C', 'B', 'D'])];
  const e = computeElo(day);
  it('détecte le hat trick (3e victoire) et la spirale de 4e places', () => {
    const m = raceMoments(day, e);
    expect(m.find((x) => x.kicker === 'Hat trick !')?.who).toBe('A');
    expect(m.find((x) => x.tone === 'red')?.title).toBe('D : 4 fois 4e de suite');
  });
  it('préfère la série à la simple répétition et respecte les pilotes à ne pas chambrer', () => {
    const run = [...day.slice(0, 2), mk(3, ['A', 'B', 'C', 'D'])];
    const m = raceMoments(run, computeElo(run), (n) => n, ['D']);
    expect(m[0].title).toBe("A enchaîne 3 victoires d'affilée");
    expect(m.some((x) => x.who === 'D')).toBe(false);
  });
});
