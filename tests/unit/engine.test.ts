import { describe, expect, it } from 'vitest';
import { addPlayer, advance, applyCommand, GameError, startProblems, submitPhoto, tally, updateLocation } from '@/lib/engine/engine';
import { buildView } from '@/lib/engine/view';
import { clusterMembers, distanceM, offsetM, sectorAt, validateSectors } from '@/lib/engine/geo';
import { PROVISIONAL_SECTORS } from '@/lib/engine/config';
import { T0, center, cmd, lobby, place, readyGame, tick } from '../helpers';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as GameError).code; } return 'ok'; };

describe('lobby', () => {
  it('creates a lobby with the host as first player', () => {
    const s = lobby(['Host']);
    expect(s.phase).toBe('lobby');
    expect(s.players.host.nickname).toBe('Host');
    expect(s.code).toMatch(/^\d{6}$/);
  });
  it('rejects duplicate and too-short nicknames, strips markup', () => {
    const s = lobby(['Host', 'Ava']);
    expect(code(() => addPlayer(s, { id: 'x', nickname: 'ava', tokenHash: 'h', now: T0 }))).toBe('nickname_taken');
    expect(code(() => addPlayer(s, { id: 'y', nickname: ' a ', tokenHash: 'h', now: T0 }))).toBe('nickname');
    const p = addPlayer(s, { id: 'z', nickname: '<b>Zed</b>', tokenHash: 'h', now: T0 });
    expect(p.nickname).toBe('bZed/b');
  });
  it('blocks joining after the match starts', () => {
    const s = readyGame();
    expect(code(() => addPlayer(s, { id: 'late', nickname: 'Late', tokenHash: 'h', now: T0 }))).toBe('locked');
  });
});

describe('roles and groups', () => {
  it('only the host can assign roles', () => {
    const s = lobby();
    expect(code(() => cmd(s, 'ava', { type: 'assignRole', playerId: 'ben', role: 'seeker' }))).toBe('host_only');
    cmd(s, 'host', { type: 'assignRole', playerId: 'ben', role: 'seeker' });
    expect(s.players.ben.role).toBe('seeker');
  });
  it('randomizes roles with the requested seeker count', () => {
    const s = lobby();
    cmd(s, 'host', { type: 'randomizeRoles', seekers: 2 });
    const roles = Object.values(s.players).map((p) => p.role);
    expect(roles.filter((r) => r === 'seeker')).toHaveLength(2);
    expect(roles.filter((r) => r === 'hider')).toHaveLength(3);
  });
  it('seekers cannot create or join hider groups; becoming a seeker removes you from a group', () => {
    const s = lobby();
    cmd(s, 'host', { type: 'assignRole', playerId: 'ava', role: 'hider' });
    cmd(s, 'host', { type: 'assignRole', playerId: 'ben', role: 'seeker' });
    cmd(s, 'ava', { type: 'createGroup', name: 'A' });
    const gid = s.players.ava.groupId!;
    expect(code(() => cmd(s, 'ben', { type: 'joinGroup', groupId: gid }))).toBe('hiders_only');
    expect(code(() => cmd(s, 'ben', { type: 'createGroup', name: 'B' }))).toBe('hiders_only');
    cmd(s, 'host', { type: 'assignRole', playerId: 'ava', role: 'seeker' });
    expect(s.groups[gid]).toBeUndefined();
  });
  it('requires every member to confirm, no solo hiders, before start', () => {
    const s = readyGame({ start: false });
    const b = Object.values(s.groups).find((g) => g.name === 'Group B')!;
    b.confirmed.dev = false;
    expect(startProblems(s).join(' ')).toMatch(/Everyone in Group B must confirm/);
    b.confirmed.dev = true;
    cmd(s, 'dev', { type: 'leaveGroup' });
    const p = startProblems(s).join(' ');
    expect(p).toMatch(/Group B needs at least two members/);
    expect(p).toMatch(/Dev is not in a group/);
  });
  it('locks groups once the match starts', () => {
    const s = readyGame();
    expect(code(() => cmd(s, 'ava', { type: 'leaveGroup' }))).toBe('locked');
  });
  it('needs at least two hiders so a game never starts already won', () => {
    const s = lobby(['Host', 'Ava', 'Ben']);
    cmd(s, 'host', { type: 'assignRole', playerId: 'host', role: 'seeker' });
    cmd(s, 'host', { type: 'assignRole', playerId: 'ava', role: 'hider' });
    cmd(s, 'host', { type: 'assignRole', playerId: 'ben', role: 'seeker' });
    expect(startProblems(s).join(' ')).toMatch(/at least two hiders/);
  });
});

