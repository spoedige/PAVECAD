import type { Row } from './types';

/** Inverso de toLegacy: lê uma linha de tupla dos JSON de referência. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

