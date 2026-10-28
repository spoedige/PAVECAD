/** Marcos quilométricos adaptativos à escala: passo, prioridade, orçamento e posição dos rótulos.
 *  Funções puras (sem DOM nem MapLibre): quem desenha é updateStakes em app/mapa.ts. */

/** Passos possíveis entre rótulos, em metros. */
export const PASSOS = [20, 40, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
/** Espaço mínimo entre dois rótulos seguidos, em pixels. */
export const MIN_PX = 64;
/** Comprimento mínimo (px) de um segmento de 20 m para o rótulo caber dentro dele. */
export const MIN_PX_INTERNO = 100;
/** Máximo de rótulos por atualização do mapa. */
export const ORCAMENTO = 400;
/** Pistas mais próximas que isso (m) dividem um rótulo só, no eixo. */
export const PISTAS_JUNTAS_M = 20;
/** Segmento de uma planilha, em metros. */
export const SEGMENTO_M = 20;

/** Metros por pixel CSS no zoom e latitude dados (tiles de 512 px do MapLibre). */
export const metrosPorPixel = (zoom: number, lat: number) => (78271.51696 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/** Menor passo cujo espaçamento na tela é de pelo menos minPx. */
export function passoParaEscala(pxPorMetro: number, minPx = MIN_PX): number {
  for (const s of PASSOS) if (s * pxPorMetro >= minPx) return s;
  return PASSOS[PASSOS.length - 1];
}

/** Próximo passo da lista (o último devolve ele mesmo). */
export const passoAcima = (passo: number): number => PASSOS[Math.min(PASSOS.length - 1, PASSOS.findIndex((s) => s >= passo) + 1)];

/** O marco m (metros inteiros) cai num múltiplo do passo? */
export const alinhado = (m: number, passo: number) => m % passo === 0;

/** Importância: km cheio 0, 500 m 1, 100 m 2, o resto 3. Menor vence. */
export const prioDoMarco = (m: number): 0 | 1 | 2 | 3 => (m % 1000 === 0 ? 0 : m % 500 === 0 ? 1 : m % 100 === 0 ? 2 : 3);

/** Escolhe o passo: o da escala e, se passar do orçamento, o próximo e assim por diante. Nunca zera: o último passo vale. */
export function passoComOrcamento(pxPorMetro: number, contar: (passo: number) => number, max = ORCAMENTO): number {
  let passo = passoParaEscala(pxPorMetro);
  while (contar(passo) > max && passo < PASSOS[PASSOS.length - 1]) passo = passoAcima(passo);
  return passo;
}

/** Fica com os `max` mais importantes; em empate de prioridade, os mais perto do centro (d menor). */
export function dentroDoOrcamento<T extends { m: number; d: number }>(c: T[], max = ORCAMENTO): T[] {
  if (c.length <= max) return c;
  return [...c].sort((a, b) => prioDoMarco(a.m) - prioDoMarco(b.m) || a.d - b.d).slice(0, max);
}

/** O quadradinho de 20 m é largo o bastante para levar o rótulo por dentro? */
export const cabeRotuloInterno = (pxPorMetro: number) => SEGMENTO_M * pxPorMetro >= MIN_PX_INTERNO;

/** Rumo (graus, 0 = norte, horário) do vetor leste/norte. */
export const rumoDe = (leste: number, norte: number) => ((Math.atan2(leste, norte) * 180) / Math.PI + 360) % 360;

/** Direção na tela (vetor unitário, y para baixo) de um vetor leste/norte quando o mapa está girado em `bearing` graus. */
export function direcaoNaTela(leste: number, norte: number, bearing: number): [number, number] {
  const t = ((rumoDe(leste, norte) - bearing) * Math.PI) / 180;
  return [Math.sin(t), -Math.cos(t)];
}

/** Deslocamento em pixels de um rótulo (largura w, altura h) que deve ficar para fora de uma borda, na direção da tela u.
 *  O centro do rótulo anda gap + a meia-extensão do retângulo ao longo de u. */
export function deslocamentoParaFora(u: [number, number], w: number, h: number, gap = 3): [number, number] {
  const ext = (Math.abs(u[0]) * w) / 2 + (Math.abs(u[1]) * h) / 2;
  return [u[0] * (gap + ext), u[1] * (gap + ext)];
}

/** Texto do rótulo interno de um segmento: só o marco dele ("209+440"), sem intervalo. */
export const rotuloInterno = (marco: string) => marco;
