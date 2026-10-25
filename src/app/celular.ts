import { localizar, type LocP } from '../dominio/localizar';
import { trShort } from '../dominio/solucoes';
import { E, projName, rodoviaNome, visibleProjects, type AppProj } from './estado';
import { gpsToggle } from './gps';
import { alternarLimpo } from './grupos';
import { ehCelular, gavetaCel, gavetaEstaAberta, setGaveta, setGavetaCel } from './layout';
import { fitList, getMap, goLabel, hitAt, north, setLegendaAberta } from './mapa';
import { setTab } from './paineis';
import { abrirDash } from './dashboard';
import { abrirConfig } from './config';
import { setTool } from './revisao';
import { setUniExpandido, uniExpandido } from './unifilar';
import { $, esc, gestoVertical } from './ui';

/** Layout de celular (até 600 px, ou paisagem com menos de 500 px de altura): barra superior única, coluna do polegar à direita e gaveta inferior
 *  com três estados. Tudo o que não é mapa fica atrás de um toque. */

/** Segmento sob a mira (centro do mapa): planilha, linha, faixa e a distância do eixo. */
export function localDoCentro() {
  if (!E.mapReady || !E.P.length) return null;
  const c = getMap().getCenter();
  const l = localizar(visibleProjects() as unknown as LocP[], c.lat, c.lng);
  return l && l.out < 60 ? l : null;
}

let agendado = false;
/** Chip de localização e linha de resumo da gaveta seguem o centro do mapa. */
export function atualizarCentro() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    const l = localDoCentro(), chip = $('#cLocalTxt'), res = $('#gavTxt');
    if (!E.P.length) { chip.textContent = 'Sem planilha'; res.textContent = 'Abra uma planilha'; return; }
    if (!l) { chip.textContent = rodoviaNome(E.P[0].meta.uf).replace('/', ' · '); res.textContent = 'Fora do trecho'; return; }
    const p = l.p as unknown as AppProj, km = p.kmLab[l.i], lane = l.lane ?? 1;
    const md = p.model[l.i], tr = lane ? md.tr[lane - 1] : md.sh;
    chip.innerHTML = `<span class="cl-via">${esc(rodoviaNome(p.meta.uf).replace('/', ' · '))}</span><span>km ${esc(km)}</span>`;
    res.textContent = `km ${km} · ${lane ? 'Fx ' + lane : 'Acost.'} · ${tr && tr.main !== '-' ? trShort(tr.main) : 'Sem intervenção'}`;
  });
}

