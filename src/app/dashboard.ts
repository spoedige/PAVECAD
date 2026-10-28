import { consolidar, resumoDoProjeto, resumoQualidade, type FatiaSolucao } from '../dominio/projetosResumo';
import { IND, IND_KEYS } from '../dominio/indicadores';
import { trColor, trShort } from '../dominio/solucoes';
import { E, corDoProjeto, getP, projName, rodoviaNome, kmFmt, type AppProj } from './estado';
import * as db from './persist';
import { abrirAlinhar } from './alinhar';
import { IC } from './icones';
import { applyVisibility, fitList, updateSelLayer } from './mapa';
import { removeProject, renderAll } from './paineis';
import { refreshPropLayers } from './revisao';
import { $, cssv, esc, fmt } from './ui';

/** Dashboard de projetos: um cartão por planilha, agrupado por rodovia, com resumo consolidado no topo. Em tela cheia no tablet e no celular,
 *  painel largo à direita no notebook. As ações de gestão das planilhas moram aqui. */
export const dashAberto = () => !$('#dash').hidden;

export function abrirDash() {
  $('#dash').hidden = false;
  $('#btnProjetos').setAttribute('aria-pressed', 'true');
  document.documentElement.classList.add('dash-aberto');
  renderDash();
  ($('#dashFechar') as HTMLElement).focus({ preventScroll: true });
}
export function fecharDash(): boolean {
  if (!dashAberto()) return false;
  $('#dash').hidden = true;
  $('#btnProjetos').setAttribute('aria-pressed', 'false');
  document.documentElement.classList.remove('dash-aberto');
  return true;
}
export const alternarDash = () => (dashAberto() ? fecharDash() : abrirDash());

const tc = (k: string) => (k === '-' ? cssv('--none') : trColor(k, E.field, cssv('--none')));
const nomeSol = (k: string) => (k === '-' ? 'Sem intervenção' : trShort(k));

/** Selo da planilha com coordenadas reconstruídas na importação (Planservi). */
export function selo(p: AppProj) {
  const n = resumoQualidade(p.qualidade).reconstruidos;
  return n ? `<b class="selo" title="Coordenadas reconstruídas pelo km na importação. A planilha original não muda. Detalhe na aba Revisão">coordenadas corrigidas: ${n}</b>` : '';
}
/** Crescente sempre primeiro, com seta e texto iguais aos do Unifilar; um preenchido e o outro só com contorno. */
export const dirBadge = (p: AppProj) => /Marginal/i.test(p.meta.via) ? '<span class="dirb m">MARG</span>' : p.meta.travel > 0 ? '<span class="dirb c" title="Sentido crescente">↑ CRESC</span>' : '<span class="dirb d" title="Sentido decrescente">↓ DECRESC</span>';
const ordemDir = (p: AppProj) => (/Marginal/i.test(p.meta.via) ? 2 : p.meta.travel > 0 ? 0 : 1);

function barra(f: FatiaSolucao[], rotulo: string) {
  return `<div class="pbar" role="img" aria-label="${esc(rotulo)}">${f.map((x) => `<i style="flex:${x.area};background:${tc(x.codigo)}" title="${esc(nomeSol(x.codigo))}: ${fmt(x.pct, 1)}%"></i>`).join('')}</div>`;
}
function legenda(f: FatiaSolucao[], max = 5) {
  const top = f.slice(0, max), resto = f.slice(max).reduce((a, b) => a + b.pct, 0);
  return `<ul class="pleg">${top.map((x) => `<li><span class="sw" style="background:${tc(x.codigo)}"></span>${esc(nomeSol(x.codigo))} <b class="num">${fmt(x.pct, x.pct < 10 ? 1 : 0)}%</b></li>`).join('')}${resto > 0.05 ? `<li class="muted">+${f.length - max} outras <b class="num">${fmt(resto, 1)}%</b></li>` : ''}</ul>`;
}

function cartao(p: AppProj): string {
  const r = resumoDoProjeto(p), q = resumoQualidade(p.qualidade);
  const props = E.props.filter((x) => x.pname === p.meta.name && !x.orfa).length, notas = E.notes.filter((n) => n.loc?.pid === p.id).length;
  const ind = IND_KEYS.filter((k) => r.medias[k] !== undefined && (k !== 'def' || p.meta.format !== 'planservi'))
    .map((k) => `<span class="pind"><span class="muted">${esc(IND[k].label.replace(' máx', ''))}</span> <b class="num">${fmt(r.medias[k]! * IND[k].scale, IND[k].dec)}</b>${IND[k].unit ? `<small class="muted"> ${IND[k].unit}</small>` : ''}</span>`).join('');
  const kmIni = p.meta.kmi === null ? null : kmFmt(p.meta.kmi), kmFim = p.meta.kmf === null ? null : kmFmt(p.meta.kmf);
  return `<article class="pcard${p.visible ? '' : ' oculta'}" data-pid="${p.id}">
    <div class="pc-h">
      <button class="iconbtn" data-eye="${p.id}" aria-pressed="${p.visible}" aria-label="${p.visible ? 'Ocultar' : 'Mostrar'} ${esc(projName(p))}" title="${p.visible ? 'Ocultar no mapa' : 'Mostrar no mapa'}">${p.visible ? IC.eye : IC.eyeoff}</button>
      <i class="pcor" style="background:${corDoProjeto(p)}" aria-hidden="true"></i>
      <button class="nm" data-fly="${p.id}"><b>${esc(projName(p))}</b><span class="num">${kmIni !== null && kmFim !== null ? `km ${esc(kmIni)} a ${esc(kmFim)} · ` : ''}${fmt(r.ext, 1)} km</span></button>
      ${dirBadge(p)}
    </div>
    <div class="pc-m num"><span><b>${fmt(r.ext, 1)}</b> km</span><span><b>${fmt(r.area / 1000, 1)}</b> mil m²</span><span><b>${p.rows.length.toLocaleString('pt-BR')}</b> segmentos de 20 m</span></div>
    ${barra(r.fatias, 'Distribuição por solução, em área')}${legenda(r.fatias)}
    ${ind ? `<div class="pc-i">${ind}</div>` : ''}
    <div class="pc-q">${selo(p)}<span class="${q.alertas ? 'alerta' : 'muted'}">${q.alertas ? `${q.alertas} alerta${q.alertas > 1 ? 's' : ''} de qualidade` : 'sem alertas de qualidade'}</span></div>
    <div class="pc-c muted"><span class="num">${props}</span> proposta${props === 1 ? '' : 's'} · <span class="num">${notas}</span> nota${notas === 1 ? '' : 's'}</div>
    <div class="pc-a"><button class="btn" data-alinhar-p="${p.id}">Alinhar</button>
      <label class="btn pc-cor" title="Cor de identificação da planilha">Cor <input type="color" data-cor="${p.id}" value="${corDoProjeto(p)}" aria-label="Cor de ${esc(projName(p))}"></label>
      <button class="btn d" data-del="${p.id}" aria-label="Remover ${esc(projName(p))}">${IC.trash} Remover</button></div>
  </article>`;
}

