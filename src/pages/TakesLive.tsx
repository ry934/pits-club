import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { Avatar, Empty, Panel, PlayerTag, Section } from '../components/ui';
import { Countdown } from './Paddock';
import { LiveTake, takeVerdict, TakeVerdict } from '../lib/bot/facts';
import { callBot, fmtHour, todayAt, useSettings } from '../lib/settings';
import { dayKey, fmtDay } from '../lib/stats';
import { getSupabase } from '../lib/supabase';
import { estimateProbability, pointsFor, ruleLabel, TakeRule } from '../lib/takes';
import { useStore } from '../store';

type Row = LiveTake & { day: string };
type Notice = { tone: 'ok' | 'warn'; text: string } | null;

const VERDICT: Record<TakeVerdict, string> = { won: 'Honoré', lost: 'Raté', void: 'Annulé', manual: 'À arbitrer' };

/** Takes réels : texte libre, traduit en règle vérifiable par l'IA, scellé jusqu'à la fin de la session. */
export function TakesLive() {
  const { me } = useAuth();
  const { byDay, dayList, elo, races, closedDays, player } = useStore();
  const { settings } = useSettings();
  const today = dayKey(new Date());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [posted, setPosted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    const sb = (await getSupabase())!;
    const since = dayKey(new Date(Date.now() - 60 * 864e5));
    const [{ data, error: e }, names] = await Promise.all([
      sb.from('takes').select('id, day, raw_text, rule, rule_label, probability, points_if_won, status, revealed, author:players(name)').gte('day', since).order('day', { ascending: false }),
      sb.rpc('takes_posted_names', { on_day: today }),
    ]);
    if (e) { setError(e.message); setRows([]); return; }
    setRows((data ?? []).map((t) => ({
      id: t.id, day: t.day, author: (t.author as unknown as { name: string } | null)?.name ?? '?', text: t.raw_text, rule: t.rule, label: t.rule_label,
      probability: t.probability, points: t.points_if_won, status: t.status, revealed: t.revealed,
    })));
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
        <p className="muted" style={{ margin: 0 }}>Un Take par pilote et par jour, avant {fmtHour(settings.takes_deadline)} et le départ de la première course. Scellé jusqu'à la fin de la session.</p>
      </header>
      {error && <p className="form-msg">{error}</p>}

      <div className="grid grid-paddock">
        <div className="stack">
          {notice && <p className={`take-notice ${notice.tone}`} role="status">{notice.text}</p>}
          {!me ? (
            <Panel hud="purple" title="Mon Take"><p className="muted" style={{ margin: 0 }}>Les Takes sont réservés aux pilotes. Tu peux suivre leur révélation après chaque session.</p></Panel>
          ) : !settings.takes_enabled ? (
            <Panel hud="purple" title="Mon Take"><p className="muted" style={{ margin: 0 }}>Les Takes sont en pause pour le moment.</p></Panel>
          ) : (
            <MyTake key={mine?.id ?? 'new'} mine={mine} open={open} onSaved={(n) => { setNotice(n); load(); }} lineup={lineup} avgRaces={avgRaces}
              closedReason={sessionStarted ? 'La session a commencé : les Takes sont fermés.' : `Les Takes ferment à ${fmtHour(settings.takes_deadline)}. Rendez-vous demain matin.`}
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
                            <span className={`outcome ${v === 'manual' ? 'pending' : v}`}>{VERDICT[v]}{v === 'won' && t.points ? ` +${t.points}` : ''}</span>
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
                  <span className="muted">Aujourd'hui, {fmtHour(settings.takes_deadline)} (ou au départ de la première course)</span>
                  <Countdown to={deadline} />
                </>
              ) : <span className="muted">{revealedToday ? 'Les Takes du jour sont révélés.' : sessionStarted ? 'Session en cours : les Takes sont scellés.' : `Fermés. Réouverture demain matin, jusqu'à ${fmtHour(settings.takes_deadline)}.`}</span>}
              <span className="hint">Ton Take est traduit en règle vérifiable, que tu valides avant l'envoi. Les points dépendent de la difficulté : 10 ÷ probabilité, plafonné à 100.</span>
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
        <span className={`outcome ${verdict === 'manual' ? 'pending' : verdict}`}>{VERDICT[verdict]}{verdict === 'won' && t.points ? ` +${t.points}` : ''}</span>
      </div>
    </div>
  );
}

