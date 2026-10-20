import { CSSProperties, useMemo, useState } from 'react';
import { Emblem } from '../components/Emblem';
import { Avatar, Empty, FormChips, Panel, PlacesBar } from '../components/ui';
import { BADGE, BADGES, BadgeDef, FAMILY_LABEL, Family, Holding, isInfamy, Rarity, RARITY_LABEL } from '../lib/badges';
import { fmtAvg, fmtShort, standings } from '../lib/stats';
import { SETTINGS } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store';

export const rarityClass = (b: BadgeDef) => `rc-${isInfamy(b) ? 'infamy' : b.rarity}`;

export function Trophees({ tab }: { tab?: string }) {
  const t = tab === 'pilotes' ? 'pilotes' : 'badges';
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t === 'badges' ? 'Achievements' : 'Pilotes'}</h1>
        <div className="tabs-line" role="tablist">
          <button role="tab" aria-selected={t === 'badges'} className={t === 'badges' ? 'on' : ''} onClick={() => { window.location.hash = '#/trophees'; }}>Trophées</button>
          <button role="tab" aria-selected={t === 'pilotes'} className={t === 'pilotes' ? 'on' : ''} onClick={() => { window.location.hash = '#/trophees/pilotes'; }}>Pilotes</button>
        </div>
      </header>
      {t === 'badges' ? <><Exploits /><Gallery /></> : <PilotList />}
    </div>
  );
}

