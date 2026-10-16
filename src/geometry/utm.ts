/** Projeção UTM transversa de Mercator no elipsoide GRS80 (SIRGAS 2000), série de Krüger.
 *  Precisão submilimétrica dentro do fuso. Hemisfério sul com falso norte de 10.000.000 m. */

const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const E0 = 500000;
const N0S = 10000000;

const n = F / (2 - F);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const AA = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const alpha = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
  (61 * n3) / 240 - (103 * n4) / 140,
  (49561 * n4) / 161280,
];
const beta = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440,
  (17 * n3) / 480 - (37 * n4) / 840,
  (4397 * n4) / 161280,
];
const delta = [
  2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45,
  (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45,
  (56 * n3) / 15 - (136 * n4) / 35,
  (4279 * n4) / 630,
];
const RAD = Math.PI / 180;

export interface Crs {
  /** Código EPSG do SIRGAS 2000 / UTM sul (31978 a 31985 para os fusos 18S a 25S), ou null fora deles. */
  epsg: number | null;
  zone: number;
  /** Meridiano central (graus). */
  lon0: number;
  hemisphere: 'S';
}

export function zoneOf(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

export function crsForZone(zone: number): Crs {
  return { epsg: zone >= 18 && zone <= 25 ? 31960 + zone : null, zone, lon0: zone * 6 - 183, hemisphere: 'S' };
}

export function toUtm(crs: Crs, lat: number, lon: number): [number, number] {
  const phi = lat * RAD;
  const lam = (lon - crs.lon0) * RAD;
  const q = (2 * Math.sqrt(n)) / (1 + n);
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - q * Math.atanh(q * s));
  const xi0 = Math.atan2(t, Math.cos(lam));
  const eta0 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi0, eta = eta0;
  for (let j = 1; j <= 4; j++) {
    xi += alpha[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += alpha[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return [E0 + K0 * AA * eta, N0S + K0 * AA * xi];
}

export function fromUtm(crs: Crs, x: number, y: number): [number, number] {
  const xi = (y - N0S) / (K0 * AA);
  const eta = (x - E0) / (K0 * AA);
  let xi0 = xi, eta0 = eta;
  for (let j = 1; j <= 4; j++) {
    xi0 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta0 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return [phi / RAD, crs.lon0 + lam / RAD]; // [lat, lon]
}
