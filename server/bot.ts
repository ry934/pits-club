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
 *   ANTHROPIC_API_KEY   (facultatif) Takes en texte libre et plume IA
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

async function claude(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`IA : ${r.status} ${(await r.text()).slice(0, 160)}`);
  const data = await r.json() as { content: { type: string; text?: string }[] };
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}

const MODEL_PEN = 'claude-sonnet-5-5';
const MODEL_PARSE = 'claude-haiku-5-5';

async function postSlack(m: SlackMessage): Promise<void> {
  const url = env('SLACK_WEBHOOK_URL');
  if (!url) throw new Error('SLACK_WEBHOOK_URL manquant dans Vercel');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.text, blocks: m.blocks }) });
  if (!r.ok) throw new Error(`Slack : ${r.status} ${(await r.text()).slice(0, 160)}`);
}

/** Récit IA si activé et disponible, sinon undefined (la bibliothèque prend le relais). */
async function aiStory(p: Payload, kind: string, salt?: string): Promise<string | undefined> {
  if (kind !== 'debrief' || p.settings.ai_pen !== true || !env('ANTHROPIC_API_KEY')) return undefined;
  const f = factsFrom(p);
  if (!f) return undefined;
  try {
    const { system, user } = aiStoryPrompt(f, optionsFrom(p, salt));
    return cleanStory(await claude(MODEL_PEN, system, user, 400)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function build(p: Payload, kind: string, salt?: string, revealedOnly = true) {
  const story = await aiStory(p, kind, salt);
  return composeMessage(kind, p, { salt, story, revealedOnly });
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
    if (!env('ANTHROPIC_API_KEY')) return json({ ok: false, unavailable: true, reason: "L'IA n'est pas encore branchée : ton Take sera arbitré à la main." });
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
      const out = firstJson(await claude(MODEL_PARSE, system, u, 300)) as { ok?: boolean; rule?: unknown; label?: string; reason?: string } | null;
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
    return json({ slack: !!env('SLACK_WEBHOOK_URL'), ai: !!env('ANTHROPIC_API_KEY'), secret: secretOk });
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
