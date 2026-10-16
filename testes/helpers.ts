import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParsedProject, Row } from '../src/formats/types';
import { parseSpreadsheet } from '../src/formats';

const raiz = resolve(import.meta.dirname, '..');
export const fixture = (nome: string) => resolve(raiz, 'testes/fixtures', nome);
export const dado = (nome: string) => JSON.parse(readFileSync(resolve(raiz, 'referencia/dados', nome), 'utf-8'));

const cache = new Map<string, ParsedProject>();
export function lerPlanilha(nome: string): ParsedProject {
  if (!cache.has(nome)) cache.set(nome, parseSpreadsheet(new Uint8Array(readFileSync(fixture(nome)))));
  return cache.get(nome)!;
}

/** Linha no formato de tupla do protótipo (referencia/dados/*.json). */
export function toLegacy(r: Row) {
  return [
    r.hod, r.lat, r.lon, r.widths, r.shoulder, r.shoulderCode, r.obs, r.platform,
    r.lanes.map((l) => [l.code, l.iri, l.defPct, l.atr, l.d0, l.rc, l.d120, l.opdr, l.exafe, l.hr, l.treat, l.fsTipo, l.fsEsp, l.fsPct, l.gapCm]),
    r.marco, r.drain, r.he,
  ];
}

/** Inverso de toLegacy: lê uma linha de tupla dos JSON de referência. */
export function fromLegacy(t: any[]): Row {
  return {
    hod: t[0], lat: t[1], lon: t[2], z: null, widths: t[3], shoulder: t[4], shoulderCode: t[5], obs: t[6], platform: t[7],
    lanes: t[8].map((l: any[]) => ({
      code: l[0], iri: l[1], defPct: l[2], atr: l[3], d0: l[4], rc: l[5], d120: l[6], opdr: l[7], exafe: l[8], hr: l[9],
      treat: l[10], fsTipo: l[11], fsEsp: l[12], fsPct: l[13], gapCm: l[14],
    })),
    marco: t[9], drain: t[10], he: t[11],
  };
}

export function projetoDeReferencia(nome: string): ParsedProject {
  const d = dado(nome);
  return { meta: { ...d.meta, format: 'roadrunner' }, rows: d.rows.map(fromLegacy), log: [], codes: {} };
}
