'use client';
import { useEffect, useState } from 'react';
import type { PlayerView } from '@/lib/engine/view';
import type { Command } from '@/lib/engine/engine';
import { api, type Session } from '@/lib/client/api';
import { clock, fmt } from '@/lib/client/format';
import { SECTOR_GRID } from '@/lib/engine/config';
import { initial } from './ui';

type Tab = 'game' | 'review' | 'players' | 'sectors';
const REASONS = ['No business sign or logo visible', 'Parking garage', 'Blank wall', 'Logo looks digitally added', 'Too blurry to read'];

export function HostPanel({ view: v, session, run, t }: { view: PlayerView; session: Session; run: (c: Command, ok?: string) => Promise<boolean>; t: number }) {
  const g = v.game;
  const pendingPhotos = v.photos.filter((x) => x.status === 'pending');
  const disputes = v.catches.filter((c) => c.status === 'disputed' || c.status === 'pending');
  const [tab, setTab] = useState<Tab>(pendingPhotos.length || disputes.some((d) => d.status === 'disputed') ? 'review' : 'game');
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (<>
    <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
      {([['game', 'Game'], ['review', `Review${pendingPhotos.length + disputes.filter((d) => d.status === 'disputed').length ? ` · ${pendingPhotos.length + disputes.filter((d) => d.status === 'disputed').length}` : ''}`], ['players', 'Players'], ['sectors', 'Sectors']] as [Tab, string][]).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={'host-tab-' + k}>{l}</button>
      ))}
    </div>

    {tab === 'game' && (<>
      <div className="list">
        <div className="li"><span className="tx"><span className="t1">{g.phase === 'headstart' ? 'Head start' : 'Live'}{g.paused ? ' · paused' : ''}</span><span className="t2">Code {g.code}{g.startedAt ? ` · started ${clock(g.startedAt)}` : ''}</span></span></div>
        {g.phase === 'headstart' && g.headStartEndsAt && <div className="li"><span className="tx"><span className="t1">Seekers released in</span></span><span className="acc">{fmt(g.headStartEndsAt - t)}</span></div>}
        {v.vote && <div className="li"><span className="tx"><span className="t1">Vote open</span><span className="t2">{v.vote.voted} of {v.vote.eligible} voted</span></span><span className="acc">{fmt(v.vote.closesAt - t)}</span></div>}
        {g.closing && <div className="li"><span className="tx"><span className="t1">Sector {g.closing.sector} closing</span></span><span className="acc">{fmt(g.closing.closesAt - t)}</span></div>}
        {g.nextVoteAt && !v.vote && <div className="li"><span className="tx"><span className="t1">Next vote</span></span><span className="acc">{fmt(g.nextVoteAt - t)}</span></div>}
        {g.nextZoneAt && <div className="li"><span className="tx"><span className="t1">Next search zone</span></span><span className="acc">{fmt(g.nextZoneAt - t)}</span></div>}
        {g.nextPhotoAt && <div className="li"><span className="tx"><span className="t1">Next photo request</span></span><span className="acc">{fmt(g.nextPhotoAt - t)}</span></div>}
      </div>
      <div className="stack">
        {g.paused ? <button className="btn" onClick={() => run({ type: 'resume' }, 'Resumed')} data-testid="host-resume">Resume game</button>
          : <button className="btn" onClick={() => run({ type: 'pause' }, 'Paused')} data-testid="host-pause">Pause game</button>}
        {!g.paused?.emergency && <button className="btn red" onClick={() => run({ type: 'pause', emergency: true }, 'Emergency pause on')} data-testid="host-emergency">Emergency pause</button>}
        {g.phase === 'headstart' && <button className="btn ghost" onClick={() => run({ type: 'restartHeadStart' }, 'Head start restarted')}>Restart head start</button>}
        {!confirmEnd ? <button className="btn ghost" onClick={() => setConfirmEnd(true)}>End game…</button> : (
          <div className="notice warn"><b>End the game for everyone?</b> No winner is declared.
            <div className="row" style={{ marginTop: 10 }}><button className="btn sm red" onClick={() => run({ type: 'endGame' })}>End game</button><button className="btn sm ghost" onClick={() => setConfirmEnd(false)}>Cancel</button></div>
          </div>
        )}
      </div>
      <p className="sub" style={{ fontSize: 12, marginTop: 14 }}>Game mode: {modeName(g.config.mode)}. Sector enforcement is {g.config.sectorsVerified ? 'on' : 'off until sectors are verified on-site'}.</p>
    </>)}

    {tab === 'review' && (<>
      {disputes.length === 0 && pendingPhotos.length === 0 && <p className="sub">Nothing to review.</p>}
      {disputes.map((c) => (
        <div className="review-card" key={c.id}>
          <div className="row"><b style={{ fontSize: 15 }}>{c.seeker} → {c.hider}</b><span className="spacer" /><span className="chip warn">{c.status === 'disputed' ? 'Disputed' : 'Awaiting hider'}</span></div>
          <span className="small">Reported {clock(c.at)}. Your decision is final.</span>
          <div className="row"><button className="btn sm red" onClick={() => run({ type: 'resolveCatch', catchId: c.id, caught: true }, `${c.hider} is now a seeker`)}>Caught</button><button className="btn sm ghost" onClick={() => run({ type: 'resolveCatch', catchId: c.id, caught: false }, 'Catch rejected')}>Not caught</button></div>
        </div>
      ))}
      {pendingPhotos.map((ph) => <PhotoReview key={ph.id} ph={ph} session={session} run={run} />)}
      <details><summary className="small" style={{ cursor: 'pointer' }}>Reviewed photos ({v.photos.filter((x) => x.status !== 'pending').length})</summary>
        <div className="list" style={{ marginTop: 8 }}>{v.photos.filter((x) => x.status !== 'pending').map((ph) => (
          <div className="li" key={ph.id}><span className="tx"><span className="t1">{ph.nickname} · {ph.groupName}</span><span className="t2">{ph.status === 'approved' ? 'Approved' : `Rejected: ${ph.reason}`}</span></span></div>
        ))}</div>
      </details>
    </>)}

    {tab === 'players' && (<>
      <p className="sub" style={{ fontSize: 12 }}>Connection and GPS status only. Positions are never shown to the host.</p>
      <div className="list">{v.players.filter((x) => !x.left).map((m) => (
        <div className="li" key={m.id}><span className={'av' + (m.role === 'seeker' ? ' s' : '')}>{initial(m.nickname)}</span>
          <span className="tx"><span className="t1">{m.nickname}{m.isHost ? ' · Host' : ''}{m.isBot ? ' · Bot' : ''}</span><span className="t2">{m.role === 'seeker' ? (m.caught ? 'Seeker (caught)' : 'Seeker') : 'Hider'}{m.groupId ? ' · ' + (v.groups.find((x) => x.id === m.groupId)?.name ?? '') : ''}</span></span>
          <span className={'chip ' + (!m.online ? 'bad' : m.gps === 'ok' ? 'ok' : 'warn')}>{!m.online ? 'Offline' : m.gps === 'ok' ? `GPS ±${m.acc ?? '?'}m` : m.gps === 'poor' ? `Weak ±${m.acc}m` : m.gps === 'denied' ? 'GPS blocked' : m.gps === 'none' ? 'No GPS yet' : 'GPS lost'}</span>
        </div>
      ))}</div>
    </>)}

    {tab === 'sectors' && (<>
      <p className="sub">Tap a sector to close or reopen it. Closing here skips the 3-minute warning. To start a warning, use Override vote.</p>
      <SectorAdmin view={v} run={run} />
    </>)}
  </>);
}

