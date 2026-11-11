'use client';
/* Stylised catch replay. It is a reconstruction drawn from the catch record only (nicknames, general
   sector, time) — no GPS trail exists or is used. Labelled as such on screen. */
import { useEffect, useRef, useState } from 'react';
import { seedFrom } from '@/lib/engine/rng';

type R = { id: string; seeker: string; hider: string; sector: number | null; at: number };
const DUR = 6000;

export function ReplayPlayer({ replay }: { replay: R }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const step = (now: number) => {
      if (last.current != null) setT((x) => { const n = x + (now - last.current!) * speed; if (n >= DUR) { setPlaying(false); return DUR; } return n; });
      last.current = now; raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d')!; x.scale(dpr, dpr);
    // deterministic layout per replay
    let seed = seedFrom(replay.id);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 1000) / 1000; };
    x.fillStyle = '#20241f'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 10;
    for (let i = 0; i < 4; i++) { const y = H * (0.15 + rnd() * 0.7); x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); const xx = W * (0.15 + rnd() * 0.7); x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, H); x.stroke(); }
    x.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 7; i++) x.fillRect(W * rnd(), H * rnd(), W * (0.12 + rnd() * 0.18), H * (0.1 + rnd() * 0.16));
    const meet = { x: W * (0.45 + rnd() * 0.1), y: H * (0.45 + rnd() * 0.1) };
    const hs = { x: W * (0.2 + rnd() * 0.6), y: H * 0.15 }, ss = { x: W * 0.12, y: H * (0.6 + rnd() * 0.3) };
    const k = Math.min(1, t / (DUR * 0.6)), e = 1 - Math.pow(1 - k, 2);
    const hp = { x: hs.x + (meet.x + 10 - hs.x) * e, y: hs.y + (meet.y - hs.y) * e }, sp = { x: ss.x + (meet.x - 10 - ss.x) * e, y: ss.y + (meet.y - ss.y) * e };
    const after = t > DUR * 0.62;
    const dot = (p: { x: number; y: number }, col: string, label: string) => {
      x.beginPath(); x.arc(p.x, p.y, 8, 0, Math.PI * 2); x.fillStyle = col; x.fill(); x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
      x.font = '600 12px Inter, sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(label, p.x, p.y - 15);
    };
    if (t > DUR * 0.6) { const r = 14 + ((t - DUR * 0.6) / (DUR * 0.4)) * 40; x.beginPath(); x.arc(meet.x, meet.y, r, 0, Math.PI * 2); x.strokeStyle = `rgba(255,59,48,${Math.max(0, 1 - (r - 14) / 40)})`; x.lineWidth = 2; x.stroke(); }
    dot(sp, 'rgb(255,59,48)', replay.seeker);
    dot(hp, after ? 'rgb(255,59,48)' : 'rgb(10,132,255)', replay.hider);
    x.textAlign = 'left'; x.font = '500 12px Inter, sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)';
    x.fillText(after ? `Catch confirmed · ${replay.hider} is now a seeker` : replay.sector ? `Sector ${replay.sector}` : 'Town Center', 12, H - 14);
  }, [t, replay]);

  return (
    <div className="stack">
      <div className="replay"><canvas ref={canvas} aria-label={`Stylised replay: ${replay.seeker} catches ${replay.hider}`} /><span className="tag">Stylised reconstruction · not real movement</span></div>
      <input className="range" type="range" min={0} max={DUR} step={50} value={t} aria-label="Timeline" onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} />
      <div className="row">
        <button className="btn sm ghost" onClick={() => { if (t >= DUR) setT(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : t >= DUR ? 'Replay' : 'Play'}</button>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Playback speed" style={{ width: 150 }}>
          {[0.5, 1, 2].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
      </div>
    </div>
  );
}
