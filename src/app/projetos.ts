import * as catalogo from '../dominio/catalogo';
import { getLimites, setLimites, type Limites } from '../dominio/indicadores';
import { aplicarLarguras, type AjusteLargura } from '../dominio/larguras';
import type { ParsedProject } from '../formats/types';
import { carregarLido, carregarPlanilha, recalcular } from '../mapa/cliente';
import { aplicarGeometria, baseOf, criarProjeto, E, H, novoId, type AppProj } from './estado';
import { addProjectToMap, applyPaint, clearFocus, fitList, removeProjectFromMap, setProjectData, updateSelLayer } from './mapa';
import * as db from './persist';
import { renderAll } from './paineis';
import { refreshPropLayers, resolveProps } from './revisao';
import { toast } from './ui';

type Resp = Awaited<ReturnType<typeof carregarPlanilha>>;

/* ---------------------------------------------------------------- */
/* Configuração salva no aparelho                                    */
/* ---------------------------------------------------------------- */
interface RegistroConfig { id: string; [k: string]: unknown }

export async function carregarConfig() {
  const itens = await db.todos<RegistroConfig>('config');
  for (const it of itens) {
    try {
      if (it.id === 'catalogo') catalogo.importar(it.json);
      else if (it.id === 'limiares') setLimites(it.limites as Limites);
      else if (it.id.startsWith('larguras:')) E.ajustesSalvos[it.pname as string] = it.ajustes as AjusteLargura[];
    } catch { /* registro inválido: ignora */ }
  }
}

export const salvarCatalogo = () => db.gravar('config', { id: 'catalogo', json: catalogo.exportar() });
export const salvarLimiares = () => db.gravar('config', { id: 'limiares', limites: getLimites() });
export function salvarAjustes(pname: string, ajustes: AjusteLargura[]) {
  E.ajustesSalvos[pname] = ajustes;
  db.gravar('config', { id: 'larguras:' + pname, pname, ajustes });
}

/* ---------------------------------------------------------------- */
/* Projetos                                                          */
/* ---------------------------------------------------------------- */
function addProject(p: AppProj) {
  const old = E.P.find((x) => x.meta.name === p.meta.name);
  if (old) { if (E.mapReady) removeProjectFromMap(old); E.P = E.P.filter((x) => x !== old); }
  E.P.push(p);
  if (E.mapReady) addProjectToMap(p);
}

/** Guarda a planilha (como veio, sem ajustes) para reabrir sem o arquivo, inclusive offline. */
export function salvarProjeto(p: AppProj) {
  const { meta, log, codes } = p;
  db.gravar('projetos', { id: meta.name, parsed: { meta, rows: p.rowsPlanilha, log, codes }, zone: p.crs.source === 'fixo' ? p.crs.zone : undefined, t: new Date().toISOString() });
}
export const esquecerProjeto = (nome: string) => db.apagar('projetos', nome);

export async function regeometrar(p: AppProj, aviso = true) {
  try {
    if (aviso) toast('Recalculando a geometria...', 20000);
    const r = await recalcular(p.id, baseOf(p), p.opts);
    aplicarGeometria(p, r);
    if (E.focus) clearFocus();
    setProjectData(p);
    applyPaint();
    updateSelLayer();
    refreshPropLayers();
    if (aviso) { renderAll(); toast('Geometria atualizada'); }
  } catch (e) { toast('Falha ao recalcular: ' + (e as Error).message, 5000); }
}

/** Aplica ajustes de largura: recalcula rows, geometria e áreas. As quantidades da planilha original não mudam. */
export async function aplicarAjustes(p: AppProj, ajustes: AjusteLargura[]) {
  p.ajustes = ajustes;
  salvarAjustes(p.meta.name, ajustes);
  p.rows = aplicarLarguras(p.rowsPlanilha, p.kmNum, ajustes);
  await regeometrar(p);
}

