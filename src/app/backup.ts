import * as catalogo from '../dominio/catalogo';
import { getLimites, setLimites, type Limites } from '../dominio/indicadores';
import { lerBackup, montarBackup, nomeArquivoBackup, novosPorId } from '../dominio/backup';
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
    baixar(new Blob([JSON.stringify(b)], { type: 'application/json' }), nomeArquivoBackup());
    toast(`Backup gerado: ${b.planilhas.length} planilha(s), ${b.notas.length} nota(s), ${b.propostas.length} proposta(s)`);
  } catch { toast('Download indisponível aqui'); }
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
