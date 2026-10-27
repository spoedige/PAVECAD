import { describe, expect, it } from 'vitest';
import { COLUNAS, csvDeLinhas, fotosDeNotas, linhasDeNotas, nomeArquivoFoto, type NotaExport } from '../src/dominio/exportNotas';
import { dimensoesReduzidas, FOTO_LADO_MAX, FOTO_QUALIDADE } from '../src/dominio/imagem';
import { jpegComGps, lerGps, grausMinSeg } from '../src/dominio/exif';
import { situacaoConserva, TIPOS_RAPIDOS, ORDEM_TIPOS } from '../src/dominio/notaRapida';

const opts = { rotuloCat: (c: string) => c };
const rapida = (tipo: 'conserva' | 'observacao' | 'foto', extra: object = {}) => ({
  tipo, origem: 'pressao' as const, precisao: null, rodovia: 'BR-050', sentido: 'Crescente' as const, planilha: 'P1', km: '177+000', faixa: 2, estado: 'dentro' as const, resolvida: false, ...extra,
});
const nota = (id: string, t: string, r: ReturnType<typeof rapida>, extra: Partial<NotaExport> = {}): NotaExport => ({ id, t, coords: [[-47.75, -12.79]], text: '', rapida: r, ...extra });

describe('tipos novos da roda', () => {
  it('Ver conserva, Observação e Foto existem, na ordem da roda', () => {
    expect(TIPOS_RAPIDOS.conserva.rotulo).toBe('Ver conserva');
    expect(TIPOS_RAPIDOS.observacao.rotulo).toBe('Observação');
    expect(TIPOS_RAPIDOS.foto.rotulo).toBe('Foto');
    expect(ORDEM_TIPOS.slice(-3)).toEqual(['conserva', 'observacao', 'foto']);
  });
  it('situação da conserva: Pendente até alguém verificar', () => {
    expect(situacaoConserva({ resolvida: false })).toBe('Pendente');
    expect(situacaoConserva({ resolvida: true })).toBe('Verificado');
  });
});

describe('exportação: Ver conserva, Observação e Foto', () => {
  it('colunas Desde, Até, Situação e Arquivo da foto no fim', () => {
    expect([...COLUNAS].slice(-4)).toEqual(['Desde', 'Até', 'Situação', 'Arquivo da foto']);
  });
  it('Ver conserva: Tipo, Desde (data do projeto da planilha), Até (data e hora da nota) e Situação', () => {
    const t = new Date(2026, 9, 26, 14, 30, 5).toISOString();
    const [l] = linhasDeNotas([nota('a', t, rapida('conserva'))], { ...opts, contexto: () => ({ desde: '01/03/2025' }) });
    expect(l.tipo).toBe('Ver conserva');
    expect(l.desde).toBe('01/03/2025');
    expect(l.ate).toBe('26/10/2026 14:30');
    expect(l.situacao).toBe('Pendente');
    expect(linhasDeNotas([nota('b', t, rapida('conserva', { resolvida: true }))], opts)[0].situacao).toBe('Verificado');
  });
  it('Ver conserva sem data do projeto deixa Desde vazio', () => {
    const [l] = linhasDeNotas([nota('a', new Date().toISOString(), rapida('conserva'))], opts);
    expect(l.desde).toBe('');
  });
  it('Observação: Tipo Observação e o texto na coluna Observação', () => {
    const [l] = linhasDeNotas([nota('a', new Date().toISOString(), rapida('observacao'), { text: 'bueiro entupido' })], opts);
    expect(l.tipo).toBe('Observação');
    expect(l.observacao).toBe('bueiro entupido');
    expect(l.desde + l.ate + l.situacao + l.arquivoFoto).toBe('');
  });
  it('Foto: nome km177+000_Fx2_AAAAMMDD_HHmmss.jpg na coluna Arquivo da foto e no CSV', () => {
    const t = new Date(2026, 9, 26, 14, 30, 5).toISOString();
    const [l] = linhasDeNotas([nota('a', t, rapida('foto'), { photos: ['data:image/jpeg;base64,AAAA'] })], opts);
    expect(l.tipo).toBe('Foto');
    expect(l.arquivoFoto).toBe('km177+000_Fx2_20261026_143005.jpg');
    const csv = csvDeLinhas([l]).split('\r\n')[1];
    expect(csv).toContain('"km177+000_Fx2_20261026_143005.jpg"');
    expect(csv.replace(/"[^"]*(""[^"]*)*"/g, '""').split(';')).toHaveLength(COLUNAS.length);
  });
  it('fotos exportadas seguem os mesmos nomes da coluna, mesmo com duas no mesmo segundo', () => {
    const t = new Date(2026, 9, 26, 14, 30, 5).toISOString();
    const ns = [nota('a', t, rapida('foto'), { photos: ['data:image/jpeg;base64,AAAA'] }), nota('b', t, rapida('foto'), { photos: ['data:image/jpeg;base64,BBBB'] })];
    const f = fotosDeNotas(ns, opts), l = linhasDeNotas(ns, opts);
    expect(f.map((x) => x.nome)).toEqual(l.map((x) => x.arquivoFoto));
    expect(new Set(f.map((x) => x.nome)).size).toBe(2);
    expect(f[1].nome).toBe('km177+000_Fx2_20261026_143005_2.jpg');
    expect(f[0].lat).toBeCloseTo(-12.79); expect(f[0].lon).toBeCloseTo(-47.75);
  });
  it('nome do arquivo: acostamento, sem faixa e sem km', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(nomeArquivoFoto(d, '177+000', 0)).toBe('km177+000_Ac_20260102_030405.jpg');
    expect(nomeArquivoFoto(d, '177+000', null)).toBe('km177+000_20260102_030405.jpg');
    expect(nomeArquivoFoto(d, null, null)).toBe('kmND_20260102_030405.jpg');
  });
});

