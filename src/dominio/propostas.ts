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
  /** Índices das linhas na planilha carregada. São derivados: recalculados pelo km a cada carga. */
  r0: number;
  r1: number;
  /** Km (marco normalizado, número) do primeiro e do último segmento de 20 m. É o que fica salvo. */
  km0: number;
  km1: number;
  /** Planilha carregada, mas sem esse km (ou sem essa faixa): a proposta é mostrada como órfã. */
  orfa?: boolean;
  from: string;
  to: string;
  note: string;
  t: string;
}

export type Alvo = Pick<Proposta, 'pid' | 'pname' | 'lane' | 'r0' | 'r1' | 'from'>;

export const kmKey = (km: number) => Math.round(km * 1000);
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

/** Uma proposta nova sobre área já proposta substitui só a parte sobreposta.
 *  `kmNum` é o km de cada linha da planilha da proposta, para ancorar os pedaços restantes. */
export function addProposta(list: Proposta[], rec: Proposta, kmNum: ArrayLike<number>) {
  const out: Proposta[] = [], removidas: string[] = [], novas: Proposta[] = [];
  for (const e of list) {
    if (e.orfa || e.pname !== rec.pname || e.lane !== rec.lane || e.r1 < rec.r0 || e.r0 > rec.r1) { out.push(e); continue; }
    removidas.push(e.id);
    if (e.r0 < rec.r0) { const l = { ...e, id: e.id + 'a', r1: rec.r0 - 1, km1: kmNum[rec.r0 - 1] }; out.push(l); novas.push(l); }
    if (e.r1 > rec.r1) { const r = { ...e, id: e.id + 'b', r0: rec.r1 + 1, km0: kmNum[rec.r1 + 1] }; out.push(r); novas.push(r); }
  }
  out.push(rec);
  novas.push(rec);
  return { list: out, removidas, novas };
}

/** Reposiciona as propostas pelo km, não pelo índice. Chamar ao abrir ou recarregar planilhas.
 *  - planilha não carregada: fica guardada, sem pid e sem marca de órfã;
 *  - planilha carregada sem o km (ou sem a faixa): órfã, preservada para o usuário decidir;
 *  - registros antigos, sem km, são ancorados pelos índices salvos (migração única). */
export function reposicionar(list: Proposta[], projs: PV[]): Proposta[] {
  const idx = new Map<string, Map<number, number>>();
  const indice = (p: PV) => {
    let m = idx.get(p.id);
    if (!m) {
      m = new Map();
      p.kmNum.forEach((k, i) => { const key = kmKey(k); if (!m!.has(key)) m!.set(key, i); });
      idx.set(p.id, m);
    }
    return m;
  };
  return list.map((r) => {
    const p = projs.find((x) => x.meta.name === r.pname);
    if (!p) return { ...r, pid: null, orfa: false };
    let { km0, km1 } = r;
    if (km0 === undefined || km1 === undefined) {
      if (r.r0 >= 0 && r.r1 < p.rows.length && r.r0 <= r.r1) { km0 = p.kmNum[r.r0]; km1 = p.kmNum[r.r1]; }
      else return { ...r, pid: null, orfa: true };
    }
    const m = indice(p), i0 = m.get(kmKey(km0)), i1 = m.get(kmKey(km1));
    const temFaixa = (i: number) => (r.lane ? r.lane <= p.rows[i].widths.length : p.rows[i].shoulder > 0);
    if (i0 === undefined || i1 === undefined || i0 > i1 || !temFaixa(i0) || !temFaixa(i1)) return { ...r, km0, km1, pid: null, orfa: true };
    return { ...r, km0, km1, pid: p.id, r0: i0, r1: i1, orfa: false };
  });
}

/** CSV com ";" para o Excel em português. Traz o código original da solução e o nome exibido pelo catálogo. */
export function propostasCsv(list: Proposta[], proj: (id: string | null) => PV | undefined, nome: (p: PV) => string, rotulo: (k: string) => string): string {
  const n = (v: number) => String(+v.toFixed(2)).replace('.', ','), q = (s: unknown) => '"' + String(s || '').replace(/"/g, '""') + '"';
  const rows = ['planilha;faixa;km_inicial;km_final;extensao_m;largura_m;area_m2;codigo_atual;solucao_atual;codigo_proposto;solucao_proposta;observacao'];
  for (const r of list) {
    const p = proj(r.pid);
    if (!p) continue;
    const s = runStats(p, r);
    rows.push([q(nome(p)), r.lane || 'Acost', p.kmLab[r.r0], kmLabel(p.kmNum[r.r1] + 0.02), s.len, n(s.area / s.len), n(s.area), q(r.from), q(rotulo(r.from)), q(r.to), q(rotulo(r.to)), q(r.note)].join(';'));
  }
  return rows.join('\n');
}
