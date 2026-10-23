/** Backup completo do PAVECAD: planilhas, notas, propostas, catálogo e limiares, num único JSON para restaurar em qualquer aparelho. */

export const TIPO_BACKUP = 'pavecad-backup';
export const VERSAO_BACKUP = 2;

export interface Backup {
  tipo: typeof TIPO_BACKUP;
  versao: number;
  criado: string;
  notas: { id: string }[];
  propostas: { id: string }[];
  catalogo: unknown;
  limiares: unknown;
  planilhas: { id: string; parsed: unknown; zone?: number }[];
}

export interface PartesBackup {
  notas: { id: string }[];
  propostas: { id: string; pid?: unknown; orfa?: unknown; r0?: unknown; r1?: unknown }[];
  catalogo: unknown;
  limiares: unknown;
  planilhas: { id: string; parsed: unknown; zone?: number }[];
}

export function montarBackup(p: PartesBackup, agora: Date = new Date()): Backup {
  return {
    tipo: TIPO_BACKUP, versao: VERSAO_BACKUP, criado: agora.toISOString(),
    notas: p.notas,
    // pid, órfã e índices de linha são derivados ao abrir a planilha: não vão no arquivo
    propostas: p.propostas.map(({ pid: _a, orfa: _b, r0: _c, r1: _d, ...resto }) => { void _a; void _b; void _c; void _d; return resto; }),
    catalogo: p.catalogo, limiares: p.limiares,
    planilhas: p.planilhas.map(({ id, parsed, zone }) => ({ id, parsed, ...(zone === undefined ? {} : { zone }) })),
  };
}

/** Reconhece e valida um backup completo. Devolve null quando o JSON não é um backup (por exemplo, o GeoJSON de notas das versões antigas). */
export function lerBackup(j: unknown): Backup | null {
  const o = j as Partial<Backup> | null;
  if (!o || o.tipo !== TIPO_BACKUP || typeof o.versao !== 'number' || o.versao > VERSAO_BACKUP) return null;
  const lista = <T extends { id: string }>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x.id === 'string') : []);
  return {
    tipo: TIPO_BACKUP, versao: o.versao, criado: String(o.criado ?? ''),
    notas: lista(o.notas), propostas: lista(o.propostas), catalogo: o.catalogo ?? null, limiares: o.limiares ?? null,
    planilhas: lista<Backup['planilhas'][number]>(o.planilhas).filter((x) => x.parsed && typeof x.parsed === 'object'),
  };
}

/** Itens do backup que ainda não existem aqui (por id) e os que já existiam. Quem já existe fica como está. */
export function novosPorId<T extends { id: string }>(atuais: T[], doBackup: T[]): { novos: T[]; repetidos: number } {
  const tem = new Set(atuais.map((x) => x.id));
  const novos = doBackup.filter((x) => !tem.has(x.id));
  return { novos, repetidos: doBackup.length - novos.length };
}

export const nomeArquivoBackup = (d: Date = new Date()): string => {
  const z = (v: number) => String(v).padStart(2, '0');
  return `pavecad-backup-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.json`;
};
