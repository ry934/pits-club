import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { Panel, PlayerTag } from '../components/ui';
import { LiveTake, sessionFacts, takeVerdict, TakeVerdict } from '../lib/bot/facts';
import { buildDebrief, buildExtra, buildReminder, buildTest, BotOptions, SlackMessage } from '../lib/bot/messages';
import { callBot, AppSettings, DEFAULT_SETTINGS, fmtHour, useSettings } from '../lib/settings';
import { dayKey, fmtDay, fmtShort } from '../lib/stats';
import { getSupabase } from '../lib/supabase';
import { ruleLabel } from '../lib/takes';
import { useStore } from '../store';

/**
 * Back-office : contrôle du bot Slack (pause, ton, horaires), des Takes et des admins.
 * Chaque réglage est enregistré dès qu'on le change.
 */

type LogRow = { id: number; kind: string; day: string; status: string; body: string | null; error: string | null; manual: boolean; created_at: string; sent_at: string | null; meta: { ids?: string[]; pen?: string } | null };
type AdminTake = LiveTake & { day: string };
type Status = { slack: boolean; ai: boolean; aiError?: string | null; secret: boolean } | null;

const KIND_LABEL: Record<string, string> = { debrief: 'Débrief', extra: 'Prolongations', reminder: 'Rappel Takes', test: 'Test' };
const STATUS_LABEL: Record<string, string> = { sent: 'Envoyé', failed: 'Échec', skipped: 'Non envoyé', pending: 'En cours' };
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const TONES: { k: AppSettings['bot_tone']; label: string; desc: string }[] = [
  { k: 'sobre', label: 'Sobre', desc: 'Résumé bienveillant, aucune moquerie nominative. Pour les périodes tendues.' },
  { k: 'taquin', label: 'Taquin', desc: 'Le ton par défaut : ironie et chambrage léger, la lanterne rouge est citée.' },
  { k: 'piquant', label: 'Piquant', desc: 'Plus mordant, toujours bon enfant. À réserver aux bonnes semaines.' },
];

