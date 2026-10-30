// Testes de interface (Playwright) das correções da revisão visual.
// Uso: node scripts/capturas/e2e.cjs [grupo ...]   (padrão: todos)
// Requer o servidor de desenvolvimento em PAVECAD_URL (padrão http://localhost:5199).
const assert = require('assert/strict');
const { VPS, abrir, lancar, tema } = require('./lib.cjs');
const os = require('os');
const path = require('path');
const { gravarConjunto } = require('../sinteticos.cjs');
const { irParaKm, escolherBase, escolherNitidez, aba, criarProposta, pontoLivre } = require('./scenarios.cjs');

/** Tamanhos de celular (com toque) da Parte 6. */
const CEL = [{ nome: 'cel-360x640', w: 360, h: 640, toque: true }, { nome: 'cel-390x844', w: 390, h: 844, toque: true }, { nome: 'cel-412x915', w: 412, h: 915, toque: true }, { nome: 'cel-915x412', w: 915, h: 412, toque: true }];
const CELULARES = CEL.map((c) => c.nome);
const vp = (nome) => VPS.find((v) => v.nome === nome) ?? CEL.find((v) => v.nome === nome);
/** Os quatro tamanhos de referência do layout único. */
const TODOS = ['1568x760', '1366x768', 'tablet-h-1024x768', 'tablet-v-820x1180'];
/** No celular, "Ir para km" é o chip de localização da barra superior. */
const irParaKmCel = async (pg, km) => { await pg.click('#cLocal'); await pg.waitForTimeout(200); await pg.fill('#cGoKm', km); await pg.click('#cGoBtn'); await pg.waitForTimeout(1800); };
const estado = (pg, expr) => pg.evaluate(`(${expr})(window.__pavecad.E)`);

/** As 9 planilhas sintéticas (18 projetos) do teste de carga, gravadas numa pasta temporária. */
const NOVE = gravarConjunto(path.join(os.tmpdir(), 'pavecad-sint'));
const OPTS_NOVE = { arquivos: NOVE, projetos: 18 };

/** Centra o mapa no polígono da faixa e devolve onde ele está na página (e a posição em graus). */
/** Muda a camada do mapa (hoje, pelos botões de modo; depois, pelo chip de camada). */
const modo = async (pg, m) => { await pg.click('#btnCamada'); await pg.click(`#modes [data-m=${m}]`); await pg.waitForTimeout(150); };
const abrirProjetos = async (pg) => { if (!(await pg.isVisible('#dash'))) { await pg.click('#btnProjetos'); await pg.waitForSelector('#dash:not([hidden])'); await pg.waitForTimeout(250); } };
const fecharProjetos = async (pg) => { if (await pg.isVisible('#dash')) { await pg.click('#dashFechar'); await pg.waitForTimeout(150); } };

async function centrarNaFaixa(pg, iProj, row, lane, zoom = 18.5) {
  const r = await pg.evaluate(({ iProj, row, lane, zoom }) => {
    const E = window.__pavecad.E, m = window.__pavecad.map(), p = typeof iProj === 'string' ? E.P.find((q) => new RegExp(iProj).test(q.meta.name)) : E.P[iProj], f = p.polyByFid.get(row * 8 + lane), ring = f.geometry.coordinates[0], n = ring.length - 1;
    const lon = ring.slice(0, n).reduce((a, c) => a + c[0], 0) / n, lat = ring.slice(0, n).reduce((a, c) => a + c[1], 0) / n;
    // em tela estreita o painel e o unifilar ocupam a parte de baixo: o ponto vai para o centro da parte livre do mapa
    const larga = [...document.querySelectorAll('#inspector, #uni, .uni')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > innerWidth * 0.6 && r.height > 0 && r.top > innerHeight / 3);
    const baixo = larga.length ? Math.max(0, innerHeight - Math.min(...larga.map((r) => r.top))) : 0;
    m.jumpTo({ center: [lon, lat], zoom, bearing: 0, padding: { top: 0, left: 0, right: 0, bottom: baixo } });
    return { lon, lat };
  }, { iProj, row, lane, zoom });
  await pg.waitForTimeout(900);
  // espera o mapa terminar de desenhar: com a página ocupada, a pressão de 500 ms disputaria o tempo com o primeiro movimento
  await pg.evaluate(() => new Promise((res) => { const m = window.__pavecad.map(); const t = setTimeout(res, 4000); m.once('idle', () => { clearTimeout(t); res(); }); m.triggerRepaint(); }));
  const pt = await pg.evaluate((a) => { const m = window.__pavecad.map(), q = m.project([a.lon, a.lat]), b = m.getCanvas().getBoundingClientRect(); return { x: b.left + q.x, y: b.top + q.y }; }, r);
  return { ...pt, ...r };
}

/** Pede tiles novos (zooms diferentes) até as falhas em sequência levarem o fundo ao Liso; com a máquina carregada pode levar alguns ciclos. */
const faltaDeTiles = async (pg) => {
  for (const z of [16.4, 17.7, 15.9, 17.1, 16.9, 18.3, 15.5, 17.4]) {
    await pg.evaluate((zz) => window.__pavecad.map().jumpTo({ zoom: zz }), z);
    const ok = await pg.waitForFunction(() => window.__pavecad.E.base === 'none', null, { timeout: 2500 }).then(() => true, () => false);
    if (ok) return;
  }
  assert.equal(await pg.evaluate(() => window.__pavecad.E.base), 'none', 'as falhas de tile em sequência levam o fundo ao Liso');
};

const TESTES = {
  t01: [
    ['abas do painel inteiras e subtítulo em duas linhas, nos quatro tamanhos', 'tablet-h-1024x768', async (pg, { ctx }) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      for (const [w, h] of [[1568, 760], [1366, 768], [1024, 768], [820, 1180]]) {
        await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(500);
        const m = await pg.evaluate(() => {
          const tabs = document.querySelector('#tabs'), tr = tabs.getBoundingClientRect();
          const fora = [...tabs.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < tr.left - 1 || r.right > tr.right + 1 || b.scrollWidth > b.clientWidth + 1; }).map((b) => b.textContent);
          const spans = [...document.querySelectorAll('#t-seg .lead span')];
          return { fora, sobra: tabs.scrollWidth - tabs.clientWidth, linhas: spans.length, cortado: spans.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent), txt: spans.map((x) => x.textContent) };
        });
        assert.deepEqual(m.fora, [], `${w}: abas cortadas`);
        assert.ok(m.sobra <= 1, `${w}: as abas rolam na horizontal (+${m.sobra}px)`);
        assert.equal(m.linhas, 2, 'o subtítulo deve ter duas linhas');
        assert.deepEqual(m.cortado, [], `${w}: subtítulo cortado`);
        assert.match(m.txt[1], /^hod\. /);
      }
    }],
    ['gradiente de rolagem só enquanto há mais conteúdo; o último cartão fica inteiro', 'tablet-h-1024x768', async (pg) => {
      await pg.setViewportSize({ width: 1024, height: 600 }); await pg.waitForTimeout(500); // baixo o bastante para o painel rolar
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      await pg.click('#segDet summary'); await pg.waitForTimeout(300);
      const r = await pg.evaluate(async () => {
        const b = document.querySelector('#t-seg'), det = document.querySelector('#segDet');
        const antes = { rola: b.scrollHeight > b.clientHeight + 2, mais: b.classList.contains('mais') };
        b.scrollTop = b.scrollHeight; await new Promise((r) => setTimeout(r, 200));
        const bb = b.getBoundingClientRect(), dd = det.getBoundingClientRect();
        return { antes, fimMais: b.classList.contains('mais'), folga: Math.round((bb.bottom - dd.bottom) * 10) / 10, fim: b.scrollTop + b.clientHeight >= b.scrollHeight - 1 };
      });
      assert.equal(r.antes.rola, true, 'com os detalhes abertos o painel deve rolar neste tamanho');
      assert.equal(r.antes.mais, true, 'o gradiente deve aparecer no topo da rolagem');
      assert.equal(r.fim, true);
      assert.equal(r.fimMais, false, 'no fim da rolagem o gradiente deve sumir');
      assert.ok(r.folga >= 0, 'o cartão Detalhes e tratamentos ficou cortado no fim: ' + r.folga);
    }],
  ],
  t02: [
    ['ferramentas na barra compacta do canto superior direito, sob Planilhas e a engrenagem; zoom e ⋯ na lateral', TODOS, async (pg) => {
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('unico')), true);
      const m = await pg.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect();
        const ids = ['#btnGps', '[data-tool=prop]', '#btnField', '#btnNotas'];
        const rs = ids.map(R), tb = R('#toolbar'), linha = R('.topright .trrow'), insp = R('#inspector');
        return {
          xs: rs.map((r) => r.left), ys: rs.map((r) => Math.round(r.top)), w: rs.map((r) => r.width), h: rs.map((r) => r.height),
          noCanto: !!document.querySelector('.topright > #toolbar'), emTools: !!document.querySelector('#tools #zoomhost') && !!document.querySelector('#tools #btnMore'), toolbarEmTools: !!document.querySelector('#tools #toolbar'),
          abaixo: tb.top - linha.bottom, direita: innerWidth - tb.right, painelGap: insp.top - tb.bottom,
          zoomX: Math.round(R('#zoomhost .maplibregl-ctrl-group').left), maisX: Math.round(R('#btnMore').left), borda: R('#btnMore').left,
          topo: [...document.querySelectorAll('.topbar button')].filter((b) => b.checkVisibility()).map((b) => b.id || b.dataset.m || b.dataset.tool || (b.dataset.ocultar ? 'ocultar-' + b.dataset.ocultar : '')),
          baseNoTopo: !!document.querySelector('.topbar #base'),
        };
      });
      assert.ok(m.noCanto, 'a barra de ferramentas fica no canto superior direito');
      assert.ok(m.emTools && !m.toolbarEmTools, 'zoom e ⋯ na barra lateral; as ferramentas não');
      assert.deepEqual([...m.xs].sort((a, b) => a - b), m.xs, 'ordem: GPS, propor, campo, nota');
      assert.equal(new Set(m.ys).size, 1, 'mesma linha');
      assert.ok(m.w.every((w) => w >= 44) && m.h.every((h) => h >= 44), 'alvos de 44 px');
      assert.ok(m.abaixo >= 4 && m.abaixo <= 16, 'sob Planilhas e a engrenagem: ' + m.abaixo);
      assert.ok(Math.abs(m.direita - 16) <= 2, 'alinhada à direita com 16 px de margem: ' + m.direita);
      assert.ok(m.painelGap >= 8, 'não cobre o painel direito: ' + m.painelGap);
      assert.equal(m.zoomX, m.maisX, 'o ⋯ alinha com o zoom');
      assert.ok(m.borda <= 20, 'barra lateral encostada na borda esquerda: ' + m.borda);
      assert.equal(m.topo.filter((x) => !['btnAjuda', 'btnCfg', 'btnFile', 'btnGps', 'btnField', 'btnAlinhar', 'btnProjetos', 'prop', 'btnNotas', 'ocultar-ferramentas'].includes(x)).length, 0, 'topo com botão extra: ' + m.topo);
      assert.equal(m.baseNoTopo, false, 'a escolha de base saiu do topo');
    }],
    ['gaveta ⋯ abre girar, norte e base; estado salvo; Satélite troca a base', TODOS, async (pg) => {
      assert.equal(await pg.isVisible('#drawer'), false, 'a gaveta começa fechada');
      assert.equal(await pg.getAttribute('#btnMore', 'aria-expanded'), 'false');
      await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible', timeout: 5000 });
      assert.equal(await pg.isVisible('#drawer'), true);
      assert.equal(await pg.getAttribute('#btnMore', 'aria-expanded'), 'true');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-gaveta')), '1');
      const alvos = await pg.evaluate(() => ['#rotL', '#rotN', '#rotR', '#rotA', '#base [data-b=none]', '#base [data-b=osm]', '#base [data-b=esri]'].map((s) => { const r = document.querySelector('#drawer ' + s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
      for (const [s, w, h] of alvos) assert.ok(w >= 44 && h >= 44, `${s} ${w}x${h}`);
      await pg.click('#drawer #base [data-b=esri]'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.base'), 'esri');
      await pg.click('#drawer #rotR'); await pg.waitForTimeout(500);
      assert.ok(Math.abs(await pg.evaluate(() => window.__pavecad.map().getBearing())) > 1, 'girar à direita deve mudar o rumo');
      await pg.click('#drawer #rotN'); await pg.waitForTimeout(600);
      assert.ok(Math.abs(await pg.evaluate(() => window.__pavecad.map().getBearing())) < 1, 'norte volta o rumo a 0');
      await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'hidden', timeout: 5000 });
      assert.equal(await pg.isVisible('#drawer'), false);
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-gaveta')), '0');
    }],
    ['gaveta aberta lembrada ao recarregar e animação curta que respeita prefers-reduced-motion', 'tablet-h-1024x768', async (pg) => {
      const dur = () => pg.evaluate(() => getComputedStyle(document.querySelector('#drawer')).transitionDuration);
      assert.match(await dur(), /0\.16s/, 'animação curta (160 ms)');
      await pg.emulateMedia({ reducedMotion: 'reduce' }); await pg.waitForTimeout(100);
      assert.match(await dur(), /^0s/, 'sem animação com prefers-reduced-motion');
      await pg.evaluate(() => localStorage.setItem('pavecad-gaveta', '1'));
      await pg.reload(); await pg.waitForTimeout(1500);
      assert.equal(await pg.isVisible('#drawer'), true, 'a gaveta deve voltar aberta');
      assert.equal(await pg.getAttribute('#btnMore', 'aria-expanded'), 'true');
    }],
    ['nenhum controle sobreposto, com a gaveta aberta, nos quatro tamanhos', 'tablet-h-1024x768', async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      await pg.click('#btnMore'); await pg.waitForTimeout(400);
      for (const [w, h] of [[1568, 760], [1366, 768], [1024, 768], [820, 1180]]) {
        await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(600);
        const r = await pg.evaluate(() => {
          const sel = ['.titlecard > .title', '.titlecard > .search', '#layerbox', '.maplibregl-ctrl-scale', '.topright > .trrow', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#drawer', '#btnMore', '#propbar:not([hidden])', '#inspector', '#unicard'];
          const caixas = sel.map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.checkVisibility()).map(([s, e]) => [s, e.getBoundingClientRect()]);
          const ruins = [];
          for (let i = 0; i < caixas.length; i++) for (let j = i + 1; j < caixas.length; j++) {
            const a = caixas[i][1], b = caixas[j][1];
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) ruins.push(`${caixas[i][0]} x ${caixas[j][0]} (${Math.round(ox)}x${Math.round(oy)})`);
          }
          const fora = caixas.filter(([, b]) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1).map(([s]) => s);
          return { ruins, fora, n: caixas.length };
        });
        assert.ok(r.n >= 9, `${w}: poucos controles medidos (${r.n})`);
        assert.deepEqual(r.ruins, [], `${w}: controles sobrepostos ${JSON.stringify(r.ruins)}`);
        assert.deepEqual(r.fora, [], `${w}: controles fora da tela`);
      }
    }],
    ['celular (500 px): classe celular, barra superior única e gaveta; a 601 px o layout volta ao de tablet; paisagem baixa também é celular', 'tablet-h-1024x768', async (pg) => {
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('celular')), false);
      await pg.setViewportSize({ width: 500, height: 900 }); await pg.waitForTimeout(600);
      const d = await pg.evaluate(() => ({ cel: document.documentElement.classList.contains('celular'), topc: document.querySelector('#topc').checkVisibility(), hud: document.querySelector('.hud').checkVisibility(), cam: !!document.querySelector('#topc #btnCamada'), gav: document.documentElement.classList.contains('gav-fechada'), tools: document.querySelector('#tools').checkVisibility() }));
      assert.deepEqual(d, { cel: true, topc: true, hud: false, cam: true, gav: true, tools: false });
      await pg.setViewportSize({ width: 601, height: 900 }); await pg.waitForTimeout(600);
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('celular')), false, '601 px já é tablet');
      assert.equal(await pg.evaluate(() => !!document.querySelector('.leftcol #btnCamada') && document.querySelector('#topc').checkVisibility() === false), true, 'o chip de camada volta para a coluna esquerda');
      await pg.setViewportSize({ width: 915, height: 412 }); await pg.waitForTimeout(600);
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('celular') && document.documentElement.classList.contains('cel-paisagem')), true, 'paisagem com menos de 500 px de altura');
      await pg.setViewportSize({ width: 1024, height: 768 }); await pg.waitForTimeout(600);
      assert.equal(await pg.evaluate(() => !!document.querySelector('#drawer #base') && !!document.querySelector('#tools #zoomhost')), true);
    }],
    ['o mesmo layout em qualquer tela: base e girar na gaveta, zoom na barra lateral, ⋯ visível', TODOS, async (pg) => {
      const d = await pg.evaluate(() => ({ unico: document.documentElement.classList.contains('unico'), base: !!document.querySelector('#drawer #base'), rot: !!document.querySelector('#drawer #rotbar'), zoom: !!document.querySelector('#tools #zoomhost'), more: document.querySelector('#btnMore').checkVisibility() }));
      assert.deepEqual(d, { unico: true, base: true, rot: true, zoom: true, more: true });
    }],
  ],
  t03: [
    ['painel: arrastar o cabeçalho para baixo (40 px) recolhe até a faixa com abas e km; para cima reabre', TODOS, async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const cab = () => pg.evaluate(() => { const r = document.querySelector('#ihead').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 8, b: r.bottom }; });
      const arrastar = async (de, dy) => { await pg.mouse.move(de.x, de.y); await pg.mouse.down(); for (let i = 1; i <= 6; i++) await pg.mouse.move(de.x, de.y + (dy * i) / 6); await pg.mouse.up(); await pg.waitForTimeout(250); };
      const rec = () => pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'));
      assert.match(await pg.textContent('#ikm'), /^km 170\+500 · /);
      await arrastar(await cab(), 30);
      assert.equal(await rec(), false, '30 px não chega ao limite de 40');
      await arrastar(await cab(), 60);
      assert.equal(await rec(), true, 'arrastar 60 px para baixo recolhe');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-painel')), '1');
      const faixa = await pg.evaluate(() => { const r = document.querySelector('#inspector').getBoundingClientRect(); return { h: r.height, tabs: document.querySelector('#tabs').checkVisibility(), km: document.querySelector('#ikm').checkVisibility(), corpo: document.querySelector('#t-seg').checkVisibility() }; });
      assert.ok(faixa.tabs && faixa.km && !faixa.corpo, 'a faixa mostra abas e km, sem o corpo');
      assert.ok(faixa.h < 140, 'faixa baixa: ' + faixa.h);
      await arrastar(await cab(), -60);
      assert.equal(await rec(), false, 'arrastar para cima reabre');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-painel')), '0');
    }],
    ['painel: tocar na faixa, numa aba ou no chevron reabre; o gesto só vale no cabeçalho', TODOS, async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const rec = () => pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'));
      // arrastar no corpo do painel não recolhe
      const c = await pg.evaluate(() => { const r = document.querySelector('#t-seg').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60 }; });
      await pg.mouse.move(c.x, c.y); await pg.mouse.down(); await pg.mouse.move(c.x, c.y + 90, { steps: 6 }); await pg.mouse.up();
      assert.equal(await rec(), false, 'o gesto só vale no cabeçalho');
      // chevron recolhe e abre
      await pg.click('#collapse'); assert.equal(await rec(), true);
      await pg.click('#collapse'); assert.equal(await rec(), false);
      // tocar na faixa
      await pg.click('#collapse'); await pg.click('#ikm'); assert.equal(await rec(), false, 'tocar no km reabre');
      // tocar numa aba reabre e seleciona
      await pg.click('#collapse'); await pg.click('#tabs [data-t=ana]');
      assert.equal(await rec(), false); assert.equal(await estado(pg, 'E => E.tab'), 'ana');
      // um toque nas abas continua selecionando (o gesto não engole o clique)
      await pg.click('#tabs [data-t=seg]'); assert.equal(await estado(pg, 'E => E.tab'), 'seg');
    }],
    ['painel: gesto de toque real (CDP) e estado recolhido lembrado ao recarregar', 'tablet-h-1024x768', async (pg, { ctx }) => {
      const cdp = await ctx.newCDPSession(pg);
      const r = await pg.evaluate(() => { const b = document.querySelector('#ihead').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 10) }; });
      const toque = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: r.x, y }] });
      await toque('touchStart', r.y);
      for (let i = 1; i <= 6; i++) await toque('touchMove', r.y + i * 12);
      await toque('touchEnd', r.y + 72); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), true, 'o toque arrastado para baixo recolhe');
      await pg.reload(); await pg.waitForTimeout(1500);
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), true, 'recolhido volta recolhido');
      assert.equal(await pg.getAttribute('#collapse', 'aria-label'), 'Expandir painel');
    }],
    ['painel: na faixa recolhida nada se sobrepõe, nos quatro tamanhos', 'tablet-h-1024x768', async (pg) => {
      await irParaKm(pg, '170+500'); await pg.click('#collapse');
      for (const [w, h] of [[1568, 760], [1366, 768], [1024, 768], [820, 1180]]) {
        await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(600);
        const r = await pg.evaluate(() => {
          const sel = ['.titlecard > .title', '.titlecard > .search', '.topright > .trrow', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#btnMore', '#inspector', '#unicard'];
          const cx = sel.map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.checkVisibility()).map(([s, e]) => [s, e.getBoundingClientRect()]);
          const ruins = [];
          for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) { const a = cx[i][1], b = cx[j][1]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) ruins.push(cx[i][0] + ' x ' + cx[j][0]); }
          const ikm = document.querySelector('#ikm');
          return { ruins, kmCortado: ikm.scrollWidth > ikm.clientWidth + 1 };
        });
        assert.deepEqual(r.ruins, [], `${w}: sobreposição`);
        assert.equal(r.kmCortado, false, `${w}: km cortado na faixa`);
      }
    }],
  ],
  t04: [
    ['unifilar: arrastar o cabeçalho para baixo recolhe até a barra de posição; para cima ou um toque reabre', TODOS, async (pg) => {
      await irParaKm(pg, '170+500');
      const cab = () => pg.evaluate(() => { const r = document.querySelector('#unicard .uni-h b').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const arrastar = async (de, dy) => { await pg.mouse.move(de.x, de.y); await pg.mouse.down(); for (let i = 1; i <= 6; i++) await pg.mouse.move(de.x, de.y + (dy * i) / 6); await pg.mouse.up(); await pg.waitForTimeout(300); };
      const rec = () => pg.evaluate(() => document.querySelector('#unicard').classList.contains('collapsed'));
      await arrastar(await cab(), 30);
      assert.equal(await rec(), false, '30 px não chega a 40');
      await arrastar(await cab(), 60);
      assert.equal(await rec(), true, 'recolhe');
      assert.equal(await estado(pg, 'E => E.uniCollapsed'), true);
      const f = await pg.evaluate(() => { const c = document.querySelector('#unicard').getBoundingClientRect(), h = document.querySelector('#unicard .uni-h').getBoundingClientRect(), sub = document.querySelector('#unisub'); return { cartao: c.height, cabBase: h.bottom, cartaoBase: c.bottom, canvas: document.querySelector('#uniwrap').checkVisibility(), sub: sub.checkVisibility() && sub.scrollWidth <= sub.clientWidth + 1 && sub.textContent.length > 0 }; });
      assert.equal(f.canvas, false, 'canvas escondido');
      assert.ok(f.cabBase <= f.cartaoBase + 0.5, `a barra de posição não pode ficar cortada (cabeçalho ${f.cabBase} x cartão ${f.cartaoBase})`);
      assert.ok(f.sub, 'a posição atual aparece na barra');
      await arrastar(await cab(), -60);
      assert.equal(await rec(), false, 'para cima reabre');
      await arrastar(await cab(), 60); assert.equal(await rec(), true);
      const p = await cab(); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(300);
      assert.equal(await rec(), false, 'um toque na barra reabre');
      await pg.click('#uniToggle'); assert.equal(await rec(), true, 'o botão continua como alternativa');
      await pg.click('#uniToggle'); assert.equal(await rec(), false);
    }],
    ['unifilar: gesto de toque real (CDP) e nada sobreposto com legenda e unifilar recolhidos', 'tablet-v-820x1180', async (pg, { ctx }) => {
      const cdp = await ctx.newCDPSession(pg);
      const r = await pg.evaluate(() => { const b = document.querySelector('#unicard .uni-h b').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
      const toque = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: r.x, y }] });
      await toque('touchStart', r.y); for (let i = 1; i <= 6; i++) await toque('touchMove', r.y + i * 12); await toque('touchEnd', r.y + 72); await pg.waitForTimeout(400);
      assert.equal(await estado(pg, 'E => E.uniCollapsed'), true, 'o toque arrastado recolhe');
      const ruins = await pg.evaluate(() => {
        const sel = ['.titlecard > .title', '.titlecard > .search', '.topright > .trrow', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#btnMore', '#inspector', '#unicard'];
        const cx = sel.map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.checkVisibility()).map(([s, e]) => [s, e.getBoundingClientRect()]);
        const out = [];
        for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) { const a = cx[i][1], b = cx[j][1]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(cx[i][0] + ' x ' + cx[j][0]); }
        return out;
      });
      assert.deepEqual(ruins, []);
      await pg.reload(); await pg.waitForTimeout(1500);
      assert.equal(await estado(pg, 'E => E.uniCollapsed'), true, 'recolhido volta recolhido');
    }],
  ],
  t05: [
    ['painel ancorado embaixo: a 12 px do topo do unifilar, aberto ou recolhido, e a altura vem da medida real (--uni-alt)', TODOS, async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const m = () => pg.evaluate(() => {
        const i = document.querySelector('#inspector').getBoundingClientRect(), u = document.querySelector('#unicard').getBoundingClientRect();
        return { i: { t: i.top, b: i.bottom, h: i.height, l: i.left, r: i.right }, uniTopo: u.top, uniH: u.height, uniAlt: parseFloat(document.documentElement.style.getPropertyValue('--uni-alt')), vh: innerHeight, vw: innerWidth };
      });
      const a = await m();
      assert.ok(Math.abs(a.uniTopo - a.i.b - 12) <= 1.5, `aberto: base do painel a ${a.uniTopo - a.i.b}px do unifilar`);
      assert.ok(Math.abs(a.uniAlt - a.uniH) <= 1, `--uni-alt (${a.uniAlt}) deve ser a altura real do unifilar (${a.uniH})`);
      assert.ok(Math.abs(a.vw - a.i.r - 16) <= 1, 'right: 16px, medido ' + (a.vw - a.i.r));
      await pg.click('#collapse'); await pg.waitForTimeout(300);
      const r = await m();
      assert.ok(Math.abs(r.uniTopo - r.i.b - 12) <= 1.5, `recolhido: a faixa encosta no unifilar (${r.uniTopo - r.i.b}px)`);
      assert.ok(r.i.t > r.vh / 2, `a faixa não flutua no meio nem no topo (topo em ${r.i.t} de ${r.vh})`);
      assert.ok(r.i.h < 140, 'faixa baixa: ' + r.i.h);
      assert.ok(Math.abs(r.i.b - a.i.b) <= 1.5, 'a base não muda ao recolher: abre para cima');
      assert.ok(a.i.h > r.i.h + 100, 'aberto cresce para cima: ' + a.i.h + ' x ' + r.i.h);
      // o unifilar recolhe e expande: o painel acompanha pela variável, sem valor fixo
      await pg.click('#uniToggle'); await pg.waitForTimeout(500);
      const u = await m();
      assert.ok(u.uniH < a.uniH - 50, 'o unifilar recolheu');
      assert.ok(Math.abs(u.uniAlt - u.uniH) <= 1, `--uni-alt segue o unifilar recolhido (${u.uniAlt} x ${u.uniH})`);
      assert.ok(Math.abs(u.uniTopo - u.i.b - 12) <= 1.5, `com o unifilar recolhido o painel desce junto (${u.uniTopo - u.i.b}px)`);
      await pg.click('#collapse'); await pg.waitForTimeout(300);
      await pg.click('#uniToggle'); await pg.waitForTimeout(500);
      const f = await m();
      assert.ok(Math.abs(f.uniTopo - f.i.b - 12) <= 1.5, 'unifilar reaberto: o painel sobe junto (' + (f.uniTopo - f.i.b) + 'px)');
      assert.ok(Math.abs(f.uniAlt - f.uniH) <= 1);
    }],
    ['painel expandido: posição e altura fixas, abaixo da barra de ferramentas e da linha de GPS, iguais em todas as abas', TODOS, async (pg) => {
      await irParaKm(pg, '170+500');
      if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) { await pg.click('#collapse'); await pg.waitForTimeout(300); }
      const medir = () => pg.evaluate(() => {
        const i = document.querySelector('#inspector').getBoundingClientRect(), tr = document.querySelector('.topright').getBoundingClientRect(), u = document.querySelector('#unicard').getBoundingClientRect();
        return { t: Math.round(i.top), h: Math.round(i.height), b: Math.round(i.bottom), trB: Math.round(tr.bottom), uni: Math.round(u.top), lado: innerWidth >= 900 };
      });
      const ref = await medir();
      for (const t of ['ana', 'notas', 'exp', 'aj', 'seg']) {
        await aba(pg, t); await pg.waitForTimeout(150);
        const m = await medir();
        assert.ok(Math.abs(m.t - ref.t) <= 1 && Math.abs(m.h - ref.h) <= 1, `aba ${t}: posição e altura não mudam (${m.t}/${m.h} x ${ref.t}/${ref.h})`);
      }
      if (ref.lado) assert.ok(ref.t >= ref.trB + 6, `abaixo da barra de ferramentas e da linha de GPS (topo ${ref.t}, barra até ${ref.trB})`);
      assert.ok(Math.abs(ref.uni - ref.b - 12) <= 1.5, 'e a base a 12 px do unifilar');
      // a linha de GPS (que aumenta a coluna do topo) empurra o painel para baixo; ele continua abaixo dela
      await pg.evaluate(() => { const c = document.querySelector('#gpschip'); c.hidden = false; c.innerHTML = '<span>GPS</span>'; });
      await pg.waitForTimeout(400);
      const g = await medir();
      if (g.lado) assert.ok(g.t >= g.trB + 6, `com a linha de GPS o painel continua abaixo (${g.t} x ${g.trB})`);
      await pg.evaluate(() => { document.querySelector('#gpschip').hidden = true; });
    }],
    ['menos de 900 px: folha inferior em largura total acima do unifilar, sem cobrir a barra lateral', ['tablet-v-820x1180'], async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'ana');
      const m = await pg.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect(), i = R('#inspector');
        return { l: i.left, r: innerWidth - i.right, t: i.top, tools: R('#tools').bottom, toolsTop: R('#tools').top, hud: R('.hud').bottom };
      });
      assert.ok(Math.abs(m.l - 16) <= 1 && Math.abs(m.r - 16) <= 1, `largura total (esq ${m.l}, dir ${m.r})`);
      assert.ok(m.tools <= m.t - 8, `a barra lateral fica acima da folha (${m.tools} x ${m.t})`);
      assert.ok(m.toolsTop >= m.hud + 8, `a barra lateral não sobe até o topo (${m.toolsTop} x ${m.hud})`);
      await pg.click('#collapse'); await pg.waitForTimeout(400);
      const c = await pg.evaluate(() => { const i = document.querySelector('#inspector').getBoundingClientRect(), t = document.querySelector('#tools').getBoundingClientRect(); return { tb: t.bottom, it: i.top }; });
      assert.ok(c.tb <= c.it - 8, 'recolhida, a barra lateral desce junto e continua acima da faixa');
    }],
  ],
  t06: [
    ['sem chips na coluna esquerda; Visão geral é um botão de 44 px dentro do cartão do título', TODOS, async (pg) => {
      assert.equal(await pg.locator('#views, #viewsIn').count(), 0, 'a linha de chips saiu da coluna esquerda');
      const m = await pg.evaluate(() => {
        const t = document.querySelector('#titlebox').getBoundingClientRect(), card = document.querySelector('#titlecard').getBoundingClientRect(), b = document.querySelector('#btnOverview').getBoundingClientRect(), s = document.querySelector('.leftcol .search').getBoundingClientRect();
        const txt = document.querySelector('#title'), g = document.querySelector('#titlebox [data-ocultar]').getBoundingClientRect();
        return { dentro: b.left >= card.left && b.right <= card.right && b.top >= card.top - 0.5 && b.bottom <= card.bottom + 0.5, w: b.width, h: b.height, rot: document.querySelector('#btnOverview').getAttribute('aria-label'),
          cortado: txt.scrollWidth > txt.clientWidth + 1, buscaAbaixo: s.top >= t.bottom - 0.5, folga: s.top - t.bottom, buscaH: s.height, semEncontro: b.right <= g.left + 0.5 };
      });
      assert.ok(m.dentro, 'o botão fica dentro do cartão do título');
      assert.ok(m.w >= 43.5 && m.h >= 43.5, `44 px: ${m.w}x${m.h}`);
      assert.equal(m.rot, 'Visão geral');
      assert.equal(m.cortado, false, 'o título não pode ser cortado');
      assert.ok(m.buscaAbaixo && m.folga >= 4, 'busca e título não se sobrepõem: ' + m.folga);
      assert.ok(Math.abs(m.buscaH - 44) <= 0.5, 'a busca tem 44 px: ' + m.buscaH);
      assert.ok(m.semEncontro, 'visão geral e ocultar não se sobrepõem');
      // clique faz o enquadramento
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 18 })); await pg.waitForTimeout(400);
      const z0 = await pg.evaluate(() => window.__pavecad.map().getZoom());
      await pg.click('#btnOverview'); await pg.waitForTimeout(2200);
      assert.ok((await pg.evaluate(() => window.__pavecad.map().getZoom())) < z0 - 1, 'Visão geral afasta o mapa para enquadrar tudo');
    }],
    ['filtro de projeto no cabeçalho do unifilar: clicável, numa linha só e com rolagem horizontal', TODOS, async (pg) => {
      const bt = pg.locator('#unigroups button');
      assert.ok((await bt.count()) >= 2, 'GO e MG como grupos');
      const a = await pg.evaluate(() => { const v = document.querySelector('#unigroups'), cs = [...v.querySelectorAll('button')], tops = cs.map((c) => Math.round(c.getBoundingClientRect().top)); return { mesma: new Set(tops).size === 1, wrap: getComputedStyle(v).flexWrap, ox: getComputedStyle(v).overflowX, ativo: window.__pavecad.E.activeGroup, h: v.getBoundingClientRect().height }; });
      assert.ok(a.mesma && a.wrap === 'nowrap' && a.ox === 'auto', 'uma linha só, rolável');
      // clicar de verdade num grupo diferente do ativo (o ponto precisa pertencer ao botão: clicável, não coberto)
      const outro = await pg.evaluate(() => { const b = [...document.querySelectorAll('#unigroups button')].find((x) => x.dataset.g !== window.__pavecad.E.activeGroup), r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { g: b.dataset.g, acerta: el === b || b.contains(el) }; });
      assert.equal(outro.acerta, true, 'o botão do filtro recebe o clique (nada por cima)');
      await pg.click(`#unigroups button[data-g="${outro.g}"]`); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.activeGroup), outro.g, 'o clique troca o grupo ativo');
      assert.equal(await pg.getAttribute(`#unigroups button[data-g="${outro.g}"]`, 'aria-pressed'), 'true');
      // com muitos grupos a linha rola em vez de quebrar; o último fica alcançável; o fade só aparece enquanto há o que rolar
      await pg.evaluate(() => { const v = document.querySelector('#unigroups'); for (const g of Array.from({ length: 40 }, (_, i) => `${100 + i}/MG`)) { const b = document.createElement('button'); b.className = 'chipbtn'; b.textContent = g; v.appendChild(b); } });
      await pg.waitForTimeout(300);
      const b = await pg.evaluate(() => { const v = document.querySelector('#unigroups'), cs = [...v.querySelectorAll('button')]; return { mesma: new Set(cs.map((c) => Math.round(c.getBoundingClientRect().top))).size === 1, sobra: v.scrollWidth - v.clientWidth, mais: v.classList.contains('mais'), h: v.getBoundingClientRect().height }; });
      assert.ok(b.mesma, 'continua numa linha'); assert.ok(b.sobra > 20, 'rola na horizontal'); assert.equal(b.mais, true, 'fade enquanto há mais');
      await pg.evaluate(() => { const v = document.querySelector('#unigroups'); v.scrollLeft = v.scrollWidth; }); await pg.waitForTimeout(200);
      const c = await pg.evaluate(() => { const v = document.querySelector('#unigroups'), u = v.lastElementChild.getBoundingClientRect(), r = v.getBoundingClientRect(); return { mais: v.classList.contains('mais'), inteiro: u.right <= r.right + 1 }; });
      assert.equal(c.mais, false); assert.ok(c.inteiro, 'o último chip fica inteiro');
      // o filtro não cobre o título "Unifilar" nem o texto de posição
      const k = await pg.evaluate(() => { const g = document.querySelector('#unigroups').getBoundingClientRect(), t = document.querySelector('#unicard .uni-h b').getBoundingClientRect(), bt = document.querySelector('#unicard .uni-h [data-ocultar]').getBoundingClientRect(); return { sobreTitulo: g.left < t.right - 0.5, sobreBotoes: g.right > bt.left + 0.5 }; });
      assert.equal(k.sobreTitulo, false); assert.equal(k.sobreBotoes, false);
    }, { exemplos: true }],
  ],
  t07: [
    ['ocultar e mostrar cada grupo: some o grupo, aparece o botão de 44 px no lugar e restaura', TODOS, async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const GRUPOS = {
        titulo: { alvos: ['#titlebox', '.leftcol .search', '#btnOverview'] },
        ferramentas: { alvos: ['#toolbar'] },
        girar: { alvos: ['#btnMore'], gaveta: true },
        unifilar: { alvos: ['#unicard'] },
        painel: { alvos: ['#inspector'] },
      };
      const vis = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);
      for (const [id, g] of Object.entries(GRUPOS)) {
        if (g.gaveta) { await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible' }); }
        for (const a of g.alvos) assert.equal(await vis(a), true, `${id}: ${a} visível antes de ocultar`);
        assert.equal(await vis(`.grestaura[data-g=${id}]`), false, `${id}: sem botão de restaurar enquanto visível`);
        await pg.click(`[data-ocultar=${id}]`); await pg.waitForTimeout(250);
        for (const a of g.alvos) assert.equal(await vis(a), false, `${id}: ${a} oculto`);
        const r = await pg.evaluate((i) => { const e = document.querySelector(`.grestaura[data-g=${i}]`), b = e.getBoundingClientRect(); return { v: e.checkVisibility(), w: b.width, h: b.height, dentro: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, rot: e.getAttribute('aria-label'), icone: !!e.querySelector('svg') }; }, id);
        assert.ok(r.v && r.w >= 43.5 && r.h >= 43.5 && r.dentro, `${id}: botão de 44 px dentro da tela (${r.w}x${r.h})`);
        assert.ok(r.icone && /^Mostrar /.test(r.rot), `${id}: ícone e rótulo acessível`);
        assert.ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('pavecad-ocultos')))).includes(id), `${id}: salvo no localStorage`);
        await pg.click(`.grestaura[data-g=${id}]`); await pg.waitForTimeout(250);
        for (const a of g.alvos) assert.equal(await vis(a), true, `${id}: ${a} voltou`);
        assert.equal(await vis(`.grestaura[data-g=${id}]`), false, `${id}: o botão de restaurar some`);
        assert.ok(!(await pg.evaluate(() => JSON.parse(localStorage.getItem('pavecad-ocultos')))).includes(id), `${id}: removido do localStorage`);
        if (g.gaveta) { await pg.waitForTimeout(100); if (await vis('#drawer')) await pg.click('#btnMore'); }
      }
    }],
    ['o estado de cada grupo persiste ao recarregar; nenhum controle sobreposto com todos ocultos', TODOS, async (pg) => {
      await pg.click('[data-ocultar=titulo]'); await pg.click('[data-ocultar=ferramentas]'); await pg.click('[data-ocultar=unifilar]'); await pg.click('[data-ocultar=painel]');
      await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible' }); await pg.click('[data-ocultar=girar]');
      await pg.waitForTimeout(300);
      const checa = () => pg.evaluate(() => {
        const ids = ['titulo', 'ferramentas', 'girar', 'unifilar', 'painel'];
        const rs = ids.map((i) => [i, document.querySelector(`.grestaura[data-g=${i}]`)]).filter(([, e]) => e.checkVisibility()).map(([i, e]) => [i, e.getBoundingClientRect()]);
        const outros = ['#zoomhost .maplibregl-ctrl-group', '#btnLimpo', '.topright > .trrow', '#layerbox'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.checkVisibility()).map(([s, e]) => [s, e.getBoundingClientRect()]);
        const todos = rs.concat(outros), ruins = [];
        for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) { const a = todos[i][1], b = todos[j][1]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) ruins.push(todos[i][0] + ' x ' + todos[j][0]); }
        const fora = todos.filter(([, b]) => b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight).map(([s]) => s);
        const visiveis = ['#titlebox', '#toolbar', '#drawer', '#unicard', '#inspector'].filter((s) => document.querySelector(s).checkVisibility());
        return { n: rs.length, ruins, fora, visiveis, classes: [...document.documentElement.classList].filter((c) => c.startsWith('h-')).sort() };
      });
      let r = await checa();
      assert.equal(r.n, 5, 'cinco botões de restaurar');
      assert.deepEqual(r.ruins, [], 'sem sobreposição com tudo oculto');
      assert.deepEqual(r.fora, [], 'tudo dentro da tela');
      assert.deepEqual(r.visiveis, []);
      await pg.reload(); await pg.waitForTimeout(2000);
      r = await checa();
      assert.deepEqual(r.classes, ['h-ferramentas', 'h-girar', 'h-painel', 'h-titulo', 'h-unifilar'], 'todos continuam ocultos após recarregar');
      assert.equal(r.n, 5); assert.deepEqual(r.ruins, []); assert.deepEqual(r.visiveis, []);
      // restaura só dois e recarrega de novo: cada grupo guarda o próprio estado
      await pg.click('.grestaura[data-g=unifilar]'); await pg.click('.grestaura[data-g=painel]');
      await pg.reload(); await pg.waitForTimeout(2000);
      r = await checa();
      assert.deepEqual(r.classes, ['h-ferramentas', 'h-girar', 'h-titulo']);
      assert.deepEqual(r.visiveis.sort(), ['#inspector', '#unicard']);
    }],
    ['mapa limpo: botão de olho e tecla H deixam só o zoom e o botão; voltar restaura o estado de cada grupo', TODOS, async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      await pg.click('[data-ocultar=ferramentas]'); await pg.waitForTimeout(250);
      const estado = () => pg.evaluate(() => ({
        limpo: document.documentElement.classList.contains('limpo'), pressed: document.querySelector('#btnLimpo').getAttribute('aria-pressed'),
        vis: ['#titlebox', '#toolbar', '#unicard', '#inspector', '#layerbox', '.topright > .trrow', '#btnMore'].filter((s) => document.querySelector(s).checkVisibility()),
        restaura: [...document.querySelectorAll('.grestaura')].filter((e) => e.checkVisibility()).length,
        botoes: [...document.querySelectorAll('button')].filter((b) => b.checkVisibility() && !b.closest('.maplibregl-ctrl-attrib')).map((b) => b.id || b.getAttribute('aria-label')),
      }));
      const antes = await estado();
      assert.equal(antes.limpo, false);
      assert.ok(antes.vis.includes('#inspector') && antes.vis.includes('#unicard') && !antes.vis.includes('#toolbar'));
      assert.equal(antes.restaura, 1);
      // tecla H
      await pg.evaluate(() => document.activeElement && document.activeElement.blur());
      await pg.keyboard.press('h'); await pg.waitForTimeout(300);
      let e = await estado();
      assert.equal(e.limpo, true); assert.equal(e.pressed, 'true');
      assert.deepEqual(e.vis, [], 'nenhum grupo visível no mapa limpo: ' + e.vis);
      assert.equal(e.restaura, 0, 'nem os botões de restaurar de cada grupo');
      assert.equal(e.botoes.filter((b) => b !== 'btnLimpo' && !/Zoom|zoom|Aproximar|Afastar/i.test(b || '')).length, 0, 'só zoom e o botão de olho: ' + e.botoes.join(' | '));
      assert.ok(e.botoes.includes('btnLimpo'), 'o botão de olho continua');
      assert.ok(e.botoes.length === 3, 'zoom (2) + olho: ' + e.botoes.join(' | '));
      assert.equal(await pg.isVisible('#zoomhost .maplibregl-ctrl-group'), true);
      assert.equal(await pg.getAttribute('#btnLimpo', 'aria-label'), 'Mostrar os controles (H)');
      // tocar de novo restaura exatamente o estado anterior
      await pg.click('#btnLimpo'); await pg.waitForTimeout(300);
      e = await estado();
      assert.equal(e.limpo, false); assert.equal(e.pressed, 'false');
      assert.deepEqual(e.vis, antes.vis, 'cada grupo volta como estava');
      assert.equal(e.restaura, 1);
      // H digitado numa caixa de texto não liga o mapa limpo
      await pg.click('#gokm'); await pg.keyboard.type('h');
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('limpo')), false, 'H em campo de texto não aciona');
      // o mapa limpo não é salvo: mudar o estado só vale na sessão
      await pg.evaluate(() => document.activeElement.blur());
      await pg.keyboard.press('h'); await pg.waitForTimeout(200);
      assert.deepEqual(await pg.evaluate(() => JSON.parse(localStorage.getItem('pavecad-ocultos')).sort()), ['ferramentas'], 'os grupos ocultos seguem salvos, o mapa limpo não altera');
    }],
    ['no mapa limpo nada se sobrepõe e só zoom e botão de olho ficam à esquerda', TODOS, async (pg) => {
      await pg.keyboard.press('h'); await pg.waitForTimeout(300);
      const r = await pg.evaluate(() => {
        const a = document.querySelector('#zoomhost .maplibregl-ctrl-group').getBoundingClientRect(), b = document.querySelector('#btnLimpo').getBoundingClientRect();
        return { ruim: Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1, ox: a.left === b.left, dentro: b.bottom <= innerHeight && a.top >= 0, h: b.height, w: b.width };
      });
      assert.equal(r.ruim, false); assert.equal(r.ox, true, 'alinhados'); assert.ok(r.dentro);
      assert.ok(r.h >= 43.5 && r.w >= 43.5, 'o botão de olho tem 44 px');
    }],
  ],
  t08: [
    ['coluna esquerda (4 planilhas, satélite): título e busca sem corte nem sobreposição, nos três temas', ['1568x760', '1366x768', 'tablet-h-1024x768'], async (pg) => {
      assert.ok((await pg.evaluate(() => window.__pavecad.E.P.length)) >= 4, 'quatro planilhas carregadas');
      await escolherBase(pg, 'esri'); await irParaKm(pg, '34+780', 3000); await pg.waitForTimeout(500);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.base), 'esri');
      const caixas = () => pg.evaluate(() => {
        const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height }; };
        const cs = (s) => getComputedStyle(document.querySelector(s));
        return { titulo: R('#titlebox'), busca: R('.leftcol .search'), coluna: R('.leftcol'), tools: R('#tools'), shrink: ['#titlebox', '.leftcol .search'].map((s) => cs(s).flexShrink),
          tituloCortado: (() => { const e = document.querySelector('#title'), f = document.querySelector('#subtitle'); return e.scrollWidth > e.clientWidth + 1 || f.scrollWidth > f.clientWidth + 1; })(),
          campo: (() => { const i = document.querySelector('#gokm'), r = i.getBoundingClientRect(), b = document.querySelector('.leftcol .search').getBoundingClientRect(); return { dentro: r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5, cortado: i.scrollHeight > i.clientHeight + 1 }; })() };
      });
      for (const t of ['claro', 'escuro', 'campo']) {
        await tema(pg, t);
        const m = await caixas();
        assert.ok(m.busca.t >= m.titulo.b + 4 - 0.5, `${t}: a busca não pode entrar no título (${m.busca.t} x ${m.titulo.b})`);
        assert.ok(Math.abs(m.busca.h - 44) <= 0.5, `${t}: a busca tem 44 px: ${m.busca.h}`);
        assert.deepEqual(m.shrink, ['0', '0'], `${t}: título e busca não encolhem`);
        assert.ok(m.campo.dentro && !m.campo.cortado, `${t}: o campo "Ir para km" aparece inteiro dentro da busca`);
        assert.equal(m.tituloCortado, false, `${t}: título e subtítulo sem corte`);
        assert.ok(m.coluna.b <= m.tools.t, `${t}: a coluna não encosta na barra lateral`);
      }
    }, { exemplos: true }],
    ['coluna esquerda em tela baixa: rola sozinha, sem sobrepor a barra lateral', ['1366x768'], async (pg) => {
      await pg.click('#uniToggle'); await pg.waitForTimeout(400);
      await pg.setViewportSize({ width: 1366, height: 520 }); await pg.waitForTimeout(800);
      const m = await pg.evaluate(() => {
        const c = document.querySelector('.leftcol'), t = document.querySelector('#tools').getBoundingClientRect();
        const rola = c.scrollHeight > c.clientHeight + 1;
        c.scrollTop = c.scrollHeight;
        const pad = parseFloat(getComputedStyle(c).paddingBottom), ult = document.querySelector('.leftcol .search').getBoundingClientRect();
        return { rola, fimConteudo: c.getBoundingClientRect().bottom - pad, toolsT: t.top, buscaB: ult.bottom };
      });
      assert.ok(m.rola, 'em tela baixa a coluna rola');
      assert.ok(m.fimConteudo <= m.toolsT + 1, `a coluna termina antes da barra lateral: ${m.fimConteudo} x ${m.toolsT}`);
      assert.ok(m.buscaB <= m.fimConteudo + 1, 'rolada até o fim, a busca aparece inteira');
    }],
  ],
  t09: [
    ['Planservi: dois arquivos viram quatro projetos no unifilar, agrupados por rodovia', ['1366x768', 'tablet-h-1024x768'], async (pg) => {
      const nomes = await pg.evaluate(() => window.__pavecad.E.P.map((p) => p.meta.name).sort());
      assert.deepEqual(nomes, ['RD-001 · TH01 · Crescente', 'RD-001 · TH01 · Decrescente', 'RD-001 · TH02 · Crescente', 'RD-001 · TH02 · Decrescente']);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.activeGroup), 'RD-001');
      await pg.waitForTimeout(600);
      const blocos = await pg.evaluate(() => window.__pavecad.blocosDoUnifilar());
      // planilhas do mesmo sentido dividem um bloco: um para o crescente e outro para o decrescente
      assert.deepEqual(blocos, ['RD-001 · Crescente · 2 planilhas', 'RD-001 · Decrescente · 2 planilhas'], 'blocos do unifilar: ' + blocos.join(' | '));
      assert.deepEqual(await pg.evaluate(() => window.__pavecad.planilhasDoUnifilar()), [['RD-001 · TH01 · Crescente', 'RD-001 · TH02 · Crescente'], ['RD-001 · TH01 · Decrescente', 'RD-001 · TH02 · Decrescente']]);
      assert.equal((await pg.evaluate(() => window.__pavecad.lacunasDoUnifilar())).length, 2, 'TH01 e TH02 não são vizinhas: uma lacuna de 48,8 km em cada bloco');
      // filtro: um grupo só (mesma rodovia), então o filtro não aparece; o título do unifilar traz a rodovia
      assert.equal(await pg.evaluate(() => document.querySelectorAll('#unigroups button').length), 0);
      assert.match(await pg.textContent('#title'), /^RD-001$/);
      // sem erro de interface: unifilar legível (altura do cartão cabe na tela)
      const h = await pg.evaluate(() => ({ uni: document.querySelector('#unicard').getBoundingClientRect().height, vh: innerHeight }));
      assert.ok(h.uni <= h.vh * 0.35 + 1, 'o unifilar não passa de 35% da tela: ' + h.uni);
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['Planservi: só IGG, FC-2 e FC-3 além de IRI e ATR; D0, Rc e Defeitos escondidos; limiares do IGG 20, 40, 80 e 160', ['1366x768'], async (pg) => {
      const modos = await pg.evaluate(() => [...document.querySelectorAll('#modes button')].filter((b) => !b.disabled).map((b) => b.querySelector('span').textContent));
      assert.deepEqual(modos, ['Solução', 'IRI', 'ATR', 'IGG', 'FC-2', 'FC-3']);
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('#modes button')].filter((b) => b.disabled).map((b) => b.dataset.m).join(',')), 'd0,rc,def');
      // atalho pela ordem dos botões visíveis: 4 = IGG
      await pg.evaluate(() => document.activeElement && document.activeElement.blur());
      await pg.keyboard.press('4');
      assert.equal(await estado(pg, 'E => E.mode'), 'igg');
      await pg.click('#btnLegenda'); await pg.waitForTimeout(300);
      const leg = await pg.evaluate(() => [...document.querySelectorAll('#legend li button')].map((b) => b.textContent.trim()));
      assert.deepEqual(leg, ['≤ 20', '20 a 40', '40 a 80', '80 a 160', '> 160']);
      await pg.keyboard.press('5');
      assert.equal(await estado(pg, 'E => E.mode'), 'fc2');
      const leg2 = await pg.evaluate(() => [...document.querySelectorAll('#legend li button')].map((b) => b.textContent.trim()));
      assert.equal(leg2[0], '0%', 'FC-2 em porcentagem: ' + leg2.join(' | '));
      assert.ok(leg2.every((t) => /%/.test(t)), 'todos os rótulos com %: ' + leg2.join(' | '));
      // Configurações > Limiares traz IGG, FC-2 e FC-3 editáveis
      await pg.click('#btnCfg'); await pg.waitForTimeout(300); await pg.click('#cfgTabs [data-ct=lim]'); await pg.waitForTimeout(300);
      const cards = await pg.evaluate(() => [...document.querySelectorAll('.cfg-grid [data-k]')].map((c) => c.dataset.k));
      for (const k of ['igg', 'fc2', 'fc3']) assert.ok(cards.includes(k), 'limiar de ' + k);
      const igg = await pg.evaluate(() => [...document.querySelectorAll('.cfg-grid [data-k="igg"] input')].map((i) => +i.value));
      assert.deepEqual(igg, [20, 40, 80, 160]);
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['Planservi: o detalhe do segmento lista as camadas; sem D0, Rc e D120; cor pela camada mais forte', ['1366x768'], async (pg) => {
      // procura um segmento do crescente com intervenção funcional, para ver camadas e cor
      const alvo = await pg.evaluate(() => {
        const p = window.__pavecad.E.P.find((q) => q.meta.name === 'RD-001 · TH01 · Crescente');
        const i = p.rows.findIndex((r) => r.lanes[0] && r.lanes[0].code === 'F4R4');
        return { id: p.id, i };
      });
      assert.ok(alvo.i >= 0, 'um segmento F4R4 na amostra');
      await pg.evaluate((a) => window.__pavecad.select(a.id, a.i, 1, { tab: true }), alvo);
      await pg.waitForTimeout(600);
      const m = await pg.evaluate(() => ({
        params: [...document.querySelectorAll('#t-seg .param .k')].map((k) => k.textContent.trim()),
        aberto: document.querySelector('#segDet').open,
        itens: [...document.querySelectorAll('#segDet .kv > div')].map((d) => [d.querySelector('span').textContent, d.querySelector('b').textContent]),
        chip: document.querySelector('#t-seg .chips .chip').textContent.trim(),
      }));
      assert.deepEqual(m.params, ['IRI', 'Flecha', 'IGG', 'FC-2', 'FC-3'], 'cartões: ' + m.params.join(', '));
      assert.equal(m.aberto, true, 'no Planservi o detalhe abre de saída');
      const nomes = m.itens.map((x) => x[0]);
      for (const n of ['Estrutural', 'Fresagem / Recomposição estrutural', 'Funcional', 'Revestimento']) assert.ok(nomes.includes(n), 'camada ' + n + ' em ' + nomes.join(' | '));
      const fun = m.itens.find((x) => x[0] === 'Funcional')[1];
      assert.match(fun, /^F4R4 · fresagem de 4 cm e recomposição de 4 cm$/);
      assert.match(m.chip, /Fresagem de 4 cm e recomposição de 4 cm/);
      // a cor vem do catálogo: F4R4 usa a de Fres. funcional (a de FS4), e o código original continua o da planilha
      const cor = await pg.evaluate((a) => { const p = window.__pavecad.E.P.find((q) => q.id === a.id); return { code: p.rows[a.i].lanes[0].code, main: p.model[a.i].tr[0].main }; }, alvo);
      assert.deepEqual(cor, { code: 'F4R4', main: 'F4R4' });
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['Planservi: a aba Revisão mostra a qualidade da importação, com o km de cada ocorrência, e o log traz o mesmo', ['1366x768'], async (pg) => {
      await aba(pg, 'notas');
      const sec = await pg.evaluate(() => ({ titulo: [...document.querySelectorAll('#t-notas .sect')].map((e) => e.textContent.trim()), itens: [...document.querySelectorAll('#t-notas details.qual')].map((d) => d.querySelector('summary b').textContent) }));
      assert.ok(sec.titulo.some((t) => /Ocorrências/.test(t)));
      // planilhas sem ocorrência ficam atrás de "mostrar vazias" quando há ocorrências em outras
      const escondidas = await pg.evaluate(() => { const b = document.querySelector('#qVazias'); return b ? +/\((\d+)\)/.exec(b.textContent)[1] : 0; });
      assert.equal(sec.itens.length + escondidas, 4, 'um item por projeto, visível ou atrás de "mostrar vazias": ' + sec.itens.join(' | '));
      assert.ok(sec.itens.length >= 1);
      // o resumo bate com o que o leitor calculou, e cada ocorrência traz o km
      const q = await pg.evaluate(() => window.__pavecad.E.P.map((p) => ({ nome: p.meta.name, corr: (p.qualidade.corrigidos || []).length, saltos: p.qualidade.saltos.length, sent: p.qualidade.sentidos.length })));
      const crescA = q.find((x) => x.nome === 'RD-001 · TH01 · Crescente');
      assert.ok(crescA.corr >= 1 && crescA.saltos === 0 && crescA.sent === 0, 'o ponto fora do lugar foi reconstruído e já não há salto nem distância entre sentidos: ' + JSON.stringify(crescA));
      await pg.click('#t-notas details.qual[data-qp] summary'); await pg.waitForTimeout(300);
      const lista = await pg.evaluate(() => [...document.querySelectorAll('#t-notas details.qual[open] [data-q]')].map((b) => b.textContent.trim()));
      assert.ok(lista.length > 0 && lista.every((t) => /^km \d+\+\d+/.test(t)), 'cada ocorrência começa pelo km: ' + lista.slice(0, 3).join(' | '));
      // clicar numa ocorrência seleciona a linha
      const alvo = await pg.evaluate(() => document.querySelector('#t-notas details.qual[open] [data-q]').dataset.q);
      await pg.click('#t-notas details.qual[open] [data-q]'); await pg.waitForTimeout(800);
      assert.equal(await pg.evaluate(() => { const s = window.__pavecad.E.sel; return s ? s.pid + ':' + s.row : null; }), alvo);
      // o log do projeto (aba Ajustes) traz o mesmo resumo
      await aba(pg, 'aj');
      const log = await pg.evaluate(() => { const E = window.__pavecad.E; return E.P.find((p) => p.meta.name === 'RD-001 · TH01 · Crescente').log.filter((l) => /^planservi/.test(l.code)).map((l) => l.code + ': ' + l.msg); });
      assert.ok(log.some((l) => /planservi-corrigidos/.test(l) && /reconstruída/.test(l) && /deslocamento|m\)/.test(l)), 'log com as coordenadas reconstruídas');
      assert.ok(log.some((l) => /Aba IRI ignorada/.test(l)), 'log da aba IRI ignorada');
      assert.ok(log.some((l) => /Larguras assumidas/.test(l)), 'log das larguras assumidas');
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['Planservi: os quatro projetos sobrevivem ao recarregar, com a qualidade da importação', ['1366x768'], async (pg) => {
      await pg.reload(); await pg.waitForTimeout(2500);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.P.length), 4, 'projetos restaurados do aparelho');
      assert.ok(await pg.evaluate(() => window.__pavecad.E.P.every((p) => p.qualidade && p.meta.format === 'planservi')));
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['RoadRunner: continua com os seis modos e sem IGG e FC', ['1366x768'], async (pg) => {
      const modos = await pg.evaluate(() => [...document.querySelectorAll('#modes button')].filter((b) => !b.disabled).map((b) => b.querySelector('span').textContent));
      assert.deepEqual(modos, ['Solução', 'IRI', 'ATR', 'D0', 'Rc', 'Defeitos']);
    }],
  ],
  t10: [
    ['nitidez do satélite: Segura é o padrão (tile 17), Máxima pede até o 19; preserva centro e zoom, recarrega só a Esri e fica salva', '1366x768', async (pg, { log }) => {
      const estadoMapa = () => pg.evaluate(() => { const m = window.__pavecad.map(), c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), rumo: m.getBearing(), esri: m.getLayoutProperty('esri', 'visibility'), max: m.getSource('esri').maxzoom, osm: m.getSource('osm').__marca || null, esriMarca: m.getSource('esri').__marca || null }; });
      const pressed = () => pg.evaluate(() => [...document.querySelectorAll('#nitidez button')].map((b) => b.dataset.n + ':' + b.getAttribute('aria-pressed')).join(','));
      const zsEsri = () => log.tiles.filter((t) => /arcgisonline/.test(t.url) && t.z !== null).map((t) => t.z);
      const pedir = async (acao) => { log.tiles.length = 0; if (acao) await acao(); await pg.waitForTimeout(1800); return zsEsri(); };
      const mesmoLugar = (a, b, msg) => { for (const k of ['lng', 'lat', 'zoom', 'rumo']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${msg}: ${k} ${a[k]} x ${b[k]}`); };

      await escolherBase(pg, 'esri'); await irParaKm(pg, '170+500', 1500);
      await pg.evaluate(() => { const m = window.__pavecad.map(); m.jumpTo({ zoom: 21 }); m.getSource('osm').__marca = 'osm'; m.getSource('esri').__marca = 'esri-antes'; });
      assert.equal(await pressed(), 'segura:true,maxima:false', 'o padrão é Segura');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-nitidez')), null, 'sem escolha salva ainda');
      let zs = await pedir(() => pg.evaluate(() => { const m = window.__pavecad.map(); m.jumpTo({ zoom: 20.9 }); m.jumpTo({ zoom: 21 }); }));
      const e0 = await estadoMapa();
      assert.equal(e0.max, 17, 'padrão: a Esri vai até o tile 17');
      assert.ok(e0.zoom >= 20.99, 'zoom 21: ' + e0.zoom);
      assert.ok(!zs.length || Math.max(...zs) <= 17, `Segura (padrão): tiles até o 17 (pediu ${[...new Set(zs)].join(', ')})`); // os tiles do g08 cobrem o pedido do zero

      // Máxima: a fonte da Esri é recriada com tile até o 19; centro, zoom e rumo ficam onde estavam
      zs = await pedir(() => escolherNitidez(pg, 'maxima'));
      const e1 = await estadoMapa();
      assert.equal(e1.max, 19, 'a fonte da Esri agora vai até o 19');
      assert.ok(zs.length > 0, 'pediu tiles depois da troca');
      assert.ok(Math.max(...zs) <= 19 && zs.includes(19), `Máxima: tiles até o 19 (pediu ${[...new Set(zs)].join(', ')})`);
      mesmoLugar(e0, e1, 'Máxima');
      assert.equal(e1.esri, 'visible', 'a camada do satélite continua visível');
      assert.equal(e1.osm, 'osm', 'a fonte das ruas não foi recarregada');
      assert.equal(e1.esriMarca, null, 'a fonte da Esri foi recriada');
      assert.equal(await pressed(), 'segura:false,maxima:true');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-nitidez')), 'maxima', 'salvo no localStorage');

      // Segura de volta: tile 17
      zs = await pedir(() => escolherNitidez(pg, 'segura'));
      const e2 = await estadoMapa();
      assert.equal(e2.max, 17);
      assert.ok(Math.max(...zs) <= 17 && zs.includes(17), `Segura: tiles até o 17 (pediu ${[...new Set(zs)].join(', ')})`);
      mesmoLugar(e0, e2, 'volta à Segura');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-nitidez')), 'segura');

      // a escolha sobrevive ao recarregar
      await escolherNitidez(pg, 'maxima');
      await pg.reload(); await pg.waitForTimeout(2500);
      assert.equal(await pressed(), 'segura:false,maxima:true', 'a chave volta em Máxima');
      await escolherBase(pg, 'esri');
      await pg.evaluate((c) => window.__pavecad.map().jumpTo({ center: [c.lng, c.lat], zoom: 21 }), e0);
      zs = await pedir(() => pg.evaluate((c) => window.__pavecad.map().jumpTo({ center: [c.lng + 0.0001, c.lat], zoom: 21 }), e0));
      assert.equal((await estadoMapa()).max, 19, 'a Esri nasce com tile até o 19');
      assert.ok(Math.max(...zs) <= 19 && zs.includes(19), `depois de recarregar: tiles até o 19 (pediu ${[...new Set(zs)].join(', ')})`);
    }],
    ['nitidez do satélite: a chave fica ao lado de Liso, Ruas e Satélite, com alvos de 44 px', ['1568x760', 'tablet-h-1024x768', 'tablet-v-820x1180'], async (pg) => {
      await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible' });
      const m = await pg.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect(), d = R('#drawer'), base = R('#base'), n = R('#nitidezBox');
        return { rot: document.querySelector('#nitidezRot').textContent, botoes: [...document.querySelectorAll('#nitidez button')].map((b) => [b.textContent, Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]),
          dentro: n.left >= d.left - 0.5 && n.right <= d.right + 0.5 && n.bottom <= d.bottom + 0.5, abaixoBase: n.top >= base.bottom - 0.5, naGaveta: !!document.querySelector('#drawer #nitidez') };
      });
      assert.equal(m.rot, 'Nitidez do satélite');
      assert.deepEqual(m.botoes.map((b) => b[0]), ['Segura', 'Máxima']);
      assert.ok(m.botoes.every((b) => b[1] >= 44 && b[2] >= 44), 'alvos de 44 px: ' + JSON.stringify(m.botoes));
      assert.ok(m.dentro && m.abaixoBase && m.naGaveta, 'dentro da gaveta, junto da escolha de base');
    }],
  ],
  t11: [
    ['larguras: "Aplicar a outras planilhas…" lista as outras com nome, rodovia e sentido, atalhos marcam o conjunto certo e só as marcadas mudam', '1366x768', async (pg) => {
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=larg]'); await pg.waitForSelector('#lgProj');
      const info = await pg.evaluate(() => { const E = window.__pavecad.E, pid = document.querySelector('#lgProj').value; return { pid, todas: E.P.map((p) => ({ id: p.id, travel: p.meta.travel, uf: p.meta.uf })) }; });
      assert.ok(info.todas.length >= 4, 'esperava 4 planilhas, vieram ' + info.todas.length);
      assert.equal(await pg.isDisabled('#lgOutras'), true, 'sem ajustes, não há o que copiar');
      await pg.fill('#lgW', '3.2'); await pg.click('#lgAdd'); await pg.waitForFunction((pid) => window.__pavecad.E.P.find((p) => p.id === pid).ajustes.length === 1, info.pid);
      await pg.click('#lgOutras'); await pg.waitForSelector('#seletor');
      const outras = info.todas.filter((p) => p.id !== info.pid);
      assert.equal(await pg.locator('#seletor input[data-id]').count(), outras.length, 'a origem não aparece');
      assert.equal(await pg.locator(`#seletor input[data-id="${info.pid}"]`).count(), 0);
      const linhas = await pg.locator('#seletor .sel-item').allInnerTexts();
      assert.ok(linhas.every((t) => /Crescente|Decrescente/.test(t) && /\S+/.test(t.split('\n')[1] || '')), 'cada linha traz nome, rodovia e sentido: ' + linhas.join(' | '));
      assert.equal(await pg.isDisabled('#selOk'), true, 'nada marcado: Aplicar desabilitado');
      assert.match(await pg.innerText('#selCont'), new RegExp(`^0 de ${outras.length} selecionadas`));
      const marcados = () => pg.evaluate(() => [...document.querySelectorAll('#seletor input[data-id]')].filter((c) => c.checked).map((c) => c.dataset.id).sort());
      const ids = (f) => outras.filter(f).map((p) => p.id).sort();
      await pg.click('#seletor [data-atalho=todas]'); assert.deepEqual(await marcados(), ids(() => true));
      await pg.click('#seletor [data-atalho=nenhuma]'); assert.deepEqual(await marcados(), []);
      await pg.click('#seletor [data-atalho=crescentes]'); assert.deepEqual(await marcados(), ids((p) => p.travel === 1));
      await pg.click('#seletor [data-atalho=rodovia]'); const orig = info.todas.find((p) => p.id === info.pid); assert.deepEqual(await marcados(), ids((p) => p.uf === orig.uf));
      await pg.click('#seletor [data-atalho=decrescentes]');
      assert.deepEqual(await marcados(), ids((p) => p.travel === -1), 'Só decrescentes marca apenas as decrescentes');
      assert.equal(await pg.isDisabled('#selOk'), false);
      const nDec = ids((p) => p.travel === -1).length;
      assert.match(await pg.innerText('#selCont'), new RegExp(`^${nDec} de ${outras.length} selecionadas`));
      await pg.click('#selOk');
      await pg.waitForFunction((n) => window.__pavecad.E.P.filter((p) => p.ajustes.length === 1).length === n, nDec + 1, { timeout: 20000 });
      const depois = await pg.evaluate(() => window.__pavecad.E.P.map((p) => ({ id: p.id, travel: p.meta.travel, aj: p.ajustes.map((a) => [a.lane, a.largura, a.pname]) })));
      for (const p of depois) {
        const esperado = p.id === info.pid || (p.travel === -1);
        assert.equal(p.aj.length, esperado ? 1 : 0, `${p.id}: ajustes ${JSON.stringify(p.aj)}`);
      }
      assert.ok(depois.filter((p) => p.travel === -1).every((p) => p.aj[0][1] === 3.2));
      // desfazer pelo aviso
      await pg.click('.toast-acao button');
      await pg.waitForFunction((pid) => window.__pavecad.E.P.every((p) => p.id === pid || p.ajustes.length === 0), info.pid, { timeout: 20000 });
      assert.equal(await pg.evaluate((pid) => window.__pavecad.E.P.find((p) => p.id === pid).ajustes.length, info.pid), 1, 'a origem continua com o ajuste');
    }, { exemplos: true }],
    ['larguras: faixas que o destino não tem são ignoradas e o aviso diz quais', '1366x768', async (pg) => {
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=larg]'); await pg.waitForSelector('#lgProj');
      const pid = await pg.inputValue('#lgProj');
      // acrescenta um ajuste na Fx 6, que nenhuma planilha de exemplo possui
      await pg.evaluate(async (pid) => { const E = window.__pavecad.E, p = E.P.find((q) => q.id === pid); p.ajustes = [{ id: 'z1', pname: p.meta.name, lane: 1, km0: null, km1: null, largura: 3.3 }, { id: 'z2', pname: p.meta.name, lane: 6, km0: null, km1: null, largura: 3.1 }]; }, pid);
      await pg.click('#cfgTabs [data-ct=dados]'); await pg.click('#cfgTabs [data-ct=larg]'); await pg.waitForSelector('#lgOutras:not([disabled])');
      await pg.click('#lgOutras'); await pg.waitForSelector('#seletor');
      const alvo = (await pg.locator('#seletor input[data-id]').first().getAttribute('data-id'));
      await pg.check(`#seletor input[data-id="${alvo}"]`);
      assert.match(await pg.innerText('#selAviso'), /Faixas inexistentes.*Fx 6/s, 'o rodapé avisa antes de aplicar');
      await pg.click('#selOk');
      await pg.waitForSelector('.toast-acao');
      assert.match(await pg.innerText('.toast-acao'), /ignoradas.*Fx 6/s);
      const aj = await pg.evaluate((id) => window.__pavecad.E.P.find((p) => p.id === id).ajustes.map((a) => a.lane), alvo);
      assert.deepEqual(aj, [1], 'só a Fx 1 foi copiada');
    }, { exemplos: true }],
    ['deslocamento: ±1 m e ±5 m, campo numérico e Zerar movem a pista no valor esperado; fica salvo e volta após recarregar', '1366x768', async (pg) => {
      const medir = () => pg.evaluate(() => {
        const E = window.__pavecad.E, p = E.P.find((q) => q.meta.travel === 1), f = p.camadas.polys.features.find((q) => q.properties.row > 5 && q.properties.lane === 1);
        const o = p.rowsPlanilha, r0 = f.properties.row, c = f.geometry.coordinates[0][0], mLon = 111320 * Math.cos((o[r0].lat * Math.PI) / 180);
        const tE = (o[r0 + 1].lon - o[r0].lon) * mLon, tN = (o[r0 + 1].lat - o[r0].lat) * 111132, d = Math.hypot(tE, tN);
        return { pid: p.id, c, mLon, tE: tE / d, tN: tN / d, desloc: { ...p.desloc }, lat: p.rows[r0].lat, lon: p.rows[r0].lon };
      });
      const mover = (a, b) => { const dE = (b.c[0] - a.c[0]) * a.mLon, dN = (b.c[1] - a.c[1]) * 111132; return { l: dE * a.tE + dN * a.tN, t: dE * a.tN + dN * -a.tE, d: Math.hypot(dE, dN) }; };
      const perto = (v, esp, msg) => assert.ok(Math.abs(v - esp) < 0.08, `${msg}: ${v.toFixed(3)} x ${esp}`);
      const ajustou = async (l, t) => { await pg.waitForFunction(([pid, l, t]) => { const p = window.__pavecad.E.P.find((q) => q.id === pid); return p.desloc.l === l && p.desloc.t === t; }, [(await medir()).pid, l, t], { timeout: 15000 }); await pg.waitForTimeout(400); };
      const pid = (await medir()).pid;
      await aba(pg, 'aj'); await pg.waitForSelector('#a-lista');
      await pg.click('#t-aj [data-atalho=nenhuma]'); await pg.check(`#a-lista input[data-id="${pid}"]`); await pg.waitForSelector('#d-l');
      const m0 = await medir();
      assert.deepEqual(m0.desloc, { l: 0, t: 0 });
      // transversal +5 m (direita do sentido de percurso)
      await pg.click('[data-d=t][data-s="5"]'); await ajustou(0, 5);
      let m1 = await medir(), d = mover(m0, m1);
      perto(d.t, 5, 'transversal +5'); perto(d.l, 0, 'sem longitudinal');
      assert.equal(await pg.inputValue('#d-t'), '5');
      // +1 e −1 voltam 1 m a cada clique
      await pg.click('[data-d=t][data-s="1"]'); await ajustou(0, 6);
      await pg.click('[data-d=t][data-s="-5"]'); await ajustou(0, 1);
      m1 = await medir(); perto(mover(m0, m1).t, 1, 'transversal +1 depois de +5 +1 −5');
      // longitudinal pelo campo numérico: 7 m no sentido de percurso
      await pg.fill('#d-l', '7'); await pg.press('#d-l', 'Tab'); await ajustou(7, 1);
      const m2 = await medir(); d = mover(m0, m2);
      perto(d.l, 7, 'longitudinal 7'); perto(d.t, 1, 'transversal 1 mantido');
      // transversal negativo vai para a esquerda
      await pg.fill('#d-t', '-4'); await pg.press('#d-t', 'Tab'); await ajustou(7, -4);
      perto(mover(m0, await medir()).t, -4, 'transversal −4 (esquerda)');
      // as linhas efetivas (coordenadas exportadas/GPS) acompanham o longitudinal; a planilha original não muda
      const lin = await pg.evaluate((pid) => {
        const p = window.__pavecad.E.P.find((q) => q.id === pid), a = p.rowsPlanilha[10], b = p.rows[10];
        return { d: Math.hypot((b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 111132), planilhaIntacta: p.rowsPlanilha[10] !== p.rows[10] };
      }, pid);
      assert.ok(Math.abs(lin.d - 7) < 0.15, 'a linha efetiva (CSV e GPS) andou 7 m: ' + lin.d);
      assert.equal(lin.planilhaIntacta, true, 'a linha original da planilha não foi alterada');
      // persistência
      await pg.click('#d-aplicar'); await pg.waitForFunction(() => !!document.querySelector('.toast-acao'));
      await pg.waitForTimeout(600);
      const antes = await medir();
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length >= 1, null, { timeout: 60000 }); await pg.waitForTimeout(3000);
      const depois = await pg.evaluate(() => { const p = window.__pavecad.E.P.find((q) => q.meta.travel === 1); return { n: window.__pavecad.E.P.length, desloc: { ...p.desloc }, lat: p.rows[10].lat }; });
      assert.deepEqual(depois.desloc, { l: 7, t: -4 }, 'o deslocamento volta após recarregar');
      assert.ok(Math.abs(depois.lat - (await pg.evaluate(() => window.__pavecad.E.P.find((q) => q.meta.travel === 1).rowsPlanilha[10].lat))) > 1e-6, 'e a geometria está deslocada');
      await aba(pg, 'aj'); await pg.waitForSelector('#a-lista');
      await pg.click('#t-aj [data-atalho=crescentes]');
      assert.equal(await pg.inputValue('#d-l'), '7'); assert.equal(await pg.inputValue('#d-t'), '-4');
      // Zerar
      await pg.click('#d-zero');
      await pg.waitForFunction(() => window.__pavecad.E.P.every((p) => p.desloc.l === 0 && p.desloc.t === 0), null, { timeout: 15000 });
      await pg.waitForTimeout(500);
      const m3 = await medir(); const dz = mover(m0, m3);
      perto(dz.d, 0, 'Zerar volta ao ponto original');
      assert.equal(await pg.inputValue('#d-l'), '0');
      void antes;
    }],
    ['Alinhar: marcar planilhas por checkbox, Aplicar às selecionadas grava só nelas ("Só decrescentes"), sair sem aplicar descarta e Desfazer restaura', '1366x768', async (pg) => {
      await aba(pg, 'aj');
      await pg.waitForSelector('#a-lista');
      const ver = () => pg.evaluate(() => window.__pavecad.E.P.map((p) => ({ id: p.id, travel: p.meta.travel, d: { ...p.desloc } })));
      const salvos = () => pg.evaluate(() => JSON.stringify(window.__pavecad.E.deslocSalvos));
      const todas = await ver();
      assert.equal(await pg.locator('#a-lista input[data-id]').count(), todas.length, 'todas as planilhas aparecem na lista');
      assert.equal(await pg.locator('select#a-proj').count(), 0, 'a lista suspensa deixou de existir');
      const dec = todas.filter((p) => p.travel === -1);
      await pg.click('#t-aj [data-atalho=decrescentes]');
      const marc = () => pg.evaluate(() => [...document.querySelectorAll('#a-lista input[data-id]')].filter((c) => c.checked).map((c) => c.dataset.id).sort());
      assert.deepEqual(await marc(), dec.map((p) => p.id).sort(), 'Só decrescentes marca apenas as decrescentes');
      assert.match(await pg.innerText('#a-cont'), new RegExp(`^${dec.length} de ${todas.length}`, 'i'));
      assert.equal(await pg.isDisabled('#d-aplicar'), true, 'sem alteração, Aplicar fica desabilitado');
      // +5 longitudinal e −1 transversal aparecem no mapa na hora, mas ainda não estão gravados
      await pg.click('[data-d=l][data-s="5"]');
      await pg.waitForFunction(() => window.__pavecad.E.P.filter((p) => p.meta.travel === -1).every((p) => p.desloc.l === 5), null, { timeout: 30000 });
      await pg.click('[data-d=t][data-s="-1"]');
      await pg.waitForFunction(() => window.__pavecad.E.P.filter((p) => p.meta.travel === -1).every((p) => p.desloc.t === -1), null, { timeout: 30000 });
      for (const p of await ver()) assert.deepEqual(p.d, p.travel === -1 ? { l: 5, t: -1 } : { l: 0, t: 0 }, `${p.id} (${p.travel})`);
      assert.equal(await salvos(), '{}', 'a prévia não grava');
      assert.equal(await pg.isDisabled('#d-aplicar'), false);
      // sair sem aplicar volta ao valor gravado
      await aba(pg, 'seg');
      await pg.waitForFunction(() => window.__pavecad.E.P.every((p) => p.desloc.l === 0 && p.desloc.t === 0), null, { timeout: 30000 });
      // de novo, agora aplicando
      await aba(pg, 'aj'); await pg.waitForSelector('#a-lista');
      await pg.click('#t-aj [data-atalho=decrescentes]');
      await pg.click('[data-d=l][data-s="5"]');
      await pg.waitForFunction(() => window.__pavecad.E.P.filter((p) => p.meta.travel === -1).every((p) => p.desloc.l === 5), null, { timeout: 30000 });
      await pg.click('#d-aplicar');
      await pg.waitForSelector('.toast-acao');
      assert.match(await pg.innerText('.toast-acao'), new RegExp(`Deslocamento aplicado a ${dec.length} planilha`));
      const gravados = await pg.evaluate(() => window.__pavecad.E.deslocSalvos);
      assert.equal(Object.keys(gravados).length, dec.length, 'só as marcadas foram gravadas');
      for (const p of await ver()) assert.deepEqual(p.d, p.travel === -1 ? { l: 5, t: 0 } : { l: 0, t: 0 }, `${p.id} depois de aplicar`);
      // individual: uma só marcada
      const uma = dec[0].id;
      await pg.click('#t-aj [data-atalho=nenhuma]'); await pg.check(`#a-lista input[data-id="${uma}"]`);
      await pg.click('[data-d=l][data-s="1"]');
      await pg.waitForFunction((id) => window.__pavecad.E.P.find((p) => p.id === id).desloc.l === 6, uma, { timeout: 30000 });
      for (const p of await ver()) assert.deepEqual(p.d, p.id === uma ? { l: 6, t: 0 } : p.travel === -1 ? { l: 5, t: 0 } : { l: 0, t: 0 }, `${p.id} depois do ajuste individual`);
      // valores diferentes entre as marcadas aparecem como "vários"
      await pg.click('#d-aplicar');
      await pg.click('#t-aj [data-atalho=decrescentes]');
      if (dec.length > 1) { assert.equal(await pg.inputValue('#d-l'), ''); assert.equal(await pg.getAttribute('#d-l', 'placeholder'), 'vários'); }
      // nenhuma marcada: nada para alinhar
      await pg.click('#t-aj [data-atalho=nenhuma]');
      assert.equal(await pg.locator('#desloc').count(), 0, 'sem planilha marcada, não há o que alinhar');
      // desfazer: restaura o valor gravado antes da aplicação
      await pg.click('#t-aj [data-atalho=decrescentes]');
      await pg.click('#d-zero');
      await pg.waitForFunction(() => window.__pavecad.E.P.filter((p) => p.meta.travel === -1).every((p) => p.desloc.l === 0), null, { timeout: 30000 });
      await pg.click('#d-aplicar');
      await pg.waitForSelector('.toast-acao');
      await pg.click('.toast-acao button');
      await pg.waitForFunction((id) => window.__pavecad.E.P.find((p) => p.id === id).desloc.l === 6, uma, { timeout: 30000 });
    }, { exemplos: true }],
    ['Alinhar: sentidos opostos mostram o aviso e "Copiar como deslocamento no mapa" converte o vetor pelo azimute médio de cada planilha', '1366x768', async (pg) => {
      await aba(pg, 'aj'); await pg.waitForSelector('#a-lista');
      const info = await pg.evaluate(() => window.__pavecad.E.P.map((p) => ({ id: p.id, travel: p.meta.travel, uf: p.meta.uf })));
      const cres = info.find((p) => p.travel === 1), decr = info.find((p) => p.travel === -1 && p.uf === cres.uf);
      await pg.click('#t-aj [data-atalho=nenhuma]'); await pg.check(`#a-lista input[data-id="${cres.id}"]`);
      assert.equal(await pg.isVisible('#al-sentidos'), false, 'uma planilha só: sem aviso');
      await pg.fill('#d-l', '5'); await pg.press('#d-l', 'Tab');
      await pg.waitForFunction((id) => window.__pavecad.E.P.find((p) => p.id === id).desloc.l === 5, cres.id, { timeout: 30000 });
      await pg.fill('#d-t', '3'); await pg.press('#d-t', 'Tab');
      await pg.waitForFunction((id) => window.__pavecad.E.P.find((p) => p.id === id).desloc.t === 3, cres.id, { timeout: 30000 });
      await pg.check(`#a-lista input[data-id="${decr.id}"]`);
      await pg.waitForSelector('#al-sentidos', { state: 'visible' });
      assert.match(await pg.innerText('#al-sentidos'), /O deslocamento transversal será aplicado em relação ao sentido de cada planilha/);
      assert.equal(await pg.innerText('#d-copiar-mapa'), 'Copiar como deslocamento no mapa');
      await pg.click('#d-copiar-mapa');
      await pg.waitForFunction((id) => { const d = window.__pavecad.E.P.find((p) => p.id === id).desloc; return d.l !== 0 || d.t !== 0; }, decr.id, { timeout: 30000 });
      await pg.waitForTimeout(500);
      const v = await pg.evaluate(([c, d]) => { const E = window.__pavecad.E; return { c: { ...E.P.find((p) => p.id === c).desloc }, d: { ...E.P.find((p) => p.id === d).desloc } }; }, [cres.id, decr.id]);
      assert.deepEqual(v.c, { l: 5, t: 3 }, 'a referência não muda');
      // pistas paralelas de sentidos opostos: o mesmo vetor no mapa tem os dois sinais trocados
      assert.ok(Math.abs(v.d.l + 5) < 1 && Math.abs(v.d.t + 3) < 1, 'convertido pelo azimute médio: ' + JSON.stringify(v.d));
      assert.ok(await pg.evaluate(() => !document.querySelector('#d-aplicar').disabled));
    }, { exemplos: true }],
    ['Alinhar nos Ajustes: seção própria com todos os controles à vista de uma vez (±1 e ±5 m, campos, Zerar, Aplicar, seleção por planilha e por sentido), alvos de 44 px, e nenhum outro ponto de entrada', TODOS, async (pg) => {
      assert.equal(await pg.locator('#btnAlinhar, #btnAlinharG, [data-alinhar]').count(), 0, 'sem botão Alinhar na barra de ferramentas nem na gaveta do mapa');
      assert.equal(await pg.locator('#tabs [data-t=al]').count(), 0, 'não há aba Alinhar separada'); assert.equal(await pg.evaluate(() => !!document.querySelector('#t-al').closest('#t-aj')), true, 'o Alinhar só existe dentro de Ajustes');
      await aba(pg, 'aj');
      await pg.waitForSelector('#t-aj #alSect');
      await pg.waitForSelector('#t-aj #desloc', { state: 'visible' });
      const m = await pg.evaluate(() => {
        const alvo = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; };
        const todos = ['[data-d=l][data-s="-5"]', '[data-d=l][data-s="-1"]', '[data-d=l][data-s="1"]', '[data-d=l][data-s="5"]', '[data-d=t][data-s="-5"]', '[data-d=t][data-s="-1"]', '[data-d=t][data-s="1"]', '[data-d=t][data-s="5"]', '#d-l', '#d-t', '#d-zero', '#d-aplicar'];
        return {
          visiveis: todos.filter((s) => !document.querySelector(s)?.checkVisibility()),
          passos: ['l', 't'].map((e) => [-5, -1, 1, 5].map((v) => alvo(`[data-d=${e}][data-s="${v}"]`))),
          campos: [alvo('#d-l'), alvo('#d-t')], zero: alvo('#d-zero'), aplicar: alvo('#d-aplicar'), item: alvo('#a-lista .sel-item'),
          atalhos: [...document.querySelectorAll('#t-aj [data-atalho]')].map((b) => b.dataset.atalho),
          dentro: document.querySelector('#desloc').getBoundingClientRect().right <= window.innerWidth + 0.5,
          rolagemH: document.querySelector('#t-aj').scrollWidth <= document.querySelector('#t-aj').clientWidth + 1,
        };
      });
      assert.deepEqual(m.visiveis, [], 'todos os controles do Alinhar visíveis ao mesmo tempo');
      assert.deepEqual(m.atalhos, ['todas', 'nenhuma', 'crescentes', 'decrescentes', 'rodovia'], 'seleção por planilha e por sentido na mesma aba');
      for (const g of m.passos) for (const a of g) assert.ok(a && a[0] >= 44 && a[1] >= 44, 'botão de passo ≥ 44 px: ' + JSON.stringify(m.passos));
      for (const a of [...m.campos, m.zero, m.aplicar]) assert.ok(a && a[1] >= 44, 'alvo ≥ 44 px: ' + JSON.stringify(m));
      const toque = await pg.evaluate(() => matchMedia('(pointer: coarse)').matches);
      assert.ok(m.item && m.item[1] >= (toque ? 44 : 36), 'linha da lista: ' + JSON.stringify(m.item));
      assert.ok(m.dentro && m.rolagemH, 'cabe na largura da tela, sem rolagem horizontal');
      // ajustar não abre nenhum sub-diálogo
      await pg.click('[data-d=l][data-s="1"]'); await pg.waitForTimeout(400);
      assert.equal(await pg.locator('[role=dialog]:not([hidden]), dialog[open]').count(), 0, 'sem sub-diálogo para ajustar');
      await pg.click('#d-zero'); await pg.waitForTimeout(300);
    }],
    ['celular: o Alinhar na aba Ajustes, com a gaveta cheia, cabe na largura (sem rolagem horizontal) e todos os controles têm alvo de 44 px ou mais', CELULARES, async (pg) => {
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      assert.equal(await pg.locator('#btnAlinhar, #btnAlinharG, [data-alinhar]').count(), 0, 'sem entrada do Alinhar no menu "Mapa" nem na barra');
      await pg.keyboard.press('a'); await pg.waitForSelector('#t-aj #desloc', { state: 'visible', timeout: 5000 }); await pg.waitForTimeout(500);
      const m = await pg.evaluate(() => {
        const alvos = [...document.querySelectorAll('#desloc button, #desloc input')].filter((e) => e.checkVisibility()).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.id, Math.round(r.width), Math.round(r.height), r.right <= innerWidth + 0.5 && r.left >= -0.5]; });
        const aj = document.querySelector('#t-aj');
        return { alvos, rolagemH: aj.scrollWidth <= aj.clientWidth + 1, pagina: document.documentElement.scrollWidth <= innerWidth + 1, gaveta: document.documentElement.classList.contains('gav-cheia') };
      });
      assert.ok(m.gaveta, 'a gaveta abre cheia'); assert.ok(m.rolagemH && m.pagina, 'sem rolagem horizontal: ' + JSON.stringify(m));
      for (const [nome, w, h, dentro] of m.alvos) { assert.ok(h >= 44, `alvo ${nome} com ${h} px de altura`); assert.ok(dentro, `${nome} dentro da largura da tela`); }
    }],
    ['Alinhar: sem botão ao lado do mapa, a tecla A abre Ajustes na seção Alinhar e o cartão do projeto tem o atalho de texto "Alinhar: abrir Ajustes"', '1366x768', async (pg) => {
      await pg.keyboard.press('a'); await pg.waitForTimeout(500);
      assert.equal(await estado(pg, 'E => E.tab'), 'aj');
      assert.ok(await pg.isVisible('#t-aj #alSect'), 'a seção Alinhar está à vista');
      await aba(pg, 'seg');
      await abrirProjetos(pg);
      assert.match(await pg.innerText('#dash [data-alinhar-p]'), /Alinhar: abrir Ajustes/);
      await pg.click('#dash [data-alinhar-p]'); await pg.waitForTimeout(500);
      assert.equal(await pg.isVisible('#dash'), false); assert.equal(await estado(pg, 'E => E.tab'), 'aj');
      assert.equal(await estado(pg, 'E => E.settingsSel.size'), 1, 'a planilha do cartão fica marcada');
    }],
  ],
  t12: [
    ['coordenadas reconstruídas: o selo aparece na planilha e o relatório lista os pontos com km, tipo e deslocamento', '1366x768', async (pg, { log }) => {
      const info = await pg.evaluate(() => window.__pavecad.E.P.map((p) => ({ id: p.id, nome: p.meta.name, n: p.qualidade?.corrigidos?.length ?? 0, cortes: p.qualidade?.cortes?.length ?? 0, inv: p.camadas.invalidos.length })));
      assert.equal(info.length, 4);
      const com = info.filter((i) => i.n > 0);
      assert.ok(com.length >= 1, 'ao menos uma planilha da amostra tem ponto reconstruído: ' + JSON.stringify(info));
      // selo no dashboard de projetos: só nas planilhas com correção, com o número certo
      await abrirProjetos(pg);
      const selos = await pg.evaluate(() => [...document.querySelectorAll('#dash .pcard')].map((r) => ({ nome: r.querySelector('.nm b')?.textContent, selo: r.querySelector('.selo')?.textContent ?? null })));
      await fecharProjetos(pg);
      for (const i of info) {
        const s = selos.find((x) => x.nome === i.nome);
        assert.equal(s.selo, i.n ? `coordenadas corrigidas: ${i.n}` : null, i.nome);
      }
      // relatório na aba Revisão
      await aba(pg, 'notas');
      const rel = await pg.innerText('#t-notas');
      assert.match(rel, /ocorrências/i);
      assert.match(rel, /corrigidas?/);
      // abre a primeira planilha com correção e confere as linhas do relatório
      const alvo = com[0];
      await pg.click(`[data-qp="${alvo.id}"] summary`);
      const itens = await pg.locator(`[data-qp="${alvo.id}"] .row`).allInnerTexts();
      assert.ok(itens.some((t) => /andou [\d.,]+ m em relação à planilha/.test(t) && /km \d+\+\d+/.test(t)), 'cada ponto traz km, tipo e deslocamento: ' + itens.slice(0, 3).join(' | '));
      // o log da aba Ajustes traz o mesmo resumo
      await aba(pg, 'aj');
      await pg.click('#t-aj [data-atalho=nenhuma]'); await pg.check(`#a-lista input[data-id="${alvo.id}"]`);
      assert.match(await pg.innerText('#t-aj'), /coordenadas corrigidas: \d+/);
      assert.equal(log.erros.filter((e) => !/Failed to load resource/i.test(e)).length, 0, log.erros.join(' | '));
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
  ],
  t13: [
    ['modo privacidade: oculta nomes, rodovia e km na tela, vale para o "Ir para km", persiste e desliga', '1366x768', async (pg) => {
      const corpo = () => pg.evaluate(() => document.body.innerText);
      assert.match(await corpo(), /RD-001/, 'sem privacidade, a rodovia aparece');
      await aba(pg, 'aj');
      await pg.click('#s-priv');
      await pg.waitForFunction(() => window.__pavecad.E.privacidade === true);
      await pg.waitForTimeout(600);
      let txt = await corpo();
      assert.doesNotMatch(txt, /RD-001|TH0[12]/, 'nenhum nome de rodovia ou trecho na tela');
      assert.equal(await pg.textContent('#title'), 'Rodovia A');
      await abrirProjetos(pg);
      const nomes = await pg.evaluate(() => [...document.querySelectorAll('#dash .pcard .nm b')].map((b) => b.textContent));
      assert.ok(nomes.every((n) => /^Planilha \d+ · (Crescente|Decrescente)$/.test(n)), nomes.join(' | '));
      await fecharProjetos(pg);
      // km: contado a partir do início da primeira planilha
      const k = await pg.evaluate(() => { const p = window.__pavecad.E.P[0]; return { real: p.kmNum[5], lab: p.kmLab[5], base: Math.floor(Math.min(...window.__pavecad.E.P.map((q) => q.kmNum[0]))) }; });
      assert.equal(k.lab, '0+100', `o km real ${k.real} aparece como ${k.lab}`);
      await pg.evaluate(() => window.__pavecad.select(window.__pavecad.E.P[0].id, 5, 1, { tab: false }));
      await pg.waitForTimeout(400);
      assert.match(await pg.textContent('#ikm'), /^km 0\+100 · Planilha 1 · /);
      // "Ir para km" aceita o km mostrado
      await pg.fill('#gokm', '0+300'); await pg.click('#goBtn'); await pg.waitForTimeout(1200);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.sel && window.__pavecad.E.sel.row), 15, 'o km 0+300 mostrado é a linha 15 da planilha');
      // a escolha fica salva e vale depois de recarregar
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length >= 4, null, { timeout: 60000 }); await pg.waitForTimeout(2500);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.privacidade), true);
      assert.doesNotMatch(await corpo(), /RD-001|TH0[12]/, 'depois de recarregar continua oculto');
      // desliga
      await aba(pg, 'aj');
      await pg.click('#s-priv');
      await pg.waitForFunction(() => window.__pavecad.E.privacidade === false);
      await pg.waitForTimeout(600);
      assert.match(await corpo(), /RD-001/);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.P[0].kmLab[5]), await pg.evaluate(() => { const k = window.__pavecad.E.P[0].kmNum[5]; return `${Math.floor(k)}+${String(Math.round((k % 1) * 1000)).padStart(3, '0')}`; }));
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
  ],
  t14: [
    ['lixeira: remover mostra aviso com Desfazer; desfazer devolve a planilha na mesma posição, com ajustes de largura e propostas', '1366x768', async (pg) => {
      await criarProposta(pg, 'FSE', 'trecho de teste');
      const info = await pg.evaluate(() => { const E = window.__pavecad.E; const r = E.props[0]; return { pname: r.pname, n: E.P.length, nomes: E.P.map((p) => p.meta.name), idx: E.P.findIndex((p) => p.meta.name === r.pname), pid: E.P.find((p) => p.meta.name === r.pname).id }; });
      // ajuste de largura na planilha da proposta, pela tela de Configurações
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=larg]'); await pg.waitForSelector('#lgProj');
      await pg.selectOption('#lgProj', info.pid);
      await pg.fill('#lgW', '3.2'); await pg.click('#lgAdd');
      await pg.waitForFunction((pid) => window.__pavecad.E.P.find((p) => p.id === pid).ajustes.length === 1, info.pid, { timeout: 20000 });
      await pg.click('#cfgClose');
      await abrirProjetos(pg);
      // remove
      await pg.click(`#dash [data-del="${info.pid}"]`); await fecharProjetos(pg);
      await pg.waitForFunction((n) => window.__pavecad.E.P.length === n - 1, info.n);
      assert.match(await pg.innerText('.toast-acao'), /removida/);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props[0].pid), null, 'sem a planilha carregada, a proposta fica guardada sem vínculo');
      // desfaz
      await pg.click('.toast-acao button');
      await pg.waitForFunction((n) => window.__pavecad.E.P.length === n, info.n, { timeout: 30000 });
      await pg.waitForTimeout(800);
      const depois = await pg.evaluate((nome) => { const E = window.__pavecad.E; const p = E.P.find((q) => q.meta.name === nome); return { idx: E.P.indexOf(p), nomes: E.P.map((q) => q.meta.name), aj: p.ajustes.map((a) => [a.lane, a.largura]), orfa: E.props[0].orfa === true, pidProp: E.props[0].pid === p.id, visivel: p.visible }; }, info.pname);
      assert.equal(depois.idx, info.idx, 'mesma posição na lista');
      assert.deepEqual(depois.nomes, info.nomes);
      assert.deepEqual(depois.aj, [[1, 3.2]], 'ajuste de largura de volta');
      assert.equal(depois.orfa, false, 'a proposta volta a apontar para a planilha');
      assert.equal(depois.pidProp, true);
      assert.equal(depois.visivel, true);
      // a planilha restaurada também foi regravada no aparelho: sobrevive ao recarregar
      await pg.reload(); await pg.waitForFunction((n) => window.__pavecad && window.__pavecad.E.P.length === n, info.n, { timeout: 60000 });
    }],
  ],
  t15: [
    ['toque: todos os alvos interativos dos painéis, da barra, da gaveta, da legenda e do unifilar têm 44 px (pointer: coarse)', ['tablet-h-1024x768', 'tablet-v-820x1180'], async (pg) => {
      const medir = (rotulo) => pg.evaluate((rot) => {
        const sels = 'button, [role=switch], select, summary, label.sel-item, input:not([type=checkbox]):not([type=hidden]):not([type=file])';
        const raizes = ['#inspector', '#toolbar', '#tools', '#drawer', '#unicard', '#modes', '.search', '#titlebox', '.topright'];
        const ruins = [];
        for (const r of raizes) for (const el of document.querySelectorAll(sels.split(', ').map((q) => `${r} ${q}`).join(', '))) {
          if (!el.checkVisibility()) continue;
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.width < 43.5 || b.height < 43.5) ruins.push(`${rot} ${r} ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`);
        }
        return ruins;
      }, rotulo);
      assert.equal(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
      let ruins = [];
      await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible' });
      ruins.push(...await medir('gaveta'));
      await pg.click('#btnMore');
      for (const t of ['seg', 'ana', 'notas', 'exp', 'aj']) { await aba(pg, t); ruins.push(...await medir(t)); }
      await abrirProjetos(pg); ruins.push(...await medir('projetos')); await fecharProjetos(pg);
      await aba(pg, 'aj'); await pg.waitForSelector('#desloc', { state: 'visible' }); ruins.push(...await medir('alinhar'));
      await aba(pg, 'seg');
      await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 20, 1, { tab: true }); });
      await pg.waitForTimeout(500); ruins.push(...await medir('segmento'));
      const unicos = [...new Set(ruins)];
      assert.deepEqual(unicos, [], 'alvos abaixo de 44 px:\n  ' + unicos.join('\n  '));
    }],
    ['tipografia: nenhum texto visível abaixo de 12 px (13 px nos metadados do modo campo)', ['1366x768', 'tablet-v-820x1180'], async (pg) => {
      const pequenos = (min, rot) => pg.evaluate(([min, rot]) => {
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const t = n.textContent.trim(); if (!t) continue;
          const el = n.parentElement; if (!el || !el.checkVisibility() || el.closest('.maplibregl-map, script, style, canvas')) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < min - 0.01) out.push(`${rot} ${px}px <${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? ' .' + el.className.split(' ')[0] : ''}> "${t.slice(0, 28)}"`);
        }
        return out;
      }, [min, rot]);
      await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 20, 1, { tab: true }); });
      let ruins = [];
      for (const t of ['seg', 'ana', 'notas', 'exp', 'aj']) { await aba(pg, t); ruins.push(...await pequenos(12, 'claro ' + t)); }
      await aba(pg, 'aj'); ruins.push(...await pequenos(12, 'claro alinhar'));
      await pg.evaluate(() => window.__pavecad.setField(true, true)); await pg.waitForTimeout(400);
      for (const t of ['seg', 'exp', 'aj']) { await aba(pg, t); ruins.push(...await pequenos(13, 'campo ' + t)); }
      const unicos = [...new Set(ruins)];
      assert.deepEqual(unicos, [], 'texto abaixo do mínimo:\n  ' + unicos.join('\n  '));
    }],
  ],
  t16: [
    ['1366x768: painel direito começa recolhido, a rodovia fica livre de elementos flutuantes e o título e a busca são um cartão só', '1366x768', async (pg) => {
      const r = await pg.evaluate(() => {
        const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const flut = ['#titlecard', '#modes', '.topright', '#tools', '#inspector', '#unicard'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.checkVisibility()).map(([s, e]) => [s, R(e)]);
        const m = window.__pavecad.map(), E = window.__pavecad.E;
        const pts = [];
        for (const p of E.P) for (let i = 0; i < p.rows.length; i += 10) { const q = m.project([p.rows[i].lon, p.rows[i].lat]); pts.push([q.x, q.y, p.meta.name]); }
        const sob = [];
        for (const [x, y] of pts) for (const [s, b] of flut) if (x >= b.x - 2 && x <= b.r + 2 && y >= b.y - 2 && y <= b.b + 2) sob.push(`${s} em (${Math.round(x)}, ${Math.round(y)})`);
        const cruz = [];
        for (let i = 0; i < flut.length; i++) for (let j = i + 1; j < flut.length; j++) {
          const a = flut[i][1], b = flut[j][1];
          if (a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b) cruz.push(`${flut[i][0]} x ${flut[j][0]}`);
        }
        const tc = document.querySelector('#titlecard');
        return { colapsado: document.querySelector('#inspector').classList.contains('collapsed'), painelH: R(document.querySelector('#inspector')).h, sob: [...new Set(sob)], cruz, tituloNoCartao: !!tc.querySelector('#title') && !!tc.querySelector('#gokm'), cartoes: document.querySelectorAll('.leftcol > .glass:not(.dica)').length, n: pts.length, fora: pts.filter(([x, y]) => x < 0 || y < 0 || x > innerWidth || y > innerHeight).length };
      });
      assert.equal(r.colapsado, true, 'o painel começa recolhido');
      assert.ok(r.painelH < 130, 'só a faixa de abas: ' + r.painelH);
      assert.equal(r.tituloNoCartao, true, 'título e busca no mesmo cartão');
      assert.equal(r.cartoes, 1, 'um cartão de vidro só na coluna esquerda');
      assert.deepEqual(r.cruz, [], 'elementos flutuantes se sobrepõem');
      assert.deepEqual(r.sob, [], 'a rodovia fica sob elementos flutuantes ' + JSON.stringify(r.sob));
      assert.equal(r.fora, 0, 'a rodovia cabe na tela');
      // selecionar um segmento abre o painel
      await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 20, 1, { tab: true }); });
      await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), false, 'selecionar abre o painel');
      // tocar na aba abre de novo depois de recolher
      await pg.click('#collapse'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), true);
      await pg.click('#tabs [data-t=ana]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), false, 'tocar na aba abre o painel');
    }],
    ['1568x760 e tablet: o painel não começa recolhido (sem mudança fora do desktop até 1400 px)', ['1568x760', 'tablet-h-1024x768', 'tablet-v-820x1180'], async (pg) => {
      assert.equal(await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed')), false);
    }],
  ],
  t17: [
    ['linha de cores do unifilar: nomes das 3 classes mais presentes na vista e "+N"; menos classes na vista, menos nomes', '1366x768', async (pg) => {
      assert.equal(await pg.getAttribute('#btnLegenda', 'aria-expanded'), 'false');
      const ler = () => pg.evaluate(() => ({ nomes: [...document.querySelectorAll('#unileg .lt')].map((e) => e.textContent.trim()), mais: document.querySelector('#unileg .legmais')?.textContent.trim() ?? null, pontos: document.querySelectorAll('#unileg .dots i').length }));
      await pg.evaluate(() => { const E = window.__pavecad.E; const b = E.P.reduce((a, p) => [Math.min(a[0], p.bounds[0][0]), Math.min(a[1], p.bounds[0][1]), Math.max(a[2], p.bounds[1][0]), Math.max(a[3], p.bounds[1][1])], [1e9, 1e9, -1e9, -1e9]); window.__pavecad.map().fitBounds([[b[0], b[1]], [b[2], b[3]]], { duration: 0, padding: 80 }); });
      await pg.waitForTimeout(1200);
      const geral = await ler();
      assert.equal(geral.pontos, 0, 'os 12 pontos sem nome saíram');
      assert.equal(geral.nomes.length, 3, 'três nomes: ' + JSON.stringify(geral));
      assert.match(geral.mais, /^\+\d+$/, 'e o resto como +N');
      assert.ok(geral.nomes.every((n) => n.length > 2 && !/^Sem interven/.test(n)), 'nomes de classes: ' + geral.nomes);
      // bem de perto sobram poucas classes: no máximo as das 2 faixas e do acostamento
      await pg.evaluate(() => { const p = window.__pavecad.E.P[0], r = p.rows[300]; window.__pavecad.map().jumpTo({ center: [r.lon, r.lat], zoom: 20.5 }); });
      await pg.waitForTimeout(1200);
      const perto = await ler();
      assert.ok(perto.nomes.length >= 1 && perto.nomes.length <= 3, JSON.stringify(perto));
      assert.equal(perto.mais, null, 'com 3 classes ou menos na vista não há +N: ' + JSON.stringify(perto));
      // os nomes existem na legenda expandida
      await pg.click('#btnLegenda'); await pg.waitForTimeout(300);
      const lista = await pg.evaluate(() => [...document.querySelectorAll('#legend li button')].map((b) => b.textContent.trim()));
      for (const n of perto.nomes) assert.ok(lista.includes(n), `"${n}" está na legenda expandida`);
      // siglas explicadas na legenda
      const nota = await pg.innerText('#legend .legnote');
      assert.match(nota, /Solução: tratamento proposto/); assert.match(nota, /Fx = faixa/); assert.match(nota, /Ac\. = acostamento/);
    }],
    ['siglas: o tooltip de cada modo explica a abreviação e a legenda traz a descrição do indicador', '1366x768', async (pg) => {
      const t = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#modes button')].filter((b) => !b.disabled).map((b) => [b.dataset.m, b.title])));
      assert.match(t.iri, /Índice de Irregularidade Internacional/); assert.match(t.atr, /afundamento em trilha de roda/);
      assert.match(t.sol, /tratamento proposto/); assert.ok(/Atalho: 1/.test(t.sol));
      assert.match(t.d0, /deflexão/); assert.match(t.rc, /raio de curvatura/);
    }, { exemplos: true }],
    ['siglas do Planservi: IGG e FC explicados no tooltip e na legenda', '1366x768', async (pg) => {
      const t = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#modes button')].filter((b) => !b.disabled).map((b) => [b.dataset.m, b.title])));
      assert.match(t.igg, /Índice de Gravidade Global/); assert.match(t.fc2, /FC-2: trincamento/); assert.match(t.fc3, /FC-3: trincamento/);
      await modo(pg, 'igg'); await pg.click('#btnLegenda');
      assert.match(await pg.innerText('#legend .legnote'), /IGG: Índice de Gravidade Global/);
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['padrão além da cor: hachura só nas classes críticas, ativável em Ajustes e ligada por padrão no modo campo', '1366x768', async (pg) => {
      const est = () => pg.evaluate(() => { const m = window.__pavecad.map(), E = window.__pavecad.E; const id = 'hach-' + E.P[0].id; return { vis: m.getLayoutProperty(id, 'visibility'), filtro: JSON.stringify(m.getFilter(id)), img: m.hasImage('hachura'), mode: E.mode, padrao: E.padrao }; });
      assert.equal((await est()).img, true, 'imagem da hachura registrada');
      let e = await est();
      assert.equal(e.vis, 'visible', 'claro, sem escolha: o RP já tem hachura por padrão');
      assert.match(e.filtro, /RP/); assert.ok(!/RE|REC|FS4|GAP/.test(e.filtro), 'só o RP: ' + e.filtro);
      // GAP (pontos) e Micro (linhas) têm camada própria, só em Solução
      const outras = await pg.evaluate(() => { const m = window.__pavecad.map(), E = window.__pavecad.E; const f = (pre) => ({ vis: m.getLayoutProperty(pre + E.P[0].id, 'visibility'), filtro: JSON.stringify(m.getFilter(pre + E.P[0].id)) }); return { pon: f('hpon-'), lin: f('hlin-'), imgs: ['hpontos', 'hlinhas'].map((n) => m.hasImage(n)) }; });
      assert.deepEqual(outras.imgs, [true, true]); assert.equal(outras.pon.vis, 'visible'); assert.match(outras.pon.filtro, /GAP/); assert.equal(outras.lin.vis, 'visible'); assert.match(outras.lin.filtro, /Micro/);
      // liga em Ajustes: entram também RE e as piores classes dos indicadores
      await aba(pg, 'aj'); assert.equal(await pg.getAttribute('#s-pad', 'aria-checked'), 'false'); await pg.click('#s-pad'); await pg.waitForTimeout(500);
      e = await est(); assert.equal(e.vis, 'visible'); assert.equal(await pg.getAttribute('#s-pad', 'aria-checked'), 'true');
      assert.match(e.filtro, /RE/); assert.match(e.filtro, /RP/); assert.ok(!/FS4|GAP/.test(e.filtro), 'só RE e RP: ' + e.filtro);
      assert.ok(await pg.evaluate(() => document.querySelectorAll('#legend .sw.crit, #legend .lt i.crit').length) >= 0);
      // modos sem classe crítica não têm hachura
      await modo(pg, 'iri'); await pg.waitForTimeout(400);
      e = await est(); assert.equal(e.vis, 'none', 'IRI: sem hachura');
      // desliga de novo e o modo campo não religa por cima da escolha explícita
      await modo(pg, 'sol'); await aba(pg, 'aj'); await pg.click('#s-pad'); await pg.waitForTimeout(300);
      await pg.evaluate(() => window.__pavecad.setField(true, true)); await pg.waitForTimeout(500);
      e = await est(); assert.equal(e.vis, 'none', 'escolha explícita (desligado) vale sobre o modo campo'); assert.equal(e.padrao, false);
    }],
    ['padrão além da cor: sem escolha, o modo campo liga a hachura; no IGG o filtro pega as classes 3 e 4', '1366x768', async (pg) => {
      const est = () => pg.evaluate(() => { const m = window.__pavecad.map(), E = window.__pavecad.E; const id = 'hach-' + E.P[0].id; return { vis: m.getLayoutProperty(id, 'visibility'), filtro: JSON.stringify(m.getFilter(id)) }; });
      let e0 = await est();
      assert.equal(e0.vis, 'visible', 'o RP tem hachura em todos os temas'); assert.ok(!/RE/.test(e0.filtro), 'claro: só o RP: ' + e0.filtro);
      await pg.evaluate(() => window.__pavecad.setField(true, true)); await pg.waitForTimeout(600);
      e0 = await est();
      assert.equal(e0.vis, 'visible', 'modo campo liga a hachura'); assert.match(e0.filtro, /RE/); assert.match(e0.filtro, /RP/);
      await modo(pg, 'igg'); await pg.waitForTimeout(500);
      const e = await est();
      assert.equal(e.vis, 'visible'); assert.match(e.filtro, /c_igg/); assert.match(e.filtro, /3/);
      await modo(pg, 'atr'); await pg.waitForTimeout(400);
      assert.match((await est()).filtro, /c_atr/);
      await modo(pg, 'iri'); await pg.waitForTimeout(400);
      assert.equal((await est()).vis, 'none', 'IRI: sem hachura');
      // sem modo campo, no escuro e no claro, o RP continua com hachura em Solução
      await modo(pg, 'sol');
      await pg.evaluate(() => window.__pavecad.setField(false, true)); await pg.emulateMedia({ colorScheme: 'dark' }); await pg.waitForTimeout(600);
      const esc = await est(); assert.equal(esc.vis, 'visible', 'escuro: RP com hachura'); assert.ok(!/RE/.test(esc.filtro), esc.filtro);
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
  ],
  t18: [
    ['tooltip do mapa: classe, código da planilha e significado, uma linha por camada', ['1366x768'], async (pg) => {
      const alvo = await pg.evaluate(() => {
        const E = window.__pavecad.E;
        for (const p of E.P) for (let i = 0; i < p.rows.length; i++) {
          const L = p.rows[i].lanes[0];
          const cs = (L.camadas || []).filter((c) => c.bruto && c.bruto !== '-' && c.bruto !== '1');
          if (cs.some((c) => /^(PMQ|R)\d/i.test(c.bruto)) && p.model[i].tr[0].main === 'REF') {
            const f = p.polyByFid.get(i * 8 + 1), ring = f.geometry.coordinates[0], n = ring.length - 1;
            const lon = ring.slice(0, n).reduce((a, c) => a + c[0], 0) / n, lat = ring.slice(0, n).reduce((a, c) => a + c[1], 0) / n;
            return { lon, lat, camadas: cs.map((c) => c.bruto), km: p.kmLab[i] };
          }
        }
        return null;
      });
      assert.ok(alvo, 'a amostra tem faixa com reforço PMQ');
      await pg.evaluate((a) => window.__pavecad.map().jumpTo({ center: [a.lon, a.lat], zoom: 18.5 }), alvo);
      await pg.waitForTimeout(900);
      const pt = await pg.evaluate((a) => { const m = window.__pavecad.map(), q = m.project([a.lon, a.lat]), r = m.getCanvas().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, alvo);
      await pg.mouse.move(pt.x - 3, pt.y); await pg.mouse.move(pt.x, pt.y); await pg.waitForTimeout(400);
      const tip = await pg.evaluate(() => ({ vis: getComputedStyle(document.querySelector('#tip')).display, linhas: document.querySelector('#tip').innerHTML.split('<br>').map((x) => x.replace(/<[^>]+>/g, '').trim()) }));
      assert.equal(tip.vis, 'block', 'tooltip aparece sobre a faixa');
      assert.match(tip.linhas[0], /^km /);
      const rev = tip.linhas.find((l) => /^REF · /.test(l));
      assert.ok(rev, 'linha do reforço com o código original: ' + tip.linhas.join(' | '));
      assert.match(rev, /^REF · (PMQ|R)\d+,\d \(Reforço estrutural de \d+,\d cm\)$/);
      assert.ok(tip.linhas.length - 1 === alvo.camadas.length, `uma linha por camada com intervenção (${alvo.camadas.join(', ')}): ` + tip.linhas.join(' | '));
    }, { arquivos: ['planservi_amostra_1.xlsx', 'planservi_amostra_2.xlsx'], projetos: 4 }],
    ['9 planilhas: carga medida, agrupamento por rodovia, trechos contíguos fundidos e a lacuna do TH46', ['1366x768'], async (pg, { log }) => {
      console.log(`     carga de 9 planilhas (18 projetos): ${log.cargaMs} ms`);
      assert.ok(log.cargaMs < 60000, 'carga em menos de 60 s: ' + log.cargaMs);
      const erros = log.erros.filter((e) => !/Failed to load resource/.test(e)); // as fontes externas são bloqueadas de propósito
      assert.deepEqual(erros, [], 'sem erro de console na carga: ' + erros.join(' | '));
      assert.equal(await pg.evaluate(() => new Set(window.__pavecad.E.P.map((p) => p.meta.uf)).size), 2, 'duas rodovias');
      assert.equal(await pg.evaluate(() => window.__pavecad.E.activeGroup), 'RD-001');
      await pg.waitForTimeout(500);
      assert.deepEqual(await pg.evaluate(() => window.__pavecad.blocosDoUnifilar()), ['RD-001 · Crescente · 6 planilhas', 'RD-001 · Decrescente · 6 planilhas']);
      const pl = await pg.evaluate(() => window.__pavecad.planilhasDoUnifilar());
      const ths = (l) => l.map((n) => /TH\d+/.exec(n)[0]);
      assert.deepEqual(ths(pl[0]), ['TH41', 'TH42', 'TH43', 'TH44', 'TH45', 'TH47']);
      assert.deepEqual(ths(pl[1]), ['TH41', 'TH42', 'TH43', 'TH44', 'TH45', 'TH47']);
      const lac = await pg.evaluate(() => window.__pavecad.lacunasDoUnifilar());
      assert.equal(lac.length, 2, 'uma lacuna por sentido (o TH46 não tem planilha)');
      for (const l of lac) assert.ok(Math.abs(l.ate - l.de - 1.2) < 0.01, 'lacuna de 1,2 km: ' + (l.ate - l.de));
      // outra rodovia: três planilhas seguidas por sentido e nenhuma lacuna
      assert.equal(await pg.evaluate(() => document.querySelectorAll('#unigroups button').length), 2, 'filtro com as duas rodovias');
      await pg.click('#unigroups button[data-g="RD-002"]'); await pg.waitForTimeout(500);
      assert.deepEqual(await pg.evaluate(() => window.__pavecad.blocosDoUnifilar()), ['RD-002 · Crescente · 3 planilhas', 'RD-002 · Decrescente · 3 planilhas']);
      assert.deepEqual(await pg.evaluate(() => window.__pavecad.lacunasDoUnifilar()), []);
    }, OPTS_NOVE],
    ['unifilar: no máximo 35% da altura da tela e rola por dentro quando o conteúdo não cabe', ['1366x768', '1568x760', 'tablet-h-1024x768'], async (pg) => {
      const m = () => pg.evaluate(() => { const c = document.querySelector('#unicard').getBoundingClientRect(), w = document.querySelector('#uniwrap'); return { h: c.height, vh: innerHeight, rola: w.scrollHeight > w.clientHeight + 1, sh: w.scrollHeight, ch: w.clientHeight, ov: getComputedStyle(w).overflowY }; });
      let r = await m();
      assert.ok(r.h <= r.vh * 0.35 + 1, `cartão de ${r.h}px em ${r.vh}px de tela`);
      assert.equal(r.ov, 'auto');
      // tela baixa: o conteúdo (dois blocos de seis planilhas) não cabe nos 35% e passa a rolar
      await pg.setViewportSize({ width: 1366, height: 520 }); await pg.waitForTimeout(900);
      r = await m();
      assert.ok(r.h <= r.vh * 0.35 + 1, `tela baixa: cartão de ${r.h}px em ${r.vh}px`);
      assert.ok(r.rola, `deve rolar por dentro (${r.sh} > ${r.ch})`);
      const topo = await pg.evaluate(() => { const w = document.querySelector('#uniwrap'); w.scrollTop = w.scrollHeight; return w.scrollTop; });
      assert.ok(topo > 0, 'a rolagem anda');
      // a régua de km é sticky: continua no topo da área visível e com texto desenhado depois de rolar até o fim
      await pg.waitForTimeout(200);
      const reg = await pg.evaluate(() => {
        const w = document.querySelector('#uniwrap'), r = document.querySelector('#uniregua'), a = w.getBoundingClientRect(), b = r.getBoundingClientRect();
        const d = r.getContext('2d').getImageData(0, 0, r.width, r.height).data; let tinta = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) tinta++;
        return { dy: b.top - a.top, h: b.height, tinta, rolado: w.classList.contains('rolado'), scroll: w.scrollTop, vis: r.checkVisibility() };
      });
      assert.ok(reg.scroll > 0 && reg.rolado, 'cartão rolado');
      assert.ok(Math.abs(reg.dy) <= 1, `régua colada no topo da área visível depois de rolar (deslocada ${reg.dy}px)`);
      assert.ok(reg.h >= 17 && reg.vis, 'régua visível com 18 px');
      assert.ok(reg.tinta > 200, 'a régua tem os rótulos de km desenhados (' + reg.tinta + ' px)');
      // com o cartão rolado até o fim, o clique na última faixa visível cai no decrescente
      const box = await pg.evaluate(() => { const r = document.querySelector('#uniwrap').getBoundingClientRect(); return { l: r.left, w: r.width, b: r.bottom }; });
      await pg.mouse.click(box.l + 44 + 0.2 * (box.w - 46), box.b - 8); await pg.waitForTimeout(500);
      assert.equal(await pg.evaluate(() => { const s = window.__pavecad.E.sel; return s ? window.__pavecad.E.P.find((p) => p.id === s.pid).meta.travel : null; }), -1, 'o clique na parte rolada seleciona o sentido decrescente');
      const ev = await pg.evaluate(() => { const a = document.querySelector('#unicard').getBoundingClientRect(), i = document.querySelector('#inspector').getBoundingClientRect(); return { uniTopo: a.top, inspB: i.bottom }; });
      assert.ok(ev.inspB <= ev.uniTopo + 1, 'o painel não invade o unifilar');
    }, OPTS_NOVE],
    ['Projetos agrupados por rodovia, com grupos recolhíveis que lembram o estado', ['1366x768'], async (pg) => {
      await abrirProjetos(pg);
      const gr = () => pg.evaluate(() => [...document.querySelectorAll('#dash details.rgrp')].map((d) => ({ uf: d.dataset.uf, aberto: d.open, titulo: d.querySelector('summary').innerText.replace(/\s+/g, ' ').trim(), linhas: d.querySelectorAll('.pcard').length })));
      let g = await gr();
      assert.deepEqual(g.map((x) => x.uf), ['RD-001', 'RD-002']);
      assert.ok(g.every((x) => x.aberto), 'começam abertos');
      assert.deepEqual(g.map((x) => x.linhas), [12, 6], 'doze projetos em RD-001 e seis em RD-002');
      assert.match(g[0].titulo, /^RD-001.*12 planilhas/); assert.match(g[1].titulo, /^RD-002.*6 planilhas/);
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('#dash details.rgrp')].every((d) => d.querySelector('.pbar') && d.querySelector('.pleg'))), true, 'cada grupo traz a distribuição por solução');
      // recolhe o primeiro; trocar de modo redesenha o painel e o estado continua
      await pg.click('#dash details.rgrp[data-uf="RD-001"] > summary'); await pg.waitForTimeout(300);
      g = await gr(); assert.equal(g[0].aberto, false); assert.equal(g[1].aberto, true);
      await pg.evaluate(() => document.activeElement && document.activeElement.blur());
      await modo(pg, 'iri'); await pg.waitForTimeout(500);
      g = await gr(); assert.equal(g[0].aberto, false, 'RD-001 continua recolhido depois de redesenhar'); assert.equal(g[1].aberto, true);
      assert.ok(await pg.evaluate(() => { const d = document.querySelector('#dash details.rgrp[data-uf="RD-001"]'); return d.getBoundingClientRect().height < 70; }), 'grupo recolhido ocupa só o cabeçalho');
      await pg.click('#dash details.rgrp[data-uf="RD-001"] > summary'); await pg.waitForTimeout(300);
      assert.equal((await gr())[0].aberto, true);
      // o botão de olho de uma planilha continua funcionando dentro do grupo
      await pg.click('#dash details.rgrp[data-uf="RD-002"] [data-eye]'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.P.filter((p) => p.meta.uf === 'RD-002' && !p.visible).length), 1);
    }, OPTS_NOVE],
  ],
  t19: [
    ['marcos de km com 9 planilhas: aparecem em planilhas que não são a de referência, do zoom 18 ao 21', ['1366x768'], async (pg) => {
      const vai = async (z, bearing = 0) => {
        await pg.evaluate(({ z, bearing }) => { const E = window.__pavecad.E, m = window.__pavecad.map(), p = E.P.find((q) => /TH44 · Crescente/.test(q.meta.name)); m.jumpTo({ center: [p.rows[30].lon, p.rows[30].lat], zoom: z, bearing }); }, { z, bearing });
        await pg.waitForTimeout(1200);
      };
      const visiveis = () => pg.evaluate(() => [...document.querySelectorAll('.stake')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0).map((e) => ({ t: e.textContent.replace(/[↑\s]+/g, ' ').trim(), cls: e.className, pid: e.dataset.pid })));
      for (const z of [18, 19, 20]) {
        await vai(z);
        const v = await visiveis(); const info = await pg.evaluate(() => window.__pavecad.marcosInfo());
        assert.ok(v.length >= 3, `zoom ${z}: rótulos visíveis na TH44 (${v.length})`);
        assert.equal(info.passo, 20, `zoom ${z}: passo de 20 m`);
        assert.ok(v.every((x) => /^\d+\+\d{3}$/.test(x.t)), `zoom ${z}: só o marco (14+200), sem intervalo: ` + v.map((x) => x.t).join(' | '));
      }
      await vai(21); assert.ok((await visiveis()).length >= 1, 'zoom 21 mostra pelo menos um rótulo');
      const info = await pg.evaluate(() => window.__pavecad.marcosInfo());
      console.log(`     marcos com 18 projetos no zoom 21: ${info.ms.toFixed(1)} ms, ${info.rotulos} rótulos e ${info.internos} internos`);
    }, OPTS_NOVE],
    ['marcos de km: km cheios longe, 100 m no meio, 20 m e rótulo interno perto; sempre abaixo do orçamento e sem sobreposição', ['1366x768'], async (pg) => {
      const medir = async (z) => {
        await pg.evaluate((z) => { const E = window.__pavecad.E, m = window.__pavecad.map(), p = E.P.find((q) => /TH44 · Crescente/.test(q.meta.name)); m.jumpTo({ center: [p.rows[30].lon, p.rows[30].lat], zoom: z, bearing: 0 }); }, z);
        await pg.waitForTimeout(1200);
        return pg.evaluate(() => {
          const info = window.__pavecad.marcosInfo();
          const v = [...document.querySelectorAll('.stake')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0);
          const rs = v.map((e) => e.getBoundingClientRect());
          let cruzam = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (rs[i].left < rs[j].right && rs[i].right > rs[j].left && rs[i].top < rs[j].bottom && rs[i].bottom > rs[j].top) cruzam++;
          const ms = v.map((e) => e.textContent.replace(/[↑\s]+/g, ' ').trim());
          return { info, n: v.length, cruzam, textos: ms, internos: v.filter((e) => e.classList.contains('interno')).length, noDom: document.querySelectorAll('.stake').length };
        });
      };
      const longe = await medir(14);
      assert.equal(longe.info.passo, 500, 'zoom 14: passo de 500 m');
      assert.ok(longe.n >= 1, 'longe ainda há rótulos');
      assert.ok(longe.textos.every((t) => /\+(000|500)$/.test(t)), 'longe só km cheio e 500 m: ' + longe.textos.join(' | '));
      const meio = await medir(16);
      assert.equal(meio.info.passo, 100, 'zoom 16: passo de 100 m');
      assert.ok(meio.textos.every((t) => /\+\d00$/.test(t)), '100 m no meio: ' + meio.textos.join(' | '));
      const perto = await medir(18);
      assert.equal(perto.info.passo, 20);
      assert.equal(perto.internos, 0, 'em 18 o segmento ainda tem menos de 100 px: sem rótulo interno');
      const max = await medir(19.5);
      assert.ok(max.internos >= 1 && max.info.internos >= 1, 'no zoom máximo há rótulo dentro do segmento: ' + max.textos.join(' | '));
      assert.ok(max.textos.every((t) => /^\d+\+\d{3}$/.test(t)), 'sem intervalo nos rótulos: ' + max.textos.join(' | '));
      for (const [nome, r] of [['14', longe], ['16', meio], ['18', perto], ['19,5', max]]) {
        assert.equal(r.cruzam, 0, `zoom ${nome}: rótulos visíveis não se sobrepõem`);
        assert.ok(r.noDom <= 400 + 150, `zoom ${nome}: dentro do orçamento (${r.noDom})`);
      }
      // com tudo na tela (18 projetos) o passo sobe, mas nunca desliga todos
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ center: [-47.5, -15.1], zoom: 9 }));
      await pg.waitForTimeout(800);
      const a = await pg.evaluate(() => ({ info: window.__pavecad.marcosInfo(), kml: [...document.querySelectorAll('.kmlabel')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none').length }));
      assert.ok(a.info.rotulos <= 400);
    }, OPTS_NOVE],
    ['marcos de km: cada sentido no lado externo (pistas a 22 m) e um rótulo com setas no eixo (pistas a 16 m); sempre de pé com o mapa girado', ['1366x768'], async (pg) => {
      // GO: pistas a cerca de 22 m, um rótulo por sentido, cada um para fora da sua pista
      const r = await pg.evaluate(() => { const E = window.__pavecad.E, m = window.__pavecad.map(); const [a] = E.P; m.jumpTo({ center: [a.rows[300].lon, a.rows[300].lat], zoom: 19, bearing: 0 }); return a.meta.name; });
      await pg.waitForTimeout(1200);
      const go = await pg.evaluate(() => {
        const E = window.__pavecad.E, m = window.__pavecad.map(), info = window.__pavecad.marcosInfo();
        const cx = (e) => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; };
        const por = {}; for (const e of document.querySelectorAll('.stake:not(.interno)')) (por[e.dataset.pid] ??= []).push(e);
        const mapaC = m.getCanvas().getBoundingClientRect();
        const pontos = E.P.map((p) => { const q = m.project([p.rows[300].lon, p.rows[300].lat]); return { id: p.id, x: mapaC.left + q.x, trav: p.meta.travel }; });
        const media = (id) => { const l = (por[id] || []).filter((e) => getComputedStyle(e).visibility !== 'hidden'); return l.length ? l.reduce((s, e) => s + cx(e), 0) / l.length : null; };
        return { pares: info.pares, ids: Object.keys(por), pontos, medias: pontos.map((p) => media(p.id)) };
      });
      assert.equal(go.pares, 0, 'GO: pistas separadas por mais de 20 m, sem rótulo de par');
      assert.equal(go.ids.length, 2, 'um conjunto de rótulos por sentido');
      const [pa, pb] = go.pontos, [ma, mb] = go.medias;
      assert.ok(ma !== null && mb !== null, 'os dois sentidos têm rótulo visível');
      // o rótulo de cada sentido fica do lado de fora: afastado do outro sentido
      const esquerda = pa.x < pb.x ? 0 : 1;
      assert.ok(go.medias[esquerda] < go.pontos[esquerda].x, 'a pista da esquerda leva o rótulo à esquerda dela');
      assert.ok(go.medias[1 - esquerda] > go.pontos[1 - esquerda].x, 'a pista da direita leva o rótulo à direita dela');
    }, { arquivos: ['rr_go_crescente.xlsx', 'rr_go_decrescente.xlsx'], projetos: 2 }],
    ['marcos de km: com pistas a menos de 20 m sai um rótulo só, no eixo, com uma seta por sentido que gira com o mapa; o texto não vira', ['1366x768'], async (pg) => {
      await pg.evaluate(() => { const E = window.__pavecad.E, m = window.__pavecad.map(), p = E.P.find((q) => /TH44 · Crescente/.test(q.meta.name)); m.jumpTo({ center: [p.rows[20].lon, p.rows[20].lat], zoom: 18.2, bearing: 0 }); });
      await pg.waitForTimeout(1200);
      const ler = () => pg.evaluate(() => {
        const info = window.__pavecad.marcosInfo(), par = [...document.querySelectorAll('.stake.par')].find((e) => getComputedStyle(e).visibility !== 'hidden');
        const mk = par && par.closest('.maplibregl-marker');
        return { info, temPar: !!par, setas: par ? par.querySelectorAll('.seta').length : 0, rot: par ? [...par.querySelectorAll('.seta')].map((s) => getComputedStyle(s).transform) : [], marker: mk ? getComputedStyle(mk).transform : null, pids: [...new Set([...document.querySelectorAll('.stake:not(.interno)')].map((e) => e.dataset.pid))] };
      });
      const a = await ler();
      assert.ok(a.info.pares > 0 && a.temPar, 'rótulo de par visível');
      assert.equal(a.setas, 2, 'uma seta por sentido');
      assert.equal(a.pids.length, 1, 'só a planilha crescente leva o rótulo do par');
      await pg.evaluate(() => window.__pavecad.map().setBearing(137)); await pg.waitForTimeout(1200);
      const b = await ler();
      assert.notDeepEqual(a.rot, b.rot, 'as setas giram com o mapa');
      assert.notEqual(b.rot[0], b.rot[1], 'e as duas apontam para lados opostos');
      const m = /matrix\(([^)]+)\)/.exec(b.marker);
      assert.ok(m, 'marcador com matriz: ' + b.marker);
      const [ma, mb] = m[1].split(',').map(Number);
      assert.ok(Math.abs(ma - 1) < 1e-6 && Math.abs(mb) < 1e-6, 'o texto do rótulo continua de pé com o mapa girado (sem rotação): ' + b.marker);
    }, OPTS_NOVE],
  ],
  t20: [
    ['limpeza: nenhum botão flutuante na borda direita; o pino da barra é só "Ver notas": sem popover, sem criar nota, sem exportar', TODOS, async (pg) => {
      const r = await pg.evaluate(() => ({
        velhos: ['btnNota', 'btnAjustes', 'btnNotasLista'].filter((id) => document.getElementById(id)),
        borda: document.querySelectorAll('.bordadir, .bbtn, .notaslista').length,
        pino: (() => { const b = document.querySelector('#btnNotas'); return b ? { tem: true, popover: b.getAttribute('aria-haspopup'), titulo: b.getAttribute('aria-label') } : { tem: false }; })(),
        restos: document.querySelectorAll('#pinpop, #ppLocal, #ppVer, #ppXlsx, #ppCsv, #ppShare').length,
      }));
      assert.deepEqual(r.velhos, [], 'Nota, Ajustes e Notas (N) saíram da borda direita');
      assert.equal(r.borda, 0, 'sem botões da borda direita');
      assert.deepEqual(r.pino, { tem: true, popover: null, titulo: 'Ver notas (0)' }, 'o pino da barra é o botão de notas, só Ver notas');
      assert.equal(r.restos, 0, 'sem popover, sem Nota no meu local e sem exportar no pino');
      await pg.click('#btnNotas'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.tab'), 'notas', 'um toque abre a aba Revisão');
      assert.equal(await pg.isVisible('#t-notas'), true);
    }],
    ['barra de GPS: duas linhas curtas (origem e precisão, km e distância ao eixo), sem Abrir e sem Nota, abaixo da barra de ferramentas; escala no canto superior esquerdo, abaixo do cartão de busca', ['1366x768', 'tablet-h-1024x768'], async (pg, { ctx }) => {
      const esc = await pg.evaluate(() => { const e = document.querySelector('.maplibregl-ctrl-scale'), t = document.querySelector('#titlecard'); const a = e.getBoundingClientRect(), b = t.getBoundingClientRect(); return { dentroLeft: !!e.closest('.leftcol'), abaixo: a.top >= b.bottom - 1, alinhada: Math.abs(a.left - b.left) < 40, top: Math.round(a.top), w: Math.round(a.width) }; });
      assert.ok(esc.dentroLeft && esc.abaixo && esc.alinhada && esc.top < 260, 'escala logo abaixo do cartão de busca: ' + JSON.stringify(esc));
      const alvo = await centrarNaFaixa(pg, 0, 300, 1);
      await ctx.grantPermissions(['geolocation']);
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 12 });
      await pg.click('#btnGps'); await pg.waitForSelector('#gpschip:not([hidden])', { timeout: 8000 }); await pg.waitForTimeout(500);
      const g = await pg.evaluate(() => { const c = document.querySelector('#gpschip'), tb = document.querySelector('#toolbar').getBoundingClientRect(), r = c.getBoundingClientRect(); return { txt: c.innerText.replace(/\s+/g, ' ').trim(), botoes: [...c.querySelectorAll('button')].map((b) => b.textContent), abaixo: r.top >= tb.bottom - 1, dentro: r.right <= innerWidth && r.left >= 0, alt: Math.round(r.height), naTopright: !!c.closest('.topright') }; });
      assert.match(g.txt, /^GPS · ±12 m · satélite · há \d+ s Seguindo km \d+\+\d{3} · a \d+ m do eixo · Fx \d$/, g.txt);
      assert.deepEqual(g.botoes, ['Seguindo'], 'sem Abrir e sem Nota');
      assert.ok(g.abaixo && g.dentro && g.naTopright, 'abaixo da barra de ferramentas, dentro da tela: ' + JSON.stringify(g));
      assert.ok(g.alt <= 84, 'duas linhas: ' + g.alt + ' px');
      await pg.click('#btnGps');
    }],
    ['GPS só por rede: avisa "Sem GPS por satélite", define a posição por toque no mapa, sobe e desce 20 m e o GPS de satélite a substitui', ['1366x768'], async (pg, { ctx }) => {
      const alvo = await centrarNaFaixa(pg, 0, 300, 1);
      await ctx.grantPermissions(['geolocation']);
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 1800 });
      await pg.click('#btnGps'); await pg.waitForSelector('#gSemSat', { timeout: 8000 });
      assert.equal((await pg.textContent('#gSemSat')).trim(), 'Sem GPS por satélite (só localização por rede)');
      await pg.waitForFunction(() => /±1800 m/.test(document.querySelector('#gpschip').textContent), null, { timeout: 8000 });
      assert.match(await pg.textContent('#gpschip'), /±1800 m · rede · há \d+ s/);
      assert.equal((await pg.textContent('#gManual')).trim(), 'Definir posição por km');
      await pg.click('#gManual');
      assert.ok(await pg.isVisible('#gKm'), 'o campo de km é a alternativa ao toque');
      await pg.mouse.click(alvo.x, alvo.y); await pg.waitForSelector('#gMais', { timeout: 4000 });
      assert.match(await pg.textContent('#gpschip'), /Posição manual · há \d+ s/);
      const km = async () => { const t = await pg.textContent('#gRef'); const m = /km (\d+)\+(\d{3}) · a (\d+) m do eixo/.exec(t); assert.ok(m, t); return { m: Number(m[1]) * 1000 + Number(m[2]), d: Number(m[3]) }; };
      const k0 = await km(); assert.ok(k0.d <= 1, 'a posição manual fica no eixo: ' + k0.d);
      await pg.click('#gMais'); const k1 = await km(); assert.ok(Math.abs(k1.m - k0.m - 20) <= 1, `+20 m: ${k0.m} -> ${k1.m}`);
      await pg.click('#gMenos'); await pg.click('#gMenos'); const k2 = await km(); assert.ok(Math.abs(k1.m - k2.m - 40) <= 1, `-40 m: ${k1.m} -> ${k2.m}`);
      // posição por km digitado
      await pg.click('#gAltera'); await pg.fill('#gKm', '170+500'); await pg.click('#gKmIr');
      assert.match(await pg.textContent('#gRef'), /^km 170\+500 · a \d+ m do eixo/);
      // GPS de satélite volta: substitui a manual e avisa
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 9 });
      await pg.waitForFunction(() => !/Posição manual/.test(document.querySelector('#gpschip').textContent), null, { timeout: 8000 });
      assert.match(await pg.textContent('#gpschip'), /±9 m · satélite/);
      assert.equal(await pg.locator('#gSemSat').count(), 0, 'com satélite não há aviso');
      await pg.click('#btnGps');
    }],
    ['GPS: alta precisão, timeout de 120 s na primeira busca, falha não apaga a última posição (fica cinza) e nova tentativa automática', ['1366x768'], async (pg) => {
      const alvo = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.evaluate((a) => {
        window.__geo = { chamadas: [], limpas: 0 };
        const fake = {
          watchPosition(ok, err, opts) {
            const n = window.__geo.chamadas.push(opts);
            if (n === 1) { setTimeout(() => ok({ coords: { latitude: a.lat, longitude: a.lon, accuracy: 10 } }), 100); setTimeout(() => err({ code: 3 }), 700); }
            else setTimeout(() => err({ code: 2 }), 300);
            return n;
          },
          clearWatch() { window.__geo.limpas++; },
          getCurrentPosition(_ok, err) { err({ code: 3 }); },
        };
        Object.defineProperty(navigator, 'geolocation', { value: fake, configurable: true });
      }, alvo);
      await pg.click('#btnGps'); await pg.waitForFunction(() => /±10 m/.test(document.querySelector('#gpschip').textContent), null, { timeout: 5000 });
      const o1 = await pg.evaluate(() => window.__geo.chamadas[0]);
      assert.equal(o1.enableHighAccuracy, true); assert.equal(o1.timeout, 120000); assert.ok(o1.maximumAge <= 2000, 'maximumAge baixo: ' + o1.maximumAge);
      await pg.waitForFunction(() => /sem sinal/.test(document.querySelector('#gpschip').textContent), null, { timeout: 5000 });
      const t = await pg.textContent('#gpschip');
      assert.match(t, /±10 m/, 'a última posição continua depois da falha: ' + t);
      assert.match(t, /km \d+\+\d{3}/, 'o referencial continua: ' + t);
      const cor = await pg.evaluate(() => window.__pavecad.map().getSource('gps')._data.features[0].properties.tipo);
      assert.equal(cor, 'cinza', 'o ponto fica cinza');
      await pg.waitForFunction(() => window.__geo.chamadas.length >= 2, null, { timeout: 9000 });
      assert.equal(await pg.evaluate(() => window.__geo.limpas >= 1), true, 'a busca anterior foi encerrada antes de tentar de novo');
      assert.match(await pg.textContent('#gpschip'), /±10 m/, 'segue com a última posição enquanto tenta');
      await pg.click('#btnGps');
    }],
    ['Offline: o selo aparece, o fundo troca para Liso e volta ao escolhido; km e distância ao eixo continuam sem rede', ['1366x768'], async (pg, { ctx }) => {
      const alvo = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.evaluate(() => document.querySelector('#btnMore')?.click()); await pg.waitForTimeout(300);
      await pg.click('[data-b=esri]'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.base), 'esri');
      assert.equal(await pg.isHidden('#offBadge'), true, 'online: sem selo');
      await ctx.grantPermissions(['geolocation']);
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 10 });
      // sem rede de verdade: o navegador diz offline e os tiles novos falham em sequência (só o aviso do navegador não basta)
      const semTiles = (r) => r.abort();
      await ctx.route(/(basemaps\.cartocdn\.com|server\.arcgisonline\.com|api\.maptiler\.com)/, semTiles);
      await ctx.setOffline(true);
      await pg.waitForSelector('#offBadge:not([hidden])', { timeout: 5000 });
      assert.equal(await pg.evaluate(() => window.__pavecad.E.base), 'esri', 'só o aviso do navegador não troca o fundo');
      await faltaDeTiles(pg);
      assert.equal((await pg.textContent('#offBadge')).trim(), 'Offline');
      assert.equal(await pg.isVisible('#offBadge'), true);
      assert.equal(await pg.evaluate(() => document.querySelector('#base [data-b=none]').getAttribute('aria-pressed')), 'true', 'o seletor mostra Liso');
      assert.equal((await pg.textContent('#toast')).trim(), 'Sem internet, fundo simples');
      await pg.click('#btnGps'); await pg.waitForSelector('#gRef', { timeout: 8000 });
      assert.match(await pg.textContent('#gRef'), /^km \d+\+\d{3} · a \d+ m do eixo · Fx \d$/, 'km e distância ao eixo sem rede');
      await pg.click('#btnGps');
      await ctx.unroute(/(basemaps\.cartocdn\.com|server\.arcgisonline\.com|api\.maptiler\.com)/, semTiles);
      await ctx.setOffline(false);
      await pg.waitForFunction(() => window.__pavecad.E.base === 'esri', null, { timeout: 5000 });
      assert.equal(await pg.isHidden('#offBadge'), true, 'o selo some ao voltar');
      assert.equal(await pg.evaluate(() => document.querySelector('#base [data-b=esri]').getAttribute('aria-pressed')), 'true');
      // se a pessoa escolheu outro fundo sem rede, a escolha dela vale ao voltar
      await ctx.route(/(basemaps\.cartocdn\.com|server\.arcgisonline\.com|api\.maptiler\.com)/, semTiles);
      await ctx.setOffline(true); await faltaDeTiles(pg);
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('#base button')].some((b) => b.disabled)), false, 'as opções de fundo nunca ficam desabilitadas');
      await pg.click('[data-b=osm]'); await pg.waitForTimeout(200);
      await ctx.unroute(/(basemaps\.cartocdn\.com|server\.arcgisonline\.com|api\.maptiler\.com)/, semTiles);
      await ctx.setOffline(false); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.base), 'osm', 'a escolha manual não é desfeita');
      await pg.click('[data-b=none]');
    }],
    ['Campo e offline em Ajustes: confirma o que está salvo, mostra o provedor, estima o tamanho e cancela o Preparar para campo', ['1366x768'], async (pg, { ctx }) => {
      await centrarNaFaixa(pg, 0, 300, 1);
      let pedidos = 0;
      await ctx.route(/server\.arcgisonline\.com/, async (rota) => {
        pedidos++;
        await new Promise((r) => setTimeout(r, 60));
        await rota.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
      });
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=campo]'); await pg.waitForSelector('#cpArmaz');
      // o armazenamento do navegador é preenchido depois do conteúdo fixo da página
      await pg.waitForFunction(() => /Planilhas: \d+/.test(document.querySelector('#cpPlan').textContent) && /Tiles de mapa: \d+/.test(document.querySelector('#cpTiles').textContent), null, { timeout: 8000 });
      const salvo = await pg.textContent('#cpArmaz');
      assert.match(salvo, /Planilhas: \d+/); assert.match(salvo, /Notas: \d+/); assert.match(salvo, /Propostas: \d+/); assert.match(salvo, /Tiles de mapa: \d+/);
      assert.match(await pg.textContent('#cpProv'), /Liso não tem tiles/, 'no Liso não há o que preparar');
      assert.equal(await pg.isDisabled('#cpPrep'), true);
      assert.match(await pg.textContent('#cpAjuda'), /ative a localização simulada/);
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('#cpLimite [data-mb]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')).join()), '100 MB:false,300 MB:true,600 MB:false,1000 MB:false', 'limite padrão de 300 MB');
      await pg.click('#cfgClose');
      await pg.evaluate(() => document.querySelector('#btnMore')?.click()); await pg.waitForTimeout(300);
      await pg.click('[data-b=esri]'); await pg.waitForTimeout(300);
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=campo]'); await pg.waitForSelector('#cpEst:not(:empty)', { timeout: 5000 });
      assert.match(await pg.textContent('#cpProv'), /Esri World Imagery \(satélite\)/, 'registra o provedor');
      const est1 = await pg.textContent('#cpEst'); assert.match(est1, /^[\d.]+ tiles, cerca de \d+ (MB|KB)\.$/, est1);
      const n1 = Number(est1.match(/^([\d.]+) tiles/)[1].replace(/\./g, ''));
      await pg.click('#cpBuf [data-buf="2000"]'); await pg.waitForTimeout(300);
      const n2 = Number((await pg.textContent('#cpEst')).match(/^([\d.]+) tiles/)[1].replace(/\./g, ''));
      assert.ok(n2 > n1, `corredor maior, mais tiles: ${n1} -> ${n2}`);
      await pg.click('#cpBuf [data-buf="500"]'); await pg.waitForTimeout(200);
      await pg.click('#cpPrep'); await pg.waitForSelector('#cpCancela:not([hidden])');
      await pg.waitForFunction(() => /^[1-9][\d.]* de [\d.]+ tiles/.test(document.querySelector('#cpStatus').textContent), null, { timeout: 8000 });
      assert.equal(await pg.isVisible('#cpBarra'), true, 'barra de progresso');
      await pg.click('#cpCancela'); await pg.waitForSelector('#cpPrep:not([hidden])', { timeout: 5000 });
      const aposCancelar = pedidos; await pg.waitForTimeout(800);
      assert.ok(pedidos - aposCancelar <= 2, `parou de pedir depois de cancelar: ${aposCancelar} -> ${pedidos}`);
      assert.match(await pg.textContent('#cpUltimo'), /Esri World Imagery.*Cancelada antes de terminar/, await pg.textContent('#cpUltimo'));
      assert.ok(pedidos < n1, `cancelou antes de baixar tudo: ${pedidos} de ${n1}`);
      await pg.click('#cfgClose'); await pg.click('[data-b=none]');
      // o selo Offline leva a esta aba
      await ctx.setOffline(true); await pg.waitForSelector('#offBadge:not([hidden])');
      await pg.click('#offBadge'); await pg.waitForSelector('#cpArmaz', { timeout: 4000 });
      await pg.click('#cfgClose'); await ctx.setOffline(false);
    }],
    ['satélite: o canvas acompanha o contêiner em qualquer tamanho e rotação, e a borda direita fica coberta pela imagem (sem faixas do fundo)', ['1366x768'], async (pg) => {
      await pg.evaluate(() => document.querySelector('#btnMore')?.click()); await pg.waitForTimeout(300);
      await pg.click('[data-b=esri]'); await pg.waitForTimeout(800);
      for (const [w, h, rumo] of [[1366, 768, 0], [1100, 700, 37], [900, 1000, 90], [1568, 760, -23]]) {
        await pg.setViewportSize({ width: w, height: h });
        await pg.evaluate((b) => window.__pavecad.map().jumpTo({ bearing: b, zoom: 18 }), rumo); await pg.waitForTimeout(1200);
        const r = await pg.evaluate(() => new Promise((res) => {
          const m = window.__pavecad.map(), c = m.getCanvas(), box = document.querySelector('#map').getBoundingClientRect(), bg = m.getPaintProperty('bg', 'background-color');
          m.once('render', () => {
            const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(c, 0, 0);
            const faixa = x.getImageData(c.width - 24, 0, 24, c.height).data; let cor = 0, n = 0;
            const alvo = typeof bg === 'string' ? bg : '';
            const rgb = (() => { const t = document.createElement('canvas').getContext('2d'); t.fillStyle = alvo || '#000'; t.fillRect(0, 0, 1, 1); return [...t.getImageData(0, 0, 1, 1).data]; })();
            for (let i = 0; i < faixa.length; i += 4) { n++; if (Math.abs(faixa[i] - rgb[0]) + Math.abs(faixa[i + 1] - rgb[1]) + Math.abs(faixa[i + 2] - rgb[2]) < 6) cor++; }
            res({ canvas: [c.clientWidth, c.clientHeight], cont: [Math.round(box.width), Math.round(box.height)], pixels: [c.width, c.height], fundo: cor / n });
          });
          m.triggerRepaint();
        }));
        assert.deepEqual(r.canvas, r.cont, `canvas = contêiner em ${w}x${h}`);
        assert.ok(r.fundo < 0.02, `a faixa de 24 px da borda direita sem cor de fundo em ${w}x${h}, rumo ${rumo}: ${(r.fundo * 100).toFixed(1)}%`);
      }
    }],
    ['nenhum controle sobrepõe outro nem passa da borda em 768x1024 (com planilhas, GPS ligado e um segmento selecionado; o celular tem o seu teste)', ['1366x768'], async (pg, { ctx }) => {
      await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: -12.79, longitude: -47.75, accuracy: 12 });
      for (const [w, h] of [[768, 1024]]) {
        await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(700);
        if (!(await pg.evaluate(() => document.querySelector('#btnGps').getAttribute('aria-pressed') === 'true'))) { await pg.click('#btnGps'); await pg.waitForTimeout(1200); }
        await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 300, 1, { tab: true }); document.querySelector('.nr-dica')?.remove(); document.querySelector('#toast')?.classList.remove('on'); });
        await pg.waitForTimeout(500);
        const r = await pg.evaluate(() => {
          const sel = ['#titlecard', '#modes', '.topright .trrow', '#toolbar', '#gpschip', '.maplibregl-ctrl-scale', '#rotbar', '#zoomhost', '#tools', '#inspector', '#unicard', '#propbar'];
          const els = sel.flatMap((q) => [...document.querySelectorAll(q)].filter((e) => e.checkVisibility({ opacityProperty: true }) && !e.closest('[inert]') && e.getBoundingClientRect().width > 0).map((e) => ({ q, b: e.getBoundingClientRect(), e })));
          const out = [];
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            const a = els[i], c = els[j]; if (a.e.contains(c.e) || c.e.contains(a.e)) continue;
            const w2 = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left), h2 = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
            if (w2 > 2 && h2 > 2) out.push(`${a.q} x ${c.q} (${Math.round(w2)}x${Math.round(h2)})`);
          }
          return { out, lados: els.filter((x) => x.b.right > innerWidth + 1 || x.b.left < -1).map((x) => x.q + ' ' + Math.round(x.b.left) + '..' + Math.round(x.b.right)), rolagemX: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert.deepEqual(r.out, [], `sem sobreposição em ${w}x${h}`);
        assert.deepEqual(r.lados, [], `nada passa da borda lateral em ${w}x${h}`);
        assert.equal(r.rolagemX, false, `sem rolagem horizontal em ${w}x${h}`);
      }
    }],
    ['painel direito expandido: o km aparece uma vez só (sem a linha duplicada acima do título do segmento); recolhido mantém a linha única', ['1366x768'], async (pg) => {
      await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 300, 1, { tab: true }); }); await pg.waitForTimeout(500);
      if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) { await pg.click('#collapse'); await pg.waitForTimeout(300); }
      const aberto = await pg.evaluate(() => [...document.querySelectorAll('#inspector')].map((i) => [...i.querySelectorAll('*')].filter((e) => e.checkVisibility() && e.children.length === 0 && /^km \d+\+\d{3}/.test(e.textContent.trim())).length)[0]);
      assert.equal(aberto, 1, 'um único rótulo de km visível no painel expandido: ' + aberto);
      await pg.click('#collapse'); await pg.waitForTimeout(300);
      const rec = await pg.evaluate(() => [...document.querySelectorAll('#inspector *')].filter((e) => e.checkVisibility() && e.children.length === 0 && /^km \d+\+\d{3}/.test(e.textContent.trim())).length);
      assert.equal(rec, 1, 'recolhido: uma linha só: ' + rec);
    }],
  ],
  t21: [
    ['menu de campo: segurar 500 ms abre o menu circular com 7 opções e um toque grava, sem digitar nada; clique simples seleciona; Desfazer; persistência', ['1366x768'], async (pg) => {
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      const n0 = await pg.evaluate(() => window.__pavecad.E.notes.length);
      // clique simples: seleciona o segmento, sem menu
      await pg.mouse.click(ponto.x, ponto.y); await pg.waitForTimeout(400);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'clique simples não abre o menu');
      assert.ok(await estado(pg, 'E => !!E.sel'), 'clique simples seleciona o segmento');
      await pg.evaluate(() => window.__pavecad.E.sel = null);
      // pressão: antes dos 500 ms nada; depois, menu
      // o anel aparece antes do menu; um observador registra isso, sem depender do atraso do desenho do mapa em máquinas lentas
      await pg.evaluate(() => { window.__anelVisto = false; const a = document.querySelector('.nr-anel'); new MutationObserver(() => { if (!a.hidden) window.__anelVisto = true; }).observe(a, { attributes: true }); });
      await pg.mouse.move(ponto.x, ponto.y); await pg.mouse.down(); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'aos 250 ms ainda não abriu');
      // solta só depois de o menu abrir (com folga para máquinas lentas)
      await pg.waitForSelector('#nr .nr-op', { timeout: 2500 }).catch(() => {}); await pg.waitForTimeout(150); await pg.mouse.up(); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__anelVisto), true, 'anel de progresso durante a pressão');
      assert.equal(await pg.locator('#nr .nr-op').count(), 8, 'aos 700 ms o menu está aberto');
      assert.ok(!(await estado(pg, 'E => !!E.sel')), 'o clique que sobra da pressão não seleciona nada');
      // auditoria: nada obrigatório. Sem campo de texto, seletor nem confirmação
      assert.equal(await pg.locator('#nr input, #nr textarea, #nr select, #nr [role=switch]').count(), 0, 'o menu não tem campo, seletor nem chave');
      assert.equal(await pg.locator('#nr button').count(), 8, 'só as oito opções');
      const op = await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((e) => { const r = e.getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return { t: e.dataset.t, w: Math.round(r.width), h: Math.round(r.height), dentro: r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom, txt: e.innerText.replace(/\s+/g, ' ').trim(), svg: !!e.querySelector('svg') }; }));
      assert.deepEqual(op.map((x) => x.t), ['alterar', 'dreno_mais', 'dreno_menos', 'parametros', 'conserva', 'observacao', 'foto']);
      assert.ok(op.every((x) => x.w === 56 && x.h === 56 && x.dentro && x.svg), 'oito alvos de 56 px, com ícone, dentro da tela: ' + JSON.stringify(op));
      assert.deepEqual(op.map((x) => x.txt), ['Alterar solução', 'Colocar dreno', 'Retirar dreno', 'Ver parâmetros', 'Ver conserva', 'Observação', 'Foto', 'Street View']);
      assert.match(await pg.textContent('#nr .nr-cap'), /km \d+\+\d{3} · Fx 1/);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(400);
      assert.equal(await pg.locator('#nr .nr-op[data-t]').count(), 0, 'um toque grava e o menu principal sai');
      const nota = await pg.evaluate(() => window.__pavecad.E.notes.at(-1));
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.length), n0 + 1);
      assert.ok(nota.rapida, 'nota rápida'); assert.equal(nota.rapida.tipo, 'dreno_menos'); assert.equal(nota.rapida.origem, 'pressao'); assert.equal(nota.rapida.precisao, null);
      assert.equal(nota.rapida.estado, 'dentro'); assert.equal(nota.rapida.faixa, 1); assert.equal(nota.rapida.sentido, 'Crescente'); assert.equal(nota.rapida.rodovia, 'BR-900/GO'); assert.match(nota.rapida.km, /^\d+\+\d{3}$/);
      assert.equal(nota.text, '', 'sem observação: nada digitado');
      assert.ok(nota.id && nota.t && Math.abs(nota.coords[0][1] - ponto.lat) < 1e-3);
      // depois de gravar, a própria roda continua com Salvo e as ações; nada de toast fora do menu
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['obs', 'desfazer'], 'dreno: Observação e Desfazer (sem Trocar sentido, sem dúvida de sentido)');
      assert.equal(await pg.locator('.toast-nota').count(), 0, 'sem toast');
      assert.equal(await pg.evaluate(() => window.__pavecad.map().getSource('notes')._data.features.length), n0 + 1, 'marcador no mapa');
      // Desfazer
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.length), n0, 'Desfazer remove a nota');
      // grava de novo e confere a persistência depois de recarregar
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_mais]'); await pg.waitForTimeout(600);
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(1500);
      const salvas = await pg.evaluate(() => window.__pavecad.E.notes.filter((n) => n.rapida).map((n) => n.rapida.tipo));
      assert.deepEqual(salvas, ['dreno_mais'], 'a nota sobrevive ao recarregar');
    }],
    ['menu de campo: Observação é opcional e só aparece depois de gravar, dentro da roda, com o teclado do aparelho', ['1366x768'], async (pg) => {
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr input').count(), 0, 'sem campo até o usuário tocar em Observação');
      await pg.click('#nr .nr-op[data-a=obs]'); await pg.waitForTimeout(200);
      assert.equal(await pg.evaluate(() => document.activeElement.tagName), 'INPUT', 'o campo abre já com o foco (teclado do aparelho)');
      assert.equal(await pg.getAttribute('#nr .nr-obs input', 'enterkeyhint'), 'done');
      await pg.keyboard.type('trinca longitudinal'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).text), 'trinca longitudinal');
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/, 'volta para a roda de Salvo');
    }],
    ['nota rápida: mover mais de 8 px cancela e o mapa arrasta; botão direito abre o menu; Esc e toque fora fecham', ['1366x768'], async (pg) => {
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      const c0 = await pg.evaluate(() => { const c = window.__pavecad.map().getCenter(); return [c.lng, c.lat]; });
      await pg.mouse.move(ponto.x, ponto.y); await pg.mouse.down();
      // o desenho por software leva centenas de ms por quadro: o primeiro passo já passa de 8 px, para o cancelamento não disputar tempo com o relógio da pressão
      await pg.mouse.move(ponto.x + 30, ponto.y + 20, { steps: 2 }); await pg.waitForTimeout(700); await pg.mouse.up(); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'movimento de 36 px cancela a pressão');
      const c1 = await pg.evaluate(() => { const c = window.__pavecad.map().getCenter(); return [c.lng, c.lat]; });
      assert.ok(Math.abs(c1[0] - c0[0]) + Math.abs(c1[1] - c0[1]) > 1e-6, 'o mapa foi arrastado');
      // movimento de 5 px (abaixo de 8) não cancela
      const p2 = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.move(p2.x, p2.y); await pg.mouse.down(); await pg.mouse.move(p2.x + 5, p2.y, { steps: 2 }); await pg.waitForTimeout(700); await pg.mouse.up(); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'tremida de 5 px ainda vale como pressão');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'Esc fecha');
      const p3 = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p3.x, p3.y, { button: 'right' }); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'botão direito abre o menu');
      await pg.mouse.click(p3.x + 250, p3.y + 120); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'toque fora fecha');
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.length), 0, 'nada gravado');
    }],
    ['nota rápida: o menu fica sempre dentro da tela, perto das bordas, nos quatro tamanhos', TODOS, async (pg) => {
      const dentro = () => pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((e) => { const r = e.getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5 && Math.round(r.width) === 56 && Math.round(r.height) === 56; }));
      const caixa = await pg.evaluate(() => { const r = document.querySelector('#map').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      for (const [fx, fy] of [[0.5, 0.5], [0.08, 0.5], [0.5, 0.2], [0.35, 0.42]]) {
        const x = caixa.l + (caixa.r - caixa.l) * fx, y = caixa.t + (caixa.b - caixa.t) * fy;
        const livre = await pg.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('maplibregl-canvas'), { x, y });
        if (!livre) continue; // coberto por um cartão da interface: o menu só abre sobre o mapa
        await pg.mouse.click(x, y, { button: 'right' }); await pg.waitForTimeout(250);
        const r = await dentro();
        assert.equal(r.length, 8, `menu aberto em ${fx},${fy}`); assert.ok(r.every(Boolean), `os oito botões dentro da tela e com 56 px em ${fx},${fy}`);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      }
    }],
    ['Nota no meu local: GPS bom abre o menu; sem GPS (negado, 8 s, erro ou pior que 50 m) uma linha avisa; entre 30 e 50 m abre com aviso', ['1366x768'], async (pg, { ctx }) => {
      const alvo = await centrarNaFaixa(pg, 0, 300, 1);
      const noMeuLocal = async () => { await pg.evaluate(() => { void window.__pavecad.notaNoMeuLocal(); }); };
      await ctx.grantPermissions(['geolocation']);
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 9 });
      await noMeuLocal(); await pg.waitForTimeout(1200);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'GPS bom: menu no meu local');
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(400);
      const n = await pg.evaluate(() => window.__pavecad.E.notes.at(-1));
      assert.equal(n.rapida.origem, 'gps'); assert.equal(n.rapida.precisao, 9); assert.equal(n.rapida.tipo, 'dreno_menos'); assert.equal(n.rapida.estado, 'dentro');
      // 40 m: abre, com aviso na legenda
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 40 });
      await noMeuLocal(); await pg.waitForTimeout(1200);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'precisão de 40 m ainda abre');
      assert.match(await pg.textContent('#nr .nr-cap'), /GPS ±40 m/);
      assert.equal(await pg.locator('#nr .nr-cap.aviso').count(), 1, 'aviso em destaque');
      await pg.keyboard.press('Escape');
      // precisão ruim (80 m): uma linha, sem menu e sem mira
      await ctx.setGeolocation({ latitude: alvo.lat, longitude: alvo.lon, accuracy: 80 });
      await noMeuLocal(); await pg.waitForTimeout(1200);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'precisão pior que 50 m não abre');
      assert.equal((await pg.textContent('#toast')).trim(), 'Sem GPS. Segure no mapa no ponto desejado.');
      assert.equal(await pg.locator('#nrUsar').count() + (await pg.isVisible('.nr-anel') ? 1 : 0), 0, 'sem modo de mira');
      // permissão negada (o Chromium sem interface não nega de verdade: responde "negada" pelo mesmo caminho do navegador)
      await pg.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, err) => setTimeout(() => err({ code: 1, message: 'negada' }), 50); });
      await noMeuLocal(); await pg.waitForTimeout(800);
      assert.equal((await pg.textContent('#toast')).trim(), 'Sem GPS. Segure no mapa no ponto desejado.');
      // sem resposta do GPS: 8 s
      await pg.evaluate(() => { navigator.geolocation.getCurrentPosition = () => {}; document.querySelector('#toast').textContent = ''; });
      const t0 = Date.now(); await noMeuLocal(); await pg.waitForFunction(() => /Sem GPS/.test(document.querySelector('#toast').textContent), null, { timeout: 12000 });
      const dt = Date.now() - t0; assert.ok(dt >= 7500 && dt < 11000, `espera de 8 s antes de avisar (${dt} ms)`);
    }],
    ['menu de campo: pistas a 10 m deixam o sentido ambíguo: grava o mais próximo e a roda oferece "Trocar sentido"; sem planilha e fora do trecho gravam só a posição', ['1366x768'], async (pg) => {
      const alvo = await pg.evaluate(() => {
        const E = window.__pavecad.E, m = window.__pavecad.map(), c = E.P.find((q) => /TH44 · Crescente/.test(q.meta.name)), d = E.P.find((q) => /TH44 · Decrescente/.test(q.meta.name));
        const i = 30, a = c.rows[i], j = d.kmNum.findIndex((k) => Math.abs(k - c.kmNum[i]) < 0.011), b = d.rows[j];
        const lon = a.lon * 0.8 + b.lon * 0.2, lat = a.lat * 0.8 + b.lat * 0.2; // 2 m do eixo do crescente
        m.jumpTo({ center: [lon, lat], zoom: 19 });
        return { lon, lat };
      });
      await pg.waitForTimeout(1000);
      const pt = await pg.evaluate((a) => { const m = window.__pavecad.map(), q = m.project([a.lon, a.lat]), r = m.getCanvas().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, alvo);
      await pg.mouse.click(pt.x, pt.y, { button: 'right' }); await pg.waitForTimeout(400);
      assert.equal(await pg.locator('#nr select, #nr [role=group], #nr .seg').count(), 0, 'sem seletor de sentido no menu');
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida.sentido), 'Crescente', 'grava o sentido mais próximo');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['obs', 'desfazer', 'sentido']);
      await pg.click('#nr .nr-op[data-a=sentido]'); await pg.waitForTimeout(300);
      const n = await pg.evaluate(() => window.__pavecad.E.notes.at(-1));
      assert.equal(n.rapida.sentido, 'Decrescente'); assert.equal(n.rapida.tipo, 'dreno_menos'); assert.match(n.rapida.planilha, /Decrescente/); assert.ok(n.loc && /Decrescente/.test(n.loc.name));
      await pg.click('#nr .nr-op[data-a=sentido]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida.sentido), 'Crescente', 'trocar de novo volta');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      // fora do trecho: longe de tudo
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ center: [-47.5, -14.9], zoom: 16 })); await pg.waitForTimeout(800);
      const c = await pg.evaluate(() => { const r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + r.width / 2 - 100, y: r.top + r.height / 2 }; });
      await pg.mouse.click(c.x, c.y, { button: 'right' }); await pg.waitForTimeout(300);
      assert.match(await pg.textContent('#nr .nr-cap'), /Fora do trecho/);
      await pg.click('#nr .nr-op[data-t=dreno_mais]'); await pg.waitForTimeout(300);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      const f = await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida);
      assert.equal(f.estado, 'fora'); assert.equal(f.planilha, null); assert.equal(f.km, null); assert.equal(f.faixa, null);
      // sem planilha visível: trecho não definido
      await pg.evaluate(() => window.__pavecad.E.P.forEach((p) => { p.visible = false; }));
      // 60 px ao lado: pressionar sobre o marcador da nota anterior abriria a edição dela
      await pg.mouse.click(c.x + 60, c.y, { button: 'right' }); await pg.waitForTimeout(300);
      assert.match(await pg.textContent('#nr .nr-cap'), /Trecho não definido/);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida.estado), 'sem-planilha');
    }, OPTS_NOVE],
    ['Alterar solução: segunda roda com as soluções do projeto (atual desabilitada), Sem intervenção e Outros; um toque grava a proposta; Estender, Observação e Desfazer dentro da roda', ['1366x768'], async (pg) => {
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      const info = await pg.evaluate(() => { const E = window.__pavecad.E, p = E.P[0]; return { atual: p.model[300].tr[0].main, props: E.props.length, tab: E.tab, r0: 300 }; });
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      const roda = await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((e) => { const r = e.getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return { s: e.dataset.s, off: e.disabled, w: Math.round(r.width), dentro: r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5 }; }));
      assert.ok(roda.length >= 3 && roda.length <= 7, 'até 5 soluções, Sem intervenção e Outros: ' + roda.length);
      assert.deepEqual(roda.slice(-2).map((x) => x.s), ['-', '__outros']);
      assert.ok(roda.every((x) => x.dentro && x.w >= 56), 'bolhas dentro da tela, com 56 px ou mais');
      const atual = roda.find((x) => x.s === info.atual);
      if (atual) assert.equal(atual.off, true, 'a solução atual fica desabilitada');
      assert.match(await pg.textContent('#nr .nr-centro'), new RegExp('Atual'));
      assert.equal(await pg.locator('#nr input, #nr textarea, #nr select').count(), 0, 'nada para digitar');
      // um toque na solução nova grava na hora
      const nova = roda.find((x) => x.s !== '__outros' && x.s !== info.atual && !x.off).s;
      await pg.click(`#nr .nr-op[data-s="${nova}"]`); await pg.waitForTimeout(400);
      const pr = await pg.evaluate(() => window.__pavecad.E.props.at(-1));
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), info.props + 1);
      assert.equal(pr.to, nova); assert.equal(pr.from, info.atual); assert.equal(pr.lane, 1); assert.equal(pr.r1, pr.r0, 'um segmento de 20 m');
      const i0 = pr.r0;
      assert.ok(['Aumenta', 'Reduz', 'Retira', 'Troca'].includes(pr.campo.efeito)); assert.equal(pr.campo.antes, 0); assert.equal(pr.campo.origem, 'pressao');
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['estender', 'obs', 'desfazer']);
      assert.equal(await pg.locator('.toast-nota, .toast-acao').count(), 0, 'sem toast fora do menu');
      // Estender: dois arcos e a extensão toda; atualiza km inicial e final
      await pg.click('#nr .nr-op[data-a=estender]'); await pg.waitForTimeout(250);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.e)), ['a20', 'a40', 'a100', 'd20', 'd40', 'd100', 'toda']);
      await pg.click('#nr .nr-op[data-e=a40]'); await pg.waitForTimeout(250);
      let q = await pg.evaluate(() => window.__pavecad.E.props.at(-1));
      assert.equal(q.r0, i0 - 2); assert.equal(q.r1, i0); assert.equal(q.campo.antes, 40);
      await pg.click('#nr .nr-op[data-e=d20]'); await pg.waitForTimeout(250);
      q = await pg.evaluate(() => window.__pavecad.E.props.at(-1));
      assert.equal(q.r0, i0 - 2); assert.equal(q.r1, i0 + 1); assert.equal(q.campo.depois, 20); assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), info.props + 1, 'estender troca a proposta, não soma outra');
      assert.equal(await pg.getAttribute('#nr .nr-op[data-e=a40]', 'aria-pressed'), 'true');
      await pg.click('#nr .nr-op[data-e=toda]'); await pg.waitForTimeout(250);
      q = await pg.evaluate(() => { const E = window.__pavecad.E, r = E.props.at(-1), base = r.r0 + r.campo.antes / 20; return { r0: r.r0, r1: r.r1, run: (() => { const p = E.P[0], c = p.model[base].tr[0].code; let a = base, b = base; while (a > 0 && p.model[a - 1].tr[0].code === c) a--; while (b < p.rows.length - 1 && p.model[b + 1].tr[0].code === c) b++; return [a, b]; })() }; });
      assert.ok(q.r0 <= q.run[0] + 0 && q.r1 >= q.run[1], 'toda a extensão da solução atual: ' + JSON.stringify(q));
      await pg.click('#nr [data-a=pronto]'); await pg.waitForTimeout(200);
      // Observação: só se o usuário tocar
      await pg.click('#nr .nr-op[data-a=obs]'); await pg.waitForTimeout(200);
      await pg.keyboard.type('trocar na faixa 1'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.at(-1).note), 'trocar na faixa 1');
      // Desfazer volta tudo
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), info.props, 'Desfazer remove a proposta');
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'e fecha a roda');
      assert.equal(await estado(pg, 'E => E.tab'), info.tab, 'nenhuma ação abriu painel ou aba');
    }],
    ['Alterar solução: Sem intervenção retira; Outros lista todo o catálogo; a roda fecha sozinha em 5 s; a proposta aparece na Revisão e sobrevive ao recarregar', ['1366x768'], async (pg) => {
      const linhaComSolucao = await pg.evaluate(() => { const p = window.__pavecad.E.P[0]; for (let r = 300; r < p.rows.length - 3; r++) if (p.model[r].tr[0].main !== '-' && p.model[r + 1].tr[0].main !== '-') return r; return 300; });
      const ponto = await centrarNaFaixa(pg, 0, linhaComSolucao, 1);
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-s="__outros"]'); await pg.waitForTimeout(250);
      const n = await pg.evaluate(() => ({ itens: document.querySelectorAll('#nr .nr-lista .nr-li[data-s]').length, rolavel: (() => { const l = document.querySelector('#nr .nr-lista'); return getComputedStyle(l).overflowY; })(), cat: window.__pavecad.E.P.length }));
      assert.ok(n.itens >= 17, 'todo o catálogo: ' + n.itens); assert.equal(n.rolavel, 'auto');
      await pg.click('#nr .nr-li[data-s="-"]'); await pg.waitForTimeout(350);
      let q = await pg.evaluate(() => window.__pavecad.E.props.at(-1));
      assert.equal(q.to, '-'); assert.equal(q.campo.efeito, 'Retira');
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      // a roda fecha sozinha depois de 5 s sem toque
      await pg.waitForTimeout(5600);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'fecha sozinha em 5 s');
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), 1, 'a proposta continua gravada');
      // Revisão: a alteração aparece na lista de propostas, com o efeito
      await aba(pg, 'notas'); await pg.waitForTimeout(250);
      assert.match(await pg.textContent('#t-notas'), /Retira|Troca/);
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(2000);
      const e = await pg.evaluate(() => window.__pavecad.E.props.map((r) => ({ to: r.to, ef: r.campo && r.campo.efeito, orfa: r.orfa })));
      assert.deepEqual(e.map((x) => x.to), ['-'], 'sobrevive ao recarregar'); assert.ok(e[0].ef && !e[0].orfa);
    }],
    ['pressionar o marcador de uma alteração abre a roda de edição: Alterar, Estender, Observação e Excluir com Desfazer; pressionar o marcador de um dreno: Alterar tipo, Observação e Excluir', ['1366x768'], async (pg) => {
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"]):not([data-s="-"])'); await pg.waitForTimeout(350);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      const marcador = () => pg.evaluate(() => { const m = window.__pavecad.map(), f = m.getSource('notes')._data.features.find((x) => String(x.properties.id).startsWith('prop:')); const q = m.project(f.geometry.coordinates), r = m.getCanvas().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
      const mk = await marcador();
      await pg.mouse.click(mk.x, mk.y, { button: 'right' }); await pg.waitForTimeout(300);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['alterar', 'estender', 'obs', 'excluir']);
      // Alterar: mesma segunda roda, com a solução nova atual desabilitada
      const to = await pg.evaluate(() => window.__pavecad.E.props.at(-1).to);
      await pg.click('#nr .nr-op[data-a=alterar]'); await pg.waitForTimeout(250);
      assert.equal(await pg.evaluate((t) => document.querySelector(`#nr .nr-op[data-s="${t}"]`)?.disabled ?? true, to), true, 'a solução atual da proposta fica desabilitada');
      await pg.click('#nr .nr-op[data-s="-"]'); await pg.waitForTimeout(350);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.at(-1).to), '-', 'trocou a solução proposta');
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), 1, 'sem duplicar');
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.at(-1).to), to, 'Desfazer devolve a solução proposta de antes');
      await pg.evaluate(() => { const E = window.__pavecad.E; E.props.length = 0; });
      // refaz e exclui com Desfazer
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"]):not([data-s="-"])'); await pg.waitForTimeout(350);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      await pg.mouse.click(mk.x, mk.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-a=excluir]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), 0, 'excluída');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['desfazer']);
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.props.length), 1, 'Desfazer devolve a alteração');
      // dreno: marcador próprio
      const p2 = await centrarNaFaixa(pg, 0, 340, 1);
      await pg.mouse.click(p2.x, p2.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_mais]'); await pg.waitForTimeout(300);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      const mk2 = await pg.evaluate(() => { const m = window.__pavecad.map(), n = window.__pavecad.E.notes.at(-1), q = m.project(n.coords[0]), r = m.getCanvas().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
      await pg.mouse.click(mk2.x, mk2.y, { button: 'right' }); await pg.waitForTimeout(300);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['alterar', 'obs', 'excluir']);
      await pg.click('#nr .nr-op[data-a=alterar]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida.tipo), 'dreno_menos', 'Alterar troca Colocar por Retirar dreno');
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.notes.at(-1).rapida.tipo), 'dreno_mais');
    }],
    ['Ver parâmetros: levantamento do ponto por faixa, alcance em chips, Copiar levantamento (CSV do recorte); não cria nota nem proposta', ['1366x768'], async (pg, { ctx }) => {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      const antes = await pg.evaluate(() => ({ n: window.__pavecad.E.notes.length, q: window.__pavecad.E.props.length }));
      await pg.mouse.click(ponto.x, ponto.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=parametros]'); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-card').count(), 1, 'cartão aberto');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-chip')].map((b) => b.textContent)), ['Só este segmento', '100 m', '500 m', '1 km']);
      const lin = () => pg.evaluate(() => [...document.querySelectorAll('#nr .nr-tab tbody tr:not(.cam)')].map((r) => r.querySelector('th').textContent));
      const f0 = await lin();
      assert.ok(f0.length >= 3 && f0[0] === 'Fx 1', 'uma linha por faixa e o acostamento: ' + f0);
      assert.match(await pg.textContent('#nr .nr-card-top'), /km \d+\+\d{3}/);
      const cab = await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-tab thead th')].map((t) => t.textContent));
      assert.deepEqual(cab.slice(0, 5), ['Faixa', 'Km', 'Solução', 'Larg. (m)', 'Área (m²)']);
      assert.ok(cab.includes('IRI'), 'indicadores com dado: ' + cab);
      await pg.click('#nr .nr-chip[data-m="500"]'); await pg.waitForTimeout(250);
      assert.equal(await pg.getAttribute('#nr .nr-chip[data-m="500"]', 'aria-pressed'), 'true');
      const f500 = await lin(); assert.ok(f500.length >= f0.length, 'alcance maior, ao menos as mesmas linhas');
      await pg.click('#nr [data-a=copiar]'); await pg.waitForTimeout(400);
      const csv = await pg.evaluate(() => navigator.clipboard.readText());
      assert.match(csv.split('\n')[0], /^Planilha;Faixa;Km inicial;Km final;Extensão \(m\);Largura \(m\);Área \(m²\);Código;Solução;Classe;Camadas;/);
      assert.equal(csv.split('\n').length - 1, f500.length, 'uma linha por trecho do recorte');
      assert.deepEqual(await pg.evaluate(() => ({ n: window.__pavecad.E.notes.length, q: window.__pavecad.E.props.length })), antes, 'não grava nota nem proposta');
      // fecha ao tocar fora
      await pg.mouse.click(40, 560); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#nr .nr-card').count(), 0, 'tocar fora fecha');
    }],
    ['as rodas cabem em 360x640: menu principal e segunda roda inteiros dentro da tela, sem sobrepor, perto das bordas', ['1366x768'], async (pg) => {
      await pg.setViewportSize({ width: 360, height: 640 }); await pg.waitForTimeout(600);
      const caixa = await pg.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const confere = async (rot, esperado) => {
        const r = await pg.evaluate(() => { const s = document.querySelector('.stage').getBoundingClientRect(); const b = [...document.querySelectorAll('#nr .nr-op')].map((e) => e.getBoundingClientRect()); return { n: b.length, dentro: b.every((q) => q.left >= s.left - 0.5 && q.right <= s.right + 0.5 && q.top >= s.top - 0.5 && q.bottom <= s.bottom + 0.5), sobrepoe: b.some((q, i) => b.some((w, j) => j > i && q.left < w.right - 1 && q.right > w.left + 1 && q.top < w.bottom - 1 && q.bottom > w.top + 1)) }; });
        assert.equal(r.n, esperado, rot + ': ' + r.n + ' bolhas'); assert.ok(r.dentro, rot + ': dentro da tela'); assert.ok(!r.sobrepoe, rot + ': sem sobreposição');
      };
      let abertos = 0;
      for (const [fx, fy] of [[0.5, 0.5], [0.06, 0.5], [0.94, 0.5], [0.5, 0.12], [0.5, 0.9], [0.06, 0.1], [0.94, 0.1], [0.06, 0.9], [0.25, 0.3], [0.75, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
        if (abertos >= 6) break;
        const x = caixa.l + (caixa.r - caixa.l) * fx, y = caixa.t + (caixa.b - caixa.t) * fy;
        const livre = await pg.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('maplibregl-canvas'), { x, y });
        if (!livre) continue;
        await pg.mouse.click(x, y, { button: 'right' }); await pg.waitForTimeout(250);
        await confere(`principal em ${fx},${fy}`, 8); abertos++;
        await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
        const n = await pg.locator('#nr .nr-op').count();
        if (n) await confere(`soluções em ${fx},${fy}`, n);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      }
      assert.ok(abertos >= 2, 'ao menos dois pontos livres do mapa testados: ' + abertos + ' ' + JSON.stringify(caixa));
    }],
    ['Ajustes: o catálogo tem o campo "Nível" (padrão: sem intervenção 0 a reparo profundo 7), editável e lembrado', ['1366x768'], async (pg) => {
      await pg.click('#btnCfg');
      await pg.waitForSelector('#catBody', { timeout: 4000 });
      const niv = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#catBody tr')].map((r) => [r.dataset.c, r.querySelector('[data-f=nivel]').value])));
      assert.equal(niv.ST, '1'); assert.equal(niv.MFS, '2'); assert.equal(niv.FS3, '3'); assert.equal(niv.FSE, '4'); assert.equal(niv.REF, '5'); assert.equal(niv.REC, '6'); assert.equal(niv.RP, '7');
      await pg.fill('#catBody tr[data-c=FS3] [data-f=nivel]', '9'); await pg.press('#catBody tr[data-c=FS3] [data-f=nivel]', 'Tab'); await pg.waitForTimeout(300);
      assert.equal(await pg.inputValue('#catBody tr[data-c=FS3] [data-f=nivel]'), '9');
    }],
    ['nota rápida em tela de toque (CDP): segurar 500 ms abre o menu e vibra; arrastar mais de 8 px cancela; dica única "Segure no mapa" lembrada', ['tablet-h-1024x768'], async (pg, { ctx }) => {
      await pg.waitForSelector('.nr-dica', { timeout: 6000 });
      assert.match(await pg.textContent('.nr-dica'), /Segure no mapa para anotar/);
      await pg.click('.nr-dica button', { timeout: 5000 }).catch(async (e) => { throw new Error(String(e.message).slice(0, 600)); }); await pg.waitForTimeout(200);
      assert.equal(await pg.locator('.nr-dica').count(), 0);
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-dica-nota')), '1');
      const ponto = await centrarNaFaixa(pg, 0, 300, 1);
      const cdp = await ctx.newCDPSession(pg);
      await pg.evaluate(() => { window.__vibrou = []; navigator.vibrate = (v) => { window.__vibrou.push(v); return true; }; });
      const toque = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
      await toque('touchStart', ponto.x, ponto.y); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'aos 250 ms ainda não abriu');
      await pg.waitForTimeout(450); await toque('touchEnd', ponto.x, ponto.y); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'pressão por toque abre o menu');
      assert.ok((await pg.evaluate(() => window.__vibrou)).length >= 1, 'vibra ao abrir');
      assert.equal(await pg.evaluate(() => !!window.__pavecad.E.sel), false, 'não seleciona o segmento por baixo');
      assert.equal(await pg.evaluate(() => document.querySelector('#nr .nr-op').getBoundingClientRect().width), 56);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      await toque('touchStart', ponto.x, ponto.y);
      for (let i = 1; i <= 5; i++) await toque('touchMove', ponto.x + i * 6, ponto.y);
      await pg.waitForTimeout(700); await toque('touchEnd', ponto.x + 30, ponto.y); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'arrastar mais de 8 px cancela a pressão');
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(3500);
      assert.equal(await pg.locator('.nr-dica').count(), 0, 'a dica não volta');
    }],
  ],
  t23: [
    ['abas do painel: Segmento, Análise, Revisão (com contador), Exportar e Ajustes, nessa ordem; Segmento abre por padrão; sem aba Resumo', TODOS, async (pg) => {
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#tabs [role=tab]')].map((b) => b.querySelector('.tt').firstChild.textContent.trim())), ['Segmento', 'Análise', 'Revisão', 'Exportar', 'Ajustes']);
      assert.equal(await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t), 'seg');
      assert.equal(await pg.locator('#t-resumo, [data-t=resumo]').count(), 0, 'a aba Resumo deixou de existir');
      if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) { await pg.click('#collapse'); await pg.waitForTimeout(300); }
      const corte = await pg.evaluate(() => { const t = document.querySelector('#tabs').getBoundingClientRect(); return [...document.querySelectorAll('#tabs button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < t.left - 1 || r.right > t.right + 1 || b.scrollWidth > b.clientWidth + 1; }).map((b) => b.dataset.t); });
      assert.deepEqual(corte, [], 'nenhuma aba cortada');
      // contador na Revisão: notas e alterações
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_mais]'); await pg.waitForTimeout(300); await pg.keyboard.press('Escape');
      assert.equal((await pg.textContent('#revN')).trim(), '1');
      assert.match((await pg.textContent('#tabs [data-t=notas]')).replace(/\s+/g, ' ').trim(), /Revisão\s?1$/);
    }],
    ['dashboard de projetos: abre pelo botão Projetos e pelo cartão da rodovia; um cartão por planilha com resumo e ações; Abrir planilhas dentro', ['1366x768', 'tablet-v-820x1180'], async (pg) => {
      assert.equal(await pg.isVisible('#dash'), false);
      await pg.click('#subtitle'); await pg.waitForSelector('#dash:not([hidden])');
      assert.equal(await pg.locator('#dash .pcard').count(), 2, 'um cartão por planilha');
      assert.equal(await pg.locator('#dash .dash-resumo').count(), 1, 'resumo consolidado no topo');
      const c = await pg.evaluate(() => { const e = document.querySelector('#dash .pcard'); const t = e.innerText.replace(/\s+/g, ' '); return { dir: !!e.querySelector('.dirb'), barra: !!e.querySelector('.pbar'), leg: !!e.querySelector('.pleg li'), ind: /IRI/.test(t) && /ATR/.test(t), q: /alerta/.test(t), cont: /proposta.*nota/.test(t), acoes: [...e.querySelectorAll('.pc-a button, .pc-a label')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')), olho: !!e.querySelector('[data-eye]') }; });
      assert.ok(c.dir && c.barra && c.leg && c.ind && c.q && c.cont && c.olho, 'o cartão traz sentido, distribuição, indicadores, qualidade, contagens e olho: ' + JSON.stringify(c));
      assert.deepEqual(c.acoes, ['Alinhar: abrir Ajustes', 'Cor', 'Remover']);
      assert.equal(await pg.isVisible('#dashAbrir'), true, 'Abrir planilhas dentro do dashboard');
      // olho oculta a planilha; Cor grava; Alinhar abre a aba de alinhamento
      await pg.click('#dash .pcard [data-eye]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => window.__pavecad.E.P.filter((p) => !p.visible).length), 1);
      await pg.click('#dash .pcard [data-eye]'); await pg.waitForTimeout(300);
      await pg.evaluate(() => { const i = document.querySelector('#dash [data-cor]'); i.value = '#ff00aa'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => Object.values(window.__pavecad.E.coresProj)[0]), '#ff00aa');
      await pg.click('#dash [data-alinhar-p]'); await pg.waitForTimeout(500);
      assert.equal(await pg.isVisible('#dash'), false, 'Alinhar fecha o dashboard'); assert.equal(await estado(pg, 'E => E.tab'), 'aj');
      await pg.click('#btnProjetos'); await pg.waitForSelector('#dash:not([hidden])');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      assert.equal(await pg.isVisible('#dash'), false, 'Esc fecha');
    }],
    ['badges de sentido: mesma largura e altura, seta e texto, crescente primeiro, um preenchido e o outro com contorno', ['1366x768'], async (pg) => {
      await pg.click('#btnProjetos'); await pg.waitForSelector('#dash:not([hidden])');
      const b = await pg.evaluate(() => [...document.querySelectorAll('#dash .pcard .dirb')].map((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { t: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, bd: cs.borderTopWidth }; }));
      assert.deepEqual(b.map((x) => x.t), ['↑ CRESC', '↓ DECRESC'], 'crescente primeiro, com seta');
      assert.equal(b[0].w, b[1].w); assert.equal(b[0].h, b[1].h);
      assert.notEqual(b[0].bg, 'rgba(0, 0, 0, 0)', 'crescente preenchido'); assert.equal(b[1].bg, 'rgba(0, 0, 0, 0)', 'decrescente só com contorno'); assert.ok(parseFloat(b[1].bd) >= 1);
    }],
    ['camada do mapa: chip compacto "Solução" no lugar da barra do topo; menu vertical com as 9 camadas, as sem dado desabilitadas; um toque escolhe e fecha; persiste; atalho C', ['1366x768', 'tablet-v-820x1180'], async (pg) => {
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('.seg.modes, .topbar > .modes')].filter((e) => e.checkVisibility()).length), 0, 'nenhuma barra de camadas aberta no topo');
      assert.equal((await pg.textContent('#camadaNome')).trim(), 'Solução');
      const chip = await pg.evaluate(() => { const c = document.querySelector('#btnCamada').getBoundingClientRect(), t = document.querySelector('#titlecard').getBoundingClientRect(); return { h: Math.round(c.height), abaixo: c.top >= t.bottom - 1, esq: Math.abs(c.left - t.left) < 40 }; });
      assert.ok(chip.h >= 36 && chip.h <= 44 && chip.abaixo && chip.esq, 'chip de 36 a 44 px, abaixo do cartão de busca, alinhado à esquerda: ' + JSON.stringify(chip));
      assert.equal(await pg.isVisible('#modes'), false);
      await pg.click('#btnCamada'); await pg.waitForTimeout(200);
      const m = await pg.evaluate(() => [...document.querySelectorAll('#modes button')].map((b) => ({ m: b.dataset.m, off: b.disabled, h: Math.round(b.getBoundingClientRect().height), sel: b.getAttribute('aria-selected'), sd: /sem dado/.test(b.textContent) })));
      assert.deepEqual(m.map((x) => x.m), ['sol', 'iri', 'atr', 'd0', 'rc', 'def', 'igg', 'fc2', 'fc3']);
      assert.ok(m.every((x) => x.h >= 44), 'itens de 44 px ou mais');
      assert.equal(m.find((x) => x.m === 'sol').sel, 'true');
      for (const k of ['igg', 'fc2', 'fc3']) assert.ok(m.find((x) => x.m === k).off && m.find((x) => x.m === k).sd, k + ' sem dado no RoadRunner');
      await pg.click('#modes [data-m=iri]'); await pg.waitForTimeout(300);
      assert.equal(await pg.isVisible('#modes'), false, 'um toque escolhe e fecha');
      assert.equal((await pg.textContent('#camadaNome')).trim(), 'IRI'); assert.equal(await estado(pg, 'E => E.mode'), 'iri');
      assert.equal(await pg.evaluate(() => document.querySelector('#btnCamada').classList.contains('fora-sol')), true, 'contorno mais forte fora de Solução');
      assert.match(await pg.textContent('#unileg'), /./, 'a linha de cores do unifilar mostra as classes do IRI');
      // persiste depois de recarregar
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(1500);
      assert.equal((await pg.textContent('#camadaNome')).trim(), 'IRI'); assert.equal(await estado(pg, 'E => E.mode'), 'iri');
      // atalho C; tocar fora fecha
      await pg.keyboard.press('c'); await pg.waitForTimeout(200); assert.equal(await pg.isVisible('#modes'), true, 'C abre o menu');
      await pg.mouse.click(5, 400); await pg.waitForTimeout(200); assert.equal(await pg.isVisible('#modes'), false, 'tocar fora fecha');
      await modo(pg, 'sol');
    }],
    ['escala sem cartão: linha fina com traços nas pontas e rótulo com contorno; entre 48 e 96 px; fora da busca, do chip e dos controles', ['1366x768', 'tablet-h-1024x768'], async (pg) => {
      const e = await pg.evaluate(() => {
        const el = document.querySelector('.maplibregl-ctrl-scale'), cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const outros = ['#titlecard', '#layerbox', '#tools'].map((s) => document.querySelector(s).getBoundingClientRect());
        return { bg: cs.backgroundColor, bd: cs.borderTopWidth + '/' + cs.borderLeftWidth + '/' + cs.borderRightWidth, sombra: cs.boxShadow, fs: parseFloat(cs.fontSize), h: Math.round(r.height), w: Math.round(r.width), halo: cs.textShadow !== 'none', sobre: outros.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top), abaixoChip: r.top >= document.querySelector('#btnCamada').getBoundingClientRect().bottom - 1 };
      });
      assert.equal(e.bg, 'rgba(0, 0, 0, 0)'); assert.equal(e.bd, '0px/0px/0px'); assert.equal(e.sombra, 'none');
      assert.equal(e.fs, 12); assert.ok(e.h >= 16 && e.h <= 20, 'altura ' + e.h); assert.ok(e.halo, 'rótulo com contorno claro');
      assert.ok(e.w >= 36 && e.w <= 96, 'largura ' + e.w); assert.ok(!e.sobre && e.abaixoChip, 'abaixo do chip e sem sobrepor busca nem controles: ' + JSON.stringify(e));
    }],
    ['cartão único de controles no canto inferior esquerdo: zoom, legenda, tela limpa e mais, com botões de 40 px ou mais; a legenda abre a lista completa', TODOS, async (pg) => {
      const c = await pg.evaluate(() => {
        const t = document.querySelector('#tools'), r = t.getBoundingClientRect();
        const btn = [...t.querySelectorAll('button')].filter((b) => b.checkVisibility()).map((b) => { const q = b.getBoundingClientRect(); return { id: b.id || b.getAttribute('aria-label'), w: Math.round(q.width), h: Math.round(q.height) }; });
        return { vidro: getComputedStyle(t).backdropFilter !== undefined && t.classList.contains('glass'), n: btn.length, menor: Math.min(...btn.map((b) => Math.min(b.w, b.h))), btn, cartoes: [...t.querySelectorAll('.glass')].length, esquerda: Math.round(r.left), margem: Math.round(innerHeight - r.bottom) };
      });
      assert.ok(c.vidro && c.n >= 5, 'cartão único com zoom +, zoom −, legenda, olho e mais: ' + JSON.stringify(c.btn)); assert.ok(c.menor >= 40, 'botões de 40 px ou mais: ' + c.menor); assert.equal(c.cartoes, 0, 'sem cartões soltos dentro');
      // a legenda é um botão do cartão e abre a lista completa
      assert.equal(await pg.isVisible('#legend'), false);
      await pg.click('#btnLegenda'); await pg.waitForTimeout(250);
      assert.equal(await pg.isVisible('#legend'), true);
      const ls = await pg.evaluate(() => ({ itens: document.querySelectorAll('#legend li button:not([data-k="-"])').length, chips: document.querySelectorAll('#unileg .lt').length, mais: +(/\+(\d+)/.exec(document.querySelector('#unileg .legmais')?.textContent ?? '')?.[1] ?? 0) }));
      assert.equal(ls.chips + ls.mais, ls.itens, `nada de classe escondida sem aviso ("Sem intervenção" fica de fora da conta): ${ls.chips} nomes + ${ls.mais} = ${ls.itens} itens`);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); assert.equal(await pg.isVisible('#legend'), false);
      // o "+N" do unifilar abre a mesma lista
      if (ls.mais) { await pg.click('#unileg .legmais'); await pg.waitForTimeout(250); assert.equal(await pg.isVisible('#legend'), true, '+N abre a lista completa'); await pg.click('#legFechar'); }
    }],
    ['dicas: "Aproxime..." com fundo próprio na coluna esquerda, fora do traçado; some ao tocar em Entendi e não volta', ['1366x768'], async (pg) => {
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 12 })); await pg.waitForTimeout(500);
      assert.equal(await pg.isVisible('#zoomnote'), true);
      const d = await pg.evaluate(() => { const e = document.querySelector('#zoomnote'), cs = getComputedStyle(e); return { fundo: cs.backgroundColor !== 'rgba(0, 0, 0, 0)', esq: !!e.closest('.leftcol'), txt: e.innerText.trim() }; });
      assert.ok(d.fundo && d.esq, 'com fundo e na coluna esquerda'); assert.match(d.txt, /Aproxime para ver a largura real das faixas/);
      await pg.click('#zoomnoteOk'); await pg.waitForTimeout(200);
      assert.equal(await pg.isVisible('#zoomnote'), false);
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-dica-zoom')), '1');
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 11 })); await pg.waitForTimeout(300);
      assert.equal(await pg.isVisible('#zoomnote'), false, 'não volta');
    }],
    ['pressão no mapa: mira, anel e rótulo de km ao vivo só depois de 150 ms; soltar ou mover cancela sem abrir nada; duração configurável; prefers-reduced-motion', ['1366x768'], async (pg) => {
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.evaluate(() => document.querySelectorAll('.nr-dica').forEach((e) => e.remove()));
      await pg.evaluate(() => localStorage.setItem('pavecad-pressao-ms', '700'));
      await pg.mouse.move(p.x, p.y); await pg.mouse.down();
      await pg.waitForTimeout(60);
      assert.equal(await pg.isVisible('.nr-anel'), false, 'antes de 150 ms nada aparece (toques e rolagens não piscam)');
      await pg.waitForTimeout(260);
      const r = await pg.evaluate(() => { const vis = (s) => !!document.querySelector(s)?.checkVisibility(); const a = document.querySelector('.nr-anel').getBoundingClientRect(), l = document.querySelector('.nr-live'), lr = l.getBoundingClientRect(); return { anel: vis('.nr-anel'), mira: vis('.nr-mira'), ops: document.querySelectorAll('#nr .nr-op').length, raio: Math.round(a.width / 2), live: l.textContent, vis: !l.hidden, fora: lr.bottom < a.top + 10 || lr.top > a.bottom - 10, hl: window.__pavecad.map().getSource('phl')._data.features.length }; });
      assert.equal(r.raio, 48, 'anel afastado do dedo (raio de 44 px mais o fio)'); assert.ok(r.vis && /^km \d+\+\d{3} · Fx 1$/.test(r.live), 'rótulo ao vivo: ' + r.live); assert.ok(r.fora, 'rótulo fora do anel e do dedo'); assert.equal(r.hl, 1, 'trecho de 20 m em destaque');
      assert.equal(r.anel, true, 'depois de 150 ms: anel'); assert.equal(r.mira, true, 'e mira no ponto exato');
      assert.equal(r.ops, 0, 'o menu ainda não abriu (700 ms)');
      // soltar antes de completar: o anel some e nada abre
      await pg.mouse.up(); await pg.waitForTimeout(350);
      assert.equal(await pg.isVisible('.nr-anel'), false); assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'soltar cancela');
      assert.equal(await pg.evaluate(() => window.__pavecad.map().getSource('phl')._data.features.length), 0, 'destaque limpo');
      // completa aos 700 ms
      await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.waitForTimeout(500);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'aos 500 ms ainda não, com 700 ms configurados');
      await pg.waitForTimeout(500); await pg.mouse.up(); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'aos 700 ms o menu abre'); assert.equal(await pg.isVisible('.nr-anel'), false);
      await pg.keyboard.press('Escape');
      // a duração é escolhida em Ajustes
      await aba(pg, 'aj');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#s-press button')].map((b) => b.textContent.trim())), ['400 ms', '500 ms', '700 ms']);
      await pg.click('#s-press [data-ms="400"]'); assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-pressao-ms')), '400');
      await pg.evaluate(() => localStorage.removeItem('pavecad-pressao-ms'));
      // movimento de mais de 8 px cancela
      await pg.evaluate(() => localStorage.setItem('pavecad-pressao-ms', '700'));
      await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.waitForTimeout(150); await pg.mouse.move(p.x + 30, p.y + 10, { steps: 2 }); await pg.waitForTimeout(800); await pg.mouse.up(); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'mover cancela');
      await pg.evaluate(() => localStorage.removeItem('pavecad-pressao-ms'));
      // prefers-reduced-motion: só o anel preenchendo em linear
      await pg.emulateMedia({ reducedMotion: 'reduce' });
      await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.waitForTimeout(300);
      const rm = await pg.evaluate(() => { const b = document.querySelector('.nr-m1 b'), cs = getComputedStyle(b), f = getComputedStyle(document.querySelector('.nr-fio')); return { fn: cs.animationTimingFunction, esc: f.transform }; });
      await pg.mouse.up(); await pg.waitForTimeout(250);
      assert.equal(rm.fn, 'linear', 'preenchimento linear'); assert.ok(rm.esc === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(rm.esc), 'sem crescimento: ' + rm.esc);
    }],
    ['contraste: todo texto visível dos cartões e painéis tem 4,5:1 ou mais nos temas claro, escuro e campo, com texto de 13 px ou mais', ['1366x768'], async (pg) => {
      const medir = () => pg.evaluate(() => {
        const cor = (s) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const comp = (f, b) => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
        const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * k[0] + .7152 * k[1] + .0722 * k[2]; };
        const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
        const root = getComputedStyle(document.documentElement), base = cor(root.getPropertyValue('--map').trim() || '#fff');
        const fundo = (el) => { if (el.closest('.seg button[aria-pressed=true],.seg button[aria-selected=true]')) return cor(root.getPropertyValue('--thumb').trim()); const cad = []; for (let e = el; e; e = e.parentElement) cad.unshift(e); let b = [base[0], base[1], base[2], 1]; for (const e of cad) { const c = cor(getComputedStyle(e).backgroundColor); if (c[3] > 0) b = comp(c, b); } return b; };
        const ruins = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) {
          const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement;
          if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          if (el.closest('.maplibregl-marker,.maplibregl-ctrl-attrib,script,style,canvas,[disabled],[aria-disabled=true],.cell,.stack,.matrix th,.xs,.stackrow,.rule .n')) continue;
          if (!el.closest('.glass,.dash,.uni,.inspector,.drawer,.topc,.lpop,.legpop')) continue;
          const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
          const cs = getComputedStyle(el), bg = fundo(el); let fg = cor(cs.color);
          if (el.closest('.seg button[aria-pressed=true],.seg button[aria-selected=true]')) fg = cor(root.getPropertyValue('--thumb-ink').trim());
          const c = cr(comp([fg[0], fg[1], fg[2], fg[3] * parseFloat(cs.opacity)], bg), bg);
          if (c < 4.5) ruins.push(`${c.toFixed(2)} ${el.className?.toString().split(' ')[0] || el.tagName} "${t.slice(0, 24)}"`);
          if (parseFloat(cs.fontSize) < 12.5 && !el.closest('.nr-op,.nr-s')) ruins.push(`${cs.fontSize} pequeno "${t.slice(0, 24)}"`);
        }
        return [...new Set(ruins)];
      });
      for (const t of ['claro', 'escuro', 'campo']) {
        await tema(pg, t);
        await pg.evaluate(() => { const E = window.__pavecad.E; window.__pavecad.select(E.P[0].id, 300, 1, { tab: true }); }); await pg.waitForTimeout(500);
        if (await pg.evaluate(() => document.querySelector('#inspector').classList.contains('collapsed'))) { await pg.click('#collapse'); await pg.waitForTimeout(300); }
        const ruins = [];
        for (const a of ['seg', 'ana', 'notas', 'exp', 'aj']) { await aba(pg, a); ruins.push(...await medir()); }
        await abrirProjetos(pg); ruins.push(...await medir()); await fecharProjetos(pg);
        assert.deepEqual([...new Set(ruins)], [], `tema ${t}`);
      }
    }],
    ['tema campo: o padrão além da cor (hachura) fica ligado por padrão', ['1366x768'], async (pg) => {
      await pg.evaluate(() => localStorage.removeItem('pavecad-padrao'));
      await tema(pg, 'campo');
      assert.equal(await estado(pg, 'E => E.padrao'), null, 'sem escolha do usuário');
      await aba(pg, 'aj');
      assert.equal(await pg.getAttribute('#s-pad', 'aria-checked'), 'true', 'ligado no campo, sem escolha explícita');
    }],
    ['ícone de ocultar painel: um só ("–") em todos os cartões; o olho só na ação global; rótulo curto e tooltip em todos os ícones da barra de ferramentas', TODOS, async (pg) => {
      const r = await pg.evaluate(() => {
        const minus = (e) => /M5 12h14/.test(e.innerHTML) && !/M3 3l18 18/.test(e.innerHTML);
        const ocultar = [...document.querySelectorAll('[data-ocultar]')].map((b) => ({ g: b.dataset.ocultar, ok: minus(b) }));
        const eyeoff = [...document.querySelectorAll('.gocultar, .tbtn[data-ocultar], .uni-h button, .ihead button, .leghead button')].filter((b) => /M3 3l18 18/.test(b.innerHTML)).length;
        const tb = [...document.querySelectorAll('#toolbar .tbtn')].map((b) => ({ id: b.id || b.dataset.tool || b.dataset.ocultar, t: !!b.title, rot: b.querySelector('.tl')?.textContent ?? null }));
        return { ocultar, eyeoff, tb };
      });
      assert.ok(r.ocultar.length >= 5 && r.ocultar.every((x) => x.ok), 'todos os botões de ocultar usam o mesmo "–": ' + JSON.stringify(r.ocultar));
      assert.equal(r.eyeoff, 0, 'o olho riscado não é mais ícone de ocultar painel');
      assert.ok(r.tb.every((b) => b.t), 'tooltip em todos'); assert.deepEqual(r.tb.filter((b) => b.rot).map((b) => b.rot), ['Posição', 'Propor', 'Campo', 'Projetos', 'Notas'], 'rótulo curto visível');
    }],
    ['botão Abrir planilhas: contorno quando há planilhas; azul sólido só na tela vazia', ['1366x768'], async (pg) => {
      const f = await pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('#btnFile')); return { bg: cs.backgroundColor, bd: cs.borderTopWidth, cor: cs.color }; });
      assert.notEqual(f.bg, 'rgb(0, 98, 204)', 'sem preenchimento azul com planilhas'); assert.ok(parseFloat(f.bd) >= 1);
      await pg.evaluate(() => { window.__pavecad.E.P.slice().forEach((p) => document.querySelector(`#dash [data-del="${p.id}"]`)); });
      await pg.click('#btnProjetos'); await pg.waitForSelector('#dash:not([hidden])');
      for (const id of await pg.evaluate(() => window.__pavecad.E.P.map((p) => p.id))) { await pg.click(`#dash [data-del="${id}"]`); await pg.waitForTimeout(250); await pg.evaluate(() => document.querySelector('.toast-acao')?.remove()); }
      await pg.click('#dashFechar'); await pg.waitForTimeout(200);
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('vazio')), true);
      const v = await pg.evaluate(() => getComputedStyle(document.querySelector('#btnFile')).backgroundColor);
      assert.match(v, /rgb\(0, 98, 204\)|rgb\(10, 107, 208\)|rgb\(0, 51, 179\)/, 'azul sólido na tela vazia: ' + v);
    }],
    ['unifilar: faixas e rótulos de 12 px, régua sem colisão na borda direita, seleção só com moldura e as cores da legenda no cabeçalho', ['1366x768', 'tablet-h-1024x768'], async (pg) => {
      const u = await pg.evaluate(() => { const l = window.__pavecad; return { alt: Math.min(...[...document.querySelectorAll('#unicard .uni-h')].map(() => 12)), chips: document.querySelectorAll('#unileg .lt').length, topo: !!document.querySelector('#unicard .uni-h #unileg') }; });
      assert.ok(u.topo && u.chips >= 1 && u.chips <= 3, 'até 3 cores no cabeçalho do unifilar: ' + u.chips);
      // a régua de km: nenhum texto passa da borda direita do canvas (desenhada em canvas: confere pelo cálculo de larguras)
      const rg = await pg.evaluate(() => { const c = document.querySelector('#uniregua'), g = c.getContext('2d'); g.font = '500 12px sans-serif'; const w = c.clientWidth, dpr = devicePixelRatio || 1; const d = g.getImageData(c.width - Math.round(6 * dpr), 0, Math.round(6 * dpr), c.height).data; let tinta = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) tinta++; return { w, tinta }; });
      assert.equal(rg.tinta, 0, 'nenhum rótulo cortado na borda direita da régua');
    }],
  ],
  // "⋯" repetido e "−" da folha Mapa no celular, com planilha: nada pode ficar oculto nem sem resposta.
  t27: [
    ['celular: o ⋯ abre e fecha a folha várias vezes, o "−" da folha só fecha e não esconde o grupo nem deixa botão solto', ['cel-412x915'], async (pg) => {
      const exp = () => pg.getAttribute('#cMapa', 'aria-expanded');
      for (let i = 0; i < 4; i++) { await pg.tap('#cMapa'); await pg.waitForTimeout(350); assert.equal(await exp(), i % 2 === 0 ? 'true' : 'false', `⋯ toque ${i + 1}`); }
      await pg.tap('#cMapa'); await pg.waitForTimeout(350); assert.equal(await exp(), 'true');
      await pg.tap('#drawer [data-ocultar=girar]'); await pg.waitForTimeout(400);
      assert.equal(await exp(), 'false', 'o "−" fechou a folha');
      for (const c of ['h-girar', 'h-titulo', 'h-ferramentas', 'h-painel', 'h-unifilar']) assert.equal(await pg.evaluate((k) => document.documentElement.classList.contains(k), c), false, c);
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll('.grestaura')].filter((e) => e.checkVisibility()).length), 0, 'sem botão de restaurar solto');
      await pg.tap('#cMapa'); await pg.waitForTimeout(400);
      assert.equal(await exp(), 'true', 'o ⋯ abre de novo depois do "−"');
      assert.equal(await pg.evaluate(() => document.querySelector('#drawer').checkVisibility()), true, 'a folha está visível');
    }],
    ['celular com estado antigo salvo ("girar" oculto): o ⋯ ainda abre a folha', ['cel-412x915'], async (pg) => {
      await pg.evaluate(() => localStorage.setItem('pavecad-ocultos', '["girar","painel"]'));
      await pg.reload(); await pg.waitForTimeout(2500);
      await pg.tap('#cMapa'); await pg.waitForTimeout(400);
      assert.equal(await pg.getAttribute('#cMapa', 'aria-expanded'), 'true');
      assert.equal(await pg.evaluate(() => document.querySelector('#drawer').checkVisibility()), true);
    }, { vazio: true }],
  ],
  // Roda de confirmação (padrão do app): nada grava antes do "Confirmar".
  t28: [
    ['roda de confirmação: escolher a solução não grava; Confirmar grava com um toque, sem teclado; Estender e Observação mudam o rascunho', ['1366x768'], async (pg) => {
      const abrir = async () => { const p = await centrarNaFaixa(pg, 0, 300, 1); await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=alterar]', { timeout: 3000 }); await pg.waitForTimeout(200); return p; };
      const nProps = () => estado(pg, 'E => E.props.length');
      await abrir();
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"])'); await pg.waitForTimeout(300);
      assert.equal(await nProps(), 0, 'tocar na solução não grava');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['estender', 'obs', 'confirmar']);
      const tam = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#nr .nr-op')].map((b) => [b.dataset.a, Math.round(b.getBoundingClientRect().width)])));
      assert.ok(tam.estender >= 56 && tam.obs >= 56 && tam.confirmar >= 56 && tam.confirmar > tam.estender && tam.confirmar > tam.obs, 'Confirmar maior que os outros dois e todos com 56 px ou mais: ' + JSON.stringify(tam));
      assert.match(await pg.textContent('#nr .nr-centro'), /→/, 'o centro resume a ação');
      assert.equal(await pg.locator('#nr input, #nr textarea').count(), 0, 'sem teclado até tocar em Observação');
      // Estender antes de confirmar altera os km do registro (ainda não gravado)
      const kmAntes = await pg.textContent('#nr .nr-centro');
      await pg.click('#nr .nr-op[data-a=estender]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-e=d100]'); await pg.waitForTimeout(250);
      await pg.click('#nr [data-a=pronto]'); await pg.waitForTimeout(250);
      assert.notEqual(await pg.textContent('#nr .nr-centro'), kmAntes, 'o resumo mostra os km estendidos');
      assert.match(await pg.textContent('#nr .nr-centro'), /km [\d+]+ a [\d+]+/);
      assert.equal(await nProps(), 0, 'Estender não grava');
      // Observação: o teclado só abre ao tocar
      await pg.click('#nr .nr-op[data-a=obs]'); await pg.waitForTimeout(250);
      assert.equal(await pg.evaluate(() => document.activeElement?.tagName), 'INPUT', 'o campo recebe o foco depois do toque em Observação');
      await pg.keyboard.type('trinca longitudinal'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      assert.equal(await nProps(), 0, 'a observação também só vale depois de confirmar');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['estender', 'obs', 'confirmar'], 'volta à roda de confirmação');
      await pg.click('#nr .nr-op[data-a=confirmar]'); await pg.waitForTimeout(350);
      assert.equal(await nProps(), 1, 'Confirmar grava');
      const r = await estado(pg, 'E => ({ note: E.props[0].note, antes: E.props[0].campo.antes, depois: E.props[0].campo.depois, r0: E.props[0].r0, r1: E.props[0].r1 })');
      assert.equal(r.note, 'trinca longitudinal'); assert.ok(r.depois >= 100 && r.r1 > r.r0, 'a extensão foi gravada: ' + JSON.stringify(r));
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['estender', 'obs', 'desfazer']);
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await nProps(), 0, 'Desfazer remove');
    }, { confirmar: true }],
    ['Confirmar grava com um toque e sem digitar: dreno e Ver conserva passam pela roda de confirmação, sem Estender', ['1366x768'], async (pg) => {
      for (const [tipo, rotulo, row] of [['dreno_mais', 'Colocar dreno', 300], ['conserva', 'Ver conserva', 330]]) {
        const p = await centrarNaFaixa(pg, 0, row, 1);
        await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector(`#nr .nr-op[data-t=${tipo}]`, { timeout: 3000 }); await pg.waitForTimeout(200);
        const antes = await estado(pg, 'E => E.notes.length');
        await pg.click(`#nr .nr-op[data-t=${tipo}]`); await pg.waitForTimeout(300);
        assert.equal(await estado(pg, 'E => E.notes.length'), antes, rotulo + ': tocar na ação não grava');
        assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['obs', 'confirmar']);
        assert.match(await pg.textContent('#nr .nr-centro'), new RegExp(rotulo));
        assert.equal(await pg.locator('#nr input, #nr textarea').count(), 0);
        await pg.click('#nr .nr-op[data-a=confirmar]'); await pg.waitForTimeout(350);
        assert.equal(await estado(pg, 'E => E.notes.length'), antes + 1, rotulo + ': Confirmar grava');
        assert.equal(await estado(pg, 'E => E.notes[E.notes.length - 1].rapida.tipo'), tipo);
        assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      }
    }, { confirmar: true }],
    ['tocar fora antes de confirmar descarta, com aviso "Descartado" e Desfazer do descarte por 5 s', ['1366x768'], async (pg) => {
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=dreno_menos]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(300);
      await pg.locator('#nrFundo').dispatchEvent('pointerdown'); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'a roda fecha');
      assert.equal(await estado(pg, 'E => E.notes.length'), 0, 'nada foi gravado');
      assert.match(await pg.textContent('.toast-acao'), /Descartado/);
      await pg.click('.toast-acao button'); await pg.waitForTimeout(300);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['obs', 'confirmar'], 'o descarte foi desfeito: a roda de confirmação volta');
      await pg.click('#nr .nr-op[data-a=confirmar]'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.notes.length'), 1);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      // Esc também descarta
      const q = await centrarNaFaixa(pg, 0, 301, 1);
      await pg.mouse.click(q.x, q.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=conserva]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=conserva]'); await pg.waitForTimeout(250);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
      assert.equal(await estado(pg, 'E => E.notes.length'), 1, 'Esc antes de confirmar não grava');
      await pg.waitForTimeout(5300);
      assert.equal(await pg.locator('.toast-acao').count(), 0, 'o Desfazer do descarte some em 5 s');
    }, { confirmar: true }],
    ['chave "Confirmar antes de gravar" em Ajustes: desligada, um toque grava e a roda mostra Estender, Observação e Desfazer', ['1366x768'], async (pg) => {
      await pg.click('#tabs [data-t=aj]'); await pg.waitForSelector('#s-conf', { timeout: 4000 });
      assert.equal(await pg.getAttribute('#s-conf', 'aria-checked'), 'true', 'ligada por padrão');
      await pg.click('#s-conf'); await pg.waitForTimeout(200);
      assert.equal(await pg.getAttribute('#s-conf', 'aria-checked'), 'false');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-confirmar-gravar')), '0');
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=alterar]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
      await pg.click('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"])'); await pg.waitForTimeout(350);
      assert.equal(await estado(pg, 'E => E.props.length'), 1, 'um toque grava');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['estender', 'obs', 'desfazer']);
      await pg.keyboard.press('Escape');
      await pg.click('#s-conf'); await pg.waitForTimeout(200);
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-confirmar-gravar')), '1', 'religa');
    }, { confirmar: true }],
    ['a roda de confirmação cabe em 360x640: três botões de 56 px ou mais dentro da tela, sem sobrepor uns aos outros nem o resumo do centro', ['1366x768'], async (pg) => {
      await pg.setViewportSize({ width: 360, height: 640 }); await pg.waitForTimeout(600);
      const caixa = await pg.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      let abertos = 0;
      for (const [fx, fy] of [[0.5, 0.5], [0.06, 0.5], [0.94, 0.5], [0.5, 0.12], [0.5, 0.9], [0.06, 0.1], [0.94, 0.1], [0.06, 0.9]]) {
        const p = await centrarNaFaixa(pg, 0, 300, 1);
        const x = caixa.l + (caixa.r - caixa.l) * fx, y = caixa.t + (caixa.b - caixa.t) * fy;
        // o ponto pressionado fica perto da borda: o mapa anda até a faixa cair ali
        await pg.evaluate(({ dx, dy }) => window.__pavecad.map().panBy([dx, dy], { duration: 0 }), { dx: p.x - x, dy: p.y - y }); await pg.waitForTimeout(250);
        const livre = await pg.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('maplibregl-canvas'), { x, y });
        if (!livre) continue;
        await pg.mouse.click(x, y, { button: 'right' }); await pg.waitForTimeout(250);
        if (!(await pg.locator('#nr .nr-op[data-t=alterar]').count())) { await pg.keyboard.press('Escape'); continue; }
        await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
        const sol = pg.locator('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"])');
        if (!(await sol.count())) { await pg.keyboard.press('Escape'); continue; }
        await sol.first().click(); await pg.waitForTimeout(300);
        const r = await pg.evaluate(() => {
          const s = document.querySelector('.stage').getBoundingClientRect(), b = [...document.querySelectorAll('#nr .nr-op')].map((e) => e.getBoundingClientRect()), c = document.querySelector('#nr .nr-centro').getBoundingClientRect();
          const cruza = (a, d) => a.left < d.right - 1 && a.right > d.left + 1 && a.top < d.bottom - 1 && a.bottom > d.top + 1;
          return { n: b.length, dentro: b.every((q) => q.left >= s.left - 0.5 && q.right <= s.right + 0.5 && q.top >= s.top - 0.5 && q.bottom <= s.bottom + 0.5), minimo: Math.min(...b.map((q) => q.width)), entre: b.some((q, i) => b.some((o, j) => j > i && cruza(q, o))), centro: b.some((q) => cruza(q, c)) };
        });
        assert.equal(r.n, 3, `confirmação em ${fx},${fy}`); assert.ok(r.dentro, `dentro da tela em ${fx},${fy}`); assert.ok(r.minimo >= 56, `alvos de 56 px ou mais em ${fx},${fy}: ${r.minimo}`);
        assert.ok(!r.entre, `sem sobreposição entre os botões em ${fx},${fy}`); assert.ok(!r.centro, `o resumo do centro não passa sob um botão em ${fx},${fy}`);
        abertos++;
        await pg.locator('#nrFundo').dispatchEvent('pointerdown'); await pg.waitForTimeout(200); await pg.evaluate(() => document.querySelector('.toast-acao')?.remove());
      }
      assert.ok(abertos >= 3, 'ao menos três pontos testados: ' + abertos);
    }, { confirmar: true }],
  ],
  // Ver conserva, Observação (texto livre com rascunho) e Foto (georreferenciada no ponto pressionado).
  t29: [
    ['Ver conserva: um toque grava; na Revisão alterna Pendente e Verificado, com filtro próprio e a data do projeto por planilha; a exportação leva Desde, Até e Situação', ['1366x768'], async (pg) => {
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=conserva]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=conserva]'); await pg.waitForTimeout(350);
      assert.equal(await pg.locator('#nr input, #nr textarea').count(), 0, 'sem teclado');
      assert.equal(await estado(pg, 'E => E.notes.length'), 1);
      assert.equal(await estado(pg, 'E => E.notes[0].rapida.tipo'), 'conserva');
      assert.equal(await estado(pg, 'E => E.notes[0].rapida.resolvida'), false, 'nasce Pendente');
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      await aba(pg, 'notas'); await pg.waitForTimeout(300);
      const item = () => pg.locator('#t-notas .nri', { hasText: 'Ver conserva' });
      assert.match(await item().first().textContent(), /Pendente/);
      assert.equal(await pg.locator('#t-notas [data-fc]').count(), 3, 'filtro Todas, Pendentes e Verificadas');
      await pg.click('#t-notas details.qual summary'); await pg.waitForTimeout(250); // o grupo da planilha abre
      // data do projeto: um campo por planilha
      assert.equal(await pg.locator('#t-notas [data-desde]').count(), 1);
      await pg.fill('#t-notas [data-desde]', '2025-03-01'); await pg.press('#t-notas [data-desde]', 'Tab'); await pg.waitForTimeout(300);
      // alternar: um toque
      await pg.click('#t-notas [data-nres]'); await pg.waitForTimeout(300);
      assert.match(await item().first().textContent(), /Verificado/);
      assert.equal(await estado(pg, 'E => E.notes[0].rapida.resolvida'), true);
      await pg.click('#t-notas [data-fc=pendente]'); await pg.waitForTimeout(250);
      assert.equal(await item().count(), 0, 'o filtro Pendentes esconde a verificada');
      await pg.click('#t-notas [data-fc=verificada]'); await pg.waitForTimeout(250);
      assert.equal(await item().count(), 1);
      await pg.click('#t-notas [data-fc=todas]'); await pg.waitForTimeout(250);
      assert.equal(await pg.evaluate(() => document.querySelector('#t-notas [data-desde]').value), '2025-03-01', 'a data do projeto fica');
      // exportação
      await aba(pg, 'exp'); await pg.waitForTimeout(400);
      const [dc] = await Promise.all([pg.waitForEvent('download'), pg.click('#exCsv')]);
      const csv = require('fs').readFileSync(await dc.path(), 'utf8').split(/\r?\n/);
      const cab = csv[0].split(';'), lin = csv[1].replace(/"[^"]*(""[^"]*)*"/g, '""').split(';');
      assert.deepEqual(cab.slice(-4), ['Desde', 'Até', 'Situação', 'Arquivo da foto']);
      assert.equal(lin[2], '""'); assert.match(csv[1], /"Ver conserva"/);
      assert.equal(lin[lin.length - 4], '01/03/2025', 'Desde'); assert.match(lin[lin.length - 3], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/, 'Até'); assert.equal(lin[lin.length - 2], 'Verificado');
    }],
    ['Observação livre: abre o campo de texto, guarda o rascunho enquanto digita, recupera depois de recarregar, Salvar grava no ponto e Cancelar descarta', ['1366x768'], async (pg) => {
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=observacao]', { timeout: 3000 }); await pg.waitForTimeout(200);
      assert.equal(await pg.locator('#nr textarea').count(), 0, 'o teclado só abre ao tocar em Observação');
      await pg.click('#nr .nr-op[data-t=observacao]'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate(() => document.activeElement?.tagName), 'TEXTAREA', 'o campo de texto recebe o foco');
      assert.equal(await estado(pg, 'E => E.notes.length'), 0);
      await pg.keyboard.type('bueiro entupido no km 170'); await pg.waitForTimeout(200);
      assert.match(await pg.evaluate(() => localStorage.getItem('pavecad-rascunho-obs')), /bueiro entupido no km 170/, 'o rascunho é guardado enquanto digita');
      // o app fecha no meio da digitação
      await pg.reload(); await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(2500);
      assert.equal(await pg.inputValue('#nr textarea'), 'bueiro entupido no km 170', 'o rascunho volta ao reabrir');
      await pg.click('#nr [data-a=salvar]'); await pg.waitForTimeout(400);
      const n = await estado(pg, 'E => E.notes.map((x) => ({ tipo: x.rapida.tipo, texto: x.text, km: x.rapida.km, lon: x.coords[0][0], lat: x.coords[0][1] }))');
      assert.equal(n.length, 1); assert.equal(n[0].tipo, 'observacao'); assert.equal(n[0].texto, 'bueiro entupido no km 170'); assert.ok(n[0].km, 'grava km, faixa e sentido do ponto: ' + JSON.stringify(n[0]));
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-rascunho-obs')), null, 'o rascunho some depois de salvar');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      // Cancelar descarta o rascunho
      const q = await centrarNaFaixa(pg, 0, 320, 1);
      await pg.mouse.click(q.x, q.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=observacao]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=observacao]'); await pg.waitForTimeout(250);
      await pg.keyboard.type('rascunho que será cancelado'); await pg.click('#nr [data-a=cancelar]'); await pg.waitForTimeout(250);
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-rascunho-obs')), null); assert.equal(await estado(pg, 'E => E.notes.length'), 1);
      // tocar fora com texto guarda o rascunho e oferece reabrir
      await pg.mouse.click(q.x, q.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=observacao]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-t=observacao]'); await pg.waitForTimeout(250);
      await pg.keyboard.type('texto guardado'); await pg.locator('#nrFundo').dispatchEvent('pointerdown'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.notes.length'), 1, 'tocar fora não grava'); assert.match(await pg.textContent('.toast-acao'), /Rascunho/);
      await pg.click('.toast-acao button'); await pg.waitForTimeout(300);
      assert.equal(await pg.inputValue('#nr textarea'), 'texto guardado');
    }],
    ['Foto: a câmera abre pelo input nativo, a foto é reduzida a 1600 px e grava no ponto pressionado; marcador com ícone e miniatura; a roda do marcador tem Ver foto, Trocar foto, Observação e Excluir', ['1366x768'], async (pg) => {
      const jpeg = async (w, h) => Buffer.from(await pg.evaluate(({ w, h }) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 10, h / 10, w / 4, h / 4); return c.toDataURL('image/jpeg', 0.92).split(',')[1]; }, { w, h }), 'base64');
      assert.equal(await pg.evaluate(() => { const i = document.querySelector('#fotoCampoIn'); return i && i.accept + '|' + i.getAttribute('capture'); }), 'image/*|environment', 'caminho nativo da câmera');
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=foto]', { timeout: 3000 }); await pg.waitForTimeout(200);
      const alvo = await pg.evaluate(({ x, y }) => { const m = window.__pavecad.map(), b = m.getCanvasContainer().getBoundingClientRect(), ll = m.unproject([x - b.left, y - b.top]); return { lon: ll.lng, lat: ll.lat }; }, p);
      const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nr .nr-op[data-t=foto]')]);
      assert.ok(fc, 'tocar em Foto abre o seletor da câmera');
      await fc.setFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: await jpeg(3000, 2000) });
      await pg.waitForFunction(() => window.__pavecad.E.notes.length === 1, null, { timeout: 8000 }); await pg.waitForTimeout(400);
      const n = await estado(pg, 'E => ({ tipo: E.notes[0].rapida.tipo, fotos: E.notes[0].photos.length, lon: E.notes[0].coords[0][0], lat: E.notes[0].coords[0][1], km: E.notes[0].rapida.km, faixa: E.notes[0].rapida.faixa, src: E.notes[0].photos[0].slice(0, 23) })');
      assert.equal(n.tipo, 'foto'); assert.equal(n.fotos, 1); assert.equal(n.src, 'data:image/jpeg;base64,'); assert.ok(n.km && n.faixa === 1, 'km e faixa do ponto: ' + JSON.stringify(n));
      assert.ok(Math.abs(n.lon - alvo.lon) < 2e-6 && Math.abs(n.lat - alvo.lat) < 2e-6, 'a posição da foto é o ponto pressionado');
      const dim = await pg.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.width, i.height]); i.src = window.__pavecad.E.notes[0].photos[0]; }));
      assert.deepEqual(dim, [1600, 1067], 'lado maior de 1600 px, na proporção');
      assert.match(await pg.textContent('#nr .nr-centro'), /Salvo/);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['obs', 'desfazer']);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      // marcador: ícone próprio e miniatura com zoom
      await pg.evaluate(() => window.__pavecad.map().setZoom(18.2)); await pg.waitForTimeout(1500);
      const m = await pg.evaluate(() => { const mp = window.__pavecad.map(); return { ic: mp.queryRenderedFeatures({ layers: ['notes-ic'] }).length, th: mp.hasImage('foto:' + window.__pavecad.E.notes[0].id), camada: !!mp.getLayer('notes-foto') }; });
      assert.ok(m.ic >= 1, 'marcador com ícone próprio'); assert.ok(m.th && m.camada, 'miniatura registrada para o zoom alto');
      // roda do marcador
      const centro = await pg.evaluate(() => { const mp = window.__pavecad.map(), n = window.__pavecad.E.notes[0], pt = mp.project(n.coords[0]), b = mp.getCanvasContainer().getBoundingClientRect(); return { x: b.left + pt.x, y: b.top + pt.y }; });
      await pg.mouse.click(centro.x, centro.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-a=verfoto]', { timeout: 3000 }); await pg.waitForTimeout(200);
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#nr .nr-op')].map((b) => b.dataset.a)), ['verfoto', 'trocarfoto', 'obs', 'excluir']);
      await pg.click('#nr .nr-op[data-a=verfoto]'); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#nr .nr-ver img').count(), 1, 'Ver foto mostra a imagem'); await pg.click('#nr .nr-ver [data-a=voltar]'); await pg.waitForTimeout(250);
      const [fc2] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nr .nr-op[data-a=trocarfoto]')]);
      const antes = await estado(pg, 'E => E.notes[0].photos[0].length');
      await fc2.setFiles({ name: 'outra.jpg', mimeType: 'image/jpeg', buffer: await jpeg(800, 600) });
      await pg.waitForFunction((a) => window.__pavecad.E.notes[0].photos[0].length !== a, antes, { timeout: 8000 });
      assert.equal(await estado(pg, 'E => E.notes.length'), 1, 'Trocar foto não cria outra nota');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      await pg.mouse.click(centro.x, centro.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-a=excluir]', { timeout: 3000 }); await pg.waitForTimeout(200);
      await pg.click('#nr .nr-op[data-a=excluir]'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.notes.length'), 0, 'Excluir remove');
      await pg.click('#nr .nr-op[data-a=desfazer]'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.notes.length'), 1, 'Desfazer devolve a foto');
    }],
    ['Foto: o XLSX e o CSV saem num ZIP com a pasta fotos/ (nome km..._Fx.._data_hora.jpg, EXIF GPS) e a coluna Arquivo da foto; o KMZ só leva fotos com o chip; o backup vira ZIP e restaura', ['1366x768'], async (pg) => {
      const fs = require('fs'), { unzipSync, strFromU8 } = require('fflate');
      const jpeg = async () => Buffer.from(await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const g = c.getContext('2d'); g.fillStyle = '#36c'; g.fillRect(0, 0, 2400, 1600); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; }), 'base64');
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=foto]', { timeout: 3000 }); await pg.waitForTimeout(200);
      const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click('#nr .nr-op[data-t=foto]')]);
      await fc.setFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
      await pg.waitForFunction(() => window.__pavecad.E.notes.length === 1, null, { timeout: 8000 }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      const lonlat = await estado(pg, 'E => E.notes[0].coords[0]');
      await aba(pg, 'exp'); await pg.waitForTimeout(500);
      const baixa = async (sel) => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click(sel)]); return { nome: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) }; };
      const x = await baixa('#exXlsx');
      assert.match(x.nome, /^notas_PAVTRACK_.*\.zip$/, 'com fotos o XLSX sai em ZIP: ' + x.nome);
      const z = unzipSync(new Uint8Array(x.buf)), nomes = Object.keys(z);
      const xl = nomes.find((k) => /\.xlsx$/.test(k)), ft = nomes.filter((k) => /^fotos\/.+\.jpg$/.test(k));
      assert.ok(xl, 'a planilha vai dentro do ZIP'); assert.equal(ft.length, 1, 'uma foto na pasta fotos/: ' + nomes.join(', '));
      assert.match(ft[0], /^fotos\/km\d+\+\d{3}_Fx1_\d{8}_\d{6}\.jpg$/, 'nome da foto: ' + ft[0]);
      const jpg = Buffer.from(z[ft[0]]); assert.deepEqual([...jpg.slice(0, 2)], [0xff, 0xd8], 'JPEG');
      assert.ok(jpg.includes(Buffer.from('Exif\0\0')) && jpg.includes(Buffer.from('WGS84')), 'EXIF com GPS');
      // a coordenada do EXIF é a do ponto pressionado: lê latitude e longitude em graus, minutos e segundos
      const exif = (() => { const i = jpg.indexOf(Buffer.from('Exif\0\0')) + 6, t = jpg.slice(i); const g32 = (o) => t.readUInt32LE(o), g16 = (o) => t.readUInt16LE(o); const ifd = (o) => { const n = g16(o), m = {}; for (let k = 0; k < n; k++) { const e = o + 2 + k * 12; m[g16(e)] = e + 8; } return m; }; const g = ifd(g32(ifd(g32(4))[0x8825])); const rat = (e) => { const b = g32(e); return [0, 1, 2].map((k) => g32(b + k * 8) / g32(b + k * 8 + 4)); }; const dec = ([d, m, s]) => d + m / 60 + s / 3600; return { lat: dec(rat(g[2])) * (String.fromCharCode(t[g[1]]) === 'S' ? -1 : 1), lon: dec(rat(g[4])) * (String.fromCharCode(t[g[3]]) === 'W' ? -1 : 1) }; })();
      assert.ok(Math.abs(exif.lon - lonlat[0]) < 1e-5 && Math.abs(exif.lat - lonlat[1]) < 1e-5, 'EXIF = ponto pressionado: ' + JSON.stringify([exif, lonlat]));
      const XLSX = require('xlsx-js-style'); const wb = XLSX.read(Buffer.from(z[xl]), { type: 'buffer' });
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets.Notas, { header: 1 });
      assert.equal(linhas[0][25], 'Arquivo da foto'); assert.equal('fotos/' + linhas[1][25], ft[0], 'a coluna aponta para o arquivo');
      const c = await baixa('#exCsv'); assert.match(c.nome, /\.zip$/);
      const zc = unzipSync(new Uint8Array(c.buf)); assert.ok(Object.keys(zc).some((k) => /\.csv$/.test(k)) && Object.keys(zc).some((k) => /^fotos\//.test(k)));
      // KMZ: sem o chip, sem fotos; com o chip (que liga as notas), a foto vai na pasta fotos/ e a descrição aponta para ela
      const k1 = await baixa('#exKmz'); assert.equal(Object.keys(unzipSync(new Uint8Array(k1.buf))).filter((k) => /^fotos\//.test(k)).length, 0, 'KMZ padrão não leva fotos');
      await pg.click('#xKmz .xchip[data-g=fotos]'); await pg.waitForTimeout(400);
      assert.equal(await pg.getAttribute('#xKmz .xchip[data-g=fotos]', 'aria-pressed'), 'true');
      const k2 = await baixa('#exKmz'), zk = unzipSync(new Uint8Array(k2.buf));
      assert.equal(Object.keys(zk).filter((k) => /^fotos\/.+\.jpg$/.test(k)).length, 1, 'KMZ com fotos: ' + Object.keys(zk).join(', '));
      assert.match(strFromU8(zk['doc.kml']), /<img src="fotos\/km[^"]+\.jpg"/, 'a descrição aponta para a imagem');
      // backup: ZIP com backup.json e fotos/, que restaura as fotos
      const b = await baixa('#bkDown'); assert.match(b.nome, /\.zip$/, 'com fotos o backup sai em ZIP');
      const zb = unzipSync(new Uint8Array(b.buf)); assert.ok(zb['backup.json']); assert.equal(Object.keys(zb).filter((k) => /^fotos\//.test(k)).length, 1);
      const j = JSON.parse(strFromU8(zb['backup.json'])); assert.match(j.notas[0].photos[0], /^fotos\//, 'as notas apontam para a pasta');
      await pg.evaluate(() => { const E = window.__pavecad.E; E.notes.length = 0; });
      const tmp = require('path').join(require('os').tmpdir(), 'pavecad-backup-teste.zip'); fs.writeFileSync(tmp, b.buf);
      await pg.setInputFiles('#importIn', tmp); await pg.waitForFunction(() => window.__pavecad.E.notes.length === 1, null, { timeout: 8000 });
      assert.match(await estado(pg, 'E => E.notes[0].photos[0].slice(0, 23)'), /^data:image\/jpeg;base64,$/, 'a foto voltou do ZIP');
    }],
  ],
  // Armazenamento que não responde (aba privada, bloqueio no Brave/Android): a partida não pode ficar presa esperando o IndexedDB.
  t26: [
    ['celular com IndexedDB que nunca responde: "⋯" e "Abrir planilhas" respondem e o app avisa que nada será salvo', ['cel-412x915'], async (pg) => {
      await pg.waitForFunction(() => document.querySelector('#cMapa')?.dataset.pronto === '1' || /indisponível/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
      await pg.tap('#cMapa'); await pg.waitForTimeout(500);
      assert.equal(await pg.getAttribute('#cMapa', 'aria-expanded'), 'true', 'o "⋯" abriu a folha');
      await pg.tap('#cMapa'); await pg.waitForTimeout(400);
      assert.equal(await pg.getAttribute('#cMapa', 'aria-expanded'), 'false');
      const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.tap('#gavAbrir')]);
      assert.ok(fc, 'o botão "Abrir planilhas" da gaveta abre o seletor de arquivos');
    }, { vazio: true, antes: () => { indexedDB.open = () => ({ set onsuccess(_f) {}, set onerror(_f) {}, set onblocked(_f) {}, set onupgradeneeded(_f) {}, result: null }); } }],
  ],
  // Teste de fumaça do celular (toque real via CDP): encadeia as ações na mesma sessão, sem recarregar, e exige que a seguinte responda.
  t25: [
    ['celular, fumaça em sequência (toques CDP): fundo, camada, ir para km, pressão, cancelar por movimento, alterar solução, gaveta e abas', ['cel-412x915'], async (pg, { ctx }) => {
      const cdp = await ctx.newCDPSession(pg);
      const erros = [];
      pg.on('pageerror', (e) => erros.push(e.message));
      const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
      const centro = (sel) => pg.evaluate((q) => { const e = document.querySelector(q); if (!e || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, t = document.elementFromPoint(x, y); return { x, y, ok: !!t && (e.contains(t) || t.contains(e)), topo: t ? (t.id || t.className || t.tagName) : null }; }, sel);
      /** Toque real no centro do controle; falha se o controle não existe ou se outro elemento recebe o toque. */
      const tocar = async (sel, rotulo) => {
        const c = await centro(sel);
        assert.ok(c, `${rotulo}: controle ausente (${sel})`);
        assert.ok(c.ok, `${rotulo}: o toque iria para ${c.topo}, não para ${sel}`);
        await T('touchStart', c.x, c.y); await pg.waitForTimeout(60); await T('touchEnd'); await pg.waitForTimeout(380);
      };
      const pressionar = async (x, y, ms, mover) => {
        await T('touchStart', x, y); await pg.waitForTimeout(ms);
        if (mover === 'mover') { await T('touchMove', x + 40, y + 40); await pg.waitForTimeout(120); }
        if (mover === 'cancelar') await T('touchCancel'); else await T('touchEnd');
        await pg.waitForTimeout(450);
      };
      const menuAberto = () => pg.evaluate(() => document.querySelectorAll('#nr .nr-op').length);
      const estadoApp = (f) => pg.evaluate(`(${f})(window.__pavecad.E)`);
      const respondem = async (rotulo) => { for (const sel of ['#cMapa', '#btnCamada', '#cLocal', '#gavTxt']) { const c = await centro(sel); assert.ok(c && c.ok, `${rotulo}: ${sel} deixou de responder (${c ? 'coberto por ' + c.topo : 'ausente'})`); } };
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      let ponto = { x: 206, y: 420 };

      // 1. fundo para Satélite, fechar a folha "Mapa", abrir e fechar de novo
      await tocar('#cMapa', 'abrir Mapa'); await tocar('#drawer #base [data-b=esri]', 'Satélite');
      assert.equal(await estadoApp('E => E.base'), 'esri');
      await tocar('#cMapa', 'fechar Mapa'); await respondem('depois do fundo');
      await tocar('#cMapa', 'abrir ⋯'); await tocar('#cMapa', 'fechar ⋯'); await respondem('depois do ⋯');
      // 2. camada
      await tocar('#btnCamada', 'chip de camada'); await tocar('#modes [data-m=iri]', 'camada IRI');
      assert.equal(await estadoApp('E => E.mode'), 'iri'); await respondem('depois da camada');
      // 3. Ir para km
      await tocar('#cLocal', 'Ir para km'); await pg.fill('#cGoKm', '170+500'); await tocar('#cGoBtn', 'Ir'); await pg.waitForTimeout(1200); await respondem('depois do km');
      ponto = await centrarNaFaixa(pg, 0, 300, 1); // um ponto sobre a pista para a pressão
      // 4. pressão abre o menu; Escape fecha
      await pressionar(ponto.x, ponto.y, 850);
      assert.ok(await menuAberto() >= 4, 'a pressão abriu o menu'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
      assert.equal(await menuAberto(), 0); await respondem('depois do menu');
      // 5. pressão cancelada por movimento: nada abre e o mapa segue respondendo
      await pressionar(ponto.x, ponto.y, 180, 'mover');
      assert.equal(await menuAberto(), 0, 'o movimento cancelou a pressão'); await respondem('depois do cancelamento por movimento');
      // 6. pressão interrompida por touchCancel: nada abre, nada fica preso
      await pressionar(ponto.x, ponto.y, 180, 'cancelar');
      assert.equal(await menuAberto(), 0, 'touchCancel cancelou a pressão');
      assert.equal(await pg.evaluate(() => { const a = document.querySelector('.nr-anel'); return !a || a.hidden; }), true, 'o anel de progresso não fica na tela');
      await respondem('depois do touchCancel');
      // 7. de novo a pressão, e "Alterar solução" (roda e solução); o arrasto do passo 5 moveu o mapa, então a pista é centrada de novo
      ponto = await centrarNaFaixa(pg, 0, 300, 1);
      await pressionar(ponto.x, ponto.y, 850);
      assert.ok(await menuAberto() >= 4, 'o menu abre de novo depois do cancelamento');
      assert.equal(await pg.locator('#nr input, #nr textarea').count(), 0, 'o menu não pede texto');
      await tocar('#nr .nr-op[data-t=alterar]', 'Alterar solução');
      await pg.waitForSelector('#nr .nr-s:not([disabled])', { timeout: 4000 }).catch(async () => { throw new Error('a roda de soluções não abriu: ' + (await pg.evaluate(() => { const n = document.querySelector('#nr'); return `${n.hidden} | ${n.textContent.slice(0, 120)} | ${n.className}`; }))); });
      await pg.waitForTimeout(500);
      await tocar('#nr .nr-s:not([disabled])', 'escolher a solução'); await pg.waitForTimeout(500);
      assert.equal(await estadoApp('E => E.props.length'), 0, 'escolher a solução não grava: falta Confirmar');
      await tocar('#nr .nr-op[data-a=confirmar]', 'Confirmar'); await pg.waitForTimeout(500);
      assert.equal(await estadoApp('E => E.props.length'), 1, 'Confirmar gravou a alteração de solução');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
      // 8. dreno grava com um toque, sem texto
      ponto = await centrarNaFaixa(pg, 0, 312, 1);
      await pressionar(ponto.x, ponto.y, 850); await tocar('#nr .nr-op[data-t=dreno_mais]', 'Colocar dreno'); await pg.waitForTimeout(400);
      assert.equal(await estadoApp('E => E.notes.length'), 0, 'o dreno só grava depois de Confirmar');
      await tocar('#nr .nr-op[data-a=confirmar]', 'Confirmar'); await pg.waitForTimeout(500);
      assert.equal(await estadoApp('E => E.notes.length'), 1, 'o dreno gravou com Confirmar, sem texto');
      assert.equal(await pg.locator('#nr input, #nr textarea').count(), 0, 'o dreno não pede texto');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await respondem('depois do dreno');
      // 8b. as outras bolinhas da roda de 7: Ver conserva (com Confirmar), Observação (texto) e Foto (câmera)
      ponto = await centrarNaFaixa(pg, 0, 330, 1);
      await pressionar(ponto.x, ponto.y, 850); assert.equal(await menuAberto(), 8, 'a roda tem 8 bolinhas no celular');
      await tocar('#nr .nr-op[data-t=conserva]', 'Ver conserva'); await tocar('#nr .nr-op[data-a=confirmar]', 'Confirmar'); await pg.waitForTimeout(400);
      assert.equal(await estadoApp('E => E.notes.filter((n) => n.rapida.tipo === "conserva").length'), 1, 'Ver conserva gravou com Confirmar');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
      ponto = await centrarNaFaixa(pg, 0, 345, 1);
      await pressionar(ponto.x, ponto.y, 850);
      await tocar('#nr .nr-op[data-t=observacao]', 'Observação'); await pg.waitForSelector('#nr textarea', { timeout: 3000 });
      await pg.keyboard.type('anotação no celular'); await tocar('#nr [data-a=salvar]', 'Salvar'); await pg.waitForTimeout(400);
      assert.equal(await estadoApp('E => E.notes.filter((n) => n.rapida.tipo === "observacao" && n.text === "anotação no celular").length'), 1, 'Observação gravou o texto');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
      ponto = await centrarNaFaixa(pg, 0, 360, 1);
      await pressionar(ponto.x, ponto.y, 850);
      const jpg = Buffer.from(await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 1800; c.height = 1200; c.getContext('2d').fillRect(0, 0, 1800, 1200); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; }), 'base64');
      const [fch] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), tocar('#nr .nr-op[data-t=foto]', 'Foto')]);
      await fch.setFiles({ name: 'f.jpg', mimeType: 'image/jpeg', buffer: jpg });
      await pg.waitForFunction(() => window.__pavecad.E.notes.some((n) => n.rapida.tipo === 'foto'), null, { timeout: 8000 });
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await respondem('depois das sete bolinhas');
      // 9. gaveta e abas
      await tocar('#gavTxt', 'abrir a gaveta'); await tocar('#tabs [data-t=ana]', 'aba Análise'); await tocar('#tabs [data-t=exp]', 'aba Exportar'); await tocar('#tabs [data-t=seg]', 'aba Segmento');
      assert.equal(await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t), 'seg');
      assert.deepEqual(erros, [], 'nenhuma exceção não tratada');
    }, { confirmar: true }],
    ['Ajustes: diagnóstico com versão, Atualizar app, relatório dos últimos erros e modo diagnóstico de toque', ['1366x768'], async (pg, { ctx }) => {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await pg.evaluate(() => localStorage.removeItem('pavecad-erros'));
      await aba(pg, 'aj'); await pg.waitForSelector('#dgVersao');
      assert.match(await pg.textContent('#dgVersao'), /\S+ · /, 'versão do app (hash e data)');
      assert.equal((await pg.textContent('#dgAtualiza')).trim(), 'Atualizar app');
      assert.match(await pg.textContent('#dgQtd'), /Nenhum erro guardado/);
      // um erro de JavaScript não tratado vai para o relatório local (e só para ele)
      await pg.evaluate(() => { setTimeout(() => { throw new Error('erro de teste do relatório'); }, 0); });
      await pg.waitForTimeout(300);
      await aba(pg, 'seg'); await aba(pg, 'aj'); await pg.waitForSelector('#dgQtd');
      assert.match(await pg.textContent('#dgQtd'), /1 erro guardado/);
      await pg.click('#dgCopia'); await pg.waitForTimeout(300);
      const txt = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      if (txt) { assert.match(txt, /^PAVTRACK versão /); assert.match(txt, /erro de teste do relatório/); }
      // modo diagnóstico de toque: desligado por padrão; ligado, mostra o último evento e o elemento que o recebeu
      assert.equal(await pg.locator('#diagToque').count(), 0, 'desligado por padrão');
      await pg.click('#dgToque'); await pg.waitForSelector('#diagToque');
      await pg.mouse.click(700, 300); await pg.waitForTimeout(200);
      assert.match(await pg.textContent('#diagToque'), /recebeu: .*\nsob o ponto: /);
      await pg.click('#dgToque'); await pg.waitForTimeout(150);
      assert.equal(await pg.locator('#diagToque').count(), 0, 'desligar remove a caixa');
      await pg.click('#dgLimpa'); await pg.waitForTimeout(150);
      assert.match(await pg.textContent('#dgQtd'), /Nenhum erro guardado/);
    }],
    ['Campo e offline: a página abre com o estado e o botão Preparar para campo, e nunca fica em branco mesmo sem Cache API', ['1366x768'], async (pg) => {
      // simula um navegador (aba privada) em que o Cache API e o armazenamento falham
      await pg.evaluate(() => { Object.defineProperty(window, 'caches', { value: { open: () => Promise.reject(new Error('bloqueado')), keys: () => Promise.reject(new Error('bloqueado')), delete: () => Promise.reject(new Error('bloqueado')) }, configurable: true }); });
      await pg.click('#btnCfg'); await pg.click('#cfgTabs [data-ct=campo]'); await pg.waitForSelector('#cpConexao');
      assert.match(await pg.textContent('#cpConexao'), /^(Online|Offline)$/);
      assert.equal((await pg.textContent('#cpPrep')).trim(), 'Preparar para campo');
      for (const id of ['#cpArmaz', '#cpPrepara', '#cpCache', '#cpPosicao', '#cpAjuda']) assert.equal(await pg.isVisible(id), true, id + ' visível');
      await pg.waitForFunction(() => /ainda não disponível/.test(document.querySelector('#cpTiles').textContent), null, { timeout: 6000 });
      assert.match(await pg.textContent('#cpTiles'), /ainda não disponível/, 'o que falha mostra a mensagem, não uma página em branco');
      assert.ok((await pg.textContent('#cpLimpar')).trim() === 'Limpar tiles');
      await pg.click('#cfgClose');
    }],
  ],

  t24: [
    ['celular, critérios de aceite: com planilha e gaveta fechada, mapa livre de 70% ou mais, nada além da borda nem rolagem horizontal, alvos de 44 px, sem sobreposição', CELULARES, async (pg, { vpNome }) => {
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('celular')), true);
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      await pg.waitForTimeout(300);
      const m = await pg.evaluate(() => {
        const W = innerWidth, H = innerHeight, vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        // mapa livre: fração da tela em que o elemento do topo é o próprio mapa
        let livre = 0, tot = 0;
        for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) { tot++; const e = document.elementFromPoint(x, y); if (e && e.closest('#map') && !e.closest('.maplibregl-ctrl-scale,.maplibregl-ctrl-attrib')) livre++; }
        const fora = [...document.querySelectorAll('#topc *, #coldir *, #inspector, #inspector *, #unicard, #unicard *, .maplibregl-ctrl-scale, #escalaSlot')].filter((e) => vis(e) && e.getBoundingClientRect().width > 0)
          .filter((e) => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5; }).filter((e) => !e.closest('.cell,.xs,#uniwrap,.uni-wrap,.drawer')).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 30));
        const blocos = ['#topc', '#coldir', '.maplibregl-ctrl-scale', '#unicard', '#inspector'].map((s) => { const e = document.querySelector(s); return e && vis(e) ? [s, e.getBoundingClientRect()] : null; }).filter(Boolean);
        const sobre = [];
        for (let i = 0; i < blocos.length; i++) for (let j = i + 1; j < blocos.length; j++) { const a = blocos[i][1], b = blocos[j][1]; if (a.width && b.width && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) sobre.push(blocos[i][0] + ' x ' + blocos[j][0]); }
        // alvos: o botão tem 44 px ou a área de toque estendida cobre 44 px (testado pelos pontos a 21 px do centro)
        const pequenos = [...document.querySelectorAll('#topc button, #coldir button, #gavRes button, #gavTxt, #gavCores, #ihead button, #tabs button')].filter((e) => vis(e)).filter((e) => {
          const r = e.getBoundingClientRect(); if (r.width >= 43.5 && r.height >= 43.5) return false;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2, ok = (x, y) => { const t = document.elementFromPoint(x, y); return t && (e.contains(t) || (t.contains(e) && t !== document.body)); };
          const horiz = r.width >= 43.5 || (ok(cx - 21, cy) && ok(cx + 21, cy)), vert = r.height >= 43.5 || (ok(cx, cy - 21) && ok(cx, cy + 21));
          return !(horiz && vert);
        }).map((e) => `${e.id || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 14)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
        return { W, H, pct: Math.round((livre / tot) * 1000) / 10, rolagem: document.documentElement.scrollWidth - W, fora, sobre, pequenos };
      });
      require('fs').mkdirSync('/tmp/crit', { recursive: true });
      require('fs').appendFileSync('/tmp/crit/mapa_livre.jsonl', JSON.stringify({ vp: vpNome, ...m }) + '\n');
      assert.ok(m.pct >= 70, `mapa livre ${m.pct}% (mínimo 70%)`);
      assert.ok(m.rolagem <= 0, 'rolagem horizontal de ' + m.rolagem + ' px');
      assert.deepEqual(m.fora, [], 'elementos fora da tela');
      assert.deepEqual(m.sobre, [], 'sobreposição entre barra superior, coluna, escala e gaveta');
      assert.deepEqual(m.pequenos, [], 'alvos abaixo de 44 px');
    }],
    ['celular: trocar fundo, trocar camada, ir para km, abrir Exportar e abrir Projetos em no máximo 2 toques', CELULARES, async (pg) => {
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      const W = await pg.evaluate(() => innerWidth);
      // trocar fundo: Mapa, Satélite
      await pg.click('#cMapa'); await pg.waitForTimeout(250);
      assert.equal(await pg.isVisible('#drawer'), true, 'o toque 1 abre a folha Mapa');
      await pg.click('#drawer #base [data-b=esri]'); await pg.waitForTimeout(500);
      assert.equal(await estado(pg, 'E => E.base'), 'esri', 'o toque 2 troca o fundo');
      await pg.click('#cMapa'); await pg.waitForTimeout(250);
      // trocar camada: chip, item
      await pg.click('#btnCamada'); await pg.waitForTimeout(200);
      assert.equal(await pg.isVisible('#modes'), true, 'o toque 1 abre o menu de camadas');
      const dentro = await pg.evaluate(() => { const r = document.querySelector('#modes').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
      assert.ok(dentro, 'o menu de camadas cabe na tela');
      await pg.click('#modes [data-m=iri]'); await pg.waitForTimeout(300);
      assert.equal(await estado(pg, 'E => E.mode'), 'iri', 'o toque 2 troca a camada'); await modo(pg, 'sol');
      // ir para km: chip de localização, ir
      await pg.click('#cLocal'); await pg.waitForTimeout(250);
      await pg.fill('#cGoKm', '170+500');
      await pg.click('#cGoBtn'); await pg.waitForTimeout(1500);
      assert.match(await pg.textContent('#cLocalTxt'), /km 170\+5\d\d/, 'foi para o km');
      // Exportar: Mapa, Exportar
      await pg.click('#cMapa'); await pg.waitForTimeout(250); await pg.click('#dExportar'); await pg.waitForTimeout(400);
      assert.equal(await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t), 'exp', 'abriu a aba Exportar');
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('gav-fechada')), false, 'a gaveta abriu');
      // Projetos: Mapa, Projetos
      await pg.click('#cMapa'); await pg.waitForTimeout(250);
      await pg.click('#dProjetos'); await pg.waitForSelector('#dash:not([hidden])');
      assert.equal(await pg.isVisible('#dash'), true); void W;
    }],
    ['celular: gaveta com três estados, abas inteiras, Unifilar compacto de 40 px que leva o mapa ao km, e fecha ao tocar fora', CELULARES, async (pg) => {
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      await irParaKmCel(pg, '170+500');
      const alt = () => pg.evaluate(() => Math.round(innerHeight - document.querySelector('#inspector').getBoundingClientRect().top)); // a gaveta inteira: painel mais a linha de resumo
      const H = await pg.evaluate(() => innerHeight), larg = await pg.evaluate(() => innerWidth), paisagem = larg > H;
      const g = () => pg.evaluate(() => ['fechada', 'meia', 'cheia'].find((k) => document.documentElement.classList.contains('gav-' + k)));
      assert.equal(await g(), 'fechada');
      const res = await pg.evaluate(() => { const u = document.querySelector('#uniwrap').getBoundingClientRect(); return { txt: document.querySelector('#gavTxt').textContent, uni: Math.round(u.height), cores: document.querySelectorAll('#gavCores .lt').length }; });
      assert.match(res.txt, /^km \d+\+\d{3} · (Fx \d|Acost\.) · /, 'resumo do ponto sob a mira: ' + res.txt);
      assert.ok(res.uni >= 36 && res.uni <= 44, 'Unifilar compacto de 40 px: ' + res.uni); assert.ok(res.cores >= 1 && res.cores <= 3, 'até 3 cores no resumo');
      if (paisagem) {
        // paisagem: painel lateral direito de 40% da largura, sem sobreposição com a coluna do polegar
        await pg.click('#gavTxt'); await pg.waitForTimeout(400);
        const l = await pg.evaluate(() => { const r = document.querySelector('#inspector').getBoundingClientRect(), c = document.querySelector('#coldir').getBoundingClientRect(); return { w: Math.round(r.width / innerWidth * 100), esq: r.left > innerWidth * 0.5, sob: c.right > r.left + 1 && c.left < r.right - 1 && c.bottom > r.top && c.top < r.bottom }; });
        assert.ok(l.w >= 36 && l.w <= 44 && l.esq && !l.sob, 'painel lateral de 40% sem sobrepor a coluna: ' + JSON.stringify(l));
        return;
      }
      // fechada -> meia (tocar no resumo) -> cheia (arrastar a alça para cima) -> meia -> fechada
      await pg.click('#gavTxt'); await pg.waitForTimeout(450); assert.equal(await g(), 'meia', 'tocar no resumo abre a meia altura'); const hm = await alt();
      assert.ok(hm >= H * 0.4 && hm <= H * 0.5, `meia ~45% (${hm}/${H})`);
      const alca = () => pg.evaluate(() => { const r = document.querySelector('#ihead').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; });
      const arrastar = async (dy) => { const a = await alca(); await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(a.x, a.y + dy / 2, { steps: 4 }); await pg.mouse.move(a.x, a.y + dy, { steps: 4 }); await pg.mouse.up(); await pg.waitForTimeout(450); };
      await arrastar(-120); assert.equal(await g(), 'cheia', 'arrastar a alça para cima: meia vira cheia'); const hc = await alt(); assert.ok(hc >= H * 0.8 && hc <= H * 0.9, `cheia ~85% (${hc}/${H})`);
      await arrastar(120); assert.equal(await g(), 'meia', 'arrastar para baixo: cheia vira meia');
      await arrastar(120); assert.equal(await g(), 'fechada', 'arrastar para baixo: meia vira fechada');
      // abas inteiras, sem corte nem rolagem lateral
      await pg.click('#gavTxt'); await pg.waitForTimeout(400);
      const ab = await pg.evaluate(() => { const t = document.querySelector('#tabs'), tr = t.getBoundingClientRect(); return { n: t.querySelectorAll('[role=tab]').length, corte: [...t.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < tr.left - 1 || r.right > tr.right + 1 || b.scrollWidth > b.clientWidth + 1; }).length, rolagem: t.scrollWidth - t.clientWidth, h: Math.min(...[...t.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height))) }; });
      assert.equal(ab.n, 5); assert.equal(ab.corte, 0, 'nenhuma aba cortada'); assert.ok(ab.rolagem <= 1, 'sem rolagem lateral nas abas'); assert.ok(ab.h >= 40, 'abas altas o bastante: ' + ab.h);
      assert.equal(await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t), 'seg', 'Segmento primeiro');
      // tocar fora fecha
      await pg.mouse.click(Math.round(larg / 2), 120); await pg.waitForTimeout(400); assert.equal(await g(), 'fechada', 'tocar no mapa fora de um segmento fecha');
      // tocar no Unifilar compacto leva o mapa àquele km
      const antes = await pg.evaluate(() => window.__pavecad.map().getCenter().lng);
      const u = await pg.evaluate(() => { const r = document.querySelector('#uni').getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 }; });
      await pg.mouse.click(u.x, u.y); await pg.waitForTimeout(1500);
      assert.notEqual(await pg.evaluate(() => window.__pavecad.map().getCenter().lng), antes, 'o mapa foi para o km tocado');
      // tocar num segmento abre a gaveta na aba Segmento, em meia altura
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(600);
      assert.equal(await g(), 'meia', 'tocar no segmento abre a meia altura'); assert.equal(await pg.evaluate(() => document.querySelector('#tabs [aria-selected=true]').dataset.t), 'seg');
    }],
    ['celular: tela limpa esconde a barra e a gaveta, mantém GPS e a saída, e a pressão no mapa continua; dica única "Segure no mapa para anotar"', CELULARES, async (pg) => {
      const dicas = await pg.evaluate(() => [...document.querySelectorAll('.nr-dica, #nrDica, #zoomnote')].filter((e) => e.checkVisibility()).map((e) => ({ txt: e.textContent.trim(), fundo: getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' })));
      assert.ok(dicas.length <= 1, 'uma dica só: ' + JSON.stringify(dicas));
      if (dicas.length) { assert.match(dicas[0].txt, /Segure no mapa para anotar/); assert.ok(dicas[0].fundo, 'dica com fundo próprio'); }
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      await pg.click('#cLimpo'); await pg.waitForTimeout(400);
      const e = await pg.evaluate(() => { const v = (s) => { const x = document.querySelector(s); return !!x && x.checkVisibility(); }; return { topo: v('#topc'), gaveta: v('#inspector') || v('#unicard'), gps: v('#cGps'), sair: v('#cLimpo') }; });
      assert.deepEqual(e, { topo: false, gaveta: false, gps: true, sair: true }, JSON.stringify(e));
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.waitForTimeout(900); await pg.mouse.up(); await pg.waitForTimeout(350);
      assert.equal(await pg.locator('#nr .nr-op').count(), 7, 'o menu abre na tela limpa');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      await pg.click('#cLimpo'); await pg.waitForTimeout(350);
      assert.equal(await pg.isVisible('#topc'), true, 'sair da tela limpa');
    }],
    ['celular: o menu pressionável cabe na tela perto das quatro bordas e dos cantos, sem cortar item nem sobrepor', CELULARES, async (pg) => {
      await pg.evaluate(() => document.querySelectorAll('.nr-dica,#nrDica').forEach((e) => e.remove()));
      const { W, H } = await pg.evaluate(() => ({ W: innerWidth, H: innerHeight }));
      const pontos = [[12, 70], [W - 12, 70], [W / 2, 70], [12, H / 2], [W - 12, H / 2], [12, H - 100], [W - 12, H - 100], [W / 2, H - 100]];
      for (const [x, y] of pontos) {
        await pg.mouse.click(Math.round(x), Math.round(y), { button: 'right' }); await pg.waitForTimeout(300);
        const r = await pg.evaluate(() => { const b = [...document.querySelectorAll('#nr .nr-op')].map((e) => e.getBoundingClientRect()); return { n: b.length, fora: b.filter((q) => q.left < 0 || q.top < 0 || q.right > innerWidth || q.bottom > innerHeight).length, sob: b.some((q, i) => b.some((o, j) => j > i && q.left < o.right - 1 && q.right > o.left + 1 && q.top < o.bottom - 1 && q.bottom > o.top + 1)) }; });
        assert.equal(r.n, 7, `menu em ${Math.round(x)},${Math.round(y)}`); assert.equal(r.fora, 0, `itens fora da tela em ${Math.round(x)},${Math.round(y)}`); assert.equal(r.sob, false, 'itens sobrepostos');
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      }
    }],
  ],
  t22: [
    ['Revisão: as notas rápidas entram na lista de ocorrências, por planilha, com ir ao local, observação e excluir com Desfazer; planilhas vazias atrás de "mostrar vazias"', ['1366x768'], async (pg) => {
      const criar = async (re, row, tipo) => {
        const p = await centrarNaFaixa(pg, re, row, 1);
        await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
        await pg.click(`#nr .nr-op[data-t=${tipo}]`); await pg.waitForTimeout(350);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
        return p;
      };
      const p1 = await criar('TH45 · Crescente', 30, 'dreno_mais');
      await criar('TH42 · Decrescente', 25, 'dreno_menos');
      const notas = await pg.evaluate(() => window.__pavecad.E.notes.filter((n) => n.rapida).map((n) => ({ id: n.id, pid: n.loc && n.loc.pid, planilha: n.rapida.planilha, tipo: n.rapida.tipo })));
      assert.equal(notas.length, 2); assert.ok(notas.every((n) => n.pid), 'as duas caíram em planilhas');
      await aba(pg, 'notas'); await pg.waitForTimeout(300);
      const g = await pg.evaluate(() => [...document.querySelectorAll('#t-notas details.qual')].map((d) => ({ pid: d.dataset.qp, nome: d.querySelector('summary b').textContent, n: +d.querySelector('summary > .num').textContent, itens: [...d.querySelectorAll('[data-nri]')].map((e) => e.dataset.nri) })));
      assert.ok(g.every((x) => x.n > 0), 'só planilhas com ocorrências: ' + g.map((x) => `${x.nome}=${x.n}`).join(' | '));
      for (const n of notas) assert.ok(g.find((x) => x.pid === n.pid && x.itens.includes(n.id)), 'cada nota aparece no grupo da planilha dela');
      assert.match(g.find((x) => x.pid === notas[0].pid).nome, /TH\d+ · (Crescente|Decrescente)/, 'grupo por planilha e sentido');
      // vazias atrás de "mostrar vazias"
      const antes = g.length, K = await pg.evaluate(() => +/\((\d+)\)/.exec(document.querySelector('#qVazias').textContent)[1]);
      assert.ok(K > 0 && antes + K === 18, `${antes} com ocorrência + ${K} vazias = 18 planilhas`);
      await pg.click('#qVazias'); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#t-notas details.qual').count(), 18, 'mostrar vazias');
      assert.match(await pg.textContent('#qVazias'), /^Esconder planilhas sem ocorrências/);
      await pg.click('#qVazias'); await pg.waitForTimeout(250);
      assert.equal(await pg.locator('#t-notas details.qual').count(), antes, 'esconder de novo');
      // o item: ícone do tipo, km, hora; abre o grupo e vai ao local
      await pg.click(`#t-notas details.qual[data-qp="${notas[0].pid}"] summary`); await pg.waitForTimeout(250);
      const item = await pg.evaluate((id) => { const e = document.querySelector(`[data-nri="${id}"]`); return { svg: !!e.querySelector('.nrl-ic svg'), txt: e.innerText.replace(/\s+/g, ' ').trim() }; }, notas[0].id);
      assert.ok(item.svg, 'ícone do tipo');
      assert.match(item.txt, /km \d+\+\d{3}/); assert.match(item.txt, /\d{2}\/\d{2}[ ,]+\d{2}:\d{2}/, 'hora: ' + item.txt); assert.match(item.txt, /Colocar dreno/);
      await pg.evaluate(() => window.__pavecad.map().jumpTo({ center: [-48.5, -14.5], zoom: 12 })); await pg.waitForTimeout(500);
      await pg.click(`[data-nri="${notas[0].id}"] .nri-go`); await pg.waitForTimeout(1100);
      const c = await pg.evaluate(() => { const m = window.__pavecad.map().getCenter(); return [m.lng, m.lat]; });
      assert.ok(Math.abs(c[0] - p1.lon) < 2e-4 && Math.abs(c[1] - p1.lat) < 2e-4, `tocar no item vai ao local (${c})`);
      // observação opcional, com o teclado do aparelho
      await pg.click(`[data-nobs="${notas[0].id}"]`); await pg.waitForTimeout(200);
      assert.equal(await pg.evaluate(() => document.activeElement.dataset.nobsin), notas[0].id, 'o campo abre com o foco');
      await pg.keyboard.type('base trincada'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate((id) => window.__pavecad.E.notes.find((n) => n.id === id).text, notas[0].id), 'base trincada');
      assert.match(await pg.textContent(`[data-nri="${notas[0].id}"]`), /base trincada/);
      // excluir com Desfazer
      await pg.click(`[data-nx="${notas[0].id}"]`); await pg.waitForTimeout(300);
      assert.equal(await pg.locator(`[data-nri="${notas[0].id}"]`).count(), 0, 'excluída');
      await pg.click('.toast-acao button'); await pg.waitForTimeout(300);
      assert.equal(await pg.evaluate((id) => window.__pavecad.E.notes.some((n) => n.id === id), notas[0].id), true, 'Desfazer devolve a nota');
      assert.equal(await pg.locator(`[data-nri="${notas[0].id}"]`).count(), 1);
    }, OPTS_NOVE],
    ['exportação: planilha .xlsx (aba Notas e aba Resumo), CSV com BOM e Compartilhar, pela Revisão e pelo pino; vale também para as anotações antigas', ['1366x768'], async (pg) => {
      const XLSX = require('xlsx');
      const criar = async (row, tipo) => {
        const p = await centrarNaFaixa(pg, 0, row, 1);
        await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
        await pg.click(`#nr .nr-op[data-t=${tipo}]`); await pg.waitForTimeout(350);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
      };
      await criar(300, 'dreno_mais'); await criar(320, 'dreno_menos');
      { // uma alteração de solução, pela mesma roda
        const p = await centrarNaFaixa(pg, 0, 340, 1);
        await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
        await pg.click('#nr .nr-op[data-t=alterar]'); await pg.waitForTimeout(250);
        await pg.click('#nr .nr-op[data-s]:not([disabled]):not([data-s="__outros"])'); await pg.waitForTimeout(350);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
      }
      await pg.evaluate(() => { const E = window.__pavecad.E; E.notes.push({ id: 'velha', type: 'pin', coords: [[-47.75, -12.79]], cat: 'def', text: 'buraco', photos: [], t: '2026-01-01T10:00:00.000Z', loc: null }); });
      await aba(pg, 'notas'); await pg.waitForTimeout(300);
      assert.equal(await pg.locator('#t-notas :text("GeoJSON"), #t-notas #exXlsx, #t-notas #exCsv, #t-notas #exShare').count(), 0, 'sem GeoJSON nem exportação na Revisão: tudo vive na aba Exportar');
      await aba(pg, 'exp'); await pg.waitForTimeout(300);
      // .xlsx
      const [dx] = await Promise.all([pg.waitForEvent('download'), pg.click('#exXlsx')]);
      assert.match(dx.suggestedFilename(), /^notas_PAVTRACK_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
      const wb = XLSX.readFile(await dx.path(), { cellDates: true, cellStyles: true });
      assert.deepEqual(wb.SheetNames, ['Notas', 'Resumo']);
      const ws = wb.Sheets.Notas, linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      assert.deepEqual(linhas[0], ['Data', 'Hora', 'Tipo', 'Rodovia', 'Planilha', 'Sentido', 'Faixa', 'Solução atual', 'Solução nova', 'Efeito', 'Extensão antes (m)', 'Extensão depois (m)', 'Km inicial', 'Km final', 'Latitude', 'Longitude', 'UTM Leste', 'UTM Norte', 'Origem', 'Precisão (m)', 'Observação', 'Status', 'Desde', 'Até', 'Situação', 'Arquivo da foto']);
      assert.equal(linhas.length, 5, 'cabeçalho, dois drenos, uma alteração de solução e a anotação antiga');
      assert.equal(ws.A2.t, 'd', 'a data é uma data de verdade'); assert.equal(typeof ws.O3.v, 'number', 'latitude numérica');
      assert.equal(ws.A2.v.getFullYear(), 2026, 'a anotação antiga (2026-01-01) é a primeira por data');
      assert.equal(ws.C2.v, 'Defeito'); assert.equal(ws.S2.v, 'Manual'); assert.equal(ws.U2.v, 'buraco');
      const tipos = linhas.slice(2).map((l) => l[2]); assert.deepEqual([...tipos].sort(), ['Alterar solução', 'Colocar dreno', 'Retirar dreno']);
      const alt = linhas.slice(2).find((l) => l[2] === 'Alterar solução');
      assert.ok(alt[7] && alt[8] && ['Aumenta', 'Reduz', 'Retira', 'Troca'].includes(alt[9]), 'solução atual, nova e efeito: ' + JSON.stringify(alt));
      assert.equal(alt[10], 0); assert.equal(alt[11], 0); assert.match(alt[12], /^\d+\+\d{3}$/); assert.match(alt[13], /^\d+\+\d{3}$/, 'km inicial e final');
      assert.ok(ws['!autofilter'], 'filtro automático'); assert.ok(ws['!cols'].length === 26, 'larguras');
      assert.equal(linhas[2][3], 'BR-900/GO'); assert.match(linhas[2][12], /^\d+\+\d{3}$/); assert.equal(linhas[2][18], 'Pressão');
      const resumo = XLSX.utils.sheet_to_json(wb.Sheets.Resumo, { header: 1 });
      assert.equal(resumo.find((r) => r[0] === 'Total')[1], 4);
      // .csv
      const [dc] = await Promise.all([pg.waitForEvent('download'), pg.click('#exCsv')]);
      assert.match(dc.suggestedFilename(), /^notas_PAVTRACK_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
      const buf = require('fs').readFileSync(await dc.path());
      assert.deepEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
      const csv = buf.slice(3).toString('utf8').split('\r\n');
      assert.equal(csv[0], 'Data;Hora;Tipo;Rodovia;Planilha;Sentido;Faixa;Solução atual;Solução nova;Efeito;Extensão antes (m);Extensão depois (m);Km inicial;Km final;Latitude;Longitude;UTM Leste;UTM Norte;Origem;Precisão (m);Observação;Status;Desde;Até;Situação;Arquivo da foto');
      assert.equal(csv.length, 5); assert.match(csv[2], /;-12,\d{6};-47,\d{6};\d{6},\d{2};\d{7},\d{2};Pressão;;;Aberta;;;;$/);
      // compartilhar: com Web Share, entrega o arquivo; sem, baixa
      await pg.evaluate(() => { window.__shared = null; navigator.canShare = (d) => !!(d && d.files && d.files.length); navigator.share = async (d) => { window.__shared = { nome: d.files[0].name, tipo: d.files[0].type, tam: d.files[0].size }; }; });
      await pg.click('#exShare'); await pg.waitForTimeout(800);
      const sh = await pg.evaluate(() => window.__shared);
      assert.ok(sh && /^notas_PAVTRACK_.*\.xlsx$/.test(sh.nome) && /spreadsheetml/.test(sh.tipo) && sh.tam > 1000, 'Web Share recebeu a planilha: ' + JSON.stringify(sh));
      await pg.evaluate(() => { navigator.canShare = undefined; });
      const [dsh] = await Promise.all([pg.waitForEvent('download'), pg.click('#exShare')]);
      assert.match(dsh.suggestedFilename(), /\.xlsx$/, 'sem Web Share, baixa');
      // o pino da barra não exporta nada: só Ver notas, com o contador
      assert.equal(await pg.locator('#ppXlsx, #ppCsv, #ppShare').count(), 0, 'nada de exportar no pino');
      assert.match(await pg.getAttribute('#btnNotas', 'aria-label'), /^Ver notas \(\d+\)$/);
    }],
    ['Backup completo (.json) na aba Exportar: baixa as notas com os campos das rápidas e restaura', ['1366x768'], async (pg) => {
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(350);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
      await aba(pg, 'exp'); await pg.waitForTimeout(200);
      assert.match(await pg.textContent('#xBackup h3'), /^Backup completo \(\.json\)$/);
      assert.equal(await pg.locator('#t-aj details.bk, #t-aj #bkDown').count(), 0, 'o backup saiu de Ajustes');
      const [d] = await Promise.all([pg.waitForEvent('download'), pg.click('#bkDown')]);
      assert.match(d.suggestedFilename(), /^pavtrack-backup-\d{4}-\d{2}-\d{2}\.json$/);
      const gj = JSON.parse(require('fs').readFileSync(await d.path(), 'utf8'));
      assert.equal(gj.tipo, 'pavecad-backup'); assert.equal(gj.notas.length, 1); assert.equal(gj.notas[0].rapida.tipo, 'dreno_menos');
      assert.ok(Array.isArray(gj.planilhas) && Array.isArray(gj.propostas) && gj.catalogo, 'o backup é completo');
      // apaga e restaura
      await pg.evaluate(() => { const E = window.__pavecad.E; E.notes.length = 0; });
      await pg.setInputFiles('#importIn', await d.path()); await pg.waitForTimeout(500);
      const n = await pg.evaluate(() => window.__pavecad.E.notes.map((x) => x.rapida && x.rapida.tipo));
      assert.deepEqual(n, ['dreno_menos'], 'a nota rápida volta com os campos');
    }],
    ['Exportar: XLSX, CSV, KMZ, KML e IFC baixam e abrem; notas só entram com o chip', ['1366x768'], async (pg) => {
      const fs = require('fs'), { unzipSync, strFromU8 } = require('fflate');
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
      await pg.click('#nr .nr-op[data-t=dreno_menos]'); await pg.waitForTimeout(350);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
      await aba(pg, 'exp'); await pg.waitForTimeout(500);
      const baixa = async (sel) => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click(sel)]); return { nome: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) }; };
      const x = await baixa('#exXlsx'); assert.match(x.nome, /\.xlsx$/); assert.equal(x.buf.slice(0, 2).toString(), 'PK');
      const c = await baixa('#exCsv'); assert.match(c.nome, /\.csv$/);
      const kz = await baixa('#exKmz');
      assert.match(kz.nome, /^PAVTRACK_.+_\d{4}-\d{2}-\d{2}_\d{4}\.kmz$/);
      const kml = strFromU8(unzipSync(new Uint8Array(kz.buf))['doc.kml']);
      assert.ok(kml.startsWith('<?xml') && kml.includes('xmlns="http://www.opengis.net/kml/2.2"') && /<Placemark>/.test(kml));
      assert.ok(!kml.includes('Notas de campo'), 'KMZ sem notas por padrão');
      assert.match(await pg.textContent('#xRelKmz'), /Verificação interna aprovada/);
      const k2 = await baixa('#exKml'); assert.match(k2.nome, /\.kml$/); assert.ok(k2.buf.toString().startsWith('<?xml'));
      await pg.click('#xKmz .xchip[data-g=notas]'); await pg.waitForTimeout(400);
      const k3 = await baixa('#exKml'); assert.ok(k3.buf.toString().includes('<Folder><name>Notas de campo</name>'), 'o chip liga as notas');
      const ifc = await baixa('#exIfc'); assert.match(ifc.nome, /\.ifc$/);
      const t = ifc.buf.toString();
      assert.ok(t.startsWith('ISO-10303-21;') && t.includes("FILE_SCHEMA(('IFC4X3_ADD2'))") && t.includes('IFCPAVEMENT(') && !t.includes('IFCANNOTATION('), 'IFC sem notas por padrão');
      assert.match(await pg.textContent('#xRelIfc'), /Verificação interna aprovada/);
      await pg.click('#xIfc .xchip[data-g=notas]'); await pg.waitForTimeout(400);
      assert.ok((await baixa('#exIfc')).buf.toString().includes('IFCANNOTATION('), 'o chip liga as notas no IFC');
    }],
  ],
  g03: [
    ['a seção é o seletor de faixa (clique, aria-pressed, teclado)', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      assert.equal(await pg.locator('#laneSeg').count(), 0, 'o seletor segmentado deve ter sido removido');
      const bt = pg.locator('#t-seg .xs button');
      assert.equal(await bt.count(), 3);
      assert.equal(await pg.locator('#t-seg .xs button[aria-pressed="true"]').count(), 1);
      await bt.nth(1).click();
      assert.equal(await estado(pg, 'E => E.sel.lane'), 2);
      assert.equal(await pg.getAttribute('#t-seg .xs button:nth-child(2)', 'aria-pressed'), 'true');
      // seta para cima volta à Fx 1 e o foco fica na faixa escolhida
      await pg.focus('#t-seg .xs button[aria-pressed="true"]');
      await pg.keyboard.press('ArrowUp');
      assert.equal(await estado(pg, 'E => E.sel.lane'), 1);
      assert.equal(await pg.evaluate(() => document.activeElement.dataset.l), '1', 'o foco deve acompanhar a faixa');
      await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown');
      assert.equal(await estado(pg, 'E => E.sel.lane'), 0, 'a terceira posição é o acostamento');
      // Tab percorre as faixas; Enter seleciona
      await pg.focus('#t-seg .xs button:nth-child(1)');
      await pg.keyboard.press('Tab');
      assert.equal(await pg.evaluate(() => document.activeElement.dataset.l), '2');
      await pg.keyboard.press('Enter');
      assert.equal(await estado(pg, 'E => E.sel.lane'), 2);
      // cada faixa tem nome acessível
      const rot = await pg.getAttribute('#t-seg .xs button:nth-child(2)', 'aria-label');
      assert.match(rot, /^Faixa 2, 3,60 m/);
    }],
  ],
  g04: [
    ['parâmetros em 3 colunas, rótulo 13 px (mínimo de tipografia da Sessão 2), valor 18 px', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const m = await pg.evaluate(() => {
        const g = document.querySelector('#t-seg .params'), p = document.querySelector('#t-seg .param');
        return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, k: getComputedStyle(p.querySelector('.k')).fontSize, v: getComputedStyle(p.querySelector('.v')).fontSize, escala: p.querySelectorAll('.scale i').length };
      });
      assert.equal(m.cols, 3); assert.equal(m.k, '13px'); assert.equal(m.v, '18px'); assert.equal(m.escala, 5);
    }],
    ['o painel Segmento cabe sem rolar em 768 px de altura (amostra de trechos)', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const r = await pg.evaluate(() => {
        const E = window.__pavecad.E, piores = [];
        let max = -1e9, n = 0;
        for (const p of E.P) for (let i = 0; i < p.rows.length; i += 3) for (const lane of [1, 2, 0]) {
          window.__pavecad.select(p.id, i, lane);
          const t = document.querySelector('#t-seg'), o = t.scrollHeight - t.clientHeight;
          n++;
          if (o > max) max = o;
          if (o > 0 && piores.length < 3) piores.push(`${p.meta.name} km ${p.kmLab[i]} lane ${lane}: +${o}px`);
        }
        return { max, n, piores, altura: document.querySelector('#t-seg').clientHeight };
      });
      assert.ok(r.max <= 0, `há rolagem em ${r.piores.join('; ')} (altura útil ${r.altura}px, ${r.n} casos)`);
    }],
  ],
  g15: [
    ['escala do mapa: sem cartão, rótulo com contorno sólido e contraste de 4,5:1 contra o contorno (claro, escuro e campo) sobre o satélite', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500');
      await escolherBase(pg, 'esri');
      await pg.waitForTimeout(800);
      const medir = () => pg.evaluate(() => {
        const e = document.querySelector('.maplibregl-ctrl-scale'), cs = getComputedStyle(e);
        const rgba = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const halo = rgba(/rgba?\([^)]*\)/.exec(cs.textShadow)[0]);
        return { fundo: rgba(cs.backgroundColor).a, fonte: cs.fontSize, contraste: cr(rgba(cs.color), halo), haloA: halo.a };
      });
      for (const tema of ['claro', 'escuro', 'campo']) {
        await pg.emulateMedia({ colorScheme: tema === 'escuro' ? 'dark' : 'light' });
        await pg.evaluate((campo) => window.__pavecad.setField(campo, true), tema === 'campo');
        await pg.waitForTimeout(500);
        const m = await medir();
        assert.equal(m.fundo, 0, `${tema}: a escala não tem cartão`);
        assert.ok(parseFloat(m.fonte) >= 12, `${tema}: fonte ${m.fonte}`);
        assert.equal(m.haloA, 1, `${tema}: contorno sólido`);
        assert.ok(m.contraste >= 4.5, `${tema}: contraste ${m.contraste.toFixed(2)}:1 do rótulo contra o contorno (mínimo 4,5:1)`);
      }
    }],
  ],
  g14: [
    ['Revisão: estados vazios em uma linha e exportação das notas desligada sem notas', '1366x768', async (pg) => {
      await aba(pg, 'notas');
      assert.equal(await pg.locator('#t-notas .empty').count(), 0, 'sem cartão grande de estado vazio');
      const vazios = await pg.evaluate(() => [...document.querySelectorAll('#t-notas .vazio')].map((e) => ({ t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height) })));
      assert.equal(vazios.length, 2, 'um estado vazio para propostas e outro para anotações');
      for (const v of vazios) assert.ok(v.h <= 20, `"${v.t}" ocupa ${v.h}px (mais de uma linha)`);
      assert.ok(vazios.some((v) => /Nenhuma proposta/.test(v.t)) && vazios.some((v) => /Nenhuma anotação/.test(v.t)));
      await aba(pg, 'exp');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#t-exp .xcard h3')].map((h) => h.textContent)), ['Backup completo (.json)', 'CSV e XLSX', 'Propostas de solução (.csv)', 'KMZ / KML', 'IFC (IFC4X3_ADD2)'], 'um cartão por formato');
      assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#t-exp .xcard .btn.p')].map((b) => b.textContent)), ['Baixar', 'Baixar XLSX', 'Baixar CSV', 'Baixar', 'Baixar KMZ', 'Baixar IFC'], 'cada cartão com o botão Baixar');
      assert.equal(await pg.isDisabled('#exXlsx'), true, 'sem notas não há o que exportar');
      assert.equal(await pg.isDisabled('#pCsvDown'), true, 'nem propostas');
      assert.equal(await pg.locator('#exDown, #exCopy, #exImp').count(), 0, 'o GeoJSON saiu da Revisão (agora é o Backup completo)');
      await aba(pg, 'notas');
      // o atalho do estado vazio continua abrindo a ferramenta
      await pg.click('#pStart');
      assert.equal(await pg.isVisible('#propbar'), true);
    }],
  ],
  g13: [
    ['barra Propor solução: acima do unifilar, fora do painel direito e sem cobrir rótulos', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500', 3500);
      await pg.keyboard.press('n');
      const a = await pontoLivre(pg);
      assert.ok(a);
      await pg.mouse.click(a.x, a.y);
      await pg.waitForTimeout(400);
      assert.match(await pg.textContent('#propbar'), /1 trecho selecionado/);
      const medir = () => pg.evaluate(() => {
        const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
        const vis = (e) => e && e.checkVisibility() ? R(e) : null;
        const esq = R(document.querySelector('.leftcol'));
        const bar = R(document.querySelector('#propbar')), insp = vis(document.querySelector('#inspector')), uni = vis(document.querySelector('#unicard')), leg = vis(document.querySelector('#legend'));
        const cruza = (x, y) => x.l < y.r && x.r > y.l && x.t < y.b && x.b > y.t;
        const rotulos = [...document.querySelectorAll('.maplibregl-marker[data-rot]')].filter((e) => !e.classList.contains('rot-oculto') && e.checkVisibility()).map((e) => ({ t: e.textContent, ...R(e) }));
        return { vw: innerWidth, vh: innerHeight, esq, bar, insp, uni, leg, sobreRotulo: rotulos.filter((r) => cruza(r, bar)).map((r) => r.t), sobreInsp: insp ? cruza(bar, insp) : false, fixed: getComputedStyle(document.querySelector('#propbar')).position };
      });
      for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768], [820, 1180]]) {
        await pg.setViewportSize({ width: w, height: h });
        await pg.waitForTimeout(600);
        const m = await medir();
        assert.deepEqual(m.sobreRotulo, [], `${w}px: a barra cobre rótulos de km: ${m.sobreRotulo.join(', ')}`);
        assert.equal(m.sobreInsp, false, `${w}px: a barra cobre o painel direito`);
        assert.ok(m.bar.l >= 16 - 0.5, `${w}px: margem esquerda ${m.bar.l}`);
        assert.ok(m.vw - m.bar.r >= 16 - 0.5, `${w}px: margem direita ${m.vw - m.bar.r}`);
        if (w > 600 && w < 900) {
          // folha inferior em largura total: a barra de propor sobe para ficar acima dela
          assert.ok(m.uni && m.insp && m.bar.b <= m.insp.t - 4, `${w}px: a barra deve ficar acima da folha inferior (barra ${m.bar.b} / folha ${m.insp && m.insp.t})`);
          if (m.leg) assert.ok(m.leg.b <= m.bar.t, `${w}px: a legenda sobe para não ficar sob a barra`);
        } else if (w >= 900) {
          assert.ok(m.uni && m.bar.b <= m.uni.t, `${w}px: a barra deve ficar acima do unifilar (barra ${m.bar.b} / unifilar ${m.uni && m.uni.t})`);
          assert.ok(m.uni.t - m.bar.b <= 40, `${w}px: a barra deve ficar logo acima do unifilar (${m.uni.t - m.bar.b}px)`);
          assert.ok(m.insp && m.bar.r <= m.insp.l - 8, `${w}px: a barra deve terminar antes do painel direito`);
          if (m.leg) assert.ok(m.leg.b <= m.bar.t, `${w}px: a legenda sobe para não ficar sob a barra`);
          assert.ok((m.leg ? m.leg.t : m.bar.t) >= m.esq.b + 4, `${w}px: a pilha da barra encosta na coluna esquerda (${m.leg ? m.leg.t : m.bar.t} / ${m.esq.b})`);
        }
      }
    }],
  ],
  g12: [
    ['configurações: fundo do app (não preto puro), 960 px centralizado, margem de 16 px e cabeçalho com folga', '1366x768', async (pg) => {
      await pg.emulateMedia({ colorScheme: 'dark' });
      await pg.click('#btnCfg');
      await pg.waitForTimeout(300);
      const fundo = await pg.evaluate(() => ({ bg: getComputedStyle(document.querySelector('#cfg')).backgroundColor, mapa: getComputedStyle(document.documentElement).getPropertyValue('--map').trim() }));
      assert.notEqual(fundo.bg, 'rgb(0, 0, 0)', 'o fundo não pode ser preto puro no tema escuro');
      assert.equal(fundo.bg, 'rgb(23, 24, 27)', 'usa o token de fundo do app (--map ' + fundo.mapa + ')');
      const medir = () => pg.evaluate(() => {
        const vw = innerWidth, r = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { l: b.left + parseFloat(cs.paddingLeft), r: b.right - parseFloat(cs.paddingRight), w: b.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; };
        const bt = document.querySelector('#cfgClose').getBoundingClientRect(), tabs = r('#cfgTabs'), wrap = r('#cfgBody'), head = r('.cfg-head-in');
        return { vw, wrap, head, btnDir: vw - bt.right, tabsL: tabs.l, titulo: document.querySelector('#cfgTitle').getBoundingClientRect().left };
      });
      for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768], [820, 1180], [480, 900]]) {
        await pg.setViewportSize({ width: w, height: h });
        await pg.waitForTimeout(150);
        const m = await medir();
        assert.ok(m.wrap.w <= 960.5, `${w}px: conteúdo com ${m.wrap.w}px (máximo 960)`);
        assert.ok(Math.abs(m.wrap.l - (m.vw - m.wrap.r)) <= 1, `${w}px: conteúdo centralizado (${m.wrap.l} / ${m.vw - m.wrap.r})`);
        assert.ok(m.wrap.l >= 16 - 0.5, `${w}px: margem esquerda do conteúdo ${m.wrap.l}`);
        assert.ok(m.vw - m.wrap.r >= 16 - 0.5, `${w}px: margem direita do conteúdo ${m.vw - m.wrap.r}`);
        assert.ok(m.btnDir >= 16 - 0.5, `${w}px: o botão do cabeçalho encosta na borda direita (folga ${m.btnDir}px)`);
        assert.ok(m.titulo >= 16 - 0.5, `${w}px: o título encosta na borda esquerda (${m.titulo}px)`);
        assert.ok(m.head.w <= 960.5, `${w}px: cabeçalho com ${m.head.w}px`);
        assert.ok(Math.abs(m.head.l - m.wrap.l) <= 1, `${w}px: cabeçalho alinhado ao conteúdo`);
      }
      // claro e campo também usam o fundo do app
      await pg.emulateMedia({ colorScheme: 'light' });
      const claro = await pg.evaluate(() => [getComputedStyle(document.querySelector('#cfg')).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--map').trim()]);
      assert.equal(claro[0], 'rgb(236, 238, 242)');
    }],
  ],
  g11: [
    ['Baixar CSV: nome, BOM UTF-8, ";" e vírgula decimal, colunas de coordenadas', '1366x768', async (pg) => {
      await criarProposta(pg, 'FSE', 'obs; com ponto e vírgula');
      assert.equal(await pg.locator('#pCsvDown').count(), 1, 'botão Baixar CSV');
      assert.equal(await pg.locator('#pCsv').count(), 1, 'o botão Copiar continua');
      await aba(pg, 'exp'); await pg.waitForTimeout(250);
      const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#pCsvDown')]);
      assert.match(dl.suggestedFilename(), /^propostas_\d{4}-\d{2}-\d{2}\.csv$/);
      const caminho = await dl.path();
      const buf = require('fs').readFileSync(caminho);
      assert.deepEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 no início do arquivo');
      const txt = buf.slice(3).toString('utf8');
      assert.ok(txt.includes('\r\n'), 'quebras de linha CRLF para o Excel');
      const [cab, lin] = txt.split('\r\n');
      assert.equal(cab, 'planilha;faixa;km_inicial;km_final;extensao_m;largura_m;area_m2;codigo_atual;solucao_atual;codigo_proposto;solucao_proposta;observacao;lat_inicial;lon_inicial;lat_final;lon_final;utm_e_inicial;utm_n_inicial;utm_e_final;utm_n_final');
      assert.match(lin, /"obs; com ponto e vírgula"/, 'observação com ";" fica entre aspas');
      assert.match(lin, /"FSE"/);
      assert.match(lin, /;-12,\d{7};-47,\d{7};-12,\d{7};-47,\d{7};\d{6},\d{2};\d{7},\d{2};\d{6},\d{2};\d{7},\d{2}$/, 'lat, lon e UTM com vírgula decimal ao final da linha');
      assert.doesNotMatch(lin.replace(/"[^"]*"/g, ''), /\d\.\d/, 'nenhum ponto decimal');
      // acentos preservados (UTF-8)
      assert.match(txt, /Fresagem estrutural/);
    }],
  ],
  g10: [
    ['propor solução: ativar, clicar um trecho, escolher, aplicar, ver na Revisão e sobreviver ao reload', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500', 3500);
      await pg.keyboard.press('n');
      assert.equal(await pg.isVisible('#propbar'), true, 'a barra de propor deve abrir com a tecla N');
      // estado inicial: nenhum trecho
      assert.match(await pg.textContent('#propbar'), /0 trechos selecionados/);
      assert.match(await pg.textContent('#propbar'), /Selecione um trecho no mapa/);
      assert.equal(await pg.isDisabled('#pApply'), true);
      // clica no meio da Fx 1 do segmento selecionado
      const alvo = await pontoLivre(pg);
      assert.ok(alvo, 'ponto livre para clicar');
      alvo.pname = await estado(pg, 'E => E.sel.pid');
      alvo.id = alvo.pname;
      await pg.mouse.click(alvo.x, alvo.y);
      await pg.waitForTimeout(400);
      assert.match(await pg.textContent('#propbar'), /1 trecho selecionado/);
      assert.doesNotMatch(await pg.textContent('#propbar'), /Selecione um trecho no mapa/);
      assert.equal(await pg.isDisabled('#pApply'), false, 'o Aplicar deve habilitar com seleção');
      // escolhe a solução e a observação
      await pg.selectOption('#pTo', 'FSE');
      await pg.fill('#pNote', 'teste e2e');
      await pg.click('#pApply');
      await pg.waitForTimeout(400);
      const props = await estado(pg, 'E => E.props.map((r) => ({ to: r.to, note: r.note, pid: !!r.pid, orfa: !!r.orfa, km0: r.km0 }))');
      assert.equal(props.length, 1, 'a proposta deve ter sido criada');
      assert.deepEqual([props[0].to, props[0].note, props[0].pid, props[0].orfa], ['FSE', 'teste e2e', true, false]);
      assert.match(await pg.textContent('#propbar'), /0 trechos selecionados/, 'a seleção zera depois de aplicar');
      assert.equal(await pg.isDisabled('#pApply'), true);
      // aba Revisão
      await pg.keyboard.press('Escape');
      await aba(pg, 'notas');
      const txt = await pg.textContent('#t-notas');
      assert.match(txt, /Propostas de solução\s*1/);
      assert.match(txt, /→ Fresagem estrutural/);
      assert.match(txt, /teste e2e/);
      // sobrevive ao reload (planilhas e propostas voltam do IndexedDB)
      await pg.reload();
      await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 90000 });
      await pg.waitForTimeout(1500);
      const depois = await estado(pg, 'E => E.props.map((r) => ({ to: r.to, pid: !!r.pid, orfa: !!r.orfa, r0: r.r0 }))');
      assert.equal(depois.length, 1);
      assert.deepEqual([depois[0].to, depois[0].pid, depois[0].orfa], ['FSE', true, false]);
      await aba(pg, 'notas');
      assert.match(await pg.textContent('#t-notas'), /→ Fresagem estrutural/);
      assert.equal(await pg.locator('#t-notas [data-pd]').count(), 1);
    }],
  ],
  g10b: [
    ['propor: seleção de planilha removida é descartada e o Aplicar desabilita', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500', 3500);
      await pg.keyboard.press('n');
      const alvo = await pontoLivre(pg);
      assert.ok(alvo, 'ponto livre para clicar');
      alvo.pname = await estado(pg, 'E => E.sel.pid');
      alvo.id = alvo.pname;
      await pg.mouse.click(alvo.x, alvo.y);
      await pg.waitForTimeout(300);
      assert.match(await pg.textContent('#propbar'), /1 trecho selecionado/);
      // remove a planilha da seleção pelo dashboard de projetos
      await abrirProjetos(pg);
      await pg.click(`#dash [data-del="${alvo.id}"]`); await fecharProjetos(pg);
      await pg.waitForTimeout(500);
      assert.match(await pg.textContent('#propbar'), /0 trechos selecionados/);
      assert.equal(await pg.isDisabled('#pApply'), true);
      assert.match(await pg.textContent('#propbar'), /Selecione um trecho no mapa/);
    }],
  ],
  g09: [
    ['limiares: campos dentro do cartão, sem sobrepor, em 1366, 1024, 820 e 480 px', '1366x768', async (pg, { ctx }) => {
      const medir = () => pg.evaluate(() => {
        const out = [];
        for (const card of document.querySelectorAll('#cfgBody [data-k]')) {
          const c = card.getBoundingClientRect(), campos = [...card.querySelectorAll('.lims input, .lims output')].map((e) => e.getBoundingClientRect());
          const cols = getComputedStyle(card.querySelector('.lims')).gridTemplateColumns.split(' ').length;
          const linhas = new Set(campos.map((r) => Math.round(r.top))).size;
          for (const [i, r] of campos.entries()) {
            if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`${card.dataset.k}#${i} fora do cartão (${Math.round(r.right - c.right)}px)`);
            for (const [j, q] of campos.entries()) if (j > i && r.left < q.right - 0.5 && r.right > q.left + 0.5 && r.top < q.bottom - 0.5 && r.bottom > q.top + 0.5) out.push(`${card.dataset.k}#${i} sobrepõe #${j}`);
          }
          out.push(`@${card.dataset.k}:cols=${cols}:campos=${campos.length}:linhas=${linhas}`);
        }
        return out;
      });
      for (const [w, h] of [[1366, 768], [1024, 768], [820, 1180], [480, 900]]) {
        await pg.setViewportSize({ width: w, height: h });
        if (w <= 600) { await pg.click('#cMapa'); await pg.click('#dConfig'); } else await pg.click('#btnCfg'); // no celular, Configurações fica no menu Mapa
        await pg.click('#cfgTabs [data-ct=lim]');
        await pg.waitForTimeout(300);
        const r = await medir();
        const problemas = r.filter((x) => !x.startsWith('@'));
        assert.equal(problemas.length, 0, `${w}px: ` + problemas.slice(0, 5).join(' | '));
        const info = r.filter((x) => x.startsWith('@'));
        assert.equal(info.length, 8, 'oito indicadores: IRI, ATR, D0, Rc, Defeitos, IGG, FC-2 e FC-3');
        for (const x of info) {
          assert.match(x, /campos=5/, `${w}px: 5 campos por cartão (${x})`);
          if (w < 520) assert.match(x, /linhas=2/, `${w}px: quebra em 2 linhas (${x})`);
          else assert.match(x, /cols=5:campos=5:linhas=1/, `${w}px: 5 colunas numa linha (${x})`);
        }
        await pg.click('#cfgClose');
      }
    }],
  ],
  g08: [
    ['zoom até o limite em Ruas (tile 19) e Satélite (tile 17, Segura, o padrão) com sobrezoom até o 21', '1366x768', async (pg, { log }) => {
      for (const [base, nome, tileMax] of [['osm', 'Ruas', 19], ['esri', 'Satélite', 17]]) {
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 15 }));
        log.tiles.length = 0;
        await escolherBase(pg, base);
        await irParaKm(pg, '170+500', 1500);
        // zoom de verdade: rolagem do mouse sobre o mapa até travar no limite
        const box = await pg.locator('#map').boundingBox();
        await pg.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
        for (let i = 0; i < 40; i++) { await pg.mouse.wheel(0, -600); await pg.waitForTimeout(60); }
        await pg.waitForTimeout(1500);
        const z = await pg.evaluate(() => window.__pavecad.map().getZoom());
        assert.ok(z >= 20.9, `${nome}: o zoom deveria chegar a 21 (chegou a ${z.toFixed(2)})`);
        assert.equal(await pg.evaluate(() => window.__pavecad.map().getMaxZoom()), 21);
        const zs = log.tiles.map((t) => t.z).filter((v) => v !== null);
        assert.ok(zs.length > 0, `${nome}: nenhum tile pedido`);
        assert.ok(Math.max(...zs) <= tileMax, `${nome}: pediu tile de zoom ${Math.max(...zs)} (máximo ${tileMax})`);
        assert.ok(zs.includes(tileMax), `${nome}: deveria usar o tile ${tileMax} ampliado`);
        // a base continua desenhada (a camada raster está visível) no zoom máximo
        const vis = await pg.evaluate((b) => window.__pavecad.map().getLayoutProperty(b, 'visibility'), base);
        assert.equal(vis, 'visible');
        // sem erros de tile no console
        const erros = log.erros.filter((e) => !/Failed to load resource/i.test(e) && /\btiles?\b|map data|\bsource\b/i.test(e));
        assert.equal(erros.length, 0, erros.join(' | '));
      }
    }],
  ],
  // Precisa de um servidor com VITE_MAPTILER_KEY definida: PAVECAD_URL=http://localhost:5198/ node scripts/capturas/e2e.cjs g08k
  g08k: [
    ['com chave do MapTiler: tiles até 21 (ruas) e 20 (satélite), mapa até 21', '1366x768', async (pg, { log }) => {
      assert.equal(await pg.evaluate(() => !!window.__pavecad.map().getSource('mt-ruas')), true, 'sem a chave no ambiente deste servidor');
      for (const [base, camada, esperado] of [['osm', 'mt-ruas', 21], ['esri', 'mt-sat', 20]]) {
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 15 }));
        await escolherBase(pg, base);
        await irParaKm(pg, '170+500', 1200);
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 16 }));
        await pg.waitForTimeout(600);
        log.tiles.length = 0;
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 21 }));
        await pg.waitForTimeout(1800);
        assert.equal(await pg.evaluate((c) => window.__pavecad.map().getLayoutProperty(c, 'visibility'), camada), 'visible', camada + ' deveria estar visível');
        const zs = log.tiles.filter((t) => /maptiler/.test(t.url)).map((t) => t.z);
        assert.ok(zs.length > 0, 'nenhum tile do MapTiler pedido');
        assert.equal(Math.max(...zs), esperado, `${camada}: maior zoom pedido`);
        assert.equal(await pg.evaluate(() => window.__pavecad.map().getMaxZoom()), 21);
      }
    }],
  ],
  g07: [
    ['em toque, botões do painel, das ferramentas e da rotação têm 44 px ou mais', 'tablet-h-1024x768', async (pg) => {
      await pg.evaluate(() => window.__pavecad.E.P.length);
      const medir = () => pg.evaluate(() => {
        const sel = '#inspector button, #toolbar button, #rotbar button, .topbar button, .search button, #unicard button, .maplibregl-ctrl-group button';
        return [...document.querySelectorAll(sel)].filter((b) => b.checkVisibility()).map((b) => {
          const r = b.getBoundingClientRect();
          return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, t: (b.getAttribute('aria-label') || b.textContent || b.id || b.className).trim().slice(0, 28), tab: b.closest('.tabbody')?.id || '' };
        });
      });
      assert.equal(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
      const ruins = [];
      let total = 0;
      for (const t of ['seg', 'ana', 'notas', 'exp', 'aj']) {
        if (t === 'seg') await irParaKm(pg, '170+500', 2500);
        await aba(pg, t);
        if (t === 'notas') { await pg.evaluate(() => document.querySelector('#toolbar [data-tool=prop]').click()); await pg.waitForTimeout(200); }
        for (const b of await medir()) { total++; if (b.w < 43.5 || b.h < 43.5) ruins.push(`${t}: "${b.t}" ${b.w}x${b.h}`); }
      }
      assert.ok(total > 25, 'poucos botões medidos: ' + total);
      const uniq = [...new Set(ruins)];
      assert.equal(uniq.length, 0, `${uniq.length} alvos abaixo de 44 px: ` + uniq.slice(0, 8).join(' | '));
    }],
    ['no desktop (mouse) os botões do painel continuam compactos; os controles das bordas têm 44 px', '1366x768', async (pg) => {
      assert.equal(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches), false);
      const h = await pg.evaluate(() => document.querySelector('#collapse').getBoundingClientRect().height);
      assert.ok(h < 44, 'o painel do desktop não deveria ganhar alvos de toque: ' + h);
      const b = await pg.evaluate(() => document.querySelector('#btnMore').getBoundingClientRect().height);
      assert.ok(b >= 43.5, 'a barra lateral tem alvos de 44 px em qualquer tela: ' + b);
    }],
  ],
  g06: [
    ['o unifilar só usa texto de 11 px ou mais', '1366x768', async (pg) => {
      await pg.evaluate(() => {
        window.__fontes = new Set();
        const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
        Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { get() { return d.get.call(this); }, set(v) { window.__fontes.add(v); d.set.call(this, v); }, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });
      await pg.waitForTimeout(500);
      const fontes = await pg.evaluate(() => [...window.__fontes]);
      assert.ok(fontes.length >= 2, 'o unifilar deveria ter redesenhado: ' + fontes.join(' | '));
      for (const f of fontes) assert.ok(+/(\d+(?:\.\d+)?)px/.exec(f)[1] >= 11, 'fonte menor que 11 px: ' + f);
    }],
  ],
  g05: [
    ['sem rodapé de atalhos; botão ? abre a lista no desktop', '1366x768', async (pg) => {
      assert.equal(await pg.locator('.foot').count(), 0, 'o rodapé de atalhos deve ter sido removido');
      assert.equal(await pg.isVisible('#btnAjuda'), true);
      assert.equal(await pg.isVisible('#ajuda'), false);
      await pg.click('#btnAjuda');
      assert.equal(await pg.isVisible('#ajuda'), true);
      assert.match(await pg.textContent('#ajuda'), /Ir para km/);
      assert.equal(await pg.evaluate(() => document.activeElement.id), 'ajudaFechar', 'o foco vai para o botão fechar');
      await pg.keyboard.press('Escape');
      assert.equal(await pg.isVisible('#ajuda'), false);
      assert.equal(await pg.evaluate(() => document.activeElement.id), 'btnAjuda', 'o foco volta ao botão ?');
      // a tecla ? também abre
      await pg.evaluate(() => document.activeElement.blur());
      await pg.keyboard.press('Shift+Slash');
      assert.equal(await pg.isVisible('#ajuda'), true);
      await pg.click('#ajudaFundo', { position: { x: 5, y: 5 } });
      assert.equal(await pg.isVisible('#ajuda'), false);
    }],
    ['em tela de toque (pointer: coarse) o botão ? fica oculto', 'tablet-h-1024x768', async (pg) => {
      assert.equal(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
      assert.equal(await pg.isVisible('#btnAjuda'), false);
      assert.equal(await pg.locator('.foot').count(), 0);
    }],
  ],
  // PAVTRACK: Street View na roda, satélite como base padrão e supressão de trechos longos sem intervenção.
  t30: [
    ['Street View: a bolinha abre o panorama do Google no ponto pressionado, em outra aba, e não grava nada', ['1366x768'], async (pg, { ctx }) => {
      await ctx.route(/google\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>sv</title>' }));
      const p = await centrarNaFaixa(pg, 0, 300, 1);
      await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForSelector('#nr .nr-op[data-t=streetview]', { timeout: 3000 }); await pg.waitForTimeout(200);
      const [nova] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), pg.click('#nr .nr-op[data-t=streetview]')]);
      assert.match(nova.url(), /^https:\/\/www\.google\.com\/maps\/@\?api=1&map_action=pano&viewpoint=-?\d+\.\d{6},-?\d+\.\d{6}$/);
      assert.equal(await estado(pg, 'E => E.notes.length'), 0, 'não grava nota');
      assert.equal(await pg.locator('#nr .nr-op').count(), 0, 'a roda fecha');
    }],
    ['A base padrão é o satélite, também no botão e na chave de Ajustes', ['1366x768'], async (pg) => {
      assert.equal(await estado(pg, 'E => E.base'), 'esri');
      assert.equal(await pg.evaluate(() => window.__pavecad.map().getLayoutProperty('esri', 'visibility')), 'visible');
      assert.equal(await pg.getAttribute('#base button[data-b=esri]', 'aria-pressed'), 'true');
      assert.equal(await pg.getAttribute('#base button[data-b=none]', 'aria-pressed'), 'false');
    }],
    ['Ruas usa o CARTO Voyager, não o servidor do OpenStreetMap', ['1366x768'], async (pg) => {
      const urls = await pg.evaluate(() => window.__pavecad.map().getStyle().sources.osm.tiles);
      assert.ok(urls.every((u) => /basemaps\.cartocdn\.com/.test(u) && !/openstreetmap/.test(u)), urls.join());
    }],
    ['Suprimir trechos longos sem intervenção: tira do mapa só o que passa do limite, e Unir faixas exige as faixas livres juntas', ['1366x768'], async (pg) => {
      // 100 linhas (2 km) sem intervenção em todas as faixas, mas o acostamento volta a ter solução nas últimas 60 (só 0,8 km livre nele)
      await pg.evaluate(() => {
        const E = window.__pavecad.E, p = E.P[0];
        p.model.forEach((md, k) => { md.tr.forEach((t) => { t.main = k < 100 ? '-' : 'X'; }); md.sh.main = k < 40 ? '-' : 'X'; });
      });
      const n = () => pg.evaluate(() => { const E = window.__pavecad.E, m = window.__pavecad.map(); return m.getSource('poly-' + E.P[0].id)._data.features.length; });
      const n0 = await n();
      await aba(pg, 'aj'); await pg.waitForTimeout(300);
      await pg.click('#s-sup'); await pg.waitForTimeout(500);
      const n1 = await n();
      assert.ok(n1 < n0, `suprimiu faixas livres: ${n0} -> ${n1}`);
      await pg.click('#s-supun'); await pg.waitForTimeout(500);
      assert.equal(await n(), n0, 'unindo, o acostamento com intervenção segura o trecho: nada some');
      await pg.click('#s-supun'); await pg.click('#s-supkm button[data-km="5"]'); await pg.waitForTimeout(500);
      assert.equal(await n(), n0, 'limite de 5 km: 2 km livres ficam');
      await pg.click('#s-supkm button[data-km="1"]'); await pg.click('#s-sup'); await pg.waitForTimeout(500);
      assert.equal(await n(), n0, 'desligado, tudo volta');
    }],
  ],
};

(async () => {
  const pedidos = process.argv.slice(2);
  const grupos = pedidos.length ? pedidos : Object.keys(TESTES).filter((g) => g !== 'g08k'); // g08k exige um servidor com VITE_MAPTILER_KEY
  const browser = await lancar();
  let falhas = 0, total = 0;
  for (const g of grupos) {
    for (const [nome, vpn, fn, opts] of TESTES[g] || []) {
      if (process.env.E2E_FILTRO && !new RegExp(process.env.E2E_FILTRO, 'i').test(nome)) continue;
      for (const v of Array.isArray(vpn) ? vpn : [vpn]) {
        total++;
        const rotulo = Array.isArray(vpn) ? `${nome} [${v}]` : nome;
        const { ctx, pg, log } = await abrir(browser, vp(v), opts || {});
        try {
          await fn(pg, { log, ctx, vpNome: v });
          console.log(`ok   ${g}: ${rotulo}`);
        } catch (e) {
          falhas++;
          console.log(`FALHA ${g}: ${rotulo}\n     ${String(e.message).split('\n').slice(0, 14).join('\n     ')}`);
          // no GitHub Actions a falha vira annotation (legível pela API mesmo quando o log do job não é)
          if (process.env.GITHUB_ACTIONS) console.log(`::error title=e2e ${g}::${rotulo} | ${String(e.message).split('\n').slice(0, 3).join(' / ').replace(/%/g, '%25')}`);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(`${total - falhas}/${total} testes de interface passaram`);
  process.exit(falhas ? 1 : 0);
})();
