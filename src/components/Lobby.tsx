'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PlayerView } from '@/lib/engine/view';
import type { Command } from '@/lib/engine/engine';
import type { GameConfig, Role } from '@/lib/engine/types';
import { SECTOR_GRID } from '@/lib/engine/config';
import { audio } from '@/lib/client/audio';
import { Seg, Sheet, initial } from './ui';
import { SafetyRules } from './Play';
import { modeName } from './HostPanel';

type Tab = 'players' | 'teams' | 'settings';

export function Lobby({ view: v, send, onLeft }: { view: PlayerView; send: (c: Command) => Promise<unknown>; onLeft: () => void }) {
  const you = v.you, g = v.game, host = you.isHost;
  const [tab, setTab] = useState<Tab>('players');
  const [msg, setMsg] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'perm' | 'player' | 'leave'>(null);
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [perm, setPerm] = useState({ location: 'unknown' as string, notify: 'unknown' as string, sound: false, rules: false });
  const run = async (c: Command) => { setMsg(null); try { await send(c); return true; } catch (e) { setMsg((e as Error).message); return false; } };

  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((r) => { setPerm((p) => ({ ...p, location: r.state })); r.onchange = () => setPerm((p) => ({ ...p, location: r.state })); }).catch(() => {});
    if ('Notification' in window) setPerm((p) => ({ ...p, notify: Notification.permission }));
    try { if (localStorage.getItem('mh.rules') === '1') setPerm((p) => ({ ...p, rules: true })); } catch { /* ignore */ }
  }, []);

  const players = v.players.filter((p) => !p.left);
  const myGroup = v.groups.find((x) => x.id === you.groupId) ?? null;
  const sim = g.simulation;
  const locOk = sim || perm.location === 'granted';
  const canReady = locOk && perm.rules;

  return (
    <div className="app" data-testid="lobby">
      <div className="scroll"><div className="page">
        <div className="navrow"><span className="wordmark">manhunt.</span><span className="pill">{sim ? 'Simulation' : 'Lobby'}</span></div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Game code</span>
          <button className="codebig" style={{ textAlign: 'left' }} data-testid="game-code" onClick={() => navigator.clipboard?.writeText(g.code).then(() => setMsg('Code copied'), () => {})}>{g.code}</button>
          <span className="small">{sim ? 'Open /sim in another tab and join with this code to add more test players.' : 'Friends join at the home screen with this code.'}</span>
        </div>

        <div className="tabs" role="tablist">
          {(['players', 'teams', ...(host ? ['settings'] : [])] as Tab[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={'tab-' + k}>{k === 'players' ? `Players · ${players.length}` : k === 'teams' ? 'Teams' : 'Settings'}</button>
          ))}
        </div>

        {tab === 'players' && (<>
          <div className="list" style={{ marginBottom: 0 }}>
            {players.map((p) => (
              <button key={p.id} className="li" onClick={() => { if (host) { setSelPlayer(p.id); setSheet('player'); } }} disabled={!host} data-testid={'player-' + p.nickname}>
                <span className={'av' + (p.role === 'seeker' ? ' s' : '')}>{initial(p.nickname)}</span>
                <span className="tx"><span className="t1">{p.id === you.id ? `${p.nickname} (you)` : p.nickname}</span><span className="t2">{[p.isHost && 'Host', p.isBot && 'Bot', !p.online && 'Offline'].filter(Boolean).join(' · ') || (p.ready ? 'Ready' : 'Not ready')}</span></span>
                <span className={'pill ' + (p.role === 'unassigned' ? '' : p.role)}>{p.role === 'unassigned' ? 'No role' : p.role === 'hider' ? 'Hider' : 'Seeker'}</span>
                {p.ready && <span className="pill ok" aria-label="Ready">✓</span>}
              </button>
            ))}
          </div>
          {host && <RandomRoles count={players.length} run={run} />}
        </>)}

        {tab === 'teams' && (<>
          <div className="notice">You are a <b>{you.role === 'unassigned' ? 'player without a role yet' : you.role}</b>.{you.role === 'unassigned' ? ' The host assigns roles.' : you.role === 'seeker' ? ' Seekers don\'t join groups.' : ' Hiders play in groups of two or more. Every member confirms.'}</div>
          {you.role === 'hider' && (myGroup ? (
            <div className="stack">
              <div className="row"><b style={{ fontSize: 17 }}>{myGroup.name}</b><span className="spacer" /><button className="link" onClick={() => run({ type: 'leaveGroup' })}>Leave</button></div>
              <div className="list" style={{ marginBottom: 0 }}>
                {myGroup.members.map((id) => { const m = players.find((p) => p.id === id); return m && (
                  <div className="li" key={id}><span className="av">{initial(m.nickname)}</span><span className="tx"><span className="t1">{id === you.id ? 'You' : m.nickname}</span></span><span className={'pill ' + (myGroup.confirmed[id] ? 'ok' : 'warn')}>{myGroup.confirmed[id] ? 'Confirmed' : 'Not confirmed'}</span></div>
                ); })}
              </div>
              {!myGroup.confirmed[you.id] && <button className="btn blue" onClick={() => run({ type: 'confirmGroup' })} data-testid="confirm-group">Confirm I&apos;m in {myGroup.name}</button>}
              {myGroup.members.length < 2 && <p className="small">Waiting for at least one more hider to join. Solo hiders can&apos;t play.</p>}
              {g.config.mode === 'groupSelected' && (<>
                <div className="cap" style={{ marginTop: 8 }}>YOUR GROUP&apos;S SECTOR</div>
                <SectorPicker value={myGroup.chosenSector} onPick={(n) => run({ type: 'chooseGroupSector', sector: n })} />
              </>)}
            </div>
          ) : <GroupPicker view={v} run={run} />)}
          {v.groups.length > 0 && (<>
            <div className="cap">ALL GROUPS</div>
            <div className="list">{v.groups.map((gr) => (
              <div className="li" key={gr.id}><span className="tx"><span className="t1">{gr.name}</span><span className="t2">{gr.members.map((m) => players.find((p) => p.id === m)?.nickname).filter(Boolean).join(', ')}</span></span><span className="acc">{gr.members.filter((m) => gr.confirmed[m]).length}/{gr.members.length}</span></div>
            ))}</div>
          </>)}
        </>)}

        {tab === 'settings' && host && <HostSettings view={v} run={run} />}

        {msg && <p className="err" role="status">{msg}</p>}

        <div className="spacer" />
        <div className="stack">
          {!canReady && <button className="btn ghost" onClick={() => setSheet('perm')} data-testid="open-permissions">Before you play: location, sound, safety</button>}
          {!host && (you.ready
            ? <button className="btn ghost" onClick={() => run({ type: 'setReady', ready: false })} data-testid="unready">Ready ✓ · tap to undo</button>
            : <button className="btn" disabled={!canReady} onClick={() => run({ type: 'setReady', ready: true })} data-testid="ready">I&apos;m ready</button>)}
          {host && (<>
            {g.startProblems.length > 0 && <div className="notice" data-testid="start-problems">{g.startProblems.slice(0, 4).map((p) => <div key={p}>{p}</div>)}</div>}
            <button className="btn red" disabled={g.startProblems.length > 0 || !canReady} onClick={() => run({ type: 'startGame' })} data-testid="start">Start head start</button>
          </>)}
          <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => setSheet('leave')}>Leave lobby</button>
        </div>
      </div></div>

      <Sheet open={sheet === 'perm'} title="Before you play" onClose={() => setSheet(null)}>
        <div className="list">
          <div className="li"><span className="tx"><span className="t1">Location</span><span className="t2">Needed to play. Shared from when you tap Ready until the game ends. Other players only ever see an approximate area, and no location history is kept.</span></span>
            {sim ? <span className="pill">Not needed</span> : perm.location === 'granted' ? <span className="pill ok">Allowed</span> : <button className="btn sm blue" data-testid="allow-location" onClick={() => navigator.geolocation.getCurrentPosition(() => setPerm((p) => ({ ...p, location: 'granted' })), (e) => setPerm((p) => ({ ...p, location: e.code === 1 ? 'denied' : p.location })), { enableHighAccuracy: true, timeout: 15000 })}>Allow</button>}
          </div>
          {perm.location === 'denied' && <div className="li"><span className="t2" style={{ color: 'var(--seeker)' }}>Location is blocked for this site. Turn it on in your browser&apos;s site settings, then come back.</span></div>}
          <div className="li"><span className="tx"><span className="t1">Sound</span><span className="t2">Spoken announcements for votes, closures and catches.</span></span>
            {perm.sound ? <span className="pill ok">On</span> : <button className="btn sm ghost" onClick={() => { audio().play(['welcome']); setPerm((p) => ({ ...p, sound: true })); }}>Test</button>}
          </div>
          <div className="li"><span className="tx"><span className="t1">Notifications</span><span className="t2">Optional. Alerts when the app is in the background.</span></span>
            {perm.notify === 'granted' ? <span className="pill ok">On</span> : perm.notify === 'unknown' ? <span className="pill">Unsupported</span> : <button className="btn sm ghost" onClick={async () => { const r = await Notification.requestPermission(); setPerm((p) => ({ ...p, notify: r })); if (r === 'granted') subscribePush(send); }}>Allow</button>}
          </div>
          <div className="li"><span className="tx"><span className="t1">Camera</span><span className="t2">Asked only when you take a photo hint. Never opens on its own.</span></span></div>
        </div>
        <div className="cap">SAFETY RULES</div>
        <SafetyRules />
        <button className="btn" onClick={() => { try { localStorage.setItem('mh.rules', '1'); } catch { /* ignore */ } setPerm((p) => ({ ...p, rules: true })); setSheet(null); }} data-testid="accept-rules">I&apos;ll follow these rules</button>
      </Sheet>

      <Sheet open={sheet === 'player'} title={players.find((p) => p.id === selPlayer)?.nickname ?? 'Player'} onClose={() => setSheet(null)}>
        {selPlayer && (() => { const p = players.find((x) => x.id === selPlayer)!; if (!p) return null; return (<>
          <div className="cap">ROLE</div>
          <Seg label="Role" value={p.role} options={[['hider', 'Hider'], ['seeker', 'Seeker'], ['unassigned', 'None']] as [Role, string][]} onChange={(r) => run({ type: 'assignRole', playerId: p.id, role: r })} />
          <div style={{ height: 16 }} />
          <div className="stack">
            {p.id !== you.id && !p.isBot && <button className="btn ghost" onClick={() => run({ type: 'makeHost', playerId: p.id }).then(() => setSheet(null))}>Make {p.nickname} host</button>}
            {p.id !== you.id && <button className="btn ghost" style={{ color: 'var(--seeker)' }} onClick={() => run({ type: 'kick', playerId: p.id }).then(() => setSheet(null))}>Remove from lobby</button>}
          </div>
        </>); })()}
      </Sheet>

      <Sheet open={sheet === 'leave'} title="Leave lobby?" onClose={() => setSheet(null)}>
        <p className="sub">You can rejoin with the code while the game is still in the lobby.</p>
        <button className="btn red" onClick={async () => { if (await run({ type: 'leave' })) onLeft(); }}>Leave</button>
      </Sheet>
    </div>
  );
}

