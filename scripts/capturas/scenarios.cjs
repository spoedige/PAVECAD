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
};

module.exports = { CENARIOS, GRUPOS, irParaKm, aba };
