import type { Row } from '../formats/types';
import { edgesOf, type GeoOptions } from './build';
import type { Project } from './project';
import { fromUtm } from './utm';

/** O que é preciso do projeto para achar o eixo de uma faixa. */
export type ProjetoEixo = Pick<Project, 'rows' | 'x' | 'y' | 'crs' | 'segOf'> & {
  opts: GeoOptions;
  normals: ({ e: number; n: number } | null)[];
};

export interface PontoEixo {
  lat: number;
  lon: number;
  /** SIRGAS 2000 UTM (fuso do projeto), em metros. */
  e: number;
  n: number;
}

/** Deslocamento lateral do eixo da faixa em relação à coordenada da planilha. A faixa 0 é o acostamento. */
function deslocamentoDoEixo(row: Row, lane: number, o: GeoOptions): number {
  const { e } = edgesOf(row, o);
  const k = lane === 0 ? row.widths.length : lane - 1;
  const a = e[k], b = e[k + 1] ?? e[k];
  return (a + b) / 2;
}

const pt = (p: ProjetoEixo, x: number, y: number): PontoEixo => {
  const [lat, lon] = fromUtm(p.crs, x, y);
  return { lat, lon, e: x, n: y };
};

/** Eixo de referência da faixa: a linha no meio da faixa. Devolve o início do primeiro segmento (linha `r0`)
 *  e o fim do último (início da linha seguinte; no fim do trecho, 20 m adiante na direção do traçado). */
export function eixoDaFaixa(p: ProjetoEixo, lane: number, r0: number, r1: number): { ini: PontoEixo; fim: PontoEixo } | null {
  const na = (i: number): [number, number] | null => {
    const n = p.normals[i];
    if (!n) return null;
    const off = deslocamentoDoEixo(p.rows[i], lane, p.opts);
    return [p.x[i] + off * n.e, p.y[i] + off * n.n];
  };
  const a = na(r0);
  if (!a) return null;
  let b: [number, number] | null = null;
  const mesmoTrecho = r1 + 1 < p.rows.length && p.segOf[r1 + 1] === p.segOf[r1];
  if (mesmoTrecho) b = na(r1 + 1);
  if (!b) {
    // fim do trecho: estende 20 m pela direção do traçado (da linha anterior para esta)
    const base = na(r1);
    const i0 = r1 > 0 && p.segOf[r1 - 1] === p.segOf[r1] ? r1 - 1 : -1;
    if (!base) return null;
    if (i0 < 0) b = base;
    else {
      const dx = p.x[r1] - p.x[i0], dy = p.y[r1] - p.y[i0], d = Math.hypot(dx, dy) || 1;
      b = [base[0] + (dx / d) * 20, base[1] + (dy / d) * 20];
    }
  }
  return { ini: pt(p, a[0], a[1]), fim: pt(p, b[0], b[1]) };
}
