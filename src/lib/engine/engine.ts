/*
 * manhunt. game engine — the single source of truth for game rules.
 *
 * Pure functions over GameState: the server loads a game, calls advance(now) to process every
 * timer that is due, applies one command, and saves the result in one transaction. Clients never
 * decide outcomes; they only send intents (commands, GPS fixes, photo uploads).
 *
 * Timers are absolute deadlines (server ms). Pausing records the pause time; resuming shifts every
 * pending deadline by the paused duration, so nothing fires during a pause.
 */
import { DEFAULT_CONFIG, PROVISIONAL_SECTORS, provisionalLandmarks } from './config';
import { approximate, centroid, clusterMembers, distanceM, offsetM, sectorAt, sectorCentroid, validateSectors } from './geo';
import { nextRandom, pick, seedFrom } from './rng';
import type {
  Audience, Catch, GameConfig, GameEvent, GameMode, GameState, Group, LatLon, Photo, PhotoRequirement, Player, Role,
  SectorCollection, Zone, Landmark,
} from './types';

export class GameError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const fail = (code: string, msg: string, status = 400): never => { throw new GameError(code, msg, status); };

export const MAX_PLAYERS = 40;
const EVENT_CAP = 200;

/* ------------------------------------------------------------------ helpers */

const ms = (s: GameState, sec: number) => Math.round((sec * 1000) / (s.config.speed || 1));
const sectorNums = (s: GameState) => s.sectors.features.map((f) => f.properties.sector).sort((a, b) => a - b);
const pad2 = (n: number) => String(n).padStart(2, '0');
export const sectorClip = (n: number) => `sector_${pad2(n)}`;

export function emit(s: GameState, now: number, type: string, text: string, audience: Audience = 'all', sound?: string[]): GameEvent {
  const e: GameEvent = { id: ++s.eventSeq, at: now, type, text, audience, sound };
  s.events.push(e);
  if (s.events.length > EVENT_CAP) s.events.splice(0, s.events.length - EVENT_CAP);
  return e;
}

export const activePlayers = (s: GameState) => Object.values(s.players).filter((p) => !p.left);
export const activeHiders = (s: GameState) => activePlayers(s).filter((p) => p.role === 'hider');
export const activeSeekers = (s: GameState) => activePlayers(s).filter((p) => p.role === 'seeker');
const isFresh = (s: GameState, p: Player, now: number) => !!p.fix && now - p.fix.at <= ms(s, s.config.staleSec) && p.gps !== 'denied';
/** A player whose GPS is unavailable has their participation paused (not the match). */
export const participating = (s: GameState, p: Player, now: number) => !p.left && (p.gps === 'ok' || p.gps === 'poor') && isFresh(s, p, now);

function groupActiveMembers(s: GameState, g: Group): Player[] {
  return g.members.map((id) => s.players[id]).filter((p) => p && !p.left && p.role === 'hider');
}

function allowedSectorsFor(s: GameState, g: Group | null): Set<number> {
  const open = new Set(sectorNums(s).filter((n) => s.sectorState[n] !== 'closed'));
  if (s.config.mode === 'groupSelected' && g?.chosenSector) return new Set([g.chosenSector].filter((n) => open.has(n)));
  return open;
}

function newId(s: GameState, prefix: string) {
  return prefix + Math.floor(nextRandom(s) * 2 ** 32).toString(36) + (s.eventSeq + 1).toString(36);
}

/* ------------------------------------------------------------------ creation */

export interface NewGameInput { id: string; code: string; hostId: string; hostName: string; hostTokenHash: string; now: number; simulation?: boolean }

export function createGame(i: NewGameInput): GameState {
  const s: GameState = {
    id: i.id, code: i.code, simulation: !!i.simulation, createdAt: i.now, expiresAt: i.now + 12 * 3600_000,
    hostId: i.hostId, phase: 'lobby', lobbyStep: 'join', paused: null,
    config: { ...DEFAULT_CONFIG }, sectors: structuredClone(PROVISIONAL_SECTORS), landmarks: provisionalLandmarks(),
    sectorState: {}, players: {}, groups: {},
    headStartEndsAt: null, headStartOneMinuteSent: false, startedAt: null, liveAt: null, endedAt: null, winnerId: null, endReason: null,
    nextVoteAt: null, voteRound: 0, vote: null, closing: null, closedLog: [],
    nextZoneAt: null, zones: [], zoneTurn: 0, nextPhotoAt: null, photoRound: null, photoRoundSeq: 0, photos: [], clues: [],
    catches: [], replays: [], finalTwoSent: false, events: [], eventSeq: 0, recentCmds: {},
    seed: seedFrom(i.id), rngState: seedFrom(i.id), lastAdvanceAt: i.now, lastViolationAt: {}, lastZoneGroup: null,
  };
  for (const n of sectorNums(s)) s.sectorState[n] = 'open';
  addPlayer(s, { id: i.hostId, nickname: i.hostName, tokenHash: i.hostTokenHash, now: i.now });
  return s;
}

export function normalizeNickname(n: string) {
  return n.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function addPlayer(s: GameState, i: { id: string; nickname: string; tokenHash: string; now: number; isBot?: boolean }): Player {
  if (s.phase !== 'lobby') fail('locked', 'This game has already started.', 409);
  if (activePlayers(s).length >= MAX_PLAYERS) fail('full', 'This game is full.', 409);
  const nick = normalizeNickname(i.nickname);
  if (nick.length < 2) fail('nickname', 'Nicknames need at least 2 characters.');
  if (activePlayers(s).some((p) => p.nickname.toLowerCase() === nick.toLowerCase())) fail('nickname_taken', 'Someone in this game already has that nickname.', 409);
  const p: Player = {
    id: i.id, nickname: nick, tokenHash: i.tokenHash, role: 'unassigned', ready: false, joinedAt: i.now, lastSeen: i.now,
    groupId: null, fix: null, sector: null, gps: 'none', caughtAt: null, wasHider: false, isBot: i.isBot,
  };
  s.players[p.id] = p;
  if (!i.isBot) emit(s, i.now, 'player_joined', `${nick} joined`, 'all');
  emit(s, i.now, 'welcome', 'Welcome to manhunt.', { players: [p.id] }, ['welcome']);
  return p;
}

/* ------------------------------------------------------------------ location */

export function updateLocation(s: GameState, playerId: string, fix: { lat: number; lon: number; acc: number; sim?: boolean }, now: number) {
  const p = s.players[playerId];
  if (!p || p.left) fail('not_found', 'Player not found.', 404);
  if (fix.sim && !s.simulation) fail('sim_only', 'Simulated locations are only allowed in simulation games.', 403);
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) fail('bad_fix', 'Invalid location.');
  const acc = Math.max(1, Math.min(5000, fix.acc || 9999));
  p.fix = { lat: fix.lat, lon: fix.lon, acc, at: now, sim: fix.sim };
  p.lastSeen = now;
  p.sector = acc <= 60 ? sectorAt(s.sectors, p.fix) : p.sector; // ignore sector changes from very poor fixes
  const wasBad = p.gps !== 'ok' && p.gps !== 'poor' && p.gps !== 'none';
  p.gps = acc <= 30 ? 'ok' : 'poor';
  if (wasBad && s.phase !== 'lobby') emit(s, now, 'gps_restored', 'Location is back. You are in the game again.', { players: [p.id] });
  p.gpsWarnedAt = null;
}

export function reportGpsProblem(s: GameState, playerId: string, kind: 'denied' | 'unavailable', now: number) {
  const p = s.players[playerId];
  if (!p) fail('not_found', 'Player not found.', 404);
  p.gps = kind === 'denied' ? 'denied' : 'stale';
  p.lastSeen = now;
  if (s.phase === 'headstart' || s.phase === 'live') {
    emit(s, now, 'gps_unavailable', 'Location unavailable. You are paused until it returns.', { players: [p.id] }, ['gps_unavailable']);
    emit(s, now, 'gps_host', `${p.nickname} has no location right now`, 'host');
  }
}

