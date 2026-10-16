import type { RasterSourceSpecification } from 'maplibre-gl';

/** Zoom máximo de tile dos provedores sem chave (OSM e Esri). Acima disso o MapLibre amplia o tile do zoom 19
 *  (sobrezoom), o que evita pedir tiles que não existem e a mensagem "Map data not yet available". */
export const TILE_MAX_ZOOM = 19;
/** Zoom máximo do mapa. Vale para todas as bases; com MapTiler os tiles vão a 21 (ruas) e 20 (satélite). */
export const MAP_MAX_ZOOM = 21;
export const MAPTILER_MAX = { ruas: 21, satelite: 20 };

/** Fontes raster das bases. Sem chave do MapTiler, só OSM (ruas) e Esri (satélite).
 *  A chave vem do ambiente (VITE_MAPTILER_KEY) e nunca do repositório. */
export function baseSources(key: string): Record<string, RasterSourceSpecification> {
  const src: Record<string, RasterSourceSpecification> = {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: TILE_MAX_ZOOM, attribution: '© OpenStreetMap' },
    esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: TILE_MAX_ZOOM, attribution: 'Esri' },
  };
  if (key) {
    const attr = '© MapTiler © OpenStreetMap contributors';
    src['mt-ruas'] = { type: 'raster', tiles: [`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}`], tileSize: 256, maxzoom: MAPTILER_MAX.ruas, attribution: attr };
    src['mt-sat'] = { type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${key}`], tileSize: 256, maxzoom: MAPTILER_MAX.satelite, attribution: attr };
  }
  return src;
}
