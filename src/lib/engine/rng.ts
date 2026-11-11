// Deterministic RNG whose state lives inside GameState, so every server instance makes the same choices
// for the same game history (tie-breaks, zone targets, offsets) and tests are reproducible.
import type { GameState } from './types';

export function nextRandom(s: GameState): number {
  let t = (s.rngState = (s.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(s: GameState, arr: T[]): T {
  return arr[Math.floor(nextRandom(s) * arr.length)];
}

export function seedFrom(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}
