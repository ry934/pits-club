import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, BrandMark, Cote, CountUp } from '../components/ui';
import { Emblem } from '../components/Emblem';
import { BADGE, RARITY_LABEL } from '../lib/badges';
import { liveFeed, liveTable, Moment, nextRaceOdds, raceMoments } from '../lib/live';
import { useSettings } from '../lib/settings';
import { play, Sfx, unlock } from '../lib/sfx';
import { dayKey, fmtAvg, fmtDay, fmtDuration, fmtTime, ratingAt, sessionState } from '../lib/stats';
import { SETTINGS } from '../lib/types';
import { useStore } from '../store';
import { discover } from '../lib/secrets';

/**
 * Mode direct : écran plein cadre laissé ouvert sur le PC pendant la session, lisible à 3-4 mètres.
 * Tout tient sur un écran sans défiler. À chaque nouvelle course, les moments forts (hat trick, spirale de 4e,
 * changement de leader, badge débloqué) s'affichent en grand, avec un jingle si le son est activé.
 */

const SHOW_MS = 4600;
const SOUND_KEY = 'mk.liveSound';
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; } };

type Shown = Moment & { badgeRarity?: string };

export function Direct() {
  const { byDay, dayList, closedDays, elo, player, sync, badges } = useStore();
  const { settings } = useSettings();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const today = dayKey(now);
  const day = byDay.has(today) ? today : dayList.at(-1);
  const races = day ? byDay.get(day)! : [];
  const state = day ? sessionState(day, races, closedDays, now) : 'closed';
  const label = useCallback((n: string) => player(n).displayName ?? n, [player]);

  const table = useMemo(() => liveTable(races), [races]);
  const feed = useMemo(() => liveFeed(races, elo, label).slice(0, 10), [races, elo, label]);
  const last = races.at(-1);
  const odds = useMemo(() => (last ? nextRaceOdds([...last.p], elo) : []), [last, elo]);

  // ---------------------------------------------------------------- son
  const [sound, setSound] = useState(readSound);
  const toggleSound = () => {
    const v = !sound;
    if (v) { unlock(); setTimeout(() => play('sparkle'), 50); }
    setSound(v);
    try { localStorage.setItem(SOUND_KEY, v ? '1' : '0'); } catch { /* indisponible */ }
  };
  // le navigateur exige un clic pour jouer du son : tout clic sur l'écran le débloque
  useEffect(() => { if (!sound) return; const on = () => unlock(); window.addEventListener('pointerdown', on); return () => window.removeEventListener('pointerdown', on); }, [sound]);

  // ---------------------------------------------------------------- file des célébrations
  const [queue, setQueue] = useState<Shown[]>([]);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    if (sound) play((current.badgeRarity === 'epic' || current.badgeRarity === 'legendary' ? 'epic' : current.sound) as Sfx);
    const t = setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // nouvelle course : flash du bloc « dernière course » + moments forts + badges apparus
  const lastId = useRef(last?.id);
  const seenBadges = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(false);
  const badgeKeys = useMemo(() => badges.events.filter((e) => e.day === day).map((e) => ({ e, key: `${e.badge}|${e.player}|${e.detail ?? ''}` })), [badges, day]);
  useEffect(() => {
    if (seenBadges.current === null) { seenBadges.current = new Set(badgeKeys.map((b) => b.key)); return; }
    if (!last || lastId.current === undefined || last.id === lastId.current) { lastId.current = last?.id; return; }
    lastId.current = last.id;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 6000);
    const moments: Shown[] = raceMoments(races, elo, label, settings.roast_optout);
    for (const { e, key } of badgeKeys) {
      if (seenBadges.current.has(key) || e.player === 'Other') continue;
      seenBadges.current.add(key);
      const b = BADGE[e.badge];
      if (!b || b.rarity === 'common') continue;
      moments.push({ id: `badge-${key}`, tone: 'purple', sound: 'sparkle', who: e.player, badge: e.badge, badgeRarity: b.rarity, kicker: `Trophée ${RARITY_LABEL[b.rarity].toLowerCase()}`, title: `${label(e.player)} débloque ${b.name}` });
    }
    if (moments.length) setQueue((q) => [...q, ...moments.slice(0, 5)]);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, badgeKeys]);

  // bouton « Tester » : rejoue des moments factices avec les pilotes du jour
  const demo = () => {
    unlock();
    const names = table.map((r) => r.name);
    const a = names[0] ?? 'Pilote', b = names.at(-1) ?? a;
    const rare = Object.values(BADGE).find((x) => x.rarity === 'epic') ?? Object.values(BADGE)[0];
    const stamp = Date.now();
    setQueue((q) => [...q,
      { id: `demo1-${stamp}`, tone: 'gold', sound: 'fanfare', who: a, kicker: 'Hat trick !', title: `3e victoire du jour pour ${label(a)}` },
      { id: `demo2-${stamp}`, tone: 'red', sound: 'sad', who: b, kicker: 'Lanterne rouge', title: `3e 4e place pour ${label(b)}` },
      { id: `demo3-${stamp}`, tone: 'purple', sound: 'sparkle', who: a, badge: rare.id, badgeRarity: rare.rarity, kicker: `Trophée ${RARITY_LABEL[rare.rarity].toLowerCase()}`, title: `${label(a)} débloque ${rare.name}` },
    ]);
  };

  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {});
  };

  const top = (count: number, sub?: string) => (
    <LiveTop state={state} now={now} count={count} sync={sync} onFull={fullscreen} sub={sub} sound={sound} onSound={toggleSound} onDemo={count ? demo : undefined} />
  );

  if (!day || !last) {
    return (
      <div className="live">
        {top(0)}
        <div className="live-empty"><p>Aucune course pour l'instant. L'écran s'animera dès la première réponse au formulaire.</p></div>
      </div>
    );
  }

  const isToday = day === today;
  const idle = Math.round((now.getTime() - last.ts.getTime()) / 60000);

  return (
    <div className={`live live-tv ${fresh ? 'is-fresh' : ''}`}>
      {top(races.length, isToday ? `${fmtTime(races[0].ts)} – ${fmtTime(last.ts)} · ${fmtDuration(races.length * SETTINGS.raceMinutes)} de jeu` : `Dernière session : ${fmtDay(day)}`)}

      <div className="live-grid">
        <section className="live-panel live-board" aria-label="Classement de la session">
          <header className="live-h"><span>Classement de la session</span><span className="hint">5 dernières · moyenne · écart au leader</span></header>
          <ol className="live-rows" style={{ '--n': table.length } as CSSProperties}>
            {table.map((r) => (
              <li key={r.name} className={`live-row ${r.rank === 1 ? 'is-lead' : ''} ${current?.who === r.name ? `is-hot hot-${current.tone}` : ''}`} style={{ '--c': player(r.name).color } as CSSProperties}>
                <span className="live-rank num">{r.rank}</span>
                <span className={`live-move ${r.move > 0 ? 'up' : r.move < 0 ? 'down' : ''}`} aria-label={r.move ? `${r.move > 0 ? '+' : ''}${r.move} place(s)` : 'stable'}>
                  {r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–'}
                </span>
                <Avatar name={r.name} size={64} />
                <span className="live-name">
                  <b>{label(r.name)}</b>
                  <span className="live-meta">
                    <span className="nw">{r.races} courses</span> · <span className="nw">{r.wins} vict.</span>
                    {r.streak ? <em className={r.streak.kind === 'win' ? 'good' : 'bad'}>{r.streak.kind === 'win' ? ` · série ${r.streak.n}` : ` · ${r.streak.n}× 4e`}</em> : null}
                    <span className="live-cote"> · cote <Cote v={ratingAt(elo, r.name, day)} delta={ratingAt(elo, r.name, day) - ratingAt(elo, r.name, day, true)} /></span>
                  </span>
                </span>
                <span className="live-last5">{r.last5.map((p, i) => <i key={i} className={`lp lp-${p}`}>{p}</i>)}</span>
                <span className="live-score">
                  <span className="live-avg num">{fmtAvg(r.avg)}</span>
                  <span className="live-gap num">{r.rank === 1 ? 'Leader' : `+${fmtAvg(r.gap)}`}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`live-panel live-race ${fresh ? 'flash' : ''}`} aria-label="Dernière course">
          <header className="live-h">
            <span>{fresh ? 'Nouvelle course' : 'Dernière course'} · n°{races.length}</span>
            <span className="hint">{fmtTime(last.ts)}{isToday && state === 'live' ? ` · il y a ${idle < 1 ? 'moins d’1' : idle} min` : ''}</span>
          </header>
          <ol className="live-result">
            {last.p.map((n, i) => (
              <li key={n} className={`p${i + 1}`} style={{ '--c': player(n).color } as CSSProperties}>
                <span className="live-pos">P{i + 1}</span><Avatar name={n} size={40} /><b>{label(n)}</b>
              </li>
            ))}
          </ol>
        </section>

        <section className="live-panel live-odds" aria-label="Cote de la prochaine course">
          <header className="live-h"><span>Course suivante · chances de victoire</span></header>
          <ul className="live-oddlist">
            {odds.map((o) => (
              <li key={o.name} style={{ '--c': player(o.name).color, '--w': `${Math.round(o.p * 100)}%` } as CSSProperties}>
                <span className="live-oddname">{label(o.name)}</span>
                <span className="live-oddbar"><i /></span>
                <span className="num">{Math.round(o.p * 100)} %</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="live-panel live-feed" aria-label="Fil du direct">
          <header className="live-h"><span>Fil du direct</span></header>
          <ul className="live-events">
            {feed.map((e, i) => (
              <li key={`${e.n}-${e.kind}-${e.who}`} className={`ev ev-${e.kind} ${i === 0 && fresh ? 'new' : ''}`}>
                <span className="ev-n num">C{e.n}</span><span className="ev-t">{e.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {current && <Celebration m={current} key={current.id} />}
    </div>
  );
}

/** Le moment fort en plein écran : grand titre, avatar, badge éventuel, pluie de confettis (ou de 4e places). */
function Celebration({ m }: { m: Shown }) {
  const { player } = useStore();
  const bits = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 1.4, dur: 2.2 + Math.random() * 1.8, rot: Math.random() * 360, size: 8 + Math.random() * 10, k: i % 4,
  })), []);
  const badge = m.badge ? BADGE[m.badge] : null;
  return (
    <div className={`celeb celeb-${m.tone}`} role="status" aria-live="assertive" style={{ '--c': player(m.who).color } as CSSProperties}>
      <div className="celeb-rain" aria-hidden="true">
        {bits.map((b, i) => (
          <i key={i} className={`k${b.k}`} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, width: b.size, height: m.tone === 'red' ? b.size : b.size * 0.45, '--r': `${b.rot}deg` } as CSSProperties}>
            {m.tone === 'red' ? '4' : ''}
          </i>
        ))}
      </div>
      <div className="celeb-card">
        <span className="celeb-rays" aria-hidden="true" />
        <div className="celeb-visual">
          {badge ? <span className="celeb-emblem"><Emblem badge={badge} size={180} /></span> : <span className="celeb-avatar"><Avatar name={m.who} size={170} /></span>}
        </div>
        <span className="celeb-kicker">{m.kicker}</span>
        <h2 className="celeb-title">{m.title}</h2>
        {badge && <span className="celeb-sub">{badge.condition}</span>}
        <span className="celeb-timer" aria-hidden="true" style={{ animationDuration: `${SHOW_MS}ms` }} />
      </div>
    </div>
  );
}

function LiveTop({ state, now, count, sub, sync, onFull, sound, onSound, onDemo }: {
  state: 'live' | 'closed'; now: Date; count: number; sub?: string;
  sync: { mode: string; checkedAt: Date | null }; onFull: () => void; sound: boolean; onSound: () => void; onDemo?: () => void;
}) {
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0'), ss = String(now.getSeconds()).padStart(2, '0');
  useEffect(() => { if (hh === '13' && mm === '37') discover('leet'); }, [hh, mm]);
  return (
    <header className="live-top">
      <a className="live-brand" href="#/" title="Retour au paddock"><BrandMark /><span className="brand-name">Pits Club</span></a>
      <span className={`live-pill ${state === 'live' ? 'on' : ''}`}>{state === 'live' ? 'En direct' : 'Hors course'}</span>
      <span className="live-sub">{sub}</span>
      <span className="live-count"><span className="label">Courses</span><b className="num"><CountUp value={count} /></b></span>
      {hh === '13' && mm === '37' ? <span className="live-clock num leet" title="13:37">LEET</span> : <span className="live-clock num">{hh}:{mm}<small>:{ss}</small></span>}
      <span className={`live-sync ${sync.mode}`} title={sync.checkedAt ? `Dernière vérification ${fmtTime(sync.checkedAt)}` : ''}>
        {sync.mode === 'realtime' ? 'Temps réel' : sync.mode === 'polling' ? 'Actualisation auto' : 'Démo'}
      </span>
      <button type="button" className={`btn btn-sm live-sound ${sound ? 'on' : ''}`} onClick={onSound} aria-pressed={sound}>{sound ? 'Son activé' : 'Son coupé'}</button>
      {onDemo && <button type="button" className="btn btn-sm" onClick={onDemo} title="Rejoue trois animations d'exemple">Tester</button>}
      <button type="button" className="btn btn-sm live-full" onClick={onFull}>Plein écran</button>
      <a className="btn btn-sm" href="#/">Quitter</a>
    </header>
  );
}
