import { cleanRaces, computeElo } from '../stats';
import { RULE_KINDS, TakeRule } from '../takes';
import { RawRace } from '../types';
import { LiveTake, sessionFacts, SessionFacts } from './facts';
import { BotOptions, BotTone, buildDebrief, buildExtra, buildReminder, buildTest, debriefStory, SlackMessage } from './messages';

/**
 * Logique côté serveur du bot (fonction Vercel /api/bot), séparée de l'enveloppe HTTP pour être testable.
 * Aucune clé n'est lue ici : elles sont passées par l'appelant.
 */

export type Payload = {
  log: { id: number; kind: 'debrief' | 'extra' | 'reminder' | 'test'; day: string; manual: boolean } | null;
  day: string;
  settings: Record<string, unknown>;
  players: { name: string; display_name: string | null; color: string; active: boolean }[];
  races: [string, string, string, string, string, string][];
  closures: string[];
  takes: (Omit<LiveTake, 'rule'> & { rule: TakeRule | null })[];
  recent_meta: ({ ids?: string[] } | null)[];
};

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function optionsFrom(p: Payload, salt?: string): BotOptions {
  const names = new Map(p.players.map((x) => [x.name, x.display_name || x.name]));
  const tone = str(p.settings.bot_tone, 'taquin');
  return {
    tone: (['sobre', 'taquin', 'piquant'].includes(tone) ? tone : 'taquin') as BotTone,
    appUrl: str(p.settings.app_url, 'https://pits-club.vercel.app').replace(/\/$/, ''),
    label: (n) => names.get(n) ?? n,
    optout: Array.isArray(p.settings.roast_optout) ? (p.settings.roast_optout as string[]) : [],
    recent: p.recent_meta.flatMap((m) => m?.ids ?? []),
    includeTakes: bool(p.settings.debrief_takes, true) && bool(p.settings.takes_enabled, true),
    salt,
  };
}

export function factsFrom(p: Payload, revealedOnly = true): SessionFacts | null {
  const raw: RawRace[] = p.races.map(([ts, a, b, c, d, src]) => ({ ts, p: [a, b, c, d], src: src as RawRace['src'] }));
  const { races } = cleanRaces(raw);
  const elo = computeElo(races);
  const takes = p.takes.filter((t) => !revealedOnly || t.revealed) as LiveTake[];
  return sessionFacts(p.day, races, elo, takes);
}

export const fmtDeadline = (v: unknown) => str(v, '13:00').replace(':', 'h');

/** Construit le message d'un type donné. `story` : récit fourni par la plume IA (facultatif). */
export function composeMessage(kind: string, p: Payload, opts: { salt?: string; story?: string; revealedOnly?: boolean } = {}): SlackMessage | { error: string } {
  const o = optionsFrom(p, opts.salt);
  if (kind === 'test') return buildTest(o);
  if (kind === 'reminder') {
    return buildReminder({ day: p.day, deadline: fmtDeadline(p.settings.takes_deadline), posted: p.takes.map((t) => t.author) }, o);
  }
  const f = factsFrom(p, opts.revealedOnly ?? true);
  if (!f) return { error: 'Aucune course ce jour-là' };
  return kind === 'extra' ? buildExtra(f, o) : buildDebrief(f, o, opts.story);
}

// ------------------------------------------------------------------ plume IA (débrief)