/* ------------------------------------------------------------------ commands */

export type Command =
  | { type: 'heartbeat' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'lobbyStep'; step: 'join' | 'teams' | 'confirm' }
  | { type: 'assignRole'; playerId: string; role: Role }
  | { type: 'randomizeRoles'; seekers: number }
  | { type: 'kick'; playerId: string }
  | { type: 'makeHost'; playerId: string }
  | { type: 'createGroup'; name: string }
  | { type: 'joinGroup'; groupId: string }
  | { type: 'confirmGroup' }
  | { type: 'leaveGroup' }
  | { type: 'chooseGroupSector'; sector: number }
  | { type: 'updateConfig'; patch: Partial<GameConfig> }
  | { type: 'setSectors'; sectors: SectorCollection; landmarks?: Landmark[]; verified: boolean }
  | { type: 'startGame' }
  | { type: 'restartHeadStart' }
  | { type: 'pause'; emergency?: boolean; reason?: string }
  | { type: 'resume' }
  | { type: 'endGame' }
  | { type: 'returnToLobby' }
  | { type: 'reportCatch'; hiderId: string }
  | { type: 'respondCatch'; catchId: string; accept: boolean }
  | { type: 'resolveCatch'; catchId: string; caught: boolean }
  | { type: 'castVote'; sector: number }
  | { type: 'overrideVote'; sector: number }
  | { type: 'setSectorState'; sector: number; status: 'open' | 'closed' }
  | { type: 'reviewPhoto'; photoId: string; approve: boolean; reason?: string }
  | { type: 'leave' }
  | { type: 'savePush'; subscription: unknown }
  | { type: 'gpsProblem'; kind: 'denied' | 'unavailable' }
  // simulation only
  | { type: 'simAddBots'; hiders: number; seekers: number; groupSize: number }
  | { type: 'simSetSpeed'; speed: number }
  | { type: 'simMovePlayer'; playerId: string; lat: number; lon: number }
  | { type: 'simBotFlags'; playerId: string; flags: { offline?: boolean; gpsFail?: boolean; disputeNext?: boolean } }
  | { type: 'simBotAction'; playerId: string; action: 'reportCatch' | 'vote' | 'submitPhoto'; target?: string; sector?: number }
  | { type: 'simSkip'; what: 'headstart' | 'vote' | 'zone' | 'photo' | 'closing' };

const HOST_ONLY = new Set(['lobbyStep', 'assignRole', 'randomizeRoles', 'kick', 'makeHost', 'updateConfig', 'setSectors', 'startGame', 'restartHeadStart',
  'pause', 'resume', 'endGame', 'returnToLobby', 'resolveCatch', 'overrideVote', 'setSectorState', 'reviewPhoto']);
const SIM_ONLY = (t: string) => t.startsWith('sim');

