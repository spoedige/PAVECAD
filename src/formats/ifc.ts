import { toUtm } from '../geometry/utm';
import type { XY } from '../geometry/build';
import type { Crs } from '../geometry/utm';
import type { ModeloExport, OpcoesExport, Trecho } from '../dominio/exportGeo';
import type { NotaKml } from './kml';

/** Escritor IFC4X3_ADD2 direto em STEP, sem biblioteca. Hierarquia IfcProject > IfcSite > IfcRoad > IfcRoadPart > IfcPavement,
 *  georreferenciada por IfcProjectedCRS e IfcMapConversion, com coordenadas locais em metros. A planilha não tem cota: Z = 0. */

export interface InfoSolucaoIfc { nome: string; categoria: string; nivel: number | null; espessura: number }

export interface EntradaIfc {
  titulo: string;
  modelo: ModeloExport;
  opcoes: OpcoesExport;
  info: (codigo: string) => InfoSolucaoIfc;
  crs: Crs;
  notas?: NotaKml[];
  data?: Date;
  ceder?: () => Promise<void>;
}

export interface SaidaIfc {
  texto: string;
  pavimentos: number;
  propostas: number;
  anotacoes: number;
  roads: number;
  roadParts: number;
  entidades: number;
  avisos: string[];
}

export const LIMITACAO_Z = 'A planilha não tem cota: todos os elementos estão em Z = 0.';
export const MOTIVO_SEM_ALINHAMENTO = 'IfcAlignment não foi gerado: o eixo vem de pontos a cada 20 m, sem curvas de transição nem perfil vertical (a planilha não tem cota). Ajustar retas e curvas inventaria uma geometria que os dados não têm. O posicionamento usa IfcLocalPlacement, com coordenadas locais em metros e IfcMapConversion para o sistema UTM.';

