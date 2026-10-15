import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Panel, PlayerTag } from '../components/ui';
import { getSupabase } from '../lib/supabase';
import { useStore } from '../store';
import { href } from '../router';


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
  const { me, visitor } = useAuth();
  return (
    <div className="page">
      <header className="page-head"><h1>{me ? 'Mon profil' : 'Profil visiteur'}</h1></header>
      {me ? <MyProfile /> : visitor ? <VisitorProfile /> : null}
    </div>
  );
}

function VisitorProfile() {
  const { live, session, signOut, refresh } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const becomePilot = async () => {
    if (!live) { await signOut(); return; }
    const { error } = await (await getSupabase())!.auth.updateUser({ data: { role: null } });
    if (error) setMsg(error.message); else refresh();
  };
  return (
    <Panel hud="cyan" title="Accès visiteur">
      <div className="stack">
        <p style={{ margin: 0 }}>Tu consultes toutes les stats en lecture. Les Takes, la présence et la clôture de session sont réservées aux pilotes.</p>
        {live && <span className="hint">{session?.user.email}</span>}
        <div className="btn-row">
          <button className="btn btn-primary" onClick={becomePilot}>{live ? 'Je suis en fait un pilote' : 'Changer de profil'}</button>
          {live && <button className="btn" onClick={signOut}>Se déconnecter</button>}
        </div>
        {msg && <p className="form-msg">{msg}</p>}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ profil

function MyProfile() {
  const { me, nickname, session, signOut, refresh, live } = useAuth();
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
          <div className="btn-row">
            <a className="btn btn-primary" href="#/">Mon paddock</a>
            <a className="btn" href={href('pilote', me!)}>Ma fiche</a>
            <button className="btn" onClick={signOut}>{live ? 'Se déconnecter' : 'Changer de pilote'}</button>
          </div>
        </div>
      </Panel>
      {live && <Panel title="Mon pseudo">
        <form className="form" onSubmit={save}>
          <label className="field"><span>Pseudo affiché dans l'app</span>
            <input id="nickname-edit" type="text" maxLength={20} placeholder={me!} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button className="btn" type="submit">Enregistrer</button>
          <span className="hint">Laisse vide pour revenir à « {me} ».</span>
          {msg && <p className="form-msg">{msg}</p>}
        </form>
      </Panel>}
    </div>
  );
}

