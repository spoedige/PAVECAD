// Auditoria de responsividade (Parte 3 da Sessão 5): matriz de viewports x estados do app, com detectores automáticos,
// capturas e relatório. Fora do CI obrigatório: roda sob demanda com `npm run auditoria-ui`.
//
// Uso: PAVECAD_URL=http://localhost:5199 npm run auditoria-ui [-- --vp 360x640,1366x768] [--estados planilha,dashboard] [--sem-capturas]
// Saída: capturas/auditoria-ui/<viewport>/<estado>.png, achados.json e relatorio.md (tabela viewport, estado, problema, gravidade).
const fs = require('fs');
const path = require('path');
const { abrir, lancar, RAIZ } = require('./capturas/lib.cjs');

const SAIDA = path.join(RAIZ, 'capturas', 'auditoria-ui');

/** Retrato e paisagem. Toque nos menores (até 1024 px de largura). 915x412 entra pelos critérios de aceite do celular (Parte 6). */
const VIEWPORTS = [
  [360, 640], [390, 844], [412, 915], [915, 412], [600, 960], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1366, 768], [1920, 1080],
].map(([w, h]) => ({ nome: `${w}x${h}`, w, h, toque: w <= 1024 }));

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const FILTRO_VP = arg('vp') ? arg('vp').split(',') : null;
const FILTRO_ESTADOS = arg('estados') ? arg('estados').split(',') : null;
const CAPTURAS = !argv.includes('--sem-capturas');

/* ------------------------------------------------------------------ */
/* Detectores (executados dentro da página)                            */
/* ------------------------------------------------------------------ */

