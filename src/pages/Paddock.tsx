import { CSSProperties, ReactNode, useEffect, useMemo, useState } from 'react';
import { Avatar, Panel } from '../components/ui';
import { dailyChallenge, horoscope, nextDeadline, rivalryOfTheDay } from '../lib/daily';
import { greeting } from '../lib/greeting';
import { useAiHoroscopes } from '../lib/horoscopeAi';
import { sessionFacts } from '../lib/bot/facts';
import { debriefStory } from '../lib/bot/messages';
import { useSettings } from '../lib/settings';
import { dayKey, fmtDay, fmtDuration, sessionState } from '../lib/stats';
import { href } from '../router';
import { useStore } from '../store';
import { useAuth } from '../auth';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function Countdown({ to }: { to: Date }) {
  const now = useNow();
  const s = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 1000));
  const parts = [[Math.floor(s / 3600), 'h'], [Math.floor((s % 3600) / 60), 'min'], [s % 60, 's']] as const;
  return (
    <div className="countdown" role="timer" aria-label={`Clôture dans ${parts[0][0]} heures ${parts[1][0]} minutes`}>
      {parts.map(([v, u]) => <div key={u} className="cd"><b>{pad(v)}</b><span>{u}</span></div>)}
    </div>
  );
}

/** Le texte du bot est écrit pour Slack (*gras*, _italique_) : on le rend tel quel dans l'app. */
function slackText(t: string): ReactNode[] {
  return t.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).filter(Boolean).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') ? <b key={i}>{part.slice(1, -1)}</b>
      : part.startsWith('_') && part.endsWith('_') ? <i key={i}>{part.slice(1, -1)}</i> : part);
}

