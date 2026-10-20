import { fmtAvg, fmtDuration, fmtTime } from '../stats';
import { seedOf } from '../takes';
import { SessionFacts, TakeVerdict } from './facts';

/**
 * Bibliothèque de phrases du bot Slack. Chaque message est assemblé à partir de plusieurs « passages »
 * (ouverture, vainqueur, lanterne rouge, fait marquant, Takes, conclusion), chacun tiré parmi des variantes
 * qui collent à la session réelle. Les phrases utilisées récemment sont écartées pour éviter les redites.
 */

export type BotTone = 'sobre' | 'taquin' | 'piquant';

export type BotOptions = {
  tone: BotTone;
  appUrl: string;
  label: (name: string) => string;       // nom affiché (pseudo si choisi)
  optout: string[];                       // jamais chambrés nommément
  recent: string[];                       // identifiants de phrases déjà utilisées récemment
  includeTakes: boolean;
  salt?: string;                          // pour forcer un autre tirage (aperçu « autre version »)
};

export type SlackMessage = { text: string; blocks: unknown[]; meta: { kind: string; ids: string[]; pen: 'library' | 'ai'; ai_error?: string } };

type Ctx = SessionFacts & { o: BotOptions; L: (n: string) => string; roastable: (n: string) => boolean };
type Variant = { id: string; tones?: BotTone[]; t: (c: Ctx) => string | null };

const TAQ: BotTone[] = ['taquin', 'piquant'];
const ALL: BotTone[] = ['sobre', 'taquin', 'piquant'];
const pl = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

// ------------------------------------------------------------------ ouvertures

