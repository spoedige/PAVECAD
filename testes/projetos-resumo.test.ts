import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheetAll } from '../src/formats';
import { consolidar, resumoDoProjeto, resumoQualidade } from '../src/dominio/projetosResumo';
import { prepareProject } from '../src/geometry/project';
import { modelOf } from '../src/dominio/modelo';
import { segmentsOf } from '../src/formats/segments';
import type { PV } from '../src/dominio/analise';

const { gerarPlanservi } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as { gerarPlanservi: (o: Record<string, unknown>) => Buffer };

function projetos(): PV[] {
  return parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10 }))).map((pr, i) => {
    const p = prepareProject(pr);
    return { id: 'p' + i, meta: p.meta, rows: p.rows, model: modelOf(p.rows), segs: segmentsOf(p.rows.map((r) => r.hod)), kmLab: p.kmLab, kmNum: p.kmNum };
  });
}

describe('resumo do projeto', () => {
  const [c, d] = projetos();
  it('extensão, área e fatias que somam 100%', () => {
    const r = resumoDoProjeto(c);
    expect(r.ext).toBeGreaterThan(1); expect(r.area).toBeGreaterThan(1000);
    expect(r.fatias.reduce((s, f) => s + f.pct, 0)).toBeCloseTo(100, 6);
    for (let i = 1; i < r.fatias.length; i++) expect(r.fatias[i - 1].area).toBeGreaterThanOrEqual(r.fatias[i].area);
    expect(r.fatias.reduce((s, f) => s + f.area, 0)).toBeCloseTo(r.area, 6);
  });
  it('médias só dos indicadores que a planilha tem (Planservi: IGG, FC-2, FC-3, IRI, ATR)', () => {
    const r = resumoDoProjeto(c);
    expect(Object.keys(r.medias).sort()).toEqual(expect.arrayContaining(['atr', 'fc2', 'fc3', 'igg', 'iri']));
    expect(r.medias.iri).toBeGreaterThan(0);
  });
  it('consolidado soma as planilhas', () => {
    const a = resumoDoProjeto(c), b = resumoDoProjeto(d), t = consolidar([c, d]);
    expect(t.n).toBe(2); expect(t.area).toBeCloseTo(a.area + b.area, 6); expect(t.ext).toBeCloseTo(a.ext + b.ext, 6);
  });
  it('qualidade: reconstruídos e alertas', () => {
    expect(resumoQualidade(undefined)).toEqual({ reconstruidos: 0, alertas: 0 });
    expect(resumoQualidade({ saltos: [{ i: 1, km: 'a', kmFim: 'b', dist: 50 }], sentidos: [], faixaSalto: [0, 1], maxSentidos: 1, corrigidos: [{ i: 0, km: 'x', tipo: 'repetido', deslocamento: 5, orig: [0, 0] }], cortes: [], avisos: [{ tipo: 'passo', km: 'a', kmFim: 'b', dist: 1, esperado: 20 }] }))
      .toEqual({ reconstruidos: 1, alertas: 2 });
  });
});
