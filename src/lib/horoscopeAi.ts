import { useEffect, useState } from 'react';
import { callBot } from './settings';
import type { Horoscope } from './daily';

type Result = { ok: boolean; day?: string; horoscopes?: Record<string, Horoscope>; reason?: string };
export type AiHoroscopes = { status: 'idle' | 'loading' | 'ready' | 'off'; byName: Record<string, Horoscope>; regenerate?: () => void };

/**
 * Horoscopes IA du jour (actu + stats). Le premier pilote connecté de la journée déclenche la génération
 * (≈ 15 s), les suivants lisent la version stockée. Sans compte ou sans IA : statut « off », le Paddock garde la version locale.
 */
export function useAiHoroscopes(enabled: boolean, today: string, admin: boolean): AiHoroscopes {
  const [state, setState] = useState<AiHoroscopes>({ status: enabled ? 'loading' : 'off', byName: {} });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) { setState({ status: 'off', byName: {} }); return; }
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    callBot<Result>({ action: 'horoscope', ...(nonce ? { force: true } : {}) })
      .then((r) => {
        if (!alive) return;
        const byName = r.ok && r.horoscopes ? r.horoscopes : {};
        setState({ status: Object.keys(byName).length ? 'ready' : 'off', byName });
      })
      .catch(() => alive && setState({ status: 'off', byName: {} }));
    return () => { alive = false; };
  }, [enabled, today, nonce]);

  return admin ? { ...state, regenerate: () => setNonce((n) => n + 1) } : state;
}