describe('head start', () => {
  it('runs a server-timed two-minute head start with catches disabled', () => {
    const s = readyGame({ start: true, live: false });
    expect(s.phase).toBe('headstart');
    expect(s.headStartEndsAt).toBe(T0 + 1000 + 120_000);
    expect(code(() => cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 5000))).toBe('headstart');
    tick(s, T0 + 5000, T0 + 120_000);
    expect(s.phase).toBe('headstart');
    tick(s, T0 + 120_000, T0 + 121_000, 1000);
    expect(s.phase).toBe('live');
    expect(s.events.some((e) => e.type === 'seekers_released')).toBe(true);
  });
  it('pause freezes and resume shifts the countdown; host can restart', () => {
    const s = readyGame({ start: true, live: false });
    cmd(s, 'host', { type: 'pause' }, T0 + 31_000);
    advance(s, T0 + 500_000);
    expect(s.phase).toBe('headstart');
    cmd(s, 'host', { type: 'resume' }, T0 + 500_000);
    expect(s.headStartEndsAt).toBe(T0 + 121_000 + 469_000);
    cmd(s, 'host', { type: 'restartHeadStart' }, T0 + 510_000);
    expect(s.headStartEndsAt).toBe(T0 + 510_000 + 120_000);
  });
});

describe('GPS and sectors', () => {
  it('classifies points into the provisional sectors', () => {
    for (const f of PROVISIONAL_SECTORS.features) expect(sectorAt(PROVISIONAL_SECTORS, center(f.properties.sector))).toBe(f.properties.sector);
    expect(sectorAt(PROVISIONAL_SECTORS, { lat: 36.85, lon: -76.15 })).toBeNull();
  });
  it('provisional sectors are valid and do not overlap', () => {
    expect(validateSectors(PROVISIONAL_SECTORS)).toEqual([]);
  });
  it('detects overlaps in edited sectors', () => {
    const fc = structuredClone(PROVISIONAL_SECTORS);
    const ring = fc.features[0].geometry.coordinates[0];
    ring[1][0] += 0.0008; ring[2][0] += 0.0008; // push sector 1's east edge into sector 2
    expect(validateSectors(fc).some((i) => i.kind === 'overlap')).toBe(true);
  });
  it('ignores sector changes from very poor fixes and marks stale GPS', () => {
    const s = readyGame();
    updateLocation(s, 'ava', { ...center(2), acc: 200 }, T0 + 130_000);
    expect(s.players.ava.sector).toBe(7);
    expect(s.players.ava.gps).toBe('poor');
    advance(s, T0 + 130_000 + 46_000);
    expect(s.players.ava.gps).toBe('stale');
    expect(s.events.some((e) => e.type === 'gps_unavailable')).toBe(true);
  });
  it('rejects simulated fixes in real games', () => {
    const s = readyGame();
    expect(code(() => updateLocation(s, 'ava', { ...center(7), acc: 5, sim: true }, T0))).toBe('sim_only');
  });
});

