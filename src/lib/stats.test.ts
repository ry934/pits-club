import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { allRuns, cleanRaces, computeElo, playerDays, records, standings } from './stats';
import { RawRace } from './types';

const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d, s]) => ({
  ts, p: [a, b, c, d], src: s === 'a' ? 'archive' : 'form',
}));
const { races, flagged, replaced } = cleanRaces(raw);
const runs = allRuns(races);
const rec = records(races, runs, playerDays(races));

describe('nettoyage', () => {
  it('écarte les doublons et les noms en double', () => {
    expect(raw.length).toBe(2457);
    expect(replaced.length).toBe(20);
    expect(flagged.length).toBe(14);
    expect(races.length).toBe(2423);
  });
});

describe('records identiques au Sheet', () => {
  it('séries', () => {
    expect(rec.winRuns.slice(0, 3).map((r) => [r.name, r.length])).toEqual([['Paul', 12], ['Paul', 12], ['Paul', 12]]);
    // Le Sheet ne voit pas la série de Baptiste (14/03 -> 11/04/2024, sur 3 journées) : elle est bien réelle.
    expect([rec.lastRuns[0].name, rec.lastRuns[0].length]).toEqual(['Baptiste', 12]);
    expect(rec.lastRuns.some((r) => r.name === 'Maxence' && r.length === 8 && r.start.day === '2024-02-22')).toBe(true);
  });
  it('journées', () => {
    expect(rec.biggestDays[0]).toMatchObject({ day: '2026-07-31', races: 40 });
    expect(rec.mostWins[0]).toMatchObject({ name: 'Paul', wins: 18, races: 24, day: '2024-08-01' });
    expect(rec.mostLasts[0]).toMatchObject({ name: 'Louane', lasts: 17, races: 21, day: '2026-07-31' });
    // 16/09/2025 : le Sheet compte une double saisie ; une fois nettoyée, Paul fait 7 sur 7.
    expect(rec.bestDays.slice(0, 2).map((d) => [d.name, d.day, d.races])).toEqual([['Paul', '2025-09-16', 7], ['Charlie', '2026-07-06', 6]]);
  });
  it('moyennes all time', () => {
    const s = Object.fromEntries(standings(races).map((x) => [x.name, +x.avg.toFixed(2)]));
    expect(s.Paul).toBe(1.55);
    expect(s.Louane).toBe(3.46);
  });
  it('Elo', () => {
    const elo = computeElo(races);
    expect(Math.round(elo.rating.get('Paul')!)).toBeGreaterThan(1750);
  });
});
