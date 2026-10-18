#!/usr/bin/env node
/** Gera planilhas Planservi sintéticas (nada real): o molde é a amostra anonimizada, e o traçado, o km e as anomalias vêm dos parâmetros.
 *  Uso como módulo: const { gerarPlanservi, conjuntoDeNove } = require('./sinteticos.cjs')
 *  Uso na linha de comando: node scripts/sinteticos.cjs <pasta>   (grava as 9 planilhas do teste de carga) */
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const MOLDE = path.resolve(__dirname, '..', 'testes/fixtures/planservi_amostra_1.xlsx');
const PRIMEIRA = 7; // primeira linha de dado do molde (60 linhas numeradas e 1 de fim)
const M_POR_GRAU = 111320;

let molde = null;
const matrizMolde = () => (molde ??= XLSX.utils.sheet_to_json(XLSX.readFile(MOLDE).Sheets['SOLUÇÃO_FINAL'], { header: 1, raw: true, defval: null }));

const fmtKm = (km) => { const m = Math.round(km * 1000); return `${Math.floor(m / 1000)},${String(m % 1000).padStart(3, '0')}`; };
const fmtEstaca = (km) => { const m = Math.round(km * 1000); return `${Math.floor(m / 1000)} + ${m % 1000}`; };

/** Matriz → planilha sem células vazias. */
function planilha(M) {
  const ws = {}; let maxC = 0;
  M.forEach((lin, r) => lin.forEach((v, c) => {
    if (v === null || v === undefined || v === '') return;
    ws[XLSX.utils.encode_cell({ r, c })] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
    if (c > maxC) maxC = c;
  }));
  ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(M.length - 1, 0), c: maxC });
  return ws;
}

/** Uma planilha Planservi (Buffer .xlsx).
 *  rodovia, codigo, kmIni: nome e km de partida; n: linhas de 20 m; lat0/lon0/rumo: partida e direção (graus, 0 = norte); curva: giro por linha (graus).
 *  anomalias (só no sentido crescente): inicioRepetido, saltoInicio (m), fimRetrocedendo (só a coordenada do ponto final), paradoMeio. */
