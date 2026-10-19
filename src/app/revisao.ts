import type { MapMouseEvent } from 'maplibre-gl';
import { areaM2, fmtLen, lenM } from '../dominio/medidas';
import { addProposta, nomeArquivoCsv, propostasCsv, reposicionar, runAt, runLabel, runStats, type Alvo, type EixoCsv, type Proposta } from '../dominio/propostas';
import { localizar, type LocP } from '../dominio/localizar';
import { eixoDaFaixa } from '../geometry/eixo';
import { trColor, trLabel, trOrder } from '../dominio/solucoes';
import { parseKmTexto } from '../formats/km';
import { E, H, NOTE_CATS, getP, kmFmt, kmReal, projName, type AppProj, type Nota, type NoteCat } from './estado';
import { IC } from './icones';
import { getMap, hitAt, renderLegend, select, setData } from './mapa';
import * as db from './persist';
import { setTab } from './paineis';
import { bindItensNotas, itemNotaHtml } from './notasItens';
import { baixarCsv, baixarXlsx, compartilharNotas } from './exportNotas';
import { notasNovasSemExportar } from './notaRapida';
import { precisaLembrar } from '../dominio/notaRapida';
import { $, cssv, esc, fmt, syncSeg, toast } from './ui';

const tc = (k: string) => trColor(k, E.field, cssv('--none'));
const copiar = (txt: string, ok: string) =>
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(ok), () => toast('Não foi possível copiar neste ambiente'));

/* ---------------------------------------------------------------- */
/* Ferramentas                                                       */
/* ---------------------------------------------------------------- */
export function setTool(t: typeof E.tool) {
  if (E.tool === t) t = null;
  E.tool = t;
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  if (E.mapReady) getMap().getCanvas().style.cursor = t ? 'crosshair' : '';
  if (t !== 'prop') E.propSel = [];
  refreshProp();
  refreshPropLayers();
  document.body.classList.toggle('modo-propor', t === 'prop');
  renderLegend();
}

