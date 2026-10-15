export type RawRace = { ts: string; p: [string, string, string, string]; src: 'archive' | 'form' | 'app' };

export type Race = {
  id: number;          // index chronologique dans les courses valides
  ts: Date;
  iso: string;         // 2026-10-14T13:31:08 (heure de Paris)
  day: string;         // 2026-10-14
  p: [string, string, string, string];
  src: RawRace['src'];
};

export type FlaggedRace = RawRace & { reason: 'duplicate-name' };
export type ReplacedRace = { replaced: RawRace; by: RawRace };

export type Player = { name: string; color: string; active: boolean; displayName?: string; id?: string; avatarPath?: string; avatarUrl?: string };

export type Dataset = {
  players: Player[];
  races: Race[];
  flagged: FlaggedRace[];
  replaced: ReplacedRace[];
  closedDays: Set<string>;
  source: 'demo' | 'live';
  loadedAt: Date;
};

export const SETTINGS = {
  raceMinutes: 2.77,
  minRacesDayRecord: 5,
  minSharedH2H: 10,
  hideOpponentAfterDays: 60,
  sessionIdleMinutes: 20,
  dedupeSeconds: 60,
  eloK: 12,
  eloStart: 1500,
  formWindow: 20,
  minRacesWeekday: 5,
};
