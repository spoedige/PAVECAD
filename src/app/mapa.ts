import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, MapMouseEvent, PointLike } from 'maplibre-gl';
import { edgesOf, offsetLL } from '../geometry/build';
import { ABREVIACOES_FAIXA, CLASSE_CRITICA, DESCRICAO_MODO, IND, INDICADORES_CRITICOS, PADRAO_DE_PAR, Q5, Q5F, SOLUCOES_CRITICAS, type IndKey } from '../dominio/indicadores';
import { trColor, trLabel, trOrder, trShort } from '../dominio/solucoes';
import type { Nota } from './estado';
import { parseKmTexto } from '../formats/km';
import { codigosOriginais } from '../formats/planservi';
import { baseSources, CHAVE_NITIDEZ, MAP_MAX_ZOOM, nitidezSalva, recarregarEsri, type Nitidez } from '../mapa/base';
import { agendarRotulos, PRIO, prioDeEstaca, resolverRotulos } from './rotulos';
import { E, H, NOTE_CATS, getP, kmFmt, kmReal, padraoAtivo, padraoDosPares, projName, visibleProjects, type AppProj, type FocoPred } from './estado';
import { $, cssv, esc, fmt, syncSeg, toast } from './ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Expr = any;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Chave do MapTiler vem do ambiente (VITE_MAPTILER_KEY) e nunca do repositório.
 *  Sem chave, a base cai no OpenStreetMap (ruas) e na Esri (satélite). */
const MT_KEY: string = (import.meta.env.VITE_MAPTILER_KEY ?? '').trim();
export const temMapTiler = () => !!MT_KEY;
let nitidez: Nitidez = nitidezSalva();
export const getNitidez = () => nitidez;

let map: maplibregl.Map;
export const getMap = () => map;
const Q = () => (E.field ? Q5F : Q5);
const drainColor = () => cssv('--drain');
const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

