import type maplibregl from 'maplibre-gl';
import type { Feature } from 'geojson';
import type { GeoOptions } from '../geometry/build';
import type { Project } from '../geometry/project';
import type { Camadas } from '../mapa/camadas';
import type { Normais } from '../mapa/worker';
import type { RowModel } from '../dominio/modelo';
import type { IndKey, ModeKey } from '../dominio/indicadores';
import type { Alvo, Proposta } from '../dominio/propostas';
import type { AjusteLargura } from '../dominio/larguras';
import type { Desloc } from '../geometry/deslocamento';
import type { Lane, Row } from '../formats/types';
import type { SolutionCode } from '../formats/km';
import type { MapMouseEvent } from 'maplibre-gl';
import { modelOf } from '../dominio/modelo';

export interface AppProj extends Project {
  id: string;
  label: string;
  visible: boolean;
  opts: GeoOptions;
  normals: (Normais | null)[];
  camadas: Camadas;
  model: RowModel[];
  polyByFid: Map<number, Feature>;
  bounds: [[number, number], [number, number]];
  markers: maplibregl.Marker[];
  /** Linhas como vieram da planilha. `rows` já traz os ajustes de largura aplicados. */
  rowsPlanilha: Row[];
  ajustes: AjusteLargura[];
  /** Eixo como veio da planilha, em metros projetados. `x` e `y` já trazem o deslocamento longitudinal. */
  x0: Float64Array;
  y0: Float64Array;
  desloc: Desloc;
}

export interface Sel { pid: string; row: number; lane: number }
export type BaseKey = 'none' | 'osm' | 'esri';
export type Ferramenta = 'pin' | 'prop' | null;

export const NOTE_CATS = {
  obs: { l: 'Observação', c: '#5e5ce6' },
  def: { l: 'Defeito', c: '#ff2d55' },
  dre: { l: 'Dreno', c: '#00a99d' },
  rev: { l: 'Revisar solução', c: '#ff9f0a' },
} as const;
export type NoteCat = keyof typeof NOTE_CATS;

export interface Nota {
  id: string;
  type: 'pin' | 'line' | 'area';
  /** [lon, lat] */
  coords: number[][];
  cat: NoteCat;
  text: string;
  photos: string[];
  t: string;
  loc: { pid: string; name: string; km: string; lane: number } | null;
  isNew?: boolean;
}

export type FocoPred = (L: Lane, t: SolutionCode, r: Row, p: AppProj) => boolean;

export const E = {
  P: [] as AppProj[],
  seq: 0,
  mode: 'sol' as ModeKey,
  sel: null as Sel | null,
  dim: new Set<string>(),
  field: false,
  base: 'none' as BaseKey,
  activeGroup: null as string | null,
  layers: { drain: true, km: true, poi: true, notes: true } as Record<'drain' | 'km' | 'poi' | 'notes', boolean>,
  mapReady: false,
  tool: null as Ferramenta,
  notes: [] as Nota[],
  editing: null as Nota | null,
  props: [] as Proposta[],
  propSel: [] as Alvo[],
  propMode: 'run' as 'run' | 'one',
  propTo: 'FS4',
  propNote: '',
  focus: null as { label: string; n: number; pred: FocoPred } | null,
  anInd: 'iri' as IndKey,
  settingsPid: null as string | null,
  uniCollapsed: false,
  tab: 'resumo' as 'resumo' | 'seg' | 'ana' | 'notas' | 'aj',
  /** Ajustes de largura salvos, por nome de planilha. Valem quando a planilha é aberta. */
  ajustesSalvos: {} as Record<string, AjusteLargura[]>,
  /** Deslocamento salvo, por nome de planilha. */
  deslocSalvos: {} as Record<string, Desloc>,
};

/** Ganchos para os módulos de interface, sem import circular com o mapa. */
export const H = {
  onSelect: (_opt: { tab?: boolean }) => {},
  onNoteHit: (_id: string) => {},
  /** Ferramentas ativas consomem o clique; devolve true quando consumiu. */
  onClick: (_e: MapMouseEvent): boolean => false,
  onView: () => {},
  /** O catálogo mudou (código novo visto, edição, importação). */
  onCatalogo: () => {},
};

