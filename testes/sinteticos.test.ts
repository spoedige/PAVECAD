import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { agruparBlocos } from '../src/dominio/blocosUnifilar';
import { parseSpreadsheetAll } from '../src/formats';
import type { ParsedProject } from '../src/formats/types';
import { buildGeometry } from '../src/geometry/build';
import { prepareProject } from '../src/geometry/project';

const { gerarPlanservi, conjuntoDeNove } = createRequire(import.meta.url)('../scripts/sinteticos.cjs') as {
  gerarPlanservi: (o: Record<string, unknown>) => Buffer;
  conjuntoDeNove: () => ({ arquivo: string; rodovia: string; codigo: string; kmIni: number } & Record<string, unknown>)[];
};

const ler = (o: Record<string, unknown>) => parseSpreadsheetAll(new Uint8Array(gerarPlanservi({ rodovia: 'RD-001', codigo: 'TH01', kmIni: 10, ...o })));

describe('planilhas sintéticas com cada anomalia das pontas (nada real)', () => {
  it('sem anomalia: nenhum ponto reconstruído', () => {
    const [c] = ler({});
    expect(c.qualidade?.corrigidos ?? []).toEqual([]);
    expect(c.qualidade?.cortes ?? []).toEqual([]);
  });

  it('início repetido: o primeiro ponto vira ponto novo, 20 m antes do segundo', () => {
    const [c] = ler({ anomalias: { inicioRepetido: true } });
    const x = c.qualidade!.corrigidos!;
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ i: 0, tipo: 'inicial', causa: 'repetido' });
    const [a, b] = c.rows;
    expect(Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180))).toBeCloseTo(20, 0);
  });

  it.each([[70], [206]])('salto de %i m no primeiro passo vira ponto inicial a 20 m, sem cortar a linha', (m) => {
    const [c] = ler({ anomalias: { saltoInicio: m } });
    const x = c.qualidade!.corrigidos!;
    expect(x[0]).toMatchObject({ i: 0, tipo: 'inicial', causa: 'salto' });
    expect(x[0].deslocamento).toBeGreaterThan(m - 25);
    expect(c.qualidade?.cortes ?? []).toEqual([]);
  });

  it('fim retrocedendo: a coordenada final é descartada e o ponto sai pelo km, à frente do último', () => {
    const [c] = ler({ anomalias: { fimRetrocedendo: true } });
    const x = c.qualidade!.corrigidos!;
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ i: 60, tipo: 'final', causa: 'terminal' });
    expect(x[0].deslocamento).toBeGreaterThan(25);
    // depois de reconstruído o ponto final não volta: a distância ao início cresce a cada linha
    const o = c.rows[0];
    const d = (r: { lat: number; lon: number }) => Math.hypot(r.lat - o.lat, (r.lon - o.lon) * Math.cos((o.lat * Math.PI) / 180));
    for (let i = 1; i < c.rows.length; i++) expect(d(c.rows[i])).toBeGreaterThan(d(c.rows[i - 1]) - 1e-9);
  });
});

describe('teste de carga: 9 planilhas sintéticas, 18 projetos', () => {
  const t0 = performance.now();
  const projetos: ParsedProject[] = [];
  for (const c of conjuntoDeNove()) projetos.push(...parseSpreadsheetAll(new Uint8Array(gerarPlanservi(c))));
  const tLeitura = performance.now() - t0;

  it('lê os 9 arquivos como 18 projetos, dois por arquivo, e mede o tempo de leitura', () => {
    expect(projetos).toHaveLength(18);
    expect(new Set(projetos.map((p) => p.meta.uf))).toEqual(new Set(['RD-001', 'RD-002']));
    console.info(`leitura de 9 planilhas (18 projetos): ${tLeitura.toFixed(0)} ms`);
    expect(tLeitura).toBeLessThan(15000);
  });

  it('prepara a geometria dos 18 projetos em tempo razoável', () => {
    const t1 = performance.now();
    for (const p of projetos) buildGeometry(prepareProject(p));
    const t = performance.now() - t1;
    console.info(`geometria de 18 projetos: ${t.toFixed(0)} ms`);
    expect(t).toBeLessThan(20000);
  });

  const comKm = (p: ParsedProject) => ({ p, kmNum: p.rows.map((r) => r.hod), meta: p.meta });

  it('agrupa por rodovia: seis planilhas em RD-001 e três em RD-002 por sentido', () => {
    const porVia = (uf: string) => projetos.filter((p) => p.meta.uf === uf);
    expect(porVia('RD-001')).toHaveLength(12);
    expect(porVia('RD-002')).toHaveLength(6);
  });

  it('funde os trechos contíguos no eixo de km: um bloco por sentido, na ordem do km', () => {
    const blocos = agruparBlocos(projetos.filter((p) => p.meta.uf === 'RD-001').map(comKm));
    expect(blocos).toHaveLength(2);
    expect(blocos.map((b) => b.sentido)).toEqual([1, -1]);
    for (const b of blocos) {
      expect(b.ps.map((q) => q.p.meta.via.split(' · ')[0])).toEqual(['TH41', 'TH42', 'TH43', 'TH44', 'TH45', 'TH47']);
      const ini = b.ps.map((q) => q.kmNum[0]);
      expect([...ini].sort((a, z) => a - z)).toEqual(ini);
    }
    const b3 = agruparBlocos(projetos.filter((p) => p.meta.uf === 'RD-002').map(comKm));
    expect(b3).toHaveLength(2);
    expect(b3.every((b) => b.ps.length === 3 && b.lacunas.length === 0)).toBe(true);
  });

  it('a lacuna do TH46 aparece entre o TH45 e o TH47 e só ali', () => {
    const [cresc] = agruparBlocos(projetos.filter((p) => p.meta.uf === 'RD-001').map(comKm));
    expect(cresc.lacunas).toHaveLength(1);
    const [l] = cresc.lacunas;
    const th45 = cresc.ps.find((q) => q.p.meta.via.startsWith('TH45'))!, th47 = cresc.ps.find((q) => q.p.meta.via.startsWith('TH47'))!;
    expect(l.de).toBeCloseTo(th45.kmNum[th45.kmNum.length - 1], 6);
    expect(l.ate).toBeCloseTo(th47.kmNum[0], 6);
    expect(l.ate - l.de).toBeCloseTo(1.2, 3);
  });

  it('planilhas que se sobrepõem no km ficam em blocos separados', () => {
    const a = { kmNum: [10, 10.02, 10.04], meta: { travel: 1 } }, b = { kmNum: [10.02, 10.04, 10.06], meta: { travel: 1 } };
    expect(agruparBlocos([a, b]).map((x) => x.ps.length)).toEqual([1, 1]);
  });
});
