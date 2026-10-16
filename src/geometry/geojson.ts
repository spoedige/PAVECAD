import type { DrainRun, Geometry, LanePoly } from './build';
import { lonLat } from './build';
import type { Project } from './project';

type Props = Record<string, unknown>;

export interface FC {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: Props; geometry: { type: 'Polygon' | 'LineString'; coordinates: unknown } }[];
}

/** Adaptador para MapLibre. `attrs` junta solução e parâmetros a cada polígono. */
export function polysToGeoJSON(p: Project, g: Geometry, attrs: (q: LanePoly) => Props = () => ({})): FC {
  return {
    type: 'FeatureCollection',
    features: g.polys.map((q) => ({
      type: 'Feature',
      properties: { pid: p.meta.name, fid: q.fid, row: q.row, lane: q.lane, ...attrs(q) },
      geometry: { type: 'Polygon', coordinates: [q.ring.map((pt) => lonLat(p, pt))] },
    })),
  };
}

export function drainsToGeoJSON(p: Project, runs: DrainRun[]): FC {
  return {
    type: 'FeatureCollection',
    features: runs.map((d) => ({
      type: 'Feature',
      properties: { t: d.type, pid: p.meta.name, r0: d.r0, r1: d.r1 },
      geometry: { type: 'LineString', coordinates: d.pts.map((pt) => lonLat(p, pt)) },
    })),
  };
}
