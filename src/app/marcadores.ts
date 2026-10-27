import type { Map as MapLibre } from 'maplibre-gl';

/** Marcadores próprios das notas "Ver conserva", "Observação" e "Foto": um disco colorido com o ícone da ação (forma, não só cor),
 *  e, com zoom suficiente, a miniatura da foto sobre o ponto. Desenhados em canvas e entregues ao mapa como imagens. */
const TIPOS = ['conserva', 'observacao', 'foto'] as const;
const COR: Record<(typeof TIPOS)[number], string> = { conserva: '#d97706', observacao: '#5e5ce6', foto: '#0a84ff' };
/** Traços do ícone (viewBox 24x24): os mesmos desenhos das bolinhas da roda. */
const TRACOS: Record<(typeof TIPOS)[number], { d?: string; c?: [number, number, number] }[]> = {
  conserva: [{ d: 'M14.5 4.5a4 4 0 0 0-4.7 5.2L4 15.5 8.5 20l5.8-5.8a4 4 0 0 0 5.2-4.7l-2.6 2.6-2.6-.7-.7-2.6z' }],
  observacao: [{ d: 'M4 20h4L19 9l-4-4L4 16z' }, { d: 'M13.5 6.5l4 4' }],
  foto: [{ d: 'M4 8h3l1.5-2.5h7L17 8h3v11H4z' }, { c: [12, 13.5, 3.5] }],
};
const TAM = 44;

function icone(tipo: (typeof TIPOS)[number]): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = TAM;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(TAM / 2, TAM / 2, TAM / 2 - 2, 0, Math.PI * 2);
  g.fillStyle = COR[tipo]; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  const k = (TAM * 0.56) / 24;
  g.save(); g.translate(TAM * 0.22, TAM * 0.22); g.scale(k, k);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const t of TRACOS[tipo]) { if (t.d) g.stroke(new Path2D(t.d)); else if (t.c) { g.beginPath(); g.arc(t.c[0], t.c[1], t.c[2], 0, Math.PI * 2); g.stroke(); } }
  g.restore();
  return g.getImageData(0, 0, TAM, TAM);
}

/** Imagens dos ícones e as duas camadas (ícone e miniatura). Chamar depois da camada de pontos das notas. */
export function registrarMarcadoresDeNotas(map: MapLibre) {
  for (const t of TIPOS) if (!map.hasImage('ic-' + t)) map.addImage('ic-' + t, icone(t), { pixelRatio: 2 });
  map.addLayer({
    id: 'notes-ic', type: 'symbol', source: 'notes', filter: ['in', ['get', 'tipo'], ['literal', [...TIPOS]]],
    layout: { 'icon-image': ['concat', 'ic-', ['get', 'tipo']], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 18, 1.1] },
  });
  map.addLayer({
    id: 'notes-foto', type: 'symbol', source: 'notes', minzoom: 17, filter: ['==', ['get', 'tipo'], 'foto'],
    layout: { 'icon-image': ['concat', 'foto:', ['get', 'id']], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom', 'icon-offset': [0, -16] },
  });
}

const miniaturas = new Set<string>();
/** Miniaturas das fotos das notas, desenhadas uma vez por nota e retiradas do mapa quando a nota sai. */
export function atualizarMiniaturas(map: MapLibre, fotos: { id: string; src: string }[]) {
  const vivas = new Set(fotos.map((f) => 'foto:' + f.id));
  for (const id of [...miniaturas]) if (!vivas.has(id)) { miniaturas.delete(id); if (map.hasImage(id)) map.removeImage(id); }
  for (const f of fotos) {
    const id = 'foto:' + f.id;
    if (miniaturas.has(id)) continue;
    miniaturas.add(id);
    const img = new Image();
    img.onload = () => {
      if (!miniaturas.has(id) || map.hasImage(id)) return;
      const S = 88, c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d')!, lado = Math.min(img.width, img.height);
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      g.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 4, 4, S - 8, S - 8);
      map.addImage(id, g.getImageData(0, 0, S, S), { pixelRatio: 2 });
    };
    img.onerror = () => miniaturas.delete(id);
    img.src = f.src;
  }
}
