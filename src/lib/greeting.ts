import { seedOf } from './takes';
import { dayKey, fmtAvg, monthKey, parseLocal, recentRivals, standings } from './stats';
import { Race } from './types';

/**
 * Message d'accueil du jour, sur le ton du chambrage. Version sans IA : un catalogue de phrases,
 * choisies selon la situation réelle du pilote (dernière session, série, classement du mois, némésis),
 * avec un tirage qui change chaque jour. La plume de l'IA arrive au lot 3.
 */

type Ctx = {
  n: string; nem?: string; vic?: string; rank?: number; field?: number; avg?: string; days?: number;
  lastRank?: number; lastSize?: number; lasts?: number; wins?: number; streak?: number;
};

const T: Record<string, ((c: Ctx) => string)[]> = {
  absent: [
    (c) => `Tiens, ${c.n}. ${c.days} jours sans toucher une manette, on pensait que tu avais changé de jeu.`,
    (c) => `${c.n} est de retour. Les autres avaient presque oublié le goût de la victoire facile.`,
    (c) => `Bonjour ${c.n}. ${c.days} jours d'absence : on a gardé ta place, au fond de la grille.`,
    (c) => `Avis de recherche levé : ${c.n} refait surface. Reste à voir dans quel état sont les trajectoires.`,
  ],
  lastSpoon: [
    (c) => `Bonjour ${c.n}. Hier, dernier du classement. Aujourd'hui, une seule direction possible.`,
    (c) => `${c.n}, la cuillère de bois d'hier est encore chaude. Tu la ramènes ou tu la passes ?`,
    (c) => `Salut ${c.n}. ${c.lasts} fois quatrième à la dernière session. On a appelé ça un échauffement, par politesse.`,
    (c) => `${c.n}, bonne nouvelle : après la dernière session, statistiquement, ça ne peut que s'améliorer.`,
  ],
  lastWin: [
    (c) => `Le boss de la dernière session est dans la place. Salut ${c.n}, reste modeste au moins jusqu'à 12h30.`,
    (c) => `${c.n}, premier la dernière fois. Profite, ça ne durera pas. Enfin, on espère.`,
    (c) => `Bonjour ${c.n}. ${c.wins} victoires à la dernière session : les autres ont porté plainte.`,
  ],
  winStreak: [
    (c) => `${c.n}, ${c.streak} victoires d'affilée en cours. Quelqu'un va bien finir par te sortir de la piste.`,
    (c) => `Série de ${c.streak} victoires pour ${c.n}. Les autres demandent un contrôle technique de ta manette.`,
  ],
  lossStreak: [
    (c) => `${c.n}, ${c.streak} dernières places de suite. Le jeu a un mode facile, tu sais.`,
    (c) => `Bonjour ${c.n}. ${c.streak} fois quatrième d'affilée : ce n'est plus une série, c'est un abonnement.`,
  ],
  leader: [
    (c) => `Salut ${c.n}, leader du mois avec ${c.avg} de moyenne. Tout le monde t'attend au virage.`,
    (c) => `${c.n} en tête de la saison. Profite de la vue, la chute fait mal d'aussi haut.`,
    (c) => `Bonjour ${c.n}. Premier du mois : chaque collègue que tu croises est désormais un ennemi.`,
  ],
  bottom: [
    (c) => `${c.n}, ${c.rank}e sur ${c.field} ce mois-ci. Il reste quelques jours pour sauver l'honneur.`,
    (c) => `Bonjour ${c.n}. Lanterne rouge du mois, mais c'est toi qui éclaires le chemin des autres.`,
    (c) => `Salut ${c.n}. Au classement du mois, il n'y a plus personne derrière toi. Regarde devant, c'est joli.`,
  ],
  nemesis: [
    (c) => `Bonjour ${c.n}. ${c.nem} sera peut-être là aujourd'hui. Respire. Ça va bien se passer. Ou pas.`,
    (c) => `${c.n}, petit rappel : ${c.nem} te colle dans le rétro ces derniers temps. Aujourd'hui, c'est le jour. Peut-être.`,
    (c) => `Salut ${c.n}. ${c.nem} a demandé si tu jouais ce midi. Ça avait l'air de lui faire très plaisir.`,
  ],
  victim: [
    (c) => `Bonjour ${c.n}. ${c.vic} est dans le coin. Petite faveur : laisse-lui une course aujourd'hui.`,
    (c) => `${c.n}, ${c.vic} a encore fait des cauchemars cette nuit. Devine de qui.`,
  ],
  monthAvg: [
    (c) => `Bonjour ${c.n}. Ta moyenne du mois est de ${c.avg}. On ne juge pas. Enfin, un peu.`,
    (c) => `${c.n}, ${c.rank}e du mois avec ${c.avg} de moyenne. Ni honte ni gloire, juste du kart.`,
  ],
  generic: [
    (c) => `Bonjour ${c.n}, bon, qu'est-ce qui va encore t'arriver aujourd'hui ?`,
    (c) => `Salut ${c.n}. Les feux passent au vert à midi. Ton talent, lui, on attend toujours.`,
    (c) => `${c.n}, rappel du règlement : la ligne d'arrivée est devant, pas dans le décor.`,
    (c) => `Hello ${c.n}. Aujourd'hui, objectif simple : finir devant au moins une personne.`,
    (c) => `${c.n}, la météo du jour : grand soleil sur la piste, brouillard sur tes trajectoires.`,
    (c) => `Bonjour ${c.n}. On a vérifié, ta manette fonctionne très bien. Le problème est ailleurs.`,
    (c) => `Salut ${c.n}. Nuit reposante ? Tant mieux, parce que ce midi tes adversaires sont bien réveillés.`,
    (c) => `${c.n}, petit conseil du paddock : cette fois, essaie de tourner dans le même sens que les autres.`,
    (c) => `Bonjour ${c.n}. Les stats disent que tu peux gagner aujourd'hui. Les stats mentent souvent.`,
    (c) => `Salut ${c.n}. Il paraît que le premier virage est le plus dangereux. Pour toi, c'est tous.`,
    (c) => `${c.n}, aujourd'hui tu joues pour l'honneur. Celui qui reste, en tout cas.`,
  ],
};

