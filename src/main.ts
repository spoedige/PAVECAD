import './estilos/app.css';
import { carregarLido, carregarPlanilha } from './mapa/cliente';
import { criarProjeto, E, H, novoId, type AppProj } from './app/estado';
import {
  addProjectToMap, alignToRoad, applyLayers, clearSel, fitList, goLabel, initMap, north, removeProjectFromMap, rotate,
  setBase, stepSel, updateStakes,
} from './app/mapa';
import { MODE_KEYS, type ModeKey } from './dominio/indicadores';
import { abrirDb } from './app/persist';
import { gpsToggle } from './app/gps';
import { initRevisao, onToolClick, refreshNotesLayer, refreshPropLayers, resolveProps, setTool } from './app/revisao';
import { renderAll, renderSeg, setField, setMode, setTab, syncBaseSeg } from './app/paineis';
import { drawUni, initUnifilar } from './app/unifilar';
import { clearFocus } from './app/mapa';
import { $, syncAllSegs, syncSeg, toast } from './app/ui';

function addProject(p: AppProj) {
  const old = E.P.find((x) => x.meta.name === p.meta.name);
  if (old) { if (E.mapReady) removeProjectFromMap(old); E.P = E.P.filter((x) => x !== old); }
  E.P.push(p);
  if (E.mapReady) addProjectToMap(p);
}

async function incluir(carregar: (id: string) => ReturnType<typeof carregarPlanilha>, rotulo: string): Promise<AppProj | null> {
  try {
    const id = novoId();
    const r = await carregar(id);
    const p = criarProjeto(id, r.projeto, { opts: r.opts, normals: r.normals, camadas: r.camadas });
    for (const l of p.log) console.info(`[${p.meta.name}] ${l.level}: ${l.msg}`);
    addProject(p);
    const avisos = p.log.filter((l) => l.level === 'warn').length;
    if (avisos) toast(`${rotulo}: ${avisos} aviso(s) de importação. Veja em Ajustes`, 5000);
    return p;
  } catch (err) {
    toast(`${rotulo}: ${(err as Error).message}`, 6000);
    return null;
  }
}

async function terminar(novos: AppProj[]) {
  if (!novos.length) return;
  E.settingsPid ??= novos[0].id;
  E.activeGroup ??= novos[0].meta.uf;
  resolveProps();
  refreshPropLayers();
  renderAll();
  fitList(novos);
  toast(`${novos.length} planilha(s) carregada(s)`);
}

async function abrir(files: File[]) {
  const novos: AppProj[] = [];
  for (const f of files) {
    toast(`Lendo ${f.name}... arquivos grandes podem levar alguns segundos`, 60000);
    const buf = await f.arrayBuffer();
    const p = await incluir((id) => carregarPlanilha(id, buf), f.name);
    if (p) novos.push(p);
  }
  await terminar(novos);
}

async function carregarExemplos() {
  const { nomesExemplo, lerExemplo } = await import('./app/exemplo');
  toast('Carregando exemplos...', 60000);
  const novos: AppProj[] = [];
  for (const n of nomesExemplo()) {
    const parsed = await lerExemplo(n);
    const p = await incluir((id) => carregarLido(id, parsed), n);
    if (p) novos.push(p);
  }
  E.activeGroup = novos[0]?.meta.uf ?? E.activeGroup;
  await terminar(novos);
}

/* ---- controles ---- */
$('#btnFile').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length) void abrir(files);
});
if (import.meta.env.DEV) {
  $('#btnExample').hidden = false;
  $('#btnExample').addEventListener('click', () => void carregarExemplos());
}
document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m as ModeKey)));
document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.t as typeof E.tab)));
document.querySelectorAll<HTMLButtonElement>('#base button').forEach((b) =>
  b.addEventListener('click', () => { setBase(b.dataset.b as typeof E.base); syncBaseSeg(); renderAll(); }));
$('#rotL').addEventListener('click', () => rotate(-15));
$('#rotR').addEventListener('click', () => rotate(15));
$('#rotN').addEventListener('click', north);
$('#rotA').addEventListener('click', alignToRoad);
$('#btnGps').addEventListener('click', () => void gpsToggle());
$('#btnField').addEventListener('click', () => setField(!E.field));
$('#goBtn').addEventListener('click', () => { const v = $<HTMLInputElement>('#gokm').value; if (v.trim()) goLabel(v); });
$('#gokm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('#goBtn').click(); (e.target as HTMLElement).blur(); } });
$('#collapse').addEventListener('click', () => {
  const c = $('#inspector').classList.toggle('collapsed');
  $('#collapse').setAttribute('aria-label', c ? 'Expandir painel' : 'Recolher painel');
  $('#collapse').innerHTML = `<svg class="i" viewBox="0 0 24 24"><path d="${c ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'}"/></svg>`;
});

window.addEventListener('keydown', (e) => {
  const t = (e.target as HTMLElement).tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k >= '1' && k <= '6') { setMode(MODE_KEYS[+k - 1]); return; }
  if (k === '/') { e.preventDefault(); $('#gokm').focus(); return; }
  if (k === 'Escape') {
    if (E.tool) { setTool(null); return; }
    if (E.editing) { E.editing = null; refreshNotesLayer(); renderAll(); return; }
    if (E.focus) { clearFocus(); return; }
    clearSel();
    return;
  }
  const lk = k.toLowerCase();
  if (lk === 'p') { setTool('pin'); return; }
  if (lk === 'n') { setTool('prop'); return; }
  if (lk === 'q') { rotate(-15); return; }
  if (lk === 'e') { rotate(15); return; }
  if (lk === 'r') { alignToRoad(); return; }
  if (lk === 'g') { void gpsToggle(); return; }
  if (lk === 's') { setField(!E.field); return; }
  if (!E.sel) return;
  const big = e.shiftKey ? 10 : 1;
  if (k === 'ArrowRight') { e.preventDefault(); stepSel(big, 0); }
  else if (k === 'ArrowLeft') { e.preventDefault(); stepSel(-big, 0); }
  else if (k === 'ArrowUp') { e.preventDefault(); stepSel(0, -1); }
  else if (k === 'ArrowDown') { e.preventDefault(); stepSel(0, 1); }
});

/* ---- ganchos entre mapa e painéis ---- */
H.onSelect = (opt) => {
  if (E.sel) E.settingsPid = E.sel.pid;
  renderSeg();
  drawUni();
  if (opt.tab) setTab('seg');
};
H.onClick = onToolClick;

async function boot() {
  try { E.field = localStorage.getItem('pavecad-field') === '1'; } catch { /* sem storage */ }
  if (E.field) { document.documentElement.setAttribute('data-contrast', 'field'); $('#btnField').setAttribute('aria-pressed', 'true'); }
  await abrirDb();
  await initRevisao();
  initUnifilar();
  renderAll();
  initMap(() => {
    resolveProps();
    applyLayers();
    refreshNotesLayer();
    refreshPropLayers();
    renderAll();
    updateStakes();
  });
  syncAllSegs();
  syncSeg($('#modes'));
}
void boot();
