import seed from '../data/seed.json';
import { cleanRaces } from './stats';
import { getSupabase } from './supabase';
import { Dataset, Player, RawRace } from './types';
import { attachAvatarUrls } from './avatars';

const SRC = { a: 'archive', f: 'form', p: 'app' } as const;

function fromSeed(): Dataset {
  const raw: RawRace[] = (seed.races as string[][]).map(([ts, a, b, c, d, s]) => ({
    ts, p: [a, b, c, d], src: SRC[s as keyof typeof SRC] ?? 'form',
  }));
  return { ...cleanRaces(raw), players: seed.players as Player[], closedDays: new Set(), source: 'demo', loadedAt: new Date() };
}

async function fromSupabase(): Promise<Dataset> {
  const sb = (await getSupabase())!;
  const raw: RawRace[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('races').select('ts,p1,p2,p3,p4,source').order('ts').range(from, from + 999);
    if (error) throw error;
    for (const r of data) raw.push({ ts: String(r.ts).replace(' ', 'T').slice(0, 19), p: [r.p1, r.p2, r.p3, r.p4], src: r.source });
    if (data.length < 1000) break;
  }
  // « * » : les colonnes ajoutées plus tard (avatar_path, hidden) sont lues si elles existent.
  const pl = await sb.from('players').select('*').order('created_at');
  const { data: closures, error: e2 } = await sb.from('session_closures').select('day');
  if (pl.error) throw pl.error;
  if (e2) throw e2;
  const players: Player[] = (pl.data ?? []).map((p) => ({
    id: p.id, name: p.name, color: p.color, active: p.active,
    displayName: p.display_name ?? undefined, avatarPath: p.avatar_path ?? undefined, hidden: p.hidden === true,
  }));
  await attachAvatarUrls(players);
  return {
    ...cleanRaces(raw),
    players,
    closedDays: new Set((closures ?? []).map((c) => c.day)),
    source: 'live', loadedAt: new Date(),
  };
}

export const isLive = () => !!import.meta.env.VITE_SUPABASE_URL;

export async function loadDataset(): Promise<Dataset> {
  return isLive() ? fromSupabase() : fromSeed();
}
