import type { FormatDef, Lane, LogEntry, ParsedProject, Row, SheetBook } from './types';
import { parseCode } from './km';
import { segmentsOf } from './segments';

/**
 * Padrão RoadRunner: abas "Unifilar" e "Solução". Índices de coluna em base 0.
 * Unifilar a partir da linha 11 (índice 10), linhas com número na coluna 13.
 * Solução a partir da linha 10 (índice 9), linhas com número na coluna 2.
 * O vínculo entre abas é o hodômetro em metros.
 */
const U_FIRST = 10;
const S_FIRST = 9;
const C = {
  hod: 13, marco: 14, lat: 15, lon: 16, obs: 19,
  laneBlock: 21, laneStep: 17, treat: 9, fsTipo: 152,
  width: 176, shoulder: 182, he: 186,
  // Solução
  sHod: 2, sCode: 7, sShoulder: 13, sDrain: [15, 16], sDrainType: [18, 19], sPlatform: 21,
  sFs: [55, 62], sFse: [69, 76], sGap: 118,
} as const;

const num = (v: unknown, n = 2): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(n)) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const key = (km: number) => Math.round(km * 1000);

function readLane(r: unknown[], sr: unknown[] | undefined, n: number): Lane {
  const b = C.laneBlock + C.laneStep * n;
  const t = b + C.treat;
  const treat: (number | string)[] = [];
  for (let j = 0; j < 7; j++) {
    const v = r[t + j];
    treat.push(typeof v === 'string' ? (v === '' ? 0 : v) : v == null || v === 0 ? 0 : (v as number));
  }
  let fsEsp: number | null = null;
  let fsPct: number | null = null;
  if (sr) {
    for (const [ce, cp] of [C.sFs, C.sFse]) {
      const e = sr[ce + n];
      if (typeof e === 'number' && e) {
        fsEsp = e;
        fsPct = typeof sr[cp + n] === 'number' ? (sr[cp + n] as number) : null;
      }
    }
  }
  const tipo = r[C.fsTipo + n];
  const gap = sr?.[C.sGap + n];
  return {
    code: sr ? str(sr[C.sCode + n]) : null,
    iri: num(r[b]),
    defPct: num(r[b + 1], 3),
    atr: num(r[b + 2]),
    d0: num(r[b + 6]),
    rc: num(r[b + 7], 0),
    d120: num(r[b + 8]),
    opdr: str(r[b + 3]),
    exafe: str(r[b + 4]),
    hr: num(r[b + 5], 1),
    treat,
    fsTipo: tipo === 'C' || tipo === 'D' ? tipo : null,
    fsEsp,
    fsPct,
    gapCm: typeof gap === 'number' && gap ? num(gap) : null,
  };
}

/** Dreno: "?" quando a coluna de presença está marcada mas o tipo (R ou P) veio vazio.
 *  Nas planilhas conferidas só a coluna 16 é preenchida; a 15 vem sempre vazia, o que
 *  não é erro de leitura. Os nomes "Crescente" e "Decrescente" das colunas não indicam
 *  o sentido da pista. As duas são lidas e unidas. */
function readDrain(sr: unknown[] | undefined): Row['drain'] {
  if (!sr) return null;
  const one = (i: number): string | null => {
    const tipo = str(sr[C.sDrainType[i]]);
    const mark = sr[C.sDrain[i]];
    return tipo ?? (mark !== null && mark !== undefined && mark !== '' ? '?' : null);
  };
  const d: [string | null, string | null] = [one(0), one(1)];
  return d[0] === null && d[1] === null ? null : d;
}