export function aiStoryPrompt(f: SessionFacts, o: BotOptions): { system: string; user: string } {
  const L = o.label;
  const facts = {
    courses: f.races, duree_minutes: f.minutes,
    classement: f.table.map((s, i) => ({ rang: i + 1, pilote: L(s.name), moyenne: Number(s.avg.toFixed(2)), victoires: s.wins, quatriemes: s.lasts, courses: s.races })),
    serie_victoires: f.winStreak && { pilote: L(f.winStreak.name), n: f.winStreak.n },
    serie_dernieres_places: f.lossStreak && !o.optout.includes(f.lossStreak.name) ? { pilote: L(f.lossStreak.name), n: f.lossStreak.n } : null,
    surprise: f.upset && { vainqueur: L(f.upset.name), favori_battu: L(f.upset.beat) },
    cote_en_hausse: f.eloUp && { pilote: L(f.eloUp.name), points: f.eloUp.delta },
    sans_faute: f.perfect && L(f.perfect),
  };
  const tone = {
    sobre: 'Ton bienveillant et léger : humour doux, aucune moquerie nominative, félicite le vainqueur.',
    taquin: "Ton de chambrage entre collègues : ironie, fausse emphase, autodérision. Taquine le dernier sans jamais l'humilier.",
    piquant: 'Ton piquant et pince-sans-rire, plus mordant, mais toujours bon enfant et sans méchanceté.',
  }[o.tone];
  const system = [
    "Tu écris le débrief Slack d'une session de Mario Kart jouée entre collègues à la pause de midi, dans une entreprise.",
    'Écris en français, 3 à 5 phrases, 90 mots maximum, un seul paragraphe, sans titre, sans liste, sans emoji, sans hashtag.',
    tone,
    "Une belle plume : ironie, images inattendues, chutes. Exemple d'esprit : « Waouh, waouh, waouh. Mais que s'est-il passé aujourd'hui ? Roro a survolé ses adversaires. Non, je plaisante. »",
    "Règles : n'invente aucun chiffre ni aucun fait, utilise uniquement les données fournies. Ne mentionne ni le travail, ni les résultats de l'entreprise, ni le physique, ni la vie privée.",
    `Pilotes à ne jamais chambrer nommément : ${o.optout.map(L).join(', ') || 'aucun'}. N'accorde pas de genre aux pilotes (évite il/elle, préfère leur prénom).`,
    'Le classement détaillé et les Takes sont ajoutés automatiquement après ton texte : ne les recopie pas.',
  ].join('\n');
  return { system, user: `Données de la session :\n${JSON.stringify(facts)}` };
}

export function cleanStory(s: string): string | null {
  const t = s.replace(/\s+/g, ' ').replace(/^["«\s]+|["»\s]+$/g, '').trim();
  return t.length >= 40 && t.length <= 900 ? t : null;
}

// ------------------------------------------------------------------ Takes en texte libre

export type TakePlayer = { name: string; display: string; aliases?: string[] };

export function takePrompt(text: string, author: string, players: TakePlayer[]): { system: string; user: string } {
  const who = players.map((p) => {
    const other = [...new Set([p.display, ...(p.aliases ?? [])])].filter((x) => x && x.toLowerCase() !== p.name.toLowerCase());
    return other.length ? `${p.name} (aussi appelé : ${other.join(', ')})` : p.name;
  });
  const system = [
    "Tu convertis le pronostic (« Take ») d'un joueur de Mario Kart en règle vérifiable sur les résultats de la session du jour.",
    "Les Takes sont écrits entre collègues, en langage familier, avec humour, chambrage, argot et fautes de frappe. Sois ouvert : cherche l'intention compétitive derrière la formule et traduis-la par la règle la plus proche.",
    'Réponds uniquement avec un objet JSON, sans texte autour.',
    'Règles possibles (champ "kind") :',
    '- {"kind":"duel","a":X,"b":Y} : X termine la journée avec une meilleure moyenne que Y',
    '- {"kind":"avg-better","p":X,"x":nombre} : moyenne du jour de X strictement meilleure (plus petite) que x (entre 1 et 4)',
    '- {"kind":"avg-worse","p":X,"x":nombre} : moyenne du jour de X strictement moins bonne (plus grande) que x',
    '- {"kind":"wins-min","p":X,"n":entier} : X gagne au moins n courses',
    '- {"kind":"no-win","p":X} : X ne gagne aucune course',
    '- {"kind":"best-of-day","p":X} : X termine avec la meilleure moyenne du jour',
    '- {"kind":"win-streak","p":X,"n":entier} : X enchaîne au moins n victoires d\'affilée',
    '- {"kind":"volume","n":entier} : au moins n courses jouées dans la session',
    'La moyenne est la place moyenne (1 = toujours premier, 4 = toujours dernier).',
    'Exemples d\'interprétation :',
    '- « X va botter le cul de Y », « X va éclater / défoncer / humilier Y », « Y va manger la poussière de X », « X > Y » → duel a=X, b=Y',
    '- « X va tout rafler », « X roi du jour », « personne ne battra X », « X va dominer » → best-of-day X',
    '- « X va se prendre une raclée », « X va faire le plein de bananes », « X va finir dans les choux » → avg-worse X, x=2.8',
    '- « X va gratter une victoire », « X va enfin gagner » → wins-min X, n=1 ; « X va gagner 3 courses » → wins-min X, n=3',
    '- « X zéro victoire », « X ne verra pas le podium de la première place » → no-win X',
    '- « X va être solide / régulier » → avg-better X, x=2.3',
    '- « X va enchaîner », « hat-trick de X » → win-streak X, n=2 (n=3 pour hat-trick)',
    '- « grosse session », « on va jouer jusqu\'à pas d\'heure » → volume n=12',
    `Les pilotes (nom exact, puis prénoms et surnoms) : ${who.join(' ; ')}.`,
    'Reconnais les pilotes par n\'importe lequel de ces noms, sans tenir compte des majuscules, des accents ni des fautes légères. Dans la règle, utilise toujours le nom exact (le premier).',
    `L'auteur du Take est ${author} : « je », « moi », « me » désignent ${author}.`,
    'Format de réponse : {"ok":true,"rule":{...},"label":"reformulation courte et neutre en français"}',
    "Refuse seulement si le Take ne parle pas de la compétition du jour (météo, travail, vie privée…), ne cite aucun pilote identifiable quand il en faut un, ou combine plusieurs conditions impossibles à ramener à une seule règle : réponds alors {\"ok\":false,\"reason\":\"explication courte en français, avec une suggestion de reformulation\"}.",
  ].join('\n');
  return { system, user: text };
}

