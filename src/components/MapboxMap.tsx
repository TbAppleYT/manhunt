'use client';
/* Live Mapbox satellite map, used when NEXT_PUBLIC_MAPBOX_TOKEN is set. Same data and controls as
   StaticMap. Style is satellite-v9 (pure imagery, no theme-dependent labels), so the imagery looks the
   same in light and dark mode. Bearing 270 = visitor-guide orientation (west up); 0 = north up. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MapData } from './StaticMap';
import { fmt } from '@/lib/client/format';
import 'mapbox-gl/dist/mapbox-gl.css';

type MB = typeof import('mapbox-gl').default;
type MapT = import('mapbox-gl').Map;

function circle(lat: number, lon: number, r: number, n = 48) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([lon + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 110540]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [pts] } };
}

export function MapboxMap(props: MapData & { now: () => number; rotation: number; onToggleRotation: () => void; onTap?: (ll: { lat: number; lon: number }) => void; onTeammate?: (n: string) => void; controls?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<MapT | null>(null);
  const lib = useRef<MB | null>(null);
  const markers = useRef<import('mapbox-gl').Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [, tick] = useState(0);
  const tapRef = useRef(props.onTap); tapRef.current = props.onTap;

  useEffect(() => {
    let dead = false;
    import('mapbox-gl').then(({ default: mapboxgl }) => {
      if (dead || !ref.current) return;
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
      lib.current = mapboxgl;
      const ring = props.sectors.features.flatMap((f) => f.geometry.coordinates[0]);
      const b: [[number, number], [number, number]] = [[Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))], [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]];
      const m = new mapboxgl.Map({ container: ref.current, style: 'mapbox://styles/mapbox/satellite-v9', bounds: b, fitBoundsOptions: { padding: 16, bearing: props.rotation === 90 ? 270 : 0 }, bearing: props.rotation === 90 ? 270 : 0, attributionControl: true, pitchWithRotate: false, dragRotate: false });
      m.touchZoomRotate.disableRotation();
      m.on('load', () => {
        m.addSource('sectors', { type: 'geojson', data: props.sectors as never });
        m.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'sec-fill', type: 'fill', source: 'sectors', paint: { 'fill-color': ['case', ['==', ['get', 'status'], 'closed'], 'rgba(12,12,14,0.42)', 'rgba(0,0,0,0)'] } });
        m.addLayer({ id: 'sec-line', type: 'line', source: 'sectors', paint: { 'line-color': ['case', ['==', ['get', 'status'], 'closing'], 'rgb(255,59,48)', 'rgba(255,255,255,0.82)'], 'line-width': ['case', ['==', ['get', 'status'], 'closing'], 2.2, 1.5], 'line-dasharray': ['case', ['==', ['get', 'status'], 'closing'], ['literal', [3, 2]], ['literal', [1, 0]]] } });
        m.addLayer({ id: 'zone-fill', type: 'fill', source: 'zones', paint: { 'fill-color': 'rgba(255,59,48,0.13)' } });
        m.addLayer({ id: 'zone-line', type: 'line', source: 'zones', paint: { 'line-color': 'rgb(255,59,48)', 'line-width': 2 } });
        setReady(true);
      });
      m.on('click', (e) => tapRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
      map.current = m;
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.easeTo({ bearing: props.rotation === 90 ? 270 : 0, duration: 400 }); }, [props.rotation]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // Sync data → map sources and HTML markers.
  useEffect(() => {
    const m = map.current, L = lib.current;
    if (!ready || !m || !L) return;
    (m.getSource('sectors') as import('mapbox-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: props.sectors.features.map((f) => ({ ...f, properties: { ...f.properties, status: props.sectorState[f.properties.sector] } })) } as never);
    const circles = [...props.zones.flatMap((z) => z.circles.map((c) => circle(c.lat, c.lon, c.r))), ...props.clues.map((c) => circle(c.lat, c.lon, c.radiusM))];
    (m.getSource('zones') as import('mapbox-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: circles } as never);
    markers.current.forEach((k) => k.remove()); markers.current = [];
    const add = (el: HTMLElement, lat: number, lon: number) => markers.current.push(new L.Marker({ element: el }).setLngLat([lon, lat]).addTo(m));
    const now = props.now();
    for (const f of props.sectors.features) {
      const n = f.properties.sector, st = props.sectorState[n];
      const ring = f.geometry.coordinates[0].slice(0, -1);
      const el = document.createElement('div');
      el.className = 'slabel' + (st === 'closed' ? ' closed' : '') + (st === 'closing' ? ' closing' : '');
      el.textContent = `${n}${st === 'closed' ? ' · Closed' : ''}${st === 'closing' && props.closing ? ' · ' + fmt(props.closing.closesAt - now) : ''}`;
      add(el, ring.reduce((a, p) => a + p[1], 0) / ring.length, ring.reduce((a, p) => a + p[0], 0) / ring.length);
    }
    for (const t of props.teammates) { const el = document.createElement('button'); el.className = 'glow team-' + t.team; el.setAttribute('aria-label', `${t.nickname}, approximate area`); el.onclick = () => props.onTeammate?.(t.nickname); add(el, t.lat, t.lon); }
    for (const z of props.zones) { const el = document.createElement('div'); el.className = 'zlabel'; el.textContent = z.label; add(el, z.circles[0].lat, z.circles[0].lon); }
    if (props.me) { const el = document.createElement('div'); el.className = 'me'; add(el, props.me.lat, props.me.lon); }
  });

  return (
    <main className="map" aria-label="Satellite map of Town Center" data-testid="map">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {props.children}
      <button className="mapbtn" id="compass" onClick={props.onToggleRotation} aria-label="Rotate map">
        <svg viewBox="0 0 24 24"><g style={{ transform: `rotate(${props.rotation}deg)`, transformOrigin: '12px 12px' }}><path d="M12 3.5 15 12H9z" fill="rgb(255,59,48)" /><path d="M12 20.5 9 12h6z" fill="currentColor" opacity=".35" /></g></svg>
      </button>
      {props.me && <button className="mapbtn" id="recenter" onClick={() => map.current?.easeTo({ center: [props.me!.lon, props.me!.lat], zoom: Math.max(map.current.getZoom(), 17.5) })} aria-label="Center on my location"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M20.5 3.5 3.5 10.7l7.1 2 2 7.1z" /></svg></button>}
      {props.controls}
    </main>
  );
}
