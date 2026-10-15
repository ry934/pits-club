import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isLive } from './lib/data';
import { getSupabase } from './lib/supabase';

/**
 * Qui est connecté, et à quel pilote ce compte est relié.
 * En mode démo (aperçu sans base), on peut « se mettre dans la peau » d'un pilote : choix gardé dans ce navigateur.
 */
export type Auth = {
  loading: boolean;
  live: boolean;
  session: Session | null;
  me: string | null;          // nom du pilote tel que dans le formulaire
  nickname: string | null;    // pseudo choisi dans l'app (affiché à la place du nom)
  refresh: () => void;
  signOut: () => Promise<void>;
  setDemoMe: (name: string | null) => void;
};

const Ctx = createContext<Auth | null>(null);
const DEMO_KEY = 'mk.demoMe';

function readDemo(): string | null { try { return localStorage.getItem(DEMO_KEY); } catch { return null; } }
function writeDemo(v: string | null) { try { v ? localStorage.setItem(DEMO_KEY, v) : localStorage.removeItem(DEMO_KEY); } catch { /* indisponible */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const live = isLive();
  const [state, setState] = useState<{ loading: boolean; session: Session | null; me: string | null; nickname: string | null }>(
    { loading: live, session: null, me: live ? null : readDemo(), nickname: null },
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) return;
    let off = () => {};
    let alive = true;
    (async () => {
      const sb = (await getSupabase())!;
      const load = async (session: Session | null) => {
        let me: string | null = null, nickname: string | null = null;
        if (session) {
          const { data } = await sb.from('players').select('name, display_name').eq('user_id', session.user.id).maybeSingle();
          me = data?.name ?? null; nickname = data?.display_name ?? null;
        }
        if (alive) setState({ loading: false, session, me, nickname });
      };
      const { data } = await sb.auth.getSession();
      await load(data.session);
      const sub = sb.auth.onAuthStateChange((event, s) => { if (event !== 'INITIAL_SESSION') load(s); });
      off = () => sub.data.subscription.unsubscribe();
    })();
    return () => { alive = false; off(); };
  }, [live, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const signOut = useCallback(async () => {
    if (live) await (await getSupabase())!.auth.signOut();
    else { writeDemo(null); setState((s) => ({ ...s, me: null })); }
  }, [live]);
  const setDemoMe = useCallback((name: string | null) => { writeDemo(name); setState((s) => ({ ...s, me: name })); }, []);

  return <Ctx.Provider value={{ ...state, live, refresh, signOut, setDemoMe }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error('AuthProvider manquant');
  return a;
}
