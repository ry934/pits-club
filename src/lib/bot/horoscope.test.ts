import { describe, expect, it } from 'vitest';
import { horoscopePrompt, parseHoroscopes, parseNews } from './server';
import { horoscope, horoscopeFacts } from '../daily';
import { cleanRaces } from '../stats';
import seed from '../../data/seed.json';
import type { RawRace } from '../types';

const players = [{ name: 'Romaing', display: 'Grominou' }, { name: 'Roro', display: 'RoroDelRoro' }];

describe('horoscope IA', () => {
  it('lit les actus même entourées de texte', () => {
    const n = parseNews('Voici : {"news":[{"titre":"Un panda fait du ski à Chamonix","resume":"Vidéo virale."},{"titre":"x"}]} merci');
    expect(n).toEqual([{ titre: 'Un panda fait du ski à Chamonix', resume: 'Vidéo virale.' }]);
  });

  it('retrouve les pilotes par surnom et rejette les entrées incomplètes', () => {
    const raw = JSON.stringify({ horoscopes: [
      { pilote: 'grominou', signe: 'Banane ascendant Carapace', actu: 'Panda skieur', lignes: ['Comme le panda, tu vas glisser.', 'Ta moyenne de 2,31 tremble.', 'Évite la neige.'], place: 2, astre: 'RoroDelRoro' },
      { pilote: 'Inconnu', lignes: ['a a a a a a a a a', 'b b b b b b b b b'] },
      { pilote: 'Roro', lignes: ['une seule ligne ici'] },
    ] });
    const out = parseHoroscopes(raw, players);
    expect(Object.keys(out)).toEqual(['Romaing']);
    expect(out.Romaing).toMatchObject({ sign: 'Banane ascendant Carapace', lucky: 2, star: 'Roro', news: 'Panda skieur' });
  });

  it('construit le prompt avec les surnoms et des faits réels', () => {
    const { races } = cleanRaces((seed.races as string[][]).map(([ts, a, b, c, d, src]) => ({ ts, p: [a, b, c, d], src: src as RawRace['src'] })));
    const name = races.at(-1)?.p[0];
    if (!name) return;
    const f = horoscopeFacts(name, races, races.at(-1)!.day);
    expect(f.courses).toBeGreaterThan(0);
    const { user } = horoscopePrompt('2026-10-21', [f], [], { tone: 'taquin', label: (n) => `@${n}`, optout: [], recent: [], appUrl: '', includeTakes: false });
    expect(user).toContain(`"pilote":"@${name}"`);
    expect(horoscope(name, races, '2026-10-21').lines.length).toBeGreaterThan(0);
  });
});