/** Devolve a lista de achados do estado atual. Sem dependências externas: é serializada para a página. */
function detectar(toque) {
  const W = innerWidth, H = innerHeight, out = [];
  const vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const modal = document.querySelector('#cfg:not([hidden]), #ajuda:not([hidden]), #dash:not([hidden])');
  const nome = (e) => {
    if (e.id) return '#' + e.id;
    const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const p = e.parentElement && e.parentElement.id ? '#' + e.parentElement.id + ' > ' : '';
    return p + e.tagName.toLowerCase() + (c ? '.' + c : '');
  };
  const rotulo = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const R = (e) => e.getBoundingClientRect();
  const add = (tipo, e, detalhe, extra = {}) => out.push({ tipo, sel: nome(e), rotulo: rotulo(e), detalhe, ...extra });

  const ehInterativo = (e) => e.matches('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio]');
  // o que não é interface do app: o desenho do mapa e os marcadores (km, notas) que o MapLibre posiciona
  const ignorar = (e) => !!e.closest('.maplibregl-canvas-container, .maplibregl-marker, .maplibregl-popup, svg, canvas, #tip');
  // dentro de um diálogo modal só vale o diálogo
  const noEscopo = (e) => !modal || modal.contains(e);

  const todos = [...document.querySelectorAll('body *')].filter((e) => !ignorar(e) && noEscopo(e) && vis(e) && R(e).width > 0 && R(e).height > 0);

  // contêineres que rolam ou recortam: o que está cortado por eles não aparece, e o que rola é alcançável
  const recorte = (e) => {
    let l = -1e9, t = -1e9, r = 1e9, b = 1e9, rola = false;
    for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox !== 'visible' || oy !== 'visible') {
        const ar = R(a);
        l = Math.max(l, ar.left); t = Math.max(t, ar.top); r = Math.min(r, ar.right); b = Math.min(b, ar.bottom);
        if (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') rola = true;
      }
    }
    return { l, t, r, b, rola };
  };
  // parte da caixa que aparece na tela
  const visivel = (e) => {
    const r = R(e), c = recorte(e);
    const l = Math.max(r.left, c.l, 0), t = Math.max(r.top, c.t, 0), rr = Math.min(r.right, c.r, W), b = Math.min(r.bottom, c.b, H);
    return { w: Math.max(0, rr - l), h: Math.max(0, b - t), rola: c.rola, c };
  };

  // 1. rolagem horizontal da página
  const sobra = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W;
  if (sobra > 1) out.push({ tipo: 'rolagem-horizontal', sel: 'html', rotulo: '', detalhe: `a página rola ${sobra} px na horizontal` });

  // 2. elementos cortados ou fora da tela (interativos e rótulos)
  for (const e of todos) {
    const folha = !e.firstElementChild && e.textContent.trim();
    if (!ehInterativo(e) && !folha) continue;
    const r = R(e), v = visivel(e);
    if (v.w < 1 || v.h < 1) continue;
    const foraL = r.left < -1, foraR = r.right > W + 1, foraT = r.top < -1, foraB = r.bottom > H + 1;
    if (!(foraL || foraR || foraT || foraB)) continue;
    // cortado só pela tela, sem contêiner que role por dentro dele
    const c = recorte(e), dentroDoRecorte = r.left >= c.l - 1 && r.right <= c.r + 1 && r.top >= c.t - 1 && r.bottom <= c.b + 1;
    if (v.rola && !dentroDoRecorte) continue;
    if (v.rola && (foraB || foraR) && c.b <= H + 1 && c.r <= W + 1) continue;
    const lados = [foraL && 'esquerda', foraR && 'direita', foraT && 'topo', foraB && 'base'].filter(Boolean).join('/');
    add('fora-da-tela', e, `passa da borda (${lados}): ${Math.round(r.left)},${Math.round(r.top)} a ${Math.round(r.right)},${Math.round(r.bottom)}`, { interativo: ehInterativo(e), pct: Math.round(100 - (v.w * v.h) / (r.width * r.height) * 100) });
  }

  // 3. alvos de toque menores que 44 px (a área de toque estendida conta: 4 pontos a 21 px do centro)
  for (const e of todos) {
    if (!ehInterativo(e) || e.closest('.maplibregl-ctrl-attrib')) continue;
    if (e.matches('input[type=range], input[type=checkbox], input[type=radio]') && e.closest('label')) continue;
    const r = R(e);
    if (r.width >= 43.5 && r.height >= 43.5) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ok = (x, y) => { if (x < 0 || y < 0 || x > W || y > H) return true; const t = document.elementFromPoint(x, y); return !!t && (e.contains(t) || (t.contains(e) && t !== document.body && t !== document.documentElement)); };
    const horiz = r.width >= 43.5 || (ok(cx - 21, cy) && ok(cx + 21, cy)), vert = r.height >= 43.5 || (ok(cx, cy - 21) && ok(cx, cy + 21));
    if (horiz && vert) continue;
    add('alvo-pequeno', e, `${Math.round(r.width)}x${Math.round(r.height)} px`, { w: Math.round(r.width), h: Math.round(r.height), toque });
  }

  // 4. texto menor que 12 px
  for (const e of todos) {
    if (e.firstElementChild || !e.textContent.trim() || e.closest('.maplibregl-ctrl-attrib')) continue;
    if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 12) add('texto-pequeno', e, `${Math.round(fs * 10) / 10} px`, { fs });
  }

  // 5. sobreposição entre controles: um controle coberto por outro no seu centro, ou caixas que se cruzam
  const inter = todos.filter((e) => ehInterativo(e) && !e.closest('.maplibregl-ctrl-attrib'));
  const vistos = new Set();
  for (const e of inter) {
    const r = R(e), v = visivel(e);
    if (v.w < 4 || v.h < 4) continue;
    // o ponto testado é o centro da parte que aparece (o que um contêiner rolável recorta não conta)
    const c = recorte(e);
    const il = Math.max(r.left, c.l, 0), it = Math.max(r.top, c.t, 0), ir = Math.min(r.right, c.r, W), ib = Math.min(r.bottom, c.b, H);
    const x = Math.min(Math.max((il + ir) / 2, 1), W - 1), y = Math.min(Math.max((it + ib) / 2, 1), H - 1);
    const t = document.elementFromPoint(x, y);
    if (!t || e.contains(t) || t.contains(e)) continue;
    if (modal && !modal.contains(t)) continue;
    // fundo que escurece a tela atrás de um menu ou diálogo: cobre tudo de propósito
    const tr = R(t);
    if (['fixed', 'absolute'].includes(getComputedStyle(t).position) && tr.width >= W * 0.9 && tr.height >= H * 0.9) continue;
    // dentro de um rótulo que contém o controle (checkbox, switch) não é cobertura
    if (t.closest('label') && t.closest('label').contains(e)) continue;
    const chave = nome(e) + '|' + nome(t);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    add('coberto', e, `coberto por ${nome(t)} (${rotulo(t)})`);
  }
  for (let i = 0; i < inter.length; i++) {
    for (let j = i + 1; j < inter.length; j++) {
      const a = inter[i], b = inter[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = R(a), rb = R(b);
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3) {
        const va = visivel(a), vb = visivel(b);
        if (va.w < 4 || vb.w < 4 || va.h < 4 || vb.h < 4) continue;
        const chave = [nome(a), nome(b)].sort().join('|');
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        add('sobreposicao', a, `cruza ${nome(b)} (${rotulo(b)}) em ${Math.round(w)}x${Math.round(h)} px`, { area: Math.round(w * h) });
      }
    }
  }

  // 6. truncamento de rótulos (reticências ou corte seco)
  for (const e of todos) {
    if (!e.textContent.trim() || e.closest('.maplibregl-ctrl-attrib')) continue;
    const cs = getComputedStyle(e);
    const corta = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis';
    if (!corta || e.scrollWidth <= e.clientWidth + 1) continue;
    if (!e.firstElementChild || cs.textOverflow === 'ellipsis' || e.matches('button, [role=tab], summary')) {
      add('truncado', e, `"${e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}" (${e.scrollWidth} px em ${e.clientWidth} px)`, { ellipsis: cs.textOverflow === 'ellipsis', rotuloDeControle: !!e.closest('button, [role=tab], label, summary, .chipbtn, .xchip, th') });
    }
  }
  return out;
}

