/** Levantamento localizado ("Ver parâmetros"): o que há sob o ponto pressionado, por faixa, num alcance de 0 a 1 km em volta.
 *  Puro e sem DOM; a tela está em app/levantamento.ts. */
import type { PV } from './analise';
import * as catalogo from './catalogo';
import { IND, IND_KEYS, type IndKey } from './indicadores';

export const ALCANCES = [
  { m: 0, rotulo: 'Só este segmento' },
  { m: 100, rotulo: '100 m' },
  { m: 500, rotulo: '500 m' },
  { m: 1000, rotulo: '1 km' },
] as const;

const TREAT = ['Estrutural', 'Fresagem funcional', 'Fresagem estrutural', 'Selagem', 'Microfresagem', 'Fresagem fina', 'Revestimento'];

export interface TrechoLev {
  /** 1 a 6 = faixa, 0 = acostamento. */
  lane: number;
  faixa: string;
  r0: number;
  r1: number;
  kmIni: string;
  kmFim: string;
  /** Metros. */
  ext: number;
  /** Código principal ("-" sem intervenção), código completo da planilha e nome no catálogo. */
  main: string;
  codigo: string | null;
  solucao: string;
  /** Categoria do catálogo (Fresagem, Reforço...). */
  classe: string;
  /** Camadas e tratamentos, na leitura do segmento (nome, valor). */
  camadas: [string, string][];
  larg: number | null;
  area: number;
  /** Média de cada indicador no trecho, na unidade da planilha (FC em %, defeitos em fração); null sem leitura. */
  ind: Record<IndKey, number | null>;
}

/** Linhas do alcance: o segmento pressionado no meio, sem atravessar um corte da planilha. */
export function janela(p: PV, i: number, alcanceM: number): [number, number] {
  const sg = p.segs.find((s) => i >= s.a && i <= s.b) ?? { a: i, b: i };
  if (alcanceM <= 0) return [i, i];
  // perto da ponta do trecho, a janela se desloca para dentro em vez de encolher
  const n = Math.max(1, Math.round(alcanceM / 20)), a = Math.max(sg.a, Math.min(sg.b - n + 1, i - Math.floor((n - 1) / 2)));
  return [a, Math.min(sg.b, a + n - 1)];
}

const media = (v: (number | null)[]) => { const x = v.filter((n): n is number => typeof n === 'number'); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };

function camadasDe(p: PV, row: number, lane: number): [string, string][] {
  const r = p.rows[row], out: [string, string][] = [];
  if (!lane) {
    if (r.shoulderRaw) out.push(['Revestimento do acostamento', r.shoulderRaw]);
    return out;
  }
  const L = r.lanes[lane - 1];
  if (L.camadas) for (const c of L.camadas) out.push([c.nome, c.texto]);
  else L.treat.forEach((v, k) => { if (v !== 0 && v !== null) out.push([TREAT[k], typeof v === 'number' ? String(v) : v]); });
  if (L.fsEsp && !L.camadas) out.push(['Espessura de fresagem', `${L.fsEsp} cm`]);
  if (L.gapCm) out.push(['Gap graded', `${L.gapCm} cm`]);
  return out;
}

/** Trechos contínuos (mesmo código completo) de cada faixa e do acostamento dentro do alcance. */
export function levantar(p: PV, i: number, alcanceM: number, kmFim: (km: number) => string): TrechoLev[] {
  const [a, b] = janela(p, i, alcanceM), out: TrechoLev[] = [];
  const nLanes = p.rows[i].widths.length;
  const faixas = Array.from({ length: nLanes }, (_, k) => k + 1).concat(p.rows[i].shoulder > 0 ? [0] : []);
  for (const lane of faixas) {
    const cel = (r: number) => (lane ? p.model[r].tr[lane - 1] : p.model[r].sh);
    const larg = (r: number) => (lane ? p.rows[r].widths[lane - 1] : p.rows[r].shoulder);
    let r0 = a;
    for (let r = a; r <= b + 1; r++) {
      if (r <= b && lane <= p.rows[r].widths.length && (cel(r)?.code ?? null) === (cel(r0)?.code ?? null)) continue;
      const r1 = r - 1, c = cel(r0), idx = Array.from({ length: r1 - r0 + 1 }, (_, k) => r0 + k);
      if (lane <= p.rows[r0].widths.length) {
        const ws = idx.map((k) => larg(k) || 0), area = ws.reduce((s, w) => s + w * 20, 0);
        const ind = Object.fromEntries(IND_KEYS.map((k) => [k, lane ? media(idx.map((q) => IND[k].value(p.rows[q].lanes[lane - 1]))) : null])) as Record<IndKey, number | null>;
        out.push({
          lane, faixa: lane ? `Fx ${lane}` : 'Acost.', r0, r1, kmIni: p.kmLab[r0], kmFim: kmFim(p.kmNum[r1] + 0.02), ext: (r1 - r0 + 1) * 20,
          main: c.main, codigo: c.code, solucao: c.main === '-' ? 'Sem intervenção' : catalogo.get(c.main).nome,
          classe: c.main === '-' ? '–' : catalogo.get(c.main).categoria, camadas: camadasDe(p, r0, lane),
          larg: ws.length ? ws.reduce((s, w) => s + w, 0) / ws.length : null, area, ind,
        });
      }
      r0 = r;
    }
  }
  return out;
}

const num = (v: number | null, d: number) => (v === null ? '' : v.toFixed(d).replace('.', ','));

/** CSV do recorte: ";" e vírgula decimal, uma linha por trecho. `eol` é "\n" na área de transferência. */
export function levantamentoCsv(t: TrechoLev[], planilha: string, eol = '\n'): string {
  const q = (s: string) => (s === '' ? '' : '"' + s.replace(/"/g, '""') + '"');
  const cab = ['Planilha', 'Faixa', 'Km inicial', 'Km final', 'Extensão (m)', 'Largura (m)', 'Área (m²)', 'Código', 'Solução', 'Classe', 'Camadas', ...IND_KEYS.map((k) => (IND[k].unit ? `${IND[k].label} (${IND[k].unit})` : IND[k].label))];
  const rows = t.map((x) => [q(planilha), x.faixa, x.kmIni, x.kmFim, String(x.ext), num(x.larg, 2), num(x.area, 1), q(x.codigo ?? ''), q(x.solucao), q(x.classe),
    q(x.camadas.map(([k, v]) => `${k}: ${v}`).join(' | ')), ...IND_KEYS.map((k) => num(x.ind[k] === null ? null : x.ind[k]! * IND[k].scale, IND[k].dec))]);
  return [cab.join(';'), ...rows.map((r) => r.join(';'))].join(eol);
}
