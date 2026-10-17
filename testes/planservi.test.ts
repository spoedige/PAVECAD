import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORMATS, parseSpreadsheetAll, readWorkbook } from '../src/formats';
import { CAMADAS, classificar, descreverCamada, espessuras, maisForte, mapearCabecalhos, qualidade } from '../src/formats/planservi';
import { conhecido } from '../src/dominio/catalogo';
import { indicadoresComDados } from '../src/dominio/indicadores';
import { distM } from '../src/dominio/medidas';
import { fixture } from './helpers';

const bytes = (n: string) => new Uint8Array(readFileSync(fixture(n)));
const A = 'planservi_TH50.xlsx';
const B = 'planservi_TH51.xlsx';

/** Coluna "AB" vira o índice base 0 (27). Só os testes usam letras; o leitor lê pelos cabeçalhos. */
const col = (l: string) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const raw = (S: unknown[][], linha: number, letra: string) => S[linha - 1][col(letra)];

describe('detecção', () => {
  it('só o Planservi reconhece a aba SOLUÇÃO_FINAL com os cabeçalhos', () => {
    const wb = readWorkbook(bytes(A));
    expect(FORMATS.filter((f) => f.detect(wb)).map((f) => f.id)).toEqual(['planservi']);
  });
  it('a aba IRI quebrada é ignorada e registrada no log', () => {
    const [c] = parseSpreadsheetAll(bytes(A));
    expect(c.log.some((l) => l.code === 'planservi-aba-ignorada' && /IRI/.test(l.msg) && /#REF!/.test(l.msg))).toBe(true);
  });
});

describe.each([[A, 'SP-333', 'TH50'], [B, 'SP-333', 'TH51']])('%s', (arq, rod, th) => {
  const S = readWorkbook(bytes(arq)).sheet('SOLUÇÃO_FINAL');
  const [cres, decr] = parseSpreadsheetAll(bytes(arq));
  const dados = S.map((r, i) => ({ r, linha: i + 1 })).filter((x) => x.linha >= 8 && typeof x.r[0] === 'number');

  it('gera dois projetos, com nome, rodovia e sentido', () => {
    expect(cres.meta.name).toBe(`${rod} · ${th} · Crescente`);
    expect(decr.meta.name).toBe(`${rod} · ${th} · Decrescente`);
    expect([cres.meta.uf, decr.meta.uf]).toEqual([rod, rod]);
    expect([cres.meta.travel, decr.meta.travel]).toEqual([1, -1]);
    expect([cres.meta.format, decr.meta.format]).toEqual(['planservi', 'planservi']);
  });

  it('tem pelo menos 40 linhas de dado; a linha final sem número dá a coordenada do fim', () => {
    expect(dados.length).toBeGreaterThanOrEqual(40);
    expect(cres.rows).toHaveLength(dados.length + 1);
    const fim = S[7 + dados.length];
    expect(typeof fim[0]).not.toBe('number');
    expect(cres.rows.at(-1)!.lat).toBeCloseTo(raw(S, 8 + dados.length, 'E') as number, 6);
    expect(decr.rows.at(-1)!.lon).toBeCloseTo(raw(S, 8 + dados.length, 'H') as number, 6);
  });

  it('cada sentido usa as suas coordenadas e o km da coluna B; o marco vem da estaca', () => {
    dados.forEach(({ linha }, i) => {
      expect(cres.rows[i].lat).toBeCloseTo(raw(S, linha, 'E') as number, 6);
      expect(cres.rows[i].lon).toBeCloseTo(raw(S, linha, 'F') as number, 6);
      expect(decr.rows[i].lat).toBeCloseTo(raw(S, linha, 'G') as number, 6);
      expect(decr.rows[i].lon).toBeCloseTo(raw(S, linha, 'H') as number, 6);
      expect(cres.rows[i].hod).toBe(raw(S, linha, 'B'));
      expect(cres.rows[i].marco).toBe(String(raw(S, linha, 'C')).replace(/\s/g, ''));
    });
  });

  it('lê as camadas pelos cabeçalhos, inclusive a ordem invertida do decrescente', () => {
    // Crescente: Faixa 1 em Q (estrutural), R (funcional), S (fresagem), T (revestimento); Faixa 2 em L, M, N, O.
    // Decrescente: Faixa 1 em V (revestimento), W (fresagem), X (funcional), Y (estrutural); Faixa 2 em AA, AB, AC, AD.
    const crescente = [['Q', 'R', 'S', 'T'], ['L', 'M', 'N', 'O']]; // est, fun, fre, rev
    const decrescente = [['Y', 'X', 'W', 'V'], ['AD', 'AC', 'AB', 'AA']];
    const brutoDe = (l: { camadas?: { bruto: string | null }[] }, k: 'est' | 'fre' | 'fun' | 'rev') => l.camadas![CAMADAS.findIndex((c) => c.key === k)].bruto;
    let conferidas = 0;
    for (const [proj, mapa] of [[cres, crescente], [decr, decrescente]] as const) {
      dados.forEach(({ linha }, i) => {
        proj.rows[i].lanes.forEach((lane, f) => {
          const [est, fun, fre, rev] = mapa[f];
          const esperado = { est: raw(S, linha, est), fun: raw(S, linha, fun), fre: raw(S, linha, fre), rev: raw(S, linha, rev) };
          for (const k of ['est', 'fun', 'fre', 'rev'] as const) {
            const v = esperado[k];
            expect(brutoDe(lane, k)).toBe(v === null || v === undefined ? null : String(v));
          }
          conferidas++;
        });
      });
    }
    expect(conferidas).toBeGreaterThan(100);
  });

  it('indicadores por sentido e faixa; FC-2 e FC-3 ficam em % sem multiplicar; IRI e Flecha (ATR)', () => {
    const idx = {
      Crescente: { igg: ['AI', 'AH'], fc3: ['AK', 'AJ'], fc2: ['AM', 'AL'], iri: ['AO', 'AN'], flecha: ['AQ', 'AP'] }, // Faixa 1, Faixa 2
      Decrescente: { igg: ['AS', 'AT'], fc3: ['AU', 'AV'], fc2: ['AW', 'AX'], iri: ['AY', 'AZ'], flecha: ['BA', 'BB'] },
    };
    let n = 0;
    for (const [proj, nome] of [[cres, 'Crescente'], [decr, 'Decrescente']] as const) {
      dados.forEach(({ linha }, i) => {
        proj.rows[i].lanes.forEach((l, f) => {
          const c = idx[nome];
          const num = (letra: string) => { const v = raw(S, linha, letra); return typeof v === 'number' ? v : null; };
          const perto = (a: number | null | undefined, b: number | null, d = 2) => (b === null ? expect(a).toBeNull() : expect(a!).toBeCloseTo(b, d));
          perto(l.igg, num(c.igg[f]), 2); perto(l.fc3, num(c.fc3[f]), 4); perto(l.fc2, num(c.fc2[f]), 4);
          perto(l.iri, num(c.iri[f]), 2); perto(l.atr, num(c.flecha[f]), 1);
          expect([l.d0, l.rc, l.d120, l.defPct]).toEqual([null, null, null, null]);
          n++;
        });
      });
    }
    expect(n).toBeGreaterThan(100);
    expect(cres.rows.some((r) => r.lanes.some((l) => (l.fc2 ?? 0) > 0 && (l.fc2 ?? 0) < 1))).toBe(true);
  });

  it('a cor vem da camada mais forte; todos os códigos usados estão no catálogo, menos EX', () => {
    for (const p of [cres, decr]) {
      for (const k of Object.keys(p.codes)) expect(conhecido(k) || k === 'EX', k).toBe(true);
      for (const r of p.rows) for (const l of r.lanes) {
        const bruto = (k: string) => l.camadas![CAMADAS.findIndex((c) => c.key === k)].bruto;
        const esperado = maisForte({ est: bruto('est') === '1' ? 1 : bruto('est'), fre: bruto('fre'), fun: bruto('fun'), rev: bruto('rev') });
        expect(l.code).toBe(esperado);
      }
    }
  });

  it('larguras assumidas e dreno no lado externo (sem coluna de tipo)', () => {
    expect(cres.rows[0].widths.every((w) => w === 3.6)).toBe(true);
    expect(cres.rows[0].shoulder).toBe(2.5);
    expect(cres.log.some((l) => l.code === 'planservi-larguras')).toBe(true);
  });
});

describe('amostra TH50: dreno nos dois sentidos e salto de coordenada', () => {
  const [cres, decr] = parseSpreadsheetAll(bytes(A));
  const S = readWorkbook(bytes(A)).sheet('SOLUÇÃO_FINAL');

  it('"X" na coluna Drenos vira dreno, em cada sentido', () => {
    const dc = cres.rows.map((r, i) => (r.drain ? i : -1)).filter((i) => i >= 0);
    const dd = decr.rows.map((r, i) => (r.drain ? i : -1)).filter((i) => i >= 0);
    expect(dc.length).toBeGreaterThan(0);
    expect(dd.length).toBeGreaterThan(0);
    expect(dc).toEqual(S.map((r, i) => (i >= 7 && typeof r[0] === 'number' && r[col('K')] === 'X' ? i - 7 : -1)).filter((i) => i >= 0));
    expect(dd).toEqual(S.map((r, i) => (i >= 7 && typeof r[0] === 'number' && r[col('AE')] === 'X' ? i - 7 : -1)).filter((i) => i >= 0));
    expect(cres.rows[dc[0]].drain).toEqual(['?', null]);
  });

  it('o salto do crescente é sinalizado, com o km de cada ocorrência, e nada é corrigido', () => {
    const salto = cres.qualidade!.saltos.filter((s) => s.dist > 60);
    expect(salto).toHaveLength(2); // entrada e saída do ponto deslocado
    expect(salto[0].dist).toBeGreaterThan(90);
    expect(salto[0].dist).toBeLessThan(110);
    const [i0] = [salto[0].i];
    expect(cres.rows[i0].lat).toBeCloseTo(raw(S, 8 + i0, 'E') as number, 6); // coordenada original mantida
    const msg = cres.log.find((l) => l.code === 'planservi-salto' && l.level === 'warn')!.msg;
    expect(msg).toContain(salto[0].km);
    expect(msg).toMatch(/Nada foi corrigido/);
    expect(cres.rows).toHaveLength(61); // nenhuma linha descartada
    // o ponto deslocado também se afasta do decrescente acima de 100 m
    expect(cres.qualidade!.sentidos.some((s) => s.i === i0)).toBe(true);
    expect(cres.log.some((l) => l.code === 'planservi-entre-sentidos')).toBe(true);
  });

  it('a verificação usa a faixa de 10 a 30 m e 100 m entre os sentidos', () => {
    expect(cres.qualidade!.faixaSalto).toEqual([10, 30]);
    expect(cres.qualidade!.maxSentidos).toBe(100);
    const rows = [0, 20, 40, 100, 108, 140, 170].map((n, i) => ({ lat: -21 + n * 9e-6, lon: -48, hod: i, marco: `${i}+000` }));
    const q = qualidade(rows as never, rows.map((r) => ({ ...r, lon: r.lon + 0.0011 })) as never);
    // 20, 20, 60 (fora), 8 (fora), 32 (fora), 30 (dentro)
    expect(q.saltos.map((s) => Math.round(s.dist))).toEqual([60, 8, 32]);
    expect(q.sentidos).toHaveLength(7); // 0,0011° de longitude ≈ 114 m em todas as linhas
    expect(distM([-48, -21], [-48, -21 + 20 * 9e-6])).toBeGreaterThan(19);
  });
});

describe('amostra TH51: salto no decrescente, EX e RE', () => {
  const [cres, decr] = parseSpreadsheetAll(bytes(B));
  it('o salto do decrescente aparece só nele', () => {
    expect(decr.qualidade!.saltos.some((s) => s.dist > 90)).toBe(true);
    expect(cres.qualidade!.saltos.some((s) => s.dist > 90)).toBe(false);
    expect(decr.rows.map((r) => !!r.drain).filter(Boolean).length).toBe(2);
    expect(cres.rows.map((r) => !!r.drain).filter(Boolean).length).toBe(1);
  });
  it('EX e RE são do estrutural e vencem as outras camadas', () => {
    const cods = new Set([...cres.rows, ...decr.rows].flatMap((r) => r.lanes.map((l) => l.code)));
    expect(cods.has('EX') || cods.has('RE')).toBe(true);
  });
  it('os indicadores presentes escondem D0, Rc e Defeitos e mostram IGG e FC', () => {
    expect(indicadoresComDados([cres, decr])).toEqual(['iri', 'atr', 'igg', 'fc2', 'fc3']);
  });
});

describe('regras de camada', () => {
  it('"1" no estrutural é sem intervenção; "-" é nada; "*" é ver projeto à parte', () => {
    expect(classificar(1, 'est')).toBeNull();
    expect(classificar('-', 'fun')).toBeNull();
    expect(classificar(null, 'rev')).toBeNull();
    expect(classificar('*', 'fre')).toEqual({ rank: 2, code: 'VP' });
    expect(descreverCamada(1, 'est')).toBe('Sem intervenção');
    expect(descreverCamada('*', 'fre')).toBe('Ver projeto à parte');
    expect(descreverCamada('-', 'fun')).toBe('Nada');
  });
  it('ordem de força: estrutural, fresagem/recomposição estrutural, funcional, MF, ST, só revestimento, nada', () => {
    const ordem = [
      { est: 'RE', fre: 'F4R10', fun: 'F4R4', rev: 'R2,5' },
      { est: 1, fre: 'F4R8', fun: 'MF', rev: 'R2,5' },
      { est: 1, fre: '-', fun: 'F8R8', rev: 'PMQ3,0' },
      { est: 1, fre: '-', fun: 'MF', rev: 'R2,5' },
      { est: 1, fre: '-', fun: 'ST', rev: 'R2,5' },
      { est: 1, fre: '-', fun: '-', rev: 'R2,5' },
      { est: 1, fre: '-', fun: '-', rev: '-' },
    ];
    expect(ordem.map(maisForte)).toEqual(['RE', 'F4R8', 'F8R8', 'MF', 'ST', 'REF', null]);
    expect(maisForte({ est: 'RP', fre: '*', fun: 'MF', rev: '-' })).toBe('RP');
    expect(maisForte({ est: 'EX', fre: '-', fun: '-', rev: '-' })).toBe('EX');
    expect(maisForte({ est: 1, fre: '-', fun: 'F4R4', rev: 'R3,0' })).toBe('F4R4');
    expect(maisForte({ est: 1, fre: '*', fun: 'F4R4', rev: '-' })).toBe('VP'); // ver projeto à parte, no lugar da fresagem estrutural
  });
  it('a espessura vem do número do código, com vírgula decimal', () => {
    expect(espessuras('F4R10')).toEqual({ fresagem: 4, recomposicao: 10 });
    expect(espessuras('F4R4')).toEqual({ fresagem: 4, recomposicao: 4 });
    expect(espessuras('R2,5')).toEqual({ reforco: 2.5 });
    expect(espessuras('PMQ3,0')).toEqual({ reforco: 3 });
    expect(espessuras('MF')).toEqual({});
    expect(descreverCamada('F4R10', 'fre')).toBe('F4R10 · fresagem de 4 cm e recomposição de 10 cm');
    expect(descreverCamada('R2,5', 'rev')).toBe('R2,5 · reforço estrutural de 2,5 cm');
    expect(descreverCamada('PMQ3,0', 'rev')).toBe('PMQ3,0 · reforço estrutural (PMQ) de 3,0 cm');
    expect(descreverCamada('ST', 'fun')).toBe('ST · selagem de trincas');
  });
  it('cabeçalho ausente dá erro com o que faltou', () => {
    expect(() => mapearCabecalhos([[], [], [], [], [], ['Segmento'], []])).toThrow(/não encontrados/);
  });
});
