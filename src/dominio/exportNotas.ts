/** Exportação das notas (rápidas e anotações antigas): linhas, resumo, CSV e nome de arquivo. Funções puras.
 *  O XLSX é montado em xlsxNotas.ts a partir destas mesmas linhas. */
import { crsForZone, toUtm, zoneOf } from '../geometry/utm';
import { TIPOS_RAPIDOS, situacaoConserva, type DadosRapida } from './notaRapida';

export const COLUNAS = [
  'Data', 'Hora', 'Tipo', 'Rodovia', 'Planilha', 'Sentido', 'Faixa', 'Solução atual', 'Solução nova', 'Efeito', 'Extensão antes (m)', 'Extensão depois (m)', 'Km inicial', 'Km final',
  'Latitude', 'Longitude', 'UTM Leste', 'UTM Norte', 'Origem', 'Precisão (m)', 'Observação', 'Status',
  'Desde', 'Até', 'Situação', 'Arquivo da foto',
] as const;

export interface NotaExport {
  id: string;
  t: string;
  coords: number[][];
  text: string;
  cat?: string;
  loc?: { pid: string; name: string; km: string; lane: number } | null;
  rapida?: DadosRapida;
  /** Fotos da nota (data URL JPEG). */
  photos?: string[];
}

/** O que o app sabe da nota e a nota sozinha não diz (anotação antiga, modo privacidade). */
export interface ContextoNota { rodovia?: string; planilha?: string; sentido?: string; km?: string; faixa?: number | null; /** "Ver conserva": data do projeto (dd/mm/aaaa), a mesma para todas as notas da planilha. */ desde?: string }
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
  solucaoAtual: string;
  solucaoNova: string;
  efeito: string;
  extAntes: number | null;
  extDepois: number | null;
  kmIni: string;
  kmFim: string;
  lat: number;
  lon: number;
  utmE: number;
  utmN: number;
  fuso: string;
  origem: string;
  precisao: number | null;
  observacao: string;
  status: string;
  /** "Ver conserva": início do período a conferir (data do projeto), ou vazio. */
  desde: string;
  /** "Ver conserva": data e hora da nota. */
  ate: string;
  /** "Ver conserva": Pendente ou Verificado. */
  situacao: string;
  /** Foto: nome do arquivo na pasta fotos/. */
  arquivoFoto: string;
}

const z2 = (v: number) => String(v).padStart(2, '0');
/** Número de série do Excel do dia local (1900, sem o erro do ano bissexto: vale a partir de março de 1900). */
export const serialDoDia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
export const fracaoDoDia = (d: Date) => (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;

const dataHoraTxt = (d: Date) => `${z2(d.getDate())}/${z2(d.getMonth() + 1)}/${d.getFullYear()} ${z2(d.getHours())}:${z2(d.getMinutes())}`;

/** "km177+000_Fx2_20261026_143005.jpg": km do segmento, faixa (Fx1 a Fx6, Ac para o acostamento, sem faixa fica só o km), data e hora locais.
 *  Repetido (mesmo segundo e mesmo local), ganha _2, _3... Sem km: "kmND". */
export function nomeArquivoFoto(d: Date, km: string | null | undefined, faixa: number | string | null | undefined, usados?: Set<string>): string {
  const f = faixa === null || faixa === undefined || faixa === '' ? '' : faixa === 0 || faixa === 'Acost.' ? '_Ac' : `_Fx${faixa}`;
  const base = `km${(km || 'ND').replace(/[^0-9A-Za-z+]/g, '')}${f}_${d.getFullYear()}${z2(d.getMonth() + 1)}${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}${z2(d.getSeconds())}`;
  let nome = `${base}.jpg`;
  for (let k = 2; usados?.has(nome); k++) nome = `${base}_${k}.jpg`;
  usados?.add(nome);
  return nome;
}

/** As notas viram linhas, da mais antiga para a mais nova. */
export function linhasDeNotas(notas: NotaExport[], o: OpcoesExport): Linha[] {
  const usados = new Set<string>();
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
      solucaoAtual: '', solucaoNova: '', efeito: '', extAntes: null, extDepois: null,
      kmIni: ctx.km ?? r?.km ?? n.loc?.km ?? '', kmFim: '',
      lat: +lat.toFixed(6), lon: +lon.toFixed(6), utmE: +e.toFixed(2), utmN: +nn.toFixed(2), fuso: `${zone}S`,
      origem: r ? (r.origem === 'gps' ? 'GPS' : 'Pressão') : 'Manual',
      precisao: r?.precisao ?? null,
      observacao: n.text ?? '',
      status: r?.resolvida ? 'Resolvida' : 'Aberta',
      desde: r?.tipo === 'conserva' ? ctx.desde ?? '' : '',
      ate: r?.tipo === 'conserva' ? dataHoraTxt(d) : '',
      situacao: r?.tipo === 'conserva' ? situacaoConserva(r) : '',
      arquivoFoto: r?.tipo === 'foto' && n.photos?.length ? nomeArquivoFoto(d, ctx.km ?? r.km ?? n.loc?.km, ctx.faixa !== undefined ? ctx.faixa : r.faixa, usados) : '',
    };
  });
}

