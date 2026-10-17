import { $, gestoVertical, syncAllSegs } from './ui';

/** Layout único: vale para qualquer tela com 601 px de largura ou mais (desktop, tablet e retrato), seja mouse ou toque.
 *  Celulares (até 600 px) mantêm o layout empilhado. */
export const MQ_UNICO = '(min-width: 601px)';
const mq = window.matchMedia(MQ_UNICO);
export const ehUnico = () => mq.matches;

/** Elementos que mudam de lugar no layout único: a barra lateral recebe o zoom (o ⋯ já está nela); a gaveta recebe girar e base. */
const MOVEIS = [
  { id: 'zoomhost', destino: 'tools', inicio: true },
  { id: 'rotbar', destino: 'drawer', inicio: false },
  { id: 'basegrp', destino: 'drawer', inicio: false },
];
const marcas = new Map<string, Comment>();

const CHAVE_GAVETA = 'pavecad-gaveta';
let gavetaAberta = false;
try { gavetaAberta = localStorage.getItem(CHAVE_GAVETA) === '1'; } catch { /* sem storage */ }

export const gavetaEstaAberta = () => gavetaAberta;

export function setGaveta(abrir: boolean, salvar = true) {
  gavetaAberta = abrir;
  $('#drawer').classList.toggle('open', abrir && ehUnico());
  $('#btnMore').setAttribute('aria-expanded', String(abrir));
  if (salvar) try { localStorage.setItem(CHAVE_GAVETA, abrir ? '1' : '0'); } catch { /* sem storage */ }
}

function aplicar() {
  const t = mq.matches;
  document.documentElement.classList.toggle('unico', t);
  for (const m of MOVEIS) {
    const el = document.getElementById(m.id);
    const marca = marcas.get(m.id);
    if (!el || !marca) continue;
    if (t) { const d = document.getElementById(m.destino)!; if (m.inicio) d.prepend(el); else d.append(el); } else marca.after(el);
  }
  $('#drawer').toggleAttribute('inert', !t || !gavetaAberta);
  setGaveta(gavetaAberta, false);
  syncAllSegs();
  window.dispatchEvent(new Event('resize'));
}

/** Medidas reais publicadas como variáveis CSS na raiz (sem valores fixos): o painel ancora na altura do unifilar, a folha inferior e
 *  a coluna esquerda desviam da barra lateral. Uma leitura só, agrupada em requestAnimationFrame: escrever as variáveis dentro do
 *  callback do ResizeObserver provocaria o aviso "ResizeObserver loop". */
const MEDIDAS: [string, string, (r: DOMRect) => number][] = [
  ['#unicard', '--uni-alt', (r) => r.height],
  ['#inspector', '--painel-alt', (r) => r.height],
  ['#tools', '--tools-alt', (r) => r.height],
  ['#tools', '--tools-t', (r) => r.top],
  ['.hud', '--hud-b', (r) => r.bottom],
];
let medidaPendente = false;
function medir() {
  const R = document.documentElement.style;
  for (const [sel, nome, f] of MEDIDAS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) R.setProperty(nome, (el.checkVisibility() ? Math.round(f(el.getBoundingClientRect())) : 0) + 'px');
  }
}
export function agendarMedidas() {
  if (medidaPendente) return;
  medidaPendente = true;
  requestAnimationFrame(() => { medidaPendente = false; medir(); });
}

export function initLayout() {
  for (const m of MOVEIS) {
    const el = document.getElementById(m.id);
    if (!el) continue;
    const marca = document.createComment(m.id);
    el.before(marca);
    marcas.set(m.id, marca);
  }
  $('#btnMore').addEventListener('click', () => { setGaveta(!gavetaAberta); $('#drawer').toggleAttribute('inert', !gavetaAberta); });
  initPainel();
  mq.addEventListener('change', aplicar);
  aplicar();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(agendarMedidas);
    for (const [sel] of MEDIDAS) { const e = document.querySelector(sel); if (e) ro.observe(e); }
  }
  window.addEventListener('resize', agendarMedidas);
  medir();
  // a gaveta sobe junto com a altura do que está no dock (legenda ou barra de propor)
  const dock = document.querySelector<HTMLElement>('.dock');
  if (dock && window.ResizeObserver) {
    const set = () => document.documentElement.style.setProperty('--dock-h', Math.round(dock.getBoundingClientRect().height) + 'px');
    new ResizeObserver(set).observe(dock);
    set();
  }
}

/* ---- painel direito: o cabeçalho (grip, abas e km) é o puxador ---- */
const CHAVE_PAINEL = 'pavecad-painel';
export const painelRecolhido = () => $('#inspector').classList.contains('collapsed');

export function setPainel(recolher: boolean, salvar = true) {
  const c = $('#collapse');
  $('#inspector').classList.toggle('collapsed', recolher);
  c.setAttribute('aria-label', recolher ? 'Expandir painel' : 'Recolher painel');
  c.setAttribute('title', recolher ? 'Expandir painel' : 'Recolher painel');
  c.setAttribute('aria-expanded', String(!recolher));
  c.innerHTML = `<svg class="i" viewBox="0 0 24 24"><path d="${recolher ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'}"/></svg>`;
  if (salvar) try { localStorage.setItem(CHAVE_PAINEL, recolher ? '1' : '0'); } catch { /* sem storage */ }
}

export function initPainel() {
  let salvo = false;
  try { salvo = localStorage.getItem(CHAVE_PAINEL) === '1'; } catch { /* sem storage */ }
  setPainel(salvo, false);
  $('#collapse').addEventListener('click', () => setPainel(!painelRecolhido()));
  const cab = $('#ihead');
  gestoVertical(cab, { ativo: ehUnico, aoBaixo: () => setPainel(true), aoCima: () => setPainel(false) });
  // tocar na faixa recolhida (fora dos botões) ou numa aba abre de novo
  cab.addEventListener('click', (e) => {
    // o chevron troca o próprio ícone ao clicar, então o alvo do evento já saiu do DOM: usa o caminho original
    if (!painelRecolhido() || e.composedPath().some((n) => n === $('#collapse') || (n instanceof HTMLElement && n.dataset.ocultar))) return;
    setPainel(false);
  });
}