const OPEN: Record<SessionFacts['scenario'] | 'any' | 'sobre', Variant[]> = {
  domination: [
    { id: 'o-dom-1', t: (c) => `Waouh. Waouh, waouh, waouh. Mais que s'est-il passé ce midi ? ${c.L(c.mvp.name)} a roulé sur tout le monde, et cette fois personne ne pourra accuser la manette.` },
    { id: 'o-dom-2', t: (c) => `Il y a des sessions de kart. Et il y a les sessions où ${c.L(c.mvp.name)} décide que les autres sont des plots de signalisation. Aujourd'hui, c'était la deuxième catégorie.` },
    { id: 'o-dom-3', t: (c) => `Communiqué officiel : ${c.L(c.mvp.name)} a confisqué la session. Les autres pilotes sont priés de récupérer leur dignité à l'accueil.` },
    { id: 'o-dom-4', t: (c) => `On avait prévu un Grand Prix, on a eu un récital. Soliste : ${c.L(c.mvp.name)}. Figurants : tous les autres.` },
    { id: 'o-dom-5', t: () => `Ce midi, la course était passionnante. Pour la deuxième place.` },
    { id: 'o-dom-6', t: (c) => `${c.L(c.mvp.name)} a gagné ${c.mvp.wins} courses sur ${c.mvp.races}. À ce niveau, ce n'est plus du kart, c'est une démonstration commerciale.` },
  ],
  serre: [
    { id: 'o-ser-1', t: (c) => `Session serrée comme un créneau de parking un lundi matin : ${fmtAvg(c.gapTop2!)} d'écart entre ${c.L(c.mvp.name)} et ${c.L(c.table[1].name)} au sommet.` },
    { id: 'o-ser-2', t: (c) => `Photo-finish au paddock. ${c.L(c.mvp.name)} s'impose d'un rien sur ${c.L(c.table[1].name)}, et ce rien mesure ${fmtAvg(c.gapTop2!)} de moyenne.` },
    { id: 'o-ser-3', t: (c) => `Personne n'a vraiment dominé, tout le monde a vraiment souffert. Au bout du compte, ${c.L(c.mvp.name)} passe devant ${c.L(c.table[1].name)} pour ${fmtAvg(c.gapTop2!)}.` },
    { id: 'o-ser-4', t: (c) => `Si vous aimez le suspense, vous avez été servis : ${c.L(c.mvp.name)} et ${c.L(c.table[1].name)} séparés par ${fmtAvg(c.gapTop2!)}. Les autres étaient séparés de la victoire par un océan.` },
    { id: 'o-ser-5', t: (c) => `Un peloton compact, des nerfs à vif, et ${c.L(c.mvp.name)} qui gratte la première place d'un cheveu devant ${c.L(c.table[1].name)}.` },
  ],
  spirale: [
    { id: 'o-spi-1', tones: TAQ, t: (c) => c.roastable(c.lossStreak!.name) ? `Grande nouvelle : ${c.L(c.lossStreak!.name)} a dominé la session. Non, je plaisante. Mais c'était beau d'y croire une demi-seconde.` : null },
    { id: 'o-spi-2', tones: TAQ, t: (c) => c.roastable(c.lossStreak!.name) ? `Spoiler : ce débrief contient une série de ${c.lossStreak!.n} dernières places. Les âmes sensibles peuvent passer directement au classement.` : null },
    { id: 'o-spi-3', tones: TAQ, t: () => `Ce midi, la session a connu un héros et une tragédie. Commençons par le héros, la tragédie mérite qu'on prenne notre temps.` },
    { id: 'o-spi-4', tones: TAQ, t: (c) => c.roastable(c.lossStreak!.name) ? `Il y a eu des courses, des dépassements, des bananes. Et il y a eu ${c.L(c.lossStreak!.name)}, avec ${c.lossStreak!.n} quatrièmes places d'affilée et un sourire de façade.` : null },
  ],
  marathon: [
    { id: 'o-mar-1', t: (c) => `${c.races} courses, ${fmtDuration(c.minutes)} de jeu. À ce stade, ce n'est plus une pause déjeuner, c'est un séminaire.` },
    { id: 'o-mar-2', t: (c) => `${c.races} courses au compteur. Quelque part, une salade attend toujours d'être mangée.` },
    { id: 'o-mar-3', t: (c) => `Session marathon : ${c.races} courses. Les manettes réclament des congés payés.` },
  ],
  courte: [
    { id: 'o-crt-1', t: (c) => `Session express : ${c.races} courses, à peine le temps de choisir son kart. ${c.L(c.mvp.name)} n'a pas perdu une minute.` },
    { id: 'o-crt-2', t: (c) => `Format court aujourd'hui, ${c.races} courses. Juste assez pour que ${c.L(c.mvp.name)} fasse le malin, pas assez pour que les autres s'en remettent.` },
    { id: 'o-crt-3', t: (c) => `${c.races} courses seulement. Un amuse-bouche, et ${c.L(c.mvp.name)} s'est quand même servi en premier.` },
  ],
  standard: [],
  any: [
    { id: 'o-any-1', tones: TAQ, t: () => `Waouh, waouh, waouh. Mais que s'est-il passé aujourd'hui ? Rien d'historique, à vrai dire. Mais on va quand même en parler pendant dix minutes.` },
    { id: 'o-any-2', t: () => `Le kart du midi a rendu son verdict, et comme d'habitude il n'a fait aucun cadeau.` },
    { id: 'o-any-3', tones: TAQ, t: () => `Bonne nouvelle : tout le monde est revenu entier. Mauvaise nouvelle : pas forcément avec son honneur.` },
    { id: 'o-any-4', t: () => `Encore une session où chacun avait un plan. Encore une session où le plan a tenu jusqu'au premier virage.` },
    { id: 'o-any-5', t: (c) => `Les feux se sont éteints à ${fmtTime(c.start)}. Certains ne s'en sont toujours pas remis.` },
    { id: 'o-any-6', t: () => `Session terminée, manettes posées, excuses en préparation. Voici le débrief.` },
    { id: 'o-any-7', tones: TAQ, t: () => `Le paddock a parlé. Et il n'a pas été tendre.` },
    { id: 'o-any-8', t: () => `Une session de plus dans la légende. Une petite légende, certes. Mais une légende.` },
    { id: 'o-any-9', t: (c) => `${c.races} courses, ${pl(c.table.length, 'pilote')}, zéro pitié. Le débrief.` },
  ],
  sobre: [
    { id: 'o-sob-1', t: () => `Session terminée. Voici le résumé du jour, sans fioritures et presque sans mauvaise foi.` },
    { id: 'o-sob-2', t: (c) => `Le kart du midi a rendu son verdict. Bravo à tous les pilotes, et en particulier à ${c.L(c.mvp.name)}.` },
    { id: 'o-sob-3', t: (c) => `${c.races} courses au programme ce midi. Résumé express.` },
    { id: 'o-sob-4', t: () => `Petit débrief de la session du jour, à consommer avec modération.` },
  ],
};