/** As fotos das notas "Foto", com o nome que a coluna "Arquivo da foto" traz (a mesma ordem e a mesma regra de nomes). */
export function fotosDeNotas(notas: NotaExport[], o: OpcoesExport): { nome: string; data: string; lat: number; lon: number; t: string }[] {
  const linhas = linhasDeNotas(notas, o), ordem = [...notas].sort((a, b) => a.t.localeCompare(b.t));
  const out: { nome: string; data: string; lat: number; lon: number; t: string }[] = [];
  ordem.forEach((n, i) => {
    if (!linhas[i].arquivoFoto || !n.photos?.length) return;
    out.push({ nome: linhas[i].arquivoFoto, data: n.photos[0], lon: n.coords[0][0], lat: n.coords[0][1], t: n.t });
  });
  return out;
}

/** Alteração de solução (a proposta, feita em campo ou na barra Propor) como linha da planilha de notas. */
export interface PropExport {
  id: string;
  t: string;
  lane: number;
  note: string;
  campo?: { efeito: string; antes: number; depois: number; origem: 'pressao' | 'gps'; precisao: number | null; lat: number; lon: number };
}
export interface ContextoProp {
  rodovia: string; planilha: string; sentido: string; kmIni: string; kmFim: string;
  /** Meio do trecho, para as propostas sem posição de campo. */
  lat: number; lon: number;
  /** Solução atual e nova como "FS3 (Fresagem funcional 3 cm)"; efeito deduzido. */
  atual: string; nova: string; efeito: string;
}

export function linhasDePropostas(props: PropExport[], ctx: (p: PropExport) => ContextoProp | undefined): Linha[] {
  const out: Linha[] = [];
  for (const r of props) {
    const c = ctx(r);
    if (!c) continue;
    const d = new Date(r.t), lat = r.campo?.lat ?? c.lat, lon = r.campo?.lon ?? c.lon, zone = zoneOf(lon), [e, nn] = toUtm(crsForZone(zone), lat, lon);
    out.push({
      data: serialDoDia(d), hora: fracaoDoDia(d),
      dataTxt: `${z2(d.getDate())}/${z2(d.getMonth() + 1)}/${d.getFullYear()}`, horaTxt: `${z2(d.getHours())}:${z2(d.getMinutes())}`,
      tipo: 'Alterar solução', rodovia: c.rodovia, planilha: c.planilha, sentido: c.sentido, faixa: r.lane === 0 ? 'Acost.' : r.lane,
      solucaoAtual: c.atual, solucaoNova: c.nova, efeito: c.efeito, extAntes: r.campo?.antes ?? 0, extDepois: r.campo?.depois ?? 0, kmIni: c.kmIni, kmFim: c.kmFim,
      lat: +lat.toFixed(6), lon: +lon.toFixed(6), utmE: +e.toFixed(2), utmN: +nn.toFixed(2), fuso: `${zone}S`,
      origem: r.campo ? (r.campo.origem === 'gps' ? 'GPS' : 'Pressão') : 'Manual', precisao: r.campo?.precisao ?? null, observacao: r.note ?? '', status: 'Aberta',
      desde: '', ate: '', situacao: '', arquivoFoto: '',
    });
  }
  return out;
}

/** Notas e alterações juntas, da mais antiga para a mais nova. */
export const juntarLinhas = (...listas: Linha[][]): Linha[] => listas.flat().sort((a, b) => a.data + a.hora - (b.data + b.hora));

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
      l.dataTxt, l.horaTxt, q(l.tipo), q(l.rodovia), q(l.planilha), l.sentido, l.faixa, q(l.solucaoAtual), q(l.solucaoNova), l.efeito, l.extAntes === null ? '' : String(l.extAntes), l.extDepois === null ? '' : String(l.extDepois), l.kmIni, l.kmFim,
      dec(l.lat, 6), dec(l.lon, 6), dec(l.utmE, 2), dec(l.utmN, 2), l.origem, l.precisao === null ? '' : String(l.precisao), q(l.observacao), l.status,
      l.desde, l.ate, l.situacao, q(l.arquivoFoto),
    ].join(';'));
  }
  return '﻿' + rows.join(eol);
}

/** "notas_PAVECAD_2026-10-19_1530.xlsx" (ou .csv), com a data e a hora locais. */
export function nomeArquivoNotas(ext: 'xlsx' | 'csv', d: Date = new Date()): string {
  return `notas_PAVECAD_${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}.${ext}`;
}
