import { criticos, INDS_ANALISE, matriz, resumo, violacoes, REGRAS } from '../dominio/analise';
import { IND, MODE_KEYS, Q5, Q5F, type IndKey, type ModeKey } from '../dominio/indicadores';
import { trColor, trLabel, trOrder } from '../dominio/solucoes';
import { edgesOf } from '../geometry/build';
import { tituloDe } from '../dominio/titulo';
import { E, getP, projName, visibleProjects, type AppProj } from './estado';
import { regeometrar, removerProjeto } from './projetos';
import { IC } from './icones';
import { applyLayers, applyPaint, clearFocus, clearSel, fitAll, fitFocus, fitList, getMap, renderLegend, select, setBase, setFocus, setProjectData, stepSel, updateSelLayer, updateStakes, applyVisibility, temMapTiler } from './mapa';
import { drawUni, renderGroups } from './unifilar';
import { refreshProp, refreshPropLayers, renderNotes, resolveProps, startNote } from './revisao';
import { $, cssv, esc, fmt, syncAllSegs, syncSeg, toast } from './ui';

const Q = () => (E.field ? Q5F : Q5);
const tc = (k: string) => trColor(k, E.field, cssv('--none'));
const TREAT_LABELS = ['Estrutural', 'Fresagem funcional', 'Fresagem estrutural', 'Selagem', 'Microfresagem', 'Fresagem fina', 'Revestimento'];
const dirBadge = (p: AppProj) => /Marginal/i.test(p.meta.via) ? '<span class="dirb m">MARG</span>' : p.meta.travel > 0 ? '<span class="dirb">CRESC</span>' : '<span class="dirb d">DECRESC</span>';
const flyTo = (p: AppProj, i: number, zoom = 17.2) => { const r = p.rows[i]; getMap().flyTo({ center: [r.lon, r.lat], zoom: Math.max(getMap().getZoom(), zoom), duration: 800 }); };

/* ---------------------------------------------------------------- */
/* Abas                                                              */
/* ---------------------------------------------------------------- */
export function setTab(t: typeof E.tab) {
  E.tab = t;
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  for (const x of ['resumo', 'seg', 'ana', 'notas', 'aj']) $(`#t-${x}`).hidden = x !== t;
  syncSeg($('#tabs'));
  if (t === 'ana') renderAna();
  if (t === 'notas') renderNotes();
  syncAllSegs();
}

export function renderViews() {
  const v = visibleProjects();
  const t = tituloDe(v.length ? v : E.P), n = E.P.length;
  $('#title').textContent = t;
  $('#titlebox').title = t;
  $('#subtitle').textContent = !n ? 'Nenhuma planilha' : `${n} planilha${n > 1 ? 's' : ''}${v.length < n ? ` · ${v.length} ${v.length > 1 ? 'visíveis' : 'visível'}` : ''}`;
  const vb = $('#views'), groups = [...new Set(v.map((p) => p.meta.uf))];
  vb.innerHTML = '<button class="chipbtn" data-g="*">Visão geral</button>' + groups.map((g) => `<button class="chipbtn" data-g="${esc(g)}">${esc(g.replace('BR-', ''))}</button>`).join('');
  vb.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.g!;
    if (g === '*') fitAll();
    else { E.activeGroup = g; fitList(visibleProjects().filter((p) => p.meta.uf === g)); renderGroups(); drawUni(); }
  }));
}

export function renderAll() {
  updateStakes();
  renderViews();
  renderLegend();
  renderResumo();
  renderSeg();
  renderAna();
  renderNotes();
  renderAj();
  renderGroups();
  syncAllSegs();
  drawUni();
}

