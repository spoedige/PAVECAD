import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGeometry, validarAnel } from '../src/geometry/build';
import { polysToGeoJSON } from '../src/geometry/geojson';
import { prepareProject } from '../src/geometry/project';
import { crsForZone, fromUtm } from '../src/geometry/utm';
import { segmentsOf } from '../src/formats/segments';
import { reconstruir, type PontoBruto } from '../src/formats/reconstrucao';
import type { ParsedProject, Row } from '../src/formats/types';
import { fixture } from './helpers';

type Linha = [string, number, number, number];
const F = JSON.parse(readFileSync(fixture('planservi_pontas.json'), 'utf-8')) as Record<string, { inicio: Linha[]; fim: Linha[] }>;
const pontos = (l: Linha[]): PontoBruto[] => l.map(([, km, lat, lon]) => ({ km, lat, lon }));
const R = 6371000, RAD = Math.PI / 180;
const metros = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((b.lon - a.lon) * RAD * Math.cos(a.lat * RAD) * R, (b.lat - a.lat) * RAD * R);
const aplicar = (p: PontoBruto[], r: ReturnType<typeof reconstruir>) => p.map((q, i) => ({ ...q, lat: r.lat[i], lon: r.lon[i] }));

/** Projeto mínimo com as linhas dadas, para validar os polígonos. */
function projeto(p: PontoBruto[], quebras: number[] = []) {
  const rows: Row[] = p.map((q, i) => ({
    hod: q.km / 1000, lat: q.lat, lon: q.lon, z: null, widths: [3.6], shoulder: 2.5, shoulderCode: null, obs: null, platform: null, lanes: [],
    marco: String(i), drain: null, he: [null, null], ...(quebras.includes(i) ? { quebra: true } : {}),
  }));
  const parsed: ParsedProject = { meta: { name: 't', uf: 'BR', via: 'T', travel: 1, kmi: 0, kmf: 1, format: 'teste' }, rows, log: [], codes: {} };
  return prepareProject(parsed);
}