/** Texto sobreposto a texto e texto cortado por contêiner (o detector já usado nas capturas). */
const OVERLAP = fs.readFileSync(path.join(__dirname, 'capturas', 'overlap.js'), 'utf8');

/* ------------------------------------------------------------------ */
/* Gravidade                                                           */
/* ------------------------------------------------------------------ */

/** P1 quebra o uso, P2 incomoda, P3 cosmético. */
function gravidade(a, vp) {
  switch (a.tipo) {
    case 'rolagem-horizontal': return 'P1';
    case 'fora-da-tela': return a.interativo ? (a.pct >= 50 ? 'P1' : 'P2') : (a.pct >= 50 ? 'P2' : 'P3');
    case 'coberto': return 'P1';
    case 'sobreposicao': return a.area >= 400 ? 'P1' : 'P2';
    case 'alvo-pequeno': return vp.toque ? (Math.min(a.w, a.h) < 24 ? 'P1' : 'P2') : 'P3';
    case 'texto-pequeno': return a.fs < 10 ? 'P2' : 'P3';
    case 'truncado': return a.rotuloDeControle ? 'P2' : 'P3';
    case 'texto-sobreposto': return 'P2';
    case 'texto-cortado': return 'P2';
    default: return 'P2';
  }
}

/* ------------------------------------------------------------------ */
/* Cenários                                                            */
/* ------------------------------------------------------------------ */

const celular = (pg) => pg.evaluate(() => document.documentElement.classList.contains('celular'));
const limparDicas = (pg) => pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
const pausa = (pg, ms = 350) => pg.waitForTimeout(ms);

/** Centra o mapa na faixa e devolve a posição do ponto na página. */
async function centrar(pg, row = 300, lane = 1, zoom = 18.5) {
  const r = await pg.evaluate(({ row, lane, zoom }) => {
    const E = window.__pavecad.E, m = window.__pavecad.map(), p = E.P[0], f = p.polyByFid.get(row * 8 + lane);
    const ring = f.geometry.coordinates[0], n = ring.length - 1;
    const lon = ring.slice(0, n).reduce((a, c) => a + c[0], 0) / n, lat = ring.slice(0, n).reduce((a, c) => a + c[1], 0) / n;
    m.jumpTo({ center: [lon, lat], zoom, bearing: 0 });
    return { lon, lat };
  }, { row, lane, zoom });
  await pg.waitForTimeout(900);
  await pg.evaluate(() => new Promise((res) => { const m = window.__pavecad.map(); const t = setTimeout(res, 4000); m.once('idle', () => { clearTimeout(t); res(); }); m.triggerRepaint(); }));
  return pg.evaluate((a) => { const m = window.__pavecad.map(), q = m.project([a.lon, a.lat]), b = m.getCanvas().getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; }, r);
}

