import { criticos, matriz, resumo, violacoes, REGRAS } from '../dominio/analise';
import { DESCRICAO_MODO, IND, indicadoresComDados, MODE_KEYS, Q5, Q5F, type IndKey, type ModeKey } from '../dominio/indicadores';
import { descreverCamada } from '../formats/planservi';
import { trColor, trLabel, trOrder } from '../dominio/solucoes';
import { edgesOf } from '../geometry/build';
import { tituloDe } from '../dominio/titulo';
import { atualizarRotulosKm, E, getP, kmVis, padraoAtivo, projName, rodoviaNome, visibleProjects, type AppProj } from './estado';
import { abrirLidas, regeometrar, removerProjeto } from './projetos';
import { renderDash, selo } from './dashboard';
import { CHAVE_PRESSAO, PRESSAO_OPCOES, confirmarAntes, definirConfirmarAntes, pressaoMs } from './notaRapida';
import { ROTULO_CAMADA, atualizarChipCamada, guardarCamada } from './camadas';
import { renderExp } from './exportar';
import { aoSairDeAlinhar, renderAlinhar } from './alinhar';
import { contadorSelecao, htmlSelecao, itemDe, ligarSelecao } from './selecaoPlanilhas';
import { IC } from './icones';
import { applyLayers, applyPaint, clearFocus, clearSel, fitAll, fitFocus, fitList, getMap, renderLegend, select, setBase, setFocus, setProjectData, stepSel, updateSelLayer, updateStakes, applyVisibility, temMapTiler } from './mapa';
import { drawUni, renderGroups } from './unifilar';
import { refreshProp, refreshPropLayers, renderNotes, resolveProps, startNote } from './revisao';
import { renderDiagnostico } from './diagnostico';
import { $, cssv, esc, fmt, syncAllSegs, syncSeg, toast, toastAcao } from './ui';

const Q = () => (E.field ? Q5F : Q5);
const tc = (k: string) => trColor(k, E.field, cssv('--none'));
const TREAT_LABELS = ['Estrutural', 'Fresagem funcional', 'Fresagem estrutural', 'Selagem', 'Microfresagem', 'Fresagem fina', 'Revestimento'];
const flyTo = (p: AppProj, i: number, zoom = 17.2) => { const r = p.rows[i]; getMap().flyTo({ center: [r.lon, r.lat], zoom: Math.max(getMap().getZoom(), zoom), duration: 800 }); };

/* ---------------------------------------------------------------- */
/* Abas                                                              */
/* ---------------------------------------------------------------- */
export function setTab(t: typeof E.tab) {
  if (E.tab === 'aj' && t !== 'aj') aoSairDeAlinhar(); // o que o Alinhar não aplicou volta ao valor gravado
  E.tab = t;
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  for (const x of ['seg', 'ana', 'notas', 'exp', 'aj']) $(`#t-${x}`).hidden = x !== t;
  syncSeg($('#tabs'));
  if (t === 'ana') renderAna();
  if (t === 'notas') renderNotes();
  if (t === 'exp') renderExp();
  syncAllSegs();
}

/** Modos de cor com dado nas planilhas visíveis. Sem planilhas, os seis do RoadRunner. D0, Rc e Defeitos somem no Planservi; IGG e FC somem no RoadRunner. */
export function modosVisiveis(): ModeKey[] {
  const V = visibleProjects();
  if (!V.length) return ['sol', 'iri', 'atr', 'd0', 'rc', 'def'];
  const com = new Set<string>(indicadoresComDados(V));
  return MODE_KEYS.filter((k) => k === 'sol' || com.has(k));
}

export function renderModes() {
  const vis = modosVisiveis();
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => {
    const k = b.dataset.m as ModeKey, i = vis.indexOf(k), sem = i < 0 && E.P.length > 0;
    b.disabled = sem;
    b.innerHTML = `<span>${ROTULO_CAMADA[k]}</span>${sem ? '<small>sem dado</small>' : k === E.mode ? '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}`;
    b.title = sem ? 'Sem dado nas planilhas carregadas' : `${DESCRICAO_MODO[k]}${i >= 0 ? `. Atalho: ${i + 1}` : ''}`;
    b.setAttribute('aria-selected', String(k === E.mode));
  });
  if (E.P.length && !vis.includes(E.mode)) setMode('sol', true);
  atualizarChipCamada();
}

export function renderViews() {
  document.documentElement.classList.toggle('vazio', !E.P.length);
  const v = visibleProjects();
  const t = tituloDe((v.length ? v : E.P).map((q) => ({ meta: { uf: rodoviaNome(q.meta.uf) } }))), n = E.P.length;
  $('#title').textContent = t;
  $('#titlebox').title = t;
  $('#subtitle').textContent = !n ? 'Nenhuma planilha' : `${n} planilha${n > 1 ? 's' : ''}${v.length < n ? ` · ${v.length} ${v.length > 1 ? 'visíveis' : 'visível'}` : ''}`;
}

