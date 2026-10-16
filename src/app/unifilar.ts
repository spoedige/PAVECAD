import { IND, Q5, Q5F } from '../dominio/indicadores';
import { trColor, trOrder } from '../dominio/solucoes';
import { E, H, projName, type AppProj } from './estado';
import { IC } from './icones';
import { getMap, grupoAtivo, select } from './mapa';
import { $, cssv, esc, fmt, toast } from './ui';

interface Linha { y: number; h: number; lane: number }
interface Bloco { p: AppProj; titleY: number; rows: Linha[] }
interface Layout { x0: number; x1: number; kmi: number; kmf: number; blocks: Bloco[]; top: number }
let lay: Layout | null = null;

const Q = () => (E.field ? Q5F : Q5);
const maxLanes = (p: AppProj) => p.rows.reduce((m, r) => Math.max(m, r.widths.length), 1);

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

export function renderGroups() {
  const gs = [...new Set(E.P.filter((p) => p.visible).map((p) => p.meta.uf))], el = $('#unigroups');
  el.innerHTML = gs.length > 1 ? gs.map((g) => `<button class="chipbtn" data-g="${esc(g)}" style="${g === E.activeGroup ? 'background:var(--accent);color:var(--accent-ink)' : ''}">${esc(g.replace('BR-', ''))}</button>`).join('') : '';
  el.querySelectorAll<HTMLElement>('button').forEach((b) => (b.onclick = () => { E.activeGroup = b.dataset.g!; renderGroups(); drawUni(); }));
}

/** Unifilar em canvas: uma linha por faixa, agregada por pixel pela pior classe. */
export function drawUni() {
  const cv = document.getElementById('uni') as HTMLCanvasElement | null, wrap = document.getElementById('uniwrap'), card = document.getElementById('unicard');
  if (!cv || !wrap || !card) return;
  const G = grupoAtivo(), root = document.documentElement;
  if (E.uniCollapsed) { root.style.setProperty('--uni-h', '44px'); card.classList.add('collapsed'); return; }
  card.classList.remove('collapsed');
  if (!G.length) {
    root.style.setProperty('--uni-h', '90px');
    wrap.style.height = '24px';
    cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
    $('#unisub').textContent = 'Sem planilhas visíveis';
    return;
  }
  const rhL = 9, gap = 2, shH = 5, titleH = 13, bgap = 6, top = 16;
  let y = top;
  const blocks: Bloco[] = [];
  for (const p of G) {
    const b: Bloco = { p, titleY: y, rows: [] };
    y += titleH;
    for (let k = 0; k < maxLanes(p); k++) { b.rows.push({ y, h: rhL, lane: k + 1 }); y += rhL + gap; }
    if (p.rows.some((r) => r.shoulder > 0)) { b.rows.push({ y, h: shH, lane: 0 }); y += shH + gap; }
    y += bgap - gap;
    blocks.push(b);
  }
  const chH = Math.ceil(y);
  wrap.style.height = chH + 'px';
  const target = chH + 22 + 6 + 10 + 12 + 8;
  if (root.style.getPropertyValue('--uni-h') !== target + 'px') root.style.setProperty('--uni-h', target + 'px');
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
  const muted = cssv('--muted'), none = cssv('--none'), fill = cssv('--fill2'), sans = cssv('--sans');
  const pxKm = (x1 - x0) / (kmf - kmi), step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * pxKm >= 70) || 100, bottom = y - bgap;
  g.font = '500 10.5px ' + sans;
  g.textBaseline = 'alphabetic';
  for (let k = Math.ceil(kmi / step) * step; k <= kmf; k += step) {
    const x = Math.round(sx(k)), txt = k + ' km', tw = g.measureText(txt).width;
    g.fillStyle = muted; g.fillText(txt, Math.min(x - 8, W - tw - 1), top - 5);
    g.fillStyle = cssv('--hair'); g.fillRect(x, top - 2, 1, bottom - top + 4);
  }
  const keys = [...trOrder(), '-'], tc = (k: string) => trColor(k, E.field, none);
  const M = E.mode === 'sol' ? null : IND[E.mode];
  for (const b of blocks) {
    g.textBaseline = 'alphabetic';
    g.font = '600 10.5px ' + sans;
    g.fillStyle = muted;
    g.fillText(projName(b.p) + (b.p.meta.travel > 0 ? '  ↑' : '  ↓'), 0, b.titleY + 10);
    g.font = '500 10px ' + sans;
    g.textBaseline = 'middle';
    for (const rw of b.rows) {
      g.fillStyle = muted; g.fillText(rw.lane ? 'Fx ' + rw.lane : 'Ac.', 0, rw.y + rw.h / 2);
      g.fillStyle = fill; g.globalAlpha = 0.55; rr(g, x0, rw.y, x1 - x0, rw.h, Math.min(4, rw.h / 2)); g.fill(); g.globalAlpha = 1;
    }
    const p = b.p, nPx = Math.max(1, Math.floor(x1 - x0)), sev = b.rows.map(() => new Int8Array(nPx).fill(-2));
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
        if (s > sev[ri][px] || sev[ri][px] === -2) sev[ri][px] = s;
      });
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
      $('#unisub').textContent = `Vista atual: hod. ${fmt(lo, 1)} a ${fmt(hi + 0.02, 1)} km`;
    } else $('#unisub').textContent = 'Clique para voar até o trecho';
  }
  const s = E.sel;
  if (s) {
    const b = blocks.find((q) => q.p.id === s.pid);
    if (b) {
      const x = sx(b.p.rows[s.row].hod), rw = b.rows.find((q) => q.lane === s.lane) || b.rows[0];
      g.fillStyle = cssv('--fg'); g.fillRect(x - 0.5, top - 2, 1.5, bottom - top + 4);
      g.strokeStyle = cssv('--fg'); g.lineWidth = 1.5; rr(g, x - 3, rw.y - 1, 6, rw.h + 2, 3); g.stroke();
    }
  }
}

function uniHit(e: MouseEvent, uw: HTMLElement) {
  if (!lay) return null;
  const r = uw.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < lay.x0 || x > lay.x1) return null;
  const km = lay.kmi + ((x - lay.x0) / (lay.x1 - lay.x0)) * (lay.kmf - lay.kmi);
  const b = lay.blocks.find((bb) => y >= bb.titleY && y <= bb.rows[bb.rows.length - 1].y + bb.rows[bb.rows.length - 1].h + 4) || lay.blocks[0];
  let rw = b.rows[0];
  for (const q of b.rows) if (y >= q.y - 1) rw = q;
  const p = b.p;
  let lo = 0, hi = p.rows.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (p.rows[m].hod < km) lo = m + 1; else hi = m; }
  let i = lo;
  if (i > 0 && Math.abs(p.rows[i - 1].hod - km) < Math.abs(p.rows[i].hod - km)) i--;
  return { x, p, i, lane: rw.lane, near: Math.abs(p.rows[i].hod - km) < 0.3 };
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
    el.firstElementChild!.textContent = 'km ' + h.p.kmLab[h.i];
  });
  uw.addEventListener('mouseleave', () => { $('#unihover').style.display = 'none'; });
  window.addEventListener('resize', drawUni);
  if (window.ResizeObserver) new ResizeObserver(() => drawUni()).observe(uw);
  const tg = $('#uniToggle');
  tg.addEventListener('click', () => {
    E.uniCollapsed = !E.uniCollapsed;
    tg.innerHTML = (E.uniCollapsed ? IC.up : IC.down).replace('class="i"', 'class="i" style="width:14px;height:14px"');
    drawUni();
  });
  H.onView = drawUni;
}