/* ---------------------------------------------------------------- */
/* Mapa e camadas fixas                                              */
/* ---------------------------------------------------------------- */
export function initMap(onReady: () => void) {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: baseSources(MT_KEY, nitidez),
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': cssv('--map') } },
        { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
        ...(MT_KEY ? [
          { id: 'mt-ruas', type: 'raster' as const, source: 'mt-ruas', layout: { visibility: 'none' as const } },
          { id: 'mt-sat', type: 'raster' as const, source: 'mt-sat', layout: { visibility: 'none' as const } },
        ] : []),
      ],
    },
    center: [-48.1, -18.4], zoom: 6, maxZoom: MAP_MAX_ZOOM, attributionControl: { compact: true },
    dragRotate: true, pitchWithRotate: false, maxPitch: 0, doubleClickZoom: true,
  });
  const zh = $('#zoomhost');
  zh.appendChild(new maplibregl.NavigationControl({ showCompass: false }).onAdd(map));
  zh.appendChild(new maplibregl.ScaleControl({ unit: 'metric' }).onAdd(map));

  map.on('load', () => {
    for (const [nome, tipo] of [['hachura', 'diag'], ['hpontos', 'pontos'], ['hlinhas', 'linhas']] as const) map.addImage(nome, criarHachura(tipo), { pixelRatio: 2 });
    const offs: Expr = ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'k'], 2.7], 15, ['*', ['get', 'k'], 0.4], 16.2, 0];
    map.addSource('sel', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'sel-halo', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'poly'], paint: { 'line-color': '#07f', 'line-opacity': 0.25, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 10], 'line-blur': 3 } });
    map.addLayer({ id: 'sel', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'poly'], paint: { 'line-color': '#07f', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 2.8] } });
    map.addLayer({ id: 'sel-l', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': '#07f', 'line-width': 5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.6, 1, 16.6, 0], 'line-offset': offs } });
    map.addSource('ticks', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'ticks', type: 'line', source: 'ticks', paint: { 'line-color': '#000', 'line-width': 1.2, 'line-opacity': 0.7 } }, 'sel-halo');
    const catc: Expr = ['match', ['get', 'cat'], ...Object.entries(NOTE_CATS).flatMap(([k, v]) => [k, v.c]), '#5e5ce6'];
    map.addSource('notes', { type: 'geojson', data: EMPTY });
    map.addSource('draft', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'notes-fill', type: 'fill', source: 'notes', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': catc, 'fill-opacity': 0.22 } });
    map.addLayer({ id: 'notes-line', type: 'line', source: 'notes', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': catc, 'line-width': 3.5 } });
    map.addLayer({ id: 'notes-pt', type: 'circle', source: 'notes', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 18, 10], 'circle-color': catc, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
    map.addSource('props', { type: 'geojson', data: EMPTY });
    map.addSource('psel', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'props-fill', type: 'fill', source: 'props', minzoom: 11, paint: { 'fill-color': '#888', 'fill-opacity': 0.94 } }, 'notes-fill');
    map.addLayer({ id: 'props-line', type: 'line', source: 'props', minzoom: 11, paint: { 'line-color': '#000', 'line-width': 1.4, 'line-dasharray': [2, 1.2] } }, 'notes-fill');
    map.addLayer({ id: 'psel-fill', type: 'fill', source: 'psel', paint: { 'fill-color': '#07f', 'fill-opacity': 0.4 } }, 'notes-fill');
    map.addLayer({ id: 'psel-line', type: 'line', source: 'psel', paint: { 'line-color': '#07f', 'line-width': 2.4 } }, 'notes-fill');
    map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0a84ff', 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#0a84ff', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#0a84ff', 'circle-stroke-width': 2.5 } });
    map.addSource('gps', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'gps-acc', type: 'fill', source: 'gps', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0a84ff', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'gps-pt', type: 'circle', source: 'gps', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#0a84ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    E.mapReady = true;
    E.P.forEach(addProjectToMap);
    applyPaint();
    onReady();
  });

  map.on('click', onMapClick);
  const tip = $('#tip');
  map.on('mousemove', (e) => {
    if (E.tool === 'pin') { map.getCanvas().style.cursor = 'crosshair'; return; }
    const h = hitAt(e.point);
    map.getCanvas().style.cursor = E.tool === 'prop' ? 'crosshair' : h ? 'pointer' : '';
    if (!h) { tip.style.display = 'none'; return; }
    tip.innerHTML = 'note' in h ? `<b>${esc(NOTE_CATS[h.note.cat].l)}</b><br>${esc((h.note.text || 'Sem texto').slice(0, 80))}` : tipHtml(h);
    tip.style.display = 'block';
    const w = $('.stage').getBoundingClientRect();
    let x = e.originalEvent.clientX - w.left + 14, y = e.originalEvent.clientY - w.top + 14;
    if (x > w.width - 220) x -= 240;
    if (y > w.height - 80) y -= 70;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  map.on('mouseout', () => { tip.style.display = 'none'; });

  const onZ = () => {
    const z = map.getZoom();
    $('.stage').classList.toggle('zoom-hi', z >= 11.5);
    $('#zoomnote').textContent = z < 15.6 ? 'Aproxime para ver a largura real das faixas.' : '';
  };
  map.on('zoom', onZ);
  onZ();
  map.on('rotate', () => { $('#compass').style.transform = `rotate(${-map.getBearing()}deg)`; });
  map.on('moveend', () => { updateStakes(); if (!legendAberta()) renderLegend(); });
  map.on('move', () => H.onView());
  new MutationObserver(() => setTimeout(applyPaint, 20)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(applyPaint, 40));
}

/** Nitidez do satélite da Esri (sem chave do MapTiler): "maxima" pede tiles até o 19, "segura" até o 17. Salva no aparelho. */
export function setNitidez(n: Nitidez, salvar = true) {
  nitidez = n;
  if (salvar) try { localStorage.setItem(CHAVE_NITIDEZ, n); } catch { /* sem storage */ }
  syncNitidezUi();
  if (E.mapReady && map.getSource('esri')) recarregarEsri(map, n);
}

/** Chave na gaveta do mapa. Com MapTiler o satélite não é o da Esri e a chave some. */
export function syncNitidezUi() {
  const box = document.getElementById('nitidezBox');
  if (!box) return;
  box.hidden = temMapTiler();
  box.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.n === nitidez)));
  syncSeg(document.getElementById('nitidez'));
}

export function setBase(b: typeof E.base) {
  E.base = b;
  if (!E.mapReady) return;
  const ruas = MT_KEY ? 'mt-ruas' : 'osm', sat = MT_KEY ? 'mt-sat' : 'esri';
  const on = b === 'osm' ? ruas : b === 'esri' ? sat : null;
  for (const l of ['osm', 'esri', 'mt-ruas', 'mt-sat']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', l === on ? 'visible' : 'none');
}

/* ---------------------------------------------------------------- */
/* Camadas por projeto                                               */
/* ---------------------------------------------------------------- */
export function addProjectToMap(p: AppProj) {
  const id = p.id, before = 'sel-halo';
  const offs: Expr = ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'k'], 2.7], 15, ['*', ['get', 'k'], 0.4], 16.2, 0];
  // tolerance 0: sem isso o MapLibre simplifica segmentos de 20 m a nada em zoom baixo.
  map.addSource('poly-' + id, { type: 'geojson', tolerance: 0, promoteId: 'fid', data: p.camadas.polys as Expr });
  map.addSource('lines-' + id, { type: 'geojson', tolerance: 0, promoteId: 'wid', data: p.camadas.lines as Expr });
  map.addSource('drain-' + id, { type: 'geojson', data: p.camadas.drains as Expr });
  map.addLayer({ id: 'lines-' + id, type: 'line', source: 'lines-' + id, maxzoom: 16.7, layout: { 'line-cap': 'butt' }, paint: { 'line-width': 2.4, 'line-offset': offs, 'line-color': '#888' } }, before);
  map.addLayer({ id: 'poly-' + id, type: 'fill', source: 'poly-' + id, minzoom: 14, paint: { 'fill-color': '#888', 'fill-opacity': 0.9 } }, before);
  // padrões além da cor: diagonal (classes críticas e RP), pontos (GAP) e linhas (Micro); o filtro e a visibilidade vêm de paintProject
  for (const [pre, img] of PADROES_CAMADAS) map.addLayer({ id: pre + id, type: 'fill', source: 'poly-' + id, minzoom: 15.2, filter: ['==', ['get', 'fid'], -1], layout: { visibility: 'none' }, paint: { 'fill-pattern': img, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, 0, 16.6, 0.9] } }, before);
  map.addLayer({ id: 'pline-' + id, type: 'line', source: 'poly-' + id, minzoom: 16, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#000', 'line-width': 0.8 } }, before);
  // polígono que falhou na validação (curto, cruzado): só a linha central do segmento
  map.addLayer({ id: 'cline-' + id, type: 'line', source: 'poly-' + id, minzoom: 14, filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#888', 'line-width': 3 } }, before);
  map.addLayer({ id: 'drainR-' + id, type: 'line', source: 'drain-' + id, minzoom: 11, filter: ['!=', ['get', 't'], 'P'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e0267f', 'line-width': 3 } }, before);
  map.addLayer({ id: 'drainP-' + id, type: 'line', source: 'drain-' + id, minzoom: 11, filter: ['==', ['get', 't'], 'P'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#e0267f', 'line-width': 3, 'line-dasharray': [1.6, 1.2] } }, before);
  buildMarkers(p);
  applyVisibility(p);
  paintProject(p);
}

export function setProjectData(p: AppProj) {
  src('poly-' + p.id)?.setData(p.camadas.polys as Expr);
  src('lines-' + p.id)?.setData(p.camadas.lines as Expr);
  src('drain-' + p.id)?.setData(p.camadas.drains as Expr);
  buildMarkers(p);
  applyVisibility(p);
}

export function removeProjectFromMap(p: AppProj) {
  for (const l of ['lines-', 'poly-', 'hach-', 'hpon-', 'hlin-', 'pline-', 'cline-', 'drainR-', 'drainP-']) if (map.getLayer(l + p.id)) map.removeLayer(l + p.id);
  for (const s of ['poly-', 'lines-', 'drain-']) if (map.getSource(s + p.id)) map.removeSource(s + p.id);
  p.markers.forEach((m) => m.remove());
  p.markers = [];
}

export function applyVisibility(p: AppProj) {
  const v = p.visible ? 'visible' : 'none', d = p.visible && E.layers.drain ? 'visible' : 'none';
  for (const l of ['lines-', 'poly-', 'pline-', 'cline-']) if (map.getLayer(l + p.id)) map.setLayoutProperty(l + p.id, 'visibility', v);
  paintHachura(p);
  for (const l of ['drainR-', 'drainP-']) if (map.getLayer(l + p.id)) map.setLayoutProperty(l + p.id, 'visibility', d);
  p.markers.forEach((m) => (m.getElement().style.display = p.visible ? '' : 'none'));
}

/** Marcos de km inteiro e plataformas (OAE, passarela). */
function buildMarkers(p: AppProj) {
  p.markers.forEach((m) => m.remove());
  p.markers = [];
  const R = p.rows;
  const feitos = new Set<number>();
  for (let i = 0; i < R.length; i++) {
    if (!p.normals[i] || !/\+000$/.test(p.kmLab[i])) continue;
    const km = parseInt(p.kmLab[i]);
    if (feitos.has(km)) continue; // 9+1000 e 10+000 viram o mesmo km
    feitos.add(km);
    const el = document.createElement('div');
    el.className = 'kmlabel ' + (km % 10 === 0 ? 'k10' : 'k1');
    el.textContent = 'km ' + km;
    Object.assign(el.dataset, { rot: 'km', pid: p.id, prio: String(PRIO.km) });
    p.markers.push(new maplibregl.Marker({ element: el, offset: [0, -14] }).setLngLat(offsetLL(p, p, i, edgesOf(R[i], p.opts).e[0] - 2)).addTo(map));
  }
  let i = 0;
  while (i < R.length) {
    const t = R[i].platform;
    if (!t) { i++; continue; }
    let j = i;
    while (j + 1 < R.length && R[j + 1].platform === t && R[j + 1].hod - R[j].hod < 0.0215) j++;
    const mid = Math.round((i + j) / 2);
    if (p.normals[mid]) {
      const e = edgesOf(R[mid], p.opts).e;
      const el = document.createElement('div');
      el.className = 'poi' + (/ped/i.test(t) ? ' ped' : '');
      el.textContent = t;
      Object.assign(el.dataset, { rot: 'poi', pid: p.id, prio: String(PRIO.poi) });
      p.markers.push(new maplibregl.Marker({ element: el }).setLngLat(offsetLL(p, p, mid, (Math.min(...e) + Math.max(...e)) / 2)).addTo(map));
    }
    i = j + 1;
  }
  agendarReaplicar();
}

/* ---------------------------------------------------------------- */
/* Cores e pintura                                                   */
/* ---------------------------------------------------------------- */
const slot = (k: string) => (k === 'sol' ? null : IND[k as IndKey]);

function colorExpr(): Expr {
  const none = cssv('--none');
  if (E.mode === 'sol') {
    const m: Expr[] = ['match', ['get', 'main']];
    for (const k of trOrder()) m.push(k, trColor(k, E.field, none));
    m.push(none);
    return m;
  }
  const st: Expr[] = ['step', ['to-number', ['get', slot(E.mode)!.prop], -1], none];
  Q().forEach((c, i) => st.push(i, c));
  return ['case', ['==', ['get', 'lane'], 0], none, st];
}

function dimCond(): Expr | null {
  if (!E.dim.size) return null;
  if (E.mode === 'sol') return ['in', ['get', 'main'], ['literal', [...E.dim]]];
  return ['in', ['to-number', ['get', slot(E.mode)!.prop], -1], ['literal', [...E.dim].map(Number)]];
}

/** Camadas de padrão por projeto: prefixo do id e imagem usada. */
const PADROES_CAMADAS = [['hach-', 'hachura'], ['hpon-', 'hpontos'], ['hlin-', 'hlinhas']] as const;

/** Padrão de duas cores (preta e branca translúcidas): aparece sobre qualquer cor de classe, no claro e no escuro. */
function criarHachura(tipo: 'diag' | 'pontos' | 'linhas'): ImageData {
  const n = 16, c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, n, n);
  const cores = ['rgba(0,0,0,.62)', 'rgba(255,255,255,.7)'];
  if (tipo === 'diag') {
    g.lineWidth = 2.2;
    cores.forEach((cor, i) => { g.strokeStyle = cor; for (let k = -n; k <= n * 2; k += 8) { g.beginPath(); g.moveTo(k + i * 3, n); g.lineTo(k + i * 3 + n, 0); g.stroke(); } });
  } else if (tipo === 'linhas') {
    g.lineWidth = 2;
    cores.forEach((cor, i) => { g.strokeStyle = cor; for (let y = 1 + i * 3; y < n; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); } });
  } else {
    cores.forEach((cor, i) => { g.fillStyle = cor; for (let x = 2 + i * 4; x < n; x += 8) for (let y = 2 + i * 4; y < n; y += 8) { g.beginPath(); g.arc(x, y, 1.7, 0, Math.PI * 2); g.fill(); } });
  }
  return g.getImageData(0, 0, n, n);
}

/** Soluções com cada padrão agora. Com "Padrão além da cor" ligado, diagonal em todas as críticas; sem escolha, só o RP (e GAP e Micro
 *  com pontos e linhas): o padrão dessas três separa as cores que o daltonismo confunde. */
export function solucoesPorPadrao(): { diag: string[]; pontos: string[]; linhas: string[] } {
  const pares = padraoDosPares();
  const de = (t: 'pontos' | 'linhas') => (pares ? Object.keys(PADRAO_DE_PAR).filter((k) => PADRAO_DE_PAR[k] === t) : []);
  return { diag: padraoAtivo() ? SOLUCOES_CRITICAS : pares ? ['RP'] : [], pontos: de('pontos'), linhas: de('linhas') };
}
export const solucoesComHachura = () => { const s = solucoesPorPadrao(); return [...s.diag, ...s.pontos, ...s.linhas]; };

/** Filtros das três camadas de padrão no modo atual (nulo = camada escondida). */
export function filtrosDoModo(): { hach: Expr | null; hpon: Expr | null; hlin: Expr | null } {
  const lista = (c: string[]): Expr | null => (c.length ? ['in', ['get', 'main'], ['literal', c]] : null);
  if (E.mode === 'sol') { const s = solucoesPorPadrao(); return { hach: lista(s.diag), hpon: lista(s.pontos), hlin: lista(s.linhas) }; }
  const crit = padraoAtivo() && INDICADORES_CRITICOS.includes(E.mode as IndKey) ? (['>=', ['to-number', ['get', IND[E.mode as IndKey].prop], -1], CLASSE_CRITICA] as Expr) : null;
  return { hach: crit, hpon: null, hlin: null };
}

/** Filtro e visibilidade das camadas de padrão de uma planilha. */
export function paintHachura(p: AppProj) {
  if (!E.mapReady) return;
  const f = filtrosDoModo();
  for (const [pre, chave] of [['hach-', 'hach'], ['hpon-', 'hpon'], ['hlin-', 'hlin']] as const) {
    const l = pre + p.id;
    if (!map.getLayer(l)) continue;
    const fi = f[chave];
    map.setFilter(l, fi ?? ['==', ['get', 'fid'], -1]);
    map.setLayoutProperty(l, 'visibility', fi && p.visible ? 'visible' : 'none');
  }
}

export function paintProject(p: AppProj) {
  const id = p.id, ce = colorExpr(), dc = dimCond(), f = E.field;
  let op: Expr = E.mode === 'sol' ? ['case', ['<', ['get', 'pct'], 100], f ? 0.72 : 0.62, f ? 1 : 0.94] : f ? 1 : 0.94;
  const hit: Expr = ['boolean', ['feature-state', 'hit'], false];
  if (dc) op = ['case', dc, 0.07, op];
  if (E.focus) op = ['case', hit, op, 0.07];
  let lop: Expr = 1;
  if (dc) lop = ['case', dc, 0.1, 1];
  if (E.focus) lop = ['case', hit, lop, 0.1];
  const S = (l: string, k: string, v: Expr) => { if (map.getLayer(l)) map.setPaintProperty(l, k, v); };
  S('poly-' + id, 'fill-color', ce);
  S('poly-' + id, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 15.2, 0, 16.6, op]);
  paintHachura(p);
  S('cline-' + id, 'line-color', ce);
  S('cline-' + id, 'line-opacity', f ? 1 : 0.94);
  S('lines-' + id, 'line-color', ce);
  S('lines-' + id, 'line-opacity', ['interpolate', ['linear'], ['zoom'], 15.6, lop, 16.6, 0]);
  S('lines-' + id, 'line-width', ['interpolate', ['linear'], ['zoom'], 8, f ? 3 : 2, 13, f ? 3.4 : 2.4, 16, f ? 3.4 : 2.4]);
  S('pline-' + id, 'line-color', f ? '#000000' : cssv('--map'));
  S('pline-' + id, 'line-opacity', f ? 0.8 : 0.55);
  S('pline-' + id, 'line-width', ['interpolate', ['linear'], ['zoom'], 16.5, 0, 19, f ? 1.8 : 0.8]);
  for (const l of ['drainR-', 'drainP-']) {
    S(l + id, 'line-color', drainColor());
    S(l + id, 'line-width', ['interpolate', ['linear'], ['zoom'], 11, f ? 2.4 : 1.4, 17, f ? 5 : 3, 20, f ? 8 : 5]);
  }
}

export function propColorExpr(): Expr {
  const m: Expr[] = ['match', ['get', 'to']];
  for (const k of trOrder()) m.push(k, trColor(k, E.field, cssv('--none')));
  m.push(cssv('--none'));
  return m;
}

export function applyPaint() {
  if (!E.mapReady) return;
  E.P.forEach(paintProject);
  map.setPaintProperty('bg', 'background-color', cssv('--map'));
  map.setPaintProperty('ticks', 'line-color', cssv('--fg'));
  for (const l of ['sel', 'sel-l', 'sel-halo']) map.setPaintProperty(l, 'line-color', cssv('--focus'));
  map.setPaintProperty('props-fill', 'fill-color', propColorExpr());
  map.setPaintProperty('props-line', 'line-color', cssv('--fg'));
  map.setPaintProperty('psel-fill', 'fill-color', cssv('--accent'));
  map.setPaintProperty('psel-line', 'line-color', cssv('--accent'));
  renderLegend();
  H.onView();
}

/* ---------------------------------------------------------------- */
/* Legenda                                                           */
/* ---------------------------------------------------------------- */
interface LegItem { key: string; c: string; l: string; s: string }

function legendItems(): LegItem[] {
  if (E.mode === 'sol') {
    const present = new Set<string>();
    for (const p of visibleProjects()) for (const m of p.model) { m.tr.forEach((t) => present.add(t.main)); present.add(m.sh.main); }
    const none = cssv('--none');
    const ordem = trOrder();
    const keys = [...ordem, ...[...present].filter((k) => !ordem.includes(k) && k !== '-')].filter((k) => present.has(k));
    const it = keys.map((k) => ({ key: k, c: trColor(k, E.field, none), l: trLabel(k), s: trShort(k) }));
    it.push({ key: '-', c: none, l: 'Sem intervenção', s: 'Sem intervenção' });
    return it;
  }
  return slot(E.mode)!.labels.map((l, i) => ({ key: String(i), c: Q()[i], l, s: l }));
}

// No layout único (601 px ou mais) a legenda começa recolhida (botão pequeno); a escolha do usuário, quando existe, vale sobre o padrão.
const OCULTAR_LEGENDA = `<button class="gocultar" type="button" data-ocultar="legenda" aria-label="Ocultar legenda" title="Ocultar legenda"><svg class="i" viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.2 7C3.7 8.7 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-.9"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/></svg></button>`;
const legendAberta = () => legendOpen && E.tool !== 'prop';
let legendOpen = !window.matchMedia('(min-width: 601px)').matches;
try { const v = localStorage.getItem('pavecad-leg'); if (v !== null) legendOpen = v !== '0'; } catch { /* sem storage */ }

/** Quantos segmentos de cada classe aparecem na vista atual (chave da legenda -> contagem). */
function contagemNaVista(): Map<string, number> {
  const out = new Map<string, number>();
  if (!E.mapReady) return out;
  const bb = map.getBounds(), I = slot(E.mode);
  for (const p of visibleProjects()) {
    for (let i = 0; i < p.rows.length; i++) {
      const r = p.rows[i];
      if (r.lon < bb.getWest() || r.lon > bb.getEast() || r.lat < bb.getSouth() || r.lat > bb.getNorth()) continue;
      if (!I) {
        for (const t of p.model[i].tr) out.set(t.main, (out.get(t.main) ?? 0) + 1);
        if (p.model[i].sh.main) out.set(p.model[i].sh.main, (out.get(p.model[i].sh.main) ?? 0) + 1);
      } else {
        for (const l of r.lanes) {
          const v = I.value(l);
          if (v == null) continue;
          const k = String(I.cls(v));
          out.set(k, (out.get(k) ?? 0) + 1);
        }
      }
    }
  }
  return out;
}

/** As classes mais presentes na vista (até 3) e quantas outras também aparecem ("Sem intervenção" fica de fora das duas contas, salvo se for a única). "Sem intervenção" só entra se for a única. */
export function topoDaLegenda(items: LegItem[]): { top: LegItem[]; mais: number } {
  const c = contagemNaVista();
  const presentes = items.filter((it) => (c.get(it.key) ?? 0) > 0).sort((a, b) => (c.get(b.key) ?? 0) - (c.get(a.key) ?? 0));
  const uteis = presentes.filter((it) => it.key !== '-');
  const base = uteis.length ? uteis : presentes;
  const top = base.slice(0, 3);
  return { top, mais: Math.max(0, base.length - top.length) };
}

/** Classe crítica: recebe hachura quando "Padrão além da cor" está ligado. */
/** Padrão da classe na legenda: diagonal (crítica), pontos ou linhas; nulo se a classe não tem padrão agora. */
const padraoDe = (it: LegItem): 'crit' | 'pontos' | 'linhas' | null => {
  if (E.mode === 'sol') { const s = solucoesPorPadrao(); return s.diag.includes(it.key) ? 'crit' : s.pontos.includes(it.key) ? 'pontos' : s.linhas.includes(it.key) ? 'linhas' : null; }
  return padraoAtivo() && INDICADORES_CRITICOS.includes(E.mode as IndKey) && +it.key >= CLASSE_CRITICA ? 'crit' : null;
};
const ehCritica = (it: LegItem) => !!padraoDe(it);

export function renderLegend() {
  const el = $('#legend'), items = legendItems();
  // com a barra Propor solução aberta a legenda fica compacta, para a pilha de baixo caber em telas baixas
  const aberta = legendAberta();
  const I = slot(E.mode);
  const title = I ? `${I.label} · ${I.unit}${I.lim ? ' · ' + I.lim : ''}` : 'Solução';
  let h = '';
  if (!aberta) {
    const { top, mais } = topoDaLegenda(items);
    const nomes = top.map((it) => `<span class="lt"><i class="${padraoDe(it) ?? ''}" style="background-color:${it.c}"></i>${esc(it.s)}</span>`).join('');
    h += `<div class="legrow"><button class="legtog" id="legTog" aria-expanded="false" aria-label="Expandir legenda" title="${esc(DESCRICAO_MODO[E.mode])}"><span class="legtop">${nomes || '<span class="lt">Legenda</span>'}</span>${mais ? `<span class="legmais" aria-label="mais ${mais} classes na vista">+${mais}</span>` : ''}</button>${OCULTAR_LEGENDA}</div>`;
  } else {
    h += `<div class="leghead"><h4 title="${esc(DESCRICAO_MODO[E.mode])}">${title}</h4><span class="legbtns"><button class="legtog sm" id="legTog" aria-expanded="true" aria-label="Recolher legenda" title="Recolher"><svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>${OCULTAR_LEGENDA}</span></div>`;
    h += `<ul title="Toque em um item para ocultar. Cor mais clara = 50% da área">` +
      items.map((it) => `<li><button type="button" data-k="${esc(it.key)}" aria-pressed="${!E.dim.has(it.key)}"><span class="sw${padraoDe(it) ? ' ' + padraoDe(it) : ''}" style="background-color:${it.c}"></span>${esc(it.s)}</button></li>`).join('') + '</ul>';
    h += `<p class="legnote">${esc(DESCRICAO_MODO[E.mode])}<br>${ABREVIACOES_FAIXA}${items.some((i) => padraoDe(i) === 'crit') ? '<br>Hachura diagonal: classe crítica' : ''}${items.some((i) => padraoDe(i) === 'pontos') ? '<br>Pontos: GAP' : ''}${items.some((i) => padraoDe(i) === 'linhas') ? '<br>Linhas: Micro' : ''}</p>`;
  }
  el.innerHTML = h;
  el.querySelectorAll<HTMLButtonElement>('li button').forEach((b) =>
    b.addEventListener('click', () => { const k = b.dataset.k!; E.dim.has(k) ? E.dim.delete(k) : E.dim.add(k); applyPaint(); }));
  const lt = document.getElementById('legTog');
  if (lt) lt.onclick = () => { legendOpen = !legendOpen; try { localStorage.setItem('pavecad-leg', legendOpen ? '1' : '0'); } catch { /* sem storage */ } renderLegend(); };
}

/* ---------------------------------------------------------------- */
/* Feição sob o cursor, dica e seleção                               */
/* ---------------------------------------------------------------- */
export type Hit =
  | { note: Nota }
  | { drain: { p: AppProj; t: string; r0: number; r1: number } }
  | { p: AppProj; row: number; lane: number };

export function hitAt(pt: PointLike & { x: number; y: number }): Hit | null {
  const b: [PointLike, PointLike] = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
  const vis = visibleProjects();
  const has = (l: string) => map.getLayer(l);
  if (E.layers.notes) {
    const n = map.queryRenderedFeatures(b, { layers: ['notes-pt', 'notes-line', 'notes-fill'].filter(has) });
    if (n.length) {
      const nt = E.notes.find((x) => x.id === n[0].properties.id) ?? (E.editing?.id === n[0].properties.id ? E.editing : undefined);
      if (nt) return { note: nt };
    }
  }
  if (E.layers.drain && E.tool !== 'prop') {
    const dl = vis.flatMap((p) => ['drainR-' + p.id, 'drainP-' + p.id]).filter(has);
    const d = dl.length ? map.queryRenderedFeatures(b, { layers: dl }) : [];
    if (d.length) {
      const pr = d[0].properties, dp = getP(pr.pid);
      if (dp) return { drain: { p: dp, t: pr.t, r0: +pr.r0, r1: +pr.r1 } };
    }
  }
  const ly = vis.flatMap((p) => ['poly-' + p.id, 'cline-' + p.id, 'lines-' + p.id]).filter(has);
  const f = ly.length ? map.queryRenderedFeatures(b, { layers: ly }) : [];
  if (!f.length) return null;
  const pr = f[0].properties, p = getP(pr.pid);
  if (!p) return null;
  let row = +pr.row;
  if (pr.r0 !== undefined) {
    const ll = map.unproject(pt as PointLike as [number, number]);
    let bd = 1e18;
    for (let t = +pr.r0; t <= +pr.r1; t++) {
      const d = (p.rows[t].lat - ll.lat) ** 2 + (p.rows[t].lon - ll.lng) ** 2;
      if (d < bd) { bd = d; row = t; }
    }
  }
  return { p, row, lane: +pr.lane };
}

function tipHtml(h: Exclude<Hit, { note: Nota }>): string {
  const multi = E.P.length > 1;
  if ('drain' in h) {
    const { p, t, r0, r1 } = h.drain;
    return `<b>Dreno tipo ${esc(t)}</b> <span>· ${(r1 - r0 + 1) * 20} m · lado ${p.opts.drainSide === 'in' ? 'interno' : 'externo'}</span><br>km ${p.kmLab[r0]} a ${kmFmt(p.kmNum[r1] + 0.02)}${multi ? ' · ' + esc(projName(p)) : ''}`;
  }
  const { p, row, lane } = h, L = lane ? p.rows[row].lanes[lane - 1] : null;
  let l2: string[];
  if (E.mode === 'sol') {
    const t = lane ? p.model[row].tr[lane - 1] : p.model[row].sh;
    l2 = codigosOriginais(p.rows[row], lane);
    if (!l2.length) l2 = [t?.code || 'Sem intervenção'];
  } else {
    const M = slot(E.mode)!, v = L ? M.value(L) : null;
    l2 = [v == null ? 'Sem leitura' : `${M.label} ${fmt(v * M.scale, M.dec)} ${M.unit}`];
  }
  return `<b>km ${p.kmLab[row]}</b> <span>· ${lane ? 'Faixa ' + lane : 'Acostamento'}${multi ? ' · ' + esc(projName(p)) : ''}</span>${l2.map((x) => '<br>' + esc(x)).join('')}`;
}

export function select(pid: string, row: number, lane: number, opt: { pan?: boolean; tab?: boolean } = {}) {
  const p = getP(pid);
  if (!p) return;
  const refAntes = refProjeto()?.id;
  E.sel = { pid, row, lane };
  E.activeGroup = p.meta.uf;
  if (refProjeto()?.id !== refAntes) updateStakes();
  updateSelLayer();
  if (opt.pan && E.mapReady) {
    const r = p.rows[row];
    if (!map.getBounds().contains([r.lon, r.lat])) map.easeTo({ center: [r.lon, r.lat], duration: 500 });
  }
  H.onSelect(opt);
}

export function clearSel() { const a = refProjeto()?.id; E.sel = null; updateSelLayer(); if (refProjeto()?.id !== a) updateStakes(); H.onSelect({}); }

export function updateSelLayer() {
  if (!E.mapReady) return;
  const fs: Expr[] = [];
  const s = E.sel, p = s && getP(s.pid);
  const f = p && s && p.polyByFid.get(s.row * 8 + (s.lane || 7));
  if (p && s && f) {
    const c = (f.geometry as GeoJSON.Polygon).coordinates[0];
    const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    fs.push({ type: 'Feature', properties: { kind: 'poly' }, geometry: f.geometry });
    fs.push({ type: 'Feature', properties: { kind: 'line', k: s.lane ? s.lane - 1 : p.rows[s.row].widths.length }, geometry: { type: 'LineString', coordinates: [mid(c[0], c[1]), mid(c[3], c[2])] } });
  }
  src('sel')?.setData({ type: 'FeatureCollection', features: fs });
}

/** Anterior e próximo (dr) e faixa acima ou abaixo (dl). */
export function stepSel(dr: number, dl: number) {
  const s = E.sel, p = s && getP(s.pid);
  if (!s || !p) return;
  const N = p.rows[s.row].widths.length;
  const row = Math.max(0, Math.min(p.rows.length - 1, s.row + dr)), N2 = p.rows[row].widths.length;
  let li = (s.lane === 0 ? N : s.lane - 1) + dl;
  li = Math.max(0, Math.min(N2, li));
  select(s.pid, row, li >= N2 ? 0 : li + 1, { pan: true });
}

function onMapClick(e: MapMouseEvent) {
  if (H.onClick(e)) return;
  const h = hitAt(e.point);
  if (!h) return;
  if ('note' in h) { H.onNoteHit(h.note.id); return; }
  if ('drain' in h) { select(h.drain.p.id, Math.round((h.drain.r0 + h.drain.r1) / 2), 1, { tab: true }); return; }
  select(h.p.id, h.row, h.lane, { tab: true });
}

/* ---------------------------------------------------------------- */
/* Enquadramento, estacas e rotação                                  */
/* ---------------------------------------------------------------- */
/** Folga do enquadramento: a rodovia deve caber na parte livre do mapa, fora dos cartões flutuantes. Mede os elementos de verdade
 *  (topo, barra lateral e legenda à esquerda, painel à direita, unifilar embaixo); telas estreitas mantêm a folga fixa. */
const fitPad = () => {
  if (innerWidth <= 900) return { top: 110, left: 30, right: 30, bottom: 70 };
  const ret = (s: string) => { const e = document.querySelector<HTMLElement>(s); return e && e.checkVisibility() ? e.getBoundingClientRect() : null; };
  const m = 12;
  const topo = Math.max(0, ...['#modes', '.topright', '#titlecard'].map((s) => ret(s)?.bottom ?? 0)) + m;
  // a legenda recolhida muda de largura conforme as classes da vista (até 330 px): reserva o máximo
  const leg = ret('#legend');
  const esq = Math.max(0, ret('#tools')?.right ?? 0, leg ? Math.max(leg.right, leg.left + 330) : 0) + m;
  const dir = ret('#inspector'), uni = ret('#unicard');
  const direita = dir ? innerWidth - dir.left + m : 60;
  // o unifilar pode ainda não ter a altura final no primeiro enquadramento: vale o maior entre o medido e a altura padrão (190 px), salvo recolhido
  const baixo = uni ? Math.max(innerHeight - uni.top, E.uniCollapsed ? 0 : 204) + m : 60;
  const w = innerWidth, h = innerHeight;
  // sem folga demais: sobra ao menos metade da tela para a rodovia (cada eixo com o seu fator)
  const fx = Math.min(1, (w * 0.5) / Math.max(1, esq + direita)), fy = Math.min(1, (h * 0.5) / Math.max(1, topo + baixo));
  return { top: Math.round(topo * fy), left: Math.round(esq * fx), right: Math.round(direita * fx), bottom: Math.round(baixo * fy) };
};

export function fitList(list: AppProj[], instant = false) {
  if (!list.length || !E.mapReady) return;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of list) {
    x0 = Math.min(x0, p.bounds[0][0]); y0 = Math.min(y0, p.bounds[0][1]);
    x1 = Math.max(x1, p.bounds[1][0]); y1 = Math.max(y1, p.bounds[1][1]);
  }
  map.fitBounds([[x0, y0], [x1, y1]], { padding: fitPad(), duration: instant ? 0 : 700 });
}
export const fitAll = (instant = false) => fitList(visibleProjects(), instant);

let stakeMk: maplibregl.Marker[] = [];
/** Estacas por zoom: 500 m a partir do zoom 14, 100 m a partir de 15,8 e 20 m a partir de 18,2. */
/** Planilha de referência dos rótulos de texto: a selecionada; senão, a primeira do grupo ativo. */
export function refProjeto(): AppProj | undefined {
  const sel = E.sel ? getP(E.sel.pid) : undefined;
  if (sel?.visible) return sel;
  return grupoAtivo()[0] ?? visibleProjects()[0];
}

const estacasAtivas = () => E.mapReady && E.layers.km && map.getZoom() >= 14;

/** Refaz só a resolução de colisão (painel mudou de tamanho, aba trocada, seleção mudou). */
export function reaplicarRotulos() {
  if (!E.mapReady) return;
  resolverRotulos({ refId: refProjeto()?.id ?? null, estacasAtivas: estacasAtivas() });
}
export const agendarReaplicar = () => agendarRotulos(reaplicarRotulos);

/** Estacas por zoom: 500 m a partir do zoom 14, 100 m a partir de 15,8 e 20 m a partir de 18,2.
 *  O traço aparece em todas as planilhas; o rótulo de texto só na de referência, sem colisão. */
export function updateStakes() {
  stakeMk.forEach((m) => m.remove());
  stakeMk = [];
  if (!E.mapReady) return;
  const z = map.getZoom(), step = z >= 18.2 ? 20 : z >= 15.8 ? 100 : z >= 14 ? 500 : 0, tk = src('ticks')!;
  if (!step || !E.layers.km) { tk.setData(EMPTY as Expr); reaplicarRotulos(); return; }
  const bb = map.getBounds(), feats: Expr[] = [], ref = refProjeto();
  for (const p of visibleProjects()) {
    const vistos = new Set<number>(); // 9+1000 e 10+000 são o mesmo km: um rótulo só
    let n = 0;
    for (let i = 0; i < p.rows.length && n < 200; i++) {
      if (!p.normals[i]) continue;
      const m = Math.round(p.kmNum[i] * 1000);
      if (m % step || vistos.has(m)) continue;
      const r = p.rows[i];
      if (r.lon < bb.getWest() - 0.002 || r.lon > bb.getEast() + 0.002 || r.lat < bb.getSouth() - 0.002 || r.lat > bb.getNorth() + 0.002) continue;
      vistos.add(m);
      n++;
      const e = edgesOf(r, p.opts).e, lo = Math.min(...e), hi = Math.max(...e), left = p.opts.travel > 0;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [offsetLL(p, p, i, lo - 0.6), offsetLL(p, p, i, hi + 0.6)] } });
      if (p !== ref) continue;
      const el = document.createElement('div');
      el.className = 'stake' + (m % 1000 === 0 ? ' km' : '');
      el.textContent = kmFmt(m / 1000);
      Object.assign(el.dataset, { rot: 'estaca', pid: p.id, prio: String(prioDeEstaca(m)) });
      stakeMk.push(new maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? -3 : 3, 0] }).setLngLat(offsetLL(p, p, i, left ? lo - 1 : hi + 1)).addTo(map));
    }
  }
  tk.setData({ type: 'FeatureCollection', features: feats } as Expr);
  reaplicarRotulos();
}

