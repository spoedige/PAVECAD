import { describe, expect, it } from 'vitest';
import { FORMATS, parseCode, parseMarco, kmLabel, segmentsOf } from '../src/formats';
import { dado, lerPlanilha, toLegacy } from './helpers';

/** Compara estruturas; números diferem até 0,011 (o Python arredonda meios-casos diferente do JS). */
function igual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.011;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => igual(x, b[i]));
  return a === b;
}

const CRESC = 'U_BR-050_GO_Crescente.xlsx';
const DECR = 'U_BR-050_GO_Decrescente.xlsx';

describe('registro FORMATS', () => {
  it('traz o padrão RoadRunner', () => {
    expect(FORMATS.map((f) => f.id)).toEqual(['roadrunner']);
  });
});

describe.each([
  [CRESC, 'BR-050/GO - Crescente', 1, 'go_c.json'],
  [DECR, 'BR-050/GO - Decrescente', -1, 'go_d.json'],
] as const)('leitura %s', (arq, nome, travel, json) => {
  const p = lerPlanilha(arq);

  it('lê 850 linhas, 2 faixas e 1 trecho contínuo', () => {
    expect(p.meta.name).toBe(nome);
    expect(p.meta.travel).toBe(travel);
    expect(p.meta.uf).toBe('BR-050/GO');
    expect(p.rows).toHaveLength(850);
    expect(p.rows.every((r) => r.lanes.length === 2 && r.widths.length === 2)).toBe(true);
    expect(segmentsOf(p.rows.map((r) => r.hod))).toEqual([{ a: 0, b: 849 }]);
    expect(p.rows[0].hod).toBe(164);
    expect(p.rows[849].hod).toBeCloseTo(180.98, 6);
  });

  it('deixa z vazio e coordenadas válidas', () => {
    expect(p.rows.every((r) => r.z === null && r.lat < -17 && r.lat > -18 && r.lon < -47)).toBe(true);
  });

  it('reproduz os JSON de referência do protótipo', () => {
    const ref = dado(json);
    expect(p.meta.name).toBe(ref.meta.name);
    expect(p.rows).toHaveLength(ref.rows.length);
    const dif: number[] = [];
    p.rows.forEach((r, i) => {
      if (!igual(toLegacy(r), ref.rows[i])) dif.push(i);
    });
    // A única diferença admitida é o acostamento do primeiro ponto (regra v3.2).
    for (const i of dif) {
      const b = [...ref.rows[i]] as unknown[];
      b[4] = p.rows[i].shoulder;
      expect(igual(toLegacy(p.rows[i]), b)).toBe(true);
      expect(i).toBe(0);
    }
  });

  it('normaliza marcos', () => {
    expect(p.rows[0].marco).toBe('164+0');
    expect(parseMarco(p.rows[0].marco)).toBe(164);
  });

  it('une as colunas de dreno e aceita só a coluna 16', () => {
    const tipos = new Set<string>();
    for (const r of p.rows) if (r.drain) {
      expect(r.drain[0]).toBeNull();
      tipos.add(r.drain[1]!);
    }
    expect([...tipos].sort()).toEqual(['P', 'R']);
  });

  it('registra códigos de solução, inclusive FS3 e REC', () => {
    expect(p.codes.FS3).toBeGreaterThan(0);
    expect(p.codes.REC).toBeGreaterThan(0);
    expect(p.codes.GAP).toBeGreaterThan(0);
  });
});

describe('regras do handoff v3.2', () => {
  it('Decrescente: acostamento 0 no primeiro ponto assume o próximo valor', () => {
    const p = lerPlanilha(DECR);
    expect(p.rows[0].shoulder).toBe(2.5);
    expect(p.log.some((l) => l.code === 'acostamento-primeiro-ponto')).toBe(true);
  });

  it('Crescente: acostamento do primeiro ponto vem da planilha, sem ajuste', () => {
    const p = lerPlanilha(CRESC);
    expect(p.rows[0].shoulder).toBe(2.5);
    expect(p.log.some((l) => l.code === 'acostamento-primeiro-ponto')).toBe(false);
  });

  it('Decrescente: ignora a linha extra da Solução e registra no log', () => {
    const p = lerPlanilha(DECR);
    const l = p.log.find((x) => x.code === 'solucao-sem-par');
    expect(l?.msg).toMatch(/^1 linha da Solução sem par/);
  });

  it('marco 9+1000 vira 10+000', () => {
    expect(parseMarco('9+1000')).toBe(10);
    expect(kmLabel(parseMarco('9+1000')!)).toBe('10+000');
    expect(kmLabel(parseMarco('180+1000')!)).toBe('181+000');
  });

  it('aceita qualquer código principal alfanumérico', () => {
    expect(parseCode('FS3(50%)+Micro')).toMatchObject({ main: 'FS3', pct: 50, comp: 'Micro' });
    expect(parseCode('XYZ9')).toMatchObject({ main: 'XYZ9', pct: 100 });
    expect(parseCode('GAP(3,0)').main).toBe('GAP');
    expect(parseCode(null).main).toBe('-');
  });
});

describe('trechos', () => {
  it('quebra quando o salto passa de 21,5 m', () => {
    expect(segmentsOf([0, 0.02, 0.04, 0.0615 + 0.0001, 0.1])).toEqual([{ a: 0, b: 2 }, { a: 3, b: 3 }, { a: 4, b: 4 }]);
    expect(segmentsOf([0, 0.02, 0.04])).toEqual([{ a: 0, b: 2 }]);
  });
});
