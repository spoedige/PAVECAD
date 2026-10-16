import type { Row } from '../formats/types';
import type { Project } from './project';
import { fromUtm } from './utm';

/** Núcleo de geometria. Função pura: recebe o projeto e as opções, devolve polígonos em
 *  metros projetados (SIRGAS 2000 UTM) com os índices de linha e faixa. Não conhece mapa.
 *  MapLibre, KML e IFC consomem o mesmo resultado.
 *
 *  Premissa: a coordenada da planilha está na borda esquerda da Fx 1 (0 m da seção) e as
 *  faixas crescem para a direita no sentido do tráfego; o acostamento externo vem depois da
 *  última faixa. Os deslocamentos usam metros reais sobre o plano UTM (o fator de escala do
 *  fuso, até 0,04%, é desprezado: 1,4 mm em 3,6 m). */

export interface GeoOptions {
  /** +1 crescente, -1 decrescente: inverte a normal lateral. */
  travel: 1 | -1;
  /** Sentido de crescimento das faixas: +1 direita, -1 esquerda. */
  dir: 1 | -1;
  /** Coordenada na borda da Fx 1 ou no eixo da Fx 1. */
  origin: 'edge' | 'axis';
  /** Janela do azimute, em pontos para cada lado (2 = 40 m). */
  win: number;
  shoulder: boolean;
  /** Deslocamento adicional em metros (ex.: marginal), no lado indicado por extraSide. */
  extra: number;
  extraSide: 1 | -1;
  /** Dreno na borda externa ou interna da pista. */
  drainSide: 'out' | 'in';
}

export const DEFAULT_OPTS: GeoOptions = {
  travel: 1, dir: 1, origin: 'edge', win: 2, shoulder: true, extra: 0, extraSide: 1, drainSide: 'out',
};

export type XY = [number, number];

export interface LanePoly {
  /** Índice da linha (início do segmento de 20 m). */
  row: number;
  /** 1 a 6 para faixas, 0 para o acostamento. */
  lane: number;
  /** Identificador estável: row*8 + lane (7 para o acostamento). */
  fid: number;
  /** Bordas lateral inicial e final, em metros a partir da coordenada. */
  e0: number;
  e1: number;
  /** Quadrilátero fechado (5 pontos) em metros projetados. */
  ring: XY[];
}

export interface DrainRun {
  type: string;
  r0: number;
  r1: number;
  pts: XY[];
}

export interface Geometry {
  opts: GeoOptions;
  /** Normal à direita do sentido de tráfego em cada linha; null onde não há azimute. */
  normals: ({ e: number; n: number } | null)[];
  polys: LanePoly[];
  drains: DrainRun[];
}

export const polyId = (row: number, lane: number) => row * 8 + (lane || 7);

/** Bordas laterais acumuladas da seção da linha i. */
export function edgesOf(row: Row, o: GeoOptions): { e: number[]; nLanes: number; hasShoulder: boolean } {
  const w1 = row.widths[0] || 3.6;
  const s0 = (o.origin === 'axis' ? (-o.dir * w1) / 2 : 0) + o.extraSide * o.extra;
  const e = [s0];
  let c = s0;
  for (const w of row.widths) {
    c += o.dir * w;
    e.push(c);
  }
  const hasShoulder = o.shoulder && row.shoulder > 0;
  if (hasShoulder) e.push(c + o.dir * row.shoulder);
  return { e, nLanes: row.widths.length, hasShoulder };
}

export function drainEdge(row: Row, o: GeoOptions): number {
  const { e } = edgesOf(row, o);
  return o.drainSide === 'in' ? e[0] - o.dir * 0.45 : e[e.length - 1] + o.dir * 0.45;
}

export function buildGeometry(p: Project, options: Partial<GeoOptions> = {}): Geometry {
  const o: GeoOptions = { ...DEFAULT_OPTS, travel: p.meta.travel, ...options };
  const R = p.rows;
  const normals: Geometry['normals'] = new Array(R.length).fill(null);

  for (const sg of p.segs) {
    for (let k = sg.a; k <= sg.b; k++) {
      const ka = Math.max(sg.a, k - o.win);
      const kb = Math.min(sg.b, k + o.win);
      if (ka === kb) continue;
      const th = Math.atan2(p.x[kb] - p.x[ka], p.y[kb] - p.y[ka]);
      normals[k] = { e: Math.cos(th) * o.travel, n: -Math.sin(th) * o.travel };
    }
  }
  const at = (i: number, off: number): XY => [p.x[i] + off * normals[i]!.e, p.y[i] + off * normals[i]!.n];

  const polys: LanePoly[] = [];
  const drains: DrainRun[] = [];
  for (const sg of p.segs) {
    for (let i = sg.a; i < sg.b; i++) {
      if (!normals[i] || !normals[i + 1]) continue;
      const { e, nLanes } = edgesOf(R[i], o);
      for (let k = 0; k < e.length - 1; k++) {
        const lane = k < nLanes ? k + 1 : 0;
        const a = e[k], b = e[k + 1];
        polys.push({ row: i, lane, fid: polyId(i, lane), e0: a, e1: b, ring: [at(i, a), at(i, b), at(i + 1, b), at(i + 1, a), at(i, a)] });
      }
    }

    let run: DrainRun | null = null;
    const flush = (i: number | null) => {
      if (!run) return;
      if (i !== null && normals[i]) run.pts.push(at(i, drainEdge(R[i], o)));
      if (run.pts.length >= 2) drains.push(run);
      run = null;
    };
    for (let i = sg.a; i <= sg.b; i++) {
      const d = R[i].drain;
      const t = d ? d[0] || d[1] : null;
      if (t && normals[i]) {
        if (run && run.type !== t) flush(i);
        if (!run) run = { type: t, r0: i, r1: i, pts: [] };
        run.pts.push(at(i, drainEdge(R[i], o)));
        run.r1 = i;
      } else flush(i);
    }
    flush(null);
  }
  return { opts: o, normals, polys, drains };
}

/** Converte um ponto projetado para [lon, lat] (ordem do GeoJSON). */
export function lonLat(p: Project, pt: XY): [number, number] {
  const [lat, lon] = fromUtm(p.crs, pt[0], pt[1]);
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}
