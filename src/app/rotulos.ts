/** Rótulos de texto do mapa (marcos de km, estacas, plataformas): sem colisão entre si, sem ficar sob os
 *  painéis da interface e sem ser cortados na borda do mapa. Roda depois de cada movimento do mapa.
 *
 *  Prioridade (menor vence): km inteiro (0), 500 m e plataformas (1), 100 m (2), 20 m (3); o rótulo interno do segmento (com intervalo) vale como 100 m e ganha dos de 20 m. */
export const PRIO = { km: 0, meio: 1, poi: 1, cem: 2, vinte: 3, interno: 2 } as const;
export const prioDeEstaca = (m: number) => (m % 1000 === 0 ? PRIO.km : m % 500 === 0 ? PRIO.meio : m % 100 === 0 ? PRIO.cem : PRIO.vinte);

interface Ret { left: number; top: number; right: number; bottom: number }
const cruza = (a: Ret, b: Ret, folga = 0) => a.left < b.right + folga && a.right > b.left - folga && a.top < b.bottom + folga && a.bottom > b.top - folga;
const rect = (e: Element): Ret => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };

/** Elementos da interface que cobrem o mapa. */
const BLOQUEIOS = [
  '.stage .glass:not(.toast):not(.tip)', '.stage .chipbtn', '.stage .pillbtn', '.stage .iconbtn', '.stage .zoomnote',
  '.stage .maplibregl-ctrl-group', '.stage .maplibregl-ctrl-scale', '.stage .maplibregl-ctrl-attrib',
  '.stage .tools button', '.grestaura', '#legend', '#propbar', '#inspector', '#unicard',
].join(',');

export interface OpcoesRotulos {
  /** Planilha de referência (a selecionada ou a primeira do grupo): só desempata, ganha o lugar quando dois rótulos disputam o mesmo. Todas as planilhas visíveis mostram rótulo. */
  refId: string | null;
  /** Estacas ligadas e visíveis neste zoom: o rótulo de estaca de km inteiro substitui o "km N" cinza. */
  estacasAtivas: boolean;
}

export function resolverRotulos(o: OpcoesRotulos) {
  const mapa = document.getElementById('map');
  if (!mapa) return;
  const mr = rect(mapa);
  const els = [...document.querySelectorAll<HTMLElement>('.stage .maplibregl-marker[data-rot]')];
  els.forEach((e) => e.classList.remove('rot-oculto'));

  const bloqueios = [...document.querySelectorAll(BLOQUEIOS)]
    .filter((e) => (e as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false)
    .map(rect)
    .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);

  const cand: { e: HTMLElement; r: Ret; prio: number; ord: number; ref: number }[] = [];
  for (const e of els) {
    const tipo = e.dataset.rot;
    if (tipo === 'km' && o.estacasAtivas) { e.classList.add('rot-oculto'); continue; }
    const r = rect(e);
    if (r.right - r.left < 1) continue; // oculto por CSS (zoom baixo, camada desligada)
    cand.push({ e, r, prio: +(e.dataset.prio ?? 3), ord: tipo === 'estaca' ? 0 : 1, ref: o.refId && e.dataset.pid === o.refId ? 0 : 1 });
  }
  cand.sort((a, b) => a.prio - b.prio || a.ref - b.ref || a.ord - b.ord);

  const aceitos: Ret[] = [];
  for (const c of cand) {
    const dentro = c.r.left >= mr.left + 2 && c.r.right <= mr.right - 2 && c.r.top >= mr.top + 2 && c.r.bottom <= mr.bottom - 2;
    if (!dentro || bloqueios.some((b) => cruza(c.r, b, 2)) || aceitos.some((a) => cruza(c.r, a, 3))) c.e.classList.add('rot-oculto');
    else aceitos.push(c.r);
  }
}

let t: ReturnType<typeof setTimeout> | undefined;
/** Agenda a resolução; vários gatilhos seguidos (painel que muda de tamanho, aba) viram uma execução só. */
export function agendarRotulos(fn: () => void, ms = 120) {
  clearTimeout(t);
  t = setTimeout(fn, ms);
}