/* ---- GlobalId ---- */

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** Hash de 128 bits (quatro palavras de 32 bits), determinístico. */
function hash128(s: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** GlobalId do IFC: 128 bits em 22 caracteres (2 bits no primeiro, 6 em cada um dos outros 21). */
export function globalId(seed: string): string {
  const [a, b, c, d] = hash128(seed);
  let v = (BigInt(a) << 96n) | (BigInt(b) << 64n) | (BigInt(c) << 32n) | BigInt(d);
  let out = '';
  for (let i = 0; i < 21; i++) { out = B64[Number(v & 63n)] + out; v >>= 6n; }
  return B64[Number(v & 3n)] + out;
}

export const globalIdValido = (g: string) => /^[0-9A-Za-z_$]{22}$/.test(g) && '0123'.includes(g[0]);

/** Gerador de GlobalIds únicos: colisão (improvável) reescreve a semente com um contador. */
export function geradorIds() {
  const usados = new Set<string>();
  return (seed: string) => {
    let g = globalId(seed), n = 0;
    while (usados.has(g)) g = globalId(`${seed}#${++n}`);
    usados.add(g);
    return g;
  };
}

/* ---- STEP ---- */

/** Texto STEP: aspas dobradas e caracteres fora do ASCII em \X2\...\X0\. */
export function stepTexto(s: string): string {
  let out = '', buf = '';
  const fecha = () => { if (buf) { out += `\\X2\\${buf}\\X0\\`; buf = ''; } };
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) {
      fecha();
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else if (c > 0xffff) {
      fecha();
      out += `\\X4\\${c.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
    } else buf += c.toString(16).toUpperCase().padStart(4, '0');
  }
  fecha();
  return `'${out}'`;
}

export const real = (v: number, dec = 4): string => {
  const t = (Math.abs(v) < 5e-5 ? 0 : v).toFixed(dec).replace(/0+$/, '');
  return t.endsWith('.') ? t : t.includes('.') ? t : t + '.';
};
const ENUM_FAIXA = (lane: number) => (lane ? 'TRAFFICLANE' : 'SHOULDER');

class Step {
  linhas: string[] = [];
  n = 0;
  add(corpo: string): string {
    this.linhas.push(`#${++this.n}=${corpo};`);
    return `#${this.n}`;
  }
}

const lista = (v: string[]) => `(${v.join(',')})`;
const pt3 = (x: number, y: number, z = 0) => `IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`;

function rotuloFaixa(lane: number) { return lane ? `Faixa ${lane}` : 'Acostamento'; }

/** Estimativa de tamanho (bytes) do arquivo IFC. */
export function estimarIfc(m: ModeloExport, nNotas = 0): number {
  let b = 6000 + nNotas * 900;
  for (const t of [...m.faixas, ...m.propostas]) b += 3800 + t.ring.length * 38;
  return b;
}

export async function gerarIfc(e: EntradaIfc): Promise<SaidaIfc> {
  const S = new Step();
  const gid = geradorIds();
  const avisos: string[] = [];
  const d = e.data ?? new Date();
  const trechos: Trecho[] = [...e.modelo.faixas, ...e.modelo.propostas];

  // origem local: canto sudoeste arredondado a 100 m
  let x0 = Infinity, y0 = Infinity;
  for (const t of trechos) for (const p of t.ring) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; }
  const crs = e.crs;
  const notasUtm = (e.opcoes.notas ? e.notas ?? [] : []).map((n) => ({ n, pts: n.coords.map((c) => toUtm(crs, c[1], c[0])) }));
  for (const nt of notasUtm) for (const p of nt.pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; avisos.push('Nenhum elemento para exportar'); }
  const E0 = Math.floor(x0 / 100) * 100, N0 = Math.floor(y0 / 100) * 100;
  const local = (p: XY): XY => [p[0] - E0, p[1] - N0];

  /* contexto, unidades, georreferenciamento */
  const origem = S.add(pt3(0, 0, 0));
  const dz = S.add('IFCDIRECTION((0.,0.,1.))');
  const dx = S.add('IFCDIRECTION((1.,0.,0.))');
  const norte = S.add('IFCDIRECTION((0.,1.))');
  const wcs = S.add(`IFCAXIS2PLACEMENT3D(${origem},${dz},${dx})`);
  const ctx = S.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcs},${norte})`);
  const corpoCtx = S.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const anotCtx = notasUtm.length ? S.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Annotation','Plan',*,*,*,*,${ctx},$,.PLAN_VIEW.,$)`) : '';
  const metro = S.add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const m2 = S.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const m3 = S.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const rad = S.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const unidades = S.add(`IFCUNITASSIGNMENT(${lista([metro, m2, m3, rad])})`);
  const nomeCrs = crs.epsg ? `EPSG:${crs.epsg}` : `SIRGAS 2000 / UTM zone ${crs.zone}S`;
  const crsEnt = S.add(`IFCPROJECTEDCRS(${stepTexto(nomeCrs)},${stepTexto(`SIRGAS 2000 / UTM zone ${crs.zone}S`)},${stepTexto('SIRGAS 2000')},$,${stepTexto('UTM')},${stepTexto(`${crs.zone}S`)},${metro})`);
  S.add(`IFCMAPCONVERSION(${ctx},${crsEnt},${real(E0)},${real(N0)},0.,1.,0.,1.)`);

  /* projeto, sítio */
  const projeto = S.add(`IFCPROJECT('${gid(`projeto:${e.titulo}`)}',$,${stepTexto(e.titulo)},${stepTexto('Exportado pelo PAVECAD')},$,$,$,(${ctx}),${unidades})`);
  const eixo = (x = 0, y = 0) => S.add(`IFCAXIS2PLACEMENT3D(${S.add(pt3(x, y, 0))},${dz},${dx})`);
  const pSite = S.add(`IFCLOCALPLACEMENT($,${eixo()})`);
  const site = S.add(`IFCSITE('${gid(`site:${e.titulo}`)}',$,${stepTexto(e.titulo)},$,$,${pSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  const relAgg = (pai: string, filhos: string[], seed: string) => {
    if (filhos.length) S.add(`IFCRELAGGREGATES('${gid(`agg:${seed}`)}',$,$,$,${pai},${lista(filhos)})`);
  };
  relAgg(projeto, [site], 'projeto');

  /* propriedades do projeto */
  const psProj = (() => {
    const props = [
      ['Gerador', 'IFCLABEL', 'PAVECAD'], ['SistemaCoordenadas', 'IFCLABEL', nomeCrs],
      ['LimitacaoZ', 'IFCTEXT', LIMITACAO_Z], ['Posicionamento', 'IFCTEXT', MOTIVO_SEM_ALINHAMENTO],
    ].map(([n, t, v]) => S.add(`IFCPROPERTYSINGLEVALUE(${stepTexto(n)},$,${t}(${stepTexto(v)}),$)`));
    return S.add(`IFCPROPERTYSET('${gid('pset:projeto')}',$,'PAVECAD_Projeto',$,${lista(props)})`);
  })();
  S.add(`IFCRELDEFINESBYPROPERTIES('${gid('rel:pset:projeto')}',$,$,$,(${projeto}),${psProj})`);

  /* rodovias e partes */
  const roads = new Map<string, { id: string; pl: string; partes: Map<string, { id: string; pl: string; itens: string[] }> }>();
  const road = (nome: string) => {
    let r = roads.get(nome);
    if (!r) {
      const pl = S.add(`IFCLOCALPLACEMENT(${pSite},${eixo()})`);
      const id = S.add(`IFCROAD('${gid(`road:${nome}`)}',$,${stepTexto(nome)},$,$,${pl},$,$,.ELEMENT.,$)`);
      r = { id, pl, partes: new Map() };
      roads.set(nome, r);
    }
    return r;
  };
  const parte = (rodovia: string, sentido: string, lane: number, proposta: boolean) => {
    const r = road(rodovia);
    const nome = proposta ? `Propostas · ${sentido}` : `${sentido} · ${rotuloFaixa(lane)}`;
    let p = r.partes.get(nome);
    if (!p) {
      const pl = S.add(`IFCLOCALPLACEMENT(${r.pl},${eixo()})`);
      const tipo = proposta ? `.USERDEFINED.` : `.${ENUM_FAIXA(lane)}.`;
      const objTipo = proposta ? stepTexto('Proposta de solução') : '$';
      const id = S.add(`IFCROADPART('${gid(`parte:${rodovia}:${nome}`)}',$,${stepTexto(nome)},$,${objTipo},${pl},$,$,.ELEMENT.,.LONGITUDINAL.,${tipo})`);
      p = { id, pl, itens: [] };
      r.partes.set(nome, p);
    }
    return p;
  };

  /* materiais e tipos por solução */
  const materiais = new Map<string, { mat: string; tipo: string; itens: string[]; info: InfoSolucaoIfc }>();
  const solucao = (codigo: string) => {
    let s = materiais.get(codigo);
    if (!s) {
      const info = e.info(codigo);
      const mat = S.add(`IFCMATERIAL(${stepTexto(info.nome)},${stepTexto(`Código ${codigo}`)},${stepTexto(info.categoria)})`);
      const tipo = S.add(`IFCPAVEMENTTYPE('${gid(`tipo:${codigo}`)}',$,${stepTexto(info.nome)},${stepTexto(`Código ${codigo}`)},$,$,$,$,$,.FLEXIBLE.)`);
      s = { mat, tipo, itens: [], info };
      materiais.set(codigo, s);
    }
    return s;
  };

  const rotulo = (v: string | number, t: 'IFCLABEL' | 'IFCTEXT' | 'IFCINTEGER' | 'IFCLENGTHMEASURE' | 'IFCAREAMEASURE' | 'IFCPOSITIVELENGTHMEASURE') =>
    typeof v === 'number' ? `${t}(${t === 'IFCINTEGER' ? String(Math.round(v)) : real(v)})` : `${t}(${stepTexto(v)})`;

  const pavimento = (t: Trecho, i: number, proposta: boolean) => {
    const f = t.fonte;
    const s = solucao(t.codigo);
    const p = parte(f.rodovia, f.sentido, t.lane, proposta);
    const loc = local(t.ring[0]);
    const pts: XY[] = [];
    for (const q of t.ring) {
      const l = local(q);
      const r: XY = [Number((l[0] - loc[0]).toFixed(4)), Number((l[1] - loc[1]).toFixed(4))];
      if (!pts.length || r[0] !== pts[pts.length - 1][0] || r[1] !== pts[pts.length - 1][1]) pts.push(r);
    }
    if (pts.length < 4 || pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) { avisos.push(`${f.planilha}: trecho ${f.km(t.r0)} descartado (anel degenerado)`); return null; }
    const lst = S.add(`IFCCARTESIANPOINTLIST2D((${pts.map((q) => `(${real(q[0])},${real(q[1])})`).join(',')}))`);
    const curva = S.add(`IFCINDEXEDPOLYCURVE(${lst},$,.F.)`);
    const perfil = S.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${curva})`);
    const solido = S.add(`IFCEXTRUDEDAREASOLID(${perfil},${wcs},${dz},${real(s.info.espessura)})`);
    const rep = S.add(`IFCSHAPEREPRESENTATION(${corpoCtx},'Body','SweptSolid',(${solido}))`);
    const def = S.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const pl = S.add(`IFCLOCALPLACEMENT(${p.pl},${eixo(loc[0], loc[1])})`);
    const nome = `${t.codigo} · ${rotuloFaixa(t.lane)} · km ${f.km(t.r0)} a ${f.km(t.r1 + 1)}`;
    const chave = `${proposta ? 'prop' : 'pav'}:${f.id}:${f.rodovia}:${f.sentido}:${t.lane}:${t.r0}:${t.r1}:${t.codigo}:${i}`;
    const el = S.add(`IFCPAVEMENT('${gid(chave)}',$,${stepTexto(nome)},${stepTexto(s.info.nome)},$,${pl},${def},$,.FLEXIBLE.)`);
    p.itens.push(el);
    s.itens.push(el);

    const volume = t.area * s.info.espessura;
    const props: [string, string][] = [
      ['Solucao', rotulo(s.info.nome, 'IFCLABEL')], ['Codigo', rotulo(t.codigo, 'IFCLABEL')], ['Faixa', rotulo(rotuloFaixa(t.lane), 'IFCLABEL')],
      ['Sentido', rotulo(f.sentido, 'IFCLABEL')], ['Rodovia', rotulo(f.rodovia, 'IFCLABEL')], ['Planilha', rotulo(f.planilha, 'IFCLABEL')],
      ['KmInicial', rotulo(f.km(t.r0), 'IFCLABEL')], ['KmFinal', rotulo(f.km(t.r1 + 1), 'IFCLABEL')],
      ['Extensao', rotulo(t.ext, 'IFCLENGTHMEASURE')], ['Area', rotulo(t.area, 'IFCAREAMEASURE')],
      ['Espessura', rotulo(s.info.espessura, 'IFCPOSITIVELENGTHMEASURE')], ['TrechosUnidos', rotulo(t.unidos, 'IFCINTEGER')],
    ];
    if (s.info.nivel !== null) props.push(['Nivel', rotulo(s.info.nivel, 'IFCINTEGER')]);
    if (proposta) {
      props.push(['SolucaoAtual', rotulo(String(t.extra?.de ?? '-'), 'IFCLABEL')]);
      if (t.extra?.nota) props.push(['Nota', rotulo(String(t.extra.nota), 'IFCTEXT')]);
    }
    const ids = props.map(([n, v]) => S.add(`IFCPROPERTYSINGLEVALUE(${stepTexto(n)},$,${v},$)`));
    const ps = S.add(`IFCPROPERTYSET('${gid(`pset:${chave}`)}',$,'PAVECAD_Trecho',$,${lista(ids)})`);
    S.add(`IFCRELDEFINESBYPROPERTIES('${gid(`relps:${chave}`)}',$,$,$,(${el}),${ps})`);
    const qc = S.add(`IFCQUANTITYLENGTH('Comprimento',$,$,${real(t.ext)},$)`);
    const qa = S.add(`IFCQUANTITYAREA('Area',$,$,${real(t.area)},$)`);
    const qv = S.add(`IFCQUANTITYVOLUME('Volume',$,$,${real(volume)},$)`);
    const eq = S.add(`IFCELEMENTQUANTITY('${gid(`eq:${chave}`)}',$,'PAVECAD_Quantidades',$,$,${lista([qc, qa, qv])})`);
    S.add(`IFCRELDEFINESBYPROPERTIES('${gid(`releq:${chave}`)}',$,$,$,(${el}),${eq})`);
    return el;
  };

  let nPav = 0, nProp = 0, k = 0;
  for (const [lote, ehProp] of [[e.modelo.faixas, false], [e.modelo.propostas, true]] as [Trecho[], boolean][]) {
    for (let i = 0; i < lote.length; i++) {
      if (pavimento(lote[i], i, ehProp)) { if (ehProp) nProp++; else nPav++; }
      if (e.ceder && ++k % 150 === 0) await e.ceder();
    }
  }

  /* anotações (notas de campo, só com o chip ligado) */
  const anot: string[] = [];
  for (const [i, { n, pts }] of notasUtm.entries()) {
    const ls = pts.map((q) => local(q as XY));
    const itens = n.tipo === 'pin' ? S.add(pt3(ls[0][0], ls[0][1])) : S.add(`IFCPOLYLINE(${lista([...ls, ...(n.tipo === 'area' ? [ls[0]] : [])].map((q) => S.add(pt3(q[0], q[1]))))})`);
    const rep = S.add(`IFCSHAPEREPRESENTATION(${anotCtx},'Annotation','${n.tipo === 'pin' ? 'Point' : 'Curve3D'}',(${itens}))`);
    const def = S.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const id = S.add(`IFCANNOTATION('${gid(`nota:${i}:${n.criado}`)}',$,${stepTexto(n.categoria)},${stepTexto(n.texto)},$,${pSite},${def},.SYMBOL.)`);
    anot.push(id);
  }
  if (anot.length) S.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid('cont:notas')}',$,$,$,${lista(anot)},${site})`);

  /* relações finais: agregação, contenção, materiais e tipos */
  for (const [nome, r] of roads) {
    relAgg(r.id, [...r.partes.values()].map((p) => p.id), `road:${nome}`);
    for (const [pn, p] of r.partes) {
      if (p.itens.length) S.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid(`cont:${nome}:${pn}`)}',$,$,$,${lista(p.itens)},${p.id})`);
    }
  }
  relAgg(site, [...roads.values()].map((r) => r.id), 'site');
  for (const [codigo, s] of materiais) {
    if (!s.itens.length) continue;
    S.add(`IFCRELASSOCIATESMATERIAL('${gid(`mat:${codigo}`)}',$,$,$,${lista(s.itens)},${s.mat})`);
    S.add(`IFCRELDEFINESBYTYPE('${gid(`reltipo:${codigo}`)}',$,$,$,${lista(s.itens)},${s.tipo})`);
  }

  const z = (v: number) => String(v).padStart(2, '0');
  const iso = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  const cab = [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [ReferenceView]',${stepTexto(`PAVECAD: ${LIMITACAO_Z}`)}),'2;1');`,
    `FILE_NAME(${stepTexto('PAVECAD.ifc')},'${iso}',(${stepTexto('PAVECAD')}),(${stepTexto('PAVECAD')}),${stepTexto('PAVECAD')},${stepTexto('PAVECAD')},'');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));", 'ENDSEC;', 'DATA;',
  ];
  const texto = [...cab, ...S.linhas, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  return { texto, pavimentos: nPav, propostas: nProp, anotacoes: anot.length, roads: roads.size, roadParts: [...roads.values()].reduce((s, r) => s + r.partes.size, 0), entidades: S.n, avisos };
}
