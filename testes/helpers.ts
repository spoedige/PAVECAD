import { createRequire } from 'node:module';
import { parseSpreadsheetAll } from '../src/formats';
import { prepareProject } from '../src/geometry/project';
import { DEFAULT_OPTS } from '../src/geometry/build';
import { modelOf } from '../src/dominio/modelo';
import type { FonteExport } from '../src/dominio/exportGeo';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParsedProject, Row } from '../src/formats/types';
import { parseSpreadsheet } from '../src/formats';
import { fromLegacy } from '../src/formats/legacy';

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

export function projetoDeReferencia(nome: string): ParsedProject {
  const d = dado(nome);
  return { meta: { ...d.meta, format: 'roadrunner' }, rows: d.rows.map(fromLegacy), log: [], codes: {} };
}

const { gerarPlanservi } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as { gerarPlanservi: (o: Record<string, unknown>) => Buffer };


/** Planilha sintética Planservi pronta para a exportação (fuso 22S fixo). */
export function fonte(o: Record<string, unknown> = {}): FonteExport {
  const [cr] = parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10, ...o })));
  const base = prepareProject(cr, { zone: 22 });
  return { id: 'p1', planilha: base.meta.name, rodovia: base.meta.uf, sentido: base.meta.travel > 0 ? 'Crescente' : 'Decrescente', base, opts: { ...DEFAULT_OPTS, travel: base.meta.travel }, model: modelOf(base.rows), km: (i) => base.kmLab[i] };
}

