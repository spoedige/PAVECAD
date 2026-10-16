import type { Lane } from '../formats/types';

/** Paletas de qualidade em 5 classes (normal e modo campo, contraste alto). */
export const Q5 = ['#34c759', '#a4d64a', '#ffcc00', '#ff9500', '#ff3b30'];
export const Q5F = ['#007a33', '#6aa000', '#f2c200', '#ff6a00', '#d0021b'];

export type IndKey = 'iri' | 'atr' | 'd0' | 'rc' | 'def';
export type ModeKey = 'sol' | IndKey;
export const MODE_KEYS: ModeKey[] = ['sol', 'iri', 'atr', 'd0', 'rc', 'def'];

export interface Indicador {
  label: string;
  unit: string;
  /** Propriedade de classe nas feições (0 a 4, -1 sem leitura). */
  prop: string;
  dec: number;
  /** Multiplicador de exibição (fração para %). */
  scale: number;
  value(l: Lane): number | null;
  /** Classe 0 (melhor) a 4 (pior), conforme os limiares ativos. */
  cls(v: number): number;
  /** Rótulos das 5 classes, derivados dos limiares ativos. */
  readonly labels: string[];
  readonly lim?: string;
  /** Quanto menor o valor, pior. */
  low?: boolean;
}

/** Limiares das classes 0 a 3 (a classe 4 é o que passa do último). Crescentes, exceto o Rc (decrescente). */
export type Limites = Record<IndKey, number[]>;

/** Provisórios; a tela de configurações permite ajustar ao critério do projeto. */
export const LIMITES_PADRAO: Limites = {
  iri: [1.5, 2, 2.7, 3.5],
  atr: [3, 5, 8, 12],
  d0: [20, 30, 40, 50],
  rc: [500, 300, 200, 150],
  def: [0, 0.05, 0.15, 0.3],
};

const clonar = (l: Limites): Limites => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [...v]])) as Limites;
let LIM: Limites = clonar(LIMITES_PADRAO);

export const getLimites = (): Limites => clonar(LIM);

/** Devolve a mensagem de erro, ou null se os 4 limiares são válidos para o indicador. */
export function validarLimites(key: IndKey, v: number[]): string | null {
  if (v.length !== 4 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return 'Informe os 4 limiares.';
  if (v.some((x) => x < 0)) return 'Os limiares não podem ser negativos.';
  const desc = key === 'rc';
  for (let i = 1; i < 4; i++) if (desc ? v[i] >= v[i - 1] : v[i] <= v[i - 1]) return desc ? 'Os limiares do Rc devem ser decrescentes.' : 'Os limiares devem ser crescentes.';
  return null;
}

/** Aplica limiares (ignora indicadores inválidos). Devolve os que foram recusados. */
export function setLimites(l: Partial<Limites>): IndKey[] {
  const recusados: IndKey[] = [];
  for (const k of Object.keys(l) as IndKey[]) {
    const v = l[k]!;
    if (validarLimites(k, v)) recusados.push(k); else LIM[k] = [...v];
  }
  return recusados;
}

export const restaurarLimites = () => { LIM = clonar(LIMITES_PADRAO); };

const num = (v: number, dec: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: Math.max(2, dec) });

/** Rótulos das 5 classes para um conjunto de limiares (os ativos ou um rascunho). */
export function rotulosPara(key: IndKey, lim: number[]): string[] {
  const { dec, scale } = ROT[key];
  return montar(key, lim, dec, scale);
}
const ROT: Record<IndKey, { dec: number; scale: number }> = { iri: { dec: 1, scale: 1 }, atr: { dec: 0, scale: 1 }, d0: { dec: 0, scale: 1 }, rc: { dec: 0, scale: 1 }, def: { dec: 0, scale: 100 } };

function rotulos(key: IndKey, dec: number, scale: number): string[] {
  return montar(key, LIM[key], dec, scale);
}

function montar(key: IndKey, lim: number[], dec: number, scale: number): string[] {
  const L = lim.map((x) => x * scale);
  const n = (v: number) => num(v, dec);
  if (key === 'rc') return [`≥ ${n(L[0])}`, `${n(L[1])} a ${n(L[0])}`, `${n(L[2])} a ${n(L[1])}`, `${n(L[3])} a ${n(L[2])}`, `< ${n(L[3])}`];
  if (key === 'def' && L[0] === 0) return ['0%', `até ${n(L[1])}%`, `${n(L[1])} a ${n(L[2])}%`, `${n(L[2])} a ${n(L[3])}%`, `> ${n(L[3])}%`];
  const suf = key === 'def' ? '%' : '';
  return [`≤ ${n(L[0])}${suf}`, `${n(L[0])} a ${n(L[1])}${suf}`, `${n(L[1])} a ${n(L[2])}${suf}`, `${n(L[2])} a ${n(L[3])}${suf}`, `> ${n(L[3])}${suf}`];
}

function classe(key: IndKey, v: number): number {
  const L = LIM[key];
  for (let i = 0; i < 4; i++) if (key === 'rc' ? v >= L[i] : v <= L[i]) return i;
  return 4;
}

export const IND: Record<IndKey, Indicador> = {
  iri: { label: 'IRI', unit: 'm/km', prop: 'c_iri', dec: 2, scale: 1, value: (l) => l.iri, cls: (v) => classe('iri', v), get labels() { return rotulos('iri', 1, 1); }, get lim() { return `admissível ${num(LIM.iri[2], 1)}`; } },
  atr: { label: 'ATR máx', unit: 'mm', prop: 'c_atr', dec: 1, scale: 1, value: (l) => l.atr, cls: (v) => classe('atr', v), get labels() { return rotulos('atr', 0, 1); } },
  d0: { label: 'D0', unit: '0,01 mm', prop: 'c_d0', dec: 1, scale: 1, value: (l) => l.d0, cls: (v) => classe('d0', v), get labels() { return rotulos('d0', 0, 1); } },
  rc: { label: 'Rc', unit: 'm', prop: 'c_rc', dec: 0, scale: 1, value: (l) => l.rc, cls: (v) => classe('rc', v), get labels() { return rotulos('rc', 0, 1); }, low: true },
  def: { label: '% Defeitos', unit: '%', prop: 'c_def', dec: 1, scale: 100, value: (l) => l.defPct, cls: (v) => classe('def', v), get labels() { return rotulos('def', 0, 100); } },
};

export const IND_KEYS = Object.keys(IND) as IndKey[];

/** Classes pré-calculadas de uma faixa: troca de modo de cor só troca a expressão de pintura. */
export function classProps(l: Lane): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of IND_KEYS) {
    const v = IND[k].value(l);
    o[IND[k].prop] = v == null ? -1 : IND[k].cls(v);
  }
  return o;
}
