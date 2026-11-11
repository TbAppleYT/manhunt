'use client';
import dynamic from 'next/dynamic';
import { useRef, useState, type ReactNode } from 'react';
import { StaticMap, type MapData } from './StaticMap';
import { usePanZoom } from '@/lib/client/usePanZoom';

const MapboxMap = dynamic(() => import('./MapboxMap').then((m) => m.MapboxMap), { ssr: false });
const hasMapbox = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/** Rotation preference. 90 = visitor-guide orientation (west up) — a provisional choice awaiting review. */
function useRotation() {
  const [rot, setRot] = useState<number>(() => { try { return localStorage.getItem('mh.northUp') === '1' ? 0 : 90; } catch { return 90; } });
  const toggle = () => setRot((r) => { const n = r === 90 ? 0 : 90; try { localStorage.setItem('mh.northUp', n === 0 ? '1' : '0'); } catch { /* ignore */ } return n; });
  return [rot, toggle] as const;
}

export function MapView(props: MapData & { now: () => number; layer: 'satellite' | 'illustrated'; onLayer: () => void; onTap?: (ll: { lat: number; lon: number }) => void; onTeammate?: (n: string) => void; children?: ReactNode }) {
  const [rot, toggle] = useRotation();
  const layerBtn = (
    <button className="mapbtn layers" onClick={props.onLayer} aria-label={props.layer === 'satellite' ? 'Show the visitor-guide map' : 'Show the satellite map'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /></svg>
    </button>
  );
  if (props.layer === 'illustrated') return <IllustratedMap controls={layerBtn}>{props.children}</IllustratedMap>;
  const Comp = hasMapbox ? MapboxMap : StaticMap;
  return <Comp {...props} rotation={rot} onToggleRotation={toggle} controls={layerBtn} />;
}

/** The supplied 2023 visitor guide, page 1, as a pan/zoom image. Not georeferenced: no live markers on it. */
export function IllustratedMap({ controls, children }: { controls?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = 2319, H = 1539;
  const pz = usePanZoom(ref, W, H, [40, 40, 1840, 1150], 0);
  return (
    <main className="map" ref={ref} aria-label="Illustrated visitor-guide map" style={{ background: '#e9f3f3' }}>
      <div className="world" style={{ transform: pz.transform, width: W, height: H }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/map/visitor-guide.jpg" alt="Town Center visitor guide map (2023)" draggable={false} style={{ width: W, height: H }} />
      </div>
      {children}
      {controls}
      <div className="attrib" style={{ color: '#234', textShadow: 'none' }}>Visitor guide, 2023. Some businesses may have changed.</div>
    </main>
  );
}