describe('separation', () => {
  it('treats nearby members as together and accounts for GPS accuracy', () => {
    const c = center(7);
    expect(clusterMembers([{ id: 'a', fix: { ...c, acc: 5 } }, { id: 'b', fix: { ...offsetM(c, 20, 0), acc: 5 } }], 35)).toHaveLength(1);
    expect(clusterMembers([{ id: 'a', fix: { ...c, acc: 5 } }, { id: 'b', fix: { ...offsetM(c, 120, 0), acc: 5 } }], 35)).toHaveLength(2);
    // 60 m apart but both ±40 m: cannot be sure they are apart → together
    expect(clusterMembers([{ id: 'a', fix: { ...c, acc: 40 } }, { id: 'b', fix: { ...offsetM(c, 60, 0), acc: 40 } }], 35)).toHaveLength(1);
  });
  it('needs the split to hold before a group counts as separated', () => {
    const s = readyGame();
    const g = Object.values(s.groups).find((x) => x.name === 'Group A')!;
    updateLocation(s, 'ben', { ...center(8), acc: 5 }, T0 + 130_000);
    advance(s, T0 + 130_000);
    expect(g.together).toBe(true);
    tick(s, T0 + 130_000, T0 + 155_000);
    expect(g.together).toBe(false);
    expect(g.clusters).toHaveLength(2);
  });
});

describe('voting', () => {
  const openVote = () => {
    const s = readyGame();
    tick(s, T0 + 121_000, T0 + 121_000 + 600_000);
    expect(s.vote).not.toBeNull();
    return s;
  };
  it('opens every ten minutes for two minutes; only seekers vote, once', () => {
    const s = openVote();
    expect(s.vote!.closesAt - s.vote!.openedAt).toBe(120_000);
    expect(code(() => cmd(s, 'ava', { type: 'castVote', sector: 2 }, s.vote!.openedAt + 1))).toBe('not_eligible');
  });
  it('closes early when all eligible seekers vote and starts a 3-minute closure', () => {
    const s = openVote();
    const t = s.vote!.openedAt + 1000;
    cmd(s, 'host', { type: 'castVote', sector: 2 }, t);
    expect(s.vote).toBeNull();
    expect(s.closing?.sector).toBe(2);
    expect(s.sectorState['2']).toBe('closing');
    expect(s.closing!.closesAt).toBe(t + 180_000);
  });
  it('blocks votes for closed sectors only (original rule) — closing sectors can still be voted', () => {
    const s = openVote();
    s.sectorState['9'] = 'closed';
    s.sectorState['4'] = 'closing';
    expect(code(() => cmd(s, 'host', { type: 'castVote', sector: 9 }, s.vote!.openedAt + 1))).toBe('closed');
    expect(code(() => cmd(s, 'host', { type: 'castVote', sector: 4 }, s.vote!.openedAt + 1))).toBe('ok');
  });
  it('counts submitted votes when the timer expires', () => {
    const s = readyGame();
    s.players.ava.role = 'seeker'; // a second seeker who will not vote
    tick(s, T0 + 121_000, T0 + 121_000 + 600_000);
    const v = s.vote!;
    cmd(s, 'host', { type: 'castVote', sector: 6 }, v.openedAt + 1000);
    expect(s.vote).not.toBeNull();
    tick(s, v.openedAt + 1000, v.closesAt + 5000, 5000);
    expect(s.vote).toBeNull();
    expect(s.closing?.sector).toBe(6);
  });
  it('breaks ties with the seeded server RNG among the tied sectors only', () => {
    const s = readyGame();
    const r = tally(s, { a: 2, b: 5, c: 2, d: 5 });
    expect(r.tied).toEqual([2, 5]);
    expect([2, 5]).toContain(r.winner);
    // deterministic for the same game state
    const s2 = readyGame();
    expect(tally(s2, { a: 2, b: 5, c: 2, d: 5 }).winner).toBe(r.winner);
  });
  it('host can override the vote', () => {
    const s = openVote();
    cmd(s, 'host', { type: 'overrideVote', sector: 10 }, s.vote!.openedAt + 1);
    expect(s.vote).toBeNull();
    expect(s.closing?.sector).toBe(10);
  });
  it('is disabled outside multi-sector mode', () => {
    const s = readyGame({ start: false });
    cmd(s, 'host', { type: 'updateConfig', patch: { mode: 'oneOpen', openSector: 7 } });
    cmd(s, 'host', { type: 'startGame' }, T0 + 1000);
    tick(s, T0 + 1000, T0 + 121_000 + 700_000, 10_000);
    expect(s.vote).toBeNull();
    expect(s.sectorState['7']).toBe('open');
    expect(s.sectorState['1']).toBe('closed');
  });
});

