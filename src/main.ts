import { registerSW } from 'virtual:pwa-register';
import './estilos/app.css';
import './estilos/config.css';
import './estilos/painel.css';
import './estilos/controles.css';
import './estilos/celular.css';
import { E, H } from './app/estado';
import {
  agendarReaplicar, marcosInfo, alignToRoad, applyLayers, clearSel, fitAll, getMap, goLabel, initMap, north, rotate, select, setBase, setNitidez, stepSel, syncNitidezUi, updateStakes,
} from './app/mapa';
import type { ModeKey } from './dominio/indicadores';
import { abrirDb, bancoIndisponivel, LIMITE_BANCO_MS } from './app/persist';
import { gpsToggle } from './app/gps';
import { iniciarDiagnostico, registrarErro } from './app/diagnostico';
import { initOffline } from './app/offline';
import { agendarPoda } from './app/tilesCache';
import { initRevisao, onToolClick, refreshNotesLayer, refreshPropLayers, resolveProps, setTool } from './app/revisao';
import { abrirArquivos, abrirLidas, carregarConfig, restaurarProjetos } from './app/projetos';
import { abrirConfig, atualizarAviso, configAberta, initConfig } from './app/config';
import { focarAjustes, modosVisiveis, renderAll, renderSeg, setField, setMode, setTab, syncBaseSeg } from './app/paineis';
import { blocosDoUnifilar, drawUni, lacunasDoUnifilar, planilhasDoUnifilar, initUnifilar } from './app/unifilar';
import { ehCelular, ehCompacto, initLayout, setPainel } from './app/layout';
import { alternarAlinhar } from './app/alinhar';
import { alternarLimpo, initGrupos } from './app/grupos';
import { initPinoNotas, verNotas } from './app/pinoNotas';
import { alternarDash, fecharDash, initDash } from './app/dashboard';
import { abrirCamadas, camadaSalva, fecharCamadas, initCamadas } from './app/camadas';
import { fecharLegenda, initControles } from './app/controles';
import { initCelular } from './app/celular';
import { fecharNotaRapida, initNotaRapida, notaNoMeuLocal } from './app/notaRapida';
import { clearFocus } from './app/mapa';
import { $, observarHud, observarRolagem, observarRolagemH, syncAllSegs, syncSeg, toast, toastAcao } from './app/ui';

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
$('#gavAbrir').addEventListener('click', () => $('#file').click()); // celular sem planilha: o botão fica à vista, sem depender do "⋯"
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
document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.t as typeof E.tab)));
document.querySelectorAll<HTMLButtonElement>('#base button').forEach((b) =>
  b.addEventListener('click', () => { setBase(b.dataset.b as typeof E.base); syncBaseSeg(); renderAll(); }));
document.querySelectorAll<HTMLButtonElement>('#nitidez button').forEach((b) => b.addEventListener('click', () => setNitidez(b.dataset.n as 'maxima' | 'segura')));
document.querySelectorAll<HTMLElement>('[data-alinhar]').forEach((b) => b.addEventListener('click', () => alternarAlinhar()));
$('#rotL').addEventListener('click', () => rotate(-15));
$('#rotR').addEventListener('click', () => rotate(15));
$('#rotN').addEventListener('click', north);
$('#rotA').addEventListener('click', alignToRoad);
$('#btnGps').addEventListener('click', () => void gpsToggle());
$('#btnField').addEventListener('click', () => setField(!E.field));
$('#btnOverview').addEventListener('click', () => fitAll());
$('#goBtn').addEventListener('click', () => { const v = $<HTMLInputElement>('#gokm').value; if (v.trim()) goLabel(v); });
$('#gokm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('#goBtn').click(); (e.target as HTMLElement).blur(); } });

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
  if (k >= '1' && k <= '9') { const v = modosVisiveis(); if (+k - 1 < v.length) setMode(v[+k - 1]); return; }
  if (k === '/') { e.preventDefault(); $('#gokm').focus(); return; }
  if (k === 'Escape') {
    if (fecharNotaRapida() || fecharCamadas() || fecharLegenda() || fecharDash()) return;
    if (E.tool) { setTool(null); return; }
    if (E.editing) { E.editing = null; refreshNotesLayer(); renderAll(); return; }
    if (E.focus) { clearFocus(); return; }
    clearSel();
    return;
  }
  const lk = k.toLowerCase();
  if (lk === 'h') { alternarLimpo(); return; }
  if (lk === 'p') { verNotas(); return; }
  if (lk === 'j') { alternarDash(); return; }
  if (lk === 'c') { abrirCamadas(true); return; }
  if (lk === 'n') { setTool('prop'); return; }
  if (lk === 'q') { rotate(-15); return; }
  if (lk === 'e') { rotate(15); return; }
  if (lk === 'r') { alignToRoad(); return; }
  if (lk === 'a') { alternarAlinhar(); return; }
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
  if (E.sel) focarAjustes(E.sel.pid);
  if (E.sel && (ehCompacto() || ehCelular()) && !opt.semGaveta) setPainel(false, false); // selecionar um segmento abre o painel recolhido (celular: a gaveta em meia altura)
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
    select, setTab, notaNoMeuLocal, map: getMap, marcosInfo, blocosDoUnifilar, lacunasDoUnifilar, planilhasDoUnifilar,
  };
}