// ------------------------------------------------------------------ vainqueur, lanterne rouge, fait marquant

const MVP: Variant[] = [
  { id: 'm-1', tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* termine en tête avec ${fmtAvg(c.mvp.avg)} de moyenne et ${pl(c.mvp.wins, 'victoire')}. Applaudissements polis, on ne voudrait pas que ça monte à la tête.` },
  { id: 'm-2', tones: TAQ, t: (c) => `Mention spéciale à *${c.L(c.mvp.name)}* : ${fmtAvg(c.mvp.avg)} de moyenne. Les autres ont pris des notes. Illisibles, mais des notes.` },
  { id: 'm-3', tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* signe la meilleure moyenne du jour (${fmtAvg(c.mvp.avg)}). Ce soir, quelqu'un va raconter cette session à des gens qui n'ont rien demandé.` },
  { id: 'm-4', tones: TAQ, t: (c) => `Au sommet : *${c.L(c.mvp.name)}*, ${fmtAvg(c.mvp.avg)} de moyenne, ${pl(c.mvp.wins, 'victoire')}. Le trophée est imaginaire, la fierté beaucoup moins.` },
  { id: 'm-5', tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* repart avec la première place (${fmtAvg(c.mvp.avg)}). Profite, ça ne dure jamais très longtemps ici.` },
  { id: 'm-6', tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* a régné sur la session avec ${fmtAvg(c.mvp.avg)} de moyenne. Le pouvoir monte vite, on surveille.` },
  { id: 'm-sob', tones: ['sobre'], t: (c) => `*${c.L(c.mvp.name)}* termine en tête avec ${fmtAvg(c.mvp.avg)} de moyenne et ${pl(c.mvp.wins, 'victoire')}. Bravo.` },
];

const FLOP: Variant[] = [
  { id: 'f-1', tones: TAQ, t: (c) => `À l'autre bout du classement, ${c.L(c.flop.name)} (${fmtAvg(c.flop.avg)}) a fait preuve d'une générosité rare envers ses adversaires.` },
  { id: 'f-2', tones: TAQ, t: (c) => `${c.L(c.flop.name)} ferme la marche avec ${fmtAvg(c.flop.avg)}. Il faut bien que quelqu'un tienne la lanterne, et ce midi c'était son tour.` },
  { id: 'f-3', tones: TAQ, t: (c) => `Lanterne rouge pour ${c.L(c.flop.name)} (${fmtAvg(c.flop.avg)}, ${c.flop.lasts} fois 4e). On parlera plutôt de « session d'observation ».` },
  { id: 'f-4', tones: TAQ, t: (c) => `${c.L(c.flop.name)} boucle la session en dernière position (${fmtAvg(c.flop.avg)}). Les bananes avaient visiblement un abonnement.` },
  { id: 'f-5', tones: TAQ, t: (c) => `Côté cuillère de bois : ${c.L(c.flop.name)}, ${fmtAvg(c.flop.avg)} de moyenne. C'est l'intention qui compte.` },
  { id: 'f-6', tones: TAQ, t: (c) => `${c.L(c.flop.name)} termine en queue de peloton (${fmtAvg(c.flop.avg)}). Le jeu propose un mode 50cc, on dit ça, on ne dit rien.` },
  { id: 'f-p1', tones: ['piquant'], t: (c) => c.flop.lasts >= 4 ? `${c.L(c.flop.name)} : ${c.flop.lasts} quatrièmes places. À ce stade, ce n'est plus une contre-performance, c'est une ligne éditoriale.` : null },
  { id: 'f-p2', tones: ['piquant'], t: (c) => `${c.L(c.flop.name)} finit avec ${fmtAvg(c.flop.avg)} de moyenne. On a vérifié : la manette était bien branchée.` },
];

