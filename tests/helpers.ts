import { addPlayer, applyCommand, createGame, updateLocation, advance, type Command } from '@/lib/engine/engine';
import { PROVISIONAL_SECTORS } from '@/lib/engine/config';
import { offsetM, sectorCentroid } from '@/lib/engine/geo';
import type { GameState } from '@/lib/engine/types';

export const T0 = 1_700_000_000_000;
export const center = (n: number) => sectorCentroid(PROVISIONAL_SECTORS.features.find((f) => f.properties.sector === n)!);

export function lobby(names: string[] = ['Host', 'Ava', 'Ben', 'Cleo', 'Dev'], sim = false): GameState {
  const s = createGame({ id: 'game1', code: '123456', hostId: 'host', hostName: names[0], hostTokenHash: 'x', now: T0, simulation: sim });
  names.slice(1).forEach((n, i) => addPlayer(s, { id: n.toLowerCase(), nickname: n, tokenHash: 'x', now: T0 + i }));
  return s;
}

export const cmd = (s: GameState, who: string, c: Command, now = T0) => applyCommand(s, who, c, now);

/**
 * host=seeker, ava+ben = Group A (hiders), cleo+dev = Group B (hiders).
 * Everyone is placed: group A in sector 7, group B in sector 5, host in sector 3.
 */
export function readyGame(opts: { start?: boolean; live?: boolean } = { start: true, live: true }): GameState {
  const s = lobby();
  cmd(s, 'host', { type: 'assignRole', playerId: 'host', role: 'seeker' });
  for (const p of ['ava', 'ben', 'cleo', 'dev']) cmd(s, 'host', { type: 'assignRole', playerId: p, role: 'hider' });
  cmd(s, 'ava', { type: 'createGroup', name: 'Group A' });
  const a = Object.values(s.groups)[0].id;
  cmd(s, 'ben', { type: 'joinGroup', groupId: a }); cmd(s, 'ben', { type: 'confirmGroup' });
  cmd(s, 'cleo', { type: 'createGroup', name: 'Group B' });
  const b = Object.values(s.groups).find((g) => g.name === 'Group B')!.id;
  cmd(s, 'dev', { type: 'joinGroup', groupId: b }); cmd(s, 'dev', { type: 'confirmGroup' });
  for (const p of ['ava', 'ben', 'cleo', 'dev']) cmd(s, p, { type: 'setReady', ready: true });
  place(s, T0);
  if (opts.start !== false) cmd(s, 'host', { type: 'startGame' }, T0 + 1000);
  if (opts.live !== false && opts.start !== false) { place(s, T0 + 121_000); advance(s, T0 + 121_000); }
  return s;
}

export function place(s: GameState, now: number) {
  const at = (id: string, n: number, e = 0, nn = 0) => s.players[id] && updateLocation(s, id, { ...offsetM(center(n), e, nn), acc: 5 }, now);
  at('host', 3); at('ava', 7); at('ben', 7, 4, 2); at('cleo', 5); at('dev', 5, 3, -3);
}

/** Keep everyone's GPS fresh while time passes. */
export function tick(s: GameState, from: number, to: number, step = 5000) {
  for (let t = from; t <= to; t += step) {
    for (const p of Object.values(s.players)) if (p.fix && !p.left && p.gps !== 'denied') { p.fix.at = t; if (p.gps === 'stale') p.gps = 'ok'; }
    advance(s, t);
  }
}
