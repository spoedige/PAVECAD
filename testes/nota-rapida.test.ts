import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { edgesOf, buildGeometry } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';
import { fromUtm } from '../src/geometry/utm';
import { parseSpreadsheetAll } from '../src/formats';
import { type LocP } from '../src/dominio/localizar';
import { LIMITE_PROXIMO_M, dadosDeLocal, posicionarMenu, precisaLembrar, resolverLocal } from '../src/dominio/notaRapida';

const { gerarPlanservi } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as { gerarPlanservi: (o: Record<string, unknown>) => Buffer };

/** Dois sentidos de um trecho sintético: pistas a 10 m uma da outra. */
function par(): { c: LocP; d: LocP } {
  const [cr, dc] = parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10 })));
  const mk = (pr: typeof cr, id: string): LocP => { const p = prepareProject(pr), g = buildGeometry(p); return { ...p, id, opts: g.opts, normals: g.normals, visible: true }; };
  return { c: mk(cr, 'pc'), d: mk(dc, 'pd') };
}
/** Ponto (lat, lon) na linha i da planilha, a `off` metros do eixo ao longo da normal. */
function ponto(p: LocP, i: number, off: number): [number, number] {
  const n = p.normals[i]!;
  return fromUtm(p.crs, p.x[i] + off * n.e, p.y[i] + off * n.n);
}
const kmTxt = (p: LocP, i: number) => p.kmLab[i];

describe('resolver o local da nota pelos polígonos', () => {
  const { c, d } = par();
  const i = 20;
  const centroFaixa1 = (p: LocP) => { const e = edgesOf(p.rows[i], p.opts).e; return (e[0] + e[1]) / 2; };

  it('ponto dentro da faixa: planilha, rodovia, sentido, faixa e km do segmento', () => {
    const [lat, lon] = ponto(c, i, centroFaixa1(c));
    const r = resolverLocal([c], lat, lon);
    expect(r.estado).toBe('dentro');
    expect(r.local!.p.id).toBe('pc');
    expect(r.local!.lane).toBe(1);
    const dd = dadosDeLocal(r.local, r.estado, kmTxt);
    expect(dd).toMatchObject({ rodovia: 'RD-001', sentido: 'Crescente', faixa: 1, km: c.kmLab[i] });
    expect(dd.planilha).toBe(c.meta.name);
  });

  it('ponto no acostamento sai com faixa 0', () => {
    const e = edgesOf(c.rows[i], c.opts).e;
    const [lat, lon] = ponto(c, i, (e[e.length - 2] + e[e.length - 1]) / 2);
    expect(resolverLocal([c], lat, lon).local!.lane).toBe(0);
  });

  it('fora dos polígonos, o segmento mais próximo vale até 30 m', () => {
    const e = edgesOf(c.rows[i], c.opts).e, ext = Math.max(...e);
    const sinal = Math.sign(e[e.length - 1] - e[0]) || 1;
    const [lat, lon] = ponto(c, i, e[e.length - 1] + sinal * 12);
    void ext;
    const r = resolverLocal([c], lat, lon);
    expect(r.estado).toBe('proximo');
    expect(r.local!.out).toBeGreaterThan(8);
    expect(r.local!.out).toBeLessThanOrEqual(LIMITE_PROXIMO_M);
  });

  it('a mais de 30 m vira "fora do trecho", só com a posição', () => {
    const e = edgesOf(c.rows[i], c.opts).e, sinal = Math.sign(e[e.length - 1] - e[0]) || 1;
    const [lat, lon] = ponto(c, i, e[e.length - 1] + sinal * 45);
    const r = resolverLocal([c], lat, lon);
    expect(r.estado).toBe('fora');
    expect(r.local).toBeNull();
    expect(dadosDeLocal(r.local, r.estado, kmTxt)).toEqual({ rodovia: null, sentido: null, planilha: null, km: null, faixa: null, estado: 'fora' });
  });

  it('sem planilha visível: trecho não definido', () => {
    const r = resolverLocal([{ ...c, visible: false }], -15.2, -47.9);
    expect(r.estado).toBe('sem-planilha');
    expect(r.local).toBeNull();
    expect(resolverLocal([], -15.2, -47.9).estado).toBe('sem-planilha');
  });

  it('desempate entre sentidos: sobre o eixo de um deles não há dúvida', () => {
    const [lat, lon] = ponto(c, i, 0);
    const r = resolverLocal([c, d], lat, lon);
    expect(r.ambiguo).toBe(false);
    expect(r.local!.p.id).toBe('pc');
    expect(r.outro).toBeNull();
  });

  it('pistas a 10 m: no meio, o sentido é ambíguo e o mais próximo vem pré-selecionado', () => {
    const [lat, lon] = ponto(c, i, 3);
    const r = resolverLocal([c, d], lat, lon);
    expect(r.ambiguo).toBe(true);
    expect(r.outro).not.toBeNull();
    expect(new Set([r.local!.p.id, r.outro!.p.id])).toEqual(new Set(['pc', 'pd']));
    expect(r.local!.dist).toBeLessThanOrEqual(r.outro!.dist);
  });

  it('GPS pior que a separação das pistas também deixa o sentido ambíguo, e acima de 30 m avisa', () => {
    const [lat, lon] = ponto(c, i, 0);
    expect(resolverLocal([c, d], lat, lon, 4).ambiguo).toBe(false);
    expect(resolverLocal([c, d], lat, lon, 15).ambiguo).toBe(true);
    expect(resolverLocal([c, d], lat, lon, 15).avisoPrecisao).toBe(false);
    expect(resolverLocal([c, d], lat, lon, 35).avisoPrecisao).toBe(true);
  });

  it('o Alinhar vale: com a planilha deslocada, o ponto sobre a pista nova cai na faixa certa e fora da antiga posição', () => {
    const desloc = { ...c, x: c.x, y: c.y.map((v) => v + 40) }; // a pista anda 40 m de lado (a sintética corre para leste)
    const [lat, lon] = ponto(desloc as LocP, i, centroFaixa1(c));
    expect(resolverLocal([desloc as LocP], lat, lon).estado).toBe('dentro');
    expect(resolverLocal([c], lat, lon).estado).not.toBe('dentro');
  });
});

