import type { Lane, ProjectMeta, Row } from '../formats/types';
import type { Seg } from '../formats/segments';
import type { SolutionCode } from '../formats/km';
import type { RowModel } from './modelo';
import { IND, IND_KEYS, type IndKey } from './indicadores';

/** O que a análise precisa de um projeto. AppProj satisfaz esta interface. */
export interface PV {
  id: string;
  meta: ProjectMeta;
  rows: Row[];
  model: RowModel[];
  segs: Seg[];
  kmLab: string[];
  kmNum: number[];
}

/* ---- Resumo ---- */
export interface ResumoSolucao { len: number; area: number }

/** Plataformas (OAE, pedágio) em trechos contínuos: uma ocorrência por sequência. */
export function contarPlataformas(rows: Row[]): Record<string, number> {
  const poi: Record<string, number> = {};
  let i = 0;
  while (i < rows.length) {
    const t = rows[i].platform;
    if (!t) { i++; continue; }
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].platform === t && rows[j + 1].hod - rows[j].hod < 0.0215) j++;
    poi[t] = (poi[t] || 0) + 1;
    i = j + 1;
  }
  return poi;
}

export function resumo(V: PV[]) {
  const st: Record<string, ResumoSolucao> = {};
  const poi: Record<string, number> = {};
  let ext = 0, nR = 0, drKm = 0;
  for (const p of V) {
    p.rows.forEach((r, i) => {
      const m = p.model[i];
      m.tr.forEach((t, k) => {
        const s = (st[t.main] = st[t.main] || { len: 0, area: 0 });
        s.len += 0.02;
        s.area += (20 * r.widths[k] * t.pct) / 100;
      });
      if (r.drain && (r.drain[0] || r.drain[1])) drKm += 0.02;
      nR++;
    });
    p.segs.forEach((s) => (ext += p.rows[s.b].hod - p.rows[s.a].hod + 0.02));
    for (const [k, n] of Object.entries(contarPlataformas(p.rows))) poi[k] = (poi[k] || 0) + n;
  }
  return { st, ext, nR, drKm, poi };
}

export interface Critico { p: PV; i: number; lane: number; v: number; km: number }

/** Os 5 piores valores do indicador, sem repetir pontos a menos de 200 m na mesma planilha. */
export function criticos(V: PV[], key: IndKey): Critico[] {
  const M = IND[key], arr: Critico[] = [];
  for (const p of V) p.rows.forEach((r, i) => r.lanes.forEach((L, k) => {
    const v = M.value(L);
    if (v != null) arr.push({ p, i, lane: k + 1, v, km: r.hod });
  }));
  arr.sort((a, b) => (M.low ? a.v - b.v : b.v - a.v));
  const out: Critico[] = [];
  for (const a of arr) {
    if (out.every((o) => o.p !== a.p || Math.abs(o.km - a.km) > 0.2)) out.push(a);
    if (out.length >= 5) break;
  }
  return out;
}

/* ---- Análise: solução x patologias ---- */
export interface Regra {
  t: string;
  s: string;
  f: (L: Lane, t: SolutionCode) => boolean;
}

/** Critérios provisórios de coerência entre solução e patologia. */
export const REGRAS: Regra[] = [
  { t: 'Sem intervenção com IRI acima de 3,5', s: 'Pavimento irregular sem solução prevista', f: (L, t) => t.main === '-' && (L.iri ?? 0) > 3.5 },
  { t: 'Sem intervenção com D0 acima de 50', s: 'Deflexão alta sem solução prevista', f: (L, t) => t.main === '-' && (L.d0 ?? 0) > 50 },
  { t: 'Fresagem funcional com D0 acima de 50', s: 'Deflexão alta pede solução estrutural', f: (L, t) => (t.main === 'FS3' || t.main === 'FS4') && (L.d0 ?? 0) > 50 },
  { t: 'Micro ou microfresagem com ATR acima de 12', s: 'Afundamento não é corrigido por solução fina', f: (L, t) => (t.main === 'MFS' || t.main === 'Micro') && (L.atr ?? 0) > 12 },
  { t: 'Defeitos acima de 30% com solução leve', s: 'Sem intervenção, Micro, MFS ou GAP', f: (L, t) => ['-', 'MFS', 'Micro', 'GAP'].includes(t.main) && (L.defPct ?? 0) > 0.3 },
  { t: 'Solução pesada com IRI até 1,5 e D0 até 20', s: 'Possível sobredimensionamento (FSE, RP, REC)', f: (L, t) => ['FSE', 'RP', 'REC'].includes(t.main) && L.iri != null && L.iri <= 1.5 && L.d0 != null && L.d0 <= 20 },
];

export interface AcumSolucao { n: number; none: number; cls: number[]; sum: number; cnt: number }

/** Distribuição do indicador por classe, dentro de cada solução. */
export function matriz(V: PV[], key: IndKey): Record<string, AcumSolucao> {
  const M = IND[key], acc: Record<string, AcumSolucao> = {};
  for (const p of V) p.rows.forEach((r, i) => p.model[i].tr.forEach((t, k) => {
    const a = (acc[t.main] = acc[t.main] || { n: 0, none: 0, cls: [0, 0, 0, 0, 0], sum: 0, cnt: 0 });
    const v = M.value(r.lanes[k]);
    a.n++;
    if (v == null) a.none++;
    else { a.cls[M.cls(v)]++; a.sum += v; a.cnt++; }
  }));
  return acc;
}

export function violacoes(V: PV[]): { regra: Regra; n: number }[] {
  return REGRAS.map((regra) => {
    let n = 0;
    for (const p of V) p.rows.forEach((r, i) => p.model[i].tr.forEach((t, k) => { if (regra.f(r.lanes[k], t)) n++; }));
    return { regra, n };
  });
}

export const INDS_ANALISE: IndKey[] = IND_KEYS;
