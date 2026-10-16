/// <reference lib="webworker" />
import { parseSpreadsheet } from '../formats';
import type { ParsedProject } from '../formats/types';
import { buildGeometry, type GeoOptions } from '../geometry/build';
import { prepareProject, type Project } from '../geometry/project';
import { buildCamadas, type Camadas } from './camadas';
import { setLimites, type Limites } from '../dominio/indicadores';

/** Leitura da planilha e geometria fora da thread da tela. */
/** Todo pedido leva os limiares de classe ativos: a pré-classificação das feições roda aqui. */
export type Req = { limites?: Limites } & (
  | { id: number; tipo: 'carregar'; pid: string; dados: ArrayBuffer; zone?: number; opts?: Partial<GeoOptions> }
  | { id: number; tipo: 'parsed'; pid: string; parsed: ParsedProject; zone?: number; opts?: Partial<GeoOptions> }
  | { id: number; tipo: 'recalcular'; pid: string; projeto: Project; opts: Partial<GeoOptions> });

export interface Normais { e: number; n: number }
export type Res =
  | { id: number; ok: true; projeto: Project; opts: GeoOptions; normals: (Normais | null)[]; camadas: Camadas }
  | { id: number; ok: false; erro: string };

function rodar(projeto: Project, pid: string, opts: Partial<GeoOptions>) {
  const g = buildGeometry(projeto, opts);
  return { projeto, opts: g.opts, normals: g.normals, camadas: buildCamadas(projeto, g, pid) };
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const r = ev.data;
  try {
    if (r.limites) setLimites(r.limites);
    const projeto =
      r.tipo === 'carregar' ? prepareProject(parseSpreadsheet(new Uint8Array(r.dados)), { zone: r.zone })
      : r.tipo === 'parsed' ? prepareProject(r.parsed, { zone: r.zone })
      : r.projeto;
    const out = rodar(projeto, r.pid, r.opts ?? {});
    (self as unknown as Worker).postMessage({ id: r.id, ok: true, ...out } satisfies Res);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: r.id, ok: false, erro: (e as Error).message } satisfies Res);
  }
};