function RandomRoles({ count, run }: { count: number; run: (c: Command) => Promise<boolean> }) {
  const [n, setN] = useState(Math.max(1, Math.round(count / 4)));
  return (
    <div className="row">
      <span className="small">Random roles with</span>
      <input className="numin" type="number" min={1} max={Math.max(1, count - 2)} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Number of seekers" />
      <span className="small">seeker{n === 1 ? '' : 's'}</span><span className="spacer" />
      <button className="btn sm ghost" onClick={() => run({ type: 'randomizeRoles', seekers: n })} data-testid="randomize">Shuffle</button>
    </div>
  );
}

function GroupPicker({ view: v, run }: { view: PlayerView; run: (c: Command) => Promise<boolean> }) {
  const [name, setName] = useState('');
  return (
    <div className="stack">
      <div className="field"><label htmlFor="gname">New group</label>
        <div className="row"><input id="gname" className="input" placeholder={`Group ${String.fromCharCode(65 + v.groups.length)}`} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn sm blue" style={{ height: 50 }} onClick={() => run({ type: 'createGroup', name })} data-testid="create-group">Create</button></div>
      </div>
      {v.groups.length > 0 && <div className="cap">OR JOIN</div>}
      {v.groups.map((gr) => <button key={gr.id} className="btn ghost" onClick={() => run({ type: 'joinGroup', groupId: gr.id })} data-testid={'join-' + gr.name}>Join {gr.name}</button>)}
    </div>
  );
}

