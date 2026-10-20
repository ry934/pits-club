import { describe, expect, it } from 'vitest';
import { LiveTake, takeVerdict } from './bot/facts';
import { takeContext } from './takes';
import { Race } from './types';

const race = (id: number, day: string, p: string[]): Race => ({ id, ts: new Date(0), iso: '', day, p: p as Race['p'], src: 'app' });
const day = [0, 1, 2, 3].map((i) => race(i, '2026-10-20', ['Paul', 'Roro', 'Charlie', 'Louane']));
const base: LiveTake = { id: 't', author: 'Roro', text: 'Paul devant Roro', rule: { kind: 'duel', a: 'Paul', b: 'Roro' }, label: null, probability: 0.5, points: 20, status: 'pending', revealed: true };

describe('cycle de validation des Takes', () => {
  it('un Take validé est résolu sur les courses', () => {
    expect(takeVerdict({ ...base, validation: 'validated' }, day)).toBe('won');
    expect(takeVerdict(base, day)).toBe('won'); // anciens Takes, sans champ de validation
  });
  it('un Take refusé (IA ou admin) est annulé', () => {
    expect(takeVerdict({ ...base, validation: 'refused' }, day)).toBe('void');
  });
  it("un brouillon que l'IA n'a pas pu analyser part en arbitrage", () => {
    expect(takeVerdict({ ...base, validation: 'draft' }, day)).toBe('manual');
  });
  it("le verdict forcé par l'admin l'emporte sur tout", () => {
    expect(takeVerdict({ ...base, validation: 'refused', status: 'won' }, day)).toBe('won');
  });
  it('contexte de cote : dernière session avant le jour, moyenne de courses', () => {
    const races = [...[0, 1].map((i) => race(i, '2026-10-19', ['Paul', 'Roro', 'Cam', 'Bap2'])), ...day];
    expect(takeContext(races, '2026-10-20')).toEqual({ lineup: ['Paul', 'Roro', 'Cam', 'Bap2'], avgRaces: 2 });
  });
});
