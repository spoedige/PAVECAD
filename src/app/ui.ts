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