/** Cliques com ferramenta ativa. */
export function onToolClick(e: MapMouseEvent): boolean {
  if (E.tool === 'prop') {
    const h = hitAt(e.point);
    if (h && 'p' in h) propToggle(h.p, h.row, h.lane);
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- */
/* Propostas de solução                                              */
/* ---------------------------------------------------------------- */
/** Reposiciona as propostas pelo km. Registros antigos (só com índices) ganham o km e são regravados. */
export function resolveProps() {
  const antes = new Map(E.props.map((r) => [r.id, r.km0 === undefined]));
  E.props = reposicionar(E.props, E.P);
  for (const r of E.props) if (antes.get(r.id) && !r.orfa && r.pid) gravarProp(r);
}

function propToggle(p: AppProj, row: number, lane: number) {
  const ix = E.propSel.findIndex((s) => s.pid === p.id && s.lane === lane && row >= s.r0 && row <= s.r1);
  if (ix >= 0) E.propSel.splice(ix, 1);
  else E.propSel.push(runAt(p, row, lane, E.propMode));
  refreshProp();
  refreshPropLayers();
}

const totalAlvos = (list: Alvo[]) => list.reduce((a, s) => {
  const p = getP(s.pid ?? '');
  if (!p) return a;
  const q = runStats(p, s);
  return { len: a.len + q.len, area: a.area + q.area };
}, { len: 0, area: 0 });

export function refreshProp() {
  // seleção de uma planilha que saiu (removida ou recarregada) não conta
  E.propSel = E.propSel.filter((s) => getP(s.pid ?? ''));
  const bar = $('#propbar');
  if (E.tool !== 'prop') { bar.hidden = true; return; }
  bar.hidden = false;
  const tot = totalAlvos(E.propSel), n = E.propSel.length;
  bar.innerHTML = `<div class="pb-top"><b>Propor solução</b><span class="muted num" id="pCount" aria-live="polite">${n} trecho${n === 1 ? '' : 's'} selecionado${n === 1 ? '' : 's'}${n ? ` · ${fmt(tot.len, 0)} m · ${fmt(tot.area, 0)} m²` : ''}</span></div>
    <div class="pb-row"><div class="seg" id="pmSeg" role="group" aria-label="Seleção"><button data-pm="run" aria-pressed="${E.propMode === 'run'}">Solução inteira</button><button data-pm="one" aria-pressed="${E.propMode === 'one'}">20 m</button></div><select id="pTo" aria-label="Nova solução">${[...trOrder(), '-'].map((k) => `<option value="${k}">${k === '-' ? 'Sem intervenção' : esc(trLabel(k))}</option>`).join('')}</select></div>
    <div class="pb-row"><input id="pNote" class="pb-in" placeholder="Observação (opcional)" value="${esc(E.propNote)}" aria-label="Observação"><button class="btn p" id="pApply" ${n ? '' : 'disabled'}>Aplicar</button>${n ? '' : '<span class="pb-hint" id="pHint">Selecione um trecho no mapa</span>'}<button class="btn" id="pClear" ${n ? '' : 'disabled'}>Limpar</button><button class="iconbtn" id="pClose" aria-label="Fechar">${IC.x}</button></div>`;
  const to = $<HTMLSelectElement>('#pTo');
  to.value = E.propTo;
  to.onchange = () => { E.propTo = to.value; };
  $<HTMLInputElement>('#pNote').oninput = (ev) => { E.propNote = (ev.target as HTMLInputElement).value; };
  bar.querySelectorAll<HTMLElement>('[data-pm]').forEach((b) => (b.onclick = () => { E.propMode = b.dataset.pm as 'run' | 'one'; refreshProp(); }));
  syncSeg($('#pmSeg'));
  $('#pClear').onclick = () => { E.propSel = []; refreshProp(); refreshPropLayers(); };
  $('#pClose').onclick = () => setTool(null);
  $('#pApply').onclick = () => {
    let aplicadas = 0;
    for (const s of E.propSel) {
      const pj = getP(s.pid ?? '');
      if (!pj) continue; // planilha removida ou recarregada depois da seleção
      aplicadas++;
      const rec: Proposta = { pid: s.pid, pname: s.pname, lane: s.lane, r0: s.r0, r1: s.r1, km0: pj.kmNum[s.r0], km1: pj.kmNum[s.r1], from: s.from, id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), to: E.propTo, note: E.propNote.trim(), t: new Date().toISOString() };
      const r = addProposta(E.props, rec, pj.kmNum);
      E.props = r.list;
      r.removidas.forEach((id) => db.apagar('props', id));
      r.novas.forEach(gravarProp);
    }
    E.propSel = [];
    E.propNote = '';
    refreshProp();
    refreshPropLayers();
    renderNotes();
    if (!aplicadas) toast('Nenhuma proposta aplicada: a planilha mudou depois da seleção. Selecione o trecho de novo.', 5000);
    else toast(`${aplicadas} proposta${aplicadas > 1 ? 's' : ''} aplicada${aplicadas > 1 ? 's' : ''}. Veja a lista na aba Revisão`);
  };
}

/** Salva o vínculo pelo nome da planilha e pelo km. Índices, pid e marca de órfã são derivados e não vão para o banco. */
function gravarProp(r: Proposta) {
  const { pid: _pid, orfa: _orfa, r0: _r0, r1: _r1, ...c } = r;
  void _pid; void _orfa; void _r0; void _r1;
  db.gravar('props', c);
}

function polysFor(s: Alvo) {
  const p = getP(s.pid ?? ''), out: GeoJSON.Feature[] = [];
  if (!p) return out;
  for (let i = s.r0; i <= s.r1; i++) {
    const f = p.polyByFid.get(i * 8 + (s.lane || 7));
    if (f) out.push(f);
  }
  return out;
}

export function refreshPropLayers() {
  if (!E.mapReady) return;
  const pf: GeoJSON.Feature[] = [];
  for (const s of E.props) {
    const p = getP(s.pid ?? '');
    if (!p || !p.visible) continue;
    for (const f of polysFor(s)) pf.push({ type: 'Feature', properties: { to: s.to }, geometry: f.geometry });
  }
  setData('props', { type: 'FeatureCollection', features: pf });
  const sf: GeoJSON.Feature[] = [];
  for (const s of E.propSel) for (const f of polysFor(s)) sf.push({ type: 'Feature', properties: {}, geometry: f.geometry });
  setData('psel', { type: 'FeatureCollection', features: sf });
}

function propsHtml(): string {
  const vp = E.props.filter((r) => getP(r.pid ?? '')).sort((a, b) => a.pname.localeCompare(b.pname) || a.lane - b.lane || a.r0 - b.r0);
  const sum: Record<string, { len: number; area: number }> = {};
  let tl = { len: 0, area: 0 };
  for (const r of vp) {
    const q = runStats(getP(r.pid!)!, r), s = (sum[r.to] = sum[r.to] || { len: 0, area: 0 });
    s.len += q.len; s.area += q.area; tl = { len: tl.len + q.len, area: tl.area + q.area };
  }
  const orfas = E.props.filter((r) => r.orfa);
  const semPlanilha = E.props.filter((r) => !r.orfa && !r.pid).length;
  const orfasHtml = orfas.length ? `<div><div class="sect">Propostas órfãs <span style="text-transform:none;font-weight:500">${orfas.length}</span></div>
    <p class="note" style="margin-bottom:8px">O km (ou a faixa) dessas propostas não existe mais na planilha carregada. Elas ficam guardadas e fora do mapa e dos totais até você removê-las.</p>
    <div class="list">${orfas.map((r) => `<div class="note-card"><div class="note-top" style="cursor:default"><span class="sw" style="background:${tc(r.to)};width:12px;height:12px"></span><span class="t"><b>${esc(trLabel(r.from))} → ${esc(trLabel(r.to))}</b><span>Órfã · ${E.privacidade ? 'planilha não carregada' : esc(r.pname)} · ${r.lane ? 'Fx ' + r.lane : 'Acost.'} · km ${kmFmt(r.km0)} a ${kmFmt(r.km1 + 0.02)}${r.note ? ' · ' + esc(r.note) : ''}</span></span></div><div class="btns"><button class="btn d" data-pd="${r.id}" style="min-height:28px;padding:3px 10px">${IC.trash} Remover</button></div></div>`).join('')}</div></div>` : '';
  const aviso = semPlanilha ? `<p class="note" style="margin-top:8px">${semPlanilha} proposta${semPlanilha > 1 ? 's' : ''} de planilhas ainda não carregadas. ${semPlanilha > 1 ? 'Voltam' : 'Volta'} ao abrir o arquivo.</p>` : '';
  const head = `<div class="sect">Propostas de solução <span style="text-transform:none;font-weight:500">${vp.length}</span></div>`;
  if (!vp.length) {
    return `${orfasHtml}<div>${head}<p class="vazio">Nenhuma proposta. <button class="linkbtn" id="pStart" type="button">Propor solução</button> (N)</p>${aviso}</div>`;
  }
  const cards = vp.map((r) => {
    const p = getP(r.pid!)!, q = runStats(p, r);
    return `<div class="note-card"><button class="note-top" data-pf="${r.id}"><span class="sw" style="background:${tc(r.to)};width:12px;height:12px"></span><span class="t"><b>${esc(trLabel(r.from))} → ${esc(trLabel(r.to))}</b><span>${esc(projName(p))} · ${r.lane ? 'Fx ' + r.lane : 'Acost.'} · ${runLabel(p, r)} · ${fmt(q.len, 0)} m · ${fmt(q.area, 0)} m²${r.note ? ' · ' + esc(r.note) : ''}</span></span></button><div class="btns"><button class="btn d" data-pd="${r.id}" style="min-height:28px;padding:3px 10px">${IC.trash} Remover</button></div></div>`;
  }).join('');
  const rows = Object.entries(sum).map(([k, v]) => `<div class="row"><span class="sw" style="background:${tc(k)}"></span><div class="grow">${esc(trLabel(k))}</div><div class="val num">${fmt(v.area, 0)} <span class="muted" style="font-weight:400;font-size:var(--fs-meta)">m² · ${fmt(v.len / 1000, 2)} km·faixa</span></div></div>`).join('');
  return `${orfasHtml}<div>${head}<div class="list">${cards}</div>
    <div class="list" style="margin-top:8px">${rows}<div class="row"><div class="grow muted">Total proposto</div><div class="val num">${fmt(tl.area, 0)} <span class="muted" style="font-weight:400;font-size:var(--fs-meta)">m²</span></div></div></div>
    <div class="btns" style="margin-top:8px"><button class="btn" id="pCsv">Copiar tabela (CSV)</button><button class="btn" id="pCsvDown">Baixar CSV</button><button class="btn d" id="pAll">Limpar todas</button></div>${aviso}</div>`;
}

function bindProps(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('[data-pf]').forEach((b) => (b.onclick = () => {
    const r = E.props.find((x) => x.id === b.dataset.pf), p = r && getP(r.pid ?? '');
    if (!r || !p) return;
    const row = p.rows[Math.round((r.r0 + r.r1) / 2)];
    getMap().flyTo({ center: [row.lon, row.lat], zoom: Math.max(getMap().getZoom(), 16.5), duration: 800 });
  }));
  el.querySelectorAll<HTMLElement>('[data-pd]').forEach((b) => (b.onclick = () => {
    E.props = E.props.filter((x) => x.id !== b.dataset.pd);
    db.apagar('props', b.dataset.pd!);
    refreshPropLayers();
    renderNotes();
    toast('Proposta removida');
  }));
  const st = el.querySelector<HTMLElement>('#pStart');
  if (st) st.onclick = () => { if (E.tool !== 'prop') setTool('prop'); };
  const all = el.querySelector<HTMLElement>('#pAll');
  if (all) all.onclick = () => {
    if (all.dataset.c !== '1') {
      all.dataset.c = '1';
      all.textContent = 'Confirmar remoção';
      setTimeout(() => { if (all.isConnected) { all.dataset.c = ''; all.textContent = 'Limpar todas'; } }, 3500);
      return;
    }
    E.props.forEach((r) => db.apagar('props', r.id));
    E.props = [];
    refreshPropLayers();
    renderNotes();
    toast('Propostas removidas');
  };
  const cv = el.querySelector<HTMLElement>('#pCsv');
  const eixo: EixoCsv = (p, r) => eixoDaFaixa(p as unknown as AppProj, r.lane, r.r0, r.r1);
  const csv = (eol: string) => propostasCsv(E.props.filter((r) => !r.orfa), (id) => getP(id ?? ''), projName, trLabel, eixo, eol);
  if (cv) cv.onclick = () => copiar(csv('\n'), 'Tabela copiada. Cole no Excel');
  const dn = el.querySelector<HTMLElement>('#pCsvDown');
  if (dn) dn.onclick = () => {
    // BOM UTF-8 para o Excel reconhecer os acentos; separador ";" e vírgula decimal
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\uFEFF', csv('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = nomeArquivoCsv();
      document.body.appendChild(a); a.click(); a.remove();
      const z = E.P[0]?.crs;
      toast(`${nomeArquivoCsv()} gerado${z ? `. Coordenadas em SIRGAS 2000, UTM fuso ${z.zone}S` : ''}`, 4500);
    } catch { toast('Download indisponível aqui. Use Copiar tabela.'); }
  };
}