export function setMode(m: ModeKey, silent = false) {
  E.mode = m;
  E.dim.clear();
  document.querySelectorAll<HTMLElement>('#modes button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === m)));
  syncSeg($('#modes'));
  applyPaint();
  renderResumo();
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
/* Resumo                                                            */
/* ---------------------------------------------------------------- */
export function renderResumo() {
  const el = $('#t-resumo'), V = visibleProjects();
  if (!E.P.length) { el.innerHTML = '<div class="empty"><b>Nenhuma planilha carregada</b>Toque em Planilhas e escolha um ou mais arquivos no padrão RoadRunner.</div>'; return; }
  const R = resumo(V);
  const rows = Object.entries(R.st).filter(([k]) => k !== '-').sort((a, b) => b[1].area - a[1].area);
  const maxA = Math.max(1, ...rows.map((r) => r[1].area));
  const key: IndKey = E.mode === 'sol' ? 'iri' : E.mode, M = IND[key], cr = criticos(V, key);
  el.innerHTML = `
    <div><div class="sect">Planilhas <button class="btn" id="addFiles" style="min-height:28px;padding:3px 10px;font-size:12px">+ Adicionar</button></div>
      <div class="list">${E.P.map((p) => `<div class="prow">
        <button class="iconbtn" data-eye="${p.id}" aria-label="${p.visible ? 'Ocultar' : 'Mostrar'} ${esc(projName(p))}" style="width:30px;height:30px">${p.visible ? IC.eye : IC.eyeoff}</button>
        <button class="nm" data-fly="${p.id}"><b>${esc(projName(p))}</b><span class="num">km ${fmt(p.meta.kmi, 0)} a ${fmt(p.meta.kmf, 0)} · ${p.rows.length.toLocaleString('pt-BR')} seg · RoadRunner</span></button>
        ${dirBadge(p)}
        <button class="iconbtn" data-del="${p.id}" aria-label="Remover ${esc(projName(p))}" style="width:30px;height:30px">${IC.trash}</button></div>`).join('')}</div></div>
    <div><h2 class="h1 num">${fmt(R.ext, 1)} km</h2><p class="lead num">${V.length} planilha${V.length !== 1 ? 's' : ''} ${V.length !== 1 ? 'visíveis' : 'visível'} · ${R.nR.toLocaleString('pt-BR')} segmentos de 20 m${R.drKm ? ` · ${fmt(R.drKm, 1)} km de dreno` : ''}</p>
      ${Object.keys(R.poi).length ? `<div class="chips" style="margin-top:8px">${Object.entries(R.poi).map(([t, n]) => `<span class="chip">${esc(t)} · ${n}</span>`).join('')}</div>` : ''}</div>
    <div><div class="sect">Soluções</div><div class="list">
      ${rows.map(([k, v]) => `<div class="row"><span class="sw" style="background:${tc(k)}"></span>
        <div class="grow"><div>${esc(trLabel(k))}</div><div class="bar"><i style="width:${(v.area / maxA) * 100}%;background:${tc(k)}"></i></div></div>
        <div style="text-align:right" class="num"><div class="val">${fmt(v.area / 1000, 1)}</div><div class="muted" style="font-size:11px">mil m² · ${fmt(v.len, 1)} km</div></div></div>`).join('')}
    </div><p class="note" style="margin-top:7px">Área = largura da faixa × 20 m × percentual de atuação.</p></div>
    <div><div class="sect">${M.low ? 'Menores' : 'Maiores'} ${M.label}</div><div class="list">
      ${cr.map((o) => `<button class="row" data-go="${o.p.id}:${o.i}:${o.lane}"><span class="sw" style="background:${Q()[M.cls(o.v)]}"></span>
        <div class="grow">km ${esc(o.p.kmLab[o.i])} <span class="muted">· Fx ${o.lane}${V.length > 1 ? ' · ' + esc(projName(o.p)) : ''}</span></div>
        <div class="val num">${fmt(o.v * M.scale, M.dec)} <span class="muted" style="font-weight:400;font-size:11px">${M.unit}</span></div></button>`).join('')}
    </div></div>`;
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
  }));
  el.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => (b.onclick = () => removeProject(b.dataset.del!)));
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => (b.onclick = () => {
    const [pid, i, l] = b.dataset.go!.split(':'), p = getP(pid)!;
    flyTo(p, +i);
    select(pid, +i, +l, { tab: true });
  }));
  const af = document.getElementById('addFiles');
  if (af) af.onclick = () => $('#file').click();
}

export function removeProject(id: string) {
  const p = getP(id);
  if (!p) return;
  removerProjeto(p, true);
  if (E.sel?.pid === id) { E.sel = null; updateSelLayer(); }
  if (E.focus) clearFocus();
  resolveProps();
  refreshProp();
  refreshPropLayers();
  renderAll();
  toast('Planilha removida');
}

/* ---------------------------------------------------------------- */
/* Segmento                                                          */
/* ---------------------------------------------------------------- */
/** Detalhes e tratamentos começam recolhidos para o painel caber sem rolar; a escolha do usuário é lembrada. */
let segDetAberto = false;

