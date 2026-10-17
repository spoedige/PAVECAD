import type { ItemSelecao } from '../dominio/selecao';
import { E, type AppProj } from './estado';
import { contadorSelecao, htmlSelecao, itemDe, ligarSelecao } from './selecaoPlanilhas';
import { esc } from './ui';

export { itemDe };

export interface OpcoesSeletor {
  titulo: string;
  /** Texto acima da lista: o que será copiado. */
  descricao: string;
  /** Rótulo do botão de confirmar. */
  ok?: string;
  /** Aviso mostrado no rodapé conforme a seleção (ex.: faixas que serão ignoradas). Devolve HTML. */
  aviso?: (marcadas: AppProj[]) => string;
}

/** Seletor de planilhas com checkbox e atalhos. A origem não aparece. Resolve com as planilhas marcadas,
 *  ou null ao cancelar (Esc, fundo ou Cancelar). */
export function selecionarPlanilhas(origem: AppProj, o: OpcoesSeletor): Promise<AppProj[] | null> {
  const outras = E.P.filter((p) => p !== origem);
  const itens = outras.map(itemDe);
  return new Promise((resolve) => {
    const marcadas = new Set<string>();
    const fundo = document.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="selT" id="seletor">
      <h2 id="selT">${esc(o.titulo)}</h2>
      <p class="note" style="margin:0">${esc(o.descricao)}</p>
      ${htmlSelecao({ itens, marcadas }, 'sel-dialogo-lista', 'Não há outras planilhas abertas.')}
      <div class="sel-aviso" id="selAviso" role="status"></div>
      <div class="sel-rod"><span class="num" id="selCont"></span>
        <span class="btns"><button class="btn" type="button" data-dlg="n">Cancelar</button><button class="btn p" type="button" data-dlg="s" id="selOk" disabled>${esc(o.ok ?? 'Aplicar')}</button></span></div></div>`;
    const atualizar = () => {
      fundo.querySelector('#selCont')!.textContent = contadorSelecao(marcadas, itens.length);
      fundo.querySelector<HTMLButtonElement>('#selOk')!.disabled = marcadas.size === 0;
      fundo.querySelector('#selAviso')!.innerHTML = o.aviso ? o.aviso(outras.filter((p) => marcadas.has(p.id))) : '';
    };
    const sair = (v: AppProj[] | null) => { window.removeEventListener('keydown', tecla, true); fundo.remove(); resolve(v); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); sair(null); } };
    fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(null); });
    ligarSelecao(fundo, { itens, marcadas, origem: itemDe(origem), aoMudar: atualizar });
    fundo.querySelector('[data-dlg=n]')!.addEventListener('click', () => sair(null));
    fundo.querySelector('[data-dlg=s]')!.addEventListener('click', () => { if (marcadas.size) sair(outras.filter((p) => marcadas.has(p.id))); });
    window.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    atualizar();
    (fundo.querySelector<HTMLElement>('[data-atalho=todas]'))!.focus();
  });
}
