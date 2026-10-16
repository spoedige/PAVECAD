import { $, syncAllSegs } from './ui';

/** Tablet: toque e largura entre 601 e 1366 px. Celulares (até 600 px) e telas com mouse mantêm o layout atual. */
export const MQ_TABLET = '(pointer: coarse) and (min-width: 601px) and (max-width: 1366px)';
const mq = window.matchMedia(MQ_TABLET);
export const isTablet = () => mq.matches;

/** Elementos que mudam de lugar no tablet: a barra única na lateral recebe o zoom e as ferramentas; a gaveta recebe girar e base. */
const MOVEIS = [
  { id: 'zoomhost', destino: 'tools' },
  { id: 'toolbar', destino: 'tools' },
  { id: 'rotbar', destino: 'drawer' },
  { id: 'base', destino: 'drawer' },
];
const marcas = new Map<string, Comment>();

const CHAVE_GAVETA = 'pavecad-gaveta';
let gavetaAberta = false;
try { gavetaAberta = localStorage.getItem(CHAVE_GAVETA) === '1'; } catch { /* sem storage */ }

export const gavetaEstaAberta = () => gavetaAberta;

export function setGaveta(abrir: boolean, salvar = true) {
  gavetaAberta = abrir;
  $('#drawer').classList.toggle('open', abrir && isTablet());
  $('#btnMore').setAttribute('aria-expanded', String(abrir));
  if (salvar) try { localStorage.setItem(CHAVE_GAVETA, abrir ? '1' : '0'); } catch { /* sem storage */ }
}

function aplicar() {
  const t = mq.matches;
  document.documentElement.classList.toggle('tablet', t);
  for (const m of MOVEIS) {
    const el = document.getElementById(m.id);
    const marca = marcas.get(m.id);
    if (!el || !marca) continue;
    if (t) document.getElementById(m.destino)!.append(el); else marca.after(el);
  }
  $('#drawer').toggleAttribute('inert', !t || !gavetaAberta);
  setGaveta(gavetaAberta, false);
  syncAllSegs();
  window.dispatchEvent(new Event('resize'));
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
  mq.addEventListener('change', aplicar);
  aplicar();
  // a gaveta sobe junto com a altura do que está no dock (legenda ou barra de propor)
  const dock = document.querySelector<HTMLElement>('.dock');
  if (dock && window.ResizeObserver) {
    const set = () => document.documentElement.style.setProperty('--dock-h', Math.round(dock.getBoundingClientRect().height) + 'px');
    new ResizeObserver(set).observe(dock);
    set();
  }
}
