import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isLive } from '../lib/data';
import { getSupabase } from '../lib/supabase';
import { useStore } from '../store';
import { PlayerTag, Section } from '../components/ui';

type Me = { session: Session | null; playerName: string | null; loading: boolean };

export function useMe(): Me & { refresh: () => void } {
  const [me, setMe] = useState<Me>({ session: null, playerName: null, loading: isLive() });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = () => {};
    (async () => {
      const sb = await getSupabase();
      if (!sb) return;
      const load = async (session: Session | null) => {
        let playerName: string | null = null;
        if (session) {
          const { data } = await sb.from('players').select('name').eq('user_id', session.user.id).maybeSingle();
          playerName = data?.name ?? null;
        }
        setMe({ session, playerName, loading: false });
      };
      const { data } = await sb.auth.getSession();
      await load(data.session);
      const sub = sb.auth.onAuthStateChange((_e, s) => { load(s); });
      off = () => sub.data.subscription.unsubscribe();
    })();
    return () => off();
  }, [tick]);
  return { ...me, refresh: () => setTick((t) => t + 1) };
}

export function CloseSessionButton({ day }: { day: string }) {
  const { reload } = useStore();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!isLive() || !me.playerName) return null;
  const close = async () => {
    setBusy(true);
    const sb = (await getSupabase())!;
    await sb.from('session_closures').insert({ day });
    setBusy(false);
    reload();
  };
  return <button className="btn btn-flag" onClick={close} disabled={busy}>{busy ? 'Clôture…' : 'Fin de session'}</button>;
}

export function Profil() {
  const me = useMe();
  if (!isLive()) {
    return (
      <div className="page">
        <header className="page-head"><h1>Profil</h1></header>
        <div className="notice">
          <p><b>Version de démonstration.</b> Les chiffres viennent de l'historique du Google Sheet arrêté au 14/10/2026.</p>
          <p>La connexion (mail et mot de passe), la clôture de session, les Takes et la présence Slack s'activent dès que la base en ligne est branchée.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <header className="page-head"><h1>Profil</h1></header>
      {me.loading ? <p className="hint">Chargement…</p> : !me.session ? <AuthForm /> : me.playerName ? (
        <Section title="Connecté">
          <PlayerTag name={me.playerName} />
          <p className="hint">{me.session.user.email}</p>
          <button className="btn" onClick={async () => (await getSupabase())!.auth.signOut()}>Se déconnecter</button>
        </Section>
      ) : <ClaimPlayer onDone={me.refresh} />}
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const sb = (await getSupabase())!;
    const { error } = mode === 'in'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });
    if (error) setMsg(error.message === 'Invalid login credentials' ? 'Mail ou mot de passe incorrect.' : error.message);
    else if (mode === 'up') setMsg('Compte créé. Si un mail de confirmation arrive, clique sur le lien puis reviens te connecter.');
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="segmented">
        <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Connexion</button>
        <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Créer mon compte</button>
      </div>
      <label htmlFor="email">Mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Mot de passe</label>
      <input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn btn-primary" type="submit">{mode === 'in' ? 'Se connecter' : 'Créer le compte'}</button>
      {msg && <p className="form-msg">{msg}</p>}
    </form>
  );
}

function ClaimPlayer({ onDone }: { onDone: () => void }) {
  const [free, setFree] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const sb = (await getSupabase())!;
      const { data } = await sb.from('players').select('name').is('user_id', null).eq('active', true).order('name');
      setFree((data ?? []).map((d) => d.name));
    })();
  }, []);
  const claim = async (e: FormEvent) => {
    e.preventDefault();
    const sb = (await getSupabase())!;
    const { error } = await sb.rpc('claim_player', { player_name: pick });
    if (error) setMsg(error.message); else onDone();
  };
  return (
    <form className="form" onSubmit={claim}>
      <p>Dernière étape : quel pilote es-tu ? Choisis le nom que vous utilisez dans le formulaire.</p>
      <label htmlFor="claim">Pilote</label>
      <select id="claim" required value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="" disabled>Choisir…</option>
        {free.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button className="btn btn-primary" type="submit" disabled={!pick}>C'est moi</button>
      {msg && <p className="form-msg">{msg}</p>}
    </form>
  );
}
