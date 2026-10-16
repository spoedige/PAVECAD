/** Trecho contínuo de linhas (índices inclusivos). */
export interface Seg {
  a: number;
  b: number;
}

/** Diferença máxima entre hodômetros consecutivos para continuar o mesmo trecho (km). */
export const GAP_KM = 0.0215;

/** Quebra em trechos quando o salto entre hodômetros passa de 21,5 m. Nunca liga pontos entre trechos. */
export function segmentsOf(hod: ArrayLike<number>): Seg[] {
  const segs: Seg[] = [];
  let a = 0;
  for (let i = 1; i <= hod.length; i++) {
    if (i === hod.length || hod[i] - hod[i - 1] > GAP_KM) {
      segs.push({ a, b: i - 1 });
      a = i;
    }
  }
  return segs;
}
