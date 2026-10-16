import './estilos/app.css';
import { carregarPlanilha } from './mapa/cliente';
import { criarProjeto, E, novoId, visibleProjects, type AppProj } from './app/estado';
import {
  addProjectToMap, alignToRoad, applyPaint, clearSel, fitAll, fitList, goLabel, initMap, north,
  removeProjectFromMap, renderLegend, rotate, setBase, stepSel, updateStakes,
} from './app/mapa';
import { MODE_KEYS, type ModeKey } from './dominio/indicadores';
import { $, esc, syncAllSegs, syncSeg, toast } from './app/ui';

function renderHeader() {
  const v = visibleProjects();
  $('#title').textContent = E.P.length ? `${E.P.length} planilha${E.P.length > 1 ? 's' : ''}` : 'Nenhuma planilha';
  $('#subtitle').textContent = v.length ? `${v.length} ${v.length > 1 ? 'visíveis' : 'visível'} · padrão RoadRunner` : 'Carregue um arquivo no padrão RoadRunner';
  const vb = $('#views'), groups = [...new Set(v.map((p) => p.meta.uf))];
  vb.innerHTML = '<button class="chipbtn" data-g="*">Visão geral</button>' + groups.map((g) => `<button class="chipbtn" data-g="${esc(g)}">${esc(g.replace('BR-', ''))}</button>`).join('');
  vb.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      const g = b.dataset.g!;
      if (g === '*') fitAll();
      else { E.activeGroup = g; fitList(visibleProjects().filter((p) => p.meta.uf === g)); }
    }));
  renderLegend();
  syncAllSegs();
}

function setMode(m: ModeKey) {
  E.mode = m;
  E.dim.clear();
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === m)));
  syncSeg($('#modes'));
  applyPaint();
}

function addProject(p: AppProj) {
  const old = E.P.find((x) => x.meta.name === p.meta.name);
  if (old) { if (E.mapReady) removeProjectFromMap(old); E.P = E.P.filter((x) => x !== old); }
  E.P.push(p);
  if (E.mapReady) addProjectToMap(p);
}

async function abrir(files: File[]) {
  const novos: AppProj[] = [];
  for (const f of files) {
    toast(`Lendo ${f.name}... arquivos grandes podem levar alguns segundos`, 60000);
    try {
      const id = novoId();
      const r = await carregarPlanilha(id, await f.arrayBuffer());
      const p = criarProjeto(id, r.projeto, { opts: r.opts, normals: r.normals, camadas: r.camadas });
      for (const l of p.log) console.info(`[${p.meta.name}] ${l.level}: ${l.msg}`);
      addProject(p);
      novos.push(p);
      const avisos = p.log.filter((l) => l.level === 'warn').length;
      if (avisos) toast(`${f.name}: ${avisos} aviso(s) de importação. Veja o console`, 5000);
    } catch (err) {
      toast(`${f.name}: ${(err as Error).message}`, 6000);
    }
  }
  if (novos.length) {
    renderHeader();
    fitList(novos);
    toast(`${novos.length} planilha(s) carregada(s)`);
  }
}

$('#btnFile').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length) void abrir(files);
});
document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m as ModeKey)));
document.querySelectorAll<HTMLButtonElement>('#base button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#base button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncSeg($('#base'));
    setBase(b.dataset.b as typeof E.base);
  }));
$('#rotL').addEventListener('click', () => rotate(-15));
$('#rotR').addEventListener('click', () => rotate(15));
$('#rotN').addEventListener('click', north);
$('#rotA').addEventListener('click', alignToRoad);
$('#goBtn').addEventListener('click', () => { const v = $<HTMLInputElement>('#gokm').value; if (v.trim()) goLabel(v); });
$('#gokm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('#goBtn').click(); (e.target as HTMLElement).blur(); } });

window.addEventListener('keydown', (e) => {
  const t = (e.target as HTMLElement).tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k >= '1' && k <= '6') { setMode(MODE_KEYS[+k - 1]); return; }
  if (k === '/') { e.preventDefault(); $('#gokm').focus(); return; }
  if (k === 'Escape') { clearSel(); return; }
  const lk = k.toLowerCase();
  if (lk === 'q') { rotate(-15); return; }
  if (lk === 'e') { rotate(15); return; }
  if (lk === 'r') { alignToRoad(); return; }
  if (!E.sel) return;
  const big = e.shiftKey ? 10 : 1;
  if (k === 'ArrowRight') { e.preventDefault(); stepSel(big, 0); }
  else if (k === 'ArrowLeft') { e.preventDefault(); stepSel(-big, 0); }
  else if (k === 'ArrowUp') { e.preventDefault(); stepSel(0, -1); }
  else if (k === 'ArrowDown') { e.preventDefault(); stepSel(0, 1); }
});

initMap(() => { renderHeader(); updateStakes(); });
renderHeader();
