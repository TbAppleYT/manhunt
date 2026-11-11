'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, saveSession } from '@/lib/client/api';
import { center } from '@/lib/client/sectorsClient';
import { Icon, Seg } from '@/components/ui';

export default function SimPage() {
  const router = useRouter();
  const [hiders, setHiders] = useState(6);
  const [seekers, setSeekers] = useState(1);
  const [size, setSize] = useState(2);
  const [speed, setSpeed] = useState(10);
  const [role, setRole] = useState<'seeker' | 'hider'>('seeker');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await api.create('Developer', true);
      const sess = { ...s, sim: true }; saveSession(sess);
      const c = (cmd: Parameters<typeof api.command>[1]) => api.command(sess, cmd, 0);
      await c({ type: 'assignRole', playerId: s.playerId, role });
      await c({ type: 'simAddBots', hiders: role === 'hider' ? Math.max(1, hiders - 1) : hiders, seekers: role === 'seeker' ? Math.max(0, seekers - 1) : seekers, groupSize: size });
      await c({ type: 'simSetSpeed', speed });
      const p = center(7);
      await c({ type: 'simMovePlayer', playerId: s.playerId, lat: p.lat, lon: p.lon });
      if (role === 'hider') {
        // put the developer into the first bot group so the game can start
        const v = (await api.view(sess, 0)).view;
        const g = v.groups[0];
        if (g) { await c({ type: 'joinGroup', groupId: g.id }); await c({ type: 'confirmGroup' }); }
      }
      router.push(`/g/${s.gameId}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const n = (v: number, set: (x: number) => void, min: number, max: number, label: string) => (
    <div className="li"><span className="tx"><span className="t1">{label}</span></span><input className="numin" type="number" min={min} max={max} value={v} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))} aria-label={label} /></div>
  );
  return (
    <div className="app"><div className="scroll"><div className="page">
      <div className="navrow"><Link className="back" href="/">{Icon.back}Back</Link><span className="pill">Developer</span></div>
      <h1 className="h1">Simulator</h1>
      <p className="lead">Play a full game at Town Center from anywhere. Bots walk, vote, answer catches and send placeholder photos. Simulation games are isolated: real players can&apos;t join them and simulated locations are refused in real games.</p>
      <div className="list" style={{ marginBottom: 0 }}>
        <div className="li"><span className="tx"><span className="t1">You play as</span></span><div style={{ width: 170 }}><Seg value={role} options={[['seeker', 'Seeker'], ['hider', 'Hider']]} onChange={setRole} label="Your role" /></div></div>
        {n(hiders, setHiders, 2, 20, 'Hiders (incl. you if hider)')}
        {n(seekers, setSeekers, 1, 10, 'Seekers (incl. you if seeker)')}
        {n(size, setSize, 2, 8, 'Hider group size')}
        <div className="li"><span className="tx"><span className="t1">Speed</span></span><div style={{ width: 190 }}><Seg value={speed} options={[[1, '1×'], [5, '5×'], [10, '10×'], [30, '30×']]} onChange={setSpeed} label="Speed" /></div></div>
      </div>
      <p className="small">Test with several windows: start here, then open <b>/join?sim=1</b> in another tab and enter the code. Each tab is a separate player.</p>
      {err && <p className="err">{err}</p>}
      <div className="spacer" />
      <button className="btn" onClick={start} disabled={busy} data-testid="sim-start">{busy ? 'Setting up…' : 'Create simulation'}</button>
      <Link className="btn ghost" style={{ display: 'grid', placeItems: 'center' }} href="/join?sim=1">Join a simulation in this tab</Link>
    </div></div></div>
  );
}
