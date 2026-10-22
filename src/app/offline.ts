import type { BaseKey } from './estado';
import { E } from './estado';
import { setBase } from './mapa';
import { syncBaseSeg } from './paineis';
import { $, toast } from './ui';

/** Sem internet: o fundo troca sozinho para "Liso" (sem tiles novos para baixar) e volta ao escolhido quando a conexão volta. */

let anterior: BaseKey | null = null;

export const estaOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function mostrarSelo(off: boolean) {
  const b = document.getElementById('offBadge');
  if (b) b.hidden = !off;
  document.documentElement.classList.toggle('offline', off);
}

/** Aplica o estado de conexão. Chamado no início e a cada evento online/offline. */
export function aplicarConexao(off: boolean = estaOffline()) {
  mostrarSelo(off);
  if (off) {
    if (E.base !== 'none') {
      anterior = E.base;
      setBase('none');
      syncBaseSeg();
      const sel = document.getElementById('a-base') as HTMLSelectElement | null;
      if (sel) sel.value = E.base;
      toast('Sem internet, fundo simples', 3500);
    }
    return;
  }
  if (anterior !== null) {
    const volta = anterior;
    anterior = null;
    // se a pessoa escolheu outro fundo enquanto estava sem rede, a escolha dela vale
    if (E.base === 'none') {
      setBase(volta);
      syncBaseSeg();
      const sel = document.getElementById('a-base') as HTMLSelectElement | null;
      if (sel) sel.value = E.base;
      toast('Conexão de volta, fundo restaurado', 3000);
    }
  }
}

/** O mapa só aceita setBase depois de pronto: quando ficar pronto, reaplica o estado de conexão. */
export function initOffline(aoClicarSelo: () => void) {
  window.addEventListener('offline', () => aplicarConexao(true));
  window.addEventListener('online', () => aplicarConexao(false));
  $('#offBadge').addEventListener('click', aoClicarSelo);
  mostrarSelo(estaOffline());
}
