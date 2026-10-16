import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';
import { buildCamadas, LINE_WIN } from '../src/mapa/camadas';
import { lerPlanilha } from './helpers';

describe('camadas do mapa (GO Crescente)', () => {
  const p = prepareProject(lerPlanilha('U_BR-050_GO_Crescente.xlsx'));
  const g = buildGeometry(p);
  const c = buildCamadas(p, g, 'p1');

  it('gera um polígono por faixa e acostamento, com classes e solução pré-calculadas', () => {
    expect(c.polys.features).toHaveLength(849 * 3);
    const f = c.polys.features.find((x) => x.properties.lane === 1)!;
    for (const k of ['pid', 'fid', 'row', 'lane', 'main', 'pct', 'c_iri', 'c_atr', 'c_d0', 'c_rc', 'c_def']) expect(f.properties).toHaveProperty(k);
    expect(f.properties.pid).toBe('p1');
    const sh = c.polys.features.find((x) => x.properties.lane === 0)!;
    expect(sh.properties).not.toHaveProperty('c_iri');
  });

  it('fids são únicos', () => {
    expect(new Set(c.polys.features.map((x) => x.properties.fid)).size).toBe(c.polys.features.length);
  });

  it('gera linhas por janela de 100 m para a visão geral', () => {
    const janelas = Math.ceil(849 / LINE_WIN);
    expect(c.lines.features.length).toBeGreaterThanOrEqual(janelas * 3 - 3);
    expect(c.lines.features.every((l) => (l.geometry.coordinates as unknown[]).length >= 2)).toBe(true);
    expect(new Set(c.lines.features.map((x) => x.properties.wid)).size).toBe(c.lines.features.length);
  });

  it('classes ficam entre -1 e 4', () => {
    for (const f of c.polys.features) for (const k of ['c_iri', 'c_atr', 'c_d0', 'c_rc', 'c_def']) {
      const v = f.properties[k] as number | undefined;
      if (v !== undefined) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(4); }
    }
  });

  it('desenha os drenos com o pid do projeto', () => {
    expect(c.drains.features.length).toBeGreaterThan(0);
    expect(c.drains.features.every((d) => d.properties.pid === 'p1')).toBe(true);
  });
});