/** Vérifie et normalise la règle renvoyée par l'IA. */
export function validateRule(raw: unknown, names: string[], aliases: Record<string, string[]> = {}): TakeRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kinds = RULE_KINDS.map((k) => k.kind) as string[];
  if (typeof r.kind !== 'string' || !kinds.includes(r.kind)) return null;
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const nm = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const k = fold(v);
    return names.find((n) => fold(n) === k) ?? names.find((n) => (aliases[n] ?? []).some((a) => fold(a) === k)) ?? null;
  };
  const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
  const num = (v: unknown) => (typeof v === 'number' && v > 1 && v < 4 ? Math.round(v * 100) / 100 : null);
  switch (r.kind) {
    case 'duel': { const a = nm(r.a), b = nm(r.b); return a && b && a !== b ? { kind: 'duel', a, b } : null; }
    case 'avg-better': case 'avg-worse': { const p = nm(r.p), x = num(r.x); return p && x ? { kind: r.kind, p, x } : null; }
    case 'wins-min': { const p = nm(r.p), n = int(r.n, 1, 40); return p && n ? { kind: 'wins-min', p, n } : null; }
    case 'win-streak': { const p = nm(r.p), n = int(r.n, 2, 20); return p && n ? { kind: 'win-streak', p, n } : null; }
    case 'no-win': case 'best-of-day': { const p = nm(r.p); return p ? { kind: r.kind, p } : null; }
    case 'volume': { const n = int(r.n, 1, 80); return n ? { kind: 'volume', n } : null; }
  }
  return null;
}