/** Les derniers trophées notables débloqués (hors communs), anciennement sur le Paddock. */
function Exploits() {
  const { badges, dayList, player } = useStore();
  const lastDay = dayList.at(-1)!;
  const feed = useMemo(() => [...badges.events].reverse().filter((e) => BADGE[e.badge].rarity !== 'common').slice(0, 6), [badges]);
  if (feed.length === 0) return null;
  return (
    <Panel hud="yellow" title="Derniers exploits">
      <ul className="feed">
        {feed.map((e, k) => (
          <li key={k} className={e.day === lastDay ? 'fresh' : ''}>
            <Emblem badge={BADGE[e.badge]} size={36} />
            <span>
              <b>{player(e.player).displayName ?? e.player}</b> débloque <b className={rarityClass(BADGE[e.badge])} style={{ color: 'var(--rc)' }}>{BADGE[e.badge].name}</b>
              <span className="sub-num">{RARITY_LABEL[BADGE[e.badge].rarity]}{e.detail ? ` · ${e.detail}` : ''}</span>
            </span>
            <a className="hint" href={href('stats', 'session', e.day)}>{fmtShort(e.day)}</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type Status = 'all' | 'unlocked' | 'locked';

function Gallery() {
  const { badges, activeNames, dayList } = useStore();
  const lastDay = dayList.at(-1)!;
  const [who, setWho] = useState('');
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [family, setFamily] = useState<Family | ''>('');
  const [status, setStatus] = useState<Status>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const holders = useMemo(() => {
    const m = new Map<string, { name: string; h: Holding }[]>();
    for (const [name, map] of badges.held) for (const [id, h] of map) {
      const a = m.get(id) ?? []; a.push({ name, h }); m.set(id, a);
    }
    for (const a of m.values()) a.sort((x, y) => (x.h.first < y.h.first ? -1 : 1));
    return m;
  }, [badges]);

  const info = (b: BadgeDef) => {
    if (who) {
      const h = badges.held.get(who)?.get(b.id) ?? null;
      const prog = badges.progress.get(who)?.get(b.id) ?? 0;
      return { unlocked: !!h, h, prog, isNew: h?.last === lastDay };
    }
    const hs = holders.get(b.id) ?? [];
    return { unlocked: hs.length > 0, h: null, prog: 0, isNew: hs.some((x) => x.h.last === lastDay) };
  };

  const list = BADGES.filter((b) => (!rarity || b.rarity === rarity) && (!family || b.family === family))
    .filter((b) => status === 'all' || (status === 'unlocked') === info(b).unlocked);
  const unlockedCount = BADGES.filter((b) => info(b).unlocked).length;
  const sel = selected ? BADGES.find((b) => b.id === selected) : null;

  return (
    <>
      <div className="filters">
        <label className="field"><span>Collection</span>
          <select id="b-who" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Tout le groupe</option>
            {activeNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="field"><span>Rareté</span>
          <select id="b-rarity" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity | '')}>
            <option value="">Toutes</option>
            {(Object.keys(RARITY_LABEL) as Rarity[]).map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="field"><span>Famille</span>
          <select id="b-family" value={family} onChange={(e) => setFamily(e.target.value as Family | '')}>
            <option value="">Toutes</option>
            {(Object.keys(FAMILY_LABEL) as Family[]).map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
          </select>
        </label>
        <div className="field"><span>Statut</span>
          <div className="seg">
            {([['all', 'Tous'], ['unlocked', 'Débloqués'], ['locked', 'À débloquer']] as [Status, string][]).map(([k, l]) => (
              <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <span className="hint">{who || 'Le groupe'} : {unlockedCount} trophées débloqués sur {BADGES.length}. Survole ou ouvre un trophée pour voir sa condition.</span>

      {sel && <Detail badge={sel} who={who} holders={holders.get(sel.id) ?? []} onClose={() => setSelected(null)} />}

      {list.length === 0 ? <Empty>Aucun trophée ne correspond à ces filtres.</Empty> : (
        <div className="badge-grid">
          {list.map((b) => {
            const it = info(b);
            const hs = holders.get(b.id) ?? [];
            const pct = b.target ? Math.min(1, it.prog / b.target) : 0;
            return (
              <button key={b.id} className={`badge-card ${rarityClass(b)} ${it.unlocked ? '' : 'locked'} ${it.isNew ? 'new' : ''} ${selected === b.id ? 'selected' : ''}`}
                title={b.condition} aria-pressed={selected === b.id} onClick={() => setSelected(selected === b.id ? null : b.id)}>
                <Emblem badge={b} size={76} />
                <span className="rarity">{RARITY_LABEL[b.rarity]}</span>
                <span className="badge-name">{b.name}</span>
                <span className="badge-desc">{b.desc}</span>
                <span className="badge-foot">
                  {b.pending ? <span>{b.pending}</span>
                    : who ? (it.unlocked
                      ? <span className="gold">Débloqué le {fmtShort(it.h!.first)}{it.h!.count > 1 ? ` · ×${it.h!.count}` : ''}</span>
                      : b.target ? <><span className="progress" aria-hidden="true"><span style={{ width: `${pct * 100}%` }} /></span><span>Meilleur : {it.prog} / {b.target}</span></> : <span>Pas encore débloqué</span>)
                      : (hs.length ? <span>{hs.length} pilote{hs.length > 1 ? 's' : ''} · 1er : {hs[0].name}, {fmtShort(hs[0].h.first)}</span> : <span>Personne ne l'a encore</span>)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function Detail({ badge, who, holders, onClose }: { badge: BadgeDef; who: string; holders: { name: string; h: Holding }[]; onClose: () => void }) {
  return (
    <div className="chamfer-frame">
      <div className={`badge-detail chamfer ${rarityClass(badge)}`}>
        <Emblem badge={badge} size={120} />
        <div className="stack">
          <span className="rarity" style={{ width: 'fit-content' }}>{RARITY_LABEL[badge.rarity]} · {FAMILY_LABEL[badge.family]} · {badge.kind}</span>
          <h2 style={{ fontSize: '1.6rem' }}>{badge.name}</h2>
          <span>{badge.desc}</span>
          <span className="muted"><b style={{ color: 'var(--white)' }}>Condition :</b> {badge.condition}</span>
          {badge.pending ? <span className="hint">{badge.pending}.</span> : holders.length > 0 ? (
            <div className="holders">
              {holders.map((x) => (
                <a key={x.name} className="chip" style={{ '--c': 'var(--rc)', opacity: who && who !== x.name ? 0.5 : 1 } as CSSProperties} href={href('stats', 'pilote', x.name)}>
                  <Avatar name={x.name} size={22} />{x.name} <span className="num muted">×{x.h.count} · {fmtShort(x.h.first)}</span>
                </a>
              ))}
            </div>
          ) : <span className="hint">Personne ne l'a encore débloqué. À toi de jouer.</span>}
          <button className="btn btn-sm" style={{ width: 'fit-content' }} onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

function PilotList() {
  const { races, players, elo, lastSeen, badges } = useStore();
  const all = useMemo(() => new Map(standings(races).map((s) => [s.name, s])), [races]);
  const withRaces = players.filter((p) => all.has(p.name) && p.name !== 'Other');
  const active = withRaces.filter((p) => p.active).sort((a, b) => all.get(a.name)!.avg - all.get(b.name)!.avg);
  const former = withRaces.filter((p) => !p.active).sort((a, b) => all.get(b.name)!.races - all.get(a.name)!.races);
  const card = (name: string, color: string) => {
    const s = all.get(name)!;
    const recent = races.filter((r) => r.p.includes(name)).slice(-5).map((r) => r.p.indexOf(name) + 1);
    return (
      <a key={name} className="pilot-card" href={href('stats', 'pilote', name)} style={{ '--c': color, gridTemplateColumns: 'auto 1fr' } as CSSProperties}>
        <Avatar name={name} size={46} />
        <span className="stack" style={{ gap: 2 }}>
          <span style={{ font: '800 1.1rem var(--font-display)' }}>{name}</span>
          <span className="muted" style={{ fontSize: '0.85rem' }}><b className="num" style={{ color: 'var(--white)' }}>{fmtAvg(s.avg)}</b> moy. · {s.races} courses · cote {Math.round(elo.rating.get(name) ?? SETTINGS.eloStart)}</span>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{badges.held.get(name)?.size ?? 0} trophées · vu le {fmtShort(lastSeen.get(name)!)}</span>
        </span>
        <span style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}><PlacesBar places={s.places} total={s.races} /><FormChips positions={recent} /></span>
      </a>
    );
  };
  return (
    <>
      <div className="pilot-cards">{active.map((p) => card(p.name, p.color))}</div>
      {former.length > 0 && (
        <Panel title="Anciens pilotes"><div className="pilot-cards">{former.map((p) => card(p.name, p.color))}</div></Panel>
      )}
      <span className="hint">Ajouter un pilote : il suffit d'utiliser un nouveau nom dans le formulaire.</span>
    </>
  );
}
