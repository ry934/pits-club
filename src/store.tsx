import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isLive, loadDataset } from './lib/data';
import { getSupabase } from './lib/supabase';
import { BadgeBook, computeBadges } from './lib/badges';
import { allRuns, computeElo, EloResult, groupByDay, lastSeenMap, PlayerDay, playerDays, Run } from './lib/stats';
import { Dataset, Player, Race } from './lib/types';

export type Store = Dataset & {
  elo: EloResult;
  badges: BadgeBook;
  runs: Run[];
  days: PlayerDay[];
  byDay: Map<string, Race[]>;
  dayList: string[];
  lastSeen: Map<string, string>;
  player: (name: string) => Player;
  activeNames: string[];
  reload: () => void;
  /** Mise à jour automatique : 'realtime' (poussée par la base), 'polling' (vérification régulière) ou 'off' (démo). */
  sync: { mode: 'realtime' | 'polling' | 'off'; checkedAt: Date | null };
};

/** Fréquence de vérification : serrée sur le créneau du midi en semaine, lâche le reste du temps. */
function pollDelay(now = new Date()) {
  const m = now.getHours() * 60 + now.getMinutes();
  const lunch = now.getDay() >= 1 && now.getDay() <= 5 && m >= 11 * 60 + 45 && m <= 15 * 60;
  return lunch ? 15_000 : 120_000;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [sync, setSync] = useState<Store['sync']>({ mode: isLive() ? 'polling' : 'off', checkedAt: null });
  const stamp = useRef<string | null>(null);   // empreinte de la table des courses (nombre + dernière date)

  useEffect(() => {
    loadDataset().then(setDs).catch((e) => setError(String(e?.message ?? e)));
  }, [tick]);

  // Direct : chaque nouvelle réponse au formulaire recharge les données sans recharger la page.
  useEffect(() => {
    if (!isLive()) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
    let off = () => {};
    const bump = () => { clearTimeout(debounce); debounce = setTimeout(() => alive && setTick((t) => t + 1), 1200); };
    const check = async () => {
      const sb = await getSupabase();
      if (!sb || !alive) return;
      const { data, count, error: err } = await sb.from('races').select('ts', { count: 'exact' }).order('ts', { ascending: false }).limit(1);
      if (!alive || err) return;
      const next = `${count}|${data?.[0]?.ts ?? ''}`;
      if (stamp.current !== null && stamp.current !== next) bump();
      stamp.current = next;
      setSync((s) => ({ ...s, checkedAt: new Date() }));
    };
    const loop = async () => {
      if (document.visibilityState === 'visible') await check().catch(() => {});
      if (alive) timer = setTimeout(loop, pollDelay());
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check().catch(() => {}); };
    (async () => {
      const sb = await getSupabase();
      if (!sb || !alive) return;
      const ch = sb.channel('pits-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'races' }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'session_closures' }, bump)
        .subscribe((status) => alive && setSync((s) => ({ ...s, mode: status === 'SUBSCRIBED' ? 'realtime' : 'polling' })));
      off = () => { sb.removeChannel(ch); };
      loop();   // la vérification régulière reste active en filet de sécurité
    })();
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearTimeout(timer); clearTimeout(debounce); off(); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const base = useMemo<Omit<Store, 'sync'> | null>(() => {
    if (!ds) return null;
    const byDay = groupByDay(ds.races);
    const known = new Map(ds.players.map((p) => [p.name, p]));
    const fallback = (name: string): Player => ({ name, color: '#9AA3B5', active: true });
    const lastSeen = lastSeenMap(ds.races);
    const elo = computeElo(ds.races);
    return {
      ...ds,
      elo,
      badges: computeBadges(ds.races, elo),
      runs: allRuns(ds.races),
      days: playerDays(ds.races),
      byDay, dayList: [...byDay.keys()],
      lastSeen,
      player: (name) => known.get(name) ?? fallback(name),
      activeNames: ds.players.filter((p) => p.active && lastSeen.has(p.name)).map((p) => p.name),
      reload: () => setTick((t) => t + 1),
    };
  }, [ds]);
  const store = useMemo<Store | null>(() => (base ? { ...base, sync } : null), [base, sync]);

  if (error) return <div className="boot"><p className="boot-title">Chargement impossible</p><p>{error}</p></div>;
  if (!store) return <div className="boot"><div className="lights" aria-hidden="true"><i /><i /><i /><i /><i /></div><p>Chargement des courses…</p></div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s;
}
