import { describe, expect, it } from 'vitest';
import * as fflate from 'fflate';
import * as XLSX from 'xlsx-js-style';
import { COLUNAS, csvDeLinhas, juntarLinhas, linhasDeNotas, linhasDePropostas, nomeArquivoNotas, resumoDeLinhas, serialDoDia, type NotaExport } from '../src/dominio/exportNotas';
import { montarXlsx, type FflateLib, type XlsxLib } from '../src/dominio/xlsxNotas';
import type { DadosRapida } from '../src/dominio/notaRapida';

const rap = (extra: Partial<DadosRapida> = {}): DadosRapida => ({
  tipo: 'melhorar', origem: 'pressao', precisao: null, rodovia: 'RD-001', planilha: 'RD-001 · TH01 · Crescente', sentido: 'Crescente', km: '10+400', faixa: 1, estado: 'dentro', resolvida: false, ...extra,
});
const nota = (id: string, t: string, extra: Partial<NotaExport> = {}): NotaExport => ({ id, t, coords: [[-47.9, -15.2]], text: '', ...extra });

// horário local fixo: construído por componentes, para o teste não depender do fuso da máquina
const quando = (d: number, h: number, mi: number) => new Date(2026, 9, d, h, mi, 5).toISOString();
const notas: NotaExport[] = [
  nota('b', quando(19, 15, 30), { rapida: rap({ tipo: 'retirar', origem: 'gps', precisao: 8, sentido: 'Decrescente', planilha: 'RD-001 · TH01 · Decrescente', faixa: 2, resolvida: true }), text: 'trinca; "grave"' }),
  nota('a', quando(18, 9, 5), { rapida: rap() }),
  nota('c', quando(19, 8, 0), { rapida: rap({ tipo: 'dreno_mais', rodovia: null, sentido: null, planilha: null, km: null, faixa: null, estado: 'fora' }) }),
  nota('antiga', quando(17, 7, 45), { cat: 'def', text: 'buraco', loc: { pid: 'p1', name: 'RD-001 · TH02 · Crescente', km: '60+120', lane: 0 } }),
];
const opcoes = {
  rotuloCat: (c: string) => ({ obs: 'Observação', def: 'Defeito', dre: 'Dreno', rev: 'Revisar solução' } as Record<string, string>)[c] ?? c,
  // o app resolve rodovia e sentido da anotação antiga pela planilha dela
  contexto: (n: NotaExport) => (n.id === 'antiga' ? { rodovia: 'RD-001', sentido: 'Crescente' } : undefined),
};
const linhas = linhasDeNotas(notas, opcoes);

