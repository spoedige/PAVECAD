import { describe, it, expect } from 'vitest';
import { CATALOGO_PADRAO } from '../src/dominio/catalogo';
import { PADRAO_DE_PAR } from '../src/dominio/indicadores';

/** CIEDE2000 e simulação de daltonismo (Machado 2009, severidade 1) para conferir os pares de cor do catálogo. */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const D65 = [0.95047, 1, 1.08883];
function lab(c: number[]) {
  const [r, g, b] = c.map(lin);
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X / D65[0]), fy = f(Y / D65[1]), fz = f(Z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dr = (x: number) => (x * Math.PI) / 180, rd = (x: number) => (x * 180) / Math.PI;
function de2000(l1: number[], l2: number[]) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (rd(Math.atan2(b, a)) + 360) % 360);
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dr(dhp / 2)), dLp = L2 - L1, dCp = C2p - C1p;
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = (h1p + h2p) / 2;
  if (C1p * C2p === 0) hpm = h1p + h2p; else if (Math.abs(h1p - h2p) > 180) hpm = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(dr(hpm - 30)) + 0.24 * Math.cos(dr(2 * hpm)) + 0.32 * Math.cos(dr(3 * hpm + 6)) - 0.2 * Math.cos(dr(4 * hpm - 63));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(dr(2 * 30 * Math.exp(-(((hpm - 275) / 25) ** 2)))) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const M = {
  prot: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deut: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const sim = (c: number[], m: number[][]) => { const l = c.map(lin); return m.map((r) => gam(Math.max(0, Math.min(1, r[0] * l[0] + r[1] * l[1] + r[2] * l[2])))); };
const tres = (a: string, b: string) => [de2000(lab(rgb(a)), lab(rgb(b))), de2000(lab(sim(rgb(a), M.deut)), lab(sim(rgb(b), M.deut))), de2000(lab(sim(rgb(a), M.prot)), lab(sim(rgb(b), M.prot)))];

const cor = (cod: string, campo: boolean) => { const i = CATALOGO_PADRAO.find((x) => x.codigo === cod)!; return campo ? i.corCampo : i.cor; };

describe('pares de cor do catálogo', () => {
  it('CIEDE2000 confere com o par de referência de Sharma (2,0425)', () => {
    expect(de2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });
  const alvos: [string, string, boolean][] = [
    ['F4R4', 'F4R8', false], ['F4R4', 'F4R8', true], ['FS3', 'MFS', false], ['FS3', 'MF', false], ['FS3', 'F4R8', true],
  ];
  for (const [a, b, campo] of alvos) {
    it(`${a} x ${b} ${campo ? '(campo)' : '(claro e escuro)'}: ΔE00 ≥ 15 em visão normal, deuteranopia e protanopia`, () => {
      const t = tres(cor(a, campo), cor(b, campo));
      t.forEach((v) => expect(v).toBeGreaterThanOrEqual(15));
    });
  }
  it('GAP e Micro têm padrões diferentes entre si e do RP (diagonal)', () => {
    expect(PADRAO_DE_PAR.GAP).toBe('pontos');
    expect(PADRAO_DE_PAR.Micro).toBe('linhas');
    expect(PADRAO_DE_PAR.GAP).not.toBe(PADRAO_DE_PAR.Micro);
  });
});
