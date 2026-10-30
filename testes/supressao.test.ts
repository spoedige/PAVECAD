import { describe, expect, it } from 'vitest';
import { chaveSup, linhasCompactadas, trechosSuprimidos } from '../src/dominio/supressao';
import type { RowModel } from '../src/dominio/modelo';

const sc = (main: string) => ({ main } as RowModel['sh']);
/** Linhas de 20 m. `f1` e `ac` são as soluções da faixa 1 e do acostamento, uma letra por linha ('-' = sem intervenção). */
function monta(f1: string[], ac: string[]) {
  const modelo: RowModel[] = f1.map((m, i) => ({ tr: [sc(m)], sh: sc(ac[i]) }));
  return { modelo, hod: f1.map((_, i) => i * 0.02), temAcost: f1.map(() => true) };
}
const livres = (n: number) => Array(n).fill('-') as string[];

describe('supressão de trechos longos sem intervenção', () => {
  it('só suprime acima do limite, por faixa', () => {
    const f1 = [...livres(60), 'A', ...livres(40)]; // 1,2 km livres, 1 linha, 0,8 km livres
    const ac = Array(f1.length).fill('X');
    const { modelo, hod, temAcost } = monta(f1, ac);
    const s = trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: false });
    expect(s.has(chaveSup(0, 1))).toBe(true);
    expect(s.has(chaveSup(59, 1))).toBe(true);
    expect(s.has(chaveSup(60, 1))).toBe(false);
    expect(s.has(chaveSup(70, 1))).toBe(false);
    expect(s.has(chaveSup(0, 0))).toBe(false);
  });
  it('sequência de exatamente o limite não é suprimida', () => {
    const f1 = livres(50), { modelo, hod, temAcost } = monta(f1, f1.map(() => 'X'));
    expect(trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: false }).size).toBe(0);
  });
  it('unir faixas: só sai onde faixa e acostamento estão livres juntas', () => {
    const f1 = livres(100), ac = [...livres(40), ...Array(60).fill('X')];
    const { modelo, hod, temAcost } = monta(f1, ac);
    const separado = trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: false });
    expect(separado.has(chaveSup(10, 1))).toBe(true); // faixa 1 livre por 2 km
    expect(separado.has(chaveSup(10, 0))).toBe(false); // acostamento livre só 0,8 km
    const junto = trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: true });
    expect(junto.size).toBe(0); // o trecho livre das duas tem 0,8 km
  });
  it('unir faixas: suprime as duas de uma vez', () => {
    const { modelo, hod, temAcost } = monta(livres(80), livres(80));
    const s = trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: true });
    expect(s.has(chaveSup(0, 1))).toBe(true);
    expect(s.has(chaveSup(79, 0))).toBe(true);
  });
  it('quebra de km encerra a sequência', () => {
    const f1 = livres(80), { modelo, temAcost } = monta(f1, f1);
    const hod = f1.map((_, i) => i * 0.02 + (i >= 40 ? 5 : 0));
    expect(trechosSuprimidos(modelo, hod, temAcost, { minKm: 1, unir: false }).size).toBe(0);
  });
  it('linhas compactadas: a faixa suprimida fica sem largura e as outras mantêm a sua', () => {
    const rows = [{ widths: [3.6, 3.6], shoulder: 2.5 }, { widths: [3.6, 3.6], shoulder: 2.5 }] as never[];
    const r = linhasCompactadas(rows, new Set([chaveSup(0, 1), chaveSup(0, 0)])) as { widths: number[]; shoulder: number }[];
    expect(r[0].widths).toEqual([0, 3.6]);
    expect(r[0].shoulder).toBe(0);
    expect(r[1]).toBe(rows[1]); // linha sem mudança não é copiada
    expect(linhasCompactadas(rows, new Set())).toBe(rows);
  });
});
