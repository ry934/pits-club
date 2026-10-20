// Fichier généré par « npm run build:api » à partir de server/bot.ts : ne pas modifier à la main.

// src/lib/types.ts
var SETTINGS = {
  raceMinutes: 2.77,
  minRacesDayRecord: 5,
  minSharedH2H: 10,
  hideOpponentAfterDays: 60,
  sessionIdleMinutes: 20,
  dedupeSeconds: 60,
  eloK: 12,
  eloStart: 1500,
  formWindow: 20,
  minRacesWeekday: 5
};

// src/lib/stats.ts
function parseLocal(iso) {
  const [d, t = "00:00:00"] = iso.replace(" ", "T").split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm, ss] = t.split(":").map(Number);
  return new Date(y, m - 1, dd, hh, mm, ss || 0);
}
function cleanRaces(raw) {
  const sorted = [...raw].map((r) => ({ ...r, ts: r.ts.replace(" ", "T") })).sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  const kept = [];
  const replaced = [];
  for (const r of sorted) {
    const prev = kept.at(-1);
    if (prev && (parseLocal(r.ts).getTime() - parseLocal(prev.ts).getTime()) / 1e3 < SETTINGS.dedupeSeconds) {
      replaced.push({ replaced: prev, by: r });
      kept[kept.length - 1] = r;
    } else kept.push(r);
  }
  const races = [];
  const flagged = [];
  for (const r of kept) {
    if (new Set(r.p).size < 4) {
      flagged.push({ ...r, reason: "duplicate-name" });
      continue;
    }
    races.push({ id: races.length, ts: parseLocal(r.ts), iso: r.ts, day: r.ts.slice(0, 10), p: r.p, src: r.src });
  }
  return { races, flagged, replaced };
}
var pad = (n) => String(n).padStart(2, "0");
var fmtTime = (d) => `${pad(d.getHours())}h${pad(d.getMinutes())}`;
var fmtAvg = (n) => n.toFixed(2).replace(".", ",");
function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h} h ${pad(m)}` : `${m} min`;
}
function standings(races) {
  const m = /* @__PURE__ */ new Map();
  for (const r of races) {
    r.p.forEach((name, i) => {
      let s = m.get(name);
      if (!s) {
        s = { name, races: 0, sum: 0, avg: 0, wins: 0, places: [0, 0, 0, 0], rank: 0 };
        m.set(name, s);
      }
      s.races++;
      s.sum += i + 1;
      s.places[i]++;
      if (i === 0) s.wins++;
    });
  }
  const list = [...m.values()];
  list.forEach((s) => s.avg = s.sum / s.races);
  list.sort((a, b) => a.avg - b.avg || b.wins - a.wins || b.races - a.races);
  list.forEach((s, i) => s.rank = i + 1);
  return list;
}
var winProb = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
function computeElo(races) {
  const R = /* @__PURE__ */ new Map();
  const get = (n) => R.get(n) ?? SETTINGS.eloStart;
  const before = [];
  const dayRating = /* @__PURE__ */ new Map();
  for (const r of races) {
    const pre = r.p.map(get);
    before[r.id] = pre;
    const delta = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const d = SETTINGS.eloK * (1 - winProb(pre[i], pre[j]));
      delta[i] += d;
      delta[j] -= d;
    }
    r.p.forEach((n, i) => {
      const v = pre[i] + delta[i] / 3;
      R.set(n, v);
      const h = dayRating.get(n) ?? [];
      if (h.at(-1)?.day === r.day) h[h.length - 1].rating = v;
      else h.push({ day: r.day, rating: v });
      dayRating.set(n, h);
    });
  }
  return { rating: R, before, dayRating };
}
function ratingAt(elo, name, day, strict = false) {
  const h = elo.dayRating.get(name);
  if (!h?.length) return SETTINGS.eloStart;
  if (!day) return elo.rating.get(name) ?? h.at(-1).rating;
  let v = SETTINGS.eloStart;
  for (const x of h) {
    if (strict ? x.day < day : x.day <= day) v = x.rating;
    else break;
  }
  return v;
}

// src/lib/takes.ts
var RULE_KINDS = [
  { kind: "duel", label: "Duel : X finit devant Y" },
  { kind: "avg-better", label: "Moyenne meilleure que\u2026" },
  { kind: "avg-worse", label: "Moyenne moins bonne que\u2026" },
  { kind: "wins-min", label: "Au moins N victoires" },
  { kind: "no-win", label: "Aucune victoire" },
  { kind: "best-of-day", label: "Meilleur du jour" },
  { kind: "win-streak", label: "S\xE9rie de victoires" },
  { kind: "volume", label: "Nombre de courses" }
];
function ruleLabel(r, L = (n) => n) {
  switch (r.kind) {
    case "duel":
      return `${L(r.a)} finit devant ${L(r.b)}`;
    case "avg-better":
      return `${L(r.p)} fait mieux que ${fmtAvg(r.x)} de moyenne`;
    case "avg-worse":
      return `${L(r.p)} fait moins bien que ${fmtAvg(r.x)} de moyenne`;
    case "wins-min":
      return `${L(r.p)} gagne au moins ${r.n} course${r.n > 1 ? "s" : ""}`;
    case "no-win":
      return `${L(r.p)} ne gagne aucune course`;
    case "best-of-day":
      return `${L(r.p)} termine meilleur du jour`;
    case "win-streak":
      return `${L(r.p)} encha\xEEne ${r.n} victoires d'affil\xE9e`;
    case "volume":
      return `Au moins ${r.n} courses dans la session`;
  }
}
var rulePlayers = (r) => r.kind === "duel" ? [r.a, r.b] : r.kind === "volume" ? [] : [r.p];
var MIN_RACES = 3;
function resolveTake(rule, dayRaces) {
  if (!dayRaces.length) return "void";
  if (rule.kind === "volume") return dayRaces.length >= rule.n ? "won" : "lost";
  const table = standings(dayRaces);
  const row = (n) => table.find((t) => t.name === n);
  for (const n of rulePlayers(rule)) if ((row(n)?.races ?? 0) < MIN_RACES) return "void";
  const ok = (b) => b ? "won" : "lost";
  switch (rule.kind) {
    case "duel":
      return ok(row(rule.a).avg < row(rule.b).avg);
    case "avg-better":
      return ok(row(rule.p).avg < rule.x);
    case "avg-worse":
      return ok(row(rule.p).avg > rule.x);
    case "wins-min":
      return ok(row(rule.p).wins >= rule.n);
    case "no-win":
      return ok(row(rule.p).wins === 0);
    case "best-of-day":
      return ok(table[0].name === rule.p);
    case "win-streak": {
      let run = 0, bestRun = 0;
      for (const r of dayRaces) {
        if (!r.p.includes(rule.p)) continue;
        run = r.p[0] === rule.p ? run + 1 : 0;
        bestRun = Math.max(bestRun, run);
      }
      return ok(bestRun >= rule.n);
    }
  }
}
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// src/lib/bot/facts.ts
function takeVerdict(t, dayRaces) {
  if (t.status !== "pending") return t.status;
  if (!t.rule) return "manual";
  return resolveTake(t.rule, dayRaces);
}
function sessionFacts(day, all, elo, takes = []) {
  const races = all.filter((r) => r.day === day);
  if (!races.length) return null;
  const st = standings(races).map((s) => ({ ...s, lasts: s.places[3] }));
  const mvp = st[0];
  const flop = [...st].sort((a, b) => b.avg - a.avg || b.lasts - a.lasts)[0];
  let winStreak = null, lossStreak = null;
  for (const s of st) {
    let w = 0, l = 0, bw = 0, bl = 0;
    for (const r of races) {
      if (!r.p.includes(s.name)) continue;
      w = r.p[0] === s.name ? w + 1 : 0;
      l = r.p[3] === s.name ? l + 1 : 0;
      bw = Math.max(bw, w);
      bl = Math.max(bl, l);
    }
    if (bw >= 3 && (!winStreak || bw > winStreak.n)) winStreak = { name: s.name, n: bw };
    if (bl >= 3 && (!lossStreak || bl > lossStreak.n)) lossStreak = { name: s.name, n: bl };
  }
  let upset = null;
  for (const r of races) {
    const pre = elo.before[r.id];
    if (!pre) continue;
    const fav = pre.indexOf(Math.max(...pre));
    const gap = pre[fav] - pre[0];
    if (pre[0] === Math.min(...pre) && gap >= 60 && (!upset || gap > upset.gap)) upset = { name: r.p[0], beat: r.p[fav], gap: Math.round(gap) };
  }
  const moves = st.map((s) => ({ name: s.name, delta: ratingAt(elo, s.name, day) - ratingAt(elo, s.name, day, true) }));
  const up = [...moves].sort((a, b) => b.delta - a.delta)[0];
  const down = [...moves].sort((a, b) => a.delta - b.delta)[0];
  const perfect = st.find((s) => s.races >= 4 && s.wins === s.races)?.name ?? null;
  const winless = st.filter((s) => s.races >= 5 && s.wins === 0).map((s) => s.name);
  const gapTop2 = st.length > 1 ? st[1].avg - st[0].avg : null;
  const scenario = races.length >= 6 && mvp.wins / mvp.races >= 0.5 ? "domination" : gapTop2 !== null && gapTop2 <= 0.12 && races.length >= 6 ? "serre" : lossStreak && lossStreak.n >= 4 ? "spirale" : races.length >= 25 ? "marathon" : races.length < 8 ? "courte" : "standard";
  return {
    day,
    races: races.length,
    minutes: Math.round(races.length * SETTINGS.raceMinutes),
    start: races[0].ts,
    end: races.at(-1).ts,
    table: st,
    mvp,
    flop,
    gapTop2,
    winStreak,
    lossStreak,
    upset,
    eloUp: up && up.delta >= 8 ? { name: up.name, delta: Math.round(up.delta) } : null,
    eloDown: down && down.delta <= -8 ? { name: down.name, delta: Math.round(down.delta) } : null,
    perfect,
    winless,
    takes: takes.map((t) => ({ take: t, verdict: takeVerdict(t, races) })),
    scenario
  };
}