const HIGHLIGHT: Variant[] = [
  { id: 'h-ws1', t: (c) => c.winStreak && c.winStreak.name !== c.perfect ? `Série du jour : ${c.L(c.winStreak.name)} a enchaîné ${c.winStreak.n} victoires d'affilée. Un moment, on a cru à un bug.` : null },
  { id: 'h-ws2', tones: TAQ, t: (c) => c.winStreak && c.winStreak.name !== c.perfect ? `${c.L(c.winStreak.name)} a aligné ${c.winStreak.n} victoires de suite. Les autres appellent ça « un petit passage à vide collectif ».` : null },
  { id: 'h-up1', t: (c) => c.upset ? `Coup de théâtre : ${c.L(c.upset.name)}, outsider de la course, a battu ${c.L(c.upset.beat)} alors que tout le monde avait déjà écrit la fin.` : null },
  { id: 'h-up2', tones: TAQ, t: (c) => c.upset ? `La surprise du jour : ${c.L(c.upset.name)} s'est offert ${c.L(c.upset.beat)}. Les bookmakers présentent leur démission.` : null },
  { id: 'h-pf', t: (c) => c.perfect ? `${c.L(c.perfect)} a gagné toutes ses courses. Toutes. Une enquête est ouverte.` : null },
  { id: 'h-eu', t: (c) => c.eloUp ? `Bonne opération pour ${c.L(c.eloUp.name)} : +${c.eloUp.delta} points de cote sur la journée. La bourse du kart est en hausse.` : null },
  { id: 'h-ed', tones: TAQ, t: (c) => c.eloDown && c.roastable(c.eloDown.name) && c.eloDown.name !== c.flop.name ? `${c.L(c.eloDown.name)} laisse ${-c.eloDown.delta} points de cote sur la piste. Ils seront remis aux objets trouvés.` : null },
  { id: 'h-ls', tones: TAQ, t: (c) => c.lossStreak && c.roastable(c.lossStreak.name) && c.lossStreak.name !== c.flop.name ? `${c.L(c.lossStreak.name)} a collectionné ${c.lossStreak.n} quatrièmes places d'affilée. La constance est une qualité. Normalement.` : null },
  { id: 'h-wl', tones: TAQ, t: (c) => { const w = c.winless.filter((n) => c.roastable(n) && n !== c.flop.name); return w.length ? `${w.map(c.L).join(' et ')} ${w.length > 1 ? 'repartent' : 'repart'} sans la moindre victoire, mais avec beaucoup d'expérience.` : null; } },
];