describe('linhas das notas', () => {
  it('ordem da mais antiga para a mais nova, com as colunas pedidas', () => {
    expect(linhas.map((l) => l.tipo)).toEqual(['Defeito', 'Melhorar solução', 'Colocar dreno', 'Retirar solução']);
    expect([...COLUNAS]).toEqual(['Data', 'Hora', 'Tipo', 'Rodovia', 'Planilha', 'Sentido', 'Faixa', 'Solução atual', 'Solução nova', 'Efeito', 'Extensão antes (m)', 'Extensão depois (m)', 'Km inicial', 'Km final', 'Latitude', 'Longitude', 'UTM Leste', 'UTM Norte', 'Origem', 'Precisão (m)', 'Observação', 'Status', 'Desde', 'Até', 'Situação', 'Arquivo da foto']);
  });

  it('nota rápida: origem, precisão, faixa e status; anotação antiga entra com os dados que tiver', () => {
    const [antiga, a, c, b] = linhas;
    expect(b).toMatchObject({ origem: 'GPS', precisao: 8, sentido: 'Decrescente', faixa: 2, status: 'Resolvida', observacao: 'trinca; "grave"' });
    expect(a).toMatchObject({ origem: 'Pressão', precisao: null, rodovia: 'RD-001', kmIni: '10+400', kmFim: '', faixa: 1, status: 'Aberta', solucaoAtual: '', efeito: '', extAntes: null });
    expect(c).toMatchObject({ rodovia: '', planilha: '', sentido: '', kmIni: '', faixa: '' }); // fora do trecho: só a posição
    expect(antiga).toMatchObject({ tipo: 'Defeito', origem: 'Manual', planilha: 'RD-001 · TH02 · Crescente', kmIni: '60+120', faixa: 'Acost.', observacao: 'buraco', precisao: null });
  });

  it('data e hora separadas, locais; coordenadas com 6 casas e UTM do fuso', () => {
    const b = linhas[3];
    expect(b.dataTxt).toBe('19/10/2026'); expect(b.horaTxt).toBe('15:30');
    expect(b.data).toBe(serialDoDia(new Date(2026, 9, 19))); expect(Number.isInteger(b.data)).toBe(true);
    expect(b.hora).toBeCloseTo((15 * 3600 + 30 * 60 + 5) / 86400, 9);
    expect(b.lat).toBe(-15.2); expect(b.lon).toBe(-47.9); expect(b.fuso).toBe('23S');
    expect(b.utmE).toBeGreaterThan(100000); expect(b.utmN).toBeGreaterThan(1e6);
  });

  it('o contexto do app sobrepõe (modo privacidade esconde nome e km)', () => {
    const l = linhasDeNotas([notas[1]], { ...opcoes, contexto: () => ({ rodovia: 'Rodovia A', planilha: 'Planilha 1 · Crescente', km: '0+400' }) })[0];
    expect(l).toMatchObject({ rodovia: 'Rodovia A', planilha: 'Planilha 1 · Crescente', kmIni: '0+400' });
  });

  it('resumo por tipo e por rodovia e sentido', () => {
    const r = resumoDeLinhas(linhas);
    expect(r.total).toBe(4);
    expect(r.porTipo).toEqual([['Colocar dreno', 1], ['Defeito', 1], ['Melhorar solução', 1], ['Retirar solução', 1]]);
    expect(r.porRodoviaSentido).toEqual([['(sem planilha)', '', 1], ['RD-001', 'Crescente', 2], ['RD-001', 'Decrescente', 1]]);
    expect(r.fusos).toEqual(['23S']);
  });
});

