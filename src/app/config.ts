import * as catalogo from '../dominio/catalogo';
import { getLimites, IND, IND_KEYS, restaurarLimites, rotulosPara, setLimites, validarLimites, type IndKey, type Limites } from '../dominio/indicadores';
import { LARGURA_ACOSTAMENTO, LARGURA_FAIXA, larguraPadrao, validarAjuste, contarAlteradas, type AjusteLargura } from '../dominio/larguras';
import { trColor } from '../dominio/solucoes';
import { kmLabel, parseKmTexto } from '../formats/km';
import { E, H, getP, projName, type AppProj } from './estado';
import { applyPaint } from './mapa';
import { renderAll } from './paineis';
import * as db from './persist';
import { aplicarAjustes, esquecerProjeto, reclassificarTodos, regeometrar, salvarCatalogo, salvarLimiares } from './projetos';
import { $, cssv, esc, fmt, syncSeg, toast } from './ui';
import { Q5, Q5F } from '../dominio/indicadores';

type Aba = 'sol' | 'larg' | 'lim' | 'dados';
let aba: Aba = 'sol';
let pidLarg: string | null = null;
let kmPrevia: number | null = null;
const el = () => $('#cfg');
export const configAberta = () => !el().hidden;

export function abrirConfig(a?: Aba) {
  if (a) aba = a;
  el().hidden = false;
  document.body.style.overflow = 'hidden';
  render();
  syncSeg($('#cfgTabs'));
  ($('#cfgClose') as HTMLElement).focus();
}
export function fecharConfig() {
  el().hidden = true;
  document.body.style.overflow = '';
}

/** Ponto laranja no botão quando há códigos sem cadastro. */
export function atualizarAviso() {
  $('#cfgDot').style.display = catalogo.naoMapeados().length ? 'block' : 'none';
}