export const visibleProjects = () => E.P.filter((p) => p.visible);
export const getP = (id: string) => E.P.find((p) => p.id === id);
const short = (p: Pick<AppProj, 'meta'>) => (/Marginal/i.test(p.meta.via) ? p.meta.via.replace(/\s*-\s*Crescente|\s*-\s*Decrescente/, '') : p.meta.via);
/** O Planservi já traz o nome pronto ("SP-333 · TH36 · Crescente"). */
export const projName = (p: Pick<AppProj, 'meta'>) => (p.meta.format === 'planservi' ? p.meta.name : `${p.meta.uf.split('/')[1] || p.meta.uf} ${short(p)}`);

export const novoId = () => 'p' + ++E.seq;

/** O id é gerado antes, com novoId(), porque o worker o grava nas feições. */
export function criarProjeto(
  id: string, base: Project, extra: { opts: GeoOptions; normals: (Normais | null)[]; camadas: Camadas },
): AppProj {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const r of base.rows) {
    x0 = Math.min(x0, r.lon); x1 = Math.max(x1, r.lon); y0 = Math.min(y0, r.lat); y1 = Math.max(y1, r.lat);
  }
  const polyByFid = new Map<number, Feature>();
  for (const f of extra.camadas.polys.features) polyByFid.set(f.properties.fid as number, f as unknown as Feature);
  const proj: AppProj = {
    ...base, ...extra, id, label: base.meta.name, visible: true, model: modelOf(base.rows),
    polyByFid, bounds: [[x0, y0], [x1, y1]], markers: [], rowsPlanilha: base.rows, ajustes: [],
    x0: Float64Array.from(base.x), y0: Float64Array.from(base.y), desloc: { l: 0, t: 0 },
  };
  registrarInvalidos(proj, extra.camadas);
  return proj;
}

/** Parte do projeto que vai ao worker; o resto é estado de interface. */
export function baseOf(p: AppProj): Project {
  const { meta, rows, log, codes, segs, segOf, crs, x, y, kmNum, kmLab } = p;
  return { meta, rows, log, codes, segs, segOf, crs, x, y, kmNum, kmLab };
}

/** Polígonos que falharam na validação ficam no log da planilha (um só registro, refeito a cada geometria). */
export function registrarInvalidos(p: Pick<AppProj, 'log' | 'kmLab'>, c: Camadas) {
  p.log = p.log.filter((l) => l.code !== 'poligonos-invalidos');
  const inv = c.invalidos ?? [];
  if (!inv.length) return;
  const porLinha = new Map<number, string>();
  for (const x of inv) if (!porLinha.has(x.row)) porLinha.set(x.row, x.motivo);
  const nome: Record<string, string> = { curto: 'menos de 1 m', cruzado: 'cruzado', 'sem-area': 'sem área' };
  const lista = [...porLinha].slice(0, 30).map(([r, m]) => `${p.kmLab[r]} (${nome[m] ?? m})`).join(', ');
  p.log.push({ level: 'warn', code: 'poligonos-invalidos', msg: `${inv.length} polígono${inv.length > 1 ? 's' : ''} em ${porLinha.size} segmento${porLinha.size > 1 ? 's' : ''} não passou${inv.length > 1 ? 'aram' : ''} na validação (anel simples, comprimento acima de 1 m); desenhado${inv.length > 1 ? 's' : ''} só a linha central. Km: ${lista}${porLinha.size > 30 ? ` e mais ${porLinha.size - 30}` : ''}` });
}

/** Aplica o resultado de uma nova geometria ao projeto. */
export function aplicarGeometria(p: AppProj, r: { opts: GeoOptions; normals: (Normais | null)[]; camadas: Camadas }) {
  p.opts = r.opts;
  registrarInvalidos(p, r.camadas);
  p.normals = r.normals;
  p.camadas = r.camadas;
  p.polyByFid = new Map();
  for (const f of r.camadas.polys.features) p.polyByFid.set(f.properties.fid as number, f as unknown as Feature);
}
