// Testes de interface (Playwright) das correções da revisão visual.
// Uso: node scripts/capturas/e2e.cjs [grupo ...]   (padrão: todos)
// Requer o servidor de desenvolvimento em PAVECAD_URL (padrão http://localhost:5199).
const assert = require('assert/strict');
const { VPS, abrir, lancar } = require('./lib.cjs');
const { irParaKm, aba } = require('./scenarios.cjs');

const vp = (nome) => VPS.find((v) => v.nome === nome);
const estado = (pg, expr) => pg.evaluate(`(${expr})(window.__pavecad.E)`);

const TESTES = {
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
    ['zoom até o limite em Ruas e Satélite sem pedir tiles acima do 19', '1366x768', async (pg, { log }) => {
      for (const [base, nome] of [['osm', 'Ruas'], ['esri', 'Satélite']]) {
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 15 }));
        await pg.click(`#base [data-b=${base}]`);
        await irParaKm(pg, '170+500', 1500);
        await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 16 }));
        await pg.waitForTimeout(800);
        log.tiles.length = 0;
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
        assert.ok(Math.max(...zs) <= 19, `${nome}: pediu tile de zoom ${Math.max(...zs)}`);
        assert.ok(zs.includes(19), `${nome}: deveria usar o tile 19 ampliado`);
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
        await pg.click(`#base [data-b=${base}]`);
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
    ['no desktop (mouse) os botões continuam compactos', '1366x768', async (pg) => {
      assert.equal(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches), false);
      const h = await pg.evaluate(() => document.querySelector('#rotL').getBoundingClientRect().height);
      assert.ok(h < 44, 'o desktop não deveria ganhar alvos de toque: ' + h);
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
  const grupos = pedidos.length ? pedidos : Object.keys(TESTES);
  const browser = await lancar();
  let falhas = 0, total = 0;
  for (const g of grupos) {
    for (const [nome, vpn, fn] of TESTES[g] || []) {
      total++;
      const { ctx, pg, log } = await abrir(browser, vp(vpn));
      try {
        await fn(pg, { log, ctx });
        console.log(`ok   ${g}: ${nome}`);
      } catch (e) {
        falhas++;
        console.log(`FALHA ${g}: ${nome}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${total - falhas}/${total} testes de interface passaram`);
  process.exit(falhas ? 1 : 0);
})();
