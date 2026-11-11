import { z } from 'zod';

const id = z.string().min(1).max(64);
const sector = z.number().int().min(1).max(10);
const nickname = z.string().min(1).max(40);
const ring = z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4).max(200);
const sectors = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({ sector, verified: z.boolean().optional() }),
    geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).length(1) }),
  })).min(1).max(10),
});
const landmark = z.object({ id, name: z.string().min(1).max(60), sector, lat: z.number(), lon: z.number(), verified: z.boolean() });

export const CreateBody = z.object({ nickname, simulation: z.boolean().optional() });
export const JoinBody = z.object({ code: z.string().min(6).max(12), nickname, simulation: z.boolean().optional() });
export const LocationBody = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), acc: z.number().min(0).max(100000), sim: z.boolean().optional() });

const config = z.object({
  mode: z.enum(['multi', 'shared', 'groupSelected', 'oneOpen']), sharedSector: sector.nullable(), openSector: sector.nullable(),
  headStartSec: z.number(), voteEverySec: z.number(), voteDurationSec: z.number(), closeGraceSec: z.number(), zoneEverySec: z.number(),
  zoneDurationSec: z.number(), zoneStartRadiusM: z.number(), zoneMinRadiusM: z.number(), photoEverySec: z.number(), photoWindowSec: z.number(),
  clueDurationSec: z.number(), clueRadiusM: z.number(), violation: z.enum(['clue', 'none']), separationM: z.number(), separationHoldSec: z.number(),
  staleSec: z.number(), replayRetentionHours: z.number(), speed: z.number(), seekerStartNote: z.string().max(80),
}).partial();

export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat') }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('lobbyStep'), step: z.enum(['join', 'teams', 'confirm']) }),
  z.object({ type: z.literal('assignRole'), playerId: id, role: z.enum(['hider', 'seeker', 'unassigned']) }),
  z.object({ type: z.literal('randomizeRoles'), seekers: z.number().int().min(1).max(39) }),
  z.object({ type: z.literal('kick'), playerId: id }),
  z.object({ type: z.literal('makeHost'), playerId: id }),
  z.object({ type: z.literal('createGroup'), name: z.string().max(30) }),
  z.object({ type: z.literal('joinGroup'), groupId: id }),
  z.object({ type: z.literal('confirmGroup') }),
  z.object({ type: z.literal('leaveGroup') }),
  z.object({ type: z.literal('chooseGroupSector'), sector }),
  z.object({ type: z.literal('updateConfig'), patch: config }),
  z.object({ type: z.literal('setSectors'), sectors, landmarks: z.array(landmark).max(50).optional(), verified: z.boolean() }),
  z.object({ type: z.literal('startGame') }),
  z.object({ type: z.literal('restartHeadStart') }),
  z.object({ type: z.literal('pause'), emergency: z.boolean().optional(), reason: z.string().max(120).optional() }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('endGame') }),
  z.object({ type: z.literal('returnToLobby') }),
  z.object({ type: z.literal('reportCatch'), hiderId: id }),
  z.object({ type: z.literal('respondCatch'), catchId: id, accept: z.boolean() }),
  z.object({ type: z.literal('resolveCatch'), catchId: id, caught: z.boolean() }),
  z.object({ type: z.literal('castVote'), sector }),
  z.object({ type: z.literal('overrideVote'), sector }),
  z.object({ type: z.literal('setSectorState'), sector, status: z.enum(['open', 'closed']) }),
  z.object({ type: z.literal('reviewPhoto'), photoId: id, approve: z.boolean(), reason: z.string().max(140).optional() }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('savePush'), subscription: z.object({ endpoint: z.string().url().max(800), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) }),
  z.object({ type: z.literal('gpsProblem'), kind: z.enum(['denied', 'unavailable']) }),
  z.object({ type: z.literal('simAddBots'), hiders: z.number().int().min(0).max(20), seekers: z.number().int().min(0).max(10), groupSize: z.number().int().min(2).max(8) }),
  z.object({ type: z.literal('simSetSpeed'), speed: z.number() }),
  z.object({ type: z.literal('simMovePlayer'), playerId: id, lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  z.object({ type: z.literal('simBotFlags'), playerId: id, flags: z.object({ offline: z.boolean().optional(), gpsFail: z.boolean().optional(), disputeNext: z.boolean().optional() }) }),
  z.object({ type: z.literal('simBotAction'), playerId: id, action: z.enum(['reportCatch', 'vote', 'submitPhoto']), target: id.optional(), sector: sector.optional() }),
  z.object({ type: z.literal('simSkip'), what: z.enum(['headstart', 'vote', 'zone', 'photo', 'closing']) }),
]);
export const CommandBody = z.object({ cmd: Command, cmdId: z.string().max(64).optional(), since: z.number().int().min(0).optional() });
