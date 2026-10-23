import { edgesOf, type GeoOptions } from '../geometry/build';
import type { Project } from '../geometry/project';
import { toUtm } from '../geometry/utm';

export interface LocP extends Project {
  id: string;
  opts: GeoOptions;
  normals: ({ e: number; n: number } | null)[];
  visible: boolean;
}

export interface Local {
  p: LocP;
  i: number;
  /** Faixa (1 a 6), 0 para acostamento, null fora da pista. */
  lane: number | null;
  /** Distância lateral até a borda da pista, quando fora. */
  out: number;
  /** Deslocamento lateral em relação à coordenada, em metros. */
  e: number;
  /** Distância ao ponto da planilha mais próximo, em metros. */
  dist: number;
}

/** Projeta uma posição na normal local do ponto mais próximo para achar planilha, km e faixa. */
export function localizar(P: LocP[], lat: number, lon: number): Local | null {
  let best: (Local & { score: number }) | null = null;
  for (const p of P) {
    if (!p.visible) continue;
    const [x, y] = toUtm(p.crs, lat, lon);
    let bi = -1, bd = 1e18;
    for (let i = 0; i < p.rows.length; i++) {
      if (!p.normals[i]) continue;
      const dx = x - p.x[i], dy = y - p.y[i], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) continue;
    const n = p.normals[bi]!, e = (x - p.x[bi]) * n.e + (y - p.y[bi]) * n.n;
    const ed = edgesOf(p.rows[bi], p.opts);
    let lane: number | null = null, out = 0;
    for (let k = 0; k < ed.e.length - 1; k++) {
      const a = Math.min(ed.e[k], ed.e[k + 1]), b = Math.max(ed.e[k], ed.e[k + 1]);
      if (e >= a && e <= b) { lane = k < ed.nLanes ? k + 1 : 0; break; }
    }
    if (lane === null) {
      const lo = Math.min(...ed.e), hi = Math.max(...ed.e);
      out = e < lo ? lo - e : e - hi;
    }
    const score = out + Math.sqrt(bd) * 0.001;
    if (!best || score < best.score) best = { p, i: bi, lane, out, e, dist: Math.sqrt(bd), score };
  }
  return best;
}
