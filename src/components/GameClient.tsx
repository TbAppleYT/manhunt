'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { GameEvent } from '@/lib/engine/types';
import { useGame } from '@/lib/client/useGame';
import { useLocation } from '@/lib/client/useLocation';
import { forgetSession } from '@/lib/client/api';
import { audio } from '@/lib/client/audio';
import { Lobby } from './Lobby';
import { Play } from './Play';
import { Results } from './Results';

const NO_BANNER = new Set(['welcome', 'player_joined', 'vote_cast', 'catch_reported', 'roles_randomized', 'lobby']);

export function GameClient({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [banner, setBanner] = useState<GameEvent | null>(null);
  const bannerT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onEvents = useCallback((evs: GameEvent[]) => {
    for (const e of evs) if (e.sound?.length) audio().play(e.sound, `${gameId}:${e.id}`);
    const show = [...evs].reverse().find((e) => !NO_BANNER.has(e.type));
    if (show) {
      setBanner(show); clearTimeout(bannerT.current);
      bannerT.current = setTimeout(() => setBanner(null), 7000);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && show.sound?.length) {
        navigator.serviceWorker?.ready.then((r) => r.showNotification('manhunt.', { body: show.text, tag: 'manhunt-game', icon: '/icons/icon-192.png' })).catch(() => {});
      }
    }
  }, [gameId]);

  const g = useGame(gameId, onEvents);
  const v = g.view;
  const phase = v?.game.phase;
  const geoGranted = useGeoGranted();
  // Location is shared only after explicit consent: in the lobby once you tap Ready (or, for the host, once
  // the browser permission was granted in "Before you play"), and throughout the match.
  const sharing = !!v && !v.game.simulation && (phase === 'headstart' || phase === 'live' || (phase === 'lobby' && (v.you.ready || (v.you.isHost && geoGranted))));
  const loc = useLocation(g.session, sharing,
    () => g.send({ type: 'gpsProblem', kind: 'denied' }).catch(() => {}),
    () => g.send({ type: 'gpsProblem', kind: 'unavailable' }).catch(() => {}));

  const leave = () => { forgetSession(gameId); router.push('/'); };

  if (g.fatal) return (
    <Shell>
      <h1 className="h1">Game unavailable</h1>
      <p className="lead">{g.fatal.message}</p>
      <button className="btn" onClick={leave}>Home</button>
    </Shell>
  );
  if (g.session === null && typeof window !== 'undefined' && !v) return (
    <NoSession gameId={gameId} />
  );
  if (!v || !g.session) return <Shell><p className="lead" aria-busy="true">Connecting…</p></Shell>;

  if (phase === 'lobby') return <Lobby view={v} send={g.send} onLeft={leave} />;
  if (phase === 'ended') return <Results view={v} session={g.session} send={g.send} onHome={() => router.push('/')} />;
  return <Play view={v} session={g.session} now={g.now} send={g.send} log={g.log} banner={banner} dismissBanner={() => setBanner(null)} loc={loc} conn={g.conn} onLeft={leave} />;
}

function useGeoGranted() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((r) => { setOk(r.state === 'granted'); r.onchange = () => setOk(r.state === 'granted'); }).catch(() => {});
  }, []);
  return ok;
}

function NoSession({ gameId }: { gameId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t); }, []);
  if (!ready) return <Shell><p className="lead">Connecting…</p></Shell>;
  return (
    <Shell>
      <h1 className="h1">You&apos;re not in this game</h1>
      <p className="lead">This device has no session for game {gameId.slice(0, 6)}…. Ask the host for the code and join.</p>
      <Link className="btn" style={{ display: 'grid', placeItems: 'center' }} href="/join">Join with a code</Link>
    </Shell>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="app"><div className="scroll"><div className="page"><div className="navrow"><Link href="/" className="wordmark">manhunt.</Link></div>{children}</div></div></div>;
}
