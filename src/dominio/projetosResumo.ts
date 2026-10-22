/** Resumo de cada planilha para o dashboard de projetos e consolidado por rodovia. Funções puras, sem DOM. */
import { resumo, type PV } from './analise';
import { IND, IND_KEYS, type IndKey } from './indicadores';
import type { Qualidade } from '../formats/types';

export interface FatiaSolucao { codigo: string; area: number; pct: number }
export interface ResumoProjeto {
  /** Extensão em km (trechos contínuos somados). */
  ext: number;
  /** Área total de pavimento em m² (soma das faixas e do acostamento). */
  area: number;
  /** Área por solução, da maior para a menor; "-" é sem intervenção. */
  fatias: FatiaSolucao[];
  /** Média de cada indicador que a planilha tem (valores na unidade da planilha). */
  medias: Partial<Record<IndKey, number>>;
  kmIni: number | null;
  kmFim: number | null;
}

/** Média de um indicador sobre todas as faixas de todas as linhas; null sem nenhuma leitura. */
export function mediaDoIndicador(p: PV, k: IndKey): number | null {
  let s = 0, n = 0;
  for (const r of p.rows) for (const l of r.lanes) { const v = IND[k].value(l); if (typeof v === 'number' && Number.isFinite(v)) { s += v; n++; } }
  return n ? s / n : null;
}

export function resumoDoProjeto(p: PV): ResumoProjeto {
  const R = resumo([p]), total = Object.values(R.st).reduce((a, b) => a + b.area, 0);
  const fatias = Object.entries(R.st).map(([codigo, v]) => ({ codigo, area: v.area, pct: total ? (v.area / total) * 100 : 0 })).filter((f) => f.area > 0).sort((a, b) => b.area - a.area);
  const medias: Partial<Record<IndKey, number>> = {};
  for (const k of IND_KEYS) { const m = mediaDoIndicador(p, k); if (m !== null) medias[k] = m; }
  return { ext: R.ext, area: total, fatias, medias, kmIni: p.meta.kmi, kmFim: p.meta.kmf };
}

/** Pontos reconstruídos e alertas (saltos, distância entre sentidos, cortes e trechos atípicos) da verificação de importação. */
export function resumoQualidade(q: Qualidade | undefined): { reconstruidos: number; alertas: number } {
  if (!q) return { reconstruidos: 0, alertas: 0 };
  return { reconstruidos: q.corrigidos?.length ?? 0, alertas: q.saltos.length + q.sentidos.length + (q.cortes?.length ?? 0) + (q.avisos?.length ?? 0) };
}

/** Totais de um conjunto de planilhas (uma rodovia ou todas). */
export function consolidar(V: PV[]): { n: number; ext: number; area: number; fatias: FatiaSolucao[] } {
  const R = resumo(V), total = Object.values(R.st).reduce((a, b) => a + b.area, 0);
  const fatias = Object.entries(R.st).map(([codigo, v]) => ({ codigo, area: v.area, pct: total ? (v.area / total) * 100 : 0 })).filter((f) => f.area > 0).sort((a, b) => b.area - a.area);
  return { n: V.length, ext: R.ext, area: total, fatias };
}
