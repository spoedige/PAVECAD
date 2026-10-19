/** Exportação das notas (rápidas e anotações antigas): linhas, resumo, CSV e nome de arquivo. Funções puras.
 *  O XLSX é montado em xlsxNotas.ts a partir destas mesmas linhas. */
import { crsForZone, toUtm, zoneOf } from '../geometry/utm';
import { TIPOS_RAPIDOS, type DadosRapida } from './notaRapida';

export const COLUNAS = [
  'Data', 'Hora', 'Tipo', 'Rodovia', 'Planilha', 'Sentido', 'Faixa', 'Km', 'Latitude', 'Longitude', 'UTM Leste', 'UTM Norte', 'Origem', 'Precisão (m)', 'Observação', 'Status',
] as const;

export interface NotaExport {
  id: string;
  t: string;
  coords: number[][];
  text: string;
  cat?: string;
  loc?: { pid: string; name: string; km: string; lane: number } | null;
  rapida?: DadosRapida;
}

/** O que o app sabe da nota e a nota sozinha não diz (anotação antiga, modo privacidade). */
export interface ContextoNota { rodovia?: string; planilha?: string; sentido?: string; km?: string; faixa?: number | null }
export interface OpcoesExport {
  /** Rótulo da categoria de uma anotação antiga ("Defeito"). */
  rotuloCat: (cat: string) => string;
  contexto?: (n: NotaExport) => ContextoNota | undefined;
}

export interface Linha {
  /** Dia (número de série do Excel, sem hora). */
  data: number;
  /** Hora do dia como fração (0 a 1). */
  hora: number;
  dataTxt: string;
  horaTxt: string;
  tipo: string;
  rodovia: string;
  planilha: string;
  sentido: string;
  faixa: number | string;
  km: string;
  lat: number;
  lon: number;
  utmE: number;
  utmN: number;
  fuso: string;
  origem: string;
  precisao: number | null;
  observacao: string;
  status: string;
}

const z2 = (v: number) => String(v).padStart(2, '0');
/** Número de série do Excel do dia local (1900, sem o erro do ano bissexto: vale a partir de março de 1900). */
export const serialDoDia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
export const fracaoDoDia = (d: Date) => (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;

/** As notas viram linhas, da mais antiga para a mais nova. */
export function linhasDeNotas(notas: NotaExport[], o: OpcoesExport): Linha[] {
  return [...notas].sort((a, b) => a.t.localeCompare(b.t)).map((n) => {
    const d = new Date(n.t), [lon, lat] = n.coords[0], zone = zoneOf(lon), [e, nn] = toUtm(crsForZone(zone), lat, lon);
    const r = n.rapida, ctx = o.contexto?.(n) ?? {};
    const faixaDe = (f: number | null | undefined) => (f === null || f === undefined ? '' : f === 0 ? 'Acost.' : f);
    return {
      data: serialDoDia(d), hora: fracaoDoDia(d),
      dataTxt: `${z2(d.getDate())}/${z2(d.getMonth() + 1)}/${d.getFullYear()}`, horaTxt: `${z2(d.getHours())}:${z2(d.getMinutes())}`,
      tipo: r ? TIPOS_RAPIDOS[r.tipo].rotulo : o.rotuloCat(n.cat ?? 'obs'),
      rodovia: ctx.rodovia ?? r?.rodovia ?? '',
      planilha: ctx.planilha ?? r?.planilha ?? n.loc?.name ?? '',
      sentido: ctx.sentido ?? r?.sentido ?? '',
      faixa: faixaDe(ctx.faixa !== undefined ? ctx.faixa : r ? r.faixa : n.loc?.lane),
      km: ctx.km ?? r?.km ?? n.loc?.km ?? '',
      lat: +lat.toFixed(6), lon: +lon.toFixed(6), utmE: +e.toFixed(2), utmN: +nn.toFixed(2), fuso: `${zone}S`,
      origem: r ? (r.origem === 'gps' ? 'GPS' : 'Pressão') : 'Manual',
      precisao: r?.precisao ?? null,
      observacao: n.text ?? '',
      status: r?.resolvida ? 'Resolvida' : 'Aberta',
    };
  });
}

export interface Resumo {
  total: number;
  porTipo: [string, number][];
  porRodoviaSentido: [string, string, number][];
  fusos: string[];
}

export function resumoDeLinhas(linhas: Linha[]): Resumo {
  const tipo = new Map<string, number>(), rs = new Map<string, number>();
  for (const l of linhas) {
    tipo.set(l.tipo, (tipo.get(l.tipo) ?? 0) + 1);
    const k = `${l.rodovia || '(sem planilha)'}\u0000${l.sentido}`;
    rs.set(k, (rs.get(k) ?? 0) + 1);
  }
  return {
    total: linhas.length,
    porTipo: [...tipo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    porRodoviaSentido: [...rs.entries()].map(([k, n]) => { const [r, s] = k.split('\u0000'); return [r, s, n] as [string, string, number]; }).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
    fusos: [...new Set(linhas.map((l) => l.fuso))].sort(),
  };
}

/** CSV em UTF-8 com BOM, separador ";" e vírgula decimal (Excel em português), com as mesmas colunas da planilha. */
export function csvDeLinhas(linhas: Linha[], eol = '\r\n'): string {
  const q = (s: string) => (s === '' ? '' : '"' + s.replace(/"/g, '""') + '"'); // campo vazio fica vazio, sem aspas
  const dec = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  const rows = [COLUNAS.join(';')];
  for (const l of linhas) {
    rows.push([
      l.dataTxt, l.horaTxt, q(l.tipo), q(l.rodovia), q(l.planilha), l.sentido, l.faixa, l.km, dec(l.lat, 6), dec(l.lon, 6), dec(l.utmE, 2), dec(l.utmN, 2), l.origem,
      l.precisao === null ? '' : String(l.precisao), q(l.observacao), l.status,
    ].join(';'));
  }
  return '﻿' + rows.join(eol);
}

/** "notas_PAVECAD_2026-10-19_1530.xlsx" (ou .csv), com a data e a hora locais. */
export function nomeArquivoNotas(ext: 'xlsx' | 'csv', d: Date = new Date()): string {
  return `notas_PAVECAD_${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}.${ext}`;
}
