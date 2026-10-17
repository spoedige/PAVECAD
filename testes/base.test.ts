import { describe, expect, it } from 'vitest';
import { baseSources, ESRI_MAX_ZOOM, ESRI_MAX_ZOOM_SEGURO, esriMaxZoom, MAP_MAX_ZOOM, MAPTILER_MAX, TILE_MAX_ZOOM } from '../src/mapa/base';

describe('zoom das bases do mapa', () => {
  it('OSM e Esri pedem tiles até o 19 por padrão; o mapa permite 21 (sobrezoom)', () => {
    const s = baseSources('');
    expect(Object.keys(s).sort()).toEqual(['esri', 'osm']);
    expect(s.osm).toMatchObject({ maxzoom: 19 });
    expect(s.esri).toMatchObject({ maxzoom: 19 });
    expect(TILE_MAX_ZOOM).toBe(19);
    expect(ESRI_MAX_ZOOM).toBe(19);
    expect(MAP_MAX_ZOOM).toBe(21);
  });

  it('nitidez do satélite: Máxima pede até o 19 e Segura até o 17, só na Esri', () => {
    expect(ESRI_MAX_ZOOM_SEGURO).toBe(17);
    expect(esriMaxZoom('maxima')).toBe(19);
    expect(esriMaxZoom('segura')).toBe(17);
    expect(baseSources('', 'maxima').esri).toMatchObject({ maxzoom: 19 });
    expect(baseSources('', 'segura').esri).toMatchObject({ maxzoom: 17 });
    expect(baseSources('', 'segura').osm).toMatchObject({ maxzoom: 19 });
  });

  it('com chave do MapTiler, mantém tiles até 21 (ruas) e 20 (satélite) e as reservas', () => {
    const s = baseSources('abc123');
    expect(s['mt-ruas']).toMatchObject({ maxzoom: 21 });
    expect(s['mt-sat']).toMatchObject({ maxzoom: 20 });
    expect(MAPTILER_MAX).toEqual({ ruas: 21, satelite: 20 });
    expect(s.osm).toMatchObject({ maxzoom: 19 });
    expect(s.esri).toMatchObject({ maxzoom: 19 });
    expect(baseSources('abc123', 'segura')['mt-sat']).toMatchObject({ maxzoom: 20 }); // a chave de nitidez não mexe no MapTiler
    expect(JSON.stringify(s['mt-ruas'].tiles)).toContain('key=abc123');
  });

  it('sem chave, nenhuma URL carrega o parâmetro key', () => {
    for (const v of Object.values(baseSources(''))) expect(JSON.stringify(v.tiles)).not.toContain('key=');
  });
});