describe('sector closures', () => {
  it('announces, notifies the whole affected group, then closes after the grace period', () => {
    const s = readyGame();
    // Ben alone is in sector 2: the whole of Group A must relocate.
    updateLocation(s, 'ben', { ...center(2), acc: 5 }, T0 + 125_000);
    cmd(s, 'host', { type: 'overrideVote', sector: 2 }, T0 + 125_000);
    const relocate = s.events.find((e) => e.type === 'sector_relocate')!;
    expect(relocate.audience).toEqual({ players: ['ava', 'ben'] });
    expect(s.events.find((e) => e.type === 'sector_closing')!.sound).toEqual(['sector_closing_3_minutes', 'sector_02']);
    tick(s, T0 + 125_000, T0 + 125_000 + 180_000);
    expect(s.sectorState['2']).toBe('closed');
  });
  it('does not apply consequences while sectors are unverified; warns host instead', () => {
    const s = readyGame();
    updateLocation(s, 'ben', { ...center(2), acc: 5 }, T0 + 125_000);
    cmd(s, 'host', { type: 'overrideVote', sector: 2 }, T0 + 125_000);
    tick(s, T0 + 125_000, T0 + 310_000);
    expect(s.clues).toHaveLength(0);
    expect(s.events.some((e) => e.type === 'violation_unenforced')).toBe(true);
  });
  it('gives seekers an approximate clue (not exact position) when enforcement is on', () => {
    const s = readyGame();
    s.config.sectorsVerified = true;
    updateLocation(s, 'ben', { ...center(2), acc: 5 }, T0 + 125_000);
    cmd(s, 'host', { type: 'overrideVote', sector: 2 }, T0 + 125_000);
    tick(s, T0 + 125_000, T0 + 306_000, 1000);
    expect(s.clues.length).toBeGreaterThan(0);
    const c = s.clues[0];
    expect(distanceM(c, s.players.ben.fix!)).toBeLessThanOrEqual(c.radiusM);
    expect(c.lat).not.toBe(s.players.ben.fix!.lat);
  });
  it('closed sectors stay closed unless the host reopens them', () => {
    const s = readyGame();
    cmd(s, 'host', { type: 'setSectorState', sector: 4, status: 'closed' }, T0 + 130_000);
    tick(s, T0 + 130_000, T0 + 800_000, 20_000);
    expect(s.sectorState['4']).toBe('closed');
    cmd(s, 'host', { type: 'setSectorState', sector: 4, status: 'open' }, T0 + 800_000);
    expect(s.sectorState['4']).toBe('open');
  });
});