describe('reconstrução das pontas (arquivos reais)', () => {
  it('TH39 crescente: início com ponto repetido vira ponto novo 20 m antes, pelo rumo dos primeiros passos', () => {
    const p = pontos(F['th39-crescente'].inicio);
    expect(metros(p[0], p[1])).toBeLessThan(0.1); // linhas 1 e 2 idênticas, segmento de 0 m
    const r = reconstruir(p, false);
    expect(r.corrigidos).toHaveLength(1);
    expect(r.corrigidos[0]).toMatchObject({ i: 0, tipo: 'inicial', causa: 'repetido' });
    const n = aplicar(p, r);
    expect(metros(n[0], n[1])).toBeGreaterThan(19.5);
    expect(metros(n[0], n[1])).toBeLessThan(20.5);
    for (let i = 1; i < p.length; i++) expect([r.lat[i], r.lon[i]]).toEqual([p[i].lat, p[i].lon]);
    expect(r.cortes).toEqual([]);
  });

  it('TH39 crescente: o ponto final ignora a coordenada da planilha e sai pelo km (10 m)', () => {
    const p = pontos(F['th39-crescente'].fim);
    const antes = metros(p[p.length - 2], p[p.length - 1]);
    expect(antes).toBeGreaterThan(29); // coordenada final distante do que o km diz
    const r = reconstruir(p, true);
    const n = aplicar(p, r);
    const ult = r.corrigidos.find((c) => c.tipo === 'final')!;
    expect(ult).toBeDefined();
    expect(ult.deslocamento).toBeGreaterThan(20);
    const km = p[p.length - 1].km - p[p.length - 2].km;
    expect(km).toBeCloseTo(10, 6);
    expect(metros(n[n.length - 2], n[n.length - 1])).toBeCloseTo(km, 0);
    // segue o rumo dos segmentos anteriores
    const h = Math.atan2(n[n.length - 2].lon - n[n.length - 3].lon, n[n.length - 2].lat - n[n.length - 3].lat);
    const g = Math.atan2(n[n.length - 1].lon - n[n.length - 2].lon, n[n.length - 1].lat - n[n.length - 2].lat);
    expect(Math.abs(h - g)).toBeLessThan(0.2);
  });

  it('TH40 crescente: salto de 70 m no primeiro passo vira ponto inicial a 20 m', () => {
    const p = pontos(F['th40-crescente'].inicio);
    expect(metros(p[0], p[1])).toBeGreaterThan(65);
    const r = reconstruir(p, false);
    expect(r.corrigidos).toHaveLength(1);
    expect(r.corrigidos[0]).toMatchObject({ i: 0, tipo: 'inicial', causa: 'salto' });
    expect(r.corrigidos[0].deslocamento).toBeGreaterThan(45);
    const n = aplicar(p, r);
    expect(metros(n[0], n[1])).toBeGreaterThan(19.5);
    expect(metros(n[0], n[1])).toBeLessThan(20.5);
  });

  it('TH48 crescente: salto de 206 m no primeiro passo vira ponto inicial a 20 m', () => {
    const p = pontos(F['th48-crescente'].inicio);
    expect(metros(p[0], p[1])).toBeGreaterThan(200);
    const r = reconstruir(p, false);
    expect(r.corrigidos).toHaveLength(1);
    expect(r.corrigidos[0].tipo).toBe('inicial');
    expect(metros(aplicar(p, r)[0], aplicar(p, r)[1])).toBeCloseTo(20, 0);
    expect(r.cortes).toEqual([]);
  });

  it('TH39 decrescente já está correto: nenhum ponto numerado muda e o final fica a menos de 3 m', () => {
    for (const parte of ['inicio', 'fim'] as const) {
      const p = pontos(F['th39-decrescente'][parte]);
      const r = reconstruir(p, parte === 'fim');
      const ate = parte === 'fim' ? p.length - 1 : p.length;
      for (let i = 0; i < ate; i++) expect([r.lat[i], r.lon[i]]).toEqual([p[i].lat, p[i].lon]);
      expect(r.corrigidos.filter((c) => c.tipo !== 'final')).toEqual([]);
      if (parte === 'fim') expect(metros(p[p.length - 1], { lat: r.lat[p.length - 1], lon: r.lon[p.length - 1] })).toBeLessThan(3);
    }
  });

  it('depois de reconstruir, todos os polígonos são simples e o comprimento bate com os marcos; antes havia polígono degenerado', () => {
    for (const [chave, parte, terminal] of [['th39-crescente', 'inicio', false], ['th39-crescente', 'fim', true], ['th40-crescente', 'inicio', false], ['th48-crescente', 'inicio', false]] as const) {
      const p = pontos(F[chave][parte]);
      const bruto = buildGeometry(projeto(p));
      const r = reconstruir(p, terminal);
      const n = aplicar(p, r);
      const pr = projeto(n);
      const g = buildGeometry(pr);
      expect(g.polys.length).toBeGreaterThan(0);
      expect(g.polys.filter((q) => q.invalido), `${chave} ${parte}`).toEqual([]);
      // comprimento por marcos: cada passo fica perto da diferença de km
      for (let i = 0; i < n.length - 1; i++) {
        const km = n[i + 1].km - n[i].km, d = metros(n[i], n[i + 1]);
        expect(Math.abs(d - km), `${chave} ${parte} passo ${i}`).toBeLessThan(0.5 * km + 0.5);
      }
      if (chave === 'th39-crescente' && parte === 'inicio') expect(bruto.polys.some((q) => q.invalido === 'curto')).toBe(true);
    }
  });
});

