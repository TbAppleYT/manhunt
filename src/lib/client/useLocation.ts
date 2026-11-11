'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type Session } from './api';

export type LocState = 'off' | 'asking' | 'on' | 'denied' | 'unavailable' | 'unsupported';

/**
 * Shares this device's real GPS with the game server while `enabled`.
 * Only real fixes from the browser are sent — never invented ones. When the browser stops giving
 * fixes (denied, no signal, phone locked), the server marks this player paused until fixes return.
 */
export function useLocation(session: Session | null, enabled: boolean, onDenied?: () => void, onUnavailable?: () => void) {
  const [state, setState] = useState<LocState>('off');
  const [acc, setAcc] = useState<number | null>(null);
  const lastSent = useRef(0);
  const lastProblem = useRef(0);
  const cb = useRef({ onDenied, onUnavailable }); cb.current = { onDenied, onUnavailable };

  useEffect(() => {
    if (!enabled || !session) { setState('off'); return; }
    if (!('geolocation' in navigator)) { setState('unsupported'); return; }
    setState((s) => (s === 'on' ? s : 'asking'));
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState('on');
        setAcc(Math.round(pos.coords.accuracy));
        const now = Date.now();
        if (now - lastSent.current < 2500) return;
        lastSent.current = now;
        api.location(session, { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }).catch(() => {});
      },
      (err) => {
        const now = Date.now();
        if (err.code === err.PERMISSION_DENIED) { setState('denied'); if (now - lastProblem.current > 30_000) { lastProblem.current = now; cb.current.onDenied?.(); } }
        else { setState('unavailable'); if (now - lastProblem.current > 30_000) { lastProblem.current = now; cb.current.onUnavailable?.(); } }
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
    );
    // A stationary phone may stop firing watchPosition. Ask for a fresh real fix every 12 s so the server
    // does not wrongly mark this player as lost. (The browser returns a real reading, never a made-up one.)
    const refresh = setInterval(() => {
      navigator.geolocation.getCurrentPosition((pos) => {
        lastSent.current = Date.now();
        setState('on'); setAcc(Math.round(pos.coords.accuracy));
        api.location(session, { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }).catch(() => {});
      }, () => {}, { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 });
    }, 12_000);
    // Keep the screen awake while playing where supported (helps GPS keep updating).
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const getLock = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    getLock();
    const vis = () => { if (!document.hidden) getLock(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(refresh); navigator.geolocation.clearWatch(id); lock?.release().catch(() => {}); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, session]);

  return { state, acc };
}
