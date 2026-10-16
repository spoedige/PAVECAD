// Capturas de revisão visual: 4 viewports x 3 temas, com 2 planilhas carregadas.
// Uso: node scripts/capturas/run.cjs <grupo> <antes|depois> [cenario ...]
// Requer o servidor de desenvolvimento em PAVECAD_URL (padrão http://localhost:5199) e o Chromium do Playwright.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CENARIOS, GRUPOS } = require('./scenarios.cjs');

const { RAIZ, VPS, TEMAS, abrir, tema, lancar } = require('./lib.cjs');

(async () => {
  const [grupo, fase, ...pedidos] = process.argv.slice(2);
  if (!grupo || !fase) { console.error('uso: run.cjs <grupo> <antes|depois> [cenario ...]'); process.exit(2); }
  const cenarios = pedidos.length ? pedidos : GRUPOS[grupo];
  if (!cenarios) { console.error('grupo sem cenários: ' + grupo); process.exit(2); }
  const saida = path.join(RAIZ, 'capturas', grupo, fase);
  fs.mkdirSync(saida, { recursive: true });
  const browser = await lancar();
  const relatorio = {};
  for (const cen of cenarios) {
    const fn = CENARIOS[cen];
    if (!fn) throw new Error('cenário desconhecido: ' + cen);
    for (const vp of VPS.filter((v) => !process.env.PAVECAD_VPS || process.env.PAVECAD_VPS.split(',').includes(v.nome))) {
      const { ctx, pg, log } = await abrir(browser, vp);
      await fn(pg, { vp, log });
      await pg.waitForTimeout(700);
      for (const t of TEMAS) {
        await tema(pg, t);
        const arq = path.join(saida, `${cen}_${vp.nome}_${t}.png`);
        await pg.screenshot({ path: arq });
        const ov = await pg.evaluate(fs.readFileSync(path.join(__dirname, 'overlap.js'), 'utf8'));
        relatorio[`${cen}_${vp.nome}_${t}`] = { sobreposicoes: ov, erros: [...log.erros] };
      }
      await ctx.close();
    }
    execFileSync('python3', [path.join(__dirname, 'montagem.py'), saida, cen, path.join(RAIZ, 'capturas', grupo, `${fase}_${cen}.png`)]);
  }
  fs.writeFileSync(path.join(RAIZ, 'capturas', grupo, `${fase}_relatorio.json`), JSON.stringify(relatorio, null, 1));
  await browser.close();
  let total = 0, marc = 0;
  for (const [k, v] of Object.entries(relatorio)) {
    const ui = v.sobreposicoes.filter((o) => !o.mk), mk = v.sobreposicoes.filter((o) => o.mk);
    total += ui.length; marc += mk.length;
    const fmt = (o) => `${o.tipo === 'cortado' ? 'CORTADO' : ''}[${o.a}]${o.b ? ' x [' + o.b + ']' : ''} ${o.w}x${o.h}@${o.x},${o.y}`;
    if (ui.length) console.log(`${k}: ${ui.length} na interface`, ui.slice(0, 4).map(fmt).join(' | '));
    const errs = v.erros.filter((e) => !/GPU|WebGL|swiftshader|GL Driver|Failed to load resource|fonts\./i.test(e));
    if (errs.length) console.log(`${k}: erros`, errs.slice(0, 3));
  }
  console.log(`${grupo}/${fase}: ${Object.keys(relatorio).length} capturas | interface: ${total} sobreposições/cortes | marcadores do mapa: ${marc}`);
})();
