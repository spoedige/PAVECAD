import { registrarErro } from './diagnostico';
import { kmLabel } from '../formats';
import * as catalogo from '../dominio/catalogo';
import type { Local, LocP } from '../dominio/localizar';
import {
  TIPOS_RAPIDOS, dadosDeLocal, posicionarRoda, precisaLembrar, resolverLocal, type OrigemNota, type Resolucao, type TipoRapido,
} from '../dominio/notaRapida';
import { efeitoDe, runAt, type Proposta } from '../dominio/propostas';
import { trColor, trShort } from '../dominio/solucoes';
import * as db from './persist';
import { E, getP, projName, type AppProj, type Nota } from './estado';
import { montarLevantamento } from './levantamento';
import { ehCelular } from './layout';
import { getMap, setData } from './mapa';
import { obterPosicao } from './posicao';
import { aplicarProposta, atualizarProposta, refreshNotesLayer, removerProposta, renderNotes } from './revisao';
import { cssv, esc, toast } from './ui';

/** Tempo de pressão (ms) e movimento (px) que separam "segurar" de "arrastar". O tempo é configurável em Ajustes (400, 500 ou 700 ms). */
export const PRESSAO_MS = 500;
export const PRESSAO_OPCOES = [400, 500, 700] as const;
export const CHAVE_PRESSAO = 'pavecad-pressao-ms';
export const PRESSAO_MOVE_PX = 8;
/** A mira e o anel só aparecem depois disto, para não piscar em toques e rolagens. */
export const PRESSAO_ATRASO_MS = 150;
export const pressaoMs = (): number => {
  try { const v = +(localStorage.getItem(CHAVE_PRESSAO) ?? 0); if ((PRESSAO_OPCOES as readonly number[]).includes(v)) return v; } catch { /* sem storage */ }
  return PRESSAO_MS;
};
const TAM = 64;
/** Quanto tempo a roda fica aberta depois de gravar, com Estender, Observação e Desfazer. */
const POS_GRAVAR_MS = 5000;

