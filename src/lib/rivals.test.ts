import { describe, expect, it } from 'vitest';
import { recentRivals } from './stats';
import { Race } from './types';

let id = 0;
const race = (day: string, p: [string, string, string, string]): Race => {
  const iso = `${day}T13:00:00`;
  return { id: id++, ts: new Date(iso), iso, day, p, src: 'form' };
};

// Septembre : Paul écrase Grominou. Octobre : Paul ne vient plus, Léa prend le dessus.
const races: Race[] = [
  ...Array.from({ length: 30 }, () => race('2026-09-10', ['Paul', 'Léa', 'Grominou', 'Max'])),
  ...Array.from({ length: 20 }, (_, i) => race('2026-10-15', i % 4 === 0 ? ['Grominou', 'Léa', 'Max', 'Tom'] : ['Léa', 'Grominou', 'Tom', 'Max'])),
];

describe('rivalités du moment', () => {
  it("un joueur absent des dernières courses n'est plus la némésis", () => {
    const r = recentRivals(races, 'Grominou');
    expect(r.window).toBe(20);
    expect(r.nemesis?.opp).toBe('Léa');
    expect(r.h2h.some((h) => h.opp === 'Paul')).toBe(false);
  });
  it('la victime est celui que le pilote bat le plus sur la fenêtre', () => {
    expect(['Max', 'Tom']).toContain(recentRivals(races, 'Grominou').victim?.opp);
  });
  it('pas de némésis sans assez de confrontations récentes', () => {
    expect(recentRivals(races.slice(0, 32), 'Tom').nemesis).toBeNull();
  });
});
