'use client';
import type { Command } from '@/lib/engine/engine';
import type { PlayerView } from '@/lib/engine/view';

export interface Session { gameId: string; playerId: string; token: string; code: string; sim?: boolean }

/* Real games: localStorage (survives app restarts → reconnection). Simulation games: sessionStorage,
   so each browser tab can be a different player for multi-window testing. */
const KEY = (id: string) => `mh.session.${id}`;
export function saveSession(s: Session) {
  try { (s.sim ? sessionStorage : localStorage).setItem(KEY(s.gameId), JSON.stringify(s)); localStorage.setItem('mh.last', s.sim ? '' : s.gameId); } catch { /* storage blocked */ }
}
export function loadSession(gameId: string): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY(gameId)) ?? localStorage.getItem(KEY(gameId));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch { return null; }
}
export function forgetSession(gameId: string) {
  try { sessionStorage.removeItem(KEY(gameId)); localStorage.removeItem(KEY(gameId)); if (localStorage.getItem('mh.last') === gameId) localStorage.removeItem('mh.last'); } catch { /* ignore */ }
}
export function lastGameId(): string | null { try { return localStorage.getItem('mh.last') || null; } catch { return null; } }

export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }

async function call<T>(path: string, init: RequestInit & { session?: Session } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.session) headers.set('authorization', `Bearer ${init.session.playerId}.${init.session.token}`);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try { res = await fetch(path, { ...init, headers, cache: 'no-store' }); }
  catch { throw new ApiError('offline', 'No connection. Retrying…', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'error', data.message || 'Something went wrong.', res.status);
  return data as T;
}

export const api = {
  create: (nickname: string, simulation = false) => call<Session>('/api/games', { method: 'POST', body: JSON.stringify({ nickname, simulation }) }),
  join: (code: string, nickname: string, simulation = false) => call<Session>('/api/join', { method: 'POST', body: JSON.stringify({ code, nickname, simulation }) }),
  view: (s: Session, since: number) => call<{ view: PlayerView; version: number }>(`/api/games/${s.gameId}?since=${since}`, { session: s }),
  command: (s: Session, cmd: Command, since: number) =>
    call<{ view: PlayerView; version: number; duplicate: boolean }>(`/api/games/${s.gameId}/command`, { method: 'POST', session: s, body: JSON.stringify({ cmd, since, cmdId: crypto.randomUUID() }) }),
  location: (s: Session, fix: { lat: number; lon: number; acc: number; sim?: boolean }) =>
    call<{ accepted: boolean; sector: number | null }>(`/api/games/${s.gameId}/location`, { method: 'POST', session: s, body: JSON.stringify(fix) }),
  uploadPhoto: (s: Session, blob: Blob) => call<{ photoId: string }>(`/api/games/${s.gameId}/photos`, { method: 'POST', session: s, body: blob, headers: { 'content-type': blob.type || 'image/jpeg' } }),
  async photoUrl(s: Session, photoId: string): Promise<string> {
    const res = await fetch(`/api/games/${s.gameId}/photos/${photoId}`, { headers: { authorization: `Bearer ${s.playerId}.${s.token}` } });
    if (!res.ok) throw new ApiError('photo', 'Photo unavailable.', res.status);
    return URL.createObjectURL(await res.blob());
  },
};

/** Downscale a camera image on-device before upload (privacy + bandwidth). Also strips EXIF/GPS metadata,
    because the canvas re-encode does not copy it. */
export async function prepareImage(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.82));
}
