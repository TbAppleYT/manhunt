/* Web-Mercator georeference for the bundled satellite image (public/map/town-center-satellite.jpg).
   The image is a crop of an Esri World Imagery export: full export extent 3857 x[-8475776.973, -8474641.515]
   y[4416715.949, 4417552.602] at 1900×1400 px; the crop starts at pixel (380, 300) and is 1220×760. */
const XMIN_FULL = -8475776.973407215, YMAX_FULL = 4417552.602456298;
const RES = (-8474641.514601124 - XMIN_FULL) / 1900; // ≈0.5976 m/px (mercator metres)
const R = 6378137;

export const SAT = { src: '/map/town-center-satellite.jpg', w: 1220, h: 760, xmin: XMIN_FULL + 380 * RES, ymax: YMAX_FULL - 300 * RES, res: RES };

export function toPx(lat: number, lon: number) {
  const x = (lon * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  return { x: (x - SAT.xmin) / SAT.res, y: (SAT.ymax - y) / SAT.res };
}
export function toLatLon(px: number, py: number) {
  const x = SAT.xmin + px * SAT.res, y = SAT.ymax - py * SAT.res;
  return { lon: (x / R) * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI };
}
/** Ground metres → image px at a latitude (mercator scale factor 1/cos φ). */
export const metresToPx = (m: number, lat: number) => m / (SAT.res * Math.cos(lat * Math.PI / 180));

/** Town Center extent in image px — the provisional sector bounding box — used to fit the view. */
export const TC_BOX: [number, number, number, number] = [80, 78, 1135, 675];
