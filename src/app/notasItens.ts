import { TIPOS_RAPIDOS, situacaoConserva } from '../dominio/notaRapida';
import { parseKmTexto } from '../formats/km';
import { E, kmFmt, type Nota } from './estado';
import { getMap } from './mapa';
import { ICONE } from './notaRapida';
import * as db from './persist';
import { refreshNotesLayer, renderNotes } from './revisao';
import { esc, toast, toastAcao } from './ui';

/** Itens das notas rápidas na lista de ocorrências da aba Revisão: ícone do tipo, km e hora, toque para ir ao local, observação, resolvida e excluir. */
const obsAberta = new Set<string>();

const hora = (t: string) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Km como o app mostra: o modo privacidade conta a partir do início (a nota guarda o real). */
const kmDe = (n: Nota) => { const k = n.rapida?.km; if (!k) return ''; if (!E.privacidade) return k; const v = parseKmTexto(k); return v === null ? '' : kmFmt(v); };

export function itemNotaHtml(n: Nota): string {
  const r = n.rapida!, t = TIPOS_RAPIDOS[r.tipo];
  const onde = r.estado === 'sem-planilha' ? 'trecho não definido' : r.estado === 'fora' ? 'fora do trecho' : `km ${esc(kmDe(n))}${r.faixa === null ? '' : r.faixa === 0 ? ' · Acost.' : ` · Fx ${r.faixa}`}`;
  const aberta = obsAberta.has(n.id), conserva = r.tipo === 'conserva';
  const rotRes = conserva ? (r.resolvida ? 'Voltar para pendente' : 'Marcar como verificado') : (r.resolvida ? 'Reabrir' : 'Marcar como resolvida');
  const sit = conserva ? ` · <b class="nri-sit ${r.resolvida ? 'ok' : 'pend'}">${situacaoConserva(r)}</b>` : r.resolvida ? ' · resolvida' : '';
  const mini = r.tipo === 'foto' && n.photos?.[0] ? `<img class="nri-th" src="${esc(n.photos[0])}" alt="Foto" loading="lazy">` : '';
  return `<div class="nri${r.resolvida ? ' resolvida' : ''}" data-nri="${n.id}">
    <div class="row nri-l"><button type="button" class="nri-go" data-nv="${n.id}" aria-label="Ir ao local: ${esc(t.rotulo)}, ${onde}">
        <span class="nrl-ic" aria-hidden="true">${mini || ICONE[r.tipo]}</span>
        <span class="grow"><b class="num">${onde}</b><span class="muted nri-s">${esc(t.rotulo)} · ${hora(n.t)}${r.origem === 'gps' ? ' · GPS' : ''}${sit}</span>${n.text ? `<span class="nri-obs">${esc(n.text)}</span>` : ''}</span></button>
      <button type="button" class="iconbtn" data-nobs="${n.id}" aria-label="Observação" aria-expanded="${aberta}" title="Observação"><svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
      <button type="button" class="iconbtn" data-nres="${n.id}" aria-label="${rotRes}" title="${rotRes}"><svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
      <button type="button" class="iconbtn" data-nx="${n.id}" aria-label="Excluir nota" title="Excluir"><svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>
    ${aberta ? `<div class="nri-obsrow"><input type="text" data-nobsin="${n.id}" enterkeyhint="done" autocomplete="off" placeholder="Observação" aria-label="Observação da nota" value="${esc(n.text)}"><button type="button" class="btn p" data-nobsok="${n.id}">OK</button></div>` : ''}</div>`;
}

export function bindItensNotas(el: HTMLElement) {
  const nota = (id: string | undefined) => E.notes.find((n) => n.id === id);
  el.querySelectorAll<HTMLElement>('[data-nv]').forEach((b) => (b.onclick = () => {
    const n = nota(b.dataset.nv); if (!n) return;
    const m = getMap(); m.flyTo({ center: [n.coords[0][0], n.coords[0][1]], zoom: Math.max(m.getZoom(), 17.5), duration: 700 });
  }));
  el.querySelectorAll<HTMLElement>('[data-nobs]').forEach((b) => (b.onclick = () => { const id = b.dataset.nobs!; if (obsAberta.has(id)) obsAberta.delete(id); else obsAberta.add(id); renderNotes(); if (obsAberta.has(id)) document.querySelector<HTMLInputElement>(`[data-nobsin="${id}"]`)?.focus(); }));
  const gravarObs = (id: string) => {
    const n = nota(id), inp = document.querySelector<HTMLInputElement>(`[data-nobsin="${id}"]`);
    if (!n || !inp) return;
    n.text = inp.value.trim(); db.gravar('notes', n); obsAberta.delete(id); renderNotes(); toast('Observação salva');
  };
  el.querySelectorAll<HTMLElement>('[data-nobsok]').forEach((b) => (b.onclick = () => gravarObs(b.dataset.nobsok!)));
  el.querySelectorAll<HTMLInputElement>('[data-nobsin]').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') gravarObs(i.dataset.nobsin!); }));
  el.querySelectorAll<HTMLElement>('[data-nres]').forEach((b) => (b.onclick = () => { const n = nota(b.dataset.nres); if (!n?.rapida) return; n.rapida.resolvida = !n.rapida.resolvida; db.gravar('notes', n); renderNotes(); }));
  el.querySelectorAll<HTMLElement>('[data-nx]').forEach((b) => (b.onclick = () => {
    const n = nota(b.dataset.nx); if (!n) return;
    E.notes = E.notes.filter((x) => x.id !== n.id); db.apagar('notes', n.id); obsAberta.delete(n.id); refreshNotesLayer(); renderNotes();
    toastAcao('Nota excluída', 'Desfazer', () => { E.notes.push(n); db.gravar('notes', n); refreshNotesLayer(); renderNotes(); }, 8000);
  }));
}
