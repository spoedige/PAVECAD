/** Catálogo de soluções: nome, cor e categoria por código principal.
 *  Só afeta a exibição. Os dados lidos da planilha e as exportações mantêm o código original. */
export interface ItemCatalogo {
  codigo: string;
  nome: string;
  curto: string;
  cor: string;
  corCampo: string;
  categoria: string;
  /** false para código visto na planilha e ainda sem cadastro. */
  mapeado: boolean;
}

export const CATEGORIAS = ['Restauração', 'Reforço', 'Reparo', 'Fresagem', 'Revestimento fino', 'Outro'];
export const CAT_NAO_MAPEADO = 'Não mapeado';
export const COR_NAO_MAPEADO = '#8e8e93';

const item = (codigo: string, nome: string, curto: string, cor: string, corCampo: string, categoria: string): ItemCatalogo =>
  ({ codigo, nome, curto, cor, corCampo, categoria, mapeado: true });

/** Catálogo inicial do padrão RoadRunner. */
export const CATALOGO_PADRAO: ItemCatalogo[] = [
  item('FS3', 'Fresagem funcional 3 cm', 'Fres. funcional 3', '#5ac8fa', '#4a88ed', 'Fresagem'),
  item('FS4', 'Fresagem funcional 4 cm', 'Fres. funcional 4', '#0a84ff', '#011e74', 'Fresagem'),
  item('FSE', 'Fresagem estrutural', 'Fres. estrutural', '#8428b4', '#7b2fbe', 'Restauração'),
  item('MFS', 'Microfresagem', 'Microfresagem', '#0f7d8f', '#00788f', 'Fresagem'),
  item('RP', 'Reparo profundo', 'Reparo prof.', '#e42e08', '#d0021b', 'Reparo'),
  item('REC', 'Reconstrução', 'Reconstrução', '#a2231d', '#6b0f0a', 'Restauração'),
  item('Micro', 'Microrrevestimento', 'Micro', '#ffcc00', '#e6a800', 'Revestimento fino'),
  item('GAP', 'Gap graded', 'Gap graded', '#ff9500', '#ff6a00', 'Reforço'),
  // Planservi. Onde há equivalente no RoadRunner, a cor é a mesma: RE como Reconstrução, RP já existe, MF como Microfresagem,
  // FXRX funcional (F4R4, F8R8) como Fres. funcional 4 e FXRX estrutural (F4R8, F4R10) como Fres. estrutural.
  item('RE', 'Reconstrução', 'Reconstrução', '#a2231d', '#6b0f0a', 'Restauração'),
  item('F4R8', 'Fresagem de 4 cm e recomposição de 8 cm', 'Fres. e recomp. estrutural', '#8428b4', '#7b2fbe', 'Restauração'),
  item('F4R10', 'Fresagem de 4 cm e recomposição de 10 cm', 'Fres. e recomp. estrutural', '#8428b4', '#7b2fbe', 'Restauração'),
  item('F4R4', 'Fresagem de 4 cm e recomposição de 4 cm', 'Fres. funcional', '#0a84ff', '#011e74', 'Fresagem'),
  item('F8R8', 'Fresagem de 8 cm e recomposição de 8 cm', 'Fres. funcional', '#0a84ff', '#011e74', 'Fresagem'),
  item('MF', 'Microfresagem', 'Microfresagem', '#0f7d8f', '#00788f', 'Fresagem'),
  // Entradas novas, com cores que não existiam no catálogo.
  item('ST', 'Selagem de trincas', 'Selagem de trincas', '#a2845e', '#6f5a40', 'Reparo'),
  item('REF', 'Reforço (R e PMQ)', 'Reforço', '#8bc34a', '#4e7a1d', 'Reforço'),
  item('VP', 'Ver projeto à parte', 'Ver projeto à parte', '#ff7a9a', '#ad5369', 'Outro'),
];

const copia = (l: ItemCatalogo[]) => l.map((x) => ({ ...x }));
let ativo = new Map<string, ItemCatalogo>(copia(CATALOGO_PADRAO).map((x) => [x.codigo, x]));
let ordem: string[] = CATALOGO_PADRAO.map((x) => x.codigo);

const hex = /^#[0-9a-f]{6}$/i;

