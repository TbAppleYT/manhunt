/*
 * What a single player is allowed to see. This is the privacy boundary:
 *  - nobody receives another player's raw coordinates (teammates get a ~25 m grid-snapped position);
 *  - the host gets connection/GPS status, never positions (except in isolated simulation games);
 *  - search zones and clues go to seekers only; pending photos go to the host and the sender's group.
 */
import { approximate } from './geo';
import { participating, requirementFor, startProblems, zoneStage } from './engine';
import type { Audience, GameConfig, GameEvent, GameState, Landmark, Paused, Phase, Role, SectorCollection, SectorStatus } from './types';

export interface ViewPlayer { id: string; nickname: string; role: Role; ready: boolean; groupId: string | null; isHost: boolean; isBot: boolean; online: boolean; gps: string | null; acc: number | null; caught: boolean; left: boolean }
export interface PlayerView {
  serverNow: number;
  you: { id: string; nickname: string; role: Role; isHost: boolean; groupId: string | null; ready: boolean; sector: number | null; gps: string; acc: number | null; lat: number | null; lon: number | null; participating: boolean; wasHider: boolean };
  game: {
    id: string; code: string; simulation: boolean; phase: Phase; lobbyStep: string; paused: Paused | null; config: GameConfig; sectors: SectorCollection; landmarks: Landmark[];
    sectorState: Record<string, SectorStatus>; hostId: string; headStartEndsAt: number | null; startedAt: number | null; liveAt: number | null; endedAt: number | null;
    winner: { id: string; nickname: string } | null; endReason: string | null; nextVoteAt: number | null; nextZoneAt: number | null; nextPhotoAt: number | null;
    closing: { sector: number; closesAt: number; affectsYou: boolean } | null; closedLog: { sector: number; at: number; by: string }[]; startProblems: string[];
  };
  vote: { round: number; closesAt: number; eligible: number; voted: number; yourVote: number | null; canVote: boolean } | null;
  players: ViewPlayer[];
  groups: { id: string; name: string; members: string[]; confirmed: Record<string, boolean>; chosenSector: number | null; together: boolean | null; clusters: string[][] | null }[];
  teammates: { id: string; nickname: string; lat: number; lon: number }[];
  simPositions: { id: string; nickname: string; role: Role; lat: number; lon: number; isBot: boolean; groupId: string | null }[] | null;
  zones: { id: string; groupName: string; circles: { lat: number; lon: number; r: number }[]; stage: number; stages: number; nextStageAt: number | null; endsAt: number }[];
  clues: { id: string; groupName: string; lat: number; lon: number; radiusM: number; until: number; reason: string }[];
  photoRequest: { round: number; dueAt: number; together: boolean; with: string[]; satisfied: boolean; pending: boolean; lastRejection: string | null; missed: boolean } | null;
  photos: { id: string; groupName: string; at: number; status: string; reason: string | null; mine: boolean; nickname: string | null; sim: boolean }[];
  catches: { id: string; seeker: string; hider: string; seekerId: string; hiderId: string; status: string; at: number; sector: number | null }[];
  replays: { id: string; seeker: string; hider: string; sector: number | null; at: number; expiresAt: number }[];
  events: GameEvent[];
  eventSeq: number;
  stats: { catches: number; closures: number; durationMs: number | null; hidersStart: number; hidersLeft: number } | null;
}

export function sees(s: GameState, playerId: string, a: Audience): boolean {
  const p = s.players[playerId];
  if (a === 'all') return true;
  if (a === 'host') return s.hostId === playerId;
  if (a === 'seekers') return p?.role === 'seeker';
  if (a === 'hiders') return p?.role === 'hider';
  return a.players.includes(playerId);
}