const gavetaPara = async (pg, alvo) => {
  const atual = () => pg.evaluate(() => ['fechada', 'meia', 'cheia'].find((k) => document.documentElement.classList.contains('gav-' + k)));
  const arrastar = async (dy) => {
    const a = await pg.evaluate(() => { const r = document.querySelector('#ihead').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; });
    await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(a.x, a.y + dy / 2, { steps: 4 }); await pg.mouse.move(a.x, a.y + dy, { steps: 4 }); await pg.mouse.up(); await pausa(pg, 450);
  };
  for (let i = 0; i < 4 && (await atual()) !== alvo; i++) {
    const g = await atual();
    if (g === 'fechada') { await pg.click('#gavTxt'); await pausa(pg, 450); }
    else if (alvo === 'cheia') await arrastar(-120);
    else await arrastar(120);
  }
};

/** Estados: cada um prepara a tela, a auditoria mede e desfaz. `aplicavel` limita o estado a certos tamanhos. */
const ESTADOS = [
  { id: 'mapa-vazio', vazio: true, aplicar: async () => {} },
  { id: 'planilha', aplicar: async (pg) => { await limparDicas(pg); } },
  { id: 'painel-aberto', so: 'largo', aplicar: async (pg) => { if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) await pg.click('#collapse'); await pausa(pg, 500); }, desfazer: async () => {} },
  { id: 'painel-recolhido', so: 'largo', aplicar: async (pg) => { if (!(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')))) await pg.click('#collapse'); await pausa(pg, 500); }, desfazer: async (pg) => { if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) await pg.click('#collapse'); await pausa(pg, 400); } },
  { id: 'gaveta-fechada', so: 'celular', aplicar: async (pg) => { await gavetaPara(pg, 'fechada'); } },
  { id: 'gaveta-meia', so: 'celular', aplicar: async (pg) => { await gavetaPara(pg, 'meia'); }, desfazer: async (pg) => { await gavetaPara(pg, 'fechada'); } },
  { id: 'gaveta-cheia', so: 'celular', aplicar: async (pg) => { await gavetaPara(pg, 'cheia'); }, desfazer: async (pg) => { await gavetaPara(pg, 'fechada'); } },
  ...[['seg', 'aba-segmento'], ['ana', 'aba-analise'], ['notas', 'aba-revisao'], ['exp', 'aba-exportar'], ['aj', 'aba-ajustes']].map(([t, id]) => ({
    id,
    aplicar: async (pg, ctx) => {
      if (ctx.celular) await gavetaPara(pg, 'meia');
      else if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) await pg.click('#collapse');
      await pausa(pg, 400);
      if (t === 'seg') { const p = await centrar(pg); await pg.mouse.click(p.x, p.y); await pausa(pg, 700); if (ctx.celular) await gavetaPara(pg, 'meia'); }
      await pg.click(`#tabs [data-t=${t}]`); await pausa(pg, 600);
    },
    desfazer: async (pg, ctx) => { if (ctx.celular) await gavetaPara(pg, 'fechada'); },
  })),
  { id: 'dashboard', aplicar: async (pg) => { await pg.click('#btnProjetos').catch(async () => { await pg.click('#cMapa'); await pausa(pg, 250); await pg.click('#dProjetos'); }); await pg.waitForSelector('#dash:not([hidden])', { timeout: 6000 }); await pausa(pg, 500); }, desfazer: async (pg) => { if (await pg.isVisible('#dash')) { await pg.click('#dashFechar'); await pausa(pg, 250); } } },
  { id: 'menu-pressionavel', aplicar: async (pg, ctx) => {
    if (ctx.celular) await gavetaPara(pg, 'fechada');
    const p = await centrar(pg);
    await limparDicas(pg);
    await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up();
    await pg.waitForSelector('#nr .nr-op', { timeout: 5000 }); await pausa(pg, 500);
  }, desfazer: async (pg) => { await pg.keyboard.press('Escape'); await pausa(pg, 250); } },
  { id: 'configuracoes-solucoes', aplicar: async (pg) => { await pg.evaluate(() => document.querySelector('#btnCfg')?.click()); await pg.waitForSelector('#cfg:not([hidden])'); await pausa(pg, 500); }, desfazer: async (pg) => { await pg.evaluate(() => document.querySelector('#cfgClose')?.click()); await pausa(pg, 250); } },
  { id: 'configuracoes-campo', aplicar: async (pg) => { await pg.evaluate(() => document.querySelector('#btnCfg')?.click()); await pg.waitForSelector('#cfg:not([hidden])'); await pg.click('#cfgTabs [data-ct=campo]'); await pausa(pg, 700); }, desfazer: async (pg) => { await pg.evaluate(() => document.querySelector('#cfgClose')?.click()); await pausa(pg, 250); } },
  { id: 'offline', aplicar: async (pg, ctx) => {
    await ctx.contexto.setOffline(true); await pg.waitForSelector(ctx.celular ? '#cOff:not([hidden])' : '#offBadge:not([hidden])', { timeout: 5000 }); await pausa(pg, 500);
  }, desfazer: async (pg, ctx) => { await ctx.contexto.setOffline(false); await pausa(pg, 300); } },
];

/* ------------------------------------------------------------------ */
/* Critérios de aceite do celular (Parte 6)                            */
/* ------------------------------------------------------------------ */

async function criteriosCelular(pg) {
  await limparDicas(pg);
  await gavetaPara(pg, 'fechada');
  await pausa(pg, 400);
  const pct = await pg.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    let livre = 0, tot = 0;
    for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) { tot++; const e = document.elementFromPoint(x, y); if (e && e.closest('#map') && !e.closest('.maplibregl-ctrl-scale,.maplibregl-ctrl-attrib')) livre++; }
    return Math.round((livre / tot) * 1000) / 10;
  });
  const acoes = [];
  const tenta = async (nome, toques, fn) => {
    try { await fn(); acoes.push({ nome, toques, ok: true }); } catch (e) { acoes.push({ nome, toques, ok: false, erro: String(e.message).split('\n')[0] }); }
  };
  await tenta('trocar fundo', 2, async () => {
    await pg.click('#cMapa'); await pausa(pg, 250); await pg.click('#drawer #base [data-b=esri]'); await pausa(pg, 450);
    if ((await pg.evaluate(() => window.__pavecad.E.base)) !== 'esri') throw new Error('fundo não trocou');
    await pg.click('#drawer #base [data-b=none]'); await pausa(pg, 250); await pg.click('#cMapa'); await pausa(pg, 250);
  });
  await tenta('trocar camada', 2, async () => {
    await pg.click('#btnCamada'); await pausa(pg, 200); await pg.click('#modes [data-m=iri]'); await pausa(pg, 300);
    if ((await pg.evaluate(() => window.__pavecad.E.mode)) !== 'iri') throw new Error('camada não trocou');
    await pg.click('#btnCamada'); await pausa(pg, 200); await pg.click('#modes [data-m=sol]'); await pausa(pg, 300);
  });
  await tenta('ir para km', 2, async () => {
    await pg.click('#cLocal'); await pausa(pg, 250); await pg.fill('#cGoKm', '170+500'); await pg.click('#cGoBtn'); await pausa(pg, 1500);
    if (!/km 170\+5\d\d/.test(await pg.textContent('#cLocalTxt'))) throw new Error('não foi ao km');
  });
  await tenta('abrir Exportar', 2, async () => {
    await pg.click('#cMapa'); await pausa(pg, 250); await pg.click('#dExportar'); await pausa(pg, 450);
    if ((await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t)) !== 'exp') throw new Error('não abriu Exportar');
    await gavetaPara(pg, 'fechada');
  });
  await tenta('abrir Projetos', 2, async () => {
    await pg.click('#cMapa'); await pausa(pg, 250); await pg.click('#dProjetos'); await pg.waitForSelector('#dash:not([hidden])', { timeout: 5000 });
    await pg.click('#dashFechar'); await pausa(pg, 250);
  });
  return { pct, acoes };
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