export function initCelular() {
  /* os botões da tela não dependem do mapa: se o mapa não subiu (WebGL bloqueado, por exemplo), "⋯" e "Abrir planilhas" ainda respondem */
  const map = getMap() as ReturnType<typeof getMap> | undefined;
  map?.on('move', atualizarCentro);
  map?.on('moveend', atualizarCentro);
  atualizarCentro();

  /* chip de localização: Ir para km (e a lista de rodovias, se houver mais de uma) */
  const pop = $('#localpop'), chip = $('#cLocal');
  const fecharLocal = () => { pop.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
  const abrirLocal = () => {
    const vias = [...new Set(E.P.map((p) => p.meta.uf))];
    $('#cVias').innerHTML = vias.length > 1 ? vias.map((uf) => `<button type="button" class="chipbtn" data-uf="${esc(uf)}" aria-pressed="${uf === E.activeGroup}">${esc(rodoviaNome(uf))}</button>`).join('') : '';
    $('#cVias').querySelectorAll<HTMLElement>('[data-uf]').forEach((b) => (b.onclick = () => { E.activeGroup = b.dataset.uf!; fitList(E.P.filter((p) => p.meta.uf === b.dataset.uf)); fecharLocal(); }));
    pop.hidden = false; chip.setAttribute('aria-expanded', 'true');
    ($('#cGoKm') as HTMLInputElement).focus({ preventScroll: true });
  };
  chip.addEventListener('click', (e) => { e.stopPropagation(); if (pop.hidden) abrirLocal(); else fecharLocal(); });
  const ir = () => { const v = ($('#cGoKm') as HTMLInputElement).value; if (v.trim()) { goLabel(v); fecharLocal(); (document.activeElement as HTMLElement | null)?.blur(); } };
  $('#cGoBtn').addEventListener('click', ir);
  $('#cGoKm').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') ir(); });

  /* botão ⋯: a gaveta de mapa vira uma folha com tudo o que saiu da superfície */
  const mapa = $('#cMapa');
  const folha = (v: boolean) => { setGaveta(v); $('#drawer').toggleAttribute('inert', !v); mapa.setAttribute('aria-expanded', String(v)); };
  mapa.addEventListener('click', (e) => { e.stopPropagation(); fecharLocal(); folha(!gavetaEstaAberta()); });
  const acao = (id: string, f: () => void) => $(id).addEventListener('click', () => { folha(false); f(); });
  acao('#dLegenda', () => setLegendaAberta(true));
  acao('#dProjetos', () => abrirDash());
  acao('#dAbrir', () => $('#file').click());
  acao('#dExportar', () => { setGavetaCel('meia'); setTab('exp'); });
  acao('#dLimpa', () => alternarLimpo());
  acao('#dConfig', () => abrirConfig());
  acao('#dPropor', () => setTool(E.tool === 'prop' ? null : 'prop'));
  document.addEventListener('pointerdown', (e) => {
    if (!ehCelular()) return;
    const alvo = e.target as Node;
    if (!pop.hidden && !pop.contains(alvo) && !chip.contains(alvo)) fecharLocal();
    if (gavetaEstaAberta() && !$('#drawer').contains(alvo) && !mapa.contains(alvo)) folha(false);
  });

  /* coluna do polegar: GPS e tela limpa repetem o estado dos botões da barra de ferramentas (que fica oculta) */
  $('#cGps').addEventListener('click', () => void gpsToggle());
  $('#cLimpo').addEventListener('click', () => alternarLimpo());
  const espelho = (de: string, para: string) => {
    const a = $(de), b = $(para);
    const sync = () => { b.setAttribute('aria-pressed', a.getAttribute('aria-pressed') ?? 'false'); b.classList.toggle('live', a.classList.contains('live')); b.setAttribute('aria-label', a.getAttribute('aria-label') ?? ''); b.setAttribute('title', a.getAttribute('title') ?? ''); };
    new MutationObserver(sync).observe(a, { attributes: true });
    sync();
  };
  espelho('#btnGps', '#cGps'); espelho('#btnLimpo', '#cLimpo');
  const gira = () => {
    if (!map) return;
    const rot = Math.abs(map.getBearing()) > 0.5;
    $('#btnCompassC').hidden = !rot;
    $('#compassF').style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map?.on('rotate', gira); gira();
  $('#btnCompassC').addEventListener('click', () => north());

  /* gaveta: três estados, arrastar a alça, tocar na linha de resumo, tocar fora fecha */
  const sobe = () => { const g = gavetaCel(); setGavetaCel(g === 'fechada' ? 'meia' : 'cheia'); };
  const desce = () => { const g = gavetaCel(); setGavetaCel(g === 'cheia' ? 'meia' : 'fechada'); };
  for (const el of [$('#gavRes'), $('#ihead')]) gestoVertical(el, { ativo: ehCelular, aoBaixo: desce, aoCima: sobe, limite: 28 });
  $('#gavTxt').addEventListener('click', () => { if (gavetaCel() === 'fechada') setGavetaCel('meia'); });
  $('#gavCores').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.legmais')) return; setLegendaAberta(true); });
  $('#gavUni').addEventListener('click', () => setUniExpandido(!uniExpandido()));
  map?.on('click', (e) => {
    if (!ehCelular() || gavetaCel() === 'fechada') return;
    if (!hitAt(e.point)) setGavetaCel('fechada');
  });
  void projName;
}