/* ---------------------------------------------------------------- */
/* Anotações                                                         */
/* ---------------------------------------------------------------- */
const noteGeom = (n: Nota): GeoJSON.Geometry =>
  n.type === 'pin' ? { type: 'Point', coordinates: n.coords[0] } : n.type === 'line' ? { type: 'LineString', coordinates: n.coords } : { type: 'Polygon', coordinates: [n.coords.concat([n.coords[0]])] };

export function startNote(type: Nota['type'], coords: number[][]) {
  const c = coords[0], loc = localizar(E.P as LocP[], c[1], c[0]);
  E.editing = {
    id: 'n' + Date.now().toString(36), type, coords, cat: 'obs', text: '', photos: [], t: new Date().toISOString(), isNew: true,
    loc: loc && loc.out < 60 && loc.lane !== null ? { pid: loc.p.id, name: projName(loc.p as AppProj), km: loc.p.kmLab[loc.i], lane: loc.lane } : null,
  };
  setTab('notas');
  renderNotes();
  refreshNotesLayer();
}

export function refreshNotesLayer() {
  const contador = document.getElementById('ppN');
  if (contador) contador.textContent = String(E.notes.length);
  if (!E.mapReady) return;
  const lista = E.notes.filter((n) => !E.editing || E.editing.id !== n.id || !E.editing.isNew).concat(E.editing ? [E.editing] : []);
  setData('notes', { type: 'FeatureCollection', features: lista.map((n) => ({ type: 'Feature', properties: { id: n.id, cat: n.cat }, geometry: noteGeom(n) })) });
}

