import { kmLabel } from '../formats/km';
import type { PV } from './analise';
import { nivelDe } from './catalogo';

/** O que a troca de solução faz com a intensidade da intervenção. */
export type Efeito = 'Aumenta' | 'Reduz' | 'Retira' | 'Troca';

/** Deduz o efeito pelo nível de cada solução no catálogo. A nova "Sem intervenção" ("-") retira; nível maior aumenta, menor reduz;
 *  igual ou sem nível em qualquer das duas é só troca. */
export function efeitoDe(atual: string | null | undefined, nova: string | null | undefined): Efeito {
  const a = atual || '-', n = nova || '-';
  if (n === '-') return a === '-' ? 'Troca' : 'Retira';
  const na = nivelDe(a), nn = nivelDe(n);
  if (na === null || nn === null || na === nn) return 'Troca';
  return nn > na ? 'Aumenta' : 'Reduz';
}

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
  /** Proposta feita em campo pelo menu pressionável: efeito deduzido, metros acrescentados antes e depois do segmento pressionado e de onde veio a posição. */
  campo?: { efeito: Efeito; antes: number; depois: number; origem: 'pressao' | 'gps'; precisao: number | null; lat: number; lon: number };
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

/** Formato do km nas legendas e no CSV. O app troca por um que oculta o km no modo privacidade. */
let formatarKm: (km: number) => string = kmLabel;
export const definirFormatoKm = (f: (km: number) => string) => { formatarKm = f; };
export const runLabel = (p: PV, s: Pick<Alvo, 'r0' | 'r1'>) => `km ${p.kmLab[s.r0]} a ${formatarKm(p.kmNum[s.r1] + 0.02)}`;

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

/** Ponto do eixo da faixa, para o CSV. */
export interface PontoCsv { lat: number; lon: number; e: number; n: number }
export type EixoCsv = (p: PV, r: Proposta) => { ini: PontoCsv; fim: PontoCsv } | null;

export const CSV_CABECALHO = [
  'planilha', 'faixa', 'km_inicial', 'km_final', 'extensao_m', 'largura_m', 'area_m2', 'codigo_atual', 'solucao_atual', 'codigo_proposto', 'solucao_proposta', 'observacao',
  'lat_inicial', 'lon_inicial', 'lat_final', 'lon_final', 'utm_e_inicial', 'utm_n_inicial', 'utm_e_final', 'utm_n_final',
];

/** CSV com ";" para o Excel em português (vírgula decimal). Traz o código original da solução e o nome exibido pelo
 *  catálogo, e as coordenadas do eixo da faixa no início do primeiro segmento e no fim do último
 *  (graus em SIRGAS 2000 e metros UTM do fuso do projeto). `eol` é "\r\n" no arquivo e "\n" na área de transferência. */
export function propostasCsv(list: Proposta[], proj: (id: string | null) => PV | undefined, nome: (p: PV) => string, rotulo: (k: string) => string, eixo?: EixoCsv, eol = '\n'): string {
  const num = (v: number, d = 2) => v.toFixed(d).replace('.', ','), q = (s: unknown) => '"' + String(s || '').replace(/"/g, '""') + '"';
  const n = (v: number) => String(+v.toFixed(2)).replace('.', ',');
  const rows = [CSV_CABECALHO.join(';')];
  for (const r of list) {
    const p = proj(r.pid);
    if (!p) continue;
    const s = runStats(p, r), e = eixo?.(p, r);
    const coords = e ? [num(e.ini.lat, 7), num(e.ini.lon, 7), num(e.fim.lat, 7), num(e.fim.lon, 7), num(e.ini.e), num(e.ini.n), num(e.fim.e), num(e.fim.n)] : Array(8).fill('');
    rows.push([q(nome(p)), r.lane || 'Acost', p.kmLab[r.r0], formatarKm(p.kmNum[r.r1] + 0.02), s.len, n(s.area / s.len), n(s.area), q(r.from), q(rotulo(r.from)), q(r.to), q(rotulo(r.to)), q(r.note), ...coords].join(';'));
  }
  return rows.join(eol);
}

/** "propostas_AAAA-MM-DD.csv", com a data local. */
export function nomeArquivoCsv(d: Date = new Date()): string {
  const z = (v: number) => String(v).padStart(2, '0');
  return `propostas_${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.csv`;
}