const SVG = (d: string) => `<svg viewBox="0 0 24 24" class="i">${d}</svg>`;
/** Ícones das notas por forma, não só por cor: solução (camadas) com mais ou menos; dreno (gota) com mais ou menos. */
export const ICONE: Record<TipoRapido, string> = {
  melhorar: SVG('<path d="M3 15l9 4.5 9-4.5M3 11l9 4.5 9-4.5L12 6.5z"/><path d="M12 1.5v4M10 3.5h4"/>'),
  retirar: SVG('<path d="M3 15l9 4.5 9-4.5M3 11l9 4.5 9-4.5L12 6.5z"/><path d="M10 3.5h4"/>'),
  dreno_mais: SVG('<path d="M12 3c3 3.8 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.6 9 6.8 12 3z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  dreno_menos: SVG('<path d="M12 3c3 3.8 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.6 9 6.8 12 3z"/><path d="M9.5 13.5h5"/>'),
  conserva: SVG('<path d="M14.5 4.5a4 4 0 0 0-4.7 5.2L4 15.5 8.5 20l5.8-5.8a4 4 0 0 0 5.2-4.7l-2.6 2.6-2.6-.7-.7-2.6z"/>'),
  observacao: SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  foto: SVG('<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
};
const IC = {
  alterar: SVG('<path d="M3 15l9 4.5 9-4.5M3 11l9 4.5 9-4.5L12 6.5z"/><path d="M8 3.5h8m-2-2 2 2-2 2"/>'),
  parametros: SVG('<path d="M5 4h14v16H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>'),
  outros: SVG('<path d="M5 12h.01M12 12h.01M19 12h.01"/>'),
  estender: SVG('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
  obs: SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  desfazer: SVG('<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>'),
  sentido: SVG('<path d="M4 9h14l-3-3M20 15H6l3 3"/>'),
  excluir: SVG('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  alterarNota: SVG('<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>'),
};

type Fase = 'principal' | 'solucao' | 'outros' | 'salvo' | 'estender' | 'obs' | 'editar' | 'param';
interface Alvo { p: AppProj; i: number; lane: number; from: string }
interface Menu {
  fase: Fase;
  lng: number; lat: number; pt: { x: number; y: number }; origem: OrigemNota; precisao: number | null; res: Resolucao;
  /** A segunda roda é para uma alteração nova ou para trocar a solução de uma proposta que já existe. */
  modo: 'nova' | 'editar';
  alvo?: Alvo;
  prop?: Proposta;
  nota?: Nota;
  /** Passos já gravados nesta pressão, do mais antigo ao mais novo: o Desfazer volta todos. */
  passos: (() => void)[];
  /** O que o centro da roda diz depois de gravar. */
  rotulo: string;
  /** Regrava depois de "Trocar sentido". */
  regravar?: () => void;
  aviso?: string;
  /** Volta de Observação e Estender. */
  voltar: Fase;
}
let menu: Menu | null = null;
let raiz: HTMLElement, anel: HTMLElement, live: HTMLElement;
let timerRoda: ReturnType<typeof setTimeout> | undefined;

export const notaRapidaAberta = () => !!menu;

const CHAVE_DICA = 'pavecad-dica-nota';
const CHAVE_NOVAS = 'pavecad-notas-novas';
const lerNum = (k: string) => { try { return +(localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const gravarNum = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* sem storage */ } };
export const notasNovasSemExportar = () => lerNum(CHAVE_NOVAS);
export const zerarNotasNovas = () => gravarNum(CHAVE_NOVAS, 0);
const contarNova = (d: number) => gravarNum(CHAVE_NOVAS, Math.max(0, notasNovasSemExportar() + d));

const stage = () => document.querySelector<HTMLElement>('.stage')!;
const relativo = (cx: number, cy: number) => { const r = stage().getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
const area = () => { const r = stage().getBoundingClientRect(); return { w: r.width, h: r.height }; };
const vibrar = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

function fecharMenu() {
  clearTimeout(timerRoda);
  menu = null;
  raiz.hidden = true; raiz.replaceChildren();
}
/** A roda some sozinha depois de `ms` sem toque. */
const agendar = (ms = POS_GRAVAR_MS) => { clearTimeout(timerRoda); timerRoda = setTimeout(fecharMenu, ms); };
const parar = () => clearTimeout(timerRoda);

const rotuloLocal = (l: Local) => `km ${esc(l.p.kmLab[l.i])} · ${l.lane === 0 ? 'Acost.' : l.lane === null ? 'fora da pista' : `Fx ${l.lane}`}`;

function textoDoLocal(m: Menu): string {
  const l = m.res.local;
  if (m.res.estado === 'sem-planilha') return 'Trecho não definido';
  if (m.res.estado === 'fora' || !l) return 'Fora do trecho';
  return `${rotuloLocal(l)}${m.res.estado === 'proximo' ? ' · mais próximo' : ''}`;
}

/* ---------------------------------------------------------------- */
/* Desenho                                                           */
/* ---------------------------------------------------------------- */
interface Bolha { id: string; attr: string; html: string; cls?: string; off?: boolean; pressed?: boolean; titulo?: string }
const bolhas = (itens: Bolha[], r: { botoes: { x: number; y: number }[] }, tam: number) => itens.map((b, k) => {
  const { x, y } = r.botoes[k];
  return `<button type="button" class="nr-op ${b.cls ?? ''}" ${b.attr} ${b.off ? 'disabled' : ''} ${b.pressed !== undefined ? `aria-pressed="${b.pressed}"` : ''} aria-label="${esc(b.titulo ?? b.id)}" style="left:${x - tam / 2}px;top:${y - tam / 2}px;width:${tam}px;height:${tam}px">${b.html}</button>`;
}).join('');

/** Monta a roda: fundo, ponto pressionado, texto no centro e as bolhas. `centro` vem em HTML. */
function roda(itens: Bolha[], centro: string, o: { tam?: number; raio?: number; passoMin?: number; centroBtn?: boolean } = {}) {
  const m = menu!, tam = o.tam ?? TAM;
  const r = posicionarRoda(m.pt, area(), itens.length, tam, o.raio ?? 116, 8, o.passoMin ?? 0);
  // o rótulo do centro (132 px) não passa da borda da tela quando o ponto está perto dela
  const c = { x: Math.min(area().w - 74, Math.max(74, r.centro.x)), y: r.centro.y }, aviso = m.res.avisoPrecisao && m.precisao !== null ? ` · GPS ±${Math.round(m.precisao)} m` : '';
  const cab = o.centroBtn ? `<button type="button" class="nr-centro nr-centro-b" data-a="pronto" style="left:${c.x}px;top:${c.y}px">${centro}</button>`
    : `<div class="nr-centro" role="status" style="left:${c.x}px;top:${c.y}px">${centro}</div>`;
  const legenda = m.fase === 'principal'
    ? `<div class="nr-cap${m.res.avisoPrecisao || m.aviso ? ' aviso' : ''}" style="left:${Math.min(area().w - 84, Math.max(84, m.pt.x))}px;top:${m.pt.y + (r.angulo >= 0 && r.angulo <= 180 ? -34 : 16)}px">${m.aviso ? esc(m.aviso) : textoDoLocal(m) + aviso}</div>` : '';
  raiz.innerHTML = `<div class="nr-fundo" id="nrFundo"></div><div class="nr-ponto" style="left:${m.pt.x}px;top:${m.pt.y}px"></div>${r.deslocada || m.fase !== 'principal' ? cab : ''}${bolhas(itens, r, tam)}${legenda}`;
  raiz.hidden = false;
  raiz.querySelector('#nrFundo')!.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharMenu(); });
  (raiz.querySelector('.nr-op:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
}
const alvoClique = (sel: string, f: (b: HTMLElement) => void) => raiz.querySelectorAll<HTMLElement>(sel).forEach((b) => b.addEventListener('click', () => f(b)));

const nomeBolha = (a: string, c: string) => `<span>${a}<br>${c}</span>`;

function pintar() {
  const m = menu;
  if (!m) return;
  if (m.fase === 'principal') pintarPrincipal(m);
  else if (m.fase === 'solucao') pintarSolucao(m);
  else if (m.fase === 'outros') pintarOutros(m);
  else if (m.fase === 'salvo') pintarSalvo(m);
  else if (m.fase === 'estender') pintarEstender(m);
  else if (m.fase === 'obs') pintarObs(m);
  else if (m.fase === 'editar') pintarEditar(m);
  else if (m.fase === 'param') pintarParam(m);
}

function pintarPrincipal(m: Menu) {
  parar();
  roda([
    { id: 'Alterar solução', attr: 'data-t="alterar"', html: IC.alterar + nomeBolha('Alterar', 'solução') },
    { id: 'Colocar dreno', attr: 'data-t="dreno_mais"', html: ICONE.dreno_mais + nomeBolha('Colocar', 'dreno') },
    { id: 'Retirar dreno', attr: 'data-t="dreno_menos"', html: ICONE.dreno_menos + nomeBolha('Retirar', 'dreno') },
    { id: 'Ver parâmetros', attr: 'data-t="parametros"', html: IC.parametros + nomeBolha('Ver', 'parâmetros') },
  ], '', { passoMin: 46 });
  alvoClique('.nr-op', (b) => {
    const t = b.dataset.t!;
    if (t === 'alterar') abrirAlterar();
    else if (t === 'parametros') abrirParametros();
    else gravarDreno(t as 'dreno_mais' | 'dreno_menos');
  });
}

/* ---------------------------------------------------------------- */
/* Alterar solução                                                   */
/* ---------------------------------------------------------------- */
/** Segmento sob o dedo que serve para uma proposta: planilha, linha e faixa (0 = acostamento). */
function alvoDoLocal(l: Local | null): Alvo | null {
  if (!l || l.lane === null) return null;
  const p = l.p as unknown as AppProj, md = p.model[l.i];
  return { p, i: l.i, lane: l.lane, from: (l.lane ? md.tr[l.lane - 1] : md.sh).main };
}

function abrirAlterar() {
  const m = menu!, alvo = alvoDoLocal(m.res.estado === 'dentro' || m.res.estado === 'proximo' ? m.res.local : null);
  if (!alvo) { m.aviso = 'Segure sobre a faixa para alterar a solução'; pintar(); return; }
  m.aviso = undefined; m.alvo = alvo; m.modo = 'nova'; m.fase = 'solucao';
  pintar();
}

/** As soluções realmente empregadas nas planilhas carregadas, mais frequentes primeiro (máximo 5). */
export function solucoesEmpregadas(max = 5): string[] {
  const n = new Map<string, number>();
  for (const p of E.P) for (const [c, k] of Object.entries(p.codes)) if (c && c !== '-') n.set(c, (n.get(c) ?? 0) + k);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([c]) => c);
}

const atualDaSolucao = (m: Menu) => (m.modo === 'editar' ? m.prop!.to : m.alvo!.from);

function pintarSolucao(m: Menu) {
  parar();
  const atual = atualDaSolucao(m);
  const sw = (c: string) => trColor(c, E.field, cssv('--none'));
  const itens: Bolha[] = solucoesEmpregadas().map((c) => ({
    id: `${trShort(c)}`, attr: `data-s="${esc(c)}"`, cls: 'nr-s', off: c === atual, titulo: catalogo.get(c).nome,
    html: `<i class="nr-sw" style="background:${sw(c)}"></i><b>${esc(c)}</b><span>${esc(trShort(c))}</span>`,
  }));
  itens.push({ id: 'Sem intervenção', attr: 'data-s="-"', cls: 'nr-s', off: atual === '-', html: `<i class="nr-sw" style="background:${cssv('--none')}"></i><span class="nr-2l">Sem<br>intervenção</span>` });
  itens.push({ id: 'Outros', attr: 'data-s="__outros"', cls: 'nr-s', html: `${IC.outros}<span>Outros</span>` });
  roda(itens, `<small>Atual</small><b>${esc(atual === '-' ? 'Sem intervenção' : atual)}</b>`, { raio: 124 });
  alvoClique('.nr-op', (b) => {
    const s = b.dataset.s!;
    if (s === '__outros') { m.fase = 'outros'; pintar(); } else escolherSolucao(s);
  });
}

function pintarOutros(m: Menu) {
  parar();
  const atual = atualDaSolucao(m);
  const a = area(), larg = Math.min(260, a.w - 16), altMax = Math.min(a.h - 16, 420);
  const embaixo = m.pt.y < a.h / 2;
  const top = embaixo ? Math.min(a.h - 8 - altMax, m.pt.y + 28) : Math.max(8, m.pt.y - 28 - altMax);
  const left = Math.min(a.w - 8 - larg, Math.max(8, m.pt.x - larg / 2));
  const itens = catalogo.todos().map((it) => `<button type="button" class="nr-li" data-s="${esc(it.codigo)}" ${it.codigo === atual ? 'disabled' : ''}>
      <i class="nr-sw" style="background:${trColor(it.codigo, E.field, cssv('--none'))}"></i><b>${esc(it.codigo)}</b><span>${esc(it.nome)}</span></button>`).join('');
  raiz.innerHTML = `<div class="nr-fundo" id="nrFundo"></div><div class="nr-ponto" style="left:${m.pt.x}px;top:${m.pt.y}px"></div>
    <div class="nr-lista" role="listbox" aria-label="Todas as soluções" style="left:${left}px;top:${top}px;width:${larg}px;max-height:${altMax}px">
      <button type="button" class="nr-li" data-s="-" ${atual === '-' ? 'disabled' : ''}><i class="nr-sw" style="background:${cssv('--none')}"></i><b>–</b><span>Sem intervenção</span></button>${itens}
      <button type="button" class="nr-li nr-volta" data-a="voltar">← Voltar</button></div>`;
  raiz.querySelector('#nrFundo')!.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharMenu(); });
  alvoClique('[data-s]', (b) => escolherSolucao(b.dataset.s!));
  alvoClique('[data-a=voltar]', () => { m.fase = 'solucao'; pintar(); });
}

function escolherSolucao(to: string) {
  const m = menu!;
  if (m.modo === 'editar') trocarSolucaoDaProposta(m, to); else gravarAlteracao(m, to);
}

function gravarAlteracao(m: Menu, to: string) {
  const a = m.alvo!, p = a.p;
  if (to === a.from) return;
  const efeito = efeitoDe(a.from, to);
  const rec: Proposta = {
    id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), pid: p.id, pname: p.meta.name, lane: a.lane, r0: a.i, r1: a.i,
    km0: p.kmNum[a.i], km1: p.kmNum[a.i], from: a.from, to, note: '', t: new Date().toISOString(),
    campo: { efeito, antes: 0, depois: 0, origem: m.origem, precisao: m.origem === 'gps' && m.precisao !== null ? Math.round(m.precisao) : null, lat: +m.lat.toFixed(7), lon: +m.lng.toFixed(7) },
  };
  const r = aplicarProposta(rec, p);
  m.prop = r.rec;
  m.passos.push(r.desfazer, () => contarNova(-1));
  contarNova(1);
  m.rotulo = `${esc(trShort(a.from))} → ${esc(trShort(to))} · ${efeito}`;
  m.regravar = () => gravarAlteracao(m, to);
  concluir(m);
}

function trocarSolucaoDaProposta(m: Menu, to: string) {
  const r = m.prop!, c = r.campo!, antiga = { to: r.to, efeito: c.efeito };
  r.to = to; c.efeito = efeitoDe(r.from, to);
  atualizarProposta(r);
  m.passos.push(() => { r.to = antiga.to; c.efeito = antiga.efeito; atualizarProposta(r); });
  m.rotulo = `${esc(trShort(r.from))} → ${esc(trShort(to))} · ${c.efeito}`;
  m.modo = 'nova';
  concluir(m);
}

/** Depois de gravar: a roda continua por 5 s com "Salvo" e as ações. */
function concluir(m: Menu) {
  vibrar(20);
  m.fase = 'salvo';
  pintar();
}

/* ---------------------------------------------------------------- */
/* Colocar e retirar dreno (nota)                                    */
/* ---------------------------------------------------------------- */
function dadosDaNota(l: Local | null, estado: Resolucao['estado']) {
  return dadosDeLocal(l, estado, (p, i) => kmLabel(p.kmNum[i]));
}
const locDaNota = (l: Local | null, estado: Resolucao['estado']): Nota['loc'] =>
  l && (estado === 'dentro' || estado === 'proximo') ? { pid: l.p.id, name: projName(l.p as never), km: kmLabel(l.p.kmNum[l.i]), lane: l.lane ?? 0 } : null;

function gravarDreno(tipo: 'dreno_mais' | 'dreno_menos') {
  const m = menu!, estado = m.res.estado, l = m.res.local;
  const n: Nota = {
    id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: 'pin', coords: [[+m.lng.toFixed(7), +m.lat.toFixed(7)]], cat: TIPOS_RAPIDOS[tipo].cat, text: '', photos: [], t: new Date().toISOString(),
    loc: locDaNota(l, estado),
    rapida: { tipo, origem: m.origem, precisao: m.origem === 'gps' && m.precisao !== null ? Math.round(m.precisao) : null, ...dadosDaNota(l, estado), resolvida: false },
  };
  E.notes.push(n);
  db.gravar('notes', n);
  m.nota = n;
  refreshNotesLayer();
  if (E.tab === 'notas') renderNotes();
  contarNova(1);
  m.passos.push(() => { removerNota(n); contarNova(-1); });
  m.rotulo = `${esc(TIPOS_RAPIDOS[tipo].rotulo)}${n.rapida?.km ? ' · km ' + esc(n.rapida.km) : ''}`;
  m.regravar = () => gravarDreno(tipo);
  if (precisaLembrar(notasNovasSemExportar()) && notasNovasSemExportar() === 10) setTimeout(() => toast('10 notas novas sem exportar. Baixe a planilha em Notas.', 5000), 6500);
  concluir(m);
}

function removerNota(n: Nota) {
  E.notes = E.notes.filter((x) => x.id !== n.id);
  db.apagar('notes', n.id);
  refreshNotesLayer();
  if (E.tab === 'notas') renderNotes();
}
function restaurarNota(n: Nota) {
  E.notes.push(n);
  db.gravar('notes', n);
  refreshNotesLayer();
  if (E.tab === 'notas') renderNotes();
}

/* ---------------------------------------------------------------- */
/* Depois de gravar: Estender, Observação, Desfazer                  */
/* ---------------------------------------------------------------- */
function desfazerTudo(m: Menu) {
  while (m.passos.length) m.passos.pop()!();
}

function pintarSalvo(m: Menu) {
  const itens: Bolha[] = [];
  if (m.prop) itens.push({ id: 'Estender', attr: 'data-a="estender"', html: IC.estender + '<span>Estender</span>' });
  if (m.prop || m.nota) itens.push({ id: 'Observação', attr: 'data-a="obs"', html: IC.obs + '<span>Observação</span>' });
  itens.push({ id: 'Desfazer', attr: 'data-a="desfazer"', cls: 'nr-d', html: IC.desfazer + '<span>Desfazer</span>' });
  if (m.res.outro && m.regravar) itens.push({ id: 'Trocar sentido', attr: 'data-a="sentido"', html: IC.sentido + nomeBolha('Trocar', 'sentido') });
  roda(itens, `<b>${m.rotulo.startsWith('Excluída') ? '' : 'Salvo'}</b><small>${m.rotulo}</small>`);
  agendar();
  alvoClique('.nr-op', (b) => {
    const a = b.dataset.a;
    if (a === 'desfazer') { desfazerTudo(m); fecharMenu(); toast('Desfeito'); }
    else if (a === 'estender') { m.fase = 'estender'; pintar(); }
    else if (a === 'obs') { m.voltar = 'salvo'; m.fase = 'obs'; pintar(); }
    else if (a === 'sentido') {
      desfazerTudo(m);
      const par = m.res.outro!;
      m.res = { ...m.res, local: par, outro: m.res.local };
      if (m.nota || m.alvo) { if (m.alvo) m.alvo = alvoDoLocal(par) ?? m.alvo; const f = m.regravar!; f(); }
    }
  });
}

const EXT = [20, 40, 100] as const;

/** Linhas-base (o segmento pressionado) de uma proposta de campo: o trecho menos o que foi estendido. */
function baseDaProposta(r: Proposta) { const c = r.campo!; return { b0: r.r0 + Math.round(c.antes / 20), b1: r.r1 - Math.round(c.depois / 20) }; }

function estender(m: Menu, qual: { antes?: number; depois?: number; toda?: boolean }) {
  const r = m.prop!, p = getP(r.pid ?? '');
  if (!p || !r.campo) return;
  const c = r.campo, { b0, b1 } = baseDaProposta(r), sg = p.segs.find((s) => b0 >= s.a && b0 <= s.b) ?? { a: b0, b: b1 };
  let n0 = r.r0, n1 = r.r1;
  if (qual.toda) { const run = runAt(p, b0, r.lane, 'run'); n0 = Math.min(b0, run.r0); n1 = Math.max(b1, run.r1); }
  if (qual.antes !== undefined) n0 = Math.max(sg.a, b0 - Math.round(qual.antes / 20));
  if (qual.depois !== undefined) n1 = Math.min(sg.b, b1 + Math.round(qual.depois / 20));
  if (n0 === r.r0 && n1 === r.r1) { toast('Não há mais trecho contínuo nessa direção', 2500); return; }
  const nova: Proposta = { ...r, id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), r0: n0, r1: n1, km0: p.kmNum[n0], km1: p.kmNum[n1], campo: { ...c, antes: (b0 - n0) * 20, depois: (n1 - b1) * 20 } };
  const ap = aplicarProposta(nova, p, [r]);
  m.prop = ap.rec;
  m.passos.push(ap.desfazer);
}

function pintarEstender(m: Menu) {
  const c = m.prop!.campo!;
  const itens: Bolha[] = [
    ...EXT.map((d) => ({ id: `Antes ${d} m`, attr: `data-e="a${d}"`, cls: 'nr-e', pressed: c.antes === d, html: `<small>Antes</small><b>${d} m</b>` })),
    ...EXT.map((d) => ({ id: `Depois ${d} m`, attr: `data-e="d${d}"`, cls: 'nr-e', pressed: c.depois === d, html: `<small>Depois</small><b>${d} m</b>` })),
    { id: 'Toda a extensão da solução atual', attr: 'data-e="toda"', cls: 'nr-e', html: '<span>Toda a<br>extensão</span>' },
  ];
  roda(itens, `<small>Estender</small><b>${c.antes + c.depois + 20} m</b><span class="nr-pronto">Pronto</span>`, { raio: 124, centroBtn: true });
  agendar();
  alvoClique('.nr-op', (b) => {
    const e = b.dataset.e!;
    if (e === 'toda') estender(m, { toda: true });
    else estender(m, e[0] === 'a' ? { antes: +e.slice(1) } : { depois: +e.slice(1) });
    m.rotulo = `${esc(trShort(m.prop!.from))} → ${esc(trShort(m.prop!.to))} · ${m.prop!.campo!.efeito}`;
    pintar();
  });
  alvoClique('[data-a=pronto]', () => { m.fase = 'salvo'; pintar(); });
}

function pintarObs(m: Menu) {
  parar();
  const atual = (m.prop?.note ?? m.nota?.text ?? '') as string, a = area(), larg = Math.min(300, a.w - 16);
  const top = Math.max(8, Math.min(a.h - 120, m.pt.y - 60)), left = Math.min(a.w - 8 - larg, Math.max(8, m.pt.x - larg / 2));
  raiz.innerHTML = `<div class="nr-fundo" id="nrFundo"></div>
    <div class="nr-obs" style="left:${left}px;top:${top}px;width:${larg}px"><b>Observação</b>
      <input type="text" enterkeyhint="done" autocomplete="off" aria-label="Observação" value="${esc(atual)}">
      <div class="nr-obs-bt"><button type="button" class="btn" data-a="cancelar">Cancelar</button><button type="button" class="btn p" data-a="ok">OK</button></div></div>`;
  raiz.hidden = false;
  raiz.querySelector('#nrFundo')!.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharMenu(); });
  const inp = raiz.querySelector('input')!;
  const sair = () => { m.fase = m.voltar; pintar(); };
  const gravar = () => {
    const t = inp.value.trim();
    if (m.prop) { const antes = m.prop.note; m.prop.note = t; atualizarProposta(m.prop); const r = m.prop; m.passos.push(() => { r.note = antes; atualizarProposta(r); }); }
    else if (m.nota) { const n = m.nota, antes = n.text; n.text = t; db.gravar('notes', n); if (E.tab === 'notas') renderNotes(); m.passos.push(() => { n.text = antes; db.gravar('notes', n); if (E.tab === 'notas') renderNotes(); }); }
    sair();
  };
  raiz.querySelector('[data-a=ok]')!.addEventListener('click', gravar);
  raiz.querySelector('[data-a=cancelar]')!.addEventListener('click', sair);
  // preventDefault: sem isso o Enter, já com a roda redesenhada, ainda clicaria no botão que ganhou o foco
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gravar(); } });
  inp.focus();
}