function SectorPicker({ value, onPick }: { value: number | null; onPick: (n: number) => void }) {
  return <div className="grid">{SECTOR_GRID.map((row) => row.map((n) => <button key={n} className={'cell' + (row.length === 2 ? ' w' : '')} aria-pressed={value === n} onClick={() => onPick(n)}>{n}</button>))}</div>;
}

function HostSettings({ view: v, run }: { view: PlayerView; run: (c: Command) => Promise<boolean> }) {
  const c = v.game.config;
  const set = (patch: Partial<GameConfig>) => run({ type: 'updateConfig', patch });
  const num = (k: keyof GameConfig, label: string, unit: 'min' | 's' | 'm', hint?: string) => {
    const raw = c[k] as number, shown = unit === 'min' ? raw / 60 : raw;
    return (
      <div className="li"><span className="tx"><span className="t1">{label}</span>{hint && <span className="t2">{hint}</span>}</span>
        <input className="numin" type="number" step={unit === 'min' ? 0.5 : 1} defaultValue={shown} aria-label={label} onBlur={(e) => set({ [k]: unit === 'min' ? Number(e.target.value) * 60 : Number(e.target.value) } as Partial<GameConfig>)} />
        <span className="small" style={{ width: 26 }}>{unit}</span>
      </div>
    );
  };
  return (<>
    <div className="cap">GAME MODE</div>
    <div className="list">
      <div className="li"><span className="tx"><span className="t1">Mode</span><span className="t2">{c.mode === 'multi' ? 'Sectors close one by one after seeker votes.' : 'Sector voting is off in this mode.'}</span></span>
        <select className="select" value={c.mode} onChange={(e) => set({ mode: e.target.value as GameConfig['mode'] })} aria-label="Game mode" data-testid="mode">
          {(['multi', 'shared', 'groupSelected', 'oneOpen'] as const).map((m) => <option key={m} value={m}>{modeName(m)}</option>)}
        </select>
      </div>
    </div>
    {c.mode === 'shared' && (<><div className="cap">SHARED SECTOR</div><SectorPicker value={c.sharedSector} onPick={(n) => set({ sharedSector: n })} /></>)}
    {c.mode === 'oneOpen' && (<><div className="cap">THE OPEN SECTOR</div><SectorPicker value={c.openSector} onPick={(n) => set({ openSector: n })} /></>)}
    {c.mode === 'groupSelected' && <p className="small" style={{ marginBottom: 12 }}>Each hider group picks its sector on the Teams tab.</p>}
    <div className="cap">TIMERS</div>
    <div className="list">
      {num('headStartSec', 'Head start', 'min')}
      {c.mode === 'multi' && num('voteEverySec', 'Sector vote every', 'min')}
      {c.mode === 'multi' && num('voteDurationSec', 'Voting lasts', 'min')}
      {num('closeGraceSec', 'Warning before a sector closes', 'min')}
      {num('zoneEverySec', 'Search zone every', 'min')}
      {num('zoneDurationSec', 'Search zone shrinks over', 's')}
      {num('zoneMinRadiusM', 'Smallest search zone radius', 'm', 'Stays approximate')}
      {num('photoEverySec', 'Photo hint every', 'min')}
      {num('photoWindowSec', 'Time to send a photo', 'min')}
      {num('clueDurationSec', 'Location clue lasts', 's')}
    </div>
    <div className="cap">SEEKER START POINT</div>
    <input className="input" maxLength={80} placeholder="e.g. by the fountain" defaultValue={c.seekerStartNote} onBlur={(e) => set({ seekerStartNote: e.target.value })} aria-label="Where seekers wait during the head start" />
    <div className="cap" style={{ marginTop: 16 }}>SECTORS</div>
    <div className="notice warn" style={{ marginBottom: 10 }}>
      <b>{c.sectorsVerified ? 'Sectors marked verified.' : 'Sector lines are provisional.'}</b> {c.sectorsVerified ? 'Automatic consequences for being in a closed sector are on.' : 'They were traced from satellite imagery and your annotated map, and need checking on-site. Until then, the app only warns players and the host — it does not apply automatic consequences.'}
    </div>
    <Link className="btn ghost" style={{ display: 'grid', placeItems: 'center' }} href={`/editor?game=${v.game.id}`}>Open sector editor</Link>
    <div className="cap" style={{ marginTop: 16 }}>ANNOUNCEMENTS</div>
    <div className="row"><button className="btn sm ghost" onClick={() => run({ type: 'lobbyStep', step: 'teams' })}>Ask everyone to pick teams</button><button className="btn sm ghost" onClick={() => run({ type: 'lobbyStep', step: 'confirm' })}>Ask everyone to confirm</button></div>
  </>);
}

async function subscribePush(send: (c: Command) => Promise<unknown>) {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (ch) => ch.charCodeAt(0)) });
    const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await send({ type: 'savePush', subscription: { endpoint: j.endpoint, keys: j.keys } });
  } catch { /* push not available; in-app alerts still work */ }
}
export { subscribePush };
