import { seedOf } from './takes';
import { dayKey, fmtAvg, headToHead, lastSeenMap, monthKey, parseLocal, standings, WEEKDAYS } from './stats';
import { Race } from './types';

const pick = <T,>(arr: T[], seed: number) => arr[seed % arr.length];

// ------------------------------------------------------------ horoscope
// La version IA (actu du jour + stats, rédigée par Gemini) est produite côté serveur et stockée dans `horoscopes`.
// Ce qui suit sert de faits d'entrée pour l'IA, et de repli (mode démo, IA indisponible).

const SIGNS = [
  'Banane ascendant Carapace', 'Turbo raté', 'Éclair en retard', 'Dérapage contrôlé (en théorie)',
  'Carapace bleue rancunière', 'Klaxon mélancolique', 'Pièce d\'or solitaire', 'Champignon doré inflationniste',
  'Bob-omb sentimental', 'Plume nostalgique', 'Nuage Lakitu', 'Boomerang qui revient toujours',
];
const ADVICE = [
  'Mercure est rétrograde, ton kart aussi. Ne t\'en sers pas comme excuse avant la course 3.',
  'Un pigeon croisé ce matin annonce une carapace verte. Ou une fiente. Les astres hésitent.',
  'Mange léger : chaque gramme de quiche se paie en virage.',
  'Ton aura de pilote est à 14 %. Respire, recharge-la sur la ligne droite.',
  'Annonce ta victoire avant le départ. Si ça rate, accuse la manette 3.',
  'Les astres te déconseillent le volant moto. Ils ne disent pas pourquoi. Ils ont vu des choses.',
  'Ne regarde pas l\'écran du voisin. Il le sait. Il te regarde aussi.',
  'Aujourd\'hui, le premier virage est un concept, pas un objectif.',
  'Saturne entre en maison Rainbow Road : chute probable, dignité optionnelle.',
  'Bois un verre d\'eau avant la course 4. Le cosmos est très clair là-dessus.',
];

export type HoroscopeFacts = {
  name: string; courses: number; moyenne: number | null; jour: string;
  moyenne_ce_jour: number | null; courses_ce_jour: number;
  forme_20: number | null; nemesis: { pilote: string; devant_pct: number } | null; victime: { pilote: string; devant_pct: number } | null;
};

/** Faits chiffrés d'un pilote pour l'horoscope (entrée de l'IA). */
export function horoscopeFacts(name: string, races: Race[], day: string): HoroscopeFacts {
  const mine = races.filter((r) => r.p.includes(name));
  const pos = (r: Race) => r.p.indexOf(name) + 1;
  const avg = (rs: Race[]) => (rs.length ? Number((rs.reduce((s, r) => s + pos(r), 0) / rs.length).toFixed(2)) : null);
  const wd = parseLocal(day).getDay();
  const onDay = mine.filter((r) => r.ts.getDay() === wd);
  const h2h = headToHead(races, name, lastSeenMap(races), races.at(-1)?.day ?? day).filter((h) => h.shared >= 10);
  const nem = [...h2h].sort((a, b) => a.pct - b.pct)[0];
  const vic = [...h2h].sort((a, b) => b.pct - a.pct)[0];
  return {
    name, courses: mine.length, moyenne: avg(mine), jour: WEEKDAYS[wd],
    moyenne_ce_jour: onDay.length >= 5 ? avg(onDay) : null, courses_ce_jour: onDay.length,
    forme_20: mine.length >= 10 ? avg(mine.slice(-20)) : null,
    nemesis: nem ? { pilote: nem.opp, devant_pct: Math.round(nem.pct * 100) } : null,
    victime: vic && vic.opp !== nem?.opp ? { pilote: vic.opp, devant_pct: Math.round(vic.pct * 100) } : null,
  };
}

export type Horoscope = { sign: string; lines: string[]; star: string | null; lucky: number; news?: string | null; ai?: boolean };

