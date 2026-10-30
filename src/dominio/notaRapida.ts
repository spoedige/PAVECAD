/** Nota rápida de campo: tipos, resolução do local pelos polígonos (em metros) e posição do menu circular.
 *  Funções puras, sem DOM. A interface está em app/notaRapida.ts. */
import { localizar, type Local, type LocP } from './localizar';

export const TIPOS_RAPIDOS = {
  // melhorar e retirar são as notas da primeira versão: continuam na lista e na exportação, mas o menu não as cria mais
  melhorar: { rotulo: 'Melhorar solução', curto: 'Melhorar', cat: 'rev' },
  retirar: { rotulo: 'Retirar solução', curto: 'Retirar', cat: 'rev' },
  dreno_mais: { rotulo: 'Colocar dreno', curto: 'Dreno +', cat: 'dre' },
  dreno_menos: { rotulo: 'Retirar dreno', curto: 'Dreno −', cat: 'dre' },
  /** Lembrete para conferir, no escritório, a conserva de rotina feita no local entre a data do projeto e o dia da nota. */
  conserva: { rotulo: 'Ver conserva', curto: 'Conserva', cat: 'obs' },
  /** Texto livre no ponto pressionado (a antiga "Anotação livre"). */
  observacao: { rotulo: 'Observação', curto: 'Obs.', cat: 'obs' },
  foto: { rotulo: 'Foto', curto: 'Foto', cat: 'obs' },
} as const;
export type TipoRapido = keyof typeof TIPOS_RAPIDOS;
export const ORDEM_TIPOS: TipoRapido[] = ['melhorar', 'retirar', 'dreno_mais', 'dreno_menos', 'conserva', 'observacao', 'foto'];
export type OrigemNota = 'pressao' | 'gps';
export type EstadoLocal = 'dentro' | 'proximo' | 'fora' | 'sem-planilha';
export type SentidoNota = 'Crescente' | 'Decrescente';

/** O que a nota rápida guarda além dos campos de qualquer nota. */
export interface DadosRapida {
  tipo: TipoRapido;
  origem: OrigemNota;
  /** Precisão do GPS em metros; vazia na pressão. */
  precisao: number | null;
  rodovia: string | null;
  sentido: SentidoNota | null;
  planilha: string | null;
  /** Km do segmento, no texto da planilha ("209+440"). */
  km: string | null;
  /** 1 a 6 = faixa, 0 = acostamento, null = não definida. */
  faixa: number | null;
  estado: EstadoLocal;
  /** Nota resolvida; na "Ver conserva", é o "Verificado" (senão, "Pendente"). */
  resolvida: boolean;
  /** Foto: posição real do GPS no instante da foto, quando havia. É dado auxiliar: a posição da foto é o ponto pressionado. */
  gps?: { lat: number; lon: number; precisao: number | null } | null;
}

/** Link do Street View do Google no ponto (lat, lon em graus). Abre o panorama mais próximo, se houver. */
export const urlStreetView = (lat: number, lon: number) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Situação de uma "Ver conserva". */
export const situacaoConserva = (r: Pick<DadosRapida, 'resolvida'>) => (r.resolvida ? 'Verificado' : 'Pendente');

/** Até onde (m) o segmento mais próximo vale quando o ponto cai fora dos polígonos. */
export const LIMITE_PROXIMO_M = 30;
/** Diferença (m) entre as distâncias aos dois sentidos abaixo da qual o sentido é ambíguo. */
export const DIF_SENTIDOS_M = 8;
/** Precisão (m) acima da qual o menu avisa em destaque. */
export const AVISO_PRECISAO_M = 30;

export interface Resolucao {
  estado: EstadoLocal;
  /** Segmento escolhido (planilha, linha, faixa). */
  local: Local | null;
  /** O melhor do sentido oposto da mesma rodovia, quando o sentido é ambíguo. */
  outro: Local | null;
  ambiguo: boolean;
  avisoPrecisao: boolean;
}

const sentidoDe = (p: LocP) => (p.meta.travel > 0 ? 'Crescente' : 'Decrescente') as SentidoNota;
const foraDe = (l: Local) => (l.lane === null ? l.out : 0);

/** Acha planilha, rodovia, sentido, faixa e km do ponto, pelos polígonos em metros reais de todas as planilhas visíveis (o Alinhar já vale:
 *  as posições das planilhas incluem o deslocamento). Sem acerto, usa o segmento mais próximo se estiver a até 30 m; acima disso, "fora do trecho".
 *  Sentido ambíguo: as duas pistas a menos de 8 m de diferença na distância, ou GPS pior que a separação entre as pistas. */