export function renderSeg() {
  const el = $('#t-seg'), s = E.sel;
  if (!s) { el.innerHTML = '<div class="empty"><b>Nenhum segmento selecionado</b>Clique em uma faixa no mapa ou no unifilar.</div>'; return; }
  const p = getP(s.pid);
  if (!p) { E.sel = null; return renderSeg(); }
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
  const treat = isSh || !L ? [] : L.treat.map((v, i) => [TREAT_LABELS[i], v] as const).filter(([, v]) => v !== 0 && v !== null);
  const dr = r.drain, drainTxt = dr && (dr[0] || dr[1]) ? `tipo ${dr[0] || dr[1]}, lado ${p.opts.drainSide === 'in' ? 'interno' : 'externo'}` : null;
  const extra: [string, string][] = [];
  if (L?.fsTipo) extra.push(['Fresagem', L.fsTipo === 'C' ? 'Contínua' : 'Descontínua']);
  if (L?.fsEsp) extra.push(['Espessura de fresagem', `${L.fsEsp} cm${L.fsPct ? ' · ' + Math.round(L.fsPct * 100) + '% da área' : ''}`]);
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
    ? `<details id="segDet" ${segDetAberto ? 'open' : ''}><summary>Detalhes e tratamentos <span class="muted num">${itens.length}</span></summary>
        <div class="kv">${itens.map(([k, v]) => `<div><span>${esc(k)}</span><b class="num">${esc(v)}</b></div>`).join('')}</div></details>`
    : '';
  el.innerHTML = `
    <div class="shead"><div><h2 class="h1 num">km ${esc(p.kmLab[s.row])}</h2>
        <p class="lead num"><span>${esc(projName(p))}</span><span>hod. ${fmt(r.hod, 3)} km${r.obs || r.platform ? ' · ' + [r.obs, r.platform].filter(Boolean).map(esc).join(' · ') : ''}</span></p></div>
      <div class="sbtns"><button class="iconbtn" id="sPrev" aria-label="Segmento anterior" title="Anterior (←)">${IC.prev}</button><button class="iconbtn" id="sNext" aria-label="Próximo segmento" title="Próximo (→)">${IC.next}</button><button class="iconbtn" id="sCopy" aria-label="Copiar localização" title="Copiar localização">${IC.copy}</button><button class="iconbtn" id="sNote" aria-label="Nota neste segmento" title="Nota neste segmento">${IC.pin}</button></div></div>
    <div class="chips" aria-label="Solução">${chips.join('')}</div>
    <div><div class="xs" role="group" aria-label="Seção a partir da coordenada: escolha a faixa" title="Seção a partir da coordenada. Setas para cima e para baixo trocam de faixa">${xs}</div><div class="xsticks num">${xt}</div></div>
    ${isSh || !L ? '' : `<div class="params">${param('iri')}${param('def', 'Defeitos')}${param('atr')}${param('d0')}${param('rc')}
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
  el.querySelector('#segDet')?.addEventListener('toggle', (ev) => { segDetAberto = (ev.target as HTMLDetailsElement).open; });
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
  const key = E.anInd, M = IND[key], acc = matriz(V, key);
  const ordem = trOrder();
  const keys = [...ordem.filter((k) => acc[k]), ...Object.keys(acc).filter((k) => !ordem.includes(k) && k !== '-'), ...(acc['-'] ? ['-'] : [])];
  const matrix = keys.map((k) => {
    const a = acc[k], tot = a.cnt || 1;
    return `<tr><td class="nm"><span class="sw" style="display:inline-block;margin-right:6px;background:${tc(k)}"></span>${esc(trLabel(k).replace('Fresagem ', 'Fres. '))}</td>
      ${a.cls.map((c, ci) => `<td><button class="cell" data-k="${esc(k)}" data-c="${ci}" title="${c} de ${a.cnt} faixas de 20 m"><i style="background:${Q()[ci]};opacity:${((c / tot) * 0.85).toFixed(2)}"></i><b>${a.cnt ? Math.round((c / tot) * 100) : 0}%</b></button></td>`).join('')}
      <td class="mean num">${a.cnt ? fmt((a.sum / a.cnt) * M.scale, M.dec) : '–'}<br><span style="font-size:10px">${fmt(a.n * 0.02, 1)} km</span></td></tr>`;
  }).join('');
  const stacks = M.labels.map((lb, ci) => {
    const tot = keys.reduce((s, k) => s + acc[k].cls[ci], 0);
    return `<div class="stackrow"><div><span class="sw" style="display:inline-block;margin-right:6px;background:${Q()[ci]}"></span>${lb}</div>
      <div class="stack">${tot ? keys.filter((k) => acc[k].cls[ci]).map((k) => `<button data-k="${esc(k)}" data-c="${ci}" style="flex:${acc[k].cls[ci]};background:${tc(k)}" title="${esc(trLabel(k))}: ${fmt(acc[k].cls[ci] * 0.02, 1)} km"></button>`).join('') : ''}</div></div>`;
  }).join('');
  const rules = violacoes(V);
  el.innerHTML = `
    <div><h2 class="h2">Solução × patologias</h2><p class="lead">Distribuição de cada indicador dentro de cada solução, nas planilhas visíveis. Toque em uma célula para ver os trechos no mapa.</p></div>
    <div class="seg" id="anSeg" role="group" aria-label="Indicador" style="align-self:flex-start">${INDS_ANALISE.map((k) => `<button data-i="${k}" aria-pressed="${k === key}">${IND[k].label.replace(' máx', '')}</button>`).join('')}</div>
    <div><div class="sect">${M.label} por solução <span style="text-transform:none;font-weight:500">${M.unit}</span></div>
      <table class="matrix"><thead><tr><th></th>${M.labels.map((l, i) => `<th style="color:${Q()[i]}">${l.replace(' a ', '–')}</th>`).join('')}<th style="text-align:right">Média</th></tr></thead><tbody>${matrix}</tbody></table></div>
    <div><div class="sect">Soluções dentro de cada classe de ${M.label}</div>${stacks}</div>
    <div><div class="sect">Verificações de coerência</div><p class="note" style="margin-bottom:8px">Critérios provisórios, para ajustar ao padrão da concessionária.</p>
      <div class="list">${rules.map(({ regra, n }, ri) => `<div class="rule ${n ? 'bad' : 'ok'}"><div class="t">${regra.t}<small>${regra.s}</small></div><div class="n num">${fmt(n * 0.02, 1)}<span class="muted" style="font-size:10px;font-weight:500"> km</span></div><button class="btn" data-r="${ri}" ${n ? '' : 'disabled'} style="min-height:30px;padding:3px 10px">Ver</button></div>`).join('')}</div></div>`;
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
export function renderAj() {
  const el = $('#t-aj'), p = getP(E.settingsPid ?? '') ?? E.P[0];
  const opts = p ? `
    <div><div class="sect">Geometria da planilha</div>
      <div class="list">
        <div class="field"><label for="a-proj">Planilha</label><select id="a-proj">${E.P.map((q) => `<option value="${q.id}">${esc(projName(q))}</option>`).join('')}</select></div>
        <div class="field"><label for="a-trav">Sentido de tráfego</label><select id="a-trav"><option value="1">Crescente</option><option value="-1">Decrescente</option></select></div>
        <div class="field"><label for="a-dir">Faixas crescem para a</label><select id="a-dir"><option value="1">Direita</option><option value="-1">Esquerda</option></select></div>
        <div class="field"><label for="a-org">Coordenada está na</label><select id="a-org"><option value="edge">Borda da Fx 1 (0 m)</option><option value="axis">Eixo da Fx 1</option></select></div>
        <div class="field"><label for="a-ext">Deslocamento adicional (m)</label><input id="a-ext" type="number" step="0.5" min="0" max="100"></div>
        <div class="field"><label for="a-exs">Lado do deslocamento</label><select id="a-exs"><option value="1">Direita</option><option value="-1">Esquerda</option></select></div>
        <div class="field"><label for="a-win">Suavização do azimute</label><select id="a-win"><option value="1">±1 ponto (20 m)</option><option value="2">±2 pontos (40 m)</option><option value="4">±4 pontos (80 m)</option></select></div>
        <div class="field"><label for="a-sh">Acostamento externo</label><select id="a-sh"><option value="1">Mostrar</option><option value="0">Ocultar</option></select></div>
        <div class="field"><label for="a-dr">Lado dos drenos</label><select id="a-dr"><option value="out">Externo</option><option value="in">Interno</option></select></div>
      </div>
      <p class="note" style="margin-top:7px">Sentido e coordenada seguem a regra confirmada: coordenada na borda esquerda da Fx 1, no sentido do tráfego. A Marginal Sul usa as mesmas coordenadas da pista principal, por isso entra com 12 m de deslocamento adicional.</p>
      <p class="note num" style="margin-top:7px">Sistema de coordenadas: SIRGAS 2000 UTM ${p.crs.zone}S${p.crs.epsg ? ` (EPSG ${p.crs.epsg})` : ''}, ${p.crs.source === 'fixo' ? 'fixado' : 'pela mediana das longitudes'}.</p>
      ${p.log.length ? `<details style="margin-top:8px"><summary>Log de importação (${p.log.length})</summary><div class="formula">${p.log.map((l) => `${l.level === 'warn' ? '! ' : '· '}${esc(l.msg)}`).join('\n')}</div></details>` : ''}</div>` : '';
  el.innerHTML = `
    <div><div class="sect">Aparência</div><div class="list">
      <div class="field"><div><div>Modo campo (sol)</div><div class="note">Contraste máximo, cores fortes, alvos de toque maiores</div></div><button class="sw2" id="s-field" role="switch" aria-checked="${E.field}" aria-label="Modo campo"></button></div></div></div>
    <div><div class="sect">Camadas</div><div class="list">
      ${([['drain', 'Drenos', 'Lado externo. Linha cheia tipo R, tracejada tipo P. Passe o mouse para ver detalhes'], ['poi', 'OAE e pedágio', 'Marcadores nos trechos observados'], ['km', 'Marcos e estacas', 'Estaca a cada 20 m com zoom máximo, 100 m e 500 m ao afastar'], ['notes', 'Anotações', '']] as const).map(([k, t, s]) => `<div class="field"><div><div>${t}</div>${s ? `<div class="note">${s}</div>` : ''}</div><button class="sw2" data-layer="${k}" role="switch" aria-checked="${E.layers[k]}" aria-label="${t}"></button></div>`).join('')}</div></div>
    ${opts}
    <div><div class="sect">Mapa</div><div class="list"><div class="field"><label for="a-base">Base</label><select id="a-base"><option value="none">Sem base</option><option value="osm">Ruas</option><option value="esri">Satélite</option></select></div></div>
      <p class="note" style="margin-top:7px">${temMapTiler() ? 'Base MapTiler ativa.' : 'Base reserva (OpenStreetMap e Esri). Para o MapTiler, defina VITE_MAPTILER_KEY no ambiente de build.'}</p></div>
    <details><summary>Como o cálculo é feito</summary><div class="formula">θ = atan2(ΔE, ΔN)   entre i−w e i+w, em metros UTM
nE = cos θ , nN = −sin θ   (invertido no sentido decrescente)
e(n) = e0 + dir · Σ largura(1..n)
P(n) = P + e(n) · (nE , nN)</div>
      <p class="note" style="margin-top:8px">O sentido decrescente usa o mesmo cálculo com a normal invertida, porque as linhas da planilha seguem a quilometragem crescente.</p></details>`;
  if (p) {
    const set = (id: string, v: string) => { $<HTMLInputElement | HTMLSelectElement>(id).value = v; };
    set('#a-proj', p.id); set('#a-trav', String(p.opts.travel)); set('#a-dir', String(p.opts.dir)); set('#a-org', p.opts.origin);
    set('#a-ext', String(p.opts.extra)); set('#a-exs', String(p.opts.extraSide)); set('#a-win', String(p.opts.win)); set('#a-sh', p.opts.shoulder ? '1' : '0'); set('#a-dr', p.opts.drainSide);
    $('#a-proj').onchange = (e) => { E.settingsPid = (e.target as HTMLSelectElement).value; renderAj(); };
    const ch = (id: string, fn: (v: string) => void) => { $(id).onchange = (e) => { fn((e.target as HTMLInputElement).value); void regeometrar(p); }; };
    ch('#a-trav', (v) => (p.opts.travel = +v as 1 | -1));
    ch('#a-dir', (v) => (p.opts.dir = +v as 1 | -1));
    ch('#a-org', (v) => (p.opts.origin = v as 'edge' | 'axis'));
    ch('#a-ext', (v) => (p.opts.extra = Math.max(0, +v || 0)));
    ch('#a-exs', (v) => (p.opts.extraSide = +v as 1 | -1));
    ch('#a-win', (v) => (p.opts.win = +v));
    ch('#a-sh', (v) => (p.opts.shoulder = v === '1'));
    ch('#a-dr', (v) => (p.opts.drainSide = v as 'out' | 'in'));
  }
  const bs = $<HTMLSelectElement>('#a-base');
  bs.value = E.base;
  bs.onchange = () => { setBase(bs.value as typeof E.base); syncBaseSeg(); };
  $('#s-field').onclick = () => setField(!E.field);
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
