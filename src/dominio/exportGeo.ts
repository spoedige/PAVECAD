import { buildGeometry, polyId, type Geometry, type GeoOptions, type LanePoly, type XY } from '../geometry/build';
import type { Project } from '../geometry/project';
import type { RowModel } from './modelo';
import { IND, IND_KEYS } from './indicadores';
import type { Proposta } from './propostas';

/** Núcleo da exportação geométrica (KMZ, KML e IFC): une trechos contíguos iguais, aplica os filtros e mede.
 *  Função pura, sobre a mesma geometria da tela. Os formatos só escrevem o que sai daqui. */

export type Formato = 'json' | 'csv' | 'xlsx' | 'kmz' | 'kml' | 'ifc';
export type Detalhe = 'resumido' | 'trecho' | 'completo';

export interface OpcoesExport {
  camadas: { faixas: boolean; patologias: boolean; drenos: boolean; estacas: boolean; propostas: boolean };
  /** Notas de campo. Só vale em KMZ, KML e IFC quando o usuário liga o chip. */
  notas: boolean;
  /** Rodovias incluídas; null = todas. */
  rodovias: string[] | null;
  sentido: 'todos' | 'crescente' | 'decrescente';
  /** 0 = acostamento. */
  faixa: 'todas' | number;
  detalhe: Detalhe;
}

/** Formatos em que as notas entram sem o usuário pedir. */
export const NOTAS_POR_PADRAO: Formato[] = ['json', 'csv', 'xlsx'];

export function opcoesPadrao(formato: Formato): OpcoesExport {
  return {
    camadas: { faixas: true, patologias: false, drenos: formato !== 'ifc', estacas: false, propostas: formato !== 'ifc' },
    notas: NOTAS_POR_PADRAO.includes(formato),
    rodovias: null, sentido: 'todos', faixa: 'todas', detalhe: 'resumido',
  };
}

/** Resolve as opções: o nível "completo" liga estacas e patologias, e IFC nunca leva notas sem o chip. */
export function opcoesEfetivas(formato: Formato, o: OpcoesExport): OpcoesExport {
  const completo = o.detalhe === 'completo' && (formato === 'kmz' || formato === 'kml');
  const detalhe: Detalhe = formato === 'ifc' && o.detalhe === 'completo' ? 'trecho' : o.detalhe;
  return {
    ...o, detalhe,
    camadas: { ...o.camadas, estacas: o.camadas.estacas || completo, patologias: o.camadas.patologias || completo },
    notas: NOTAS_POR_PADRAO.includes(formato) ? true : o.notas,
  };
}

/** O que a exportação precisa de uma planilha. AppProj satisfaz esta interface. */
export interface FonteExport {
  id: string;
  planilha: string;
  rodovia: string;
  sentido: 'Crescente' | 'Decrescente';
  base: Project;
  opts: GeoOptions;
  model: RowModel[];
  /** Km exibido da linha i (respeita o modo privacidade). */
  km(i: number): string;
}

export interface Trecho {
  fonte: FonteExport;
  /** 0 = acostamento. */
  lane: number;
  codigo: string;
  r0: number;
  r1: number;
  /** Anel fechado, anti-horário, em metros projetados. */
  ring: XY[];
  ext: number;
  area: number;
  /** Quantos trechos de 20 m viraram este. */
  unidos: number;
  extra?: Record<string, string | number>;
}

export interface Dreno { fonte: FonteExport; tipo: string; r0: number; r1: number; pts: XY[]; ext: number }
export interface Estaca { fonte: FonteExport; row: number; km: string; pt: XY }

export interface ModeloExport {
  faixas: Trecho[];
  patologias: Trecho[];
  propostas: Trecho[];
  drenos: Dreno[];
  estacas: Estaca[];
  avisos: string[];
  /** Trechos de 20 m antes da união. */
  brutos: number;
}

/* ---- geometria ---- */

const sinal = (ring: XY[]) => {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
};
export const areaAnel = (ring: XY[]) => Math.abs(sinal(ring));

