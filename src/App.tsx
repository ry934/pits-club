import { Paddock } from './pages/Paddock';
import { Session } from './pages/Session';
import { Stats } from './pages/Stats';
import { Rivalites } from './pages/Rivalites';
import { Takes } from './pages/Takes';
import { Trophees } from './pages/Trophees';
import { Pilote } from './pages/Pilote';
import { Profil } from './pages/Profil';
import { useRoute } from './router';
import { StoreProvider, useStore } from './store';
import { BrandMark } from './components/ui';
import { dayKey, sessionState } from './lib/stats';

const NAV = [
  { key: 'paddock', label: 'Paddock', icon: 'M3 21V9l9-6 9 6v12M9 21v-6h6v6M3 13h18' },
  { key: 'stats', label: 'Stats', icon: 'M3 20h18M6 20v-6h3v6M11 20V8h3v12M16 20v-9h3v9' },
  { key: 'rivalites', label: 'Rivalités', icon: 'M5 4l7 7M19 4l-7 7M8 13l-4 4M16 13l4 4M3 21l2-2M21 21l-2-2' },
  { key: 'takes', label: 'Takes', icon: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z' },
  { key: 'trophees', label: 'Trophées', icon: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4h-4z' },
];
const TITLES: Record<string, string> = {
  paddock: 'Paddock', session: 'Session', stats: 'Statistiques', rivalites: 'Rivalités', takes: 'Takes',
  trophees: 'Trophées', pilote: 'Pilote', profil: 'Profil',
};
const ALIASES: Record<string, string> = { grille: 'session', duel: 'rivalites', classement: 'stats', records: 'stats', pilotes: 'trophees' };

function SessionChip() {
  const { byDay, dayList, closedDays } = useStore();
  const today = dayKey(new Date());
  const last = dayList.at(-1);
  if (last !== today) return <span className="state state-closed">Pas de session<span className="long">&nbsp;aujourd'hui</span></span>;
  const live = sessionState(today, byDay.get(today)!, closedDays) === 'live';
  return (
    <a href={`#/session/${today}`} className={`state ${live ? 'state-live' : 'state-closed'}`}>
      {live ? 'En course' : <>Terminée<span className="long">&nbsp;· {byDay.get(today)!.length} courses</span></>}
    </a>
  );
}

function Shell() {
  const route = useRoute();
  const { source, races } = useStore();
  const [raw = 'paddock', a, b] = route;
  const page = ALIASES[raw] ?? raw;
  const section = page === 'session' ? 'paddock' : page === 'pilote' ? 'trophees' : page;
  let body;
  if (races.length === 0 && page !== 'profil') body = <Waiting />;
  else switch (page) {
    case 'session': body = <Session day={a} />; break;
    case 'stats': body = <Stats tab={raw === 'records' ? 'records' : a} />; break;
    case 'rivalites': body = <Rivalites a={a} b={b} />; break;
    case 'takes': body = <Takes />; break;
    case 'trophees': body = <Trophees tab={raw === 'pilotes' ? 'pilotes' : a} />; break;
    case 'pilote': body = <Pilote name={a} key={a} />; break;
    case 'profil': body = <Profil />; break;
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
          <span className="brand-text"><span className="brand-name">Pits Club</span><span className="brand-sub">Neon Grand Prix</span></span>
        </a>
        <nav className="nav" aria-label="Sections">{navLinks('')}</nav>
        <div className="sidebar-foot">
          <a className="btn btn-sm" href="#/profil">{source === 'demo' ? 'Mode démo' : 'Mon profil'}</a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <a className="mobile-brand" href="#/"><BrandMark /><span className="brand-name">Pits Club</span></a>
          <span className="topbar-title">{TITLES[page] ?? 'Paddock'}</span>
          <div className="topbar-right">
            <SessionChip />
            <a className="btn btn-sm" href="#/profil" aria-label="Profil">{source === 'demo' ? 'Démo' : 'Profil'}</a>
          </div>
        </header>
        <main className="content">{body}</main>
      </div>
      <nav className="bottomnav" aria-label="Sections">{navLinks('')}</nav>
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
  return <StoreProvider><Shell /></StoreProvider>;
}
