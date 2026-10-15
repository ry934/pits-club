import { seedOf } from './takes';
import { dayKey, fmtAvg, headToHead, lastSeenMap, monthKey, parseLocal, standings, WEEKDAYS } from './stats';
import { Race } from './types';

const pick = <T,>(arr: T[], seed: number) => arr[seed % arr.length];

// ------------------------------------------------------------ horoscope (version provisoire, sans IA)

const SIGNS = ['Turbo', 'Dérapage', 'Aspiration', 'Chicane', 'Épingle', 'Ligne droite', 'Pole position', 'Drapeau à damier'];
const ADVICE = [
  'Garde ta manette à deux mains, même pendant les ralentis.',
  'Évite de commenter ta propre trajectoire à voix haute.',
  'Le premier virage ne se gagne pas, il se survit.',
  'Bois un verre d\'eau avant la course 4. Fais-nous confiance.',
  'Choisis ton kart en moins de dix secondes : l\'hésitation coûte cher.',
  'Ne regarde pas l\'écran du voisin. Il le sait.',
  'Annonce ta victoire avant le départ. Ou pas.',
  'Laisse passer la tempête des trois premiers tours.',
];

export type Horoscope = { sign: string; lines: string[]; star: string | null; lucky: number };

export function horoscope(name: string, races: Race[], day: string): Horoscope {
  const seed = seedOf(name + day);
  const mine = races.filter((r) => r.p.includes(name));
  const pos = (r: Race) => r.p.indexOf(name) + 1;
  const all = mine.reduce((s, r) => s + pos(r), 0) / Math.max(1, mine.length);
  const wd = parseLocal(day).getDay();
  const onDay = mine.filter((r) => r.ts.getDay() === wd);
  const dayAvg = onDay.reduce((s, r) => s + pos(r), 0) / Math.max(1, onDay.length);
  const recent = mine.slice(-20);
  const form = recent.reduce((s, r) => s + pos(r), 0) / Math.max(1, recent.length);
  const h2h = headToHead(races, name, lastSeenMap(races), races.at(-1)?.day ?? day);
  const nemesis = [...h2h].sort((a, b) => a.pct - b.pct)[0];
  const victim = h2h[0];
  const lines: string[] = [];

  if (onDay.length >= 5) {
    lines.push(dayAvg < all - 0.08
      ? `Les ${WEEKDAYS[wd]}s te portent : ${fmtAvg(dayAvg)} de moyenne ce jour-là, contre ${fmtAvg(all)} d'habitude.`
      : dayAvg > all + 0.08
        ? `Les ${WEEKDAYS[wd]}s te sont contraires (${fmtAvg(dayAvg)} contre ${fmtAvg(all)} d'habitude). Prudence au départ.`
        : `Un ${WEEKDAYS[wd]} comme les autres pour toi : ${fmtAvg(dayAvg)} de moyenne, pile ta norme.`);
  }
  if (recent.length >= 10) {
    lines.push(form < all - 0.15
      ? `Ta forme monte : ${fmtAvg(form)} sur tes 20 dernières courses. Les astres appuient sur l'accélérateur.`
      : form > all + 0.15
        ? `Ta forme tousse (${fmtAvg(form)} sur 20 courses). Une bonne trajectoire peut tout relancer.`
        : `Forme stable, ${fmtAvg(form)} sur 20 courses. Rien ne t'arrête, rien ne te propulse.`);
  }
  const star = seed % 2 === 0 ? nemesis?.opp ?? null : victim?.opp ?? null;
  if (star && nemesis && star === nemesis.opp) lines.push(`Astre menaçant : ${star}. Tu ne finis devant que ${Math.round(nemesis.pct * 100)} % du temps.`);
  else if (star && victim) lines.push(`Astre favorable : ${star}. Tu finis devant ${Math.round(victim.pct * 100)} % du temps.`);
  lines.push(pick(ADVICE, seed >>> 3));
  return { sign: pick(SIGNS, seedOf(name)), lines: lines.slice(0, 4), star, lucky: 1 + (seed % 4) };
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
