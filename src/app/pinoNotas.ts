import { baixarCsv, baixarXlsx, compartilharNotas } from './exportNotas';
import { setPainel } from './layout';
import { notaNoMeuLocal } from './notaRapida';
import { setTab } from './paineis';
import { $ } from './ui';

/** Popover do pino da barra de ferramentas: nota no meu local e ver notas. */
const aberto = () => !$('#pinpop').hidden;

function abrir(v: boolean) {
  $('#pinpop').hidden = !v;
  $('#btnNotas').setAttribute('aria-expanded', String(v));
  $('#btnNotas').setAttribute('aria-pressed', String(v));
}

export const alternarPinoNotas = () => { abrir(!aberto()); if (aberto()) ($('#ppLocal') as HTMLElement).focus({ preventScroll: true }); };
/** Esc fecha o popover. Devolve true quando consumiu. */
export function fecharPinoNotas(): boolean {
  if (!aberto()) return false;
  abrir(false);
  return true;
}

export function initPinoNotas() {
  $('#btnNotas').addEventListener('click', (e) => { e.stopPropagation(); alternarPinoNotas(); });
  document.addEventListener('pointerdown', (e) => {
    const alvo = e.target as Node;
    if (aberto() && !$('#pinpop').contains(alvo) && !$('#btnNotas').contains(alvo)) abrir(false);
  });
  $('#ppLocal').addEventListener('click', () => { abrir(false); void notaNoMeuLocal(); });
  $('#ppVer').addEventListener('click', () => { abrir(false); setPainel(false); setTab('notas'); });
  $('#ppXlsx').addEventListener('click', () => { abrir(false); void baixarXlsx(); });
  $('#ppCsv').addEventListener('click', () => { abrir(false); baixarCsv(); });
  $('#ppShare').addEventListener('click', () => { abrir(false); void compartilharNotas(); });
}