describe('reconstrução no meio da linha (sintético)', () => {
  const crs = crsForZone(23);
  const linha = (n: number, ajuste: (i: number, x: number, y: number) => [number, number]): PontoBruto[] =>
    Array.from({ length: n }, (_, i) => {
      const [x, y] = ajuste(i, 300000 + i * 20, 8000000);
      const [lat, lon] = fromUtm(crs, x, y);
      return { km: 100000 + i * 20, lat, lon };
    });

  it('ponto isolado fora do lugar é interpolado pelo km', () => {
    const p = linha(40, (i, x, y) => (i === 15 ? [x, y + 100] : [x, y]));
    const r = reconstruir(p, false);
    expect(r.corrigidos.map((c) => c.i)).toEqual([15]);
    const certo = linha(40, (_i, x, y) => [x, y])[15];
    expect(metros({ lat: r.lat[15], lon: r.lon[15] }, certo)).toBeLessThan(0.5);
    expect(r.cortes).toEqual([]);
  });

  it('dois pontos seguidos fora do lugar também são interpolados', () => {
    const p = linha(40, (i, x, y) => (i === 15 ? [x, y + 100] : i === 16 ? [x, y - 90] : [x, y]));
    const r = reconstruir(p, false);
    expect(r.corrigidos.map((c) => c.i)).toEqual([15, 16]);
    const certo = linha(40, (_i, x, y) => [x, y]);
    for (const i of [15, 16]) expect(metros({ lat: r.lat[i], lon: r.lon[i] }, certo[i])).toBeLessThan(0.5);
  });

  it('dois pontos deslocados juntos formam um bloco: sem como saber o certo, a linha é cortada nas duas bordas', () => {
    const p = linha(40, (i, x, y) => (i === 15 || i === 16 ? [x - 60, y + 80] : [x, y]));
    const r = reconstruir(p, false);
    expect(r.corrigidos).toEqual([]);
    expect(r.cortes.map((c) => c.i)).toEqual([15, 17]);
  });

  it('salto grande real de 206 m no meio corta a linha em duas partes, sem interpolar', () => {
    const p = linha(40, (i, x, y) => (i >= 21 ? [x + 186, y] : [x, y])); // passo de 206 m entre as linhas 20 e 21
    const r = reconstruir(p, false);
    expect(r.corrigidos).toEqual([]);
    expect(r.cortes).toHaveLength(1);
    expect(r.cortes[0].i).toBe(21);
    expect(r.cortes[0].dist).toBeCloseTo(206, 0);
    const pr = projeto(p, [21]);
    expect(pr.segs).toEqual([{ a: 0, b: 20 }, { a: 21, b: 39 }]);
    const g = buildGeometry(pr);
    expect(g.polys.some((q) => q.row === 20)).toBe(false); // nada liga as duas partes
    expect(g.polys.filter((q) => q.invalido)).toEqual([]);
  });

  it('trecho parado (km avança, coordenada quase não) não é inventado: fica como está, com aviso, e o polígono vira linha central', () => {
    const p = linha(40, (i, x, y) => (i >= 15 && i <= 25 ? [300000 + 15 * 20 + (i - 15) * 0.5, y] : i > 25 ? [x - 190, y] : [x, y]));
    const r = reconstruir(p, false);
    expect(r.corrigidos).toEqual([]);
    expect(r.avisos.some((a) => a.tipo === 'estacionario')).toBe(true);
    for (let i = 0; i < p.length; i++) expect([r.lat[i], r.lon[i]]).toEqual([p[i].lat, p[i].lon]);
    const pr = projeto(p);
    const g = buildGeometry(pr);
    const inv = g.polys.filter((q) => q.invalido === 'curto');
    expect(inv.length).toBeGreaterThan(5);
    const fc = polysToGeoJSON(pr, g);
    const f = fc.features.find((x) => x.properties.row === inv[0].row && x.properties.lane === inv[0].lane)!;
    expect(f.geometry.type).toBe('LineString');
    expect((f.geometry.coordinates as number[][]).length).toBe(2);
  });
});

describe('validação do anel e quebras', () => {
  it('anel em gravata-borboleta é rejeitado; quadrado simples passa; segmento curto falha', () => {
    const ok: [number, number][] = [[0, 0], [3, 0], [3, 20], [0, 20], [0, 0]];
    const cruzado: [number, number][] = [[0, 0], [3, 20], [3, 0], [0, 20], [0, 0]];
    expect(validarAnel(ok, 20)).toBeNull();
    expect(validarAnel(cruzado, 20)).toBe('cruzado');
    expect(validarAnel(ok, 0.6)).toBe('curto');
    expect(validarAnel([[0, 0], [0, 0], [0, 20], [0, 20], [0, 0]], 20)).not.toBeNull();
  });

  it('segmentsOf corta onde a linha marca quebra, mesmo com o km contínuo', () => {
    expect(segmentsOf([0, 0.02, 0.04, 0.06], [false, false, true, false])).toEqual([{ a: 0, b: 1 }, { a: 2, b: 3 }]);
    expect(segmentsOf([0, 0.02, 0.04, 0.06])).toEqual([{ a: 0, b: 3 }]);
  });
});
