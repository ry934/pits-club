import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { Avatar, Empty, Panel, PlayerTag, Section } from '../components/ui';
import { Countdown } from './Paddock';
import { LiveTake, takeVerdict, TakeValidation, TakeVerdict } from '../lib/bot/facts';
import { callBot, fmtHour, todayAt, useSettings } from '../lib/settings';
import { dayKey, fmtDay } from '../lib/stats';
import { getSupabase } from '../lib/supabase';
import { estimateProbability, pointsFor, ruleLabel, TakeRule } from '../lib/takes';
import { useStore } from '../store';

type Row = LiveTake & { day: string; aiValidation: TakeValidation; adminValidation: TakeValidation | null; note: string | null };
/** Résultat d'une analyse refusée ou impossible : le pilote choisit de reformuler ou de valider quand même. */
type Blocked = { text: string; reason: string; unavailable: boolean };

const TAKE_COLS = 'id, day, raw_text, rule, rule_label, probability, points_if_won, status, revealed, validation, admin_validation, validation_note, author:players(name)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRow = (t: any): Row => ({
  id: t.id, day: t.day, author: (t.author as { name: string } | null)?.name ?? '?', text: t.raw_text, rule: t.rule, label: t.rule_label,
  probability: t.probability, points: t.points_if_won, status: t.status, revealed: t.revealed,
  validation: (t.admin_validation ?? t.validation ?? 'validated') as TakeValidation,
  aiValidation: (t.validation ?? 'validated') as TakeValidation, adminValidation: t.admin_validation ?? null, note: t.validation_note ?? null,
});

const VERDICT: Record<TakeVerdict, string> = { won: 'Honoré', lost: 'Raté', void: 'Annulé', manual: 'À arbitrer' };
/** Libellé du verdict ; un Take refusé (IA ou admin) s'affiche « Refusé » plutôt qu'« Annulé ». */
const verdictLabel = (t: LiveTake, v: TakeVerdict) => (v === 'void' && t.status === 'pending' && t.validation === 'refused' ? 'Refusé' : VERDICT[v]);

