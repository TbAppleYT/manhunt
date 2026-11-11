'use client';
/* Pan / pinch / wheel / double-tap zoom with rotation, ported from the approved Phase 1 prototype.
   World coordinates are image pixels; screen = T + R(θ)·(s·p). */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface PZ { s: number; rot: number; tx: number; ty: number }
type Box = [number, number, number, number];

export function usePanZoom(ref: RefObject<HTMLElement | null>, imgW: number, imgH: number, box: Box, rotation: number) {
  const v = useRef<PZ>({ s: 1, rot: rotation, tx: 0, ty: 0 });
  const lim = useRef({ min: 0.2, max: 4 });
  const [, force] = useState(0);
  const raf = useRef(0);
  const anim = useRef(0);
  const redraw = useCallback(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => force((n) => n + 1)); }, []);
  const size = () => ({ W: ref.current?.clientWidth || 1, H: ref.current?.clientHeight || 1 });
  const rad = () => (v.current.rot * Math.PI) / 180;

  const project = useCallback((x: number, y: number): [number, number] => {
    const c = Math.cos(rad()), s = Math.sin(rad()), X = v.current.s * x, Y = v.current.s * y;
    return [v.current.tx + c * X - s * Y, v.current.ty + s * X + c * Y];
  }, []);
  const unproject = useCallback((X: number, Y: number): [number, number] => {
    const c = Math.cos(rad()), s = Math.sin(rad()), dx = X - v.current.tx, dy = Y - v.current.ty;
    return [(c * dx + s * dy) / v.current.s, (-s * dx + c * dy) / v.current.s];
  }, []);
  const centerOn = (px: number, py: number) => {
    const { W, H } = size(), c = Math.cos(rad()), s = Math.sin(rad());
    v.current.tx = W / 2 - (c * v.current.s * px - s * v.current.s * py);
    v.current.ty = H / 2 - (s * v.current.s * px + c * v.current.s * py);
  };
  const fitScale = (rot: number) => {
    const { W, H } = size(), bw = box[2] - box[0], bh = box[3] - box[1], r = (rot * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    const fit = Math.min((W - 24) / (bw * c + bh * s), (H - 24) / (bw * s + bh * c));
    return Math.max(fit, W / (rot % 180 ? imgH : imgW)); // imagery always spans the full map width
  };
  const clamp = () => {
    const { W, H } = size(); const [cx, cy] = unproject(W / 2, H / 2);
    const nx = Math.min(Math.max(cx, 0), imgW), ny = Math.min(Math.max(cy, 0), imgH);
    if (nx !== cx || ny !== cy) centerOn(nx, ny);
  };
  const fit = useCallback(() => {
    v.current.rot = rotation;
    v.current.s = fitScale(rotation);
    const f = Math.min(fitScale(0), fitScale(90));
    lim.current = { min: f * 0.7, max: f * 7 };
    centerOn((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, imgW, imgH, box[0], box[1], box[2], box[3]]);

  const zoomAt = (X: number, Y: number, f: number) => {
    const [px, py] = unproject(X, Y);
    v.current.s = Math.min(lim.current.max, Math.max(lim.current.min, v.current.s * f));
    const c = Math.cos(rad()), s = Math.sin(rad());
    v.current.tx = X - (c * v.current.s * px - s * v.current.s * py);
    v.current.ty = Y - (s * v.current.s * px + c * v.current.s * py);
    clamp(); redraw();
  };
  const flyTo = useCallback((px: number, py: number, s: number, rot: number, ms = 420) => {
    cancelAnimationFrame(anim.current);
    const { W, H } = size(); const [sx, sy] = unproject(W / 2, H / 2);
    const s0 = v.current.s, r0 = v.current.rot, t0 = performance.now();
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (now: number) => {
      let k = reduce ? 1 : Math.min(1, (now - t0) / ms); k = 1 - Math.pow(1 - k, 3);
      v.current.s = s0 + (s - s0) * k; v.current.rot = r0 + (rot - r0) * k;
      centerOn(sx + (px - sx) * k, sy + (py - sy) * k); force((n) => n + 1);
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotation changes animate around the current centre.
  const firstRot = useRef(true);
  useEffect(() => {
    if (firstRot.current) { firstRot.current = false; return; }
    const { W, H } = size(); const [cx, cy] = unproject(W / 2, H / 2);
    flyTo(cx, cy, v.current.s * fitScale(rotation) / fitScale(v.current.rot), rotation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => fit()); ro.observe(el);
    const ptrs = new Map<number, [number, number]>();
    let last: { mid: [number, number]; dist: number; n: number } | null = null;
    let moved = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button,[data-nopan]')) return;
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = null; moved = 0; cancelAnimationFrame(anim.current);
    };
    const move = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const r = el.getBoundingClientRect();
      const pts = [...ptrs.values()].map((p) => [p[0] - r.left, p[1] - r.top] as [number, number]);
      const mid: [number, number] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      const dist = pts.length > 1 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0;
      if (last && last.n === pts.length) {
        moved += Math.abs(mid[0] - last.mid[0]) + Math.abs(mid[1] - last.mid[1]);
        v.current.tx += mid[0] - last.mid[0]; v.current.ty += mid[1] - last.mid[1];
        if (pts.length > 1 && last.dist) zoomAt(mid[0], mid[1], dist / last.dist); else { clamp(); redraw(); }
      }
      last = { mid, dist, n: pts.length };
    };
    const up = (e: PointerEvent) => { ptrs.delete(e.pointerId); last = null; (el as HTMLElement & { _moved?: number })._moved = moved; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0018)); };
    const dbl = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('button')) return; const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.7); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('dblclick', dbl);
    return () => { ro.disconnect(); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); el.removeEventListener('dblclick', dbl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  /** True if the last pointer gesture was a tap rather than a drag (for click-to-move). */
  const wasTap = () => ((ref.current as HTMLElement & { _moved?: number })?._moved ?? 0) < 6;
  const recenter = (px: number, py: number) => flyTo(px, py, Math.max(v.current.s, fitScale(v.current.rot) * 2.2), v.current.rot);

  return { v: v.current, project, unproject, recenter, fit, wasTap, transform: `translate(${v.current.tx}px,${v.current.ty}px) rotate(${v.current.rot}deg) scale(${v.current.s})` };
}
