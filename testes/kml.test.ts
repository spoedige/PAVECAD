import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { estimarKml, gerarKml, corKml, type InfoSolucao } from '../src/formats/kml';
import { montarModelo, opcoesPadrao, areaAnel } from '../src/dominio/exportGeo';
import { fonte } from './helpers';

const info = (c: string): InfoSolucao => ({ nome: `Solução ${c}`, cor: c === 'FS3' ? '#ff3b30' : '#34c759', categoria: 'Reparo' });
const f = fonte();

async function kmlDe(over = {}) {
  const o = { ...opcoesPadrao('kmz'), ...over };
  const modelo = montarModelo([f], o);
  return { kml: await gerarKml({ titulo: 'Teste & <cia>', modelo, opcoes: o, info }), modelo };
}

describe('KML', () => {
  it('cor no formato aabbggrr', () => {
    expect(corKml('#ff8000')).toBe('ff0080ff');
    expect(corKml('#102030', 0x80)).toBe('80302010');
  });

  it('um Style por solução, nunca por feição', async () => {
    const { kml, modelo } = await kmlDe();
    const codigos = new Set(modelo.faixas.map((t) => t.codigo));
    const estilos = kml.match(/<Style id="s_[^"]+"/g) ?? [];
    expect(estilos.length).toBe(codigos.size);
    expect((kml.match(/<styleUrl>#s_/g) ?? []).length).toBe(modelo.faixas.length);
  });

  it('coordenadas com 6 casas, anéis fechados, anti-horários e sem degenerados', async () => {
    const { kml } = await kmlDe();
    const rings = [...kml.matchAll(/<Polygon>.*?<coordinates>([^<]+)<\/coordinates>/g)].map((m) => m[1].trim().split(' ').map((c) => c.split(',').map(Number)));
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) {
      expect(r[0]).toEqual(r[r.length - 1]);
      const xy = r.map(([lon, lat]) => [lon, lat] as [number, number]);
      let s = 0;
      for (let i = 0; i < xy.length - 1; i++) s += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
      expect(s).toBeGreaterThan(0);
      expect(areaAnel(xy)).toBeGreaterThan(0);
    }
    expect(/\d+\.\d{7,}/.test(kml.replace(/<\?xml[^>]*>/, ''))).toBe(false);
    expect(/\.\d{6},/.test(kml)).toBe(true);
  });

  it('pastas Rodovia > Sentido > Faixa e ExtendedData estruturado', async () => {
    const { kml } = await kmlDe();
    expect(kml).toContain(`<Folder><name>${f.rodovia}</name><Folder><name>${f.sentido}</name><Folder><name>`);
    expect(kml).toContain('<Folder><name>Faixa 1</name><Placemark>');
    for (const k of ['planilha', 'rodovia', 'faixa', 'sentido', 'solucao', 'codigo', 'kmInicial', 'kmFinal', 'extensao_m', 'area_m2'])
      expect(kml).toContain(`<Data name="${k}">`);
    expect(kml).toContain('Teste &amp; &lt;cia&gt;');
  });

  it('notas só entram com o chip ligado e em pasta própria', async () => {
    const nota = { tipo: 'pin' as const, coords: [[-51, -23.5]], categoria: 'Defeito', texto: 'trinca', criado: '2026-01-01', planilha: null, km: null };
    const base = montarModelo([f], opcoesPadrao('kmz'));
    const sem = await gerarKml({ titulo: 't', modelo: base, opcoes: opcoesPadrao('kmz'), info, notas: [nota] });
    expect(sem).not.toContain('Notas de campo');
    const com = await gerarKml({ titulo: 't', modelo: base, opcoes: { ...opcoesPadrao('kmz'), notas: true }, info, notas: [nota] });
    expect(com).toContain('<Folder><name>Notas de campo</name>');
  });

  it('KMZ: descompacta, traz doc.kml e o XML é bem formado', async () => {
    const { kml } = await kmlDe();
    const kmz = zipSync({ 'doc.kml': strToU8(kml) }, { level: 9 });
    const arq = unzipSync(kmz);
    expect(Object.keys(arq)).toEqual(['doc.kml']);
    expect(strFromU8(arq['doc.kml'])).toBe(kml);
    expect(kmz.length).toBeLessThan(kml.length);
    const est = estimarKml(montarModelo([f], opcoesPadrao('kmz')));
    expect(est.kml).toBeGreaterThan(kml.length / 3);
    expect(est.kml).toBeLessThan(kml.length * 3);
  });

  it('valida contra o esquema oficial do KML 2.2 (pykml)', async () => {
    const { kml } = await kmlDe({ detalhe: 'completo', camadas: { ...opcoesPadrao('kmz').camadas, estacas: true, patologias: true } });
    const dir = mkdtempSync(join(tmpdir(), 'kml-'));
    const arq = join(dir, 'doc.kml');
    writeFileSync(arq, kml);
    const r = spawnSync('python3', [join(__dirname, '..', 'scripts', 'validar', 'kml_xsd.py'), arq], { encoding: 'utf8' });
    if (r.status === 2) { console.warn('Validação XSD do KML não rodou: ' + r.stdout.trim()); return; }
    expect(r.stdout).toContain('KML 2.2 válido');
    expect(r.status).toBe(0);
  });
});
