import { useEffect, useMemo, useState } from 'react';
import { Avatar, Empty, MockNotice, Panel, PlayerTag, Section } from '../components/ui';
import { Countdown } from './Paddock';
import { nextDeadline } from '../lib/daily';
import { dayKey, fmtDay, sessionState } from '../lib/stats';
import { estimateProbability, pointsFor, resolveTake, RULE_KINDS, ruleLabel, TakeOutcome, TakeRule } from '../lib/takes';
import { mockTakeHistory, takeLeaderboard } from '../mock/takes';
import { useStore } from '../store';

type Mode = 'open' | 'locked' | 'revealed';
type MyTake = { author: string; rule: TakeRule; text: string; submitted: boolean };
const OUTCOME_LABEL: Record<TakeOutcome | 'pending', string> = { won: 'Validé', lost: 'Raté', void: 'Annulé', pending: 'En attente' };

function loadMine(): MyTake | null { try { const v = localStorage.getItem('mk.myTake'); return v ? JSON.parse(v) : null; } catch { return null; } }
function saveMine(t: MyTake | null) { try { t ? localStorage.setItem('mk.myTake', JSON.stringify(t)) : localStorage.removeItem('mk.myTake'); } catch { /* indisponible */ } }

function defaultMode(lastDay: string, closed: boolean): Mode {
  const now = new Date();
  const today = dayKey(now);
  if (now.getHours() < 13) return 'open';
  return lastDay === today && closed ? 'revealed' : 'locked';
}

function makeRule(kind: TakeRule['kind'], p1: string, p2: string, x: number): TakeRule {
  switch (kind) {
    case 'duel': return { kind, a: p1, b: p2 === p1 ? '' : p2 };
    case 'avg-better': case 'avg-worse': return { kind, p: p1, x };
    case 'wins-min': return { kind, p: p1, n: Math.max(1, Math.round(x)) };
    case 'win-streak': return { kind, p: p1, n: Math.max(2, Math.round(x)) };
    case 'volume': return { kind, n: Math.max(1, Math.round(x)) };
    default: return { kind, p: p1 } as TakeRule;
  }
}

