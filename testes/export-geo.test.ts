import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheetAll, kmLabel } from '../src/formats';
import { prepareProject } from '../src/geometry/project';
import { buildGeometry, DEFAULT_OPTS } from '../src/geometry/build';
import { fromUtm, toUtm } from '../src/geometry/utm';
import { modelOf } from '../src/dominio/modelo';
import {
  anelSimples, areaAnel, montarModelo, nomeArquivo, NOTAS_POR_PADRAO, opcoesEfetivas, opcoesPadrao, relatorioDe, type FonteExport,
} from '../src/dominio/exportGeo';

const { gerarPlanservi } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as { gerarPlanservi: (o: Record<string, unknown>) => Buffer };

export function fonte(o: Record<string, unknown> = {}): FonteExport {
  const [cr] = parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10, ...o })));
  const base = prepareProject(cr, { zone: 22 });
  return { id: 'p1', planilha: base.meta.name, rodovia: base.meta.uf, sentido: base.meta.travel > 0 ? 'Crescente' : 'Decrescente', base, opts: { ...DEFAULT_OPTS, travel: base.meta.travel }, model: modelOf(base.rows), km: (i) => base.kmLab[i] };
}

describe('núcleo da exportação', () => {
  const f = fonte();
  const resumo = montarModelo([f], opcoesPadrao('kmz'));
  const trecho = montarModelo([f], { ...opcoesPadrao('kmz'), detalhe: 'trecho' });

  it('resumido une trechos contíguos iguais; por trecho mantém um por linha', () => {
    expect(trecho.faixas.every((t) => t.unidos === 1)).toBe(true);
    expect(resumo.faixas.length).toBeLessThan(trecho.faixas.length);
    const soma = (m: typeof resumo) => m.faixas.reduce((s, t) => s + t.area, 0);
    expect(soma(resumo)).toBeCloseTo(soma(trecho), 3);
    expect(resumo.faixas.reduce((s, t) => s + t.unidos, 0)).toBe(trecho.faixas.length);
  });

  it('a área e a extensão unidas conferem com a soma dos trechos de 20 m', () => {
    const ext = (m: typeof resumo) => m.faixas.reduce((s, t) => s + t.ext, 0);
    expect(ext(resumo)).toBeCloseTo(ext(trecho), 6);
  });

  it('anéis fechados, simples, anti-horários e sem degenerados', () => {
    for (const t of resumo.faixas) {
      expect(t.ring[0]).toEqual(t.ring[t.ring.length - 1]);
      expect(anelSimples(t.ring)).toBe(true);
      expect(t.area).toBeGreaterThan(1);
      let s = 0;
      for (let i = 0; i < t.ring.length - 1; i++) s += t.ring[i][0] * t.ring[i + 1][1] - t.ring[i + 1][0] * t.ring[i][1];
      expect(s).toBeGreaterThan(0);
      expect(areaAnel(t.ring)).toBeCloseTo(t.area, 9);
    }
  });

  it('só entram trechos com solução e o código de cada um vem do modelo', () => {
    expect(resumo.faixas.every((t) => t.codigo !== '-')).toBe(true);
    for (const t of trecho.faixas.slice(0, 40)) {
      const s = t.lane ? f.model[t.r0].tr[t.lane - 1] : f.model[t.r0].sh;
      expect(s.main).toBe(t.codigo);
    }
  });

  it('filtros: faixa, sentido e rodovia', () => {
    const fx1 = montarModelo([f], { ...opcoesPadrao('kmz'), faixa: 1 });
    expect(fx1.faixas.length).toBeGreaterThan(0);
    expect(fx1.faixas.every((t) => t.lane === 1)).toBe(true);
    const oposto = f.sentido === 'Crescente' ? 'decrescente' : 'crescente';
    expect(montarModelo([f], { ...opcoesPadrao('kmz'), sentido: oposto }).faixas.length).toBe(0);
    expect(montarModelo([f], { ...opcoesPadrao('kmz'), rodovias: ['outra'] }).faixas.length).toBe(0);
    expect(montarModelo([f], { ...opcoesPadrao('kmz'), rodovias: [f.rodovia] }).faixas.length).toBe(resumo.faixas.length);
  });

  it('camadas: estacas a cada 100 m e patologias só quando ligadas', () => {
    expect(resumo.estacas.length).toBe(0);
    expect(resumo.patologias.length).toBe(0);
    const c = montarModelo([f], { ...opcoesPadrao('kmz'), camadas: { ...opcoesPadrao('kmz').camadas, estacas: true, patologias: true } });
    expect(c.estacas.length).toBeGreaterThan(5);
    for (const e of c.estacas.slice(1)) expect(e.km).toMatch(/^\d+\+\d00$|^\d+\+000$/);
  });

  it('relatório: elementos, trechos unidos e validação', () => {
    const r = relatorioDe(resumo, { ok: true, detalhe: 'ok' });
    expect(r.elementos).toBe(resumo.faixas.length + resumo.drenos.length);
    expect(r.unidos).toBe(trecho.faixas.length - resumo.faixas.length);
  });

  it('projeção UTM com ponto conhecido: ida e volta no fuso 22S', () => {
    const crs = f.base.crs;
    expect(crs.epsg).toBe(31982);
    const [x, y] = toUtm(crs, 0 - 15.7801, -47.9292 + 0);
    const [lat, lon] = fromUtm(crs, x, y);
    expect(lat).toBeCloseTo(-15.7801, 7);
    expect(lon).toBeCloseTo(-47.9292, 7);
    const [x0, y0] = toUtm(crs, -23.5, -51); // meridiano central do fuso 22 (-51°): x = 500000
    expect(x0).toBeCloseTo(500000, 3);
    expect(y0).toBeGreaterThan(7.4e6);
    expect(y0).toBeLessThan(7.5e6);
  });

  it('opções por formato: notas só entram onde são permitidas', () => {
    for (const fm of NOTAS_POR_PADRAO) expect(opcoesEfetivas(fm, { ...opcoesPadrao(fm), notas: false }).notas).toBe(true);
    for (const fm of ['kmz', 'kml', 'ifc'] as const) {
      expect(opcoesPadrao(fm).notas).toBe(false);
      expect(opcoesEfetivas(fm, opcoesPadrao(fm)).notas).toBe(false);
      expect(opcoesEfetivas(fm, { ...opcoesPadrao(fm), notas: true }).notas).toBe(true);
    }
    expect(opcoesEfetivas('ifc', { ...opcoesPadrao('ifc'), detalhe: 'completo' }).detalhe).toBe('trecho');
    expect(opcoesEfetivas('kmz', { ...opcoesPadrao('kmz'), detalhe: 'completo' }).camadas.estacas).toBe(true);
  });

  it('nome do arquivo no padrão PAVECAD_[planilha]_AAAA-MM-DD_HHmm', () => {
    expect(nomeArquivo('PAVECAD', 'kmz', 'RD-001 · TH01 · Crescente', new Date(2026, 2, 5, 9, 7))).toBe('PAVECAD_RD-001-TH01-Crescente_2026-03-05_0907.kmz');
  });

  it('a geometria usada é a da tela (buildGeometry)', () => {
    const g = buildGeometry(f.base, f.opts);
    const q = g.polys.find((p) => p.lane === 1 && !p.invalido)!;
    const t = trecho.faixas.find((x) => x.lane === 1 && x.r0 === q.row);
    expect(t).toBeTruthy();
    expect(t!.area).toBeCloseTo(areaAnel(q.ring), 6);
    expect(new Set(t!.ring.map((p) => p.join()))).toEqual(new Set(q.ring.map((p) => p.join())));
    expect(kmLabel(f.base.kmNum[0])).toBe(f.km(0));
  });
});