/* ---------------------------------------------------------------- */
/* Editar o que já existe: pressionar o marcador                      */
/* ---------------------------------------------------------------- */
function abrirEdicao(ref: { prop?: Proposta; nota?: Nota }, pt: { x: number; y: number }, lng: number, lat: number) {
  const res = { estado: 'fora', local: null, outro: null, ambiguo: false, avisoPrecisao: false } as Resolucao;
  menu = { fase: 'editar', lng, lat, pt, origem: 'pressao', precisao: null, res, modo: 'nova', passos: [], rotulo: '', voltar: 'editar', ...ref };
  const m = menu;
  if (ref.prop) {
    const p = getP(ref.prop.pid ?? '');
    if (!p || !ref.prop.campo) { fecharMenu(); return; }
    const { b0 } = baseDaProposta(ref.prop);
    m.alvo = { p, i: b0, lane: ref.prop.lane, from: ref.prop.from };
  }
  pintar();
}

function pintarEditar(m: Menu) {
  parar();
  const itens: Bolha[] = [];
  const r = m.prop, n = m.nota;
  const dreno = n?.rapida && (n.rapida.tipo === 'dreno_mais' || n.rapida.tipo === 'dreno_menos');
  if (r || dreno) itens.push({ id: 'Alterar', attr: 'data-a="alterar"', html: (r ? IC.alterar : IC.alterarNota) + '<span>Alterar</span>' });
  if (r) itens.push({ id: 'Estender', attr: 'data-a="estender"', html: IC.estender + '<span>Estender</span>' });
  itens.push({ id: 'Observação', attr: 'data-a="obs"', html: IC.obs + '<span>Observação</span>' });
  itens.push({ id: 'Excluir', attr: 'data-a="excluir"', cls: 'nr-d', html: IC.excluir + '<span>Excluir</span>' });
  const resumo = r ? `${esc(trShort(r.from))} → ${esc(trShort(r.to))}` : n?.rapida ? esc(TIPOS_RAPIDOS[n.rapida.tipo].rotulo) : 'Nota';
  roda(itens, `<small>${r ? 'Alteração' : 'Nota'}</small><b>${resumo}</b>`);
  alvoClique('.nr-op', (b) => {
    const a = b.dataset.a;
    if (a === 'alterar') {
      if (r) { m.modo = 'editar'; m.fase = 'solucao'; pintar(); return; }
      const nn = n!, nova: TipoRapido = nn.rapida!.tipo === 'dreno_mais' ? 'dreno_menos' : 'dreno_mais', antiga = nn.rapida!.tipo;
      nn.rapida!.tipo = nova; db.gravar('notes', nn); refreshNotesLayer(); if (E.tab === 'notas') renderNotes();
      m.passos.push(() => { nn.rapida!.tipo = antiga; db.gravar('notes', nn); if (E.tab === 'notas') renderNotes(); });
      m.rotulo = esc(TIPOS_RAPIDOS[nova].rotulo);
      concluir(m);
    } else if (a === 'estender') { m.fase = 'estender'; pintar(); }
    else if (a === 'obs') { m.voltar = 'editar'; m.fase = 'obs'; pintar(); }
    else if (a === 'excluir') {
      if (r) m.passos.push(removerProposta(r));
      else if (n) { removerNota(n); m.passos.push(() => restaurarNota(n)); }
      m.prop = undefined; m.nota = undefined; m.regravar = undefined;
      m.rotulo = 'Excluída';
      vibrar(20);
      m.fase = 'salvo'; pintar();
    }
  });
}

