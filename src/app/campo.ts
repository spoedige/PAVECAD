import { BUFFERS_M, LIMITES_MB, ZOOM_MAX_CAMPO, ZOOM_MIN_CAMPO, formatarBytes } from '../dominio/tiles';
import { E } from './estado';
import * as db from './persist';
import {
  definirLimiteMb, estatisticasCache, estimarPreparo, limiteMb, limparCache, podarCache, preparar, provedorAtual, ultimoPreparo, type Progresso,
} from './tilesCache';
import { $, esc, toast } from './ui';

/** Aba "Campo e offline" de Ajustes: o que está salvo no aparelho, cache de mapa, "Preparar para campo" e ajuda de localização. */

let buffer: number = BUFFERS_M[0];
let cancelar: AbortController | null = null;

const chip = (attr: string, v: string | number, rotulo: string, on: boolean) =>
  `<button type="button" class="xchip" data-${attr}="${v}" aria-pressed="${on}">${esc(rotulo)}</button>`;

async function armazenamento() {
  const [planilhas, tiles] = await Promise.all([db.todos<unknown>('projetos'), estatisticasCache()]);
  let uso = '', persistente = '';
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage !== undefined) uso = `Uso total deste aparelho: ${formatarBytes(e.usage)}${e.quota ? ` de ${formatarBytes(e.quota)}` : ''}.`;
    const p = await navigator.storage?.persisted?.();
    if (p !== undefined) persistente = p ? 'Armazenamento protegido contra limpeza automática.' : 'Armazenamento comum: o navegador pode limpar se faltar espaço.';
  } catch { /* sem a API */ }
  return { planilhas: planilhas.length, tiles, uso, persistente };
}

