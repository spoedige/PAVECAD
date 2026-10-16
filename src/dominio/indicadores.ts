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
  cls(v: number): number;
  labels: string[];
  lim?: string;
  /** Quanto menor o valor, pior. */
  low?: boolean;
}

/** Limiares provisórios; a tela de configurações vai torná-los editáveis. */
export const IND: Record<IndKey, Indicador> = {
  iri: { label: 'IRI', unit: 'm/km', prop: 'c_iri', dec: 2, scale: 1, value: (l) => l.iri, cls: (v) => (v <= 1.5 ? 0 : v <= 2 ? 1 : v <= 2.7 ? 2 : v <= 3.5 ? 3 : 4), labels: ['≤ 1,5', '1,5 a 2,0', '2,0 a 2,7', '2,7 a 3,5', '> 3,5'], lim: 'admissível 2,7' },
  atr: { label: 'ATR máx', unit: 'mm', prop: 'c_atr', dec: 1, scale: 1, value: (l) => l.atr, cls: (v) => (v <= 3 ? 0 : v <= 5 ? 1 : v <= 8 ? 2 : v <= 12 ? 3 : 4), labels: ['≤ 3', '3 a 5', '5 a 8', '8 a 12', '> 12'] },
  d0: { label: 'D0', unit: '0,01 mm', prop: 'c_d0', dec: 1, scale: 1, value: (l) => l.d0, cls: (v) => (v <= 20 ? 0 : v <= 30 ? 1 : v <= 40 ? 2 : v <= 50 ? 3 : 4), labels: ['≤ 20', '20 a 30', '30 a 40', '40 a 50', '> 50'] },
  rc: { label: 'Rc', unit: 'm', prop: 'c_rc', dec: 0, scale: 1, value: (l) => l.rc, cls: (v) => (v >= 500 ? 0 : v >= 300 ? 1 : v >= 200 ? 2 : v >= 150 ? 3 : 4), labels: ['≥ 500', '300 a 500', '200 a 300', '150 a 200', '< 150'], low: true },
  def: { label: '% Defeitos', unit: '%', prop: 'c_def', dec: 1, scale: 100, value: (l) => l.defPct, cls: (v) => (v === 0 ? 0 : v <= 0.05 ? 1 : v <= 0.15 ? 2 : v <= 0.3 ? 3 : 4), labels: ['0%', 'até 5%', '5 a 15%', '15 a 30%', '> 30%'] },
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
