import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/geometry/build';
import { converterDesloc, deslocarLongitudinal, deslocZerado, quadroMedio, validarDesloc, DESLOC_MAX } from '../src/geometry/deslocamento';
import { eixoDaFaixa } from '../src/geometry/eixo';
import { prepareProject, type Project } from '../src/geometry/project';
import { crsForZone, fromUtm } from '../src/geometry/utm';
import { localizar } from '../src/dominio/localizar';
import { planejarCopia, type AjusteLargura } from '../src/dominio/larguras';
import { marcadosPor, type ItemSelecao } from '../src/dominio/selecao';
import type { ParsedProject, Row } from '../src/formats/types';

// Estrada reta para o norte em UTM 23S (E 300000, N 8000000), linhas de 20 m, 2 faixas de 3,5 m.
function reta(travel: 1 | -1, n = 12): Project {
  const crs = crsForZone(23);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const [lat, lon] = fromUtm(crs, 300000, 8000000 + i * 20);
    rows.push({ hod: i * 0.02, lat, lon, z: null, widths: [3.5, 3.5], shoulder: 2.5, shoulderCode: null, obs: null, platform: null, lanes: [], marco: `1+${String(i * 20).padStart(3, '0')}`, drain: null, he: [null, null] });
  }
  const parsed: ParsedProject = { meta: { name: 'Reta', uf: 'BR-000/XX', via: 'Teste', travel, kmi: 1, kmf: 1.24, format: 'teste' }, rows, log: [], codes: {} };
  return prepareProject(parsed);
}

describe('deslocamento longitudinal', () => {
  it('crescente: positivo avança no sentido de percurso (norte)', () => {
    const p = reta(1);
    const { x, y } = deslocarLongitudinal(p.x, p.y, p.segs, 2, 1, 5);
    for (let i = 0; i < p.x.length; i++) {
      expect(x[i]).toBeCloseTo(p.x[i], 6);
      expect(y[i]).toBeCloseTo(p.y[i] + 5, 6);
    }
  });

  it('decrescente: positivo avança contra a quilometragem (sul)', () => {
    const p = reta(-1);
    const { y } = deslocarLongitudinal(p.x, p.y, p.segs, 2, -1, 5);
    expect(y[3]).toBeCloseTo(p.y[3] - 5, 6);
  });

  it('zero devolve cópia sem alterar o original', () => {
    const p = reta(1);
    const { x, y } = deslocarLongitudinal(p.x, p.y, p.segs, 2, 1, 0);
    expect(x).not.toBe(p.x);
    expect(Array.from(y)).toEqual(Array.from(p.y));
  });

  it('valida o limite e reconhece o zero', () => {
    expect(validarDesloc({ l: 0, t: 0 })).toBeNull();
    expect(validarDesloc({ l: DESLOC_MAX + 1, t: 0 })).toMatch(/longitudinal/);
    expect(validarDesloc({ l: 0, t: Number.NaN })).toMatch(/transversal/);
    expect(deslocZerado({ l: 0, t: 0 })).toBe(true);
    expect(deslocZerado({ l: 0, t: 1 })).toBe(false);
  });
});

describe('o deslocamento chega às coordenadas exportadas e ao GPS', () => {
  const montar = (l: number, t: number) => {
    const p0 = reta(1);
    const { x, y } = deslocarLongitudinal(p0.x, p0.y, p0.segs, 2, 1, l);
    const p = { ...p0, x, y };
    const g = buildGeometry(p, { extra: Math.abs(t), extraSide: t < 0 ? -1 : 1 });
    return { p, g, ep: { ...p, opts: g.opts, normals: g.normals } };
  };

  it('CSV: o eixo da Fx 1 sai 1,75 m a leste mais o transversal e o longitudinal ao norte', () => {
    const { ep } = montar(5, 3);
    const e = eixoDaFaixa(ep, 1, 2, 4)!;
    expect(e.ini.e).toBeCloseTo(300000 + 3 + 1.75, 3);
    expect(e.ini.n).toBeCloseTo(8000040 + 5, 3);
  });

  it('transversal negativo vai para a esquerda (oeste, no crescente)', () => {
    const { ep } = montar(0, -3);
    expect(eixoDaFaixa(ep, 1, 2, 4)!.ini.e).toBeCloseTo(300000 - 3 + 1.75, 3);
  });

  it('GPS: um ponto sobre a pista deslocada cai na faixa certa; sem o deslocamento ficaria fora', () => {
    const { p, g } = montar(0, 10);
    const [lat, lon] = fromUtm(p.crs, 300000 + 10 + 1.75, 8000100);
    const loc = localizar([{ ...p, id: 'p1', opts: g.opts, normals: g.normals, visible: true }], lat, lon)!;
    expect(loc.lane).toBe(1);
    expect(loc.e).toBeCloseTo(11.75, 2);
    const sem = montar(0, 0);
    const fora = localizar([{ ...sem.p, id: 'p1', opts: sem.g.opts, normals: sem.g.normals, visible: true }], lat, lon)!;
    expect(fora.lane).toBeNull();
  });
});

