/**
 * Petits jingles synthétisés (Web Audio, aucun fichier son) pour le mode direct.
 * Le navigateur n'autorise le son qu'après un clic : `unlock()` doit être appelé depuis un bouton.
 */
export type Sfx = 'fanfare' | 'sad' | 'sparkle' | 'swoosh' | 'epic';

let ctx: AudioContext | null = null;

export function unlock() {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx && C) ctx = new C();
    void ctx?.resume();
  } catch { /* pas de son disponible */ }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', gain = 0.12, slideTo?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export function play(s: Sfx) {
  if (!ctx || ctx.state !== 'running') return;
  switch (s) {
    case 'fanfare':   // arpège montant façon ligne d'arrivée
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.16));
      tone(1047, 0.36, 0.5); tone(784, 0.36, 0.5, 'triangle', 0.08);
      break;
    case 'epic':      // badge rare : arpège plus long, avec écho
      [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.18, 'square', 0.1));
      tone(1319, 0.5, 0.8, 'triangle', 0.12); tone(1047, 0.5, 0.8, 'square', 0.06);
      break;
    case 'sad':       // « trombone triste » : trois notes qui descendent, la dernière qui s'effondre
      [392, 370, 349].forEach((f, i) => tone(f, i * 0.32, 0.3, 'sawtooth', 0.08));
      tone(330, 0.96, 0.9, 'sawtooth', 0.08, 220);
      break;
    case 'sparkle':   // badge : petites étincelles
      [1319, 1568, 2093, 2637].forEach((f, i) => tone(f, i * 0.07, 0.14, 'triangle', 0.09));
      break;
    case 'swoosh':    // changement de leader, outsider
      tone(220, 0, 0.35, 'sawtooth', 0.06, 880); tone(659, 0.3, 0.3, 'square', 0.08); tone(880, 0.42, 0.35, 'square', 0.08);
      break;
  }
}