export function resolverLocal(P: LocP[], lat: number, lon: number, precisao: number | null = null): Resolucao {
  const todos: Local[] = [];
  for (const p of P) { if (!p.visible) continue; const l = localizar([p], lat, lon); if (l) todos.push(l); }
  const avisoPrecisao = precisao !== null && precisao > AVISO_PRECISAO_M;
  if (!todos.length) return { estado: 'sem-planilha', local: null, outro: null, ambiguo: false, avisoPrecisao };
  todos.sort((a, b) => foraDe(a) - foraDe(b) || a.dist - b.dist);
  const local = todos[0], d = foraDe(local);
  const estado: EstadoLocal = d === 0 ? 'dentro' : d <= LIMITE_PROXIMO_M ? 'proximo' : 'fora';
  let outro: Local | null = null;
  for (const l of todos) if (l !== local && l.p.meta.uf === local.p.meta.uf && l.p.meta.travel !== local.p.meta.travel && foraDe(l) <= LIMITE_PROXIMO_M) { outro = l; break; }
  let ambiguo = false;
  if (outro && estado !== 'fora') {
    const separacao = local.dist + outro.dist;
    ambiguo = Math.abs(local.dist - outro.dist) < DIF_SENTIDOS_M || (precisao !== null && precisao > separacao);
  }
  return { estado, local: estado === 'fora' ? null : local, outro: ambiguo ? outro : null, ambiguo, avisoPrecisao };
}

/** Dados de localização da nota a partir da escolha (o segmento certo, mesmo que o usuário tenha trocado o sentido). */
export function dadosDeLocal(l: Local | null, estado: EstadoLocal, kmTxt: (p: LocP, i: number) => string): Pick<DadosRapida, 'rodovia' | 'sentido' | 'planilha' | 'km' | 'faixa' | 'estado'> {
  if (!l || estado === 'fora' || estado === 'sem-planilha') return { rodovia: null, sentido: null, planilha: null, km: null, faixa: null, estado };
  return { rodovia: l.p.meta.uf, sentido: sentidoDe(l.p), planilha: l.p.meta.name, km: kmTxt(l.p, l.i), faixa: l.lane, estado };
}

/* ---------------------------------------------------------------- */
/* Menu circular                                                     */
/* ---------------------------------------------------------------- */
export interface Ponto { x: number; y: number }
export interface Roda { botoes: Ponto[]; /** Centro da roda: o ponto pressionado, ou um ponto deslocado para dentro quando a roda não cabe em volta dele. */ centro: Ponto; angulo: number; deslocada: boolean }

/** Posiciona `n` botões de lado `tam` em arco em volta do ponto, para longe do dedo (para cima primeiro), sem sobrepor os vizinhos e sempre inteiros dentro da área.
 *  O passo angular vem do tamanho do botão e do raio (mínimo `passoMin`). Se nenhum arco cabe em volta do ponto, o raio cresce; sem espaço mesmo assim,
 *  a roda inteira é centrada num ponto deslocado para dentro da tela ("arco ajustado à borda"). */
export function posicionarRoda(pt: Ponto, area: { w: number; h: number }, n: number, tam = 64, raio = 116, margem = 8, passoMin = 0): Roda {
  const dentro = (b: Ponto) => b.x - tam / 2 >= margem && b.x + tam / 2 <= area.w - margem && b.y - tam / 2 >= margem && b.y + tam / 2 <= area.h - margem;
  const passoDe = (r: number) => Math.max(passoMin, (2 * Math.asin(Math.min(1, (tam + 6) / (2 * r))) * 180) / Math.PI);
  const gerar = (c: Ponto, centro: number, r: number, passo: number): Ponto[] => Array.from({ length: n }, (_, k) => {
    const a = ((centro + (k - (n - 1) / 2) * passo) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  const angulos = [-90, 90, 180, 0, -135, -45, 135, 45, -112, -68, 112, 68, 157, 23, -157, -23];
  for (const r of [raio, raio + 16, raio + 32, raio + 48]) for (const a of angulos) {
    const b = gerar(pt, a, r, passoDe(r));
    if (b.every(dentro)) return { botoes: b, centro: pt, angulo: a, deslocada: false };
  }
  // anel completo num centro deslocado: cabe sempre que a área comporta o anel
  const R = Math.max(tam, Math.min(raio, Math.min(area.w, area.h) / 2 - tam / 2 - margem));
  const lim = (v: number, tot: number) => Math.min(tot - margem - tam / 2 - R, Math.max(margem + tam / 2 + R, v));
  const c = { x: lim(pt.x, area.w), y: lim(pt.y, area.h) };
  return { botoes: gerar(c, -90, R, Math.max(passoDe(R), 360 / n)), centro: c, angulo: -90, deslocada: true };
}

/** Os quatro botões do menu principal (46° entre eles). */
export function posicionarMenu(pt: Ponto, area: { w: number; h: number }, tam = 64, raio = 116, margem = 8): { botoes: Ponto[]; angulo: number } {
  const r = posicionarRoda(pt, area, 4, tam, raio, margem, 46);
  return { botoes: r.botoes, angulo: r.angulo };
}

/* ---------------------------------------------------------------- */
/* Lembrete de exportar                                              */
/* ---------------------------------------------------------------- */
export const NOTAS_ENTRE_EXPORTACOES = 10;
/** Já passou da hora de lembrar de exportar? */
export const precisaLembrar = (novasDesdeExportar: number) => novasDesdeExportar >= NOTAS_ENTRE_EXPORTACOES;
