// Executado dentro da página: lista pares de textos visíveis que se sobrepõem.
(() => {
  const nos = [], cortes = [];
  // com um diálogo modal aberto, só vale o texto do próprio diálogo (o resto está coberto e escurecido)
  const modal = document.querySelector('#cfg:not([hidden]), #ajuda:not([hidden]), #dash:not([hidden])') || (() => { const m = document.querySelector('#nr'); return m && m.checkVisibility() ? m : null; })();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'OPTION', 'TITLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (modal && !modal.contains(el)) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    let b = r.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    // recorta pelos ancestrais com overflow (o que está cortado não aparece)
    let clip = { l: 0, t: -1e9, r: innerWidth, b: 1e9 };
    let rolavelX = false; // o corte horizontal vem de um contêiner que rola (linha de chips, abas): o usuário alcança o texto rolando
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') rolavelX = true;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        clip = { l: Math.max(clip.l, ar.left), t: Math.max(clip.t, ar.top), r: Math.min(clip.r, ar.right), b: Math.min(clip.b, ar.bottom) };
      }
    }
    const rect = { l: Math.max(b.left, clip.l), t: Math.max(b.top, clip.t), r: Math.min(b.right, clip.r), b: Math.min(b.bottom, clip.b) };
    if (rect.r - rect.l < 1 || rect.b - rect.t < 1) continue;
    // texto cortado na horizontal por um contêiner (sem reticências): o usuário não lê a palavra inteira
    if (b.left < rect.l - 2 || b.right > rect.r + 2) {
      const ell = getComputedStyle(el).textOverflow === 'ellipsis' || (el.parentElement && getComputedStyle(el.parentElement).textOverflow === 'ellipsis');
      if (!ell && !rolavelX) cortes.push({ tipo: 'cortado', mk: !!el.closest('.maplibregl-marker'), a: t.slice(0, 40), b: '', w: Math.round(Math.max(rect.l - b.left, b.right - rect.r)), h: 0, x: Math.round(b.left), y: Math.round(b.top) });
    }
    nos.push({ t: t.slice(0, 40), rect, el, mk: !!el.closest('.maplibregl-marker') });
  }
  const out = [];
  for (let i = 0; i < nos.length; i++) for (let j = i + 1; j < nos.length; j++) {
    const a = nos[i], c = nos[j];
    if (a.el === c.el) continue;
    const w2 = Math.min(a.rect.r, c.rect.r) - Math.max(a.rect.l, c.rect.l);
    const h2 = Math.min(a.rect.b, c.rect.b) - Math.max(a.rect.t, c.rect.t);
    if (w2 > 3 && h2 > 3) out.push({ tipo: 'sobrepoe', mk: a.mk || c.mk, a: a.t, b: c.t, w: Math.round(w2), h: Math.round(h2), x: Math.round(Math.max(a.rect.l, c.rect.l)), y: Math.round(Math.max(a.rect.t, c.rect.t)) });
  }
  return out.concat(cortes);
})()