async function rodarViewport(browser, vp) {
  const achados = [], capturas = [];
  const { ctx: contexto, pg, log } = await abrir(browser, vp, { vazio: true });
  const eCel = await celular(pg);
  const ctx = { celular: eCel, contexto };
  const dir = path.join(SAIDA, vp.nome);
  fs.mkdirSync(dir, { recursive: true });

  const medir = async (estado) => {
    await pausa(pg, 250);
    const lista = await pg.evaluate(detectar, vp.toque);
    const texto = await pg.evaluate(OVERLAP);
    for (const t of texto) {
      if (t.mk) continue; // marcadores do mapa se sobrepõem por natureza (rótulos de km)
      lista.push({ tipo: t.tipo === 'cortado' ? 'texto-cortado' : 'texto-sobreposto', sel: '', rotulo: t.a, detalhe: t.tipo === 'cortado' ? `"${t.a}" cortado em ${t.w} px` : `"${t.a}" sobre "${t.b}" (${t.w}x${t.h} px)` });
    }
    for (const a of lista) achados.push({ viewport: vp.nome, estado, ...a, gravidade: gravidade(a, vp) });
    if (CAPTURAS) { const f = path.join(dir, `${estado}.png`); await pg.screenshot({ path: f }); capturas.push(f); }
  };

  const querEstado = (e) => (!FILTRO_ESTADOS || FILTRO_ESTADOS.includes(e.id)) && (e.so !== 'celular' || eCel) && (e.so !== 'largo' || !eCel);

  // 1. mapa vazio
  if (querEstado(ESTADOS[0])) await medir('mapa-vazio');
  // 2. carrega as planilhas e audita os demais estados
  await pg.setInputFiles('#file', require('./capturas/lib.cjs').FIXTURES);
  await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 90000 });
  await pausa(pg, 2500);
  await limparDicas(pg);
  let criterios = null;
  for (const e of ESTADOS.slice(1)) {
    if (!querEstado(e)) continue;
    try {
      await e.aplicar(pg, ctx);
      await medir(e.id);
    } catch (erro) {
      achados.push({ viewport: vp.nome, estado: e.id, tipo: 'falha-no-cenario', sel: '', rotulo: '', detalhe: String(erro.message).split('\n')[0], gravidade: 'P2' });
    }
    try { if (e.desfazer) await e.desfazer(pg, ctx); } catch { /* o próximo cenário se recompõe */ }
  }
  if (eCel && ['360x640', '390x844', '412x915', '915x412'].includes(vp.nome) && !FILTRO_ESTADOS) criterios = await criteriosCelular(pg);
  const errosPagina = log.erros.filter((m) => /PAGEERROR/.test(m));
  for (const m of errosPagina) achados.push({ viewport: vp.nome, estado: 'geral', tipo: 'erro-de-script', sel: '', rotulo: '', detalhe: m.slice(0, 160), gravidade: 'P1' });
  await contexto.close();
  return { achados, criterios, capturas };
}

