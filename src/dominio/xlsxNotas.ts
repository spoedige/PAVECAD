/** Monta o XLSX das notas: aba "Notas" (cabeçalho em negrito, filtro, linha de cabeçalho congelada, larguras, data e hora de verdade, coordenadas
 *  com 6 casas) e aba "Resumo". O SheetJS (xlsx-js-style, que grava estilos) e o fflate chegam por parâmetro: o app os carrega só ao exportar. */
import { COLUNAS, resumoDeLinhas, type Linha } from './exportNotas';

/** O que usamos do xlsx-js-style. */
export interface XlsxLib {
  utils: {
    aoa_to_sheet(d: unknown[][]): Record<string, unknown>;
    book_new(): { SheetNames: string[]; Sheets: Record<string, unknown>; Props?: Record<string, unknown> };
    book_append_sheet(wb: unknown, ws: unknown, nome: string): void;
    encode_cell(c: { r: number; c: number }): string;
    encode_range(r: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
  };
  write(wb: unknown, o: Record<string, unknown>): ArrayBuffer | Uint8Array;
}
export interface FflateLib {
  unzipSync(d: Uint8Array): Record<string, Uint8Array>;
  zipSync(d: Record<string, Uint8Array>, o?: { level?: number }): Uint8Array;
  strFromU8(d: Uint8Array): string;
  strToU8(s: string): Uint8Array;
}

type Cel = { t?: string; v?: unknown; z?: string; s?: unknown };
const NEGRITO = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'E8EAF0' } }, border: { bottom: { style: 'thin', color: { rgb: '999999' } } }, alignment: { vertical: 'center' } };

/** Largura em caracteres de cada coluna, pelo maior texto (com teto). */
function larguras(cab: readonly string[], linhas: unknown[][]): { wch: number }[] {
  return cab.map((c, i) => {
    let w = c.length + 3;
    for (const l of linhas) { const v = l[i]; const n = typeof v === 'string' ? v.length : typeof v === 'number' ? 12 : 0; if (n > w) w = n; }
    return { wch: Math.min(48, w + 2) };
  });
}

export function montarXlsx(X: XlsxLib, F: FflateLib, linhas: Linha[]): Uint8Array {
  // campo vazio fica sem célula (e não uma célula de texto vazio)
  const v = (x: string | number | null) => (x === '' || x === null ? null : x);
  const dados = linhas.map((l) => [l.data, l.hora, l.tipo, v(l.rodovia), v(l.planilha), v(l.sentido), v(l.faixa), v(l.solucaoAtual), v(l.solucaoNova), v(l.efeito), v(l.extAntes), v(l.extDepois), v(l.kmIni), v(l.kmFim),
    l.lat, l.lon, l.utmE, l.utmN, l.origem, v(l.precisao), v(l.observacao), l.status, v(l.desde), v(l.ate), v(l.situacao), v(l.arquivoFoto)]);
  const ws = X.utils.aoa_to_sheet([[...COLUNAS], ...dados]);
  const set = (r: number, c: number, f: (x: Cel) => void) => { const a = ws[X.utils.encode_cell({ r, c })] as Cel | undefined; if (a) f(a); };
  COLUNAS.forEach((_, c) => set(0, c, (x) => { x.s = NEGRITO; }));
  const FORM: Record<number, string> = { 0: 'dd/mm/yyyy', 1: 'hh:mm', 10: '0', 11: '0', 14: '0.000000', 15: '0.000000', 16: '0.00', 17: '0.00', 19: '0' };
  linhas.forEach((_, i) => { for (const [c, z] of Object.entries(FORM)) set(i + 1, +c, (x) => { if (x.t === 'n') x.z = z; }); });
  ws['!cols'] = larguras(COLUNAS, dados);
  ws['!rows'] = [{ hpt: 22 }];
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(linhas.length, 1), c: COLUNAS.length - 1 } }) };

  const r = resumoDeLinhas(linhas);
  const aoa: unknown[][] = [['Resumo das notas'], ['Total', r.total], [], ['Tipo', 'Notas'], ...r.porTipo.map(([t, n]) => [t, n]), [], ['Rodovia', 'Sentido', 'Notas'], ...r.porRodoviaSentido.map(([a, b, n]) => [a, b, n]), [],
    [`Coordenadas UTM em SIRGAS 2000, fuso ${r.fusos.join(' e ') || '-'}. Latitude e longitude em graus decimais.`]];
  const wr = X.utils.aoa_to_sheet(aoa);
  const marcar = (a: number, c: number) => { const x = wr[X.utils.encode_cell({ r: a, c })] as Cel | undefined; if (x) x.s = NEGRITO; };
  marcar(0, 0);
  const iTipo = 3, iRod = 4 + r.porTipo.length + 1;
  [0, 1].forEach((c) => marcar(iTipo, c)); [0, 1, 2].forEach((c) => marcar(iRod, c));
  wr['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 10 }];

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Notas');
  X.utils.book_append_sheet(wb, wr, 'Resumo');
  wb.Props = { Title: 'Notas PAVECAD', Author: 'PAVECAD' };
  const bruto = new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer);
  return congelarCabecalho(F, bruto);
}

/** O SheetJS não grava painel congelado: acrescenta o <pane> na vista da aba Notas (primeira linha fixa). */
export function congelarCabecalho(F: FflateLib, xlsx: Uint8Array): Uint8Array {
  const zip = F.unzipSync(xlsx), nome = 'xl/worksheets/sheet1.xml';
  if (!zip[nome]) return xlsx;
  const xml = F.strFromU8(zip[nome]);
  const vista = '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>';
  const novo = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, vista);
  if (novo === xml) return xlsx;
  zip[nome] = F.strToU8(novo);
  return F.zipSync(zip, { level: 6 });
}
