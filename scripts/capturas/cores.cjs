// Capturas de cores para comparar duas versões do app (antes e depois do ajuste de pares), nos três temas.
// Uso: PAVECAD_URL=http://localhost:5198 node scripts/capturas/cores.cjs antes <pasta>
//      PAVECAD_URL=http://localhost:5199 node scripts/capturas/cores.cjs depois <pasta>
// Grava <pasta>/<versao>_<cena>_<tema>.png (mapa) e <versao>_<cena>_<tema>_leg.png (legenda). A visão normal, deuteranopia e
// protanopia sai de cores-montagem.py, que aplica a simulação nos PNG. Cenas: A1 e A2 (Planservi sintético com dez classes) e B (RoadRunner).
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { abrir, lancar, tema, VPS } = require('./lib.cjs');
const { aba } = require('./scenarios.cjs');
const { gerarPlanservi } = require('../sinteticos.cjs');

const [versao, pasta] = process.argv.slice(2);
if (!versao || !pasta) { console.error('uso: node cores.cjs <antes|depois> <pasta>'); process.exit(1); }
fs.mkdirSync(pasta, { recursive: true });

/** Dez classes em blocos de 5 linhas (100 m): a faixa 2 anda cinco blocos adiante, então cada classe faz fronteira com outra diferente. */
const CLASSES = [['REF', 'rev', 'PMQ4,0'], ['RP', 'est', 'RP'], ['GAP', 'fun', 'GAP'], ['F4R4', 'fre', 'F4R4'], ['MF', 'fun', 'MF'],
  ['ST', 'fun', 'ST'], ['F4R8', 'fre', 'F4R8'], ['VP', 'rev', '*'], ['FS3', 'fre', 'FS3'], ['RE', 'est', 'RE']];
const COL = { 1: { est: 'Q', fun: 'R', fre: 'S', rev: 'T' }, 2: { est: 'L', fun: 'M', fre: 'N', rev: 'O' } };

function cenaPlanservi() {
  const buf = gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10, n: 60, lat0: -15.2, lon0: -47.9, rumo: 90, curva: 0 });
  const wb = XLSX.read(buf), ws = wb.Sheets['SOLUÇÃO_FINAL'];
  const put = (r, l, v) => { const a = XLSX.utils.encode_cell({ r: r - 1, c: XLSX.utils.decode_col(l) }); if (v === null) delete ws[a]; else ws[a] = { t: 's', v }; };
  for (let r = 8; r <= 67; r++) for (const f of [1, 2]) for (const k of ['est', 'fun', 'fre', 'rev']) put(r, COL[f][k], k === 'est' ? '1' : null);
  for (let r = 8; r <= 67; r++) for (const f of [1, 2]) put(r, COL[f].est, null);
  for (let b = 0; b < 12; b++) for (let j = 0; j < 5; j++) {
    const r = 8 + b * 5 + j;
    if (r > 67) continue;
    const [, k1, v1] = CLASSES[b % 10], [, k2, v2] = CLASSES[(b + 5) % 10];
    put(r, COL[1][k1], v1); put(r, COL[2][k2], v2);
  }
  const f = path.join(os.tmpdir(), 'cores-cena-planservi.xlsx');
  XLSX.writeFile(wb, f);
  return f;
}

(async () => {
  const browser = await lancar();
  const vp = VPS.find((v) => v.nome === '1366x768');
  const fA = cenaPlanservi();
  for (const t of ['claro', 'escuro', 'campo']) {
    for (const cena of ['A', 'B']) {
      const opts = cena === 'A' ? { arquivos: [fA], projetos: 2 } : {};
      const { ctx, pg } = await abrir(browser, vp, opts);
      pg.on('dialog', (d) => d.accept());
      await tema(pg, t);
      // "Padrão além da cor" ligado: o pior caso de poluição visual
      await aba(pg, 'aj');
      if ((await pg.getAttribute('#s-pad', 'aria-checked')) !== 'true') await pg.click('#s-pad');
      await pg.waitForTimeout(600);
      await aba(pg, 'resumo');
      const tomadas = await pg.evaluate((cena) => {
        const E = window.__pavecad.E, m = window.__pavecad.map();
        const P = E.P.filter((p) => p.meta.travel > 0)[0];
        const dir = (a, b) => { const A = P.rows[a], B = P.rows[b]; return (Math.atan2((B.lon - A.lon) * Math.cos(A.lat * Math.PI / 180), B.lat - A.lat) * 180) / Math.PI; };
        if (cena === 'A') {
          return [{ i: 24, z: 18.2 }, { i: 54, z: 18.2 }].map(({ i, z }) => ({ lon: P.rows[i].lon, lat: P.rows[i].lat, z, b: dir(i - 2, i + 2) - 90 }));
        }
        // B: a janela de 16 linhas com mais classes diferentes (soluções) em todas as faixas
        let melhor = { n: 0, i: 0 };
        for (let i = 0; i + 16 < P.rows.length; i += 4) {
          const s = new Set();
          for (let j = i; j < i + 16; j++) { P.model[j].tr.forEach((t) => t.main !== '-' && s.add(t.main)); if (P.model[j].sh.main !== '-') s.add(P.model[j].sh.main); }
          if (s.size > melhor.n) melhor = { n: s.size, i, set: [...s] };
        }
        const c = melhor.i + 8;
        return [{ lon: P.rows[c].lon, lat: P.rows[c].lat, z: 18.4, b: dir(c - 4, c + 4) - 90, classes: melhor.set }];
      }, cena);
      if (cena === 'B') console.log(`  B (${t}): classes na janela: ${tomadas[0].classes.join(', ')}`);
      let k = 0;
      for (const tm of tomadas) {
        k++;
        await pg.evaluate((a) => window.__pavecad.map().jumpTo({ center: [a.lon, a.lat], zoom: a.z, bearing: a.b, pitch: 0 }), tm);
        await pg.waitForTimeout(1500);
        if (await pg.getAttribute('#legTog', 'aria-expanded') !== 'true') await pg.click('#legTog');
        await pg.waitForTimeout(500);
        const nome = `${versao}_${cena}${cena === 'A' ? k : ''}_${t}`;
        await pg.locator('#legend').screenshot({ path: path.join(pasta, nome + '_leg.png') });
        // mapa limpo: sem cartões por cima da via
        await pg.evaluate(() => document.documentElement.classList.add('limpo')); await pg.waitForTimeout(500);
        await pg.screenshot({ path: path.join(pasta, nome + '.png') });
        await pg.evaluate(() => document.documentElement.classList.remove('limpo'));
      }
      await ctx.close();
      console.log(`${versao} ${cena} ${t}`);
    }
  }
  await browser.close();
})();
