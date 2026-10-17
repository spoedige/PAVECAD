import { reconstruir, type Reconstrucao } from './reconstrucao';
import type { FormatDef, Lane, LogEntry, ParsedProject, Qualidade, Row, SheetBook } from './types';
import { distM } from '../dominio/medidas';

/**
 * Padrão Planservi: aba "SOLUÇÃO_FINAL" (uma linha por segmento de 20 m) e aba "IRI" (ignorada).
 * Cada arquivo gera dois projetos, Crescente e Decrescente, cada um com as coordenadas do seu sentido.
 *
 * A leitura é sempre pelos cabeçalhos das linhas 5 a 7, nunca por posição fixa de coluna: a ordem das
 * quatro colunas de cada faixa se inverte no decrescente. A linha 5 diz o sentido dos blocos de indicadores,
 * a linha 6 o bloco (faixa, acostamento, dreno, indicador, coordenadas) e a linha 7 a camada ou a faixa.
 * Células mescladas só trazem o texto na primeira coluna; o texto vale até o próximo cabeçalho à direita.
 * Linhas de dado são as que têm número na coluna 1. A primeira linha seguinte sem número, com coordenadas,
 * dá o ponto de fim do último segmento.
 */
const ABA = 'SOLUÇÃO_FINAL';
const H = { sentido: 4, bloco: 5, sub: 6, dados: 7 } as const; // índices base 0 das linhas 5, 6, 7 e 8

/** Largura assumida (a planilha não traz): ajustável em Configurações > Larguras. */
export const LARGURA_FAIXA_PADRAO = 3.6;
export const LARGURA_ACOSTAMENTO_PADRAO = 2.5;

export type Sentido = 'Crescente' | 'Decrescente';
export type CamadaKey = 'est' | 'fun' | 'fre' | 'rev';
export type IndKeyP = 'igg' | 'fc3' | 'fc2' | 'iri' | 'flecha';

/** Nome de cada camada, na ordem em que o detalhe do segmento as lista. */
export const CAMADAS: { key: CamadaKey; nome: string }[] = [
  { key: 'est', nome: 'Estrutural' },
  { key: 'fre', nome: 'Fresagem / Recomposição estrutural' },
  { key: 'fun', nome: 'Funcional' },
  { key: 'rev', nome: 'Revestimento' },
];

const norm = (v: unknown): string =>
  typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';
const low = (v: unknown) => norm(v).toLowerCase();
const num = (v: unknown, n = 3): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(n)) : null;

/** Preenche para a direita: cada cabeçalho vale até o próximo. Colunas antes do primeiro cabeçalho ficam vazias. */
function preencher(linha: unknown[] | undefined, n: number): string[] {
  const out: string[] = [];
  let atual = '';
  for (let c = 0; c < n; c++) {
    const t = norm(linha?.[c]);
    if (t) atual = t;
    out.push(atual);
  }
  return out;
}

interface Mapa {
  /** Camadas por sentido, faixa (1 ou 2) e camada: índice da coluna. */
  camada: Record<Sentido, Record<number, Partial<Record<CamadaKey, number>>>>;
  acost: Partial<Record<Sentido, number>>;
  dreno: Partial<Record<Sentido, number>>;
  ind: Record<Sentido, Record<number, Partial<Record<IndKeyP, number>>>>;
  coord: Record<Sentido, { lat: number; lon: number } | undefined>;
  col: { seg: number; km: number; ini: number; fim: number };
}

const sentidoDe = (t: string): Sentido | null => (/^decrescente/i.test(t) ? 'Decrescente' : /^crescente/i.test(t) ? 'Crescente' : null);

