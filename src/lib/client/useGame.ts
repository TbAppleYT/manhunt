'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command } from '@/lib/engine/engine';
import type { GameEvent } from '@/lib/engine/types';
import type { PlayerView } from '@/lib/engine/view';
import { api, ApiError, loadSession, type Session } from './api';
import { audio } from './audio';

export type Conn = 'ok' | 'reconnecting' | 'lost';

/**
 * Keeps one player's view in sync with the server.
 *  - Polls (1.5 s in game, 2.5 s in lobby, slower when hidden). Polling is also the reconnection path:
 *    after the phone wakes, the next poll returns everything missed since the last event cursor.
 *  - If Supabase Realtime is configured, a broadcast nudge triggers an immediate poll.
 *  - Server clock offset is estimated from each response so countdowns match every device.
 */
export function useGame(gameId: string, onEvents?: (e: GameEvent[], fresh: boolean) => void) {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [fatal, setFatal] = useState<ApiError | null>(null);
  const [conn, setConn] = useState<Conn>('ok');
  const [log, setLog] = useState<GameEvent[]>([]);
  const offset = useRef(0);
  const cursor = useRef(0);
  const fails = useRef(0);
  const loadedAt = useRef(Date.now());
  const inflight = useRef(false);
  const onEv = useRef(onEvents); onEv.current = onEvents;
  const kick = useRef<() => void>(() => {});

  useEffect(() => { setSession(loadSession(gameId)); }, [gameId]);

  const accept = useCallback((v: PlayerView, t0: number, t1: number) => {
    const est = v.serverNow - (t0 + t1) / 2;
    offset.current = offset.current === 0 ? est : offset.current * 0.7 + est * 0.3;
    if (v.events.length) {
      const fresh = v.events.filter((e) => e.id > cursor.current);
      if (fresh.length) {
        // Events from before this page loaded are history: no sound or banner.
        const live = fresh.filter((e) => e.at >= loadedAt.current - 4000 + 0 * offset.current);
        onEv.current?.(live, true);
        setLog((l) => [...l, ...fresh].slice(-120));
      }
    }
    cursor.current = Math.max(cursor.current, v.eventSeq);
    setView(v);
  }, []);

  const poll = useCallback(async () => {
    if (!session || inflight.current) return;
    inflight.current = true;
    const t0 = Date.now();
    try {
      const r = await api.view(session, cursor.current);
      accept(r.view, t0, Date.now());
      if (fails.current >= 2) setConn('ok');
      fails.current = 0; setConn('ok');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401 || err.status === 403 || err.status === 404) setFatal(err);
      else {
        fails.current++;
        if (fails.current === 2) setConn('reconnecting');
        if (fails.current === 5) { setConn('lost'); audio().play(['connection_lost'], `conn-${Date.now() / 60000 | 0}`); }
      }
    } finally { inflight.current = false; }
  }, [session, accept]);
  kick.current = poll;

  useEffect(() => {
    if (!session) return;
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (stop) return;
      const phase = view?.game.phase;
      const base = phase === 'lobby' ? 2500 : phase === 'ended' ? 6000 : 1500;
      timer = setTimeout(loop, document.hidden ? Math.max(base, 5000) : base);
    };
    loop();
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view?.game.phase]);

  // Optional realtime nudge.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!session || !url || !key) return;
    let cleanup = () => {};
    import('@supabase/supabase-js').then(({ createClient }) => {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const ch = sb.channel(`game-${session.gameId}`).on('broadcast', { event: 'v' }, () => kick.current()).subscribe();
      cleanup = () => { sb.removeChannel(ch); };
    }).catch(() => {});
    return () => cleanup();
  }, [session]);

  const send = useCallback(async (cmd: Command) => {
    if (!session) throw new ApiError('no_session', 'No session.', 401);
    const t0 = Date.now();
    const r = await api.command(session, cmd, cursor.current);
    accept(r.view, t0, Date.now());
    return r.view;
  }, [session, accept]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { session, view, fatal, conn, log, send, now, refresh: poll, setSession };
}
