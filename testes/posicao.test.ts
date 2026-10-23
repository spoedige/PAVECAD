import { describe, expect, it } from 'vitest';
import type { LocP } from '../src/dominio/localizar';
import {
  definirManual, idade, manualDoPonto, moverManual, origemDoGps, origemEfetiva, pontoNoKm, receberGps, referenciar, textoReferencia,
  LIMITE_FORA_M, type EstadoPos,
} from '../src/dominio/posicao';
import { fromUtm, toUtm } from '../src/geometry/utm';
import { buildGeometry } from '../src/geometry/build';
import { fonte } from './helpers';
import { kmLabel } from '../src/formats';

const f = fonte();
const g = buildGeometry(f.base, f.opts);
const p = { ...f.base, id: 'p1', opts: f.opts, normals: g.normals, visible: true } as LocP;
const P = [p];
const pt = (i: number, ds = 0, dn = 0) => fromUtm(p.crs, p.x[i] + ds, p.y[i] + dn);

describe('referencial local', () => {
  it('sobre o ponto da planilha: km exato e distância zero', () => {
    const [lat, lon] = pt(10);
    const r = referenciar(P, lat, lon)!;
    expect(r.i).toBe(10);
    expect(r.km).toBeCloseTo(p.kmNum[10], 9);
    expect(r.dEixo).toBeLessThan(0.01);
    expect(r.fora).toBe(false);
  });

  it('interpola o km entre dois pontos (meio do segmento de 20 m = +10 m)', () => {
    const [lat, lon] = fromUtm(p.crs, (p.x[10] + p.x[11]) / 2, (p.y[10] + p.y[11]) / 2);
    const r = referenciar(P, lat, lon)!;
    expect(r.km).toBeCloseTo(p.kmNum[10] + 0.01, 6);
  });

  it('distância ao eixo é a perpendicular, e passa de 50 m vira "fora do trecho"', () => {
    const n = p.normals[20]!;
    const [lat, lon] = pt(20, n.e * 8, n.n * 8);
    const r = referenciar(P, lat, lon)!;
    expect(r.dEixo).toBeCloseTo(8, 1);
    expect(textoReferencia(r, kmLabel)).toMatch(/^km \d+\+\d{3} · a 8 m do eixo/);
    const [la2, lo2] = pt(20, n.e * (LIMITE_FORA_M + 10), n.n * (LIMITE_FORA_M + 10));
    const longe = referenciar(P, la2, lo2)!;
    expect(longe.fora).toBe(true);
    expect(textoReferencia(longe, kmLabel)).toMatch(/^Fora do trecho \(a 6\d m do eixo\)$/);
  });

  it('confere com UTM de ponto conhecido (ida e volta sem erro)', () => {
    const [lat, lon] = pt(5);
    const [x, y] = toUtm(p.crs, lat, lon);
    expect(Math.hypot(x - p.x[5], y - p.y[5])).toBeLessThan(1e-4);
  });

  it('sem planilha visível não há referência', () => {
    const [lat, lon] = pt(5);
    expect(referenciar([{ ...p, visible: false }], lat, lon)).toBeNull();
  });
});

describe('posição manual', () => {
  const [lat, lon] = pt(10);
  const m0 = manualDoPonto(P, lat, lon, 1000)!;

  it('toque no mapa vira posição no eixo, no km do ponto', () => {
    expect(m0.pid).toBe('p1');
    expect(m0.km).toBeCloseTo(p.kmNum[10], 9);
  });

  it('botões de ±20 m movem o km exatamente 20 m e param nas pontas do trecho', () => {
    const m1 = moverManual(p, m0, 20, 2000);
    expect(m1.km - m0.km).toBeCloseTo(0.02, 9);
    expect(moverManual(p, m1, -20, 3000).km).toBeCloseTo(m0.km, 9);
    expect(moverManual(p, { ...m0, km: p.kmNum[0] }, -20).km).toBeCloseTo(p.kmNum[0], 9);
    const fim = p.segs[p.segs.length - 1].b;
    expect(moverManual(p, { ...m0, km: p.kmNum[fim] }, 20).km).toBeCloseTo(p.kmNum[fim], 9);
  });

  it('o ponto no km cai sobre o eixo: ir e voltar devolve o mesmo km', () => {
    const q = pontoNoKm(p, m0.km + 0.013)!;
    const r = referenciar(P, q.lat, q.lon)!;
    expect(r.km).toBeCloseTo(m0.km + 0.013, 6);
    expect(r.dEixo).toBeLessThan(0.01);
    expect(pontoNoKm(p, 9999)).toBeNull();
  });

  it('GPS por satélite substitui a manual com aviso; só por rede não substitui', () => {
    let s: EstadoPos = definirManual({ gps: null, manual: null }, m0);
    expect(origemEfetiva(s)).toBe('manual');
    const rede = receberGps(s, { lat, lon, acc: 1200, t: 5 });
    expect(rede.substituiuManual).toBe(false);
    expect(origemEfetiva(rede.estado)).toBe('manual');
    const sat = receberGps(rede.estado, { lat, lon, acc: 8, t: 6 });
    expect(sat.substituiuManual).toBe(true);
    expect(sat.estado.manual).toBeNull();
    expect(origemEfetiva(sat.estado)).toBe('satelite');
    s = receberGps({ gps: null, manual: null }, { lat, lon, acc: 8, t: 7 }).estado;
    expect(receberGps(s, { lat, lon, acc: 6, t: 8 }).substituiuManual).toBe(false);
  });

  it('origem pela precisão e idade em texto', () => {
    expect(origemDoGps(500)).toBe('satelite');
    expect(origemDoGps(501)).toBe('rede');
    expect(idade(0, 12000)).toBe('há 12 s');
    expect(idade(0, 180000)).toBe('há 3 min');
    expect(idade(5000, 1000)).toBe('há 0 s');
  });
});
