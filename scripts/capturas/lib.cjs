// Utilitários compartilhados pelas capturas (run.cjs) e pelos testes de interface (e2e.cjs).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const URL = process.env.PAVECAD_URL || 'http://localhost:5199/';
const VPS = [
  { nome: '1366x768', w: 1366, h: 768, toque: false },
  { nome: '1920x1080', w: 1920, h: 1080, toque: false },
  { nome: 'tablet-h-1024x768', w: 1024, h: 768, toque: true },
  { nome: 'tablet-v-820x1180', w: 820, h: 1180, toque: true },
];
const TEMAS = ['claro', 'escuro', 'campo'];
const FIXTURES = ['U_BR-050_GO_Crescente.xlsx', 'U_BR-050_GO_Decrescente.xlsx'].map((f) => path.join(RAIZ, 'testes/fixtures', f));
const TILE = { sat: fs.readFileSync(path.join(__dirname, 'tile-sat.png')), osm: fs.readFileSync(path.join(__dirname, 'tile-osm.png')) };

async function abrir(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, hasTouch: vp.toque, isMobile: vp.toque, deviceScaleFactor: 1,
    geolocation: { latitude: -17.291, longitude: -47.757 }, permissions: ['geolocation'],
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
  await pg.goto(URL);
  await pg.waitForTimeout(1200);
  await pg.setInputFiles('#file', FIXTURES);
  await pg.waitForFunction(() => window.__pavecad && window.__pavecad.E.P.length === 2, null, { timeout: 90000 });
  await pg.waitForTimeout(2500);
  return { ctx, pg, log };
}

async function tema(pg, t) {
  await pg.emulateMedia({ colorScheme: t === 'escuro' ? 'dark' : 'light' });
  await pg.evaluate((campo) => window.__pavecad.setField(campo, true), t === 'campo');
  await pg.waitForTimeout(500);
}


async function lancar() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

module.exports = { RAIZ, URL, VPS, TEMAS, FIXTURES, abrir, tema, lancar };
