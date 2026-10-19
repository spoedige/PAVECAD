import { csvDeLinhas, linhasDeNotas, nomeArquivoNotas, type ContextoNota, type NotaExport } from '../dominio/exportNotas';
import { montarXlsx, type FflateLib, type XlsxLib } from '../dominio/xlsxNotas';
import { parseKmTexto } from '../formats/km';
import { E, NOTE_CATS, getP, kmFmt, projName, rodoviaNome, type Nota } from './estado';
import { zerarNotasNovas } from './notaRapida';
import { renderNotes } from './revisao';
import { toast } from './ui';

/** Contexto de cada nota para a exportação: rodovia, planilha, sentido e km como o app mostra (o modo privacidade esconde os reais). */
function contextoDe(n: NotaExport): ContextoNota | undefined {
  const nota = n as Nota, p = nota.loc ? getP(nota.loc.pid) : undefined;
  const km = (txt: string | null | undefined) => { if (!txt || !E.privacidade) return txt ?? ''; const v = parseKmTexto(txt); return v === null ? '' : kmFmt(v); };
  if (nota.rapida) {
    const r = nota.rapida;
    return { rodovia: E.privacidade ? (p ? rodoviaNome(p.meta.uf) : '') : r.rodovia ?? '', planilha: E.privacidade ? (p ? projName(p) : '') : r.planilha ?? '', km: km(r.km) };
  }
  if (!p) return E.privacidade ? { rodovia: '', planilha: '', km: '' } : undefined;
  // anotação antiga: a planilha dá rodovia e sentido
  return { rodovia: E.privacidade ? rodoviaNome(p.meta.uf) : p.meta.uf, planilha: E.privacidade ? projName(p) : p.meta.name, sentido: p.meta.travel > 0 ? 'Crescente' : 'Decrescente', km: km(nota.loc?.km), faixa: nota.loc?.lane ?? null };
}

export const linhasAtuais = () => linhasDeNotas(E.notes as NotaExport[], { rotuloCat: (c) => NOTE_CATS[c as keyof typeof NOTE_CATS]?.l ?? c, contexto: contextoDe });

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function gerarXlsx(): Promise<Uint8Array> {
  const [X, F] = await Promise.all([import('xlsx-js-style'), import('fflate')]);
  return montarXlsx(X as unknown as XlsxLib, F as unknown as FflateLib, linhasAtuais());
}

function baixar(blob: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function aposExportar() {
  zerarNotasNovas();
  if (E.tab === 'notas') renderNotes();
}

const semNotas = () => { if (!E.notes.length) { toast('Nenhuma nota para exportar'); return true; } return false; };

/** "Baixar planilha (.xlsx)". */
export async function baixarXlsx() {
  if (semNotas()) return;
  try {
    const nome = nomeArquivoNotas('xlsx');
    baixar(new Blob([await gerarXlsx() as BlobPart], { type: MIME_XLSX }), nome);
    aposExportar(); toast(`${nome} gerado`, 4000);
  } catch { toast('Não foi possível gerar a planilha'); }
}

/** "Baixar CSV": UTF-8 com BOM, ";" e vírgula decimal. */
export function baixarCsv() {
  if (semNotas()) return;
  try {
    const nome = nomeArquivoNotas('csv');
    baixar(new Blob([csvDeLinhas(linhasAtuais())], { type: 'text/csv;charset=utf-8' }), nome);
    aposExportar(); toast(`${nome} gerado`, 4000);
  } catch { toast('Não foi possível gerar o CSV'); }
}

/** "Compartilhar": Web Share com o arquivo .xlsx quando o aparelho aceita; senão, baixa. */
export async function compartilharNotas() {
  if (semNotas()) return;
  try {
    const nome = nomeArquivoNotas('xlsx'), blob = new Blob([await gerarXlsx() as BlobPart], { type: MIME_XLSX });
    const arq = new File([blob], nome, { type: MIME_XLSX });
    if (navigator.canShare?.({ files: [arq] })) {
      await navigator.share({ files: [arq], title: 'Notas PAVECAD' });
      aposExportar();
      return;
    }
    baixar(blob, nome); aposExportar();
    toast(`Compartilhar não está disponível aqui: ${nome} baixado`, 4500);
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') toast('Não foi possível compartilhar');
  }
}