/** Lê os cabeçalhos das linhas 5 a 7 e devolve onde está cada coluna. Lança erro com o que faltou. */
export function mapearCabecalhos(S: unknown[][]): Mapa {
  const n = Math.max(...S.slice(0, 8).map((r) => r?.length ?? 0), 0);
  const r5 = preencher(S[H.sentido], n), r6 = preencher(S[H.bloco], n), r7 = S[H.sub] ?? [];
  const m: Mapa = {
    camada: { Crescente: {}, Decrescente: {} }, acost: {}, dreno: {}, ind: { Crescente: {}, Decrescente: {} },
    coord: { Crescente: undefined, Decrescente: undefined }, col: { seg: 0, km: -1, ini: -1, fim: -1 },
  };
  const camadaDe = (t: string): CamadaKey | null => (/^estrutural/i.test(t) ? 'est' : /^funcional/i.test(t) ? 'fun' : /^fresag/i.test(t) ? 'fre' : /^revest/i.test(t) ? 'rev' : null);
  for (let c = 0; c < n; c++) {
    const b = r6[c], sub = norm(r7[c]), lb = b.toLowerCase();
    if (!b) continue;
    if (/^segmento$/i.test(b)) m.col.seg = c;
    else if (/^segmentos homog/i.test(b)) {
      if (/^km$/i.test(sub)) m.col.km = c;
      else if (/in[ií]cio/i.test(sub)) m.col.ini = c;
      else if (/fim/i.test(sub)) m.col.fim = c;
    } else if (/^coordenadas/i.test(b)) {
      const s = /decrescente/i.test(b) ? 'Decrescente' : 'Crescente';
      m.coord[s] ??= { lat: -1, lon: -1 };
      if (/^lat/i.test(sub)) m.coord[s]!.lat = c; else if (/^lon/i.test(sub)) m.coord[s]!.lon = c;
    } else if (/faixa\s*(\d)/i.test(b) && sentidoDe(b)) {
      const s = sentidoDe(b)!, f = Number(/faixa\s*(\d)/i.exec(b)![1]), k = camadaDe(sub);
      if (k) (m.camada[s][f] ??= {})[k] = c;
    } else if (/acostamento/i.test(lb) && sentidoDe(b)) {
      m.acost[sentidoDe(b)!] = c; // só a coluna de revestimento existe nesse bloco
    } else if (/^drenos/i.test(lb)) {
      const s = sentidoDe(r5[c]);
      if (s) m.dreno[s] = c;
    } else {
      const s = sentidoDe(r5[c]);
      const k: IndKeyP | null = /^igg/i.test(b) ? 'igg' : /^fc-?3/i.test(b) ? 'fc3' : /^fc-?2/i.test(b) ? 'fc2' : /^iri/i.test(b) ? 'iri' : /^flecha/i.test(b) ? 'flecha' : null;
      const f = /faixa\s*(\d)/i.exec(sub);
      if (s && k && f) (m.ind[s][Number(f[1])] ??= {})[k] = c;
    }
  }
  const falta: string[] = [];
  if (m.col.km < 0) falta.push('km (Segmentos Homogêneos)');
  for (const s of ['Crescente', 'Decrescente'] as const) {
    const c = m.coord[s];
    if (!c || c.lat < 0 || c.lon < 0) falta.push(`Coordenadas (${s})`);
    if (!m.camada[s][1] || !Object.keys(m.camada[s][1]).length) falta.push(`${s} - Faixa 1`);
  }
  if (falta.length) throw new Error('cabeçalhos do Planservi não encontrados: ' + falta.join(', '));
  return m;
}

/* ---------------------------------------------------------------- */
/* Camadas                                                           */
/* ---------------------------------------------------------------- */

/** Códigos do catálogo usados pelo Planservi. As cores vêm do catálogo e são editáveis. */
export const COD = { selagem: 'ST', micro: 'MF', reconstrucao: 'RE', reparo: 'RP', reforco: 'REF', verProjeto: 'VP' } as const;

