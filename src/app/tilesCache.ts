import {
  LIMITE_PADRAO_MB, LIMITES_MB, MAX_TILES, NOME_PROVEDOR, entradasParaPodar, estimar, tilesDoCorredor, urlDoTile,
  type Estimativa, type Provedor, type Tile,
} from '../dominio/tiles';
import { E, visibleProjects } from './estado';
import { fontesDeTiles, temMapTiler } from './mapa';

/** Cache dos tiles do mapa: o service worker guarda o que o MapLibre pede (CacheFirst); aqui ficam o limite em MB, a poda
 *  dos mais antigos e o "Preparar para campo", que pede os tiles do corredor pelo mesmo caminho de requisição. */

export const CACHE_TILES = 'mapa-tiles';
const CHAVE_LIMITE = 'pavecad-cache-mb';
const CHAVE_PREPARO = 'pavecad-ultimo-preparo';

export const limiteMb = (): number => {
  try { const v = Number(localStorage.getItem(CHAVE_LIMITE)); return (LIMITES_MB as readonly number[]).includes(v) ? v : LIMITE_PADRAO_MB; } catch { return LIMITE_PADRAO_MB; }
};
export function definirLimiteMb(mb: number) {
  try { localStorage.setItem(CHAVE_LIMITE, String(mb)); } catch { /* sem storage */ }
}

export interface Preparo { provedor: Provedor; nome: string; tiles: number; novos: number; jaTinha: number; falhas: number; bytes: number; buffer: number; quando: string; completo: boolean }
export function ultimoPreparo(): Preparo | null {
  try { const j = localStorage.getItem(CHAVE_PREPARO); return j ? (JSON.parse(j) as Preparo) : null; } catch { return null; }
}
const guardarPreparo = (p: Preparo) => { try { localStorage.setItem(CHAVE_PREPARO, JSON.stringify(p)); } catch { /* sem storage */ } };

/** Provedor do fundo atual, ou null no Liso (não há tile para guardar). */
export function provedorAtual(): { id: Provedor; modelo: string; nome: string } | null {
  if (E.base === 'none') return null;
  const id: Provedor = E.base === 'osm' ? (temMapTiler() ? 'mt-ruas' : 'osm') : (temMapTiler() ? 'mt-sat' : 'esri');
  const fonte = fontesDeTiles()[id];
  const modelo = fonte && 'tiles' in fonte && fonte.tiles ? fonte.tiles[0] : '';
  return modelo ? { id, modelo, nome: NOME_PROVEDOR[id] } : null;
}

/** Linhas [lon, lat] do eixo de cada trecho contínuo das planilhas visíveis. */
export function linhasDoCorredor(): [number, number][][] {
  const out: [number, number][][] = [];
  for (const p of visibleProjects()) for (const s of p.segs) out.push(p.rows.slice(s.a, s.b + 1).map((r) => [r.lon, r.lat] as [number, number]));
  return out;
}

export function estimarPreparo(buffer: number): (Estimativa & { prov: NonNullable<ReturnType<typeof provedorAtual>> }) | null {
  const prov = provedorAtual();
  if (!prov) return null;
  const tiles = tilesDoCorredor(linhasDoCorredor(), buffer).length;
  return { ...estimar(tiles, prov.id), prov };
}

/* ---- cache ---- */

const temCache = () => typeof caches !== 'undefined';

export async function estatisticasCache(): Promise<{ entradas: number; bytesMedio: number; bytes: number }> {
  if (!temCache()) return { entradas: 0, bytesMedio: 0, bytes: 0 };
  const c = await caches.open(CACHE_TILES), chaves = await c.keys();
  if (!chaves.length) return { entradas: 0, bytesMedio: 0, bytes: 0 };
  const n = Math.min(40, chaves.length), passo = chaves.length / n;
  let soma = 0, lidos = 0;
  for (let i = 0; i < n; i++) {
    const r = await c.match(chaves[Math.floor(i * passo)]);
    if (!r) continue;
    soma += (await r.clone().blob()).size; lidos++;
  }
  const medio = lidos ? soma / lidos : 0;
  return { entradas: chaves.length, bytesMedio: medio, bytes: Math.round(medio * chaves.length) };
}