/** Agrupa achados iguais (mesmo problema em vários estados e tamanhos) para o relatório curto. */
function agrupar(achados) {
  const mapa = new Map();
  for (const a of achados) {
    const chave = [a.tipo, a.sel, a.rotulo, a.gravidade].join('|');
    const g = mapa.get(chave) ?? { ...a, vps: new Set(), estados: new Set() };
    g.vps.add(a.viewport); g.estados.add(a.estado);
    mapa.set(chave, g);
  }
  return [...mapa.values()];
}

function relatorio(achados, criterios) {
  const sev = { P1: 0, P2: 1, P3: 2 };
  const grupos = agrupar(achados).sort((a, b) => sev[a.gravidade] - sev[b.gravidade] || a.tipo.localeCompare(b.tipo));
  const cont = (g) => achados.filter((a) => a.gravidade === g).length;
  const L = [];
  L.push('# Auditoria de responsividade', '', `Gerado em ${new Date().toLocaleString('pt-BR')}. Viewports: ${[...new Set(achados.map((a) => a.viewport))].join(', ') || '-'}.`, '');
  L.push(`Achados: P1 ${cont('P1')}, P2 ${cont('P2')}, P3 ${cont('P3')} (${grupos.length} problemas distintos).`, '');
  if (criterios.length) {
    L.push('## Critérios de aceite do celular (Parte 6)', '', '| Viewport | Mapa livre (mínimo 70%) | Trocar fundo | Trocar camada | Ir para km | Abrir Exportar | Abrir Projetos |', '|---|---|---|---|---|---|---|');
    for (const c of criterios) {
      const a = (n) => { const x = c.acoes.find((y) => y.nome === n); return x ? (x.ok ? `${x.toques} toques` : `falhou: ${x.erro}`) : '-'; };
      L.push(`| ${c.viewport} | ${c.pct}% ${c.pct >= 70 ? 'ok' : 'ABAIXO'} | ${a('trocar fundo')} | ${a('trocar camada')} | ${a('ir para km')} | ${a('abrir Exportar')} | ${a('abrir Projetos')} |`);
    }
    L.push('');
  }
  L.push('## Problemas', '', '| Gravidade | Problema | Onde | Viewports | Estados |', '|---|---|---|---|---|');
  const lim = (s, n) => { const v = [...s]; return v.length > n ? `${v.slice(0, n).join(', ')} e mais ${v.length - n}` : v.join(', '); };
  for (const g of grupos) {
    L.push(`| ${g.gravidade} | ${g.tipo}: ${g.detalhe.replace(/\|/g, '/')} | ${(g.sel + (g.rotulo ? ` "${g.rotulo}"` : '')).replace(/\|/g, '/')} | ${lim(g.vps, 4)} | ${lim(g.estados, 4)} |`);
  }
  L.push('', '## Detalhe por viewport e estado', '', '| Viewport | Estado | Problema | Gravidade |', '|---|---|---|---|');
  for (const a of achados.slice().sort((x, y) => sev[x.gravidade] - sev[y.gravidade] || x.viewport.localeCompare(y.viewport))) {
    L.push(`| ${a.viewport} | ${a.estado} | ${a.tipo}: ${(a.sel + (a.rotulo ? ` "${a.rotulo}"` : '') + ' ' + a.detalhe).replace(/\|/g, '/')} | ${a.gravidade} |`);
  }
  return L.join('\n') + '\n';
}

