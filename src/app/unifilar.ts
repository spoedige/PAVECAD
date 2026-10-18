import { agruparBlocos, type Lacuna } from '../dominio/blocosUnifilar';
import { IND, Q5, Q5F } from '../dominio/indicadores';
import { trColor, trOrder } from '../dominio/solucoes';
import { E, H, kmVis, projName, rodoviaNome, type AppProj } from './estado';
import { IC } from './icones';
import { getMap, grupoAtivo, select } from './mapa';
import { $, cssv, esc, fmt, gestoVertical, toast } from './ui';
import { ehUnico } from './layout';

interface Linha { y: number; h: number; lane: number }
interface Bloco { ps: AppProj[]; titulo: string; sentido: 1 | -1; lacunas: Lacuna[]; titleY: number; rows: Linha[] }
interface Layout { x0: number; x1: number; kmi: number; kmf: number; blocks: Bloco[]; top: number }
let lay: Layout | null = null;
let ultimaSel = '';

const Q = () => (E.field ? Q5F : Q5);
const maxLanes = (ps: AppProj[]) => ps.reduce((m, p) => Math.max(m, p.rows.reduce((n, r) => Math.max(n, r.widths.length), 1)), 1);

/** Altura máxima do cartão do unifilar: 35% da tela. O que passar rola dentro do cartão. */
const FRACAO_MAX = 0.35;
/** Cabeçalho, respiros e rodapé do cartão em volta da área de desenho. */
const MOLDURA = 22 + 6 + 10 + 12 + 8;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

const card0 = () => $('#unicard');

/** Filtro de projeto no cabeçalho do unifilar. Com mais de uma rodovia, os grupos vêm sob o rótulo da rodovia; a linha rola na horizontal. */
export function renderGroups() {
  const gs = [...new Set(E.P.filter((p) => p.visible).map((p) => p.meta.uf))], el = $('#unigroups');
  const via = (g: string) => g.split('/')[0];
  const vias = [...new Set(gs.map(via))];
  const chip = (g: string, txt: string) => `<button class="chipbtn" data-g="${esc(g)}" aria-pressed="${g === E.activeGroup}" style="${g === E.activeGroup ? 'background:var(--accent);color:var(--accent-ink)' : ''}">${esc(txt)}</button>`;
  let h = '';
  if (gs.length > 1) {
    for (const v of vias) {
      const doVia = gs.filter((g) => via(g) === v);
      const comUf = doVia.some((g) => g.includes('/'));
      if (vias.length > 1 && comUf && !E.privacidade) h += `<span class="hwy">${esc(v.replace('BR-', ''))}</span>`;
      h += doVia.map((g) => chip(g, E.privacidade ? rodoviaNome(g) : !g.includes('/') ? g : vias.length > 1 ? g.split('/')[1] : g.replace('BR-', ''))).join('');
    }
  }
  el.innerHTML = h;
  el.querySelectorAll<HTMLElement>('button').forEach((b) => (b.onclick = () => { E.activeGroup = b.dataset.g!; renderGroups(); drawUni(); }));
}

