import * as catalogo from '../dominio/catalogo';
import { getLimites, setLimites, type Limites } from '../dominio/indicadores';
import { aplicarLarguras, type AjusteLargura } from '../dominio/larguras';
import { deslocarLongitudinal, deslocZerado, type Desloc } from '../geometry/deslocamento';
import { fromUtm } from '../geometry/utm';
import type { ParsedProject } from '../formats/types';
import { carregarLido, lerPlanilha, recalcular } from '../mapa/cliente';
import { aplicarGeometria, atualizarRotulosKm, baseOf, criarProjeto, E, H, novoId, type AppProj } from './estado';
import { addProjectToMap, applyPaint, clearFocus, fitList, removeProjectFromMap, setProjectData, updateSelLayer, updateStakes } from './mapa';
import * as db from './persist';
import { renderAll } from './paineis';
import { refreshProp, refreshPropLayers, resolveProps } from './revisao';
import { toast } from './ui';

type Resp = Awaited<ReturnType<typeof carregarLido>>;

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
      else if (it.id.startsWith('cor:')) E.coresProj[it.pname as string] = String(it.cor);
      else if (it.id.startsWith('desde:')) E.conservaDesde[it.pname as string] = String(it.data ?? '');
      else if (it.id.startsWith('desloc:')) E.deslocSalvos[it.pname as string] = { l: +(it.l as number) || 0, t: +(it.t as number) || 0 };
    } catch { /* registro inválido: ignora */ }
  }
}

export const salvarCatalogo = () => db.gravar('config', { id: 'catalogo', json: catalogo.exportar() });
export const salvarLimiares = () => db.gravar('config', { id: 'limiares', limites: getLimites() });
export function salvarAjustes(pname: string, ajustes: AjusteLargura[]) {
  E.ajustesSalvos[pname] = ajustes;
  db.gravar('config', { id: 'larguras:' + pname, pname, ajustes });
}

export function salvarDesloc(p: AppProj) {
  const { l, t } = p.desloc;
  E.deslocSalvos[p.meta.name] = { l, t };
  db.gravar('config', { id: 'desloc:' + p.meta.name, pname: p.meta.name, l, t });
}

/* ---------------------------------------------------------------- */
/* Projetos                                                          */
/* ---------------------------------------------------------------- */
function addProject(p: AppProj) {
  const old = E.P.find((x) => x.meta.name === p.meta.name);
  if (old) { if (E.mapReady) removeProjectFromMap(old); E.P = E.P.filter((x) => x !== old); }
  E.P.push(p);
  atualizarRotulosKm();
  if (E.mapReady) addProjectToMap(p);
}

/** Guarda a planilha (como veio, sem ajustes) para reabrir sem o arquivo, inclusive offline. */
export function salvarProjeto(p: AppProj) {
  const { meta, log, codes, qualidade } = p;
  db.gravar('projetos', { id: meta.name, parsed: { meta, rows: p.rowsPlanilha, log, codes, qualidade }, zone: p.crs.source === 'fixo' ? p.crs.zone : undefined, t: new Date().toISOString() });
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

/** Linhas efetivas: larguras ajustadas e deslocamento longitudinal. A planilha original não é tocada:
 *  as linhas deslocadas são cópias, e `x0`/`y0` guardam o eixo de partida. */
export function atualizarLinhas(p: AppProj) {
  const base = aplicarLarguras(p.rowsPlanilha, p.kmNum, p.ajustes);
  const { l, t } = p.desloc;
  p.opts.extra = Math.abs(t);
  p.opts.extraSide = t < 0 ? -1 : 1;
  const { x, y } = deslocarLongitudinal(p.x0, p.y0, p.segs, p.opts.win, p.meta.travel, l);
  p.x = x; p.y = y;
  p.rows = l === 0 ? base : base.map((r, i) => {
    if (x[i] === p.x0[i] && y[i] === p.y0[i]) return r;
    const [lat, lon] = fromUtm(p.crs, x[i], y[i]);
    return { ...r, lat: +lat.toFixed(7), lon: +lon.toFixed(7) };
  });
}

/** Aplica ajustes de largura: recalcula rows, geometria e áreas. As quantidades da planilha original não mudam. */
export async function aplicarAjustes(p: AppProj, ajustes: AjusteLargura[]) {
  p.ajustes = ajustes;
  salvarAjustes(p.meta.name, ajustes);
  atualizarLinhas(p);
  await regeometrar(p);
}

/** Desloca a planilha inteira (metros) e refaz a geometria na hora. Vale também para o CSV de propostas e
 *  para o georreferenciamento por GPS, que leem a mesma geometria. */
export async function aplicarDesloc(p: AppProj, d: Desloc, salvar = true) {
  p.desloc = { l: d.l, t: d.t };
  atualizarLinhas(p);
  await regeometrar(p, false);
  updateStakes();
  if (salvar) salvarDesloc(p);
  renderAll();
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
  const aj = E.ajustesSalvos[p.meta.name], ds = E.deslocSalvos[p.meta.name];
  if (ds && !deslocZerado(ds)) p.desloc = { ...ds };
  if (aj?.length || !deslocZerado(p.desloc)) {
    p.ajustes = aj ?? [];
    atualizarLinhas(p);
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
  if (!E.settingsSel.size) E.settingsSel = new Set([novos[0].id]);
  E.activeGroup ??= novos[0].meta.uf;
  resolveProps();
  refreshProp();
  refreshPropLayers();
  renderAll();
  if (enquadrar) fitList(novos);
}

export async function abrirArquivos(files: File[]) {
  const novos: AppProj[] = [];
  for (const [n, f] of files.entries()) {
    const nome = E.privacidade ? `arquivo ${n + 1}` : f.name; // no modo privacidade o nome do arquivo não aparece
    toast(`Lendo ${nome}... arquivos grandes podem levar alguns segundos`, 60000);
    const buf = await f.arrayBuffer();
    let lista: ParsedProject[];
    try { lista = await lerPlanilha(buf); } catch (err) { toast(`${nome}: ${(err as Error).message}`, 6000); continue; }
    // um arquivo pode gerar mais de um projeto (Planservi: Crescente e Decrescente)
    for (const parsed of lista) {
      const p = await incluir((id) => carregarLido(id, parsed), lista.length > 1 && !E.privacidade ? `${nome} (${parsed.meta.name})` : nome, true);
      if (p) novos.push(p);
    }
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
  atualizarRotulosKm();
  if (esquecer) esquecerProjeto(p.meta.name);
}
