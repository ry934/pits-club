/**
 * Fonction serveur Vercel : le bot Slack de Pits Club et les appels à l'IA.
 *
 * Appels possibles (POST, JSON) :
 * - par la base (planificateur, chaque minute) : en-tête x-bot-secret + { log_id } → rédige et poste le message ;
 * - par un pilote connecté (Authorization: Bearer <jeton>) : { action: 'parse-take', text } → règle vérifiable ;
 * - par un admin connecté : { action: 'status' | 'preview' | 'send', kind?, day?, salt? }.
 *
 * Variables d'environnement (Vercel > Settings > Environment Variables) :
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  (déjà présentes)
 *   BOT_SECRET          secret affiché par le script SQL 006
 *   SLACK_WEBHOOK_URL   adresse du webhook Slack du canal dédié
 *   GEMINI_API_KEY      (facultatif) Takes en texte libre et plume IA (clé Google AI Studio, commence par « AIza »)
 *   GEMINI_MODEL_PEN, GEMINI_MODEL_PARSE  (facultatif) pour changer de modèle sans toucher au code
 */
import {
  aiStoryPrompt, cleanStory, composeMessage, factsFrom, firstJson, optionsFrom, Payload, takePrompt, validateRule,
} from '../src/lib/bot/server';
import { ruleLabel } from '../src/lib/takes';
import type { SlackMessage } from '../src/lib/bot/messages';

declare const process: { env: Record<string, string | undefined> };

const env = (k: string) => (process.env[k] ?? '').trim();
const SB_URL = () => env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const SB_KEY = () => env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function rpc<T>(fn: string, args: Record<string, unknown>, jwt?: string): Promise<T> {
  const r = await fetch(`${SB_URL()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${jwt ?? SB_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} : ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function currentUser(jwt: string): Promise<{ id: string } | null> {
  const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${jwt}` } });
  return r.ok ? r.json() : null;
}

/**
 * Clé Gemini. Par tolérance, une clé Google (« AIza… ») collée par erreur dans ANTHROPIC_API_KEY est aussi acceptée.
 */
const aiKey = () => env('GEMINI_API_KEY') || env('GOOGLE_API_KEY') || (env('ANTHROPIC_API_KEY').startsWith('AIza') ? env('ANTHROPIC_API_KEY') : '');

/** Appel Gemini avec une nouvelle tentative sur saturation passagère (429/500/503), puis repli sur les modèles suivants. */
async function ai(models: string | string[], system: string, user: string, maxTokens: number, asJson = false): Promise<string> {
  const list = (Array.isArray(models) ? models : [models]).filter((m, i, a) => m && a.indexOf(m) === i);
  let last: unknown;
  for (const model of list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await aiOnce(model, system, user, maxTokens, asJson); }
      catch (e) {
        last = e;
        if (!/IA : (429|500|503)/.test(String(e))) break; // erreur non passagère : modèle suivant
        if (attempt === 0) await new Promise((res) => setTimeout(res, 1200));
      }
    }
  }
  throw last;
}