function render() {
  document.querySelectorAll<HTMLElement>('#cfgTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ct === aba)));
  syncSeg($('#cfgTabs'));
  const body = $('#cfgBody');
  body.innerHTML = '';
  if (aba === 'sol') renderSolucoes(body);
  else if (aba === 'larg') renderLarguras(body);
  else if (aba === 'lim') renderLimiares(body);
  else void renderDados(body);
}

const baixar = (nome: string, conteudo: string, tipo: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
};

/** Depois de qualquer mudança no catálogo: repinta o mapa e refaz os painéis. A tabela não é refeita. */
function aplicarCatalogo() {
  salvarCatalogo();
  applyPaint();
  renderAll();
  atualizarAviso();
}

/* ---------------------------------------------------------------- */
/* Soluções                                                          */
/* ---------------------------------------------------------------- */
const ocorrencias = (codigo: string) => E.P.reduce((s, p) => s + (p.codes[codigo] || 0), 0);

function linhaSolucao(it: catalogo.ItemCatalogo): string {
  const nm = !it.mapeado;
  return `<tr data-c="${esc(it.codigo)}" class="${nm ? 'nm' : ''}">
    <td class="cod"><code>${esc(it.codigo)}</code><span class="badge" ${nm ? '' : 'hidden'}>Não mapeado</span></td>
    <td><input type="text" data-f="nome" value="${esc(it.nome)}" aria-label="Nome exibido de ${esc(it.codigo)}"></td>
    <td><input type="text" data-f="curto" value="${esc(it.curto)}" aria-label="Nome curto de ${esc(it.codigo)}"></td>
    <td><input type="color" data-f="cor" value="${esc(it.cor)}" aria-label="Cor de ${esc(it.codigo)}"></td>
    <td><input type="text" data-f="categoria" list="cfgCats" value="${esc(it.mapeado ? it.categoria : '')}" placeholder="${nm ? catalogo.CAT_NAO_MAPEADO : ''}" aria-label="Categoria de ${esc(it.codigo)}"></td>
    <td class="num">${ocorrencias(it.codigo).toLocaleString('pt-BR')}</td>
    <td>${catalogo.ehPadrao(it.codigo) ? `<button class="btn" data-rest="${esc(it.codigo)}" style="min-height:30px;padding:3px 10px">Restaurar</button>` : ''}</td></tr>`;
}

function renderSolucoes(body: HTMLElement) {
  const itens = catalogo.todos(), nm = catalogo.naoMapeados();
  body.innerHTML = `
    <div><h2 class="h2">Catálogo de soluções</h2>
      <p class="lead">Nome, cor e categoria de cada código principal lido das planilhas. Isso muda só como a solução aparece na tela. O código original continua nos dados e nas exportações: "GAP" pode aparecer como "Reforço", e o arquivo exportado segue dizendo GAP.</p></div>
    <div class="cfg-warn" id="catWarn" ${nm.length ? '' : 'hidden'}><b id="catWarnTxt">${nm.length} código${nm.length > 1 ? 's' : ''} sem cadastro</b><span class="note">Aparecem em cinza como "Não mapeado". Edite o nome, a cor e a categoria para cadastrar.</span></div>
    <table class="ctable"><thead><tr><th>Código</th><th>Nome exibido</th><th>Nome curto</th><th>Cor</th><th>Categoria</th><th>Ocorrências</th><th></th></tr></thead>
      <tbody id="catBody">${itens.map(linhaSolucao).join('')}</tbody></table>
    <datalist id="cfgCats">${catalogo.CATEGORIAS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="cfg-row">
      <label>Novo código<input class="in" type="text" id="catNovo" placeholder="Ex.: FS5" style="text-transform:none"></label>
      <button class="btn" id="catAdd">Adicionar</button>
      <span style="flex:1"></span>
      <button class="btn" id="catExp">Exportar JSON</button>
      <button class="btn" id="catImp">Importar JSON</button>
      <button class="btn d" id="catRest">Restaurar padrão</button>
    </div>
    <p class="note">As ocorrências contam faixas de 20 m nas planilhas abertas. O catálogo fica salvo neste aparelho. Exporte o JSON para usar o mesmo catálogo em outro aparelho, por organização ou por projeto.</p>`;

  const tb = $('#catBody');
  const atualizaAviso = () => {
    const n = catalogo.naoMapeados().length;
    $('#catWarn').hidden = !n;
    $('#catWarnTxt').textContent = `${n} código${n > 1 ? 's' : ''} sem cadastro`;
  };
  tb.addEventListener('change', (ev) => {
    const inp = ev.target as HTMLInputElement, tr = inp.closest('tr')!, codigo = tr.dataset.c!, f = inp.dataset.f as 'nome' | 'curto' | 'cor' | 'categoria';
    if (!f) return;
    const novo = catalogo.definir({ codigo, [f]: inp.value });
    tr.classList.remove('nm');
    tr.querySelector<HTMLElement>('.badge')!.hidden = true;
    // reflete o que o catálogo normalizou (nome vazio cai no código, cor inválida é ignorada)
    for (const k of ['nome', 'curto', 'cor', 'categoria'] as const) {
      const c = tr.querySelector<HTMLInputElement>(`[data-f="${k}"]`)!;
      if (c !== inp || k === 'nome' || k === 'curto') c.value = novo[k];
    }
    atualizaAviso();
    aplicarCatalogo();
  });
  tb.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-rest]');
    if (!b) return;
    catalogo.restaurarItem(b.dataset.rest!);
    aplicarCatalogo();
    renderSolucoes(body);
  });
  const add = () => {
    const inp = $<HTMLInputElement>('#catNovo'), c = inp.value.trim();
    if (!/^[A-Za-z0-9]+$/.test(c)) { toast('Use só letras e números no código'); return; }
    if (catalogo.conhecido(c)) { toast('Esse código já existe'); return; }
    catalogo.definir({ codigo: c, nome: c, curto: c, cor: '#5e5ce6', categoria: 'Outro' });
    aplicarCatalogo();
    renderSolucoes(body);
  };
  $('#catAdd').onclick = add;
  $('#catNovo').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add(); });
  $('#catExp').onclick = () => { baixar('catalogo-solucoes.json', JSON.stringify(catalogo.exportar(), null, 1), 'application/json'); toast('Catálogo exportado'); };
  $('#catImp').onclick = () => $('#catIn').click();
  const rest = $('#catRest');
  rest.onclick = () => {
    if (rest.dataset.c !== '1') {
      rest.dataset.c = '1'; rest.textContent = 'Confirmar restauração';
      setTimeout(() => { if (rest.isConnected) { rest.dataset.c = ''; rest.textContent = 'Restaurar padrão'; } }, 3500);
      return;
    }
    catalogo.restaurarPadrao(true);
    aplicarCatalogo();
    renderSolucoes(body);
    toast('Catálogo restaurado. Códigos de fora do padrão voltam como "Não mapeado"');
  };
}

