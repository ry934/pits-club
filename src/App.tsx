import { Paddock } from './pages/Paddock';
import { Stats } from './pages/Stats';
import { Takes } from './pages/Takes';
import { Trophees } from './pages/Trophees';
import { Profil } from './pages/Profil';
import { Direct } from './pages/Direct';
import { Admin } from './pages/Admin';
import { useRoute } from './router';
import { Fx } from './components/Fx';
import { StoreProvider, useStore } from './store';
import { AuthProvider, useAuth } from './auth';
import { BannedScreen, GateLoading, LoginScreen, Onboarding } from './pages/Gate';
import { Avatar, BrandMark } from './components/ui';
import { dayKey, sessionState } from './lib/stats';

const NAV = [
  { key: 'paddock', label: 'Paddock', icon: 'M3 21V9l9-6 9 6v12M9 21v-6h6v6M3 13h18' },
  { key: 'stats', label: 'Stats', icon: 'M3 20h18M6 20v-6h3v6M11 20V8h3v12M16 20v-9h3v9' },
  { key: 'takes', label: 'Takes', icon: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z' },
  { key: 'trophees', label: 'Trophées', icon: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4h-4z' },
];
const TITLES: Record<string, string> = {
  paddock: 'Paddock', stats: 'Statistiques', takes: 'Takes', trophees: 'Trophées', profil: 'Profil', admin: 'Back-office',
};
const ALIASES: Record<string, string> = { classement: 'stats', records: 'stats', pilotes: 'trophees' };
/** Anciennes adresses (liens Slack, favoris) : elles ouvrent désormais un onglet de Stats. */
const STATS_TABS: Record<string, string> = { session: 'session', grille: 'session', pilote: 'pilote', rivalites: 'duels', duel: 'duels' };

function SessionChip() {
  const { byDay, dayList, closedDays } = useStore();
  const today = dayKey(new Date());
  const last = dayList.at(-1);
  if (last !== today) return <span className="state state-closed">Pas de session<span className="long">&nbsp;aujourd'hui</span></span>;
  const live = sessionState(today, byDay.get(today)!, closedDays) === 'live';
  return (
    <a href={live ? '#/direct' : `#/stats/session/${today}`} className={`state ${live ? 'state-live' : 'state-closed'}`} title={live ? 'Ouvrir le mode direct' : undefined}>
      {live ? 'En course' : <>Terminée<span className="long">&nbsp;· {byDay.get(today)!.length} courses</span></>}
    </a>
  );
}

function AdminLink() {
  const { admin } = useAuth();
  return admin ? <a className="btn btn-sm" href="#/admin">Back-office</a> : null;
}

function MeButton({ compact }: { compact?: boolean }) {
  const { me, visitor } = useAuth();
  const { player } = useStore();
  if (visitor) return <a className="btn btn-sm me-chip" href="#/profil"><span>Visiteur</span></a>;
  if (me) {
    return (
      <a className="btn btn-sm me-chip" href="#/profil" aria-label="Mon profil">
        <Avatar name={me} size={20} /><span className="me-name">{player(me).displayName ?? me}</span>
      </a>
    );
  }
  return <a className="btn btn-sm" href="#/profil">{compact ? 'Profil' : 'Mon profil'}</a>;
}

function Shell() {
  const route = useRoute();
  const { source, races } = useStore();
  const [raw0 = 'paddock', ...rest] = route;
  const legacy = STATS_TABS[raw0];
  const [raw, a, b, c] = legacy ? ['stats', legacy, ...rest] : [raw0, ...rest];
  const page = ALIASES[raw] ?? raw;
  if (page === 'direct' && races.length > 0) return <><Direct /><Fx /></>;
  const section = page;
  let body;
  if (races.length === 0 && page !== 'profil' && page !== 'admin') body = <Waiting />;
  else switch (page) {
    case 'stats': body = <Stats tab={raw === 'records' ? 'records' : a} arg={b} arg2={c} />; break;
    case 'takes': body = <Takes />; break;
    case 'trophees': body = <Trophees tab={raw === 'pilotes' ? 'pilotes' : a} />; break;
    case 'profil': body = <Profil />; break;
    case 'admin': body = <Admin />; break;
    default: body = <Paddock />;
  }
  const navLinks = (cls: string) => NAV.map((n) => (
    <a key={n.key} href={`#/${n.key}`} className={section === n.key ? 'on' : ''} aria-current={section === n.key ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={n.icon} /></svg>
      <span className={cls}>{n.label}</span>
    </a>
  ));
  return (
    <div className="shell">
      <div className="track-bg" aria-hidden="true" />
      <aside className="sidebar">
        <a className="brand" href="#/">
          <BrandMark />
          <span className="brand-text"><span className="brand-name">Pits Club</span><span className="brand-sub">MK expert mode</span></span>
        </a>
        <nav className="nav" aria-label="Sections">{navLinks('')}</nav>
        <div className="sidebar-foot">
          <a className="btn btn-sm live-link" href="#/direct">Mode direct</a>
          <AdminLink />
          <MeButton />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <a className="mobile-brand" href="#/"><BrandMark /><span className="brand-name">Pits Club</span></a>
          <span className="topbar-title">{TITLES[page] ?? 'Paddock'}</span>
          <div className="topbar-right">
            <SessionChip />
            <MeButton compact />
          </div>
        </header>
        <main className="content" key={`${page}/${page === 'stats' ? a ?? '' : ''}`}>
          <span className="route-swoosh" aria-hidden="true" />
          <div className="route-in">{body}</div>
        </main>
      </div>
      <nav className="bottomnav" aria-label="Sections">{navLinks('')}</nav>
      <Fx />
    </div>
  );
}

/** Base branchée mais encore vide : les courses arrivent avec la synchro du Google Sheet. */
function Waiting() {
  const { reload } = useStore();
  return (
    <div className="page">
      <div className="chamfer-frame">
        <section className="hero chamfer" style={{ gridTemplateColumns: '1fr' }}>
          <span className="speed" aria-hidden="true" />
          <div className="hero-body">
            <span className="label cyan">Grille de départ</span>
            <span className="hero-name">En attente des courses</span>
            <span className="muted">L'app est en ligne et connectée à la base. Aucune course n'y est encore enregistrée : elles arriveront dès que la synchro du Google Sheet sera lancée.</span>
            <div><button className="btn btn-primary" onClick={reload}>Recharger</button></div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  return <AuthProvider><Gate /></AuthProvider>;
}

/** Rien n'est chargé ni affiché avant la connexion et le choix d'un profil (pilote ou visiteur). */
function Gate() {
  const { live, loading, session, me, visitor, banned } = useAuth();
  if (live && loading) return <GateLoading />;
  if (live && !session) return <LoginScreen />;
  if (banned) return <BannedScreen />;
  if (!me && !visitor) return <Onboarding />;
  return <StoreProvider><Shell /></StoreProvider>;
}
