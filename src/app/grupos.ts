import { $ } from './ui';
import { ehCelular, ehUnico, MQ_CELULAR, MQ_UNICO } from './layout';

/** Grupos de controles que o usuário pode ocultar. Oculto, o grupo vira um botão de 44 px com ícone, no lugar dele, que o restaura.
 *  O estado de cada grupo fica no localStorage. O mapa limpo (botão de olho e tecla H) esconde todos de uma vez, menos o zoom e o
 *  próprio botão, sem mexer no estado de cada grupo: ao voltar, cada um reaparece como estava. */
const ico = (d: string) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
export const GRUPOS = [
  { id: 'titulo', rotulo: 'título e busca', icone: ico('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>') },
  { id: 'ferramentas', rotulo: 'ferramentas', icone: ico('<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>') },
  { id: 'girar', rotulo: 'fundo e rotação', icone: ico('<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>') },
  { id: 'unifilar', rotulo: 'unifilar', icone: ico('<path d="M3 7h18M3 12h12M3 17h16"/>') },
  { id: 'painel', rotulo: 'painel', icone: ico('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>') },
] as const;
type Id = (typeof GRUPOS)[number]['id'];

const CHAVE = 'pavecad-ocultos';
const OLHO = ico('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const OLHO_RISCADO = ico('<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.2 7C3.7 8.7 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-.9"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/>');

let ocultos = new Set<string>();
let limpo = false;
let aoMudar: () => void = () => {};

try { ocultos = new Set(JSON.parse(localStorage.getItem(CHAVE) ?? '[]') as string[]); } catch { /* sem storage ou JSON inválido */ }

export const estaOculto = (id: Id) => ocultos.has(id);
export const mapaLimpo = () => limpo;

/** Liga as classes na raiz. No celular nada é ocultado: lá a folha "Mapa" abre e fecha pelo "⋯", e um grupo oculto deixaria o "⋯" sem efeito. */
function aplicar() {
  const R = document.documentElement, ativo = ehUnico();
  for (const g of GRUPOS) R.classList.toggle('h-' + g.id, ativo && !ehCelular() && ocultos.has(g.id));
  R.classList.toggle('limpo', ativo && limpo);
  const b = $('#btnLimpo');
  b.setAttribute('aria-pressed', String(limpo));
  b.setAttribute('aria-label', limpo ? 'Mostrar os controles (H)' : 'Mapa limpo: ocultar os controles (H)');
  b.setAttribute('title', limpo ? 'Mostrar os controles (H)' : 'Mapa limpo (H)');
  b.innerHTML = limpo ? OLHO_RISCADO : OLHO;
  aoMudar();
}

function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify([...ocultos])); } catch { /* sem storage */ } }

export function setOculto(id: Id, oculto: boolean) {
  if (oculto) ocultos.add(id); else ocultos.delete(id);
  salvar();
  aplicar();
}

export function setLimpo(v: boolean) {
  if (!ehUnico()) return;
  limpo = v;
  aplicar();
}
export const alternarLimpo = () => setLimpo(!limpo);

/** Cria os botões de restaurar, cada um no lugar do seu grupo (a CSS mostra só o do grupo oculto). */
function criarRestauracoes() {
  const onde: Record<Id, string> = { titulo: '.leftcol', ferramentas: '.topright', girar: '#tools', unifilar: '.app', painel: '.app' };
  for (const g of GRUPOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'grestaura';
    b.dataset.g = g.id;
    b.setAttribute('aria-label', `Mostrar ${g.rotulo}`);
    b.title = `Mostrar ${g.rotulo}`;
    b.innerHTML = g.icone;
    const pai = document.querySelector(onde[g.id])!;
    if (g.id === 'titulo') pai.prepend(b); else pai.append(b);
  }
}

export function initGrupos(mudou: () => void) {
  aoMudar = mudou;
  criarRestauracoes();
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const o = t.closest<HTMLElement>('[data-ocultar]');
    if (o) {
      if (ehCelular()) { if (o.dataset.ocultar === 'girar') { const m = $('#cMapa'); if (m.getAttribute('aria-expanded') === 'true') m.click(); } return; } // celular: o "−" da folha só fecha
      setOculto(o.dataset.ocultar as Id, true); return;
    }
    const r = t.closest<HTMLElement>('.grestaura');
    if (r) setOculto(r.dataset.g as Id, false);
  });
  $('#btnLimpo').addEventListener('click', alternarLimpo);
  window.matchMedia(MQ_UNICO).addEventListener('change', aplicar);
  window.matchMedia(MQ_CELULAR).addEventListener('change', aplicar);
  aplicar();
}
