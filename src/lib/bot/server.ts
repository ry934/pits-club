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

export function takePrompt(text: string, author: string, players: { name: string; display: string }[]): { system: string; user: string } {
  const system = [
    "Tu convertis le pronostic (« Take ») d'un joueur de Mario Kart en règle vérifiable sur les résultats de la session du jour.",
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
    'La moyenne est la place moyenne (1 = toujours premier, 4 = toujours dernier). « Finir devant » quelqu\'un = duel.',
    `Les pilotes (nom exact, puis pseudo) : ${players.map((p) => (p.display !== p.name ? `${p.name} (alias ${p.display})` : p.name)).join(', ')}.`,
    `L'auteur du Take est ${author} : « je », « moi » désignent ${author}.`,
    'Utilise toujours le nom exact du pilote, jamais l\'alias.',
    'Format de réponse : {"ok":true,"rule":{...},"label":"reformulation courte et neutre en français"}',
    'Si le Take ne peut pas se traduire par une de ces règles (trop vague, hors du jeu, plusieurs conditions, subjectif), réponds {"ok":false,"reason":"explication courte en français, avec une suggestion de reformulation"}.',
  ].join('\n');
  return { system, user: text };
}

/** Vérifie et normalise la règle renvoyée par l'IA. */
export function validateRule(raw: unknown, names: string[]): TakeRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kinds = RULE_KINDS.map((k) => k.kind) as string[];
  if (typeof r.kind !== 'string' || !kinds.includes(r.kind)) return null;
  const nm = (v: unknown) => (typeof v === 'string' ? names.find((n) => n.toLowerCase() === v.trim().toLowerCase()) ?? null : null);
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
