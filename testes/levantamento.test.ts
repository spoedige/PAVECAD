import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheetAll } from '../src/formats';
import { janela, levantamentoCsv, levantar } from '../src/dominio/levantamento';
import { prepareProject } from '../src/geometry/project';
import { modelOf } from '../src/dominio/modelo';
import { segmentsOf } from '../src/formats/segments';
import { kmLabel } from '../src/formats';
import type { PV } from '../src/dominio/analise';

const { gerarPlanservi } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as { gerarPlanservi: (o: Record<string, unknown>) => Buffer };

function projeto(): PV {
  const [cr] = parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10 })));
  const p = prepareProject(cr);
  return { id: 'p1', meta: p.meta, rows: p.rows, model: modelOf(p.rows), segs: segmentsOf(p.rows.map((r) => r.hod)), kmLab: p.kmLab, kmNum: p.kmNum };
}

describe('levantamento localizado', () => {
  const p = projeto();
  it('alcance: o segmento pressionado no meio, sem sair do trecho', () => {
    expect(janela(p, 30, 0)).toEqual([30, 30]);
    expect(janela(p, 30, 100)).toEqual([28, 32]);
    expect(janela(p, 30, 500)).toEqual([18, 42]);
    expect(janela(p, 2, 500)).toEqual([0, 24]);
    const [a, b] = janela(p, 30, 1000);
    expect(b - a + 1).toBe(50);
  });

  it('um segmento: uma linha por faixa e o acostamento, com km, área e solução', () => {
    const t = levantar(p, 30, 0, kmLabel);
    const nFx = p.rows[30].widths.length;
    expect(t.length).toBe(nFx + (p.rows[30].shoulder > 0 ? 1 : 0));
    for (const x of t) { expect(x.r0).toBe(30); expect(x.r1).toBe(30); expect(x.ext).toBe(20); expect(x.kmIni).toBe(p.kmLab[30]); expect(x.area).toBeCloseTo((x.larg ?? 0) * 20, 6); }
    const f1 = t.find((x) => x.lane === 1)!;
    expect(f1.codigo).toBe(p.model[30].tr[0].code);
  });

  it('um trecho maior junta linhas contíguas com o mesmo código e soma a área', () => {
    const t = levantar(p, 30, 500, kmLabel), f1 = t.filter((x) => x.lane === 1);
    expect(f1.reduce((s, x) => s + x.ext, 0)).toBe(500);
    for (let k = 1; k < f1.length; k++) { expect(f1[k].r0).toBe(f1[k - 1].r1 + 1); expect(f1[k].codigo).not.toBe(f1[k - 1].codigo); }
  });

  it('CSV do recorte: ";" e vírgula decimal, uma linha por trecho', () => {
    const t = levantar(p, 30, 100, kmLabel), csv = levantamentoCsv(t, 'RD-001 · TH01 · Crescente');
    const [cab, ...rows] = csv.split('\n');
    expect(cab.startsWith('Planilha;Faixa;Km inicial;Km final;Extensão (m);Largura (m);Área (m²);Código;Solução;Classe;Camadas;')).toBe(true);
    expect(rows).toHaveLength(t.length);
    for (const r of rows) expect(r.replace(/"[^"]*(""[^"]*)*"/g, '""').split(';')).toHaveLength(cab.split(';').length);
    expect(rows[0]).toMatch(/;\d+,\d{2};\d+,\d;/);
  });
});
