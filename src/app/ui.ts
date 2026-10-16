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
  let pend = false;
  const agenda = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; set(); }); };
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(agenda);
    ro.observe(m);
    for (const q of ['#inspector', '#legend', '#propbar', '#unicard', '.leftcol']) { const e = document.querySelector(q); if (e) ro.observe(e); }
  }
  set();
}

/** Liga a classe .mais no corpo de uma aba enquanto há conteúdo abaixo da área visível (gradiente de rolagem). */
export function observarRolagem(el: HTMLElement) {
  const att = () => el.classList.toggle('mais', el.scrollHeight - el.clientHeight - el.scrollTop > 2);
  el.addEventListener('scroll', att, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(att).observe(el);
  new MutationObserver(att).observe(el, { childList: true, subtree: true });
  att();
}

/** Gesto vertical num cabeçalho (puxador). Arrastar `limite` px ou mais para baixo ou para cima chama o callback.
 *  Só vale quando `ativo()` é verdadeiro. Move e soltar são ouvidos na janela, porque o ponteiro pode sair do cabeçalho
 *  durante o arrasto. O clique que termina um arrasto é descartado, então tocar nas abas continua funcionando. */
export function gestoVertical(el: HTMLElement, o: { aoBaixo: () => void; aoCima: () => void; ativo: () => boolean; limite?: number }) {
  const limite = o.limite ?? 40;
  let id = -1, y0 = 0, moveu = false;
  const mover = (e: PointerEvent) => { if (e.pointerId === id && Math.abs(e.clientY - y0) > 8) moveu = true; };
  const soltar = (e: PointerEvent, cancelado: boolean) => {
    if (e.pointerId !== id) return;
    id = -1;
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', aoSoltar);
    window.removeEventListener('pointercancel', aoCancelar);
    const dy = e.clientY - y0;
    if (cancelado || !moveu) return;
    if (dy >= limite) o.aoBaixo(); else if (dy <= -limite) o.aoCima();
  };
  const aoSoltar = (e: PointerEvent) => soltar(e, false);
  const aoCancelar = (e: PointerEvent) => soltar(e, true);
  el.addEventListener('pointerdown', (e) => {
    if (!o.ativo() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    id = e.pointerId; y0 = e.clientY; moveu = false;
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoCancelar);
  });
  el.addEventListener('click', (e) => { if (moveu) { e.stopPropagation(); e.preventDefault(); moveu = false; } }, true);
}

/** Igual a observarRolagem, para a rolagem horizontal (linha de chips): liga .mais enquanto há conteúdo à direita. */
export function observarRolagemH(el: HTMLElement) {
  const att = () => el.classList.toggle('mais', el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  el.addEventListener('scroll', att, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(att).observe(el);
  new MutationObserver(att).observe(el, { childList: true, subtree: true });
  att();
}