export function Admin() {
  const { admin, live, me } = useAuth();
  const store = useStore();
  const { settings, loaded, reload } = useSettings();
  const [local, setLocal] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<Date | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [takes, setTakes] = useState<AdminTake[]>([]);

  useEffect(() => { if (loaded) setLocal(settings); }, [loaded, settings]);

  const loadAll = useCallback(async () => {
    if (!live) { setStatusErr('Aperçu : pas de connexion au serveur'); return; }
    const sb = (await getSupabase())!;
    const since = dayKey(new Date(Date.now() - 14 * 864e5));
    const [lg, st, tk] = await Promise.all([
      sb.from('bot_log').select('*').order('id', { ascending: false }).limit(30),
      sb.from('bot_state').select('last_tick').maybeSingle(),
      sb.from('takes').select('id, day, raw_text, rule, rule_label, probability, points_if_won, status, revealed, author:players(name)').eq('revealed', true).gte('day', since).order('day', { ascending: false }),
    ]);
    setLogs((lg.data ?? []) as LogRow[]);
    setLastTick(st.data?.last_tick ? new Date(st.data.last_tick) : null);
    setTakes((tk.data ?? []).map((t) => ({
      id: t.id, day: t.day, author: (t.author as unknown as { name: string } | null)?.name ?? '?', text: t.raw_text, rule: t.rule, label: t.rule_label,
      probability: t.probability, points: t.points_if_won, status: t.status, revealed: t.revealed,
    })));
    callBot<{ slack: boolean; ai: boolean; aiError?: string | null; secret: boolean; error?: string }>({ action: 'status' })
      .then((r) => { if (r.error) setStatusErr(r.error); else setStatus(r); })
      .catch(() => setStatusErr('Fonction serveur injoignable (déploiement Vercel en cours ?)'));
  }, [live]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const set = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocal((s) => ({ ...s, [key]: value }));
    setErr(null);
    if (!live) { setSaved('Aperçu : non enregistré'); return; }
    const { error } = await (await getSupabase())!.rpc('admin_set_setting', { p_key: key, p_value: value });
    if (error) { setErr(error.message); reload(); return; }
    setSaved('Enregistré'); setTimeout(() => setSaved(null), 1600);
  };

  if (!admin) return <div className="page"><header className="page-head"><h1>Back-office</h1></header><Panel><p className="muted" style={{ margin: 0 }}>Réservé aux admins.</p></Panel></div>;

  const tickAge = lastTick ? Math.round((Date.now() - lastTick.getTime()) / 60000) : null;
  const allPlayers = store.activeNames;

  return (
    <div className="page admin">
      <header className="page-head">
        <h1>Back-office</h1>
        <p className="muted" style={{ margin: 0 }}>Le contrôle des messages automatiques et des Takes. Chaque réglage s'applique immédiatement.</p>
      </header>
      {!live && <p className="hint">Aperçu de démonstration : les réglages ne sont pas enregistrés.</p>}
      <div className="admin-toast" role="status" aria-live="polite">{err ? <span className="bad">{err}</span> : saved}</div>

      <div className="admin-status">
        <Chip ok={tickAge !== null && tickAge <= 3} label="Planificateur" value={tickAge === null ? 'jamais lancé' : tickAge <= 1 ? 'actif' : `dernier passage il y a ${tickAge} min`} />
        <Chip ok={status?.slack} label="Slack" value={status ? (status.slack ? 'branché' : 'webhook manquant') : statusErr ? '?' : '…'} />
        <Chip ok={status?.secret} label="Secret du bot" value={status ? (status.secret ? 'valide' : 'à recopier dans Vercel') : statusErr ? '?' : '…'} />
        <Chip ok={status?.ai} label="IA" value={status ? (status.ai ? 'branchée' : !status.aiError || status.aiError === 'clé absente' ? 'clé absente' : 'en erreur') : statusErr ? '?' : '…'} />
        {status && !status.ai && status.aiError && status.aiError !== 'clé absente' && <span className="hint">IA (Gemini) : {status.aiError}</span>}
        {statusErr && <span className="hint">{statusErr}</span>}
      </div>

      <Panel hud={local.bot_paused ? 'red' : 'cyan'} title="Interrupteur général" className={local.bot_paused ? 'admin-paused' : ''}>
        <div className="stack">
          <Toggle on={!local.bot_paused} onChange={(v) => set('bot_paused', !v)} label={local.bot_paused ? 'Messages Slack en pause' : 'Messages Slack actifs'}
            desc="La pause coupe tous les envois (débriefs, rappels). L'app, les stats et la révélation des Takes continuent normalement." />
          {local.bot_paused && (
            <label className="field"><span>Motif (pour mémoire, non publié)</span>
              <input id="pause-reason" type="text" maxLength={120} defaultValue={local.bot_pause_reason} placeholder="Ex. fin de trimestre chargée" onBlur={(e) => e.target.value !== local.bot_pause_reason && set('bot_pause_reason', e.target.value)} />
            </label>
          )}
          <div className="field"><span>Jours d'envoi</span>
            <div className="seg" role="group" aria-label="Jours d'envoi">
              {DAYS.map((d, i) => {
                const iso = i + 1, on = local.bot_days.includes(iso);
                return <button key={i} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set('bot_days', on ? local.bot_days.filter((x) => x !== iso) : [...local.bot_days, iso].sort())}>{d}</button>;
              })}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-2">
        <Panel hud="purple" title="Ton du bot">
          <div className="stack">
            <div className="tone-grid" role="radiogroup" aria-label="Ton">
              {TONES.map((t) => (
                <button key={t.k} type="button" role="radio" aria-checked={local.bot_tone === t.k} className={`tone-card ${local.bot_tone === t.k ? 'on' : ''}`} onClick={() => set('bot_tone', t.k)}>
                  <b>{t.label}</b><span className="muted">{t.desc}</span>
                </button>
              ))}
            </div>
            <div className="field"><span>Pilotes jamais chambrés nommément</span>
              <div className="chips">
                {allPlayers.map((n) => {
                  const on = local.roast_optout.includes(n);
                  return <button key={n} type="button" className="chip" aria-pressed={!on} onClick={() => set('roast_optout', on ? local.roast_optout.filter((x) => x !== n) : [...local.roast_optout, n])}><span className="dot" style={{ background: store.player(n).color }} />{store.player(n).displayName ?? n}{on ? ' · protégé' : ''}</button>;
                })}
              </div>
            </div>
            <span className="hint">Un pilote protégé peut être félicité, jamais moqué (lanterne rouge, séries de 4e places).</span>
          </div>
        </Panel>

        <Panel hud="yellow" title="Débrief de fin de session">
          <div className="stack">
            <Toggle on={local.debrief_enabled} onChange={(v) => set('debrief_enabled', v)} label="Débrief automatique" desc="Envoyé après la dernière course du jour, ou dès qu'un pilote clôture la session." />
            <label className="field inline"><span>Délai après la dernière course</span>
              <input id="delay" type="number" min={3} max={60} value={local.debrief_delay_min} onChange={(e) => set('debrief_delay_min', Math.max(3, Math.min(60, Number(e.target.value) || 7)))} /> <span className="hint">min</span>
            </label>
            <Toggle on={local.debrief_takes} onChange={(v) => set('debrief_takes', v)} label="Inclure les Takes" desc="Honorés et ratés, avec la phrase de chaque pilote." />
            <Toggle on={local.ai_pen} onChange={(v) => set('ai_pen', v)} disabled={status !== null && !status.ai} label="Plume IA" desc={status && !status.ai ? 'Disponible quand la clé Gemini (GEMINI_API_KEY) répond dans Vercel.' : 'Un récit inédit à chaque session ; la bibliothèque reprend la main en cas de souci.'} />
          </div>
        </Panel>

        <Panel hud="purple" title="Takes et rappel de midi">
          <div className="stack">
            <Toggle on={local.takes_enabled} onChange={(v) => set('takes_enabled', v)} label="Takes ouverts" desc="Désactivés, la page Takes reste visible mais on ne peut plus en poser." />
            <label className="field inline"><span>Clôture des Takes</span>
              <input id="deadline" type="time" value={local.takes_deadline} onChange={(e) => e.target.value && set('takes_deadline', e.target.value)} />
            </label>
            <Toggle on={local.reminder_enabled} onChange={(v) => set('reminder_enabled', v)} label="Rappel sur Slack" desc="Invite les pilotes à poser leur Take." />
            <label className="field inline"><span>Heure du rappel</span>
              <input id="reminder" type="time" value={local.reminder_time} onChange={(e) => e.target.value && set('reminder_time', e.target.value)} />
            </label>
            {local.reminder_time >= local.takes_deadline && <span className="form-msg">Le rappel doit partir avant la clôture ({fmtHour(local.takes_deadline)}).</span>}
          </div>
        </Panel>

        <Composer settings={local} logs={logs} onSent={loadAll} />
      </div>

      <TakesReview takes={takes} onChange={loadAll} />

      <Panel title="Journal des envois" aside={<button className="btn btn-sm" onClick={loadAll}>Actualiser</button>}>
        {logs.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucun message pour l'instant.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Type</th><th>Statut</th><th>Détail</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtShort(l.day)} {new Date(l.sent_at ?? l.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{KIND_LABEL[l.kind] ?? l.kind}{l.manual ? ' · manuel' : ''}{l.meta?.pen === 'ai' ? ' · IA' : ''}</td>
                    <td><span className={`log-status ${l.status}`}>{STATUS_LABEL[l.status] ?? l.status}</span></td>
                    <td className="log-detail">{l.error ?? (l.status === 'skipped' && !l.body ? 'Pause active ou rien à envoyer' : '')}
                      {l.body && <details><summary>Voir le message</summary><SlackText text={l.body} /></details>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <HiddenPanel onError={setErr} onSaved={(m) => { setSaved(m); setTimeout(() => setSaved(null), 2000); }} />

      <MembersPanel onError={setErr} onSaved={(m) => { setSaved(m); setTimeout(() => setSaved(null), 2000); }} />
    </div>
  );
}

function Chip({ ok, label, value }: { ok?: boolean; label: string; value: string }) {
  return <span className={`admin-chip ${ok ? 'ok' : ok === false ? 'ko' : ''}`}><b>{label}</b>{value}</span>;
}

function Toggle({ on, onChange, label, desc, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><i /></span>
      <span className="toggle-text"><b>{label}</b>{desc && <span className="hint">{desc}</span>}</span>
    </label>
  );
}

/** Rendu simplifié du mrkdwn Slack : *gras*, _italique_, liens. */
export function SlackText({ text }: { text: string }) {
  const render = (line: string) => line.split(/(\*[^*]+\*|_[^_]+_|https?:\/\/\S+)/g).map((p, i) =>
    /^\*[^*]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b>
      : /^_[^_]+_$/.test(p) ? <i key={i}>{p.slice(1, -1)}</i>
        : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\//, '')}</a> : <Fragment key={i}>{p}</Fragment>);
  return <div className="slack-text">{text.split('\n').map((l, i) => <p key={i}>{l ? render(l) : ' '}</p>)}</div>;
}

function Composer({ settings, logs, onSent }: { settings: AppSettings; logs: LogRow[]; onSent: () => void }) {
  const { live } = useAuth();
  const { dayList, races, elo, player } = useStore();
  const today = dayKey(new Date());
  const days = useMemo(() => [...new Set([today, ...[...dayList].reverse().slice(0, 15)])], [dayList, today]);
  const [kind, setKind] = useState<'debrief' | 'extra' | 'reminder' | 'test'>('debrief');
  const [day, setDay] = useState(dayList.at(-1) ?? today);
  const [salt, setSalt] = useState(0);
  const [takes, setTakes] = useState<LiveTake[]>([]);
  const [posted, setPosted] = useState<string[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    (async () => {
      const sb = (await getSupabase())!;
      const [t, n] = await Promise.all([
        sb.from('takes').select('id, raw_text, rule, rule_label, probability, points_if_won, status, revealed, author:players(name)').eq('day', day).eq('revealed', true),
        sb.rpc('takes_posted_names', { on_day: day }),
      ]);
      setTakes((t.data ?? []).map((x) => ({ id: x.id, author: (x.author as unknown as { name: string } | null)?.name ?? '?', text: x.raw_text, rule: x.rule, label: x.rule_label, probability: x.probability, points: x.points_if_won, status: x.status, revealed: true })));
      setPosted(((n.data ?? []) as { name: string }[]).map((x) => x.name));
    })();
  }, [day, live]);
  useEffect(() => { setServer(null); setConfirm(false); setMsg(null); }, [kind, day, salt, settings]);

  const opts: BotOptions = {
    tone: settings.bot_tone, appUrl: settings.app_url.replace(/\/$/, ''), label: (n) => player(n).displayName ?? n,
    optout: settings.roast_optout, recent: logs.flatMap((l) => l.meta?.ids ?? []), includeTakes: settings.debrief_takes && settings.takes_enabled,
    salt: salt ? String(salt) : undefined,
  };
  const local: SlackMessage | null = useMemo(() => {
    if (kind === 'test') return buildTest(opts);
    if (kind === 'reminder') return buildReminder({ day, deadline: fmtHour(settings.takes_deadline), posted }, opts);
    const f = sessionFacts(day, races, elo, takes);
    if (!f) return null;
    return kind === 'extra' ? buildExtra(f, opts) : buildDebrief(f, opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, day, salt, settings, races, elo, takes, posted, logs]);

  const aiPreview = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await callBot<{ ok: boolean; text?: string; error?: string }>({ action: 'preview', kind, day, salt: String(salt) });
      if (r.ok && r.text) setServer(r.text); else setMsg(r.error ?? 'Aperçu impossible');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const send = async () => {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setMsg(null); setConfirm(false);
    try {
      const r = await callBot<{ ok: boolean; error?: string }>({ action: 'send', kind, day });
      setMsg(r.ok ? 'Message envoyé sur Slack.' : `Échec : ${r.error}`);
      onSent();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Panel hud="cyan" title="Aperçu et envoi manuel">
      <div className="stack">
        <div className="builder">
          <label className="field"><span>Message</span>
            <select id="compose-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="debrief">Débrief</option><option value="reminder">Rappel Takes</option><option value="extra">Prolongations</option><option value="test">Test de connexion</option>
            </select>
          </label>
          {kind !== 'test' && (
            <label className="field"><span>Session</span>
              <select id="compose-day" value={day} onChange={(e) => setDay(e.target.value)}>{days.map((d) => <option key={d} value={d}>{fmtDay(d, false)}</option>)}</select>
            </label>
          )}
        </div>
        <div className="slack-preview">
          <div className="slack-head"><span className="slack-avatar" aria-hidden="true">PC</span><b>Pits Club</b><span className="hint">APP</span>{server && <span className="hint">· version serveur{settings.ai_pen ? ' (IA)' : ''}</span>}</div>
          {server ? <SlackText text={server} /> : local ? <SlackText text={local.text} /> : <p className="hint">Pas de course ce jour-là.</p>}
        </div>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => setSalt((s) => s + 1)}>Autre version</button>
          {live && settings.ai_pen && kind === 'debrief' && <button className="btn btn-sm" onClick={aiPreview} disabled={busy}>Aperçu plume IA</button>}
          {live && <button className={`btn ${confirm ? 'btn-flag' : 'btn-primary'}`} onClick={send} disabled={busy || (!local && kind !== 'test')}>{busy ? 'Envoi…' : confirm ? 'Confirmer l\'envoi sur Slack' : 'Envoyer sur Slack'}</button>}
        </div>
        <span className="hint">L'aperçu suit le ton et les exclusions réglés ici. L'envoi part tout de suite dans le canal, avec une nouvelle rédaction{settings.ai_pen ? ' (plume IA si disponible)' : ''}.</span>
        {msg && <p className="form-msg">{msg}</p>}
      </div>
    </Panel>
  );
}

function TakesReview({ takes, onChange }: { takes: AdminTake[]; onChange: () => void }) {
  const { live } = useAuth();
  const { byDay } = useStore();
  const [err, setErr] = useState<string | null>(null);
  const today = dayKey(new Date());
  const setStatus = async (id: string, status: string) => {
    const { error } = await (await getSupabase())!.rpc('admin_set_take_status', { p_id: id, p_status: status });
    if (error) setErr(error.message); else onChange();
  };
  const reveal = async () => {
    const { error } = await (await getSupabase())!.rpc('admin_reveal_takes', { p_day: today });
    if (error) setErr(error.message); else onChange();
  };
  const VERD: Record<TakeVerdict, string> = { won: 'Honoré', lost: 'Raté', void: 'Annulé', manual: 'À arbitrer' };
  const toArbitrate = takes.filter((t) => takeVerdict(t, byDay.get(t.day) ?? []) === 'manual').length;
  return (
    <Panel hud="purple" title="Arbitrage des Takes" aside={live ? <button className="btn btn-sm" onClick={reveal}>Révéler les Takes du jour</button> : undefined}>
      <div className="stack">
        <span className="hint">Takes révélés des 14 derniers jours. « Auto » laisse le calcul décider ; un verdict forcé l'emporte.{toArbitrate ? ` ${toArbitrate} Take${toArbitrate > 1 ? 's' : ''} attend${toArbitrate > 1 ? 'ent' : ''} ton arbitrage.` : ''}</span>
        {takes.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucun Take révélé récemment.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Jour</th><th>Pilote</th><th>Take</th><th>Calcul</th><th>Verdict</th></tr></thead>
              <tbody>
                {takes.map((t) => {
                  const auto = takeVerdict({ ...t, status: 'pending' }, byDay.get(t.day) ?? []);
                  return (
                    <tr key={t.id} className={auto === 'manual' && t.status === 'pending' ? 'needs-review' : ''}>
                      <td className="num">{fmtShort(t.day)}</td>
                      <td><PlayerTag name={t.author} size={24} /></td>
                      <td><span className="take-text">« {t.text} »</span>{t.rule && <span className="take-rule" style={{ display: 'block' }}>{ruleLabel(t.rule)}</span>}</td>
                      <td>{VERD[auto]}</td>
                      <td>
                        <select aria-label={`Verdict du Take de ${t.author}`} value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}>
                          <option value="pending">{auto === 'manual' ? 'À arbitrer' : 'Auto'}</option><option value="won">Honoré</option><option value="lost">Raté</option><option value="void">Annulé</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {err && <p className="form-msg">{err}</p>}
      </div>
    </Panel>
  );
}


type Member = { user_id: string; email: string | null; player: string | null; display_name: string | null; visitor: boolean; admin: boolean; banned: boolean; ban_reason: string | null; created_at: string; last_sign_in_at: string | null };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '–');

/** Membres inscrits : rôle admin, bannissement, déliaison du pilote. */
function MembersPanel({ onError, onSaved }: { onError: (m: string) => void; onSaved: (m: string) => void }) {
  const { live, session } = useAuth();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<{ id: string; action: 'ban' | 'unlink' } | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!live) { setRows([]); return; }
    const { data, error } = await (await getSupabase())!.rpc('admin_members');
    if (error) { setMissing(/admin_members|function/i.test(error.message)); setRows([]); return; }
    setRows((data ?? []) as Member[]);
  }, [live]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await (await getSupabase())!.rpc(fn, args);
    setPending(null); setReason('');
    if (error) onError(error.message); else { onSaved(ok); load(); }
  };

  const label = (m: Member) => m.player ? (m.display_name ? `${m.display_name} (${m.player})` : m.player) : m.visitor ? 'Visiteur' : 'Sans profil';
  const active = rows?.filter((m) => !m.banned).length ?? 0;
  const banned = rows?.filter((m) => m.banned).length ?? 0;

  return (
    <Panel title="Membres" aside={rows ? <span className="hint">{active} actif{active > 1 ? 's' : ''}{banned ? ` · ${banned} banni${banned > 1 ? 's' : ''}` : ''}</span> : undefined}>
      <div className="stack">
        <span className="hint">Un membre banni ne voit plus rien de l'app et ne peut plus rien modifier ; ses courses restent dans les stats. « Délier » libère le pilote choisi à l'inscription (en cas d'erreur). Seuls les admins voient le back-office.</span>
        {missing && <p className="form-msg" style={{ margin: 0 }}>Lance le script 007_bans.sql dans Supabase pour activer la gestion des membres.</p>}
        {!live && <p className="hint" style={{ margin: 0 }}>Aperçu : la liste des membres n'est disponible que sur Pits Club.</p>}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table members">
              <thead><tr><th>Membre</th><th>Profil</th><th className="hide-sm">Inscrit</th><th className="hide-sm">Vu</th><th>Admin</th><th>Accès</th></tr></thead>
              <tbody>
                {rows.map((m) => {
                  const self = m.user_id === session?.user.id;
                  const isPending = pending?.id === m.user_id;
                  return (
                    <tr key={m.user_id} className={m.banned ? 'is-banned' : ''}>
                      <td><span className="member-mail">{m.email ?? '–'}</span>{self && <span className="hint"> · toi</span>}</td>
                      <td>{m.player ? <PlayerTag name={m.player} size={22} /> : <span className="muted">{label(m)}</span>}</td>
                      <td className="hide-sm num">{fmtDate(m.created_at)}</td>
                      <td className="hide-sm num">{fmtDate(m.last_sign_in_at)}</td>
                      <td>
                        <label className="toggle mini" title={self ? 'Tu ne peux pas te retirer ce rôle' : ''}>
                          <input type="checkbox" role="switch" checked={m.admin} disabled={self || m.banned}
                            onChange={(e) => run('admin_set_role', { p_user: m.user_id, p_admin: e.target.checked }, e.target.checked ? `${label(m)} est admin` : `${label(m)} n'est plus admin`)} />
                          <span className="toggle-track" aria-hidden="true"><i /></span>
                          <span className="sr-only">Admin</span>
                        </label>
                      </td>
                      <td>
                        {isPending && pending.action === 'ban' ? (
                          <div className="member-confirm">
                            <input type="text" maxLength={120} placeholder="Motif (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motif du bannissement" />
                            <button className="btn btn-sm btn-flag" onClick={() => run('admin_ban', { p_user: m.user_id, p_reason: reason }, `${m.email ?? 'Membre'} banni`)}>Confirmer</button>
                            <button className="btn btn-sm" onClick={() => setPending(null)}>Annuler</button>
                          </div>
                        ) : isPending && pending.action === 'unlink' ? (
                          <div className="member-confirm">
                            <span className="hint">Libérer {m.player} ?</span>
                            <button className="btn btn-sm btn-flag" onClick={() => run('admin_unlink', { p_user: m.user_id }, `${m.player} est de nouveau libre`)}>Confirmer</button>
                            <button className="btn btn-sm" onClick={() => setPending(null)}>Annuler</button>
                          </div>
                        ) : m.banned ? (
                          <div className="member-confirm">
                            <span className="log-status failed">Banni</span>{m.ban_reason && <span className="hint">{m.ban_reason}</span>}
                            <button className="btn btn-sm" onClick={() => run('admin_unban', { p_user: m.user_id }, `${m.email ?? 'Membre'} réactivé`)}>Réactiver</button>
                          </div>
                        ) : (
                          <div className="member-confirm">
                            <button className="btn btn-sm" disabled={self || m.admin} title={m.admin ? 'Retire d\'abord son rôle d\'admin' : ''} onClick={() => { setPending({ id: m.user_id, action: 'ban' }); setReason(''); }}>Bannir</button>
                            {m.player && <button className="btn btn-sm" disabled={self} onClick={() => setPending({ id: m.user_id, action: 'unlink' })}>Délier</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows === null && <p className="hint" style={{ margin: 0 }}>Chargement…</p>}
        <span className="hint">Les inscriptions restent ouvertes : une personne bannie peut recréer un compte avec une autre adresse, qu'il suffira de bannir à son tour.</span>
      </div>
    </Panel>
  );
}

/** Pilotes effacés de l'app : ils n'apparaissent plus nulle part, leurs courses restent pour les stats des autres. */
function HiddenPanel({ onError, onSaved }: { onError: (m: string) => void; onSaved: (m: string) => void }) {
  const { live } = useAuth();
  const { activeNames, lastSeen, reload } = useStore();
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(async () => {
    if (!live) { setHidden(['Auguste', 'Baptiste', 'Eva', 'Genevieve']); return; }
    const { data } = await (await getSupabase())!.from('players').select('*').order('name');
    setHidden(((data ?? []) as { name: string; hidden?: boolean }[]).filter((p) => p.hidden).map((p) => p.name));
  }, [live]);
  useEffect(() => { load(); }, [load]);
  const set = async (name: string, on: boolean) => {
    if (!live) return;
    const { error } = await (await getSupabase())!.rpc('admin_set_hidden', { p_player: name, p_hidden: on });
    setConfirm(false); setPick('');
    if (error) onError(/admin_set_hidden|function/i.test(error.message) ? 'Lance le script 008_hidden_players.sql dans Supabase.' : error.message);
    else { onSaved(on ? `${name} effacé de l'app` : `${name} restauré`); load(); reload(); }
  };
  const candidates = [...lastSeen.keys()].filter((n) => n !== 'Other' && !(hidden ?? []).includes(n)).sort((a, b) => Number(activeNames.includes(a)) - Number(activeNames.includes(b)) || a.localeCompare(b));
  return (
    <Panel title="Pilotes effacés" aside={hidden ? <span className="hint">{hidden.length}</span> : undefined}>
      <div className="stack">
        <span className="hint">Un pilote effacé disparaît de toute l'app : classements, fiches, face-à-face, trophées, records, choix à l'inscription. Dans l'historique des sessions, sa place apparaît comme « Ancien joueur ». Ses courses restent dans les calculs, pour que les stats et les cotes des autres ne changent pas.</span>
        <div className="chips">
          {(hidden ?? []).map((n) => (
            <span key={n} className="chip" style={{ cursor: 'default' }}>{n}<button type="button" className="linkbtn" onClick={() => set(n, false)}>Restaurer</button></span>
          ))}
          {hidden?.length === 0 && <span className="hint">Aucun pilote effacé.</span>}
        </div>
        <div className="btn-row">
          <select aria-label="Pilote à effacer" value={pick} onChange={(e) => { setPick(e.target.value); setConfirm(false); }}>
            <option value="">Effacer un pilote…</option>
            {candidates.map((n) => <option key={n} value={n}>{n}{activeNames.includes(n) ? ' (actif)' : ''}</option>)}
          </select>
          {pick && <button className={`btn btn-sm ${confirm ? 'btn-flag' : ''}`} onClick={() => (confirm ? set(pick, true) : setConfirm(true))}>{confirm ? `Confirmer : effacer ${pick}` : 'Effacer'}</button>}
        </div>
      </div>
    </Panel>
  );
}