export function applyCommand(s: GameState, actorId: string, cmd: Command, now: number, cmdId?: string): { duplicate: boolean } {
  const actor = s.players[actorId];
  if (!actor || actor.left) fail('not_member', 'You are not in this game.', 403);
  actor.lastSeen = now;
  if (actor.isBot) fail('forbidden', 'Bots cannot send commands.', 403);
  if (cmdId) {
    const seen = (s.recentCmds[actorId] ||= []);
    if (seen.includes(cmdId)) return { duplicate: true };
    seen.push(cmdId);
    if (seen.length > 30) seen.shift();
  }
  if (HOST_ONLY.has(cmd.type) && actorId !== s.hostId) fail('host_only', 'Only the host can do that.', 403);
  if (SIM_ONLY(cmd.type) && !s.simulation) fail('sim_only', 'That only works in simulation games.', 403);
  if (SIM_ONLY(cmd.type) && actorId !== s.hostId) fail('host_only', 'Only the host can drive the simulator.', 403);
  const inGame = s.phase === 'headstart' || s.phase === 'live';

  switch (cmd.type) {
    case 'heartbeat': return ok();
    case 'gpsProblem': reportGpsProblem(s, actorId, cmd.kind, now); return ok();
    case 'savePush': actor.push = cmd.subscription; return ok();
    case 'setReady': requireLobby(s); actor.ready = !!cmd.ready; return ok();
    case 'lobbyStep': {
      requireLobby(s); s.lobbyStep = cmd.step;
      if (cmd.step === 'teams') emit(s, now, 'choose_teams', 'Choose teams and form hider groups.', 'all', ['choose_teams']);
      if (cmd.step === 'confirm') emit(s, now, 'confirm_teams', 'Check your team and group, then tap Ready.', 'all', ['confirm_teams']);
      return ok();
    }
    case 'assignRole': {
      requireLobby(s);
      const p = need(s, cmd.playerId);
      setRole(s, p, cmd.role);
      return ok();
    }
    case 'randomizeRoles': {
      requireLobby(s);
      const ps = activePlayers(s);
      const k = Math.max(1, Math.min(ps.length - 2, Math.floor(cmd.seekers)));
      if (ps.length < 3) fail('players', 'Random roles need at least 3 players.');
      const order = ps.map((p) => ({ p, r: nextRandom(s) })).sort((a, b) => a.r - b.r).map((x) => x.p);
      order.forEach((p, i) => setRole(s, p, i < k ? 'seeker' : 'hider'));
      emit(s, now, 'roles_randomized', `Roles shuffled: ${k} seeker${k > 1 ? 's' : ''}.`);
      return ok();
    }
    case 'kick': {
      requireLobby(s);
      if (cmd.playerId === s.hostId) fail('bad', 'The host cannot remove themselves.');
      const p = need(s, cmd.playerId);
      removeFromGroup(s, p); p.left = true; delete s.players[p.id];
      return ok();
    }
    case 'makeHost': { const p = need(s, cmd.playerId); if (p.isBot) fail('bad', 'A bot cannot host.'); s.hostId = p.id; emit(s, now, 'host_changed', `${p.nickname} is now the host.`); return ok(); }
    case 'createGroup': {
      requireLobby(s);
      if (actor.role !== 'hider') fail('hiders_only', 'Only hiders can create groups. Seekers cannot join hider groups.');
      removeFromGroup(s, actor);
      const name = normalizeNickname(cmd.name || '') || `Group ${String.fromCharCode(65 + Object.keys(s.groups).length)}`;
      const g: Group = { id: newId(s, 'g'), name, createdBy: actorId, members: [actorId], confirmed: { [actorId]: true }, chosenSector: null, together: true, clusters: [[actorId]], splitSince: null };
      s.groups[g.id] = g; actor.groupId = g.id;
      return ok();
    }
    case 'joinGroup': {
      requireLobby(s);
      if (actor.role !== 'hider') fail('hiders_only', 'Seekers cannot join hider groups.');
      const g = s.groups[cmd.groupId] || fail('not_found', 'Group not found.', 404);
      removeFromGroup(s, actor);
      g.members.push(actorId); g.confirmed[actorId] = false; actor.groupId = g.id;
      return ok();
    }
    case 'confirmGroup': {
      requireLobby(s);
      const g = (actor.groupId && s.groups[actor.groupId]) || fail('no_group', 'Join a group first.');
      g.confirmed[actorId] = true; return ok();
    }
    case 'leaveGroup': requireLobby(s); removeFromGroup(s, actor); return ok();
    case 'chooseGroupSector': {
      requireLobby(s);
      const g = (actor.groupId && s.groups[actor.groupId]) || fail('no_group', 'Join a group first.');
      if (!sectorNums(s).includes(cmd.sector)) fail('bad_sector', 'Unknown sector.');
      g.chosenSector = cmd.sector; return ok();
    }
    case 'updateConfig': {
      requireLobby(s);
      s.config = sanitizeConfig({ ...s.config, ...cmd.patch }, s);
      return ok();
    }
    case 'setSectors': {
      requireLobby(s);
      const issues = validateSectors(cmd.sectors);
      if (issues.length) fail('invalid_sectors', issues.map((i) => i.detail).join('. '));
      s.sectors = cmd.sectors;
      if (cmd.landmarks) s.landmarks = cmd.landmarks.slice(0, 50);
      s.config.sectorsVerified = !!cmd.verified;
      s.sectorState = {}; for (const n of sectorNums(s)) s.sectorState[n] = 'open';
      return ok();
    }
    case 'startGame': startGame(s, now); return ok();
    case 'restartHeadStart': {
      if (s.phase !== 'headstart') fail('phase', 'The head start is not running.');
      s.headStartEndsAt = now + ms(s, s.config.headStartSec); s.headStartOneMinuteSent = false;
      if (s.paused) s.paused = null;
      emit(s, now, 'headstart_restarted', 'The host restarted the head start.');
      return ok();
    }
    case 'pause': {
      if (!inGame) fail('phase', 'The game is not running.');
      if (s.paused) { if (cmd.emergency && !s.paused.emergency) { s.paused.emergency = true; emit(s, now, 'emergency_pause', 'Emergency pause. Stop where you are and check in with the host.', 'all', ['emergency_pause']); } return ok(); }
      s.paused = { at: now, by: actorId, emergency: !!cmd.emergency, reason: cmd.reason?.slice(0, 120) || null };
      if (cmd.emergency) emit(s, now, 'emergency_pause', 'Emergency pause. Stop where you are and check in with the host.', 'all', ['emergency_pause']);
      else emit(s, now, 'game_paused', 'The host paused the game.', 'all', ['game_paused']);
      return ok();
    }
    case 'resume': {
      if (!s.paused) fail('phase', 'The game is not paused.');
      shiftDeadlines(s, now - s.paused!.at);
      s.paused = null;
      emit(s, now, 'game_resumed', 'The game is back on.', 'all', ['game_resumed']);
      return ok();
    }
    case 'endGame': if (!inGame) fail('phase', 'The game is not running.'); endGame(s, now, null, 'Ended by the host'); return ok();
    case 'returnToLobby': {
      if (s.phase !== 'ended') fail('phase', 'Finish the game first.');
      resetToLobby(s, now); return ok();
    }
    case 'reportCatch': reportCatch(s, actor, cmd.hiderId, now); return ok();
    case 'respondCatch': respondCatch(s, actor, cmd.catchId, cmd.accept, now); return ok();
    case 'resolveCatch': {
      const c = s.catches.find((x) => x.id === cmd.catchId) || fail('not_found', 'Catch not found.', 404);
      if (c.status !== 'disputed' && c.status !== 'pending') fail('resolved', 'That catch is already resolved.', 409);
      if (cmd.caught) confirmCatch(s, c, now, 'host');
      else { c.status = 'rejected'; c.resolvedAt = now; c.resolvedBy = 'host'; emit(s, now, 'catch_rejected', `Host ruled ${s.players[c.hiderId]?.nickname} not caught.`, { players: [c.seekerId, c.hiderId, s.hostId] }); }
      return ok();
    }
    case 'castVote': castVote(s, actor, cmd.sector, now); return ok();
    case 'overrideVote': {
      if (s.phase !== 'live') fail('phase', 'The game is not live.');
      if (s.sectorState[cmd.sector] !== 'open') fail('bad_sector', 'Pick an open sector.');
      if (s.closing) fail('busy', `Sector ${s.closing.sector} is already closing.`, 409);
      if (s.vote) { s.vote = null; emit(s, now, 'vote_override', `Host override: sector ${cmd.sector} selected.`); }
      startClosing(s, cmd.sector, now);
      return ok();
    }
    case 'setSectorState': {
      const cur = s.sectorState[cmd.sector] || fail('bad_sector', 'Unknown sector.');
      if (cmd.status === 'closed') {
        if (cur === 'closing' && s.closing) s.closing = null;
        s.sectorState[cmd.sector] = 'closed'; s.closedLog.push({ sector: cmd.sector, at: now, by: 'host' });
        emit(s, now, 'sector_closed', `Host closed sector ${cmd.sector}.`, 'all', ['sector_closed', sectorClip(cmd.sector)]);
      } else {
        if (cur === 'closing' && s.closing?.sector === cmd.sector) s.closing = null;
        s.sectorState[cmd.sector] = 'open';
        emit(s, now, 'sector_reopened', `Host reopened sector ${cmd.sector}.`);
      }
      return ok();
    }
    case 'reviewPhoto': reviewPhoto(s, cmd.photoId, cmd.approve, cmd.reason ?? null, now); return ok();
    case 'leave': {
      if (s.phase === 'lobby') { removeFromGroup(s, actor); delete s.players[actorId]; }
      else { actor.left = true; actor.fix = null; actor.sector = null; }
      if (actorId === s.hostId) {
        const next = activePlayers(s).filter((p) => !p.isBot).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (next) { s.hostId = next.id; emit(s, now, 'host_changed', `${next.nickname} is now the host.`); }
      }
      emit(s, now, 'player_left', `${actor.nickname} left the game.`);
      if (s.phase === 'live' || s.phase === 'headstart') checkWin(s, now);
      return ok();
    }
    case 'simAddBots': simAddBots(s, cmd.hiders, cmd.seekers, cmd.groupSize, now); return ok();
    case 'simSetSpeed': {
      const speed = [1, 5, 10, 30].includes(cmd.speed) ? cmd.speed : fail('bad', 'Speed must be 1, 5, 10 or 30.');
      rescaleDeadlines(s, now, s.config.speed / speed); s.config.speed = speed; return ok();
    }
    case 'simMovePlayer': {
      const p = need(s, cmd.playerId);
      updateLocation(s, p.id, { lat: cmd.lat, lon: cmd.lon, acc: 6, sim: true }, now);
      if (p.isBot) p.botTarget = { lat: cmd.lat, lon: cmd.lon };
      return ok();
    }
    case 'simBotFlags': { const p = need(s, cmd.playerId); if (!p.isBot) fail('bad', 'Not a bot.'); p.botFlags = { ...p.botFlags, ...cmd.flags }; if (cmd.flags.gpsFail) { p.gps = 'stale'; } return ok(); }
    case 'simBotAction': {
      const p = need(s, cmd.playerId); if (!p.isBot) fail('bad', 'Not a bot.');
      if (cmd.action === 'reportCatch') reportCatch(s, p, cmd.target || fail('bad', 'Pick a hider.'), now);
      if (cmd.action === 'vote') castVote(s, p, cmd.sector ?? fail('bad', 'Pick a sector.'), now);
      if (cmd.action === 'submitPhoto') submitPhoto(s, p.id, newId(s, 'ph'), now, true);
      return ok();
    }
    case 'simSkip': {
      if (cmd.what === 'headstart' && s.headStartEndsAt) s.headStartEndsAt = now;
      if (cmd.what === 'vote') { if (s.vote) s.vote.closesAt = now; else s.nextVoteAt = now; }
      if (cmd.what === 'zone') s.nextZoneAt = now;
      if (cmd.what === 'photo') { if (s.photoRound && !s.photoRound.closed) s.photoRound.dueAt = now; else s.nextPhotoAt = now; }
      if (cmd.what === 'closing' && s.closing) s.closing.closesAt = now;
      return ok();
    }
  }
  return ok();
}
const ok = () => ({ duplicate: false });
function need(s: GameState, id: string) { const p = s.players[id]; if (!p || p.left) fail('not_found', 'Player not found.', 404); return p!; }
function requireLobby(s: GameState) { if (s.phase !== 'lobby') fail('locked', 'Teams and groups are locked once the match starts.', 409); }

function setRole(s: GameState, p: Player, role: Role) {
  p.role = role;
  if (role !== 'hider') removeFromGroup(s, p);
}

