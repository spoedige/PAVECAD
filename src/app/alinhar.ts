import { converterDesloc, DESLOC_MAX, quadroMedio, validarDesloc, type Desloc } from '../geometry/deslocamento';
import { E, getP, type AppProj } from './estado';
import { aplicarDesloc, salvarDesloc } from './projetos';
import { alvosAjuste, setTab } from './paineis';
import { setPainel } from './layout';
import { contadorSelecao, htmlSelecao, itemDe, ligarSelecao } from './selecaoPlanilhas';
import { projName } from './estado';
import { $, toast, toastAcao } from './ui';

/** Alinhar planilhas: desloca as coordenadas das planilhas marcadas para encaixar a rodovia no eixo do mapa.
 *  Longitudinal e transversal em metros, relativos ao sentido de percurso de cada planilha. Os passos mostram o resultado no mapa
 *  na hora; "Aplicar às selecionadas" grava no aparelho e oferece Desfazer. Sair da ferramenta sem aplicar volta ao valor gravado. */

let abaAnterior: typeof E.tab = 'seg';
let foco: string | null = null;

const gravado = (p: AppProj): Desloc => E.deslocSalvos[p.meta.name] ?? { l: 0, t: 0 };
const igual = (a: Desloc, b: Desloc) => a.l === b.l && a.t === b.t;
const pendentes = () => alvosAjuste().filter((q) => !igual(atual(q), gravado(q)));

/** Deslocamentos em fila: cada clique usa o valor mais recente, mesmo com o worker ainda calculando. */
const fila = new Map<string, { p: AppProj; d: Desloc }>();
let ocupado = false;
const atual = (p: AppProj): Desloc => fila.get(p.id)?.d ?? p.desloc;
async function pedir(p: AppProj, d: Desloc, salvar = false) {
  fila.set(p.id, { p, d });
  if (ocupado) return;
  ocupado = true;
  try {
    while (fila.size) {
      const [id, n] = fila.entries().next().value as [string, { p: AppProj; d: Desloc }];
      await aplicarDesloc(n.p, n.d, salvar);
      if (fila.get(id) === n) fila.delete(id);
    }
  } finally { ocupado = false; }
}

/** Espera o worker terminar os deslocamentos em fila. */
const esperarFila = async () => { while (ocupado || fila.size) await new Promise((r) => setTimeout(r, 30)); };

export const alinharAberto = () => E.tab === 'al';

export function abrirAlinhar() {
  if (E.tab !== 'al') abaAnterior = E.tab;
  setPainel(false, false);
  setTab('al');
  document.querySelectorAll<HTMLElement>('[data-alinhar]').forEach((b) => b.setAttribute('aria-pressed', 'true'));
}

/** Fecha a ferramenta. Alterações não aplicadas voltam ao valor gravado. */
export function fecharAlinhar() {
  if (E.tab !== 'al') return;
  descartar();
  setTab(abaAnterior === 'al' ? 'seg' : abaAnterior);
}
export const alternarAlinhar = () => (alinharAberto() ? fecharAlinhar() : abrirAlinhar());

