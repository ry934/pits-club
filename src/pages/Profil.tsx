import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Avatar, Panel, PlayerTag } from '../components/ui';
import { getSupabase } from '../lib/supabase';
import { useStore } from '../store';
import { href } from '../router';

const goHome = () => { window.location.hash = '#/'; };

export function CloseSessionButton({ day }: { day: string }) {
  const { reload } = useStore();
  const { live, me } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!live || !me) return null;
  const close = async () => {
    setBusy(true);
    await (await getSupabase())!.from('session_closures').insert({ day });
    setBusy(false);
    reload();
  };
  return <button className="btn btn-flag" onClick={close} disabled={busy}>{busy ? 'Clôture…' : 'Fin de session'}</button>;
}

export function Profil() {
  const auth = useAuth();
  const [justSignedIn, setJustSignedIn] = useState(false);

  // Connexion d'un compte déjà relié à un pilote : direction le paddock personnel.
  useEffect(() => { if (justSignedIn && !auth.loading && auth.me) goHome(); }, [justSignedIn, auth.loading, auth.me]);

  if (!auth.live) return <DemoProfile />;
  return (
    <div className="page">
      <header className="page-head"><h1>{auth.me ? 'Mon profil' : 'Connexion'}</h1></header>
      {auth.loading ? <p className="hint">Chargement…</p>
        : !auth.session ? <AuthForm onSignedIn={() => { setJustSignedIn(true); auth.refresh(); }} />
          : auth.me ? <MyProfile /> : <ClaimPlayer />}
    </div>
  );
}

// ------------------------------------------------------------ connexion / inscription

function AuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const sb = (await getSupabase())!;
    const { data, error } = mode === 'in'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setMsg(error.message === 'Invalid login credentials' ? 'Mail ou mot de passe incorrect.'
        : error.message.includes('already registered') ? 'Ce mail a déjà un compte : utilise « Connexion ».' : error.message);
      return;
    }
    if (mode === 'up' && !data.session) { setMsg('Compte créé. Valide le lien reçu par mail, puis reviens te connecter.'); return; }
    onSignedIn();
  };
  return (
    <Panel hud="cyan">
      <form className="form" onSubmit={submit}>
        <div className="seg">
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Connexion</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Créer mon compte</button>
        </div>
        <label className="field"><span>Mail</span>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Mot de passe</span>
          <input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '…' : mode === 'in' ? 'Se connecter' : 'Créer mon compte'}</button>
        {mode === 'up' && <span className="hint">Étape suivante : tu choisiras le pilote qui te correspond.</span>}
        {msg && <p className="form-msg">{msg}</p>}
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------ première connexion : choix du pilote

function ClaimPlayer() {
  const { refresh } = useAuth();
  const { reload, lastSeen } = useStore();
  const [free, setFree] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [nickname, setNickname] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await (await getSupabase())!.from('players').select('name').is('user_id', null).neq('name', 'Other');
      const names = (data ?? []).map((d) => d.name);
      // les pilotes vus récemment d'abord
      names.sort((a, b) => (lastSeen.get(b) ?? '').localeCompare(lastSeen.get(a) ?? ''));
      setFree(names);
    })();
  }, [lastSeen]);
  const claim = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const sb = (await getSupabase())!;
    let { error } = await sb.rpc('claim_player', { player_name: pick, nickname: nickname.trim() || null });
    // Base pas encore mise à jour (ancienne fonction sans pseudo) : on lie le pilote sans pseudo.
    if (error && (error.code === 'PGRST202' || /function/i.test(error.message))) ({ error } = await sb.rpc('claim_player', { player_name: pick }));
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    refresh(); reload(); goHome();
  };
  return (
    <Panel hud="yellow" title="Dernière étape : qui es-tu sur la grille ?">
      <form className="stack" onSubmit={claim}>
        <p style={{ margin: 0 }}>Choisis le pilote qui te correspond, sous le nom utilisé dans le formulaire. Ce choix est définitif : ton compte et ce pilote seront liés.</p>
        <div className="claim-grid" role="radiogroup" aria-label="Pilote">
          {free.map((n) => (
            <button type="button" key={n} role="radio" aria-checked={pick === n} className={`claim-card ${pick === n ? 'on' : ''}`} onClick={() => setPick(n)}>
              <Avatar name={n} size={40} /><b>{n}</b>
              <span className="hint">{lastSeen.get(n) ? `vu le ${lastSeen.get(n)!.split('-').reverse().join('/')}` : 'jamais vu'}</span>
            </button>
          ))}
        </div>
        <label className="field" style={{ maxWidth: 360 }}><span>Ton pseudo dans l'app (facultatif)</span>
          <input id="nickname" type="text" maxLength={20} placeholder={pick ? `Ex. ${pick === 'Ayann' ? 'Zay' : 'Turbo ' + pick}` : 'Ex. Zay'} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <span className="hint">Le pseudo remplace ton nom partout dans l'app. Le formulaire, lui, ne change pas.</span>
        <button className="btn btn-gold" type="submit" disabled={!pick || busy}>{busy ? '…' : pick ? `Je suis ${pick}` : 'Choisis ton pilote'}</button>
        {msg && <p className="form-msg">{msg}</p>}
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------ profil

function MyProfile() {
  const { me, nickname, session, signOut, refresh } = useAuth();
  const { reload } = useStore();
  const [value, setValue] = useState(nickname ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await (await getSupabase())!.rpc('set_display_name', { nickname: value.trim() || null });
    if (error) { setMsg(error.message); return; }
    setMsg('Pseudo enregistré.'); refresh(); reload();
  };
  return (
    <div className="grid grid-2">
      <Panel hud="cyan" title="Mon pilote">
        <div className="stack">
          <PlayerTag name={me!} size={48} sub={nickname ? `pseudo de ${me}` : undefined} />
          <span className="hint">{session?.user.email}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href="#/">Mon paddock</a>
            <a className="btn" href={href('pilote', me!)}>Ma fiche</a>
            <button className="btn" onClick={signOut}>Se déconnecter</button>
          </div>
        </div>
      </Panel>
      <Panel title="Mon pseudo">
        <form className="form" onSubmit={save}>
          <label className="field"><span>Pseudo affiché dans l'app</span>
            <input id="nickname-edit" type="text" maxLength={20} placeholder={me!} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button className="btn" type="submit">Enregistrer</button>
          <span className="hint">Laisse vide pour revenir à « {me} ».</span>
          {msg && <p className="form-msg">{msg}</p>}
        </form>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------ démo (aperçu sans base)

function DemoProfile() {
  const { me, setDemoMe } = useAuth();
  const { activeNames } = useStore();
  const [pick, setPick] = useState(me ?? '');
  return (
    <div className="page">
      <header className="page-head"><h1>Profil</h1></header>
      <div className="notice"><b>Démo</b><span>Ici, pas de vrai compte : choisis un pilote pour voir l'accueil personnalisé tel qu'il apparaîtra après connexion.</span></div>
      <Panel hud="yellow" title="Se mettre dans la peau de">
        <div className="stack">
          <div className="claim-grid">
            {activeNames.map((n) => (
              <button type="button" key={n} className={`claim-card ${pick === n ? 'on' : ''}`} aria-pressed={pick === n} onClick={() => setPick(n)}>
                <Avatar name={n} size={40} /><b>{n}</b>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold" disabled={!pick} onClick={() => { setDemoMe(pick); goHome(); }}>Entrer dans mon paddock</button>
            {me && <button className="btn" onClick={() => { setDemoMe(null); setPick(''); }}>Quitter</button>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
