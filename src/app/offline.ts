import type { BaseKey } from './estado';
import { E, H } from './estado';
import { setBase } from './mapa';
import { syncBaseSeg } from './paineis';
import { $, toast } from './ui';

/** Falta de rede. `navigator.onLine` não é confiável no celular: só vale como falta de rede quando os tiles do fundo falham em sequência.
 *  Nesse caso (e com o navegador dizendo que está offline) o fundo vai para "Liso" com um aviso discreto; as opções de fundo nunca são
 *  desabilitadas, e a escolha manual da pessoa (por exemplo Satélite, com os tiles já guardados) vale sempre. */

/** Falhas de tile seguidas, sem nenhum tile carregando entre elas, para considerar que não há rede. */
export const FALHAS_SEGUIDAS = 4;

let anterior: BaseKey | null = null;
let falhas = 0;
let semRede = false;

export const estaOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function mostrarSelo(off: boolean) {
  for (const id of ['offBadge', 'cOff']) { const b = document.getElementById(id); if (b) b.hidden = !off; }
  document.documentElement.classList.toggle('offline', off);
}

function trocarFundo(b: BaseKey) {
  setBase(b);
  syncBaseSeg();
  const sel = document.getElementById('a-base') as HTMLSelectElement | null;
  if (sel) sel.value = E.base;
}

function restaurar() {
  if (anterior === null) return;
  const volta = anterior;
  anterior = null;
  // se a pessoa escolheu outro fundo enquanto estava sem rede, a escolha dela vale
  if (E.base === 'none') { trocarFundo(volta); toast('Conexão de volta, fundo restaurado', 3000); }
}

function marcarSemRede(on: boolean) {
  if (on === semRede) return;
  semRede = on;
  mostrarSelo(on || estaOffline());
  if (on) {
    if (estaOffline() && E.base !== 'none' && anterior === null) { anterior = E.base; trocarFundo('none'); toast('Sem internet, fundo simples', 3500); }
    else toast('Sem conexão com os tiles do mapa', 3500);
  } else restaurar();
}

/** Um tile do fundo falhou. */
export function aoErroTile() {
  falhas++;
  if (falhas >= FALHAS_SEGUIDAS) marcarSemRede(true);
}
/** Um tile do fundo carregou: a rede voltou (ou nunca caiu). */
export function aoTileOk() {
  falhas = 0;
  if (semRede && !estaOffline()) marcarSemRede(false);
}

export function aplicarConexao(off: boolean = estaOffline()) {
  if (!off) { falhas = 0; semRede = false; }
  mostrarSelo(off || semRede);
  if (!off) restaurar();
}

export function initOffline(aoClicarSelo: () => void) {
  H.onTileErro = aoErroTile;
  H.onTileOk = aoTileOk;
  window.addEventListener('offline', () => aplicarConexao(true));
  window.addEventListener('online', () => aplicarConexao(false));
  $('#offBadge').addEventListener('click', aoClicarSelo);
  $('#cOff').addEventListener('click', aoClicarSelo);
  mostrarSelo(estaOffline());
}
