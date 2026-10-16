/** Só em desenvolvimento: lê os JSON de referencia/dados (padrão RoadRunner já extraído). */
import type { ParsedProject } from '../formats/types';
import { fromLegacy } from '../formats/legacy';

const arquivos = import.meta.glob('/referencia/dados/*.json', { import: 'default' }) as Record<string, () => Promise<{ meta: ParsedProject['meta']; rows: unknown[][] }>>;

export const nomesExemplo = () => Object.keys(arquivos).map((k) => k.split('/').pop()!.replace('.json', ''));

export async function lerExemplo(nome: string): Promise<ParsedProject> {
  const d = await arquivos[`/referencia/dados/${nome}.json`]();
  return { meta: { ...d.meta, format: 'roadrunner' }, rows: d.rows.map(fromLegacy), log: [{ level: 'info', code: 'exemplo', msg: 'Dados de exemplo (referencia/dados)' }], codes: {} };
}