describe('search zones', () => {
  it('appears every 3 minutes for one group, shrinks over three stages, contains the group, then disappears', () => {
    const s = readyGame();
    tick(s, T0 + 121_000, T0 + 121_000 + 180_000);
    expect(s.zones).toHaveLength(1);
    const z = s.zones[0];
    const radii = z.circles[0].radii;
    expect(radii).toHaveLength(3);
    expect(radii[0]).toBeGreaterThan(radii[2]);
    expect(radii[2]).toBeGreaterThanOrEqual(s.config.zoneMinRadiusM);
    const g = s.groups[z.groupId];
    for (const m of g.members) expect(distanceM(z.circles[0], s.players[m].fix!)).toBeLessThanOrEqual(radii[2]);
    expect(distanceM(z.circles[0], s.players[g.members[0]].fix!)).toBeGreaterThan(1); // never the exact spot
    tick(s, z.startAt, z.startAt + 61_000, 1000);
    expect(s.zones).toHaveLength(0);
  });
  it('is visible to seekers only', () => {
    const s = readyGame();
    tick(s, T0 + 121_000, T0 + 121_000 + 181_000);
    expect(buildView(s, 'host', T0 + 302_000).zones).toHaveLength(1);
    expect(buildView(s, 'ava', T0 + 302_000).zones).toHaveLength(0);
  });
  it('covers separated members with one circle per cluster', () => {
    const s = readyGame();
    s.lastZoneGroup = Object.values(s.groups).find((g) => g.name === 'Group B')!.id; // force Group A next
    updateLocation(s, 'ben', { ...center(1), acc: 5 }, T0 + 200_000);
    tick(s, T0 + 200_000, T0 + 121_000 + 180_000 + 4000);
    expect(s.zones[0].circles).toHaveLength(2);
  });
});

describe('photo hints', () => {
  const round = () => { const s = readyGame(); tick(s, T0 + 121_000, T0 + 121_000 + 300_000); expect(s.photoRound).not.toBeNull(); return s; };
  it('requests a photo every 5 minutes with a 2-minute window; together groups need one photo', () => {
    const s = round();
    expect(s.photoRound!.dueAt - s.photoRound!.requestedAt).toBe(120_000);
    const a = s.photoRound!.reqs.filter((r) => r.memberIds.includes('ava'));
    expect(a).toHaveLength(1);
    expect(a[0].memberIds.sort()).toEqual(['ava', 'ben']);
  });
  it('the first approved photo satisfies the group', () => {
    const s = round();
    const t = s.photoRound!.requestedAt + 5000;
    const p = submitPhoto(s, 'ben', 'ph1', t);
    cmd(s, 'host', { type: 'reviewPhoto', photoId: p.id, approve: true }, t + 1000);
    expect(s.photoRound!.reqs.find((r) => r.memberIds.includes('ava'))!.satisfiedBy).toBe('ph1');
    expect(code(() => submitPhoto(s, 'ava', 'ph2', t + 2000))).toBe('done');
    expect(buildView(s, 'cleo', t + 3000).photos.map((x) => x.id)).toContain('ph1'); // approved photos visible to all
  });
  it('separated members each owe their own photo', () => {
    const s = readyGame();
    updateLocation(s, 'ben', { ...center(1), acc: 5 }, T0 + 200_000);
    tick(s, T0 + 200_000, T0 + 121_000 + 300_000 + 4000);
    const reqs = s.photoRound!.reqs.filter((r) => r.groupId === s.players.ava.groupId);
    expect(reqs).toHaveLength(2);
  });
  it('a missed deadline creates a temporary approximate clue for that group', () => {
    const s = round();
    const p = submitPhoto(s, 'cleo', 'ph1', s.photoRound!.requestedAt + 1000);
    cmd(s, 'host', { type: 'reviewPhoto', photoId: p.id, approve: true }, s.photoRound!.requestedAt + 2000);
    tick(s, s.photoRound!.requestedAt + 2000, s.photoRound!.dueAt + 1000, 1000);
    expect(s.clues).toHaveLength(1);
    expect(s.clues[0].groupId).toBe(s.players.ava.groupId);
    expect(s.events.some((e) => e.type === 'photo_deadline_missed')).toBe(true);
    tick(s, s.photoRound!.dueAt + 1000, s.photoRound!.dueAt + 62_000, 1000);
    expect(s.clues).toHaveLength(0);
  });
  it('rejections carry a reason; a pending photo at the deadline is judged when reviewed', () => {
    const s = round();
    const p = submitPhoto(s, 'ava', 'ph1', s.photoRound!.requestedAt + 1000);
    tick(s, s.photoRound!.requestedAt + 1000, s.photoRound!.dueAt + 1000, 1000);
    expect(s.clues.filter((c) => c.groupId === s.players.ava.groupId)).toHaveLength(0);
    cmd(s, 'host', { type: 'reviewPhoto', photoId: p.id, approve: false, reason: 'Parking garage' }, s.photoRound!.dueAt + 2000);
    expect(s.photos[0].reason).toBe('Parking garage');
    expect(s.clues.filter((c) => c.groupId === s.players.ava.groupId)).toHaveLength(1);
  });
});

