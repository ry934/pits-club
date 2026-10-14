import { EloResult, groupByDay, monthKey, standings } from './stats';
import { Race } from './types';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Family = 'victoires' | 'sessions' | 'rivalites' | 'carriere' | 'takes' | 'infamie';

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Commun', uncommon: 'Peu commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire',
};
export const FAMILY_LABEL: Record<Family, string> = {
  victoires: 'Victoires', sessions: 'Sessions', rivalites: 'Rivalités', carriere: 'Carrière', takes: 'Takes', infamie: 'Infamie',
};

export type BadgeDef = {
  id: string; name: string; desc: string; condition: string;
  family: Family; rarity: Rarity; target?: number; needsTakes?: boolean;
};

/** Catalogue. Nom en anglais, description et condition en français. */
export const BADGES: BadgeDef[] = [
  { id: 'grand-slam', name: 'Grand Slam', family: 'sessions', rarity: 'legendary', desc: 'Une session entière sans lâcher la première place.', condition: 'Gagner toutes les courses d\'une session de 5 courses ou plus.' },
  { id: 'living-legend', name: 'Living Legend', family: 'carriere', rarity: 'legendary', target: 1000, desc: 'Mille départs. Le paddock te doit un trophée.', condition: 'Disputer 1 000 courses.' },
  { id: 'unstoppable', name: 'Unstoppable', family: 'victoires', rarity: 'epic', target: 10, desc: 'Dix victoires de suite. Plus personne ne te voit.', condition: 'Gagner 10 courses d\'affilée.' },
  { id: 'king-of-the-hill', name: 'King of the Hill', family: 'sessions', rarity: 'epic', desc: 'Meilleure moyenne du mois, couronne méritée.', condition: 'Finir un mois avec la meilleure position moyenne (20 courses minimum).' },
  { id: 'comeback-king', name: 'Comeback King', family: 'sessions', rarity: 'epic', desc: 'Lanterne rouge au départ, premier du jour à l\'arrivée.', condition: 'Finir 4e dans 2 des 3 premières courses de la session, puis terminer la session à la 1re place (6 courses minimum).' },
  { id: 'phoenix', name: 'Phoenix', family: 'victoires', rarity: 'rare', desc: 'Renaître de ses cendres en une course.', condition: 'Gagner juste après 3 dernières places d\'affilée.' },
  { id: 'giant-slayer', name: 'Giant Slayer', family: 'rivalites', rarity: 'uncommon', target: 5, desc: 'Le favori de la table a mordu la poussière.', condition: 'Finir devant le pilote à la meilleure cote de la session dans au moins 5 courses de cette session.' },
  { id: 'perfect-session', name: 'Perfect Session', family: 'sessions', rarity: 'rare', desc: 'Dix courses ou plus, jamais dernier.', condition: 'Jouer 10 courses ou plus dans une session sans finir 4e une seule fois.' },
  { id: 'mr-consistent', name: 'Mr. Consistent', family: 'victoires', rarity: 'rare', target: 15, desc: 'Toujours sur la boîte, quoi qu\'il arrive.', condition: 'Monter sur le podium (top 3) 15 courses d\'affilée.' },
  { id: 'winning-machine', name: 'Winning Machine', family: 'victoires', rarity: 'uncommon', target: 5, desc: 'Cinq victoires de rang, la machine est lancée.', condition: 'Gagner 5 courses d\'affilée.' },
  { id: 'nemesis', name: 'Nemesis', family: 'rivalites', rarity: 'uncommon', target: 10, desc: 'Le même adversaire, dix fois derrière toi.', condition: 'Finir devant le même adversaire 10 courses communes d\'affilée.' },
  { id: 'hot-streak', name: 'Hot Streak', family: 'victoires', rarity: 'common', target: 3, desc: 'Trois victoires de suite, ça chauffe.', condition: 'Gagner 3 courses d\'affilée.' },
  { id: 'choke-artist', name: 'Choke Artist', family: 'infamie', rarity: 'rare', desc: 'Deux victoires pour lancer la session, et puis plus rien.', condition: 'Gagner les 2 premières courses d\'une session, puis la finir hors du top 2 (6 courses minimum).' },
  { id: 'wooden-spoon', name: 'Wooden Spoon', family: 'infamie', rarity: 'common', target: 5, desc: 'Cinq fois dernier d\'affilée. La cuillère de bois est à toi.', condition: 'Finir 4e 5 courses d\'affilée.' },
  { id: 'called-it', name: 'Called It!', family: 'takes', rarity: 'rare', needsTakes: true, desc: 'Un Take osé, validé.', condition: 'Gagner un Take coté 50 points ou plus.' },
  { id: 'mind-reader', name: 'Mind Reader', family: 'takes', rarity: 'rare', needsTakes: true, target: 3, desc: 'Tu lis dans les manettes.', condition: 'Gagner 3 Takes d\'affilée.' },
  { id: 'plot-twist', name: 'Plot Twist', family: 'takes', rarity: 'epic', needsTakes: true, desc: 'Personne n\'y croyait. Toi si.', condition: 'Gagner un Take dont la probabilité était inférieure à 10 %.' },
  { id: 'false-prophet', name: 'False Prophet', family: 'takes', rarity: 'uncommon', needsTakes: true, target: 5, desc: 'Cinq prophéties, cinq ratés.', condition: 'Perdre 5 Takes d\'affilée.' },
];
export const BADGE = Object.fromEntries(BADGES.map((b) => [b.id, b])) as Record<string, BadgeDef>;