describe('menu circular', () => {
  const area = { w: 1000, h: 600 };
  const cabe = (b: { x: number; y: number }, m = 8) => b.x - 32 >= m && b.x + 32 <= area.w - m && b.y - 32 >= m && b.y + 32 <= area.h - m;

  it('quatro botões de 64 px dentro da tela em qualquer ponto, inclusive cantos e bordas', () => {
    for (const pt of [{ x: 500, y: 300 }, { x: 2, y: 2 }, { x: 998, y: 2 }, { x: 2, y: 598 }, { x: 998, y: 598 }, { x: 500, y: 5 }, { x: 5, y: 300 }, { x: 995, y: 300 }, { x: 500, y: 595 }]) {
      const m = posicionarMenu(pt, area);
      expect(m.botoes).toHaveLength(4);
      for (const b of m.botoes) expect(cabe(b)).toBe(true);
    }
  });

  it('no meio da tela abre para cima (longe do dedo)', () => {
    const m = posicionarMenu({ x: 500, y: 400 }, area);
    expect(m.angulo).toBe(-90);
    expect(m.botoes.every((b) => b.y < 400)).toBe(true);
  });

  it('perto do topo abre para baixo e os botões não se sobrepõem', () => {
    const m = posicionarMenu({ x: 500, y: 40 }, area);
    expect(m.botoes.every((b) => b.y > 40)).toBe(true);
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(Math.hypot(m.botoes[a].x - m.botoes[b].x, m.botoes[a].y - m.botoes[b].y)).toBeGreaterThanOrEqual(64);
  });
});

describe('lembrete de exportar', () => {
  it('depois de 10 notas novas sem exportar', () => {
    expect(precisaLembrar(9)).toBe(false);
    expect(precisaLembrar(10)).toBe(true);
  });
});
