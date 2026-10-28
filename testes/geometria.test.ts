import { describe, expect, it } from 'vitest';
import { buildGeometry, edgesOf, DEFAULT_OPTS } from '../src/geometry/build';
import { polysToGeoJSON, drainsToGeoJSON } from '../src/geometry/geojson';
import { prepareProject, type Project } from '../src/geometry/project';
import { crsForZone, fromUtm, toUtm, zoneOf } from '../src/geometry/utm';
import type { ParsedProject, Row } from '../src/formats/types';
import { lerPlanilha } from './helpers';

const area = (ring: number[][]) => {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
};

describe('UTM SIRGAS 2000', () => {
  // Valores de referência: pyproj, EPSG:4674 para EPSG:31983 e 31982.
  it('confere com o pyproj', () => {
    const c23 = crsForZone(23);
    const casos: [number, number, number, number][] = [
      [-17.2873, -47.7573, 206861.1149549578, 8086564.754547687],
      [-17.5, -48.1, 170780.96266713156, 8062451.077331295],
      [-15.8, -47.9, 189303.9156132344, 8251045.076815761],
    ];
    for (const [lat, lon, x, y] of casos) {
      const [e, n] = toUtm(c23, lat, lon);
      expect(Math.abs(e - x)).toBeLessThan(0.002);
      expect(Math.abs(n - y)).toBeLessThan(0.002);
    }
    const [e, n] = toUtm(crsForZone(22), -17.0, -48.3);
    expect(Math.abs(e - 787485.5547429554)).toBeLessThan(0.002);
    expect(Math.abs(n - 8118463.4686075235)).toBeLessThan(0.002);
  });

  it('ida e volta com erro submilimétrico', () => {
    const c = crsForZone(23);
    const [x, y] = toUtm(c, -17.2873, -47.7573);
    const [lat, lon] = fromUtm(c, x, y);
    expect(Math.abs(lat + 17.2873)).toBeLessThan(1e-9);
    expect(Math.abs(lon + 47.7573)).toBeLessThan(1e-9);
  });

  it('escolhe o fuso e o EPSG', () => {
    expect(zoneOf(-47.76)).toBe(23);
    expect(crsForZone(23).epsg).toBe(31983);
    expect(crsForZone(22).epsg).toBe(31982);
  });
});

function reta(travel: 1 | -1, n = 10): Project {
  // Linha reta para o norte, 20 m entre pontos, 2 faixas de 3,5 m e acostamento de 2,5 m.
  const crs = crsForZone(23);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const [lat, lon] = fromUtm(crs, 300000, 8000000 + i * 20);
    rows.push({
      hod: i * 0.02, lat, lon, z: null, widths: [3.5, 3.5], shoulder: 2.5, shoulderCode: null, obs: null, platform: null,
      lanes: [], marco: `0+${String(i * 20).padStart(3, '0')}`, drain: i >= 3 && i <= 6 ? [null, 'R'] : null, he: [null, null],
    });
  }
  const parsed: ParsedProject = {
    meta: { name: 'teste', uf: 'T', via: 'T', travel, kmi: 0, kmf: 0.2, format: 'teste' }, rows, log: [], codes: {},
  };
  return prepareProject(parsed);
}

