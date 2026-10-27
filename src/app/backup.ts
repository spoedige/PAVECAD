import * as catalogo from '../dominio/catalogo';
import { getLimites, setLimites, type Limites } from '../dominio/indicadores';
import { ARQUIVO_JSON_BACKUP, PASTA_FOTOS, juntarFotos, lerBackup, montarBackup, nomeArquivoBackup, nomeArquivoBackupZip, novosPorId, separarFotos } from '../dominio/backup';
import { bytesDeDataUrlParaArray } from '../dominio/imagem';
import { reposicionar, type Proposta } from '../dominio/propostas';
import { E, type Nota } from './estado';
import * as db from './persist';
import { toast } from './ui';

function baixar(blob: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Backup completo (JSON): planilhas guardadas, notas com fotos, propostas, catálogo e limiares. */
export async function baixarBackupCompleto() {
  try {
    const planilhas = await db.todos<{ id: string; parsed: unknown; zone?: number }>('projetos');
    const b = montarBackup({ notas: E.notes, propostas: E.props, catalogo: catalogo.exportar(), limiares: getLimites(), planilhas });
    if (E.notes.some((n) => n.photos?.length)) {
      // com fotos: ZIP com backup.json e a pasta fotos/
      const { zipSync, strToU8 } = await import('fflate');
      const sep = separarFotos(b.notas as Nota[]);
      const ent: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { [ARQUIVO_JSON_BACKUP]: strToU8(JSON.stringify({ ...b, notas: sep.notas })) };
      for (const a of sep.arquivos) ent[PASTA_FOTOS + a.nome] = [bytesDeDataUrlParaArray(a.data), { level: 0 }];
      baixar(new Blob([zipSync(ent) as BlobPart], { type: 'application/zip' }), nomeArquivoBackupZip());
    } else baixar(new Blob([JSON.stringify(b)], { type: 'application/json' }), nomeArquivoBackup());
    toast(`Backup gerado: ${b.planilhas.length} planilha(s), ${b.notas.length} nota(s), ${b.propostas.length} proposta(s)`);
  } catch { toast('Download indisponível aqui'); }
}

/** Lê um backup em ZIP (backup.json e fotos/) e devolve o JSON com as fotos de volta nas notas. Null quando o ZIP não é um backup. */
export async function lerBackupZip(buf: ArrayBuffer): Promise<unknown | null> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const z = unzipSync(new Uint8Array(buf));
  const js = z[ARQUIVO_JSON_BACKUP];
  if (!js) return null;
  const j = JSON.parse(strFromU8(js)) as { notas?: { photos?: string[] }[] };
  const dataUrl = (nome: string) => { const b = z[PASTA_FOTOS + nome]; if (!b) return null; let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return 'data:image/jpeg;base64,' + btoa(s); };
  if (Array.isArray(j.notas)) j.notas = juntarFotos(j.notas, dataUrl);
  return j;
}

export interface ResultadoBackup { resumo: string; recarregar: boolean }

/** Restaura um backup completo. Notas e propostas entram por id (as que já existem ficam como estão); planilhas, catálogo e limiares vêm do arquivo.
 *  Devolve null se o JSON não for um backup completo. `recarregar` é verdadeiro quando há planilhas que ainda não estão abertas: o app recarrega para abri-las. */
export async function restaurarBackup(j: unknown): Promise<ResultadoBackup | null> {
  const b = lerBackup(j);
  if (!b) return null;
  const n = novosPorId(E.notes, b.notas as Nota[]);
  const p = novosPorId(E.props, b.propostas as unknown as Proposta[]);
  const abertas = new Set(E.P.map((x) => x.meta.name));
  const ops: Promise<boolean>[] = [];
  for (const x of n.novos) ops.push(db.gravarAguardando('notes', x as Nota));
  for (const x of p.novos) ops.push(db.gravarAguardando('props', x as Proposta));
  for (const x of b.planilhas) ops.push(db.gravarAguardando('projetos', { ...x, t: new Date().toISOString() }));
  if (b.catalogo) { try { catalogo.importar(b.catalogo); ops.push(db.gravarAguardando('config', { id: 'catalogo', json: catalogo.exportar() })); } catch { /* catálogo inválido: ignora */ } }
  if (b.limiares) { try { setLimites(b.limiares as Limites); ops.push(db.gravarAguardando('config', { id: 'limiares', limites: getLimites() })); } catch { /* ignora */ } }
  const ok = (await Promise.all(ops)).every(Boolean);
  E.notes.push(...(n.novos as Nota[]));
  E.props = reposicionar([...E.props, ...(p.novos as unknown as Proposta[]).map((r) => ({ ...r, pid: null, orfa: false }))], E.P);
  const resumo = `${b.planilhas.length} planilha(s), ${n.novos.length} nota(s) nova(s), ${p.novos.length} proposta(s) nova(s)`;
  return { resumo: ok ? resumo : `${resumo}. Parte dos dados não pôde ser gravada neste aparelho`, recarregar: b.planilhas.some((x) => !abertas.has((x.parsed as { meta?: { name?: string } }).meta?.name ?? x.id)) };
}
