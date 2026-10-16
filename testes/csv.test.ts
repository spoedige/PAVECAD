import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/geometry/build';
import { eixoDaFaixa } from '../src/geometry/eixo';
import { prepareProject } from '../src/geometry/project';
import { crsForZone, fromUtm } from '../src/geometry/utm';
import { modelOf } from '../src/dominio/modelo';
import { CSV_CABECALHO, nomeArquivoCsv, propostasCsv, type Proposta } from '../src/dominio/propostas';
import type { PV } from '../src/dominio/analise';
import type { ParsedProject, Row } from '../src/formats/types';

// Caso conhecido: estrada reta para o norte em UTM 23S (E 300000, N 8000000), linhas de 20 m,
// 2 faixas de 3,5 m e acostamento de 2,5 m. O eixo da Fx 1 fica 1,75 m a leste da coordenada (crescente).
function reta(travel: 1 | -1, n = 12) {
  const crs = crsForZone(23);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const [lat, lon] = fromUtm(crs, 300000, 8000000 + i * 20);
    rows.push({ hod: i * 0.02, lat, lon, z: null, widths: [3.5, 3.5], shoulder: 2.5, shoulderCode: null, obs: null, platform: null, lanes: [], marco: `1+${String(i * 20).padStart(3, '0')}`, drain: null, he: [null, null] });
  }
  const parsed: ParsedProject = { meta: { name: 'Reta', uf: 'BR-000/XX', via: 'Teste', travel, kmi: 1, kmf: 1.24, format: 'teste' }, rows, log: [], codes: {} };
  const proj = prepareProject(parsed);
  const g = buildGeometry(proj);
  const eixoP = { ...proj, opts: g.opts, normals: g.normals };
  const pv: PV = { ...proj, id: 'p1', model: modelOf(proj.rows) };
  return { pv, eixoP };
}

