import { marcadosPor, ROTULO_ATALHO, type Atalho, type ItemSelecao } from '../dominio/selecao';
import { E, projName, rodoviaNome, type AppProj } from './estado';
import { esc } from './ui';

/** Componente de seleção de planilhas: atalhos (sempre na mesma ordem) e lista com checkbox. Usado em Alinhar, em Ajustes e
 *  no seletor das Larguras. O HTML e a ligação ficam aqui para os três se comportarem igual. */

export const itemDe = (p: AppProj): ItemSelecao => ({ id: p.id, nome: projName(p), rodovia: rodoviaNome(p.meta.uf), sentido: p.meta.travel });

export interface ConfigSelecao {
  itens: ItemSelecao[];
  /** Conjunto de ids marcados. O componente altera o conjunto e chama `aoMudar`. */
  marcadas: Set<string>;
  /** Planilha de referência dos atalhos "Mesma rodovia que a atual". */
  origem: ItemSelecao | undefined;
  aoMudar: () => void;
}

const ORDEM = Object.keys(ROTULO_ATALHO) as Atalho[];

export function htmlSelecao(c: Pick<ConfigSelecao, 'itens' | 'marcadas'>, idLista: string, vazio = 'Não há planilhas abertas.'): string {
  return `<div class="sel-atalhos" role="group" aria-label="Atalhos de seleção">${ORDEM.map((a) => `<button type="button" class="btn" data-atalho="${a}">${ROTULO_ATALHO[a]}</button>`).join('')}</div>
    <div class="sel-lista" id="${idLista}" role="group" aria-label="Planilhas">${c.itens.length
      ? c.itens.map((i) => `<label class="sel-item"><input type="checkbox" data-id="${esc(i.id)}"${c.marcadas.has(i.id) ? ' checked' : ''}><span><b>${esc(i.nome)}</b><span class="note">${esc(i.rodovia)} · ${i.sentido === 1 ? 'Crescente' : 'Decrescente'}</span></span></label>`).join('')
      : `<p class="note" style="padding:10px;margin:0">${esc(vazio)}</p>`}</div>`;
}

/** Marca ou desmarca os checkbox de acordo com o conjunto, sem refazer a lista. */
export function sincronizarSelecao(raiz: ParentNode, marcadas: Set<string>) {
  raiz.querySelectorAll<HTMLInputElement>('input[data-id]').forEach((c) => { c.checked = marcadas.has(c.dataset.id!); });
}

export function ligarSelecao(raiz: ParentNode, c: ConfigSelecao) {
  raiz.querySelectorAll<HTMLElement>('[data-atalho]').forEach((b) => b.addEventListener('click', () => {
    const novo = marcadosPor(b.dataset.atalho as Atalho, c.itens, c.origem ?? { rodovia: '' });
    c.marcadas.clear();
    novo.forEach((id) => c.marcadas.add(id));
    sincronizarSelecao(raiz, c.marcadas);
    c.aoMudar();
  }));
  raiz.querySelectorAll<HTMLInputElement>('input[data-id]').forEach((i) => i.addEventListener('change', () => {
    if (i.checked) c.marcadas.add(i.dataset.id!); else c.marcadas.delete(i.dataset.id!);
    c.aoMudar();
  }));
}

export const contadorSelecao = (marcadas: Set<string>, total: number) => `${marcadas.size} de ${total} selecionadas`;
export const outrasPlanilhas = (origem: AppProj) => E.P.filter((p) => p !== origem);