/* ---------------------------------------------------------------- */
/* Ver parâmetros                                                    */
/* ---------------------------------------------------------------- */
function pintarParam(m: Menu) {
  parar();
  const l = m.res.local;
  raiz.innerHTML = '<div class="nr-fundo" id="nrFundo"></div>';
  raiz.querySelector('#nrFundo')!.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharMenu(); });
  raiz.hidden = false;
  if (!l) return;
  montarLevantamento(raiz, l.p as unknown as AppProj, l.i, l.lane, fecharMenu);
}

function abrirParametros() {
  const m = menu!;
  if (!m.res.local || m.res.estado === 'fora' || m.res.estado === 'sem-planilha') { m.aviso = 'Segure sobre a pista para ver os parâmetros'; pintar(); return; }
  m.aviso = undefined; m.fase = 'param';
  pintar();
}

/* ---------------------------------------------------------------- */
/* Abertura                                                          */
/* ---------------------------------------------------------------- */
/** Abre o menu circular no ponto (lng, lat), que está em pt na tela (relativo ao mapa). */
export function abrirMenuNota(lng: number, lat: number, pt: { x: number; y: number }, origem: OrigemNota, precisao: number | null) {
  const res = resolverLocal(E.P as LocP[], lat, lng, precisao);
  menu = { fase: 'principal', lng, lat, pt, origem, precisao, res, modo: 'nova', passos: [], rotulo: '', voltar: 'salvo' };
  pintar();
}

