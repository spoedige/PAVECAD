import { fromUtm } from '../geometry/utm';
import type { XY } from '../geometry/build';
import type { Crs } from '../geometry/utm';
import type { FonteExport, ModeloExport, OpcoesExport, Trecho } from '../dominio/exportGeo';

/** Escritor de KML 2.2. Recebe o modelo já agrupado e escreve um Style por solução (não por feição),
 *  pastas Rodovia > Sentido > Faixa e ExtendedData estruturado. Coordenadas com 6 casas decimais. */

export interface InfoSolucao { nome: string; cor: string; categoria: string }

export interface NotaKml {
  tipo: 'pin' | 'line' | 'area';
  /** [lon, lat] */
  coords: number[][];
  categoria: string;
  texto: string;
  criado: string;
  planilha: string | null;
  km: string | null;
  /** Caminho da foto dentro do KMZ (fotos/NOME.jpg), quando o usuário liga "Incluir fotos". */
  foto?: string;
}

export interface EntradaKml {
  titulo: string;
  modelo: ModeloExport;
  opcoes: OpcoesExport;
  info: (codigo: string) => InfoSolucao;
  notas?: NotaKml[];
  /** Cede a vez ao navegador a cada lote de feições. */
  ceder?: () => Promise<void>;
}

export const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "#rrggbb" para "aabbggrr" do KML. */
export function corKml(hex: string, alfa = 255): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ['8e', '8e', '93'];
  return (alfa.toString(16).padStart(2, '0') + b + g + r).toLowerCase();
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

/** Coordenada "lon,lat,0" com 6 casas. */
export function coordKml(crs: Crs, pt: XY): string {
  const [lat, lon] = fromUtm(crs, pt[0], pt[1]);
  return `${lon.toFixed(6)},${lat.toFixed(6)},0`;
}
const coordLL = (c: number[]) => `${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)},0`;