/** Paddock : le rituel du jour. Les chiffres détaillés vivent dans Stats. */
export function Paddock() {
  const { races, byDay, dayList, elo, activeNames, player, closedDays } = useStore();
  const { me, session, admin } = useAuth();
  const { settings } = useSettings();
  const now = new Date();
  const today = dayKey(now);
  const lastDay = dayList.at(-1)!;
  const live = lastDay === today && sessionState(today, byDay.get(today)!, closedDays) === 'live';

  const display = me ? player(me).displayName ?? me : '';
  const hello = useMemo(() => (me ? greeting(me, display, races, now) : null), [me, display, races, today]);
  const [astroFor, setAstroFor] = useState(() => me ?? activeNames[0]);
  const aiAstro = useAiHoroscopes(!!session && !!me, today, admin);
  const localAstro = useMemo(() => horoscope(astroFor, races, today), [astroFor, races, today]);
  const astro = aiAstro.byName[astroFor] ?? localAstro;
  const rivalry = useMemo(() => rivalryOfTheDay(races, activeNames, today), [races, activeNames, today]);
  const challenge = useMemo(() => dailyChallenge(today, races, byDay.get(today) ?? []), [today, races, byDay]);
  const deadline = useMemo(() => nextDeadline(), []);

  const facts = useMemo(() => sessionFacts(lastDay, races, elo), [lastDay, races, elo]);
  const story = useMemo(() => facts && debriefStory(facts, {
    tone: settings.bot_tone, appUrl: '', label: (n) => player(n).displayName ?? n,
    optout: settings.roast_optout, recent: [], includeTakes: false,
  }), [facts, settings.bot_tone, settings.roast_optout, player]);
  const storyTitle = live ? 'Le récit en direct' : lastDay === today ? 'Le récit du jour' : 'Le récit de la dernière session';

  return (
    <div className="page">
      <div className="chamfer-frame">
        <section className="hero chamfer me-hero" style={{ '--c': me ? player(me).color : 'var(--cyan)' } as CSSProperties}>
          <span className="speed" aria-hidden="true" />
          {me && <div className="hero-avatar"><Avatar name={me} size={96} /></div>}
          <div className="hero-body">
            <span className="label cyan">{me ? 'Ton paddock' : 'Le paddock'} · {fmtDay(today, false)}</span>
            {hello ? <p className="me-hello">{hello}</p> : <p className="me-hello">Bienvenue au paddock. Les chiffres sont dans Stats, les paris dans Takes.</p>}
            <div className="btn-row">
              {live && <a className="btn btn-primary live-link" href="#/direct">Session en cours · mode direct</a>}
              {me && <a className="btn btn-sm" href={href('stats', 'pilote', me)}>Ma fiche</a>}
              <a className="btn btn-sm" href={href('stats', 'session', lastDay)}>{lastDay === today ? 'Session du jour' : 'Dernière session'}</a>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-paddock">
        <div className="stack">
          {facts && story && (
            <Panel hud="cyan" title={storyTitle} className="story" aside={<a className="link" href={href('stats', 'session', lastDay)}>Voir la session</a>}>
              <div className="stack">
                <span className="label" style={{ textTransform: 'none', letterSpacing: '0.04em' }}>
                  {fmtDay(lastDay, false).replace(/^./, (c) => c.toUpperCase())} · {facts.races} courses · {fmtDuration(facts.minutes)} · {facts.table.length} pilotes
                </span>
                <p className="story-text">{slackText(story)}</p>
              </div>
            </Panel>
          )}

          {rivalry && (
            <Panel hud="red" title="Rivalité du jour" aside={<a className="link" href={href('stats', 'duels', rivalry.a, rivalry.b)}>Voir le duel</a>}>
              <div className="stack">
                <div className="vs">
                  <div className="vs-side"><Avatar name={rivalry.a} size={44} /><b>{player(rivalry.a).displayName ?? rivalry.a}</b><span className="num">{Math.round(rivalry.pct * 100)} %</span></div>
                  <span className="vs-mark">VS</span>
                  <div className="vs-side"><Avatar name={rivalry.b} size={44} /><b>{player(rivalry.b).displayName ?? rivalry.b}</b><span className="num">{Math.round((1 - rivalry.pct) * 100)} %</span></div>
                </div>
                <div className="duel-meter" aria-hidden="true">
                  <span style={{ width: `${rivalry.pct * 100}%`, background: player(rivalry.a).color }} />
                  <span style={{ flex: 1, background: player(rivalry.b).color }} />
                </div>
                <span className="hint">{rivalry.shared} courses ensemble sur 90 jours. Le duel le plus serré du moment.</span>
              </div>
            </Panel>
          )}

          <Panel hud="green" title="Défi du jour">
            <div className="stack">
              <h3>{challenge.title}</h3>
              <span className="muted">{challenge.detail}</span>
              {challenge.results ? (
                <div className="challenge-results">
                  {challenge.results.map((r) => <span key={r.name} className={r.done ? 'ok' : ''}>{r.done ? '✓' : '·'} {r.name} <b className="num">{r.value}</b></span>)}
                </div>
              ) : <span className="hint">À jouer lors de la prochaine session.</span>}
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel hud="purple" title="Takes du jour" className="glow-edge">
            <div className="stack">
              <span className="muted">Clôture des Takes le {fmtDay(dayKey(deadline), false)} à 13h00</span>
              <Countdown to={deadline} />
              <a className="btn btn-purple" href="#/takes">Préparer mon Take</a>
            </div>
          </Panel>

          <Panel hud="purple" title={astroFor === me ? 'Ton horoscope du jour' : 'Horoscope du jour'} className="horoscope" aside={
            <select id="astro-player" aria-label="Pilote" value={astroFor} onChange={(e) => setAstroFor(e.target.value)}>
              {activeNames.map((n) => <option key={n} value={n}>{n === me ? 'Moi' : player(n).displayName ?? n}</option>)}
            </select>
          }>
            <div className="stack">
              {aiAstro.status === 'loading' && !aiAstro.byName[astroFor]
                ? <p className="hint astro-loading">Madame Kartmira lit le journal du jour et consulte une boule de cristal en forme de carapace…</p>
                : <>
                  <span className="sign">Signe : {astro.sign}</span>
                  {astro.news && <span className="astro-news">Inspiré de l'actu : {astro.news}</span>}
                  <ul>{astro.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  <span className="hint">
                    Place porte-bonheur : P{astro.lucky}.{astro.star ? ` Astre du jour : ${player(astro.star).displayName ?? astro.star}.` : ''}
                    {!astro.ai && aiAstro.status === 'off' && session ? ' (version de secours, les astres IA sont en pause)' : ''}
                  </span>
                  {aiAstro.regenerate && aiAstro.status !== 'loading' && (
                    <button type="button" className="btn btn-sm" onClick={aiAstro.regenerate}>Relancer les astres (admin)</button>
                  )}
                </>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