describe('catches', () => {
  it('seeker reports, hider confirms, only the hider becomes a seeker, replay is created', () => {
    const s = readyGame();
    cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_000);
    const c = s.catches[0];
    expect(c.status).toBe('pending');
    expect(code(() => cmd(s, 'ben', { type: 'respondCatch', catchId: c.id, accept: true }, T0 + 131_000))).toBe('forbidden');
    cmd(s, 'ava', { type: 'respondCatch', catchId: c.id, accept: true }, T0 + 131_000);
    expect(s.players.ava.role).toBe('seeker');
    expect(s.players.ben.role).toBe('hider');
    expect(s.replays).toHaveLength(1);
    expect(s.replays[0]).toMatchObject({ seeker: 'Host', hider: 'Ava', sector: 3 });
  });
  it('disputes go to the host who makes the final decision', () => {
    const s = readyGame();
    cmd(s, 'host', { type: 'reportCatch', hiderId: 'cleo' }, T0 + 130_000);
    cmd(s, 'cleo', { type: 'respondCatch', catchId: s.catches[0].id, accept: false }, T0 + 131_000);
    expect(s.catches[0].status).toBe('disputed');
    expect(s.players.cleo.role).toBe('hider');
    cmd(s, 'host', { type: 'resolveCatch', catchId: s.catches[0].id, caught: false }, T0 + 140_000);
    expect(s.catches[0].status).toBe('rejected');
    expect(s.players.cleo.role).toBe('hider');
  });
  it('hiders cannot report catches and duplicate pending reports are refused', () => {
    const s = readyGame();
    expect(code(() => cmd(s, 'ben', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_000))).toBe('seekers_only');
    cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_000);
    expect(code(() => cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_500))).toBe('pending');
  });
  it('a group shrinking to one remaining hider keeps working', () => {
    const s = readyGame();
    cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_000);
    cmd(s, 'ava', { type: 'respondCatch', catchId: s.catches[0].id, accept: true }, T0 + 131_000);
    tick(s, T0 + 131_000, T0 + 121_000 + 300_000);
    const req = s.photoRound!.reqs.find((r) => r.groupId === s.players.ben.groupId)!;
    expect(req.memberIds).toEqual(['ben']);
    expect(s.phase).toBe('live');
  });
});

describe('win condition', () => {
  it('ends when one uncaught hider remains, who wins', () => {
    const s = readyGame();
    let t = T0 + 130_000;
    for (const h of ['ava', 'ben', 'cleo']) {
      cmd(s, 'host', { type: 'reportCatch', hiderId: h }, t);
      cmd(s, h, { type: 'respondCatch', catchId: s.catches.at(-1)!.id, accept: true }, t + 500);
      t += 1000;
    }
    expect(s.phase).toBe('ended');
    expect(s.winnerId).toBe('dev');
    expect(s.events.some((e) => e.type === 'final_two')).toBe(true);
    // results never contain positions
    expect(Object.values(s.players).every((p) => p.fix === null)).toBe(true);
  });
});

describe('privacy', () => {
  it('never sends other players\' raw coordinates; teammates are grid-snapped', () => {
    const s = readyGame();
    const v = buildView(s, 'ava', T0 + 130_000);
    const raw = JSON.stringify(v);
    for (const id of ['ben', 'cleo', 'dev', 'host']) expect(raw).not.toContain(String(s.players[id].fix!.lat));
    expect(v.teammates.map((t) => t.id)).toEqual(['ben']);
    const hostView = buildView(s, 'host', T0 + 130_000);
    expect(hostView.teammates).toHaveLength(0); // the only seeker
    expect(hostView.simPositions).toBeNull();
  });
  it('the host sees GPS status but not other players\' sectors', () => {
    const s = readyGame();
    const v = buildView(s, 'host', T0 + 130_000);
    expect(v.players.find((p) => p.id === 'ava')!.gps).toBe('ok');
    expect(JSON.stringify(v.players)).not.toContain('"sector"');
  });
});

