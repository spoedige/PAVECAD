import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimarIfc, gerarIfc, geradorIds, globalId, globalIdValido, stepTexto, real, LIMITACAO_Z, type InfoSolucaoIfc } from '../src/formats/ifc';
import { montarModelo, opcoesPadrao } from '../src/dominio/exportGeo';
import { fonte } from './helpers';

const info = (c: string): InfoSolucaoIfc => ({ nome: `Solução ${c} é "boa"`, categoria: 'Reparo', nivel: c === 'RP' ? 7 : null, espessura: 0.05 });
const f = fonte();
const data = new Date(2026, 0, 2, 3, 4, 5);

async function gerar(over = {}) {
  const o = { ...opcoesPadrao('ifc'), ...over };
  const modelo = montarModelo([f], o);
  const saida = await gerarIfc({ titulo: 'Planilha de teste', modelo, opcoes: o, info, crs: f.base.crs, data });
  return { saida, modelo };
}

describe('IFC: peças', () => {
  it('GlobalId: 22 caracteres, válido, determinístico e único', () => {
    const g = globalId('a');
    expect(g).toHaveLength(22);
    expect(globalIdValido(g)).toBe(true);
    expect(globalId('a')).toBe(g);
    expect(globalId('b')).not.toBe(g);
    const gid = geradorIds();
    const ids = new Set(Array.from({ length: 20000 }, (_, i) => gid(`x${i}`)));
    expect(ids.size).toBe(20000);
    for (const i of [...ids].slice(0, 200)) expect(globalIdValido(i)).toBe(true);
  });

  it('texto STEP: aspas, barra e acentos', () => {
    expect(stepTexto("a'b")).toBe("'a''b'");
    expect(stepTexto('a\\b')).toBe("'a\\\\b'");
    expect(stepTexto('Solução')).toBe("'Solu\\X2\\00E700E3\\X0\\o'");
    expect(real(5)).toBe('5.');
    expect(real(0.05)).toBe('0.05');
    expect(real(-12.34567)).toBe('-12.3457');
  });
});

describe('IFC: arquivo', () => {
  it('cabeçalho, esquema, unidades, CRS e hierarquia', async () => {
    const { saida } = await gerar();
    const t = saida.texto;
    expect(t).toContain("FILE_SCHEMA(('IFC4X3_ADD2'));");
    expect(t).toContain("ViewDefinition [ReferenceView]");
    expect(t).toContain('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
    expect(t).toContain('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
    expect(t).toContain("IFCPROJECTEDCRS('EPSG:31982'");
    expect(t).toContain('IFCMAPCONVERSION(');
    expect(t).toContain('PAVECAD_Projeto');
    expect(t).toContain('Z = 0');
    expect(LIMITACAO_Z).toContain('Z = 0');
    expect(t).not.toMatch(/'Pset_|'Qto_/);
    expect(saida.roads).toBe(1);
    expect(saida.roadParts).toBeGreaterThan(0);
    expect(/[^\x00-\x7f]/.test(t)).toBe(false);
  });

  it('a contagem de pavimentos é a de trechos do modelo; resumido tem menos que por trecho', async () => {
    const r = await gerar();
    const p = await gerar({ detalhe: 'trecho' });
    expect(r.saida.pavimentos).toBe(r.modelo.faixas.length);
    expect(p.saida.pavimentos).toBe(p.modelo.faixas.length);
    expect(r.saida.pavimentos).toBeLessThan(p.saida.pavimentos);
    expect((r.saida.texto.match(/=IFCPAVEMENT\(/g) ?? []).length).toBe(r.saida.pavimentos);
  });

  it('determinístico: mesma entrada, mesmo conteúdo', async () => {
    const a = await gerar(), b = await gerar();
    expect(a.saida.texto).toBe(b.saida.texto);
  });

  it('notas só entram com o chip ligado', async () => {
    const nota = { tipo: 'pin' as const, coords: [[-51, -23.5]], categoria: 'Defeito', texto: 'trinca', criado: '2026-01-01', planilha: null, km: null };
    const base = montarModelo([f], opcoesPadrao('ifc'));
    const sem = await gerarIfc({ titulo: 't', modelo: base, opcoes: opcoesPadrao('ifc'), info, crs: f.base.crs, notas: [nota], data });
    expect(sem.anotacoes).toBe(0);
    const com = await gerarIfc({ titulo: 't', modelo: base, opcoes: { ...opcoesPadrao('ifc'), notas: true }, info, crs: f.base.crs, notas: [nota], data });
    expect(com.anotacoes).toBe(1);
    expect(com.texto).toContain('IFCANNOTATION(');
  });

  it('estimativa de tamanho na ordem de grandeza do arquivo', async () => {
    const { saida, modelo } = await gerar();
    const est = estimarIfc(modelo);
    expect(est).toBeGreaterThan(saida.texto.length / 3);
    expect(est).toBeLessThan(saida.texto.length * 3);
  });

  it('valida com ifcopenshell.validate (esquema e regras), sem órfãs e com GlobalIds únicos', async () => {
    const o = { ...opcoesPadrao('ifc'), detalhe: 'trecho' as const, notas: true, camadas: { ...opcoesPadrao('ifc').camadas, propostas: true } };
    const [lat, lon] = [-23.5, -51];
    const nota = (tipo: 'pin' | 'line' | 'area', coords: number[][]) => ({ tipo, coords, categoria: 'Defeito', texto: "trinca d'água", criado: '2026-01-01', planilha: null, km: null });
    const saida = await gerarIfc({
      titulo: 'Planilha de teste', modelo: montarModelo([f], o), opcoes: o, info, crs: f.base.crs, data,
      notas: [nota('pin', [[lon, lat]]), nota('line', [[lon, lat], [lon + 0.001, lat]]), nota('area', [[lon, lat], [lon + 0.001, lat], [lon, lat + 0.001]])],
    });
    expect(saida.anotacoes).toBe(3);
    const dir = mkdtempSync(join(tmpdir(), 'ifc-'));
    const arq = join(dir, 'teste.ifc');
    writeFileSync(arq, saida.texto);
    const r = spawnSync('python3', [join(__dirname, '..', 'scripts', 'validar', 'ifc_validar.py'), arq], { encoding: 'utf8' });
    if (r.status === 2) { console.warn('Validação IFC não rodou: ' + r.stdout.trim()); return; }
    const j = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(j.erros).toEqual([]);
    expect(j.schema).toBe('IFC4X3_ADD2');
    expect(j.contagem.IfcPavement).toBe(saida.pavimentos);
    expect(j.contagem.IfcRoad).toBe(1);
    expect(j.contagem.IfcMapConversion).toBe(1);
    expect(j.globalIdsUnicos).toBe(true);
    expect(j.orfas).toEqual([]);
    if (!j.ifctester.indisponivel) expect(j.ifctester.aprovado).toBe(true);
  });
});
