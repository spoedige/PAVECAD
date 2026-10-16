import { kmLabel } from '../formats/km';
import type { PV } from './analise';

/** Proposta de nova solução para um trecho de uma faixa. Ligada à planilha pelo nome. */
export interface Proposta {
  id: string;
  /** Nome da planilha; é o vínculo que sobrevive ao recarregar. */
  pname: string;
  /** Id da planilha carregada, resolvido em runtime. */
  pid: string | null;
  /** 0 = acostamento. */
  lane: number;
  r0: number;
  r1: number;
  from: string;
  to: string;
  note: string;
  t: string;
}

export type Alvo = Pick<Proposta, 'pid' | 'pname' | 'lane' | 'r0' | 'r1' | 'from'>;
export const PROP_OPTS = ['FS3', 'FS4', 'FSE', 'MFS', 'RP', 'REC', 'Micro', 'GAP', '-'];

const cell = (p: PV, row: number, lane: number) => (lane ? p.model[row].tr[lane - 1] : p.model[row].sh);

/** "run": trecho contínuo com o mesmo código de solução na faixa. "one": um segmento de 20 m. */
export function runAt(p: PV, row: number, lane: number, mode: 'run' | 'one'): Alvo {
  const base = cell(p, row, lane), sg = p.segs.find((s) => row >= s.a && row <= s.b)!;
  let a = row, b = row;
  if (mode === 'run') {
    const same = (i: number) => cell(p, i, lane)?.code === base.code;
    while (a > sg.a && same(a - 1)) a--;
    while (b < sg.b && same(b + 1)) b++;
  }
  return { pid: p.id, pname: p.meta.name, lane, r0: a, r1: b, from: base.main };
}

export function runStats(p: PV, s: Pick<Alvo, 'lane' | 'r0' | 'r1'>) {
  let area = 0;
  for (let i = s.r0; i <= s.r1; i++) area += 20 * (s.lane ? p.rows[i].widths[s.lane - 1] || 0 : p.rows[i].shoulder);
  return { len: (s.r1 - s.r0 + 1) * 20, area };
}

export const runLabel = (p: PV, s: Pick<Alvo, 'r0' | 'r1'>) => `km ${p.kmLab[s.r0]} a ${kmLabel(p.kmNum[s.r1] + 0.02)}`;

/** Uma proposta nova sobre área já proposta substitui só a parte sobreposta. */
export function addProposta(list: Proposta[], rec: Proposta) {
  const out: Proposta[] = [], removidas: string[] = [], novas: Proposta[] = [];
  for (const e of list) {
    if (e.pname !== rec.pname || e.lane !== rec.lane || e.r1 < rec.r0 || e.r0 > rec.r1) { out.push(e); continue; }
    removidas.push(e.id);
    if (e.r0 < rec.r0) { const l = { ...e, id: e.id + 'a', r1: rec.r0 - 1 }; out.push(l); novas.push(l); }
    if (e.r1 > rec.r1) { const r = { ...e, id: e.id + 'b', r0: rec.r1 + 1 }; out.push(r); novas.push(r); }
  }
  out.push(rec);
  novas.push(rec);
  return { list: out, removidas, novas };
}

/** CSV com ";" para o Excel em português. */
export function propostasCsv(list: Proposta[], proj: (id: string | null) => PV | undefined, nome: (p: PV) => string, rotulo: (k: string) => string): string {
  const n = (v: number) => String(+v.toFixed(2)).replace('.', ','), q = (s: unknown) => '"' + String(s || '').replace(/"/g, '""') + '"';
  const rows = ['planilha;faixa;km_inicial;km_final;extensao_m;largura_m;area_m2;solucao_atual;solucao_proposta;observacao'];
  for (const r of list) {
    const p = proj(r.pid);
    if (!p) continue;
    const s = runStats(p, r);
    rows.push([q(nome(p)), r.lane || 'Acost', p.kmLab[r.r0], kmLabel(p.kmNum[r.r1] + 0.02), s.len, n(s.area / s.len), n(s.area), q(rotulo(r.from)), q(rotulo(r.to)), q(r.note)].join(';'));
  }
  return rows.join('\n');
}