/** Cada etapa da partida roda isolada: erro ou espera longa numa delas (banco, mapa) não deixa os botões sem ouvinte. */
function passo(nome: string, f: () => unknown) {
  try { f(); } catch (e) { registrarErro(e, 'partida:' + nome, e instanceof Error ? (e.stack ?? '') : ''); }
}
async function passoAsync(nome: string, f: () => Promise<unknown>, limiteMs = 6000) {
  try { await Promise.race([f(), new Promise((r) => setTimeout(r, limiteMs))]); } catch (e) { registrarErro(e, 'partida:' + nome, e instanceof Error ? (e.stack ?? '') : ''); }
}

async function boot() {
  passo('prefs', () => {
    E.mode = camadaSalva();
    try { E.field = localStorage.getItem('pavecad-field') === '1'; } catch { /* sem storage */ }
    try { E.privacidade = localStorage.getItem('pavecad-privacidade') === '1'; } catch { /* sem storage */ }
    try { const v = localStorage.getItem('pavecad-padrao'); E.padrao = v === null ? null : v === '1'; } catch { /* sem storage */ }
    if (E.field) { document.documentElement.setAttribute('data-contrast', 'field'); $('#btnField').setAttribute('aria-pressed', 'true'); }
  });
  await passoAsync('banco', abrirDb, LIMITE_BANCO_MS + 500);
  await passoAsync('config', carregarConfig);
  await passoAsync('revisao', initRevisao);
  passo('unifilar', initUnifilar);
  passo('config-ui', initConfig);
  passo('offline', () => initOffline(() => abrirConfig('campo')));
  passo('poda', agendarPoda);
  passo('persist', () => { void navigator.storage?.persist?.(); });
  passo('layout', initLayout);
  passo('nitidez', syncNitidezUi);
  passo('grupos', () => initGrupos(() => { drawUni(); agendarReaplicar(); }));
  passo('hud', () => observarHud(agendarReaplicar));
  passo('rolagem', () => {
    document.querySelectorAll<HTMLElement>('.tabbody').forEach(observarRolagem);
    observarRolagemH($('#unigroups'));
  });
  passo('render', renderAll);
  passo('mapa', () => initMap(() => {
    resolveProps();
    applyLayers();
    refreshNotesLayer();
    refreshPropLayers();
    renderAll();
    updateStakes();
    if (E.P.length) fitAll(true);
  }));
  passo('nota-rapida', initNotaRapida); // depois do initMap: precisa da instância do mapa
  passo('pino', initPinoNotas);
  passo('dash', initDash);
  passo('camadas', initCamadas);
  passo('controles', initControles);
  passo('celular', initCelular);
  passo('segs', syncAllSegs);
  if (bancoIndisponivel) toast('Armazenamento do navegador indisponível: nada será salvo neste aparelho');
  await passoAsync('restaurar', async () => {
    const n = await restaurarProjetos();
    if (n) toast(`${n} planilha(s) reaberta(s) deste aparelho`);
  }, 30000);
  passo('aviso', atualizarAviso);
}
iniciarDiagnostico();
void boot();

/* PWA: cache do app para abrir sem rede. Só ativo no build (no dev não há service worker). */
const atualizarSW = registerSW({
  immediate: true,
  onNeedRefresh: () => toastAcao('Nova versão disponível', 'Atualizar', () => void atualizarSW(true), 20000),
  onOfflineReady: () => toast('Pronto para uso sem internet', 4000),
  onRegisterError: (e) => console.warn('service worker:', e),
});
