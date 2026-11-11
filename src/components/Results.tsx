'use client';
import { useState } from 'react';
import type { PlayerView } from '@/lib/engine/view';
import type { Command } from '@/lib/engine/engine';
import type { Session } from '@/lib/client/api';
import { clock, duration } from '@/lib/client/format';
import { PhotoGallery, ReplayList } from './Play';
import { Sheet } from './ui';

export function Results({ view: v, session, send, onHome }: { view: PlayerView; session: Session; send: (c: Command) => Promise<unknown>; onHome: () => void }) {
  const g = v.game, st = v.stats;
  const [sheet, setSheet] = useState<null | 'replays' | 'photos'>(null);
  const [err, setErr] = useState<string | null>(null);
  const youWon = g.winner?.id === v.you.id;
  const catches = v.catches.filter((c) => c.status === 'confirmed');
  return (
    <div className="app" data-testid="results">
      <div className="scroll"><div className="page">
        <div className="navrow"><span className="wordmark">manhunt.</span><span className="pill">Game over</span></div>
        <div className="stack" style={{ gap: 6, paddingTop: 8 }}>
          <span className="small">{g.winner ? 'Winner' : 'Result'}</span>
          <h1 className="h1" data-testid="winner">{g.winner ? (youWon ? 'You won' : g.winner.nickname) : 'No winner'}</h1>
          <p className="lead">{g.winner ? 'Last hider standing.' : g.endReason ?? ''}</p>
        </div>
        <div className="list" style={{ marginBottom: 0 }}>
          {st?.durationMs != null && <div className="li"><span className="tx"><span className="t1">Match length</span></span><span className="acc">{duration(st.durationMs)}</span></div>}
          <div className="li"><span className="tx"><span className="t1">Catches</span></span><span className="acc">{st?.catches ?? 0}</span></div>
          <div className="li"><span className="tx"><span className="t1">Hiders</span></span><span className="acc">{st ? `${st.hidersLeft} of ${st.hidersStart} uncaught` : ''}</span></div>
          <div className="li"><span className="tx"><span className="t1">Sectors closed</span></span><span className="acc">{g.closedLog.length ? g.closedLog.map((c) => c.sector).join(', ') : 'None'}</span></div>
        </div>
        {catches.length > 0 && (<>
          <div className="cap" style={{ margin: 0 }}>CATCHES</div>
          <div className="list" style={{ marginBottom: 0 }}>{catches.map((c) => (
            <div className="li" key={c.id}><span className="tx"><span className="t1">{c.hider}</span><span className="t2">Caught by {c.seeker}{c.sector ? ` · Sector ${c.sector}` : ''}</span></span><span className="acc">{clock(c.at)}</span></div>
          ))}</div>
        </>)}
        <div className="stack">
          {v.replays.length > 0 && <button className="btn ghost" onClick={() => setSheet('replays')} data-testid="open-replays">Watch catch replays</button>}
          <button className="btn ghost" onClick={() => setSheet('photos')}>Photo hints</button>
        </div>
        <p className="small">Location data is not kept. Replays are stylised and expire after {g.config.replayRetentionHours} hours.</p>
        <div className="spacer" />
        {err && <p className="err">{err}</p>}
        <div className="stack">
          {v.you.isHost && <button className="btn" onClick={() => send({ type: 'returnToLobby' }).catch((e) => setErr(e.message))} data-testid="to-lobby">Return to lobby</button>}
          {!v.you.isHost && <p className="small" style={{ textAlign: 'center' }}>The host can bring everyone back to the lobby for another round.</p>}
          <button className="btn ghost" onClick={onHome}>Home</button>
        </div>
      </div></div>
      <Sheet open={sheet === 'replays'} title="Catch replays" onClose={() => setSheet(null)}><ReplayList view={v} /></Sheet>
      <Sheet open={sheet === 'photos'} title="Photo hints" onClose={() => setSheet(null)}><PhotoGallery view={v} session={session} /></Sheet>
    </div>
  );
}