/** Marcador de nota ou de alteração de campo sob o ponto da tela (px do canvas), se houver. */
function marcadorEm(x: number, y: number): { prop?: Proposta; nota?: Nota } | null {
  const map = getMap();
  if (!map.getLayer('notes-pt')) return null;
  const f = map.queryRenderedFeatures([[x - 18, y - 18], [x + 18, y + 18]], { layers: ['notes-pt'] })[0];
  const id = f?.properties?.id as string | undefined;
  if (!id) return null;
  if (id.startsWith('prop:')) { const prop = E.props.find((r) => r.id === id.slice(5)); return prop ? { prop } : null; }
  const nota = E.notes.find((n) => n.id === id && n.type === 'pin');
  return nota ? { nota } : null;
}

/** Esc fecha o menu. Devolve true quando consumiu. */
export function fecharNotaRapida(): boolean {
  if (!menu) return false;
  fecharMenu();
  return true;
}

/* ---------------------------------------------------------------- */
/* Entradas: pressão no mapa e botão direito                         */
/* ---------------------------------------------------------------- */
export function initNotaRapida() {
  raiz = document.createElement('div');
  raiz.className = 'nr'; raiz.id = 'nr'; raiz.hidden = true;
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-label', 'Menu de campo');
  stage().appendChild(raiz);
  anel = document.createElement('div');
  anel.className = 'nr-anel'; anel.hidden = true; anel.setAttribute('aria-hidden', 'true');
  // anel de 44 px de raio em volta do dedo, só com transform e opacity: um fio de fundo e duas metades que giram; mira fina no centro
  anel.innerHTML = '<i class="nr-fio"></i><i class="nr-meia nr-m1"><b></b></i><i class="nr-meia nr-m2"><b></b></i><i class="nr-mira"></i>';
  stage().appendChild(anel);
  live = document.createElement('div');
  live.className = 'nr-live'; live.hidden = true; live.setAttribute('aria-hidden', 'true');
  stage().appendChild(live);
  try { void navigator.storage?.persist?.(); } catch { /* sem persistência garantida */ }

  const map = getMap();
  const cont = map.getCanvasContainer();
  let timer: ReturnType<typeof setTimeout> | undefined, mostra: ReturnType<typeof setTimeout> | undefined, sai: ReturnType<typeof setTimeout> | undefined;
  let ini: { x: number; y: number; id: number } | null = null, disparouEm = 0;
  const limparDestaque = () => setData('phl', { type: 'FeatureCollection', features: [] });
  /** Cancelar: o anel encolhe e some em 150 ms, sem abrir nada. */
  const cancelar = (animar = true) => {
    clearTimeout(timer); clearTimeout(mostra); ini = null;
    live.hidden = true; limparDestaque();
    if (!anel.hidden && animar) { anel.classList.remove('nr-roda'); anel.classList.add('nr-sai'); clearTimeout(sai); sai = setTimeout(() => { anel.hidden = true; anel.classList.remove('nr-sai'); }, 150); }
    else { anel.hidden = true; anel.classList.remove('nr-roda', 'nr-sai'); }
  };
  const livre = () => E.mapReady && !E.tool && E.tab !== 'al' && !menu;
  const noMapa = (e: PointerEvent) => (e.target as HTMLElement).classList.contains('maplibregl-canvas');
  const abrirEm = (cx: number, cy: number) => {
    const box = cont.getBoundingClientRect(), pt = relativo(cx, cy), ll = map.unproject([cx - box.left, cy - box.top]);
    const marcador = marcadorEm(cx - box.left, cy - box.top);
    if (marcador) abrirEdicao(marcador, pt, ll.lng, ll.lat); else abrirMenuNota(ll.lng, ll.lat, pt, 'pressao', null);
  };
  /** Depois de 150 ms: mira no ponto exato, anel de progresso, rótulo ao vivo (km e faixa) e o trecho de 20 m mais próximo em destaque. */
  const mostrarAnel = (cx: number, cy: number, dur: number) => {
    const p = relativo(cx, cy), box = cont.getBoundingClientRect(), ll = map.unproject([cx - box.left, cy - box.top]);
    anel.style.left = p.x + 'px'; anel.style.top = p.y + 'px';
    anel.style.setProperty('--nr-dur', Math.max(100, dur - PRESSAO_ATRASO_MS) + 'ms');
    clearTimeout(sai);
    anel.hidden = false; anel.classList.remove('nr-roda', 'nr-sai'); void anel.getBoundingClientRect(); anel.classList.add('nr-roda');
    const res = resolverLocal(E.P as LocP[], ll.lat, ll.lng, null), l = res.local;
    live.textContent = res.estado === 'sem-planilha' ? 'Trecho não definido' : res.estado === 'fora' || !l ? 'Fora do trecho'
      : `km ${l.p.kmLab[l.i]} · ${l.lane === 0 ? 'Acost.' : l.lane === null ? 'fora da pista' : 'Fx ' + l.lane}`;
    // deslocado para fora do dedo: acima do anel, ou abaixo quando o ponto está perto do topo
    const area0 = stage().getBoundingClientRect(), acima = p.y > 118;
    live.style.left = Math.min(area0.width - 80, Math.max(80, p.x)) + 'px';
    live.style.top = (acima ? p.y - 76 : p.y + 62) + 'px';
    live.hidden = false;
    if (l && l.lane !== null && (res.estado === 'dentro' || res.estado === 'proximo')) {
      const f = (l.p as unknown as AppProj).polyByFid.get(l.i * 8 + (l.lane || 7));
      setData('phl', { type: 'FeatureCollection', features: f ? [{ type: 'Feature', properties: {}, geometry: f.geometry }] : [] });
    } else limparDestaque();
  };

  /** Qualquer erro num gesto de entrada limpa o estado da pressão e é guardado em Ajustes > Diagnóstico: um gesto que falha nunca pode deixar o mapa sem responder. */
  const seguro = (onde: string, f: () => void) => {
    try { f(); } catch (err) {
      registrarErro(err, onde, err instanceof Error ? err.stack : '');
      try { cancelar(false); if (menu) fecharMenu(); } catch { /* o estado já está limpo o bastante */ }
    }
  };
  cont.addEventListener('pointerdown', (e) => seguro('pressão (pointerdown)', () => {
    if (ini && e.pointerId !== ini.id) { cancelar(); return; } // segundo dedo: é gesto de zoom ou rotação
    if ((e.pointerType === 'mouse' && e.button !== 0) || !livre() || !noMapa(e)) return;
    const dur = pressaoMs();
    ini = { x: e.clientX, y: e.clientY, id: e.pointerId };
    mostra = setTimeout(() => seguro('pressão (anel)', () => { if (ini) mostrarAnel(ini.x, ini.y, dur); }), PRESSAO_ATRASO_MS);
    timer = setTimeout(() => seguro('pressão (abrir o menu)', () => {
      if (!ini) return;
      const { x, y } = ini;
      cancelar(false); disparouEm = Date.now();
      E.cliqueSuprimidoAte = Date.now() + 700;
      vibrar(30);
      abrirEm(x, y);
    }), dur);
  }));
  cont.addEventListener('pointermove', (e) => { if (ini && e.pointerId === ini.id && Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > PRESSAO_MOVE_PX) cancelar(); });
  // fim ou interrupção do gesto por qualquer caminho: soltar, cancelar, perder a captura, sair da tela, trocar de app ou perder o foco
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'touchcancel'] as const) cont.addEventListener(ev, () => cancelar());
  window.addEventListener('blur', () => cancelar());
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelar(); });
  // o menu de contexto do navegador nunca aparece sobre o mapa; o botão direito do mouse abre o menu direto
  cont.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const toque = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
    // o navegador solta um contextmenu logo depois da pressão longa por toque: a pressão já abriu o menu
    if (toque || Date.now() - disparouEm < 900 || !livre()) return;
    cancelar();
    E.cliqueSuprimidoAte = Date.now() + 300;
    abrirEm(e.clientX, e.clientY);
  });

  mostrarDicaSePreciso();
}

