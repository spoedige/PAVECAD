import { marcadosPor, ROTULO_ATALHO, type Atalho, type ItemSelecao } from '../dominio/selecao';
import { E, projName, rodoviaNome, type AppProj } from './estado';
import { esc } from './ui';

export interface OpcoesSeletor {
  titulo: string;
  /** Texto acima da lista: o que será copiado. */
  descricao: string;
  /** Rótulo do botão de confirmar. */
  ok?: string;
  /** Aviso mostrado no rodapé conforme a seleção (ex.: faixas que serão ignoradas). Devolve HTML. */
  aviso?: (marcadas: AppProj[]) => string;
}

export const itemDe = (p: AppProj): ItemSelecao => ({ id: p.id, nome: projName(p), rodovia: rodoviaNome(p.meta.uf), sentido: p.meta.travel });

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
      <div class="sel-atalhos" role="group" aria-label="Atalhos de seleção">${(Object.keys(ROTULO_ATALHO) as Atalho[]).map((a) => `<button type="button" class="btn" data-atalho="${a}">${ROTULO_ATALHO[a]}</button>`).join('')}</div>
      <div class="sel-lista" role="group" aria-label="Planilhas">${itens.length ? itens.map((i) => `<label class="sel-item"><input type="checkbox" data-id="${esc(i.id)}"><span><b>${esc(i.nome)}</b><span class="note">${esc(i.rodovia)} · ${i.sentido === 1 ? 'Crescente' : 'Decrescente'}</span></span></label>`).join('') : '<p class="note" style="padding:10px;margin:0">Não há outras planilhas abertas.</p>'}</div>
      <div class="sel-aviso" id="selAviso" role="status"></div>
      <div class="sel-rod"><span class="num" id="selCont"></span>
        <span class="btns"><button class="btn" type="button" data-dlg="n">Cancelar</button><button class="btn p" type="button" data-dlg="s" id="selOk" disabled>${esc(o.ok ?? 'Aplicar')}</button></span></div></div>`;
    const caixas = [...fundo.querySelectorAll<HTMLInputElement>('input[data-id]')];
    const atualizar = () => {
      caixas.forEach((c) => { c.checked = marcadas.has(c.dataset.id!); });
      fundo.querySelector('#selCont')!.textContent = `${marcadas.size} de ${itens.length} selecionadas`;
      fundo.querySelector<HTMLButtonElement>('#selOk')!.disabled = marcadas.size === 0;
      fundo.querySelector('#selAviso')!.innerHTML = o.aviso ? o.aviso(outras.filter((p) => marcadas.has(p.id))) : '';
    };
    const sair = (v: AppProj[] | null) => { window.removeEventListener('keydown', tecla, true); fundo.remove(); resolve(v); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); sair(null); } };
    fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(null); });
    fundo.querySelectorAll<HTMLElement>('[data-atalho]').forEach((b) => b.addEventListener('click', () => {
      marcadas.clear();
      marcadosPor(b.dataset.atalho as Atalho, itens, itemDe(origem)).forEach((id) => marcadas.add(id));
      atualizar();
    }));
    caixas.forEach((c) => c.addEventListener('change', () => { if (c.checked) marcadas.add(c.dataset.id!); else marcadas.delete(c.dataset.id!); atualizar(); }));
    fundo.querySelector('[data-dlg=n]')!.addEventListener('click', () => sair(null));
    fundo.querySelector('[data-dlg=s]')!.addEventListener('click', () => { if (marcadas.size) sair(outras.filter((p) => marcadas.has(p.id))); });
    window.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    atualizar();
    (fundo.querySelector<HTMLElement>('[data-atalho=todas]'))!.focus();
  });
}
