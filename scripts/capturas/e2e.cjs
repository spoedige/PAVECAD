// Testes de interface (Playwright) das correções da revisão visual.
// Uso: node scripts/capturas/e2e.cjs [grupo ...]   (padrão: todos)
// Requer o servidor de desenvolvimento em PAVECAD_URL (padrão http://localhost:5199).
const assert = require('assert/strict');
const { VPS, abrir, lancar } = require('./lib.cjs');
const { irParaKm, escolherBase, aba, criarProposta, pontoLivre } = require('./scenarios.cjs');

const vp = (nome) => VPS.find((v) => v.nome === nome);
/** Os quatro tamanhos de referência do layout único. */
const TODOS = ['1568x760', '1366x768', 'tablet-h-1024x768', 'tablet-v-820x1180'];
const estado = (pg, expr) => pg.evaluate(`(${expr})(window.__pavecad.E)`);

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
    ['barra única à esquerda, ordem GPS, propor, campo, nota, ⋯, e topo só com indicadores, Planilhas e engrenagem', TODOS, async (pg) => {
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('unico')), true);
      const m = await pg.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect();
        const ids = ['#btnGps', '[data-tool=prop]', '#btnField', '[data-tool=pin]', '#btnMore'];
        const rs = ids.map(R);
        return {
          xs: rs.map((r) => Math.round(r.left)), ys: rs.map((r) => r.top), w: rs.map((r) => r.width), h: rs.map((r) => r.height),
          zoomEmTools: !!document.querySelector('#tools #zoomhost'), barraEmTools: !!document.querySelector('#tools #toolbar'),
          zoomX: Math.round(R('#zoomhost .maplibregl-ctrl-group').left), borda: R('#toolbar').left,
          topo: [...document.querySelectorAll('.topbar button')].filter((b) => b.checkVisibility()).map((b) => b.id || b.dataset.m),
          baseNoTopo: !!document.querySelector('.topbar #base'), rotNoTopo: !!document.querySelector('.leftcol #rotbar'),
        };
      });
      assert.ok(m.zoomEmTools && m.barraEmTools, 'zoom e ferramentas devem estar na barra lateral');
      assert.ok(new Set(m.xs).size === 1, 'os botões devem estar alinhados em coluna: ' + m.xs);
      assert.deepEqual([...m.ys].sort((a, b) => a - b), m.ys, 'ordem vertical: GPS, propor, campo, nota, ⋯');
      assert.ok(m.w.every((w) => w >= 44) && m.h.every((h) => h >= 44), 'alvos de 44 px');
      assert.ok(Math.abs(m.zoomX - m.borda) <= 2, 'barra alinhada ao zoom');
      assert.ok(m.borda <= 20, 'barra encostada na borda esquerda: ' + m.borda);
      assert.equal(m.topo.filter((x) => !['sol', 'iri', 'atr', 'd0', 'rc', 'def', 'btnAjuda', 'btnCfg', 'btnFile'].includes(x)).length, 0, 'topo com botão extra: ' + m.topo);
      assert.equal(m.baseNoTopo, false, 'a escolha de base saiu do topo');
      assert.equal(m.rotNoTopo, false, 'girar e alinhar saíram da coluna esquerda de cima');
    }],
    ['gaveta ⋯ abre alinhar, girar, norte e base; estado salvo; Satélite troca a base', TODOS, async (pg) => {
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
          const sel = ['.leftcol > .title', '.leftcol > .search', '.leftcol > .views', '.topbar > .modes', '.topbar > .topright', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#drawer', '#legend', '#propbar:not([hidden])', '#inspector', '#unicard'];
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
        assert.deepEqual(r.ruins, [], `${w}: controles sobrepostos`);
        assert.deepEqual(r.fora, [], `${w}: controles fora da tela`);
      }
    }],
    ['celular (500 px) mantém o layout empilhado, e voltar a 601 px ou mais devolve o layout único', 'tablet-h-1024x768', async (pg) => {
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('unico')), true);
      await pg.setViewportSize({ width: 500, height: 900 }); await pg.waitForTimeout(600);
      const d = await pg.evaluate(() => ({ unico: document.documentElement.classList.contains('unico'), base: !!document.querySelector('.topright #base'), rot: !!document.querySelector('.leftcol #rotbar'), more: document.querySelector('#btnMore').checkVisibility() }));
      assert.deepEqual(d, { unico: false, base: true, rot: true, more: false });
      await pg.setViewportSize({ width: 601, height: 900 }); await pg.waitForTimeout(600);
      assert.equal(await pg.evaluate(() => document.documentElement.classList.contains('unico')), true, '601 px já é layout único');
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
          const sel = ['.leftcol > .title', '.leftcol > .search', '.leftcol > .views', '.topbar > .modes', '.topbar > .topright', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#legend', '#inspector', '#unicard'];
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
    ['legenda começa recolhida, em botão de 44 px; tocar expande e lembra a escolha', TODOS, async (pg) => {
      assert.equal(await pg.getAttribute('#legTog', 'aria-expanded'), 'false', 'a legenda deve começar recolhida em toque');
      const m = await pg.evaluate(() => { const r = document.querySelector('#legend').getBoundingClientRect(), t = document.querySelector('#legTog').getBoundingClientRect(), b = document.querySelector('#toolbar').getBoundingClientRect(); return { w: r.width, h: t.height, aoLado: r.left >= b.right, naoSobre: r.right <= document.querySelector('#inspector').getBoundingClientRect().left }; });
      assert.ok(m.h >= 43.5, 'botão da legenda com 44 px: ' + m.h);
      assert.ok(m.w < 200, 'botão pequeno: ' + m.w);
      assert.ok(m.aoLado, 'ao lado da barra de ferramentas');
      await pg.click('#legTog'); await pg.waitForTimeout(300);
      assert.equal(await pg.getAttribute('#legTog', 'aria-expanded'), 'true');
      assert.equal(await pg.evaluate(() => localStorage.getItem('pavecad-leg')), '1');
      assert.ok(await pg.evaluate(() => document.querySelectorAll('#legend li button').length) > 2, 'itens da legenda visíveis');
      await pg.click('#legTog'); await pg.waitForTimeout(300);
      assert.equal(await pg.getAttribute('#legTog', 'aria-expanded'), 'false');
    }],
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
        const sel = ['.leftcol > .title', '.leftcol > .search', '.leftcol > .views', '.topbar > .modes', '.topbar > .topright', '#zoomhost .maplibregl-ctrl-group', '#toolbar', '#legend', '#inspector', '#unicard'];
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
    ['painel não está no topo: cresce para cima com max-height logo abaixo da barra superior', TODOS, async (pg) => {
      // sem segmento selecionado a aba Segmento é curta: um painel preso ao topo esticaria até o unifilar; o ancorado fica baixo
      await aba(pg, 'seg');
      const curto = await pg.evaluate(() => { const i = document.querySelector('#inspector').getBoundingClientRect(), u = document.querySelector('#unicard').getBoundingClientRect(); return { t: i.top, h: i.height, b: i.bottom, uni: u.top, hud: document.querySelector('.hud').getBoundingClientRect().bottom }; });
      assert.ok(curto.h < 260, 'o painel com conteúdo curto não estica até o topo: ' + curto.h);
      assert.ok(curto.t > curto.hud + 60, `o topo do painel curto fica longe da barra superior (topo ${curto.t}, barra até ${curto.hud})`);
      assert.ok(Math.abs(curto.uni - curto.b - 12) <= 1.5, 'e a base continua a 12 px do unifilar');
      await irParaKm(pg, '170+500'); await aba(pg, 'resumo');
      const r = await pg.evaluate(() => {
        const i = document.querySelector('#inspector').getBoundingClientRect(), hud = document.querySelector('.hud').getBoundingClientRect(), t = document.querySelector('.topright'), tr = t.getBoundingClientRect();
        const lado = innerWidth >= 900;
        const topo = lado ? tr.bottom : hud.bottom;
        return { gap: i.top - topo, lado, max: getComputedStyle(document.querySelector('#inspector')).maxHeight, h: i.height };
      });
      assert.ok(r.gap >= 8, 'o painel mais alto (Resumo longo) para logo abaixo da barra superior, sem cobri-la: ' + r.gap);
      assert.notEqual(r.max, 'none');
    }],
    ['menos de 900 px: folha inferior em largura total acima do unifilar, sem cobrir a barra lateral nem a legenda', ['tablet-v-820x1180'], async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'resumo');
      const m = await pg.evaluate(() => {
        const R = (s) => document.querySelector(s).getBoundingClientRect(), i = R('#inspector');
        return { l: i.left, r: innerWidth - i.right, t: i.top, tools: R('#tools').bottom, toolsTop: R('#tools').top, leg: R('#legend').bottom, hud: R('.hud').bottom, dockL: R('#legend').left };
      });
      assert.ok(Math.abs(m.l - 16) <= 1 && Math.abs(m.r - 16) <= 1, `largura total (esq ${m.l}, dir ${m.r})`);
      assert.ok(m.tools <= m.t - 8, `a barra lateral fica acima da folha (${m.tools} x ${m.t})`);
      assert.ok(m.leg <= m.t - 8, `a legenda fica acima da folha (${m.leg} x ${m.t})`);
      assert.ok(m.toolsTop >= m.hud + 8, `a barra lateral não sobe até o topo (${m.toolsTop} x ${m.hud})`);
      await pg.click('#collapse'); await pg.waitForTimeout(400);
      const c = await pg.evaluate(() => { const i = document.querySelector('#inspector').getBoundingClientRect(), t = document.querySelector('#tools').getBoundingClientRect(); return { tb: t.bottom, it: i.top }; });
      assert.ok(c.tb <= c.it - 8, 'recolhida, a barra lateral desce junto e continua acima da faixa');
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
    ['parâmetros em 3 colunas, rótulo 10 px, valor 18 px', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      const m = await pg.evaluate(() => {
        const g = document.querySelector('#t-seg .params'), p = document.querySelector('#t-seg .param');
        return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, k: getComputedStyle(p.querySelector('.k')).fontSize, v: getComputedStyle(p.querySelector('.v')).fontSize, escala: p.querySelectorAll('.scale i').length };
      });
      assert.equal(m.cols, 3); assert.equal(m.k, '10px'); assert.equal(m.v, '18px'); assert.equal(m.escala, 5);
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
    ['escala do mapa: fundo de vidro e texto com contraste (claro, escuro e campo) sobre o satélite', '1366x768', async (pg) => {
      await irParaKm(pg, '170+500');
      await escolherBase(pg, 'esri');
      await pg.waitForTimeout(800);
      const medir = () => pg.evaluate(() => {
        const e = document.querySelector('.maplibregl-ctrl-scale'), cs = getComputedStyle(e);
        const rgba = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const sobre = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
        const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const fundo = rgba(cs.backgroundColor), texto = rgba(cs.color);
        // pior caso: o vidro sobre preto e sobre branco, e sobre o verde escuro do satélite sintético
        const piso = [{ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }, { r: 58, g: 84, b: 52, a: 1 }];
        return { alfa: fundo.a, fonte: cs.fontSize, bt: cs.backgroundColor, minimo: Math.min(...piso.map((b) => cr(texto, sobre(fundo, b)))), blur: cs.backdropFilter, borda: cs.borderBottomWidth };
      });
      for (const tema of ['claro', 'escuro', 'campo']) {
        await pg.emulateMedia({ colorScheme: tema === 'escuro' ? 'dark' : 'light' });
        await pg.evaluate((campo) => window.__pavecad.setField(campo, true), tema === 'campo');
        await pg.waitForTimeout(500);
        const m = await medir();
        assert.ok(m.alfa >= 0.7, `${tema}: fundo de vidro precisa ser quase opaco (alfa ${m.alfa})`);
        assert.ok(parseFloat(m.fonte) >= 11, `${tema}: fonte ${m.fonte}`);
        assert.ok(m.minimo >= 4.5, `${tema}: contraste ${m.minimo.toFixed(2)}:1 no pior fundo (mínimo 4,5:1)`);
        assert.notEqual(m.borda, '0px');
        if (tema !== 'campo') assert.notEqual(m.blur, 'none', `${tema}: sem blur de vidro`);
      }
    }],
  ],
  g14: [
    ['Revisão: estados vazios em uma linha e botão "Baixar GeoJSON"', '1366x768', async (pg) => {
      await aba(pg, 'notas');
      assert.equal(await pg.locator('#t-notas .empty').count(), 0, 'sem cartão grande de estado vazio');
      const vazios = await pg.evaluate(() => [...document.querySelectorAll('#t-notas .vazio')].map((e) => ({ t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height) })));
      assert.equal(vazios.length, 2, 'um estado vazio para propostas e outro para anotações');
      for (const v of vazios) assert.ok(v.h <= 20, `"${v.t}" ocupa ${v.h}px (mais de uma linha)`);
      assert.ok(vazios.some((v) => /Nenhuma proposta/.test(v.t)) && vazios.some((v) => /Nenhuma anotação/.test(v.t)));
      assert.equal((await pg.textContent('#exDown')).trim(), 'Baixar GeoJSON');
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
      assert.match(lin, /;-17,\d{7};-47,\d{7};-17,\d{7};-47,\d{7};\d{6},\d{2};\d{7},\d{2};\d{6},\d{2};\d{7},\d{2}$/, 'lat, lon e UTM com vírgula decimal ao final da linha');
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
      // remove a planilha da seleção pelo painel Resumo
      await aba(pg, 'resumo');
      await pg.click(`#t-resumo [data-del="${alvo.id}"]`);
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
        await pg.click('#btnCfg');
        await pg.click('#cfgTabs [data-ct=lim]');
        await pg.waitForTimeout(300);
        const r = await medir();
        const problemas = r.filter((x) => !x.startsWith('@'));
        assert.equal(problemas.length, 0, `${w}px: ` + problemas.slice(0, 5).join(' | '));
        const info = r.filter((x) => x.startsWith('@'));
        assert.equal(info.length, 5, 'cinco indicadores');
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
    ['zoom até o limite em Ruas (tile 19) e Satélite (tile 17) com sobrezoom até o 21', '1366x768', async (pg, { log }) => {
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
      for (const t of ['resumo', 'seg', 'ana', 'notas', 'aj']) {
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
};

(async () => {
  const pedidos = process.argv.slice(2);
  const grupos = pedidos.length ? pedidos : Object.keys(TESTES).filter((g) => g !== 'g08k'); // g08k exige um servidor com VITE_MAPTILER_KEY
  const browser = await lancar();
  let falhas = 0, total = 0;
  for (const g of grupos) {
    for (const [nome, vpn, fn] of TESTES[g] || []) {
      for (const v of Array.isArray(vpn) ? vpn : [vpn]) {
        total++;
        const rotulo = Array.isArray(vpn) ? `${nome} [${v}]` : nome;
        const { ctx, pg, log } = await abrir(browser, vp(v));
        try {
          await fn(pg, { log, ctx });
          console.log(`ok   ${g}: ${rotulo}`);
        } catch (e) {
          falhas++;
          console.log(`FALHA ${g}: ${rotulo}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(`${total - falhas}/${total} testes de interface passaram`);
  process.exit(falhas ? 1 : 0);
})();