/* ---------------------------------------------------------------- */
/* Larguras                                                          */
/* ---------------------------------------------------------------- */
const nomeFaixa = (l: number) => (l ? `Fx ${l}` : 'Acostamento');
const numStr = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function previaSecao(p: AppProj, km: number): string {
  let i = 0, bd = 1e9;
  p.kmNum.forEach((k, j) => { const d = Math.abs(k - km); if (d < bd) { bd = d; i = j; } });
  const plan = p.rowsPlanilha[i], ef = p.rows[i], md = p.model[i];
  const W = 640, pad = 8, esc2 = (W - pad * 2) / Math.max(1, (plan.widths.reduce((a, b) => a + b, 0) + plan.shoulder), (ef.widths.reduce((a, b) => a + b, 0) + ef.shoulder));
  const none = cssv('--none');
  const barra = (r: typeof plan, y: number, rot: string, destaca: boolean) => {
    let x = pad, out = `<text class="mut" x="${pad}" y="${y - 5}">${rot}</text>`;
    const partes = [...r.widths.map((w, k) => ({ w, nome: `Fx ${k + 1}`, cor: trColor(md.tr[k].main, E.field, none), mud: Math.abs(w - plan.widths[k]) > 1e-9 })), ...(r.shoulder > 0 ? [{ w: r.shoulder, nome: 'Ac', cor: trColor(md.sh.main, E.field, none), mud: Math.abs(r.shoulder - plan.shoulder) > 1e-9 }] : [])];
    for (const q of partes) {
      const w = q.w * esc2;
      out += `<rect x="${x}" y="${y}" width="${Math.max(1, w - 1.5)}" height="30" rx="5" fill="${q.cor}" opacity="${destaca && q.mud ? 1 : 0.85}" ${destaca && q.mud ? `stroke="${cssv('--accent')}" stroke-width="2.5"` : ''}/>`;
      out += `<text x="${x + w / 2}" y="${y + 19}" text-anchor="middle" fill="#000" style="fill:#000;mix-blend-mode:normal">${q.nome} ${numStr(q.w)}</text>`;
      x += w;
    }
    return out;
  };
  return `<svg class="xsvg" viewBox="0 0 ${W} 100" role="img" aria-label="Seção transversal no km ${p.kmLab[i]}">${barra(plan, 22, 'Planilha', false)}${barra(ef, 68, 'Efetiva (com ajustes)', true)}</svg>
    <p class="note num">Seção do km ${p.kmLab[i]} · largura total ${numStr(plan.widths.reduce((a, b) => a + b, 0))} m na planilha e ${numStr(ef.widths.reduce((a, b) => a + b, 0))} m efetiva (sem acostamento).</p>`;
}

