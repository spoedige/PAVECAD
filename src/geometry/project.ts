import type { LogEntry, ParsedProject, ProjectMeta, Qualidade, Row } from '../formats/types';
import { kmLabel, parseMarco } from '../formats/km';
import { segmentsOf, type Seg } from '../formats/segments';
import { type Crs, crsForZone, toUtm, zoneOf } from './utm';

/** Projeto pronto para a geometria: trechos, rótulos de km e pontos em metros projetados. */
export interface Project {
  meta: ProjectMeta;
  rows: Row[];
  log: LogEntry[];
  codes: Record<string, number>;
  /** Verificação das coordenadas feita na importação (Planservi). */
  qualidade?: Qualidade;
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

export interface PrepareOptions {
  /** Fuso UTM a usar. Sem isso, vale o fuso da mediana das longitudes. Fixar por projeto
   *  garante que o IFC e a topografia usem o mesmo sistema em todas as exportações. */
  zone?: number;
}

export function prepareProject(p: ParsedProject, opt: PrepareOptions = {}): Project {
  const rows = p.rows;
  const segs = segmentsOf(rows.map((r) => r.hod));
  const segOf = new Int32Array(rows.length);
  segs.forEach((s, si) => {
    for (let i = s.a; i <= s.b; i++) segOf[i] = si;
  });
  const lons = rows.map((r) => r.lon).sort((a, b) => a - b);
  const crs = opt.zone ? crsForZone(opt.zone, 'fixo') : crsForZone(zoneOf(lons[lons.length >> 1]), 'mediana');
  const log = [...p.log];
  const z0 = zoneOf(lons[0]), z1 = zoneOf(lons[lons.length - 1]);
  log.push({
    level: z0 !== z1 ? 'warn' : 'info',
    code: 'fuso-utm',
    msg:
      `Fuso UTM ${crs.zone}S${crs.epsg ? ` (EPSG ${crs.epsg})` : ''}, ${crs.source === 'fixo' ? 'informado' : 'escolhido pela mediana das longitudes'}` +
      (z0 !== z1 ? `. O projeto cruza o limite entre os fusos ${z0}S e ${z1}S; a distorção fora do fuso é desprezível para o mapa e o KMZ.` : ''),
  });
  const x = new Float64Array(rows.length);
  const y = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    [x[i], y[i]] = toUtm(crs, r.lat, r.lon);
  });
  const kmNum = rows.map((r) => parseMarco(r.marco) ?? r.hod);
  return { ...p, log, segs, segOf, crs, x, y, kmNum, kmLab: kmNum.map(kmLabel) };
}