export function renderDash() {
  if (!dashAberto()) return;
  const el = $('#dashCorpo');
  if (!E.P.length) {
    el.innerHTML = '<div class="empty"><b>Nenhuma planilha carregada</b>Toque em "Abrir planilhas" e escolha um ou mais arquivos nos padrões RoadRunner ou Planservi.</div>';
    return;
  }
  const vias = [...new Set(E.P.map((p) => p.meta.uf))];
  const grupo = (uf: string) => {
    const todas = E.P.filter((p) => p.meta.uf === uf).sort((a, b) => ordemDir(a) - ordemDir(b)), vis = todas.filter((p) => p.visible);
    const c = consolidar(vis.length ? vis : todas);
    return `<details class="rgrp" data-uf="${esc(uf)}" ${rodoviasFechadas.has(uf) ? '' : 'open'}>
      <summary><span class="rg-n"><b>${esc(rodoviaNome(uf))}</b><span class="muted num">${todas.length} planilha${todas.length !== 1 ? 's' : ''} · ${fmt(c.ext, 1)} km · ${fmt(c.area / 1000, 0)} mil m²${vis.length < todas.length ? ` · ${vis.length} visíve${vis.length === 1 ? 'l' : 'is'}` : ''}</span></span></summary>
      <div class="rg-c">${barra(c.fatias, 'Distribuição por solução da rodovia')}${legenda(c.fatias, 6)}<div class="pcards">${todas.map(cartao).join('')}</div></div></details>`;
  };
  const tot = consolidar(E.P);
  el.innerHTML = `<div class="dash-resumo"><div class="num"><b class="h1">${fmt(tot.ext, 1)} km</b><span class="muted"> · ${fmt(tot.area / 1000, 0)} mil m² · ${tot.n} planilha${tot.n !== 1 ? 's' : ''} em ${vias.length} rodovia${vias.length !== 1 ? 's' : ''}</span></div>
    ${barra(tot.fatias, 'Distribuição por solução, todas as planilhas')}${legenda(tot.fatias, 6)}</div>${vias.map(grupo).join('')}`;
  el.querySelectorAll<HTMLDetailsElement>('details.rgrp').forEach((d) => d.addEventListener('toggle', () => { if (d.open) rodoviasFechadas.delete(d.dataset.uf!); else rodoviasFechadas.add(d.dataset.uf!); }));
  el.querySelectorAll<HTMLElement>('[data-eye]').forEach((b) => (b.onclick = () => {
    const p = getP(b.dataset.eye!)!;
    p.visible = !p.visible;
    applyVisibility(p);
    if (E.sel && !getP(E.sel.pid)?.visible) E.sel = null;
    updateSelLayer(); refreshPropLayers(); renderAll();
  }));
  el.querySelectorAll<HTMLElement>('[data-fly]').forEach((b) => (b.onclick = () => {
    const p = getP(b.dataset.fly!)!;
    p.visible = true; applyVisibility(p); E.activeGroup = p.meta.uf; fitList([p]); renderAll();
    if (matchMedia('(max-width: 1100px)').matches) fecharDash();
  }));
  el.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => (b.onclick = () => removeProject(b.dataset.del!)));
  el.querySelectorAll<HTMLElement>('[data-alinhar-p]').forEach((b) => (b.onclick = () => {
    const p = getP(b.dataset.alinharP!)!;
    E.settingsSel = new Set([p.id]); E.settingsPid = p.id;
    fecharDash();
    abrirAlinhar();
  }));
  el.querySelectorAll<HTMLInputElement>('[data-cor]').forEach((i) => i.addEventListener('change', () => {
    const p = getP(i.dataset.cor!)!;
    E.coresProj[p.meta.name] = i.value;
    db.gravar('config', { id: 'cor:' + p.meta.name, pname: p.meta.name, cor: i.value });
    renderDash();
  }));
}

/** Rodovias recolhidas (lembradas enquanto a página estiver aberta). */
const rodoviasFechadas = new Set<string>();

export function initDash() {
  $('#btnProjetos').addEventListener('click', alternarDash);
  $('#dashFechar').addEventListener('click', () => { fecharDash(); });
  $('#dashAbrir').addEventListener('click', () => $('#file').click());
  $('#subtitle').addEventListener('click', abrirDash);
}
