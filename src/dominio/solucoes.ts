/** Catálogo padrão de soluções, por código principal. Cores: normal (c) e modo campo (f).
 *  A tela de configurações vai permitir editar nome, cor e categoria sem alterar o código original. */
export interface SolucaoDef {
  c: string;
  f: string;
  l: string;
}

export const TR: Record<string, SolucaoDef> = {
  FS3: { c: '#5ac8fa', f: '#1f6fd0', l: 'Fresagem funcional 3 cm' },
  FS4: { c: '#0a84ff', f: '#0033b3', l: 'Fresagem funcional 4 cm' },
  FSE: { c: '#af52de', f: '#7b2fbe', l: 'Fresagem estrutural' },
  MFS: { c: '#30b0c7', f: '#00788f', l: 'Microfresagem' },
  RP: { c: '#ff3b30', f: '#d0021b', l: 'Reparo profundo' },
  REC: { c: '#a2231d', f: '#6b0f0a', l: 'Reconstrução' },
  Micro: { c: '#ffcc00', f: '#e6a800', l: 'Microrrevestimento' },
  GAP: { c: '#ff9500', f: '#ff6a00', l: 'Gap graded' },
};
export const TR_ORDER = ['FS3', 'FS4', 'FSE', 'MFS', 'RP', 'REC', 'Micro', 'GAP'];
export const SEM_COR = '#8e8e93';

export const trLabel = (k: string) => (k === '-' ? 'Sem intervenção' : TR[k]?.l ?? k);
export const trColor = (k: string, field: boolean, none: string) => (k === '-' || !k ? none : TR[k] ? (field ? TR[k].f : TR[k].c) : SEM_COR);