// src/lib/bot/messages.ts
var TAQ = ["taquin", "piquant"];
var ALL = ["sobre", "taquin", "piquant"];
var pl = (n, one, many = one + "s") => `${n} ${n > 1 ? many : one}`;
var OPEN = {
  domination: [
    { id: "o-dom-1", t: (c) => `Waouh. Waouh, waouh, waouh. Mais que s'est-il pass\xE9 ce midi ? ${c.L(c.mvp.name)} a roul\xE9 sur tout le monde, et cette fois personne ne pourra accuser la manette.` },
    { id: "o-dom-2", t: (c) => `Il y a des sessions de kart. Et il y a les sessions o\xF9 ${c.L(c.mvp.name)} d\xE9cide que les autres sont des plots de signalisation. Aujourd'hui, c'\xE9tait la deuxi\xE8me cat\xE9gorie.` },
    { id: "o-dom-3", t: (c) => `Communiqu\xE9 officiel : ${c.L(c.mvp.name)} a confisqu\xE9 la session. Les autres pilotes sont pri\xE9s de r\xE9cup\xE9rer leur dignit\xE9 \xE0 l'accueil.` },
    { id: "o-dom-4", t: (c) => `On avait pr\xE9vu un Grand Prix, on a eu un r\xE9cital. Soliste : ${c.L(c.mvp.name)}. Figurants : tous les autres.` },
    { id: "o-dom-5", t: () => `Ce midi, la course \xE9tait passionnante. Pour la deuxi\xE8me place.` },
    { id: "o-dom-6", t: (c) => `${c.L(c.mvp.name)} a gagn\xE9 ${c.mvp.wins} courses sur ${c.mvp.races}. \xC0 ce niveau, ce n'est plus du kart, c'est une d\xE9monstration commerciale.` }
  ],
  serre: [
    { id: "o-ser-1", t: (c) => `Session serr\xE9e comme un cr\xE9neau de parking un lundi matin : ${fmtAvg(c.gapTop2)} d'\xE9cart entre ${c.L(c.mvp.name)} et ${c.L(c.table[1].name)} au sommet.` },
    { id: "o-ser-2", t: (c) => `Photo-finish au paddock. ${c.L(c.mvp.name)} s'impose d'un rien sur ${c.L(c.table[1].name)}, et ce rien mesure ${fmtAvg(c.gapTop2)} de moyenne.` },
    { id: "o-ser-3", t: (c) => `Personne n'a vraiment domin\xE9, tout le monde a vraiment souffert. Au bout du compte, ${c.L(c.mvp.name)} passe devant ${c.L(c.table[1].name)} pour ${fmtAvg(c.gapTop2)}.` },
    { id: "o-ser-4", t: (c) => `Si vous aimez le suspense, vous avez \xE9t\xE9 servis : ${c.L(c.mvp.name)} et ${c.L(c.table[1].name)} s\xE9par\xE9s par ${fmtAvg(c.gapTop2)}. Les autres \xE9taient s\xE9par\xE9s de la victoire par un oc\xE9an.` },
    { id: "o-ser-5", t: (c) => `Un peloton compact, des nerfs \xE0 vif, et ${c.L(c.mvp.name)} qui gratte la premi\xE8re place d'un cheveu devant ${c.L(c.table[1].name)}.` }
  ],
  spirale: [
    { id: "o-spi-1", tones: TAQ, t: (c) => c.roastable(c.lossStreak.name) ? `Grande nouvelle : ${c.L(c.lossStreak.name)} a domin\xE9 la session. Non, je plaisante. Mais c'\xE9tait beau d'y croire une demi-seconde.` : null },
    { id: "o-spi-2", tones: TAQ, t: (c) => c.roastable(c.lossStreak.name) ? `Spoiler : ce d\xE9brief contient une s\xE9rie de ${c.lossStreak.n} derni\xE8res places. Les \xE2mes sensibles peuvent passer directement au classement.` : null },
    { id: "o-spi-3", tones: TAQ, t: () => `Ce midi, la session a connu un h\xE9ros et une trag\xE9die. Commen\xE7ons par le h\xE9ros, la trag\xE9die m\xE9rite qu'on prenne notre temps.` },
    { id: "o-spi-4", tones: TAQ, t: (c) => c.roastable(c.lossStreak.name) ? `Il y a eu des courses, des d\xE9passements, des bananes. Et il y a eu ${c.L(c.lossStreak.name)}, avec ${c.lossStreak.n} quatri\xE8mes places d'affil\xE9e et un sourire de fa\xE7ade.` : null }
  ],
  marathon: [
    { id: "o-mar-1", t: (c) => `${c.races} courses, ${fmtDuration(c.minutes)} de jeu. \xC0 ce stade, ce n'est plus une pause d\xE9jeuner, c'est un s\xE9minaire.` },
    { id: "o-mar-2", t: (c) => `${c.races} courses au compteur. Quelque part, une salade attend toujours d'\xEAtre mang\xE9e.` },
    { id: "o-mar-3", t: (c) => `Session marathon : ${c.races} courses. Les manettes r\xE9clament des cong\xE9s pay\xE9s.` }
  ],
  courte: [
    { id: "o-crt-1", t: (c) => `Session express : ${c.races} courses, \xE0 peine le temps de choisir son kart. ${c.L(c.mvp.name)} n'a pas perdu une minute.` },
    { id: "o-crt-2", t: (c) => `Format court aujourd'hui, ${c.races} courses. Juste assez pour que ${c.L(c.mvp.name)} fasse le malin, pas assez pour que les autres s'en remettent.` },
    { id: "o-crt-3", t: (c) => `${c.races} courses seulement. Un amuse-bouche, et ${c.L(c.mvp.name)} s'est quand m\xEAme servi en premier.` }
  ],
  standard: [],
  any: [
    { id: "o-any-1", tones: TAQ, t: () => `Waouh, waouh, waouh. Mais que s'est-il pass\xE9 aujourd'hui ? Rien d'historique, \xE0 vrai dire. Mais on va quand m\xEAme en parler pendant dix minutes.` },
    { id: "o-any-2", t: () => `Le kart du midi a rendu son verdict, et comme d'habitude il n'a fait aucun cadeau.` },
    { id: "o-any-3", tones: TAQ, t: () => `Bonne nouvelle : tout le monde est revenu entier. Mauvaise nouvelle : pas forc\xE9ment avec son honneur.` },
    { id: "o-any-4", t: () => `Encore une session o\xF9 chacun avait un plan. Encore une session o\xF9 le plan a tenu jusqu'au premier virage.` },
    { id: "o-any-5", t: (c) => `Les feux se sont \xE9teints \xE0 ${fmtTime(c.start)}. Certains ne s'en sont toujours pas remis.` },
    { id: "o-any-6", t: () => `Session termin\xE9e, manettes pos\xE9es, excuses en pr\xE9paration. Voici le d\xE9brief.` },
    { id: "o-any-7", tones: TAQ, t: () => `Le paddock a parl\xE9. Et il n'a pas \xE9t\xE9 tendre.` },
    { id: "o-any-8", t: () => `Une session de plus dans la l\xE9gende. Une petite l\xE9gende, certes. Mais une l\xE9gende.` },
    { id: "o-any-9", t: (c) => `${c.races} courses, ${pl(c.table.length, "pilote")}, z\xE9ro piti\xE9. Le d\xE9brief.` }
  ],
  sobre: [
    { id: "o-sob-1", t: () => `Session termin\xE9e. Voici le r\xE9sum\xE9 du jour, sans fioritures et presque sans mauvaise foi.` },
    { id: "o-sob-2", t: (c) => `Le kart du midi a rendu son verdict. Bravo \xE0 tous les pilotes, et en particulier \xE0 ${c.L(c.mvp.name)}.` },
    { id: "o-sob-3", t: (c) => `${c.races} courses au programme ce midi. R\xE9sum\xE9 express.` },
    { id: "o-sob-4", t: () => `Petit d\xE9brief de la session du jour, \xE0 consommer avec mod\xE9ration.` }
  ]
};
var MVP = [
  { id: "m-1", tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* termine en t\xEAte avec ${fmtAvg(c.mvp.avg)} de moyenne et ${pl(c.mvp.wins, "victoire")}. Applaudissements polis, on ne voudrait pas que \xE7a monte \xE0 la t\xEAte.` },
  { id: "m-2", tones: TAQ, t: (c) => `Mention sp\xE9ciale \xE0 *${c.L(c.mvp.name)}* : ${fmtAvg(c.mvp.avg)} de moyenne. Les autres ont pris des notes. Illisibles, mais des notes.` },
  { id: "m-3", tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* signe la meilleure moyenne du jour (${fmtAvg(c.mvp.avg)}). Ce soir, quelqu'un va raconter cette session \xE0 des gens qui n'ont rien demand\xE9.` },
  { id: "m-4", tones: TAQ, t: (c) => `Au sommet : *${c.L(c.mvp.name)}*, ${fmtAvg(c.mvp.avg)} de moyenne, ${pl(c.mvp.wins, "victoire")}. Le troph\xE9e est imaginaire, la fiert\xE9 beaucoup moins.` },
  { id: "m-5", tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* repart avec la premi\xE8re place (${fmtAvg(c.mvp.avg)}). Profite, \xE7a ne dure jamais tr\xE8s longtemps ici.` },
  { id: "m-6", tones: TAQ, t: (c) => `*${c.L(c.mvp.name)}* a r\xE9gn\xE9 sur la session avec ${fmtAvg(c.mvp.avg)} de moyenne. Le pouvoir monte vite, on surveille.` },
  { id: "m-sob", tones: ["sobre"], t: (c) => `*${c.L(c.mvp.name)}* termine en t\xEAte avec ${fmtAvg(c.mvp.avg)} de moyenne et ${pl(c.mvp.wins, "victoire")}. Bravo.` }
];
var FLOP = [
  { id: "f-1", tones: TAQ, t: (c) => `\xC0 l'autre bout du classement, ${c.L(c.flop.name)} (${fmtAvg(c.flop.avg)}) a fait preuve d'une g\xE9n\xE9rosit\xE9 rare envers ses adversaires.` },
  { id: "f-2", tones: TAQ, t: (c) => `${c.L(c.flop.name)} ferme la marche avec ${fmtAvg(c.flop.avg)}. Il faut bien que quelqu'un tienne la lanterne, et ce midi c'\xE9tait son tour.` },
  { id: "f-3", tones: TAQ, t: (c) => `Lanterne rouge pour ${c.L(c.flop.name)} (${fmtAvg(c.flop.avg)}, ${c.flop.lasts} fois 4e). On parlera plut\xF4t de \xAB session d'observation \xBB.` },
  { id: "f-4", tones: TAQ, t: (c) => `${c.L(c.flop.name)} boucle la session en derni\xE8re position (${fmtAvg(c.flop.avg)}). Les bananes avaient visiblement un abonnement.` },
  { id: "f-5", tones: TAQ, t: (c) => `C\xF4t\xE9 cuill\xE8re de bois : ${c.L(c.flop.name)}, ${fmtAvg(c.flop.avg)} de moyenne. C'est l'intention qui compte.` },
  { id: "f-6", tones: TAQ, t: (c) => `${c.L(c.flop.name)} termine en queue de peloton (${fmtAvg(c.flop.avg)}). Le jeu propose un mode 50cc, on dit \xE7a, on ne dit rien.` },
  { id: "f-p1", tones: ["piquant"], t: (c) => c.flop.lasts >= 4 ? `${c.L(c.flop.name)} : ${c.flop.lasts} quatri\xE8mes places. \xC0 ce stade, ce n'est plus une contre-performance, c'est une ligne \xE9ditoriale.` : null },
  { id: "f-p2", tones: ["piquant"], t: (c) => `${c.L(c.flop.name)} finit avec ${fmtAvg(c.flop.avg)} de moyenne. On a v\xE9rifi\xE9 : la manette \xE9tait bien branch\xE9e.` }
];
var HIGHLIGHT = [
  { id: "h-ws1", t: (c) => c.winStreak && c.winStreak.name !== c.perfect ? `S\xE9rie du jour : ${c.L(c.winStreak.name)} a encha\xEEn\xE9 ${c.winStreak.n} victoires d'affil\xE9e. Un moment, on a cru \xE0 un bug.` : null },
  { id: "h-ws2", tones: TAQ, t: (c) => c.winStreak && c.winStreak.name !== c.perfect ? `${c.L(c.winStreak.name)} a align\xE9 ${c.winStreak.n} victoires de suite. Les autres appellent \xE7a \xAB un petit passage \xE0 vide collectif \xBB.` : null },
  { id: "h-up1", t: (c) => c.upset ? `Coup de th\xE9\xE2tre : ${c.L(c.upset.name)}, outsider de la course, a battu ${c.L(c.upset.beat)} alors que tout le monde avait d\xE9j\xE0 \xE9crit la fin.` : null },
  { id: "h-up2", tones: TAQ, t: (c) => c.upset ? `La surprise du jour : ${c.L(c.upset.name)} s'est offert ${c.L(c.upset.beat)}. Les bookmakers pr\xE9sentent leur d\xE9mission.` : null },
  { id: "h-pf", t: (c) => c.perfect ? `${c.L(c.perfect)} a gagn\xE9 toutes ses courses. Toutes. Une enqu\xEAte est ouverte.` : null },
  { id: "h-eu", t: (c) => c.eloUp ? `Bonne op\xE9ration pour ${c.L(c.eloUp.name)} : +${c.eloUp.delta} points de cote sur la journ\xE9e. La bourse du kart est en hausse.` : null },
  { id: "h-ed", tones: TAQ, t: (c) => c.eloDown && c.roastable(c.eloDown.name) && c.eloDown.name !== c.flop.name ? `${c.L(c.eloDown.name)} laisse ${-c.eloDown.delta} points de cote sur la piste. Ils seront remis aux objets trouv\xE9s.` : null },
  { id: "h-ls", tones: TAQ, t: (c) => c.lossStreak && c.roastable(c.lossStreak.name) && c.lossStreak.name !== c.flop.name ? `${c.L(c.lossStreak.name)} a collectionn\xE9 ${c.lossStreak.n} quatri\xE8mes places d'affil\xE9e. La constance est une qualit\xE9. Normalement.` : null },
  { id: "h-wl", tones: TAQ, t: (c) => {
    const w = c.winless.filter((n) => c.roastable(n) && n !== c.flop.name);
    return w.length ? `${w.map(c.L).join(" et ")} ${w.length > 1 ? "repartent" : "repart"} sans la moindre victoire, mais avec beaucoup d'exp\xE9rience.` : null;
  } }
];
var TAKES_NONE = [
  { id: "t-n1", t: () => `Aucun Take aujourd'hui. Prudence ou manque d'imagination, l'histoire tranchera.` },
  { id: "t-n2", t: () => `Pas un seul Take pos\xE9. Les devins sont en RTT.` },
  { id: "t-n3", t: () => `Z\xE9ro Take ce midi. Personne n'a os\xE9, et c'\xE9tait peut-\xEAtre le plus sage.` }
];
var TAKES_ALLWON = [
  { id: "t-w1", t: () => `Tous les Takes sont pass\xE9s. Soit vous \xEAtes devins, soit vous visez trop bas.` },
  { id: "t-w2", t: () => `Sans-faute sur les Takes. Le paddock envisage de vous confier les pr\xE9visions m\xE9t\xE9o.` }
];
var TAKES_ALLLOST = [
  { id: "t-l1", t: () => `Aucun Take n'a tenu. Nostradamus peut dormir tranquille.` },
  { id: "t-l2", t: () => `Z\xE9ro Take honor\xE9. L'avenir reste, pour l'instant, hors de port\xE9e du paddock.` },
  { id: "t-l3", t: () => `Tous les Takes sont tomb\xE9s. On appelle \xE7a de l'optimisme, et c'est tr\xE8s bien.` }
];
var TAKES_MIXED = [
  { id: "t-m1", t: () => `Quelques visionnaires, quelques r\xEAveurs. Comme d'habitude.` },
  { id: "t-m2", t: () => `Le paddock fait ses comptes : il y a les voyants, et il y a les autres.` },
  { id: "t-m3", t: () => `Certains ont vu juste, d'autres ont vu grand.` }
];
var CLOSE = [
  { id: "c-1", t: () => `Tous les d\xE9tails, les courbes et les excuses sont au paddock.` },
  { id: "c-2", tones: TAQ, t: () => `Les chiffres complets attendent au paddock. Les excuses, elles, se font en personne.` },
  { id: "c-3", t: () => `Rendez-vous \xE0 la prochaine session pour la revanche. Ou pour la confirmation.` },
  { id: "c-4", t: () => `Le paddock est ouvert pour ceux qui veulent revivre \xE7a au ralenti.` },
  { id: "c-5", tones: TAQ, t: () => `Prochaine session bient\xF4t. D'ici l\xE0, entra\xEEnez-vous. Certains plus que d'autres.` },
  { id: "c-sob", tones: ["sobre"], t: () => `Le d\xE9tail est sur le paddock. Bon apr\xE8s-midi \xE0 tous.` }
];
function pick(list, c, slot, used) {
  const ok = list.filter((v) => (v.tones ?? ALL).includes(c.o.tone)).map((v) => ({ v, s: v.t(c) })).filter((x2) => x2.s);
  if (!ok.length) return null;
  const fresh = ok.filter((x2) => !c.o.recent.includes(x2.v.id));
  const pool = fresh.length ? fresh : ok;
  const x = pool[seedOf(`${c.day}|${slot}|${c.o.salt ?? ""}`) % pool.length];
  used.push(x.v.id);
  return x.s;
}
function ctxOf(f, o) {
  return { ...f, o, L: o.label, roastable: (n) => o.tone !== "sobre" && !o.optout.includes(n) };
}
var VERDICT_LABEL = { won: "honor\xE9", lost: "rat\xE9", void: "annul\xE9", manual: "\xE0 arbitrer" };
function takesBlock(c, used) {
  if (!c.o.includeTakes) return null;
  const t = c.takes;
  if (!t.length) return pick(TAKES_NONE, c, "takes", used);
  const quote = (x) => `${c.L(x.take.author)} (\xAB ${x.take.text.length > 90 ? x.take.text.slice(0, 88) + "\u2026" : x.take.text} \xBB${x.verdict === "won" && x.take.points ? `, +${x.take.points} pts` : ""})`;
  const won = t.filter((x) => x.verdict === "won"), lost = t.filter((x) => x.verdict === "lost");
  const other = t.filter((x) => x.verdict === "void" || x.verdict === "manual");
  const lines = ["*Les Takes du jour*"];
  if (won.length) lines.push(`Honor\xE9s : ${won.map(quote).join(" \xB7 ")}`);
  if (lost.length) lines.push(`Rat\xE9s : ${lost.map(quote).join(" \xB7 ")}`);
  if (other.length) lines.push(`Sans verdict : ${other.map((x) => `${c.L(x.take.author)} (${VERDICT_LABEL[x.verdict]})`).join(" \xB7 ")}`);
  const comment = lost.length === t.length ? pick(TAKES_ALLLOST, c, "takes", used) : won.length === t.length ? pick(TAKES_ALLWON, c, "takes", used) : won.length && lost.length ? pick(TAKES_MIXED, c, "takes", used) : null;
  if (comment) lines.push(`_${comment}_`);
  return lines.join("\n");
}
function recap(c) {
  const rows = c.table.map((s, i) => `${i + 1}. ${c.L(s.name)} \xB7 ${fmtAvg(s.avg)}${s.wins ? ` \xB7 ${pl(s.wins, "victoire")}` : ""}`);
  return `*Classement du jour* \xB7 ${pl(c.races, "course")} \xB7 ${fmtDuration(c.minutes)}
${rows.join("\n")}`;
}
function linkBlocks(url, label, note) {
  return [
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: label }, url, style: "primary" }] },
    { type: "context", elements: [{ type: "mrkdwn", text: note }] }
  ];
}
var section = (text) => ({ type: "section", text: { type: "mrkdwn", text } });
function debriefStory(f, o, used = []) {
  const c = ctxOf(f, o);
  const open = o.tone === "sobre" ? pick(OPEN.sobre, c, "open", used) : pick([...OPEN[f.scenario], ...OPEN[f.scenario].length ? [] : OPEN.any], c, "open", used) ?? pick(OPEN.any, c, "open", used);
  const parts = [open, pick(MVP, c, "mvp", used)];
  if (c.roastable(f.flop.name) && f.flop.name !== f.mvp.name && f.table.length >= 3) parts.push(pick(FLOP, c, "flop", used));
  parts.push(pick(HIGHLIGHT, c, "hl", used));
  return parts.filter(Boolean).join(" ");
}
function buildDebrief(f, o, story) {
  const used = [];
  const c = ctxOf(f, o);
  const narrative = story ?? debriefStory(f, o, used);
  const takes = takesBlock(c, used);
  const close = pick(CLOSE, c, "close", used);
  const url = `${o.appUrl}/#/session/${f.day}`;
  const text = [narrative, recap(c), takes, `${close} ${url}`].filter(Boolean).join("\n\n");
  const blocks = [
    section(narrative),
    section(recap(c)),
    ...takes ? [section(takes)] : [],
    section(close ?? ""),
    ...linkBlocks(url, "Ouvrir le paddock", "Pits Club \xB7 d\xE9brief automatique")
  ];
  return { text, blocks, meta: { kind: "debrief", ids: used, pen: story ? "ai" : "library" } };
}
var EXTRA = [
  { id: "x-1", tones: TAQ, t: () => `Prolongations ! Des courses ont \xE9t\xE9 jou\xE9es apr\xE8s le d\xE9brief. Visiblement, quelqu'un n'avait pas dig\xE9r\xE9 le premier r\xE9sultat.` },
  { id: "x-2", t: () => `On croyait la session termin\xE9e. Erreur : il y a eu du rab, et le classement a boug\xE9.` },
  { id: "x-3", tones: TAQ, t: () => `Rab de kart : quelques courses en plus, pour ceux qui aiment souffrir. Classement mis \xE0 jour.` },
  { id: "x-sob", tones: ["sobre"], t: () => `Quelques courses ont \xE9t\xE9 ajout\xE9es apr\xE8s le d\xE9brief. Voici le classement mis \xE0 jour.` }
];
function buildExtra(f, o) {
  const used = [];
  const c = ctxOf(f, o);
  const head = pick(EXTRA, c, "extra" + f.races, used) ?? "";
  const url = `${o.appUrl}/#/session/${f.day}`;
  return {
    text: `${head}

${recap(c)}

${url}`,
    blocks: [section(head), section(recap(c)), ...linkBlocks(url, "Ouvrir le paddock", "Pits Club \xB7 prolongations")],
    meta: { kind: "extra", ids: used, pen: "library" }
  };
}
var REMIND = [
  { id: "r-1", tones: TAQ, t: () => `C'est l'heure des Takes. Personne ne vous demande d'avoir raison, juste d'avoir du courage.` },
  { id: "r-2", t: (d) => `L'heure des pronostics a sonn\xE9. Qui va finir devant qui ? Vous avez jusqu'\xE0 ${d} pour le pr\xE9dire.` },
  { id: "r-3", tones: TAQ, t: (d) => `Petit rappel du paddock : un Take par pilote, avant ${d}. Les \xAB je l'avais dit \xBB ne comptent que s'ils sont \xE9crits.` },
  { id: "r-4", tones: TAQ, t: () => `Les Takes sont ouverts. C'est le moment de promettre des choses que la piste se fera un plaisir de d\xE9mentir.` },
  { id: "r-5", t: (d) => `Avis aux devins, aux optimistes et aux mauvais perdants : les Takes ferment \xE0 ${d}.` },
  { id: "r-6", tones: TAQ, t: (d) => `Il reste un peu de temps avant ${d} pour poser votre Take. Ce midi, quelqu'un va avoir raison. Statistiquement, pas vous.` },
  { id: "r-7", tones: TAQ, t: () => `Rappel amical : les Takes, c'est maintenant. Plus tard, \xE7a s'appelle de la mauvaise foi.` },
  { id: "r-8", t: (d) => `Pr\xE9dire l'avenir, c'est facile. Le faire avant ${d}, c'est plus sportif. \xC0 vos Takes.` },
  { id: "r-9", tones: ["piquant"], t: () => `Les Takes sont ouverts. Vu les r\xE9sultats de certains, un pronostic sur leur propre victoire rel\xE8verait de la science-fiction. Mais on ne juge pas.` },
  { id: "r-s1", tones: ["sobre"], t: (d) => `Rappel : les Takes sont ouverts jusqu'\xE0 ${d}. Un pronostic par pilote.` },
  { id: "r-s2", tones: ["sobre"], t: (d) => `Les Takes du jour sont ouverts jusqu'\xE0 ${d}. Bonne chance \xE0 tous.` }
];
function buildReminder(r, o) {
  const ok = REMIND.filter((v2) => (v2.tones ?? ALL).includes(o.tone));
  const fresh = ok.filter((v2) => !o.recent.includes(v2.id));
  const pool = fresh.length ? fresh : ok;
  const v = pool[seedOf(`${r.day}|remind|${o.salt ?? ""}`) % pool.length];
  const posted = r.posted.length === 0 ? `Personne n'a encore os\xE9.` : `D\xE9j\xE0 ${pl(r.posted.length, "Take scell\xE9", "Takes scell\xE9s")} (${r.posted.map(o.label).join(", ")}). ${o.tone === "sobre" ? "" : "Les autres r\xE9fl\xE9chissent, para\xEEt-il."}`.trim();
  const url = `${o.appUrl}/#/takes`;
  const head = v.t(r.deadline);
  return {
    text: `${head}
${posted}
${url}`,
    blocks: [section(`${head}
${posted}`), ...linkBlocks(url, "Poser mon Take", `Cl\xF4ture \xE0 ${r.deadline} \xB7 un Take par pilote, r\xE9v\xE9l\xE9 apr\xE8s la session`)],
    meta: { kind: "reminder", ids: [v.id], pen: "library" }
  };
}
function buildTest(o) {
  const t = `Test de connexion Pits Club. Si vous lisez ceci, le bot est branch\xE9. Il n'a encore rien dit de m\xE9chant, profitez-en.`;
  return { text: `${t}
${o.appUrl}`, blocks: [section(t), ...linkBlocks(o.appUrl, "Ouvrir Pits Club", "Pits Club \xB7 message de test")], meta: { kind: "test", ids: [], pen: "library" } };
}

