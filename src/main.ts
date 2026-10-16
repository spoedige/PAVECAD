import { registerSW } from 'virtual:pwa-register';
import './estilos/app.css';
import './estilos/config.css';
import { E, H } from './app/estado';
import {
  agendarReaplicar, alignToRoad, applyLayers, clearSel, fitAll, getMap, goLabel, initMap, north, rotate, select, setBase, stepSel, updateStakes,
} from './app/mapa';
import { MODE_KEYS, type ModeKey } from './dominio/indicadores';
import { abrirDb } from './app/persist';
import { gpsToggle } from './app/gps';
import { initRevisao, onToolClick, refreshNotesLayer, refreshPropLayers, resolveProps, setTool } from './app/revisao';
import { abrirArquivos, abrirLidas, carregarConfig, restaurarProjetos } from './app/projetos';
import { abrirConfig, atualizarAviso, configAberta, initConfig } from './app/config';
import { renderAll, renderSeg, setField, setMode, setTab, syncBaseSeg } from './app/paineis';
import { drawUni, initUnifilar } from './app/unifilar';
import { clearFocus } from './app/mapa';
import { $, observarHud, observarRolagem, syncAllSegs, syncSeg, toast } from './app/ui';

async function carregarExemplos() {
  const { nomesExemplo, lerExemplo } = await import('./app/exemplo');
  toast('Carregando exemplos...', 60000);
  const lista = [];
  for (const n of nomesExemplo()) lista.push({ parsed: await lerExemplo(n), rotulo: n });
  const novos = await abrirLidas(lista, false);
  if (novos[0]) E.activeGroup = novos[0].meta.uf;
  renderAll();
  toast(`${novos.length} planilha(s) de exemplo`);
}

/* ---- controles ---- */
$('#btnFile').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length) void abrirArquivos(files);
});
if (import.meta.env.DEV) {
  $('#btnExample').hidden = false;
  $('#btnExample').addEventListener('click', () => void carregarExemplos());
} else {
  $('#btnExample').remove(); // só existe em desenvolvimento
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

/* ---- lista de atalhos ---- */
const ajudaAberta = () => !$('#ajuda').hidden;
function abrirAjuda() {
  $('#ajuda').hidden = false;
  $('#ajudaFundo').hidden = false;
  $('#btnAjuda').setAttribute('aria-expanded', 'true');
  $('#ajudaFechar').focus();
}
function fecharAjuda() {
  $('#ajuda').hidden = true;
  $('#ajudaFundo').hidden = true;
  $('#btnAjuda').setAttribute('aria-expanded', 'false');
  $('#btnAjuda').focus();
}
$('#btnAjuda').addEventListener('click', () => (ajudaAberta() ? fecharAjuda() : abrirAjuda()));
$('#ajudaFechar').addEventListener('click', fecharAjuda);
$('#ajudaFundo').addEventListener('click', fecharAjuda);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ajudaAberta()) { e.stopPropagation(); e.preventDefault(); fecharAjuda(); } }, true);

window.addEventListener('keydown', (e) => {
  const t = (e.target as HTMLElement).tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (configAberta() || ajudaAberta()) return;
  const k = e.key;
  if (k === '?' && !matchMedia('(pointer: coarse)').matches) { abrirAjuda(); return; }
  if (k === ',') { abrirConfig(); return; }
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

/** Só em desenvolvimento: gancho para os testes de interface (Playwright). Não existe no build. */
if (import.meta.env.DEV) {
  (window as unknown as { __pavecad: unknown }).__pavecad = {
    E,
    setField: (on: boolean, silencioso?: boolean) => { if (E.field !== on) setField(on); if (silencioso) $('#toast').classList.remove('on'); },
    select, setTab, map: getMap,
  };
}

async function boot() {
  try { E.field = localStorage.getItem('pavecad-field') === '1'; } catch { /* sem storage */ }
  if (E.field) { document.documentElement.setAttribute('data-contrast', 'field'); $('#btnField').setAttribute('aria-pressed', 'true'); }
  await abrirDb();
  await carregarConfig();
  await initRevisao();
  initUnifilar();
  initConfig();
  observarHud(agendarReaplicar);
  document.querySelectorAll<HTMLElement>('.tabbody').forEach(observarRolagem);
  renderAll();
  initMap(() => {
    resolveProps();
    applyLayers();
    refreshNotesLayer();
    refreshPropLayers();
    renderAll();
    updateStakes();
    if (E.P.length) fitAll(true);
  });
  syncAllSegs();
  syncSeg($('#modes'));
  const n = await restaurarProjetos();
  if (n) toast(`${n} planilha(s) reaberta(s) deste aparelho`);
  atualizarAviso();
}
void boot();

/* PWA: cache do app para abrir sem rede. Só ativo no build (no dev não há service worker). */
registerSW({
  immediate: true,
  onOfflineReady: () => toast('Pronto para uso sem internet', 4000),
  onRegisterError: (e) => console.warn('service worker:', e),
});
