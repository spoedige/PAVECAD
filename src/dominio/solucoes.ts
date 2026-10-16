import * as catalogo from './catalogo';

/** Acesso de exibição ao catálogo de soluções. O código original nunca muda; só o rótulo e a cor. */
export const SEM_COR = catalogo.COR_NAO_MAPEADO;

export const trLabel = (k: string) => (k === '-' ? 'Sem intervenção' : catalogo.get(k).nome);
export const trShort = (k: string) => (k === '-' ? 'Sem intervenção' : catalogo.get(k).curto);
export const trColor = (k: string, field: boolean, none: string) => {
  if (k === '-' || !k) return none;
  const it = catalogo.get(k);
  return field ? it.corCampo : it.cor;
};
/** Códigos do catálogo na ordem de exibição. */
export const trOrder = () => catalogo.codigos();
