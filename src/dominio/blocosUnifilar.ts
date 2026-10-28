/** Agrupamento do unifilar: uma linha de blocos por sentido. Planilhas do mesmo sentido cujo km não se sobrepõe dividem o mesmo bloco,
 *  na ordem do km; o vazio entre duas delas é uma lacuna (planilha que falta, como um trecho homogêneo sem arquivo). */
export interface ComKm { kmNum: number[]; meta: { travel: number } }
export interface Lacuna { de: number; ate: number }
export interface GrupoBloco<T extends ComKm> { ps: T[]; sentido: 1 | -1; lacunas: Lacuna[] }

/** Passo entre linhas (km). */
const PASSO = 0.02;
/** Vazio mínimo (km) para contar como lacuna: abaixo disso é só arredondamento de marco. */
export const LACUNA_MIN = 0.05;

export const fimDe = (p: ComKm) => p.kmNum[p.kmNum.length - 1] + PASSO;

export function agruparBlocos<T extends ComKm>(G: T[]): GrupoBloco<T>[] {
  const out: GrupoBloco<T>[] = [];
  for (const sentido of [1, -1] as const) {
    const faixas: { ps: T[]; fim: number }[] = [];
    const doSentido = G.filter((q) => (q.meta.travel > 0 ? 1 : -1) === sentido).sort((a, b) => a.kmNum[0] - b.kmNum[0]);
    for (const p of doSentido) {
      // o ponto final de uma planilha repete o km de partida da seguinte: uma linha de folga não é sobreposição
      const f = faixas.find((x) => p.kmNum[0] >= x.fim - PASSO - 1e-6);
      if (f) { f.ps.push(p); f.fim = fimDe(p); } else faixas.push({ ps: [p], fim: fimDe(p) });
    }
    for (const f of faixas) {
      const lacunas: Lacuna[] = [];
      for (let i = 1; i < f.ps.length; i++) {
        const ant = f.ps[i - 1], de = ant.kmNum[ant.kmNum.length - 1], ate = f.ps[i].kmNum[0];
        if (ate - de > LACUNA_MIN) lacunas.push({ de, ate });
      }
      out.push({ ps: f.ps, sentido, lacunas });
    }
  }
  return out;
}