const dados = (o: Record<string, string | number | undefined>) =>
  `<ExtendedData>${Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v!)}</value></Data>`).join('')}</ExtendedData>`;

const fmtNum = (v: number, d = 1) => v.toFixed(d);

function poligono(crs: Crs, ring: XY[]): string {
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${ring.map((p) => coordKml(crs, p)).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

const nomeFaixa = (lane: number) => (lane ? `Faixa ${lane}` : 'Acostamento');

function dadosTrecho(t: Trecho, info: InfoSolucao, extra: Record<string, string | number | undefined> = {}) {
  const f = t.fonte;
  return dados({
    planilha: f.planilha, rodovia: f.rodovia, faixa: nomeFaixa(t.lane), sentido: f.sentido, solucao: info.nome, codigo: t.codigo,
    kmInicial: f.km(t.r0), kmFinal: f.km(t.r1 + 1), extensao_m: fmtNum(t.ext), area_m2: fmtNum(t.area), trechos_20m: t.unidos, ...extra,
  });
}

class Pasta {
  filhos: string[] = [];
  sub = new Map<string, Pasta>();
  constructor(readonly nome: string) {}
  pasta(nome: string): Pasta {
    let p = this.sub.get(nome);
    if (!p) { p = new Pasta(nome); this.sub.set(nome, p); }
    return p;
  }
  xml(): string {
    return `<Folder><name>${esc(this.nome)}</name>${this.filhos.join('')}${[...this.sub.values()].map((p) => p.xml()).join('')}</Folder>`;
  }
}

const CORES_PAT: Record<string, string> = { '3': '#ff9500', '4': '#ff3b30' };

export async function gerarKml(e: EntradaKml): Promise<string> {
  const { modelo: m, opcoes: o } = e;
  const estilos = new Map<string, string>();
  const infos = new Map<string, InfoSolucao>();
  const infoDe = (c: string) => { let i = infos.get(c); if (!i) { i = e.info(c); infos.set(c, i); } return i; };
  const addEstilo = (id: string, xml: string) => { if (!estilos.has(id)) estilos.set(id, xml); };
  const estiloSolucao = (c: string) => {
    const id = `s_${slug(c)}`, cor = infoDe(c).cor;
    addEstilo(id, `<Style id="${id}"><LineStyle><color>${corKml(cor)}</color><width>1</width></LineStyle><PolyStyle><color>${corKml(cor, 0xb3)}</color></PolyStyle></Style>`);
    return id;
  };
  const estiloProposta = (c: string) => {
    const id = `pp_${slug(c)}`, cor = infoDe(c).cor;
    addEstilo(id, `<Style id="${id}"><LineStyle><color>ffffffff</color><width>3</width></LineStyle><PolyStyle><color>${corKml(cor, 0x66)}</color></PolyStyle></Style>`);
    return id;
  };
  const estiloPatologia = (cls: string) => {
    const id = `pat_${cls}`, cor = CORES_PAT[cls] ?? '#ff3b30';
    addEstilo(id, `<Style id="${id}"><LineStyle><color>${corKml(cor)}</color><width>2</width></LineStyle><PolyStyle><color>${corKml(cor, 0x80)}</color></PolyStyle></Style>`);
    return id;
  };
  addEstilo('dreno', `<Style id="dreno"><LineStyle><color>${corKml('#0a84ff')}</color><width>3</width></LineStyle></Style>`);
  addEstilo('estaca', `<Style id="estaca"><IconStyle><color>${corKml('#ffffff')}</color><scale>0.6</scale></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>`);
  addEstilo('nota', `<Style id="nota"><IconStyle><color>${corKml('#ff9500')}</color><scale>0.9</scale></IconStyle><LineStyle><color>${corKml('#ff9500')}</color><width>3</width></LineStyle><PolyStyle><color>${corKml('#ff9500', 0x55)}</color></PolyStyle></Style>`);

  const raiz = new Pasta(e.titulo);
  const via = (f: FonteExport) => raiz.pasta(f.rodovia).pasta(f.sentido);
  let n = 0;
  const lote = async () => { if (e.ceder && ++n % 400 === 0) await e.ceder(); };

  for (const t of m.faixas) {
    const i = infoDe(t.codigo), f = t.fonte;
    via(f).pasta(nomeFaixa(t.lane)).filhos.push(
      `<Placemark><name>${esc(`${t.codigo} · km ${f.km(t.r0)} a ${f.km(t.r1 + 1)}`)}</name><description>${esc(`${i.nome}. ${nomeFaixa(t.lane)}, ${fmtNum(t.ext, 0)} m, ${fmtNum(t.area, 0)} m²`)}</description><styleUrl>#${estiloSolucao(t.codigo)}</styleUrl>${dadosTrecho(t, i)}${poligono(f.base.crs, t.ring)}</Placemark>`,
    );
    await lote();
  }
  for (const t of m.patologias) {
    const f = t.fonte, ex = t.extra!;
    via(f).pasta('Patologias').pasta(String(ex.indicador)).filhos.push(
      `<Placemark><name>${esc(`${t.codigo} · ${nomeFaixa(t.lane)} · km ${f.km(t.r0)} a ${f.km(t.r1 + 1)}`)}</name><description>${esc(`${t.codigo} classe ${ex.classe}, pior valor ${ex.valorMax} ${ex.unidade}`)}</description><styleUrl>#${estiloPatologia(String(ex.classe))}</styleUrl>${dados({
        planilha: f.planilha, rodovia: f.rodovia, faixa: nomeFaixa(t.lane), sentido: f.sentido, indicador: t.codigo, classe: ex.classe, valorMax: ex.valorMax, unidade: String(ex.unidade),
        kmInicial: f.km(t.r0), kmFinal: f.km(t.r1 + 1), extensao_m: fmtNum(t.ext), area_m2: fmtNum(t.area),
      })}${poligono(f.base.crs, t.ring)}</Placemark>`,
    );
    await lote();
  }
  for (const t of m.propostas) {
    const i = infoDe(t.codigo), f = t.fonte, ex = t.extra!;
    via(f).pasta('Propostas').filhos.push(
      `<Placemark><name>${esc(`Proposta ${ex.de || '-'} para ${t.codigo} · km ${f.km(t.r0)} a ${f.km(t.r1 + 1)}`)}</name><description>${esc(`${nomeFaixa(t.lane)}, ${fmtNum(t.ext, 0)} m. ${ex.nota || ''}`.trim())}</description><styleUrl>#${estiloProposta(t.codigo)}</styleUrl>${dadosTrecho(t, i, { solucaoAtual: String(ex.de), efeito: String(ex.efeito) })}${poligono(f.base.crs, t.ring)}</Placemark>`,
    );
    await lote();
  }
  for (const d of m.drenos) {
    const f = d.fonte;
    via(f).pasta('Drenos').filhos.push(
      `<Placemark><name>${esc(`Dreno ${d.tipo} · km ${f.km(d.r0)} a ${f.km(d.r1)}`)}</name><styleUrl>#dreno</styleUrl>${dados({ planilha: f.planilha, rodovia: f.rodovia, sentido: f.sentido, tipo: d.tipo, kmInicial: f.km(d.r0), kmFinal: f.km(d.r1), extensao_m: fmtNum(d.ext) })}<LineString><tessellate>1</tessellate><coordinates>${d.pts.map((p) => coordKml(f.base.crs, p)).join(' ')}</coordinates></LineString></Placemark>`,
    );
    await lote();
  }
  for (const s of m.estacas) {
    const f = s.fonte;
    via(f).pasta('Estacas').filhos.push(
      `<Placemark><name>${esc(s.km)}</name><styleUrl>#estaca</styleUrl>${dados({ planilha: f.planilha, rodovia: f.rodovia, sentido: f.sentido, km: s.km })}<Point><coordinates>${coordKml(f.base.crs, s.pt)}</coordinates></Point></Placemark>`,
    );
    await lote();
  }
  if (o.notas && e.notas?.length) {
    const pn = raiz.pasta('Notas de campo');
    for (const nt of e.notas) {
      const g = nt.tipo === 'pin' ? `<Point><coordinates>${coordLL(nt.coords[0])}</coordinates></Point>`
        : nt.tipo === 'line' ? `<LineString><tessellate>1</tessellate><coordinates>${nt.coords.map(coordLL).join(' ')}</coordinates></LineString>`
          : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${[...nt.coords, nt.coords[0]].map(coordLL).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      pn.filhos.push(`<Placemark><name>${esc(nt.categoria)}</name><description>${nt.foto ? `<![CDATA[${(esc(nt.texto) + `<br/><img src="${esc(nt.foto)}" width="400"/>`).replace(/]]>/g, ']]&gt;')}]]>` : esc(nt.texto)}</description><styleUrl>#nota</styleUrl>${dados({ categoria: nt.categoria, texto: nt.texto, criado: nt.criado, planilha: nt.planilha ?? undefined, km: nt.km ?? undefined })}${g}</Placemark>`);
      await lote();
    }
  }

  const corpo = [...raiz.sub.values()].map((p) => p.xml()).join('') + (raiz.filhos.length ? raiz.filhos.join('') : '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(e.titulo)}</name><description>${esc('Exportado pelo PAVECAD. Geometria em metros sobre o plano UTM, a mesma da tela. Sem cota (Z = 0).')}</description>${[...estilos.values()].join('')}${corpo}</Document></kml>\n`;
}

