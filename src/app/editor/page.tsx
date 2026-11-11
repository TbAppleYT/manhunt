'use client';
/* Sector editor: drag corners on the satellite image, validate overlaps, import/export GeoJSON, edit
   landmarks, and save to a game you host (in its lobby). Saved sectors stay "provisional" until the
   host ticks "verified on-site" — only then does the game apply automatic consequences. */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PROVISIONAL_SECTORS, provisionalLandmarks } from '@/lib/engine/config';
import { validateSectors } from '@/lib/engine/geo';
import type { Landmark, SectorCollection } from '@/lib/engine/types';
import { SAT, TC_BOX, toLatLon, toPx } from '@/lib/client/projection';
import { usePanZoom } from '@/lib/client/usePanZoom';
import { api, loadSession } from '@/lib/client/api';
import { Icon, Seg } from '@/components/ui';

export default function EditorPage() { return <Suspense><Editor /></Suspense>; }

const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

function Editor() {
  const params = useSearchParams();
  const gameId = params.get('game');
  const session = gameId ? loadSession(gameId) : null;
  const [fc, setFc] = useState<SectorCollection>(() => structuredClone(PROVISIONAL_SECTORS));
  const [lms, setLms] = useState<Landmark[]>(() => provisionalLandmarks());
  const [verified, setVerified] = useState(false);
  const [sel, setSel] = useState<number>(7);
  const [corner, setCorner] = useState<number | null>(null);
  const [linked, setLinked] = useState(true);
  const [tab, setTab] = useState<'sectors' | 'landmarks'>('sectors');
  const [msg, setMsg] = useState<string | null>(null);
  const [rot, setRot] = useState(90);
  const ref = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(ref, SAT.w, SAT.h, TC_BOX, rot);
  const issues = useMemo(() => validateSectors(fc), [fc]);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) return;
    api.view(session, 0).then(({ view }) => { setFc(view.game.sectors); setLms(view.game.landmarks); setVerified(view.game.config.sectorsVerified); }).catch(() => setMsg('Could not load the game’s sectors. Showing the provisional set.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const feature = fc.features.find((f) => f.properties.sector === sel);
  const ring = feature?.geometry.coordinates[0] ?? [];

  const drag = (e: React.PointerEvent, onMove: (lat: number, lon: number) => void) => {
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const r = ref.current!.getBoundingClientRect();
    const mv = (ev: PointerEvent) => { const [x, y] = pz.unproject(ev.clientX - r.left, ev.clientY - r.top); const ll = toLatLon(x, y); onMove(ll.lat, ll.lon); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const moveCorner = (i: number, lat: number, lon: number) => setFc((old) => {
    const next = structuredClone(old);
    const f = next.features.find((x) => x.properties.sector === sel)!;
    const r = f.geometry.coordinates[0];
    const prev = [...r[i]];
    const n = r.length - 1;
    const setAt = (rr: number[][], j: number) => { rr[j] = [lon, lat]; if (j === 0) rr[rr.length - 1] = [lon, lat]; if (j === rr.length - 1) rr[0] = [lon, lat]; };
    setAt(r, i % n);
    if (linked) for (const o of next.features) { if (o === f) continue; const rr = o.geometry.coordinates[0]; rr.forEach((pt, j) => { if (same(pt, prev)) setAt(rr, j); }); }
    return next;
  });
  const addCorner = () => setFc((old) => {
    const next = structuredClone(old); const r = next.features.find((x) => x.properties.sector === sel)!.geometry.coordinates[0];
    let best = 0, len = -1;
    for (let i = 0; i < r.length - 1; i++) { const d = Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); if (d > len) { len = d; best = i; } }
    r.splice(best + 1, 0, [(r[best][0] + r[best + 1][0]) / 2, (r[best][1] + r[best + 1][1]) / 2]);
    return next;
  });
  const removeCorner = () => { if (corner == null) return; setFc((old) => { const next = structuredClone(old); const r = next.features.find((x) => x.properties.sector === sel)!.geometry.coordinates[0]; if (r.length <= 4) return old; r.splice(corner, 1); if (corner === 0) r[r.length - 1] = [...r[0]]; return next; }); setCorner(null); };

  const exportJson = () => {
    const out = { ...fc, properties: { verified, note: verified ? 'Verified on-site by host' : 'Provisional — not verified on-site' }, landmarks: lms };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/geo+json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'manhunt-sectors.geojson'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (j?.type !== 'FeatureCollection' || !Array.isArray(j.features)) throw new Error('Not a GeoJSON FeatureCollection');
      const feats = j.features.filter((x: { geometry?: { type?: string }; properties?: { sector?: number } }) => x.geometry?.type === 'Polygon' && Number.isInteger(x.properties?.sector));
      setFc({ type: 'FeatureCollection', features: feats });
      if (Array.isArray(j.landmarks)) setLms(j.landmarks);
      setMsg(`Imported ${feats.length} sectors.`);
    } catch (e) { setMsg('Import failed: ' + (e as Error).message); }
  };
  const save = async () => {
    if (!session) return;
    try { await api.command(session, { type: 'setSectors', sectors: fc, landmarks: lms, verified }, 0); setMsg(verified ? 'Saved. Automatic sector enforcement is on for this game.' : 'Saved as provisional.'); }
    catch (e) { setMsg((e as Error).message); }
  };

  const P = (lat: number, lon: number) => { const p = toPx(lat, lon); const [x, y] = pz.project(p.x, p.y); return { left: x, top: y }; };
  const bad = new Set(issues.flatMap((i) => i.sectors));

  return (
    <div className="app wide" data-testid="editor" style={{ flexDirection: 'column' }}>
      <header className="top" style={{ gap: 10 }}>
        <div className="row1"><Link className="back" href={gameId ? `/g/${gameId}` : '/'}>{Icon.back}Back</Link><span className={'pill ' + (verified ? 'ok' : 'warn')}>{verified ? 'Verified on-site' : 'Provisional'}</span></div>
        <div className="tabs" role="tablist"><button role="tab" aria-selected={tab === 'sectors'} onClick={() => setTab('sectors')}>Sectors</button><button role="tab" aria-selected={tab === 'landmarks'} onClick={() => setTab('landmarks')}>Landmarks</button></div>
      </header>
      <main className="map" ref={ref} aria-label="Sector editor map">
        <div className="world" style={{ transform: pz.transform }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SAT.src} alt="" draggable={false} />
          <svg viewBox={`0 0 ${SAT.w} ${SAT.h}`} style={{ pointerEvents: 'auto' }}>
            {fc.features.map((f) => (
              <polygon key={f.properties.sector} onClick={() => { setSel(f.properties.sector); setCorner(null); }}
                points={f.geometry.coordinates[0].map(([lon, lat]) => { const p = toPx(lat, lon); return `${p.x},${p.y}`; }).join(' ')}
                style={{ fill: f.properties.sector === sel ? 'rgba(10,132,255,.18)' : 'rgba(0,0,0,0)', stroke: bad.has(f.properties.sector) ? 'rgb(255,59,48)' : f.properties.sector === sel ? 'rgb(10,132,255)' : 'rgba(255,255,255,.82)', strokeWidth: f.properties.sector === sel ? 2.5 : 1.5, vectorEffect: 'non-scaling-stroke', cursor: 'pointer' }} />
            ))}
          </svg>
        </div>
        <div className="pins">
          {fc.features.map((f) => { const r = f.geometry.coordinates[0].slice(0, -1); const c = P(r.reduce((a, p) => a + p[1], 0) / r.length, r.reduce((a, p) => a + p[0], 0) / r.length); return <div key={f.properties.sector} className="pin" style={c}><div className="slabel">{f.properties.sector}</div></div>; })}
          {tab === 'sectors' && ring.slice(0, -1).map(([lon, lat], i) => (
            <div key={i} className={'editor-handle' + (corner === i ? ' sel' : '')} style={P(lat, lon)} data-nopan role="button" aria-label={`Drag sector ${sel} corner ${i + 1}`} tabIndex={0}
              onPointerDown={(e) => { setCorner(i); drag(e, (la, lo) => moveCorner(i, la, lo)); }} />
          ))}
          {tab === 'landmarks' && lms.map((l) => (
            <div key={l.id} className="pin" style={{ ...P(l.lat, l.lon), pointerEvents: 'auto', cursor: 'grab' }} data-nopan
              onPointerDown={(e) => drag(e, (la, lo) => setLms((x) => x.map((m) => (m.id === l.id ? { ...m, lat: la, lon: lo } : m))))}>
              <div className={'lm' + (l.verified ? '' : ' unv')}>{l.name}</div>
            </div>
          ))}
        </div>
        <button className="mapbtn" id="compass" onClick={() => setRot((r) => (r === 90 ? 0 : 90))} aria-label="Rotate map">
          <svg viewBox="0 0 24 24"><g style={{ transform: `rotate(${pz.v.rot}deg)`, transformOrigin: '12px 12px' }}><path d="M12 3.5 15 12H9z" fill="rgb(255,59,48)" /><path d="M12 20.5 9 12h6z" fill="currentColor" opacity=".35" /></g></svg>
        </button>
        <div className="attrib">Imagery © Esri, Maxar</div>
      </main>
      <footer className="bottom" style={{ maxHeight: '42%', overflow: 'auto', gap: 10 }}>
        {tab === 'sectors' ? (<>
          <div className="row"><b>Sector {sel}</b><span className="small">{ring.length - 1} corners</span><span className="spacer" />
            <button className="chipbtn" onClick={addCorner}>Add corner</button><button className="chipbtn" disabled={corner == null} onClick={removeCorner}>Remove corner</button></div>
          <div className="row"><label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Move shared corners together</label></div>
          {issues.length ? <div className="notice warn" role="status">{issues.map((i) => <div key={i.detail}>{i.detail}</div>)}</div> : <div className="small" style={{ color: 'var(--ok)' }}>No overlaps or invalid shapes.</div>}
        </>) : (
          <div className="list" style={{ marginBottom: 0 }}>{lms.map((l) => (
            <div className="li" key={l.id}><span className="tx"><span className="t1">{l.name}</span><span className="t2">Sector {l.sector} · drag on the map to place</span></span>
              <div style={{ width: 150 }}><Seg value={l.verified ? 'y' : 'n'} options={[['n', 'Unverified'], ['y', 'Verified']]} onChange={(x) => setLms((a) => a.map((m) => (m.id === l.id ? { ...m, verified: x === 'y' } : m)))} label={`${l.name} verified`} /></div>
            </div>
          ))}</div>
        )}
        <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="verified" />I walked these boundaries on-site and they are correct</label>
        {msg && <p className="small" role="status">{msg}</p>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={exportJson}>Export GeoJSON</button>
          <button className="btn sm ghost" onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept=".json,.geojson,application/geo+json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button className="btn sm ghost" onClick={() => { setFc(structuredClone(PROVISIONAL_SECTORS)); setLms(provisionalLandmarks()); setVerified(false); }}>Reset</button>
          <span className="spacer" />
          {session ? <button className="btn sm" disabled={issues.length > 0} onClick={save} data-testid="save-sectors">Save to game</button> : <span className="small">Open from a lobby you host to save.</span>}
        </div>
      </footer>
    </div>
  );
}