function removeFromGroup(s: GameState, p: Player) {
  if (!p.groupId) return;
  const g = s.groups[p.groupId];
  p.groupId = null;
  if (!g) return;
  g.members = g.members.filter((m) => m !== p.id);
  delete g.confirmed[p.id];
  if (g.members.length === 0) delete s.groups[g.id];
}

export function sanitizeConfig(c: GameConfig, s: GameState): GameConfig {
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const nums = sectorNums(s);
  const modes: GameMode[] = ['multi', 'shared', 'groupSelected', 'oneOpen'];
  const d = DEFAULT_CONFIG;
  return {
    mode: modes.includes(c.mode) ? c.mode : 'multi',
    sharedSector: nums.includes(c.sharedSector as number) ? c.sharedSector : null,
    openSector: nums.includes(c.openSector as number) ? c.openSector : null,
    headStartSec: clamp(c.headStartSec, 30, 600, d.headStartSec),
    voteEverySec: clamp(c.voteEverySec, 120, 3600, d.voteEverySec),
    voteDurationSec: clamp(c.voteDurationSec, 30, 600, d.voteDurationSec),
    closeGraceSec: clamp(c.closeGraceSec, 60, 900, d.closeGraceSec),
    zoneEverySec: clamp(c.zoneEverySec, 60, 1800, d.zoneEverySec),
    zoneDurationSec: clamp(c.zoneDurationSec, 15, 300, d.zoneDurationSec),
    zoneStages: 3,
    zoneStartRadiusM: clamp(c.zoneStartRadiusM, 40, 400, d.zoneStartRadiusM),
    zoneMinRadiusM: clamp(c.zoneMinRadiusM, 25, 200, d.zoneMinRadiusM),
    photoEverySec: clamp(c.photoEverySec, 60, 3600, d.photoEverySec),
    photoWindowSec: clamp(c.photoWindowSec, 30, 600, d.photoWindowSec),
    clueDurationSec: clamp(c.clueDurationSec, 15, 600, d.clueDurationSec),
    clueRadiusM: clamp(c.clueRadiusM, 30, 300, d.clueRadiusM),
    violation: c.violation === 'none' ? 'none' : 'clue',
    separationM: clamp(c.separationM, 15, 120, d.separationM),
    separationHoldSec: clamp(c.separationHoldSec, 0, 120, d.separationHoldSec),
    staleSec: clamp(c.staleSec, 15, 300, d.staleSec),
    replayRetentionHours: clamp(c.replayRetentionHours, 1, 168, d.replayRetentionHours),
    sectorsVerified: !!c.sectorsVerified,
    speed: s.simulation ? ([1, 5, 10, 30].includes(c.speed) ? c.speed : 1) : 1,
    seekerStartNote: typeof c.seekerStartNote === 'string' ? c.seekerStartNote.replace(/[<>]/g, '').slice(0, 80) : '',
  };
}

/* ------------------------------------------------------------------ lifecycle */

export function startProblems(s: GameState): string[] {
  const out: string[] = [];
  const ps = activePlayers(s);
  const hiders = ps.filter((p) => p.role === 'hider'), seekers = ps.filter((p) => p.role === 'seeker');
  if (ps.some((p) => p.role === 'unassigned')) out.push('Everyone needs a role.');
  if (seekers.length < 1) out.push('Add at least one seeker.');
  if (hiders.length < 2) out.push('Add at least two hiders.');
  for (const h of hiders) if (!h.groupId) out.push(`${h.nickname} is not in a group. Solo hiders are not allowed.`);
  for (const g of Object.values(s.groups)) {
    const confirmed = g.members.filter((m) => g.confirmed[m]);
    if (g.members.length < 2) out.push(`${g.name} needs at least two members.`);
    if (confirmed.length !== g.members.length) out.push(`Everyone in ${g.name} must confirm.`);
    if (s.config.mode === 'groupSelected' && !g.chosenSector) out.push(`${g.name} has not chosen its sector.`);
  }
  if (s.config.mode === 'shared' && !s.config.sharedSector) out.push('Pick the shared sector.');
  if (s.config.mode === 'oneOpen' && !s.config.openSector) out.push('Pick the open sector.');
  const notReady = ps.filter((p) => !p.ready && !p.isBot && p.id !== s.hostId);
  if (notReady.length) out.push(`Waiting for ${notReady.map((p) => p.nickname).join(', ')} to be ready.`);
  return out;
}

function startGame(s: GameState, now: number) {
  requireLobby(s);
  const problems = startProblems(s);
  if (problems.length) fail('not_ready', problems.join(' '), 409);
  for (const g of Object.values(s.groups)) { g.together = true; g.clusters = [g.members.slice()]; g.splitSince = null; }
  for (const p of activePlayers(s)) { p.wasHider = p.role === 'hider'; p.caughtAt = null; }
  const nums = sectorNums(s);
  for (const n of nums) s.sectorState[n] = 'open';
  if (s.config.mode === 'shared') for (const n of nums) s.sectorState[n] = n === s.config.sharedSector ? 'open' : 'closed';
  if (s.config.mode === 'oneOpen') for (const n of nums) s.sectorState[n] = n === s.config.openSector ? 'open' : 'closed';
  s.phase = 'headstart'; s.startedAt = now; s.paused = null;
  s.headStartEndsAt = now + ms(s, s.config.headStartSec); s.headStartOneMinuteSent = false;
  emit(s, now, 'teams_finalized', 'Teams are final. Hiders, you have a two-minute head start. Walk, don\'t run.', 'all', ['teams_finalized']);
}

function goLive(s: GameState, at: number) {
  s.phase = 'live'; s.liveAt = at; s.headStartEndsAt = null;
  s.nextVoteAt = s.config.mode === 'multi' ? at + ms(s, s.config.voteEverySec) : null; // voting only in multi-sector mode
  s.nextZoneAt = at + ms(s, s.config.zoneEverySec);
  s.nextPhotoAt = at + ms(s, s.config.photoEverySec);
  emit(s, at, 'seekers_released', 'Seekers released. The hunt is on.', 'all');
}

function endGame(s: GameState, now: number, winnerId: string | null, reason: string) {
  s.phase = 'ended'; s.endedAt = now; s.winnerId = winnerId; s.endReason = reason;
  s.vote = null; s.closing = null; s.zones = []; s.clues = []; s.paused = null;
  if (s.photoRound) s.photoRound.closed = true;
  // Positions are not needed once the game is over.
  for (const p of Object.values(s.players)) { p.fix = null; p.sector = null; }
  if (winnerId) emit(s, now, 'winner', `${s.players[winnerId]?.nickname} wins.`, 'all', ['winner']);
  emit(s, now, 'game_over', 'Game over.', 'all', ['game_over']);
}

function resetToLobby(s: GameState, now: number) {
  s.phase = 'lobby'; s.lobbyStep = 'teams';
  s.startedAt = s.liveAt = s.endedAt = s.headStartEndsAt = null; s.winnerId = null; s.endReason = null;
  s.nextVoteAt = s.nextZoneAt = s.nextPhotoAt = null; s.vote = null; s.closing = null; s.closedLog = [];
  s.zones = []; s.clues = []; s.photoRound = null; s.photos = []; s.catches = []; s.finalTwoSent = false; s.voteRound = 0;
  for (const n of sectorNums(s)) s.sectorState[n] = 'open';
  for (const p of Object.values(s.players)) {
    if (p.left) { delete s.players[p.id]; continue; }
    p.ready = false; if (p.wasHider) p.role = 'hider'; p.caughtAt = null;
  }
  for (const g of Object.values(s.groups)) { g.members = g.members.filter((m) => s.players[m]); if (!g.members.length) delete s.groups[g.id]; }
  emit(s, now, 'lobby', 'Back in the lobby. Replays stay available until they expire.');
}