describe('seletor de planilhas', () => {
  const lista: ItemSelecao[] = [
    { id: 'a', nome: 'A', rodovia: 'RD-001', sentido: 1 },
    { id: 'b', nome: 'B', rodovia: 'RD-001', sentido: -1 },
    { id: 'c', nome: 'C', rodovia: 'BR-116', sentido: 1 },
    { id: 'd', nome: 'D', rodovia: 'BR-116', sentido: -1 },
  ];
  const origem = { rodovia: 'RD-001' };

  it('atalhos marcam o conjunto esperado', () => {
    expect([...marcadosPor('todas', lista, origem)]).toEqual(['a', 'b', 'c', 'd']);
    expect([...marcadosPor('nenhuma', lista, origem)]).toEqual([]);
    expect([...marcadosPor('crescentes', lista, origem)]).toEqual(['a', 'c']);
    expect([...marcadosPor('decrescentes', lista, origem)]).toEqual(['b', 'd']);
    expect([...marcadosPor('rodovia', lista, origem)]).toEqual(['a', 'b']);
  });
});

describe('copiar larguras para outras planilhas', () => {
  const aj = (lane: number, largura: number): AjusteLargura => ({ id: 'x' + lane, pname: 'origem', lane, km0: null, km1: null, largura });
  let n = 0;
  const id = () => 'n' + n++;

  it('copia só as faixas que o destino tem e informa as ignoradas', () => {
    const plano = planejarCopia([aj(1, 3.4), aj(3, 3.2), aj(0, 2)], [{ pname: 'P2', nome: 'P2', maxFaixas: 2 }, { pname: 'P3', nome: 'P3', maxFaixas: 3 }], id);
    expect(plano[0].ajustes.map((a) => a.lane)).toEqual([1, 0]);
    expect(plano[0].ignorados.map((a) => a.lane)).toEqual([3]);
    expect(plano[1].ajustes.map((a) => a.lane)).toEqual([1, 3, 0]);
    expect(plano[1].ignorados).toEqual([]);
    expect(plano[0].ajustes.every((a) => a.pname === 'P2')).toBe(true);
    expect(new Set(plano.flatMap((x) => x.ajustes.map((a) => a.id))).size).toBe(5);
  });
});

describe('copiar o deslocamento como vetor no mapa', () => {
  it('sentido oposto: o mesmo vetor sobre o mapa vira longitudinal e transversal com o sinal trocado', () => {
    const cres = { tE: 0, tN: 1 }, decr = { tE: 0, tN: -1 };
    expect(converterDesloc({ l: 5, t: 3 }, cres, decr)).toEqual({ l: -5, t: -3 });
    expect(converterDesloc({ l: -5, t: -3 }, decr, cres)).toEqual({ l: 5, t: 3 });
  });

  it('mesmo sentido: o deslocamento não muda', () => {
    const q = { tE: 0.6, tN: 0.8 };
    expect(converterDesloc({ l: 4, t: -2 }, q, q)).toEqual({ l: 4, t: -2 });
  });

  it('pista virada 90°: leste para a esquerda do norte vira transversal', () => {
    const leste = { tE: 1, tN: 0 }, norte = { tE: 0, tN: 1 };
    // 5 m ao longo de uma pista que vai para leste = 5 m para leste = 5 m à direita de quem vai para o norte
    expect(converterDesloc({ l: 5, t: 0 }, leste, norte)).toEqual({ l: 0, t: 5 });
    // 3 m à direita de quem vai para leste = 3 m para o sul = 3 m para trás de quem vai para o norte
    expect(converterDesloc({ l: 0, t: 3 }, leste, norte)).toEqual({ l: -3, t: 0 });
  });

  it('o azimute médio vem dos passos e respeita o sentido de percurso', () => {
    const p = reta(1), q = reta(-1);
    const a = quadroMedio(p.x, p.y, p.segs, 1)!, b = quadroMedio(q.x, q.y, q.segs, -1)!;
    expect(a.tE).toBeCloseTo(0, 6); expect(a.tN).toBeCloseTo(1, 6);
    expect(b.tE).toBeCloseTo(0, 6); expect(b.tN).toBeCloseTo(-1, 6);
    expect(quadroMedio([0], [0], [{ a: 0, b: 0 }], 1)).toBeNull();
  });

  it('a conversão fecha o ciclo: vetor no mapa idêntico dos dois lados', () => {
    const p = reta(1), q = reta(-1);
    const a = quadroMedio(p.x, p.y, p.segs, 1)!, b = quadroMedio(q.x, q.y, q.segs, -1)!;
    const d = converterDesloc({ l: 7, t: -2 }, a, b);
    // em coordenadas do mapa (leste, norte): origem l*a + t*n_a; destino l'*b + t'*n_b
    const mapa = (v: { l: number; t: number }, f: { tE: number; tN: number }) => [v.l * f.tE + v.t * f.tN, v.l * f.tN - v.t * f.tE];
    const [e1, n1] = mapa({ l: 7, t: -2 }, a), [e2, n2] = mapa(d, b);
    expect(e2).toBeCloseTo(e1, 6); expect(n2).toBeCloseTo(n1, 6);
  });
});