export const rotate = (graus: number) => map.easeTo({ bearing: map.getBearing() + graus, duration: 250 });
export const north = () => map.easeTo({ bearing: 0, duration: 400 });

/** Deixa o sentido de tráfego do trecho selecionado, ou do mais próximo do centro, apontando para cima. */
export function alignToRoad() {
  if (!E.mapReady) return;
  let p: AppProj | undefined, i = -1;
  if (E.sel && getP(E.sel.pid)) { p = getP(E.sel.pid)!; i = E.sel.row; }
  else {
    const c = map.getCenter();
    let bd = 1e18;
    for (const q of visibleProjects()) q.rows.forEach((r, k) => {
      if (!q.normals[k]) return;
      const d = (r.lat - c.lat) ** 2 + (r.lon - c.lng) ** 2;
      if (d < bd) { bd = d; p = q; i = k; }
    });
  }
  if (!p || i < 0) { toast('Nenhum trecho visível'); return; }
  const R = p.rows, a = Math.max(0, i - 2), b = Math.min(R.length - 1, i + 2);
  if (a === b) return;
  const mLon = 111320 * Math.cos((R[i].lat * Math.PI) / 180);
  let br = (Math.atan2((R[b].lon - R[a].lon) * mLon, (R[b].lat - R[a].lat) * 111132) * 180) / Math.PI;
  if (p.opts.travel < 0) br += 180;
  map.easeTo({ bearing: br, duration: 600 });
  toast('Pista alinhada ao sentido de tráfego');
}