describe('unauthorized actions and duplicates', () => {
  it('rejects host-only and simulation-only commands', () => {
    const s = readyGame();
    for (const c of [{ type: 'pause' }, { type: 'endGame' }, { type: 'overrideVote', sector: 2 }, { type: 'reviewPhoto', photoId: 'x', approve: true }] as const)
      expect(code(() => cmd(s, 'ava', c as never, T0 + 130_000))).toBe('host_only');
    expect(code(() => cmd(s, 'host', { type: 'simSkip', what: 'zone' }, T0 + 130_000))).toBe('sim_only');
  });
  it('ignores a repeated command id (duplicate-event prevention)', () => {
    const s = lobby();
    expect(applyCommand(s, 'ava', { type: 'setReady', ready: true }, T0, 'c1').duplicate).toBe(false);
    expect(applyCommand(s, 'ava', { type: 'setReady', ready: false }, T0, 'c1').duplicate).toBe(true);
    expect(s.players.ava.ready).toBe(true);
  });
});

describe('simulation', () => {
  it('adds bots in groups, runs them through a whole game at 30× speed', () => {
    const s = lobby(['Host'], true);
    cmd(s, 'host', { type: 'assignRole', playerId: 'host', role: 'seeker' });
    cmd(s, 'host', { type: 'simAddBots', hiders: 4, seekers: 1, groupSize: 2 });
    cmd(s, 'host', { type: 'simSetSpeed', speed: 30 });
    cmd(s, 'host', { type: 'setReady', ready: true });
    expect(Object.values(s.groups)).toHaveLength(2);
    cmd(s, 'host', { type: 'startGame' }, T0 + 1000);
    expect(s.headStartEndsAt).toBe(T0 + 1000 + 4000);
    for (let t = T0 + 1000; t < T0 + 60_000; t += 500) advance(s, t); // ≈ 30 game-minutes
    expect(s.phase).toBe('live');
    expect(s.voteRound).toBeGreaterThan(0);
    expect(s.closedLog.length).toBeGreaterThan(0);
    expect(s.photos.some((p) => p.sim)).toBe(true);
    // bots catch-confirm automatically
    const bot = Object.values(s.players).find((p) => p.isBot && p.role === 'hider')!;
    cmd(s, 'host', { type: 'simMovePlayer', playerId: 'host', lat: bot.fix!.lat, lon: bot.fix!.lon }, T0 + 60_000);
    cmd(s, 'host', { type: 'reportCatch', hiderId: bot.id }, T0 + 60_000);
    advance(s, T0 + 60_200);
    expect(s.players[bot.id].role).toBe('seeker');
  });
  it('host sees all positions only in simulation games', () => {
    const s = lobby(['Host'], true);
    cmd(s, 'host', { type: 'simAddBots', hiders: 2, seekers: 0, groupSize: 2 });
    expect(buildView(s, 'host', T0).simPositions!.length).toBe(2);
  });
});

describe('replays', () => {
  it('expire after the retention period', () => {
    const s = readyGame();
    cmd(s, 'host', { type: 'reportCatch', hiderId: 'ava' }, T0 + 130_000);
    cmd(s, 'ava', { type: 'respondCatch', catchId: s.catches[0].id, accept: true }, T0 + 131_000);
    advance(s, T0 + 131_000 + 23 * 3600_000);
    expect(s.replays).toHaveLength(1);
    advance(s, T0 + 131_000 + 25 * 3600_000);
    expect(s.replays).toHaveLength(0);
  });
});

void place;
