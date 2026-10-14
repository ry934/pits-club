import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { loadDataset } from './lib/data';
import { allRuns, computeElo, EloResult, groupByDay, lastSeenMap, PlayerDay, playerDays, Run } from './lib/stats';
import { Dataset, Player, Race } from './lib/types';

export type Store = Dataset & {
  elo: EloResult;
  runs: Run[];
  days: PlayerDay[];
  byDay: Map<string, Race[]>;
  dayList: string[];
  lastSeen: Map<string, string>;
  player: (name: string) => Player;
  activeNames: string[];
  reload: () => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadDataset().then(setDs).catch((e) => setError(String(e?.message ?? e)));
  }, [tick]);

  const store = useMemo<Store | null>(() => {
    if (!ds) return null;
    const byDay = groupByDay(ds.races);
    const known = new Map(ds.players.map((p) => [p.name, p]));
    const fallback = (name: string): Player => ({ name, color: '#9AA3B5', active: true });
    const lastSeen = lastSeenMap(ds.races);
    return {
      ...ds,
      elo: computeElo(ds.races),
      runs: allRuns(ds.races),
      days: playerDays(ds.races),
      byDay, dayList: [...byDay.keys()],
      lastSeen,
      player: (name) => known.get(name) ?? fallback(name),
      activeNames: ds.players.filter((p) => p.active && lastSeen.has(p.name)).map((p) => p.name),
      reload: () => setTick((t) => t + 1),
    };
  }, [ds]);

  if (error) return <div className="boot"><p className="boot-title">Chargement impossible</p><p>{error}</p></div>;
  if (!store) return <div className="boot"><div className="lights"><i /><i /><i /><i /><i /></div><p>Chargement des courses…</p></div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s;
}