/** Planilha e km de uma nota. No modo privacidade, refeitos com o nome e o km ocultos (a nota guarda os reais). */
const locDe = (loc: NonNullable<Nota['loc']>) => {
  if (!E.privacidade) return loc;
  const p = getP(loc.pid), k = parseKmTexto(loc.km);
  return { ...loc, name: p ? projName(p) : 'Planilha', km: k === null ? '' : kmFmt(k) };
};
const noteSummary = (n: Nota) => (n.type === 'pin' ? 'Ponto' : n.type === 'line' ? `Linha · ${fmtLen(lenM(n.coords))}` : `Área · ${fmt(areaM2(n.coords), 0)} m²`);

/** Verificação de qualidade das coordenadas (Planservi): pontos reconstruídos, cortes, saltos que restaram, distância entre sentidos e
 *  polígonos desenhados só como linha central, com o km de cada ocorrência. A planilha original não é alterada. */
const qualAbertas = new Set<string>();
const MAX_OC = 60;
const ROT_TIPO: Record<string, string> = { repetido: 'ponto repetido', salto: 'salto', retrocedendo: 'retrocedendo', inicial: 'ponto inicial', final: 'ponto final' };
const ROT_INV: Record<string, string> = { curto: 'segmento com menos de 1 m', cruzado: 'polígono cruzado', 'sem-area': 'polígono sem área' };
/** Planilhas sem ocorrência ficam escondidas quando há ocorrências em outras (menos que o usuário peça para mostrar). */
let mostrarVazias = false;
function ocorrenciasHtml(): string {
  const rapidas = E.notes.filter((n) => n.rapida) as Nota[];
  const doProjeto = (id: string) => rapidas.filter((n) => n.loc?.pid === id && getP(id));
  const com = E.P.filter((p) => p.qualidade || p.camadas.invalidos?.length || doProjeto(p.id).length);
  // notas fora do trecho, sem planilha ou de planilha que já saiu da lista: um grupo por nome
  const orfas = new Map<string, Nota[]>();
  for (const n of rapidas) if (!(n.loc && getP(n.loc.pid))) { const k = n.rapida!.planilha ?? ''; (orfas.get(k) ?? orfas.set(k, []).get(k)!).push(n); }
  if (!com.length && !orfas.size) return '';
  const grupos: { n: number; html: string }[] = [];
  const notasHtml = (ns: Nota[]) => ns.slice().sort((a, b) => b.t.localeCompare(a.t)).map(itemNotaHtml).join('');
  for (const p of com) {
    const q = p.qualidade, inv = p.camadas.invalidos ?? [], notas = doProjeto(p.id) as Nota[];
    const corr = q?.corrigidos ?? [], cortes = q?.cortes ?? [], saltos = q?.saltos ?? [], sentidos = q?.sentidos ?? [];
    const nq = corr.length + cortes.length + saltos.length + sentidos.length + inv.length, n = nq + notas.length;
    const oc = (i: number, km: string, rot: string) => `<button class="row" data-q="${p.id}:${i}" aria-label="Ir ao km ${esc(km)}"><div class="grow"><b class="num">km ${esc(km)}</b> <span class="muted">${esc(rot)}</span></div>${IC.next}</button>`;
    const nbr = (v: number) => v.toLocaleString('pt-BR');
    const K = (i: number, real: string) => (E.privacidade ? p.kmLab[Math.max(0, Math.min(i, p.kmLab.length - 1))] : real);
    const itens = [
      ...corr.map((x) => oc(x.i, K(x.i, x.km), `${ROT_TIPO[x.tipo] ?? x.tipo}${x.causa && x.causa !== 'terminal' ? ' (' + (ROT_TIPO[x.causa] ?? x.causa) + ')' : ''}, andou ${nbr(x.deslocamento)} m em relação à planilha`)),
      ...cortes.map((x) => oc(x.i, K(x.i, x.kmFim), `corte: passo de ${nbr(x.dist)} m entre o km ${K(x.i - 1, x.km)} e o ${K(x.i, x.kmFim)} (esperado ${nbr(x.esperado)} m)`)),
      ...saltos.map((x) => oc(x.i, K(x.i, x.kmFim), `salto de ${nbr(x.dist)} m até o km ${K(x.i, x.kmFim)}`)),
      ...sentidos.map((x) => oc(x.i, K(x.i, x.km), `${x.dist} m entre os sentidos`)),
      ...inv.map((x) => oc(x.row, p.kmLab[x.row], `${ROT_INV[x.motivo] ?? x.motivo}${x.lane ? ' na Fx ' + x.lane : ' no acostamento'}: só a linha central`)),
    ];
    const resumo = [
      notas.length ? `${notas.length} nota${notas.length === 1 ? '' : 's'}` : '',
      corr.length ? `${corr.length} corrigida${corr.length === 1 ? '' : 's'}` : '',
      cortes.length ? `${cortes.length} corte${cortes.length === 1 ? '' : 's'}` : '',
      saltos.length ? `${saltos.length} salto${saltos.length === 1 ? '' : 's'} fora de ${q!.faixaSalto[0]} a ${q!.faixaSalto[1]} m` : '',
      sentidos.length ? `${sentidos.length} acima de ${q!.maxSentidos} m entre os sentidos` : '',
      inv.length ? `${inv.length} polígono${inv.length === 1 ? '' : 's'} só em linha` : '',
    ].filter(Boolean).join(' · ') || 'Nenhuma ocorrência';
    const corpo = n ? `<div class="list" style="margin-top:8px">${notasHtml(notas)}${itens.slice(0, MAX_OC).join('')}${itens.length > MAX_OC ? `<p class="note" style="padding:8px 10px;margin:0">e mais ${itens.length - MAX_OC} ocorrências, no log da aba Ajustes.</p>` : ''}</div>` : '<p class="vazio" style="margin-top:8px">Nenhuma ocorrência.</p>';
    grupos.push({ n, html: `<details class="qual" data-qp="${p.id}"><summary><span><b>${esc(projName(p))}</b><span class="muted num" style="display:block;font-size:var(--fs-meta);font-weight:400">${esc(resumo)}</span></span><span class="num ${n ? '' : 'muted'}">${n}</span></summary>${corpo}</details>` });
  }
  for (const [nome, ns] of orfas) {
    const titulo = E.privacidade || !nome ? 'Fora do trecho ou sem planilha' : nome;
    grupos.push({ n: ns.length, html: `<details class="qual" data-qp="orf:${esc(nome)}"><summary><span><b>${esc(titulo)}</b><span class="muted num" style="display:block;font-size:var(--fs-meta);font-weight:400">${ns.length} nota${ns.length === 1 ? '' : 's'}</span></span><span class="num">${ns.length}</span></summary><div class="list" style="margin-top:8px">${notasHtml(ns)}</div></details>` });
  }
  const algumaComOcorrencia = grupos.some((g) => g.n > 0), vazias = grupos.filter((g) => g.n === 0).length;
  const visiveis = algumaComOcorrencia && !mostrarVazias ? grupos.filter((g) => g.n > 0) : grupos;
  const alternar = algumaComOcorrencia && vazias ? `<button type="button" class="btn" id="qVazias" style="margin-top:6px">${mostrarVazias ? 'Esconder' : 'Mostrar'} planilhas sem ocorrências (${vazias})</button>` : '';
  return `<div><div class="sect">Ocorrências</div>${visiveis.map((g) => g.html).join('')}${alternar}<p class="note" style="margin-top:7px">Notas de campo e pontos reconstruídos pelo km quando a coordenada da planilha estava repetida, saltando ou retrocedendo. A planilha original não muda. O mesmo resumo está no log da aba Ajustes.</p></div>`;
}