export const roadrunner: FormatDef = {
  id: 'roadrunner',
  label: 'RoadRunner',

  detect: (wb: SheetBook) => wb.names.includes('Unifilar') && wb.names.includes('Solução'),

  parse(wb: SheetBook): ParsedProject[] {
    const log: LogEntry[] = [];
    const solRows = wb.sheet('Solução');
    const U = wb.sheet('Unifilar').filter((r, i) => i >= U_FIRST && typeof r[C.hod] === 'number');
    const S = solRows.filter((r, i) => i >= S_FIRST && typeof r[C.sHod] === 'number');
    if (!U.length) throw new Error('nenhuma linha com hodômetro na aba Unifilar');

    const sol = new Map(S.map((r) => [key(r[C.sHod] as number), r]));
    const rows: Row[] = U.map((r) => {
      const sr = sol.get(key(r[C.hod] as number));
      const all = [0, 1, 2, 3, 4, 5].map((i) => (typeof r[C.width + i] === 'number' ? (r[C.width + i] as number) : 0));
      const nl = all.filter((w) => w > 0).length;
      const lanes: Lane[] = [];
      for (let n = 0; n < nl; n++) lanes.push(readLane(r, sr, n));
      return {
        hod: r[C.hod] as number,
        lat: Number((r[C.lat] as number).toFixed(7)),
        lon: Number((r[C.lon] as number).toFixed(7)),
        z: null,
        widths: all.slice(0, nl),
        shoulder: (r[C.shoulder] as number) || 0,
        shoulderCode: sr ? str(sr[C.sShoulder]) : null,
        obs: str(r[C.obs]),
        platform: sr ? str(sr[C.sPlatform]) : null,
        lanes,
        marco: str(r[C.marco]),
        drain: readDrain(sr),
        he: [num(r[C.he], 0), num(r[C.he + 1], 0)],
      };
    });

    // Linhas da Solução sem par no Unifilar: ignora e registra.
    const keys = new Set(rows.map((r) => key(r.hod)));
    const orphans = S.filter((r) => !keys.has(key(r[C.sHod] as number)));
    if (orphans.length) {
      const kms = orphans.map((r) => (r[C.sHod] as number).toFixed(3)).join(', ');
      log.push({
        level: 'info',
        code: 'solucao-sem-par',
        msg: `${orphans.length} linha${orphans.length > 1 ? 's' : ''} da Solução sem par no Unifilar ignorada${orphans.length > 1 ? 's' : ''} (km ${kms})`,
      });
    }
    const semSol = rows.filter((r) => !sol.has(key(r.hod))).length;
    if (semSol) log.push({ level: 'warn', code: 'unifilar-sem-solucao', msg: `${semSol} linha(s) do Unifilar sem linha na Solução` });

    // Acostamento 0 no primeiro ponto de um trecho: assume o próximo valor diferente de zero do mesmo trecho.
    for (const sg of segmentsOf(rows.map((r) => r.hod))) {
      if (rows[sg.a].shoulder !== 0) continue;
      for (let i = sg.a + 1; i <= sg.b; i++) {
        if (rows[i].shoulder > 0) {
          log.push({
            level: 'info',
            code: 'acostamento-primeiro-ponto',
            msg: `Acostamento 0 no primeiro ponto do trecho (marco ${rows[sg.a].marco ?? rows[sg.a].hod}); assumido ${rows[i].shoulder} m`,
          });
          rows[sg.a].shoulder = rows[i].shoulder;
          break;
        }
      }
    }

    const codes: Record<string, number> = {};
    const count = (c: string | null) => {
      if (c) codes[parseCode(c).main] = (codes[parseCode(c).main] || 0) + 1;
    };
    for (const r of rows) {
      r.lanes.forEach((l) => count(l.code));
      count(r.shoulderCode);
    }

    const name = (typeof solRows[1]?.[2] === 'string' && (solRows[1][2] as string)) || 'Projeto';
    const parts = name.split(' - ').map((s) => s.trim());
    const kmi = solRows[2]?.[2];
    const kmf = solRows[3]?.[2];
    return [{
      meta: {
        name,
        uf: parts[0],
        via: parts.slice(1).join(' - '),
        travel: /Decrescente/.test(name) ? -1 : 1,
        kmi: typeof kmi === 'number' ? kmi : null,
        kmf: typeof kmf === 'number' ? kmf : null,
        format: 'roadrunner',
      },
      rows,
      log,
      codes,
    }];
  },
};
