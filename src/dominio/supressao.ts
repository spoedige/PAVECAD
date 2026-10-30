/** Supressão de longos trechos sem intervenção no mapa. Funções puras, sem DOM. */
import type { RowModel } from './modelo';

export interface OpcoesSupressao {
  /** Trecho sem intervenção mais longo que isto (km) é suprimido. */
  minKm: number;
  /** Une as faixas paralelas: um trecho só sai quando TODAS as faixas e o acostamento estão sem intervenção ali. */
  unir: boolean;
}
export const SUPRESSAO_PADRAO: OpcoesSupressao = { minKm: 1, unir: false };

/** Passo (km) de uma linha da planilha, usado para contar o comprimento de uma sequência. */
const PASSO_KM = 0.02;

/** Chave de uma faixa de uma linha, a mesma das feições do mapa: faixa 1..n, 0 = acostamento. */
export const chaveSup = (linha: number, faixa: number) => linha * 8 + faixa;

/** Quais (linha, faixa) saem do mapa. `hod` é o km corrido de cada linha; `temAcost[i]` diz se a linha tem acostamento.
 *  Sequências são de linhas consecutivas; uma quebra de km maior que um passo e meio encerra a sequência. */
export function trechosSuprimidos(modelo: RowModel[], hod: number[], temAcost: boolean[], o: OpcoesSupressao): Set<number> {
  const out = new Set<number>();
  const n = modelo.length;
  if (!n || o.minKm <= 0) return out;
  const livre = (i: number, f: number) => (f === 0 ? !temAcost[i] || modelo[i].sh.main === '-' : modelo[i].tr[f - 1] === undefined || modelo[i].tr[f - 1].main === '-');
  const faixasDe = (i: number) => [0, ...modelo[i].tr.map((_, k) => k + 1)];
  const fechar = (a: number, b: number, faixas?: number[]) => {
    if (hod[b] - hod[a] + PASSO_KM <= o.minKm) return;
    for (let i = a; i <= b; i++) for (const f of faixas ?? faixasDe(i)) out.add(chaveSup(i, f));
  };
  if (o.unir) {
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && faixasDe(i).every((f) => livre(i, f)) && (a < 0 || hod[i] - hod[i - 1] < PASSO_KM * 1.5);
      if (ok) { if (a < 0) a = i; continue; }
      if (a >= 0) { fechar(a, i - 1); a = -1; }
      if (i < n && faixasDe(i).every((f) => livre(i, f))) a = i;
    }
    return out;
  }
  const maxF = Math.max(...modelo.map((m) => m.tr.length));
  for (let f = 0; f <= maxF; f++) {
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && livre(i, f) && (a < 0 || hod[i] - hod[i - 1] < PASSO_KM * 1.5);
      if (ok) { if (a < 0) a = i; continue; }
      if (a >= 0) { fechar(a, i - 1, [f]); a = -1; }
      if (i < n && livre(i, f)) a = i;
    }
  }
  return out;
}
