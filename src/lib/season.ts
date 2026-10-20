/**
 * Thèmes de saison, appliqués automatiquement selon la date : Halloween (24 oct. au 1er nov.),
 * neige en décembre, classement lu à l'envers le 1er avril.
 * Pour prévisualiser : ajouter ?saison=halloween (ou noel, avril, aucune) à l'adresse.
 */
export type Season = 'halloween' | 'noel' | 'avril' | null;

export function seasonOf(d = new Date()): Season {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 10 && day >= 24) || (m === 11 && day === 1)) return 'halloween';
  if (m === 12) return 'noel';
  if (m === 4 && day === 1) return 'avril';
  return null;
}

export function currentSeason(): Season {
  try {
    const q = new URLSearchParams(window.location.search).get('saison');
    if (q !== null) return (['halloween', 'noel', 'avril'].includes(q) ? q : null) as Season;
  } catch { /* adresse illisible */ }
  return seasonOf();
}