function MyTake({ mine, open, onSaved, lineup, avgRaces, closedReason, verdict, ratings }: {
  mine: Row | null; open: boolean; onSaved: (notice: Notice) => void; lineup: string[]; avgRaces: number; closedReason: string;
  verdict: TakeVerdict | null; ratings: Map<string, number>;
}) {
  const [editing, setEditing] = useState(!mine);
  const [text, setText] = useState(mine?.text ?? '');
  const [busy, setBusy] = useState<'analyse' | 'save' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * Un seul clic : l'IA traduit le Take en règle, puis il est enregistré dans tous les cas.
   * Si l'IA ne sait pas le traduire (ou ne répond pas), il part en arbitrage manuel : rien n'est perdu.
   */
  const submit = async () => {
    const t = text.trim();
    if (t.length < 3) { setMsg('Écris ton Take avant de valider.'); return; }
    setMsg(null); setBusy('analyse');
    let rule: TakeRule | null = null, label: string | null = null, reason: string | null = null;
    try {
      const r = await callBot<{ ok: boolean; rule?: TakeRule; label?: string; reason?: string }>({ action: 'parse-take', text: t });
      if (r.ok && r.rule) { rule = r.rule; label = r.label ?? ruleLabel(r.rule); } else reason = r.reason ?? null;
    } catch {
      reason = "l'analyse automatique n'a pas répondu";
    }
    setBusy('save');
    const p = rule ? estimateProbability(rule, lineup, ratings, avgRaces, 1500, 7) : null;
    const { error } = await (await getSupabase())!.rpc('submit_take', {
      p_text: t, p_rule: rule, p_label: label,
      p_probability: p !== null ? Math.round(p * 1000) / 1000 : null, p_points: p !== null ? pointsFor(p) : null,
    });
    setBusy(null);
    if (error) { setMsg(`Take non enregistré : ${error.message}`); return; }
    onSaved(rule
      ? { tone: 'ok', text: `Take enregistré et scellé. Règle retenue : ${label}.` }
      : { tone: 'warn', text: `Take enregistré et scellé, en arbitrage manuel${reason ? ` (${reason.replace(/\.$/, '')})` : ''}. Un admin tranchera après la session ; tu peux aussi le reformuler avant la clôture.` });
  };

  const remove = async () => {
    const { error } = await (await getSupabase())!.rpc('delete_my_take');
    if (error) setMsg(error.message); else { setText(''); setEditing(true); onSaved(null); }
  };

  const status = mine ? (verdict ? VERDICT[verdict] : open ? 'Scellé' : 'Verrouillé') : 'Brouillon';
  return (
    <Panel hud="purple" title={mine ? 'Mon Take du jour' : 'Poser mon Take'} className="take-arena" aside={<span className={`outcome ${verdict && verdict !== 'manual' ? verdict : 'pending'}`}>{status}</span>}>
      <div className="stack">
        {mine && !editing ? (
          <>
            <p className="take-text" style={{ margin: 0 }}>« {mine.text} »</p>
            <span className="take-rule">{mine.rule ? ruleLabel(mine.rule) : 'Arbitrage manuel par un admin'}</span>
            {mine.probability != null && <span className="hint num">Probabilité estimée {Math.round(mine.probability * 100)} % · {mine.points} pts si honoré</span>}
            {open && (
              <div className="btn-row">
                <button className="btn" onClick={() => { setEditing(true); setText(mine.text); }}>Modifier</button>
                <button className="btn btn-sm" onClick={remove}>Supprimer</button>
              </div>
            )}
          </>
        ) : !open ? (
          <span className="muted">{closedReason}</span>
        ) : (
          <>
            <label className="field"><span>Ta prédiction, avec tes mots</span>
              <textarea id="take-text" rows={2} maxLength={280} value={text} placeholder="Ex. Je mets Paul dans le rétro ce midi" onChange={(e) => { setText(e.target.value); setMsg(null); }} />
            </label>
            <div className="btn-row">
              <button className="btn btn-purple" disabled={text.trim().length < 3 || busy !== null} onClick={submit}>
                {busy === 'analyse' ? 'Analyse…' : busy === 'save' ? 'Enregistrement…' : mine ? 'Valider la modification' : 'Valider mon Take'}
              </button>
              {mine && <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={busy !== null}>Annuler</button>}
            </div>
            <span className="hint">Un clic suffit : ton Take est traduit en règle vérifiable puis enregistré. S'il ne peut pas être traduit, il est quand même enregistré et un admin tranchera.</span>
          </>
        )}
        {msg && <p className="form-msg" role="alert">{msg}</p>}
      </div>
    </Panel>
  );
}

