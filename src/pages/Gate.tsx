import { CSSProperties, FormEvent, ReactNode, useEffect, useState } from 'react';
import seed from '../data/seed.json';
import { useAuth } from '../auth';
import { BrandMark, initials } from '../components/ui';
import { getSupabase } from '../lib/supabase';

/** Écrans affichés avant l'accès aux données : connexion, puis choix du pilote ou du profil visiteur. */

function GateLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="gate">
      <div className="track-bg" aria-hidden="true" />
      <div className={`gate-inner ${wide ? 'wide' : ''}`}>
        <header className="gate-brand">
          <BrandMark />
          <span className="brand-text"><span className="brand-name">Pits Club</span><span className="brand-sub">Neon Grand Prix</span></span>
        </header>
        {children}
      </div>
    </div>
  );
}

function Dot({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ '--c': color, width: size, height: size, fontSize: size * 0.4 } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// ------------------------------------------------------------ connexion

export function LoginScreen() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
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
      setMsg({ text: error.message === 'Invalid login credentials' ? 'Mail ou mot de passe incorrect.'
        : /already registered/i.test(error.message) ? 'Ce mail a déjà un compte. Passe par « Connexion ».'
          : /at least/i.test(error.message) ? 'Le mot de passe doit faire au moins 8 caractères.' : error.message });
      return;
    }
    if (mode === 'up' && !data.session) { setMsg({ text: 'Compte créé. Valide le lien reçu par mail, puis connecte-toi.', ok: true }); setMode('in'); return; }
    refresh();
  };

  return (
    <GateLayout>
      <div className="gate-intro">
        <h1>{mode === 'in' ? 'Retour au paddock' : 'Rejoindre le club'}</h1>
        <p className="muted">Les stats du kart du midi sont réservées aux membres du club.</p>
      </div>
      <section className="gate-card panel hud">
        <div className="gate-tabs" role="tablist" aria-label="Accès">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setMsg(null); }}>Connexion</button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setMsg(null); }}>Inscription</button>
        </div>
        <form className="gate-form" onSubmit={submit}>
          <label className="field"><span>Mail</span>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.fr" />
          </label>
          <label className="field"><span>Mot de passe</span>
            <input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'up' ? '8 caractères minimum' : ''} />
          </label>
          {mode === 'up' && (
            <p className="gate-tip" role="note">
              <b>Conseil des dev'</b> : ne mettez pas le même mot de passe que celui du compte où dorment vos bitcoins. Pits Club a été codé entre deux courses, pas par la NASA.
            </p>
          )}
          <button className="btn btn-primary gate-submit" type="submit" disabled={busy}>
            {busy ? 'Un instant…' : mode === 'in' ? 'Se connecter' : 'Créer mon compte'}
          </button>
          {msg && <p className={`gate-msg ${msg.ok ? 'ok' : ''}`} role="status">{msg.text}</p>}
        </form>
      </section>
      <p className="gate-foot muted">{mode === 'in' ? 'Pas encore de compte ? ' : 'Déjà membre ? '}
        <button type="button" className="linkbtn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>{mode === 'in' ? 'Crée-le en 30 secondes' : 'Connecte-toi'}</button>
      </p>
    </GateLayout>
  );
}

// ------------------------------------------------------------ choix du pilote ou visiteur

type Free = { name: string; color: string; active: boolean };

