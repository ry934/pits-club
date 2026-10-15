import { describe, expect, it } from 'vitest';
import seed from '../../data/seed.json';
import { cleanRaces, computeElo, groupByDay } from '../stats';
import { RawRace } from '../types';
import { LiveTake, sessionFacts } from './facts';
import { buildDebrief, buildExtra, buildReminder, BotOptions } from './messages';

const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d, s]) => ({ ts, p: [a, b, c, d], src: s === 'a' ? 'archive' : 'form' }));
const { races } = cleanRaces(raw);
const elo = computeElo(races);
const days = [...groupByDay(races).keys()];
const opts = (tone: BotOptions['tone'], recent: string[] = []): BotOptions => ({ tone, appUrl: 'https://pits-club.vercel.app', label: (n) => n, optout: [], recent, includeTakes: true });

const takes: LiveTake[] = [
  { id: '1', author: 'Camille', text: 'Charlie finit derrière moi', rule: { kind: 'duel', a: 'Camille', b: 'Charlie' }, label: null, probability: 0.4, points: 25, status: 'pending', revealed: true },
  { id: '2', author: 'Paul', text: 'Je gagne au moins 3 courses', rule: { kind: 'wins-min', p: 'Paul', n: 3 }, label: null, probability: 0.3, points: 33, status: 'pending', revealed: true },
  { id: '3', author: 'Romaing', text: 'Quelqu’un va pleurer', rule: null, label: null, probability: null, points: null, status: 'pending', revealed: true },
];

describe('bot Slack', () => {
  it('rédige un débrief pour chacune des 30 dernières sessions, dans les trois tonalités', () => {
    for (const day of days.slice(-30)) {
      const f = sessionFacts(day, races, elo, takes)!;
      for (const tone of ['sobre', 'taquin', 'piquant'] as const) {
        const m = buildDebrief(f, opts(tone));
        expect(m.text).toContain(`/#/session/${day}`);
        expect(m.text).toContain('Classement du jour');
        expect(m.text).not.toMatch(/undefined|NaN|null/);
        if (tone === 'sobre') expect(m.meta.ids.some((id) => id.startsWith('f-'))).toBe(false);
      }
    }
  });
  it('évite de répéter les phrases utilisées récemment', () => {
    const f = sessionFacts(days.at(-1)!, races, elo, takes)!;
    const a = buildDebrief(f, opts('taquin'));
    const b = buildDebrief(f, opts('taquin', a.meta.ids));
    expect(b.meta.ids.filter((id) => a.meta.ids.includes(id)).length).toBeLessThan(a.meta.ids.length);
  });
  it("n'épingle jamais un pilote exclu du chambrage", () => {
    for (const day of days.slice(-30)) {
      const f = sessionFacts(day, races, elo)!;
      const m = buildDebrief(f, { ...opts('piquant'), optout: [f.flop.name] });
      expect(m.meta.ids.some((id) => id.startsWith('f-'))).toBe(false);
    }
  });
  it('rappel et prolongations', () => {
    const r = buildReminder({ day: '2026-10-15', deadline: '13h00', posted: ['Camille'] }, opts('taquin'));
    expect(r.text).toContain('/#/takes');
    expect(r.text).toContain('Camille');
    const f = sessionFacts(days.at(-1)!, races, elo)!;
    expect(buildExtra(f, opts('taquin')).text).toContain('Classement du jour');
  });
  it('échantillon', () => {
    for (const day of days.slice(-4)) console.log('\n---- ' + day + '\n' + buildDebrief(sessionFacts(day, races, elo, takes)!, opts('taquin')).text);
    console.log('\n---- sobre\n' + buildDebrief(sessionFacts(days.at(-1)!, races, elo, takes)!, opts('sobre')).text);
    console.log('\n---- rappel\n' + buildReminder({ day: '2026-10-15', deadline: '13h00', posted: ['Camille', 'Paul'] }, opts('taquin')).text);
  });
});