describe('geometria: reta ao norte', () => {
  it('crescente: faixas crescem para o leste, coladas e com a largura certa', () => {
    const p = reta(1);
    const g = buildGeometry(p);
    expect(g.polys).toHaveLength(9 * 3);
    const q = g.polys.filter((x) => x.row === 2).sort((a, b) => a.lane - b.lane);
    expect(q.map((x) => x.lane)).toEqual([0, 1, 2].sort((a, b) => a - b));
    const f1 = g.polys.find((x) => x.row === 2 && x.lane === 1)!;
    const f2 = g.polys.find((x) => x.row === 2 && x.lane === 2)!;
    const sh = g.polys.find((x) => x.row === 2 && x.lane === 0)!;
    expect(f1.ring[0][0]).toBeCloseTo(300000, 3);
    expect(f1.ring[1][0]).toBeCloseTo(300003.5, 3);
    expect(f2.ring[1][0]).toBeCloseTo(300007, 3);
    expect(sh.ring[1][0]).toBeCloseTo(300009.5, 3);
    expect(f1.ring[1]).toEqual(f2.ring[0]);
    expect(Math.abs(area(f1.ring))).toBeCloseTo(3.5 * 20, 2);
  });

  it('decrescente: inverte a normal lateral', () => {
    const g = buildGeometry(reta(-1));
    const f1 = g.polys.find((x) => x.row === 2 && x.lane === 1)!;
    expect(f1.ring[1][0]).toBeCloseTo(300000 - 3.5, 3);
  });

  it('origem no eixo e deslocamento extra', () => {
    const g = buildGeometry(reta(1), { origin: 'axis', extra: 12 });
    const f1 = g.polys.find((x) => x.row === 2 && x.lane === 1)!;
    expect(f1.e0).toBeCloseTo(-1.75 + 12, 6);
    expect(f1.ring[0][0]).toBeCloseTo(300000 + 10.25, 3);
  });

  it('oculta o acostamento sob demanda', () => {
    expect(buildGeometry(reta(1), { shoulder: false }).polys).toHaveLength(9 * 2);
  });

  it('drenos no lado externo, um trecho por sequência', () => {
    const p = reta(1);
    const g = buildGeometry(p);
    expect(g.drains).toHaveLength(1);
    expect(g.drains[0].type).toBe('R');
    expect(g.drains[0].r0).toBe(3);
    // 7 + 2,5 de acostamento + 0,45 de afastamento
    expect(g.drains[0].pts[0][0]).toBeCloseTo(300000 + 7 + 2.5 + 0.45, 3);
    const gi = buildGeometry(p, { drainSide: 'in' });
    expect(gi.drains[0].pts[0][0]).toBeCloseTo(300000 - 0.45, 3);
  });

  it('exporta GeoJSON em lon/lat', () => {
    const p = reta(1);
    const g = buildGeometry(p);
    const fc = polysToGeoJSON(p, g, (q) => ({ lane: q.lane }));
    expect(fc.features).toHaveLength(g.polys.length);
    const c = fc.features[0].geometry.coordinates as number[][][];
    expect(c[0][0][0]).toBeCloseTo(p.rows[0].lon, 5);
    expect(drainsToGeoJSON(p, g.drains).features).toHaveLength(1);
  });
});

describe('geometria: planilhas GO', () => {
  for (const [arq, travel] of [['rr_go_crescente.xlsx', 1], ['rr_go_decrescente.xlsx', -1]] as const) {
    describe(arq, () => {
      const p = prepareProject(lerPlanilha(arq));
      const g = buildGeometry(p);

      it('usa o fuso 23S (EPSG 31983)', () => {
        expect(p.crs.epsg).toBe(31983);
        expect(p.kmLab[0]).toBe('164+0'.replace('164+0', '164+000'));
      });

      it('gera 3 polígonos por segmento de 20 m (2 faixas e acostamento)', () => {
        expect(g.polys).toHaveLength(849 * 3);
        expect(g.opts.travel).toBe(travel);
      });

      it('mantém faixas coladas, sem inverter e com área próxima de largura x 20 m', () => {
        const sinais = new Set<number>();
        for (const q of g.polys) {
          const a = area(q.ring);
          sinais.add(Math.sign(a));
          const larg = Math.abs(q.e1 - q.e0);
          const comp = Math.hypot(p.x[q.row + 1] - p.x[q.row], p.y[q.row + 1] - p.y[q.row]);
          expect(Math.abs(a)).toBeGreaterThan(larg * comp * 0.9);
          expect(Math.abs(a)).toBeLessThan(larg * comp * 1.1);
        }
        expect(sinais.size).toBe(1);
        for (let i = 0; i < 848; i += 37) {
          const f1 = g.polys.find((x) => x.row === i && x.lane === 1)!;
          const f2 = g.polys.find((x) => x.row === i && x.lane === 2)!;
          expect(f1.ring[1]).toEqual(f2.ring[0]);
        }
      });

      it('mantém a largura da seção nos vértices', () => {
        const f = g.polys.find((x) => x.row === 100 && x.lane === 1)!;
        expect(Math.hypot(f.ring[1][0] - f.ring[0][0], f.ring[1][1] - f.ring[0][1])).toBeCloseTo(3.6, 2);
      });

      it('sai pelo lado direito do sentido de tráfego', () => {
        // Normal à direita: produto vetorial (direção do tráfego x deslocamento) negativo no plano.
        const i = 300, f = g.polys.find((x) => x.row === i && x.lane === 1)!;
        const dx = (p.x[i + 1] - p.x[i - 1]) * travel, dy = (p.y[i + 1] - p.y[i - 1]) * travel;
        const ox = f.ring[1][0] - f.ring[0][0], oy = f.ring[1][1] - f.ring[0][1];
        expect(dx * oy - dy * ox).toBeLessThan(0);
      });

      it('traz drenos com tipo R ou P', () => {
        expect(g.drains.length).toBeGreaterThan(0);
        expect(g.drains.every((d) => d.type === 'R' || d.type === 'P')).toBe(true);
      });
    });
  }

  it('edgesOf respeita as opções', () => {
    const p = prepareProject(lerPlanilha('rr_go_crescente.xlsx'));
    const e = edgesOf(p.rows[0], DEFAULT_OPTS);
    expect(e.e).toEqual([0, 3.6, 7.2, 9.7]);
  });
});