/** Reclassifica as feições de todas as planilhas (limiares novos). */
export async function reclassificarTodos() {
  toast('Reclassificando...', 20000);
  for (const p of E.P) await regeometrar(p, false);
  applyPaint();
  renderAll();
  toast('Limiares aplicados');
}

/** Passos comuns a toda planilha que entra: catálogo, ajustes de largura salvos, propostas. */
async function finalizar(p: AppProj): Promise<void> {
  const novos = catalogo.registrar(Object.keys(p.codes));
  if (novos.length) {
    toast(`${novos.length} código${novos.length > 1 ? 's' : ''} de solução sem cadastro: ${novos.join(', ')}. Veja em Configurações`, 6000);
    H.onCatalogo();
  }
  const aj = E.ajustesSalvos[p.meta.name];
  if (aj?.length) {
    p.ajustes = aj;
    p.rows = aplicarLarguras(p.rowsPlanilha, p.kmNum, aj);
    const r = await recalcular(p.id, baseOf(p), p.opts);
    aplicarGeometria(p, r);
  }
}

async function incluir(carregar: (id: string) => Promise<Resp>, rotulo: string, salvar: boolean): Promise<AppProj | null> {
  try {
    const id = novoId();
    const r = await carregar(id);
    const p = criarProjeto(id, r.projeto, { opts: r.opts, normals: r.normals, camadas: r.camadas });
    for (const l of p.log) console.info(`[${p.meta.name}] ${l.level}: ${l.msg}`);
    await finalizar(p);
    addProject(p);
    if (salvar) salvarProjeto(p);
    const avisos = p.log.filter((l) => l.level === 'warn').length;
    if (avisos) toast(`${rotulo}: ${avisos} aviso(s) de importação. Veja em Ajustes`, 5000);
    return p;
  } catch (err) {
    toast(`${rotulo}: ${(err as Error).message}`, 6000);
    return null;
  }
}

function terminar(novos: AppProj[], enquadrar = true) {
  if (!novos.length) return;
  E.settingsPid ??= novos[0].id;
  E.activeGroup ??= novos[0].meta.uf;
  resolveProps();
  refreshPropLayers();
  renderAll();
  if (enquadrar) fitList(novos);
}

export async function abrirArquivos(files: File[]) {
  const novos: AppProj[] = [];
  for (const f of files) {
    toast(`Lendo ${f.name}... arquivos grandes podem levar alguns segundos`, 60000);
    const buf = await f.arrayBuffer();
    const p = await incluir((id) => carregarPlanilha(id, buf), f.name, true);
    if (p) novos.push(p);
  }
  terminar(novos);
  if (novos.length) toast(`${novos.length} planilha(s) carregada(s)`);
}

/** Planilhas já lidas (JSON). Em desenvolvimento, para os exemplos; também na restauração. */
export async function abrirLidas(lista: { parsed: ParsedProject; zone?: number; rotulo: string }[], salvar: boolean, enquadrar = true) {
  const novos: AppProj[] = [];
  for (const it of lista) {
    const p = await incluir((id) => carregarLido(id, it.parsed, it.zone), it.rotulo, salvar);
    if (p) novos.push(p);
  }
  terminar(novos, enquadrar);
  return novos;
}

/** Reabre as planilhas guardadas no aparelho. Não precisa do arquivo nem de rede. */
export async function restaurarProjetos(): Promise<number> {
  const itens = await db.todos<{ id: string; parsed: ParsedProject; zone?: number }>('projetos');
  if (!itens.length) return 0;
  const novos = await abrirLidas(itens.map((i) => ({ parsed: i.parsed, zone: i.zone, rotulo: i.id })), false, false);
  if (novos.length) { E.activeGroup = novos[0].meta.uf; fitList(novos, true); }
  return novos.length;
}

export function removerProjeto(p: AppProj, esquecer: boolean) {
  removeProjectFromMap(p);
  E.P = E.P.filter((x) => x !== p);
  if (esquecer) esquecerProjeto(p.meta.name);
}