export function renderAll() {
  updateStakes();
  renderModes();
  renderViews();
  renderLegend();
  renderDash();
  renderSeg();
  renderAna();
  renderNotes();
  renderExp();
  renderAj();
  renderGroups();
  syncAllSegs();
  drawUni();
}

export function setMode(m: ModeKey, silent = false) {
  E.mode = m;
  E.dim.clear();
  if (!silent) guardarCamada(m);
  renderModes();
  applyPaint();
  renderSeg();
  if (!silent) renderAna();
}

export function setField(on: boolean) {
  E.field = on;
  const r = document.documentElement;
  if (on) r.setAttribute('data-contrast', 'field'); else r.removeAttribute('data-contrast');
  $('#btnField').setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('pavecad-field', on ? '1' : '0'); } catch { /* sem storage */ }
  if (E.mapReady) applyPaint();
  renderAll();
  setTimeout(() => { syncAllSegs(); drawUni(); }, 30);
  toast(on ? 'Modo campo ligado: contraste máximo para uso ao sol' : 'Modo campo desligado');
}

/* ---------------------------------------------------------------- */
/* Resumo (seção da Análise)                                         */
/* ---------------------------------------------------------------- */
/** Seções da Análise recolhidas pelo usuário (lembradas enquanto a página estiver aberta). */
const anaFechadas = new Set<string>();
const rodoviasFechadas = new Set<string>();

/** Totais, soluções e piores pontos de um conjunto de planilhas visíveis. */
function estatisticas(Vg: AppProj[], key: IndKey) {
  const M = IND[key], R = resumo(Vg), cr = criticos(Vg, key);
  const rows = Object.entries(R.st).filter(([k]) => k !== '-').sort((a, b) => b[1].area - a[1].area);
  const maxA = Math.max(1, ...rows.map((r) => r[1].area));
  return `<div><h2 class="h1 num">${fmt(R.ext, 1)} km</h2><p class="lead num">${Vg.length} planilha${Vg.length !== 1 ? 's' : ''} ${Vg.length !== 1 ? 'visíveis' : 'visível'} · ${R.nR.toLocaleString('pt-BR')} segmentos de 20 m${R.drKm ? ` · ${fmt(R.drKm, 1)} km com dreno` : ''}</p>
      ${Object.keys(R.poi).length ? `<div class="chips" style="margin-top:8px">${Object.entries(R.poi).map(([t, n]) => `<span class="chip">${esc(t)} · ${n}</span>`).join('')}</div>` : ''}</div>
    <div><div class="sect">Soluções</div><div class="list">
      ${rows.map(([k, v]) => `<div class="row"><span class="sw" style="background:${tc(k)}"></span>
        <div class="grow"><div>${esc(trLabel(k))}</div><div class="bar"><i style="width:${(v.area / maxA) * 100}%;background:${tc(k)}"></i></div></div>
        <div style="text-align:right" class="num"><div class="val">${fmt(v.area / 1000, 1)}</div><div class="muted" style="font-size:var(--fs-meta)">mil m² · ${fmt(v.len, 1)} km</div></div></div>`).join('')}
    </div><p class="note" style="margin-top:7px">Área = largura da faixa × 20 m × percentual de atuação.</p></div>
    <div><div class="sect">${M.low ? 'Menores' : 'Maiores'} ${M.label}</div><div class="list">
      ${cr.map((o) => `<button class="row" data-go="${o.p.id}:${o.i}:${o.lane}"><span class="sw" style="background:${Q()[M.cls(o.v)]}"></span>
        <div class="grow">km ${esc(o.p.kmLab[o.i])} <span class="muted">· Fx ${o.lane}${Vg.length > 1 ? ' · ' + esc(projName(o.p)) : ''}</span></div>
        <div class="val num">${fmt(o.v * M.scale, M.dec)} <span class="muted" style="font-weight:400;font-size:var(--fs-meta)">${M.unit}</span></div></button>`).join('')}
    </div></div>`;
}

/** Resumo das soluções e dos piores pontos. Com mais de uma rodovia, um grupo recolhível por rodovia. */
function resumoHtml(V: AppProj[]): string {
  const key: IndKey = E.mode === 'sol' ? 'iri' : E.mode;
  const vias = [...new Set(V.map((p) => p.meta.uf))];
  if (vias.length <= 1) return estatisticas(V, key);
  return vias.map((uf) => {
    const vis = V.filter((p) => p.meta.uf === uf), ext = resumo(vis).ext;
    return `<details class="rgrp" data-uf="${esc(uf)}" ${rodoviasFechadas.has(uf) ? '' : 'open'}>
      <summary><span class="rg-n"><b>${esc(rodoviaNome(uf))}</b><span class="muted num">${vis.length} planilha${vis.length !== 1 ? 's' : ''} · ${fmt(ext, 1)} km visíveis</span></span></summary>
      <div class="rg-c">${estatisticas(vis, key)}</div></details>`;
  }).join('');
}

