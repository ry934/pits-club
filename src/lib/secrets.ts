/**
 * Easter eggs : la liste des secrets, ceux déjà trouvés (mémorisés dans ce navigateur) et un petit bus
 * d'événements pour déclencher les effets visuels depuis n'importe quelle page.
 */
export type SecretId = 'konami' | 'logo' | 'name' | 'leet' | 'boom' | 'dice' | 'vanity';

export const SECRETS: { id: SecretId; name: string; hint: string }[] = [
  { id: 'konami', name: 'Mode miroir', hint: 'Un très vieux code de console. Ça commence par monter deux fois.' },
  { id: 'logo', name: "Tour d'honneur", hint: "Le logo n'aime pas qu'on l'ignore. Insiste." },
  { id: 'name', name: 'Appel du pilote', hint: "Écris le nom d'un pilote, n'importe où, sans champ de saisie." },
  { id: 'leet', name: 'Heure LEET', hint: "Regarde l'horloge du mode direct au bon moment." },
  { id: 'boom', name: 'Tête chercheuse', hint: 'Sur le classement, un mot de quatre lettres fait très mal au leader.' },
  { id: 'dice', name: 'Le hasard a parlé', hint: 'Dans le lexique, le hasard répond quand on le titille trois fois.' },
  { id: 'vanity', name: 'Miroir, mon beau miroir', hint: 'Ton propre avatar, sur le Paddock. Un peu trop de clics.' },
];

const KEY = 'mk.secrets';

export function foundSecrets(): SecretId[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Marque un secret comme trouvé ; affiche le toast la première fois seulement. */
export function discover(id: SecretId) {
  const found = foundSecrets();
  if (found.includes(id)) return;
  const next = [...found, id];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* indisponible */ }
  window.dispatchEvent(new CustomEvent('mk:secret', { detail: { id, count: next.length } }));
}

export type FxEvent =
  | { type: 'mirror' } | { type: 'kart' } | { type: 'lap'; name: string } | { type: 'boom'; target: DOMRect }
  | { type: 'dice' } | { type: 'toast'; text: string };

export function fx(e: FxEvent) { window.dispatchEvent(new CustomEvent('mk:fx', { detail: e })); }
