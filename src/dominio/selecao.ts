/** O que o seletor de planilhas precisa saber de cada planilha. */
export interface ItemSelecao {
  id: string;
  nome: string;
  rodovia: string;
  /** +1 crescente, -1 decrescente. */
  sentido: 1 | -1;
}

export type Atalho = 'todas' | 'nenhuma' | 'crescentes' | 'decrescentes' | 'rodovia';

export const ROTULO_ATALHO: Record<Atalho, string> = {
  todas: 'Todas', nenhuma: 'Nenhuma', crescentes: 'Só crescentes', decrescentes: 'Só decrescentes', rodovia: 'Mesma rodovia que a atual',
};

/** Ids marcados por um atalho. A origem nunca entra: ela não aparece na lista. */
export function marcadosPor(atalho: Atalho, lista: ItemSelecao[], origem: Pick<ItemSelecao, 'rodovia'>): Set<string> {
  const ok = (i: ItemSelecao) =>
    atalho === 'todas' ? true : atalho === 'nenhuma' ? false : atalho === 'crescentes' ? i.sentido === 1 : atalho === 'decrescentes' ? i.sentido === -1 : i.rodovia === origem.rodovia;
  return new Set(lista.filter(ok).map((i) => i.id));
}