describe('redução da foto', () => {
  it('lado maior vira 1600 px, mantém a proporção e nunca amplia', () => {
    expect(FOTO_LADO_MAX).toBe(1600);
    expect(FOTO_QUALIDADE).toBe(0.8);
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(dimensoesReduzidas(3000, 4000)).toEqual({ w: 1200, h: 1600 });
    expect(dimensoesReduzidas(1000, 800)).toEqual({ w: 1000, h: 800 });
    expect(dimensoesReduzidas(0, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('EXIF GPS', () => {
  // JPEG mínimo: SOI, APP0 JFIF, EOI
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  it('escreve e lê de volta a coordenada, com sinais de sul e oeste', () => {
    const out = jpegComGps(jpeg, -12.791234, -47.757891, new Date(2026, 9, 26, 14, 30, 5));
    const p = lerGps(out)!;
    expect(p.lat).toBeCloseTo(-12.791234, 5);
    expect(p.lon).toBeCloseTo(-47.757891, 5);
    expect(out[0]).toBe(0xff); expect(out[1]).toBe(0xd8);
    expect(out.slice(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });
  it('hemisfério norte e leste', () => {
    const p = lerGps(jpegComGps(jpeg, 10.5, 20.25))!;
    expect(p.lat).toBeCloseTo(10.5, 6); expect(p.lon).toBeCloseTo(20.25, 6);
  });
  it('substitui um EXIF que já exista e não duplica', () => {
    const uma = jpegComGps(jpeg, 1, 2), duas = jpegComGps(uma, 3, 4);
    const p = lerGps(duas)!;
    expect(p.lat).toBeCloseTo(3, 6); expect(p.lon).toBeCloseTo(4, 6);
    let n = 0; for (let i = 0; i < duas.length - 5; i++) if (duas[i] === 0xff && duas[i + 1] === 0xe1) n++;
    expect(n).toBe(1);
  });
  it('arquivo que não é JPEG volta como veio', () => {
    const x = new Uint8Array([1, 2, 3, 4, 5]);
    expect(jpegComGps(x, 1, 2)).toBe(x);
  });
  it('graus, minutos e segundos', () => {
    const [g, m, s] = grausMinSeg(12.791234);
    expect(g).toBe(12); expect(m).toBe(47); expect(s).toBeCloseTo(28.4424, 3);
  });
});
