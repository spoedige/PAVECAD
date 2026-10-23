import { BUFFERS_M, LIMITES_MB, ZOOM_MAX_CAMPO, ZOOM_MIN_CAMPO, formatarBytes } from '../dominio/tiles';
import { origemDoGps, idade } from '../dominio/posicao';
import { E } from './estado';
import { gps, iniciarPosicaoManual } from './gps';
import { fecharConfig } from './config';
import * as db from './persist';
import {
  definirLimiteMb, estatisticasCache, estimarPreparo, limiteMb, limparCache, podarCache, preparar, provedorAtual, ultimoPreparo, type Progresso,
} from './tilesCache';
import { $, esc, toast } from './ui';

/** Aba "Campo e offline" de Ajustes. A página nunca fica em branco: o conteúdo aparece na hora e cada trecho que depende do
 *  armazenamento do navegador (IndexedDB, Cache API) é preenchido depois, com tempo limite e, se falhar, o texto "ainda não disponível". */

let buffer: number = BUFFERS_M[0];
let cancelar: AbortController | null = null;

const chip = (attr: string, v: string | number, rotulo: string, on: boolean) =>
  `<button type="button" class="xchip" data-${attr}="${v}" aria-pressed="${on}">${esc(rotulo)}</button>`;

/** Resolve com o valor ou com `null` se falhar ou passar do tempo (o armazenamento de alguns navegadores trava em aba privada). */
async function comTempo<T>(p: () => Promise<T>, ms = 3000): Promise<T | null> {
  try {
    return await Promise.race([p(), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  } catch { return null; }
}

const NAO_DISPONIVEL = 'ainda não disponível neste aparelho';

function textoUltimo(): string {
  const u = ultimoPreparo();
  if (!u) return 'Nenhuma preparação feita neste aparelho.';
  const q = new Date(u.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `Última preparação (${q}): ${u.nome}, corredor de ${u.buffer >= 1000 ? u.buffer / 1000 + ' km' : u.buffer + ' m'}, ${u.tiles.toLocaleString('pt-BR')} tiles (${u.novos.toLocaleString('pt-BR')} novos, ${u.jaTinha.toLocaleString('pt-BR')} que já estavam${u.falhas ? `, ${u.falhas} falharam` : ''}), ${formatarBytes(u.bytes)} baixados${u.completo ? '' : '. Cancelada antes de terminar'}.`;
}

const fotosDasNotas = () => {
  let n = 0, bytes = 0;
  for (const nota of E.notes) for (const f of nota.photos ?? []) { n++; bytes += Math.round((f.length * 3) / 4); }
  return { n, bytes };
};

function textoPosicao(): string {
  const agora = Date.now(), m = gps.estado.manual;
  if (m) return `Posição manual (${idade(m.t, agora)}). Um GPS por satélite substitui esta posição quando chegar.`;
  if (!gps.last) return gps.on ? 'Buscando a posição. Se não houver GPS por satélite, defina a posição por km.' : 'GPS desligado. Toque no botão de posição do mapa para ligar, ou defina a posição por km.';
  const rede = origemDoGps(gps.last.acc) === 'rede';
  return `${rede ? 'Só localização por rede (sem GPS por satélite)' : 'GPS por satélite'}, precisão de ±${Math.round(gps.last.acc)} m, ${idade(gps.ultima, agora)}.`;
}

export async function renderCampo(body: HTMLElement) {
  const prov = provedorAtual();
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  body.innerHTML = `
    <div><h2 class="h2">Campo e offline</h2>
      <p class="lead">O app abre e funciona sem internet. Aqui você vê o que está salvo neste aparelho e prepara o mapa antes de ir a campo.</p></div>
    <section class="xcard" id="cpArmaz"><div class="xc-h"><h3>Estado</h3><span class="num" id="cpConexao">${off ? 'Offline' : 'Online'}</span></div>
      <ul class="cp-lista num">
        <li id="cpPlan">Planilhas: <b>carregando</b></li>
        <li id="cpNotas">Notas: <b>${E.notes.length}</b></li>
        <li id="cpProps">Propostas: <b>${E.props.length}</b></li>
        <li id="cpFotos">Fotos: <b>${fotosDasNotas().n}</b> (${formatarBytes(fotosDasNotas().bytes)})</li>
        <li id="cpTiles">Tiles de mapa: <b>carregando</b></li>
      </ul>
      <p class="note" id="cpUso"></p></section>
    <section class="xcard" id="cpPrepara"><div class="xc-h"><h3>Preparar para campo</h3></div>
      <p class="note">Baixa o fundo do mapa ao longo das planilhas visíveis, nos zooms ${ZOOM_MIN_CAMPO} a ${ZOOM_MAX_CAMPO}, para usar sem internet. Use com Wi-Fi.</p>
      <p class="note" id="cpProv">${prov ? `Provedor: <b>${esc(prov.nome)}</b>. Para outro provedor, troque o fundo do mapa.` : 'Escolha Ruas ou Satélite no mapa: o fundo Liso não tem tiles.'}</p>
      <div class="xg"><span class="xg-l">Largura do corredor</span><div class="xchips" id="cpBuf">${BUFFERS_M.map((b) => chip('buf', b, b >= 1000 ? `${b / 1000} km` : `${b} m`, buffer === b)).join('')}</div></div>
      <p class="note" id="cpEst" aria-live="polite"></p>
      <div class="btns"><button class="btn p" id="cpPrep">Preparar para campo</button><button class="btn" id="cpCancela" hidden>Cancelar</button></div>
      <div class="cp-barra" id="cpBarra" hidden><div id="cpBarraI"></div></div>
      <p class="note" id="cpStatus" aria-live="polite"></p>
      <p class="note" id="cpUltimo">${esc(textoUltimo())}</p></section>
    <section class="xcard" id="cpCache"><div class="xc-h"><h3>Cache de mapa</h3></div>
      <p class="note" id="cpEspaco">Espaço usado: <b>carregando</b>.</p>
      <p class="note">Os tiles que você já viu ficam guardados. Quando passa do limite, os mais antigos saem primeiro.</p>
      <div class="xg"><span class="xg-l">Limite</span><div class="xchips" id="cpLimite">${LIMITES_MB.map((mb) => chip('mb', mb, `${mb} MB`, limiteMb() === mb)).join('')}</div></div>
      <div class="btns"><button class="btn" id="cpLimpar">Limpar tiles</button></div></section>
    <section class="xcard" id="cpPosicao"><div class="xc-h"><h3>Posição</h3></div>
      <p class="note" id="cpPosTxt">${esc(textoPosicao())}</p>
      <div class="btns"><button class="btn" id="cpManual">Definir posição por km</button></div></section>
    <section class="xcard" id="cpAjuda"><div class="xc-h"><h3>Dicas</h3></div>
      <p class="note">Antes de sair, use Preparar para campo com Wi-Fi. Sem internet, o fundo volta ao Liso e o app continua mostrando km, distância ao eixo e faixa.</p>
      <p class="note">Este aparelho pode não ter GPS por satélite e localizar só pela rede. Quando isso acontece, o app avisa e permite definir a posição por km.</p>
      <p class="note">Para usar o GPS do celular ou de um receptor Bluetooth neste aparelho, ative a localização simulada.</p></section>`;

  // o que depende do armazenamento do navegador entra depois, sem travar a página
  void (async () => {
    const [planilhas, tiles, est, persistente] = await Promise.all([
      comTempo(() => db.todos<unknown>('projetos')), comTempo(() => estatisticasCache()),
      comTempo(async () => navigator.storage?.estimate?.() ?? null), comTempo(async () => navigator.storage?.persisted?.() ?? null),
    ]);
    if (!$('#cpPlan').isConnected) return;
    $('#cpPlan').innerHTML = `Planilhas: <b>${planilhas ? planilhas.length : NAO_DISPONIVEL}</b>`;
    $('#cpTiles').innerHTML = tiles ? `Tiles de mapa: <b>${tiles.entradas.toLocaleString('pt-BR')}</b>${tiles.entradas ? ` (cerca de ${formatarBytes(tiles.bytes)})` : ''}` : `Tiles de mapa: <b>${NAO_DISPONIVEL}</b>`;
    $('#cpEspaco').innerHTML = tiles ? `Espaço usado: <b>${formatarBytes(tiles.bytes)}</b> de ${limiteMb()} MB.` : `Espaço usado: <b>${NAO_DISPONIVEL}</b>.`;
    const partes: string[] = [];
    if (est?.usage !== undefined) partes.push(`Uso total deste aparelho: ${formatarBytes(est.usage)}${est.quota ? ` de ${formatarBytes(est.quota)}` : ''}.`);
    if (persistente !== null && persistente !== undefined) partes.push(persistente ? 'Armazenamento protegido contra limpeza automática.' : 'Armazenamento comum: o navegador pode limpar se faltar espaço.');
    $('#cpUso').textContent = partes.join(' ');
  })();

  const estimativa = () => {
    const el = $('#cpEst'), btn = $<HTMLButtonElement>('#cpPrep');
    let e: ReturnType<typeof estimarPreparo> = null;
    try { e = estimarPreparo(buffer); } catch { e = null; }
    if (!e) { el.textContent = prov ? NAO_DISPONIVEL : ''; btn.disabled = true; return; }
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
    const n = (await comTempo(() => podarCache())) ?? 0;
    toast(n ? `Limite de ${b.dataset.mb} MB: ${n.toLocaleString('pt-BR')} tiles antigos descartados` : `Limite de ${b.dataset.mb} MB`);
    void renderCampo(body);
  });
  $('#cpLimpar').addEventListener('click', async () => { await comTempo(() => limparCache()); toast('Tiles limpos'); void renderCampo(body); });
  $('#cpManual').addEventListener('click', () => { fecharConfig(); iniciarPosicaoManual(); });

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
