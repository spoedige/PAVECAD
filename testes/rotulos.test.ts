import { describe, expect, it } from 'vitest';
import { PRIO, prioDeEstaca } from '../src/app/rotulos';
import { tituloDe } from '../src/dominio/titulo';

describe('prioridade dos rótulos de estaca', () => {
  it('km inteiro vence 500 m, que vence 100 m, que vence 20 m', () => {
    expect(prioDeEstaca(26000)).toBe(PRIO.km);
    expect(prioDeEstaca(135000)).toBe(PRIO.km);
    expect(prioDeEstaca(26500)).toBe(PRIO.meio);
    expect(prioDeEstaca(26300)).toBe(PRIO.cem);
    expect(prioDeEstaca(26320)).toBe(PRIO.vinte);
    expect(PRIO.km).toBeLessThan(PRIO.meio);
    expect(PRIO.meio).toBeLessThan(PRIO.cem);
    expect(PRIO.cem).toBeLessThan(PRIO.vinte);
  });
});

describe('título da coluna esquerda', () => {
  const m = (uf: string) => ({ meta: { uf } });
  it('uma rodovia, um estado', () => expect(tituloDe([m('BR-050/MG'), m('BR-050/MG')])).toBe('BR-050 · MG'));
  it('uma rodovia, vários estados', () => expect(tituloDe([m('BR-050/MG'), m('BR-050/GO')])).toBe('BR-050 · GO, MG'));
  it('várias rodovias', () => expect(tituloDe([m('BR-050/MG'), m('BR-153/SP')])).toBe('BR-050 · MG + BR-153 · SP'));
  it('sem planilhas', () => expect(tituloDe([])).toBe('PAVTRACK'));
  it('rodovia sem estado', () => expect(tituloDe([m('BR-050')])).toBe('BR-050'));
});
