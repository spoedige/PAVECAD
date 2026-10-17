import type { Row } from '../formats/types';

/** Ajuste de largura sobre o valor da planilha.
 *  Hierarquia: planilha, depois ajuste por faixa de toda a planilha (sem km), depois ajuste por
 *  intervalo de km (o último da lista vence em sobreposição). O intervalo é [km0, km1):
 *  "do km 120 ao 135" vale para os segmentos de 120+000 a 134+980. */
export interface AjusteLargura {
  id: string;
  /** Nome da planilha: é o vínculo que sobrevive ao recarregar. */
  pname: string;
  /** 1 a 6 para faixas, 0 para o acostamento externo. */
  lane: number;
  km0: number | null;
  km1: number | null;
  largura: number;
}

export const LARGURA_FAIXA = { min: 0.5, max: 12 };
export const LARGURA_ACOSTAMENTO = { min: 0, max: 6 };

const br = (v: number) => String(v).replace('.', ',');

export function validarAjuste(a: Pick<AjusteLargura, 'lane' | 'km0' | 'km1' | 'largura'>, maxLanes: number): string | null {
  if (!Number.isInteger(a.lane) || a.lane < 0 || a.lane > maxLanes) return 'Faixa inexistente nesta planilha.';
  const lim = a.lane === 0 ? LARGURA_ACOSTAMENTO : LARGURA_FAIXA;
  if (!Number.isFinite(a.largura) || a.largura < lim.min || a.largura > lim.max)
    return `A largura ${a.lane === 0 ? 'do acostamento' : 'da faixa'} deve ficar entre ${br(lim.min)} e ${br(lim.max)} m.`;
  if ((a.km0 === null) !== (a.km1 === null)) return 'Informe o km inicial e o final, ou deixe os dois vazios.';
  if (a.km0 !== null && a.km1 !== null && !(a.km1 > a.km0)) return 'O km final deve ser maior que o inicial.';
  return null;
}

const EPS = 1e-6;
const noIntervalo = (a: AjusteLargura, km: number) => a.km0 === null || a.km1 === null || (km >= a.km0 - EPS && km < a.km1 - EPS);

/** Aplica os ajustes às linhas da planilha. Linhas sem alteração são reaproveitadas (mesma referência). */
export function aplicarLarguras(rows: Row[], kmNum: ArrayLike<number>, ajustes: AjusteLargura[]): Row[] {
  if (!ajustes.length) return rows;
  const geral = ajustes.filter((a) => a.km0 === null);
  const faixa = ajustes.filter((a) => a.km0 !== null);
  const ordem = [...geral, ...faixa];
  return rows.map((r, i) => {
    let widths: number[] | null = null, shoulder = r.shoulder;
    for (const a of ordem) {
      if (!noIntervalo(a, kmNum[i])) continue;
      if (a.lane === 0) { if (r.shoulder > 0 || a.largura > 0) shoulder = a.largura; }
      else if (a.lane <= r.widths.length) { widths ??= [...r.widths]; widths[a.lane - 1] = a.largura; }
    }
    return widths || shoulder !== r.shoulder ? { ...r, widths: widths ?? r.widths, shoulder } : r;
  });
}

/** Quantas linhas diferem da planilha. */
export const contarAlteradas = (plan: Row[], atual: Row[]) =>
  atual.reduce((n, r, i) => n + (r !== plan[i] && (r.shoulder !== plan[i].shoulder || r.widths.some((w, k) => w !== plan[i].widths[k])) ? 1 : 0), 0);

/** Largura mais frequente de cada faixa (e do acostamento) na planilha. */
export function larguraPadrao(rows: Row[]): { lane: number; largura: number }[] {
  const maxL = rows.reduce((m, r) => Math.max(m, r.widths.length), 0);
  const moda = (vals: number[]) => {
    const c = new Map<number, number>();
    for (const v of vals) c.set(v, (c.get(v) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  };
  const out = Array.from({ length: maxL }, (_, k) => ({ lane: k + 1, largura: moda(rows.map((r) => r.widths[k]).filter((v) => v !== undefined)) }));
  out.push({ lane: 0, largura: moda(rows.map((r) => r.shoulder)) });
  return out;
}

export interface DestinoLargura { pname: string; nome: string; maxFaixas: number }
export interface PlanoCopia {
  pname: string;
  nome: string;
  /** Ajustes novos desta planilha: os que cabem no número de faixas dela. */
  ajustes: AjusteLargura[];
  /** Ajustes que não se aplicam porque a planilha tem menos faixas. */
  ignorados: AjusteLargura[];
}

/** Copia os ajustes de uma planilha para as demais. O acostamento (faixa 0) sempre cabe. Cada cópia
 *  ganha id novo e o nome da planilha de destino; os ajustes que já existiam no destino são substituídos. */
export function planejarCopia(ajustes: AjusteLargura[], destinos: DestinoLargura[], novoId: () => string): PlanoCopia[] {
  return destinos.map((d) => {
    const ok = ajustes.filter((a) => a.lane === 0 || a.lane <= d.maxFaixas);
    return {
      pname: d.pname, nome: d.nome,
      ajustes: ok.map((a) => ({ ...a, id: novoId(), pname: d.pname })),
      ignorados: ajustes.filter((a) => !ok.includes(a)),
    };
  });
}
