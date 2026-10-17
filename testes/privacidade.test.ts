import { afterEach, describe, expect, it } from 'vitest';
import { atualizarRotulosKm, E, kmBase, kmFmt, kmReal, kmVis, projName, rodoviaNome, type AppProj } from '../src/app/estado';
import { CSV_CABECALHO, definirFormatoKm, propostasCsv, runLabel, type Proposta } from '../src/dominio/propostas';
import { kmLabel } from '../src/formats/km';
import type { PV } from '../src/dominio/analise';

const proj = (nome: string, uf: string, travel: 1 | -1, km0: number): AppProj => {
  const kmNum = Array.from({ length: 6 }, (_, i) => km0 + i * 0.02);
  return {
    id: nome, meta: { name: nome, uf, via: 'T', travel, kmi: km0, kmf: km0 + 0.1, format: 'planservi' }, kmNum, kmLab: kmNum.map(kmLabel),
    rows: kmNum.map((k) => ({ hod: k, lat: 0, lon: 0, widths: [3.6], shoulder: 0, lanes: [] })), model: [], segs: [], opts: { extra: 0 },
  } as unknown as AppProj;
};

afterEach(() => { E.privacidade = false; E.P = []; atualizarRotulosKm(); });

describe('modo privacidade', () => {
  it('desligado: nomes, rodovia e km saem como vieram', () => {
    E.P = [proj('SP-333 · TH01 · Crescente', 'SP-333', 1, 154.7)];
    atualizarRotulosKm();
    expect(projName(E.P[0])).toBe('SP-333 · TH01 · Crescente');
    expect(rodoviaNome('SP-333')).toBe('SP-333');
    expect(E.P[0].kmLab[1]).toBe('154+720');
    expect(kmBase()).toBe(0);
  });

  it('ligado: nome genérico, rodovia por letra e km contado do início da primeira planilha', () => {
    E.P = [proj('A', 'SP-333', 1, 154.7), proj('B', 'SP-351', -1, 190.2)];
    E.privacidade = true;
    atualizarRotulosKm();
    expect(projName(E.P[0])).toBe('Planilha 1 · Crescente');
    expect(projName(E.P[1])).toBe('Planilha 2 · Decrescente');
    expect(rodoviaNome('SP-333')).toBe('Rodovia A');
    expect(rodoviaNome('SP-351')).toBe('Rodovia B');
    expect(kmBase()).toBe(154);
    expect(E.P[0].kmLab[0]).toBe('0+700');
    expect(E.P[1].kmLab[0]).toBe('36+200');
    expect(kmFmt(155)).toBe('1+000');
    expect(kmReal(kmVis(155.5))).toBeCloseTo(155.5, 9);
  });

  it('o CSV de propostas usa o km mostrado e o nome genérico', () => {
    const p = proj('SP-333 · TH01 · Crescente', 'SP-333', 1, 154.7);
    E.P = [p];
    E.privacidade = true;
    atualizarRotulosKm();
    const pv = Object.assign(p, { id: 'p1', model: Array.from({ length: 6 }, () => ({ tr: [{ main: 'GAP', pct: 100 }], sh: { main: '-', pct: 100 } })) }) as unknown as PV;
    const prop: Proposta = { id: 'a', pname: p.meta.name, pid: 'p1', lane: 1, r0: 1, r1: 3, km0: p.kmNum[1], km1: p.kmNum[3], from: 'GAP', to: 'FS4', note: '', t: '' };
    expect(runLabel(pv, prop)).toBe('km 0+720 a 0+780');
    const csv = propostasCsv([prop], () => pv, projName, (k) => k, undefined, '\n');
    const [cab, linha] = csv.split('\n');
    expect(cab).toBe(CSV_CABECALHO.join(';'));
    expect(linha).toContain('"Planilha 1 · Crescente"');
    expect(linha).toContain(';0+720;0+780;');
    expect(csv).not.toMatch(/SP-333|154\+|155\+/);
  });

  it('desligado de novo, o CSV volta ao km real', () => {
    definirFormatoKm(kmLabel);
    const p = proj('X', 'SP-333', 1, 154.7);
    const pv = { ...p, id: 'p1' } as unknown as PV;
    expect(runLabel(pv, { r0: 1, r1: 3 })).toBe('km 154+720 a 154+780');
  });
});