/** "Nota no meu local": abre o menu na posição do GPS. Sem GPS (negado, sem resposta em 8 s, erro ou precisão pior que 50 m), uma linha avisa e a pressão no mapa segue valendo. */
export async function notaNoMeuLocal() {
  if (menu) fecharMenu();
  const map = getMap(), r = await obterPosicao();
  if (!r.ok) { toast('Sem GPS. Segure no mapa no ponto desejado.', 5000); return; }
  map.jumpTo({ center: [r.pos.lon, r.pos.lat], zoom: Math.max(map.getZoom(), 17.5) });
  const p = map.project([r.pos.lon, r.pos.lat]), box = map.getCanvasContainer().getBoundingClientRect(), s = stage().getBoundingClientRect();
  abrirMenuNota(r.pos.lon, r.pos.lat, { x: box.left - s.left + p.x, y: box.top - s.top + p.y }, 'gps', r.pos.acc);
}

/** Dica única na primeira vez com planilhas na tela. */
function mostrarDicaSePreciso() {
  let visto = false;
  try { visto = localStorage.getItem(CHAVE_DICA) === '1'; } catch { /* sem storage */ }
  if (visto) return;
  const tentar = () => {
    if (!E.P.length || document.querySelector('.nr-dica')) return;
    clearInterval(iv);
    const d = document.createElement('div');
    d.className = 'glass dica nr-dica'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>Segure no mapa para anotar</span><button type="button" class="btn p">Entendi</button>';
    d.querySelector('button')!.addEventListener('click', () => { d.remove(); try { localStorage.setItem(CHAVE_DICA, '1'); } catch { /* sem storage */ } });
    (ehCelular() ? stage() : document.querySelector('.leftcol') ?? stage()).appendChild(d);
  };
  const iv = setInterval(tentar, 1500);
}
