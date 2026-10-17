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