/** Descrição do que a planilha escreveu numa célula de camada, na linguagem da legenda do Planservi. */
export function descreverCamada(valor: string | number | null | undefined, camada: CamadaKey): string {
  if (valor === null || valor === undefined || valor === '' || valor === '-') return 'Nada';
  if (valor === '*') return 'Ver projeto à parte';
  if (valor === 1 || valor === '1') return camada === 'est' ? 'Sem intervenção' : '1';
  const t = String(valor).trim();
  let m = /^F(\d+(?:[.,]\d+)?)R(\d+(?:[.,]\d+)?)$/i.exec(t);
  if (m) return `${t} · fresagem de ${m[1].replace('.', ',')} cm e recomposição de ${m[2].replace('.', ',')} cm`;
  m = /^PMQ\s*(\d+(?:[.,]\d+)?)$/i.exec(t);
  if (m) return `${t} · reforço estrutural (PMQ) de ${m[1].replace('.', ',')} cm`;
  m = /^R\s*(\d+(?:[.,]\d+)?)$/i.exec(t);
  if (m) return `${t} · reforço estrutural de ${m[1].replace('.', ',')} cm`;
  const nomes: Record<string, string> = { ST: 'selagem de trincas', MF: 'microfresagem', RE: 'reconstrução', RP: 'reparo profundo' };
  return nomes[t.toUpperCase()] ? `${t} · ${nomes[t.toUpperCase()]}` : t;
}

/** Espessuras (cm) lidas do número do código. F4R10: fresagem 4 e recomposição 10. R2,5 e PMQ3,0: reforço. */
export function espessuras(valor: string): { fresagem?: number; recomposicao?: number; reforco?: number } {
  const n = (s: string) => Number(s.replace(',', '.'));
  let m = /^F(\d+(?:[.,]\d+)?)R(\d+(?:[.,]\d+)?)$/i.exec(valor.trim());
  if (m) return { fresagem: n(m[1]), recomposicao: n(m[2]) };
  m = /^(?:PMQ|R)\s*(\d+(?:[.,]\d+)?)$/i.exec(valor.trim());
  if (m) return { reforco: n(m[1]) };
  return {};
}

type Celula = string | number | null;
const ehNada = (v: Celula) => v === null || v === undefined || v === '' || v === '-';

interface Intervencao { rank: number; code: string }

/** Classifica uma célula de camada pela ordem de força: 1 estrutural (RE, RP, EX), 2 fresagem/recomposição estrutural,
 *  3 funcional (FXRX), 4 MF, 5 ST, 6 só revestimento. Devolve null quando não há intervenção (vazio, "-" ou "1" no estrutural). */
export function classificar(v: Celula, camada: CamadaKey): Intervencao | null {
  if (ehNada(v)) return null;
  if (camada === 'est') {
    if (v === 1 || v === '1') return null;
    if (typeof v === 'number') return null; // outro número: sem leitura, o importador avisa
    return { rank: 1, code: String(v).trim().toUpperCase() };
  }
  if (v === '*') return { rank: camada === 'fre' ? 2 : camada === 'fun' ? 3 : 6, code: COD.verProjeto };
  const t = String(v).trim().toUpperCase();
  if (camada === 'fre') return { rank: 2, code: t };
  if (camada === 'fun') return { rank: t === 'MF' ? 4 : t === 'ST' ? 5 : 3, code: t };
  return { rank: 6, code: COD.reforco }; // revestimento: R e PMQ viram "Reforço"; a espessura fica na camada
}

/** Camada mais forte da faixa (menor rank). Em empate de rank vale a ordem das camadas. */
export function maisForte(c: Partial<Record<CamadaKey, Celula>>): string | null {
  let best: Intervencao | null = null;
  for (const k of ['est', 'fre', 'fun', 'rev'] as CamadaKey[]) {
    const i = classificar(c[k] ?? null, k);
    if (i && (!best || i.rank < best.rank)) best = i;
  }
  return best ? best.code : null;
}

/* ---------------------------------------------------------------- */
/* Leitura                                                           */
/* ---------------------------------------------------------------- */

const estaca = (v: unknown): string | null => {
  const m = /^(\d+)\s*\+\s*(\d+)$/.exec(norm(v));
  return m ? `${m[1]}+${m[2]}` : null;
};

