import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheetAll } from '../src/formats';
import { mapearCabecalhos } from '../src/formats/planservi';
import { buildGeometry, DEFAULT_OPTS } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';
import { fixture } from './helpers';

/** Planilhas reais anonimizadas (scripts/anonimizar.cjs): o bloco decrescente é o espelho do crescente e o acostamento vem por último (coluna AF). */
const ARQUIVOS = ['planservi_th48_anon.xlsx', 'planservi_th45_anon.xlsx'];

describe('acostamento do sentido decrescente (Planservi)', () => {
  for (const arq of ARQUIVOS) {
    const [cres, decr] = parseSpreadsheetAll(new Uint8Array(readFileSync(fixture(arq))));

    it(`${arq}: os dois sentidos trazem o acostamento, com código, cor e largura`, () => {
      expect(cres.meta.travel).toBe(1);
      expect(decr.meta.travel).toBe(-1);
      const comCodigo = (p: typeof cres) => p.rows.filter((r) => r.shoulderCode && r.shoulderCode !== '-');
      expect(comCodigo(cres).length).toBeGreaterThan(100);
      // o decrescente tem a mesma estrutura de linhas: quase todas com acostamento (o ponto final vem sem dados próprios)
      expect(comCodigo(decr).length).toBeGreaterThan(comCodigo(cres).length * 0.95);
      for (const r of comCodigo(decr)) {
        expect(r.shoulder).toBeGreaterThan(0);
        expect(r.shoulderRaw).toMatch(/^(R|PMQ)\s?\d/);
        expect(r.shoulderCode).toBe('REF');
      }
    });

    it(`${arq}: o relatório de qualidade da importação conta as linhas com acostamento por sentido`, () => {
      for (const p of [cres, decr]) {
        const l = p.log.find((x) => x.code === 'planservi-acostamento')!;
        expect(l).toBeTruthy();
        expect(l.level).toBe('info');
        const n = p.rows.filter((r) => r.shoulderCode && r.shoulderCode !== '-').length;
        expect(l.msg).toContain(`${n} de ${p.rows.length} linhas`);
      }
    });

    it(`${arq}: o acostamento fica do lado externo da pista nos dois sentidos`, () => {
      for (const p of [cres, decr]) {
        const prep = prepareProject(p, { zone: 23 });
        const g = buildGeometry(prep, { ...DEFAULT_OPTS, travel: p.meta.travel });
        const i = g.polys.find((q) => q.lane === 0 && !q.invalido)!.row;
        const faixas = g.polys.filter((q) => q.row === i && q.lane > 0), ac = g.polys.find((q) => q.row === i && q.lane === 0)!;
        const fimDasFaixas = Math.max(...faixas.map((q) => Math.max(q.e0, q.e1)));
        expect(Math.min(ac.e0, ac.e1)).toBeGreaterThanOrEqual(fimDasFaixas - 1e-6);
      }
    });
  }

  it('a coluna do acostamento é a primeira com o rótulo, não a célula vazia que `preencher` repete à direita', () => {
    // linha 5: sentidos; linha 6: blocos; linha 7: camadas. O acostamento decrescente (AF) é seguido de uma célula vazia (AG)
    const n = 40, S: unknown[][] = Array.from({ length: 9 }, () => new Array(n).fill(null));
    S[4][9] = 'CRESCENTE'; S[4][21] = 'DECRESCENTE';
    S[5][0] = 'Segmento'; S[5][1] = 'Segmentos Homogêneos'; S[6][1] = 'Km';
    S[5][9] = 'Crescente - Acostamento / Acessos'; S[5][10] = 'Drenos'; S[5][11] = 'Crescente - Faixa 1'; S[6][11] = 'Estrutural';
    S[5][21] = 'Decrescente - Faixa 1'; S[6][21] = 'Estrutural'; S[5][30] = 'Drenos'; S[5][31] = 'Decrescente - Acostamento / Acessos';
    S[5][33] = 'Coordenadas (Crescente)'; S[6][33] = 'Latitude'; S[6][34] = 'Longitude';
    S[5][35] = 'Coordenadas (Decrescente)'; S[6][35] = 'Latitude'; S[6][36] = 'Longitude';
    const m = mapearCabecalhos(S);
    expect(m.acost.Crescente).toBe(9);
    expect(m.acost.Decrescente).toBe(31);
  });
});
