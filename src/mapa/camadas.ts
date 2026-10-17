import type { FC } from '../geometry/geojson';
import { drainsToGeoJSON, polysToGeoJSON } from '../geometry/geojson';
import { edgesOf, offsetLL, type Geometry } from '../geometry/build';
import type { Project } from '../geometry/project';
import { classProps, IND_KEYS, IND } from '../dominio/indicadores';
import { modelOf } from '../dominio/modelo';

/** Janela, em pontos, de cada linha da visão geral (100 m). */
export const LINE_WIN = 5;

export interface Camadas {
  polys: FC;
  lines: FC;
  drains: FC;
  /** Polígonos que falharam na validação e foram desenhados só como linha central. */
  invalidos: { row: number; lane: number; motivo: string }[];
}

/** Converte a geometria em camadas GeoJSON para o MapLibre. Sem acesso a DOM: roda no worker. */
export function buildCamadas(p: Project, g: Geometry, pid: string): Camadas {
  const R = p.rows;
  const M = modelOf(R);
  const polys = polysToGeoJSON(
    p, g,
    (q) => {
      const tr = q.lane ? M[q.row].tr[q.lane - 1] : M[q.row].sh;
      const o: Record<string, unknown> = { main: tr?.main ?? '-', pct: q.lane && tr ? tr.pct : 100 };
      if (q.lane) Object.assign(o, classProps(R[q.row].lanes[q.lane - 1]));
      return o;
    },
    pid,
  );

  const lines: FC['features'] = [];
  for (const sg of p.segs) {
    for (let w0 = sg.a; w0 < sg.b; w0 += LINE_WIN) {
      const w1 = Math.min(w0 + LINE_WIN, sg.b);
      const ed = edgesOf(R[w0], g.opts);
      for (let k = 0; k < ed.e.length - 1; k++) {
        const lane = k < ed.nLanes ? k + 1 : 0;
        const em = (ed.e[k] + ed.e[k + 1]) / 2;
        const coords: [number, number][] = [];
        for (let t = w0; t <= w1; t++) if (g.normals[t]) coords.push(offsetLL(p, g, t, em));
        if (coords.length < 2) continue;
        const cnt: Record<string, number> = {};
        const pctOf: Record<string, number> = {};
        const mx: Record<string, number> = Object.fromEntries(IND_KEYS.map((i) => [IND[i].prop, -1]));
        for (let t = w0; t < w1; t++) {
          const tr = lane ? M[t].tr[k] : M[t].sh;
          if (!tr) continue;
          cnt[tr.main] = (cnt[tr.main] || 0) + 1;
          pctOf[tr.main] = tr.pct;
          if (lane && R[t].lanes[k]) {
            const cp = classProps(R[t].lanes[k]);
            for (const q in mx) if (cp[q] > mx[q]) mx[q] = cp[q];
          }
        }
        let main = '-', best = -1;
        for (const m in cnt) {
          const sc = cnt[m] + (m !== '-' ? 0.5 : 0);
          if (sc > best) { best = sc; main = m; }
        }
        lines.push({
          type: 'Feature',
          properties: { pid, wid: w0 * 8 + (lane || 7), r0: w0, r1: w1 - 1, lane, k, main, pct: pctOf[main] || 100, ...mx },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    }
  }
  const invalidos = g.polys.filter((q) => q.invalido).map((q) => ({ row: q.row, lane: q.lane, motivo: q.invalido! }));
  return { polys, lines: { type: 'FeatureCollection', features: lines }, drains: drainsToGeoJSON(p, g.drains, pid), invalidos };
}
