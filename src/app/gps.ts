import { localizar, type Local, type LocP } from '../dominio/localizar';
import { M_LAT } from '../dominio/medidas';
import {
  PASSO_MANUAL_M, idade, manualDoPonto, moverManual, origemDoGps, pontoNoKm, receberGps, referenciar, textoReferencia,
  type EstadoPos, type Manual, type Referencia,
} from '../dominio/posicao';
import { parseKmTexto } from '../formats/km';
import { E, H, kmFmt, kmReal, visibleProjects } from './estado';
import { getMap, select, setData } from './mapa';
import { $, esc, toast } from './ui';

interface Fix { lat: number; lon: number; acc: number }
export type FalhaGps = 'tempo' | 'indisponivel' | 'negada' | null;

export const gps = {
  on: false, follow: true, id: null as number | null, last: null as Fix | null,
  lock: null as WakeLockSentinel | null, loc: null as Local | null, autoSel: false, ultima: 0,
  /** Posição por satélite/rede e posição manual (a manual vale enquanto um GPS de satélite não chegar). */
  estado: { gps: null, manual: null } as EstadoPos,
  /** Última falha de leitura. A última posição fica no mapa, em cinza. */
  falha: null as FalhaGps,
  /** Esperando o toque no mapa (ou o km digitado) para definir a posição manual. */
  definindo: false,
  /** Referencial da posição que vale agora (km, distância ao eixo, faixa). */
  ref: null as Referencia | null,
  primeira: true,
};

/** Quanto tempo sem posição nova até o ponto ficar cinza. */
const VELHA_MS = 15000;
/** Espera até a nova tentativa depois de uma falha. */
const RETENTA_MS = 4000;
/** Primeira busca (frio) demora; as seguintes cobrem só um intervalo sem sinal. */
const TIMEOUT_PRIMEIRA_MS = 120000;
const TIMEOUT_DEPOIS_MS = 60000;

let relogio: number | null = null;
let retenta: number | null = null;
let cinzaAnterior = false;

/** Círculo de precisão em torno da posição, em [lon, lat]. */
export function circle(lng: number, lat: number, rm: number): number[][] {
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180), pts: number[][] = [];
  for (let a = 0; a <= 48; a++) {
    const t = (a / 48) * 2 * Math.PI;
    pts.push([lng + (Math.cos(t) * rm) / mLon, lat + (Math.sin(t) * rm) / M_LAT]);
  }
  return pts;
}

const projetos = () => visibleProjects() as unknown as LocP[];

/** Posição que vale agora: a manual (no eixo) ou a última do GPS. */
function posicaoAtual(): { lat: number; lon: number; acc: number | null; manual: boolean } | null {
  const m = gps.estado.manual;
  if (m) {
    const p = projetos().find((x) => x.id === m.pid);
    const pt = p ? pontoNoKm(p, m.km) : null;
    if (pt) return { lat: pt.lat, lon: pt.lon, acc: null, manual: true };
  }
  return gps.last ? { lat: gps.last.lat, lon: gps.last.lon, acc: gps.last.acc, manual: false } : null;
}

const velha = () => gps.falha !== null || Date.now() - gps.ultima > VELHA_MS;

function desenharMapa() {
  if (!E.mapReady) return;
  const pos = posicaoAtual();
  if (!pos) { setData('gps', { type: 'FeatureCollection', features: [] }); return; }
  const tipo = pos.manual ? 'manual' : velha() ? 'cinza' : 'gps';
  cinzaAnterior = velha();
  const feicoes: GeoJSON.Feature[] = [{ type: 'Feature', properties: { tipo }, geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] } }];
  if (pos.acc !== null) feicoes.push({ type: 'Feature', properties: { tipo }, geometry: { type: 'Polygon', coordinates: [circle(pos.lon, pos.lat, Math.max(pos.acc || 5, 3))] } });
  setData('gps', { type: 'FeatureCollection', features: feicoes });
}

function calcularReferencia() {
  const pos = posicaoAtual();
  gps.ref = pos ? referenciar(projetos(), pos.lat, pos.lon) : null;
  gps.loc = pos ? localizar(E.P as LocP[], pos.lat, pos.lon) : null;
}

/** Linha única do chip: de onde vem a posição, a precisão e a idade. */
function linhaOrigem(agora: number): string {
  const m = gps.estado.manual;
  if (m) return `<b>Posição manual</b> · ${idade(m.t, agora)}`;
  if (!gps.last) return gps.falha === 'negada' ? '<b>GPS</b> · localização bloqueada' : gps.falha ? '<b>GPS</b> · sem posição ainda, tentando de novo' : '<b>GPS</b> · buscando a posição';
  const acc = Math.round(gps.last.acc || 0);
  const origem = origemDoGps(gps.last.acc) === 'rede' ? 'rede' : 'satélite';
  return `<b>GPS</b> · ±${acc} m · ${origem} · ${idade(gps.ultima, agora)}${gps.falha ? ' · sem sinal, tentando de novo' : ''}`;
}

