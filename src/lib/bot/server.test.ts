import { describe, expect, it } from 'vitest';
import { cleanStory, firstJson, validateRule } from './server';

const names = ['Paul', 'Ayann', 'Charlie'];
describe('validation des Takes renvoyés par l’IA', () => {
  it('accepte une règle propre et normalise les noms', () => {
    expect(validateRule({ kind: 'duel', a: 'ayann', b: 'Paul' }, names)).toEqual({ kind: 'duel', a: 'Ayann', b: 'Paul' });
    expect(validateRule({ kind: 'wins-min', p: 'Charlie', n: 2.4 }, names)).toEqual({ kind: 'wins-min', p: 'Charlie', n: 2 });
  });
  it('refuse les pilotes inconnus, les duels contre soi-même et les valeurs absurdes', () => {
    expect(validateRule({ kind: 'duel', a: 'Bob', b: 'Paul' }, names)).toBeNull();
    expect(validateRule({ kind: 'duel', a: 'Paul', b: 'paul' }, names)).toBeNull();
    expect(validateRule({ kind: 'avg-better', p: 'Paul', x: 7 }, names)).toBeNull();
    expect(validateRule({ kind: 'hack', p: 'Paul' }, names)).toBeNull();
  });
  it('extrait le JSON et filtre les récits trop courts', () => {
    expect(firstJson('Voici : {"ok":true} merci')).toEqual({ ok: true });
    expect(cleanStory('Trop court')).toBeNull();
  });
});