/** Unifilar em canvas: uma linha por faixa, agregada por pixel pela pior classe. */
export function drawUni() {
  const cv = document.getElementById('uni') as HTMLCanvasElement | null, wrap = document.getElementById('uniwrap'), card = document.getElementById('unicard');
  if (!cv || !wrap || !card) return;
  const G = grupoAtivo(), root = document.documentElement;
  // oculto (por grupo ou pelo mapa limpo): sem altura, para o painel e o resto descerem para a base
  if (root.classList.contains('h-unifilar') || root.classList.contains('limpo')) { root.style.setProperty('--uni-h', '0px'); return; }
  if (E.uniCollapsed) { root.style.setProperty('--uni-h', '44px'); card.classList.add('collapsed'); return; }
  card.classList.remove('collapsed');
  if (!G.length) {
    root.style.setProperty('--uni-h', '90px');
    wrap.style.height = '24px';
    cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
    $('#unisub').textContent = 'Sem planilhas visíveis';
    return;
  }
  // Rótulos de 11 px no mínimo: linhas de 11 px, título da planilha com 18 px de respiro até a primeira faixa.
  const rhL = 11, gap = 2, shH = 9, titleH = 18, bgap = 6, top = 18;
  let y = top;
  const blocks: Bloco[] = [];
  for (const gb of agruparBlocos(G)) {
    const um = gb.ps.length === 1;
    const sent = gb.sentido > 0 ? 'Crescente' : 'Decrescente';
    const via = rodoviaNome(gb.ps[0].meta.uf);
    const b: Bloco = { ps: gb.ps, sentido: gb.sentido, lacunas: gb.lacunas, titulo: um ? projName(gb.ps[0]) : `${via} · ${sent} · ${gb.ps.length} planilhas`, titleY: y, rows: [] };
    y += titleH;
    for (let k = 0; k < maxLanes(gb.ps); k++) { b.rows.push({ y, h: rhL, lane: k + 1 }); y += rhL + gap; }
    if (gb.ps.some((p) => p.rows.some((r) => r.shoulder > 0))) { b.rows.push({ y, h: shH, lane: 0 }); y += shH + gap; }
    y += bgap - gap;
    blocks.push(b);
  }
  const chH = Math.ceil(y);
  // área visível: o que passa de 35% da tela rola dentro do cartão
  const visH = Math.max(60, Math.min(chH, Math.floor(innerHeight * FRACAO_MAX) - MOLDURA));
  wrap.style.height = visH + 'px';
  cv.style.height = chH + 'px';
  const target = visH + MOLDURA;
  if (root.style.getPropertyValue('--uni-h') !== target + 'px') root.style.setProperty('--uni-h', target + 'px');
  const hov = document.getElementById('unihover');
  if (hov) hov.style.height = chH + 'px';
  const dpr = devicePixelRatio || 1, W = wrap.clientWidth, H0 = chH;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H0 * dpr)) { cv.width = W * dpr; cv.height = H0 * dpr; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H0);
  const lab = 44, x0 = lab, x1 = W - 2;
  let kmi = 1e9, kmf = -1e9;
  for (const p of G) { kmi = Math.min(kmi, p.rows[0].hod); kmf = Math.max(kmf, p.rows[p.rows.length - 1].hod + 0.02); }
  kmi = Math.floor(kmi); kmf = Math.ceil(kmf);
  const sx = (km: number) => x0 + ((km - kmi) / (kmf - kmi)) * (x1 - x0);
  lay = { x0, x1, kmi, kmf, blocks, top };
  const fm = E.field ? 13 : 12, muted = cssv('--muted'), none = cssv('--none'), fill = cssv('--fill2'), sans = cssv('--sans');
  const pxKm = (x1 - x0) / (kmf - kmi), step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * pxKm >= 70) || 100, bottom = y - bgap;
  g.font = `500 ${fm}px ` + sans;
  g.textBaseline = 'alphabetic';
  for (let k = Math.ceil(kmi / step) * step; k <= kmf; k += step) {
    const x = Math.round(sx(k)), txt = kmVis(k) + ' km', tw = g.measureText(txt).width;
    g.fillStyle = muted; g.fillText(txt, Math.min(x - 8, W - tw - 1), top - 5);
    g.fillStyle = cssv('--hair'); g.fillRect(x, top - 2, 1, bottom - top + 4);
  }
  const keys = [...trOrder(), '-'], tc = (k: string) => trColor(k, E.field, none);
  const M = E.mode === 'sol' ? null : IND[E.mode];
  for (const b of blocks) {
    g.textBaseline = 'alphabetic';
    g.font = `600 ${fm}px ` + sans;
    g.fillStyle = muted;
    g.fillText(b.titulo + (b.sentido > 0 ? '  ↑' : '  ↓'), 0, b.titleY + 11);
    g.font = `500 ${fm}px ` + sans;
    g.textBaseline = 'middle';
    for (const rw of b.rows) {
      g.fillStyle = muted; g.fillText(rw.lane ? 'Fx ' + rw.lane : 'Ac.', 0, rw.y + rw.h / 2);
      g.fillStyle = fill; g.globalAlpha = 0.55; rr(g, x0, rw.y, x1 - x0, rw.h, Math.min(4, rw.h / 2)); g.fill(); g.globalAlpha = 1;
    }
    // lacuna: planilha que falta entre duas do mesmo sentido, tracejada e com o tamanho no título
    for (const lc of b.lacunas) {
      const xa = sx(lc.de), xb = sx(lc.ate), alto = b.rows[b.rows.length - 1].y + b.rows[b.rows.length - 1].h - b.rows[0].y;
      g.save(); g.setLineDash([3, 3]); g.strokeStyle = muted; g.lineWidth = 1; g.globalAlpha = 0.8;
      g.strokeRect(Math.round(xa) + 0.5, b.rows[0].y - 1.5, Math.max(1, xb - xa), alto + 3); g.restore();
      const txt = `sem dados · ${fmt(lc.ate - lc.de, 2)} km`;
      g.font = `500 ${fm}px ` + sans; g.textBaseline = 'alphabetic'; g.fillStyle = muted;
      if (g.measureText(txt).width <= xb - xa - 4) g.fillText(txt, xa + 4, b.titleY + 11);
    }
    const nPx = Math.max(1, Math.floor(x1 - x0)), sev = b.rows.map(() => new Int8Array(nPx).fill(-2));

    for (const p of b.ps) {
      const passo = Math.max(1, Math.round((0.02 / (kmf - kmi)) * nPx));
      for (let i = 0; i < p.rows.length; i++) {
        const px = Math.min(nPx - 1, Math.max(0, Math.floor(((p.rows[i].hod - kmi) / (kmf - kmi)) * nPx))), md = p.model[i], r = p.rows[i];
        b.rows.forEach((rw, ri) => {
          let s: number;
          if (rw.lane) {
            if (rw.lane > r.widths.length) return;
            if (!M) s = md.tr[rw.lane - 1].main === '-' ? -1 : Math.max(0, keys.indexOf(md.tr[rw.lane - 1].main));
            else { const v = M.value(r.lanes[rw.lane - 1]); s = v == null ? -1 : M.cls(v); }
          } else {
            if (!(r.shoulder > 0)) return;
            s = !M ? (md.sh.main === '-' ? -1 : Math.max(0, keys.indexOf(md.sh.main))) : -1;
          }
          // com pouco km na tela cada linha de 20 m ocupa vários pixels: preenche o passo inteiro, para não ficar pontilhado
          for (let q = px; q < Math.min(nPx, px + passo); q++) if (s > sev[ri][q] || sev[ri][q] === -2) sev[ri][q] = s;
        });
      }
    }
    b.rows.forEach((rw, ri) => {
      for (let q = 0; q < nPx; q++) {
        const s = sev[ri][q];
        if (s === -2) continue;
        const key = !M ? (s < 0 ? '-' : keys[s]) : String(s);
        g.globalAlpha = E.dim.has(key) ? 0.12 : 1;
        g.fillStyle = !M ? (s < 0 ? none : tc(keys[s])) : s < 0 ? none : Q()[s];
        g.fillRect(x0 + q, rw.y, 1.25, rw.h);
      }
      g.globalAlpha = 1;
    });
  }
  if (E.mapReady) {
    const bb = getMap().getBounds();
    let lo = 1e9, hi = -1e9;
    for (const p of G) for (let i = 0; i < p.rows.length; i += 2) {
      const r = p.rows[i];
      if (r.lon >= bb.getWest() && r.lon <= bb.getEast() && r.lat >= bb.getSouth() && r.lat <= bb.getNorth()) { lo = Math.min(lo, r.hod); hi = Math.max(hi, r.hod); }
    }
    if (hi >= lo) {
      const xa = sx(lo), xb = Math.max(sx(hi + 0.02), xa + 6);
      g.fillStyle = cssv('--accent'); g.globalAlpha = 0.14; rr(g, xa, top - 4, xb - xa, bottom - top + 8, 6); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = cssv('--accent'); g.lineWidth = 1.5; rr(g, xa, top - 4, xb - xa, bottom - top + 8, 6); g.stroke();
      $('#unisub').textContent = `Vista atual: km ${fmt(kmVis(lo), 1)} a ${fmt(kmVis(hi + 0.02), 1)}`;
    } else $('#unisub').textContent = 'Clique para voar até o trecho';
  }
  const s = E.sel;
  if (s) {
    const b = blocks.find((q) => q.ps.some((pp) => pp.id === s.pid));
    const ps = b?.ps.find((pp) => pp.id === s.pid);
    if (b && ps) {
      const x = sx(ps.rows[s.row].hod), rw = b.rows.find((q) => q.lane === s.lane) || b.rows[0];
      g.fillStyle = cssv('--fg'); g.fillRect(x - 0.5, top - 2, 1.5, bottom - top + 4);
      g.strokeStyle = cssv('--fg'); g.lineWidth = 1.5; rr(g, x - 3, rw.y - 1, 6, rw.h + 2, 3); g.stroke();
      // seleção fora da área visível: rola o cartão até o bloco, uma vez por seleção
      const chave = `${s.pid}:${s.row}`;
      if (chave !== ultimaSel) {
        ultimaSel = chave;
        const fimB = b.rows[b.rows.length - 1].y + b.rows[b.rows.length - 1].h + 4;
        if (b.titleY < wrap.scrollTop) wrap.scrollTop = b.titleY - 4;
        else if (fimB > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = fimB - wrap.clientHeight;
      }
    }
  }
}