describe('CSV', () => {
  const csv = csvDeLinhas(linhas);
  it('UTF-8 com BOM, separador ";" e CRLF, com as mesmas colunas', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [cab, ...resto] = csv.slice(1).split('\r\n');
    expect(cab).toBe(COLUNAS.join(';'));
    expect(resto).toHaveLength(4);
    for (const l of resto) expect(l.replace(/"[^"]*(""[^"]*)*"/g, '""').split(';')).toHaveLength(COLUNAS.length);
  });
  it('vírgula decimal nas coordenadas e aspas escapadas na observação', () => {
    const l = csv.slice(1).split('\r\n')[4];
    expect(l).toContain('-15,200000;-47,900000');
    expect(l).toMatch(/;\d{6},\d{2};\d{7},\d{2};GPS;8;/);
    expect(l).toContain('"trinca; ""grave"""');
    expect(l.replace(/"[^"]*(""[^"]*)*"/g, '')).not.toMatch(/\d\.\d/);
    expect(l.startsWith('19/10/2026;15:30;')).toBe(true);
  });
});

describe('nome do arquivo', () => {
  it('notas_PAVTRACK_AAAA-MM-DD_HHmm', () => {
    const d = new Date(2026, 9, 9, 7, 5);
    expect(nomeArquivoNotas('xlsx', d)).toBe('notas_PAVTRACK_2026-10-09_0705.xlsx');
    expect(nomeArquivoNotas('csv', d)).toBe('notas_PAVTRACK_2026-10-09_0705.csv');
  });
});

describe('XLSX', () => {
  const bytes = montarXlsx(XLSX as unknown as XlsxLib, fflate as unknown as FflateLib, linhas);
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true, cellStyles: true });
  const ws = wb.Sheets['Notas'];
  const cel = (a: string) => ws[a] as XLSX.CellObject & { s?: { font?: { bold?: boolean } } };

  it('duas abas, Notas e Resumo, e um .xlsx de verdade (zip)', () => {
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
    expect(wb.SheetNames).toEqual(['Notas', 'Resumo']);
  });

  it('cabeçalho com as colunas pedidas, em negrito', () => {
    COLUNAS.forEach((c, i) => expect(cel(XLSX.utils.encode_cell({ r: 0, c: i })).v).toBe(c));
    const zip = fflate.unzipSync(bytes), xml = fflate.strFromU8(zip['xl/worksheets/sheet1.xml']), estilos = fflate.strFromU8(zip['xl/styles.xml']);
    expect(estilos).toContain('<b/>');
    const ids = COLUNAS.map((_, i) => new RegExp(`<c r="${XLSX.utils.encode_cell({ r: 0, c: i })}" s="(\\d+)"`).exec(xml)?.[1]);
    expect(ids.every((id) => id !== undefined && Number(id) >= 3)).toBe(true); // estilos próprios, não o padrão
    expect(ids).not.toContain(/<c r="C2" s="(\d+)"/.exec(xml)?.[1]); // os dados não herdam o negrito
  });

  it('data de verdade, hora como horário, coordenadas como número de 6 casas', () => {
    const a2 = cel('A2');
    expect(a2.t).toBe('d'); expect(a2.v).toBeInstanceOf(Date);
    expect((a2.v as Date).toISOString().slice(0, 10)).toBe('2026-10-17'); // a anotação antiga, a primeira por data
    expect(a2.z).toBe('dd/mm/yyyy');
    expect(cel('B2').t).toBe('d'); expect(cel('B2').z).toBe('hh:mm'); // horário (o SheetJS o devolve como data com cellDates)
    const num = XLSX.read(bytes, { type: 'array' }).Sheets['Notas'];
    expect(num['B2'].t).toBe('n'); expect(num['B2'].v).toBeCloseTo((7 * 3600 + 45 * 60 + 5) / 86400, 6);
    expect(num['A2'].t).toBe('n'); expect(num['A2'].v).toBe(serialDoDia(new Date(2026, 9, 17)));
    expect(cel('O2').t).toBe('n'); expect(cel('O2').v).toBe(-15.2); expect(cel('O2').z).toBe('0.000000');
    expect(cel('P2').t).toBe('n'); expect(cel('P2').z).toBe('0.000000');
    expect(cel('Q2').t).toBe('n'); expect(cel('R2').t).toBe('n');
    expect(cel('T5').v).toBe(8); expect(cel('T5').t).toBe('n'); // precisão do GPS
    expect(ws['T3']).toBeUndefined(); // pressão: sem precisão, sem célula
  });

  it('valores de texto: tipo, sentido, faixa, km, origem, observação e status', () => {
    expect(cel('C5').v).toBe('Retirar solução'); expect(cel('F5').v).toBe('Decrescente'); expect(cel('G5').v).toBe(2); expect(cel('M3').v).toBe('10+400');
    expect(cel('S5').v).toBe('GPS'); expect(cel('U5').v).toBe('trinca; "grave"'); expect(cel('V5').v).toBe('Resolvida');
    expect(cel('G2').v).toBe('Acost.');
  });

  it('filtro automático, larguras e primeira linha congelada', () => {
    expect(ws['!autofilter']?.ref).toBe('A1:Z5');
    expect(ws['!cols']).toHaveLength(COLUNAS.length);
    expect(ws['!cols']!.every((c) => (c.wch ?? 0) >= 6)).toBe(true);
    const xml = fflate.strFromU8(fflate.unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  });

  it('aba Resumo: contagem por tipo e por rodovia e sentido', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Resumo'], { header: 1 }) as unknown[][];
    const achar = (t: string) => rows.find((r) => r[0] === t);
    expect(achar('Total')).toEqual(['Total', 4]);
    expect(achar('Melhorar solução')).toEqual(['Melhorar solução', 1]);
    expect(rows.some((r) => r[0] === 'RD-001' && r[1] === 'Decrescente' && r[2] === 1)).toBe(true);
    expect(rows.some((r) => r[0] === 'RD-001' && r[1] === 'Crescente' && r[2] === 2)).toBe(true);
    expect(String(rows.at(-1)![0])).toMatch(/SIRGAS 2000, fuso 23S/);
  });

  it('sem notas gera só o cabeçalho', () => {
    const vazio = XLSX.read(montarXlsx(XLSX as unknown as XlsxLib, fflate as unknown as FflateLib, []), { type: 'array' });
    expect(XLSX.utils.sheet_to_json<unknown[]>(vazio.Sheets['Notas'], { header: 1 })).toHaveLength(1);
  });
});