function textoUltimo(): string {
  const u = ultimoPreparo();
  if (!u) return 'Nenhuma preparação feita neste aparelho.';
  const q = new Date(u.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `Última preparação (${q}): ${u.nome}, corredor de ${u.buffer >= 1000 ? u.buffer / 1000 + ' km' : u.buffer + ' m'}, ${u.tiles.toLocaleString('pt-BR')} tiles (${u.novos.toLocaleString('pt-BR')} novos, ${u.jaTinha.toLocaleString('pt-BR')} que já estavam${u.falhas ? `, ${u.falhas} falharam` : ''}), ${formatarBytes(u.bytes)} baixados${u.completo ? '' : '. Cancelada antes de terminar'}.`;
}

export async function renderCampo(body: HTMLElement) {
  const a = await armazenamento();
  const prov = provedorAtual();
  body.innerHTML = `
    <div><h2 class="h2">Campo e offline</h2>
      <p class="lead">O app abre e funciona sem internet. Aqui você vê o que está salvo neste aparelho e prepara o mapa antes de ir a campo.</p></div>
    <section class="xcard" id="cpArmaz"><div class="xc-h"><h3>Salvo neste aparelho</h3></div>
      <ul class="cp-lista num">
        <li id="cpPlan">Planilhas: <b>${a.planilhas}</b></li>
        <li id="cpNotas">Notas: <b>${E.notes.length}</b></li>
        <li id="cpProps">Propostas: <b>${E.props.length}</b></li>
        <li id="cpTiles">Tiles de mapa: <b>${a.tiles.entradas.toLocaleString('pt-BR')}</b>${a.tiles.entradas ? ` (cerca de ${formatarBytes(a.tiles.bytes)})` : ''}</li>
      </ul>
      <p class="note">${esc(a.uso)} ${esc(a.persistente)}</p></section>
    <section class="xcard" id="cpCache"><div class="xc-h"><h3>Cache de mapa</h3></div>
      <p class="note">Os tiles que você já viu ficam guardados. Quando passa do limite, os mais antigos saem primeiro.</p>
      <div class="xg"><span class="xg-l">Limite</span><div class="xchips" id="cpLimite">${LIMITES_MB.map((mb) => chip('mb', mb, `${mb} MB`, limiteMb() === mb)).join('')}</div></div>
      <div class="btns"><button class="btn" id="cpLimpar">Limpar cache de mapa</button></div></section>
    <section class="xcard" id="cpPrepara"><div class="xc-h"><h3>Preparar para campo</h3></div>
      <p class="note">Baixa o fundo do mapa ao longo das planilhas visíveis, nos zooms ${ZOOM_MIN_CAMPO} a ${ZOOM_MAX_CAMPO}, para usar sem internet. Use com Wi-Fi.</p>
      <p class="note" id="cpProv">${prov ? `Provedor: <b>${esc(prov.nome)}</b>. Para outro provedor, troque o fundo do mapa.` : 'Escolha Ruas ou Satélite no mapa: o fundo Liso não tem tiles.'}</p>
      <div class="xg"><span class="xg-l">Largura do corredor</span><div class="xchips" id="cpBuf">${BUFFERS_M.map((b) => chip('buf', b, b >= 1000 ? `${b / 1000} km` : `${b} m`, buffer === b)).join('')}</div></div>
      <p class="note" id="cpEst" aria-live="polite"></p>
      <div class="btns"><button class="btn p" id="cpPrep">Preparar para campo</button><button class="btn" id="cpCancela" hidden>Cancelar</button></div>
      <div class="cp-barra" id="cpBarra" hidden><div id="cpBarraI"></div></div>
      <p class="note" id="cpStatus" aria-live="polite"></p>
      <p class="note" id="cpUltimo">${esc(textoUltimo())}</p></section>
    <section class="xcard" id="cpAjuda"><div class="xc-h"><h3>Localização</h3></div>
      <p class="note">Este aparelho pode não ter GPS por satélite e localizar só pela rede. Quando isso acontece, o app avisa e permite definir a posição por km.</p>
      <p class="note">Para usar o GPS do celular ou de um receptor Bluetooth neste aparelho, ative a localização simulada.</p></section>`;

  const estimativa = () => {
    const el = $('#cpEst'), btn = $<HTMLButtonElement>('#cpPrep');
    const e = estimarPreparo(buffer);
    if (!e) { el.textContent = ''; btn.disabled = true; return; }
    if (!e.tiles) { el.textContent = 'Nenhuma planilha visível para preparar.'; btn.disabled = true; return; }
    el.textContent = e.excede
      ? `${e.tiles.toLocaleString('pt-BR')} tiles: passa do limite de ${e.max.toLocaleString('pt-BR')} para ${e.prov.nome}. Use um corredor menor ou deixe só as planilhas necessárias visíveis.`
      : `${e.tiles.toLocaleString('pt-BR')} tiles, cerca de ${formatarBytes(e.bytes)}.`;
    btn.disabled = e.excede;
  };
  setTimeout(() => { if ($('#cpEst').isConnected) estimativa(); }, 0);

  $('#cpBuf').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-buf]');
    if (!b || cancelar) return;
    buffer = Number(b.dataset.buf);
    $('#cpBuf').querySelectorAll<HTMLElement>('[data-buf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    estimativa();
  });
  $('#cpLimite').addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-mb]');
    if (!b) return;
    definirLimiteMb(Number(b.dataset.mb));
    $('#cpLimite').querySelectorAll<HTMLElement>('[data-mb]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const n = await podarCache();
    toast(n ? `Limite de ${b.dataset.mb} MB: ${n.toLocaleString('pt-BR')} tiles antigos descartados` : `Limite de ${b.dataset.mb} MB`);
    void renderCampo(body);
  });
  $('#cpLimpar').addEventListener('click', async () => { await limparCache(); toast('Cache de mapa limpo'); void renderCampo(body); });

  const preparando = (on: boolean) => {
    $<HTMLButtonElement>('#cpPrep').hidden = on;
    $('#cpCancela').hidden = !on;
    $('#cpBarra').hidden = !on;
  };
  $('#cpCancela').addEventListener('click', () => cancelar?.abort());
  $('#cpPrep').addEventListener('click', async () => {
    if (cancelar) return;
    if (navigator.onLine === false) { toast('Sem internet. Prepare o mapa quando houver conexão'); return; }
    const e = estimarPreparo(buffer);
    if (!e || e.excede || !e.tiles) return;
    cancelar = new AbortController();
    preparando(true);
    const mostrar = (p: Progresso) => {
      const barra = document.getElementById('cpBarraI'), st = document.getElementById('cpStatus');
      if (barra) barra.style.width = `${Math.round((p.feitos / Math.max(1, p.total)) * 100)}%`;
      if (st) st.textContent = `${p.feitos.toLocaleString('pt-BR')} de ${p.total.toLocaleString('pt-BR')} tiles · ${formatarBytes(p.bytes)}${p.falhas ? ` · ${p.falhas} falharam` : ''}`;
    };
    mostrar({ feitos: 0, total: e.tiles, bytes: 0, falhas: 0, jaTinha: 0 });
    const r = await preparar(buffer, mostrar, cancelar.signal);
    const foiCancelada = cancelar.signal.aborted;
    cancelar = null;
    toast(foiCancelada ? 'Preparação cancelada' : r ? `Mapa preparado: ${r.tiles.toLocaleString('pt-BR')} tiles` : 'Não foi possível preparar o mapa', 4000);
    if ($('#cpPrepara').isConnected) void renderCampo(body);
  });
  preparando(cancelar !== null);
}