function renderLarguras(body: HTMLElement) {
  if (!E.P.length) { body.innerHTML = '<div class="empty"><b>Nenhuma planilha aberta</b>Abra uma planilha no mapa para editar as larguras.</div>'; return; }
  const p = getP(pidLarg ?? '') ?? getP(E.settingsPid ?? '') ?? E.P[0];
  pidLarg = p.id;
  const N = p.rowsPlanilha.reduce((m, r) => Math.max(m, r.widths.length), 0);
  const padrao = larguraPadrao(p.rowsPlanilha);
  const alt = contarAlteradas(p.rowsPlanilha, p.rows);
  const kmIni = p.kmNum[0], kmFim = p.kmNum[p.kmNum.length - 1] + 0.02;
  kmPrevia ??= E.sel && E.sel.pid === p.id ? p.kmNum[E.sel.row] : p.kmNum[Math.floor(p.kmNum.length / 2)];
  const ajustes = p.ajustes;
  body.innerHTML = `
    <div><h2 class="h2">Largura das faixas</h2>
      <p class="lead">A planilha é o valor padrão. Por cima dela você edita por planilha e faixa, ou por faixa de km (por exemplo, Fx 1 com 3,50 m do km 120 ao 135). A geometria no mapa e as áreas calculadas aqui recalculam.</p></div>
    <div class="cfg-warn"><b>As quantidades da planilha original não mudam.</b><span class="note">Aba Quantidades e Orçamento seguem os valores do arquivo. Só o que o app calcula (mapa, áreas do Resumo e das propostas) usa as larguras ajustadas.</span></div>
    <div class="cfg-card">
      <div class="cfg-row">
        <label>Planilha<select class="in" id="lgProj">${E.P.map((q) => `<option value="${q.id}">${esc(projName(q))}</option>`).join('')}</select></label>
        <label>Coordenada está na<select class="in" id="lgOrg"><option value="edge">Borda da Fx 1 (0 m)</option><option value="axis">Eixo da Fx 1</option></select></label>
      </div>
      <div class="chips">${padrao.map((q) => `<span class="chip">${nomeFaixa(q.lane)} · ${numStr(q.largura)} m na planilha</span>`).join('')}</div>
      <p class="note num">Faixas de ${fmt(kmIni, 0)} a ${fmt(kmFim, 0)} km. ${alt ? `${alt.toLocaleString('pt-BR')} segmentos de 20 m com largura diferente da planilha.` : 'Nenhum ajuste ativo.'}</p>
    </div>
    <div><div class="sect">Ajustes desta planilha <span>${ajustes.length}</span></div>
      ${ajustes.length ? `<table class="ctable"><thead><tr><th>Faixa</th><th>Alcance</th><th>Largura</th><th></th></tr></thead><tbody>${ajustes.map((a) => `<tr><td>${nomeFaixa(a.lane)}</td><td class="num">${a.km0 === null ? 'Planilha toda' : `km ${kmLabel(a.km0)} a ${kmLabel(a.km1!)}`}</td><td class="num">${numStr(a.largura)} m</td><td><button class="btn d" data-del="${a.id}" style="min-height:30px;padding:3px 10px">Remover</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="note">Sem ajustes. As larguras são as da planilha.</p>'}</div>
    <div class="cfg-card"><div class="sect" style="margin:0">Novo ajuste</div>
      <div class="cfg-row">
        <label>Faixa<select class="in" id="lgLane">${Array.from({ length: N }, (_, k) => `<option value="${k + 1}">Fx ${k + 1}</option>`).join('')}<option value="0">Acostamento</option></select></label>
        <label>Km inicial<input class="in" type="text" id="lgK0" placeholder="Planilha toda" inputmode="decimal" style="width:120px"></label>
        <label>Km final<input class="in" type="text" id="lgK1" placeholder="(vazio)" inputmode="decimal" style="width:120px"></label>
        <label>Largura (m)<input class="in" type="number" id="lgW" step="0.05" min="0" max="12" value="3.5" style="width:100px"></label>
        <button class="btn p" id="lgAdd">Adicionar</button>
      </div>
      <p class="cfg-err" id="lgErr" role="alert"></p>
      <p class="note">Km no formato 120+000 ou 120,5. Deixe os dois km vazios para valer na planilha toda. O intervalo vai do km inicial até o final, sem incluir o final. Faixa de ${fmt(LARGURA_FAIXA.min, 1)} a ${fmt(LARGURA_FAIXA.max, 0)} m, acostamento de ${fmt(LARGURA_ACOSTAMENTO.min, 0)} a ${fmt(LARGURA_ACOSTAMENTO.max, 0)} m. Se dois intervalos se sobrepõem, vale o adicionado por último.</p>
    </div>
    <div class="cfg-card"><div class="sect" style="margin:0">Pré-visualização da seção</div>
      <div class="cfg-row"><label>Km<input class="in" type="text" id="lgPv" value="${kmLabel(kmPrevia)}" style="width:120px"></label></div>
      <div id="lgSvg">${previaSecao(p, kmPrevia)}</div></div>`;

  $<HTMLSelectElement>('#lgProj').value = p.id;
  $<HTMLSelectElement>('#lgOrg').value = p.opts.origin;
  $('#lgProj').onchange = (e) => { pidLarg = (e.target as HTMLSelectElement).value; kmPrevia = null; renderLarguras(body); };
  $('#lgOrg').onchange = (e) => { p.opts.origin = (e.target as HTMLSelectElement).value as 'edge' | 'axis'; void regeometrar(p).then(() => renderLarguras(body)); };
  $('#lgPv').onchange = (e) => {
    const k = parseKmTexto((e.target as HTMLInputElement).value);
    if (k === null) { toast('Use o formato 59+740 ou 59,74'); return; }
    kmPrevia = k;
    $('#lgSvg').innerHTML = previaSecao(p, k);
  };
  body.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => (b.onclick = async () => {
    await aplicarAjustes(p, p.ajustes.filter((a) => a.id !== b.dataset.del));
    renderLarguras(body);
  }));
  $('#lgAdd').onclick = async () => {
    const err = $('#lgErr'), t0 = $<HTMLInputElement>('#lgK0').value.trim(), t1 = $<HTMLInputElement>('#lgK1').value.trim();
    const km0 = t0 ? parseKmTexto(t0) : null, km1 = t1 ? parseKmTexto(t1) : null;
    if ((t0 && km0 === null) || (t1 && km1 === null)) { err.textContent = 'Km inválido. Use 120+000 ou 120,5.'; return; }
    const novo: AjusteLargura = { id: 'a' + Date.now().toString(36), pname: p.meta.name, lane: +$<HTMLSelectElement>('#lgLane').value, km0, km1, largura: parseFloat($<HTMLInputElement>('#lgW').value.replace(',', '.')) };
    let msg = validarAjuste(novo, N);
    if (!msg && novo.km0 !== null && (novo.km1! <= kmIni || novo.km0 >= kmFim)) msg = `Esse intervalo está fora da planilha (km ${kmLabel(kmIni)} a ${kmLabel(kmFim)}).`;
    err.textContent = msg ?? '';
    if (msg) return;
    await aplicarAjustes(p, [...p.ajustes, novo]);
    renderLarguras(body);
  };
}

/* ---------------------------------------------------------------- */
/* Limiares                                                          */
/* ---------------------------------------------------------------- */
function renderLimiares(body: HTMLElement) {
  const atual = getLimites();
  const Q = E.field ? Q5F : Q5;
  body.innerHTML = `
    <div><h2 class="h2">Limiares de classe</h2>
      <p class="lead">Definem as cinco classes (da melhor, verde, à pior, vermelha) de cada indicador, no mapa, na legenda, no unifilar e na Análise. Os valores iniciais são provisórios: ajuste ao critério do projeto.</p></div>
    <div class="cfg-grid">${IND_KEYS.map((k) => {
      const I = IND[k], desc = k === 'rc';
      return `<div class="cfg-card" data-k="${k}"><div class="sect" style="margin:0">${I.label} <span style="text-transform:none;font-weight:500">${I.unit}</span></div>
        <p class="note">${desc ? 'Quatro limites, do maior para o menor. Classe 1: Rc ≥ primeiro limite.' : 'Quatro limites crescentes. Classe 1: valor ≤ primeiro limite.'}</p>
        <div class="lims">${atual[k].map((v, i) => `<div><span class="cl"><i style="background:${Q[i]}"></i>Classe ${i + 1}</span><input class="in" type="number" step="any" inputmode="decimal" data-i="${i}" value="${+(v * I.scale).toFixed(4)}" aria-label="Limite da classe ${i + 1} de ${I.label}"></div>`).join('')}<div><span class="cl"><i style="background:${Q[4]}"></i>Classe 5</span><output class="in" data-auto aria-label="Classe 5 de ${I.label}: ${desc ? 'abaixo' : 'acima'} do limite 4">${desc ? '<' : '>'} ${+(atual[k][3] * I.scale).toFixed(4)}</output></div></div>
        <div class="leg5" data-leg>${rotulosPara(k, atual[k]).map((l, i) => `<span><i style="background:${Q[i]}"></i>${esc(l)}</span>`).join('')}</div>
        <p class="cfg-err" data-err role="alert"></p></div>`;
    }).join('')}</div>
    <div class="cfg-row"><button class="btn p" id="limAp">Aplicar limiares</button><button class="btn" id="limRest">Restaurar padrão</button><span class="note" id="limNota"></span></div>
    <p class="note">Aplicar reclassifica todas as planilhas abertas. Os limiares ficam salvos neste aparelho.</p>`;

  const ler = (k: IndKey): number[] => {
    const card = body.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    return [...card.querySelectorAll<HTMLInputElement>('input')].map((i) => parseFloat(i.value.replace(',', '.')) / IND[k].scale);
  };
  const previa = (k: IndKey) => {
    const card = body.querySelector<HTMLElement>(`[data-k="${k}"]`)!, v = ler(k), msg = validarLimites(k, v);
    card.querySelector<HTMLElement>('[data-err]')!.textContent = msg ?? '';
    const auto = card.querySelector<HTMLElement>('[data-auto]');
    if (!msg && auto) auto.textContent = `${k === 'rc' ? '<' : '>'} ${+(v[3] * IND[k].scale).toFixed(4)}`;
    if (!msg) card.querySelector<HTMLElement>('[data-leg]')!.innerHTML = rotulosPara(k, v).map((l, i) => `<span><i style="background:${Q[i]}"></i>${esc(l)}</span>`).join('');
    return msg;
  };
  body.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('input', () => previa(i.closest<HTMLElement>('[data-k]')!.dataset.k as IndKey)));
  $('#limAp').onclick = async () => {
    const novos: Partial<Limites> = {};
    let erro = false;
    for (const k of IND_KEYS) { if (previa(k)) erro = true; else novos[k] = ler(k); }
    if (erro) { toast('Corrija os limiares destacados'); return; }
    setLimites(novos);
    salvarLimiares();
    await reclassificarTodos();
    renderLimiares(body);
  };
  $('#limRest').onclick = async () => {
    restaurarLimites();
    salvarLimiares();
    await reclassificarTodos();
    renderLimiares(body);
  };
}