/** Horoscope de repli, sans IA : stats + conseils absurdes tirés au sort (stable sur la journée). */
export function horoscope(name: string, races: Race[], day: string): Horoscope {
  const seed = seedOf(name + day);
  const f = horoscopeFacts(name, races, day);
  const lines: string[] = [];
  const all = f.moyenne ?? 2.5;

  if (f.moyenne_ce_jour !== null) {
    const d = f.moyenne_ce_jour;
    lines.push(d < all - 0.08
      ? `Les ${f.jour}s te portent (${fmtAvg(d)} de moyenne contre ${fmtAvg(all)}). Jupiter t'a mis en mode 200cc.`
      : d > all + 0.08
        ? `Les ${f.jour}s te détestent personnellement (${fmtAvg(d)} contre ${fmtAvg(all)}). Rien de personnel, sauf que si.`
        : `Un ${f.jour} d'une banalité cosmique : ${fmtAvg(d)} de moyenne, pile ta norme. Les astres baillent.`);
  }
  if (f.forme_20 !== null) {
    const fm = f.forme_20;
    lines.push(fm < all - 0.15
      ? `Ta forme grimpe (${fmtAvg(fm)} sur 20 courses). Vénus pousse ton kart dans le dos, discrètement.`
      : fm > all + 0.15
        ? `Ta forme tousse (${fmtAvg(fm)} sur 20 courses). Un dérapage bien senti et c'est reparti, paraît-il.`
        : `Forme stable, ${fmtAvg(fm)} sur 20 courses : tu es le Wi-Fi de l'open space, ni bon ni mauvais, juste là.`);
  }
  const star = seed % 2 === 0 ? f.nemesis?.pilote ?? null : f.victime?.pilote ?? f.nemesis?.pilote ?? null;
  if (star && star === f.nemesis?.pilote) lines.push(`Astre menaçant : ${star}. Tu ne finis devant que ${f.nemesis.devant_pct} % du temps. Évite son regard.`);
  else if (star && f.victime) lines.push(`Astre favorable : ${star}. Tu finis devant ${f.victime.devant_pct} % du temps. Sois magnanime.`);
  lines.push(pick(ADVICE, seed >>> 3));
  return { sign: pick(SIGNS, seed >>> 5), lines: lines.slice(0, 4), star, lucky: 1 + (seed % 4), ai: false };
}

// ------------------------------------------------------------ défi du jour

export type Challenge = { title: string; detail: string; results: { name: string; done: boolean; value: string }[] | null };

export function dailyChallenge(day: string, races: Race[], dayRaces: Race[]): Challenge {
  const seed = seedOf('defi' + day);
  const month = races.filter((r) => monthKey(r.day) === monthKey(day) && r.day < day);
  const leader = standings(month.length ? month : races.slice(-200)).filter((s) => s.races >= 5)[0]?.name ?? 'le leader';
  const table = standings(dayRaces);
  const kind = seed % 4;
  const has = dayRaces.length > 0;
  if (kind === 0) {
    return {
      title: `Finir devant ${leader} au moins 3 fois`,
      detail: `${leader} mène le mois. Le défi : le devancer dans 3 courses de la session.`,
      results: has ? table.filter((t) => t.name !== leader).map((t) => {
        const n = dayRaces.filter((r) => r.p.includes(t.name) && r.p.includes(leader) && r.p.indexOf(t.name) < r.p.indexOf(leader)).length;
        return { name: t.name, done: n >= 3, value: `${n} / 3` };
      }) : null,
    };
  }
  if (kind === 1) {
    return {
      title: 'Aucune 4e place sur tes 5 premières courses',
      detail: 'Cinq départs propres pour lancer la session.',
      results: has ? table.map((t) => {
        const first = dayRaces.filter((r) => r.p.includes(t.name)).slice(0, 5);
        const lasts = first.filter((r) => r.p[3] === t.name).length;
        return { name: t.name, done: first.length === 5 && lasts === 0, value: first.length < 5 ? `${first.length} courses` : `${lasts} fois 4e` };
      }) : null,
    };
  }
  if (kind === 2) {
    return {
      title: 'Finir la session sous 2,40 de moyenne',
      detail: 'Une session solide, sans exploit obligatoire.',
      results: has ? table.map((t) => ({ name: t.name, done: t.avg < 2.4, value: fmtAvg(t.avg) })) : null,
    };
  }
  return {
    title: 'Gagner au moins 2 courses',
    detail: 'Deux victoires, peu importe comment.',
    results: has ? table.map((t) => ({ name: t.name, done: t.wins >= 2, value: `${t.wins} vict.` })) : null,
  };
}

// ------------------------------------------------------------ rivalité du jour

export function rivalryOfTheDay(races: Race[], active: string[], day: string) {
  const since = dayKey(new Date(parseLocal(day).getTime() - 90 * 864e5));
  const recent = races.filter((r) => r.day >= since);
  const pairs: { a: string; b: string; shared: number; pct: number }[] = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    const both = recent.filter((r) => r.p.includes(a) && r.p.includes(b));
    if (both.length < 20) continue;
    const ahead = both.filter((r) => r.p.indexOf(a) < r.p.indexOf(b)).length;
    pairs.push({ a, b, shared: both.length, pct: ahead / both.length });
  }
  pairs.sort((x, y) => Math.abs(x.pct - 0.5) - Math.abs(y.pct - 0.5));
  return pairs.length ? pick(pairs.slice(0, 5), seedOf('riv' + day)) : null;
}

/** Prochaine échéance des Takes (13h00, jours ouvrés). */
export function nextDeadline(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(13, 0, 0, 0);
  if (now >= d) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
