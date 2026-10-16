import type { MapMouseEvent } from 'maplibre-gl';
import { areaM2, fmtLen, lenM } from '../dominio/medidas';
import { addProposta, propostasCsv, reposicionar, runAt, runLabel, runStats, type Alvo, type Proposta } from '../dominio/propostas';
import { localizar, type LocP } from '../dominio/localizar';
import { trColor, trLabel, trOrder } from '../dominio/solucoes';
import { kmLabel } from '../formats/km';
import { E, H, NOTE_CATS, getP, projName, type AppProj, type Nota, type NoteCat } from './estado';
import { IC } from './icones';
import { getMap, hitAt, setData } from './mapa';
import * as db from './persist';
import { setTab } from './paineis';
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
}

/** Cliques com ferramenta ativa. */
export function onToolClick(e: MapMouseEvent): boolean {
  if (E.tool === 'pin') {
    const c = [+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)];
    setTool(null);
    startNote('pin', [c]);
    return true;
  }
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
    <div class="list">${orfas.map((r) => `<div class="note-card"><div class="note-top" style="cursor:default"><span class="sw" style="background:${tc(r.to)};width:12px;height:12px"></span><span class="t"><b>${esc(trLabel(r.from))} → ${esc(trLabel(r.to))}</b><span>Órfã · ${esc(r.pname)} · ${r.lane ? 'Fx ' + r.lane : 'Acost.'} · km ${kmLabel(r.km0)} a ${kmLabel(r.km1 + 0.02)}${r.note ? ' · ' + esc(r.note) : ''}</span></span></div><div class="btns"><button class="btn d" data-pd="${r.id}" style="min-height:28px;padding:3px 10px">${IC.trash} Remover</button></div></div>`).join('')}</div></div>` : '';
  const aviso = semPlanilha ? `<p class="note" style="margin-top:8px">${semPlanilha} proposta${semPlanilha > 1 ? 's' : ''} de planilhas ainda não carregadas. ${semPlanilha > 1 ? 'Voltam' : 'Volta'} ao abrir o arquivo.</p>` : '';
  const head = `<div class="sect">Propostas de solução <span style="text-transform:none;font-weight:500">${vp.length}</span></div>`;
  if (!vp.length) {
    return `${orfasHtml}<div>${head}<div class="empty" style="padding:14px 8px"><b>Nenhuma proposta</b>Use o botão de propor solução no alto do mapa, clique em uma solução ou em vários trechos e escolha a nova.</div><div class="btns"><button class="btn p" id="pStart">Propor solução</button></div>${aviso}</div>`;
  }
  const cards = vp.map((r) => {
    const p = getP(r.pid!)!, q = runStats(p, r);
    return `<div class="note-card"><button class="note-top" data-pf="${r.id}"><span class="sw" style="background:${tc(r.to)};width:12px;height:12px"></span><span class="t"><b>${esc(trLabel(r.from))} → ${esc(trLabel(r.to))}</b><span>${esc(projName(p))} · ${r.lane ? 'Fx ' + r.lane : 'Acost.'} · ${runLabel(p, r)} · ${fmt(q.len, 0)} m · ${fmt(q.area, 0)} m²${r.note ? ' · ' + esc(r.note) : ''}</span></span></button><div class="btns"><button class="btn d" data-pd="${r.id}" style="min-height:28px;padding:3px 10px">${IC.trash} Remover</button></div></div>`;
  }).join('');
  const rows = Object.entries(sum).map(([k, v]) => `<div class="row"><span class="sw" style="background:${tc(k)}"></span><div class="grow">${esc(trLabel(k))}</div><div class="val num">${fmt(v.area, 0)} <span class="muted" style="font-weight:400;font-size:11px">m² · ${fmt(v.len / 1000, 2)} km·faixa</span></div></div>`).join('');
  return `${orfasHtml}<div>${head}<div class="list">${cards}</div>
    <div class="list" style="margin-top:8px">${rows}<div class="row"><div class="grow muted">Total proposto</div><div class="val num">${fmt(tl.area, 0)} <span class="muted" style="font-weight:400;font-size:11px">m²</span></div></div></div>
    <div class="btns" style="margin-top:8px"><button class="btn" id="pCsv">Copiar tabela (CSV)</button><button class="btn d" id="pAll">Limpar todas</button></div>${aviso}</div>`;
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
  if (cv) cv.onclick = () => copiar(propostasCsv(E.props, (id) => getP(id ?? ''), projName, trLabel), 'Tabela copiada. Cole no Excel');
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
  if (!E.mapReady) return;
  const lista = E.notes.filter((n) => !E.editing || E.editing.id !== n.id || !E.editing.isNew).concat(E.editing ? [E.editing] : []);
  setData('notes', { type: 'FeatureCollection', features: lista.map((n) => ({ type: 'Feature', properties: { id: n.id, cat: n.cat }, geometry: noteGeom(n) })) });
}

const noteSummary = (n: Nota) => (n.type === 'pin' ? 'Ponto' : n.type === 'line' ? `Linha · ${fmtLen(lenM(n.coords))}` : `Área · ${fmt(areaM2(n.coords), 0)} m²`);

export function renderNotes() {
  const el = document.getElementById('t-notas');
  if (!el) return;
  const ed = E.editing;
  const form = ed ? `<div class="list"><div class="note-card">
      <div class="sect" style="margin:0">${ed.isNew ? 'Nova nota' : 'Editar nota'} · ${noteSummary(ed)}</div>
      ${ed.loc ? `<div class="chips"><span class="chip">${esc(ed.loc.name)} · km ${esc(ed.loc.km)} · ${ed.loc.lane ? 'Fx ' + ed.loc.lane : 'Acost.'}</span></div>` : '<p class="note">Fora dos trechos carregados.</p>'}
      <div class="seg" id="catSeg" role="group" aria-label="Categoria" style="align-self:flex-start">${Object.entries(NOTE_CATS).map(([k, v]) => `<button data-c="${k}" aria-pressed="${ed.cat === k}">${v.l}</button>`).join('')}</div>
      <textarea id="noteText" placeholder="Descreva a ocorrência, a dúvida ou a decisão" aria-label="Texto da nota">${esc(ed.text)}</textarea>
      <div class="photos">${ed.photos.map((src, i) => `<div><img src="${src}" alt="Foto ${i + 1}"><button data-ph="${i}" aria-label="Remover foto">${IC.x}</button></div>`).join('')}</div>
      <div class="btns"><button class="btn" id="nPhoto">${IC.cam} Foto</button><button class="btn p" id="nSave">Salvar</button><button class="btn" id="nCancel">${ed.isNew ? 'Descartar' : 'Fechar'}</button>${ed.isNew ? '' : `<button class="btn d" id="nDel">${IC.trash} Excluir</button>`}</div></div></div>` : '';
  const list = E.notes.filter((n) => !ed || n.id !== ed.id).sort((a, b) => b.t.localeCompare(a.t));
  el.innerHTML = `${form}${propsHtml()}
    <div><div class="sect">Anotações <span style="text-transform:none;font-weight:500">${E.notes.length}</span></div>
      ${list.length ? `<div class="list">${list.map((n) => `<div class="note-card"><button class="note-top" data-n="${n.id}"><span class="sw" style="background:${NOTE_CATS[n.cat].c};width:12px;height:12px"></span>
        <span class="t"><b>${esc(n.text || 'Sem texto')}</b><span>${NOTE_CATS[n.cat].l} · ${noteSummary(n)}${n.loc ? ' · ' + esc(n.loc.name) + ' km ' + esc(n.loc.km) : ''} · ${new Date(n.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${n.photos?.length ? ' · ' + n.photos.length + ' foto(s)' : ''}</span></span></button></div>`).join('')}</div>`
        : (ed ? '' : '<div class="empty"><b>Nenhuma anotação</b>Use a ferramenta de ponto no alto do mapa. As notas ficam neste aparelho.</div>')}</div>
    <div><div class="sect">Exportar e importar</div><div class="btns"><button class="btn" id="exCopy" ${E.notes.length ? '' : 'disabled'}>Copiar GeoJSON</button><button class="btn" id="exDown" ${E.notes.length ? '' : 'disabled'}>Baixar</button><button class="btn" id="exImp">Importar</button></div>
      <p class="note" style="margin-top:7px">As anotações ficam no armazenamento deste navegador. Exporte para levar a outro aparelho ou compartilhar.</p></div>`;

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
  bindProps(el);
  $('#exCopy').onclick = () => copiar(JSON.stringify(notesGeoJSON(false), null, 1), 'GeoJSON copiado');
  $('#exDown').onclick = () => {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(notesGeoJSON(true))], { type: 'application/geo+json' }));
      a.download = 'anotacoes-pavecad.geojson';
      document.body.appendChild(a); a.click(); a.remove();
      toast('Arquivo gerado');
    } catch { toast('Download indisponível aqui. Use Copiar GeoJSON.'); }
  };
  $('#exImp').onclick = () => $('#importIn').click();
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

export function notesGeoJSON(withPhotos: boolean) {
  return {
    type: 'FeatureCollection',
    features: E.notes.map((n) => ({
      type: 'Feature',
      properties: { id: n.id, categoria: NOTE_CATS[n.cat].l, texto: n.text, criado: n.t, planilha: n.loc?.name ?? null, km: n.loc?.km ?? null, faixa: n.loc?.lane ?? null, ...(withPhotos ? { fotos: n.photos } : { fotos_qtd: (n.photos || []).length }) },
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
    const n: Nota = { id: 'n' + Date.now().toString(36) + c, type, coords, cat, text: String(pr.texto ?? ''), photos: (pr.fotos as string[]) ?? [], t: String(pr.criado ?? new Date().toISOString()), loc: null };
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
