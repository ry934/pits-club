import { useId } from 'react';
import { BadgeDef, isInfamy } from '../lib/badges';

/** Emblèmes originaux : la forme du cadre dit la rareté, la matière dit la famille (rouge = infamie). */
const METAL: Record<string, [string, string, string]> = {
  common: ['#ffd2a8', '#c97b45', '#6e3b1d'],
  uncommon: ['#ffffff', '#b9c4e2', '#5c6788'],
  rare: ['#c8fbff', '#28e7ff', '#0b6f8a'],
  epic: ['#e9dcff', '#a879ff', '#4b2a99'],
  legendary: ['#fff6c4', '#ffd84d', '#a3720b'],
  infamy: ['#ffc2ca', '#ff4057', '#7a0d1d'],
};

function frame(rarity: string): string {
  switch (rarity) {
    case 'common': return 'M36 4 L64 20 L64 52 L36 68 L8 52 L8 20 Z';                         // hexagone
    case 'uncommon': return 'M12 8 H60 V36 C60 52 48 62 36 68 C24 62 12 52 12 36 Z';           // écusson
    case 'rare': return 'M36 2 L70 36 L36 70 L2 36 Z';                                           // losange
    case 'epic': {                                                                               // étoile à 8 branches
      const pts: string[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI / 8) * i - Math.PI / 2, r = i % 2 ? 26 : 34;
        pts.push(`${(36 + r * Math.cos(a)).toFixed(1)} ${(36 + r * Math.sin(a)).toFixed(1)}`);
      }
      return 'M' + pts.join(' L') + ' Z';
    }
    default: return 'M24 6 H48 L64 22 V50 L48 66 H24 L8 50 V22 Z';                              // octogone
  }
}

