import { getMap, legendaAberta, north, setLegendaAberta } from './mapa';
import { $ } from './ui';

/** Cartão único de controles do canto inferior esquerdo: zoom, bússola (só com o mapa girado), legenda, tela limpa e "mais". */
export function fecharLegenda(): boolean {
  if (!legendaAberta()) return false;
  setLegendaAberta(false);
  return true;
}

export function initControles() {
  const b = $('#btnLegenda');
  b.addEventListener('click', (e) => { e.stopPropagation(); setLegendaAberta(!legendaAberta()); });
  // fora do popover, toque fecha (o "+N" do unifilar e o botão do cartão abrem)
  document.addEventListener('pointerdown', (e) => {
    const alvo = e.target as Node;
    if (legendaAberta() && !$('#legend').contains(alvo) && !b.contains(alvo) && !(alvo as HTMLElement).closest?.('.legmais, #gavCores')) setLegendaAberta(false);
  });
  const map = getMap(), c = $('#btnCompass');
  c.addEventListener('click', () => north());
  const gira = () => {
    const rot = Math.abs(map.getBearing()) > 0.5;
    c.hidden = !rot;
    $('#compassC').style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map.on('rotate', gira);
  gira();
}
