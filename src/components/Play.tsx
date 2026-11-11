'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '@/lib/engine/types';
import type { PlayerView } from '@/lib/engine/view';
import type { Command } from '@/lib/engine/engine';
import { SECTOR_GRID } from '@/lib/engine/config';
import { api, prepareImage, type Session } from '@/lib/client/api';
import { clock, fmt } from '@/lib/client/format';
import type { LocState } from '@/lib/client/useLocation';
import { MapView } from './MapView';
import { Icon, Seg, Sheet, Toggle, initial } from './ui';
import { HostPanel } from './HostPanel';
import { SettingsList } from './SettingsList';
import { SimPanel } from './SimPanel';
import { ReplayPlayer } from './Replay';

type SheetKey = null | 'photo' | 'catch' | 'vote' | 'group' | 'events' | 'more' | 'safety' | 'leave' | 'host' | 'photos' | 'replays';

export function Play(p: {
  view: PlayerView; session: Session; now: () => number; send: (c: Command) => Promise<unknown>; log: GameEvent[];
  banner: GameEvent | null; dismissBanner: () => void; loc: { state: LocState; acc: number | null }; conn: string; onLeft: () => void;
}) {
  const { view: v, now, send } = p;
  const you = v.you, g = v.game;
  const hider = you.role === 'hider', seeker = you.role === 'seeker';
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [layer, setLayer] = useState<'satellite' | 'illustrated'>('satellite');
  const [simSel, setSimSel] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const toastT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = useCallback((m: string) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 2600); }, []);
  const run = useCallback(async (c: Command, ok?: string) => { try { await send(c); if (ok) say(ok); return true; } catch (e) { say((e as Error).message); return false; } }, [send, say]);
  const close = useCallback(() => setSheet(null), []);

  // Time shown is frozen while paused: deadlines minus the pause start.
  const t = g.paused ? g.paused.at : now();
  const left = (d: number | null | undefined) => (d == null ? null : d - t);
  const playersById = useMemo(() => Object.fromEntries(v.players.map((x) => [x.id, x])), [v.players]);
  const hidersLeft = v.players.filter((x) => x.role === 'hider' && !x.left).length;
  const seekersN = v.players.filter((x) => x.role === 'seeker' && !x.left).length;
  const hidersStart = v.stats?.hidersStart || v.players.filter((x) => x.role === 'hider').length;
  const pr = v.photoRequest;
  const photoOpen = !!pr && !pr.satisfied && !pr.missed && pr.dueAt > t;
  const myGroup = v.groups.find((x) => x.id === you.groupId) ?? null;
  const pendingAgainstMe = v.catches.find((c) => c.hiderId === you.id && c.status === 'pending');
  const hostAttention = you.isHost ? v.photos.filter((x) => x.status === 'pending').length + v.catches.filter((c) => c.status === 'disputed').length : 0;

  // --- the one important countdown
  let label = '', deadline: number | null = null;
  if (g.phase === 'headstart') { label = seeker ? 'Seekers released in' : 'Head start'; deadline = g.headStartEndsAt; }
  else if (hider) {
    if (photoOpen && !pr!.pending) { label = 'Photo hint due'; deadline = pr!.dueAt; }
    else if (g.closing?.affectsYou) { label = `Leave sector ${g.closing.sector}`; deadline = g.closing.closesAt; }
    else if (v.vote) { label = 'Seekers voting'; deadline = v.vote.closesAt; }
    else { label = 'Next photo hint'; deadline = g.nextPhotoAt; }
  } else {
    if (v.vote) { label = 'Voting closes'; deadline = v.vote.closesAt; }
    else if (g.config.mode === 'multi' && g.nextVoteAt) { label = 'Next sector vote'; deadline = g.nextVoteAt; }
    else { label = 'Next search zone'; deadline = g.nextZoneAt; }
  }
  if (g.paused) label = g.paused.emergency ? 'Emergency pause' : 'Paused by host';

  const sectorText = you.sector ? `Sector ${you.sector}` : you.lat == null ? 'Locating…' : 'Outside sectors';
  const metaText = hider
    ? (v.vote ? null : `${hidersLeft} of ${hidersStart} hiding`)
    : v.vote ? `${v.vote.voted} of ${v.vote.eligible} seekers voted` : `${seekersN} seeker${seekersN === 1 ? '' : 's'} · ${hidersLeft} hiding`;

  // --- map data
  const teammates = v.teammates.map((m) => ({ ...m, team: (playersById[m.id]?.role === 'seeker' ? 'seeker' : 'hider') as 'hider' | 'seeker' }));
  const zones = v.zones.map((z) => ({ id: z.id, label: `Search zone · ${z.stage}/${z.stages}`, circles: z.circles, nextAt: z.nextStageAt ?? z.endsAt }));
  const clues = v.clues.map((c) => ({ id: c.id, label: `Clue · ${c.groupName}`, lat: c.lat, lon: c.lon, radiusM: c.radiusM, until: c.until }));
  const sim = g.simulation && you.isHost;
  const simPins = sim && v.simPositions ? v.simPositions.filter((x) => x.id !== you.id).map((x) => ({ id: x.id, label: initial(x.nickname), lat: x.lat, lon: x.lon, role: x.role, selected: x.id === simSel })) : undefined;
  const onTap = sim ? (ll: { lat: number; lon: number }) => run({ type: 'simMovePlayer', playerId: simSel ?? you.id, lat: ll.lat, lon: ll.lon }) : undefined;

  const primary = hider
    ? { label: pr?.pending ? 'Photo in review' : photoOpen ? 'Take photo hint' : 'Photo hints', meta: photoOpen && !pr!.pending ? fmt(pr!.dueAt - t) : pr?.pending ? 'Host' : '', quiet: !photoOpen || !!pr?.pending, icon: Icon.camera, open: 'photo' as const }
    : { label: 'Report catch', meta: g.phase === 'headstart' ? fmt((g.headStartEndsAt ?? t) - t) : '', quiet: g.phase === 'headstart' || !you.participating, icon: Icon.target, open: 'catch' as const };
  const actions: [React.ReactNode, string, SheetKey, number?][] = hider
    ? [[Icon.group, 'Group', 'group'], [Icon.events, 'Events', 'events'], [Icon.more, 'More', 'more', hostAttention]]
    : [[Icon.vote, 'Vote', 'vote', v.vote?.canVote ? 1 : 0], [Icon.group, 'Team', 'group'], [Icon.more, 'More', 'more', hostAttention]];

  return (
    <div className="app" data-role={seeker ? 'seeker' : 'hider'} data-state={g.paused ? 'paused' : v.vote ? 'voting' : 'live'} data-testid="play">
      {g.paused?.emergency && <div className="emergency" role="alert">Emergency pause. Stop where you are and check in with the host.</div>}
      <header className="top">
        <div className="row1">
          <span className="wordmark">manhunt.</span>
          <div className="status">
            <button className="loc" onClick={() => say(locText(p.loc.state, p.loc.acc))} aria-label={locText(p.loc.state, p.loc.acc)} style={{ color: p.loc.state === 'on' ? undefined : 'var(--warn)' }}>{Icon.arrow}</button>
            <span className="role" data-testid="role-pill"><i />{seeker ? 'Seeker' : 'Hider'}</span>
          </div>
        </div>
        <div className="row2">
          <div><div className="t-label" data-testid="timer-label">{label}</div><div className="t-val" data-testid="timer">{deadline ? fmt(left(deadline)!) : '–:––'}</div></div>
          <div className="meta"><div className="m1">{sectorText}</div><div className="m2">{v.vote && hider ? <><i className="dot" />Seekers are voting</> : metaText}</div></div>
        </div>
      </header>

      <MapView
        layer={layer} onLayer={() => setLayer((l) => (l === 'satellite' ? 'illustrated' : 'satellite'))}
        sectors={g.sectors} sectorState={g.sectorState} closing={g.closing} now={now}
        me={you.lat != null ? { lat: you.lat, lon: you.lon!, acc: you.acc } : null}
        teammates={teammates} zones={zones} clues={clues} simPins={simPins} onSimPin={(id) => setSimSel((s) => (s === id ? null : id))}
        onTap={onTap} onTeammate={(n) => say(`${n} · approximate area`)}
      >
        <button className={'banner' + (p.banner ? ' show' : '')} onClick={p.dismissBanner} aria-live="polite" tabIndex={p.banner ? 0 : -1}>
          <i className={'bd ' + bannerTone(p.banner)} /><div><b>{p.banner ? bannerTitle(p.banner) : ''}</b><span>{p.banner ? bannerBody(p.banner) : ''}</span></div><time>now</time>
        </button>
        {g.paused && <div className="pausecard"><b>{g.paused.emergency ? 'Emergency pause' : 'Paused by host'}</b><span>Stay where you are. Timers are frozen until the host resumes.</span></div>}
        {!you.participating && g.phase === 'live' && !g.paused && (
          <div className="statusbar" style={sim ? { bottom: 46 } : undefined}><span className="pill warn" data-testid="gps-paused">GPS paused · you&apos;re out until location returns</span></div>
        )}
        {p.conn !== 'ok' && <div className="statusbar" style={{ bottom: 44 }}><span className="pill warn">{p.conn === 'lost' ? 'Connection lost · retrying' : 'Reconnecting…'}</span></div>}
        {sim && <SimPanel view={v} send={send} selected={simSel} setSelected={setSimSel} say={say} />}
      </MapView>

      <footer className="bottom">
        <button className={'primary' + (primary.quiet ? ' quiet' : '')} onClick={() => setSheet(primary.open)} data-testid="primary">
          {primary.icon}<span>{primary.label}</span><span className="pm">{primary.meta}</span>
        </button>
        <nav className="actions">
          {actions.map(([ic, lab, key, badge]) => (
            <button key={lab} className={'act' + (sheet === key ? ' on' : '')} onClick={() => setSheet(key)} data-testid={'act-' + lab.toLowerCase()}>
              {ic}<span>{lab}</span>{badge ? <i className="badge">{badge}</i> : null}
            </button>
          ))}
        </nav>
      </footer>

      {/* ---------------- sheets ---------------- */}
      <Sheet open={sheet === 'photo'} title="Photo hint" onClose={close} testId="sheet-photo">
        <PhotoSheet view={v} session={p.session} t={t} run={run} say={say} onDone={close} />
      </Sheet>

      <Sheet open={sheet === 'catch'} title="Report catch" onClose={close} testId="sheet-catch">
        <CatchSheet view={v} run={run} onDone={close} />
      </Sheet>

      <Sheet open={sheet === 'vote'} title="Sector vote" onClose={close} testId="sheet-vote">
        <VoteSheet view={v} t={t} run={run} />
      </Sheet>

      <Sheet open={sheet === 'group'} title={hider ? myGroup?.name ?? 'Group' : 'Seekers'} onClose={close} testId="sheet-group">
        {hider && myGroup ? (<>
          <p className="sub">Locked when the match started. If any of you is in a closing sector, the whole group moves.</p>
          <div className="list">
            {myGroup.members.map((id) => {
              const m = playersById[id]; if (!m) return null;
              const apart = myGroup.together === false && !myGroup.clusters?.some((c) => c.includes(id) && c.includes(you.id));
              return (
                <div className="li" key={id}><span className="av">{initial(m.nickname)}</span>
                  <span className="tx"><span className="t1">{id === you.id ? 'You' : m.nickname}</span><span className="t2">{m.role === 'seeker' ? 'Caught · now seeking' : gpsText(m.gps, m.acc)}</span></span>
                  {m.role === 'hider' && <span className={'chip ' + (apart ? 'warn' : 'ok')}>{apart ? 'Separated' : 'Together'}</span>}
                </div>
              );
            })}
          </div>
          <p className="sub" style={{ fontSize: 12 }}>Teammates appear on the map as an approximate area, never an exact point.</p>
        </>) : (<>
          <div className="list">
            {v.players.filter((x) => x.role === 'seeker' && !x.left).map((m) => (
              <div className="li" key={m.id}><span className="av s">{initial(m.nickname)}</span>
                <span className="tx"><span className="t1">{m.id === you.id ? 'You' : m.nickname}{m.isHost ? ' · Host' : ''}</span><span className="t2">{m.caught ? 'Caught · now seeking' : 'Seeker'}</span></span>
                <span className={'chip ' + (!m.online ? 'bad' : m.gps === 'ok' ? 'ok' : 'warn')}>{!m.online ? 'Offline' : m.gps === 'ok' ? 'Online' : 'Weak GPS'}</span>
              </div>
            ))}
          </div>
          {v.catches.filter((c) => c.status === 'confirmed').length > 0 && (<>
            <div className="cap">CATCHES</div>
            <div className="list">{v.catches.filter((c) => c.status === 'confirmed').map((c) => (
              <button className="li" key={c.id} onClick={() => setSheet('replays')}><span className="tx"><span className="t1">{c.hider}</span><span className="t2">Caught by {c.seeker}{c.sector ? ` · Sector ${c.sector}` : ''}</span></span><span className="acc">Replay</span></button>
            ))}</div>
          </>)}
        </>)}
      </Sheet>

      <Sheet open={sheet === 'events'} title="Events" onClose={close} testId="sheet-events">
        {p.log.length === 0 ? <p className="sub">Nothing has happened yet.</p> : [...p.log].reverse().slice(0, 60).map((e) => (
          <div className="ev" key={e.id}><time>{clock(e.at)}</time><div>{e.text}</div></div>
        ))}
      </Sheet>

      <Sheet open={sheet === 'photos'} title="Photo hints" onClose={close}>
        <PhotoGallery view={v} session={p.session} />
      </Sheet>

      <Sheet open={sheet === 'replays'} title="Catch replays" onClose={close}>
        <ReplayList view={v} />
      </Sheet>

      <Sheet open={sheet === 'more'} title="More" onClose={close} testId="sheet-more">
        <div className="list">
          {you.isHost && <button className="li" onClick={() => setSheet('host')} data-testid="open-host"><span className="tx"><span className="t1">Host controls</span><span className="t2">Players, photos, disputes, sectors, timers</span></span>{hostAttention ? <span className="chip bad">{hostAttention}</span> : null}</button>}
          {seeker && <button className="li" onClick={() => setSheet('events')}><span className="tx"><span className="t1">Events</span></span><span className="acc">{p.log.length}</span></button>}
          <button className="li" onClick={() => setSheet('photos')}><span className="tx"><span className="t1">Approved photo hints</span></span><span className="acc">{v.photos.filter((x) => x.status === 'approved').length}</span></button>
          {v.replays.length > 0 && <button className="li" onClick={() => setSheet('replays')}><span className="tx"><span className="t1">Catch replays</span></span><span className="acc">{v.replays.length}</span></button>}
          <button className="li" onClick={() => setSheet('safety')}><span className="tx"><span className="t1">Safety rules</span></span></button>
          <div className="li"><span className="tx"><span className="t1">Location</span><span className="t2">{locText(p.loc.state, p.loc.acc)}</span></span></div>
        </div>
        <div className="cap">SETTINGS</div>
        <SettingsList />
        <div className="list"><button className="li danger" onClick={() => setSheet('leave')} data-testid="leave"><span className="tx"><span className="t1">Leave game</span></span></button></div>
      </Sheet>

      <Sheet open={sheet === 'safety'} title="Safety rules" onClose={close}>
        <SafetyRules />
        <button className="btn ghost" onClick={() => setSheet('more')}>Back</button>
      </Sheet>

      <Sheet open={sheet === 'leave'} title="Leave game?" onClose={close}>
        <p className="sub">You&apos;ll stop sharing location and drop out of the match.{you.isHost ? ' Host duties pass to the longest-standing player.' : ''}</p>
        <button className="btn red" onClick={async () => { if (await run({ type: 'leave' })) p.onLeft(); }} data-testid="confirm-leave">Leave game</button>
        <div style={{ height: 8 }} />
        <button className="btn ghost" onClick={() => setSheet('more')}>Cancel</button>
      </Sheet>

      <Sheet open={sheet === 'host'} title="Host controls" onClose={close} testId="sheet-host">
        <HostPanel view={v} session={p.session} run={run} t={t} />
      </Sheet>

      {pendingAgainstMe && (
        <div className="overlay" role="alertdialog" aria-labelledby="catch-q" data-testid="catch-confirm">
          <div className="modal">
            <h3 id="catch-q">Were you caught?</h3>
            <p>{pendingAgainstMe.seeker} says they caught you. If you confirm, you become a seeker right away. If you dispute, the host decides.</p>
            <button className="btn red" onClick={() => run({ type: 'respondCatch', catchId: pendingAgainstMe.id, accept: true })}>Yes, I was caught</button>
            <button className="btn ghost" onClick={() => run({ type: 'respondCatch', catchId: pendingAgainstMe.id, accept: false }, 'Disputed. The host will decide.')}>Dispute</button>
          </div>
        </div>
      )}
      <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
    </div>
  );
}