/** Descarta os tiles mais antigos (primeiros do cache) até a estimativa de tamanho caber no limite. Devolve quantos saíram. */
export async function podarCache(): Promise<number> {
  if (!temCache()) return 0;
  const { entradas, bytesMedio } = await estatisticasCache();
  const sai = entradasParaPodar(entradas, bytesMedio, limiteMb() * 1024 * 1024);
  if (!sai) return 0;
  const c = await caches.open(CACHE_TILES), chaves = await c.keys();
  await Promise.all(chaves.slice(0, sai).map((k) => c.delete(k)));
  return sai;
}

export async function limparCache(): Promise<void> {
  if (temCache()) await caches.delete(CACHE_TILES);
}

/* ---- preparar para campo ---- */

export interface Progresso { feitos: number; total: number; bytes: number; falhas: number; jaTinha: number }

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Pausa entre pedidos de cada trabalhador (2 em paralelo): ~15 tiles por segundo no máximo, para respeitar os limites do provedor. */
const PAUSA_MS = 120;
const TRABALHADORES = 2;

/** Pede os tiles do corredor nos zooms 13 a 17 pelo caminho normal de requisição (o service worker os guarda). Sem service worker
 *  ativo, grava no mesmo cache direto. Cancelável por `sinal`. */
export async function preparar(buffer: number, aoProgredir: (p: Progresso) => void, sinal: AbortSignal): Promise<Preparo | null> {
  const prov = provedorAtual();
  if (!prov) return null;
  const tiles: Tile[] = tilesDoCorredor(linhasDoCorredor(), buffer);
  if (tiles.length > MAX_TILES[prov.id]) return null;
  const cache = temCache() ? await caches.open(CACHE_TILES) : null;
  const semSw = !navigator.serviceWorker?.controller;
  const p: Progresso = { feitos: 0, total: tiles.length, bytes: 0, falhas: 0, jaTinha: 0 };
  let proximo = 0, ultimaTela = 0;
  const informar = (forcar = false) => { const t = Date.now(); if (forcar || t - ultimaTela > 150) { ultimaTela = t; aoProgredir({ ...p }); } };
  const trabalhar = async () => {
    while (!sinal.aborted) {
      const t = tiles[proximo++];
      if (!t) return;
      const url = urlDoTile(prov.modelo, t);
      try {
        if (cache && await cache.match(url)) { p.jaTinha++; }
        else {
          const r = await fetch(url, { signal: sinal, mode: 'cors' });
          if (!r.ok) throw new Error(String(r.status));
          const copia = r.clone();
          p.bytes += (await r.arrayBuffer()).byteLength;
          if (cache && semSw) await cache.put(url, copia);
        }
      } catch { if (sinal.aborted) return; p.falhas++; }
      p.feitos++;
      informar();
      await dormir(PAUSA_MS);
    }
  };
  await Promise.all(Array.from({ length: TRABALHADORES }, trabalhar));
  informar(true);
  const prep: Preparo = {
    provedor: prov.id, nome: prov.nome, tiles: tiles.length, novos: p.feitos - p.jaTinha - p.falhas, jaTinha: p.jaTinha, falhas: p.falhas,
    bytes: p.bytes, buffer, quando: new Date().toISOString(), completo: !sinal.aborted,
  };
  guardarPreparo(prep);
  await podarCache();
  return prep;
}

/** Poda o cache pouco depois de abrir o app, sem atrapalhar a primeira pintura. */
export function agendarPoda() {
  const rodar = () => { void podarCache(); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  setTimeout(() => (ric ? ric(rodar, { timeout: 10000 }) : rodar()), 8000);
}