describe('alterações de solução (propostas) na mesma planilha', () => {
  const props = [
    { id: 'q1', t: new Date(2026, 9, 19, 9, 0, 0).toISOString(), lane: 2, note: 'rebaixa; "pouco"', campo: { efeito: 'Reduz', antes: 40, depois: 20, origem: 'gps' as const, precisao: 6, lat: -15.21, lon: -47.91 } },
    { id: 'q2', t: new Date(2026, 9, 19, 9, 30, 0).toISOString(), lane: 0, note: '' },
  ];
  const ctx = (p: { id: string }) => ({
    rodovia: 'RD-001', planilha: 'RD-001 · TH01 · Crescente', sentido: 'Crescente', kmIni: '10+400', kmFim: '10+480', lat: -15.2, lon: -47.9,
    atual: p.id === 'q1' ? 'REC (Reconstrução)' : 'Sem intervenção', nova: 'FS3 (Fresagem funcional 3 cm)', efeito: p.id === 'q1' ? 'Reduz' : 'Aumenta',
  });
  const l = linhasDePropostas(props, ctx);
  const todas = juntarLinhas(linhas, l);

  it('Tipo "Alterar solução", solução atual e nova, efeito, extensões e km inicial e final', () => {
    expect(l[0]).toMatchObject({ tipo: 'Alterar solução', faixa: 2, solucaoAtual: 'REC (Reconstrução)', solucaoNova: 'FS3 (Fresagem funcional 3 cm)', efeito: 'Reduz', extAntes: 40, extDepois: 20, kmIni: '10+400', kmFim: '10+480', origem: 'GPS', precisao: 6, lat: -15.21, lon: -47.91, observacao: 'rebaixa; "pouco"' });
    expect(l[1]).toMatchObject({ faixa: 'Acost.', origem: 'Manual', extAntes: 0, extDepois: 0, lat: -15.2, precisao: null });
  });

  it('entram na ordem do tempo junto das notas', () => {
    expect(todas).toHaveLength(6);
    expect(todas.map((x) => x.tipo)).toEqual(['Defeito', 'Melhorar solução', 'Colocar dreno', 'Alterar solução', 'Alterar solução', 'Retirar solução']);
  });

  it('CSV: mesmas colunas, vírgula decimal', () => {
    const [, ...resto] = csvDeLinhas(todas).slice(1).split('\r\n');
    expect(resto).toHaveLength(6);
    for (const r of resto) expect(r.replace(/"[^"]*(""[^"]*)*"/g, '""').split(';')).toHaveLength(COLUNAS.length);
    expect(resto[3]).toContain(';"REC (Reconstrução)";"FS3 (Fresagem funcional 3 cm)";Reduz;40;20;10+400;10+480;-15,210000;-47,910000;');
  });

  it('XLSX: extensões numéricas e solução em texto', () => {
    const w = XLSX.read(montarXlsx(XLSX as unknown as XlsxLib, fflate as unknown as FflateLib, todas), { type: 'array' }).Sheets['Notas'];
    expect(w['H5'].v).toBe('REC (Reconstrução)'); expect(w['J5'].v).toBe('Reduz');
    expect(w['K5'].t).toBe('n'); expect(w['K5'].v).toBe(40); expect(w['L5'].v).toBe(20);
    expect(w['M5'].v).toBe('10+400'); expect(w['N5'].v).toBe('10+480');
    expect(w['H4']).toBeUndefined(); // dreno: sem solução
  });
});
