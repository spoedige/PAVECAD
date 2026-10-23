import { $, esc, toast } from './ui';

/** Diagnóstico sem terminal: últimos erros de JavaScript guardados no aparelho, versão do app, "Atualizar app" e o modo diagnóstico de toque.
 *  Nada sai do aparelho: o relatório só é copiado quando a pessoa pede. */

const CHAVE_ERROS = 'pavecad-erros';
const CHAVE_TOQUE = 'pavecad-diag-toque';
const MAX_ERROS = 20;

export interface ErroGuardado { t: string; msg: string; onde: string; pilha: string }

export const versaoApp = () => ({ commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev', data: typeof __APP_DATA__ === 'string' ? __APP_DATA__ : '' });

export function errosGuardados(): ErroGuardado[] {
  try { const j = JSON.parse(localStorage.getItem(CHAVE_ERROS) ?? '[]'); return Array.isArray(j) ? j : []; } catch { return []; }
}
function gravarErros(l: ErroGuardado[]) { try { localStorage.setItem(CHAVE_ERROS, JSON.stringify(l.slice(-MAX_ERROS))); } catch { /* sem storage */ } }

export function registrarErro(msg: unknown, onde = '', pilha = '') {
  const e: ErroGuardado = {
    t: new Date().toISOString(), msg: String(msg instanceof Error ? msg.message : msg).slice(0, 300), onde: String(onde).slice(0, 120),
    pilha: String(pilha).split('\n').slice(0, 4).join('\n').slice(0, 400),
  };
  gravarErros([...errosGuardados(), e]);
}
export const limparErros = () => { try { localStorage.removeItem(CHAVE_ERROS); } catch { /* sem storage */ } };

/** Texto do relatório para colar numa conversa: versão, aparelho, estado e os últimos erros. */
export function textoRelatorio(): string {
  const v = versaoApp(), erros = errosGuardados();
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller ? 'ativo' : 'inativo';
  const linhas = [
    `PAVECAD versão ${v.commit} (${v.data || 'sem data'})`,
    `Aparelho: ${navigator.userAgent}`,
    `Tela: ${innerWidth}x${innerHeight} (DPR ${devicePixelRatio}), toque: ${navigator.maxTouchPoints}, online: ${navigator.onLine}, service worker: ${sw}`,
    `Classes: ${document.documentElement.className}`,
    `Erros guardados: ${erros.length}`,
    ...erros.map((e, i) => `${i + 1}. ${e.t} ${e.msg}${e.onde ? ` (${e.onde})` : ''}${e.pilha ? `\n   ${e.pilha.replace(/\n/g, '\n   ')}` : ''}`),
  ];
  return linhas.join('\n');
}

async function copiarTexto(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* cai para o método antigo */ }
  try {
    const a = document.createElement('textarea');
    a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
    document.body.appendChild(a); a.select();
    const ok = document.execCommand('copy');
    a.remove();
    return ok;
  } catch { return false; }
}

/** Limpa só o cache do app (service worker e arquivos), sem tocar em notas, propostas, fotos, planilhas ou tiles; depois recarrega. */
export async function atualizarApp() {
  try {
    if ('caches' in window) for (const n of await caches.keys()) if (n !== 'mapa-tiles') await caches.delete(n);
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* segue para o recarregamento */ }
  location.reload();
}

/* ---- modo diagnóstico de toque ---- */

export const diagToqueLigado = () => { try { return localStorage.getItem(CHAVE_TOQUE) === '1'; } catch { return false; } };
let caixa: HTMLElement | null = null;
const EVENTOS = ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend', 'touchcancel', 'click', 'contextmenu'] as const;

const descrever = (e: Element | null) => {
  if (!e) return 'nada';
  const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c ? '.' + c : ''}`;
};

function aoEvento(ev: Event) {
  if (!caixa) return;
  const p = ev as PointerEvent & { touches?: TouchList; changedTouches?: TouchList };
  const t = p.changedTouches?.[0] ?? p.touches?.[0];
  const x = Math.round(t ? t.clientX : p.clientX ?? 0), y = Math.round(t ? t.clientY : p.clientY ?? 0);
  const no = (ev.target as Element) ?? null, sob = document.elementFromPoint(x, y);
  caixa.textContent = `${ev.type}${p.pointerType ? ' (' + p.pointerType + ')' : ''} em ${x},${y}\nrecebeu: ${descrever(no)}\nsob o ponto: ${descrever(sob)}`;
}

export function ligarDiagToque(on: boolean) {
  try { localStorage.setItem(CHAVE_TOQUE, on ? '1' : '0'); } catch { /* sem storage */ }
  for (const e of EVENTOS) window.removeEventListener(e, aoEvento, true);
  caixa?.remove(); caixa = null;
  if (!on) return;
  caixa = document.createElement('pre');
  caixa.id = 'diagToque';
  caixa.setAttribute('aria-hidden', 'true');
  caixa.textContent = 'Diagnóstico de toque ligado. Toque na tela.';
  document.body.appendChild(caixa);
  for (const e of EVENTOS) window.addEventListener(e, aoEvento, { capture: true, passive: true });
}

/** Liga os registradores de erro e, se estava ligado, o diagnóstico de toque. Chamar o mais cedo possível. */
export function iniciarDiagnostico() {
  window.addEventListener('error', (e) => registrarErro(e.message || 'erro', e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : '', e.error?.stack ?? ''));
  window.addEventListener('unhandledrejection', (e) => registrarErro((e.reason && (e.reason.message ?? e.reason)) || 'promessa rejeitada', 'promessa', e.reason?.stack ?? ''));
  if (diagToqueLigado()) ligarDiagToque(true);
}

/* ---- seção em Ajustes ---- */

export function renderDiagnostico(box: HTMLElement) {
  const v = versaoApp(), erros = errosGuardados();
  const quando = v.data ? new Date(v.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem data';
  box.innerHTML = `<div class="sect">Diagnóstico</div><div class="list">
    <div class="field"><div><div>Versão do app</div><div class="note num" id="dgVersao">${esc(v.commit)} · ${esc(quando)}</div></div><button class="btn" id="dgAtualiza">Atualizar app</button></div>
    <div class="field"><div><div>Relatório de erros</div><div class="note" id="dgQtd">${erros.length ? `${erros.length} erro${erros.length > 1 ? 's' : ''} guardado${erros.length > 1 ? 's' : ''} neste aparelho` : 'Nenhum erro guardado'}. Nada é enviado a servidor.</div></div>
      <span class="dg-btns"><button class="btn" id="dgCopia">Copiar relatório</button><button class="btn" id="dgLimpa" ${erros.length ? '' : 'disabled'}>Limpar</button></span></div>
    <div class="field"><div><div>Modo diagnóstico de toque</div><div class="note">Mostra na tela o último toque recebido e o elemento que o recebeu. Use quando algo parar de responder e tire uma captura</div></div><button class="sw2" id="dgToque" role="switch" aria-checked="${diagToqueLigado()}" aria-label="Modo diagnóstico de toque"></button></div>
  </div>
  ${erros.length ? `<details><summary>Últimos erros</summary><div class="formula" id="dgLista">${erros.slice().reverse().map((e) => esc(`${e.t.slice(11, 19)} ${e.msg}${e.onde ? ' (' + e.onde + ')' : ''}`)).join('\n')}</div></details>` : ''}`;
  $('#dgAtualiza').onclick = () => { toast('Atualizando o app'); void atualizarApp(); };
  $('#dgCopia').onclick = async () => toast((await copiarTexto(textoRelatorio())) ? 'Relatório copiado' : 'Não foi possível copiar');
  $('#dgLimpa').onclick = () => { limparErros(); renderDiagnostico(box); };
  $('#dgToque').onclick = () => {
    const on = $('#dgToque').getAttribute('aria-checked') !== 'true';
    $('#dgToque').setAttribute('aria-checked', String(on));
    ligarDiagToque(on);
  };
}