export function buildView(s: GameState, playerId: string, now: number, sinceEvent = 0): PlayerView {
  const me = s.players[playerId];
  const isHost = s.hostId === playerId;
  const myGroup = me.groupId ? s.groups[me.groupId] : null;
  const isSeeker = me.role === 'seeker';
  const gname = (id: string | null) => (id && s.groups[id]?.name) || 'A group';

  const players: ViewPlayer[] = Object.values(s.players).map((p) => {
    const teammate = p.id === playerId || (me.groupId && p.groupId === me.groupId) || (isSeeker && p.role === 'seeker');
    const showGps = isHost || teammate;
    return {
      id: p.id, nickname: p.nickname, role: p.role, ready: p.ready, groupId: p.groupId, isHost: p.id === s.hostId, isBot: !!p.isBot,
      online: now - p.lastSeen < 30_000, gps: showGps ? p.gps : null, acc: showGps && p.fix ? Math.round(p.fix.acc) : null, caught: !!p.caughtAt, left: !!p.left,
    };
  });

  const teammates = (s.phase === 'ended' ? [] : Object.values(s.players))
    .filter((p) => p.id !== playerId && !p.left && p.fix && ((me.role === 'hider' && me.groupId && p.groupId === me.groupId && p.role === 'hider') || (isSeeker && p.role === 'seeker')))
    .map((p) => ({ id: p.id, nickname: p.nickname, ...approximate(p.fix!) }));

  const r = s.photoRound;
  const req = me.role === 'hider' ? requirementFor(s, playerId) : null;
  const reqPhotos = req && r ? s.photos.filter((x) => x.reqKey === req.key && x.round === r.round) : [];

  return {
    serverNow: now,
    you: {
      id: me.id, nickname: me.nickname, role: me.role, isHost, groupId: me.groupId, ready: me.ready, sector: me.sector, gps: me.gps,
      acc: me.fix ? Math.round(me.fix.acc) : null, lat: me.fix?.lat ?? null, lon: me.fix?.lon ?? null, participating: participating(s, me, now), wasHider: me.wasHider,
    },
    game: {
      id: s.id, code: s.code, simulation: s.simulation, phase: s.phase, lobbyStep: s.lobbyStep, paused: s.paused, config: s.config, sectors: s.sectors, landmarks: s.landmarks,
      sectorState: s.sectorState, hostId: s.hostId, headStartEndsAt: s.headStartEndsAt, startedAt: s.startedAt, liveAt: s.liveAt, endedAt: s.endedAt,
      winner: s.winnerId ? { id: s.winnerId, nickname: s.players[s.winnerId]?.nickname ?? '' } : null, endReason: s.endReason,
      nextVoteAt: s.nextVoteAt, nextZoneAt: isSeeker || isHost ? s.nextZoneAt : null, nextPhotoAt: me.role === 'hider' || isHost ? s.nextPhotoAt : null,
      closing: s.closing ? { sector: s.closing.sector, closesAt: s.closing.closesAt, affectsYou: !!me.groupId && s.closing.affectedGroups.includes(me.groupId) } : null,
      closedLog: s.closedLog, startProblems: s.phase === 'lobby' ? startProblems(s) : [],
    },
    vote: s.vote
      ? {
          round: s.vote.round, closesAt: s.vote.closesAt, eligible: s.vote.eligible.length,
          voted: isSeeker || isHost ? Object.keys(s.vote.votes).length : 0, yourVote: s.vote.votes[playerId] ?? null,
          canVote: isSeeker && s.vote.eligible.includes(playerId) && s.vote.votes[playerId] == null,
        }
      : null,
    players,
    groups: Object.values(s.groups).map((g) => {
      const mine = g.id === me.groupId;
      return { id: g.id, name: g.name, members: g.members, confirmed: g.confirmed, chosenSector: mine || isHost || s.phase === 'lobby' ? g.chosenSector : null, together: mine || isHost ? g.together : null, clusters: mine ? g.clusters : null };
    }),
    teammates,
    simPositions: s.simulation && isHost
      ? Object.values(s.players).filter((p) => p.fix && !p.left).map((p) => ({ id: p.id, nickname: p.nickname, role: p.role, lat: p.fix!.lat, lon: p.fix!.lon, isBot: !!p.isBot, groupId: p.groupId }))
      : null,
    zones: isSeeker
      ? s.zones.map((z) => {
          const st = zoneStage(z, now), n = z.circles[0].radii.length;
          return { id: z.id, groupName: gname(z.groupId), circles: z.circles.map((c) => ({ lat: c.lat, lon: c.lon, r: c.radii[st] })), stage: st + 1, stages: n, nextStageAt: st + 1 < n ? z.startAt + (st + 1) * z.stageMs : null, endsAt: z.endsAt };
        })
      : [],
    clues: isSeeker ? s.clues.map((c) => ({ id: c.id, groupName: gname(c.groupId), lat: c.lat, lon: c.lon, radiusM: c.radiusM, until: c.until, reason: c.reason })) : [],
    photoRequest: req && r
      ? {
          round: r.round, dueAt: r.dueAt, together: req.memberIds.length > 1 || !!myGroup?.together,
          with: req.memberIds.filter((m) => m !== playerId).map((m) => s.players[m]?.nickname ?? ''),
          satisfied: !!req.satisfiedBy, pending: reqPhotos.some((x) => x.status === 'pending'),
          lastRejection: reqPhotos.filter((x) => x.status === 'rejected').slice(-1)[0]?.reason ?? null, missed: req.missed,
        }
      : null,
    photos: s.photos
      .filter((x) => x.status === 'approved' || isHost || (myGroup && x.groupId === myGroup.id))
      .map((x) => ({ id: x.id, groupName: gname(x.groupId), at: x.at, status: x.status, reason: x.reason, mine: x.playerId === playerId, nickname: isHost || x.groupId === me.groupId ? s.players[x.playerId]?.nickname ?? null : null, sim: !!x.sim })),
    catches: s.catches
      .filter((c) => c.status === 'confirmed' || c.hiderId === playerId || c.seekerId === playerId || isHost)
      .map((c) => ({ id: c.id, seeker: s.players[c.seekerId]?.nickname ?? '', hider: s.players[c.hiderId]?.nickname ?? '', seekerId: c.seekerId, hiderId: c.hiderId, status: c.status, at: c.at, sector: c.status === 'confirmed' ? c.sector : null })),
    replays: s.replays.map((x) => ({ id: x.id, seeker: x.seeker, hider: x.hider, sector: x.sector, at: x.at, expiresAt: x.expiresAt })),
    events: s.events.filter((e) => e.id > sinceEvent && sees(s, playerId, e.audience)),
    eventSeq: s.eventSeq,
    stats: s.phase === 'ended' || s.phase === 'live'
      ? {
          catches: s.catches.filter((c) => c.status === 'confirmed').length, closures: s.closedLog.length,
          durationMs: s.startedAt ? (s.endedAt ?? now) - s.startedAt : null,
          hidersStart: Object.values(s.players).filter((p) => p.wasHider).length,
          hidersLeft: Object.values(s.players).filter((p) => p.role === 'hider' && !p.left).length,
        }
      : null,
  };
}
