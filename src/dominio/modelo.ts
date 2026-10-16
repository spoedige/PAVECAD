import type { Row } from '../formats/types';
import { parseCode, type SolutionCode } from '../formats/km';

export interface RowModel {
  /** Solução por faixa. */
  tr: SolutionCode[];
  /** Solução do acostamento. */
  sh: SolutionCode;
}

export const modelOf = (rows: Row[]): RowModel[] =>
  rows.map((r) => ({ tr: r.lanes.map((l) => parseCode(l.code)), sh: parseCode(r.shoulderCode) }));