/** Chamado por setTab ao sair de Alinhar. */
export function aoSairDeAlinhar() {
  descartar();
  document.querySelectorAll<HTMLElement>('[data-alinhar]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

function descartar() {
  for (const q of E.P) if (!igual(atual(q), gravado(q))) void pedir(q, { ...gravado(q) });
}

export function renderAlinhar() {
  const el = $('#t-al');
  const lista = E.P.map(itemDe);
  const alvos = alvosAjuste(), pend = pendentes();
  const campo = (e: 'l' | 't', nome: string, dica: string) => `
    <div class="desl-eixo"><label for="d-${e}">${nome} (m)</label><span class="note">${dica}</span>
      <div class="desl-passo">${[-5, -1].map((v) => `<button class="btn" type="button" data-d="${e}" data-s="${v}" aria-label="${nome} ${v} m">${v === -1 ? '−1' : '−5'}</button>`).join('')}
        <input id="d-${e}" class="in num" type="number" step="0.1" min="-${DESLOC_MAX}" max="${DESLOC_MAX}" inputmode="decimal" aria-label="${nome} em metros">
        ${[1, 5].map((v) => `<button class="btn" type="button" data-d="${e}" data-s="${v}" aria-label="${nome} +${v} m">+${v}</button>`).join('')}</div></div>`;
  el.innerHTML = E.P.length ? `
    <div class="al-topo"><b>Alinhar planilhas</b><span class="num al-cont" id="al-cont">${contadorSelecao(E.settingsSel, E.P.length)}</span><button class="btn" type="button" id="al-fechar">Fechar</button></div>
    <div class="al-lista-wrap">${htmlSelecao({ itens: lista, marcadas: E.settingsSel }, 'al-lista')}</div>
    <div class="al-corpo" id="al-corpo">
      ${alvos.length ? `<div class="list desl" id="desloc">
        ${campo('l', 'Longitudinal', 'ao longo da via; positivo no sentido de percurso')}
        ${campo('t', 'Transversal', 'positivo à direita do sentido de percurso, negativo à esquerda')}
        <p class="cfg-err" id="d-err" role="alert"></p>
        <div class="al-sentidos" id="al-sentidos" hidden>
          <p class="note" id="al-sentidos-txt"></p>
          <button class="btn" type="button" id="d-copiar-mapa">Copiar como deslocamento no mapa</button>
        </div>
        <div class="btns"><button class="btn" type="button" id="d-zero">Zerar</button><button class="btn p" type="button" id="d-aplicar"${pend.length ? '' : ' disabled'}>Aplicar às selecionadas</button></div>
        <p class="note" id="d-estado">${pend.length ? `${pend.length} planilha${pend.length > 1 ? 's' : ''} com alteração ainda não aplicada. Sair daqui sem aplicar volta ao valor gravado.` : 'Os passos mostram o resultado no mapa na hora. Aplique para gravar no aparelho, junto com a planilha.'}</p>
        <p class="note">Vale para o mapa, o CSV de propostas e a localização por GPS. Cada planilha é movida em relação ao seu sentido de percurso.</p>
      </div>` : '<p class="note">Marque ao menos uma planilha para alinhar.</p>'}
    </div>` : '<div class="empty"><b>Nenhuma planilha aberta</b>Abra uma planilha para alinhar.</div>';
  if (!E.P.length) return;

  ligarSelecao(el, {
    itens: lista, marcadas: E.settingsSel, origem: alvos[0] ? itemDe(alvos[0]) : undefined,
    aoMudar: () => {
      // planilha desmarcada com alteração pendente volta ao valor gravado
      for (const q of E.P) if (!E.settingsSel.has(q.id) && !igual(atual(q), gravado(q))) void pedir(q, { ...gravado(q) });
      renderCorpo();
    },
  });
  $('#al-fechar').onclick = () => fecharAlinhar();
  renderCorpo();
  if (foco && (!document.activeElement || document.activeElement === document.body)) restaurarFoco();
}

/** Refaz só a parte de baixo (campos e botões); a lista de planilhas fica parada no topo. */
function renderCorpo() {
  const el = $('#t-al');
  const alvos = alvosAjuste(), pend = pendentes();
  const cont = document.getElementById('al-cont');
  if (cont) cont.textContent = contadorSelecao(E.settingsSel, E.P.length);
  const corpo = document.getElementById('al-corpo');
  if (!corpo) return;
  if (!alvos.length) { corpo.innerHTML = '<p class="note">Marque ao menos uma planilha para alinhar.</p>'; return; }
  if (!document.getElementById('desloc')) { renderAlinhar(); return; }

  const set = (id: string, vals: string[]) => {
    const e = $<HTMLInputElement>(id);
    if (vals.every((v) => v === vals[0])) { e.value = vals[0]; e.placeholder = ''; } else { e.value = ''; e.placeholder = 'vários'; }
  };
  set('#d-l', alvos.map((q) => String(atual(q).l)));
  set('#d-t', alvos.map((q) => String(atual(q).t)));
  const ap = $<HTMLButtonElement>('#d-aplicar');
  ap.disabled = pend.length === 0;
  $('#d-estado').textContent = pend.length ? `${pend.length} planilha${pend.length > 1 ? 's' : ''} com alteração ainda não aplicada. Sair daqui sem aplicar volta ao valor gravado.` : 'Os passos mostram o resultado no mapa na hora. Aplique para gravar no aparelho, junto com a planilha.';

  const mudar = (novos: { q: AppProj; d: Desloc }[]) => {
    const msg = novos.map((x) => validarDesloc(x.d)).find(Boolean) ?? '';
    $('#d-err').textContent = msg;
    if (msg) return;
    for (const x of novos) void pedir(x.q, x.d); // a fila já guarda o valor novo; o mapa chega logo depois
    renderCorpo();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => {
    const e = b.dataset.d as 'l' | 't', passo = +b.dataset.s!;
    foco = `[data-d="${e}"][data-s="${b.dataset.s}"]`;
    mudar(alvosAjuste().map((q) => ({ q, d: { ...atual(q), [e]: Math.round((atual(q)[e] + passo) * 1000) / 1000 } })));
    restaurarFoco();
  }));
  for (const e of ['l', 't'] as const) {
    $<HTMLInputElement>('#d-' + e).onchange = (ev) => {
      const txt = (ev.target as HTMLInputElement).value.replace(',', '.');
      if (txt === '') return;
      const v = parseFloat(txt);
      foco = '#d-' + e;
      if (!Number.isFinite(v)) { $('#d-err').textContent = 'Informe um número em metros.'; return; }
      mudar(alvosAjuste().map((q) => ({ q, d: { ...atual(q), [e]: Math.round(v * 1000) / 1000 } })));
      restaurarFoco();
    };
  }
  $('#d-zero').onclick = () => { foco = '#d-zero'; $('#d-err').textContent = ''; mudar(alvosAjuste().map((q) => ({ q, d: { l: 0, t: 0 } }))); restaurarFoco(); };
  ap.onclick = () => void aplicarSelecionadas();

  // sentidos opostos: avisa que o transversal é relativo ao sentido de cada planilha e oferece a conversão pelo mapa
  const origem = alvos[0], opostas = alvos.filter((q) => q.meta.travel !== origem.meta.travel);
  const caixa = $('#al-sentidos');
  caixa.hidden = opostas.length === 0;
  if (opostas.length) {
    $('#al-sentidos-txt').textContent = `O deslocamento transversal será aplicado em relação ao sentido de cada planilha. Para mover as outras pelo mesmo vetor no mapa, use o botão abaixo (referência: ${projName(origem)}, a primeira marcada).`;
    $('#d-copiar-mapa').onclick = () => copiarComoMapa(origem, alvos.filter((q) => q !== origem));
  }
}

/** Leva o deslocamento da planilha de referência às outras marcadas como o mesmo vetor sobre o mapa, pelo azimute médio de cada uma. */
function copiarComoMapa(origem: AppProj, destinos: AppProj[]) {
  const qo = quadroMedio(origem.x0, origem.y0, origem.segs, origem.meta.travel);
  if (!qo) { toast('A planilha de referência não tem trecho para medir o azimute'); return; }
  const d = atual(origem), novos: { q: AppProj; d: Desloc }[] = [];
  for (const q of destinos) {
    const qd = quadroMedio(q.x0, q.y0, q.segs, q.meta.travel);
    if (!qd) continue;
    novos.push({ q, d: converterDesloc(d, qo, qd) });
  }
  if (!novos.length) { toast('Nada a converter'); return; }
  for (const x of novos) void pedir(x.q, x.d);
  foco = '#d-copiar-mapa';
  renderCorpo();
  toast(`Convertido pelo azimute médio de ${novos.length} planilha${novos.length > 1 ? 's' : ''}. Confira no mapa e aplique`);
}

function restaurarFoco() {
  if (!foco) return;
  document.querySelector<HTMLElement>(`#t-al ${foco}`)?.focus();
}

/** Grava o deslocamento das planilhas com alteração pendente e oferece Desfazer. */
async function aplicarSelecionadas() {
  const alvos = pendentes();
  if (!alvos.length) { toast('Nada a aplicar'); return; }
  await esperarFila();
  const antes = alvos.map((q) => ({ q, d: { ...gravado(q) } }));
  for (const q of alvos) salvarDesloc(q);
  renderCorpo();
  toastAcao(`Deslocamento aplicado a ${alvos.length} planilha${alvos.length > 1 ? 's' : ''}`, 'Desfazer', () => {
    for (const a of antes) if (getP(a.q.id)) { void pedir(a.q, { ...a.d }, true); }
    toast('Aplicação desfeita');
    setTimeout(renderCorpo, 300);
  });
}
