import { setPainel } from './layout';
import { setTab } from './paineis';
import { $ } from './ui';

/** O pino da barra de ferramentas só abre a aba Revisão (Ver notas). Criar nota é pelo menu pressionável; exportar, pela aba Exportar. */
export const verNotas = () => { setPainel(false); setTab('notas'); };

/** Contador no botão: "Ver notas (N)" no nome acessível e um número pequeno quando houver notas ou alterações. */
export function atualizarContadorNotas(n: number) {
  const b = document.getElementById('btnNotas'), c = document.getElementById('notasBadge');
  if (!b || !c) return;
  b.setAttribute('aria-label', `Ver notas (${n})`);
  b.setAttribute('title', `Ver notas (${n}) (P)`);
  c.hidden = n === 0;
  c.textContent = n > 99 ? '99+' : String(n);
}

export function initPinoNotas() {
  $('#btnNotas').addEventListener('click', verNotas);
}