function gerarPlanservi({ rodovia, codigo, kmIni, n = 60, lat0 = -15.2, lon0 = -47.9, rumo = 90, curva = 0.15, anomalias = {} }) {
  const mol = matrizMolde();
  const kmFim = kmIni + n * 0.02;
  const cab = mol.slice(0, PRIMEIRA).map((l) => l.slice());
  cab[1][1] = `${rodovia} - ${codigo}`;
  cab[2][1] = `km ${fmtKm(kmIni)} ao ${fmtKm(kmFim)}`;

  // traçado: posição em metros ao longo de um arco suave
  const px = [0], py = [0];
  let h = (rumo * Math.PI) / 180;
  for (let i = 1; i <= n; i++) { px.push(px[i - 1] + 20 * Math.sin(h)); py.push(py[i - 1] + 20 * Math.cos(h)); h += (curva * Math.PI) / 180; }
  const coordenada = (x, y) => [Number((lat0 + y / M_POR_GRAU).toFixed(8)), Number((lon0 + x / (M_POR_GRAU * Math.cos((lat0 * Math.PI) / 180))).toFixed(8))];
  // sentido decrescente: 10 m ao lado
  const lado = (i) => { const a = Math.atan2(px[Math.min(i + 1, n)] - px[Math.max(i - 1, 0)], py[Math.min(i + 1, n)] - py[Math.max(i - 1, 0)]); return [Math.cos(a) * 10, -Math.sin(a) * 10]; };

  const cresc = px.map((x, i) => [x, py[i]]);
  const a = anomalias;
  if (a.inicioRepetido) cresc[0] = cresc[1].slice();
  if (a.saltoInicio) { const d = Math.hypot(px[1] - px[0], py[1] - py[0]), ux = (px[1] - px[0]) / d, uy = (py[1] - py[0]) / d; cresc[0] = [px[1] - ux * a.saltoInicio, py[1] - uy * a.saltoInicio]; }
  if (a.fimRetrocedendo) { // a coordenada do ponto final volta 15 m para trás do último ponto numerado
    const ux = (px[n - 1] - px[n - 2]) / 20, uy = (py[n - 1] - py[n - 2]) / 20;
    cresc[n] = [px[n - 1] - ux * 15, py[n - 1] - uy * 15];
  }
  if (a.paradoMeio) { const i = Math.floor(n / 2); for (let k = 0; k < 4; k++) cresc[i + k] = cresc[i - 1].slice(); }

  const dados = [];
  for (let i = 0; i <= n; i++) {
    const base = mol[PRIMEIRA + (i % 60)].slice();
    const km = kmIni + i * 0.02;
    const [dx, dy] = lado(i);
    const [la, lo] = coordenada(...cresc[i]);
    const [lad, lod] = coordenada(px[i] + dx, py[i] + dy);
    if (i < n) { base[0] = i + 1; base[1] = Number(km.toFixed(3)); base[2] = fmtEstaca(km); base[3] = fmtEstaca(km + 0.02); }
    else { for (let c = 0; c < base.length; c++) base[c] = null; base[1] = Number(km.toFixed(3)); base[2] = fmtEstaca(km); }
    base[4] = la; base[5] = lo; base[6] = lad; base[7] = lod;
    dados.push(base);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, planilha([...cab, ...dados]), 'SOLUÇÃO_FINAL');
  XLSX.utils.book_append_sheet(wb, planilha([['Rodovia:'], ['Trecho:']]), 'IRI');
  wb.Props = { Application: 'SheetJS', Author: 'sintético', Title: 'Dados fictícios' };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** As 9 planilhas do teste de carga, em duas rodovias fictícias.
 *  RD-001: TH41 a TH45 seguidas (km 10 a 16), lacuna de 1,2 km onde estaria o TH46, e TH47.
 *  RD-002: TH48 a TH50 seguidas. Cada arquivo traz os dois sentidos, então são 18 projetos. */
function conjuntoDeNove() {
  const PASSO = 60 * 0.02; // 1,2 km por arquivo
  const f = [];
  let km = 10;
  for (const [i, th] of ['TH41', 'TH42', 'TH43', 'TH44', 'TH45'].entries()) {
    f.push({ arquivo: `sint_${th}.xlsx`, rodovia: 'RD-001', codigo: th, kmIni: Number(km.toFixed(3)), lat0: -15.2 + i * 0.0001, lon0: -47.9 + i * 0.0112, anomalias: th === 'TH41' ? { inicioRepetido: true } : th === 'TH43' ? { saltoInicio: 70 } : {} });
    km += PASSO;
  }
  km += PASSO; // TH46 não tem arquivo: lacuna
  f.push({ arquivo: 'sint_TH47.xlsx', rodovia: 'RD-001', codigo: 'TH47', kmIni: Number(km.toFixed(3)), lat0: -15.2 + 6 * 0.0001, lon0: -47.9 + 6 * 0.0112, anomalias: { saltoInicio: 206 } });
  km = 40;
  for (const [i, th] of ['TH48', 'TH49', 'TH50'].entries()) {
    f.push({ arquivo: `sint_${th}.xlsx`, rodovia: 'RD-002', codigo: th, kmIni: Number(km.toFixed(3)), lat0: -14.6 + i * 0.0001, lon0: -48.7 + i * 0.0112, rumo: 80, anomalias: th === 'TH50' ? { fimRetrocedendo: true } : {} });
    km += PASSO;
  }
  return f;
}

function gravarConjunto(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  return conjuntoDeNove().map((c) => { const arq = path.join(pasta, c.arquivo); fs.writeFileSync(arq, gerarPlanservi(c)); return arq; });
}

module.exports = { gerarPlanservi, conjuntoDeNove, gravarConjunto };

if (require.main === module) {
  const pasta = process.argv[2];
  if (!pasta) { console.error('uso: node scripts/sinteticos.cjs <pasta>'); process.exit(1); }
  gravarConjunto(pasta).forEach((a) => console.log(a));
}