/* ---------------------------------------------------------------- */
/* Dados                                                             */
/* ---------------------------------------------------------------- */
async function renderDados(body: HTMLElement) {
  const salvos = await db.todos<{ id: string; parsed: { rows: unknown[] }; t: string }>('projetos');
  body.innerHTML = `
    <div><h2 class="h2">Dados neste aparelho</h2>
      <p class="lead">As planilhas abertas ficam guardadas aqui para reabrir sem o arquivo e sem internet. Notas e propostas também. Nada disso sai do aparelho.</p></div>
    <div><div class="sect">Planilhas guardadas <span>${salvos.length}</span></div>
      ${salvos.length ? `<table class="ctable"><thead><tr><th>Planilha</th><th>Segmentos</th><th>Guardada em</th><th></th></tr></thead><tbody>${salvos.map((s) => `<tr><td>${esc(s.id)}</td><td class="num">${s.parsed.rows.length.toLocaleString('pt-BR')}</td><td class="num">${new Date(s.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td><button class="btn d" data-esq="${esc(s.id)}" style="min-height:30px;padding:3px 10px">Esquecer</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="note">Nenhuma planilha guardada.</p>'}</div>
    <div class="cfg-row"><button class="btn d" id="dLimpa">Apagar configurações salvas</button><span class="note">Catálogo, limiares e larguras ajustadas voltam ao padrão. Planilhas, notas e propostas não são apagadas.</span></div>`;
  body.querySelectorAll<HTMLElement>('[data-esq]').forEach((b) => (b.onclick = () => { esquecerProjeto(b.dataset.esq!); setTimeout(() => render(), 80); toast('Planilha esquecida. Ela continua aberta até recarregar'); }));
  const lp = $('#dLimpa');
  lp.onclick = async () => {
    if (lp.dataset.c !== '1') {
      lp.dataset.c = '1'; lp.textContent = 'Confirmar';
      setTimeout(() => { if (lp.isConnected) { lp.dataset.c = ''; lp.textContent = 'Apagar configurações salvas'; } }, 3500);
      return;
    }
    db.limparStore('config');
    catalogo.restaurarPadrao(true);
    restaurarLimites();
    E.ajustesSalvos = {};
    for (const p of E.P) if (p.ajustes.length) { p.ajustes = []; p.rows = p.rowsPlanilha; }
    atualizarAviso();
    await reclassificarTodos();
    toast('Configurações apagadas');
    render();
  };
}

/* ---------------------------------------------------------------- */
export function initConfig() {
  $('#btnCfg').addEventListener('click', () => abrirConfig());
  $('#cfgClose').addEventListener('click', fecharConfig);
  document.querySelectorAll<HTMLElement>('#cfgTabs button').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.ct as Aba; render(); }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && configAberta()) { e.stopPropagation(); fecharConfig(); } }, true);
  $<HTMLInputElement>('#catIn').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const n = catalogo.importar(JSON.parse(String(fr.result)));
        aplicarCatalogo();
        if (configAberta() && aba === 'sol') render();
        toast(`${n} item(ns) importado(s)`);
      } catch (err) { toast((err as Error).message || 'Arquivo inválido'); }
    };
    fr.readAsText(f);
  });
  H.onCatalogo = () => { atualizarAviso(); if (configAberta() && aba === 'sol') render(); };
  atualizarAviso();
}