export type Unlock = { badge: string; player: string; day: string; detail?: string };
export type Holding = { count: number; first: string; last: string };
export type BadgeBook = {
  events: Unlock[];                                    // chronologique
  held: Map<string, Map<string, Holding>>;            // joueur -> badge -> obtention
  progress: Map<string, Map<string, number>>;         // joueur -> badge -> meilleur score atteint
};

export function computeBadges(races: Race[], elo: EloResult): BadgeBook {
  const events: Unlock[] = [];
  const best = new Map<string, Map<string, number>>();
  const bump = (p: string, b: string, v: number) => {
    const m = best.get(p) ?? new Map<string, number>();
    m.set(b, Math.max(m.get(b) ?? 0, v)); best.set(p, m);
  };
  const emit = (badge: string, player: string, day: string, detail?: string) => {
    if (player !== 'Other') events.push({ badge, player, day, detail });
  };

  // ---- séries course par course
  type S = { win: number; last: number; podium: number; count: number };
  const st = new Map<string, S>();
  const pair = new Map<string, number>(); // "a|b" = courses d'affilée où a est devant b
  for (const r of races) {
    r.p.forEach((n, i) => {
      const s = st.get(n) ?? { win: 0, last: 0, podium: 0, count: 0 };
      s.count++;
      if (s.count === 1000) emit('living-legend', n, r.day);
      bump(n, 'living-legend', s.count);
      if (i === 0) {
        if (s.last >= 3) emit('phoenix', n, r.day, `après ${s.last} dernières places`);
        s.win++;
        if (s.win === 3) emit('hot-streak', n, r.day);
        if (s.win === 5) emit('winning-machine', n, r.day);
        if (s.win === 10) emit('unstoppable', n, r.day);
        for (const b of ['hot-streak', 'winning-machine', 'unstoppable']) bump(n, b, s.win);
      } else s.win = 0;
      if (i === 3) {
        s.last++;
        if (s.last === 5) emit('wooden-spoon', n, r.day);
        bump(n, 'wooden-spoon', s.last);
      } else s.last = 0;
      if (i < 3) {
        s.podium++;
        if (s.podium === 15) emit('mr-consistent', n, r.day);
        bump(n, 'mr-consistent', s.podium);
      } else s.podium = 0;
      st.set(n, s);
    });
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = r.p[i], b = r.p[j];
      const k = a + '|' + b;
      const v = (pair.get(k) ?? 0) + 1;
      pair.set(k, v); pair.set(b + '|' + a, 0);
      if (v === 10) emit('nemesis', a, r.day, `devant ${b}`);
      bump(a, 'nemesis', v);
    }
  }

  // ---- sessions
  const ratingBefore = (name: string, firstRaceId: number) => {
    // cote du joueur juste avant la session : on remonte à sa dernière course précédente
    for (let id = firstRaceId - 1; id >= 0; id--) {
      const r = races[id], i = r.p.indexOf(name);
      if (i >= 0) return elo.before[id][i];
    }
    return 1500;
  };
  for (const [day, rs] of groupByDay(races)) {
    const table = standings(rs);
    const names = table.map((t) => t.name);
    // Grand Slam
    if (rs.length >= 5 && rs.every((r) => r.p[0] === rs[0].p[0])) emit('grand-slam', rs[0].p[0], day, `${rs.length} sur ${rs.length}`);
    // Perfect Session
    for (const t of table) if (t.races >= 10 && t.places[3] === 0) emit('perfect-session', t.name, day, `${t.races} courses`);
    // Giant Slayer
    const fav = [...names].sort((a, b) => ratingBefore(b, rs[0].id) - ratingBefore(a, rs[0].id))[0];
    for (const n of names) {
      if (n === fav) continue;
      const ahead = rs.filter((r) => r.p.includes(n) && r.p.includes(fav) && r.p.indexOf(n) < r.p.indexOf(fav)).length;
      bump(n, 'giant-slayer', ahead);
      if (ahead >= 5) emit('giant-slayer', n, day, `devant ${fav} ${ahead} fois`);
    }
    // Comeback King / Choke Artist
    for (const t of table) {
      if (t.races < 6) continue;
      const mine = rs.filter((r) => r.p.includes(t.name)).map((r) => r.p.indexOf(t.name) + 1);
      if (mine.slice(0, 3).filter((x) => x === 4).length >= 2 && t.rank === 1) emit('comeback-king', t.name, day);
      if (mine[0] === 1 && mine[1] === 1 && t.rank >= 3) emit('choke-artist', t.name, day, `${t.rank}e du jour`);
    }
  }

  // ---- mois terminés
  const months = new Map<string, Race[]>();
  for (const r of races) { const k = monthKey(r.day); const a = months.get(k); a ? a.push(r) : months.set(k, [r]); }
  const currentMonth = monthKey(races.at(-1)?.day ?? '');
  for (const [m, rs] of months) {
    if (m === currentMonth) continue;
    const champ = standings(rs).filter((s) => s.races >= 20 && s.name !== 'Other')[0];
    if (champ) emit('king-of-the-hill', champ.name, rs.at(-1)!.day, m);
  }

  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const held = new Map<string, Map<string, Holding>>();
  for (const e of events) {
    const m = held.get(e.player) ?? new Map<string, Holding>();
    const h = m.get(e.badge);
    if (h) { h.count++; h.last = e.day; } else m.set(e.badge, { count: 1, first: e.day, last: e.day });
    held.set(e.player, m);
  }
  return { events, held, progress: best };
}
