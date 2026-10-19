import { FILTRO_VAZIO, ORDEM_TIPOS, TIPOS_RAPIDOS, filtrarRapidas, notasCsv, nomeCsvNotas, precisaLembrar, type Filtro, type NotaRap, type SentidoNota, type TipoRapido } from '../dominio/notaRapida';
import { parseKmTexto } from '../formats/km';
import { E, getP, kmFmt, projName, type Nota } from './estado';
import { getMap } from './mapa';
import { ICONE, notasNovasSemExportar, zerarNotasNovas } from './notaRapida';
import * as db from './persist';
import { refreshNotesLayer, renderNotes } from './revisao';
import { esc, toast, toastAcao } from './ui';

let filtro: Filtro = { ...FILTRO_VAZIO };

const hora = (t: string) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Planilha e km como o app mostra: o modo privacidade esconde os reais (a nota guarda os reais). */
const nomeDe = (n: Nota) => { const p = n.loc ? getP(n.loc.pid) : undefined; return E.privacidade ? (p ? projName(p) : 'Planilha') : n.rapida!.planilha ?? ''; };
const kmDe = (n: Nota) => { const k = n.rapida!.km; if (!k || !E.privacidade) return k ?? ''; const v = parseKmTexto(k); return v === null ? '' : kmFmt(v); };
const rodoviaDe = (n: Nota) => (E.privacidade ? '' : n.rapida!.rodovia ?? '');

function localTxt(n: Nota): string {
  const r = n.rapida!;
  if (r.estado === 'sem-planilha') return 'Trecho não definido';
  if (r.estado === 'fora') return 'Fora do trecho';
  const faixa = r.faixa === null ? '' : r.faixa === 0 ? 'Acost.' : `Fx ${r.faixa}`;
  return [`km ${esc(kmDe(n))}`, faixa, esc(rodoviaDe(n) || nomeDe(n)), r.sentido ?? ''].filter(Boolean).join(' · ') + (r.estado === 'proximo' ? ' (mais próximo)' : '');
}