const GLYPHS: Record<string, JSX.Element> = {
  centurion: <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="currentColor" stroke="none" fontFamily="Oxanium, sans-serif">100</text>,
  '500-club': <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="currentColor" stroke="none" fontFamily="Oxanium, sans-serif">500</text>,
  'millennium-racer': <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor" stroke="none" fontFamily="Oxanium, sans-serif">1K</text>,
  'grand-slam': <path d="M7 3h10v4a5 5 0 0 1-10 0zM7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4M12 12v4M8 21h8M9.5 16h5v5h-5z" />,
  'living-legend': <><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7M12 8.5v7" /><path d="M4 4l2 2M20 4l-2 2M4 20l2-2M20 20l-2-2" /></>,
  unstoppable: <path d="M3 5l7 7-7 7M11 5l7 7-7 7M19 5v14" />,
  'king-of-the-hill': <><path d="M2 21l7-9 4 5 3-4 6 8z" /><path d="M8 8l2-4 2 3 2-3 2 4z" /></>,
  'comeback-king': <path d="M6 20V9a5 5 0 0 1 10 0v4M12 9l4 4 4-4" />,
  phoenix: <path d="M12 22c-4-2-6-5-5-9 1 2 2 3 3 3-1-4 1-8 4-11 0 4 2 6 3 8 1-1 1-2 1-3 2 4 1 9-6 12z" />,
  'giant-slayer': <path d="M12 2v14M9 16h6M12 16v5M10 21h4M9 5l3-3 3 3" />,
  'perfect-session': <><circle cx="12" cy="12" r="9" /><path d="M7.5 12.5l3 3 6-6.5" /></>,
  'mr-consistent': <path d="M3 20h18M6 20V8h5v12M13 20V8h5v12M6 4h12" />,
  'winning-machine': <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  nemesis: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" /></>,
  'hot-streak': <path d="M13 2L5 13h6l-2 9 9-12h-6z" />,
  'choke-artist': <path d="M3 5l5 5 4-3 4 7 5 5M16 19h5v-5" />,
  'wooden-spoon': <><ellipse cx="12" cy="7" rx="4" ry="5" /><path d="M12 12v10" /></>,
  'called-it': <path d="M12 3v12M12 19v2M7 8l-3-3M17 8l3-3" />,
  'main-character': <><path d="M12 2l2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 7.8l5.4-.8z" /><path d="M6 21h12" /></>,
  completionist: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14.5 17.5l2 2 4-4" /></>,
  'dark-horse': <path d="M6 21v-5c0-4 2-7 5-9l1-3 2 3c3 1 5 4 5 7l-3 1-2-2-2 3v5M14 8h.01" />,
  'marathon-runner': <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M10 2h4M12 2v3" /></>,
  'plot-twist': <path d="M4 7h11a4 4 0 0 1 0 8H8M8 15l3-3M8 15l3 3M20 17H9" />,
  'giant-killer': <path d="M4 20L20 4M14 4h6v6M4 14l6 6M3 21l3-3" />,
  'sweet-revenge': <><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z" /><path d="M9 11l2 2 4-4" /></>,
  'rivalry-winner': <path d="M4 20l7-7M20 20l-7-7M4 4l6 6M20 4l-6 6M9 20h6" />,
  'the-troll': <><circle cx="12" cy="12" r="9" /><path d="M8 14c1.5 2 6.5 2 8 0M8 9h2M14 9h2" /></>,
  'loyal-racer': <><rect x="3" y="4" width="18" height="17" rx="1" /><path d="M3 9h18M8 2v4M16 2v4M7 14l2 2 4-4" /></>,
  'no-days-off': <><rect x="3" y="4" width="18" height="17" rx="1" /><path d="M3 9h18M8 2v4M16 2v4M8 13h2M12 13h2M16 13h0M8 17h2M12 17h2" /></>,
  'veteran-racer': <path d="M5 3h14v6l-7 4-7-4zM5 13l7 4 7-4M5 17l7 4 7-4" />,
  'the-collector': <><rect x="3" y="6" width="18" height="14" rx="1" /><path d="M7 6V3h10v3M7 13h2M11 13h2M15 13h2" /></>,
  'record-breaker': <path d="M3 17l6-6 4 4 8-8M15 7h6v6M3 21h18" />,
  'dead-last': <path d="M5 4v17M5 4h12l-3 4 3 4H5" />,
  cursed: <><path d="M4 19c4-1 6-5 8-10 2 5 4 9 8 10" /><path d="M9 5l3-3 3 3M8 22h8" /></>,
  oracle: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><path d="M12 9l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  'high-roller': <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01" strokeWidth="3" /></>,
  'all-in': <path d="M4 16l4-8 4 6 4-10 4 12M3 20h18" />,
  'madame-irma': <><circle cx="12" cy="10" r="7" /><path d="M8 21h8M10 17l-1 4M14 17l1 4M10 8a3 3 0 0 1 3-2" /></>,
  sandbagger: <path d="M6 4h12l-1 6H7zM7 10l-2 10h14l-2-10M10 14h4" />,
  'big-mouth': <path d="M3 11v2a2 2 0 0 0 2 2h2l6 4V5L7 9H5a2 2 0 0 0-2 2zM17 8a5 5 0 0 1 0 8M20 5a9 9 0 0 1 0 14" />,
  'humble-bragger': <path d="M7 20V10l4-7c1.5 0 2.5 1 2 3l-1 4h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2zM3 10h4v10H3z" />,
  'mind-reader': <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  'false-prophet': <><circle cx="12" cy="11" r="7" /><path d="M10 4l2 5-2 3 3 3-1 3M7 21h10" /></>,
};

export function Emblem({ badge, size = 72 }: { badge: BadgeDef; size?: number }) {
  const id = useId().replace(/:/g, '');
  const tone = isInfamy(badge) ? 'infamy' : badge.rarity;
  const [hi, mid, lo] = METAL[tone];
  const shape = frame(badge.rarity);
  return (
    <svg className="emblem" width={size} height={size} viewBox="0 0 72 72" role="img" aria-label={badge.name}>
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} /><stop offset="0.45" stopColor={mid} /><stop offset="1" stopColor={lo} />
        </linearGradient>
        <linearGradient id={`i${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2240" /><stop offset="1" stopColor="#0d1020" />
        </linearGradient>
      </defs>
      {badge.rarity === 'legendary' && (
        <g fill={mid} opacity="0.85">
          <path d="M8 30c-6 6-6 16 2 22-2-7 0-14 4-18zM64 30c6 6 6 16-2 22 2-7 0-14-4-18z" />
        </g>
      )}
      <path d={shape} fill={`url(#m${id})`} />
      <path d={shape} fill={`url(#i${id})`} transform="translate(36 36) scale(0.78) translate(-36 -36)" />
      <path d={shape} fill="none" stroke={hi} strokeOpacity="0.5" strokeWidth="1" transform="translate(36 36) scale(0.78) translate(-36 -36)" />
      <g transform="translate(22 22) scale(1.17)" fill="none" stroke={mid} color={mid} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[badge.id]}
      </g>
      <path d="M20 10 L30 10 L14 26 L14 16 Z" fill="#fff" opacity="0.14" />
    </svg>
  );
}
