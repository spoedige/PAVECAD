/** Medidas sobre coordenadas [lon, lat]. */
export const M_LAT = 111132;

export function distM(a: number[], b: number[]): number {
  const R = 6371000, t = Math.PI / 180;
  const dl = (b[1] - a[1]) * t, dg = (b[0] - a[0]) * t;
  const s = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const lenM = (c: number[][]) => c.reduce((s, p, i) => (i ? s + distM(c[i - 1], p) : 0), 0);

export function areaM2(c: number[][]): number {
  if (c.length < 3) return 0;
  const lat0 = (c[0][1] * Math.PI) / 180, mx = 111320 * Math.cos(lat0), my = M_LAT;
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    s += a[0] * mx * (b[1] * my) - b[0] * mx * (a[1] * my);
  }
  return Math.abs(s) / 2;
}

export const fmtLen = (m: number) => (m >= 1000 ? (m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km' : Math.round(m) + ' m');