/** Nomes dos projetos desenhados no unifilar, na ordem de cima para baixo (para os testes de interface). */
export const blocosDoUnifilar = () => (lay ? lay.blocks.map((b) => b.titulo) : []);
/** Lacunas desenhadas (km real), por bloco, para os testes de interface. */
export const lacunasDoUnifilar = () => (lay ? lay.blocks.flatMap((b) => b.lacunas.map((l) => ({ bloco: b.titulo, ...l }))) : []);
/** Planilhas de cada bloco, na ordem do km (para os testes de interface). */
export const planilhasDoUnifilar = () => (lay ? lay.blocks.map((b) => b.ps.map((p) => p.meta.name)) : []);

function uniHit(e: MouseEvent, uw: HTMLElement) {
  if (!lay) return null;
  const r = uw.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top + uw.scrollTop;
  if (x < lay.x0 || x > lay.x1) return null;
  const km = lay.kmi + ((x - lay.x0) / (lay.x1 - lay.x0)) * (lay.kmf - lay.kmi);
  const b = lay.blocks.find((bb) => y >= bb.titleY && y <= bb.rows[bb.rows.length - 1].y + bb.rows[bb.rows.length - 1].h + 4) || lay.blocks[0];
  let rw = b.rows[0];
  for (const q of b.rows) if (y >= q.y - 1) rw = q;
  // dentro do bloco, vale a planilha cujo ponto está mais perto do km
  let melhor: { p: AppProj; i: number; d: number } | null = null;
  for (const p of b.ps) {
    let lo = 0, hi = p.rows.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p.rows[m].hod < km) lo = m + 1; else hi = m; }
    let i = lo;
    if (i > 0 && Math.abs(p.rows[i - 1].hod - km) < Math.abs(p.rows[i].hod - km)) i--;
    const d = Math.abs(p.rows[i].hod - km);
    if (!melhor || d < melhor.d) melhor = { p, i, d };
  }
  const { p, i, d } = melhor!;
  return { x, p, i, lane: rw.lane, near: d < 0.3, multi: b.ps.length > 1 };
}

