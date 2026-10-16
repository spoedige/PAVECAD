import type { GeoOptions } from '../geometry/build';
import { getLimites } from '../dominio/indicadores';
import type { ParsedProject } from '../formats/types';
import type { Project } from '../geometry/project';
import type { Req, Res } from './worker';

type Ok = Extract<Res, { ok: true }>;
type Pedido = Req extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

let worker: Worker | null = null;
let seq = 0;
const espera = new Map<number, { ok: (r: Ok) => void; erro: (e: Error) => void }>();

function iniciar(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<Res>) => {
    const r = ev.data, w = espera.get(r.id);
    if (!w) return;
    espera.delete(r.id);
    r.ok ? w.ok(r) : w.erro(new Error(r.erro));
  };
  worker.onerror = (e) => {
    for (const w of espera.values()) w.erro(new Error(e.message || 'falha no worker'));
    espera.clear();
  };
  return worker;
}

function chamar(req: Pedido, transfer: Transferable[] = []): Promise<Ok> {
  const id = ++seq;
  return new Promise((ok, erro) => {
    espera.set(id, { ok, erro });
    iniciar().postMessage({ ...req, id, limites: getLimites() }, transfer);
  });
}

export const carregarPlanilha = (pid: string, dados: ArrayBuffer, zone?: number) =>
  chamar({ tipo: 'carregar', pid, dados, zone }, [dados]);

export const recalcular = (pid: string, projeto: Project, opts: Partial<GeoOptions>) =>
  chamar({ tipo: 'recalcular', pid, projeto, opts });

/** Projeto já lido (por exemplo, dos JSON de exemplo em desenvolvimento). */
export const carregarLido = (pid: string, parsed: ParsedProject, zone?: number) =>
  chamar({ tipo: 'parsed', pid, parsed, zone });
