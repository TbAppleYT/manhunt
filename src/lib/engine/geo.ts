import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import intersect from '@turf/intersect';
import area from '@turf/area';
import kinks from '@turf/kinks';
import { featureCollection, point, polygon } from '@turf/helpers';
import type { LatLon, SectorCollection, SectorFeature } from './types';

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Offset a point by metres east/north (small distances). */
export function offsetM(p: LatLon, east: number, north: number): LatLon {
  return { lat: p.lat + (north / R) * (180 / Math.PI), lon: p.lon + (east / (R * Math.cos(toRad(p.lat)))) * (180 / Math.PI) };
}

export function sectorAt(sectors: SectorCollection, p: LatLon): number | null {
  const pt = point([p.lon, p.lat]);
  for (const f of sectors.features) if (booleanPointInPolygon(pt, f as never)) return f.properties.sector;
  return null;
}

export function sectorCentroid(f: SectorFeature): LatLon {
  const ring = f.geometry.coordinates[0].slice(0, -1);
  const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
  const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  return { lat, lon };
}

/**
 * Cluster players into "together" groups. Two members are linked when their distance is within
 * max(baseM, accA + accB) — so poor GPS accuracy never splits a group that is really together.
 */
export function clusterMembers(members: { id: string; fix: (LatLon & { acc: number }) | null }[], baseM: number): string[][] {
  const withFix = members.filter((m) => m.fix);
  const parent: Record<string, string> = {};
  const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const m of withFix) parent[m.id] = m.id;
  for (let i = 0; i < withFix.length; i++)
    for (let j = i + 1; j < withFix.length; j++) {
      const a = withFix[i], b = withFix[j];
      const lim = Math.max(baseM, Math.min(80, a.fix!.acc + b.fix!.acc));
      if (distanceM(a.fix!, b.fix!) <= lim) parent[find(a.id)] = find(b.id);
    }
  const out: Record<string, string[]> = {};
  for (const m of withFix) (out[find(m.id)] ||= []).push(m.id);
  // Members without a fix are not counted as separated: they stay with the first cluster.
  const clusters = Object.values(out);
  const noFix = members.filter((m) => !m.fix).map((m) => m.id);
  if (clusters.length === 0) return noFix.length ? [noFix] : [];
  clusters[0].push(...noFix);
  return clusters;
}

export function centroid(points: LatLon[]): LatLon {
  return { lat: points.reduce((a, p) => a + p.lat, 0) / points.length, lon: points.reduce((a, p) => a + p.lon, 0) / points.length };
}

/** Approximate a position for display to teammates: snapped to a ~25 m grid. Never the raw fix. */
export function approximate(p: LatLon, gridM = 25): LatLon {
  const dLat = (gridM / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos(toRad(p.lat));
  return { lat: Math.round(p.lat / dLat) * dLat, lon: Math.round(p.lon / dLon) * dLon };
}

export interface SectorIssue { kind: 'overlap' | 'self-intersection' | 'duplicate' | 'invalid'; sectors: number[]; detail: string }

/** Validate a sector configuration (used by the editor and before saving). */
export function validateSectors(fc: SectorCollection): SectorIssue[] {
  const issues: SectorIssue[] = [];
  const seen = new Set<number>();
  for (const f of fc.features) {
    const n = f.properties?.sector;
    if (!Number.isInteger(n) || n < 1 || n > 10) { issues.push({ kind: 'invalid', sectors: [n], detail: 'Sector number must be 1–10' }); continue; }
    if (seen.has(n)) issues.push({ kind: 'duplicate', sectors: [n], detail: `Sector ${n} appears twice` });
    seen.add(n);
    const ring = f.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) { issues.push({ kind: 'invalid', sectors: [n], detail: `Sector ${n} needs at least 3 corners` }); continue; }
    try {
      if (kinks(polygon(f.geometry.coordinates)).features.length) issues.push({ kind: 'self-intersection', sectors: [n], detail: `Sector ${n} crosses itself` });
    } catch { issues.push({ kind: 'invalid', sectors: [n], detail: `Sector ${n} has an invalid shape` }); }
  }
  const fs = fc.features;
  for (let i = 0; i < fs.length; i++)
    for (let j = i + 1; j < fs.length; j++) {
      try {
        const x = intersect(featureCollection([polygon(fs[i].geometry.coordinates), polygon(fs[j].geometry.coordinates)]));
        if (x && area(x) > 4) issues.push({ kind: 'overlap', sectors: [fs[i].properties.sector, fs[j].properties.sector], detail: `Sectors ${fs[i].properties.sector} and ${fs[j].properties.sector} overlap by ${Math.round(area(x))} m²` });
      } catch { /* invalid geometry reported above */ }
    }
  return issues;
}