function lerRodovia(S: unknown[][]): { rodovia: string; th: string | null; trecho: string | null } {
  const linha = S[1] ?? [];
  let txt = '';
  for (let c = 0; c < linha.length; c++) if (/^rodovia/i.test(norm(linha[c]))) { txt = norm(linha.slice(c + 1).find((x) => norm(x))); break; }
  const partes = txt.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const trecho = norm((S[2] ?? []).find((x, i, a) => i > 0 && /^trecho/i.test(norm(a[i - 1])) && norm(x)));
  return { rodovia: partes[0] || 'Planservi', th: partes[1] || null, trecho: trecho || null };
}

interface LinhaDado { r: unknown[]; i: number }

function montarProjeto(S: unknown[][], m: Mapa, dados: LinhaDado[], fim: unknown[] | null, s: Sentido, topo: ReturnType<typeof lerRodovia>, ignoradas: string[]): ParsedProject {
  const log: LogEntry[] = [];
  const c = m.coord[s]!;
  const cel = (r: unknown[], col: number | undefined): Celula => {
    if (col === undefined || col < 0) return null;
    const v = r[col];
    if (typeof v === 'number') return v;
    const t = norm(v);
    return t === '' ? null : t;
  };
  const lanesTodas = [1, 2].filter((f) => m.camada[s][f]);
  const outrosNumeros = new Set<number>();
  const rows: Row[] = [];
  const kms: number[] = [];

  const linhaDe = (r: unknown[], terminal: boolean, modelo: Row | null): Row | null => {
    const lat = r[c.lat], lon = r[c.lon], km = r[m.col.km];
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof km !== 'number') return null;
    if (terminal && modelo) {
      return { ...modelo, hod: km, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), marco: estaca(r[m.col.ini]) ?? modelo.marco, obs: 'ponto final do trecho (sem dados próprios)' };
    }
    const lanes: Lane[] = [];
    let nl = 0;
    const camadasPorFaixa: Partial<Record<CamadaKey, Celula>>[] = [];
    lanesTodas.forEach((f, idx) => {
      const col = m.camada[s][f], ind = m.ind[s][f] ?? {};
      const v: Partial<Record<CamadaKey, Celula>> = {};
      for (const k of ['est', 'fre', 'fun', 'rev'] as CamadaKey[]) v[k] = cel(r, col[k]);
      const temInd = (['igg', 'fc3', 'fc2', 'iri', 'flecha'] as IndKeyP[]).some((k) => typeof r[ind[k] ?? -1] === 'number');
      const existe = (['est', 'fre', 'fun', 'rev'] as CamadaKey[]).some((k) => !ehNada(v[k] ?? null)) || temInd;
      camadasPorFaixa[idx] = v;
      if (existe) nl = idx + 1;
    });
    for (let idx = 0; idx < nl; idx++) {
      const f = lanesTodas[idx], col = m.camada[s][f], ind = m.ind[s][f] ?? {};
      const v = camadasPorFaixa[idx];
      const code = maisForte(v);
      const ve = v.est;
      if (typeof ve === 'number' && ve !== 1) outrosNumeros.add(ve);
      const esp = { fresagem: undefined as number | undefined, recomposicao: undefined as number | undefined, reforco: undefined as number | undefined };
      for (const k of ['fre', 'fun'] as CamadaKey[]) { const t = v[k]; if (typeof t === 'string') { const e = espessuras(t); esp.fresagem ??= e.fresagem; esp.recomposicao ??= e.recomposicao; } }
      if (typeof v.rev === 'string') esp.reforco = espessuras(v.rev).reforco;
      const val = (k: IndKeyP, d: number) => num(r[ind[k] ?? -1], d);
      lanes.push({
        code, iri: val('iri', 2), defPct: null, atr: val('flecha', 1), d0: null, rc: null, d120: null, opdr: null, exafe: null, hr: null,
        treat: [0, 0, 0, 0, 0, 0, 0], fsTipo: null, fsEsp: esp.fresagem ?? null, fsPct: null, gapCm: null,
        igg: val('igg', 2), fc2: val('fc2', 4), fc3: val('fc3', 4),
        recCm: esp.recomposicao ?? null, refCm: esp.reforco ?? null,
        camadas: CAMADAS.map(({ key, nome }) => ({ nome, bruto: v[key] === null || v[key] === undefined ? null : String(v[key]), texto: descreverCamada(v[key], key) })),
      });
      void col;
    }
    const acRaw = cel(r, m.acost[s]);
    const acClasse = classificar(acRaw, 'rev');
    const temAc = !ehNada(acRaw);
    const dr = cel(r, m.dreno[s]);
    return {
      hod: km, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), z: null,
      widths: lanes.map(() => LARGURA_FAIXA_PADRAO),
      shoulder: temAc ? LARGURA_ACOSTAMENTO_PADRAO : 0,
      shoulderCode: acClasse ? acClasse.code : null, shoulderRaw: temAc ? String(acRaw) : null,
      obs: null, platform: null, lanes,
      marco: estaca(r[m.col.ini]), drain: dr !== null && String(dr).trim().toUpperCase() === 'X' ? ['?', null] : null, he: [null, null],
    };
  };

  for (const d of dados) {
    const row = linhaDe(d.r, false, null);
    if (row) { rows.push(row); kms.push(d.r[m.col.km] as number); }
  }
  let temTerminal = false;
  if (fim && rows.length) {
    const ult = rows[rows.length - 1];
    const t = linhaDe(fim, true, ult);
    if (t) {
      rows.push(t);
      temTerminal = true;
      log.push({ level: 'info', code: 'planservi-linha-final', msg: `A última linha (sem número, km ${t.marco ?? t.hod}) deu a coordenada do fim do último segmento` });
    }
  }
  if (!rows.length) throw new Error(`nenhuma linha com número na coluna 1 da aba ${ABA}`);
  if (outrosNumeros.size) log.push({ level: 'warn', code: 'planservi-estrutural-numero', msg: `Estrutural com número diferente de 1 (${[...outrosNumeros].join(', ')}): tratado como sem intervenção` });
  for (const t of ignoradas) log.push({ level: 'info', code: 'planservi-aba-ignorada', msg: t });

  const rec = reconstruir(rows.map((r) => ({ km: r.hod * 1000, lat: r.lat, lon: r.lon })), temTerminal);
  aplicarReconstrucao(rows, rec);

  const codes: Record<string, number> = {};
  const conta = (cod: string | null) => { if (cod) codes[cod] = (codes[cod] || 0) + 1; };
  for (const r of rows) { r.lanes.forEach((l) => conta(l.code)); conta(r.shoulderCode); }

  const nome = `${topo.rodovia}${topo.th ? ' · ' + topo.th : ''} · ${s}`;
  const km0 = rows[0].hod, km1 = rows[rows.length - 1].hod;
  return {
    meta: { name: nome, uf: topo.rodovia, via: `${topo.th ? topo.th + ' · ' : ''}${s}`, travel: s === 'Crescente' ? 1 : -1, kmi: km0, kmf: km1, format: 'planservi' },
    rows, log, codes,
    qualidade: qualidadeDe(rows, rec),
  };
}

