import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, MapMouseEvent, PointLike } from 'maplibre-gl';
import { edgesOf, offsetLL } from '../geometry/build';
import { IND, Q5, Q5F, type IndKey } from '../dominio/indicadores';
import { TR, TR_ORDER, trColor, trLabel } from '../dominio/solucoes';
import { kmLabel } from '../formats/km';
import { E, getP, projName, visibleProjects, type AppProj } from './estado';
import { $, cssv, esc, fmt, toast } from './ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Expr = any;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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
      sources: {
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' },
        esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Esri' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': cssv('--map') } },
        { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
      ],
    },
    center: [-48.1, -18.4], zoom: 6, maxZoom: 21, attributionControl: { compact: true },
    dragRotate: true, pitchWithRotate: false, maxPitch: 0, doubleClickZoom: true,
  });
  const zh = $('#zoomhost');
  zh.appendChild(new maplibregl.NavigationControl({ showCompass: false }).onAdd(map));
  zh.appendChild(new maplibregl.ScaleControl({ unit: 'metric' }).onAdd(map));

  map.on('load', () => {
    const offs: Expr = ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'k'], 2.7], 15, ['*', ['get', 'k'], 0.4], 16.2, 0];
    map.addSource('sel', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'sel-halo', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'poly'], paint: { 'line-color': '#07f', 'line-opacity': 0.25, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 10], 'line-blur': 3 } });
    map.addLayer({ id: 'sel', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'poly'], paint: { 'line-color': '#07f', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 2.8] } });
    map.addLayer({ id: 'sel-l', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': '#07f', 'line-width': 5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.6, 1, 16.6, 0], 'line-offset': offs } });
    map.addSource('ticks', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'ticks', type: 'line', source: 'ticks', paint: { 'line-color': '#000', 'line-width': 1.2, 'line-opacity': 0.7 } }, 'sel-halo');
    E.mapReady = true;
    E.P.forEach(addProjectToMap);
    applyPaint();
    onReady();
  });

  map.on('click', onMapClick);
  const tip = $('#tip');
  map.on('mousemove', (e) => {
    const h = hitAt(e.point);
    map.getCanvas().style.cursor = h ? 'pointer' : '';
    if (!h) { tip.style.display = 'none'; return; }
    tip.innerHTML = tipHtml(h);
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
  map.on('moveend', updateStakes);
  new MutationObserver(() => setTimeout(applyPaint, 20)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(applyPaint, 40));
}

export function setBase(b: typeof E.base) {
  E.base = b;
  if (!E.mapReady) return;
  map.setLayoutProperty('osm', 'visibility', b === 'osm' ? 'visible' : 'none');
  map.setLayoutProperty('esri', 'visibility', b === 'esri' ? 'visible' : 'none');
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
  map.addLayer({ id: 'pline-' + id, type: 'line', source: 'poly-' + id, minzoom: 16, paint: { 'line-color': '#000', 'line-width': 0.8 } }, before);
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
  for (const l of ['lines-', 'poly-', 'pline-', 'drainR-', 'drainP-']) if (map.getLayer(l + p.id)) map.removeLayer(l + p.id);
  for (const s of ['poly-', 'lines-', 'drain-']) if (map.getSource(s + p.id)) map.removeSource(s + p.id);
  p.markers.forEach((m) => m.remove());
  p.markers = [];
}

export function applyVisibility(p: AppProj) {
  const v = p.visible ? 'visible' : 'none', d = p.visible && E.layers.drain ? 'visible' : 'none';
  for (const l of ['lines-', 'poly-', 'pline-']) if (map.getLayer(l + p.id)) map.setLayoutProperty(l + p.id, 'visibility', v);
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
      p.markers.push(new maplibregl.Marker({ element: el }).setLngLat(offsetLL(p, p, mid, (Math.min(...e) + Math.max(...e)) / 2)).addTo(map));
    }
    i = j + 1;
  }
}

/* ---------------------------------------------------------------- */
/* Cores e pintura                                                   */
/* ---------------------------------------------------------------- */
const slot = (k: string) => (k === 'sol' ? null : IND[k as IndKey]);