export function removeProject(id: string) {
  const p = getP(id);
  if (!p) return;
  // o que preciso para trazer a planilha de volta: a planilha como veio, a posição na lista e se estava visível.
  // Ajustes de largura, deslocamento e propostas continuam guardados pelo nome da planilha e voltam sozinhos.
  const copia = { parsed: { meta: p.meta, rows: p.rowsPlanilha, log: p.log, codes: p.codes, qualidade: p.qualidade }, zone: p.crs.source === 'fixo' ? p.crs.zone : undefined, rotulo: p.meta.name };
  const indice = E.P.indexOf(p), visivel = p.visible, nome = projName(p);
  removerProjeto(p, true);
  E.settingsSel.delete(id);
  if (E.sel?.pid === id) { E.sel = null; updateSelLayer(); }
  if (E.focus) clearFocus();
  resolveProps();
  refreshProp();
  refreshPropLayers();
  renderAll();
  toastAcao(`${nome} removida`, 'Desfazer', async () => {
    const [volta] = await abrirLidas([copia], true, false);
    if (!volta) return;
    E.P = E.P.filter((x) => x !== volta);
    E.P.splice(Math.min(indice, E.P.length), 0, volta);
    volta.visible = visivel;
    applyVisibility(volta);
    resolveProps();
    refreshProp();
    refreshPropLayers();
    renderAll();
    toast('Planilha restaurada');
  }, 10000);
}

/* ---------------------------------------------------------------- */
/* Segmento                                                          */
/* ---------------------------------------------------------------- */
/** Detalhes e tratamentos começam recolhidos para o painel caber sem rolar; a escolha do usuário é lembrada. */
let segDetAberto = false;
/** O Planservi abre os detalhes de saída (as camadas são o que importa); depois vale a escolha do usuário. */
let segDetEscolhido = false;