/** Separa os campos de uma linha de CSV com ";", respeitando aspas. */
const campos = (linha: string) => {
  const out: string[] = [];
  let cur = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') { cur += ch; if (aspas && linha[i + 1] === '"') { cur += '"'; i++; } else aspas = !aspas; }
    else if (ch === ';' && !aspas) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

const prop = (pv: PV, r0: number, r1: number, lane: number): Proposta => ({
  id: 'a', pname: pv.meta.name, pid: 'p1', lane, r0, r1, km0: pv.kmNum[r0], km1: pv.kmNum[r1], from: 'GAP', to: 'FS4', note: 'obs "teste"; ok', t: '',
});

describe('eixo da faixa (caso conhecido)', () => {
  it('crescente, Fx 1: eixo 1,75 m a leste; início da linha 2 e fim na linha 5', () => {
    const { eixoP } = reta(1);
    const e = eixoDaFaixa(eixoP, 1, 2, 4)!;
    expect(e.ini.e).toBeCloseTo(300001.75, 3);
    expect(e.ini.n).toBeCloseTo(8000040, 3);
    expect(e.fim.e).toBeCloseTo(300001.75, 3);
    expect(e.fim.n).toBeCloseTo(8000100, 3);
    // lat/lon coerentes com o UTM (volta pelo mesmo fuso)
    const [lat, lon] = fromUtm(crsForZone(23), 300001.75, 8000040);
    expect(e.ini.lat).toBeCloseTo(lat, 9);
    expect(e.ini.lon).toBeCloseTo(lon, 9);
  });

  it('Fx 2 fica 5,25 m a leste e o acostamento 8,25 m (de 7 a 9,5 m)', () => {
    const { eixoP } = reta(1);
    expect(eixoDaFaixa(eixoP, 2, 0, 0)!.ini.e).toBeCloseTo(300005.25, 3);
    expect(eixoDaFaixa(eixoP, 0, 0, 0)!.ini.e).toBeCloseTo(300008.25, 3);
  });

  it('decrescente inverte o lado: Fx 1 a oeste', () => {
    const { eixoP } = reta(-1);
    expect(eixoDaFaixa(eixoP, 1, 2, 4)!.ini.e).toBeCloseTo(299998.25, 3);
  });

  it('no fim do trecho, o fim é 20 m adiante na direção do traçado', () => {
    const { eixoP } = reta(1, 12);
    const e = eixoDaFaixa(eixoP, 1, 9, 11)!;
    expect(e.ini.n).toBeCloseTo(8000180, 3);
    expect(e.fim.n).toBeCloseTo(8000240, 3); // linha 11 (8000220) + 20 m
  });
});

describe('CSV das propostas', () => {
  const { pv, eixoP } = reta(1);
  const eixo = (_p: PV, r: Proposta) => eixoDaFaixa(eixoP, r.lane, r.r0, r.r1);
  const csv = propostasCsv([prop(pv, 2, 4, 1)], () => pv, (p) => p.meta.name, (k) => 'Nome ' + k, eixo, '\r\n');
  const [cab, lin] = csv.split('\r\n');
  const c = campos(lin);

  it('cabeçalho com as colunas atuais e as 8 de coordenadas, nesta ordem', () => {
    expect(cab.split(';')).toEqual(CSV_CABECALHO);
    expect(CSV_CABECALHO.slice(0, 12)).toEqual(['planilha', 'faixa', 'km_inicial', 'km_final', 'extensao_m', 'largura_m', 'area_m2', 'codigo_atual', 'solucao_atual', 'codigo_proposto', 'solucao_proposta', 'observacao']);
    expect(CSV_CABECALHO.slice(12)).toEqual(['lat_inicial', 'lon_inicial', 'lat_final', 'lon_final', 'utm_e_inicial', 'utm_n_inicial', 'utm_e_final', 'utm_n_final']);
  });

  it('separador ";" e vírgula decimal, com 20 campos', () => {
    // a observação traz ";" entre aspas: o parser respeita as aspas
    expect(c).toHaveLength(20);
    expect(lin).not.toMatch(/\d\.\d/); // nenhum ponto decimal
  });

  it('valores do caso conhecido', () => {
    expect(c[0]).toBe('"Reta"');
    expect(c[1]).toBe('1');
    expect(c[4]).toBe('60'); // 3 segmentos de 20 m
    expect(c[5]).toBe('3,5');
    expect(c[6]).toBe('210'); // 60 m x 3,5 m
    expect(c[7]).toBe('"GAP"');
    expect(c[8]).toBe('"Nome GAP"');
    expect(c[9]).toBe('"FS4"');
    expect(c[11]).toBe('"obs ""teste""; ok"'); // aspas duplicadas, ";" protegido
    expect(c[16]).toBe('300001,75'); // utm_e_inicial
    expect(c[17]).toBe('8000040,00'); // utm_n_inicial
    expect(c[18]).toBe('300001,75'); // utm_e_final
    expect(c[19]).toBe('8000100,00'); // utm_n_final
    const [lat, lon] = fromUtm(crsForZone(23), 300001.75, 8000040);
    expect(c[12]).toBe(lat.toFixed(7).replace('.', ','));
    expect(c[13]).toBe(lon.toFixed(7).replace('.', ','));
  });

  it('sem função de eixo, as colunas de coordenadas ficam vazias', () => {
    const l = campos(propostasCsv([prop(pv, 2, 4, 1)], () => pv, (p) => p.meta.name, (k) => k).split('\n')[1]);
    expect(l).toHaveLength(20);
    expect(l.slice(12)).toEqual(Array(8).fill(''));
  });
});

describe('nome do arquivo', () => {
  it('propostas_AAAA-MM-DD.csv com a data local', () => {
    expect(nomeArquivoCsv(new Date(2026, 9, 16, 12, 0))).toBe('propostas_2026-10-16.csv');
    expect(nomeArquivoCsv(new Date(2027, 0, 5, 23, 59))).toBe('propostas_2027-01-05.csv');
  });
});
