import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';
import { MemoryStore } from '@/lib/server/memoryStore';
import { PgStore } from '@/lib/server/pgStore';
import type { Store } from '@/lib/server/store';
import { cleanup, createNewGame, getView, joinGame, postLocation, readPhoto, runCommand, uploadPhoto } from '@/lib/server/service';
import { GameError } from '@/lib/engine/engine';
import { center } from '../helpers';

const errCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as GameError).code ?? String(e); } };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let pg: EmbeddedPostgres | null = null;
let pgStore: PgStore | null = null;

beforeAll(async () => {
  if (process.env.SKIP_PG) return;
  rmSync('.pg-test', { recursive: true, force: true });
  pg = new EmbeddedPostgres({ databaseDir: '.pg-test', user: 'postgres', password: 'test', port: 54329, persistent: false, createPostgresUser: true, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('manhunt');
  pgStore = new PgStore('postgres://postgres:test@localhost:54329/manhunt');
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
  // run the migration through a raw client
  const { default: postgres } = await import('postgres');
  const raw = postgres('postgres://postgres:test@localhost:54329/manhunt', { onnotice: () => {} });
  await raw.unsafe(sql);
  await raw.end();
});
afterAll(async () => { await pgStore?.end(); await pg?.stop(); rmSync('.pg-test', { recursive: true, force: true }); });

const stores: [string, () => Store][] = [['memory', () => new MemoryStore()], ['postgres', () => pgStore!]];

describe.each(stores)('service with %s store', (name, make) => {
  const skip = name === 'postgres' && !!process.env.SKIP_PG;

  it.skipIf(skip)('creates and joins with a six-digit code; sessions are required', async () => {
    const store = make();
    const host = await createNewGame(store, { nickname: 'Host' }, 'ip-a');
    expect(host.code).toMatch(/^\d{6}$/);
    const ava = await joinGame(store, { code: host.code, nickname: 'Ava' }, 'ip-b');
    const { view } = await getView(store, host.gameId, host.playerId, host.token, 0);
    expect(view.players.map((p) => p.nickname).sort()).toEqual(['Ava', 'Host']);
    expect(await errCode(getView(store, host.gameId, ava.playerId, host.token, 0))).toBe('unauthorized'); // impersonation
    expect(await errCode(getView(store, host.gameId, ava.playerId, 'x'.repeat(32), 0))).toBe('unauthorized');
    expect(await errCode(joinGame(store, { code: host.code, nickname: 'ava' }, 'ip-c'))).toBe('nickname_taken'); // duplicate join
  });

  it.skipIf(skip)('rate-limits code guessing', async () => {
    const store = make();
    const ip = 'guesser-' + name;
    const results: string[] = [];
    for (let i = 0; i < 14; i++) results.push(await errCode(joinGame(store, { code: String(100000 + i), nickname: 'X' + i }, ip)));
    expect(results.slice(0, 12).every((r) => r === 'not_found')).toBe(true);
    expect(results.slice(12)).toEqual(['rate_limited', 'rate_limited']);
  });

  it.skipIf(skip)('keeps simulation games isolated from real joins and vice versa', async () => {
    const store = make();
    const sim = await createNewGame(store, { nickname: 'Dev', simulation: true }, 'ip-s1');
    const real = await createNewGame(store, { nickname: 'Host' }, 'ip-s2');
    expect(await errCode(joinGame(store, { code: sim.code, nickname: 'Ava' }, 'ip-s3'))).toBe('not_found');
    expect(await errCode(joinGame(store, { code: real.code, nickname: 'Ava', simulation: true }, 'ip-s3'))).toBe('not_found');
    expect(await errCode(joinGame(store, { code: sim.code, nickname: 'Ava', simulation: true }, 'ip-s3'))).toBe('ok');
    expect(await errCode(runCommand(store, real.gameId, real.playerId, real.token, { type: 'simAddBots', hiders: 2, seekers: 0, groupSize: 2 }, undefined, 0))).toBe('sim_only');
    expect(await errCode(postLocation(store, real.gameId, real.playerId, real.token, { ...center(7), acc: 5, sim: true }))).toBe('sim_only');
  });

  it.skipIf(skip)('serialises concurrent commands without losing updates', async () => {
    const store = make();
    const host = await createNewGame(store, { nickname: 'Host' }, 'ip-c1');
    const players = await Promise.all(['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'].map((n, i) => joinGame(store, { code: host.code, nickname: n }, `ip-c${i + 2}`)));
    await Promise.all(players.map((p) => runCommand(store, p.gameId, p.playerId, p.token, { type: 'setReady', ready: true }, undefined, 0)));
    const { view } = await getView(store, host.gameId, host.playerId, host.token, 0);
    expect(view.players.filter((p) => p.ready)).toHaveLength(6);
  });

  it.skipIf(skip)('duplicate command ids are applied once; reconnecting with the same session resumes with missed events', async () => {
    const store = make();
    const host = await createNewGame(store, { nickname: 'Host' }, 'ip-d1');
    const ava = await joinGame(store, { code: host.code, nickname: 'Ava' }, 'ip-d2');
    const first = await getView(store, ava.gameId, ava.playerId, ava.token, 0);
    const seq = first.view.eventSeq;
    await runCommand(store, host.gameId, host.playerId, host.token, { type: 'lobbyStep', step: 'teams' }, 'k1', seq);
    const dup = await runCommand(store, host.gameId, host.playerId, host.token, { type: 'lobbyStep', step: 'teams' }, 'k1', seq);
    expect(dup.duplicate).toBe(true);
    // "reconnect": a fresh poll with the old cursor gets exactly the events that were missed
    const again = await getView(store, ava.gameId, ava.playerId, ava.token, seq, Date.now() + 60_000);
    expect(again.view.events.map((e) => e.type)).toEqual(['choose_teams']);
  });

  it.skipIf(skip)('photo upload: checks file type, stores privately, and only allowed players can read it', async () => {
    const store = make();
    const host = await createNewGame(store, { nickname: 'Host' }, 'ip-p1');
    const names = ['Ava', 'Ben', 'Cleo', 'Dev'];
    const ps = await Promise.all(names.map((n, i) => joinGame(store, { code: host.code, nickname: n }, `ip-p${i + 2}`)));
    const [ava, ben, cleo, dev] = ps;
    const run = (s: typeof host, cmd: Parameters<typeof runCommand>[4], now?: number) => runCommand(store, s.gameId, s.playerId, s.token, cmd, undefined, 0, now);
    await run(host, { type: 'assignRole', playerId: host.playerId, role: 'seeker' });
    for (const p of ps) await run(host, { type: 'assignRole', playerId: p.playerId, role: 'hider' });
    await run(ava, { type: 'createGroup', name: 'A' });
    const g = (await getView(store, ava.gameId, ava.playerId, ava.token, 0)).view.you.groupId!;
    await run(ben, { type: 'joinGroup', groupId: g }); await run(ben, { type: 'confirmGroup' });
    await run(cleo, { type: 'createGroup', name: 'B' });
    const g2 = (await getView(store, cleo.gameId, cleo.playerId, cleo.token, 0)).view.you.groupId!;
    await run(dev, { type: 'joinGroup', groupId: g2 }); await run(dev, { type: 'confirmGroup' });
    for (const p of ps) { await run(p, { type: 'setReady', ready: true }); await postLocation(store, p.gameId, p.playerId, p.token, { ...center(7), acc: 5 }); }
    const t0 = Date.now();
    await run(host, { type: 'startGame' }, t0);
    // jump past the head start and the first 5-minute photo request
    for (const p of ps) await postLocation(store, p.gameId, p.playerId, p.token, { ...center(7), acc: 5 }, t0 + 420_000);
    await getView(store, host.gameId, host.playerId, host.token, 0, t0 + 421_000);
    expect(await errCode(uploadPhoto(store, ava.gameId, ava.playerId, ava.token, new Uint8Array([1, 2, 3, 4]), t0 + 422_000))).toBe('bad_image');
    const { photoId } = await uploadPhoto(store, ava.gameId, ava.playerId, ava.token, JPEG, t0 + 422_000);
    expect(await errCode(readPhoto(store, cleo.gameId, cleo.playerId, cleo.token, photoId))).toBe('forbidden'); // other group, pending
    expect((await readPhoto(store, ben.gameId, ben.playerId, ben.token, photoId)).mime).toBe('image/jpeg'); // own group
    await run(host, { type: 'reviewPhoto', photoId, approve: true }, t0 + 423_000);
    expect((await readPhoto(store, cleo.gameId, cleo.playerId, cleo.token, photoId)).bytes.length).toBe(JPEG.length); // approved: visible to all
  });

  it.skipIf(skip)('cleanup deletes expired games and their photos', async () => {
    const store = make();
    const host = await createNewGame(store, { nickname: 'Host' }, 'ip-e1');
    await store.putPhoto(host.gameId, 'x', 'image/jpeg', JPEG);
    expect(await cleanup(store, Date.now() + 13 * 3600_000)).toBeGreaterThanOrEqual(1);
    expect(await store.load(host.gameId)).toBeNull();
    expect(await store.getPhoto(host.gameId, 'x')).toBeNull();
  });
});