/** "59+740" ou "59,74". */
export function goLabel(text: string) {
  const t0 = parseKmTexto(text), t = t0 === null ? null : kmReal(t0);
  if (t === null) { toast('Use o formato 59+740 ou 59,74'); return; }
  // Procura primeiro no grupo ativo; se o km não existir lá, nos demais visíveis.
  const procurar = (lista: AppProj[]) => {
    let best: { p: AppProj; i: number; d: number } | null = null;
    for (const p of lista) for (let i = 0; i < p.rows.length; i++) {
      const d = Math.abs(p.kmNum[i] - t);
      if (!best || d < best.d) best = { p, i, d };
    }
    return best && best.d <= 0.5 ? best : null;
  };
  const best = procurar(grupoAtivo()) ?? procurar(visibleProjects());
  if (!best) { toast('Esse km está fora dos trechos visíveis'); return; }
  const r = best.p.rows[best.i];
  map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 17.2), duration: 900 });
  select(best.p.id, best.i, 1, { tab: true });
}

/** Projetos visíveis do mesmo rodovia/UF ativo, crescente antes de decrescente. */
export function grupoAtivo(): AppProj[] {
  const v = visibleProjects();
  if (!v.length) return [];
  if (!E.activeGroup || !v.some((p) => p.meta.uf === E.activeGroup)) E.activeGroup = v[0].meta.uf;
  return v.filter((p) => p.meta.uf === E.activeGroup).sort((a, b) => b.meta.travel - a.meta.travel || a.meta.name.localeCompare(b.meta.name));
}

