import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isLive, loadDataset } from './lib/data';
import { getSupabase } from './lib/supabase';
import { BadgeBook, computeBadges } from './lib/badges';
import { allRuns, computeElo, EloResult, groupByDay, lastSeenMap, PlayerDay, playerDays, Run, standings } from './lib/stats';
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
  /** Leader et lanterne rouge du mois en cours (10 courses minimum) : couronne et nuage sur leur avatar. */
  crown: { leader: string | null; last: string | null };
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
    // Pilotes effacés : ils disparaissent de l'app (remplacés par « Ancien joueur »), mais leurs courses restent
    // pour que les stats et les cotes des autres ne bougent pas. La cote est calculée sur les courses d'origine.
    const hidden = new Set(ds.players.filter((p) => p.hidden).map((p) => p.name));
    const mask = <T extends { p: string[] }>(r: T): T => (r.p.some((n) => hidden.has(n)) ? { ...r, p: r.p.map((n) => (hidden.has(n) ? 'Other' : n)) } : r);
    const races = hidden.size ? ds.races.map(mask) : ds.races;
    const flagged = hidden.size ? ds.flagged.map(mask) : ds.flagged;
    const replaced = hidden.size ? ds.replaced.map((x) => ({ replaced: mask(x.replaced), by: mask(x.by) })) : ds.replaced;
    const players = ds.players.filter((p) => !p.hidden).map((p) => (p.name === 'Other' ? { ...p, displayName: 'Ancien joueur' } : p));
    const byDay = groupByDay(races);
    const known = new Map(players.map((p) => [p.name, p]));
    const fallback = (name: string): Player => (name === 'Other' ? { name, color: '#6B7390', active: false, displayName: 'Ancien joueur' } : { name, color: '#9AA3B5', active: true });
    const lastSeen = lastSeenMap(races);
    const elo = computeElo(ds.races);
    return {
      ...ds,
      races, flagged, replaced, players,
      elo,
      badges: computeBadges(races, elo),
      runs: allRuns(races),
      days: playerDays(races),
      byDay, dayList: [...byDay.keys()],
      lastSeen,
      player: (name) => known.get(name) ?? fallback(name),
      activeNames: players.filter((p) => p.active && p.name !== 'Other' && lastSeen.has(p.name)).map((p) => p.name),
      crown: (() => {
        const month = [...byDay.keys()].at(-1)?.slice(0, 7);
        const active = new Set(players.filter((p) => p.active && p.name !== 'Other').map((p) => p.name));
        const t = month ? standings(races.filter((r) => r.day.startsWith(month))).filter((x) => x.races >= 10 && active.has(x.name)) : [];
        return { leader: t[0]?.name ?? null, last: t.length >= 3 ? t.at(-1)!.name : null };
      })(),
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
