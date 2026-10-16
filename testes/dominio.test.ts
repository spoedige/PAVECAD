import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';
import { modelOf } from '../src/dominio/modelo';
import { contarPlataformas, criticos, matriz, REGRAS, resumo, violacoes, type PV } from '../src/dominio/analise';
import { addProposta, propostasCsv, runAt, runStats, type Proposta } from '../src/dominio/propostas';
import { localizar, type LocP } from '../src/dominio/localizar';
import { areaM2, distM, fmtLen, lenM } from '../src/dominio/medidas';
import { fromUtm, toUtm } from '../src/geometry/utm';
import { lerPlanilha } from './helpers';

function carregar(arq: string, id = 'p1') {
  const proj = prepareProject(lerPlanilha(arq));
  const g = buildGeometry(proj);
  const pv: PV = { ...proj, id, model: modelOf(proj.rows) };
  const lp: LocP = { ...proj, id, opts: g.opts, normals: g.normals, visible: true };
  return { pv, lp };
}
const { pv, lp } = carregar('U_BR-050_GO_Crescente.xlsx');

describe('medidas', () => {
  it('distância, comprimento e área', () => {
    expect(distM([-47, -17], [-47, -17.001])).toBeCloseTo(111.2, 0);
    expect(lenM([[-47, -17], [-47, -17.001], [-47, -17.002]])).toBeCloseTo(222.4, 0);
    const quad = [[-47, -17], [-47 + 0.001, -17], [-47 + 0.001, -17 + 0.001], [-47, -17 + 0.001]];
    expect(areaM2(quad)).toBeGreaterThan(10000);
    expect(areaM2(quad)).toBeLessThan(12000);
    expect(fmtLen(950)).toBe('950 m');
    expect(fmtLen(1500)).toBe('1,50 km');
  });
});

describe('resumo e críticos', () => {
  it('soma extensão e área por solução', () => {
    const r = resumo([pv]);
    expect(r.nR).toBe(850);
    expect(r.ext).toBeCloseTo(17, 1);
    const area = Object.entries(r.st).filter(([k]) => k !== '-').reduce((s, [, v]) => s + v.area, 0);
    expect(area).toBeGreaterThan(0);
    expect(r.st.GAP.len).toBeGreaterThan(0);
    expect(r.drKm).toBeGreaterThan(5);
  });

  it('conta plataformas como uma ocorrência por sequência', () => {
    const poi = contarPlataformas(pv.rows);
    expect(poi.OAE).toBeGreaterThan(0);
    expect(poi.OAE).toBeLessThanOrEqual(pv.rows.filter((r) => r.platform === 'OAE').length);
  });

  it('lista os 5 piores IRI sem repetir pontos próximos', () => {
    const c = criticos([pv], 'iri');
    expect(c).toHaveLength(5);
    expect(c[0].v).toBeGreaterThanOrEqual(c[4].v);
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) expect(Math.abs(c[a].km - c[b].km)).toBeGreaterThan(0.2);
  });

  it('Rc crítico ordena do menor para o maior', () => {
    const c = criticos([pv], 'rc');
    expect(c[0].v).toBeLessThanOrEqual(c[4].v);
  });
});

describe('análise solução x patologias', () => {
  it('as classes somam o número de leituras', () => {
    const acc = matriz([pv], 'iri');
    for (const a of Object.values(acc)) expect(a.cls.reduce((s, x) => s + x, 0)).toBe(a.cnt);
    expect(Object.values(acc).reduce((s, a) => s + a.n, 0)).toBe(850 * 2);
  });

  it('seis regras de coerência, com contagem não negativa', () => {
    const v = violacoes([pv]);
    expect(v).toHaveLength(REGRAS.length);
    expect(v.every((x) => x.n >= 0)).toBe(true);
  });
});