// src/lib/bot/server.ts
var str = (v, d) => typeof v === "string" ? v : d;
var bool = (v, d) => typeof v === "boolean" ? v : d;
function optionsFrom(p, salt) {
  const names = new Map(p.players.map((x) => [x.name, x.display_name || x.name]));
  const tone = str(p.settings.bot_tone, "taquin");
  return {
    tone: ["sobre", "taquin", "piquant"].includes(tone) ? tone : "taquin",
    appUrl: str(p.settings.app_url, "https://pits-club.vercel.app").replace(/\/$/, ""),
    label: (n) => names.get(n) ?? n,
    optout: Array.isArray(p.settings.roast_optout) ? p.settings.roast_optout : [],
    recent: p.recent_meta.flatMap((m) => m?.ids ?? []),
    includeTakes: bool(p.settings.debrief_takes, true) && bool(p.settings.takes_enabled, true),
    salt
  };
}
function factsFrom(p, revealedOnly = true) {
  const raw = p.races.map(([ts, a, b, c, d, src]) => ({ ts, p: [a, b, c, d], src }));
  const { races } = cleanRaces(raw);
  const elo = computeElo(races);
  const takes = p.takes.filter((t) => !revealedOnly || t.revealed);
  return sessionFacts(p.day, races, elo, takes);
}
var fmtDeadline = (v) => str(v, "13:00").replace(":", "h");
function composeMessage(kind, p, opts = {}) {
  const o = optionsFrom(p, opts.salt);
  if (kind === "test") return buildTest(o);
  if (kind === "reminder") {
    return buildReminder({ day: p.day, deadline: fmtDeadline(p.settings.takes_deadline), posted: p.takes.map((t) => t.author) }, o);
  }
  const f = factsFrom(p, opts.revealedOnly ?? true);
  if (!f) return { error: "Aucune course ce jour-l\xE0" };
  return kind === "extra" ? buildExtra(f, o) : buildDebrief(f, o, opts.story);
}
function aiStoryPrompt(f, o) {
  const L = o.label;
  const facts = {
    courses: f.races,
    duree_minutes: f.minutes,
    classement: f.table.map((s, i) => ({ rang: i + 1, pilote: L(s.name), moyenne: Number(s.avg.toFixed(2)), victoires: s.wins, quatriemes: s.lasts, courses: s.races })),
    serie_victoires: f.winStreak && { pilote: L(f.winStreak.name), n: f.winStreak.n },
    serie_dernieres_places: f.lossStreak && !o.optout.includes(f.lossStreak.name) ? { pilote: L(f.lossStreak.name), n: f.lossStreak.n } : null,
    surprise: f.upset && { vainqueur: L(f.upset.name), favori_battu: L(f.upset.beat) },
    cote_en_hausse: f.eloUp && { pilote: L(f.eloUp.name), points: f.eloUp.delta },
    sans_faute: f.perfect && L(f.perfect)
  };
  const tone = {
    sobre: "Ton bienveillant et l\xE9ger : humour doux, aucune moquerie nominative, f\xE9licite le vainqueur.",
    taquin: "Ton de chambrage entre coll\xE8gues : ironie, fausse emphase, autod\xE9rision. Taquine le dernier sans jamais l'humilier.",
    piquant: "Ton piquant et pince-sans-rire, plus mordant, mais toujours bon enfant et sans m\xE9chancet\xE9."
  }[o.tone];
  const system = [
    "Tu \xE9cris le d\xE9brief Slack d'une session de Mario Kart jou\xE9e entre coll\xE8gues \xE0 la pause de midi, dans une entreprise.",
    "\xC9cris en fran\xE7ais, 3 \xE0 5 phrases, 90 mots maximum, un seul paragraphe, sans titre, sans liste, sans emoji, sans hashtag.",
    tone,
    "Une belle plume : ironie, images inattendues, chutes. Exemple d'esprit : \xAB Waouh, waouh, waouh. Mais que s'est-il pass\xE9 aujourd'hui ? Roro a survol\xE9 ses adversaires. Non, je plaisante. \xBB",
    "R\xE8gles : n'invente aucun chiffre ni aucun fait, utilise uniquement les donn\xE9es fournies. Ne mentionne ni le travail, ni les r\xE9sultats de l'entreprise, ni le physique, ni la vie priv\xE9e.",
    `Pilotes \xE0 ne jamais chambrer nomm\xE9ment : ${o.optout.map(L).join(", ") || "aucun"}. N'accorde pas de genre aux pilotes (\xE9vite il/elle, pr\xE9f\xE8re leur pr\xE9nom).`,
    "Le classement d\xE9taill\xE9 et les Takes sont ajout\xE9s automatiquement apr\xE8s ton texte : ne les recopie pas."
  ].join("\n");
  return { system, user: `Donn\xE9es de la session :
${JSON.stringify(facts)}` };
}
function cleanStory(s) {
  const t = s.replace(/\s+/g, " ").replace(/^["«\s]+|["»\s]+$/g, "").trim();
  return t.length >= 40 && t.length <= 900 ? t : null;
}
function takePrompt(text, author, players) {
  const who = players.map((p) => {
    const other = [.../* @__PURE__ */ new Set([p.display, ...p.aliases ?? []])].filter((x) => x && x.toLowerCase() !== p.name.toLowerCase());
    return other.length ? `${p.name} (aussi appel\xE9 : ${other.join(", ")})` : p.name;
  });
  const system = [
    "Tu convertis le pronostic (\xAB Take \xBB) d'un joueur de Mario Kart en r\xE8gle v\xE9rifiable sur les r\xE9sultats de la session du jour.",
    "Les Takes sont \xE9crits entre coll\xE8gues, en langage familier, avec humour, chambrage, argot et fautes de frappe. Sois ouvert : cherche l'intention comp\xE9titive derri\xE8re la formule et traduis-la par la r\xE8gle la plus proche.",
    "R\xE9ponds uniquement avec un objet JSON, sans texte autour.",
    'R\xE8gles possibles (champ "kind") :',
    '- {"kind":"duel","a":X,"b":Y} : X termine la journ\xE9e avec une meilleure moyenne que Y',
    '- {"kind":"avg-better","p":X,"x":nombre} : moyenne du jour de X strictement meilleure (plus petite) que x (entre 1 et 4)',
    '- {"kind":"avg-worse","p":X,"x":nombre} : moyenne du jour de X strictement moins bonne (plus grande) que x',
    '- {"kind":"wins-min","p":X,"n":entier} : X gagne au moins n courses',
    '- {"kind":"no-win","p":X} : X ne gagne aucune course',
    '- {"kind":"best-of-day","p":X} : X termine avec la meilleure moyenne du jour',
    `- {"kind":"win-streak","p":X,"n":entier} : X encha\xEEne au moins n victoires d'affil\xE9e`,
    '- {"kind":"volume","n":entier} : au moins n courses jou\xE9es dans la session',
    "La moyenne est la place moyenne (1 = toujours premier, 4 = toujours dernier).",
    "Exemples d'interpr\xE9tation :",
    "- \xAB X va botter le cul de Y \xBB, \xAB X va \xE9clater / d\xE9foncer / humilier Y \xBB, \xAB Y va manger la poussi\xE8re de X \xBB, \xAB X > Y \xBB \u2192 duel a=X, b=Y",
    "- \xAB X va tout rafler \xBB, \xAB X roi du jour \xBB, \xAB personne ne battra X \xBB, \xAB X va dominer \xBB \u2192 best-of-day X",
    "- \xAB X va se prendre une racl\xE9e \xBB, \xAB X va faire le plein de bananes \xBB, \xAB X va finir dans les choux \xBB \u2192 avg-worse X, x=2.8",
    "- \xAB X va gratter une victoire \xBB, \xAB X va enfin gagner \xBB \u2192 wins-min X, n=1 ; \xAB X va gagner 3 courses \xBB \u2192 wins-min X, n=3",
    "- \xAB X z\xE9ro victoire \xBB, \xAB X ne verra pas le podium de la premi\xE8re place \xBB \u2192 no-win X",
    "- \xAB X va \xEAtre solide / r\xE9gulier \xBB \u2192 avg-better X, x=2.3",
    "- \xAB X va encha\xEEner \xBB, \xAB hat-trick de X \xBB \u2192 win-streak X, n=2 (n=3 pour hat-trick)",
    "- \xAB grosse session \xBB, \xAB on va jouer jusqu'\xE0 pas d'heure \xBB \u2192 volume n=12",
    `Les pilotes (nom exact, puis pr\xE9noms et surnoms) : ${who.join(" ; ")}.`,
    "Reconnais les pilotes par n'importe lequel de ces noms, sans tenir compte des majuscules, des accents ni des fautes l\xE9g\xE8res. Dans la r\xE8gle, utilise toujours le nom exact (le premier).",
    `L'auteur du Take est ${author} : \xAB je \xBB, \xAB moi \xBB, \xAB me \xBB d\xE9signent ${author}.`,
    'Format de r\xE9ponse : {"ok":true,"rule":{...},"label":"reformulation courte et neutre en fran\xE7ais"}',
    'Refuse seulement si le Take ne parle pas de la comp\xE9tition du jour (m\xE9t\xE9o, travail, vie priv\xE9e\u2026), ne cite aucun pilote identifiable quand il en faut un, ou combine plusieurs conditions impossibles \xE0 ramener \xE0 une seule r\xE8gle : r\xE9ponds alors {"ok":false,"reason":"explication courte en fran\xE7ais, avec une suggestion de reformulation"}.'
  ].join("\n");
  return { system, user: text };
}
function validateRule(raw, names, aliases = {}) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  const kinds = RULE_KINDS.map((k) => k.kind);
  if (typeof r.kind !== "string" || !kinds.includes(r.kind)) return null;
  const fold = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const nm = (v) => {
    if (typeof v !== "string") return null;
    const k = fold(v);
    return names.find((n) => fold(n) === k) ?? names.find((n) => (aliases[n] ?? []).some((a) => fold(a) === k)) ?? null;
  };
  const int = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;
  const num = (v) => typeof v === "number" && v > 1 && v < 4 ? Math.round(v * 100) / 100 : null;
  switch (r.kind) {
    case "duel": {
      const a = nm(r.a), b = nm(r.b);
      return a && b && a !== b ? { kind: "duel", a, b } : null;
    }
    case "avg-better":
    case "avg-worse": {
      const p = nm(r.p), x = num(r.x);
      return p && x ? { kind: r.kind, p, x } : null;
    }
    case "wins-min": {
      const p = nm(r.p), n = int(r.n, 1, 40);
      return p && n ? { kind: "wins-min", p, n } : null;
    }
    case "win-streak": {
      const p = nm(r.p), n = int(r.n, 2, 20);
      return p && n ? { kind: "win-streak", p, n } : null;
    }
    case "no-win":
    case "best-of-day": {
      const p = nm(r.p);
      return p ? { kind: r.kind, p } : null;
    }
    case "volume": {
      const n = int(r.n, 1, 80);
      return n ? { kind: "volume", n } : null;
    }
  }
  return null;
}
function firstJson(s) {
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

// server/bot.ts
var env = (k) => (process.env[k] ?? "").trim();
var SB_URL = () => env("VITE_SUPABASE_URL") || env("SUPABASE_URL");
var SB_KEY = () => env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function rpc(fn, args, jwt) {
  const r = await fetch(`${SB_URL()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${jwt ?? SB_KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} : ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function currentUser(jwt) {
  const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${jwt}` } });
  return r.ok ? r.json() : null;
}
var aiKey = () => env("GEMINI_API_KEY") || env("GOOGLE_API_KEY") || (env("ANTHROPIC_API_KEY").startsWith("AIza") ? env("ANTHROPIC_API_KEY") : "");
async function ai(models, system, user, maxTokens, asJson = false) {
  const list = (Array.isArray(models) ? models : [models]).filter((m, i, a) => m && a.indexOf(m) === i);
  let last;
  for (const model of list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await aiOnce(model, system, user, maxTokens, asJson);
      } catch (e) {
        last = e;
        if (!/IA : (429|500|503)/.test(String(e))) break;
        if (attempt === 0) await new Promise((res) => setTimeout(res, 1200));
      }
    }
  }
  throw last;
}
async function aiOnce(model, system, user, maxTokens, asJson) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": aiKey(), "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // Marge large : sur les modèles qui « réfléchissent », le raisonnement consomme aussi ce budget.
      generationConfig: { maxOutputTokens: Math.max(maxTokens * 4, 1024), ...asJson ? { responseMimeType: "application/json" } : {} }
    })
  });
  if (!r.ok) throw new Error(`IA : ${r.status} (${model}) ${(await r.text()).replace(/\s+/g, " ").slice(0, 200)}`);
  const data = await r.json();
  const c = data.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((x) => !x.thought && x.text).map((x) => x.text).join("").trim();
  if (!text) throw new Error(`IA : r\xE9ponse vide (${c?.finishReason ?? "aucun candidat"})`);
  return text;
}
var MODEL_PEN = env("GEMINI_MODEL_PEN") || "gemini-3.8-flash";
var MODEL_PARSE = env("GEMINI_MODEL_PARSE") || "gemini-3.5-flash-lite";
var PEN_CHAIN = [MODEL_PEN, "gemini-3.6-flash", MODEL_PARSE];
var PARSE_CHAIN = [MODEL_PARSE, "gemini-3.1-flash-lite", "gemini-3.6-flash"];
async function postSlack(m) {
  const url = env("SLACK_WEBHOOK_URL");
  if (!url) throw new Error("SLACK_WEBHOOK_URL manquant dans Vercel");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: m.text, blocks: m.blocks }) });
  if (!r.ok) throw new Error(`Slack : ${r.status} ${(await r.text()).slice(0, 160)}`);
}
async function aiStory(p, kind, salt) {
  if (kind !== "debrief" || p.settings.ai_pen !== true) return {};
  if (!aiKey()) return { aiError: "cl\xE9 absente" };
  const f = factsFrom(p);
  if (!f) return { aiError: "pas de donn\xE9es de session" };
  try {
    const { system, user } = aiStoryPrompt(f, optionsFrom(p, salt));
    const raw = await ai(PEN_CHAIN, system, user, 400);
    const story = cleanStory(raw);
    return story ? { story } : { aiError: `r\xE9cit hors format (${raw.length} caract\xE8res)` };
  } catch (e) {
    return { aiError: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
async function build(p, kind, salt, revealedOnly = true) {
  const { story, aiError } = await aiStory(p, kind, salt);
  const m = composeMessage(kind, p, { salt, story, revealedOnly });
  if (aiError && !("error" in m)) m.meta = { ...m.meta, ai_error: aiError };
  return m;
}
async function processLog(logId) {
  const secret = env("BOT_SECRET");
  const p = await rpc("bot_payload", { secret, p_log: logId });
  if (!p.log) return { ok: false, error: "entr\xE9e inconnue" };
  try {
    const m = await build(p, p.log.kind);
    if ("error" in m) {
      await rpc("bot_result", { secret, p_log: logId, p_status: "skipped", p_body: null, p_error: m.error });
      return { ok: false, error: m.error };
    }
    await postSlack(m);
    await rpc("bot_result", { secret, p_log: logId, p_status: "sent", p_body: m.text, p_error: null, p_meta: m.meta });
    return { ok: true, body: m.text };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await rpc("bot_result", { secret, p_log: logId, p_status: "failed", p_body: null, p_error: error }).catch(() => {
    });
    return { ok: false, error };
  }
}
async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
  }
  const botHeader = req.headers.get("x-bot-secret");
  if (botHeader) {
    if (!env("BOT_SECRET") || botHeader !== env("BOT_SECRET")) return json({ error: "secret invalide" }, 401);
    const id = Number(body.log_id);
    if (!id) return json({ error: "log_id manquant" }, 400);
    return json(await processLog(id));
  }
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await currentUser(jwt) : null;
  if (!user) return json({ error: "Connexion requise" }, 401);
  const action = String(body.action ?? "");
  if (action === "parse-take") {
    const text = String(body.text ?? "").trim().slice(0, 280);
    if (text.length < 3) return json({ ok: false, reason: "Ton Take est vide." });
    if (!aiKey()) return json({ ok: false, unavailable: true, reason: "L'IA n'est pas encore branch\xE9e : ton Take sera arbitr\xE9 \xE0 la main." });
    const sbHeaders = { apikey: SB_KEY(), Authorization: `Bearer ${jwt}` };
    const [meRes, plRes] = await Promise.all([
      fetch(`${SB_URL()}/rest/v1/players?select=name&user_id=eq.${user.id}`, { headers: sbHeaders }),
      fetch(`${SB_URL()}/rest/v1/players?select=name,display_name,active,aliases&name=neq.Other&active=eq.true`, { headers: sbHeaders })
    ]);
    const me = (await meRes.json())[0]?.name;
    if (!me) return json({ ok: false, reason: "Seuls les pilotes peuvent poster un Take." });
    const players = await plRes.json();
    const list = players.map((p) => ({ name: p.name, display: p.display_name || p.name, aliases: p.aliases ?? [] }));
    const aliasMap = Object.fromEntries(list.map((p) => [p.name, [p.display, ...p.aliases]]));
    try {
      const { system, user: u } = takePrompt(text, me, list);
      const out = firstJson(await ai(PARSE_CHAIN, system, u, 300, true));
      if (!out?.ok) return json({ ok: false, reason: out?.reason ?? "Take impossible \xE0 v\xE9rifier automatiquement. Essaie une formulation plus pr\xE9cise." });
      const rule = validateRule(out.rule, list.map((p) => p.name), aliasMap);
      if (!rule) return json({ ok: false, reason: "Take impossible \xE0 v\xE9rifier automatiquement. Essaie une formulation plus pr\xE9cise." });
      const show = (n) => list.find((p) => p.name === n)?.display ?? n;
      return json({ ok: true, rule, label: ruleLabel(rule, show) });
    } catch (e) {
      return json({ ok: false, unavailable: true, reason: "L'IA ne r\xE9pond pas pour le moment : ton Take sera arbitr\xE9 \xE0 la main.", detail: String(e) });
    }
  }
  const admin = await rpc("is_admin", {}, jwt).catch(() => false);
  if (!admin) return json({ error: "R\xE9serv\xE9 aux admins" }, 403);
  if (action === "status") {
    let secretOk = false;
    if (env("BOT_SECRET")) secretOk = await rpc("bot_payload", { secret: env("BOT_SECRET"), p_log: null, p_day: null }).then(() => true, () => false);
    let aiOk = false;
    let aiError = aiKey() ? null : "cl\xE9 absente";
    if (aiKey()) {
      try {
        await ai(PARSE_CHAIN, "R\xE9ponds uniquement OK.", "Test", 5);
        aiOk = true;
      } catch (e) {
        aiError = String(e instanceof Error ? e.message : e).slice(0, 200);
      }
    }
    return json({ slack: !!env("SLACK_WEBHOOK_URL"), ai: aiOk, aiError, secret: secretOk });
  }
  const kind = String(body.kind ?? "debrief");
  if (!["debrief", "extra", "reminder", "test"].includes(kind)) return json({ error: "type inconnu" }, 400);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day)) ? String(body.day) : null;
  if (action === "preview") {
    const p = await rpc("bot_payload", { secret: env("BOT_SECRET"), p_log: null, p_day: day });
    const m = await build(p, kind, body.salt ? String(body.salt) : void 0);
    return json("error" in m ? { ok: false, error: m.error } : { ok: true, text: m.text, meta: m.meta });
  }
  if (action === "send") {
    const id = await rpc("bot_queue", { secret: env("BOT_SECRET"), p_kind: kind, p_day: day ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) });
    return json(await processLog(id));
  }
  return json({ error: "action inconnue" }, 400);
}
export {
  POST
};
