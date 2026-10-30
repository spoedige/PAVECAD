import { describe, expect, it } from 'vitest';
import { lerBackup, montarBackup, nomeArquivoBackup, novosPorId } from '../src/dominio/backup';

describe('backup completo', () => {
  const partes = {
    notas: [{ id: 'n1', text: 'a' }, { id: 'n2', text: 'b' }],
    propostas: [{ id: 'r1', pid: 'p9', orfa: false, r0: 3, r1: 5, km0: 1, km1: 2, from: 'FS3', to: 'RP' }],
    catalogo: { tipo: 'catalogo-solucoes', itens: [] }, limiares: { iri: [1, 2, 3, 4] },
    planilhas: [{ id: 'RD-001', parsed: { meta: {}, rows: [] }, zone: 22 }],
  };

  it('ida e volta: tudo o que foi guardado volta, sem os campos derivados da proposta', () => {
    const b = montarBackup(partes, new Date(2026, 0, 2));
    expect(b.tipo).toBe('pavecad-backup');
    const volta = lerBackup(JSON.parse(JSON.stringify(b)))!;
    expect(volta.notas).toEqual(partes.notas);
    expect(volta.planilhas).toEqual(partes.planilhas);
    expect(volta.catalogo).toEqual(partes.catalogo);
    expect(volta.propostas).toEqual([{ id: 'r1', km0: 1, km1: 2, from: 'FS3', to: 'RP' }]);
  });

  it('não confunde o GeoJSON de notas antigo com backup, e recusa versão futura', () => {
    expect(lerBackup({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(lerBackup(null)).toBeNull();
    expect(lerBackup({ tipo: 'pavecad-backup', versao: 99 })).toBeNull();
  });

  it('ignora itens sem id ou planilha sem dados', () => {
    const b = lerBackup({ tipo: 'pavecad-backup', versao: 2, notas: [{ id: 'a' }, { x: 1 }], propostas: [], planilhas: [{ id: 'x' }, { id: 'y', parsed: {} }] })!;
    expect(b.notas).toHaveLength(1);
    expect(b.planilhas.map((p) => p.id)).toEqual(['y']);
  });

  it('mescla por id: quem já existe fica como está', () => {
    const r = novosPorId([{ id: 'n1' }], [{ id: 'n1' }, { id: 'n2' }]);
    expect(r.novos).toEqual([{ id: 'n2' }]);
    expect(r.repetidos).toBe(1);
  });

  it('nome do arquivo', () => expect(nomeArquivoBackup(new Date(2026, 2, 5))).toBe('pavtrack-backup-2026-03-05.json'));
});
