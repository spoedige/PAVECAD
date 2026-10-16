import * as XLSX from 'xlsx';
import type { FormatDef, ParsedProject, SheetBook } from './types';
import { roadrunner } from './roadrunner';

export * from './types';
export * from './km';
export * from './segments';

/** Registro de padrões de planilha. Novo padrão = novo item, sem mexer no resto. */
export const FORMATS: FormatDef[] = [roadrunner];

export function bookFrom(wb: XLSX.WorkBook): SheetBook {
  return {
    names: wb.SheetNames,
    sheet: (name) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  };
}

/** Lê o conteúdo de um .xlsx. Só carrega as abas que o padrão precisa. */
export function readWorkbook(data: Uint8Array | ArrayBuffer): SheetBook {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(buf, {
    type: 'array', sheets: ['Unifilar', 'Solução'], dense: true,
    cellFormula: false, cellStyles: false, cellNF: false, cellHTML: false, cellText: false,
  });
  return bookFrom(wb);
}

export function parseSpreadsheet(data: Uint8Array | ArrayBuffer): ParsedProject {
  const book = readWorkbook(data);
  const fm = FORMATS.find((f) => f.detect(book));
  if (!fm) throw new Error('formato não reconhecido. Padrões disponíveis: ' + FORMATS.map((f) => f.label).join(', '));
  return fm.parse(book);
}
