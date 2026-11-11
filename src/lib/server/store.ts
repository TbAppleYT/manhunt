import type { GameState } from '@/lib/engine/types';

export interface Loaded { state: GameState; version: number }

export interface Store {
  readonly kind: 'memory' | 'postgres';
  /** Insert a new game. Throws StoreError('code_taken') if the code is in use by an unexpired game. */
  insert(state: GameState): Promise<void>;
  findByCode(code: string): Promise<{ id: string; simulation: boolean } | null>;
  load(id: string): Promise<Loaded | null>;
  /** Load-modify-save under a row lock (or per-game mutex). fn may throw to abort without saving. */
  mutate<T>(id: string, fn: (s: GameState) => T): Promise<Loaded & { result: T }>;
  putPhoto(gameId: string, photoId: string, mime: string, bytes: Uint8Array): Promise<void>;
  getPhoto(gameId: string, photoId: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
  deletePhoto(gameId: string, photoId: string): Promise<void>;
  /** Fixed-window rate limit. Returns true when the call is allowed. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
  /** Delete expired games, their photos and stale rate-limit rows. Returns games deleted. */
  cleanup(now: number): Promise<number>;
}

export class StoreError extends Error {
  constructor(public code: 'code_taken' | 'not_found' | 'conflict', msg?: string) { super(msg ?? code); }
}
