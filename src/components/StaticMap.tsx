'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SectorCollection, SectorStatus, Landmark } from '@/lib/engine/types';
import { SAT, TC_BOX, metresToPx, toLatLon, toPx } from '@/lib/client/projection';
import { usePanZoom } from '@/lib/client/usePanZoom';
import { fmt } from '@/lib/client/format';

export interface MapData {
  sectors: SectorCollection;
  sectorState: Record<string, SectorStatus>;
  closing: { sector: number; closesAt: number } | null;
  me: { lat: number; lon: number; acc: number | null } | null;
  teammates: { id: string; nickname: string; lat: number; lon: number; team: 'hider' | 'seeker' }[];
  zones: { id: string; label: string; circles: { lat: number; lon: number; r: number }[]; nextAt: number | null }[];
  clues: { id: string; label: string; lat: number; lon: number; radiusM: number; until: number }[];
  landmarks?: Landmark[];
  simPins?: { id: string; label: string; lat: number; lon: number; role: string; selected: boolean }[];
  onSimPin?: (id: string) => void;
}

export function StaticMap(props: MapData & {
  now: () => number; rotation: number; onToggleRotation: () => void; onTap?: (ll: { lat: number; lon: number }) => void;
  onTeammate?: (name: string) => void; controls?: ReactNode; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(ref, SAT.w, SAT.h, TC_BOX, props.rotation);
  const [, tick] = useState(0);
  const needsTick = !!props.closing || props.zones.length > 0 || props.clues.length > 0;
  useEffect(() => { if (!needsTick) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [needsTick]);

  const now = props.now();
  const s = pz.v.s;
  const pin = (lat: number, lon: number, dy = 0) => { const p = toPx(lat, lon); const [x, y] = pz.project(p.x, p.y); return { left: x, top: y + dy }; };
  const lat0 = props.sectors.features[0]?.geometry.coordinates[0][0][1] ?? 36.84;

  const click = (e: React.MouseEvent) => {
    if (!props.onTap || !pz.wasTap() || (e.target as HTMLElement).closest('button,.glow,[data-nopan]')) return;
    const r = ref.current!.getBoundingClientRect();
    const [x, y] = pz.unproject(e.clientX - r.left, e.clientY - r.top);
    props.onTap(toLatLon(x, y));
  };

  return (
    <main className="map" ref={ref} onClick={click} aria-label="Satellite map of Town Center" data-testid="map">
      <div className="world" style={{ transform: pz.transform }}>
        {/* Satellite imagery is never filtered or tinted — identical in light and dark mode. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SAT.src} alt="" draggable={false} />
        <svg viewBox={`0 0 ${SAT.w} ${SAT.h}`}>
          <defs>
            <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="9" height="9" fill="rgba(12,12,14,.42)" /><line x1="0" y1="0" x2="0" y2="9" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
            </pattern>
          </defs>
          {props.sectors.features.map((f) => {
            const st = props.sectorState[f.properties.sector];
            const pts = f.geometry.coordinates[0].map(([lon, lat]) => { const p = toPx(lat, lon); return `${p.x},${p.y}`; }).join(' ');
            return <polygon key={f.properties.sector} points={pts} className={'sec' + (st === 'closed' ? ' closed' : '') + (st === 'closing' ? ' closing' : '')} />;
          })}
          {props.zones.flatMap((z) => z.circles.map((c, i) => { const p = toPx(c.lat, c.lon); return <circle key={z.id + i} className="zone" cx={p.x} cy={p.y} r={metresToPx(c.r, c.lat)} />; }))}
          {props.clues.map((c) => { const p = toPx(c.lat, c.lon); return <circle key={c.id} className="zone" style={{ strokeDasharray: '6 5', fillOpacity: 0.7 }} cx={p.x} cy={p.y} r={metresToPx(c.radiusM, c.lat)} />; })}
        </svg>
      </div>
      <div className="pins">
        {props.sectors.features.map((f) => {
          const n = f.properties.sector, st = props.sectorState[n];
          const ring = f.geometry.coordinates[0].slice(0, -1);
          const c = { lat: ring.reduce((a, p) => a + p[1], 0) / ring.length, lon: ring.reduce((a, p) => a + p[0], 0) / ring.length };
          const closing = st === 'closing' && props.closing?.sector === n;
          return (
            <div key={n} className="pin" style={pin(c.lat, c.lon)}>
              <div className={'slabel' + (st === 'closed' ? ' closed' : '') + (st === 'closing' ? ' closing' : '')} data-sector={n}>
                {n}{st === 'closed' && <span>· Closed</span>}{closing && <span className="tnum">· {fmt(props.closing!.closesAt - now)}</span>}
              </div>
            </div>
          );
        })}
        {props.landmarks?.map((l) => (
          <div key={l.id} className="pin" style={pin(l.lat, l.lon, 18)}><div className={'lm' + (l.verified ? '' : ' unv')} title={l.verified ? '' : 'Unverified'}>{l.name}</div></div>
        ))}
        {props.zones.map((z) => {
          const c = z.circles[0]; const p = pin(c.lat, c.lon);
          return <div key={z.id} className="pin" style={{ left: p.left, top: p.top - metresToPx(c.r, c.lat) * s - 16 }}><div className="zlabel">{z.label}{z.nextAt ? ` · ${fmt(z.nextAt - now)}` : ''}</div></div>;
        })}
        {props.clues.map((c) => { const p = pin(c.lat, c.lon); return <div key={c.id} className="pin" style={{ left: p.left, top: p.top - metresToPx(c.radiusM, c.lat) * s - 16 }}><div className="zlabel" style={{ background: 'rgba(10,10,12,.6)' }}>{c.label} · {fmt(c.until - now)}</div></div>; })}
        {props.teammates.map((t) => (
          <button key={t.id} className={'pin glow team-' + t.team} style={pin(t.lat, t.lon)} aria-label={`${t.nickname}, approximate area`} onClick={() => props.onTeammate?.(t.nickname)} />
        ))}
        {props.simPins?.map((b) => (
          <button key={b.id} className="pin" data-nopan style={pin(b.lat, b.lon)} onClick={(e) => { e.stopPropagation(); props.onSimPin?.(b.id); }} aria-label={`Select ${b.label}`}>
            <span className="slabel" style={{ background: b.role === 'seeker' ? 'rgb(255,59,48)' : 'rgb(10,132,255)', boxShadow: b.selected ? '0 0 0 3px #fff' : undefined, minWidth: 22, height: 22, fontSize: 11 }}>{b.label}</span>
          </button>
        ))}
        {props.me && (() => {
          const d = Math.max(30, 2 * metresToPx(props.me.acc ?? 8, props.me.lat) * s);
          return (<>
            <div className="pin" style={pin(props.me.lat, props.me.lon)}><div className="halo" style={{ width: d, height: d }} /></div>
            <div className="pin" style={pin(props.me.lat, props.me.lon)} data-testid="me"><div className="me" /></div>
          </>);
        })()}
      </div>
      {props.children}
      <button className="mapbtn" id="compass" onClick={props.onToggleRotation} aria-label={props.rotation === 90 ? 'Switch to north up' : 'Switch to visitor-guide orientation'}>
        <svg viewBox="0 0 24 24"><g style={{ transform: `rotate(${pz.v.rot}deg)`, transformOrigin: '12px 12px' }}><path d="M12 3.5 15 12H9z" fill="rgb(255,59,48)" /><path d="M12 20.5 9 12h6z" fill="currentColor" opacity=".35" /></g></svg>
      </button>
      {props.me && (
        <button className="mapbtn" id="recenter" onClick={() => { const p = toPx(props.me!.lat, props.me!.lon); pz.recenter(p.x, p.y); }} aria-label="Center on my location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M20.5 3.5 3.5 10.7l7.1 2 2 7.1z" /></svg>
        </button>
      )}
      {props.controls}
      <div className="attrib">Imagery © Esri, Maxar{lat0 ? '' : ''}</div>
    </main>
  );
}