export function greeting(name: string, display: string, races: Race[], now = new Date()): string {
  const today = dayKey(now);
  const seed = seedOf('hello' + name + today);
  const mine = races.filter((r) => r.p.includes(name));
  const c: Ctx = { n: display };
  const pool: string[] = [];

  if (mine.length) {
    const lastDay = mine.at(-1)!.day;
    c.days = Math.round((parseLocal(today).getTime() - parseLocal(lastDay).getTime()) / 864e5);
    // dernière session jouée (avant aujourd'hui de préférence)
    const prevDay = [...new Set(mine.map((r) => r.day))].filter((d) => d < today).at(-1);
    if (prevDay) {
      const table = standings(races.filter((r) => r.day === prevDay));
      const me = table.find((t) => t.name === name);
      if (me && table.length >= 3) {
        c.lastRank = me.rank; c.lastSize = table.length; c.lasts = me.places[3]; c.wins = me.wins;
        if (me.rank === table.length && me.races >= 4) pool.push('lastSpoon', 'lastSpoon');
        if (me.rank === 1 && me.races >= 4) pool.push('lastWin', 'lastWin');
      }
    }
    // série en cours
    let win = 0, loss = 0;
    for (let i = mine.length - 1; i >= 0; i--) { if (mine[i].p[0] === name) win++; else break; }
    for (let i = mine.length - 1; i >= 0; i--) { if (mine[i].p[3] === name) loss++; else break; }
    if (win >= 3) { c.streak = win; pool.push('winStreak', 'winStreak', 'winStreak'); }
    if (loss >= 3) { c.streak = loss; pool.push('lossStreak', 'lossStreak', 'lossStreak'); }
    // classement du mois
    const month = standings(races.filter((r) => monthKey(r.day) === monthKey(today))).filter((s) => s.races >= 5);
    const m = month.find((s) => s.name === name);
    if (m) {
      c.rank = m.rank; c.field = month.length; c.avg = fmtAvg(m.avg);
      pool.push('monthAvg');
      if (m.rank === 1) pool.push('leader', 'leader');
      if (m.rank === month.length && month.length >= 4) pool.push('bottom', 'bottom');
    }
    // rivalités
    // rivalités du moment : sur les dernières courses du pilote
    const { nemesis: nem, victim: vic } = recentRivals(races, name);
    if (nem && nem.pct < 0.45) { c.nem = nem.opp; pool.push('nemesis'); }
    if (vic && vic.pct > 0.6) { c.vic = vic.opp; pool.push('victim'); }
    if (c.days >= 14) pool.unshift('absent', 'absent', 'absent', 'absent');
  }
  // toujours une part de phrases génériques, pour varier d'un jour à l'autre
  pool.push('generic', 'generic', 'generic');

  const bucket = pool[seed % pool.length];
  const list = T[bucket];
  return list[seedOf('pick' + name + today + bucket) % list.length](c);
}