export function rapidasHtml(): string {
  const todas = E.notes.filter((n) => n.rapida);
  const cab = `<div class="sect">Notas de campo <span style="text-transform:none;font-weight:500">${todas.length}</span></div>`;
  if (!todas.length) return `<div>${cab}<p class="vazio">Nenhuma nota de campo. Segure no mapa.</p></div>`;
  const lista = filtrarRapidas(todas as Nota[], filtro) as Nota[];
  const rodovias = [...new Set(todas.map((n) => n.rapida!.rodovia).filter((x): x is string => !!x))].sort();
  const opt = (v: string, t: string, sel: string) => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}>${esc(t)}</option>`;
  const filtros = `<div class="nrl-filtros">
    <select data-nf="tipo" aria-label="Filtrar por tipo">${opt('', 'Todos os tipos', filtro.tipo)}${ORDEM_TIPOS.map((t) => opt(t, TIPOS_RAPIDOS[t].rotulo, filtro.tipo)).join('')}</select>
    <select data-nf="rodovia" aria-label="Filtrar por rodovia">${opt('', 'Todas as rodovias', filtro.rodovia)}${rodovias.map((r) => opt(r, E.privacidade ? 'Rodovia' : r, filtro.rodovia)).join('')}</select>
    <select data-nf="sentido" aria-label="Filtrar por sentido">${opt('', 'Os dois sentidos', filtro.sentido)}${opt('Crescente', 'Crescente', filtro.sentido)}${opt('Decrescente', 'Decrescente', filtro.sentido)}</select>
    <select data-nf="origem" aria-label="Filtrar por origem">${opt('', 'Toda origem', filtro.origem)}${opt('pressao', 'Pressão no mapa', filtro.origem)}${opt('gps', 'GPS', filtro.origem)}</select></div>`;
  const cards = lista.map((n) => {
    const r = n.rapida!;
    return `<div class="note-card nrl-card${r.resolvida ? ' resolvida' : ''}" data-nr="${n.id}">
      <div style="display:flex;gap:8px;align-items:center"><span class="nrl-ic" aria-hidden="true">${ICONE[r.tipo]}</span>
        <div class="t nrl-t" style="min-width:0"><b>${esc(TIPOS_RAPIDOS[r.tipo].rotulo)}</b><span style="display:block">${localTxt(n)}</span>
        <span class="muted" style="display:block;font-size:var(--fs-meta)">${hora(n.t)} · ${r.origem === 'gps' ? 'GPS' + (r.precisao !== null ? ` ±${r.precisao} m` : '') : 'Pressão no mapa'}${r.resolvida ? ' · resolvida' : ''}</span></div></div>
      ${n.text ? `<p class="note" style="margin:0">${esc(n.text)}</p>` : ''}
      <div class="nrl-acoes"><button class="btn" data-nv="${n.id}">Ver no mapa</button><button class="btn" data-nres="${n.id}">${r.resolvida ? 'Reabrir' : 'Marcar resolvida'}</button>
        <select data-net="${n.id}" aria-label="Editar o tipo da nota" class="btn" style="padding:0 8px">${ORDEM_TIPOS.map((t) => opt(t, TIPOS_RAPIDOS[t].curto, r.tipo)).join('')}</select>
        <button class="btn d" data-nx="${n.id}">Excluir</button></div></div>`;
  }).join('');
  const novas = notasNovasSemExportar();
  const lembrete = precisaLembrar(novas) ? `<p class="nrl-lembrete">${novas} notas novas sem exportar. Baixe o CSV para guardar uma cópia.</p>` : '';
  return `<div>${cab}${filtros}
    <div class="list" style="margin-top:8px">${cards || '<p class="vazio">Nenhuma nota com esses filtros.</p>'}</div>${lembrete}
    <div class="btns" style="margin-top:8px"><button class="btn" id="nrCsv">Baixar CSV</button></div>
    <p class="note" style="margin-top:7px">Ficam neste aparelho, funcionam sem internet. O CSV traz coordenadas em graus e UTM.</p></div>`;
}

const salvar = (n: Nota) => { db.gravar('notes', n); };

export function bindRapidas(el: HTMLElement) {
  const nota = (id: string | undefined) => E.notes.find((n) => n.id === id);
  el.querySelectorAll<HTMLSelectElement>('[data-nf]').forEach((s) => (s.onchange = () => { (filtro as unknown as Record<string, string>)[s.dataset.nf!] = s.value; renderNotes(); }));
  el.querySelectorAll<HTMLElement>('[data-nv]').forEach((b) => (b.onclick = () => { const n = nota(b.dataset.nv); if (!n) return; const m = getMap(); m.flyTo({ center: [n.coords[0][0], n.coords[0][1]], zoom: Math.max(m.getZoom(), 17.5), duration: 700 }); }));
  el.querySelectorAll<HTMLElement>('[data-nres]').forEach((b) => (b.onclick = () => { const n = nota(b.dataset.nres); if (!n?.rapida) return; n.rapida.resolvida = !n.rapida.resolvida; salvar(n); renderNotes(); }));
  el.querySelectorAll<HTMLSelectElement>('[data-net]').forEach((s) => (s.onchange = () => {
    const n = nota(s.dataset.net); if (!n?.rapida) return;
    n.rapida.tipo = s.value as TipoRapido; n.cat = TIPOS_RAPIDOS[n.rapida.tipo].cat; salvar(n); refreshNotesLayer(); renderNotes(); toast('Tipo alterado');
  }));
  el.querySelectorAll<HTMLElement>('[data-nx]').forEach((b) => (b.onclick = () => {
    const n = nota(b.dataset.nx); if (!n) return;
    E.notes = E.notes.filter((x) => x.id !== n.id); db.apagar('notes', n.id); refreshNotesLayer(); renderNotes();
    toastAcao('Nota excluída', 'Desfazer', () => { E.notes.push(n); salvar(n); refreshNotesLayer(); renderNotes(); }, 8000);
  }));
  const csv = document.getElementById('nrCsv');
  if (csv) csv.onclick = () => {
    const lista = filtrarRapidas(E.notes as unknown as NotaRap[], FILTRO_VAZIO);
    const porId = new Map(E.notes.map((n) => [n.id, n]));
    const texto = notasCsv(lista, { eol: '\r\n', planilha: (n) => nomeDe(porId.get(n.id)!), km: (n) => kmDe(porId.get(n.id)!) });
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿', texto], { type: 'text/csv;charset=utf-8' }));
      a.download = nomeCsvNotas();
      document.body.appendChild(a); a.click(); a.remove();
      zerarNotasNovas(); renderNotes();
      toast(`${nomeCsvNotas()} gerado`, 4000);
    } catch { toast('Download indisponível aqui'); }
  };
}