/** Takes réels : texte libre, traduit en règle vérifiable par l'IA, scellé jusqu'à la fin de la session. */
export function TakesLive() {
  const { me } = useAuth();
  const { byDay, dayList, elo, races, closedDays, player } = useStore();
  const { settings } = useSettings();
  const today = dayKey(new Date());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [posted, setPosted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = (await getSupabase())!;
    const since = dayKey(new Date(Date.now() - 60 * 864e5));
    const [{ data, error: e }, names] = await Promise.all([
      sb.from('takes').select(TAKE_COLS).gte('day', since).order('day', { ascending: false }),
      sb.rpc('takes_posted_names', { on_day: today }),
    ]);
    if (e) { setError(e.message); setRows([]); return; }
    setRows((data ?? []).map(toRow));
    setPosted(((names.data ?? []) as { name: string }[]).map((n) => n.name));
  }, [today]);
  // recharge quand une course arrive ou que la session se termine (révélation)
  useEffect(() => { load(); }, [load, races.length, closedDays.size]);

  const deadline = todayAt(settings.takes_deadline);
  const sessionStarted = byDay.has(today);
  const mine = rows?.find((r) => r.day === today && r.author === me) ?? null;
  const revealedToday = rows?.some((r) => r.day === today && r.revealed) ?? false;
  const open = settings.takes_enabled && !!me && new Date() < deadline && !sessionStarted && !mine?.revealed && !revealedToday;
  const todayRaces = byDay.get(today) ?? [];
  const todayRows = rows?.filter((r) => r.day === today && r.revealed) ?? [];
  const sealed = posted.filter((n) => n !== me && !todayRows.some((r) => r.author === n));

  // contexte de la cote : présents de la dernière session et nombre moyen de courses
  const lastDay = dayList.at(-1);
  const lineup = useMemo(() => [...new Set((lastDay ? byDay.get(lastDay)! : []).flatMap((r) => r.p))].filter((p) => p !== 'Other'), [lastDay, byDay]);
  const avgRaces = useMemo(() => { const d = dayList.slice(-20); return d.length ? d.reduce((s, x) => s + byDay.get(x)!.length, 0) / d.length : 12; }, [dayList, byDay]);

  // classement des pronostiqueurs sur 30 jours (Takes révélés)
  const board = useMemo(() => {
    const from = dayKey(new Date(Date.now() - 30 * 864e5));
    const m = new Map<string, { name: string; points: number; won: number; played: number; recent: TakeVerdict[] }>();
    for (const r of [...(rows ?? [])].reverse()) {
      if (!r.revealed || r.day < from) continue;
      const v = takeVerdict(r, byDay.get(r.day) ?? []);
      if (v === 'manual' || v === 'void') continue;
      const e = m.get(r.author) ?? { name: r.author, points: 0, won: 0, played: 0, recent: [] };
      e.played++; if (v === 'won') { e.won++; e.points += r.points ?? 10; }
      e.recent = [...e.recent, v].slice(-8);
      m.set(r.author, e);
    }
    return [...m.values()].sort((a, b) => b.points - a.points || b.won - a.won);
  }, [rows, byDay]);

  const history = useMemo(() => {
    const days = [...new Set((rows ?? []).filter((r) => r.revealed && r.day !== today).map((r) => r.day))].slice(0, 5);
    return days.map((d) => ({ day: d, items: rows!.filter((r) => r.day === d && r.revealed) }));
  }, [rows, today]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Prediction arena</h1>
        <p className="muted" style={{ margin: 0 }}>Un Take par pilote et par jour. Écris-le, valide-le, modifie-le autant que tu veux jusqu'à {fmtHour(settings.takes_deadline)} : il est ensuite verrouillé et scellé jusqu'à la fin de la session.</p>
      </header>
      {error && <p className="form-msg">{error}</p>}

      <div className="grid grid-paddock">
        <div className="stack">
          {!me ? (
            <Panel hud="purple" title="Mon Take"><p className="muted" style={{ margin: 0 }}>Les Takes sont réservés aux pilotes. Tu peux suivre leur révélation après chaque session.</p></Panel>
          ) : !settings.takes_enabled ? (
            <Panel hud="purple" title="Mon Take"><p className="muted" style={{ margin: 0 }}>Les Takes sont en pause pour le moment.</p></Panel>
          ) : (
            <MyTake key={rows === null ? 'loading' : 'take'} mine={mine} open={open} onSaved={load} lineup={lineup} avgRaces={avgRaces}
              deadline={fmtHour(settings.takes_deadline)}
              closedReason={sessionStarted ? 'La session a commencé : les Takes sont verrouillés.' : `Les Takes sont verrouillés depuis ${fmtHour(settings.takes_deadline)}. Rendez-vous demain matin.`}
              verdict={mine?.revealed ? takeVerdict(mine, todayRaces) : null} ratings={elo.rating} />
          )}

          <Section title={`Takes du ${fmtDay(today, false)}`} aside={<span className="hint">{posted.length} Take{posted.length > 1 ? 's' : ''} posé{posted.length > 1 ? 's' : ''}</span>}>
            {rows === null ? <p className="hint">Chargement…</p> : posted.length === 0 && !todayRows.length ? (
              <Empty>Aucun Take pour l'instant.</Empty>
            ) : (
              <div className="reveal-grid">
                {sealed.map((n) => (
                  <div key={n} className="take-card sealed">
                    <PlayerTag name={n} />
                    <span className="muted">Take scellé. Révélation à la fin de la session.</span>
                    <div className="take-foot"><span className="outcome pending">Scellé</span></div>
                  </div>
                ))}
                {todayRows.map((t, i) => <TakeCard key={t.id} t={t} verdict={takeVerdict(t, todayRaces)} delay={i * 0.15} />)}
              </div>
            )}
          </Section>

          {history.length > 0 && (
            <Section title="Takes précédents">
              <div className="stack">
                {history.map((h) => (
                  <Panel key={h.day} title={fmtDay(h.day, false)}>
                    <ul className="take-list">
                      {h.items.map((t) => {
                        const v = takeVerdict(t, byDay.get(h.day) ?? []);
                        return (
                          <li key={t.id}>
                            <PlayerTag name={t.author} size={24} />
                            <span className="take-text">« {t.text} »</span>
                            <span className={`outcome ${v === 'manual' ? 'pending' : v}`}>{verdictLabel(t, v)}{v === 'won' && t.points ? ` +${t.points}` : ''}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </Panel>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="stack">
          <Panel hud="purple" title="Clôture des Takes" className="glow-edge">
            <div className="stack">
              {open ? (
                <>
                  <span className="muted">Verrouillage aujourd'hui à {fmtHour(settings.takes_deadline)} (ou au départ de la première course)</span>
                  <Countdown to={deadline} />
                </>
              ) : <span className="muted">{revealedToday ? 'Les Takes du jour sont révélés.' : sessionStarted ? 'Session en cours : les Takes sont verrouillés.' : `Verrouillés. Réouverture demain matin, jusqu'à ${fmtHour(settings.takes_deadline)}.`}</span>}
              <span className="hint">« Valider » fait analyser ton Take par l'IA, qui le traduit en règle vérifiable. Un brouillon jamais validé est analysé automatiquement au verrouillage. Les points dépendent de la difficulté : 10 ÷ probabilité, plafonné à 100.</span>
            </div>
          </Panel>

          <Panel hud="yellow" title="Classement des pronostiqueurs" aside={<span className="hint">30 derniers jours</span>}>
            {board.length === 0 ? <Empty>Pas encore de Takes résolus.</Empty> : (
              <ol className="feed">
                {board.map((l, i) => (
                  <li key={l.name} style={{ gridTemplateColumns: '28px 1fr auto' }}>
                    <span className={`num ${i === 0 ? 'gold' : 'muted'}`}>{i + 1}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar name={l.name} size={28} />
                      <span style={{ minWidth: 0 }}><b>{player(l.name).displayName ?? l.name}</b><span className="sub-num">{Math.round((l.won / l.played) * 100)} % de réussite · {l.won}/{l.played}</span></span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <b className={`num ${i === 0 ? 'gold' : ''}`}>{l.points} pts</b>
                      <span className="form-chips" aria-label="Derniers Takes">{l.recent.map((o, k) => <i key={k} style={{ background: o === 'won' ? 'var(--green)' : 'var(--red)' }} />)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TakeCard({ t, verdict, delay }: { t: Row; verdict: TakeVerdict; delay: number }) {
  return (
    <div className={`take-card flip ${verdict === 'manual' ? '' : verdict}`} style={{ animationDelay: `${delay}s` }}>
      <PlayerTag name={t.author} />
      <span className="take-text">« {t.text} »</span>
      {t.rule && <span className="take-rule">{ruleLabel(t.rule)}</span>}
      <div className="take-foot">
        <span className="hint num">{t.probability != null ? `${Math.round(t.probability * 100)} % · ${t.points} pts` : 'arbitrage manuel'}</span>
        <span className={`outcome ${verdict === 'manual' ? 'pending' : verdict}`}>{verdictLabel(t, verdict)}{verdict === 'won' && t.points ? ` +${t.points}` : ''}</span>
      </div>
    </div>
  );
}

const VALIDATION: Record<TakeValidation, string> = { draft: 'Brouillon', validated: 'Take validée', refused: 'Refusée' };

function MyTake({ mine, open, onSaved, lineup, avgRaces, deadline, closedReason, verdict, ratings }: {
  mine: Row | null; open: boolean; onSaved: () => void; lineup: string[]; avgRaces: number; deadline: string; closedReason: string;
  verdict: TakeVerdict | null; ratings: Map<string, number>;
}) {
  const [editing, setEditing] = useState(!mine || mine.validation === 'draft');
  const [text, setText] = useState(mine?.text ?? '');
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [busy, setBusy] = useState<'validate' | 'save' | 'manual' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sb = async () => (await getSupabase())!;
  const odds = (rule: TakeRule) => {
    const p = estimateProbability(rule, lineup, ratings, avgRaces, 1500, 7);
    return { p_probability: Math.round(p * 1000) / 1000, p_points: pointsFor(p) };
  };

  /** Enregistre le texte sans le valider (brouillon). */
  const saveDraft = async () => {
    setBusy('save'); setMsg(null); setBlocked(null);
    const { error } = await (await sb()).rpc('save_take_draft', { p_text: text });
    setBusy(null);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: `Brouillon enregistré. Pense à le valider avant ${deadline}, sinon l'IA s'en chargera au verrouillage.` });
    onSaved();
  };

  /** Valider : on enregistre d'abord le texte (rien n'est perdu si l'IA échoue), puis l'IA l'analyse. */
  const validate = async () => {
    setBusy('validate'); setMsg(null); setBlocked(null);
    const client = await sb();
    const saved = await client.rpc('save_take_draft', { p_text: text });
    if (saved.error) { setBusy(null); setMsg({ ok: false, text: saved.error.message }); return; }
    let r: { ok: boolean; rule?: TakeRule; label?: string; reason?: string; unavailable?: boolean };
    try { r = await callBot({ action: 'parse-take', text }); }
    catch { r = { ok: false, unavailable: true, reason: "L'analyse automatique n'est pas disponible pour le moment." }; }
    if (!r.ok || !r.rule) {
      setBusy(null); onSaved();
      setBlocked({ text, reason: r.reason ?? 'Take impossible à vérifier automatiquement.', unavailable: !!r.unavailable });
      return;
    }
    const { error } = await client.rpc('validate_my_take', { p_text: text, p_rule: r.rule, p_label: r.label ?? ruleLabel(r.rule), ...odds(r.rule), p_note: null });
    setBusy(null);
    if (error) { setMsg({ ok: false, text: error.message }); onSaved(); return; }
    setEditing(false); setMsg({ ok: true, text: `Take validée. Tu peux encore la modifier jusqu'à ${deadline}.` }); onSaved();
  };

  /** Valider sans règle : un admin tranchera après la session. */
  const validateManual = async () => {
    if (!blocked) return;
    setBusy('manual'); setMsg(null);
    const { error } = await (await sb()).rpc('validate_my_take', { p_text: blocked.text, p_rule: null, p_label: null, p_probability: null, p_points: null, p_note: blocked.reason });
    setBusy(null);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setBlocked(null); setEditing(false); setMsg({ ok: true, text: 'Take validée, en arbitrage manuel.' }); onSaved();
  };

  const remove = async () => {
    const { error } = await (await sb()).rpc('delete_my_take');
    if (error) setMsg({ ok: false, text: error.message }); else { setText(''); setEditing(true); setBlocked(null); setMsg(null); onSaved(); }
  };

  const status = verdict && mine ? verdictLabel(mine, verdict) : mine ? (open ? VALIDATION[mine.validation ?? 'validated'] : 'Verrouillée') : 'À écrire';
  const tone = verdict && verdict !== 'manual' ? verdict : mine?.validation === 'validated' ? 'won' : mine?.validation === 'refused' ? 'lost' : 'pending';
  const changed = text.trim() !== (mine?.text ?? '').trim();

  return (
    <Panel hud="purple" title={mine ? 'Mon Take du jour' : 'Poser mon Take'} className="take-arena" aside={<span className={`outcome ${tone}`}>{status}</span>}>
      <div className="stack">
        {mine && (!editing || !open) ? (
          <>
            <p className="take-text" style={{ margin: 0 }}>« {mine.text} »</p>
            {mine.validation === 'draft' ? (
              <span className="hint">Brouillon non validé : l'IA l'analysera au verrouillage.</span>
            ) : mine.validation === 'refused' ? (
              <span className="form-msg" style={{ margin: 0 }}>{mine.adminValidation === 'refused' ? 'Refusée par un admin.' : mine.note ?? "Refusée par l'IA."} Elle ne rapportera pas de points.</span>
            ) : (
              <>
                <span className="take-rule">{mine.rule ? ruleLabel(mine.rule) : 'Arbitrage manuel par un admin'}</span>
                {mine.probability != null && <span className="hint num">Probabilité estimée {Math.round(mine.probability * 100)} % · {mine.points} pts si honorée</span>}
                {mine.adminValidation === 'validated' && <span className="hint">Validée par un admin.</span>}
              </>
            )}
            {open && (
              <div className="btn-row">
                <button className="btn" onClick={() => { setEditing(true); setText(mine.text); setMsg(null); }}>Modifier</button>
                <button className="btn btn-sm" onClick={remove}>Supprimer</button>
              </div>
            )}
            {open && <span className="hint">Modifiable jusqu'à {deadline}, puis verrouillée.</span>}
          </>
        ) : !open ? (
          <span className="muted">{closedReason}</span>
        ) : (
          <>
            {mine?.validation === 'draft' && !changed && !blocked && (
              <span className="hint">Brouillon enregistré, pas encore validé. Sans validation d'ici {deadline}, l'IA l'analysera automatiquement.</span>
            )}
            {mine && mine.validation !== 'draft' && <span className="hint">Ta Take actuelle reste valable tant que tu n'as pas enregistré la nouvelle version.</span>}
            <label className="field"><span>Ta prédiction, avec tes mots</span>
              <textarea id="take-text" rows={2} maxLength={280} value={text} placeholder="Ex. Je mets Paul dans le rétro ce midi"
                onChange={(e) => { setText(e.target.value); setBlocked(null); setMsg(null); }} />
            </label>
            {!blocked && (
              <div className="btn-row">
                <button className="btn btn-purple" disabled={text.trim().length < 3 || busy !== null} onClick={validate}>{busy === 'validate' ? 'Analyse par l\'IA…' : 'Valider mon Take'}</button>
                <button className="btn btn-sm" disabled={text.trim().length < 3 || busy !== null || (!!mine && !changed)} onClick={saveDraft}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer sans valider'}</button>
                {mine && mine.validation !== 'draft' && <button className="btn btn-sm" onClick={() => { setEditing(false); setText(mine.text); setMsg(null); }}>Annuler</button>}
              </div>
            )}
            {blocked && (
              <>
                <p className="form-msg" style={{ margin: 0 }}>{blocked.reason}</p>
                <div className="btn-row">
                  <button className="btn" onClick={() => setBlocked(null)}>Reformuler</button>
                  <button className={`btn ${blocked.unavailable ? 'btn-purple' : 'btn-sm'}`} disabled={busy !== null} onClick={validateManual}>{busy === 'manual' ? 'Validation…' : 'Valider quand même'}</button>
                </div>
                <span className="hint">Ton texte est enregistré en brouillon. « Valider quand même » le soumet à l'arbitrage manuel d'un admin après la session (10 pts, sans bonus de difficulté).</span>
              </>
            )}
          </>
        )}
        {msg && <p className={msg.ok ? 'hint' : 'form-msg'} style={{ margin: 0 }}>{msg.text}</p>}
      </div>
    </Panel>
  );
}