const TAKES_NONE: Variant[] = [
  { id: 't-n1', t: () => `Aucun Take aujourd'hui. Prudence ou manque d'imagination, l'histoire tranchera.` },
  { id: 't-n2', t: () => `Pas un seul Take posé. Les devins sont en RTT.` },
  { id: 't-n3', t: () => `Zéro Take ce midi. Personne n'a osé, et c'était peut-être le plus sage.` },
];
const TAKES_ALLWON: Variant[] = [
  { id: 't-w1', t: () => `Tous les Takes sont passés. Soit vous êtes devins, soit vous visez trop bas.` },
  { id: 't-w2', t: () => `Sans-faute sur les Takes. Le paddock envisage de vous confier les prévisions météo.` },
];
const TAKES_ALLLOST: Variant[] = [
  { id: 't-l1', t: () => `Aucun Take n'a tenu. Nostradamus peut dormir tranquille.` },
  { id: 't-l2', t: () => `Zéro Take honoré. L'avenir reste, pour l'instant, hors de portée du paddock.` },
  { id: 't-l3', t: () => `Tous les Takes sont tombés. On appelle ça de l'optimisme, et c'est très bien.` },
];
const TAKES_MIXED: Variant[] = [
  { id: 't-m1', t: () => `Quelques visionnaires, quelques rêveurs. Comme d'habitude.` },
  { id: 't-m2', t: () => `Le paddock fait ses comptes : il y a les voyants, et il y a les autres.` },
  { id: 't-m3', t: () => `Certains ont vu juste, d'autres ont vu grand.` },
];

const CLOSE: Variant[] = [
  { id: 'c-1', t: () => `Tous les détails, les courbes et les excuses sont au paddock.` },
  { id: 'c-2', tones: TAQ, t: () => `Les chiffres complets attendent au paddock. Les excuses, elles, se font en personne.` },
  { id: 'c-3', t: () => `Rendez-vous à la prochaine session pour la revanche. Ou pour la confirmation.` },
  { id: 'c-4', t: () => `Le paddock est ouvert pour ceux qui veulent revivre ça au ralenti.` },
  { id: 'c-5', tones: TAQ, t: () => `Prochaine session bientôt. D'ici là, entraînez-vous. Certains plus que d'autres.` },
  { id: 'c-sob', tones: ['sobre'], t: () => `Le détail est sur le paddock. Bon après-midi à tous.` },
];

// ------------------------------------------------------------------ tirage

function pick(list: Variant[], c: Ctx, slot: string, used: string[]): string | null {
  const ok = list.filter((v) => (v.tones ?? ALL).includes(c.o.tone)).map((v) => ({ v, s: v.t(c) })).filter((x) => x.s);
  if (!ok.length) return null;
  const fresh = ok.filter((x) => !c.o.recent.includes(x.v.id));
  const pool = fresh.length ? fresh : ok;
  const x = pool[seedOf(`${c.day}|${slot}|${c.o.salt ?? ''}`) % pool.length];
  used.push(x.v.id);
  return x.s;
}

function ctxOf(f: SessionFacts, o: BotOptions): Ctx {
  return { ...f, o, L: o.label, roastable: (n) => o.tone !== 'sobre' && !o.optout.includes(n) };
}

const VERDICT_LABEL: Record<TakeVerdict, string> = { won: 'honoré', lost: 'raté', void: 'annulé', manual: 'à arbitrer' };

function takesBlock(c: Ctx, used: string[]): string | null {
  if (!c.o.includeTakes) return null;
  const t = c.takes;
  if (!t.length) return pick(TAKES_NONE, c, 'takes', used);
  const quote = (x: (typeof t)[number]) => `${c.L(x.take.author)} (« ${x.take.text.length > 90 ? x.take.text.slice(0, 88) + '…' : x.take.text} »${x.verdict === 'won' && x.take.points ? `, +${x.take.points} pts` : ''})`;
  const won = t.filter((x) => x.verdict === 'won'), lost = t.filter((x) => x.verdict === 'lost');
  const other = t.filter((x) => x.verdict === 'void' || x.verdict === 'manual');
  const lines = ['*Les Takes du jour*'];
  if (won.length) lines.push(`Honorés : ${won.map(quote).join(' · ')}`);
  if (lost.length) lines.push(`Ratés : ${lost.map(quote).join(' · ')}`);
  if (other.length) lines.push(`Sans verdict : ${other.map((x) => `${c.L(x.take.author)} (${VERDICT_LABEL[x.verdict]})`).join(' · ')}`);
  const comment = lost.length === t.length ? pick(TAKES_ALLLOST, c, 'takes', used)
    : won.length === t.length ? pick(TAKES_ALLWON, c, 'takes', used)
      : won.length && lost.length ? pick(TAKES_MIXED, c, 'takes', used) : null;
  if (comment) lines.push(`_${comment}_`);
  return lines.join('\n');
}