export function renderSeg() {
  const el = $('#t-seg'), s = E.sel;
  if (!s) { el.innerHTML = '<div class="empty"><b>Toque na via para ver o segmento</b>Ou toque no unifilar.</div>'; $('#ikm').textContent = 'Toque na via para ver o segmento'; return; }
  const p = getP(s.pid);
  if (!p) { E.sel = null; return renderSeg(); }
  $('#ikm').textContent = `km ${p.kmLab[s.row]} · ${projName(p)}`;
  const tinhaFoco = !!document.activeElement?.closest('#t-seg .xs');
  const r = p.rows[s.row], md = p.model[s.row], N = r.widths.length, isSh = s.lane === 0;
  const L = isSh ? null : r.lanes[s.lane - 1], tr = isSh ? md.sh : md.tr[s.lane - 1];
  const chips: string[] = [];
  if (tr.main !== '-') chips.push(`<span class="chip"><span class="sw" style="background:${tc(tr.main)}"></span>${esc(trLabel(tr.main))}${tr.pct < 100 ? ' · ' + tr.pct + '%' : ''}</span>`);
  if (tr.comp) chips.push(`<span class="chip">+ ${esc(tr.comp)}</span>`);
  if (!chips.length) chips.push('<span class="chip muted">Sem intervenção</span>');
  const param = (k: IndKey, label?: string) => {
    const M = IND[k], v = L ? M.value(L) : null, c = v == null ? -1 : M.cls(v);
    return `<div class="param"><div class="k">${label || M.label}</div><div class="v num">${fmt(v == null ? null : v * M.scale, M.dec)}<small>${M.unit}</small></div><div class="scale">${Q().map((q, i) => `<i style="${i === c ? 'background:' + q : ''}"></i>`).join('')}</div></div>`;
  };
  const ed = edgesOf(r, p.opts), total = Math.abs(ed.e[ed.e.length - 1] - ed.e[0]), widths = r.widths.concat(ed.hasShoulder ? [r.shoulder] : []);
  let xs = '', acc = 0;
  const ticks = [0];
  widths.forEach((w, k) => {
    acc += w; ticks.push(acc);
    const isS = k >= N, t = isS ? md.sh : md.tr[k], nd = t.main === '-', on = isS ? isSh : s.lane === k + 1;
    const rot = `${isS ? 'Acostamento' : 'Faixa ' + (k + 1)}, ${fmt(w, 2)} m, ${nd ? 'sem intervenção' : trLabel(t.main)}`;
    xs += `<button type="button" data-l="${isS ? 0 : k + 1}" aria-pressed="${on}" aria-label="${esc(rot)}" title="${esc(rot)}" class="${on ? 'sel' : ''} ${nd ? 'nodata' : ''}" style="width:${(w / total) * 100}%;background:${tc(t.main)}">${isS ? 'Ac' : 'Fx ' + (k + 1)}</button>`;
  });
  const xt = ticks.map((e, i) => `<span style="left:${(e / total) * 100}%;transform:translateX(${i === 0 ? '0' : i === ticks.length - 1 ? '-100%' : '-50%'})">${fmt(e, 1)} m</span>`).join('');
  const plan = p.meta.format === 'planservi';
  const treat = isSh || !L ? [] : L.treat.map((v, i) => [TREAT_LABELS[i], v] as const).filter(([, v]) => v !== 0 && v !== null);
  const dr = r.drain, drainTxt = dr && (dr[0] || dr[1]) ? `tipo ${dr[0] || dr[1]}, lado ${p.opts.drainSide === 'in' ? 'interno' : 'externo'}` : null;
  const extra: [string, string][] = [];
  if (L?.camadas) for (const c of L.camadas) extra.push([c.nome, c.texto]);
  if (plan && isSh) extra.push(['Revestimento do acostamento', descreverCamada(r.shoulderRaw ?? null, 'rev')]);
  if (L?.fsTipo) extra.push(['Fresagem', L.fsTipo === 'C' ? 'Contínua' : 'Descontínua']);
  if (L?.fsEsp && !L.camadas) extra.push(['Espessura de fresagem', `${L.fsEsp} cm${L.fsPct ? ' · ' + Math.round(L.fsPct * 100) + '% da área' : ''}`]);
  if (L?.gapCm) extra.push(['Gap graded', `${L.gapCm} cm`]);
  if (r.he[0]) extra.push(['Revestimento existente (He)', `${r.he[0]} cm`]);
  if (L?.opdr) extra.push(['Ocorrência O/P/R/D', 'marcada']);
  if (L?.exafe) extra.push(['Ocorrência EX/AF/E', 'marcada']);
  if (drainTxt) extra.push(['Dreno', drainTxt]);
  if (tr.code) extra.unshift(['Código na planilha', tr.code]);
  const itens: [string, string][] = [
    ...treat.map(([k, v]) => [k, typeof v === 'number' ? fmt(v, v % 1 ? 2 : 0) : String(v)] as [string, string]),
    ...extra,
  ];
  const detalhes = itens.length
    ? `<details id="segDet" ${segDetAberto || (plan && !segDetEscolhido) ? 'open' : ''}><summary>Detalhes e tratamentos <span class="muted num">${itens.length}</span></summary>
        <div class="kv">${itens.map(([k, v]) => `<div><span>${esc(k)}</span><b class="num">${esc(v)}</b></div>`).join('')}</div></details>`
    : '';
  el.innerHTML = `
    <div class="shead"><div><h2 class="h1 num">km ${esc(p.kmLab[s.row])}</h2>
        <p class="lead num"><span>${esc(projName(p))}</span><span>hod. ${fmt(kmVis(r.hod), 3)} km${r.obs || r.platform ? ' · ' + [r.obs, r.platform].filter(Boolean).map(esc).join(' · ') : ''}</span></p></div>
      <div class="sbtns"><button class="iconbtn" id="sPrev" aria-label="Segmento anterior" title="Anterior (←)">${IC.prev}</button><button class="iconbtn" id="sNext" aria-label="Próximo segmento" title="Próximo (→)">${IC.next}</button><button class="iconbtn" id="sCopy" aria-label="Copiar localização" title="Copiar localização">${IC.copy}</button><button class="iconbtn" id="sNote" aria-label="Nota neste segmento" title="Nota neste segmento">${IC.pin}</button></div></div>
    <div class="chips" aria-label="Solução">${chips.join('')}</div>
    <div><div class="xs" role="group" aria-label="Seção a partir da coordenada: escolha a faixa" title="Seção a partir da coordenada. Setas para cima e para baixo trocam de faixa">${xs}</div><div class="xsticks num">${xt}</div></div>
    ${isSh || !L ? '' : plan
      ? `<div class="params">${param('iri')}${param('atr', 'Flecha')}${param('igg')}${param('fc2')}${param('fc3')}</div>`
      : `<div class="params">${param('iri')}${param('def', 'Defeitos')}${param('atr')}${param('d0')}${param('rc')}
      <div class="param"><div class="k">D120</div><div class="v num">${fmt(L.d120, 2)}<small>0,01 mm</small></div></div></div>`}
    ${detalhes}`;
  $('#sPrev').onclick = () => stepSel(-1, 0);
  $('#sNext').onclick = () => stepSel(1, 0);
  $('#sCopy').onclick = () => {
    const txt = `${projName(p)} · km ${p.kmLab[s.row]} · ${isSh ? 'Acostamento' : 'Fx ' + s.lane} · ${r.lat}, ${r.lon}`;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Localização copiada'), () => toast('Não foi possível copiar neste ambiente'));
  };
  $('#sNote').onclick = () => {
    const f = p.polyByFid.get(s.row * 8 + (s.lane || 7));
    if (!f) return;
    const c = (f.geometry as GeoJSON.Polygon).coordinates[0];
    startNote('pin', [[(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2]]);
  };
  el.querySelectorAll<HTMLElement>('.xs button').forEach((b) => b.addEventListener('click', () => select(s.pid, s.row, +b.dataset.l!)));
  el.querySelector('#segDet')?.addEventListener('toggle', (ev) => { segDetAberto = (ev.target as HTMLDetailsElement).open; segDetEscolhido = true; });
  // a seleção refaz o painel: devolve o foco do teclado à faixa escolhida
  if (tinhaFoco) el.querySelector<HTMLElement>('.xs [aria-pressed="true"]')?.focus();
}

/* ---------------------------------------------------------------- */
/* Análise: solução x patologias                                     */
/* ---------------------------------------------------------------- */
export function renderAna() {
  const el = document.getElementById('t-ana');
  if (!el) return;
  const V = visibleProjects();
  if (!V.length) { el.innerHTML = '<div class="empty"><b>Sem dados visíveis</b>Mostre ao menos uma planilha.</div>'; return; }
  const inds = indicadoresComDados(V);
  const key: IndKey = inds.includes(E.anInd) ? E.anInd : inds[0] ?? 'iri', M = IND[key], acc = matriz(V, key);
  const ordem = trOrder();
  const keys = [...ordem.filter((k) => acc[k]), ...Object.keys(acc).filter((k) => !ordem.includes(k) && k !== '-'), ...(acc['-'] ? ['-'] : [])];
  const matrix = keys.map((k) => {
    const a = acc[k], tot = a.cnt || 1;
    return `<tr><td class="nm"><span class="sw" style="display:inline-block;margin-right:6px;background:${tc(k)}"></span>${esc(trLabel(k).replace('Fresagem ', 'Fres. '))}</td>
      ${a.cls.map((c, ci) => `<td><button class="cell" data-k="${esc(k)}" data-c="${ci}" title="${c} de ${a.cnt} faixas de 20 m"><i style="background:${Q()[ci]};opacity:${((c / tot) * 0.85).toFixed(2)}"></i><b>${a.cnt ? Math.round((c / tot) * 100) : 0}%</b></button></td>`).join('')}
      <td class="mean num">${a.cnt ? fmt((a.sum / a.cnt) * M.scale, M.dec) : '–'}<br><span style="font-size:var(--fs-meta)">${fmt(a.n * 0.02, 1)} km</span></td></tr>`;
  }).join('');
  const stacks = M.labels.map((lb, ci) => {
    const tot = keys.reduce((s, k) => s + acc[k].cls[ci], 0);
    return `<div class="stackrow"><div><span class="sw" style="display:inline-block;margin-right:6px;background:${Q()[ci]}"></span>${lb}</div>
      <div class="stack">${tot ? keys.filter((k) => acc[k].cls[ci]).map((k) => `<button data-k="${esc(k)}" data-c="${ci}" style="flex:${acc[k].cls[ci]};background:${tc(k)}" title="${esc(trLabel(k))}: ${fmt(acc[k].cls[ci] * 0.02, 1)} km"></button>`).join('') : ''}</div></div>`;
  }).join('');
  const rules = violacoes(V);
  const sec = (id: string, titulo: string, corpo: string) => `<details class="ana-sec" data-sec="${id}" ${anaFechadas.has(id) ? '' : 'open'}><summary>${titulo}</summary><div class="ana-c">${corpo}</div></details>`;
  const matrizHtml = `<p class="lead">Distribuição de cada indicador dentro de cada solução, nas planilhas visíveis. Toque em uma célula para ver os trechos no mapa.</p>
    <div class="seg" id="anSeg" role="group" aria-label="Indicador" style="align-self:flex-start">${inds.map((k) => `<button data-i="${k}" aria-pressed="${k === key}">${IND[k].label.replace(' máx', '')}</button>`).join('')}</div>
    <div><div class="sect">${M.label} por solução <span style="text-transform:none;font-weight:500">${M.unit}</span></div>
      <table class="matrix"><thead><tr><th></th>${M.labels.map((l, i) => `<th style="color:${Q()[i]}">${l.replace(' a ', '–')}</th>`).join('')}<th style="text-align:right">Média</th></tr></thead><tbody>${matrix}</tbody></table></div>
    <div><div class="sect">Soluções dentro de cada classe de ${M.label}</div>${stacks}</div>`;
  const regrasHtml = `<p class="note" style="margin-bottom:8px">Critérios provisórios, para ajustar ao padrão da concessionária.</p>
      <div class="list">${rules.map(({ regra, n }, ri) => `<div class="rule ${n ? 'bad' : 'ok'}"><div class="t">${regra.t}<small>${regra.s}</small></div><div class="n num">${fmt(n * 0.02, 1)}<span class="muted" style="font-size:var(--fs-meta);font-weight:500"> km</span></div><button class="btn" data-r="${ri}" ${n ? '' : 'disabled'} style="min-height:30px;padding:3px 10px">Ver</button></div>`).join('')}</div>`;
  el.innerHTML = sec('resumo', 'Resumo das soluções', resumoHtml(V)) + sec('matriz', 'Solução × patologias', matrizHtml) + sec('regras', 'Verificações de coerência', regrasHtml);
  el.querySelectorAll<HTMLDetailsElement>('details.ana-sec').forEach((d) => d.addEventListener('toggle', () => { if (d.open) anaFechadas.delete(d.dataset.sec!); else anaFechadas.add(d.dataset.sec!); }));
  el.querySelectorAll<HTMLDetailsElement>('details.rgrp').forEach((d) => d.addEventListener('toggle', () => { if (d.open) rodoviasFechadas.delete(d.dataset.uf!); else rodoviasFechadas.add(d.dataset.uf!); }));
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => (b.onclick = () => {
    const [pid, i, l] = b.dataset.go!.split(':'), q = getP(pid)!;
    flyTo(q, +i);
    select(pid, +i, +l, { tab: true });
  }));
  el.querySelectorAll<HTMLElement>('#anSeg button').forEach((b) => b.addEventListener('click', () => { E.anInd = b.dataset.i as IndKey; renderAna(); }));
  const focusCell = (k: string, ci: number) => {
    setMode(E.anInd, true);
    if (setFocus(`${trLabel(k)} · ${M.label} ${M.labels[ci]}`, (L, t) => { const v = M.value(L); return t.main === k && v != null && M.cls(v) === ci; })) fitFocus();
  };
  el.querySelectorAll<HTMLElement>('.cell').forEach((b) => b.addEventListener('click', () => focusCell(b.dataset.k!, +b.dataset.c!)));
  el.querySelectorAll<HTMLElement>('.stack button').forEach((b) => b.addEventListener('click', () => focusCell(b.dataset.k!, +b.dataset.c!)));
  el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.addEventListener('click', () => { const rl = REGRAS[+b.dataset.r!]; if (setFocus(rl.t, (L, t) => rl.f(L, t))) fitFocus(); }));
  syncSeg($('#anSeg'));
}