export function Takes() {
  const { byDay, dayList, elo, activeNames, closedDays } = useStore();
  const lastDay = dayList.at(-1)!;
  const lastRaces = byDay.get(lastDay)!;
  const closed = sessionState(lastDay, lastRaces, closedDays) === 'closed';
  const [mode, setMode] = useState<Mode>(() => defaultMode(lastDay, closed));
  const [mine, setMineRaw] = useState<MyTake | null>(loadMine);
  const setMine = (t: MyTake | null) => { setMineRaw(t); saveMine(t); };
  const [me, setMe] = useState(() => mine?.author ?? activeNames[0]);
  const lineup = useMemo(() => [...new Set(lastRaces.flatMap((r) => r.p))].filter((p) => p !== 'Other'), [lastRaces]);
  const avgRaces = useMemo(() => { const d = dayList.slice(-20); return d.reduce((s, x) => s + byDay.get(x)!.length, 0) / d.length; }, [dayList, byDay]);
  const history = useMemo(() => mockTakeHistory(byDay, elo, 20), [byDay, elo]);
  const round = history.filter((t) => t.day === lastDay && t.author !== me);
  const board = useMemo(() => takeLeaderboard(history), [history]);
  const deadline = useMemo(() => nextDeadline(), []);
  const [revealed, setRevealed] = useState(false);
  const [lights, setLights] = useState(0);

  // ------ constructeur
  const [kind, setKind] = useState<TakeRule['kind']>(mine?.rule.kind ?? 'duel');
  const [p1, setP1] = useState(me);
  const [p2, setP2] = useState(() => lineup.find((n) => n !== me) ?? activeNames[1]);
  const [x, setX] = useState(2.5);
  const [text, setText] = useState(mine?.text ?? '');
  useEffect(() => { if (kind === 'wins-min') setX(3); else if (kind === 'win-streak') setX(3); else if (kind === 'volume') setX(12); else if (kind.startsWith('avg')) setX(2.5); }, [kind]);
  const draftRule = makeRule(kind, p1, p2, x);
  const valid = draftRule.kind !== 'duel' || (draftRule.a && draftRule.b);
  const shownRule = mine?.submitted ? mine.rule : draftRule;
  const prob = useMemo(() => valid ? estimateProbability(shownRule, lineup, elo.rating, avgRaces, 1500, 7) : 0.5, [JSON.stringify(shownRule), lineup, elo, avgRaces, valid]);
  const pts = pointsFor(prob);
  const editable = mode === 'open';
  const myOutcome: TakeOutcome | 'pending' = mode === 'revealed' && mine?.submitted ? resolveTake(mine.rule, lastRaces) : 'pending';

  const startReveal = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setLights(6); setRevealed(true); return; }
    let i = 0;
    const t = setInterval(() => { i++; setLights(i); if (i >= 6) { clearInterval(t); setRevealed(true); } }, 280);
  };

  const number = kind === 'avg-better' || kind === 'avg-worse';
  return (
    <div className="page">
      <header className="page-head">
        <h1>Prediction arena</h1>
        <MockNotice>
          Données simulées. Les Takes des autres pilotes sont fictifs mais résolus sur les vrais résultats, et ton Take reste dans ce navigateur.
          Les vrais Takes (comptes, secret jusqu'à la révélation, reformulation par l'IA) arrivent au lot 2.
        </MockNotice>
      </header>

      <div className="sim-bar">
        <label className="field"><span>Je suis</span>
          <select id="me" value={me} onChange={(e) => { setMe(e.target.value); setP1(e.target.value); }} disabled={!!mine?.submitted}>
            {activeNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="field"><span>Simuler le moment</span>
          <div className="seg">
            {(['open', 'locked', 'revealed'] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setRevealed(false); setLights(0); }}>
                {m === 'open' ? 'Avant 13h' : m === 'locked' ? 'Verrouillé' : 'Après la session'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-paddock">
        <div className="stack">
          <Panel hud="purple" title={mine?.submitted ? 'Mon Take' : 'Préparer mon Take'} className="take-arena" aside={
            <span className={`outcome ${myOutcome}`}>{mine?.submitted ? (mode === 'open' ? 'Envoyé' : mode === 'locked' ? 'Verrouillé' : OUTCOME_LABEL[myOutcome]) : 'Brouillon'}</span>
          }>
            <div className="stack">
              {!mine?.submitted ? (
                <>
                  <label className="field"><span>Ta prédiction, avec tes mots</span>
                    <textarea id="take-text" rows={2} value={text} disabled={!editable} placeholder="Ex. Romain va mettre Baptiste dans le rétro" onChange={(e) => setText(e.target.value)} />
                  </label>
                  <div className="builder">
                    <label className="field"><span>Type</span>
                      <select id="take-kind" value={kind} disabled={!editable} onChange={(e) => setKind(e.target.value as TakeRule['kind'])}>
                        {RULE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                      </select>
                    </label>
                    {kind !== 'volume' && (
                      <label className="field"><span>{kind === 'duel' ? 'Pilote devant' : 'Pilote'}</span>
                        <select id="take-p1" value={p1} disabled={!editable} onChange={(e) => setP1(e.target.value)}>{activeNames.map((n) => <option key={n}>{n}</option>)}</select>
                      </label>
                    )}
                    {kind === 'duel' && (
                      <label className="field"><span>Pilote derrière</span>
                        <select id="take-p2" value={p2} disabled={!editable} onChange={(e) => setP2(e.target.value)}>{activeNames.filter((n) => n !== p1).map((n) => <option key={n}>{n}</option>)}</select>
                      </label>
                    )}
                    {['avg-better', 'avg-worse', 'wins-min', 'win-streak', 'volume'].includes(kind) && (
                      <label className="field"><span>{number ? 'Moyenne' : kind === 'volume' ? 'Courses' : 'Nombre'}</span>
                        <input id="take-x" type="number" step={number ? 0.05 : 1} min={number ? 1 : 1} max={number ? 4 : 40} value={x} disabled={!editable} onChange={(e) => setX(Number(e.target.value))} />
                      </label>
                    )}
                  </div>
                </>
              ) : <p className="take-text" style={{ margin: 0 }}>« {mine.text || ruleLabel(mine.rule)} »</p>}

              <div className="stack" style={{ gap: 6 }}>
                <span className="label">Règle vérifiable</span>
                <span className="take-rule">{valid ? ruleLabel(shownRule) : 'Choisis deux pilotes différents'}</span>
                <span className="hint">Au lot 2, l'IA proposera cette reformulation à partir de ta phrase ; tu la valideras avant envoi.</span>
              </div>

              <div className="odds">
                <div className="stat"><span className="label">Probabilité</span><span className="stat-value violet num">{Math.round(prob * 100)} %</span></div>
                <div className="stat"><span className="label">Gain si validé</span><span className="stat-value gold num">{pts} pts</span></div>
                <div className="odds-gauge" aria-hidden="true"><span style={{ width: `${prob * 100}%` }} /></div>
              </div>
              <span className="hint">Cote estimée en rejouant 1 500 fois une session de {Math.round(avgRaces)} courses avec les présents de la dernière session ({lineup.join(', ')}). Gain = 10 ÷ probabilité, plafonné à 100.</span>

              {editable && (
                mine?.submitted
                  ? <button className="btn" onClick={() => setMine({ ...mine, submitted: false })}>Modifier mon Take</button>
                  : <button className="btn btn-purple" disabled={!valid} onClick={() => setMine({ author: me, rule: draftRule, text, submitted: true })}>Valider mon Take</button>
              )}
              {!editable && !mine?.submitted && <span className="hint">Les Takes sont fermés depuis 13h00. Rendez-vous demain matin.</span>}
              {mine?.submitted && mode !== 'revealed' && <button className="btn btn-sm" onClick={() => setMine(null)} disabled={!editable}>Supprimer</button>}
            </div>
          </Panel>

          <Section title={`Takes du ${fmtDay(lastDay, false)}`} aside={<span className="hint">{round.length + (mine?.submitted ? 1 : 0)} Takes postés</span>}>
            {mode === 'revealed' && !revealed && (
              <Panel hud="red">
                <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
                  <div className={`lights-row ${lights >= 6 ? 'go' : ''}`} aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={lights >= i ? 'on' : ''} />)}</div>
                  <span className="muted">La session est terminée. Les Takes peuvent être dévoilés.</span>
                  <button className="btn btn-gold" onClick={startReveal} disabled={lights > 0}>Lancer la révélation</button>
                </div>
              </Panel>
            )}
            <div className="reveal-grid">
              {round.map((t, i) => {
                const open = mode === 'revealed' && revealed;
                if (!open) {
                  return (
                    <div key={t.id} className="take-card sealed">
                      <PlayerTag name={t.author} />
                      <span className="muted">Take scellé. Contenu visible à la révélation.</span>
                      <div className="take-foot"><span className="outcome pending">Scellé</span></div>
                    </div>
                  );
                }
                return (
                  <div key={t.id} className={`take-card flip ${t.outcome}`} style={{ animationDelay: `${i * 0.18}s` }}>
                    <PlayerTag name={t.author} />
                    <span className="take-text">« {t.text} »</span>
                    <span className="take-rule">{t.label}</span>
                    <div className="take-foot">
                      <span className="hint num">{Math.round(t.probability * 100)} % · {t.points} pts</span>
                      <span className={`outcome ${t.outcome}`}>{OUTCOME_LABEL[t.outcome]}{t.outcome === 'won' ? ` +${t.points}` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="stack">
          <Panel hud="purple" title="Prochaine clôture" className="glow-edge">
            <div className="stack">
              <span className="muted">{fmtDay(dayKey(deadline), false)}, 13h00</span>
              <Countdown to={deadline} />
              <span className="hint">Un Take par pilote et par jour, modifiable jusqu'à 13h00, révélé à la fin de la session.</span>
            </div>
          </Panel>

          <Panel hud="yellow" title="Classement des pronostiqueurs" aside={<span className="hint">20 dernières sessions</span>}>
            {board.length === 0 ? <Empty>Pas encore de Takes résolus.</Empty> : (
              <ol className="feed">
                {board.map((l, i) => (
                  <li key={l.name} style={{ gridTemplateColumns: '28px 1fr auto' }}>
                    <span className={`num ${i === 0 ? 'gold' : 'muted'}`}>{i + 1}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar name={l.name} size={28} />
                      <span style={{ minWidth: 0 }}><b>{l.name}</b><span className="sub-num">{l.played ? Math.round((l.won / l.played) * 100) : 0} % de réussite · {l.won}/{l.played}</span></span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <b className={`num ${i === 0 ? 'gold' : ''}`}>{l.points} pts</b>
                      <span className="form-chips" aria-label="Derniers Takes">{l.recent.map((o, k) => <i key={k} style={{ background: o === 'won' ? 'var(--green)' : o === 'lost' ? 'var(--red)' : 'var(--edge-2)' }} />)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
