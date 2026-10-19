import { describe, expect, it } from 'vitest';
import {
  ORCAMENTO, PASSOS, alinhado, cabeRotuloInterno, dentroDoOrcamento, deslocamentoParaFora, direcaoNaTela, metrosPorPixel, passoAcima,
  passoComOrcamento, passoParaEscala, prioDoMarco, rotuloInterno,
} from '../src/mapa/marcos';

describe('passo dos marcos pela escala', () => {
  it('metros por pixel no equador e em -15°', () => {
    expect(metrosPorPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metrosPorPixel(18, -15)).toBeCloseTo(0.2884, 3);
  });

  it('o menor passo com pelo menos 64 px de espaço', () => {
    expect(passoParaEscala(3.47)).toBe(20); // 20 m = 69 px
    expect(passoParaEscala(3.0)).toBe(40); // 20 m = 60 px, 40 m = 120 px
    expect(passoParaEscala(1.5)).toBe(50); // 40 m = 60 px, 50 m = 75 px
    expect(passoParaEscala(0.87)).toBe(100);
    expect(passoParaEscala(0.217)).toBe(500);
    expect(passoParaEscala(0.00001)).toBe(10000); // escala continental: o último passo
  });

  it('cada passo da lista é escolhido na sua faixa de escala', () => {
    for (const s of PASSOS) expect(passoParaEscala(64 / s)).toBeLessThanOrEqual(s);
    for (const s of PASSOS) expect(s * (64 / s)).toBeGreaterThanOrEqual(64 - 1e-9);
  });

  it('passoAcima sobe um degrau e para no último', () => {
    expect(passoAcima(20)).toBe(40);
    expect(passoAcima(100)).toBe(200);
    expect(passoAcima(10000)).toBe(10000);
  });

  it('a escala em zoom 18 a 21 (lat -15) dá 20 m', () => {
    for (const z of [18, 19, 20, 21]) expect(passoParaEscala(1 / metrosPorPixel(z, -15))).toBe(20);
    expect(passoParaEscala(1 / metrosPorPixel(17, -15))).toBe(40);
  });
});

describe('alinhamento e prioridade', () => {
  it('só rotula múltiplos do passo', () => {
    expect(alinhado(209440, 20)).toBe(true);
    expect(alinhado(209450, 20)).toBe(false);
    expect(alinhado(209450, 50)).toBe(true);
    expect(alinhado(209000, 1000)).toBe(true);
    expect(alinhado(209500, 1000)).toBe(false);
    expect(alinhado(210000, 2000)).toBe(true);
    expect(alinhado(211000, 2000)).toBe(false);
  });

  it('km cheio, depois 500 m, 100 m e 20 m', () => {
    expect([209000, 209500, 209100, 209440, 209460].map(prioDoMarco)).toEqual([0, 1, 2, 3, 3]);
  });
});

describe('orçamento de rótulos', () => {
  it('passo sobe até caber, e nunca zera', () => {
    const contar = (passo: number) => Math.floor(100000 / passo); // 100 km de via na vista
    const p = passoComOrcamento(10, contar); // escala pediria 20 m (5000 rótulos)
    expect(p).toBe(250 > 200 ? 500 : 200); // 100000/200 = 500 > 400; 100000/500 = 200
    expect(contar(p)).toBeLessThanOrEqual(ORCAMENTO);
    expect(passoComOrcamento(10, () => 1e9)).toBe(10000);
  });

  it('com poucos candidatos o passo da escala fica', () => {
    expect(passoComOrcamento(3.47, () => 10)).toBe(20);
  });

  it('acima do orçamento ficam os mais importantes (km cheio antes de 100 m antes de 20 m)', () => {
    const c = Array.from({ length: 2000 }, (_, k) => ({ m: 209000 + k * 20, d: k }));
    const r = dentroDoOrcamento(c);
    expect(r).toHaveLength(ORCAMENTO);
    const kms = c.filter((x) => x.m % 1000 === 0).length;
    expect(r.filter((x) => x.m % 1000 === 0)).toHaveLength(kms); // todos os km cheios entram
    const cem = c.filter((x) => x.m % 100 === 0).length;
    expect(r.filter((x) => x.m % 100 === 0)).toHaveLength(cem);
    expect(dentroDoOrcamento(c.slice(0, 50))).toHaveLength(50);
  });

  it('em empate de prioridade entram os mais perto do centro', () => {
    const c = Array.from({ length: 600 }, (_, k) => ({ m: 1020 + k * 1000, d: 600 - k })); // só 20 m; d menor = mais perto
    const r = dentroDoOrcamento(c);
    expect(Math.max(...r.map((x) => x.d))).toBeLessThanOrEqual(400);
  });
});

describe('rótulo interno e posição', () => {
  it('só com 100 px ou mais por segmento de 20 m', () => {
    expect(cabeRotuloInterno(5)).toBe(true);
    expect(cabeRotuloInterno(4.9)).toBe(false);
    expect(rotuloInterno('209+440')).toBe('209+440'); // só o marco, sem intervalo
  });

  it('direção na tela acompanha a rotação do mapa', () => {
    const [x, y] = direcaoNaTela(1, 0, 0); // leste, norte para cima
    expect(x).toBeCloseTo(1, 9); expect(y).toBeCloseTo(0, 9);
    const [x2, y2] = direcaoNaTela(1, 0, 90); // mapa girado: leste para cima
    expect(x2).toBeCloseTo(0, 9); expect(y2).toBeCloseTo(-1, 9);
    const [x3, y3] = direcaoNaTela(0, 1, 180); // norte com o mapa de cabeça para baixo: aponta para baixo
    expect(x3).toBeCloseTo(0, 9); expect(y3).toBeCloseTo(1, 9);
  });

  it('o rótulo anda para fora pela meia-extensão na direção da borda', () => {
    expect(deslocamentoParaFora([1, 0], 70, 18, 3)).toEqual([38, 0]);
    expect(deslocamentoParaFora([0, -1], 70, 18, 3)).toEqual([0, -12]);
    const [dx, dy] = deslocamentoParaFora([Math.SQRT1_2, Math.SQRT1_2], 70, 18, 3);
    expect(dx).toBeCloseTo(dy, 9);
    expect(dx).toBeCloseTo(Math.SQRT1_2 * (3 + (Math.SQRT1_2 * 70) / 2 + (Math.SQRT1_2 * 18) / 2), 9);
  });
});
