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
  visitor: boolean;           // membre sans pilote (compte « visiteur »)
  admin: boolean;             // accès au back-office
  refresh: () => void;
  signOut: () => Promise<void>;
  setDemoMe: (name: string | null) => void;
  setVisitor: () => Promise<string | null>;
};

const Ctx = createContext<Auth | null>(null);
const DEMO_KEY = 'mk.demoMe';
const DEMO_VISITOR = '__visitor__';

function readDemo(): string | null { try { return localStorage.getItem(DEMO_KEY); } catch { return null; } }
function writeDemo(v: string | null) { try { v ? localStorage.setItem(DEMO_KEY, v) : localStorage.removeItem(DEMO_KEY); } catch { /* indisponible */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const live = isLive();
  const demo = live ? null : readDemo();
  const [state, setState] = useState<{ loading: boolean; session: Session | null; me: string | null; nickname: string | null; visitor: boolean; admin: boolean }>(
    { loading: live, session: null, me: demo && demo !== DEMO_VISITOR ? demo : null, nickname: null, visitor: demo === DEMO_VISITOR, admin: !live },
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) return;
    let off = () => {};
    let alive = true;
    (async () => {
      const sb = (await getSupabase())!;
      const load = async (session: Session | null) => {
        let me: string | null = null, nickname: string | null = null, admin = false;
        if (session) {
          const [{ data }, adm] = await Promise.all([
            sb.from('players').select('name, display_name').eq('user_id', session.user.id).maybeSingle(),
            sb.rpc('is_admin'),
          ]);
          me = data?.name ?? null; nickname = data?.display_name ?? null; admin = adm.data === true;
        }
        const visitor = !me && session?.user.user_metadata?.role === 'visitor';
        if (alive) setState({ loading: false, session, me, nickname, visitor, admin });
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
    else { writeDemo(null); setState((s) => ({ ...s, me: null, visitor: false })); }
  }, [live]);
  const setDemoMe = useCallback((name: string | null) => { writeDemo(name); setState((s) => ({ ...s, me: name, visitor: false })); }, []);
  const setVisitor = useCallback(async () => {
    if (!live) { writeDemo(DEMO_VISITOR); setState((s) => ({ ...s, me: null, visitor: true })); return null; }
    const { error } = await (await getSupabase())!.auth.updateUser({ data: { role: 'visitor' } });
    if (error) return error.message;
    setTick((t) => t + 1);
    return null;
  }, [live]);

  return <Ctx.Provider value={{ ...state, live, refresh, signOut, setDemoMe, setVisitor }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error('AuthProvider manquant');
  return a;
}
