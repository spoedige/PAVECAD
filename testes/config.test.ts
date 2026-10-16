import { afterEach, describe, expect, it } from 'vitest';
import * as cat from '../src/dominio/catalogo';
import { trColor, trLabel, trOrder, trShort } from '../src/dominio/solucoes';
import { aplicarLarguras, contarAlteradas, larguraPadrao, validarAjuste, type AjusteLargura } from '../src/dominio/larguras';
import { classProps, getLimites, IND, LIMITES_PADRAO, restaurarLimites, setLimites, validarLimites } from '../src/dominio/indicadores';
import { prepareProject } from '../src/geometry/project';
import { buildGeometry } from '../src/geometry/build';
import { resumo, type PV } from '../src/dominio/analise';
import { modelOf } from '../src/dominio/modelo';
import { lerPlanilha } from './helpers';

afterEach(() => { cat.restaurarPadrao(false); restaurarLimites(); });

describe('catálogo de soluções', () => {
  it('traz o padrão RoadRunner', () => {
    expect(trOrder()).toEqual(['FS3', 'FS4', 'FSE', 'MFS', 'RP', 'REC', 'Micro', 'GAP']);
    expect(trLabel('GAP')).toBe('Gap graded');
    expect(trLabel('-')).toBe('Sem intervenção');
    expect(trColor('Micro', false, '#ccc')).toBe('#ffcc00');
    expect(trColor('-', false, '#ccc')).toBe('#ccc');
  });

  it('GAP aparece como "Reforço" só no rótulo; o código original continua o mesmo', () => {
    cat.definir({ codigo: 'GAP', nome: 'Reforço (gap graded)', curto: 'Reforço' });
    expect(trLabel('GAP')).toBe('Reforço (gap graded)');
    expect(trShort('GAP')).toBe('Reforço');
    expect(cat.get('GAP').codigo).toBe('GAP');
    expect(cat.exportar().itens.find((i) => i.codigo === 'GAP')!.codigo).toBe('GAP');
  });

  it('código nunca visto entra como "Não mapeado", cinza, e avisa', () => {
    const novos = cat.registrar(['FS3', 'XYZ', 'ABC9', '-']);
    expect(novos).toEqual(['XYZ', 'ABC9']);
    expect(cat.naoMapeados().map((x) => x.codigo)).toEqual(['XYZ', 'ABC9']);
    const x = cat.get('XYZ');
    expect(x).toMatchObject({ nome: 'XYZ', cor: cat.COR_NAO_MAPEADO, categoria: cat.CAT_NAO_MAPEADO, mapeado: false });
    expect(trColor('XYZ', false, '#ccc')).toBe(cat.COR_NAO_MAPEADO);
    // ler a mesma planilha de novo não duplica
    expect(cat.registrar(['XYZ'])).toEqual([]);
  });

  it('editar um não mapeado o torna mapeado, com cor escura própria no modo campo', () => {
    cat.registrar(['XYZ']);
    cat.definir({ codigo: 'XYZ', nome: 'Solução X', cor: '#40a0ff', categoria: 'Reparo' });
    const x = cat.get('XYZ');
    expect(x.mapeado).toBe(true);
    expect(cat.naoMapeados()).toHaveLength(0);
    expect(x.corCampo).not.toBe(x.cor);
    expect(trColor('XYZ', true, '#ccc')).toBe(x.corCampo);
  });

  it('nome vazio cai no código; cor inválida é ignorada', () => {
    cat.definir({ codigo: 'FS3', nome: '   ', cor: 'azul' });
    expect(cat.get('FS3').nome).toBe('FS3');
    expect(cat.get('FS3').cor).toBe('#5ac8fa');
  });

  it('exporta e importa JSON sem levar os não mapeados', () => {
    cat.registrar(['XYZ']);
    cat.definir({ codigo: 'GAP', nome: 'Reforço', cor: '#123456' });
    cat.definir({ codigo: 'NOVO', nome: 'Novo', cor: '#654321', categoria: 'Reparo' });
    const j = JSON.parse(JSON.stringify(cat.exportar()));
    expect(j.itens.some((i: { codigo: string }) => i.codigo === 'XYZ')).toBe(false);
    cat.restaurarPadrao(false);
    expect(trLabel('GAP')).toBe('Gap graded');
    expect(cat.importar(j)).toBe(9);
    expect(trLabel('GAP')).toBe('Reforço');
    expect(cat.get('NOVO').categoria).toBe('Reparo');
  });

  it('recusa arquivo que não é catálogo', () => {
    expect(() => cat.importar({ foo: 1 })).toThrow();
    expect(() => cat.importar(null)).toThrow();
  });

  it('restaurar item e restaurar padrão', () => {
    cat.definir({ codigo: 'RP', nome: 'Outro nome' });
    cat.restaurarItem('RP');
    expect(trLabel('RP')).toBe('Reparo profundo');
    cat.definir({ codigo: 'REC', nome: 'Mudou' });
    cat.registrar(['XYZ']);
    cat.restaurarPadrao(true);
    expect(trLabel('REC')).toBe('Reconstrução');
    expect(cat.conhecido('XYZ')).toBe(true); // não mapeado é mantido
  });
});

