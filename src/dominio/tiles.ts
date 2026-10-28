/** Tiles de mapa para uso offline: quais tiles cobrem o corredor das planilhas, quanto pesam e como podar o cache.
 *  Função pura; a rede e o cache ficam em app/tilesCache. */

export const ZOOM_MIN_CAMPO = 13;
export const ZOOM_MAX_CAMPO = 17;
export const BUFFERS_M = [500, 1000, 2000] as const;
export const LIMITE_PADRAO_MB = 300;
export const LIMITES_MB = [100, 300, 600, 1000] as const;

export type Provedor = 'osm' | 'esri' | 'mt-ruas' | 'mt-sat';

export const NOME_PROVEDOR: Record<Provedor, string> = {
  osm: 'OpenStreetMap (ruas)', esri: 'Esri World Imagery (satélite)', 'mt-ruas': 'MapTiler Streets (ruas)', 'mt-sat': 'MapTiler Satellite (satélite)',
};

/** Peso médio de um tile 256 px (KB), por provedor. Serve só para a estimativa antes de baixar. */
export const KB_POR_TILE: Record<Provedor, number> = { osm: 14, esri: 30, 'mt-ruas': 12, 'mt-sat': 30 };

/** Máximo de tiles por preparação. O OpenStreetMap desencoraja download em massa: o teto dele é bem menor. */
export const MAX_TILES: Record<Provedor, number> = { osm: 2000, esri: 25000, 'mt-ruas': 25000, 'mt-sat': 25000 };

export interface Tile { z: number; x: number; y: number }

const M_GRAU = 111320;

export function tileDe(lon: number, lat: number, z: number): Tile {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Metros por pixel de um tile de 256 px na latitude dada. */
export const metrosPorTile = (lat: number, z: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Tiles que cobrem as linhas ([lon, lat]) com uma faixa de `bufferM` metros para cada lado, em um zoom. Cobertura retangular em torno de cada amostra. */
export function tilesDoZoom(linhas: [number, number][][], z: number, bufferM: number): Tile[] {
  const achados = new Map<number, Tile>();
  const n = 2 ** z;
  for (const linha of linhas) {
    let ult: [number, number] | null = null;
    for (const pt of linha) {
      const [lon, lat] = pt;
      const passo = Math.min(bufferM, metrosPorTile(lat, z) / 2);
      if (ult) {
        const dx = (lon - ult[0]) * M_GRAU * Math.cos((lat * Math.PI) / 180), dy = (lat - ult[1]) * M_GRAU;
        if (Math.hypot(dx, dy) < passo) continue;
      }
      ult = pt;
      const dLat = bufferM / M_GRAU, dLon = bufferM / (M_GRAU * Math.cos((lat * Math.PI) / 180));
      const a = tileDe(lon - dLon, lat + dLat, z), b = tileDe(lon + dLon, lat - dLat, z);
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) achados.set(x * n + y, { z, x, y });
    }
  }
  return [...achados.values()];
}

export function tilesDoCorredor(linhas: [number, number][][], bufferM: number, zMin = ZOOM_MIN_CAMPO, zMax = ZOOM_MAX_CAMPO): Tile[] {
  const out: Tile[] = [];
  for (let z = zMin; z <= zMax; z++) out.push(...tilesDoZoom(linhas, z, bufferM));
  return out;
}

export interface Estimativa { tiles: number; bytes: number; excede: boolean; max: number }

export function estimar(tiles: number, prov: Provedor): Estimativa {
  return { tiles, bytes: tiles * KB_POR_TILE[prov] * 1024, excede: tiles > MAX_TILES[prov], max: MAX_TILES[prov] };
}

/** URL de um tile a partir do modelo da fonte ({z}, {x}, {y}). */
export const urlDoTile = (modelo: string, t: Tile) => modelo.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));

/** Quantas entradas manter para caber no limite, dado o peso médio medido. As mais antigas (primeiras do cache) saem. */
export function entradasParaPodar(total: number, bytesMedio: number, limiteBytes: number): number {
  if (!(bytesMedio > 0) || total <= 0) return 0;
  const cabem = Math.floor(limiteBytes / bytesMedio);
  return Math.max(0, total - cabem);
}

export const formatarBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