/** Tamanho estimado em bytes do KML e do KMZ (compressão típica de 5:1 em XML de coordenadas). */
export function estimarKml(m: ModeloExport, nNotas = 0): { kml: number; kmz: number } {
  let pts = 0, pm = 0;
  for (const t of [...m.faixas, ...m.patologias, ...m.propostas]) { pts += t.ring.length; pm++; }
  for (const d of m.drenos) { pts += d.pts.length; pm++; }
  pm += m.estacas.length + nNotas; pts += m.estacas.length + nNotas;
  const kml = Math.round(pts * 28 + pm * 760 + 2000);
  return { kml, kmz: Math.round(kml / 5) };
}

export interface Verificacao { ok: boolean; problemas: string[]; detalhe: string }

/** Verificação interna do KML gerado: XML bem formado (quando o navegador tem DOMParser), estilos definidos, anéis fechados e contagem de feições. */
export function verificarKml(kml: string, esperadas: number): Verificacao {
  const problemas: string[] = [];
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(kml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) problemas.push('XML mal formado');
  }
  const definidos = new Set([...kml.matchAll(/<Style id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of kml.matchAll(/<styleUrl>#([^<]+)<\/styleUrl>/g)) if (!definidos.has(m[1])) { problemas.push(`estilo ${m[1]} não definido`); break; }
  let abertos = 0;
  for (const m of kml.matchAll(/<Polygon>.*?<coordinates>([^<]+)<\/coordinates>/g)) {
    const c = m[1].trim().split(' ');
    if (c.length < 4 || c[0] !== c[c.length - 1]) abertos++;
  }
  if (abertos) problemas.push(`${abertos} anel(is) aberto(s) ou degenerado(s)`);
  const n = (kml.match(/<Placemark>/g) ?? []).length;
  if (n !== esperadas) problemas.push(`${n} feições escritas, ${esperadas} esperadas`);
  return { ok: !problemas.length, problemas, detalhe: problemas.length ? problemas.join('; ') : 'XML, estilos, anéis e contagem conferidos' };
}