/** Exportar as notas: planilha (principal), CSV e compartilhar. */
function exportarHtml(): string {
  const n = E.notes.length, novas = notasNovasSemExportar();
  const lembrete = precisaLembrar(novas) ? `<p class="nrl-lembrete" style="margin-bottom:8px">${novas} notas novas sem exportar. Baixe a planilha para guardar uma cópia.</p>` : '';
  return `<div><div class="sect">Exportar notas <span style="text-transform:none;font-weight:500">${n}</span></div>${lembrete}
    <div class="btns"><button class="btn p" id="exXlsx" ${n ? '' : 'disabled'}>Baixar planilha (.xlsx)</button><button class="btn" id="exCsv" ${n ? '' : 'disabled'}>Baixar CSV</button><button class="btn" id="exShare" ${n ? '' : 'disabled'}>Compartilhar</button></div>
    <p class="note" style="margin-top:7px">As notas ficam neste aparelho e funcionam sem internet. A planilha traz data, hora, local, coordenadas em graus e UTM.</p></div>`;
}

export function renderNotes() {
  const el = document.getElementById('t-notas');
  if (!el) return;
  const ed = E.editing;
  const form = ed ? `<div class="list"><div class="note-card">
      <div class="sect" style="margin:0">${ed.isNew ? 'Nova nota' : 'Editar nota'} · ${noteSummary(ed)}</div>
      ${ed.loc ? `<div class="chips"><span class="chip">${esc(locDe(ed.loc).name)} · km ${esc(locDe(ed.loc).km)} · ${ed.loc.lane ? 'Fx ' + ed.loc.lane : 'Acost.'}</span></div>` : '<p class="note">Fora dos trechos carregados.</p>'}
      <div class="seg" id="catSeg" role="group" aria-label="Categoria" style="align-self:flex-start">${Object.entries(NOTE_CATS).map(([k, v]) => `<button data-c="${k}" aria-pressed="${ed.cat === k}">${v.l}</button>`).join('')}</div>
      <textarea id="noteText" placeholder="Descreva a ocorrência, a dúvida ou a decisão" aria-label="Texto da nota">${esc(ed.text)}</textarea>
      <div class="photos">${ed.photos.map((src, i) => `<div><img src="${src}" alt="Foto ${i + 1}"><button data-ph="${i}" aria-label="Remover foto">${IC.x}</button></div>`).join('')}</div>
      <div class="btns"><button class="btn" id="nPhoto">${IC.cam} Foto</button><button class="btn p" id="nSave">Salvar</button><button class="btn" id="nCancel">${ed.isNew ? 'Descartar' : 'Fechar'}</button>${ed.isNew ? '' : `<button class="btn d" id="nDel">${IC.trash} Excluir</button>`}</div></div></div>` : '';
  const list = E.notes.filter((n) => !n.rapida && (!ed || n.id !== ed.id)).sort((a, b) => b.t.localeCompare(a.t));
  el.innerHTML = `${form}${propsHtml()}${ocorrenciasHtml()}
    <div><div class="sect">Anotações <span style="text-transform:none;font-weight:500">${E.notes.filter((n) => !n.rapida).length}</span></div>
      ${list.length ? `<div class="list">${list.map((n) => `<div class="note-card"><button class="note-top" data-n="${n.id}"><span class="sw" style="background:${NOTE_CATS[n.cat].c};width:12px;height:12px"></span>
        <span class="t"><b>${esc(n.text || 'Sem texto')}</b><span>${NOTE_CATS[n.cat].l} · ${noteSummary(n)}${n.loc ? ' · ' + esc(locDe(n.loc).name) + ' km ' + esc(locDe(n.loc).km) : ''} · ${new Date(n.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${n.photos?.length ? ' · ' + n.photos.length + ' foto(s)' : ''}</span></span></button></div>`).join('')}</div>`
        : (ed ? '' : '<p class="vazio">Nenhuma anotação. Use o ponto no mapa (P).</p>')}</div>
    ${exportarHtml()}`;

  if (ed) {
    const txt = () => { ed.text = $<HTMLTextAreaElement>('#noteText').value; };
    syncSeg($('#catSeg'));
    el.querySelectorAll<HTMLElement>('#catSeg button').forEach((b) => (b.onclick = () => { txt(); ed.cat = b.dataset.c as NoteCat; renderNotes(); refreshNotesLayer(); }));
    $('#nPhoto').onclick = () => { txt(); if (ed.photos.length >= 4) { toast('Limite de 4 fotos por nota'); return; } $('#photoIn').click(); };
    el.querySelectorAll<HTMLElement>('[data-ph]').forEach((b) => (b.onclick = () => { txt(); ed.photos.splice(+b.dataset.ph!, 1); renderNotes(); }));
    $('#nSave').onclick = () => {
      ed.text = $<HTMLTextAreaElement>('#noteText').value.trim();
      const n: Nota = { ...ed };
      delete n.isNew;
      const ix = E.notes.findIndex((x) => x.id === n.id);
      if (ix >= 0) E.notes[ix] = n; else E.notes.push(n);
      db.gravar('notes', n);
      E.editing = null;
      refreshNotesLayer(); renderNotes(); toast('Nota salva');
    };
    $('#nCancel').onclick = () => { E.editing = null; refreshNotesLayer(); renderNotes(); };
    const dl = document.getElementById('nDel');
    if (dl) dl.onclick = () => { E.notes = E.notes.filter((x) => x.id !== ed.id); db.apagar('notes', ed.id); E.editing = null; refreshNotesLayer(); renderNotes(); toast('Nota excluída'); };
  }
  el.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => (b.onclick = () => openNote(b.dataset.n!)));
  el.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => (b.onclick = () => { const [pid, i] = b.dataset.q!.split(':'); const r = getP(pid)?.rows[+i]; if (!r) return; getMap().flyTo({ center: [r.lon, r.lat], zoom: Math.max(getMap().getZoom(), 17.2), duration: 800 }); select(pid, +i, 1, { tab: false }); }));
  // as listas abertas continuam abertas quando o painel é refeito
  el.querySelectorAll<HTMLDetailsElement>('details.qual').forEach((d) => { if (qualAbertas.has(d.dataset.qp!)) d.open = true; d.addEventListener('toggle', () => { d.open ? qualAbertas.add(d.dataset.qp!) : qualAbertas.delete(d.dataset.qp!); }); });
  bindProps(el);
  bindItensNotas(el);
  const vz = document.getElementById('qVazias');
  if (vz) vz.onclick = () => { mostrarVazias = !mostrarVazias; renderNotes(); };
  $('#exXlsx').onclick = () => void baixarXlsx();
  $('#exCsv').onclick = () => baixarCsv();
  $('#exShare').onclick = () => void compartilharNotas();
}

