import { Classement } from './pages/Classement';
import { Duel } from './pages/Duel';
import { Grille } from './pages/Grille';
import { Pilote, Pilotes } from './pages/Pilotes';
import { Profil } from './pages/Profil';
import { Records } from './pages/Records';
import { useRoute } from './router';
import { StoreProvider, useStore } from './store';

const TABS = [
  { key: 'grille', label: 'Grille', icon: 'M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z' },
  { key: 'classement', label: 'Classement', icon: 'M3 20h18M6 20v-6h4v6M10 20V8h4v12M14 20v-9h4v9' },
  { key: 'pilotes', label: 'Pilotes', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { key: 'duel', label: 'Duel', icon: 'M5 5l6 6M19 5l-6 6M8 14l-4 4M16 14l4 4M3 21l2-2M21 21l-2-2' },
  { key: 'records', label: 'Records', icon: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4h-4z' },
];

function Shell() {
  const route = useRoute();
  const { source } = useStore();
  const [page = 'grille', a, b] = route;
  const active = page === 'pilote' ? 'pilotes' : page;
  let body;
  switch (page) {
    case 'classement': body = <Classement />; break;
    case 'pilotes': body = <Pilotes />; break;
    case 'pilote': body = <Pilote name={a} key={a} />; break;
    case 'duel': body = <Duel a={a} b={b} />; break;
    case 'records': body = <Records />; break;
    case 'profil': body = <Profil />; break;
    default: body = <Grille day={page === 'grille' ? a : undefined} />;
  }
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-flag" aria-hidden="true" />
          <span className="brand-name">Pause Kart</span>
        </a>
        <nav className="tabs" aria-label="Navigation">
          {TABS.map((t) => (
            <a key={t.key} href={`#/${t.key}`} className={active === t.key ? 'on' : ''} aria-current={active === t.key ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
              <span>{t.label}</span>
            </a>
          ))}
        </nav>
        <a className={`profile-link ${active === 'profil' ? 'on' : ''}`} href="#/profil">
          {source === 'demo' ? 'Démo' : 'Profil'}
        </a>
      </header>
      <main>{body}</main>
    </div>
  );
}

export default function App() {
  return <StoreProvider><Shell /></StoreProvider>;
}
