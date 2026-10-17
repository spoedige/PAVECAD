import type { Map as MapLibreMap, RasterSourceSpecification } from 'maplibre-gl';

/** Zoom máximo de tile do OSM (ruas sem chave). Acima disso o MapLibre amplia o tile do zoom 19 (sobrezoom). */
export const TILE_MAX_ZOOM = 19;
/** Zoom máximo de tile da Esri (satélite sem chave) no modo "Máxima". O padrão é 19: nos zooms altos o tile ampliado de um nível menor
 *  fica borrado. Em parte do interior a Esri não tem imagem nos zooms 18 e 19 e devolve um tile com a mensagem "Map data not yet
 *  available"; para esses casos existe o modo "Segura" (17), que amplia o tile 17 em vez de pedir os níveis sem imagem. */
export const ESRI_MAX_ZOOM = 19;
export const ESRI_MAX_ZOOM_SEGURO = 17;
export type Nitidez = 'maxima' | 'segura';
export const esriMaxZoom = (n: Nitidez) => (n === 'segura' ? ESRI_MAX_ZOOM_SEGURO : ESRI_MAX_ZOOM);
export const CHAVE_NITIDEZ = 'pavecad-nitidez';

/** Escolha salva da nitidez do satélite; "maxima" quando não há escolha. */
export function nitidezSalva(): Nitidez {
  try { return localStorage.getItem(CHAVE_NITIDEZ) === 'segura' ? 'segura' : 'maxima'; } catch { return 'maxima'; }
}

export const esriSource = (n: Nitidez): RasterSourceSpecification =>
  ({ type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: esriMaxZoom(n), attribution: 'Esri' });

/** Recarrega só a fonte do satélite da Esri com outro nível máximo de tile. O MapLibre não muda o maxzoom de uma fonte existente,
 *  então a fonte e a camada são recriadas no mesmo lugar da pilha e com a mesma visibilidade. Centro, zoom e rumo não mudam. */
export function recarregarEsri(map: MapLibreMap, n: Nitidez) {
  const camadas = map.getStyle().layers, i = camadas.findIndex((l) => l.id === 'esri');
  if (i < 0) return;
  const antes = camadas[i + 1]?.id;
  const vis = map.getLayoutProperty('esri', 'visibility') ?? 'none';
  map.removeLayer('esri');
  map.removeSource('esri');
  map.addSource('esri', esriSource(n));
  map.addLayer({ id: 'esri', type: 'raster', source: 'esri', layout: { visibility: vis } }, antes);
}
/** Zoom máximo do mapa. Vale para todas as bases; com MapTiler os tiles vão a 21 (ruas) e 20 (satélite). */
export const MAP_MAX_ZOOM = 21;
export const MAPTILER_MAX = { ruas: 21, satelite: 20 };

/** Fontes raster das bases. Sem chave do MapTiler, só OSM (ruas) e Esri (satélite).
 *  A chave vem do ambiente (VITE_MAPTILER_KEY) e nunca do repositório. */
export function baseSources(key: string, nitidez: Nitidez = 'maxima'): Record<string, RasterSourceSpecification> {
  const src: Record<string, RasterSourceSpecification> = {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: TILE_MAX_ZOOM, attribution: '© OpenStreetMap' },
    esri: esriSource(nitidez),
  };
  if (key) {
    const attr = '© MapTiler © OpenStreetMap contributors';
    src['mt-ruas'] = { type: 'raster', tiles: [`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}`], tileSize: 256, maxzoom: MAPTILER_MAX.ruas, attribution: attr };
    src['mt-sat'] = { type: 'raster', tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${key}`], tileSize: 256, maxzoom: MAPTILER_MAX.satelite, attribution: attr };
  }
  return src;
}