/* ---------------------------------------------------------------- */
/* Foco (filtro vindo da Análise) e camadas                          */
/* ---------------------------------------------------------------- */
const winStart = (p: AppProj, i: number) => {
  const s = p.segs[p.segOf[i]];
  return s.a + Math.floor((i - s.a) / 5) * 5;
};

function clearFocusStates() {
  if (!E.mapReady) return;
  for (const p of E.P) for (const s of ['poly-', 'lines-']) if (map.getSource(s + p.id)) map.removeFeatureState({ source: s + p.id });
}

export function clearFocus() {
  if (!E.focus) return;
  clearFocusStates();
  E.focus = null;
  applyPaint();
}

/** Destaca no mapa só as faixas que atendem ao critério. Devolve false quando nenhuma atende. */
export function setFocus(label: string, pred: FocoPred): boolean {
  clearFocusStates();
  E.focus = { label, n: 0, pred };
  for (const p of visibleProjects()) {
    p.rows.forEach((r, i) => {
      for (let k = 0; k < r.widths.length; k++) {
        if (!pred(r.lanes[k], p.model[i].tr[k], r, p)) continue;
        E.focus!.n++;
        map.setFeatureState({ source: 'poly-' + p.id, id: i * 8 + k + 1 }, { hit: true });
        map.setFeatureState({ source: 'lines-' + p.id, id: winStart(p, i) * 8 + k + 1 }, { hit: true });
      }
    });
  }
  if (!E.focus.n) { E.focus = null; toast('Nenhum segmento atende a esse filtro'); return false; }
  applyPaint();
  return true;
}

export function fitFocus() {
  const f = E.focus;
  if (!f) return;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, any = false;
  for (const p of visibleProjects()) p.rows.forEach((r, i) => {
    for (let k = 0; k < r.widths.length; k++) {
      if (f.pred(r.lanes[k], p.model[i].tr[k], r, p)) {
        any = true;
        x0 = Math.min(x0, r.lon); x1 = Math.max(x1, r.lon); y0 = Math.min(y0, r.lat); y1 = Math.max(y1, r.lat);
        break;
      }
    }
  });
  if (any) map.fitBounds([[x0, y0], [x1, y1]], { padding: fitPad(), duration: 700, maxZoom: 15 });
}

export function applyLayers() {
  E.P.forEach(applyVisibility);
  updateStakes();
  $('.stage').classList.toggle('hide-km', !E.layers.km);
  $('.stage').classList.toggle('hide-poi', !E.layers.poi);
  if (E.mapReady) for (const l of ['notes-fill', 'notes-line', 'notes-pt']) map.setLayoutProperty(l, 'visibility', E.layers.notes ? 'visible' : 'none');
}

export function setData(id: string, data: GeoJSON.FeatureCollection) { src(id)?.setData(data); }