async function aiOnce(model: string, system: string, user: string, maxTokens: number, asJson: boolean): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': aiKey(), 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // Marge large : sur les modèles qui « réfléchissent », le raisonnement consomme aussi ce budget.
      generationConfig: { maxOutputTokens: Math.max(maxTokens * 4, 1024), ...(asJson ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  if (!r.ok) throw new Error(`IA : ${r.status} (${model}) ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
  const data = await r.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };
  const c = data.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((x) => !x.thought && x.text).map((x) => x.text).join('').trim();
  if (!text) throw new Error(`IA : réponse vide (${c?.finishReason ?? 'aucun candidat'})`);
  return text;
}

const MODEL_PEN = env('GEMINI_MODEL_PEN') || 'gemini-3.8-flash';
const MODEL_PARSE = env('GEMINI_MODEL_PARSE') || 'gemini-3.5-flash-lite';
/** Si un modèle est saturé, on bascule sur le suivant. */
const PEN_CHAIN = [MODEL_PEN, 'gemini-3.6-flash', MODEL_PARSE];
const PARSE_CHAIN = [MODEL_PARSE, 'gemini-3.1-flash-lite', 'gemini-3.6-flash'];

async function postSlack(m: SlackMessage): Promise<void> {
  const url = env('SLACK_WEBHOOK_URL');
  if (!url) throw new Error('SLACK_WEBHOOK_URL manquant dans Vercel');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.text, blocks: m.blocks }) });
  if (!r.ok) throw new Error(`Slack : ${r.status} ${(await r.text()).slice(0, 160)}`);
}

/** Récit IA si activé et disponible ; sinon story vide (la bibliothèque prend le relais) et la raison dans aiError. */
async function aiStory(p: Payload, kind: string, salt?: string): Promise<{ story?: string; aiError?: string }> {
  if (kind !== 'debrief' || p.settings.ai_pen !== true) return {};
  if (!aiKey()) return { aiError: 'clé absente' };
  const f = factsFrom(p);
  if (!f) return { aiError: 'pas de données de session' };
  try {
    const { system, user } = aiStoryPrompt(f, optionsFrom(p, salt));
    const raw = await ai(PEN_CHAIN, system, user, 400);
    const story = cleanStory(raw);
    return story ? { story } : { aiError: `récit hors format (${raw.length} caractères)` };
  } catch (e) {
    return { aiError: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

async function build(p: Payload, kind: string, salt?: string, revealedOnly = true) {
  const { story, aiError } = await aiStory(p, kind, salt);
  const m = composeMessage(kind, p, { salt, story, revealedOnly });
  if (aiError && !('error' in m)) m.meta = { ...m.meta, ai_error: aiError };
  return m;
}

/** Traite une entrée du journal : rédige, poste sur Slack, consigne le résultat. */
async function processLog(logId: number): Promise<{ ok: boolean; body?: string; error?: string }> {
  const secret = env('BOT_SECRET');
  const p = await rpc<Payload>('bot_payload', { secret, p_log: logId });
  if (!p.log) return { ok: false, error: 'entrée inconnue' };
  try {
    const m = await build(p, p.log.kind);
    if ('error' in m) {
      await rpc('bot_result', { secret, p_log: logId, p_status: 'skipped', p_body: null, p_error: m.error });
      return { ok: false, error: m.error };
    }
    await postSlack(m);
    await rpc('bot_result', { secret, p_log: logId, p_status: 'sent', p_body: m.text, p_error: null, p_meta: m.meta });
    return { ok: true, body: m.text };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await rpc('bot_result', { secret, p_log: logId, p_status: 'failed', p_body: null, p_error: error }).catch(() => {});
    return { ok: false, error };
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps vide */ }

  // 1) Appel du planificateur (base de données)
  const botHeader = req.headers.get('x-bot-secret');
  if (botHeader) {
    if (!env('BOT_SECRET') || botHeader !== env('BOT_SECRET')) return json({ error: 'secret invalide' }, 401);
    const id = Number(body.log_id);
    if (!id) return json({ error: 'log_id manquant' }, 400);
    return json(await processLog(id));
  }

  // 2) Appels depuis l'app (pilote ou admin connecté)
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const user = jwt ? await currentUser(jwt) : null;
  if (!user) return json({ error: 'Connexion requise' }, 401);
  const action = String(body.action ?? '');

  if (action === 'parse-take') {
    const text = String(body.text ?? '').trim().slice(0, 280);
    if (text.length < 3) return json({ ok: false, reason: 'Ton Take est vide.' });
    if (!aiKey()) return json({ ok: false, unavailable: true, reason: "L'IA n'est pas encore branchée : ton Take sera arbitré à la main." });
    const sbHeaders = { apikey: SB_KEY(), Authorization: `Bearer ${jwt}` };
    const [meRes, plRes] = await Promise.all([
      fetch(`${SB_URL()}/rest/v1/players?select=name&user_id=eq.${user.id}`, { headers: sbHeaders }),
      fetch(`${SB_URL()}/rest/v1/players?select=name,display_name,active&name=neq.Other`, { headers: sbHeaders }),
    ]);
    const me = ((await meRes.json()) as { name: string }[])[0]?.name;
    if (!me) return json({ ok: false, reason: 'Seuls les pilotes peuvent poster un Take.' });
    const players = ((await plRes.json()) as { name: string; display_name: string | null; active: boolean }[]);
    const list = players.map((p) => ({ name: p.name, display: p.display_name || p.name }));
    try {
      const { system, user: u } = takePrompt(text, me, list);
      const out = firstJson(await ai(PARSE_CHAIN, system, u, 300, true)) as { ok?: boolean; rule?: unknown; label?: string; reason?: string } | null;
      if (!out?.ok) return json({ ok: false, reason: out?.reason ?? 'Take impossible à vérifier automatiquement. Essaie une formulation plus précise.' });
      const rule = validateRule(out.rule, list.map((p) => p.name));
      if (!rule) return json({ ok: false, reason: 'Take impossible à vérifier automatiquement. Essaie une formulation plus précise.' });
      return json({ ok: true, rule, label: ruleLabel(rule) });
    } catch (e) {
      return json({ ok: false, unavailable: true, reason: "L'IA ne répond pas pour le moment : ton Take sera arbitré à la main.", detail: String(e) });
    }
  }

  // Actions réservées aux admins
  const admin = await rpc<boolean>('is_admin', {}, jwt).catch(() => false);
  if (!admin) return json({ error: 'Réservé aux admins' }, 403);

  if (action === 'status') {
    let secretOk = false;
    if (env('BOT_SECRET')) secretOk = await rpc('bot_payload', { secret: env('BOT_SECRET'), p_log: null, p_day: null }).then(() => true, () => false);
    // Vrai appel test : une clé présente mais refusée ne doit plus afficher « branchée ».
    let aiOk = false;
    let aiError: string | null = aiKey() ? null : 'clé absente';
    if (aiKey()) {
      try { await ai(PARSE_CHAIN, 'Réponds uniquement OK.', 'Test', 5); aiOk = true; }
      catch (e) { aiError = String(e instanceof Error ? e.message : e).slice(0, 200); }
    }
    return json({ slack: !!env('SLACK_WEBHOOK_URL'), ai: aiOk, aiError, secret: secretOk });
  }

  const kind = String(body.kind ?? 'debrief');
  if (!['debrief', 'extra', 'reminder', 'test'].includes(kind)) return json({ error: 'type inconnu' }, 400);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day)) ? String(body.day) : null;

  if (action === 'preview') {
    const p = await rpc<Payload>('bot_payload', { secret: env('BOT_SECRET'), p_log: null, p_day: day });
    const m = await build(p, kind, body.salt ? String(body.salt) : undefined);
    return json('error' in m ? { ok: false, error: m.error } : { ok: true, text: m.text, meta: m.meta });
  }

  if (action === 'send') {
    const id = await rpc<number>('bot_queue', { secret: env('BOT_SECRET'), p_kind: kind, p_day: day ?? new Date().toISOString().slice(0, 10) });
    return json(await processLog(id));
  }

  return json({ error: 'action inconnue' }, 400);
}
