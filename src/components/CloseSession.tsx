import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { getSupabase } from '../lib/supabase';
import { useStore } from '../store';

const OUTCOME: Record<string, string> = {
  sent: 'Session clôturée. Le débrief part sur Slack.',
  paused: 'Session clôturée. Le bot est en pause : pas de message Slack.',
  disabled: 'Session clôturée. Le débrief Slack est désactivé dans le back-office.',
  off_day: 'Session clôturée. Le bot ne publie pas ce jour-là.',
  none: 'Session clôturée. Le débrief a déjà été envoyé.',
};

/**
 * « Clôturer la session » : fige les résultats du jour, révèle les Takes et envoie le débrief Slack.
 * Deux temps (clic, puis confirmation) pour éviter une clôture accidentelle en pleine session.
 */
export function CloseSessionButton({ size }: { size?: 'sm' }) {
  const { reload } = useStore();
  const { live, me } = useAuth();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (step !== 'confirm') return;
    const t = setTimeout(() => setStep('idle'), 6000);
    return () => clearTimeout(t);
  }, [step]);
  if (!live || !me) return null;

  const close = async () => {
    setStep('busy');
    const { data, error } = await (await getSupabase())!.rpc('close_session');
    setStep('idle');
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setMsg({ ok: true, text: OUTCOME[(data as { debrief?: string })?.debrief ?? 'sent'] ?? OUTCOME.sent });
    reload();
  };

  const cls = `btn btn-flag${size === 'sm' ? ' btn-sm' : ''}`;
  return (
    <span className="close-session">
      {step === 'confirm' ? (
        <>
          <button type="button" className={`${cls} btn-primary`} onClick={close}>Confirmer : figer et envoyer le débrief</button>
          <button type="button" className={`btn${size === 'sm' ? ' btn-sm' : ''}`} onClick={() => setStep('idle')}>Annuler</button>
        </>
      ) : (
        <button type="button" className={cls} onClick={() => { setMsg(null); setStep('confirm'); }} disabled={step === 'busy'}>
          {step === 'busy' ? 'Clôture…' : 'Clôturer la session'}
        </button>
      )}
      {msg && <span className={`form-msg ${msg.ok ? 'ok' : ''}`} role="status">{msg.text}</span>}
    </span>
  );
}

/** Réservé aux admins : rouvrir une session clôturée par erreur (le débrief déjà parti reste parti). */
export function ReopenSessionButton({ day }: { day: string }) {
  const { reload, closedDays } = useStore();
  const { live, admin } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  if (!live || !admin || !closedDays.has(day)) return null;
  const reopen = async () => {
    const { error } = await (await getSupabase())!.rpc('reopen_session', { p_day: day });
    if (error) setErr(error.message); else reload();
  };
  return (
    <span className="close-session">
      <button type="button" className="btn btn-sm" onClick={reopen} title="Admin : remet la session en direct. Une nouvelle clôture enverra un message « prolongations » si des courses ont été ajoutées.">Rouvrir la session</button>
      {err && <span className="form-msg">{err}</span>}
    </span>
  );
}