function recap(c: Ctx): string {
  const rows = c.table.map((s, i) => `${i + 1}. ${c.L(s.name)} · ${fmtAvg(s.avg)}${s.wins ? ` · ${pl(s.wins, 'victoire')}` : ''}`);
  return `*Classement du jour* · ${pl(c.races, 'course')} · ${fmtDuration(c.minutes)}\n${rows.join('\n')}`;
}

function linkBlocks(url: string, label: string, note: string) {
  return [
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: label }, url, style: 'primary' }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: note }] },
  ];
}

const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });

/** Le récit (ouverture, vainqueur, lanterne rouge, fait marquant) : remplaçable par la plume IA. */
export function debriefStory(f: SessionFacts, o: BotOptions, used: string[] = []): string {
  const c = ctxOf(f, o);
  const open = o.tone === 'sobre'
    ? pick(OPEN.sobre, c, 'open', used)
    : pick([...OPEN[f.scenario], ...(OPEN[f.scenario].length ? [] : OPEN.any)], c, 'open', used) ?? pick(OPEN.any, c, 'open', used);
  const parts = [open, pick(MVP, c, 'mvp', used)];
  if (c.roastable(f.flop.name) && f.flop.name !== f.mvp.name && f.table.length >= 3) parts.push(pick(FLOP, c, 'flop', used));
  parts.push(pick(HIGHLIGHT, c, 'hl', used));
  return parts.filter(Boolean).join(' ');
}

export function buildDebrief(f: SessionFacts, o: BotOptions, story?: string): SlackMessage {
  const used: string[] = [];
  const c = ctxOf(f, o);
  const narrative = story ?? debriefStory(f, o, used);
  const takes = takesBlock(c, used);
  const close = pick(CLOSE, c, 'close', used);
  const url = `${o.appUrl}/#/stats/session/${f.day}`;
  const text = [narrative, recap(c), takes, `${close} ${url}`].filter(Boolean).join('\n\n');
  const blocks = [
    section(narrative),
    section(recap(c)),
    ...(takes ? [section(takes)] : []),
    section(close ?? ''),
    ...linkBlocks(url, 'Voir les stats de la session', 'Pits Club · débrief automatique'),
  ];
  return { text, blocks, meta: { kind: 'debrief', ids: used, pen: story ? 'ai' : 'library' } };
}

// ------------------------------------------------------------------ prolongations

const EXTRA: Variant[] = [
  { id: 'x-1', tones: TAQ, t: () => `Prolongations ! Des courses ont été jouées après le débrief. Visiblement, quelqu'un n'avait pas digéré le premier résultat.` },
  { id: 'x-2', t: () => `On croyait la session terminée. Erreur : il y a eu du rab, et le classement a bougé.` },
  { id: 'x-3', tones: TAQ, t: () => `Rab de kart : quelques courses en plus, pour ceux qui aiment souffrir. Classement mis à jour.` },
  { id: 'x-sob', tones: ['sobre'], t: () => `Quelques courses ont été ajoutées après le débrief. Voici le classement mis à jour.` },
];

export function buildExtra(f: SessionFacts, o: BotOptions): SlackMessage {
  const used: string[] = [];
  const c = ctxOf(f, o);
  const head = pick(EXTRA, c, 'extra' + f.races, used) ?? '';
  const url = `${o.appUrl}/#/stats/session/${f.day}`;
  return {
    text: `${head}\n\n${recap(c)}\n\n${url}`,
    blocks: [section(head), section(recap(c)), ...linkBlocks(url, 'Voir les stats de la session', 'Pits Club · prolongations')],
    meta: { kind: 'extra', ids: used, pen: 'library' },
  };
}

// ------------------------------------------------------------------ rappel des Takes