/* ---------------------------------------------------------------- */
/* Qualidade das coordenadas                                         */
/* ---------------------------------------------------------------- */

/** Salto aceitável entre linhas consecutivas (m) e distância máxima entre os sentidos (m). A tolerância de 0,5 m absorve o ruído de
 *  medida: um passo de 30,1 m é o passo de 30 m, não um salto. */
export const SALTO_MIN = 10, SALTO_MAX = 30, SALTO_TOLERANCIA = 0.5, ENTRE_SENTIDOS_MAX = 100;

const kmTxt = (r: Row) => r.marco ?? r.hod.toFixed(3);

/** Só sinaliza: não corrige nem descarta nada. */
export function qualidade(rows: Row[], outro: Row[]): Qualidade {
  const saltos: Qualidade['saltos'] = [];
  for (let i = 1; i < rows.length; i++) {
    const d = distM([rows[i - 1].lon, rows[i - 1].lat], [rows[i].lon, rows[i].lat]);
    if (d < SALTO_MIN - SALTO_TOLERANCIA || d > SALTO_MAX + SALTO_TOLERANCIA) saltos.push({ i, km: kmTxt(rows[i - 1]), kmFim: kmTxt(rows[i]), dist: Math.round(d * 10) / 10 });
  }
  const sentidos: Qualidade['sentidos'] = [];
  const n = Math.min(rows.length, outro.length);
  for (let i = 0; i < n; i++) {
    const d = distM([rows[i].lon, rows[i].lat], [outro[i].lon, outro[i].lat]);
    if (d > ENTRE_SENTIDOS_MAX) sentidos.push({ i, km: kmTxt(rows[i]), dist: Math.round(d) });
  }
  return { saltos, sentidos, faixaSalto: [SALTO_MIN, SALTO_MAX], maxSentidos: ENTRE_SENTIDOS_MAX };
}

