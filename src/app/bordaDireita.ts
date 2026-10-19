import { E } from './estado';
import { setPainel } from './layout';
import { getMap } from './mapa';
import { setTab } from './paineis';
import { centroDoMapa, MOTIVO_TXT, obterPosicao } from './posicao';
import { startNote } from './revisao';
import { $, toast } from './ui';

/** Contagem do atalho "Notas (N)". */
export function atualizarContadorNotas() {
  const n = document.getElementById('notasN');
  if (n) n.textContent = String(E.notes.length);
}

/** "Nota": como "Meu local", anota na posição do GPS; sem posição boa, no centro do mapa. */
export async function notaNoMeuLocal() {
  const m = getMap();
  const r = await obterPosicao();
  if (r.ok) {
    m.easeTo({ center: [r.pos.lon, r.pos.lat], zoom: Math.max(m.getZoom(), 17.5), duration: 400 });
    startNote('pin', [[r.pos.lon, r.pos.lat]]);
    return;
  }
  toast(`${MOTIVO_TXT[r.motivo]}: arraste o mapa até o ponto da nota`, 5000);
  const c = centroDoMapa(m);
  startNote('pin', [[c.lon, c.lat]]);
}

export function initBordaDireita() {
  $('#btnAjustes').addEventListener('click', () => { setPainel(false); setTab('aj'); });
  $('#btnNotasLista').addEventListener('click', () => { setPainel(false); setTab('notas'); });
  $('#btnNota').addEventListener('click', () => void notaNoMeuLocal());
  atualizarContadorNotas();
}