function colorExpr(): Expr {
  const none = cssv('--none');
  if (E.mode === 'sol') {
    const m: Expr[] = ['match', ['get', 'main']];
    for (const k of Object.keys(TR)) m.push(k, trColor(k, E.field, none));
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

export function paintProject(p: AppProj) {
  const id = p.id, ce = colorExpr(), dc = dimCond(), f = E.field;
  let op: Expr = E.mode === 'sol' ? ['case', ['<', ['get', 'pct'], 100], f ? 0.72 : 0.62, f ? 1 : 0.94] : f ? 1 : 0.94;
  if (dc) op = ['case', dc, 0.07, op];
  let lop: Expr = 1;
  if (dc) lop = ['case', dc, 0.1, 1];
  const S = (l: string, k: string, v: Expr) => { if (map.getLayer(l)) map.setPaintProperty(l, k, v); };
  S('poly-' + id, 'fill-color', ce);
  S('poly-' + id, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 15.2, 0, 16.6, op]);
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

export function applyPaint() {
  if (!E.mapReady) return;
  E.P.forEach(paintProject);
  map.setPaintProperty('bg', 'background-color', cssv('--map'));
  map.setPaintProperty('ticks', 'line-color', cssv('--fg'));
  for (const l of ['sel', 'sel-l', 'sel-halo']) map.setPaintProperty(l, 'line-color', cssv('--focus'));
  renderLegend();
}

/* ---------------------------------------------------------------- */
/* Legenda                                                           */
/* ---------------------------------------------------------------- */
interface LegItem { key: string; c: string; l: string }

function legendItems(): LegItem[] {
  if (E.mode === 'sol') {
    const present = new Set<string>();
    for (const p of visibleProjects()) for (const m of p.model) { m.tr.forEach((t) => present.add(t.main)); present.add(m.sh.main); }
    const none = cssv('--none');
    const keys = [...TR_ORDER, ...[...present].filter((k) => !TR[k] && k !== '-')].filter((k) => present.has(k));
    const it = keys.map((k) => ({ key: k, c: trColor(k, E.field, none), l: trLabel(k) }));
    it.push({ key: '-', c: none, l: 'Sem intervenção' });
    return it;
  }
  return slot(E.mode)!.labels.map((l, i) => ({ key: String(i), c: Q()[i], l }));
}

let legendOpen = true;
try { legendOpen = localStorage.getItem('pavecad-leg') !== '0'; } catch { /* sem storage */ }

export function renderLegend() {
  const el = $('#legend'), items = legendItems();
  const I = slot(E.mode);
  const title = I ? `${I.label} · ${I.unit}${I.lim ? ' · ' + I.lim : ''}` : 'Solução';
  const abrev = (s: string) => s.replace('Fresagem funcional', 'Fres. funcional').replace('Fresagem estrutural', 'Fres. estrutural').replace('Microrrevestimento', 'Micro').replace('Reparo profundo', 'Reparo prof.');
  let h = '';
  if (!legendOpen) {
    h += `<button class="legtog" id="legTog" aria-expanded="false" aria-label="Expandir legenda"><span class="dots">${items.map((it) => `<i style="background:${it.c}"></i>`).join('')}</span>Legenda</button>`;
  } else {
    h += `<div class="leghead"><h4>${title}</h4><button class="legtog sm" id="legTog" aria-expanded="true" aria-label="Recolher legenda" title="Recolher"><svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button></div>`;
    h += `<ul title="Toque em um item para ocultar. Cor mais clara = 50% da área">` +
      items.map((it) => `<li><button type="button" data-k="${esc(it.key)}" aria-pressed="${!E.dim.has(it.key)}"><span class="sw" style="background:${it.c}"></span>${esc(abrev(it.l))}</button></li>`).join('') + '</ul>';
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
type Hit =
  | { drain: { p: AppProj; t: string; r0: number; r1: number } }
  | { p: AppProj; row: number; lane: number };

function hitAt(pt: PointLike & { x: number; y: number }): Hit | null {
  const b: [PointLike, PointLike] = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
  const vis = visibleProjects();
  const has = (l: string) => map.getLayer(l);
  if (E.layers.drain) {
    const dl = vis.flatMap((p) => ['drainR-' + p.id, 'drainP-' + p.id]).filter(has);
    const d = dl.length ? map.queryRenderedFeatures(b, { layers: dl }) : [];
    if (d.length) {
      const pr = d[0].properties, dp = getP(pr.pid);
      if (dp) return { drain: { p: dp, t: pr.t, r0: +pr.r0, r1: +pr.r1 } };
    }
  }
  const ly = vis.flatMap((p) => ['poly-' + p.id, 'lines-' + p.id]).filter(has);
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

function tipHtml(h: Hit): string {
  const multi = E.P.length > 1;
  if ('drain' in h) {
    const { p, t, r0, r1 } = h.drain;
    return `<b>Dreno tipo ${esc(t)}</b> <span>· ${(r1 - r0 + 1) * 20} m · lado ${p.opts.drainSide === 'in' ? 'interno' : 'externo'}</span><br>km ${p.kmLab[r0]} a ${kmLabel(p.kmNum[r1] + 0.02)}${multi ? ' · ' + esc(projName(p)) : ''}`;
  }
  const { p, row, lane } = h, L = lane ? p.rows[row].lanes[lane - 1] : null;
  let l2: string;
  if (E.mode === 'sol') {
    const t = lane ? p.model[row].tr[lane - 1] : p.model[row].sh;
    l2 = t?.code || 'Sem intervenção';
  } else {
    const M = slot(E.mode)!, v = L ? M.value(L) : null;
    l2 = v == null ? 'Sem leitura' : `${M.label} ${fmt(v * M.scale, M.dec)} ${M.unit}`;
  }
  return `<b>km ${p.kmLab[row]}</b> <span>· ${lane ? 'Faixa ' + lane : 'Acostamento'}${multi ? ' · ' + esc(projName(p)) : ''}</span><br>${esc(l2)}`;
}

export function select(pid: string, row: number, lane: number, opt: { pan?: boolean } = {}) {
  const p = getP(pid);
  if (!p) return;
  E.sel = { pid, row, lane };
  E.activeGroup = p.meta.uf;
  updateSelLayer();
  if (opt.pan && E.mapReady) {
    const r = p.rows[row];
    if (!map.getBounds().contains([r.lon, r.lat])) map.easeTo({ center: [r.lon, r.lat], duration: 500 });
  }
}

export function clearSel() { E.sel = null; updateSelLayer(); }

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
  showSel();
}

function showSel() {
  const s = E.sel, p = s && getP(s.pid);
  if (!s || !p) return;
  toast(tipHtml({ p, row: s.row, lane: s.lane }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 2400);
}

function onMapClick(e: MapMouseEvent) {
  const h = hitAt(e.point);
  if (!h || 'drain' in h) return;
  select(h.p.id, h.row, h.lane);
  showSel();
}

/* ---------------------------------------------------------------- */
/* Enquadramento, estacas e rotação                                  */
/* ---------------------------------------------------------------- */
const fitPad = () => (innerWidth > 900 ? { top: 110, left: 240, right: 60, bottom: 120 } : { top: 110, left: 30, right: 30, bottom: 70 });

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
export function updateStakes() {
  stakeMk.forEach((m) => m.remove());
  stakeMk = [];
  if (!E.mapReady) return;
  const z = map.getZoom(), step = z >= 18.2 ? 20 : z >= 15.8 ? 100 : z >= 14 ? 500 : 0, tk = src('ticks')!;
  if (!step || !E.layers.km) { tk.setData(EMPTY as Expr); return; }
  const bb = map.getBounds(), feats: Expr[] = [];
  let n = 0;
  for (const p of visibleProjects()) {
    const vistos = new Set<number>(); // 9+1000 e 10+000 são o mesmo km: um rótulo só
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
      const el = document.createElement('div');
      el.className = 'stake' + (m % 1000 === 0 ? ' km' : '');
      el.textContent = kmLabel(m / 1000);
      stakeMk.push(new maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? -3 : 3, 0] }).setLngLat(offsetLL(p, p, i, left ? lo - 1 : hi + 1)).addTo(map));
    }
  }
  tk.setData({ type: 'FeatureCollection', features: feats } as Expr);
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
  const m = /^(\d+)\+(\d{1,3})$/.exec(text.trim().replace(',', '.'));
  let t: number;
  if (m) t = +m[1] + +m[2].padEnd(3, '0') / 1000;
  else {
    t = parseFloat(text.trim().replace(',', '.'));
    if (isNaN(t)) { toast('Use o formato 59+740 ou 59,74'); return; }
  }
  let best: { p: AppProj; i: number; d: number } | null = null;
  for (const p of grupoAtivo()) for (let i = 0; i < p.rows.length; i++) {
    const d = Math.abs(p.kmNum[i] - t);
    if (!best || d < best.d) best = { p, i, d };
  }
  if (!best || best.d > 0.5) { toast('Esse km está fora dos trechos visíveis'); return; }
  const r = best.p.rows[best.i];
  map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 17.2), duration: 900 });
  select(best.p.id, best.i, 1);
  showSel();
}

/** Projetos visíveis do mesmo rodovia/UF ativo, crescente antes de decrescente. */
export function grupoAtivo(): AppProj[] {
  const v = visibleProjects();
  if (!v.length) return [];
  if (!E.activeGroup || !v.some((p) => p.meta.uf === E.activeGroup)) E.activeGroup = v[0].meta.uf;
  return v.filter((p) => p.meta.uf === E.activeGroup).sort((a, b) => b.meta.travel - a.meta.travel || a.meta.name.localeCompare(b.meta.name));
}
