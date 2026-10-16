import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';
import { fromUtm } from '../src/geometry/utm';
import { segmentsOf } from '../src/formats';
import { projetoDeReferencia } from './helpers';

// BR-050/MG cruza o meridiano de -48 (limite entre os fusos 22S e 23S).
describe('BR-050/MG (referencia/dados)', () => {
  const pc = projetoDeReferencia('mg_c.json');

  it('tem 5.540 linhas e 2 trechos contínuos', () => {
    expect(pc.rows).toHaveLength(5540);
    expect(segmentsOf(pc.rows.map((r) => r.hod))).toHaveLength(2);
    expect(pc.rows.some((r) => r.lon < -48)).toBe(true);
    expect(pc.rows.some((r) => r.lon > -48)).toBe(true);
  });

  it('registra o fuso escolhido e avisa que cruza o limite', () => {
    const p = prepareProject(pc);
    expect(p.crs.source).toBe('mediana');
    const l = p.log.find((x) => x.code === 'fuso-utm')!;
    expect(l.level).toBe('warn');
    expect(l.msg).toContain(`${p.crs.zone}S`);
    expect(l.msg).toMatch(/cruza o limite entre os fusos 22S e 23S/);
  });

  it('fixa o fuso por projeto', () => {
    for (const zone of [22, 23]) {
      const p = prepareProject(pc, { zone });
      expect(p.crs).toMatchObject({ zone, source: 'fixo', epsg: 31960 + zone });
      expect(p.log.find((x) => x.code === 'fuso-utm')!.msg).toContain('informado');
    }
  });

  it('gera geometria igual nos dois fusos, dentro de 2 cm', () => {
    const a = prepareProject(pc, { zone: 22 });
    const b = prepareProject(pc, { zone: 23 });
    const ga = buildGeometry(a), gb = buildGeometry(b);
    expect(ga.polys.length).toBe(gb.polys.length);
    for (let k = 0; k < ga.polys.length; k += 211) {
      const [la, oa] = fromUtm(a.crs, ...ga.polys[k].ring[1]);
      const [lb, ob] = fromUtm(b.crs, ...gb.polys[k].ring[1]);
      expect(Math.abs(la - lb) * 111132).toBeLessThan(0.02);
      expect(Math.abs(oa - ob) * 100000).toBeLessThan(0.02);
    }
  });

  it('mantém largura e sem polígonos invertidos nos 2 trechos', () => {
    const p = prepareProject(pc, { zone: 22 });
    const g = buildGeometry(p);
    const sinais = new Set<number>();
    for (const q of g.polys) {
      let s = 0;
      for (let i = 0; i < 4; i++) s += q.ring[i][0] * q.ring[i + 1][1] - q.ring[i + 1][0] * q.ring[i][1];
      sinais.add(Math.sign(s));
    }
    expect(sinais.size).toBe(1);
  });

  it('lê as outras pistas', () => {
    expect(projetoDeReferencia('mg_d.json').rows).toHaveLength(5540);
    expect(projetoDeReferencia('mg_ms.json').meta.name).toMatch(/Marginal Sul/);
  });
});