/** O navegador não entregou posição por satélite: só rede (ou nada). */
const semSatelite = () => !gps.estado.manual && (!gps.last || origemDoGps(gps.last.acc) === 'rede' || gps.falha !== null);

/** Redesenha o chip. Barato: o referencial vem do cálculo guardado, só as idades mudam a cada segundo. */
export function desenharChip() {
  const chip = document.getElementById('gpschip');
  if (!chip) return;
  const ativo = gps.on || gps.estado.manual || gps.definindo || gps.falha === 'negada';
  chip.hidden = !ativo;
  if (!ativo) return;
  const agora = Date.now(), r = gps.ref;
  const linhas: string[] = [`<div class="gc-l"><span class="num">${linhaOrigem(agora)}</span>${gps.on ? `<button id="gFollow">${gps.follow ? 'Seguindo' : 'Seguir'}</button>` : ''}</div>`];
  if (r) linhas.push(`<div class="gc-l num" id="gRef">${esc(textoReferencia(r, (km) => kmFmt(km)))}</div>`);
  else if (gps.estado.manual || gps.last) linhas.push('<div class="gc-l num" id="gRef">Sem planilha visível</div>');
  if (semSatelite() && !gps.definindo) {
    linhas.push(`<div class="gc-l"><span class="num" id="gSemSat">Sem GPS por satélite (só localização por rede)</span><button class="p" id="gManual">Definir posição por km</button></div>`);
  }
  if (gps.definindo) {
    linhas.push(`<div class="gc-l"><span class="num">Toque no mapa para definir a posição</span></div>
      <div class="gc-l"><label class="num">ou digite o km <input id="gKm" class="in" type="text" inputmode="decimal" placeholder="Ex.: 59+740" style="width:110px"></label><button id="gKmIr">Ir</button><button id="gCancela">Cancelar</button></div>`);
  }
  if (gps.estado.manual) {
    linhas.push(`<div class="gc-l"><button id="gMenos" aria-label="Descer 20 metros">−${PASSO_MANUAL_M} m</button><button id="gMais" aria-label="Subir 20 metros">+${PASSO_MANUAL_M} m</button><button id="gAltera">Mudar</button><button id="gSai">Sair</button></div>`);
  }
  chip.innerHTML = linhas.join('');
  ligarChip(chip);
}

function ligarChip(chip: HTMLElement) {
  const get = <T extends HTMLElement>(id: string) => chip.querySelector<T>('#' + id);
  const m = getMap();
  get('gFollow')?.addEventListener('click', () => {
    gps.follow = !gps.follow;
    desenharChip();
    const pos = posicaoAtual();
    if (gps.follow && pos) m.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(m.getZoom(), 17.5) });
  });
  get('gManual')?.addEventListener('click', () => { gps.definindo = true; desenharChip(); get('gKm')?.focus(); });
  get('gAltera')?.addEventListener('click', () => { gps.definindo = true; desenharChip(); chip.querySelector<HTMLElement>('#gKm')?.focus(); });
  get('gCancela')?.addEventListener('click', () => { gps.definindo = false; desenharChip(); });
  get('gSai')?.addEventListener('click', () => { sairManual(); });
  get('gMenos')?.addEventListener('click', () => moverPosicaoManual(-PASSO_MANUAL_M));
  get('gMais')?.addEventListener('click', () => moverPosicaoManual(PASSO_MANUAL_M));
  const ir = () => {
    const v = parseKmTexto(get<HTMLInputElement>('gKm')?.value ?? '');
    if (v === null) { toast('Km inválido. Use o formato 59+740'); return; }
    const km = kmReal(v);
    const alvo = projetos().find((p) => p.segs.some((s) => km >= p.kmNum[s.a] - 1e-9 && km <= p.kmNum[s.b] + 1e-9));
    if (!alvo) { toast('Esse km não existe nas planilhas visíveis'); return; }
    definirPosicaoManual({ pid: alvo.id, km, t: Date.now() });
  };
  get('gKmIr')?.addEventListener('click', ir);
  get<HTMLInputElement>('gKm')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); e.stopPropagation(); });
}

/* ---- posição manual ---- */

export function definirPosicaoManual(m: Manual) {
  gps.estado = { ...gps.estado, manual: m };
  gps.definindo = false;
  atualizarTudo();
  const pos = posicaoAtual();
  if (pos && E.mapReady) getMap().easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(getMap().getZoom(), 17), duration: 500 });
  garantirRelogio();
}

function moverPosicaoManual(passo: number) {
  const m = gps.estado.manual;
  const p = m ? projetos().find((x) => x.id === m.pid) : undefined;
  if (!m || !p) return;
  definirPosicaoManual(moverManual(p, m, passo));
}