describe('limiares de classe', () => {
  const lane = (o: object) => ({ iri: null, defPct: null, atr: null, d0: null, rc: null, ...o }) as never;

  it('padrão: mesmas classes do protótipo', () => {
    expect(IND.iri.cls(1.5)).toBe(0);
    expect(IND.iri.cls(2.7)).toBe(2);
    expect(IND.iri.cls(3.6)).toBe(4);
    expect(IND.rc.cls(500)).toBe(0);
    expect(IND.rc.cls(149)).toBe(4);
    expect(IND.def.cls(0)).toBe(0);
    expect(IND.def.cls(0.04)).toBe(1);
    expect(IND.def.cls(0.31)).toBe(4);
    expect(IND.iri.labels).toEqual(['≤ 1,5', '1,5 a 2,0', '2,0 a 2,7', '2,7 a 3,5', '> 3,5']);
    expect(IND.def.labels).toEqual(['0%', 'até 5%', '5 a 15%', '15 a 30%', '> 30%']);
    expect(IND.rc.labels[1]).toBe('300 a 500');
    expect(IND.iri.lim).toBe('admissível 2,7');
  });

  it('limiares novos mudam classes, rótulos e a pré-classificação', () => {
    expect(setLimites({ iri: [1, 2, 3, 4] })).toEqual([]);
    expect(IND.iri.cls(1.5)).toBe(1);
    expect(IND.iri.labels[0]).toBe('≤ 1,0');
    expect(IND.iri.lim).toBe('admissível 3,0');
    expect(classProps(lane({ iri: 3.5 })).c_iri).toBe(3);
    expect(classProps(lane({})).c_iri).toBe(-1);
    restaurarLimites();
    expect(getLimites()).toEqual(LIMITES_PADRAO);
  });

  it('valida: crescente (Rc decrescente), 4 valores, sem negativos', () => {
    expect(validarLimites('iri', [1, 2, 3, 4])).toBeNull();
    expect(validarLimites('iri', [1, 3, 2, 4])).toMatch(/crescentes/);
    expect(validarLimites('iri', [1, 2, 3])).toMatch(/4 limiares/);
    expect(validarLimites('iri', [-1, 2, 3, 4])).toMatch(/negativos/);
    expect(validarLimites('rc', [500, 300, 200, 150])).toBeNull();
    expect(validarLimites('rc', [150, 200, 300, 500])).toMatch(/decrescentes/);
    expect(validarLimites('atr', [1, NaN, 3, 4])).toMatch(/4 limiares/);
  });

  it('limiares inválidos são recusados e não alteram nada', () => {
    expect(setLimites({ iri: [4, 3, 2, 1] })).toEqual(['iri']);
    expect(getLimites().iri).toEqual([1.5, 2, 2.7, 3.5]);
  });

  it('defeitos com primeiro limiar diferente de zero usa rótulos genéricos', () => {
    setLimites({ def: [0.02, 0.05, 0.15, 0.3] });
    expect(IND.def.labels[0]).toBe('≤ 2%');
    expect(IND.def.cls(0)).toBe(0);
    expect(IND.def.cls(0.02)).toBe(0);
  });
});

