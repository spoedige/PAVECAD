import { ALCANCES, levantamentoCsv, levantar, type TrechoLev } from '../dominio/levantamento';
import { IND, IND_KEYS, Q5, Q5F, type IndKey } from '../dominio/indicadores';
import { trColor } from '../dominio/solucoes';
import { E, kmFmt, projName, type AppProj } from './estado';
import { cssv, esc, fmt, toast } from './ui';

/** "Ver parâmetros": cartão com o que há sob o ponto pressionado, por faixa, e o CSV só desse recorte.
 *  Não grava nota nem proposta e não guarda estado fora do cartão. */
export function montarLevantamento(host: HTMLElement, p: AppProj, i: number, lane: number | null, fechar: () => void) {
  let alcance = 0, trechos: TrechoLev[] = [];
  const card = document.createElement('div');
  card.className = 'nr-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Levantamento no ponto');
  // o toque dentro do cartão nunca chega ao fundo que fecha o menu
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  host.appendChild(card);

  const cores = () => (E.field ? Q5F : Q5);
  const celula = (k: IndKey, v: number | null) => {
    if (v === null) return '<td class="num muted">–</td>';
    const M = IND[k];
    return `<td class="num"><i class="nr-q" style="background:${cores()[M.cls(v)]}"></i>${fmt(v * M.scale, M.dec)}</td>`;
  };
  const pintar = () => {
    trechos = levantar(p, i, ALCANCES.find((a) => a.m === alcance)!.m, kmFmt);
    const usados = IND_KEYS.filter((k) => trechos.some((t) => t.ind[k] !== null));
    const detalhe = alcance === 0;
    const linhas = trechos.map((t) => `<tr${lane !== null && t.lane === lane ? ' class="sel"' : ''}>
        <th scope="row">${t.faixa}</th><td class="num">${esc(t.kmIni)}<br>${esc(t.kmFim)}</td>
        <td><span class="sw" style="background:${trColor(t.main, E.field, cssv('--none'))}"></span><b>${esc(t.codigo ?? '–')}</b><br><span class="muted">${esc(t.solucao)}${t.main === '-' ? '' : ' · ' + esc(t.classe)}</span></td>
        <td class="num">${t.larg === null ? '–' : fmt(t.larg, 2)}</td><td class="num">${fmt(t.area, 0)}</td>${usados.map((k) => celula(k, t.ind[k])).join('')}</tr>`
      + (detalhe && t.camadas.length ? `<tr class="cam"><td></td><td colspan="${4 + usados.length}">${t.camadas.map(([k, v]) => `<span><span class="muted">${esc(k)}</span> ${esc(v)}</span>`).join('')}</td></tr>` : '')).join('');
    card.innerHTML = `<div class="nr-card-top"><div><b class="num">km ${esc(p.kmLab[i])}</b><span class="muted"> · ${esc(projName(p))}</span></div>
        <button type="button" class="nr-x" data-a="fechar" aria-label="Fechar">×</button></div>
      <div class="nr-chips" role="group" aria-label="Alcance">${ALCANCES.map((a) => `<button type="button" class="nr-chip" data-m="${a.m}" aria-pressed="${a.m === alcance}">${a.rotulo}</button>`).join('')}</div>
      <div class="nr-tab"><table><thead><tr><th>Faixa</th><th>Km</th><th>Solução</th><th>Larg. (m)</th><th>Área (m²)</th>${usados.map((k) => `<th>${esc(IND[k].label.replace(' máx', ''))}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="nr-card-fim"><button type="button" class="btn p" data-a="copiar">Copiar levantamento</button></div>`;
    card.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => { alcance = +b.dataset.m!; pintar(); }));
    card.querySelector('[data-a=fechar]')!.addEventListener('click', fechar);
    card.querySelector('[data-a=copiar]')!.addEventListener('click', () => {
      const csv = levantamentoCsv(trechos, projName(p));
      (navigator.clipboard ? navigator.clipboard.writeText(csv) : Promise.reject()).then(() => toast('Levantamento copiado (CSV)'), () => toast('Não foi possível copiar neste ambiente'));
    });
  };
  pintar();
  return card;
}
