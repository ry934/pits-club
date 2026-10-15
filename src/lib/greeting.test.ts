import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { greeting } from './greeting';
import { cleanRaces } from './stats';
import { RawRace } from './types';

const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d]) => ({ ts, p: [a, b, c, d], src: 'archive' }));
const { races } = cleanRaces(raw);

describe('message d accueil', () => {
  it('varie selon le joueur et le jour', () => {
    const out: string[] = [];
    for (const n of ['Ayann', 'Paul', 'Louane', 'Romaing', 'Auguste']) {
      for (const d of [15, 16, 19]) out.push(`${n} ${d}/10 : ` + greeting(n, n === 'Ayann' ? 'Zay' : n, races, new Date(2026, 9, d, 8)));
    }
    console.log(out.join('\n'));
    expect(out.every((l) => !l.includes('undefined'))).toBe(true);
    expect(new Set(out.map((l) => l.split(' : ')[1])).size).toBeGreaterThan(10);
  });
  it('fonctionne pour un pilote sans course', () => {
    expect(greeting('Nouveau', 'Nouveau', races)).not.toContain('undefined');
  });
});
