import { kmLabel } from '../formats';
import type { LocP } from '../dominio/localizar';
import {
  ORDEM_TIPOS, TIPOS_RAPIDOS, dadosDeLocal, posicionarMenu, precisaLembrar, resolverLocal, type OrigemNota, type Resolucao, type TipoRapido,
} from '../dominio/notaRapida';
import type { Local } from '../dominio/localizar';
import * as db from './persist';
import { E, projName, type Nota } from './estado';
import { getMap } from './mapa';
import { obterPosicao } from './posicao';
import { refreshNotesLayer, renderNotes } from './revisao';
import { esc, toast } from './ui';

/** Tempo de pressão (ms) e movimento (px) que separam "segurar" de "arrastar". */
export const PRESSAO_MS = 500;
export const PRESSAO_MOVE_PX = 8;
const TAM_BOTAO = 64;

/** Ícones por forma, não só por cor: solução (camadas) com mais ou menos; dreno (gota) com mais ou menos. */
export const ICONE: Record<TipoRapido, string> = {
  melhorar: '<svg viewBox="0 0 24 24" class="i"><path d="M3 15l9 4.5 9-4.5M3 11l9 4.5 9-4.5L12 6.5z"/><path d="M12 1.5v4M10 3.5h4"/></svg>',
  retirar: '<svg viewBox="0 0 24 24" class="i"><path d="M3 15l9 4.5 9-4.5M3 11l9 4.5 9-4.5L12 6.5z"/><path d="M10 3.5h4"/></svg>',
  dreno_mais: '<svg viewBox="0 0 24 24" class="i"><path d="M12 3c3 3.8 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.6 9 6.8 12 3z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  dreno_menos: '<svg viewBox="0 0 24 24" class="i"><path d="M12 3c3 3.8 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.6 9 6.8 12 3z"/><path d="M9.5 13.5h5"/></svg>',
};
const NOME_BOTAO: Record<TipoRapido, [string, string]> = { melhorar: ['Melhorar', 'solução'], retirar: ['Retirar', 'solução'], dreno_mais: ['Colocar', 'dreno'], dreno_menos: ['Retirar', 'dreno'] };

interface Menu {
  lng: number; lat: number; pt: { x: number; y: number }; origem: OrigemNota; precisao: number | null; res: Resolucao;
}
let menu: Menu | null = null;
let raiz: HTMLElement, anel: HTMLElement;

export const notaRapidaAberta = () => !!menu;

const CHAVE_DICA = 'pavecad-dica-nota';
const CHAVE_NOVAS = 'pavecad-notas-novas';
const lerNum = (k: string) => { try { return +(localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const gravarNum = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* sem storage */ } };
export const notasNovasSemExportar = () => lerNum(CHAVE_NOVAS);
export const zerarNotasNovas = () => gravarNum(CHAVE_NOVAS, 0);

const stage = () => document.querySelector<HTMLElement>('.stage')!;
const relativo = (cx: number, cy: number) => { const r = stage().getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };

function fecharMenu() {
  menu = null;
  raiz.hidden = true; raiz.replaceChildren();
}

function textoDoLocal(m: Menu): string {
  const l = m.res.local;
  if (m.res.estado === 'sem-planilha') return 'Trecho não definido';
  if (m.res.estado === 'fora' || !l) return 'Fora do trecho';
  const lane = l.lane === 0 ? 'Acost.' : l.lane === null ? '' : `Fx ${l.lane}`;
  return `km ${esc(l.p.kmLab[l.i])}${lane ? ' · ' + lane : ''}${m.res.estado === 'proximo' ? ' · mais próximo' : ''}`;
}

function desenharMenu() {
  const m = menu!;
  const area = stage().getBoundingClientRect();
  const pos = posicionarMenu(m.pt, { w: area.width, h: area.height }, TAM_BOTAO);
  const botoes = ORDEM_TIPOS.map((t, k) => {
    const b = pos.botoes[k], [a, c] = NOME_BOTAO[t];
    return `<button type="button" class="nr-op" data-t="${t}" aria-label="${esc(TIPOS_RAPIDOS[t].rotulo)}" style="left:${b.x - TAM_BOTAO / 2}px;top:${b.y - TAM_BOTAO / 2}px">${ICONE[t]}<span>${a}<br>${c}</span></button>`;
  }).join('');
  // legenda sem campo nenhum: o que o toque vai gravar. Fica do lado oposto ao do anel de botões
  const emBaixo = pos.angulo >= 0 && pos.angulo <= 180;
  const avisoGps = m.res.avisoPrecisao && m.precisao !== null ? ` · GPS ±${Math.round(m.precisao)} m` : '';
  raiz.innerHTML = `<div class="nr-fundo" id="nrFundo"></div>
    <div class="nr-ponto" style="left:${m.pt.x}px;top:${m.pt.y}px"></div>${botoes}
    <div class="nr-cap${m.res.avisoPrecisao ? ' aviso' : ''}" style="left:${m.pt.x}px;top:${m.pt.y + (emBaixo ? -34 : 16)}px">${textoDoLocal(m)}${avisoGps}</div>`;
  raiz.hidden = false;
  raiz.querySelector('#nrFundo')!.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharMenu(); });
  raiz.querySelectorAll<HTMLElement>('.nr-op').forEach((b) => b.addEventListener('click', () => salvarNota(b.dataset.t as TipoRapido)));
  (raiz.querySelector('.nr-op') as HTMLElement | null)?.focus({ preventScroll: true });
}

