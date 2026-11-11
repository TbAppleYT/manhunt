/* Server operations, independent of Next.js so tests can drive them directly. */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { addPlayer, advance, applyCommand, createGame, GameError, submitPhoto, updateLocation, type Command } from '@/lib/engine/engine';
import { buildView, sees } from '@/lib/engine/view';
import type { GameEvent, GameState } from '@/lib/engine/types';
import { StoreError, type Store } from './store';
import { notifyGame } from './realtime';
import { pushEvents } from './push';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(24).toString('base64url');
const newId = (p: string) => p + randomBytes(9).toString('base64url');

export interface Session { gameId: string; playerId: string; token: string; code: string }

/** Throws GameError(401) unless the bearer token matches the player. */
export function authorize(s: GameState, playerId: string, token: string) {
  const p = s.players[playerId];
  if (!p || p.isBot || !token) throw new GameError('unauthorized', 'Your session is not valid for this game.', 401);
  const a = Buffer.from(p.tokenHash, 'hex'), b = Buffer.from(hashToken(token), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new GameError('unauthorized', 'Your session is not valid for this game.', 401);
  if (p.left) throw new GameError('left', 'You left this game.', 403);
  return p;
}

async function limit(store: Store, key: string, n: number, sec: number, msg = 'Too many attempts. Wait a minute and try again.') {
  if (!(await store.hit(key, n, sec))) throw new GameError('rate_limited', msg, 429);
}

export async function createNewGame(store: Store, input: { nickname: string; simulation?: boolean }, ip: string, now = Date.now()): Promise<Session> {
  await limit(store, `create:${ip}`, 10, 600, 'Too many games created from this network. Try again later.');
  const token = newToken(), playerId = newId('p');
  for (let i = 0; i < 8; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const state = createGame({ id: newId('g'), code, hostId: playerId, hostName: input.nickname, hostTokenHash: hashToken(token), now, simulation: !!input.simulation });
    try {
      await store.insert(state);
      return { gameId: state.id, playerId, token, code };
    } catch (e) {
      if (e instanceof StoreError && e.code === 'code_taken') continue;
      throw e;
    }
  }
  throw new GameError('busy', 'Could not allocate a game code. Try again.', 503);
}

export async function joinGame(store: Store, input: { code: string; nickname: string; simulation?: boolean }, ip: string, now = Date.now()): Promise<Session> {
  // Brute-force protection: per-network limits on join attempts (six-digit codes = 1,000,000 combinations).
  await limit(store, `join:${ip}`, 12, 60);
  await limit(store, `joinh:${ip}`, 60, 3600);
  const code = String(input.code).replace(/\D/g, '');
  const found = code.length === 6 ? await store.findByCode(code) : null;
  // Simulation games are isolated: they can only be joined from the simulator, and real games never from it.
  if (!found || found.simulation !== !!input.simulation) throw new GameError('not_found', 'No game with that code. Check it with your host.', 404);
  const token = newToken(), playerId = newId('p');
  const r = await store.mutate(found.id, (s) => { advance(s, now); addPlayer(s, { id: playerId, nickname: input.nickname, tokenHash: hashToken(token), now }); });
  await afterChange(store, r.state, r.version, 0);
  return { gameId: found.id, playerId, token, code };
}

/** Comparable snapshot without fields that change on every poll. */
function material(s: GameState) {
  const { lastAdvanceAt: _a, ...rest } = s;
  return JSON.stringify({ ...rest, players: Object.fromEntries(Object.entries(s.players).map(([k, p]) => [k, { ...p, lastSeen: 0 }])) });
}

export async function getView(store: Store, gameId: string, playerId: string, token: string, since: number, now = Date.now()) {
  const loaded = await store.load(gameId);
  if (!loaded) throw new GameError('not_found', 'This game has ended or expired.', 404);
  const me = authorize(loaded.state, playerId, token);
  // Only write when a timer fired / bots moved, or to refresh this player's "online" status.
  const probe = structuredClone(loaded.state);
  advance(probe, now);
  const changed = material(probe) !== material(loaded.state);
  if (changed || now - me.lastSeen > 15_000) {
    const before = loaded.state.eventSeq;
    const r = await store.mutate(gameId, (s) => { advance(s, now); if (s.players[playerId]) s.players[playerId].lastSeen = now; });
    if (changed) await afterChange(store, r.state, r.version, before);
    return { view: buildView(r.state, playerId, now, since), version: r.version };
  }
  return { view: buildView(loaded.state, playerId, now, since), version: loaded.version };
}

export async function runCommand(store: Store, gameId: string, playerId: string, token: string, cmd: Command, cmdId: string | undefined, since: number, now = Date.now()) {
  const loaded = await store.load(gameId);
  if (!loaded) throw new GameError('not_found', 'This game has ended or expired.', 404);
  authorize(loaded.state, playerId, token);
  await limit(store, `cmd:${playerId}`, 40, 10, 'Slow down a little.');
  const before = loaded.state.eventSeq;
  const r = await store.mutate(gameId, (s) => { advance(s, now); authorize(s, playerId, token); return applyCommand(s, playerId, cmd, now, cmdId); });
  if (!r.result.duplicate) await afterChange(store, r.state, r.version, before);
  return { view: buildView(r.state, playerId, now, since), version: r.version, duplicate: r.result.duplicate };
}

export async function postLocation(store: Store, gameId: string, playerId: string, token: string, fix: { lat: number; lon: number; acc: number; sim?: boolean }, now = Date.now()) {
  const loaded = await store.load(gameId);
  if (!loaded) throw new GameError('not_found', 'This game has ended or expired.', 404);
  const me = authorize(loaded.state, playerId, token);
  if (me.fix && now - me.fix.at < 1500 && !fix.sim) return { accepted: false }; // at most one fix every 1.5 s
  const before = loaded.state.eventSeq;
  const r = await store.mutate(gameId, (s) => { advance(s, now); updateLocation(s, playerId, fix, now); });
  if (r.state.eventSeq !== before) await afterChange(store, r.state, r.version, before);
  else await notifyGame(gameId, r.version);
  return { accepted: true, sector: r.state.players[playerId]?.sector ?? null };
}

const MAGIC: [string, number[]][] = [['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export async function uploadPhoto(store: Store, gameId: string, playerId: string, token: string, bytes: Uint8Array, now = Date.now()) {
  if (bytes.length > MAX_PHOTO_BYTES) throw new GameError('too_big', 'That photo is too large.', 413);
  const mime = MAGIC.find(([, sig]) => sig.every((b, i) => bytes[i] === b))?.[0];
  if (!mime) throw new GameError('bad_image', 'Send a JPEG, PNG or WebP photo.', 415);
  const loaded = await store.load(gameId);
  if (!loaded) throw new GameError('not_found', 'This game has ended or expired.', 404);
  authorize(loaded.state, playerId, token);
  await limit(store, `photo:${playerId}`, 6, 60, 'Too many photos. Wait a moment.');
  const photoId = newId('ph');
  await store.putPhoto(gameId, photoId, mime, bytes);
  try {
    const before = loaded.state.eventSeq;
    const r = await store.mutate(gameId, (s) => { advance(s, now); submitPhoto(s, playerId, photoId, now); });
    await afterChange(store, r.state, r.version, before);
    return { photoId };
  } catch (e) {
    await store.deletePhoto(gameId, photoId);
    throw e;
  }
}

export async function readPhoto(store: Store, gameId: string, playerId: string, token: string, photoId: string) {
  const loaded = await store.load(gameId);
  if (!loaded) throw new GameError('not_found', 'Not found.', 404);
  const s = loaded.state, me = authorize(s, playerId, token);
  const ph = s.photos.find((p) => p.id === photoId);
  if (!ph) throw new GameError('not_found', 'Not found.', 404);
  const allowed = ph.status === 'approved' || s.hostId === playerId || (me.groupId && me.groupId === ph.groupId);
  if (!allowed) throw new GameError('forbidden', 'Not allowed.', 403);
  if (ph.sim) return { mime: 'image/svg+xml', bytes: new TextEncoder().encode(simPhotoSvg(s.players[ph.playerId]?.nickname ?? 'Bot')) };
  const img = await store.getPhoto(gameId, photoId);
  if (!img) throw new GameError('not_found', 'Photo expired.', 404);
  return img;
}

function simPhotoSvg(name: string) {
  const n = name.replace(/[^\w .-]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750"><rect width="600" height="750" fill="#2b2f33"/><rect x="60" y="260" width="480" height="140" rx="8" fill="#f2f2f2"/><text x="300" y="345" font-family="Inter,Arial" font-size="44" font-weight="700" text-anchor="middle" fill="#222">STOREFRONT</text><text x="300" y="470" font-family="Inter,Arial" font-size="26" text-anchor="middle" fill="#bbb">Simulated photo · ${n}</text></svg>`;
}

/** Realtime nudge + push notifications for events created by this change. */
async function afterChange(store: Store, s: GameState, version: number, prevEventSeq: number) {
  await notifyGame(s.id, version);
  const fresh: GameEvent[] = s.events.filter((e) => e.id > prevEventSeq);
  if (fresh.length) {
    await pushEvents(
      Object.values(s.players).filter((p) => p.push && !p.left && !p.isBot).map((p) => ({ id: p.id, push: p.push, lastSeen: p.lastSeen })),
      fresh,
      (pid, e) => sees(s, pid, e.audience),
    ).catch(() => {});
  }
  void store;
}

export async function cleanup(store: Store, now = Date.now()) { return store.cleanup(now); }
