// Testes de interface (Playwright) das correções da revisão visual.
// Uso: node scripts/capturas/e2e.cjs [grupo ...]   (padrão: todos)
// Requer o servidor de desenvolvimento em PAVECAD_URL (padrão http://localhost:5199).
const assert = require('assert/strict');
const { VPS, abrir, lancar } = require('./lib.cjs');
const { irParaKm, aba, criarProposta, pontoLivre } = require('./scenarios.cjs');

const vp = (nome) => VPS.find((v) => v.nome === nome);
const estado = (pg, expr) => pg.evaluate(`(${expr})(window.__pavecad.E)`);

const TESTES = {
  t01: [
    ['abas do painel inteiras e subtítulo em duas linhas, nos dois tablets', 'tablet-h-1024x768', async (pg, { ctx }) => {
      await irParaKm(pg, '170+500'); await aba(pg, 'seg');
      for (const [w, h] of [[1024, 768], [820, 1180]]) {
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
      await pg.click('#base [data-b=esri]');
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
        if (w > 900) {
          assert.ok(m.uni && m.bar.b <= m.uni.t, `${w}px: a barra deve ficar acima do unifilar (barra ${m.bar.b} / unifilar ${m.uni && m.uni.t})`);
          assert.ok(m.uni.t - m.bar.b <= 40, `${w}px: a barra deve ficar logo acima do unifilar (${m.uni.t - m.bar.b}px)`);
          assert.ok(m.insp && m.bar.r <= m.insp.l - 8, `${w}px: a barra deve terminar antes do painel direito`);
          if (m.leg) assert.ok(m.leg.b <= m.bar.t, `${w}px: a legenda sobe para não ficar sob a barra`);
          assert.ok((m.leg ? m.leg.t : m.bar.t) >= m.esq.b + 4, `${w}px: a pilha da barra encosta na coluna esquerda (${m.leg ? m.leg.t : m.bar.t} / ${m.esq.b})`);
        } else {
          assert.ok(Math.abs(m.bar.w - (m.vw - 32)) <= 1, `${w}px: largura toda com 16 px de margem (${m.bar.w} de ${m.vw - 32})`);
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
        await pg.click(`#base [data-b=${base}]`);
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
  const grupos = pedidos.length ? pedidos : Object.keys(TESTES).filter((g) => g !== 'g08k'); // g08k exige um servidor com VITE_MAPTILER_KEY
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