/** Abre o menu circular no ponto (lng, lat), que está em pt na tela (relativo ao mapa). */
export function abrirMenuNota(lng: number, lat: number, pt: { x: number; y: number }, origem: OrigemNota, precisao: number | null) {
  const res = resolverLocal(E.P as LocP[], lat, lng, precisao);
  menu = { lng, lat, pt, origem, precisao, res };
  desenharMenu();
}

function dadosDaNota(l: Local | null, estado: Resolucao['estado']) {
  return dadosDeLocal(l, estado, (p, i) => kmLabel(p.kmNum[i]));
}
const locDaNota = (l: Local | null, estado: Resolucao['estado']): Nota['loc'] =>
  l && (estado === 'dentro' || estado === 'proximo') ? { pid: l.p.id, name: projName(l.p as never), km: kmLabel(l.p.kmNum[l.i]), lane: l.lane ?? 0 } : null;

function salvarNota(tipo: TipoRapido) {
  const m = menu;
  if (!m) return;
  const estado = m.res.estado, l = m.res.local;
  const n: Nota = {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: 'pin', coords: [[+m.lng.toFixed(7), +m.lat.toFixed(7)]], cat: TIPOS_RAPIDOS[tipo].cat, text: '', photos: [], t: new Date().toISOString(),
    loc: locDaNota(l, estado),
    rapida: { tipo, origem: m.origem, precisao: m.origem === 'gps' && m.precisao !== null ? Math.round(m.precisao) : null, ...dadosDaNota(l, estado), resolvida: false },
  };
  E.notes.push(n);
  db.gravar('notes', n);
  fecharMenu();
  refreshNotesLayer();
  if (E.tab === 'notas') renderNotes();
  const novas = notasNovasSemExportar() + 1;
  gravarNum(CHAVE_NOVAS, novas);
  toastNota(n, m.res);
  if (precisaLembrar(novas) && novas === 10) setTimeout(() => toast('10 notas novas sem exportar. Baixe a planilha em Notas.', 5000), 1200);
  vibrar(20);
}

let notaT: ReturnType<typeof setTimeout> | undefined;
/** "Nota salva": Desfazer, Trocar sentido (só se o sentido ficou ambíguo) e Observação (opcional, com o teclado do aparelho). */
function toastNota(n: Nota, res: Resolucao) {
  document.querySelector('.toast-acao')?.remove();
  clearTimeout(notaT);
  const t = document.createElement('div');
  t.className = 'toast-acao toast-nota'; t.setAttribute('role', 'status');
  let outro = res.ambiguo ? res.outro : null, atual = res.local;
  const fechar = () => { clearTimeout(notaT); t.remove(); };
  const agendar = (ms: number) => { clearTimeout(notaT); notaT = setTimeout(fechar, ms); };
  const pintar = () => {
    t.innerHTML = `<span>Nota salva</span><button type="button" class="btn p" data-a="desfazer">Desfazer</button>`
      + (outro ? '<button type="button" class="btn" data-a="sentido">Trocar sentido</button>' : '')
      + '<button type="button" class="btn" data-a="obs">Observação</button>';
    t.querySelector('[data-a=desfazer]')!.addEventListener('click', () => {
      fechar();
      E.notes = E.notes.filter((x) => x.id !== n.id);
      db.apagar('notes', n.id);
      gravarNum(CHAVE_NOVAS, Math.max(0, notasNovasSemExportar() - 1));
      refreshNotesLayer();
      if (E.tab === 'notas') renderNotes();
    });
    t.querySelector('[data-a=sentido]')?.addEventListener('click', () => {
      const par = outro!;
      outro = atual; atual = par;
      Object.assign(n.rapida!, dadosDaNota(atual, res.estado));
      n.loc = locDaNota(atual, res.estado);
      db.gravar('notes', n);
      if (E.tab === 'notas') renderNotes();
      toast(`Sentido: ${n.rapida!.sentido}`);
      agendar(6000);
    });
    t.querySelector('[data-a=obs]')!.addEventListener('click', () => {
      clearTimeout(notaT);
      t.innerHTML = '<input type="text" enterkeyhint="done" autocomplete="off" placeholder="Observação" aria-label="Observação da nota"><button type="button" class="btn p" data-a="ok">OK</button>';
      const inp = t.querySelector('input')!;
      const gravar = () => { n.text = inp.value.trim(); db.gravar('notes', n); if (E.tab === 'notas') renderNotes(); fechar(); toast(n.text ? 'Observação salva' : 'Nota salva'); };
      t.querySelector('[data-a=ok]')!.addEventListener('click', gravar);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') gravar(); });
      inp.focus();
    });
  };
  pintar();
  document.body.appendChild(t);
  agendar(7000);
}