export function Onboarding() {
  const { live, refresh, signOut, setDemoMe, setVisitor, session } = useAuth();
  const [free, setFree] = useState<Free[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);   // nom du pilote, ou 'visitor'
  const [nickname, setNickname] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      let list: Free[];
      if (live) {
        const { data } = await (await getSupabase())!.from('players').select('*').is('user_id', null).neq('name', 'Other');
        list = ((data ?? []) as (Free & { hidden?: boolean })[]).filter((p) => !p.hidden);
      } else {
        list = (seed.players as (Free & { hidden?: boolean })[]).filter((p) => p.name !== 'Other' && !p.hidden);
      }
      list.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
      setFree(list);
    })();
  }, [live]);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true); setMsg(null);
    if (pick === 'visitor') {
      const err = await setVisitor();
      setBusy(false);
      if (err) setMsg(err);
      return;
    }
    if (!live) { setDemoMe(pick); setBusy(false); return; }
    const sb = (await getSupabase())!;
    let { error } = await sb.rpc('claim_player', { player_name: pick, nickname: nickname.trim() || null });
    if (error && (error.code === 'PGRST202' || /function/i.test(error.message))) ({ error } = await sb.rpc('claim_player', { player_name: pick }));
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    refresh();
  };

  const active = free?.filter((p) => p.active) ?? [];
  const former = free?.filter((p) => !p.active) ?? [];
  const card = (p: Free) => (
    <button type="button" key={p.name} role="radio" aria-checked={pick === p.name} className={`claim-card ${pick === p.name ? 'on' : ''}`} onClick={() => setPick(p.name)}>
      <Dot name={p.name} color={p.color} /><b>{p.name}</b>
    </button>
  );

  return (
    <GateLayout wide>
      <div className="gate-intro">
        <h1>Qui es-tu sur la grille ?</h1>
        <p className="muted">{live && session?.user.email ? `Connecté avec ${session.user.email}. ` : ''}Choisis ton pilote, sous le nom utilisé dans le formulaire, ou entre comme visiteur.</p>
      </div>
      <form className="gate-card panel hud gate-onboard" onSubmit={confirm}>
        <span className="label">Pilotes</span>
        {free === null ? <p className="hint">Chargement des pilotes…</p> : (
          <div className="claim-grid" role="radiogroup" aria-label="Pilote">{active.map(card)}</div>
        )}
        {former.length > 0 && (
          <>
            <span className="label">Anciens pilotes</span>
            <div className="claim-grid" role="radiogroup" aria-label="Ancien pilote">{former.map(card)}</div>
          </>
        )}
        <span className="label">Pas pilote ?</span>
        <button type="button" role="radio" aria-checked={pick === 'visitor'} className={`visitor-card ${pick === 'visitor' ? 'on' : ''}`} onClick={() => setPick('visitor')}>
          <span className="visitor-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          </span>
          <span className="visitor-text"><b>Profil visiteur</b><span className="muted">Accès à toutes les stats en lecture, sans pilote ni Takes.</span></span>
        </button>

        {pick && pick !== 'visitor' && live && (
          <label className="field"><span>Pseudo dans l'app (facultatif)</span>
            <input id="nickname" type="text" maxLength={20} placeholder={pick === 'Ayann' ? 'Ex. Zay' : `Ex. Turbo ${pick}`} value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </label>
        )}
        <div className="gate-actions">
          <button className="btn btn-gold gate-submit" type="submit" disabled={!pick || busy}>
            {busy ? 'Un instant…' : !pick ? 'Fais ton choix' : pick === 'visitor' ? 'Entrer comme visiteur' : `Je suis ${pick}`}
          </button>
          <span className="hint">{pick && pick !== 'visitor' ? 'Choix définitif : ce pilote sera lié à ton compte.' : 'Un visiteur pourra devenir pilote plus tard depuis son profil.'}</span>
        </div>
        {msg && <p className="gate-msg" role="status">{msg}</p>}
      </form>
      {live && <p className="gate-foot muted"><button type="button" className="linkbtn" onClick={signOut}>Se déconnecter</button></p>}
      {!live && <p className="gate-foot muted">Aperçu de démonstration : aucun compte n'est créé.</p>}
    </GateLayout>
  );
}

export function GateLoading() {
  return (
    <GateLayout>
      <div className="boot" style={{ minHeight: 'auto' }}>
        <div className="lights" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p>Vérification de l'accès…</p>
      </div>
    </GateLayout>
  );
}

/** Compte banni par un admin : plus aucun accès aux données. */
export function BannedScreen() {
  const { signOut, session } = useAuth();
  return (
    <GateLayout>
      <div className="gate-intro">
        <h1>Accès retiré</h1>
        <p className="muted">Ce compte{session?.user.email ? ` (${session.user.email})` : ''} n'a plus accès à Pits Club. Si c'est une erreur, contacte un admin du club.</p>
      </div>
      <p className="gate-foot"><button type="button" className="btn" onClick={signOut}>Se déconnecter</button></p>
    </GateLayout>
  );
}