const cruza = (a: XY, b: XY, c: XY, d: XY) => {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/** Anel simples: nenhum par de arestas não adjacentes se cruza. */
export function anelSimples(ring: XY[]): boolean {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cruza(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}

const igual = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** Anel de uma sequência contígua de quadriláteros: borda esquerda na ida e direita na volta. Sem pontos repetidos, anti-horário. */
export function anelDeSequencia(polys: LanePoly[]): XY[] {
  const esq: XY[] = [], dir: XY[] = [];
  for (const q of polys) {
    esq.push(q.ring[0], q.ring[3]);
    dir.push(q.ring[1], q.ring[2]);
  }
  const pts: XY[] = [];
  for (const p of [...esq, ...dir.reverse()]) if (!pts.length || !igual(pts[pts.length - 1], p)) pts.push(p);
  if (pts.length > 1 && igual(pts[0], pts[pts.length - 1])) pts.pop();
  if (sinal([...pts, pts[0]]) < 0) pts.reverse();
  return [...pts, pts[0]];
}

const MAX_POLYS = 500;

/** Divide a sequência ao meio até o anel ficar simples (curvas fechadas podem cruzar as bordas ao unir). */
function aneisSimples(polys: LanePoly[]): { polys: LanePoly[]; ring: XY[] }[] {
  const ring = anelDeSequencia(polys);
  if (polys.length === 1 || (polys.length <= MAX_POLYS && anelSimples(ring))) return [{ polys, ring }];
  const m = polys.length >> 1;
  return [...aneisSimples(polys.slice(0, m)), ...aneisSimples(polys.slice(m))];
}

/* ---- trechos ---- */

interface Corrida { lane: number; chave: string; polys: LanePoly[]; extra?: Record<string, string | number> }

/** Percorre cada trecho contínuo da planilha e agrupa linhas consecutivas da mesma faixa com a mesma chave. */
function corridas(g: Geometry, p: Project, chave: (q: LanePoly) => string | null, faixaSel: 'todas' | number, unir: boolean): Corrida[] {
  const por = new Map<number, LanePoly>();
  let maxLane = 0;
  for (const q of g.polys) { por.set(q.fid, q); if (q.lane > maxLane) maxLane = q.lane; }
  const out: Corrida[] = [];
  for (const sg of p.segs) {
    for (let lane = 0; lane <= maxLane; lane++) {
      if (faixaSel !== 'todas' && faixaSel !== lane) continue;
      let cur: Corrida | null = null;
      for (let i = sg.a; i < sg.b; i++) {
        const q = por.get(polyId(i, lane));
        const k = q && !q.invalido ? chave(q) : null;
        if (k === null) { cur = null; continue; }
        if (cur && unir && cur.chave === k) { cur.polys.push(q!); continue; }
        cur = { lane, chave: k, polys: [q!] };
        out.push(cur);
      }
    }
  }
  return out;
}

const hip = (p: Project, i: number) => Math.hypot(p.x[i + 1] - p.x[i], p.y[i + 1] - p.y[i]);

function paraTrechos(f: FonteExport, cor: Corrida, codigo: string, extra?: Record<string, string | number>): Trecho[] {
  return aneisSimples(cor.polys).map(({ polys, ring }) => {
    const r0 = polys[0].row, r1 = polys[polys.length - 1].row;
    let ext = 0;
    for (let i = r0; i <= r1; i++) ext += hip(f.base, i);
    return { fonte: f, lane: cor.lane, codigo, r0, r1, ring, ext, area: areaAnel(ring), unidos: polys.length, extra };
  });
}

export function fontesFiltradas(fontes: FonteExport[], o: OpcoesExport): FonteExport[] {
  return fontes.filter((f) => (!o.rodovias || o.rodovias.includes(f.rodovia))
    && (o.sentido === 'todos' || (o.sentido === 'crescente') === (f.sentido === 'Crescente')));
}

/** Classe do indicador (0 a 4) a partir da qual o trecho entra como patologia. */
const CLASSE_PATOLOGIA = 3;

export function montarModelo(fontes: FonteExport[], opcoes: OpcoesExport, propostas: Proposta[] = []): ModeloExport {
  const o = opcoes;
  const unir = o.detalhe === 'resumido';
  const m: ModeloExport = { faixas: [], patologias: [], propostas: [], drenos: [], estacas: [], avisos: [], brutos: 0 };
  for (const f of fontesFiltradas(fontes, o)) {
    const g = buildGeometry(f.base, f.opts);
    const R = f.base.rows;
    const solucao = (q: LanePoly) => (q.lane ? f.model[q.row].tr[q.lane - 1] : f.model[q.row].sh);
    const naoPoly = g.polys.filter((q) => q.invalido).length;
    if (naoPoly) m.avisos.push(`${f.planilha}: ${naoPoly} polígono${naoPoly > 1 ? 's' : ''} inválido${naoPoly > 1 ? 's' : ''} ficou de fora`);
    if (o.camadas.faixas) {
      const cs = corridas(g, f.base, (q) => { const s = solucao(q)?.main; return s && s !== '-' ? s : null; }, o.faixa, unir);
      for (const c of cs) { m.brutos += c.polys.length; m.faixas.push(...paraTrechos(f, c, c.chave)); }
    }
    if (o.camadas.patologias) {
      for (const k of IND_KEYS) {
        const cs = corridas(g, f.base, (q) => {
          if (!q.lane) return null;
          const v = IND[k].value(R[q.row].lanes[q.lane - 1]);
          if (v == null) return null;
          const c = IND[k].cls(v);
          return c >= CLASSE_PATOLOGIA ? String(c) : null;
        }, o.faixa, unir);
        for (const c of cs) {
          const ind = IND[k];
          const pior = Math.max(...c.polys.map((q) => ind.value(R[q.row].lanes[q.lane - 1]) ?? 0)) * ind.scale;
          m.brutos += c.polys.length;
          m.patologias.push(...paraTrechos(f, c, ind.label, { indicador: k, classe: Number(c.chave), valorMax: Number(pior.toFixed(ind.dec)), unidade: ind.unit }));
        }
      }
    }
    if (o.camadas.drenos) {
      for (const d of g.drains) {
        let ext = 0;
        for (let i = 1; i < d.pts.length; i++) ext += Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]);
        m.drenos.push({ fonte: f, tipo: d.type, r0: d.r0, r1: d.r1, pts: d.pts, ext });
      }
    }
    if (o.camadas.estacas) {
      for (const sg of f.base.segs) {
        for (let i = sg.a; i <= sg.b; i++) {
          const k = f.base.kmNum[i] * 10;
          if (i !== sg.a && Math.abs(k - Math.round(k)) > 1e-6) continue;
          m.estacas.push({ fonte: f, row: i, km: f.km(i), pt: [f.base.x[i], f.base.y[i]] });
        }
      }
    }
    if (o.camadas.propostas) {
      for (const pr of propostas) {
        if (pr.orfa || pr.pid !== f.id) continue;
        if (o.faixa !== 'todas' && o.faixa !== pr.lane) continue;
        const cs = corridas(g, f.base, (q) => (q.lane === pr.lane && q.row >= pr.r0 && q.row <= pr.r1 ? pr.to : null), pr.lane, unir);
        for (const c of cs) {
          m.brutos += c.polys.length;
          m.propostas.push(...paraTrechos(f, c, pr.to, { de: pr.from, para: pr.to, nota: pr.note, efeito: pr.campo?.efeito ?? '' }));
        }
      }
    }
  }
  return m;
}

export interface Relatorio {
  elementos: number;
  unidos: number;
  avisos: string[];
  validacao: { ok: boolean; detalhe: string };
}

export function relatorioDe(m: ModeloExport, validacao: Relatorio['validacao'], avisosExtras: string[] = []): Relatorio {
  const elementos = m.faixas.length + m.patologias.length + m.propostas.length + m.drenos.length + m.estacas.length;
  const gerados = m.faixas.length + m.patologias.length + m.propostas.length;
  return { elementos, unidos: Math.max(0, m.brutos - gerados), avisos: [...m.avisos, ...avisosExtras], validacao };
}

export function nomeArquivo(base: string, ext: string, nome: string, d: Date = new Date()): string {
  const z = (v: number) => String(v).padStart(2, '0');
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'projeto';
  return `${base}_${limpo}_${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.${ext}`;
}