/* ---------------------------------------------------------------- */
/* Ajustes                                                           */
/* ---------------------------------------------------------------- */
/** Planilhas marcadas em Ajustes. Sem marca nenhuma, as mudanças não valem para planilha alguma. */
export function alvosAjuste(): AppProj[] {
  for (const id of [...E.settingsSel]) if (!getP(id)) E.settingsSel.delete(id); // no mesmo conjunto: a lista de checkbox guarda a referência
  return E.P.filter((q) => E.settingsSel.has(q.id));
}
/** Uma planilha ganhou o foco (clique no mapa ou planilha nova): se não está marcada, passa a ser a única marcada. */
export function focarAjustes(pid: string) {
  E.settingsPid = pid;
  if (!E.settingsSel.has(pid)) E.settingsSel = new Set([pid]);
}
const iguais = <T,>(v: T[]) => v.every((x) => x === v[0]);

/** Liga ou desliga o modo privacidade: refaz rótulos de km, marcadores e painéis. A escolha fica no aparelho. */
export function setPrivacidade(on: boolean) {
  E.privacidade = on;
  try { localStorage.setItem('pavecad-privacidade', on ? '1' : '0'); } catch { /* sem storage */ }
  atualizarRotulosKm();
  if (E.mapReady) for (const q of E.P) setProjectData(q);
  renderAll();
  toast(on ? 'Modo privacidade ligado' : 'Modo privacidade desligado');
}