/* ---------------- sheet bodies ---------------- */

function PhotoSheet({ view: v, session, t, run, say, onDone }: { view: PlayerView; session: Session; t: number; run: (c: Command, ok?: string) => Promise<boolean>; say: (m: string) => void; onDone: () => void }) {
  const pr = v.photoRequest;
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  void run;
  const open = !!pr && !pr.satisfied && !pr.missed && pr.dueAt > t;
  const who = pr ? (pr.with.length ? `You and ${pr.with.join(', ')} are together, so one photo covers you all.` : v.groups.find((g) => g.id === v.you.groupId)?.together === false ? 'You are separated from your group, so you send your own photo.' : 'Send one photo for yourself.') : '';
  return (<>
    {pr?.pending ? <p className="sub">Your photo is with the host. You&apos;ll be told when it&apos;s approved or rejected.</p>
      : pr?.satisfied ? <p className="sub">Your group&apos;s photo for this round was approved.</p>
      : open ? <p className="sub">Due in <b className="tnum" style={{ color: 'var(--text)' }}>{fmt(pr!.dueAt - t)}</b>. {who}</p>
      : <p className="sub">No photo needed right now.{v.game.nextPhotoAt ? <> Next request in <b className="tnum" style={{ color: 'var(--text)' }}>{fmt(v.game.nextPhotoAt - t)}</b>.</> : null}</p>}
    {pr?.lastRejection && open && !pr.pending && <p className="sub" style={{ color: 'var(--seeker)' }}>Last photo rejected: {pr.lastRejection}</p>}
    <div className="ex">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <figure><img src="/photo-examples/GOOD_storefront_sign.thumb.jpg" alt="A storefront with its business sign clearly visible" /><figcaption><b>Good</b>A real sign or storefront name</figcaption></figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <figure><img src="/photo-examples/BAD_parking_garage.thumb.jpg" alt="A parking garage with no business signs" /><figcaption><b>Not accepted</b>Garages, blank walls, edited logos</figcaption></figure>
    </div>
    <p className="sub" style={{ fontSize: 12 }}>The host checks every photo by eye. There is no automatic image checking.</p>
    {open && !pr!.pending && (<>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden data-testid="photo-input"
        onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const b = await prepareImage(f); setFile(b); setPreview(URL.createObjectURL(b)); }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img className="preview" src={preview} alt="Your photo" />}
      {!file ? <button className="btn blue" onClick={() => input.current?.click()}>Open camera</button> : (
        <div className="stack">
          <button className="btn blue" disabled={busy} data-testid="send-photo" onClick={async () => {
            setBusy(true);
            try { await api.uploadPhoto(session, file); say('Photo sent to the host for review'); onDone(); }
            catch (e) { say((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? 'Sending…' : 'Send for review'}</button>
          <button className="btn ghost" onClick={() => { setFile(null); setPreview(null); input.current?.click(); }}>Retake</button>
        </div>
      )}
    </>)}
  </>);
}

function CatchSheet({ view: v, run, onDone }: { view: PlayerView; run: (c: Command, ok?: string) => Promise<boolean>; onDone: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const g = v.game;
  const hiders = v.players.filter((x) => x.role === 'hider' && !x.left);
  const pending = v.catches.filter((c) => c.seekerId === v.you.id && (c.status === 'pending' || c.status === 'disputed'));
  if (g.phase === 'headstart') return <p className="sub">Catch reports open when the head start ends.</p>;
  if (!v.you.participating) return <p className="sub">Your location is unavailable, so you can&apos;t report catches until it returns.</p>;
  const target = hiders.find((h) => h.id === pick);
  return (<>
    <p className="sub">Pick who you tagged. They&apos;ll be asked to confirm. Disputes go to the host.</p>
    {pending.length > 0 && <div className="notice" style={{ marginBottom: 14 }}>{pending.map((c) => <div key={c.id}>Waiting on <b>{c.hider}</b>{c.status === 'disputed' ? ' · disputed, host deciding' : ''}</div>)}</div>}
    <div className="cap">HIDERS</div>
    <div className="list" role="radiogroup">
      {hiders.map((h) => (
        <button key={h.id} className="li" role="radio" aria-checked={pick === h.id} onClick={() => setPick(h.id)} disabled={pending.some((c) => c.hiderId === h.id)}>
          <span className="av">{initial(h.nickname)}</span><span className="tx"><span className="t1">{h.nickname}</span></span><span className="radio" />
        </button>
      ))}
    </div>
    <button className="btn red" disabled={!target} data-testid="send-catch" onClick={async () => { if (await run({ type: 'reportCatch', hiderId: target!.id }, `Sent. Waiting for ${target!.nickname} to confirm.`)) onDone(); }}>
      Ask {target?.nickname ?? 'them'} to confirm
    </button>
  </>);
}

function VoteSheet({ view: v, t, run }: { view: PlayerView; t: number; run: (c: Command, ok?: string) => Promise<boolean> }) {
  const [pick, setPick] = useState<number | null>(null);
  const g = v.game, vote = v.vote;
  const multi = g.config.mode === 'multi';
  const cell = (n: number, wide: boolean) => {
    const st = g.sectorState[n];
    if (st == null) return <div key={n} className={'cell' + (wide ? ' w' : '')} style={{ visibility: 'hidden' }} />;
    const sel = vote?.yourVote === n || pick === n;
    // Original rule: only closed sectors are blocked.
    const disabled = st === 'closed' || !vote?.canVote;
    return <button key={n} className={'cell' + (wide ? ' w' : '')} aria-pressed={sel} disabled={disabled} onClick={() => setPick(n)} data-testid={'vote-' + n}>{n}{st === 'closed' ? <small>Closed</small> : st === 'closing' ? <small>Closing</small> : null}</button>;
  };
  if (!multi) return <p className="sub">Sector voting is off in this game mode.</p>;
  return (<>
    <p className="sub">
      {vote ? (vote.yourVote ? <>You voted for sector {vote.yourVote}. {vote.voted} of {vote.eligible} seekers have voted.</>
        : vote.canVote ? <>Voting closes in <b className="tnum" style={{ color: 'var(--text)' }}>{fmt(vote.closesAt - t)}</b>. The sector with the most votes closes after a {Math.round(g.config.closeGraceSec / 60)}-minute warning.</>
        : <>Voting is open for seekers who were active when it started.</>)
        : g.nextVoteAt ? <>Voting opens in <b className="tnum" style={{ color: 'var(--text)' }}>{fmt(g.nextVoteAt - t)}</b>.</> : <>No more votes this game.</>}
    </p>
    <div className="grid">{SECTOR_GRID.map((row) => row.map((n) => cell(n, row.length === 2)))}</div>
    <p className="sub" style={{ fontSize: 12 }}>Laid out like the visitor guide: Independence Blvd at the top, Virginia Beach Blvd on the right. Ties are drawn at random by the server.</p>
    {vote?.canVote && <button className="btn red" disabled={!pick} data-testid="cast-vote" onClick={() => run({ type: 'castVote', sector: pick! }, `Voted for sector ${pick}`)}>{pick ? `Vote for sector ${pick}` : 'Choose a sector'}</button>}
  </>);
}

export function PhotoGallery({ view: v, session }: { view: PlayerView; session: Session }) {
  const approved = v.photos.filter((x) => x.status === 'approved');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    approved.forEach((ph) => { if (!urls[ph.id]) api.photoUrl(session, ph.id).then((u) => live && setUrls((m) => ({ ...m, [ph.id]: u }))).catch(() => {}); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved.length]);
  if (!approved.length) return <p className="sub">No approved photo hints yet.</p>;
  return (
    <div className="photo-grid">
      {[...approved].reverse().map((ph) => (
        // eslint-disable-next-line @next/next/no-img-element
        <figure key={ph.id}>{urls[ph.id] ? <img src={urls[ph.id]} alt={`Photo hint from ${ph.groupName}`} /> : <div style={{ aspectRatio: '4/5', background: 'var(--surface-2)', borderRadius: 10 }} />}<figcaption>{ph.groupName} · {clock(ph.at)}{ph.sim ? ' · simulated' : ''}</figcaption></figure>
      ))}
    </div>
  );
}

export function ReplayList({ view: v }: { view: PlayerView }) {
  const [open, setOpen] = useState<string | null>(v.replays[v.replays.length - 1]?.id ?? null);
  const r = v.replays.find((x) => x.id === open);
  if (!v.replays.length) return <p className="sub">No catches yet.</p>;
  return (<>
    {r && <ReplayPlayer replay={r} key={r.id} />}
    <div className="list" style={{ marginTop: 14 }}>
      {v.replays.map((x) => (
        <button key={x.id} className="li" onClick={() => setOpen(x.id)} aria-current={x.id === open}><span className="tx"><span className="t1">{x.hider}</span><span className="t2">Caught by {x.seeker}{x.sector ? ` · Sector ${x.sector}` : ''} · {clock(x.at)}</span></span>{x.id === open ? <span className="chip">Playing</span> : null}</button>
      ))}
    </div>
  </>);
}

export function SafetyRules() {
  return (
    <ul className="rules">
      <li>Stay in public areas that are open to visitors.</li>
      <li>Keep out of parking garages and restricted spaces.</li>
      <li>Don&apos;t trespass.</li>
      <li>Walk. Never run into roads or traffic.</li>
      <li>Be respectful of businesses and other visitors.</li>
      <li>If anything feels unsafe, stop playing and tell the host.</li>
    </ul>
  );
}

/* ---------------- text helpers ---------------- */
export function locText(s: LocState, acc: number | null) {
  return s === 'on' ? `Location on${acc ? ` · ±${acc} m` : ''}. Others only ever see an approximate area.`
    : s === 'asking' ? 'Waiting for location…' : s === 'denied' ? 'Location is blocked. Allow it in your browser settings to keep playing.'
    : s === 'unavailable' ? 'No GPS signal right now.' : s === 'unsupported' ? 'This browser has no location support.' : 'Location off';
}
function gpsText(g: string | null, acc: number | null) {
  if (!g) return '';
  return g === 'ok' || g === 'poor' ? `GPS ±${acc ?? '?'} m` : g === 'denied' ? 'Location blocked' : g === 'none' ? 'Waiting for GPS' : 'GPS lost';
}
function bannerBody(e: GameEvent) {
  const t = bannerTitle(e);
  return e.text.startsWith(t) ? e.text.slice(t.length).replace(/^[.:]\s*/, '') || e.text : e.text;
}
function bannerTone(e: GameEvent | null) {
  if (!e) return '';
  if (/catch|sector|zone|signal|violation|vote|emergency/.test(e.type)) return 'seeker';
  if (/photo/.test(e.type)) return 'hider';
  return '';
}
function bannerTitle(e: GameEvent) {
  const m: Record<string, string> = {
    sector_closing: 'Sector closing', sector_relocate: 'Move your group', sector_one_minute: 'One minute', sector_closed: 'Sector closed', sector_voting_open: 'Sector voting is open',
    sector_voting_open_hiders: 'Seekers are voting', sector_voting_closed: 'Voting closed', vote_reminder: 'Cast your vote', zone: 'New search zone', zone_hider: 'Search zone', photo_required: 'Photo hint requested',
    photo_deadline: 'One minute left', photo_30: '30 seconds left', photo_approved: 'Photo approved', photo_rejected: 'Photo rejected', photo_deadline_missed: 'Photo deadline missed',
    photo_review: 'Photo to review', catch_reported_host: 'Catch reported', catch_confirmed: 'Catch confirmed', catch_disputed: 'Catch disputed', catch_rejected: 'Catch rejected', final_two: 'Final two',
    signal_new_location: 'Location clue', signal_expired: 'Clue expired', game_paused: 'Paused', game_resumed: 'Resumed', emergency_pause: 'Emergency pause', seekers_released: 'Seekers released',
    teams_finalized: 'Head start', headstart_minute: 'One minute', gps_unavailable: 'Location unavailable', gps_restored: 'Location back', violation_warning: 'Leave this sector', violation_unenforced: 'Possible violation',
    sector_violation: 'Sector violation', host_changed: 'New host', player_left: 'Player left', vote_tie: 'Tie', vote_none: 'No votes', vote_cast: 'Vote counted',
  };
  return m[e.type] ?? 'manhunt.';
}
export { Seg, Toggle };
