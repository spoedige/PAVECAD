import { afterEach, describe, expect, it } from 'vitest';
import * as catalogo from '../src/dominio/catalogo';
import { efeitoDe } from '../src/dominio/propostas';
import { posicionarRoda } from '../src/dominio/notaRapida';

afterEach(() => catalogo.restaurarPadrao(false));

describe('nível das soluções no catálogo', () => {
  it('ordem inicial: sem intervenção 0, selagem 1, microfresagem 2, funcional 3, estrutural 4, reforço 5, reconstrução 6, reparo profundo 7', () => {
    expect([catalogo.nivelDe('-'), catalogo.nivelDe('ST'), catalogo.nivelDe('MFS'), catalogo.nivelDe('FS3'), catalogo.nivelDe('FSE'), catalogo.nivelDe('REF'), catalogo.nivelDe('REC'), catalogo.nivelDe('RP')])
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(catalogo.nivelDe('Micro')).toBeNull();
    expect(catalogo.nivelDe('XYZ')).toBeNull();
  });

  it('o nível é editável e vai e volta no JSON do catálogo; arquivo antigo, sem nível, mantém o do item', () => {
    catalogo.definir({ codigo: 'FS3', nivel: 9 });
    expect(catalogo.nivelDe('FS3')).toBe(9);
    const j = catalogo.exportar();
    expect(j.itens.find((i) => i.codigo === 'FS3')?.nivel).toBe(9);
    catalogo.restaurarPadrao(false);
    expect(catalogo.nivelDe('FS3')).toBe(3);
    catalogo.importar(j);
    expect(catalogo.nivelDe('FS3')).toBe(9);
    catalogo.importar({ versao: 1, tipo: 'catalogo-solucoes', itens: [{ codigo: 'FS3', nome: 'Fresagem funcional 3 cm', curto: 'x', cor: '#5ac8fa', categoria: 'Fresagem' }] });
    expect(catalogo.nivelDe('FS3')).toBe(9);
    catalogo.definir({ codigo: 'FS3', nivel: null });
    expect(catalogo.nivelDe('FS3')).toBeNull();
    catalogo.definir({ codigo: 'FS3', nivel: -2 });
    expect(catalogo.nivelDe('FS3')).toBeNull();
  });
});

describe('efeito da troca de solução', () => {
  it('nível maior aumenta, menor reduz', () => {
    expect(efeitoDe('MF', 'FSE')).toBe('Aumenta');
    expect(efeitoDe('-', 'ST')).toBe('Aumenta');
    expect(efeitoDe('REC', 'FS3')).toBe('Reduz');
    expect(efeitoDe('RP', 'REF')).toBe('Reduz');
  });
  it('nova "Sem intervenção" retira', () => {
    expect(efeitoDe('FS3', '-')).toBe('Retira');
    expect(efeitoDe('RP', '-')).toBe('Retira');
  });
  it('nível igual ou ausente é só troca', () => {
    expect(efeitoDe('FS3', 'F4R4')).toBe('Troca');
    expect(efeitoDe('FS3', 'Micro')).toBe('Troca');
    expect(efeitoDe('Micro', 'FS3')).toBe('Troca');
    expect(efeitoDe('FS3', 'XYZ')).toBe('Troca');
    expect(efeitoDe('-', '-')).toBe('Troca');
  });
  it('segue o nível editado no catálogo', () => {
    expect(efeitoDe('FS3', 'MFS')).toBe('Reduz');
    catalogo.definir({ codigo: 'MFS', nivel: 8 });
    expect(efeitoDe('FS3', 'MFS')).toBe('Aumenta');
  });
});

describe('roda de botões em 360x640', () => {
  const area = { w: 360, h: 560 }; // altura útil do mapa, já sem a barra do navegador
  const dentro = (b: { x: number; y: number }, tam: number) => b.x - tam / 2 >= 8 && b.x + tam / 2 <= area.w - 8 && b.y - tam / 2 >= 8 && b.y + tam / 2 <= area.h - 8;
  for (const [n, tam, raio] of [[4, 64, 116], [7, 64, 124], [7, 56, 116]] as const) {
    it(`${n} botões de ${tam} px: dentro da tela e sem sobrepor, em toda a área`, () => {
      for (let x = 0; x <= area.w; x += 20) for (let y = 0; y <= area.h; y += 20) {
        const r = posicionarRoda({ x, y }, area, n, tam, raio, 8, n === 4 ? 46 : 0);
        expect(r.botoes).toHaveLength(n);
        for (const b of r.botoes) expect(dentro(b, tam), `(${x},${y}) ${JSON.stringify(b)}`).toBe(true);
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(Math.hypot(r.botoes[a].x - r.botoes[b].x, r.botoes[a].y - r.botoes[b].y), `(${x},${y})`).toBeGreaterThanOrEqual(tam);
      }
    });
  }
  it('no meio da tela a roda de 7 abre para cima e não cobre o dedo', () => {
    const r = posicionarRoda({ x: 180, y: 400 }, area, 7, 64, 124);
    expect(r.deslocada).toBe(false);
    expect(r.botoes.every((b) => Math.hypot(b.x - 180, b.y - 400) > 64)).toBe(true);
  });
  it('no canto a roda inteira é deslocada para dentro', () => {
    const r = posicionarRoda({ x: 4, y: 4 }, area, 7, 64, 124);
    expect(r.deslocada).toBe(true);
    expect(r.centro.x).toBeGreaterThan(100);
  });
});
