import { fromUtm, toUtm } from '../geometry/utm';
import { localizar, type LocP } from './localizar';

/** Posição do usuário sobre o traçado: referencial local (km, distância ao eixo, faixa) e posição manual por km.
 *  Tudo calculado só com a geometria local, sem rede. */

/** Acima desta distância ao eixo a posição é "fora do trecho". */
export const LIMITE_FORA_M = 50;
/** Acima desta precisão a posição não veio de satélite: é localização por rede. */
export const PRECISAO_SEM_SATELITE_M = 500;
/** Passo dos botões da posição manual. */
export const PASSO_MANUAL_M = 20;

export interface Referencia {
  p: LocP;
  /** Linha mais próxima. */
  i: number;
  /** Km numérico interpolado entre as linhas vizinhas. */
  km: number;
  /** Distância ao eixo (m), medida até o segmento mais próximo. */
  dEixo: number;
  /** Faixa (1 a 6), 0 para acostamento, null fora da pista. */
  lane: number | null;
  fora: boolean;
}

/** Projeta a posição sobre a poligonal do eixo: km interpolado, distância perpendicular e faixa. */
export function referenciar(P: LocP[], lat: number, lon: number): Referencia | null {
  const loc = localizar(P, lat, lon);
  if (!loc) return null;
  const p = loc.p, [x, y] = toUtm(p.crs, lat, lon);
  let melhor = { d: loc.dist, km: p.kmNum[loc.i] };
  for (const [a, b] of [[loc.i - 1, loc.i], [loc.i, loc.i + 1]]) {
    if (a < 0 || b >= p.rows.length || p.segOf[a] !== p.segOf[b]) continue;
    const dx = p.x[b] - p.x[a], dy = p.y[b] - p.y[a], c = dx * dx + dy * dy;
    if (!c) continue;
    const t = Math.max(0, Math.min(1, ((x - p.x[a]) * dx + (y - p.y[a]) * dy) / c));
    const d = Math.hypot(x - (p.x[a] + t * dx), y - (p.y[a] + t * dy));
    if (d < melhor.d - 1e-9) melhor = { d, km: p.kmNum[a] + t * (p.kmNum[b] - p.kmNum[a]) };
  }
  return { p, i: loc.i, km: melhor.km, dEixo: melhor.d, lane: loc.lane, fora: melhor.d > LIMITE_FORA_M };
}

/** "km 59+940 · a 3 m do eixo · Fx 2", ou "fora do trecho" além de 50 m. */
export function textoReferencia(r: Referencia, kmTxt: (km: number) => string): string {
  if (r.fora) return `Fora do trecho (a ${Math.round(r.dEixo)} m do eixo)`;
  const faixa = r.lane === null ? '' : r.lane ? ` · Fx ${r.lane}` : ' · Acost.';
  return `km ${kmTxt(r.km)} · a ${Math.round(r.dEixo)} m do eixo${faixa}`;
}

/* ---- posição manual ---- */

export interface Manual { pid: string; km: number; t: number }

/** Ponto do eixo no km indicado, dentro de um trecho contínuo. Fora de qualquer trecho, devolve null. */
export function pontoNoKm(p: LocP, km: number): { lat: number; lon: number; i: number } | null {
  for (const sg of p.segs) {
    if (km < p.kmNum[sg.a] - 1e-9 || km > p.kmNum[sg.b] + 1e-9) continue;
    for (let i = sg.a; i < sg.b; i++) {
      if (km > p.kmNum[i + 1] + 1e-9) continue;
      const k0 = p.kmNum[i], k1 = p.kmNum[i + 1], t = k1 === k0 ? 0 : Math.max(0, Math.min(1, (km - k0) / (k1 - k0)));
      const [lat, lon] = fromUtm(p.crs, p.x[i] + t * (p.x[i + 1] - p.x[i]), p.y[i] + t * (p.y[i + 1] - p.y[i]));
      return { lat, lon, i };
    }
  }
  return null;
}

/** Posição manual a partir de um ponto do mapa (toque): o ponto do eixo mais próximo. */
export function manualDoPonto(P: LocP[], lat: number, lon: number, agora = Date.now()): Manual | null {
  const r = referenciar(P, lat, lon);
  return r ? { pid: r.p.id, km: r.km, t: agora } : null;
}

/** Km mínimo e máximo do trecho contínuo que contém o km. */
function limitesDoTrecho(p: LocP, km: number): [number, number] | null {
  for (const sg of p.segs) if (km >= p.kmNum[sg.a] - 1e-9 && km <= p.kmNum[sg.b] + 1e-9) return [p.kmNum[sg.a], p.kmNum[sg.b]];
  return null;
}

/** Sobe ou desce `passoM` metros no traçado (positivo = km crescente). Para nas pontas do trecho. */
export function moverManual(p: LocP, m: Manual, passoM: number, agora = Date.now()): Manual {
  const lim = limitesDoTrecho(p, m.km);
  if (!lim) return m;
  const km = Math.max(lim[0], Math.min(lim[1], m.km + passoM / 1000));
  return { ...m, km, t: agora };
}

/* ---- origem da posição ---- */

export interface Fix { lat: number; lon: number; acc: number; t: number }
export interface EstadoPos { gps: Fix | null; manual: Manual | null }
export type Origem = 'satelite' | 'rede' | 'manual';

export const origemDoGps = (acc: number): 'satelite' | 'rede' => (acc > PRECISAO_SEM_SATELITE_M ? 'rede' : 'satelite');

/** Uma posição de satélite substitui a manual (com aviso). Posição só por rede não substitui: o usuário a definiu de propósito. */
export function receberGps(s: EstadoPos, fix: Fix): { estado: EstadoPos; substituiuManual: boolean } {
  const satelite = origemDoGps(fix.acc) === 'satelite';
  const substitui = satelite && s.manual !== null;
  return { estado: { gps: fix, manual: substitui ? null : s.manual }, substituiuManual: substitui };
}

export const definirManual = (s: EstadoPos, m: Manual): EstadoPos => ({ ...s, manual: m });

/** A posição que vale agora: a manual, se houver; senão a última do GPS (satélite ou rede). */
export function origemEfetiva(s: EstadoPos): Origem | null {
  if (s.manual) return 'manual';
  return s.gps ? origemDoGps(s.gps.acc) : null;
}

/** "há 12 s" ou "há 3 min". */
export function idade(desde: number, agora: number): string {
  const s = Math.max(0, Math.round((agora - desde) / 1000));
  return s < 90 ? `há ${s} s` : `há ${Math.round(s / 60)} min`;
}