function shiftDeadlines(s: GameState, d: number) {
  if (s.headStartEndsAt) s.headStartEndsAt += d;
  if (s.nextVoteAt) s.nextVoteAt += d;
  if (s.vote) s.vote.closesAt += d;
  if (s.closing) s.closing.closesAt += d;
  if (s.nextZoneAt) s.nextZoneAt += d;
  for (const z of s.zones) { z.startAt += d; z.endsAt += d; }
  if (s.nextPhotoAt) s.nextPhotoAt += d;
  if (s.photoRound && !s.photoRound.closed) s.photoRound.dueAt += d;
  for (const c of s.clues) c.until += d;
  // Fixes received before the pause should not instantly count as stale after it.
  for (const p of Object.values(s.players)) if (p.fix) p.fix.at += d;
}

/** Simulation speed change: compress/expand the remaining time of every pending deadline. */
function rescaleDeadlines(s: GameState, now: number, f: number) {
  const r = (t: number | null) => (t == null ? t : now + Math.max(0, t - now) * f);
  s.headStartEndsAt = r(s.headStartEndsAt); s.nextVoteAt = r(s.nextVoteAt); s.nextZoneAt = r(s.nextZoneAt); s.nextPhotoAt = r(s.nextPhotoAt);
  if (s.vote) s.vote.closesAt = r(s.vote.closesAt)!;
  if (s.closing) s.closing.closesAt = r(s.closing.closesAt)!;
  if (s.photoRound && !s.photoRound.closed) s.photoRound.dueAt = r(s.photoRound.dueAt)!;
  for (const z of s.zones) { const st = z.startAt; z.stageMs *= f; z.startAt = now - (now - st) * f; z.endsAt = r(z.endsAt)!; }
  for (const c of s.clues) c.until = r(c.until)!;
}

/* ------------------------------------------------------------------ catches */

function reportCatch(s: GameState, seeker: Player, hiderId: string, now: number) {
  if (s.phase === 'headstart') fail('headstart', 'Catches are disabled during the head start.', 409);
  if (s.phase !== 'live') fail('phase', 'The game is not live.', 409);
  if (s.paused) fail('paused', 'The game is paused.', 409);
  if (seeker.role !== 'seeker') fail('seekers_only', 'Only seekers can report catches.', 403);
  if (!participating(s, seeker, now) && !seeker.isBot) fail('gps', 'Your location is unavailable, so you are paused until it returns.', 409);
  const h = s.players[hiderId];
  if (!h || h.left || h.role !== 'hider') fail('not_hider', 'That player is not an active hider.', 409);
  if (s.catches.some((c) => c.hiderId === hiderId && (c.status === 'pending' || c.status === 'disputed'))) fail('pending', `A catch on ${h!.nickname} is already waiting.`, 409);
  const c: Catch = { id: newId(s, 'c'), seekerId: seeker.id, hiderId, status: 'pending', at: now, resolvedAt: null, sector: seeker.sector, resolvedBy: null };
  s.catches.push(c);
  emit(s, now, 'catch_reported', `${seeker.nickname} says they caught you. Confirm or dispute.`, { players: [hiderId] }, ['catch_reported']);
  emit(s, now, 'catch_reported_seeker', `Waiting for ${h!.nickname} to confirm.`, { players: [seeker.id] });
  if (s.hostId !== hiderId && s.hostId !== seeker.id) emit(s, now, 'catch_reported_host', `${seeker.nickname} reported catching ${h!.nickname}.`, 'host');
}

function respondCatch(s: GameState, actor: Player, catchId: string, accept: boolean, now: number) {
  const c = s.catches.find((x) => x.id === catchId) || fail('not_found', 'Catch not found.', 404);
  if (c.hiderId !== actor.id) fail('forbidden', 'Only the caught player can answer this.', 403);
  if (c.status !== 'pending') fail('resolved', 'You already answered this.', 409);
  if (accept) confirmCatch(s, c, now, 'hider');
  else {
    c.status = 'disputed';
    emit(s, now, 'catch_disputed', `${actor.nickname} disputed the catch. The host will decide.`, { players: [c.seekerId, c.hiderId, s.hostId] }, ['catch_disputed']);
  }
}

function confirmCatch(s: GameState, c: Catch, now: number, by: 'hider' | 'host') {
  c.status = 'confirmed'; c.resolvedAt = now; c.resolvedBy = by;
  const h = s.players[c.hiderId], k = s.players[c.seekerId];
  // Only the caught player changes role. Their group stays intact for everyone else.
  if (h && h.role === 'hider') { h.role = 'seeker'; h.caughtAt = now; }
  if (s.photoRound) for (const r of s.photoRound.reqs) r.memberIds = r.memberIds.filter((m) => m !== c.hiderId);
  s.replays.push({ id: newId(s, 'r'), catchId: c.id, seeker: k?.nickname ?? 'Seeker', hider: h?.nickname ?? 'Hider', sector: c.sector, at: now, expiresAt: now + s.config.replayRetentionHours * 3600_000 });
  emit(s, now, 'catch_confirmed', `${h?.nickname} was caught by ${k?.nickname} and is now a seeker.`, 'all', ['catch_confirmed']);
  checkWin(s, now);
}

function checkWin(s: GameState, now: number) {
  if (s.phase !== 'live' && s.phase !== 'headstart') return;
  const hiders = activeHiders(s);
  if (hiders.length === 2 && !s.finalTwoSent) { s.finalTwoSent = true; emit(s, now, 'final_two', 'Two hiders left.', 'all', ['final_two']); }
  // A game can only start with 2+ hiders, so this never fires immediately at the start.
  if (hiders.length <= 1) endGame(s, now, hiders[0]?.id ?? null, hiders.length ? 'Last hider standing' : 'No hiders left');
}

/* ------------------------------------------------------------------ voting & closures */

function castVote(s: GameState, p: Player, sector: number, now: number) {
  if (!s.vote) fail('no_vote', 'Voting is not open.', 409);
  if (s.paused) fail('paused', 'The game is paused.', 409);
  if (p.role !== 'seeker' || !s.vote!.eligible.includes(p.id)) fail('not_eligible', 'Only seekers active when voting opened can vote.', 403);
  if (s.vote!.votes[p.id] != null) fail('already', 'You already voted.', 409);
  const st = s.sectorState[sector];
  if (!st) fail('bad_sector', 'Unknown sector.');
  if (st === 'closed') fail('closed', 'That sector is already closed.', 409); // original rule: only closed sectors are blocked
  s.vote!.votes[p.id] = sector;
  emit(s, now, 'vote_cast', `You voted for sector ${sector}.`, { players: [p.id] });
  const remaining = s.vote!.eligible.filter((id) => s.players[id] && !s.players[id].left && s.vote!.votes[id] == null);
  if (remaining.length === 0) closeVote(s, now); // closes early when everyone eligible has voted
}

/**
 * Tally. Documented tie-break: when several sectors share the top count, the server picks one of them
 * using the game's seeded random generator (stored in the game state), so the choice is fair, cannot be
 * predicted by players, and every server instance reaches the same result.
 */
