import type { ProjectMeta } from '../formats/types';

/** "BR-050 · MG". Com mais de um estado, "BR-050 · GO, MG". Com mais de uma rodovia, separadas por " + ". */
export function tituloDe(lista: { meta: Pick<ProjectMeta, 'uf'> }[]): string {
  if (!lista.length) return 'PaveCAD';
  const por = new Map<string, Set<string>>();
  for (const p of lista) {
    const [via, uf] = p.meta.uf.split('/');
    if (!por.has(via)) por.set(via, new Set());
    if (uf) por.get(via)!.add(uf);
  }
  return [...por].map(([via, ufs]) => (ufs.size ? `${via} · ${[...ufs].sort().join(', ')}` : via)).join(' + ');
}

