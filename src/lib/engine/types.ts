// Core game types. All state lives server-side; clients only ever receive a filtered PlayerView (see view.ts).

export type Role = 'hider' | 'seeker' | 'unassigned';
export type Phase = 'lobby' | 'headstart' | 'live' | 'ended';
export type GameMode = 'multi' | 'shared' | 'groupSelected' | 'oneOpen';
export type SectorStatus = 'open' | 'closing' | 'closed';
export type GpsStatus = 'none' | 'ok' | 'stale' | 'denied' | 'poor';

export interface LatLon { lat: number; lon: number }

export interface Fix extends LatLon {
  acc: number; // metres (1 sigma-ish, as reported by the browser)
  at: number; // server receive time (ms)
  sim?: boolean; // only allowed in simulation games
}

export interface Player {
  id: string;
  nickname: string;
  tokenHash: string;
  role: Role;
  ready: boolean;
  joinedAt: number;
  lastSeen: number;
  groupId: string | null;
  fix: Fix | null; // latest fix only. No history is ever stored.
  sector: number | null; // derived from fix
  gps: GpsStatus;
  caughtAt: number | null; // when a hider was converted to seeker
  wasHider: boolean;
  isBot?: boolean;
  botFlags?: { offline?: boolean; gpsFail?: boolean; disputeNext?: boolean };
  push?: unknown; // web-push subscription (opaque)
  botTarget?: LatLon | null;
  gpsWarnedAt?: number | null;
  left?: boolean;
}

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  members: string[];
  confirmed: Record<string, boolean>;
  chosenSector: number | null; // for groupSelected mode
  together: boolean; // last separation verdict
  clusters: string[][]; // member clusters (each cluster is together)
  splitSince: number | null; // hysteresis
}

export interface GameConfig {
  mode: GameMode;
  sharedSector: number | null;
  openSector: number | null;
  headStartSec: number;
  voteEverySec: number;
  voteDurationSec: number;
  closeGraceSec: number;
  zoneEverySec: number;
  zoneDurationSec: number;
  zoneStages: number;
  zoneStartRadiusM: number;
  zoneMinRadiusM: number;
  photoEverySec: number;
  photoWindowSec: number;
  clueDurationSec: number;
  clueRadiusM: number;
  violation: 'clue' | 'none';
  separationM: number;
  separationHoldSec: number;
  staleSec: number;
  replayRetentionHours: number;
  sectorsVerified: boolean; // automatic sector enforcement only when true
  speed: number; // 1 in real games; 1/5/10/30 in simulation
  seekerStartNote: string; // where seekers wait during the head start (host-written)
}

export interface SectorFeature {
  type: 'Feature';
  properties: { sector: number; verified?: boolean };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}
export interface SectorCollection { type: 'FeatureCollection'; features: SectorFeature[] }

export interface Landmark { id: string; name: string; sector: number; lat: number; lon: number; verified: boolean }

export interface Vote {
  round: number;
  openedAt: number;
  closesAt: number;
  eligible: string[];
  votes: Record<string, number>;
  reminded: boolean;
}

export interface Closing { sector: number; announcedAt: number; closesAt: number; oneMinuteSent: boolean; affectedGroups: string[] }

export interface Zone {
  id: string;
  groupId: string;
  circles: { lat: number; lon: number; radii: number[] }[]; // one circle per together-cluster; radii per stage
  startAt: number;
  stageMs: number;
  endsAt: number;
}

export interface Clue { id: string; groupId: string | null; playerId: string | null; lat: number; lon: number; radiusM: number; until: number; reason: 'photo_missed' | 'violation' }

export interface PhotoRequirement { key: string; groupId: string; memberIds: string[]; satisfiedBy: string | null; missed: boolean }
export interface PhotoRound { round: number; requestedAt: number; dueAt: number; reqs: PhotoRequirement[]; sent60: boolean; sent30: boolean; closed: boolean }
export interface Photo { id: string; round: number; playerId: string; groupId: string; reqKey: string; status: 'pending' | 'approved' | 'rejected'; reason: string | null; at: number; reviewedAt: number | null; sim?: boolean }

export interface Catch { id: string; seekerId: string; hiderId: string; status: 'pending' | 'confirmed' | 'disputed' | 'rejected'; at: number; resolvedAt: number | null; sector: number | null; resolvedBy: 'hider' | 'host' | null }
export interface Replay { id: string; catchId: string; seeker: string; hider: string; sector: number | null; at: number; expiresAt: number }

export type Audience = 'all' | 'seekers' | 'hiders' | 'host' | { players: string[] };
export interface GameEvent { id: number; at: number; type: string; text: string; audience: Audience; sound?: string[] }

export interface Paused { at: number; by: string; emergency: boolean; reason: string | null }

export interface GameState {
  id: string;
  code: string;
  simulation: boolean;
  createdAt: number;
  expiresAt: number;
  hostId: string;
  phase: Phase;
  lobbyStep: 'join' | 'teams' | 'confirm';
  paused: Paused | null;
  config: GameConfig;
  sectors: SectorCollection;
  landmarks: Landmark[];
  sectorState: Record<string, SectorStatus>;
  players: Record<string, Player>;
  groups: Record<string, Group>;
  headStartEndsAt: number | null;
  headStartOneMinuteSent: boolean;
  startedAt: number | null;
  liveAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
  endReason: string | null;
  nextVoteAt: number | null;
  voteRound: number;
  vote: Vote | null;
  closing: Closing | null;
  closedLog: { sector: number; at: number; by: 'vote' | 'host' }[];
  nextZoneAt: number | null;
  zones: Zone[];
  zoneTurn: number;
  nextPhotoAt: number | null;
  photoRound: PhotoRound | null;
  photoRoundSeq: number;
  photos: Photo[];
  clues: Clue[];
  catches: Catch[];
  replays: Replay[];
  finalTwoSent: boolean;
  events: GameEvent[];
  eventSeq: number;
  recentCmds: Record<string, string[]>;
  seed: number;
  rngState: number;
  lastAdvanceAt: number;
  lastViolationAt: Record<string, number>;
  lastZoneGroup: string | null;
}