export function tally(s: GameState, votes: Record<string, number>): { winner: number | null; counts: Record<number, number>; tied: number[] } {
  const counts: Record<number, number> = {};
  for (const v of Object.values(votes)) if (s.sectorState[v] !== 'closed') counts[v] = (counts[v] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return { winner: null, counts, tied: [] };
  const tied = Object.keys(counts).map(Number).filter((k) => counts[k] === max).sort((a, b) => a - b);
  return { winner: tied.length === 1 ? tied[0] : pick(s, tied), counts, tied };
}

function closeVote(s: GameState, now: number) {
  const v = s.vote!; s.vote = null;
  const { winner, tied } = tally(s, v.votes);
  emit(s, now, 'sector_voting_closed', 'Sector voting closed.', 'all', ['sector_voting_closed']);
  if (winner == null) { emit(s, now, 'vote_none', 'No votes were cast. No sector closes this round.'); return; }
  if (tied.length > 1) emit(s, now, 'vote_tie', `Tie between sectors ${tied.join(', ')}. Sector ${winner} was drawn.`);
  if (s.closing) { emit(s, now, 'vote_busy', `Sector ${s.closing.sector} is still closing, so sector ${winner} was not added.`); return; }
  if (s.sectorState[winner] !== 'open') return;
  startClosing(s, winner, now);
}

function startClosing(s: GameState, sector: number, now: number) {
  const affected = Object.values(s.groups).filter((g) => groupActiveMembers(s, g).some((m) => m.sector === sector)).map((g) => g.id);
  s.sectorState[sector] = 'closing';
  s.closing = { sector, announcedAt: now, closesAt: now + ms(s, s.config.closeGraceSec), oneMinuteSent: false, affectedGroups: affected };
  emit(s, now, 'sector_closing', `Sector ${sector} closes in ${Math.round(s.config.closeGraceSec / 60)} minutes.`, 'all', ['sector_closing_3_minutes', sectorClip(sector)]);
  for (const gid of affected) {
    const members = s.groups[gid].members;
    emit(s, now, 'sector_relocate', `Someone in your group is in sector ${sector}. The whole group must move out before it closes.`, { players: members });
  }
}

function finishClosing(s: GameState, now: number) {
  const c = s.closing!; s.closing = null;
  s.sectorState[c.sector] = 'closed';
  s.closedLog.push({ sector: c.sector, at: now, by: 'vote' });
  emit(s, now, 'sector_closed', `Sector ${c.sector} is now closed.`, 'all', ['sector_closed', sectorClip(c.sector)]);
  checkViolations(s, now, true);
}

/** Groups with a member in a disallowed sector. Consequences only apply once sectors are verified. */
function checkViolations(s: GameState, now: number, force = false) {
  if (s.phase !== 'live') return;
  for (const g of Object.values(s.groups)) {
    const allowed = allowedSectorsFor(s, g);
    const offenders = groupActiveMembers(s, g).filter((m) => participating(s, m, now) && m.fix!.acc <= 30 && m.sector != null && !allowed.has(m.sector));
    if (!offenders.length) continue;
    const last = s.lastViolationAt[g.id] || 0;
    if (!force && now - last < ms(s, 90)) continue;
    s.lastViolationAt[g.id] = now;
    const where = [...new Set(offenders.map((o) => o.sector))].join(', ');
    if (!s.config.sectorsVerified || s.config.violation === 'none') {
      emit(s, now, 'violation_unenforced', `${g.name} may be in a closed sector (${where}). Automatic enforcement is off until sectors are verified.`, 'host');
      emit(s, now, 'violation_warning', `Your group needs to leave sector ${where}.`, { players: g.members });
      continue;
    }
    emit(s, now, 'sector_violation', `${g.name} is in a closed sector. Seekers get a temporary clue.`, 'all', ['sector_violation']);
    addClue(s, g, offenders, 'violation', now);
  }
}

function addClue(s: GameState, g: Group, members: Player[], reason: 'violation' | 'photo_missed', now: number) {
  const fixes = members.filter((m) => m.fix).map((m) => m.fix!) as LatLon[];
  if (!fixes.length) return;
  const c = centroid(fixes);
  const r = s.config.clueRadiusM;
  const ang = nextRandom(s) * 2 * Math.PI, dist = nextRandom(s) * r * 0.6; // true spot stays inside, centre is not the true spot
  const center = offsetM(c, Math.cos(ang) * dist, Math.sin(ang) * dist);
  s.clues.push({ id: newId(s, 'k'), groupId: g.id, playerId: members.length === 1 ? members[0].id : null, lat: center.lat, lon: center.lon, radiusM: r, until: now + ms(s, s.config.clueDurationSec), reason });
  emit(s, now, 'signal_new_location', reason === 'violation' ? `Location clue: ${g.name}.` : `Missed photo. Location clue: ${g.name}.`, 'seekers', ['signal_new_location']);
}

/* ------------------------------------------------------------------ zones */

function spawnZone(s: GameState, now: number) {
  const eligible = Object.values(s.groups).filter((g) => groupActiveMembers(s, g).some((m) => participating(s, m, now)));
  if (!eligible.length) return;
  const pool = eligible.length > 1 ? eligible.filter((g) => g.id !== s.lastZoneGroup) : eligible;
  const g = pick(s, pool);
  s.lastZoneGroup = g.id;
  const members = groupActiveMembers(s, g).filter((m) => participating(s, m, now));
  // One circle per together-cluster, so separated members in different sectors are each covered
  // without revealing which member is where.
  const clusters = clusterMembers(members.map((m) => ({ id: m.id, fix: m.fix })), s.config.separationM);
  const minR = s.config.zoneMinRadiusM, maxR = Math.max(minR, s.config.zoneStartRadiusM), n = s.config.zoneStages;
  const circles = clusters.map((cl) => {
    const c = centroid(cl.map((id) => s.players[id].fix!));
    const ang = nextRandom(s) * 2 * Math.PI, dist = (0.25 + nextRandom(s) * 0.4) * minR; // final stage still approximate
    const ctr = offsetM(c, Math.cos(ang) * dist, Math.sin(ang) * dist);
    const radii = Array.from({ length: n }, (_, i) => Math.round(maxR - ((maxR - minR) * i) / Math.max(1, n - 1)));
    return { lat: ctr.lat, lon: ctr.lon, radii };
  });
  const dur = ms(s, s.config.zoneDurationSec);
  const z: Zone = { id: newId(s, 'z'), groupId: g.id, circles, startAt: now, stageMs: dur / n, endsAt: now + dur };
  s.zones.push(z); s.zoneTurn++;
  emit(s, now, 'zone', `Search zone: ${g.name}. It shrinks over the next ${Math.round(s.config.zoneDurationSec)} seconds.`, 'seekers', ['signal_new_location']);
  emit(s, now, 'zone_hider', 'Seekers can see a search zone around your group.', { players: g.members });
}

export function zoneStage(z: Zone, now: number) { return Math.min(z.circles[0].radii.length - 1, Math.max(0, Math.floor((now - z.startAt) / z.stageMs))); }

/* ------------------------------------------------------------------ photo hints */

function openPhotoRound(s: GameState, now: number) {
  const reqs: PhotoRequirement[] = [];
  for (const g of Object.values(s.groups)) {
    const members = groupActiveMembers(s, g);
    if (!members.length) continue;
    // Together: one photo covers the group. Separated: each cluster (a lone member is their own cluster) submits.
    const clusters = g.together ? [members.map((m) => m.id)] : g.clusters.map((c) => c.filter((id) => members.some((m) => m.id === id))).filter((c) => c.length);
    clusters.forEach((ids, i) => reqs.push({ key: `${g.id}:${i}`, groupId: g.id, memberIds: ids, satisfiedBy: null, missed: false }));
  }
  if (!reqs.length) return;
  s.photoRound = { round: ++s.photoRoundSeq, requestedAt: now, dueAt: now + ms(s, s.config.photoWindowSec), reqs, sent60: false, sent30: false, closed: false };
  emit(s, now, 'photo_required', `Photo hint needed within ${Math.round(s.config.photoWindowSec / 60)} minutes.`, 'hiders', ['photo_required']);
}

export function requirementFor(s: GameState, playerId: string) {
  const r = s.photoRound;
  if (!r || r.closed) return null;
  return r.reqs.find((q) => q.memberIds.includes(playerId)) ?? null;
}

export function submitPhoto(s: GameState, playerId: string, photoId: string, now: number, sim = false): Photo {
  const p = s.players[playerId];
  if (!p || p.left || p.role !== 'hider') fail('forbidden', 'Only hiders send photo hints.', 403);
  if (s.phase !== 'live' || s.paused) fail('phase', 'Photo hints are only accepted while the game is live.', 409);
  const req = requirementFor(s, playerId) || fail('no_request', 'There is no open photo request for you.', 409);
  if (now > s.photoRound!.dueAt) fail('late', 'The photo window has closed.', 409);
  if (req!.satisfiedBy) fail('done', 'Your group already has an approved photo for this round.', 409);
  if (s.photos.some((x) => x.reqKey === req!.key && x.round === s.photoRound!.round && x.status === 'pending' && x.playerId === playerId)) fail('pending', 'Your photo is already waiting for review.', 409);
  const ph: Photo = { id: photoId, round: s.photoRound!.round, playerId, groupId: req!.groupId, reqKey: req!.key, status: 'pending', reason: null, at: now, reviewedAt: null, sim };
  s.photos.push(ph);
  emit(s, now, 'photo_submitted', 'Photo sent. The host will review it.', { players: req!.memberIds }, ['photo_submitted']);
  emit(s, now, 'photo_review', `${p!.nickname} sent a photo hint to review.`, 'host');
  return ph;
}

function reviewPhoto(s: GameState, photoId: string, approve: boolean, reason: string | null, now: number) {
  const ph = s.photos.find((x) => x.id === photoId) || fail('not_found', 'Photo not found.', 404);
  if (ph.status !== 'pending') fail('reviewed', 'That photo was already reviewed.', 409);
  ph.status = approve ? 'approved' : 'rejected'; ph.reviewedAt = now; ph.reason = approve ? null : (reason || 'Not a clear business sign or storefront').slice(0, 140);
  const r = s.photoRound;
  const req = r && r.round === ph.round ? r.reqs.find((q) => q.key === ph.reqKey) : null;
  const who = req?.memberIds ?? [ph.playerId];
  if (approve) {
    if (req && !req.satisfiedBy) req.satisfiedBy = ph.id; // first approved photo satisfies the requirement
    emit(s, now, 'photo_approved', 'Photo approved.', { players: who }, ['photo_approved']);
    emit(s, now, 'photo_public', `New photo hint from ${s.groups[ph.groupId]?.name ?? 'a group'}.`, 'all');
  } else {
    emit(s, now, 'photo_rejected', `Photo rejected: ${ph.reason}`, { players: who }, ['photo_rejected']);
    // Rejected after the window closed with nothing else pending: that requirement is missed now.
    if (req && r && (r.closed || now > r.dueAt) && !req.satisfiedBy && !req.missed && !s.photos.some((x) => x.reqKey === req.key && x.round === r.round && x.status === 'pending')) missRequirement(s, req, now);
  }
}

function missRequirement(s: GameState, req: PhotoRequirement, now: number) {
  req.missed = true;
  const g = s.groups[req.groupId];
  const members = req.memberIds.map((id) => s.players[id]).filter((p) => p && p.role === 'hider' && !p.left && p.fix);
  emit(s, now, 'photo_deadline_missed', 'Photo deadline missed. Seekers get a temporary location clue.', { players: req.memberIds }, ['photo_deadline_missed']);
  if (g && members.length) addClue(s, g, members, 'photo_missed', now);
}

function closePhotoRound(s: GameState, now: number) {
  const r = s.photoRound!; r.closed = true;
  for (const q of r.reqs) {
    if (q.satisfiedBy || q.missed || !q.memberIds.length) continue;
    const pending = s.photos.some((x) => x.reqKey === q.key && x.round === r.round && x.status === 'pending');
    if (!pending) missRequirement(s, q, now);
  }
}

/* ------------------------------------------------------------------ simulation */

function simAddBots(s: GameState, hiders: number, seekers: number, groupSize: number, now: number) {
  if (s.phase !== 'lobby') fail('locked', 'Add bots in the lobby.');
  const names = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ira', 'Jude', 'Kai', 'Lena', 'Milo', 'Nia', 'Owen', 'Pia', 'Quin', 'Rae', 'Sol', 'Tess'];
  const used = new Set(Object.values(s.players).map((p) => p.nickname));
  const take = () => { const n = names.find((x) => !used.has('Bot ' + x)) || `Bot${Object.keys(s.players).length}`; used.add('Bot ' + n); return 'Bot ' + n.replace(/^Bot /, ''); };
  const f7 = s.sectors.features.find((f) => f.properties.sector === 7) ?? s.sectors.features[0];
  const base = sectorCentroid(f7);
  const mk = (role: Role) => {
    const p = addPlayer(s, { id: newId(s, 'b'), nickname: take(), tokenHash: 'bot', now, isBot: true });
    p.role = role; p.ready = true;
    const e = (nextRandom(s) - 0.5) * 300, n = (nextRandom(s) - 0.5) * 200;
    updateLocation(s, p.id, { ...offsetM(base, e, n), acc: 6, sim: true }, now);
    return p;
  };
  const size = Math.max(2, Math.floor(groupSize) || 2);
  let made: Player[] = [];
  for (let i = 0; i < Math.min(20, hiders); i++) made.push(mk('hider'));
  for (let i = 0; i < Math.min(10, seekers); i++) mk('seeker');
  while (made.length >= 2) {
    const chunk = made.splice(0, made.length - size === 1 ? made.length : Math.min(size, made.length));
    const g: Group = { id: newId(s, 'g'), name: `Group ${String.fromCharCode(65 + Object.keys(s.groups).length)}`, createdBy: chunk[0].id, members: chunk.map((p) => p.id), confirmed: Object.fromEntries(chunk.map((p) => [p.id, true])), chosenSector: null, together: true, clusters: [chunk.map((p) => p.id)], splitSince: null };
    s.groups[g.id] = g; chunk.forEach((p) => (p.groupId = g.id));
    // keep group members near each other
    chunk.slice(1).forEach((p, i) => updateLocation(s, p.id, { ...offsetM(chunk[0].fix!, 4 + i * 3, 3), acc: 6, sim: true }, now));
  }
  made = made.filter(Boolean);
}

function stepBots(s: GameState, now: number) {
  const dt = Math.max(0, Math.min(10_000, now - s.lastAdvanceAt));
  const step = 1.2 * (dt / 1000) * (s.config.speed || 1); // walking pace, scaled by sim speed
  for (const p of Object.values(s.players)) {
    // Humans in a simulation game place themselves by tapping the map; that placed position stays current.
    if (!p.isBot) { if (!p.left && p.fix?.sim) { p.fix.at = now; if (p.gps === 'stale') p.gps = 'ok'; } continue; }
    if (p.left || p.botFlags?.offline) continue;
    p.lastSeen = now;
    if (p.botFlags?.gpsFail) { p.gps = 'stale'; continue; }
    if (s.phase === 'live' || s.phase === 'headstart') {
      if (!(s.phase === 'headstart' && p.role === 'seeker') && p.fix && step > 0) {
        const g = p.groupId ? s.groups[p.groupId] : null;
        const leader = g ? s.players[g.members[0]] : null;
        if (!p.botTarget || distanceM(p.fix, p.botTarget) < 3) {
          if (leader && leader.id !== p.id && leader.fix && !p.botFlags?.disputeNext) p.botTarget = offsetM(leader.fix, (nextRandom(s) - 0.5) * 8, (nextRandom(s) - 0.5) * 8);
          else {
            const allowed = [...allowedSectorsFor(s, g)].filter((n) => s.sectorState[n] === 'open');
            const want = pick(s, allowed.length ? allowed : sectorNums(s));
            const f = s.sectors.features.find((x) => x.properties.sector === want);
            if (f) p.botTarget = offsetM(sectorCentroid(f), (nextRandom(s) - 0.5) * 60, (nextRandom(s) - 0.5) * 60);
          }
        }
        if (!p.botTarget) { p.fix.at = now; continue; }
        const d = distanceM(p.fix, p.botTarget!);
        const k = Math.min(1, step / Math.max(d, 0.01));
        const nf = { lat: p.fix.lat + (p.botTarget!.lat - p.fix.lat) * k, lon: p.fix.lon + (p.botTarget!.lon - p.fix.lon) * k };
        updateLocation(s, p.id, { ...nf, acc: 6, sim: true }, now);
      } else if (p.fix) { p.fix.at = now; p.gps = 'ok'; }
    } else if (p.fix) { p.fix.at = now; p.gps = 'ok'; }
  }
  // Bot hiders answer catch reports after ~3 game-seconds. Bots flagged "disputeNext" dispute once.
  for (const c of s.catches) {
    const h = s.players[c.hiderId];
    if (c.status !== 'pending' || !h?.isBot || h.botFlags?.offline) continue;
    if (now - c.at < ms(s, 3)) continue;
    if (h.botFlags?.disputeNext) { h.botFlags.disputeNext = false; c.status = 'disputed'; emit(s, now, 'catch_disputed', `${h.nickname} disputed the catch. The host will decide.`, { players: [c.seekerId, s.hostId] }, ['catch_disputed']); }
    else confirmCatch(s, c, now, 'hider');
  }
  // Bot seekers vote for a random eligible sector a few seconds after voting opens.
  if (s.vote && now - s.vote.openedAt > ms(s, 4)) {
    for (const id of s.vote.eligible) {
      const p = s.players[id];
      if (!p?.isBot || p.botFlags?.offline || s.vote.votes[id] != null) continue;
      const opts = sectorNums(s).filter((n) => s.sectorState[n] !== 'closed');
      if (opts.length) castVote(s, p, pick(s, opts), now);
      if (!s.vote) break;
    }
  }
  // Bot hiders submit a placeholder photo hint ~10 game-seconds into each round (marked as simulated).
  const r = s.photoRound;
  if (r && !r.closed && now - r.requestedAt > ms(s, 10)) {
    for (const q of r.reqs) {
      if (q.satisfiedBy || s.photos.some((x) => x.reqKey === q.key && x.round === r.round && x.status !== 'rejected')) continue;
      const bot = q.memberIds.map((id) => s.players[id]).find((p) => p?.isBot && !p.botFlags?.offline && !p.botFlags?.disputeNext);
      if (bot) submitPhoto(s, bot.id, newId(s, 'ph'), now, true);
    }
  }
}

/* ------------------------------------------------------------------ advance */

/** Process everything that is due at `now`. Idempotent: calling twice with the same `now` changes nothing more. */
export function advance(s: GameState, now: number): void {
  // Housekeeping that runs in every phase.
  s.replays = s.replays.filter((r) => r.expiresAt > now);
  if (s.simulation) stepBots(s, now);
  s.lastAdvanceAt = now;
  if (s.phase === 'lobby' || s.phase === 'ended') return;
  if (s.paused) return;

  // GPS freshness: participation pauses for that player only.
  for (const p of activePlayers(s)) {
    if (p.fix && now - p.fix.at > ms(s, s.config.staleSec) && (p.gps === 'ok' || p.gps === 'poor')) {
      p.gps = 'stale';
      if (!p.gpsWarnedAt) { p.gpsWarnedAt = now; emit(s, now, 'gps_unavailable', 'Location unavailable. You are paused until it returns.', { players: [p.id] }, ['gps_unavailable']); }
    }
  }
  updateSeparation(s, now);

  if (s.phase === 'headstart') {
    if (!s.headStartOneMinuteSent && s.headStartEndsAt! - now <= ms(s, 60) && s.config.headStartSec > 60) {
      s.headStartOneMinuteSent = true;
      emit(s, now, 'headstart_minute', 'One minute of head start left.', 'all', ['one_minute']);
    }
    if (now >= s.headStartEndsAt!) goLive(s, s.headStartEndsAt!);
    else return;
  }

  // Voting (multi-sector mode only).
  if (s.vote) {
    const v = s.vote;
    if (!v.reminded && v.closesAt - now <= ms(s, 30)) {
      v.reminded = true;
      const waiting = v.eligible.filter((id) => v.votes[id] == null && s.players[id] && !s.players[id].left);
      if (waiting.length) emit(s, now, 'vote_reminder', 'Voting closes in 30 seconds. Cast your vote.', { players: waiting }, ['voting_reminder_cast_votes']);
    }
    if (now >= v.closesAt) closeVote(s, now);
  } else if (s.nextVoteAt && now >= s.nextVoteAt) {
    const openable = sectorNums(s).filter((n) => s.sectorState[n] === 'open');
    const seekers = activeSeekers(s);
    s.nextVoteAt += ms(s, s.config.voteEverySec);
    if (openable.length > 1 && seekers.length) {
      s.vote = { round: ++s.voteRound, openedAt: now, closesAt: now + ms(s, s.config.voteDurationSec), eligible: seekers.map((p) => p.id), votes: {}, reminded: false };
      emit(s, now, 'sector_voting_open', 'Sector voting is open. Seekers, pick one sector to close.', 'seekers', ['sector_voting_open']);
      emit(s, now, 'sector_voting_open_hiders', 'Seekers are voting on a sector to close.', 'hiders');
    }
  }

  if (s.closing) {
    const c = s.closing;
    if (!c.oneMinuteSent && c.closesAt - now <= ms(s, 60)) {
      c.oneMinuteSent = true;
      emit(s, now, 'sector_one_minute', `Sector ${c.sector} closes in one minute.`, 'all', ['sector_one_minute', sectorClip(c.sector)]);
    }
    if (now >= c.closesAt) finishClosing(s, now);
  }

  // Search zones.
  s.zones = s.zones.filter((z) => z.endsAt > now);
  if (s.nextZoneAt && now >= s.nextZoneAt) { s.nextZoneAt += ms(s, s.config.zoneEverySec); spawnZone(s, now); }

  // Photo hints.
  const r = s.photoRound;
  if (r && !r.closed) {
    const open = r.reqs.filter((q) => !q.satisfiedBy && q.memberIds.length);
    const who = open.flatMap((q) => (s.photos.some((x) => x.reqKey === q.key && x.round === r.round && x.status === 'pending') ? [] : q.memberIds));
    if (!r.sent60 && r.dueAt - now <= ms(s, 60)) { r.sent60 = true; if (who.length) emit(s, now, 'photo_deadline', 'One minute left to send your photo hint.', { players: who }, ['photo_deadline']); }
    if (!r.sent30 && r.dueAt - now <= ms(s, 30)) { r.sent30 = true; if (who.length) emit(s, now, 'photo_30', '30 seconds left to send your photo hint.', { players: who }, ['thirty_seconds']); }
    if (now >= r.dueAt) closePhotoRound(s, now);
  }
  if (s.nextPhotoAt && now >= s.nextPhotoAt) { s.nextPhotoAt += ms(s, s.config.photoEverySec); openPhotoRound(s, now); }

  // Clues expire.
  const before = s.clues.length;
  s.clues = s.clues.filter((c) => c.until > now);
  if (s.clues.length < before) emit(s, now, 'signal_expired', 'Location clue expired.', 'seekers', ['signal_expired']);

  checkViolations(s, now);
  checkWin(s, now);
}

function updateSeparation(s: GameState, now: number) {
  for (const g of Object.values(s.groups)) {
    const members = groupActiveMembers(s, g).filter((m) => m.gps === 'ok' || m.gps === 'poor');
    const clusters = clusterMembers(members.map((m) => ({ id: m.id, fix: m.fix })), s.config.separationM);
    g.clusters = clusters;
    if (clusters.length <= 1) { g.together = true; g.splitSince = null; continue; }
    // Hysteresis: GPS jumps for a few seconds should not split a group.
    if (g.splitSince == null) g.splitSince = now;
    if (now - g.splitSince >= ms(s, s.config.separationHoldSec)) g.together = false;
  }
}

export { approximate };
