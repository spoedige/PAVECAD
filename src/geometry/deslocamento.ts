import type { Seg } from '../formats/segments';

/** Deslocamento da planilha inteira, em metros. Positivo: longitudinal no sentido de percurso e
 *  transversal à direita do sentido de percurso (a mesma normal da geometria das faixas). */
export interface Desloc { l: number; t: number }
export const DESLOC_ZERO: Desloc = { l: 0, t: 0 };
export const DESLOC_MAX = 500;

export const deslocZerado = (d: Desloc) => d.l === 0 && d.t === 0;

export function validarDesloc(d: Desloc): string | null {
  for (const [v, nome] of [[d.l, 'longitudinal'], [d.t, 'transversal']] as const)
    if (!Number.isFinite(v) || Math.abs(v) > DESLOC_MAX) return `O deslocamento ${nome} deve ficar entre -${DESLOC_MAX} e ${DESLOC_MAX} m.`;
  return null;
}

/** Translada o eixo `l` metros ao longo da via, no sentido de percurso. A direção vem da janela de
 *  azimute da geometria (±win pontos). Pontos sem vizinho no trecho ficam onde estão. */
export function deslocarLongitudinal(
  x0: Float64Array, y0: Float64Array, segs: Seg[], win: number, travel: 1 | -1, l: number,
): { x: Float64Array; y: Float64Array } {
  const x = Float64Array.from(x0), y = Float64Array.from(y0);
  if (!l) return { x, y };
  for (const sg of segs) {
    for (let k = sg.a; k <= sg.b; k++) {
      const ka = Math.max(sg.a, k - win), kb = Math.min(sg.b, k + win);
      if (ka === kb) continue;
      const dx = x0[kb] - x0[ka], dy = y0[kb] - y0[ka], d = Math.hypot(dx, dy);
      if (!d) continue;
      x[k] = x0[k] + (l * travel * dx) / d;
      y[k] = y0[k] + (l * travel * dy) / d;
    }
  }
  return { x, y };
}

/** Direção média de uma planilha: vetor unitário (leste, norte) do sentido de percurso. */
export interface Quadro { tE: number; tN: number }

/** Azimute médio da planilha, pela soma dos passos entre pontos consecutivos do mesmo trecho. Nulo se não há passo. */
export function quadroMedio(x0: ArrayLike<number>, y0: ArrayLike<number>, segs: Seg[], travel: 1 | -1): Quadro | null {
  let sx = 0, sy = 0;
  for (const sg of segs) {
    for (let k = sg.a; k < sg.b; k++) {
      const dx = x0[k + 1] - x0[k], dy = y0[k + 1] - y0[k], d = Math.hypot(dx, dy);
      if (d > 0.5) { sx += dx / d; sy += dy / d; }
    }
  }
  const m = Math.hypot(sx, sy);
  return m ? { tE: (travel * sx) / m, tN: (travel * sy) / m } : null;
}

const arred = (v: number) => Math.round(v * 1000) / 1000;

/** Converte um deslocamento (longitudinal e transversal de uma planilha) no mesmo vetor sobre o mapa, expresso em relação ao
 *  sentido de outra planilha. Transversal positivo é à direita do sentido de percurso: n = (tN, -tE). */
export function converterDesloc(d: Desloc, de: Quadro, para: Quadro): Desloc {
  const E = d.l * de.tE + d.t * de.tN, N = d.l * de.tN - d.t * de.tE;
  return { l: arred(E * para.tE + N * para.tN), t: arred(E * para.tN - N * para.tE) };
}
