import { describe, expect, it } from 'vitest';
import { baseSources, MAP_MAX_ZOOM, MAPTILER_MAX, TILE_MAX_ZOOM } from '../src/mapa/base';

describe('zoom das bases do mapa', () => {
  it('OSM e Esri pedem tiles só até o zoom 19; o mapa permite 21 (sobrezoom)', () => {
    const s = baseSources('');
    expect(Object.keys(s).sort()).toEqual(['esri', 'osm']);
    expect(s.osm).toMatchObject({ maxzoom: 19 });
    expect(s.esri).toMatchObject({ maxzoom: 19 });
    expect(TILE_MAX_ZOOM).toBe(19);
    expect(MAP_MAX_ZOOM).toBe(21);
  });

  it('com chave do MapTiler, mantém tiles até 21 (ruas) e 20 (satélite) e as reservas', () => {
    const s = baseSources('abc123');
    expect(s['mt-ruas']).toMatchObject({ maxzoom: 21 });
    expect(s['mt-sat']).toMatchObject({ maxzoom: 20 });
    expect(MAPTILER_MAX).toEqual({ ruas: 21, satelite: 20 });
    expect(s.osm).toMatchObject({ maxzoom: 19 });
    expect(s.esri).toMatchObject({ maxzoom: 19 });
    expect(JSON.stringify(s['mt-ruas'].tiles)).toContain('key=abc123');
  });

  it('sem chave, nenhuma URL carrega o parâmetro key', () => {
    for (const v of Object.values(baseSources(''))) expect(JSON.stringify(v.tiles)).not.toContain('key=');
  });
});
