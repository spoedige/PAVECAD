import type { ModeKey } from '../dominio/indicadores';
import { E } from './estado';
import { setMode } from './paineis';
import { $ } from './ui';

/** Chip "Solução ▾" da coluna esquerda e o menu vertical com todas as camadas. Um toque escolhe e o menu fecha; tocar fora também fecha.
 *  A camada escolhida fica no aparelho. */
export const ROTULO_CAMADA: Record<ModeKey, string> = { sol: 'Solução', iri: 'IRI', atr: 'ATR', d0: 'D0', rc: 'Rc', def: 'Defeitos', igg: 'IGG', fc2: 'FC-2', fc3: 'FC-3' };
export const CHAVE_CAMADA = 'pavecad-camada';

export function camadaSalva(): ModeKey {
  try { const v = localStorage.getItem(CHAVE_CAMADA) as ModeKey | null; if (v && v in ROTULO_CAMADA) return v; } catch { /* sem storage */ }
  return 'sol';
}
export const guardarCamada = (m: ModeKey) => { try { localStorage.setItem(CHAVE_CAMADA, m); } catch { /* sem storage */ } };

export const camadasAbertas = () => !$('#modes').hidden;

export function abrirCamadas(v: boolean) {
  const m = $('#modes');
  m.hidden = !v;
  if (v) {
    // ancorado no chip, mas sempre inteiro na tela: recua da borda direita e rola por dentro quando falta altura
    const r = $('#btnCamada').getBoundingClientRect(), M = 8, topo = Math.round(r.bottom + 6);
    m.style.maxHeight = `${Math.max(120, window.innerHeight - topo - M)}px`; m.style.overflowY = 'auto';
    m.style.top = topo + 'px';
    m.style.left = Math.round(Math.max(M, Math.min(r.left, window.innerWidth - m.offsetWidth - M))) + 'px';
  }
  $('#btnCamada').setAttribute('aria-expanded', String(v));
  if (v) ($('#modes button[aria-selected="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
}
/** Esc fecha o menu. Devolve true quando consumiu. */
export function fecharCamadas(): boolean {
  if (!camadasAbertas()) return false;
  abrirCamadas(false);
  $('#btnCamada').focus({ preventScroll: true });
  return true;
}

/** Nome da camada ativa no chip, com contorno mais forte quando o mapa não mostra a solução. */
export function atualizarChipCamada() {
  $('#camadaNome').textContent = ROTULO_CAMADA[E.mode];
  $('#btnCamada').classList.toggle('fora-sol', E.mode !== 'sol');
  $('#btnCamada').setAttribute('aria-label', `Camada do mapa: ${ROTULO_CAMADA[E.mode]}. Trocar`);
}

export function initCamadas() {
  $('#btnCamada').addEventListener('click', (e) => { e.stopPropagation(); abrirCamadas(!camadasAbertas()); });
  $('#modes').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-m]');
    if (!b || b.disabled) return;
    setMode(b.dataset.m as ModeKey);
    abrirCamadas(false);
  });
  document.addEventListener('pointerdown', (e) => {
    const alvo = e.target as Node;
    if (camadasAbertas() && !$('#modes').contains(alvo) && !$('#btnCamada').contains(alvo)) abrirCamadas(false);
  });
  atualizarChipCamada();
}
