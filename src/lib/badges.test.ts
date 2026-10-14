import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { BADGES, computeBadges } from './badges';
import { cleanRaces, computeElo } from './stats';
import { RawRace } from './types';

const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d]) => ({ ts, p: [a, b, c, d], src: 'archive' }));
const { races } = cleanRaces(raw);
const book = computeBadges(races, computeElo(races));

describe('badges', () => {
  it('se calculent sur l\'historique', () => {
    const summary = BADGES.filter((b) => !b.needsTakes).map((b) => {
      const ev = book.events.filter((e) => e.badge === b.id);
      return `${b.id}: ${ev.length} fois, ${new Set(ev.map((e) => e.player)).size} pilotes`;
    });
    console.log(summary.join('\n'));
    expect(book.events.some((e) => e.badge === 'unstoppable' && e.player === 'Paul')).toBe(true);
    expect(book.events.some((e) => e.badge === 'living-legend' && e.player === 'Charlie')).toBe(true);
  });
});
