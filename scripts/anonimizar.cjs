#!/usr/bin/env node
/** Anonimiza planilhas e JSON de rodovias reais antes de qualquer coisa entrar no repositório.
 *
 *  Uso (entradas reais ficam em `dados-reais/`, que o .gitignore ignora):
 *    node scripts/anonimizar.cjs planservi  <entrada.xlsx> <saida.xlsx> --codigo TH01 [--rodovia RD-001] [--km 10]
 *    node scripts/anonimizar.cjs roadrunner <entrada.xlsx> <saida.xlsx>
 *    node scripts/anonimizar.cjs json       <entrada.json> <saida.json>
 *
 *  O que muda:
 *   - coordenadas ganham um deslocamento fixo (Planservi: +0,5° lat e +2,8° lon; RoadRunner e JSON: só +4,5° de latitude,
 *     para o meridiano de -48 continuar cortando a mesma linha do traçado);
 *   - nomes de rodovia viram nomes fictícios (BR-050 → BR-900; SP-333 → RD-001) e o código do trecho é trocado;
 *   - no Planservi o km é transladado para começar em --km (estaca e texto do trecho acompanham);
 *   - RoadRunner: só ficam as abas Solução e Unifilar, sem fórmulas, autor, empresa, nomes definidos nem outras abas
 *     (Premissas, Orçamento e SGP trazem concessionária, responsável e preços);
 *   - as anomalias geométricas (ponto repetido, salto, retrocesso) e os valores de IGG, IRI etc. ficam como estão. */
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const PLANSERVI = { dLat: 0.5, dLon: 2.8 };
const RR = { dLat: 4.5, dLon: 0 };

const arg = (nome, padrao) => { const i = process.argv.indexOf('--' + nome); return i > 0 ? process.argv[i + 1] : padrao; };
/** Matriz → planilha sem as células vazias (aoa_to_sheet gravaria cada null e inflaria o arquivo). */
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
const arred = (v, n = 8) => Number(v.toFixed(n));

/** Troca nomes reais por fictícios em qualquer texto. */
const NOMES = [[/BR-050/g, 'BR-900'], [/SP-333/g, 'RD-001'], [/SP-351/g, 'RD-002']];
const limpa = (s) => NOMES.reduce((t, [re, nv]) => t.replace(re, nv), s);

function propsNeutras(wb, app) {
  wb.Props = { Application: app, Author: 'anonimizado', Title: 'Dados fictícios', CreatedDate: new Date('2024-01-01T00:00:00Z') };
  wb.Custprops = {};
  delete wb.Workbook;
}

/* ---------- Planservi ---------- */
function planservi(entrada, saida) {
  const codigo = arg('codigo'), rodovia = arg('rodovia', 'RD-001'), kmNovo = Number(arg('km', '10'));
  if (!codigo) throw new Error('--codigo é obrigatório (ex.: TH01)');
  const wb = XLSX.readFile(entrada, { cellFormula: false, cellStyles: false });
  const ws = wb.Sheets['SOLUÇÃO_FINAL'];
  if (!ws) throw new Error('aba SOLUÇÃO_FINAL não encontrada: não parece um Planservi');
  const M = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hdr = M[2][1]; // "km 154,700 ao 155,900"
  const mm = /km (\d+),(\d+)/.exec(hdr);
  const kmIni = Number(mm[1]) + Number(mm[2]) / 1000, dKm = kmNovo - kmIni;
  const fmtEstaca = (km) => { const m = Math.round(km * 1000); return `${Math.floor(m / 1000)} + ${m % 1000}`; };
  const fmtKm = (km) => { const m = Math.round(km * 1000); return `${Math.floor(m / 1000)},${String(m % 1000).padStart(3, '0')}`; };
  const nova = M.map((lin, i) => lin.map((v, j) => {
    if (i === 1 && j === 1) return `${rodovia} - ${codigo}`;
    if (i === 2 && j === 1) return hdr.replace(/km (\d+),(\d+) ao (\d+),(\d+)/, (_, a, b, c, d) => `km ${fmtKm(Number(a) + Number(b) / 1000 + dKm)} ao ${fmtKm(Number(c) + Number(d) / 1000 + dKm)}`);
    if (i < 7) return typeof v === 'string' ? limpa(v) : v;
    if (j === 1 && typeof v === 'number') return arred(v + dKm, 3);
    if ((j === 2 || j === 3) && typeof v === 'string') { const e = /(\d+) \+ (\d+)/.exec(v); return e ? fmtEstaca(Number(e[1]) + Number(e[2]) / 1000 + dKm) : v; }
    if ((j === 4 || j === 6) && typeof v === 'number') return arred(v + PLANSERVI.dLat);
    if ((j === 5 || j === 7) && typeof v === 'number') return arred(v + PLANSERVI.dLon);
    return typeof v === 'string' ? limpa(v) : v;
  }));
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, planilha(nova), 'SOLUÇÃO_FINAL');
  XLSX.utils.book_append_sheet(out, planilha([['Rodovia:'], ['Trecho:']]), 'IRI');
  propsNeutras(out, 'SheetJS');
  XLSX.writeFile(out, saida);
}

/* ---------- RoadRunner ---------- */
function roadrunner(entrada, saida) {
  const wb = XLSX.readFile(entrada, { cellFormula: false, cellStyles: false, cellDates: false });
  const out = XLSX.utils.book_new();
  for (const nome of ['Solução', 'Unifilar']) {
    const ws = wb.Sheets[nome];
    if (!ws) throw new Error(`aba ${nome} não encontrada: não parece um RoadRunner`);
    const M = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    // colunas de latitude e longitude do Unifilar (ver C.lat/C.lon em src/formats/roadrunner.ts)
    const nv = M.map((lin, i) => lin.map((v, j) => {
      if (typeof v === 'string') return limpa(v);
      if (nome === 'Unifilar' && i >= 10 && typeof v === 'number') {
        if (j === 15) return arred(v + RR.dLat, 7);
        if (j === 16) return arred(v + RR.dLon, 7);
      }
      return v;
    }));
    XLSX.utils.book_append_sheet(out, planilha(nv), nome);
  }
  propsNeutras(out, 'SheetJS');
  XLSX.writeFile(out, saida);
}

/* ---------- JSON de referência (protótipo) ---------- */
function json(entrada, saida) {
  const d = JSON.parse(fs.readFileSync(entrada, 'utf-8'));
  const meta = JSON.parse(limpa(JSON.stringify(d.meta)));
  // linha: [hod, lat, lon, ...]
  const rows = d.rows.map((r) => { const c = r.slice(); c[1] = arred(c[1] + RR.dLat, 6); c[2] = arred(c[2] + RR.dLon, 6); return c; });
  fs.writeFileSync(saida, JSON.stringify({ meta, rows }));
}

const [modo, entrada, saida] = process.argv.slice(2);
const modos = { planservi, roadrunner, json };
if (!modos[modo] || !entrada || !saida) { console.error(fs.readFileSync(__filename, 'utf-8').split('*/')[0]); process.exit(1); }
fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
modos[modo](entrada, saida);
console.log(`${modo}: ${entrada} → ${saida}`);
