import type { LogEntry, ParsedProject, ProjectMeta, Row } from '../formats/types';
import { kmLabel, parseMarco } from '../formats/km';
import { segmentsOf, type Seg } from '../formats/segments';
import { type Crs, crsForZone, toUtm, zoneOf } from './utm';

/** Projeto pronto para a geometria: trechos, rótulos de km e pontos em metros projetados. */
export interface Project {
  meta: ProjectMeta;
  rows: Row[];
  log: LogEntry[];
  codes: Record<string, number>;
  segs: Seg[];
  /** Trecho de cada linha. */
  segOf: Int32Array;
  crs: Crs;
  /** Eixo da seção (coordenada da planilha) em metros projetados. */
  x: Float64Array;
  y: Float64Array;
  /** Km numérico do marco (normalizado por metros totais). */
  kmNum: number[];
  /** Rótulo exibido, "59+940". */
  kmLab: string[];
}

export function prepareProject(p: ParsedProject): Project {
  const rows = p.rows;
  const segs = segmentsOf(rows.map((r) => r.hod));
  const segOf = new Int32Array(rows.length);
  segs.forEach((s, si) => {
    for (let i = s.a; i <= s.b; i++) segOf[i] = si;
  });
  const lons = rows.map((r) => r.lon).sort((a, b) => a - b);
  const crs = crsForZone(zoneOf(lons[lons.length >> 1]));
  const x = new Float64Array(rows.length);
  const y = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    [x[i], y[i]] = toUtm(crs, r.lat, r.lon);
  });
  const kmNum = rows.map((r) => parseMarco(r.marco) ?? r.hod);
  return { ...p, segs, segOf, crs, x, y, kmNum, kmLab: kmNum.map(kmLabel) };
}