const vibrar = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

/* ---------------------------------------------------------------- */
/* Entradas: pressão no mapa, botão direito e botão Nota             */
/* ---------------------------------------------------------------- */
export function initNotaRapida() {
  raiz = document.createElement('div');
  raiz.className = 'nr'; raiz.id = 'nr'; raiz.hidden = true;
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-label', 'Nota rápida');
  stage().appendChild(raiz);
  anel = document.createElement('div');
  anel.className = 'nr-anel'; anel.hidden = true;
  anel.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" pathLength="100"/></svg>';
  stage().appendChild(anel);
  try { void navigator.storage?.persist?.(); } catch { /* sem persistência garantida */ }

  const map = getMap();
  const cont = map.getCanvasContainer();
  let timer: ReturnType<typeof setTimeout> | undefined, ini: { x: number; y: number; id: number } | null = null, disparouEm = 0;
  const cancelar = () => { clearTimeout(timer); ini = null; anel.hidden = true; };
  const livre = () => E.mapReady && !E.tool && E.tab !== 'al' && !menu;
  const noMapa = (e: PointerEvent) => (e.target as HTMLElement).classList.contains('maplibregl-canvas');
  const abrirEm = (cx: number, cy: number) => {
    const pt = relativo(cx, cy), ll = map.unproject([cx - cont.getBoundingClientRect().left, cy - cont.getBoundingClientRect().top]);
    abrirMenuNota(ll.lng, ll.lat, pt, 'pressao', null);
  };

  cont.addEventListener('pointerdown', (e) => {
    if (ini && e.pointerId !== ini.id) { cancelar(); return; } // segundo dedo: é gesto de zoom ou rotação
    if ((e.pointerType === 'mouse' && e.button !== 0) || !livre() || !noMapa(e)) return;
    ini = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const p = relativo(e.clientX, e.clientY);
    anel.style.left = p.x + 'px'; anel.style.top = p.y + 'px';
    anel.hidden = false; anel.classList.remove('nr-roda'); void anel.getBoundingClientRect(); anel.classList.add('nr-roda');
    timer = setTimeout(() => {
      if (!ini) return;
      const { x, y } = ini;
      cancelar(); disparouEm = Date.now();
      E.cliqueSuprimidoAte = Date.now() + 700;
      vibrar(30);
      abrirEm(x, y);
    }, PRESSAO_MS);
  });
  cont.addEventListener('pointermove', (e) => { if (ini && e.pointerId === ini.id && Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > PRESSAO_MOVE_PX) cancelar(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) cont.addEventListener(ev, cancelar);
  // o menu de contexto do navegador nunca aparece sobre o mapa; o botão direito do mouse abre o menu da nota
  cont.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const toque = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
    // o navegador solta um contextmenu logo depois da pressão longa por toque: a pressão já abriu o menu
    if (toque || Date.now() - disparouEm < 900 || !livre()) return;
    cancelar();
    E.cliqueSuprimidoAte = Date.now() + 300;
    abrirEm(e.clientX, e.clientY);
  });

  mostrarDicaSePreciso();
}

/** "Nota no meu local": abre o menu na posição do GPS. Sem GPS (negado, sem resposta em 8 s, erro ou precisão pior que 50 m), uma linha avisa e a pressão no mapa segue valendo. */
export async function notaNoMeuLocal() {
  if (menu) fecharMenu();
  const map = getMap(), r = await obterPosicao();
  if (!r.ok) { toast('Sem GPS. Segure no mapa no ponto desejado.', 5000); return; }
  map.jumpTo({ center: [r.pos.lon, r.pos.lat], zoom: Math.max(map.getZoom(), 17.5) });
  const p = map.project([r.pos.lon, r.pos.lat]), box = map.getCanvasContainer().getBoundingClientRect(), s = stage().getBoundingClientRect();
  abrirMenuNota(r.pos.lon, r.pos.lat, { x: box.left - s.left + p.x, y: box.top - s.top + p.y }, 'gps', r.pos.acc);
}

/** Esc fecha o menu. Devolve true quando consumiu. */
export function fecharNotaRapida(): boolean {
  if (!menu) return false;
  fecharMenu();
  return true;
}

/** Dica única na primeira vez com planilhas na tela. */
function mostrarDicaSePreciso() {
  let visto = false;
  try { visto = localStorage.getItem(CHAVE_DICA) === '1'; } catch { /* sem storage */ }
  if (visto) return;
  const tentar = () => {
    if (!E.P.length || document.querySelector('.nr-dica')) return;
    clearInterval(iv);
    const d = document.createElement('div');
    d.className = 'glass nr-dica'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>Segure no mapa para anotar</span><button type="button" class="btn p">Entendi</button>';
    d.querySelector('button')!.addEventListener('click', () => { d.remove(); try { localStorage.setItem(CHAVE_DICA, '1'); } catch { /* sem storage */ } });
    stage().appendChild(d);
  };
  const iv = setInterval(tentar, 1500);
}