type ReminderCtx = { day: string; deadline: string; posted: string[] };
type RVariant = { id: string; tones?: BotTone[]; t: (d: string) => string };

const REMIND: RVariant[] = [
  { id: 'r-1', tones: TAQ, t: () => `C'est l'heure des Takes. Personne ne vous demande d'avoir raison, juste d'avoir du courage.` },
  { id: 'r-2', t: (d) => `L'heure des pronostics a sonné. Qui va finir devant qui ? Vous avez jusqu'à ${d} pour le prédire.` },
  { id: 'r-3', tones: TAQ, t: (d) => `Petit rappel du paddock : un Take par pilote, avant ${d}. Les « je l'avais dit » ne comptent que s'ils sont écrits.` },
  { id: 'r-4', tones: TAQ, t: () => `Les Takes sont ouverts. C'est le moment de promettre des choses que la piste se fera un plaisir de démentir.` },
  { id: 'r-5', t: (d) => `Avis aux devins, aux optimistes et aux mauvais perdants : les Takes ferment à ${d}.` },
  { id: 'r-6', tones: TAQ, t: (d) => `Il reste un peu de temps avant ${d} pour poser votre Take. Ce midi, quelqu'un va avoir raison. Statistiquement, pas vous.` },
  { id: 'r-7', tones: TAQ, t: () => `Rappel amical : les Takes, c'est maintenant. Plus tard, ça s'appelle de la mauvaise foi.` },
  { id: 'r-8', t: (d) => `Prédire l'avenir, c'est facile. Le faire avant ${d}, c'est plus sportif. À vos Takes.` },
  { id: 'r-9', tones: ['piquant'], t: () => `Les Takes sont ouverts. Vu les résultats de certains, un pronostic sur leur propre victoire relèverait de la science-fiction. Mais on ne juge pas.` },
  { id: 'r-s1', tones: ['sobre'], t: (d) => `Rappel : les Takes sont ouverts jusqu'à ${d}. Un pronostic par pilote.` },
  { id: 'r-s2', tones: ['sobre'], t: (d) => `Les Takes du jour sont ouverts jusqu'à ${d}. Bonne chance à tous.` },
];

export function buildReminder(r: ReminderCtx, o: BotOptions): SlackMessage {
  const ok = REMIND.filter((v) => (v.tones ?? ALL).includes(o.tone));
  const fresh = ok.filter((v) => !o.recent.includes(v.id));
  const pool = fresh.length ? fresh : ok;
  const v = pool[seedOf(`${r.day}|remind|${o.salt ?? ''}`) % pool.length];
  const posted = r.posted.length === 0 ? `Personne n'a encore osé.`
    : `Déjà ${pl(r.posted.length, 'Take scellé', 'Takes scellés')} (${r.posted.map(o.label).join(', ')}). ${o.tone === 'sobre' ? '' : 'Les autres réfléchissent, paraît-il.'}`.trim();
  const url = `${o.appUrl}/#/takes`;
  const head = v.t(r.deadline);
  return {
    text: `${head}\n${posted}\n${url}`,
    blocks: [section(`${head}\n${posted}`), ...linkBlocks(url, 'Poser mon Take', `Clôture à ${r.deadline} · un Take par pilote, révélé après la session`)],
    meta: { kind: 'reminder', ids: [v.id], pen: 'library' },
  };
}

export function buildTest(o: BotOptions): SlackMessage {
  const t = `Test de connexion Pits Club. Si vous lisez ceci, le bot est branché. Il n'a encore rien dit de méchant, profitez-en.`;
  return { text: `${t}\n${o.appUrl}`, blocks: [section(t), ...linkBlocks(o.appUrl, 'Ouvrir Pits Club', 'Pits Club · message de test')], meta: { kind: 'test', ids: [], pen: 'library' } };
}

/** Rendu texte d'un message Slack pour l'aperçu dans le back-office (mrkdwn simplifié). */
export function plainPreview(m: SlackMessage): string {
  return m.text;
}
