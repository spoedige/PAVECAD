import { describe, expect, it } from 'vitest';
import { prepareProject } from '../src/geometry/project';
import { modelOf } from '../src/dominio/modelo';
import type { PV } from '../src/dominio/analise';
import { addProposta, reposicionar, type Proposta } from '../src/dominio/propostas';
import type { ParsedProject } from '../src/formats/types';
import { lerPlanilha } from './helpers';

const ARQ = 'rr_go_crescente.xlsx';
const comoPV = (parsed: ParsedProject, id: string): PV => {
  const p = prepareProject(parsed);
  return { ...p, id, model: modelOf(p.rows) };
};
const original = lerPlanilha(ARQ);
const pv = comoPV(original, 'p1');

const prop = (id: string, r0: number, r1: number, lane = 1): Proposta => ({
  id, pname: pv.meta.name, pid: 'p1', lane, r0, r1, km0: pv.kmNum[r0], km1: pv.kmNum[r1], from: 'GAP', to: 'FS4', note: '', t: '',
});

describe('propostas ancoradas no km', () => {
  it('planilha igual: os índices voltam como estavam', () => {
    const [r] = reposicionar([prop('a', 10, 14)], [pv]);
    expect(r).toMatchObject({ pid: 'p1', r0: 10, r1: 14, orfa: false });
  });

  it('planilha recarregada com uma linha a menos no começo: reposiciona pelo km', () => {
    const menos = comoPV({ ...original, rows: original.rows.slice(1) }, 'p9');
    expect(menos.rows).toHaveLength(849);
    const [r] = reposicionar([prop('a', 10, 14)], [menos]);
    expect(r.orfa).toBe(false);
    expect(r.pid).toBe('p9');
    expect(r.r0).toBe(9);
    expect(r.r1).toBe(13);
    // o km guardado não muda, e aponta para as mesmas linhas da planilha original
    expect(r.km0).toBeCloseTo(pv.kmNum[10], 6);
    expect(menos.rows[r.r0].hod).toBeCloseTo(pv.rows[10].hod, 6);
    expect(menos.rows[r.r1].hod).toBeCloseTo(pv.rows[14].hod, 6);
  });

  it('proposta cujo km sumiu fica órfã, preservada e sem pid', () => {
    const menos = comoPV({ ...original, rows: original.rows.slice(1) }, 'p9');
    const lista = [prop('a', 0, 3), prop('b', 20, 25)];
    const out = reposicionar(lista, [menos]);
    const a = out.find((x) => x.id === 'a')!, b = out.find((x) => x.id === 'b')!;
    expect(out).toHaveLength(2); // nada é apagado
    expect(a.orfa).toBe(true);
    expect(a.pid).toBeNull();
    expect(a.km0).toBeCloseTo(pv.kmNum[0], 6);
    expect(b.orfa).toBe(false);
    expect(b.r0).toBe(19);
  });

  it('o fim do trecho também precisa existir', () => {
    const curta = comoPV({ ...original, rows: original.rows.slice(0, 100) }, 'p9');
    const [r] = reposicionar([prop('a', 90, 120)], [curta]);
    expect(r.orfa).toBe(true);
  });

  it('faixa que não existe mais torna a proposta órfã', () => {
    const umaFaixa = comoPV({ ...original, rows: original.rows.map((r) => ({ ...r, widths: [r.widths[0]], lanes: [r.lanes[0]] })) }, 'p9');
    const out = reposicionar([prop('a', 10, 14, 2), prop('b', 10, 14, 1)], [umaFaixa]);
    expect(out.find((x) => x.id === 'a')!.orfa).toBe(true);
    expect(out.find((x) => x.id === 'b')!.orfa).toBe(false);
  });

  it('planilha não carregada: fica guardada, sem ser órfã', () => {
    const [r] = reposicionar([prop('a', 10, 14)], []);
    expect(r).toMatchObject({ pid: null, orfa: false });
  });

  it('proposta órfã volta a valer quando o km reaparece', () => {
    const menos = comoPV({ ...original, rows: original.rows.slice(1) }, 'p9');
    const orfa = reposicionar([prop('a', 0, 3)], [menos]);
    expect(orfa[0].orfa).toBe(true);
    const volta = reposicionar(orfa, [pv]);
    expect(volta[0]).toMatchObject({ orfa: false, pid: 'p1', r0: 0, r1: 3 });
  });

  it('registro antigo, só com índices, é ancorado no km', () => {
    const { km0: _a, km1: _b, ...semKm } = prop('a', 10, 14);
    void _a; void _b;
    const [r] = reposicionar([semKm as Proposta], [pv]);
    expect(r.km0).toBeCloseTo(pv.kmNum[10], 6);
    expect(r.km1).toBeCloseTo(pv.kmNum[14], 6);
    expect(r.orfa).toBe(false);
  });

  it('proposta órfã não é tocada por uma proposta nova na mesma faixa', () => {
    const menos = comoPV({ ...original, rows: original.rows.slice(1) }, 'p9');
    const [orfa] = reposicionar([prop('a', 0, 3)], [menos]);
    const nova: Proposta = { ...prop('n', 0, 2), pid: 'p9', km0: menos.kmNum[0], km1: menos.kmNum[2], r0: 0, r1: 2 };
    const r = addProposta([orfa], nova, menos.kmNum);
    expect(r.removidas).toEqual([]);
    expect(r.list).toHaveLength(2);
    expect(r.list.find((x) => x.id === 'a')!.orfa).toBe(true);
  });

  it('marcos repetidos (9+1000 e 10+000, mesmo km) não quebram o reposicionamento', () => {
    const rows = original.rows.map((r) => ({ ...r }));
    expect(rows[98].marco).toBe('166+0');
    rows[99].marco = '165+1000'; // mesmo km da linha 98, depois de normalizar
    const dup = comoPV({ ...original, rows }, 'p9');
    expect(dup.kmNum[99]).toBeCloseTo(dup.kmNum[98], 9);
    const out = reposicionar([{ ...prop('a', 99, 101), km0: dup.kmNum[99], km1: dup.kmNum[101] }], [dup]);
    expect(out[0].orfa).toBe(false);
    expect(out[0].r1).toBe(101);
    // com o km repetido, vale a primeira ocorrência: no máximo uma linha de diferença
    expect([98, 99]).toContain(out[0].r0);
  });
});
