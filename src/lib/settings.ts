import { useCallback, useEffect, useState } from 'react';
import { isLive } from './data';
import { getSupabase } from './supabase';

/** Réglages de l'app (table settings), avec des valeurs par défaut quand la base ne les a pas encore. */
export type AppSettings = {
  bot_paused: boolean; bot_pause_reason: string; bot_tone: 'sobre' | 'taquin' | 'piquant'; bot_days: number[];
  debrief_enabled: boolean; debrief_delay_min: number; debrief_takes: boolean;
  reminder_enabled: boolean; reminder_time: string; ai_pen: boolean;
  takes_enabled: boolean; takes_deadline: string; roast_optout: string[]; app_url: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  bot_paused: false, bot_pause_reason: '', bot_tone: 'taquin', bot_days: [1, 2, 3, 4, 5],
  debrief_enabled: true, debrief_delay_min: 7, debrief_takes: true,
  reminder_enabled: true, reminder_time: '12:00', ai_pen: false,
  takes_enabled: true, takes_deadline: '13:00', roast_optout: [], app_url: 'https://pits-club.vercel.app',
};

export function useSettings() {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(!isLive());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isLive()) return;
    (async () => {
      const { data } = await (await getSupabase())!.from('settings').select('key, value');
      const next = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
      for (const row of data ?? []) if (row.key in next) next[row.key] = row.value;
      setS(next as AppSettings);
      setLoaded(true);
    })();
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { settings: s, loaded, reload };
}

/** Heure « 13:00 » → Date du jour à cette heure (heure locale du navigateur). */
export function todayAt(hhmm: string, now = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export const fmtHour = (hhmm: string) => hhmm.replace(':', 'h');

/** Appel de la fonction serveur /api/bot avec le jeton du membre connecté. */
export async function callBot<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  const token = (await sb?.auth.getSession())?.data.session?.access_token;
  const r = await fetch('/api/bot', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: `Réponse invalide (${r.status})` }));
  if (!r.ok && !('ok' in data)) throw new Error((data as { error?: string }).error ?? `Erreur ${r.status}`);
  return data as T;
}
