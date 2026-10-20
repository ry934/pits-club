import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Avatar, Panel, PlayerTag } from '../components/ui';
import { clearMyAvatar, uploadMyAvatar } from '../lib/avatars';
import { getSupabase } from '../lib/supabase';
import { useStore } from '../store';
import { href } from '../router';
import { foundSecrets, SECRETS } from '../lib/secrets';


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
  const { me, nickname, session, signOut, refresh, live, admin } = useAuth();
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
            <a className="btn" href={href('stats', 'pilote', me!)}>Ma fiche</a>
            {admin && <a className="btn" href="#/admin">Back-office</a>}
            <button className="btn" onClick={signOut}>{live ? 'Se déconnecter' : 'Changer de pilote'}</button>
          </div>
        </div>
      </Panel>
      {live && <AvatarEditor />}
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
      <SecretHunter />
    </div>
  );
}

/** Compteur des easter eggs trouvés dans ce navigateur, avec un indice pour chacun des autres. */
function SecretHunter() {
  const [found] = useState(foundSecrets);
  return (
    <Panel hud="purple" title="Chasseur de secrets" aside={<span className="hint"><b className="num" style={{ color: 'var(--white)' }}>{found.length}</b> / {SECRETS.length}</span>}>
      <div className="stack">
        <div className="secret-bar" aria-hidden="true"><i style={{ width: `${(found.length / SECRETS.length) * 100}%` }} /></div>
        <ul className="secret-list">
          {SECRETS.map((x) => found.includes(x.id)
            ? <li key={x.id} className="ok"><b>{x.name}</b></li>
            : <li key={x.id}><b>???</b><span className="hint">{x.hint}</span></li>)}
        </ul>
        <span className="hint">{found.length === SECRETS.length ? 'Tout trouvé. Respect.' : 'Les secrets trouvés sont retenus sur cet appareil.'}</span>
      </div>
    </Panel>
  );
}


function AvatarEditor() {
  const { me } = useAuth();
  const { player, reload } = useStore();
  const p = player(me!);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = async (file?: File) => {
    if (!file || !p.id) return;
    if (!/^image\//.test(file.type)) { setMsg('Choisis une image (JPG, PNG ou WebP).'); return; }
    setBusy(true); setMsg(null);
    const err = await uploadMyAvatar(p.id, file).catch((e) => String(e?.message ?? e));
    setBusy(false);
    if (err) setMsg(/set_avatar|function/i.test(err) ? 'Les photos ne sont pas encore activées dans la base.' : err);
    else { setMsg('Photo mise à jour.'); reload(); }
  };
  const reset = async () => {
    setBusy(true);
    const err = await clearMyAvatar();
    setBusy(false);
    if (err) setMsg(err); else { setMsg('Photo retirée : retour à la photo par défaut.'); reload(); }
  };
  return (
    <Panel title="Ma photo">
      <div className="avatar-editor">
        <Avatar name={me!} size={88} />
        <div className="stack" style={{ gap: 8 }}>
          <div className="btn-row">
            <label className="btn btn-primary" htmlFor="avatar-file" aria-disabled={busy}>{busy ? 'Envoi…' : 'Changer ma photo'}</label>
            <input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
            {p.avatarPath && <button className="btn" onClick={reset} disabled={busy}>Revenir à la photo par défaut</button>}
          </div>
          <span className="hint">La photo est recadrée en carré et allégée automatiquement. Visible uniquement par les membres connectés.</span>
          {msg && <p className="form-msg">{msg}</p>}
        </div>
      </div>
    </Panel>
  );
}
