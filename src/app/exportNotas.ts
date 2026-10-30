import * as catalogo from '../dominio/catalogo';
import { csvDeLinhas, fotosDeNotas, juntarLinhas, linhasDeNotas, linhasDePropostas, nomeArquivoNotas, type ContextoNota, type ContextoProp, type NotaExport } from '../dominio/exportNotas';
import { jpegComGps } from '../dominio/exif';
import { bytesDeDataUrlParaArray } from '../dominio/imagem';
import { efeitoDe, type Proposta } from '../dominio/propostas';
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
    const nomeP = p?.meta.name ?? r.planilha ?? '', d = E.conservaDesde[nomeP], desde = d ? d.split('-').reverse().join('/') : '';
    return { rodovia: E.privacidade ? (p ? rodoviaNome(p.meta.uf) : '') : r.rodovia ?? '', planilha: E.privacidade ? (p ? projName(p) : '') : r.planilha ?? '', km: km(r.km), desde };
  }
  if (!p) return E.privacidade ? { rodovia: '', planilha: '', km: '' } : undefined;
  // anotação antiga: a planilha dá rodovia e sentido
  return { rodovia: E.privacidade ? rodoviaNome(p.meta.uf) : p.meta.uf, planilha: E.privacidade ? projName(p) : p.meta.name, sentido: p.meta.travel > 0 ? 'Crescente' : 'Decrescente', km: km(nota.loc?.km), faixa: nota.loc?.lane ?? null };
}

/** "FS3 (Fresagem funcional 3 cm)": o código original e o nome do catálogo. */
const nomeSolucao = (c: string) => (c === '-' ? 'Sem intervenção' : `${c} (${catalogo.get(c).nome})`);

function contextoDaProposta(r: Proposta): ContextoProp | undefined {
  const p = r.orfa || !r.pid ? undefined : getP(r.pid);
  if (!p) return undefined;
  const meio = p.rows[Math.round((r.r0 + r.r1) / 2)];
  return {
    rodovia: E.privacidade ? rodoviaNome(p.meta.uf) : p.meta.uf, planilha: E.privacidade ? projName(p) : p.meta.name, sentido: p.meta.travel > 0 ? 'Crescente' : 'Decrescente',
    kmIni: p.kmLab[r.r0], kmFim: kmFmt(p.kmNum[r.r1] + 0.02), lat: meio.lat, lon: meio.lon,
    atual: nomeSolucao(r.from), nova: nomeSolucao(r.to), efeito: r.campo?.efeito ?? efeitoDe(r.from, r.to),
  };
}

const opcoesNotas = () => ({ rotuloCat: (c: string) => NOTE_CATS[c as keyof typeof NOTE_CATS]?.l ?? c, contexto: contextoDe });

/** Fotos das notas "Foto", com o nome da coluna "Arquivo da foto" e o EXIF GPS do ponto pressionado. */
export function fotosAtuais(): { id: string; nome: string; bytes: Uint8Array }[] {
  return fotosDeNotas(E.notes as NotaExport[], opcoesNotas()).map((f) => ({ id: f.id, nome: f.nome, bytes: jpegComGps(bytesDeDataUrlParaArray(f.data), f.lat, f.lon, new Date(f.t)) }));
}

/** Com fotos nas notas, a planilha sai num ZIP com a pasta fotos/; sem fotos, o arquivo segue como veio. */
async function comFotos(arq: { nome: string; blob: Blob }, comNotas: boolean): Promise<{ nome: string; blob: Blob }> {
  const fotos = comNotas ? fotosAtuais() : [];
  if (!fotos.length) return arq;
  const { zipSync } = await import('fflate');
  const ent: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { [arq.nome]: new Uint8Array(await arq.blob.arrayBuffer()) };
  for (const f of fotos) ent['fotos/' + f.nome] = [f.bytes, { level: 0 }];
  return { nome: arq.nome.replace(/\.(xlsx|csv)$/, '.zip'), blob: new Blob([zipSync(ent) as BlobPart], { type: 'application/zip' }) };
}

/** Notas (drenos e as da primeira versão) e alterações de solução, juntas e da mais antiga para a mais nova. */
export const linhasAtuais = (comNotas = true) => juntarLinhas(
  comNotas ? linhasDeNotas(E.notes as NotaExport[], opcoesNotas()) : [],
  linhasDePropostas(E.props, (r) => contextoDaProposta(r as Proposta)),
);

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function gerarXlsx(comNotas: boolean): Promise<Uint8Array> {
  const [X, F] = await Promise.all([import('xlsx-js-style'), import('fflate')]);
  return montarXlsx(X as unknown as XlsxLib, F as unknown as FflateLib, linhasAtuais(comNotas));
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

const semNotas = (comNotas: boolean) => { if (!linhasAtuais(comNotas).length) { toast(comNotas ? 'Nenhuma nota para exportar' : 'Nenhuma alteração para exportar'); return true; } return false; };

/** "Baixar planilha (.xlsx)". */
export async function baixarXlsx(comNotas = true) {
  if (semNotas(comNotas)) return;
  try {
    const a = await comFotos({ nome: nomeArquivoNotas('xlsx'), blob: new Blob([await gerarXlsx(comNotas) as BlobPart], { type: MIME_XLSX }) }, comNotas);
    baixar(a.blob, a.nome);
    aposExportar(); toast(`${a.nome} gerado`, 4000);
  } catch { toast('Não foi possível gerar a planilha'); }
}

/** "Baixar CSV": UTF-8 com BOM, ";" e vírgula decimal. */
export function baixarCsv(comNotas = true) {
  if (semNotas(comNotas)) return;
  try {
    void comFotos({ nome: nomeArquivoNotas('csv'), blob: new Blob([csvDeLinhas(linhasAtuais(comNotas))], { type: 'text/csv;charset=utf-8' }) }, comNotas).then((a) => {
      baixar(a.blob, a.nome);
      aposExportar(); toast(`${a.nome} gerado`, 4000);
    }).catch(() => toast('Não foi possível gerar o CSV'));
  } catch { toast('Não foi possível gerar o CSV'); }
}

/** "Compartilhar": Web Share com o arquivo .xlsx quando o aparelho aceita; senão, baixa. */
export async function compartilharNotas(comNotas = true) {
  if (semNotas(comNotas)) return;
  try {
    const a = await comFotos({ nome: nomeArquivoNotas('xlsx'), blob: new Blob([await gerarXlsx(comNotas) as BlobPart], { type: MIME_XLSX }) }, comNotas);
    const nome = a.nome, blob = a.blob, tipo = blob.type;
    const arq = new File([blob], nome, { type: tipo });
    if (navigator.canShare?.({ files: [arq] })) {
      await navigator.share({ files: [arq], title: 'Notas PAVTRACK' });
      aposExportar();
      return;
    }
    baixar(blob, nome); aposExportar();
    toast(`Compartilhar não está disponível aqui: ${nome} baixado`, 4500);
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') toast('Não foi possível compartilhar');
  }
}
