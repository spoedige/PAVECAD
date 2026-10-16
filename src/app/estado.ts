import type maplibregl from 'maplibre-gl';
import type { Feature } from 'geojson';
import type { GeoOptions } from '../geometry/build';
import type { Project } from '../geometry/project';
import type { Camadas } from '../mapa/camadas';
import type { Normais } from '../mapa/worker';
import type { RowModel } from '../dominio/modelo';
import type { ModeKey } from '../dominio/indicadores';
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
}

export interface Sel { pid: string; row: number; lane: number }
export type BaseKey = 'none' | 'osm' | 'esri';

export const E = {
  P: [] as AppProj[],
  seq: 0,
  mode: 'sol' as ModeKey,
  sel: null as Sel | null,
  dim: new Set<string>(),
  field: false,
  base: 'none' as BaseKey,
  activeGroup: null as string | null,
  layers: { drain: true, km: true, poi: true },
  mapReady: false,
};

export const visibleProjects = () => E.P.filter((p) => p.visible);
export const getP = (id: string) => E.P.find((p) => p.id === id);
const short = (p: AppProj) => (/Marginal/i.test(p.meta.via) ? p.meta.via.replace(/\s*-\s*Crescente|\s*-\s*Decrescente/, '') : p.meta.via);
export const projName = (p: AppProj) => `${p.meta.uf.split('/')[1] || p.meta.uf} ${short(p)}`;

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
  return {
    ...base, ...extra, id, label: base.meta.name, visible: true, model: modelOf(base.rows),
    polyByFid, bounds: [[x0, y0], [x1, y1]], markers: [],
  };
}
