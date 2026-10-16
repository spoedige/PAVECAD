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
    const a = await pg.evaluate(() => {
      const E = window.__pavecad.E, sel = E.sel, p = E.P.find((x) => x.id === sel.pid), f = p.polyByFid.get(sel.row * 8 + 1), c = f.geometry.coordinates[0];
      const pt = window.__pavecad.map().project([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2]), box = document.querySelector('#map').getBoundingClientRect();
      return { x: box.left + pt.x, y: box.top + pt.y };
    });
    await pg.mouse.click(a.x, a.y); await pg.waitForTimeout(500);
  },
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
  g12: ['config'],
};

module.exports = { CENARIOS, GRUPOS, irParaKm, aba };