export function renderAj() {
  const el = $('#t-aj');
  const alvos = alvosAjuste(), p = alvos[0];
  const lista = E.P.map(itemDe);
  const sel = E.P.length ? `
    <div><div class="sect">Planilhas a ajustar <span class="num" id="a-cont">${contadorSelecao(E.settingsSel, E.P.length)}</span></div>
      ${htmlSelecao({ itens: lista, marcadas: E.settingsSel }, 'a-lista')}
      <p class="note" style="margin-top:6px">${alvos.length ? 'Os campos abaixo valem para todas as marcadas.' : 'Marque ao menos uma planilha para ajustar.'} O Alinhar fica mais abaixo, nesta mesma aba.</p></div>` : '';
  const opts = p ? `
    <div><div class="sect">Geometria ${alvos.length > 1 ? `das ${alvos.length} planilhas` : 'da planilha'}</div>
      <div class="list">
        <div class="field"><label for="a-trav">Sentido de tráfego</label><select id="a-trav"><option value="1">Crescente</option><option value="-1">Decrescente</option></select></div>
        <div class="field"><label for="a-dir">Faixas crescem para a</label><select id="a-dir"><option value="1">Direita</option><option value="-1">Esquerda</option></select></div>
        <div class="field"><label for="a-org">Coordenada está na</label><select id="a-org"><option value="edge">Borda da Fx 1 (0 m)</option><option value="axis">Eixo da Fx 1</option></select></div>
        <div class="field"><label for="a-win">Suavização do azimute</label><select id="a-win"><option value="1">±1 ponto (20 m)</option><option value="2">±2 pontos (40 m)</option><option value="4">±4 pontos (80 m)</option></select></div>
        <div class="field"><label for="a-sh">Acostamento externo</label><select id="a-sh"><option value="1">Mostrar</option><option value="0">Ocultar</option></select></div>
        <div class="field"><label for="a-dr">Lado dos drenos</label><select id="a-dr"><option value="out">Externo</option><option value="in">Interno</option></select></div>
      </div>
      <p class="note" style="margin-top:7px">Sentido e coordenada seguem a regra confirmada: coordenada na borda esquerda da Fx 1, no sentido do tráfego. A Marginal Sul usa as mesmas coordenadas da pista principal, por isso entra com 12 m de deslocamento transversal à direita.</p>
      ${selo(p) ? `<p class="note" style="margin-top:7px">${selo(p)}. Veja o detalhe em Revisão, em Ocorrências.</p>` : ''}
      <p class="note num" style="margin-top:7px">Sistema de coordenadas: SIRGAS 2000 UTM ${p.crs.zone}S${p.crs.epsg ? ` (EPSG ${p.crs.epsg})` : ''}, ${p.crs.source === 'fixo' ? 'fixado' : 'pela mediana das longitudes'}.</p>
      ${p.log.length && E.privacidade ? '<p class="note" style="margin-top:8px">Log de importação oculto no modo privacidade: traz km e nomes.</p>' : p.log.length ? `<details style="margin-top:8px"><summary>Log de importação (${p.log.length})</summary><div class="formula">${p.log.map((l) => `${l.level === 'warn' ? '! ' : '· '}${esc(l.msg)}`).join('\n')}</div></details>` : ''}</div>` : '';
  el.innerHTML = `
    <div><div class="sect">Aparência</div><div class="list">
      <div class="field"><div><div>Padrão além da cor</div><div class="note">Hachura nas classes críticas (RE, RP e as piores de IGG, FC e ATR). Liga sozinho no modo campo. O RP sempre tem hachura, até você desligar aqui</div></div><button class="sw2" id="s-pad" role="switch" aria-checked="${padraoAtivo()}" aria-label="Padrão além da cor"></button></div>
      <div class="field"><div><div>Modo privacidade</div><div class="note">Oculta nomes de planilha, rodovia e km na tela e nas exportações. Os dados no aparelho não mudam</div></div><button class="sw2" id="s-priv" role="switch" aria-checked="${E.privacidade}" aria-label="Modo privacidade"></button></div>
      <div class="field"><div><div>Duração da pressão no mapa</div><div class="note">Tempo segurando o dedo até abrir o menu de campo</div></div><div class="seg" id="s-press" role="group" aria-label="Duração da pressão">${PRESSAO_OPCOES.map((v) => `<button type="button" data-ms="${v}" aria-pressed="${pressaoMs() === v}">${v} ms</button>`).join('')}</div></div>
      <div class="field"><div><div>Confirmar antes de gravar</div><div class="note">A roda de campo mostra Estender, Observação e Confirmar antes de gravar. Desligado, um toque grava e a roda mostra Estender, Observação e Desfazer</div></div><button class="sw2" id="s-conf" role="switch" aria-checked="${confirmarAntes()}" aria-label="Confirmar antes de gravar"></button></div>
      <div class="field"><div><div>Modo campo (sol)</div><div class="note">Contraste máximo, cores fortes, alvos de toque maiores</div></div><button class="sw2" id="s-field" role="switch" aria-checked="${E.field}" aria-label="Modo campo"></button></div></div></div>
    <div><div class="sect">Camadas</div><div class="list">
      ${([['drain', 'Drenos', 'Lado externo. Linha cheia tipo R, tracejada tipo P. Passe o mouse para ver detalhes'], ['poi', 'OAE e pedágio', 'Marcadores nos trechos observados'], ['km', 'Marcos e estacas', 'Estaca a cada 20 m com zoom máximo, 100 m e 500 m ao afastar'], ['notes', 'Anotações', '']] as const).map(([k, t, s]) => `<div class="field"><div><div>${t}</div>${s ? `<div class="note">${s}</div>` : ''}</div><button class="sw2" data-layer="${k}" role="switch" aria-checked="${E.layers[k]}" aria-label="${t}"></button></div>`).join('')}</div></div>
    ${sel}
    ${opts}
    <div id="alSecWrap"><div class="sect" id="alSect">Alinhar planilhas</div><div id="t-al"></div></div>
    <div><div class="sect">Mapa</div><div class="list"><div class="field"><label for="a-base">Base</label><select id="a-base"><option value="none">Sem base</option><option value="osm">Ruas</option><option value="esri">Satélite</option></select></div></div>
      <p class="note" style="margin-top:7px">${temMapTiler() ? 'Base MapTiler ativa.' : 'Base reserva (OpenStreetMap e Esri). Para o MapTiler, defina VITE_MAPTILER_KEY no ambiente de build.'}</p></div>
    <details><summary>Como o cálculo é feito</summary><div class="formula">θ = atan2(ΔE, ΔN)   entre i−w e i+w, em metros UTM
nE = cos θ , nN = −sin θ   (invertido no sentido decrescente)
e(n) = e0 + dir · Σ largura(1..n)
P(n) = P + e(n) · (nE , nN)</div>
      <p class="note" style="margin-top:8px">O sentido decrescente usa o mesmo cálculo com a normal invertida, porque as linhas da planilha seguem a quilometragem crescente.</p></details>`;
  ligarSelecao(el, { itens: lista, marcadas: E.settingsSel, origem: p ? itemDe(p) : undefined, aoMudar: () => renderAj() });
  renderAlinhar();
  const diag = document.createElement('div');
  diag.id = 'diagBox';
  el.appendChild(diag);
  renderDiagnostico(diag);
  if (p) {
    // seletores: mostra o valor comum; se as marcadas diferem, "vários"
    const set = (id: string, vals: string[]) => {
      const e = $<HTMLInputElement | HTMLSelectElement>(id);
      if (iguais(vals)) { e.value = vals[0]; return; }
      if (e instanceof HTMLSelectElement) { const o = document.createElement('option'); o.value = ''; o.textContent = 'vários'; o.hidden = true; e.prepend(o); e.value = ''; }
      else { e.value = ''; e.placeholder = 'vários'; }
    };
    set('#a-trav', alvos.map((q) => String(q.opts.travel))); set('#a-dir', alvos.map((q) => String(q.opts.dir))); set('#a-org', alvos.map((q) => q.opts.origin));
    set('#a-win', alvos.map((q) => String(q.opts.win))); set('#a-sh', alvos.map((q) => (q.opts.shoulder ? '1' : '0'))); set('#a-dr', alvos.map((q) => q.opts.drainSide));
    const ch = (id: string, fn: (q: AppProj, v: string) => void) => {
      $(id).onchange = (e) => {
        const v = (e.target as HTMLInputElement).value;
        if (v === '') return;
        const todos = alvosAjuste();
        for (const q of todos) fn(q, v);
        void Promise.all(todos.map((q) => regeometrar(q, todos.length === 1))).then(() => { if (todos.length > 1) { renderAll(); toast(`Aplicado a ${todos.length} planilhas`); } });
      };
    };
    ch('#a-trav', (q, v) => (q.opts.travel = +v as 1 | -1));
    ch('#a-dir', (q, v) => (q.opts.dir = +v as 1 | -1));
    ch('#a-org', (q, v) => (q.opts.origin = v as 'edge' | 'axis'));
    ch('#a-win', (q, v) => (q.opts.win = +v));
    ch('#a-sh', (q, v) => (q.opts.shoulder = v === '1'));
    ch('#a-dr', (q, v) => (q.opts.drainSide = v as 'out' | 'in'));
  }
  const bs = $<HTMLSelectElement>('#a-base');
  bs.value = E.base;
  bs.onchange = () => { setBase(bs.value as typeof E.base); syncBaseSeg(); };
  $('#s-field').onclick = () => setField(!E.field);
  el.querySelectorAll<HTMLElement>('#s-press button').forEach((b) => (b.onclick = () => {
    try { localStorage.setItem(CHAVE_PRESSAO, b.dataset.ms!); } catch { /* sem storage */ }
    el.querySelectorAll<HTMLElement>('#s-press button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncSeg($('#s-press'));
    toast(`Pressão de ${b.dataset.ms} ms`);
  }));
  syncSeg($('#s-press'));
  $('#s-priv').onclick = () => setPrivacidade(!E.privacidade);
  $('#s-conf').onclick = () => { const v = !confirmarAntes(); definirConfirmarAntes(v); $('#s-conf').setAttribute('aria-checked', String(v)); };
  $('#s-pad').onclick = () => {
    E.padrao = !padraoAtivo();
    try { localStorage.setItem('pavecad-padrao', E.padrao ? '1' : '0'); } catch { /* sem storage */ }
    $('#s-pad').setAttribute('aria-checked', String(E.padrao));
    applyPaint();
    renderLegend();
  };
  el.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.layer as keyof typeof E.layers;
    E.layers[k] = !E.layers[k];
    b.setAttribute('aria-checked', String(E.layers[k]));
    applyLayers();
  }));
}

/** Mantém o seletor da barra superior igual ao de Ajustes. */
export function syncBaseSeg() {
  document.querySelectorAll<HTMLElement>('#base button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.b === E.base)));
  syncSeg($('#base'));
}

export { MODE_KEYS, clearSel };