/** Troca as coordenadas reconstruídas e marca onde a linha foi cortada. */
function aplicarReconstrucao(rows: Row[], rec: Reconstrucao) {
  for (const c of rec.corrigidos) { rows[c.i].lat = Number(c.lat.toFixed(7)); rows[c.i].lon = Number(c.lon.toFixed(7)); }
  for (const c of rec.cortes) rows[c.i].quebra = true;
}

/** Relatório da reconstrução. Os saltos e a distância entre sentidos entram depois, medidos nas coordenadas já corrigidas. */
function qualidadeDe(rows: Row[], rec: Reconstrucao): Qualidade {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    saltos: [], sentidos: [], faixaSalto: [SALTO_MIN, SALTO_MAX], maxSentidos: ENTRE_SENTIDOS_MAX,
    corrigidos: rec.corrigidos.map((c) => ({ i: c.i, km: kmTxt(rows[c.i]), tipo: c.tipo, causa: c.causa, deslocamento: r1(c.deslocamento), orig: c.orig })),
    cortes: rec.cortes.map((c) => ({ i: c.i, km: kmTxt(rows[c.i - 1]), kmFim: kmTxt(rows[c.i]), dist: r1(c.dist), esperado: r1(c.esperado) })),
    avisos: rec.avisos.map((a) => ({ tipo: a.tipo, km: kmTxt(rows[a.i0]), kmFim: kmTxt(rows[a.i1]), dist: r1(a.dist), esperado: r1(a.esperado) })),
  };
}

const lista = (itens: string[], max = 40) => (itens.length > max ? itens.slice(0, max).join(', ') + ` e mais ${itens.length - max}` : itens.join(', '));

const ROTULO_TIPO: Record<string, string> = { repetido: 'ponto repetido', salto: 'salto', retrocedendo: 'retrocedendo', inicial: 'ponto inicial', final: 'ponto final' };

