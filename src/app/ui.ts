export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
export const cssv = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const fmt = (v: number | null | undefined, d = 1) =>
  v == null || isNaN(v) ? '–' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

let toastT: ReturnType<typeof setTimeout>;
export function toast(msg: string, ms = 3400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

/** Pílula deslizante do controle segmentado. */
export function syncSeg(el: HTMLElement | null) {
  const b = el?.querySelector<HTMLElement>('[aria-pressed="true"],[aria-selected="true"]');
  if (!el || !b) return;
  el.style.setProperty('--x', b.offsetLeft + 'px');
  el.style.setProperty('--w', b.offsetWidth + 'px');
}
export const syncAllSegs = () => document.querySelectorAll<HTMLElement>('.seg').forEach(syncSeg);
window.addEventListener('resize', syncAllSegs);
document.fonts?.ready.then(syncAllSegs);

/** Publica a altura da coluna superior direita (--hudm-h) para o painel lateral não depender de um número fixo. */
export function observarHud(aoMudar?: () => void) {
  const m = document.querySelector<HTMLElement>('.hud-main');
  if (!m) return;
  const set = () => { document.documentElement.style.setProperty('--hudm-h', Math.round(m.getBoundingClientRect().height) + 'px'); aoMudar?.(); };
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(set);
    ro.observe(m);
    for (const q of ['#inspector', '#legend', '#propbar', '#unicard', '.leftcol']) { const e = document.querySelector(q); if (e) ro.observe(e); }
  }
  set();
}