async function principal() {
  fs.mkdirSync(SAIDA, { recursive: true });
  const browser = await lancar();
  const todos = [], criterios = [];
  const lista = VIEWPORTS.filter((v) => !FILTRO_VP || FILTRO_VP.includes(v.nome));
  for (const vp of lista) {
    process.stdout.write(`${vp.nome} ... `);
    try {
      const r = await rodarViewport(browser, vp);
      todos.push(...r.achados);
      if (r.criterios) criterios.push({ viewport: vp.nome, ...r.criterios });
      const c = (g) => r.achados.filter((a) => a.gravidade === g).length;
      console.log(`P1 ${c('P1')}  P2 ${c('P2')}  P3 ${c('P3')}`);
    } catch (e) {
      console.log('falhou: ' + e.message.split('\n')[0]);
      todos.push({ viewport: vp.nome, estado: 'geral', tipo: 'falha-no-cenario', sel: '', rotulo: '', detalhe: e.message.split('\n')[0], gravidade: 'P1' });
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(SAIDA, 'achados.json'), JSON.stringify({ achados: todos, criterios }, null, 1));
  fs.writeFileSync(path.join(SAIDA, 'relatorio.md'), relatorio(todos, criterios));
  const n = (g) => todos.filter((a) => a.gravidade === g).length;
  console.log(`\nRelatório: ${path.relative(RAIZ, path.join(SAIDA, 'relatorio.md'))}\nP1 ${n('P1')}  P2 ${n('P2')}  P3 ${n('P3')}`);
  // a auditoria é informativa: não derruba o processo, mas sai com código 1 se houver P1 (útil em CI opcional)
  process.exitCode = n('P1') ? 1 : 0;
}

principal().catch((e) => { console.error(e); process.exit(2); });
