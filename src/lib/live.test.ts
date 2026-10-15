import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { cleanRaces, computeElo, groupByDay } from './stats';
import { liveFeed, liveTable, nextRaceOdds } from './live';
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
