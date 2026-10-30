// Cenários de captura. Cada um prepara o estado da tela depois de abrir as 2 planilhas.
const irParaKm = async (pg, km, espera = 3000) => {
  await pg.fill('#gokm', km);
  await pg.press('#gokm', 'Enter');
  await pg.waitForTimeout(espera);
  await pg.evaluate(() => document.activeElement && document.activeElement.blur());
};
/** Escolhe a base do mapa. A escolha fica na gaveta do mapa (botão ⋯): abre, clica e fecha de novo se foi ela quem abriu. */
const escolherBase = async (pg, b) => {
  const abriu = !(await pg.isVisible('#base'));
  if (abriu) { await pg.click('#btnMore'); await pg.waitForTimeout(250); }
  await pg.click(`#base [data-b=${b}]`);
  if (abriu) { await pg.click('#btnMore'); await pg.waitForTimeout(250); }
};
/** Escolhe a nitidez do satélite (maxima ou segura) na gaveta do mapa. */
const escolherNitidez = async (pg, n) => {
  const abriu = !(await pg.isVisible('#nitidez'));
  if (abriu) { await pg.click('#btnMore'); await pg.waitForTimeout(250); }
  await pg.click(`#nitidez [data-n=${n}]`);
  if (abriu) { await pg.click('#btnMore'); await pg.waitForTimeout(250); }
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
  zoom21ruas: async (pg) => { await irParaKm(pg, '170+500'); await escolherBase(pg, 'osm'); await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 21 })); await pg.waitForTimeout(1500); },
  zoom21sat: async (pg) => { await irParaKm(pg, '170+500'); await escolherBase(pg, 'esri'); await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 21 })); await pg.waitForTimeout(1500); },
  propor0: async (pg) => { await irParaKm(pg, '170+500', 3500); await pg.keyboard.press('n'); await pg.waitForTimeout(300); },
  propor1: async (pg) => {
    await irParaKm(pg, '170+500', 3500); await pg.keyboard.press('n'); await pg.waitForTimeout(300);
    const a = await pontoLivre(pg);
    if (a) { await pg.mouse.click(a.x, a.y); await pg.mouse.move(1, 1); await pg.waitForTimeout(600); }
  },
  revisaoVazia: async (pg) => { await aba(pg, 'notas'); await pg.waitForTimeout(300); },
  revisaoComProposta: async (pg) => { await criarProposta(pg, 'FSE', 'trecho de teste'); },
  escalaSat: async (pg) => { await irParaKm(pg, '170+500'); await escolherBase(pg, 'esri'); await pg.evaluate(() => window.__pavecad.map().jumpTo({ zoom: 17.5 })); await pg.mouse.move(1, 1); await pg.waitForTimeout(1500); },
  limiares: async (pg) => { await pg.click('#btnCfg'); await pg.waitForTimeout(300); await pg.click('#cfgTabs [data-ct=lim]'); await pg.waitForTimeout(400); },
  config: async (pg) => { await pg.click('#btnCfg'); await pg.waitForTimeout(500); },
  toque: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); },
  segmento: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); },
  /** Aba Segmento rolada até o fim: o último cartão precisa ficar inteiro. */
  /** Tablet com a gaveta de mapa (alinhar, girar, base) aberta. */
  gaveta: async (pg, { vp }) => {
    await irParaKm(pg, '170+500'); await aba(pg, 'seg');
    if (await pg.isVisible('#btnMore')) { await pg.click('#btnMore'); await pg.waitForTimeout(500); }
  },
  /** Tablet com o painel direito e o unifilar recolhidos (gesto de puxar para baixo). */
  recolhidos: async (pg, { vp }) => {
    await irParaKm(pg, '170+500'); await aba(pg, 'seg');
    if (await pg.isVisible('#ikm')) { await pg.click('#collapse'); await pg.click('#uniToggle'); await pg.waitForTimeout(400); }
  },
  /** Combinações do painel (aberto/recolhido) com o unifilar (aberto/recolhido). */
  painelAbertoUniAberto: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); },
  painelRecolhidoUniAberto: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); await pg.click('#collapse'); await pg.waitForTimeout(400); },
  painelAbertoUniRecolhido: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); await pg.click('#uniToggle'); await pg.waitForTimeout(500); },
  painelRecolhidoUniRecolhido: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); await pg.click('#collapse'); await pg.click('#uniToggle'); await pg.waitForTimeout(500); },
  /** Mapa limpo (tecla H): só o zoom e o botão de olho. */
  mapaLimpo: async (pg) => { await irParaKm(pg, '170+500'); await aba(pg, 'seg'); await pg.keyboard.press('h'); await pg.waitForTimeout(500); },
  /** Todos os grupos ocultos: cada um vira um botão de 44 px no lugar. */
  tudoOculto: async (pg) => {
    await irParaKm(pg, '170+500'); await aba(pg, 'seg');
    for (const id of ['titulo', 'ferramentas', 'legenda', 'unifilar', 'painel']) await pg.click(`[data-ocultar=${id}]`);
    await pg.click('#btnMore'); await pg.waitForSelector('#drawer', { state: 'visible' }); await pg.click('[data-ocultar=girar]'); await pg.waitForTimeout(500);
  },
  /** Coluna esquerda com 4 planilhas (GO e MG) e satélite como base: título, busca e chips não podem se cortar nem sobrepor. */
  colunaEsquerda: async (pg) => { await escolherBase(pg, 'esri'); await irParaKm(pg, '34+780', 3500); await aba(pg, 'seg'); await pg.mouse.move(1, 1); await pg.waitForTimeout(800); },
  segmentoFim: async (pg) => {
    await irParaKm(pg, '170+500'); await aba(pg, 'seg');
    await pg.evaluate(() => { const b = document.querySelector('#t-seg'); b.scrollTop = b.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
    await pg.waitForTimeout(400);
  },
};

CENARIOS.colunaEsquerda.exemplos = true;

/** Planservi com os arquivos reais (TH38 e TH39, que não ficam no repositório). Caminho em PAVTRACK_PLANSERVI (pasta com os .xlsx). */
const PS = process.env.PAVTRACK_PLANSERVI || '/root/.claude/uploads/cde62ba2-1e72-5783-bd3b-09396233492a';
const psOpts = { arquivos: [`${PS}/86f46219-C0866_UNIFILAR_SOLU__ES_TH38_R02_1.xlsx`, `${PS}/c65a789d-C0867_UNIFILAR_SOLU__ES_TH39_R02_1.xlsx`], projetos: 4 };
/** Vai ao km, aproxima até ver as faixas e escolhe a base lisa. */
const psVai = async (pg, km, zoom = 17.3) => {
  await irParaKm(pg, km, 3500);
  await pg.evaluate((z) => window.__pavecad.map().jumpTo({ zoom: z }), zoom);
  await pg.mouse.move(1, 1); await pg.waitForTimeout(1500);
};
CENARIOS.planserviMapa = async (pg) => { await psVai(pg, '150+500'); };
CENARIOS.planserviIgg = async (pg) => { await psVai(pg, '150+500'); await pg.keyboard.press('4'); await pg.waitForTimeout(800); };
CENARIOS.planserviDetalhe = async (pg) => {
  await psVai(pg, '150+500');
  // um segmento do crescente com fresagem e reforço, para o detalhe mostrar as quatro camadas
  const alvo = await pg.evaluate(() => {
    const p = window.__pavecad.E.P.find((q) => /TH38 · Crescente/.test(q.meta.name));
    const i = p.rows.findIndex((r, k) => k > 280 && r.lanes[0] && r.lanes[0].code === 'F4R10');
    const j = i >= 0 ? i : p.rows.findIndex((r, k) => k > 280 && r.lanes[0] && r.lanes[0].code === 'F4R4');
    return { id: p.id, i: j };
  });
  await pg.evaluate((a) => window.__pavecad.select(a.id, a.i, 1, { tab: true, pan: true }), alvo);
  await pg.waitForTimeout(2500);
  // com o painel baixo, as camadas ficam abaixo dos cartões: rola até o fim do corpo da aba
  await pg.evaluate(() => { const b = document.querySelector('#t-seg'); b.scrollTop = b.scrollHeight; });
  await pg.waitForTimeout(500);
};
for (const k of ['planserviMapa', 'planserviIgg', 'planserviDetalhe']) CENARIOS[k].opts = psOpts;

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
  g15: ['escalaSat'],
  g12: ['config'],
  p01: ['painelAbertoUniAberto', 'painelRecolhidoUniAberto', 'painelAbertoUniRecolhido', 'painelRecolhidoUniRecolhido', 'mapaLimpo', 'tudoOculto'],
  c01: ['colunaEsquerda'],
  s01: ['planserviMapa', 'planserviIgg', 'planserviDetalhe'],
  u01: ['inicio', 'segmento', 'gaveta', 'recolhidos', 'propor0'],
  t01: ['inicio', 'segmento', 'segmentoFim', 'gaveta', 'recolhidos'],
};

module.exports = { CENARIOS, GRUPOS, irParaKm, escolherBase, escolherNitidez, aba, criarProposta, pontoLivre };