function SectorAdmin({ view: v, run }: { view: PlayerView; run: (c: Command, ok?: string) => Promise<boolean> }) {
  const g = v.game;
  const [sel, setSel] = useState<number | null>(null);
  const st = sel ? g.sectorState[sel] : null;
  return (<>
    <div className="grid">{SECTOR_GRID.map((row) => row.map((n) => (
      <button key={n} className={'cell' + (row.length === 2 ? ' w' : '')} aria-pressed={sel === n} onClick={() => setSel(n)}>{n}<small>{g.sectorState[n] === 'closed' ? 'Closed' : g.sectorState[n] === 'closing' ? 'Closing' : 'Open'}</small></button>
    )))}</div>
    {sel && (
      <div className="stack">
        {st !== 'closed' && <button className="btn ghost" onClick={() => run({ type: 'setSectorState', sector: sel, status: 'closed' }, `Sector ${sel} closed`)}>Close sector {sel} now</button>}
        {st !== 'open' && <button className="btn ghost" onClick={() => run({ type: 'setSectorState', sector: sel, status: 'open' }, `Sector ${sel} reopened`)}>Reopen sector {sel}</button>}
        {st === 'open' && g.phase === 'live' && g.config.mode === 'multi' && <button className="btn red" disabled={!!g.closing} onClick={() => run({ type: 'overrideVote', sector: sel }, `Sector ${sel} selected`)}>Override vote: close sector {sel} after warning</button>}
      </div>
    )}
  </>);
}

function PhotoReview({ ph, session, run }: { ph: PlayerView['photos'][number]; session: Session; run: (c: Command, ok?: string) => Promise<boolean> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => { let u: string | null = null; api.photoUrl(session, ph.id).then((x) => { u = x; setUrl(x); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [ph.id, session]);
  return (
    <div className="review-card" data-testid="photo-review">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={`Photo hint from ${ph.nickname}`} /> : <div style={{ height: 200, borderRadius: 8, background: '#000' }} />}
      <div className="row"><b style={{ fontSize: 14 }}>{ph.nickname} · {ph.groupName}</b><span className="spacer" /><span className="small">{clock(ph.at)}{ph.sim ? ' · simulated' : ''}</span></div>
      {!rejecting ? (
        <div className="row"><button className="btn sm blue" onClick={() => run({ type: 'reviewPhoto', photoId: ph.id, approve: true }, 'Approved')} data-testid="approve-photo">Approve</button><button className="btn sm ghost" onClick={() => setRejecting(true)}>Reject…</button></div>
      ) : (
        <div className="stack">
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Rejection reason" style={{ height: 40, background: 'var(--surface)' }}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
          <div className="row"><button className="btn sm red" onClick={() => run({ type: 'reviewPhoto', photoId: ph.id, approve: false, reason }, 'Rejected')}>Reject photo</button><button className="btn sm ghost" onClick={() => setRejecting(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

export const modeName = (m: string) => ({ multi: 'Multi-sector', shared: 'Shared sector', groupSelected: 'Group-selected sectors', oneOpen: 'One open sector' } as Record<string, string>)[m] ?? m;