function sairManual() {
  gps.estado = { ...gps.estado, manual: null };
  gps.definindo = false;
  atualizarTudo();
  if (!gps.on) pararRelogio();
}

/** Toque no mapa enquanto espera a posição manual. */
H.onPosManual = (e) => {
  if (!gps.definindo) return false;
  const m = manualDoPonto(projetos(), e.lngLat.lat, e.lngLat.lng);
  if (!m) { toast('Nenhuma planilha visível para ancorar a posição'); return true; }
  definirPosicaoManual(m);
  return true;
};

function atualizarTudo() {
  calcularReferencia();
  desenharMapa();
  desenharChip();
  const sel = gps.loc;
  if (gps.autoSel && sel && sel.lane !== null && sel.out < 40) select(sel.p.id, sel.i, sel.lane);
}

/* ---- leitura do GPS ---- */

function onFix(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  gps.last = { lat, lon, acc };
  gps.ultima = Date.now();
  gps.falha = null;
  gps.primeira = false;
  const r = receberGps(gps.estado, { lat, lon, acc, t: gps.ultima });
  gps.estado = r.estado;
  if (r.substituiuManual) toast('GPS por satélite voltou: a posição manual foi substituída', 3500);
  atualizarTudo();
  const m = getMap();
  if (gps.follow && E.mapReady && !gps.estado.manual) m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 17.5), duration: 600 });
}

function onErro(err: GeolocationPositionError) {
  if (err?.code === 1) {
    gps.falha = 'negada';
    toast('Localização bloqueada. Com HTTPS o navegador pede permissão. Você pode definir a posição por km.', 5500);
    parar(false);
    gps.on = false;
    setGpsUi();
    atualizarTudo();
    return;
  }
  // tempo esgotado ou posição indisponível: a última posição fica (cinza) e a busca recomeça sozinha
  gps.falha = err?.code === 3 ? 'tempo' : 'indisponivel';
  desenharMapa();
  desenharChip();
  if (gps.id != null) { navigator.geolocation.clearWatch(gps.id); gps.id = null; }
  if (retenta) clearTimeout(retenta);
  retenta = window.setTimeout(() => { retenta = null; if (gps.on) iniciarBusca(); }, RETENTA_MS);
}

function iniciarBusca() {
  if (!navigator.geolocation) return;
  gps.id = navigator.geolocation.watchPosition(onFix, onErro, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: gps.primeira ? TIMEOUT_PRIMEIRA_MS : TIMEOUT_DEPOIS_MS,
  });
}

function parar(limparPosicao = true) {
  if (gps.id != null) navigator.geolocation.clearWatch(gps.id);
  gps.id = null;
  if (retenta) { clearTimeout(retenta); retenta = null; }
  if (limparPosicao) { gps.last = null; gps.ultima = 0; gps.falha = null; gps.estado = { gps: null, manual: null }; gps.definindo = false; gps.ref = null; gps.loc = null; }
}

/** Atualiza a idade ("há N s") a cada segundo e esmaece o ponto quando a posição envelhece. */
function garantirRelogio() {
  if (relogio != null) return;
  relogio = window.setInterval(() => {
    if (!gps.on && !gps.estado.manual) { pararRelogio(); return; }
    if (velha() !== cinzaAnterior) desenharMapa();
    if (!gps.definindo) desenharChip();
  }, 1000);
}
function pararRelogio() { if (relogio != null) { clearInterval(relogio); relogio = null; } }

function setGpsUi() {
  const b = $('#btnGps');
  b.setAttribute('aria-pressed', String(gps.on));
  b.classList.toggle('live', gps.on);
}

/** watchPosition com alta precisão, modo seguir e wakeLock. Exige HTTPS e permissão do navegador. */
export async function gpsToggle(force?: boolean) {
  const on = force !== undefined ? force : !gps.on;
  if (!on) {
    parar();
    gps.on = false;
    if (gps.lock) { try { await gps.lock.release(); } catch { /* já liberado */ } gps.lock = null; }
    if (E.mapReady) setData('gps', { type: 'FeatureCollection', features: [] });
    pararRelogio();
    desenharChip();
    setGpsUi();
    return;
  }
  if (!navigator.geolocation) {
    gps.falha = 'indisponivel'; gps.on = false; setGpsUi(); desenharChip();
    toast('Este navegador não oferece localização. Defina a posição por km.', 5000);
    return;
  }
  gps.on = true; gps.follow = true; gps.autoSel = true; gps.primeira = true; gps.falha = null;
  setGpsUi();
  desenharChip();
  toast('Buscando sua posição...');
  iniciarBusca();
  garantirRelogio();
  try { if (navigator.wakeLock) gps.lock = await navigator.wakeLock.request('screen'); } catch { /* sem wakeLock */ }
}

