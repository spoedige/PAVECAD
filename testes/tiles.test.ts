import { describe, expect, it } from 'vitest';
import {
  entradasParaPodar, estimar, formatarBytes, KB_POR_TILE, MAX_TILES, metrosPorTile, tileDe, tilesDoCorredor, tilesDoZoom, urlDoTile,
} from '../src/dominio/tiles';

describe('tiles do corredor', () => {
  it('tile de ponto conhecido (Brasília, zoom 13)', () => {
    expect(tileDe(-47.9292, -15.7801, 13)).toEqual({ z: 13, x: 3005, y: 4459 });
    expect(tileDe(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
  });

  it('um ponto com buffer pequeno cobre 1 tile; o buffer grande cobre mais', () => {
    const l: [number, number][][] = [[[-47.93, -15.78]]];
    expect(tilesDoZoom(l, 13, 50).length).toBe(1);
    expect(tilesDoZoom(l, 17, 500).length).toBeGreaterThan(tilesDoZoom(l, 17, 50).length);
  });

  it('o número de tiles cresce com o buffer e com o comprimento do trecho', () => {
    const reta = (km: number): [number, number][] => Array.from({ length: km * 50 + 1 }, (_, i) => [-47.9 + (i * 0.02) / 111.32, -15.78]);
    const t = (km: number, b: number) => tilesDoCorredor([reta(km)], b).length;
    expect(t(5, 1000)).toBeGreaterThan(t(5, 500));
    expect(t(5, 2000)).toBeGreaterThan(t(5, 1000));
    expect(t(10, 500)).toBeGreaterThan(t(5, 500) * 1.5);
    expect(t(10, 500)).toBeLessThan(t(5, 500) * 2.5);
  });

  it('sem repetição e dentro dos zooms 13 a 17', () => {
    const l: [number, number][][] = [Array.from({ length: 200 }, (_, i) => [-47.9 + i * 0.0002, -15.78 + i * 0.0001])];
    const ts = tilesDoCorredor(l, 500);
    expect(new Set(ts.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(ts.length);
    expect(Math.min(...ts.map((t) => t.z))).toBe(13);
    expect(Math.max(...ts.map((t) => t.z))).toBe(17);
  });

  it('a cobertura contém o ponto do traçado em todos os zooms', () => {
    const l: [number, number][][] = [[[-47.9, -15.78], [-47.89, -15.775], [-47.88, -15.77]]];
    const ts = tilesDoCorredor(l, 500);
    for (let z = 13; z <= 17; z++) {
      const t = tileDe(-47.89, -15.775, z);
      expect(ts.some((x) => x.z === z && x.x === t.x && x.y === t.y)).toBe(true);
    }
  });

  it('metros por tile cai pela metade a cada zoom', () => {
    expect(metrosPorTile(-15, 14)).toBeCloseTo(metrosPorTile(-15, 13) / 2, 3);
  });
});

describe('estimativa, URL e poda', () => {
  it('estimativa por provedor e teto menor no OpenStreetMap', () => {
    const e = estimar(1000, 'esri');
    expect(e.bytes).toBe(1000 * KB_POR_TILE.esri * 1024);
    expect(e.excede).toBe(false);
    expect(estimar(MAX_TILES.osm + 1, 'osm').excede).toBe(true);
    expect(MAX_TILES.osm).toBeLessThan(MAX_TILES.esri);
  });

  it('URL do tile na ordem do provedor', () => {
    expect(urlDoTile('https://t.example/{z}/{x}/{y}.png', { z: 5, x: 6, y: 7 })).toBe('https://t.example/5/6/7.png');
    expect(urlDoTile('https://s.example/{z}/{y}/{x}', { z: 5, x: 6, y: 7 })).toBe('https://s.example/5/7/6');
  });

  it('poda os mais antigos até caber no limite', () => {
    expect(entradasParaPodar(15000, 20 * 1024, 300 * 1024 ** 2)).toBe(0);
    expect(entradasParaPodar(20000, 20 * 1024, 300 * 1024 ** 2)).toBe(20000 - 15360);
    expect(entradasParaPodar(0, 20, 100)).toBe(0);
    expect(entradasParaPodar(10, 0, 100)).toBe(0);
  });

  it('tamanho legível', () => {
    expect(formatarBytes(500 * 1024)).toBe('500 KB');
    expect(formatarBytes(300 * 1024 ** 2)).toBe('300 MB');
    expect(formatarBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
  });
});
