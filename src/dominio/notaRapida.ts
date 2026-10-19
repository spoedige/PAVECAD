/** Nota rápida de campo: tipos, resolução do local pelos polígonos (em metros) e posição do menu circular.
 *  Funções puras, sem DOM. A interface está em app/notaRapida.ts. */
import { localizar, type Local, type LocP } from './localizar';

export const TIPOS_RAPIDOS = {
  melhorar: { rotulo: 'Melhorar solução', curto: 'Melhorar', cat: 'rev' },
  retirar: { rotulo: 'Retirar solução', curto: 'Retirar', cat: 'rev' },
  dreno_mais: { rotulo: 'Colocar dreno', curto: 'Dreno +', cat: 'dre' },
  dreno_menos: { rotulo: 'Retirar dreno', curto: 'Dreno −', cat: 'dre' },
} as const;
export type TipoRapido = keyof typeof TIPOS_RAPIDOS;
export const ORDEM_TIPOS: TipoRapido[] = ['melhorar', 'retirar', 'dreno_mais', 'dreno_menos'];
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
  resolvida: boolean;
}

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
/** Centros dos quatro botões em volta do ponto, deslocados para longe do dedo (para cima primeiro) e sempre inteiros dentro da área. */
export function posicionarMenu(pt: Ponto, area: { w: number; h: number }, tam = 64, raio = 116, margem = 8): { botoes: Ponto[]; angulo: number } {
  const dentro = (b: Ponto) => b.x - tam / 2 >= margem && b.x + tam / 2 <= area.w - margem && b.y - tam / 2 >= margem && b.y + tam / 2 <= area.h - margem;
  const gerar = (centro: number, r: number): Ponto[] => [0, 1, 2, 3].map((k) => {
    const a = ((centro + (k - 1.5) * 46) * Math.PI) / 180;
    return { x: pt.x + r * Math.cos(a), y: pt.y + r * Math.sin(a) };
  });
  const angulos = [-90, 90, 180, 0, -135, -45, 135, 45];
  for (const r of [raio, raio + 16, raio + 32]) for (const a of angulos) { const b = gerar(a, r); if (b.every(dentro)) return { botoes: b, angulo: a }; }
  const b = gerar(-90, raio).map((q) => ({ x: Math.min(area.w - margem - tam / 2, Math.max(margem + tam / 2, q.x)), y: Math.min(area.h - margem - tam / 2, Math.max(margem + tam / 2, q.y)) }));
  return { botoes: b, angulo: -90 };
}

/* ---------------------------------------------------------------- */
/* Lembrete de exportar                                              */
/* ---------------------------------------------------------------- */
export const NOTAS_ENTRE_EXPORTACOES = 10;
/** Já passou da hora de lembrar de exportar? */
export const precisaLembrar = (novasDesdeExportar: number) => novasDesdeExportar >= NOTAS_ENTRE_EXPORTACOES;