export function initUnifilar() {
  const uw = $('#uniwrap');
  uw.addEventListener('click', (e) => {
    const h = uniHit(e, uw);
    if (!h) return;
    if (!h.near) { toast('Sem dados neste ponto do trecho'); return; }
    const r = h.p.rows[h.i], m = getMap();
    m.flyTo({ center: [r.lon, r.lat], zoom: Math.max(m.getZoom(), 17.2), duration: 900 });
    select(h.p.id, h.i, h.lane, { tab: true });
  });
  uw.addEventListener('mousemove', (e) => {
    const h = uniHit(e, uw), el = $('#unihover');
    if (!h || !h.near) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = h.x + 'px';
    (el.firstElementChild as HTMLElement).style.top = uw.scrollTop + 2 + 'px';
    el.firstElementChild!.textContent = 'km ' + h.p.kmLab[h.i] + (h.multi ? ' · ' + projName(h.p) : '');
  });
  uw.addEventListener('mouseleave', () => { $('#unihover').style.display = 'none'; });
  window.addEventListener('resize', drawUni);
  if (window.ResizeObserver) new ResizeObserver(() => drawUni()).observe(uw);
  const tg = $('#uniToggle'), cab = card0().querySelector<HTMLElement>('.uni-h')!;
  try { E.uniCollapsed = localStorage.getItem('pavecad-uni') === '1'; } catch { /* sem storage */ }
  const recolher = (c: boolean) => {
    E.uniCollapsed = c;
    tg.innerHTML = (c ? IC.up : IC.down).replace('class="i"', 'class="i" style="width:14px;height:14px"');
    tg.setAttribute('aria-label', c ? 'Expandir unifilar' : 'Recolher unifilar');
    tg.setAttribute('title', c ? 'Expandir unifilar' : 'Recolher unifilar');
    try { localStorage.setItem('pavecad-uni', c ? '1' : '0'); } catch { /* sem storage */ }
    drawUni();
  };
  recolher(E.uniCollapsed);
  tg.addEventListener('click', (e) => { e.stopPropagation(); recolher(!E.uniCollapsed); });
  // o cabeçalho é o puxador (para baixo recolhe até a barra de posição, para cima ou um toque reabre)
  gestoVertical(cab, { ativo: ehUnico, aoBaixo: () => recolher(true), aoCima: () => recolher(false) });
  cab.addEventListener('click', (e) => { if (E.uniCollapsed && ehUnico() && !(e.target as HTMLElement).closest('button')) recolher(false); });
  H.onView = drawUni;
}