describe('largura das faixas editável', () => {
  const parsed = lerPlanilha('U_BR-050_GO_Crescente.xlsx');
  const proj = prepareProject(parsed);
  const aj = (o: Partial<AjusteLargura>): AjusteLargura => ({ id: 'a', pname: parsed.meta.name, lane: 1, km0: null, km1: null, largura: 3.5, ...o });

  it('a planilha é o valor padrão', () => {
    expect(larguraPadrao(proj.rows)).toEqual([{ lane: 1, largura: 3.6 }, { lane: 2, largura: 3.6 }, { lane: 0, largura: 2.5 }]);
    expect(aplicarLarguras(proj.rows, proj.kmNum, [])).toBe(proj.rows);
  });

  it('ajuste por projeto e faixa vale para a planilha toda', () => {
    const out = aplicarLarguras(proj.rows, proj.kmNum, [aj({ lane: 1, largura: 3.5 })]);
    expect(out.every((r) => r.widths[0] === 3.5 && r.widths[1] === 3.6)).toBe(true);
    expect(contarAlteradas(proj.rows, out)).toBe(850);
    // a planilha original não foi mexida
    expect(proj.rows[0].widths[0]).toBe(3.6);
  });

  it('ajuste por intervalo de km vence o da planilha toda; fim exclusivo', () => {
    const k0 = proj.kmNum[100], k1 = proj.kmNum[150];
    const out = aplicarLarguras(proj.rows, proj.kmNum, [aj({ lane: 1, km0: k0, km1: k1, largura: 3.2 }), aj({ id: 'b', lane: 1, largura: 3.8 })]);
    expect(out[99].widths[0]).toBe(3.8); // fora do intervalo: ajuste geral
    expect(out[100].widths[0]).toBe(3.2);
    expect(out[149].widths[0]).toBe(3.2);
    expect(out[150].widths[0]).toBe(3.8); // km final não entra
  });

  it('intervalos sobrepostos: o último da lista vence', () => {
    const a = aj({ lane: 2, km0: proj.kmNum[10], km1: proj.kmNum[40], largura: 3.0 });
    const b = aj({ id: 'b', lane: 2, km0: proj.kmNum[20], km1: proj.kmNum[30], largura: 3.3 });
    const out = aplicarLarguras(proj.rows, proj.kmNum, [a, b]);
    expect(out[15].widths[1]).toBe(3.0);
    expect(out[25].widths[1]).toBe(3.3);
    expect(out[35].widths[1]).toBe(3.0);
  });

  it('acostamento (faixa 0) pode ser alterado ou zerado', () => {
    const out = aplicarLarguras(proj.rows, proj.kmNum, [aj({ lane: 0, largura: 1.5 }), aj({ id: 'z', lane: 0, km0: proj.kmNum[5], km1: proj.kmNum[10], largura: 0 })]);
    expect(out[0].shoulder).toBe(1.5);
    expect(out[7].shoulder).toBe(0);
  });

  it('faixa inexistente na linha é ignorada', () => {
    const out = aplicarLarguras(proj.rows, proj.kmNum, [aj({ lane: 4, largura: 3 })]);
    expect(contarAlteradas(proj.rows, out)).toBe(0);
  });

  it('valida faixa, largura e intervalo', () => {
    expect(validarAjuste({ lane: 1, km0: null, km1: null, largura: 3.5 }, 2)).toBeNull();
    expect(validarAjuste({ lane: 3, km0: null, km1: null, largura: 3.5 }, 2)).toMatch(/inexistente/);
    expect(validarAjuste({ lane: 1, km0: null, km1: null, largura: 0.2 }, 2)).toMatch(/entre/);
    expect(validarAjuste({ lane: 1, km0: null, km1: null, largura: 20 }, 2)).toMatch(/entre/);
    expect(validarAjuste({ lane: 0, km0: null, km1: null, largura: 0 }, 2)).toBeNull();
    expect(validarAjuste({ lane: 1, km0: 120, km1: null, largura: 3.5 }, 2)).toMatch(/inicial e o final/);
    expect(validarAjuste({ lane: 1, km0: 135, km1: 120, largura: 3.5 }, 2)).toMatch(/maior/);
  });

  it('geometria e áreas recalculam; as quantidades da planilha original não', () => {
    const out = aplicarLarguras(proj.rows, proj.kmNum, [aj({ lane: 1, largura: 3.0 })]);
    const novo = { ...proj, rows: out };
    const g0 = buildGeometry(proj), g1 = buildGeometry(novo);
    const f0 = g0.polys.find((q) => q.row === 10 && q.lane === 1)!, f1 = g1.polys.find((q) => q.row === 10 && q.lane === 1)!;
    expect(Math.hypot(f0.ring[1][0] - f0.ring[0][0], f0.ring[1][1] - f0.ring[0][1])).toBeCloseTo(3.6, 2);
    expect(Math.hypot(f1.ring[1][0] - f1.ring[0][0], f1.ring[1][1] - f1.ring[0][1])).toBeCloseTo(3.0, 2);
    // a Fx 2 começa 0,6 m mais perto, e o acostamento acompanha
    const s0 = g0.polys.find((q) => q.row === 10 && q.lane === 0)!, s1 = g1.polys.find((q) => q.row === 10 && q.lane === 0)!;
    expect(Math.hypot(s0.ring[1][0] - s1.ring[1][0], s0.ring[1][1] - s1.ring[1][1])).toBeCloseTo(0.6, 2);
    const pv = (rows: typeof out): PV => ({ ...proj, rows, id: 'p', model: modelOf(rows) });
    const a0 = resumo([pv(proj.rows)]), a1 = resumo([pv(out)]);
    const soma = (r: typeof a0) => Object.values(r.st).reduce((s, v) => s + v.area, 0);
    expect(soma(a1)).toBeLessThan(soma(a0));
  });
});