function logQualidade(q: Qualidade, s: Sentido): LogEntry[] {
  const out: LogEntry[] = [];
  if (q.corrigidos?.length) {
    out.push({
      level: 'warn', code: 'planservi-corrigidos',
      msg: `${s}: ${q.corrigidos.length} coordenada${q.corrigidos.length > 1 ? 's' : ''} reconstruída${q.corrigidos.length > 1 ? 's' : ''} pelo km (a planilha original não muda). Km (tipo, deslocamento): ${lista(q.corrigidos.map((x) => `${x.km} (${ROTULO_TIPO[x.tipo]}${x.causa && x.causa !== 'terminal' ? ', ' + ROTULO_TIPO[x.causa] : ''}, ${String(x.deslocamento).replace('.', ',')} m)`))}`,
    });
  }
  if (q.cortes?.length) {
    out.push({
      level: 'warn', code: 'planservi-corte',
      msg: `${s}: ${q.cortes.length} descontinuidade${q.cortes.length > 1 ? 's' : ''} real${q.cortes.length > 1 ? 'is' : ''} de coordenada; o traçado foi cortado em trechos separados, sem interpolar. Entre km (passo, esperado): ${lista(q.cortes.map((x) => `${x.km} e ${x.kmFim} (${String(x.dist).replace('.', ',')} m, ${String(x.esperado).replace('.', ',')} m)`))}`,
    });
  }
  const parados = q.avisos?.filter((x) => x.tipo === 'estacionario') ?? [];
  if (parados.length) out.push({ level: 'info', code: 'planservi-parado', msg: `${s}: ${parados.length} trecho${parados.length > 1 ? 's' : ''} com coordenadas quase paradas enquanto o km avança (não corrigido): ${lista(parados.map((x) => `${x.km} a ${x.kmFim} (${String(x.dist).replace('.', ',')} m em ${String(x.esperado).replace('.', ',')} m de km)`), 12)}` });
  if (q.saltos.length) {
    out.push({
      level: 'warn', code: 'planservi-salto',
      msg: `${s}: ${q.saltos.length} salto${q.saltos.length > 1 ? 's' : ''} de coordenada fora de ${q.faixaSalto[0]} a ${q.faixaSalto[1]} m (tolerância de 0,5 m) entre linhas. Km (distância): ${lista(q.saltos.map((x) => `${x.km} (${x.dist} m)`))}. Esses não foram corrigidos`,
    });
  } else out.push({ level: 'info', code: 'planservi-salto', msg: `${s}: nenhum salto de coordenada fora de ${q.faixaSalto[0]} a ${q.faixaSalto[1]} m` });
  if (q.sentidos.length) {
    out.push({
      level: 'warn', code: 'planservi-entre-sentidos',
      msg: `${s}: ${q.sentidos.length} ponto${q.sentidos.length > 1 ? 's' : ''} com mais de ${q.maxSentidos} m entre os sentidos. Km (distância): ${lista(q.sentidos.map((x) => `${x.km} (${x.dist} m)`))}. Esses não foram corrigidos`,
    });
  }
  return out;
}

export const planservi: FormatDef = {
  id: 'planservi',
  label: 'Planservi',

  detect(wb: SheetBook) {
    if (!wb.names.some((n) => n.normalize('NFC') === ABA)) return false;
    const S = wb.sheet(ABA);
    const txt = S.slice(0, 8).flat().map(norm).join('|');
    return /segmentos homog/i.test(txt) && /coordenadas \(crescente\)/i.test(txt);
  },

  parse(wb: SheetBook): ParsedProject[] {
    const S = wb.sheet(ABA);
    const m = mapearCabecalhos(S);
    const topo = lerRodovia(S);
    const dados: LinhaDado[] = [];
    let ultima = -1;
    S.forEach((r, i) => {
      if (i >= H.dados && typeof r?.[m.col.seg] === 'number') { dados.push({ r, i }); ultima = i; }
    });
    if (!dados.length) throw new Error(`nenhuma linha com número na coluna 1 da aba ${ABA}`);
    let fim: unknown[] | null = null;
    for (let i = ultima + 1; i < S.length; i++) {
      const r = S[i];
      if (r && typeof r[m.col.km] === 'number' && typeof r[m.coord.Crescente!.lat] === 'number') { fim = r; break; }
    }
    const ignoradas: string[] = [];
    if (wb.names.some((n) => n.normalize('NFC') === 'IRI')) ignoradas.push('Aba IRI ignorada: tem referências quebradas (#REF!). O IRI vem das colunas de indicadores da SOLUÇÃO_FINAL');
    const cres = montarProjeto(S, m, dados, fim, 'Crescente', topo, ignoradas);
    const decr = montarProjeto(S, m, dados, fim, 'Decrescente', topo, ignoradas);
    const qC = Object.assign(cres.qualidade!, qualidade(cres.rows, decr.rows)), qD = Object.assign(decr.qualidade!, qualidade(decr.rows, cres.rows));
    cres.log.push(...logQualidade(qC, 'Crescente'));
    decr.log.push(...logQualidade(qD, 'Decrescente'));
    for (const p of [cres, decr]) {
      p.log.push({ level: 'info', code: 'planservi-larguras', msg: `Larguras assumidas, porque a planilha não traz: ${String(LARGURA_FAIXA_PADRAO).replace('.', ',')} m por faixa e ${String(LARGURA_ACOSTAMENTO_PADRAO).replace('.', ',')} m de acostamento. Ajuste em Configurações > Larguras` });
    }
    return [cres, decr];
  },
};