/** Extrait le premier objet JSON d'une réponse texte. */
export function firstJson(s: string): unknown {
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

export { debriefStory };

// ------------------------------------------------------------------ horoscope IA (actu du jour + stats)

export type NewsItem = { titre: string; resume: string };
export type AiHoroscope = { sign: string; lines: string[]; lucky: number; news: string | null; star: string | null };

/** Étape 1 (avec recherche Google) : quelques actus du jour, légères et exploitables pour faire rire. */
export function newsPrompt(day: string): { system: string; user: string } {
  return {
    system: [
      "Tu es documentaliste pour un horoscope humoristique. Tu cherches l'actualité réelle du jour sur le web.",
      'Choisis 8 actualités récentes (24-48 h) variées : insolite, sport, tech, people, météo, culture, conso, science, faits divers légers.',
      "Exclus strictement : décès, guerres, attentats, catastrophes avec victimes, violences, maladies graves, politique clivante, religion.",
      'Réponds UNIQUEMENT avec un JSON : {"news":[{"titre":"...","resume":"une phrase factuelle, 25 mots max"}]}. Aucun texte autour.',
    ].join('\n'),
    user: `Date du jour : ${day} (France). Donne les actus.`,
  };
}

export function parseNews(raw: string): NewsItem[] {
  const out = firstJson(raw) as { news?: unknown } | null;
  const list = Array.isArray(out?.news) ? out!.news : [];
  return (list as Record<string, unknown>[])
    .map((n) => ({ titre: String(n?.titre ?? '').trim().slice(0, 140), resume: String(n?.resume ?? '').trim().slice(0, 240) }))
    .filter((n) => n.titre.length > 5)
    .slice(0, 10);
}

type HFacts = { name: string; [k: string]: unknown };

/** Étape 2 : un horoscope loufoque par pilote, qui mélange ses vraies stats et une actu du jour. */
export function horoscopePrompt(day: string, facts: HFacts[], news: NewsItem[], o: BotOptions): { system: string; user: string } {
  const L = o.label;
  const tone = {
    sobre: 'Humour absurde et bienveillant, aucune moquerie appuyée.',
    taquin: "Chambrage entre collègues : fausse solennité d'astrologue, ironie, mauvaise foi assumée. Taquine sans humilier.",
    piquant: 'Pince-sans-rire et mordant, franchement absurde, mais toujours bon enfant.',
  }[o.tone];
  const system = [
    "Tu es Madame Kartmira, astrologue de pacotille qui rédige l'horoscope quotidien d'un club de Mario Kart 8 entre collègues (parties à la pause de midi, 4 pilotes par course, places 1 à 4).",
    "Style : LOUFOQUE. Horoscope parodique, prédictions absurdes, causalités cosmiques ridicules, comparaisons inattendues, chutes. Pense « Les Inconnus » croisé avec un astrologue de télé-achat.",
    tone,
    "Pour CHAQUE pilote : rattache sa prédiction à UNE actu du jour (différente d'un pilote à l'autre si possible), détournée de façon absurde vers sa course du midi. Ex. d'esprit : « Le Louvre a perdu un tableau ? Toi tu vas perdre ta 2e place au même rythme : discrètement, puis tout le monde en parle. »",
    "Si la liste d'actus est vide, invente des brèves manifestement fictives et absurdes (ex. « Un lama nommé directeur de la RATP »), jamais crédibles.",
    "Dans les phrases, appelle chaque pilote par le nom fourni dans « pilote ».",
    "Glisse au moins une de ses vraies stats (moyenne, forme, jour de la semaine, némésis ou victime) dans une ligne, chiffres exacts tels que fournis. N'invente aucun chiffre.",
    "« nemesis » et « victime » sont les rivalités DU MOMENT, calculées sur ses dernières courses (« rivalites_sur_courses ») : présente-les comme une rivalité actuelle, jamais comme une rivalité de toujours. Si elles valent null, ne cite aucune némésis ni victime.",
    "Interdits : physique, vie privée, travail ou résultats de l'entreprise, sujets graves. Sans emoji, sans hashtag. N'accorde pas de genre aux pilotes (évite il/elle).",
    `Pilotes à ne pas chambrer (reste doux avec eux) : ${o.optout.map(L).join(', ') || 'aucun'}.`,
    'Format de sortie : UNIQUEMENT un JSON :',
    '{"horoscopes":[{"pilote":"<nom exact tel que fourni>","signe":"signe astral absurde inventé, 2 à 5 mots, ex. Banane ascendant Carapace","actu":"titre court de l\'actu utilisée","lignes":["3 phrases, 30 mots max chacune : la prophétie liée à l\'actu, la stat détournée, un conseil absurde"],"place":1,"astre":"<nom d\'un autre pilote ou null>"}]}',
  ].join('\n');
  const user = JSON.stringify({
    date: day,
    actus: news,
    pilotes: facts.map((f) => {
      const { name, nemesis, victime, ...rest } = f as HFacts & { nemesis?: { pilote: string } | null; victime?: { pilote: string } | null };
      return {
        pilote: L(name), ...rest,
        nemesis: nemesis ? { ...nemesis, pilote: L(nemesis.pilote) } : null,
        victime: victime ? { ...victime, pilote: L(victime.pilote) } : null,
      };
    }),
  });
  return { system, user };
}

/** `players` : nom interne et nom affiché (celui que l'IA a reçu). Renvoie les horoscopes indexés par nom interne. */
export function parseHoroscopes(raw: string, players: { name: string; display: string }[]): Record<string, AiHoroscope> {
  const out = firstJson(raw) as { horoscopes?: unknown } | null;
  const list = Array.isArray(out?.horoscopes) ? out!.horoscopes as Record<string, unknown>[] : [];
  const res: Record<string, AiHoroscope> = {};
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const find = (v: unknown) => players.find((p) => norm(p.display) === norm(String(v ?? '')) || norm(p.name) === norm(String(v ?? '')))?.name ?? null;
  for (const h of list) {
    const name = find(h?.pilote);
    if (!name || res[name]) continue;
    const lines = (Array.isArray(h.lignes) ? h.lignes : []).map((l) => String(l).replace(/\s+/g, ' ').trim()).filter((l) => l.length > 8).slice(0, 4).map((l) => l.slice(0, 280));
    if (lines.length < 2) continue;
    const place = Math.round(Number(h.place));
    const astre = find(h.astre);
    const star = astre && astre !== name ? astre : null;
    res[name] = {
      sign: String(h.signe ?? '').trim().slice(0, 60) || 'Signe inconnu (même des astres)',
      lines,
      lucky: place >= 1 && place <= 4 ? place : 1,
      news: String(h.actu ?? '').trim().slice(0, 140) || null,
      star,
    };
  }
  return res;
}
