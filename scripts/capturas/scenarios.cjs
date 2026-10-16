// Cenários de captura. Cada um prepara o estado da tela depois de abrir as 2 planilhas.
const irParaKm = async (pg, km, espera = 3000) => {
  await pg.fill('#gokm', km);
  await pg.press('#gokm', 'Enter');
  await pg.waitForTimeout(espera);
  await pg.evaluate(() => document.activeElement && document.activeElement.blur());
};
const aba = async (pg, t) => { await pg.click(`#tabs [data-t=${t}]`); await pg.waitForTimeout(300); };

const zoomPara = async (pg, z) => {
  await pg.evaluate((zz) => window.__pavecad.map().jumpTo({ zoom: zz }), z);
  await pg.waitForTimeout(1500);
};

/** Ponto de tela sobre a Fx 1 de algum segmento perto do selecionado e livre de painéis (o clique cai no mapa). */
const pontoLivre = (pg) => pg.evaluate(() => {
  const E = window.__pavecad.E, sel = E.sel, p = E.P.find((x) => x.id === sel.pid), m = window.__pavecad.map(), box = document.querySelector('#map').getBoundingClientRect();
  for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8, 12, -12, 16, -16, 24, -24]) {
    const row = sel.row + d, f = p.polyByFid.get(row * 8 + 1);
    if (!f) continue;
    const c = f.geometry.coordinates[0], pt = m.project([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2]);
    const x = box.left + pt.x, y = box.top + pt.y;
    if (x < box.left + 4 || y < box.top + 4 || x > box.right - 4 || y > box.bottom - 4) continue;
    const el = document.elementFromPoint(x, y);
    if (el && el.classList.contains('maplibregl-canvas')) return { x, y, row };
  }
  return null;
});

/** Cria uma proposta pelo fluxo real da interface (N, clicar um trecho, escolher, Aplicar) e volta à aba Revisão. */
const criarProposta = async (pg, solucao = 'FSE', nota = '') => {
  await irParaKm(pg, '170+500', 3500);
  await pg.keyboard.press('n');
  const a = await pontoLivre(pg);
  if (!a) throw new Error('nenhum ponto livre de painéis para clicar no trecho');
  await pg.mouse.click(a.x, a.y); await pg.waitForTimeout(400);
  await pg.selectOption('#pTo', solucao);
  if (nota) await pg.fill('#pNote', nota);
  await pg.click('#pApply'); await pg.waitForTimeout(400);
  await pg.keyboard.press('Escape');
  await aba(pg, 'notas');
};

const CENARIOS = {
  inicio: async () => {},
  estacas500: async (pg) => { await irParaKm(pg, '170+500'); await zoomPara(pg, 14.6); },
  estacas100: async (pg) => { await irParaKm(pg, '170+500'); await zoomPara(pg, 16.4); },
  estacas20: async (pg) => { await irParaKm(pg, '170+500'); await zoomPara(pg, 18.6); },
  ajuda: async (pg, { vp }) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); if (!vp.toque) { await pg.click('#btnAjuda'); await pg.waitForTimeout(300); } },
  zoom21ruas: async (pg) => { await irParaKm(pg, '170+500'); await pg.click('#base [data-b=osm]'); await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 21 })); await pg.waitForTimeout(1500); },
  zoom21sat: async (pg) => { await irParaKm(pg, '170+500'); await pg.click('#base [data-b=esri]'); await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 21 })); await pg.waitForTimeout(1500); },
  propor0: async (pg) => { await irParaKm(pg, '170+500', 3500); await pg.keyboard.press('n'); await pg.waitForTimeout(300); },
  propor1: async (pg) => {
    await irParaKm(pg, '170+500', 3500); await pg.keyboard.press('n'); await pg.waitForTimeout(300);
    const a = await pontoLivre(pg);
    if (a) { await pg.mouse.click(a.x, a.y); await pg.mouse.move(1, 1); await pg.waitForTimeout(600); }
  },
  revisaoVazia: async (pg) => { await aba(pg, 'notas'); await pg.waitForTimeout(300); },
  revisaoComProposta: async (pg) => { await criarProposta(pg, 'FSE', 'trecho de teste'); },
  limiares: async (pg) => { await pg.click('#btnCfg'); await pg.waitForTimeout(300); await pg.click('#cfgTabs [data-ct=lim]'); await pg.waitForTimeout(400); },
  config: async (pg) => { await pg.click('#btnCfg'); await pg.waitForTimeout(500); },
  toque: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); },
  segmento: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); },
};

const GRUPOS = {
  g01: ['inicio'],
  g02: ['estacas500', 'estacas100', 'estacas20'],
  g03: ['segmento'],
  g04: ['segmento'],
  g05: ['segmento', 'ajuda'],
  g06: ['inicio'],
  g07: ['toque'],
  g08: ['zoom21ruas', 'zoom21sat'],
  g09: ['limiares'],
  g10: ['propor0', 'propor1'],
  g11: ['revisaoComProposta'],
  g13: ['propor1'],
  g14: ['revisaoVazia', 'revisaoComProposta'],
  g12: ['config'],
};

module.exports = { CENARIOS, GRUPOS, irParaKm, aba, criarProposta, pontoLivre };
