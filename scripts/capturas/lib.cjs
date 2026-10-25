// Utilitários compartilhados pelas capturas (run.cjs) e pelos testes de interface (e2e.cjs).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const URL = process.env.PAVECAD_URL || 'http://localhost:5199/';
const VPS = [
  { nome: '1568x760', w: 1568, h: 760, toque: false },
  { nome: '1366x768', w: 1366, h: 768, toque: false },
  { nome: '1920x1080', w: 1920, h: 1080, toque: false },
  { nome: 'tablet-h-1024x768', w: 1024, h: 768, toque: true },
  { nome: 'tablet-v-820x1180', w: 820, h: 1180, toque: true },
];
const TEMAS = ['claro', 'escuro', 'campo'];
const FIXTURES = ['rr_go_crescente.xlsx', 'rr_go_decrescente.xlsx'].map((f) => path.join(RAIZ, 'testes/fixtures', f));
const TILE = { sat: fs.readFileSync(path.join(__dirname, 'tile-sat.png')), osm: fs.readFileSync(path.join(__dirname, 'tile-osm.png')) };

/** opts.antes: script injetado antes do app. opts.vazio: abre sem carregar planilha. opts.exemplos: carrega os JSON de referencia/dados pelo botão de exemplo (só em desenvolvimento) em vez das 2 planilhas GO, e tira a marginal para ficar com 4 planilhas (GO e MG, crescente e decrescente). */
async function abrir(browser, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, hasTouch: vp.toque, isMobile: vp.toque, deviceScaleFactor: 1,
    geolocation: { latitude: -12.791, longitude: -47.757 }, permissions: ['geolocation'],
  });
  const pg = await ctx.newPage();
  const log = { erros: [], tiles: [] };
  pg.on('console', (m) => { if (m.type() === 'error') log.erros.push(m.text()); });
  pg.on('pageerror', (e) => log.erros.push('PAGEERROR ' + e.message));
  // Sem rede para os provedores de tiles: devolve imagens sintéticas e registra o zoom pedido.
  await ctx.route(/(tile\.openstreetmap\.org|server\.arcgisonline\.com|api\.maptiler\.com)/, (route) => {
    const u = route.request().url();
    const m = /\/(\d+)\/(\d+)\/(\d+)(\.\w+)?(\?|$)/.exec(u);
    log.tiles.push({ url: u, z: m ? +m[1] : null });
    route.fulfill({ status: 200, contentType: 'image/png', body: /arcgis|satellite/.test(u) ? TILE.sat : TILE.osm });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  if (opts.antes) await ctx.addInitScript(opts.antes); // roda antes do app (simula navegador com armazenamento que não responde)
  await pg.goto(URL);
  await pg.waitForTimeout(1200);
  if (opts.vazio) return { ctx, pg, log }; // mapa vazio: nenhuma planilha carregada
  if (opts.exemplos) {
    pg.on('dialog', (d) => d.accept());
    await pg.evaluate(() => document.querySelector('#btnExample').click());
    await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length >= 4, null, { timeout: 90000 });
    await pg.waitForTimeout(1500);
    // deixa só as quatro principais (sem a marginal)
    await pg.evaluate(async () => {
      const E = window.__pavecad.E;
      for (const p of [...E.P]) if (/Marginal/i.test(p.meta.via) && E.P.length > 4) { const b = document.querySelector(`[data-del="${p.id}"]`); if (b) b.click(); await new Promise((r) => setTimeout(r, 300)); }
    });
    await pg.evaluate(() => document.querySelector('.toast-acao')?.remove()); // o aviso de planilha removida não deve ficar na frente dos testes
    await pg.waitForTimeout(500);
  } else if (opts.arquivos) {
    // opts.arquivos: nomes em testes/fixtures; opts.projetos: quantos projetos esperar (um arquivo Planservi gera dois)
    const t0 = Date.now();
    await pg.setInputFiles('#file', opts.arquivos.map((f) => path.resolve(RAIZ, 'testes/fixtures', f)));
    await pg.waitForFunction((n) => window.__pavecad && window.__pavecad.E.P.length === n, opts.projetos, { timeout: 180000 });
    log.cargaMs = Date.now() - t0; // do envio dos arquivos até todos os projetos na lista
  } else {
    await pg.setInputFiles('#file', FIXTURES);
    await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 90000 });
  }
  await pg.waitForTimeout(2500);
  return { ctx, pg, log };
}

async function tema(pg, t) {
  await pg.emulateMedia({ colorScheme: t === 'escuro' ? 'dark' : 'light' });
  await pg.evaluate((campo) => window.__pavecad.setField(campo, true), t === 'campo');
  await pg.waitForTimeout(500);
}


async function lancar() {
  // No CI vale o Chromium instalado pelo Playwright; aqui, o do ambiente (PAVECAD_CHROMIUM ou /opt/pw-browsers/chromium).
  const local = process.env.PAVECAD_CHROMIUM || '/opt/pw-browsers/chromium';
  const executablePath = require('fs').existsSync(local) ? local : undefined;
  return chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

module.exports = { RAIZ, URL, VPS, TEMAS, FIXTURES, abrir, tema, lancar };
