import { estimateProbability, seedOf } from './takes';
import { EloResult, groupByDay, monthKey, parseLocal, standings } from './stats';
import { Race } from './types';

/**
 * Catalogue des trophées : conditions reprises du cahier des charges (section Badges, liste de Romain).
 * Ce qui demande des données pas encore collectées (Takes, annonces, horoscope) est marqué `pending`.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Family = 'victoires' | 'sessions' | 'rivalites' | 'carriere' | 'records' | 'pronostics' | 'infamie';
export type Kind = 'Unique' | 'Cumulable' | 'Milestone' | 'Unique par collection';

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Commun', uncommon: 'Peu commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire',
};
export const FAMILY_LABEL: Record<Family, string> = {
  victoires: 'Victoires', sessions: 'Sessions', rivalites: 'Rivalités', carriere: 'Carrière',
  records: 'Records', pronostics: 'Pronostics', infamie: 'Infamie',
};

export type BadgeDef = {
  id: string; name: string; desc: string; condition: string; kind: Kind;
  family: Family; rarity: Rarity; target?: number; pending?: string;
};

const TAKES = 'Arrive avec les Takes (lot 2)';
const ANNOUNCE = 'Arrive avec les annonces Slack (lot 2)';
const IRMA = 'Arrive avec l\'horoscope IA (lot 3)';

export const BADGES: BadgeDef[] = [
  // ---- légendaires
  { id: 'grand-slam', name: 'Grand Slam', family: 'sessions', rarity: 'legendary', kind: 'Unique', desc: 'Une session entière sans lâcher la première place.', condition: 'Gagner toutes les courses d\'une session d\'au moins 5 courses.' },
  { id: 'living-legend', name: 'Living Legend', family: 'carriere', rarity: 'legendary', kind: 'Milestone', target: 1000, desc: 'Mille départs et un an de paddock.', condition: 'Atteindre 1 000 courses et un an d\'ancienneté dans le groupe.' },
  { id: 'main-character', name: 'Main Character', family: 'records', rarity: 'legendary', kind: 'Unique', target: 3, desc: 'Le livre des records porte ton nom, trois fois.', condition: 'Détenir simultanément 3 records historiques.' },
  { id: 'completionist', name: 'Completionist', family: 'carriere', rarity: 'legendary', kind: 'Unique par collection', desc: 'Une famille complète, du premier au dernier trophée.', condition: 'Débloquer tous les badges d\'une collection.' },
  // ---- victoires
  { id: 'unstoppable', name: 'Unstoppable', family: 'victoires', rarity: 'epic', kind: 'Cumulable', target: 10, desc: 'Dix victoires de suite. Plus personne ne te voit.', condition: 'Gagner 10 courses consécutives.' },
  { id: 'winning-machine', name: 'Winning Machine', family: 'victoires', rarity: 'uncommon', kind: 'Cumulable', target: 5, desc: 'Cinq victoires de rang, la machine est lancée.', condition: 'Gagner 5 courses consécutives.' },
  { id: 'phoenix', name: 'Phoenix', family: 'victoires', rarity: 'rare', kind: 'Cumulable', desc: 'Renaître de ses cendres en une course.', condition: 'Gagner une course immédiatement après 3 dernières places consécutives.' },
  { id: 'hot-streak', name: 'Hot Streak', family: 'victoires', rarity: 'common', kind: 'Cumulable', target: 5, desc: 'Cinq courses brûlantes d\'affilée.', condition: 'Obtenir un ratio moyen ≤ 1,5 sur au moins 5 courses consécutives.' },
  { id: 'mr-consistent', name: 'Mr. Consistent', family: 'victoires', rarity: 'rare', kind: 'Cumulable', target: 10, desc: 'Toujours dans les deux premiers.', condition: 'Terminer dans le top 2 sur 10 courses consécutives.' },
  // ---- sessions
  { id: 'perfect-session', name: 'Perfect Session', family: 'sessions', rarity: 'uncommon', kind: 'Cumulable', desc: 'Dix courses ou plus, et le meilleur de tous à l\'arrivée.', condition: 'Finir premier au classement moyen d\'une session d\'au moins 10 courses.' },
  { id: 'king-of-the-hill', name: 'King of the Hill', family: 'sessions', rarity: 'epic', kind: 'Cumulable', target: 5, desc: 'Cinq sessions de suite en haut de l\'affiche.', condition: 'Terminer n°1 du classement général à la fin de 5 sessions consécutives.' },
  { id: 'comeback-king', name: 'Comeback King', family: 'sessions', rarity: 'epic', kind: 'Cumulable', desc: 'Lanterne rouge à la mi-temps, premier à l\'arrivée.', condition: 'Être dernier au classement provisoire puis premier au classement final.' },
  { id: 'dark-horse', name: 'Dark Horse', family: 'sessions', rarity: 'common', kind: 'Cumulable', desc: 'Personne ne t\'attendait si haut.', condition: 'Réaliser la plus grosse surperformance de la session par rapport à son classement attendu.' },
  { id: 'marathon-runner', name: 'Marathon Runner', family: 'sessions', rarity: 'uncommon', kind: 'Cumulable', desc: 'La pause déjeuner a débordé.', condition: 'Participer à une session d\'au moins 20 courses.' },
  { id: 'plot-twist', name: 'Plot Twist', family: 'sessions', rarity: 'epic', kind: 'Cumulable', desc: 'Moins d\'une chance sur dix, et pourtant.', condition: 'Gagner une session avec moins de 10 % de chances de victoire estimées avant celle-ci.' },
  // ---- rivalités
  { id: 'giant-slayer', name: 'Giant Slayer', family: 'rivalites', rarity: 'uncommon', kind: 'Cumulable', target: 5, desc: 'Le favori de la table a mordu la poussière.', condition: 'Finir devant le joueur n°1 de la cote sur au moins 5 courses d\'une même session.' },
  { id: 'giant-killer', name: 'Giant Killer', family: 'rivalites', rarity: 'rare', kind: 'Cumulable', target: 5, desc: 'Cinq fois de suite devant le patron.', condition: 'Battre le joueur le mieux classé au général sur 5 courses consécutives.' },
  { id: 'nemesis', name: 'Nemesis', family: 'rivalites', rarity: 'rare', kind: 'Cumulable', target: 10, desc: 'Ton bourreau, dix fois derrière toi.', condition: 'Battre le joueur qui vous domine le plus souvent sur 10 confrontations directes consécutives.' },
  { id: 'sweet-revenge', name: 'Sweet Revenge', family: 'rivalites', rarity: 'rare', kind: 'Cumulable', desc: 'Une session entière devant ta némésis.', condition: 'Finir devant sa némésis sur toutes les courses communes d\'une session d\'au moins 5 courses.' },
  { id: 'rivalry-winner', name: 'Rivalry Winner', family: 'rivalites', rarity: 'common', kind: 'Cumulable', desc: 'Duel du jour remporté.', condition: 'Remporter le bilan face à un adversaire sur une session d\'au moins 10 courses communes.' },
  { id: 'the-troll', name: 'The Troll', family: 'rivalites', rarity: 'common', kind: 'Cumulable', target: 5, desc: 'Ton adversaire préféré ne rigole plus.', condition: 'Battre son rival préféré sur 5 courses consécutives.' },
  // ---- carrière
  { id: 'centurion', name: 'Centurion', family: 'carriere', rarity: 'common', kind: 'Milestone', target: 100, desc: 'Cent départs au compteur.', condition: 'Atteindre 100 courses disputées.' },
  { id: '500-club', name: '500 Club', family: 'carriere', rarity: 'rare', kind: 'Milestone', target: 500, desc: 'Membre du club des 500.', condition: 'Atteindre 500 courses disputées.' },
  { id: 'millennium-racer', name: 'Millennium Racer', family: 'carriere', rarity: 'epic', kind: 'Milestone', target: 1000, desc: 'Mille courses, une carrière.', condition: 'Atteindre 1 000 courses disputées.' },
  { id: 'loyal-racer', name: 'Loyal Racer', family: 'carriere', rarity: 'uncommon', kind: 'Cumulable', target: 10, desc: 'Dix sessions sans en rater une.', condition: 'Participer à 10 sessions consécutives.' },
  { id: 'no-days-off', name: 'No Days Off', family: 'carriere', rarity: 'rare', kind: 'Cumulable', target: 20, desc: 'Vingt sessions d\'affilée, présent à chaque fois.', condition: 'Participer à 20 sessions consécutives sans manquer une session officiellement organisée.' },
  { id: 'veteran-racer', name: 'Veteran Racer', family: 'carriere', rarity: 'rare', kind: 'Milestone', target: 100, desc: 'Cent pauses déjeuner sur la grille.', condition: 'Participer à 100 sessions au total.' },
  { id: 'the-collector', name: 'The Collector', family: 'carriere', rarity: 'rare', kind: 'Milestone', target: 10, desc: 'La vitrine se remplit.', condition: 'Débloquer 10 badges différents.' },
  // ---- records
  { id: 'record-breaker', name: 'Record Breaker', family: 'records', rarity: 'epic', kind: 'Cumulable', desc: 'Une page du livre réécrite.', condition: 'Battre un record historique (all-time).' },
  // ---- infamie
  { id: 'dead-last', name: 'Dead Last', family: 'infamie', rarity: 'common', kind: 'Cumulable', target: 5, desc: 'Cinq fois dernier d\'affilée.', condition: 'Terminer dernier sur 5 courses consécutives.' },
  { id: 'wooden-spoon', name: 'Wooden Spoon', family: 'infamie', rarity: 'common', kind: 'Cumulable', desc: 'La cuillère de bois du jour est à toi.', condition: 'Terminer dernier au classement moyen d\'une session d\'au moins 5 courses.' },
  { id: 'cursed', name: 'Cursed', family: 'infamie', rarity: 'uncommon', kind: 'Cumulable', desc: 'Une session où rien ne passe.', condition: 'Terminer dernier sur au moins 50 % des courses d\'une session de 10 courses ou plus.' },
  { id: 'choke-artist', name: 'Choke Artist', family: 'infamie', rarity: 'rare', kind: 'Cumulable', desc: 'En tête à la mi-temps, dernier au drapeau.', condition: 'Être premier au classement provisoire puis dernier au classement final.' },
  // ---- pronostics (données à venir)
  { id: 'oracle', name: 'Oracle', family: 'pronostics', rarity: 'uncommon', kind: 'Cumulable', pending: TAKES, desc: 'Trois prédictions, trois réussites.', condition: 'Réussir 3 prédictions consécutives.' },
  { id: 'mind-reader', name: 'Mind Reader', family: 'pronostics', rarity: 'rare', kind: 'Cumulable', pending: TAKES, desc: 'Tu lis dans les manettes.', condition: 'Réussir 5 prédictions consécutives sur des duels entre joueurs.' },
  { id: 'high-roller', name: 'High Roller', family: 'pronostics', rarity: 'uncommon', kind: 'Cumulable', pending: TAKES, desc: 'Un pari osé, encaissé.', condition: 'Réussir une prédiction cotée à 50 points ou plus.' },
  { id: 'all-in', name: 'All In', family: 'pronostics', rarity: 'epic', kind: 'Cumulable', pending: TAKES, desc: 'Tapis, et ça passe.', condition: 'Réussir une prédiction à très forte cote définie par le système.' },
  { id: 'called-it', name: 'Called It!', family: 'pronostics', rarity: 'rare', kind: 'Cumulable', pending: TAKES, desc: 'Seul contre tous, et raison.', condition: 'Être le seul à avoir correctement prédit le vainqueur d\'une session.' },
  { id: 'madame-irma', name: 'Madame Irma', family: 'pronostics', rarity: 'rare', kind: 'Cumulable', pending: IRMA, desc: 'Les astres t\'obéissent.', condition: 'Obtenir un horoscope exact pendant 5 jours de jeu consécutifs.' },
  { id: 'false-prophet', name: 'False Prophet', family: 'pronostics', rarity: 'uncommon', kind: 'Cumulable', pending: TAKES, desc: 'Cinq prophéties, cinq ratés.', condition: 'Rater 5 prédictions consécutives.' },
  { id: 'sandbagger', name: 'The Sandbagger', family: 'pronostics', rarity: 'uncommon', kind: 'Cumulable', pending: ANNOUNCE, desc: '« Je suis nul aujourd\'hui. » Puis premier.', condition: 'Annoncer une mauvaise performance puis finir premier au classement moyen.' },
  { id: 'big-mouth', name: 'Big Mouth', family: 'pronostics', rarity: 'uncommon', kind: 'Cumulable', pending: ANNOUNCE, desc: 'Grande gueule, petite session.', condition: 'Annoncer une victoire puis finir dernier au classement moyen.' },
  { id: 'humble-bragger', name: 'Humble Bragger', family: 'pronostics', rarity: 'rare', kind: 'Cumulable', pending: ANNOUNCE, desc: 'Annoncé, et même dépassé.', condition: 'Battre son record personnel après avoir annoncé sa domination.' },
];
export const BADGE = Object.fromEntries(BADGES.map((b) => [b.id, b])) as Record<string, BadgeDef>;
export const isInfamy = (b: BadgeDef) => b.family === 'infamie' || ['false-prophet', 'big-mouth'].includes(b.id);

export type Unlock = { badge: string; player: string; day: string; detail?: string };
export type Holding = { count: number; first: string; last: string };
export type BadgeBook = {
  events: Unlock[];
  held: Map<string, Map<string, Holding>>;
  progress: Map<string, Map<string, number>>;
  records: { category: string; label: string; holder: string; value: number; day: string }[];
};

const RECORD_LABELS: Record<string, string> = {
  winStreak: 'Victoires d\'affilée', podiumStreak: 'Top 3 d\'affilée', bestDay: 'Meilleure journée', winsDay: 'Victoires en un jour',
};

export function computeBadges(races: Race[], elo: EloResult): BadgeBook {
  const events: Unlock[] = [];
  const best = new Map<string, Map<string, number>>();
  const bump = (p: string, b: string, v: number) => {
    const m = best.get(p) ?? new Map<string, number>(); m.set(b, Math.max(m.get(b) ?? 0, v)); best.set(p, m);
  };
  const emit = (badge: string, player: string, day: string, detail?: string) => {
    if (player !== 'Other') events.push({ badge, player, day, detail });
  };
  if (!races.length) return { events, held: new Map(), progress: best, records: [] };
  const firstDay = races[0].day;
  const recordsOpen = (day: string) => (parseLocal(day).getTime() - parseLocal(firstDay).getTime()) / 864e5 >= 30;

  // ---- état course par course
  type S = { win: number; last: number; top2: number; top3: number; count: number; recent: number[]; hot: boolean; firstDay: string };
  const st = new Map<string, S>();
  const pairStreak = new Map<string, number>();                         // "a|b" : courses d'affilée où a devant b
  const pairTot = new Map<string, { shared: number; ahead: number }>(); // cumul a vs b
  const sharedWith = (a: string) => {
    const out: { opp: string; shared: number; pct: number }[] = [];
    for (const [k, v] of pairTot) { const [x, y] = k.split('|'); if (x === a) out.push({ opp: y, shared: v.shared, pct: v.ahead / v.shared }); }
    return out;
  };
  const nemesisOf = (a: string) => sharedWith(a).filter((o) => o.shared >= 10 && o.opp !== 'Other').sort((x, y) => x.pct - y.pct)[0]?.opp;
  const favoriteOf = (a: string) => sharedWith(a).filter((o) => o.opp !== 'Other').sort((x, y) => y.shared - x.shared)[0]?.opp;
  const cumul = new Map<string, { sum: number; n: number }>();
  const generalLeader = () => [...cumul].filter(([n, v]) => v.n >= 50 && n !== 'Other').sort((x, y) => x[1].sum / x[1].n - y[1].sum / y[1].n)[0]?.[0];

  // ---- records historiques
  const rec: Record<string, { holder: string; value: number; day: string } | undefined> = {};
  const holdersCount = (p: string) => Object.values(rec).filter((r) => r?.holder === p).length;
  const mainChar = new Set<string>();
  const brokenThisRun = new Set<string>();
  const setRecord = (cat: string, player: string, value: number, day: string, higherIsBetter = true, runKey?: string) => {
    const cur = rec[cat];
    const better = !cur || (higherIsBetter ? value > cur.value : value < cur.value);
    if (!better) return;
    const prevHolder = cur?.holder;
    rec[cat] = { holder: player, value, day };
    if (cur && recordsOpen(day) && !(runKey && brokenThisRun.has(runKey))) {
      emit('record-breaker', player, day, `${RECORD_LABELS[cat]} : ${cat === 'bestDay' ? value.toFixed(2).replace('.', ',') : value}${prevHolder && prevHolder !== player ? `, record de ${prevHolder}` : ''}`);
      if (runKey) brokenThisRun.add(runKey);
    }
    if (holdersCount(player) >= 3 && !mainChar.has(player) && recordsOpen(day)) { mainChar.add(player); emit('main-character', player, day); }
    bump(player, 'main-character', holdersCount(player));
  };

  const byDay = groupByDay(races);
  const dayList = [...byDay.keys()];
  const sessionsPlayed = new Map<string, number>();
  const sessionRun = new Map<string, number>();
  const seasonLeaderRun = new Map<string, number>();
  const ratingBefore = (name: string, firstRaceId: number) => {
    for (let id = firstRaceId - 1; id >= 0; id--) { const i = races[id].p.indexOf(name); if (i >= 0) return elo.before[id][i]; }
    return 1500;
  };

  for (const day of dayList) {
    const rs = byDay.get(day)!;
    const leader = generalLeader();
    const leaderStreak = new Map<string, number>();

    for (const r of rs) {
      r.p.forEach((n, i) => {
        const s = st.get(n) ?? { win: 0, last: 0, top2: 0, top3: 0, count: 0, recent: [], hot: false, firstDay: day };
        s.count++;
        for (const [b, t] of [['centurion', 100], ['500-club', 500], ['millennium-racer', 1000]] as const) {
          bump(n, b, s.count);
          if (s.count === t) emit(b, n, day);
        }
        bump(n, 'living-legend', s.count);
        if (s.count >= 1000 && (parseLocal(day).getTime() - parseLocal(s.firstDay).getTime()) / 864e5 >= 365 && !best.get(n)?.get('living-legend-done')) {
          emit('living-legend', n, day); bump(n, 'living-legend-done', 1);
        }
        // victoires
        if (i === 0) {
          if (s.last >= 3) emit('phoenix', n, day, `après ${s.last} dernières places`);
          s.win++;
          if (s.win === 5) emit('winning-machine', n, day);
          if (s.win === 10) emit('unstoppable', n, day);
          bump(n, 'winning-machine', s.win); bump(n, 'unstoppable', s.win);
          setRecord('winStreak', n, s.win, day, true, `${n}-win-${r.id - s.win}`);
        } else s.win = 0;
        if (i === 3) { s.last++; if (s.last === 5) emit('dead-last', n, day); bump(n, 'dead-last', s.last); } else s.last = 0;
        if (i < 2) { s.top2++; if (s.top2 === 10) emit('mr-consistent', n, day); bump(n, 'mr-consistent', s.top2); } else s.top2 = 0;
        if (i < 3) { s.top3++; setRecord('podiumStreak', n, s.top3, day, true, `${n}-top3-${r.id - s.top3}`); } else s.top3 = 0;
        s.recent.push(i + 1); if (s.recent.length > 5) s.recent.shift();
        const hotNow = s.recent.length === 5 && s.recent.reduce((a, b) => a + b, 0) / 5 <= 1.5;
        if (hotNow && !s.hot) emit('hot-streak', n, day);
        s.hot = hotNow;
        st.set(n, s);
        const c = cumul.get(n) ?? { sum: 0, n: 0 }; c.sum += i + 1; c.n++; cumul.set(n, c);
      });
      // duels
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        const a = r.p[i], b = r.p[j], k = a + '|' + b;
        const t = pairTot.get(k) ?? { shared: 0, ahead: 0 }; t.shared++; if (i < j) t.ahead++; pairTot.set(k, t);
        if (i < j) {
          const v = (pairStreak.get(k) ?? 0) + 1; pairStreak.set(k, v);
          if (v === 10 && nemesisOf(a) === b) emit('nemesis', a, day, `devant ${b}`);
          if (v === 5 && favoriteOf(a) === b) emit('the-troll', a, day, `devant ${b}`);
          if (nemesisOf(a) === b) bump(a, 'nemesis', v);
          if (favoriteOf(a) === b) bump(a, 'the-troll', v);
        } else pairStreak.set(k, 0);
      }
      // Giant Killer : 5 courses d'affilée devant le leader du général
      if (leader && r.p.includes(leader)) {
        const li = r.p.indexOf(leader);
        r.p.forEach((n, i) => {
          if (n === leader) return;
          const v = i < li ? (leaderStreak.get(n) ?? 0) + 1 : 0;
          leaderStreak.set(n, v);
          bump(n, 'giant-killer', v);
          if (v === 5) emit('giant-killer', n, day, `devant ${leader}`);
        });
      }
    }

    // ---- bilan de session
    const table = standings(rs);
    const names = table.map((t) => t.name);
    const lastRank = table.at(-1)!;
    if (rs.length >= 5 && rs.every((r) => r.p[0] === rs[0].p[0])) emit('grand-slam', rs[0].p[0], day, `${rs.length} sur ${rs.length}`);
    if (rs.length >= 10 && table[0]) emit('perfect-session', table[0].name, day, `${table[0].races} courses`);
    if (rs.length >= 5 && lastRank && table.length >= 4) emit('wooden-spoon', lastRank.name, day);
    if (rs.length >= 20) for (const n of names) emit('marathon-runner', n, day, `${rs.length} courses`);
    for (const t of table) if (t.races >= 10 && t.places[3] / t.races >= 0.5) emit('cursed', t.name, day, `${t.places[3]} fois 4e sur ${t.races}`);
    // mi-temps
    if (rs.length >= 6) {
      const half = standings(rs.slice(0, Math.ceil(rs.length / 2))).filter((s) => s.races >= 2);
      if (half.length >= 4) {
        if (half.at(-1)!.name === table[0].name) emit('comeback-king', table[0].name, day);
        if (half[0].name === lastRank.name) emit('choke-artist', lastRank.name, day);
      }
    }
    // surperformance
    const gain = new Map<string, number>();
    for (const r of rs) {
      const pre = elo.before[r.id];
      r.p.forEach((n, i) => {
        const exp = 1 + pre.reduce((s, rj, j) => (j === i ? s : s + 1 - 1 / (1 + 10 ** ((rj - pre[i]) / 400))), 0);
        gain.set(n, (gain.get(n) ?? 0) + exp - (i + 1));
      });
    }
    const dh = [...gain].sort((a, b) => b[1] - a[1])[0];
    if (dh && dh[1] > 0.5) emit('dark-horse', dh[0], day, `+${dh[1].toFixed(1).replace('.', ',')} places`);
    // Giant Slayer
    const fav = [...names].sort((a, b) => ratingBefore(b, rs[0].id) - ratingBefore(a, rs[0].id))[0];
    for (const n of names) {
      if (n === fav) continue;
      const ahead = rs.filter((r) => r.p.includes(n) && r.p.includes(fav) && r.p.indexOf(n) < r.p.indexOf(fav)).length;
      bump(n, 'giant-slayer', ahead);
      if (ahead >= 5) emit('giant-slayer', n, day, `devant ${fav} ${ahead} fois`);
    }
    // Rivalry Winner / Sweet Revenge
    for (const a of names) {
      let won = false;
      for (const b of names) {
        if (a === b) continue;
        const both = rs.filter((r) => r.p.includes(a) && r.p.includes(b));
        const ahead = both.filter((r) => r.p.indexOf(a) < r.p.indexOf(b)).length;
        if (both.length >= 10 && ahead > both.length / 2) won = true;
        if (both.length >= 5 && ahead === both.length && nemesisOf(a) === b) emit('sweet-revenge', a, day, `devant ${b}`);
      }
      if (won) emit('rivalry-winner', a, day);
    }
    // Plot Twist : chances du vainqueur estimées avant la session
    const winner = table[0];
    if (rs.length >= 5 && winner && names.length >= 4) {
      const ratings = new Map(names.map((n) => [n, ratingBefore(n, rs[0].id)]));
      const p = estimateProbability({ kind: 'best-of-day', p: winner.name }, names, ratings, rs.length, 200, seedOf('pt' + day));
      if (p < 0.1) emit('plot-twist', winner.name, day, `${Math.round(p * 100)} % de chances`);
    }
    // présence
    for (const n of new Set([...sessionRun.keys(), ...names])) {
      const v = names.includes(n) ? (sessionRun.get(n) ?? 0) + 1 : 0;
      sessionRun.set(n, v);
      bump(n, 'loyal-racer', v); bump(n, 'no-days-off', v);
      if (v === 10) emit('loyal-racer', n, day);
      if (v === 20) emit('no-days-off', n, day);
    }
    for (const n of names) {
      const v = (sessionsPlayed.get(n) ?? 0) + 1; sessionsPlayed.set(n, v); bump(n, 'veteran-racer', v);
      if (v === 100) emit('veteran-racer', n, day);
    }
    // King of the Hill : n°1 de la saison (mois) à la fin de 5 sessions de suite
    const season = standings(races.filter((r) => monthKey(r.day) === monthKey(day) && r.day <= day)).filter((s) => s.races >= 10 && s.name !== 'Other');
    const top = season[0]?.name;
    for (const n of new Set([...seasonLeaderRun.keys(), ...(top ? [top] : [])])) {
      const v = n === top ? (seasonLeaderRun.get(n) ?? 0) + 1 : 0;
      seasonLeaderRun.set(n, v); bump(n, 'king-of-the-hill', v);
      if (v > 0 && v % 5 === 0) emit('king-of-the-hill', n, day, `${v} sessions en tête`);
    }
    // records de journée
    for (const t of table) {
      if (t.name === 'Other') continue;
      if (t.races >= 5) setRecord('bestDay', t.name, t.avg, day, false);
      setRecord('winsDay', t.name, t.wins, day);
    }
  }

  // ---- méta : collection
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const seen = new Map<string, Map<string, string>>(); // joueur -> badge -> 1re date
  const meta: Unlock[] = [];
  for (const e of events) {
    const m = seen.get(e.player) ?? new Map<string, string>();
    if (m.has(e.badge)) continue;
    m.set(e.badge, e.day); seen.set(e.player, m);
    if (m.size === 10) meta.push({ badge: 'the-collector', player: e.player, day: e.day });
    const fam = BADGE[e.badge].family;
    const famAll = BADGES.filter((b) => b.family === fam && !b.pending && !['completionist', 'the-collector'].includes(b.id));
    if (famAll.every((b) => m.has(b.id))) meta.push({ badge: 'completionist', player: e.player, day: e.day, detail: FAMILY_LABEL[fam] });
  }
  for (const [p, m] of seen) { bump(p, 'the-collector', m.size); }
  events.push(...meta);
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const held = new Map<string, Map<string, Holding>>();
  for (const e of events) {
    const m = held.get(e.player) ?? new Map<string, Holding>();
    const h = m.get(e.badge);
    if (h) { h.count++; h.last = e.day; } else m.set(e.badge, { count: 1, first: e.day, last: e.day });
    held.set(e.player, m);
  }
  return {
    events, held, progress: best,
    records: Object.entries(rec).filter(([, v]) => v).map(([category, v]) => ({ category, label: RECORD_LABELS[category], ...v! })),
  };
}