describe('propostas de solução', () => {
  it('"run" seleciona o trecho contínuo com o mesmo código; "one" um segmento', () => {
    const i = pv.rows.findIndex((r) => r.lanes[0].code === 'FS3(100%)');
    const run = runAt(pv, i, 1, 'run');
    expect(run.r0).toBeLessThanOrEqual(i);
    expect(run.r1).toBeGreaterThanOrEqual(i);
    for (let k = run.r0; k <= run.r1; k++) expect(pv.rows[k].lanes[0].code).toBe('FS3(100%)');
    if (run.r0 > 0) expect(pv.rows[run.r0 - 1].lanes[0].code).not.toBe('FS3(100%)');
    expect(run.from).toBe('FS3');
    const one = runAt(pv, i, 1, 'one');
    expect(one.r0).toBe(i);
    expect(one.r1).toBe(i);
  });

  it('estatística: extensão e área', () => {
    const s = runStats(pv, { lane: 1, r0: 10, r1: 14 });
    expect(s.len).toBe(100);
    expect(s.area).toBeCloseTo(100 * 3.6, 6);
    expect(runStats(pv, { lane: 0, r0: 10, r1: 10 }).area).toBeCloseTo(20 * 2.5, 6);
  });

  const base = (id: string, r0: number, r1: number, lane = 1): Proposta => ({ id, pname: pv.meta.name, pid: 'p1', lane, r0, r1, km0: pv.kmNum[r0], km1: pv.kmNum[r1], from: 'GAP', to: 'FS4', note: '', t: '' });

  it('proposta nova substitui só a parte sobreposta', () => {
    const a = addProposta([], base('a', 10, 30), pv.kmNum);
    const b = addProposta(a.list, base('b', 15, 20), pv.kmNum);
    expect(b.removidas).toEqual(['a']);
    const faixas = b.list.map((x) => [x.r0, x.r1]).sort((x, y) => x[0] - y[0]);
    expect(faixas).toEqual([[10, 14], [15, 20], [21, 30]]);
    expect(b.novas).toHaveLength(3);
    // os pedaços restantes continuam ancorados no km
    const esq = b.list.find((x) => x.r0 === 10)!, dir = b.list.find((x) => x.r0 === 21)!;
    expect(esq.km0).toBeCloseTo(pv.kmNum[10], 6);
    expect(esq.km1).toBeCloseTo(pv.kmNum[14], 6);
    expect(dir.km0).toBeCloseTo(pv.kmNum[21], 6);
    expect(dir.km1).toBeCloseTo(pv.kmNum[30], 6);
  });

  it('não mexe em outra faixa nem em área sem sobreposição', () => {
    const a = addProposta([], base('a', 10, 30, 1), pv.kmNum);
    const b = addProposta(a.list, base('b', 15, 20, 2), pv.kmNum);
    const c = addProposta(b.list, base('c', 40, 50, 1), pv.kmNum);
    expect(c.removidas).toEqual([]);
    expect(c.list).toHaveLength(3);
  });

  it('exporta CSV com ponto e vírgula e vírgula decimal', () => {
    const csv = propostasCsv([base('a', 10, 14)], () => pv, (p) => p.meta.name, (k) => k);
    const [head, linha] = csv.split('\n');
    expect(head.split(';')).toHaveLength(20);
    expect(head).toContain('codigo_atual');
    expect(linha).toContain('"GAP"');
    expect(linha).toContain('"FS4"');
    expect(linha).toContain(';1;');
    expect(linha).toContain('360'); // 100 m x 3,6 m
    expect(linha).toContain('3,6');
  });
});

describe('localização por GPS', () => {
  it('acha planilha, km e faixa a partir de uma posição sobre a Fx 1', () => {
    const i = 300;
    const n = lp.normals[i]!;
    const x = lp.x[i] + 1.8 * n.e, y = lp.y[i] + 1.8 * n.n; // meio da Fx 1
    const [lat, lon] = fromUtm(lp.crs, x, y);
    const l = localizar([lp], lat, lon)!;
    expect(l.p.id).toBe('p1');
    expect(l.i).toBe(i);
    expect(l.lane).toBe(1);
    const x2 = lp.x[i] + 5.4 * n.e, y2 = lp.y[i] + 5.4 * n.n; // Fx 2
    const [la2, lo2] = fromUtm(lp.crs, x2, y2);
    expect(localizar([lp], la2, lo2)!.lane).toBe(2);
    const x3 = lp.x[i] + 8.5 * n.e, y3 = lp.y[i] + 8.5 * n.n; // acostamento
    const [la3, lo3] = fromUtm(lp.crs, x3, y3);
    expect(localizar([lp], la3, lo3)!.lane).toBe(0);
  });

  it('fora da pista devolve lane nulo e a distância', () => {
    const i = 300, n = lp.normals[i]!;
    const [lat, lon] = fromUtm(lp.crs, lp.x[i] - 30 * n.e, lp.y[i] - 30 * n.n);
    const l = localizar([lp], lat, lon)!;
    expect(l.lane).toBeNull();
    expect(l.out).toBeGreaterThan(25);
    expect(l.out).toBeLessThan(35);
  });

  it('ignora planilhas ocultas', () => {
    expect(localizar([{ ...lp, visible: false }], lp.rows[0].lat, lp.rows[0].lon)).toBeNull();
  });

  it('toUtm continua consistente com o CRS do projeto', () => {
    const [x, y] = toUtm(lp.crs, lp.rows[5].lat, lp.rows[5].lon);
    expect(Math.abs(x - lp.x[5])).toBeLessThan(1e-6);
    expect(Math.abs(y - lp.y[5])).toBeLessThan(1e-6);
  });
});

describe('km digitado', () => {
  it('entende marco e decimal', async () => {
    const { parseKmTexto } = await import('../src/formats/km');
    expect(parseKmTexto('59+740')).toBeCloseTo(59.74, 9);
    expect(parseKmTexto('59+74')).toBeCloseTo(59.74, 9);
    expect(parseKmTexto('120')).toBe(120);
    expect(parseKmTexto('59,74')).toBeCloseTo(59.74, 9);
    expect(parseKmTexto(' 135.5 ')).toBe(135.5);
    expect(parseKmTexto('abc')).toBeNull();
    expect(parseKmTexto('')).toBeNull();
    expect(parseKmTexto('59+7400')).toBeNull();
  });
});