export function openNote(id: string) {
  const n = E.notes.find((x) => x.id === id);
  if (!n) return;
  E.editing = { ...n, photos: (n.photos || []).slice() };
  renderNotes();
  setTab('notas');
  refreshNotesLayer();
  getMap().flyTo({ center: n.coords[0] as [number, number], zoom: Math.max(getMap().getZoom(), 17), duration: 700 });
}

/** "Backup (.json)": as notas deste aparelho em GeoJSON, com fotos e os campos das notas rápidas, para restaurar depois. */
export function baixarBackup() {
  if (!E.notes.length) { toast('Nenhuma nota para fazer backup'); return; }
  try {
    const d = new Date(), z = (v: number) => String(v).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(notesGeoJSON(true))], { type: 'application/json' }));
    a.download = `pavecad-backup-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup gerado');
  } catch { toast('Download indisponível aqui'); }
}

export function notesGeoJSON(withPhotos: boolean) {
  return {
    type: 'FeatureCollection',
    features: E.notes.map((n) => ({
      type: 'Feature',
      properties: { id: n.id, categoria: NOTE_CATS[n.cat].l, texto: n.text, criado: n.t, planilha: n.loc ? locDe(n.loc).name : null, km: n.loc ? locDe(n.loc).km : null, faixa: n.loc?.lane ?? null, ...(withPhotos ? { fotos: n.photos } : { fotos_qtd: (n.photos || []).length }), ...(n.rapida ? { rapida: n.rapida, local: n.loc } : {}) },
      geometry: noteGeom(n),
    })),
  };
}

export function importarNotas(gj: { features?: { geometry?: GeoJSON.Geometry; properties?: Record<string, unknown> }[] }): number {
  let c = 0;
  for (const ft of gj.features || []) {
    const g = ft.geometry, pr = ft.properties || {};
    if (!g) continue;
    const type = g.type === 'Point' ? 'pin' : g.type === 'LineString' ? 'line' : g.type === 'Polygon' ? 'area' : null;
    if (!type) continue;
    const coords = type === 'pin' ? [(g as GeoJSON.Point).coordinates] : type === 'line' ? (g as GeoJSON.LineString).coordinates : (g as GeoJSON.Polygon).coordinates[0].slice(0, -1);
    const cat = (Object.keys(NOTE_CATS) as NoteCat[]).find((k) => NOTE_CATS[k].l === pr.categoria) ?? 'obs';
    const n: Nota = { id: 'n' + Date.now().toString(36) + c, type, coords, cat, text: String(pr.texto ?? ''), photos: (pr.fotos as string[]) ?? [], t: String(pr.criado ?? new Date().toISOString()), loc: (pr.local as Nota['loc']) ?? null, ...(pr.rapida ? { rapida: pr.rapida as Nota['rapida'] } : {}) };
    E.notes.push(n);
    db.gravar('notes', n);
    c++;
  }
  return c;
}

/** Carrega do IndexedDB e liga os controles. */
export async function initRevisao() {
  E.notes = await db.todos<Nota>('notes');
  E.props = (await db.todos<Proposta>('props')).map((r) => ({ ...r, pid: null, orfa: false }));
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as typeof E.tool)));
  H.onNoteHit = openNote;

  $<HTMLInputElement>('#importIn').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try { const c = importarNotas(JSON.parse(String(fr.result))); refreshNotesLayer(); renderNotes(); toast(`${c} anotação(ões) importada(s)`); }
      catch { toast('Arquivo inválido'); }
      input.value = '';
    };
    fr.readAsText(f);
  });

  $<HTMLInputElement>('#photoIn').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f || !E.editing) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      E.editing?.photos.push(c.toDataURL('image/jpeg', 0.72));
      URL.revokeObjectURL(url);
      renderNotes();
    };
    img.onerror = () => toast('Não foi possível ler a imagem');
    img.src = url;
  });
}