/** Versão escura da cor, para o modo campo (contraste alto ao sol). */
export function escurecer(cor: string, f = 0.68): string {
  if (!hex.test(cor)) return cor;
  const c = [1, 3, 5].map((i) => Math.round(parseInt(cor.slice(i, i + 2), 16) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function get(codigo: string): ItemCatalogo {
  return ativo.get(codigo) ?? { codigo, nome: codigo, curto: codigo, cor: COR_NAO_MAPEADO, corCampo: escurecer(COR_NAO_MAPEADO), categoria: CAT_NAO_MAPEADO, mapeado: false };
}

export const conhecido = (codigo: string) => ativo.has(codigo);

/** Todos os itens, na ordem do catálogo (padrão primeiro, depois o que foi sendo cadastrado ou visto). */
export const todos = (): ItemCatalogo[] => ordem.map((c) => ativo.get(c)!).filter(Boolean);
export const codigos = (): string[] => [...ordem];
export const naoMapeados = (): ItemCatalogo[] => todos().filter((x) => !x.mapeado);

/** Edita (ou cria) um item. Editar um código "Não mapeado" o torna mapeado. */
export function definir(parcial: Partial<ItemCatalogo> & { codigo: string }): ItemCatalogo {
  const atual = get(parcial.codigo);
  const novo: ItemCatalogo = { ...atual, ...parcial, mapeado: true };
  novo.nome = novo.nome.trim() || novo.codigo;
  novo.curto = novo.curto.trim() || novo.nome;
  if (!hex.test(novo.cor)) novo.cor = atual.cor;
  if (parcial.cor && !parcial.corCampo) novo.corCampo = escurecer(novo.cor);
  if (novo.categoria === CAT_NAO_MAPEADO) novo.categoria = 'Outro';
  if (!ativo.has(novo.codigo)) ordem.push(novo.codigo);
  ativo.set(novo.codigo, novo);
  return novo;
}

/** Registra códigos vistos nas planilhas. Os desconhecidos entram como "Não mapeado". Devolve os novos. */
export function registrar(codigosVistos: Iterable<string>): string[] {
  const novos: string[] = [];
  for (const c of codigosVistos) {
    if (!c || c === '-' || ativo.has(c)) continue;
    ativo.set(c, { ...get(c) });
    ordem.push(c);
    novos.push(c);
  }
  return novos;
}

export function restaurarPadrao(manterNaoMapeados = true) {
  const extras = manterNaoMapeados ? todos().filter((x) => !conhecidoPadrao(x.codigo)).map((x) => x.codigo) : [];
  ativo = new Map(copia(CATALOGO_PADRAO).map((x) => [x.codigo, x]));
  ordem = CATALOGO_PADRAO.map((x) => x.codigo);
  registrar(extras);
}
const conhecidoPadrao = (c: string) => CATALOGO_PADRAO.some((x) => x.codigo === c);
export const ehPadrao = conhecidoPadrao;

/** Volta um item do padrão ao que veio de fábrica. */
export function restaurarItem(codigo: string) {
  const p = CATALOGO_PADRAO.find((x) => x.codigo === codigo);
  if (p) ativo.set(codigo, { ...p });
}

export interface CatalogoJson {
  versao: 1;
  tipo: 'catalogo-solucoes';
  itens: Pick<ItemCatalogo, 'codigo' | 'nome' | 'curto' | 'cor' | 'corCampo' | 'categoria'>[];
}

/** Só os itens cadastrados (mapeados). Os "Não mapeado" ficam de fora: voltam sozinhos ao ler a planilha. */
export function exportar(): CatalogoJson {
  return {
    versao: 1,
    tipo: 'catalogo-solucoes',
    itens: todos().filter((x) => x.mapeado).map(({ codigo, nome, curto, cor, corCampo, categoria }) => ({ codigo, nome, curto, cor, corCampo, categoria })),
  };
}

/** Carrega itens de um JSON exportado. Devolve quantos entraram. Lança erro se o arquivo não for um catálogo. */
export function importar(j: unknown): number {
  const o = j as Partial<CatalogoJson> | null;
  if (!o || o.tipo !== 'catalogo-solucoes' || !Array.isArray(o.itens)) throw new Error('Arquivo não é um catálogo de soluções.');
  let n = 0;
  for (const it of o.itens) {
    if (!it || typeof it.codigo !== 'string' || !it.codigo.trim() || typeof it.nome !== 'string') continue;
    definir({
      codigo: it.codigo.trim(), nome: it.nome, curto: typeof it.curto === 'string' ? it.curto : it.nome,
      cor: typeof it.cor === 'string' ? it.cor : COR_NAO_MAPEADO, corCampo: typeof it.corCampo === 'string' ? it.corCampo : undefined,
      categoria: typeof it.categoria === 'string' && it.categoria ? it.categoria : 'Outro',
    });
    n++;
  }
  return n;
}
