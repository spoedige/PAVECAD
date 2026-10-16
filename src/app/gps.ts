import { localizar, type Local, type LocP } from '../dominio/localizar';
import { M_LAT } from '../dominio/medidas';
import { E, projName, type AppProj } from './estado';
import { getMap, select, setData } from './mapa';
import { startNote } from './revisao';
import { $, esc, toast } from './ui';

interface Fix { lat: number; lon: number; acc: number }
export const gps = {
  on: false, follow: true, id: null as number | null, last: null as Fix | null,
  lock: null as WakeLockSentinel | null, loc: null as Local | null, autoSel: false,
};

/** Círculo de precisão em torno da posição, em [lon, lat]. */
export function circle(lng: number, lat: number, rm: number): number[][] {
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180), pts: number[][] = [];
  for (let a = 0; a <= 48; a++) {
    const t = (a / 48) * 2 * Math.PI;
    pts.push([lng + (Math.cos(t) * rm) / mLon, lat + (Math.sin(t) * rm) / M_LAT]);
  }
  return pts;
}

function onFix(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  gps.last = { lat, lon, acc };
  const m = getMap();
  if (E.mapReady) {
    setData('gps', {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(lon, lat, Math.max(acc || 5, 3))] } },
      ],
    });
  }
  const loc = localizar(E.P as LocP[], lat, lon), chip = $('#gpschip');
  chip.hidden = false;
  let txt: string;
  gps.loc = loc;
  if (loc && loc.out < 40 && loc.lane !== null) txt = `<b>km ${esc(loc.p.kmLab[loc.i])}</b> · ${loc.lane ? 'Faixa ' + loc.lane : 'Acostamento'} · ${esc(projName(loc.p as AppProj))}`;
  else if (loc) txt = `Fora da pista (${Math.round(loc.out || loc.dist)} m) · mais próximo: km ${esc(loc.p.kmLab[loc.i])} ${esc(projName(loc.p as AppProj))}`;
  else txt = 'Sem planilhas visíveis para localizar';
  chip.innerHTML = `<span class="num">${txt} · ±${Math.round(acc || 0)} m</span><button class="p" id="gOpen">Abrir</button><button id="gNote">Nota</button><button id="gFollow">${gps.follow ? 'Seguindo' : 'Seguir'}</button>`;
  $('#gOpen').onclick = () => { const l = gps.loc; if (l) select(l.p.id, l.i, l.lane ?? 1, { tab: true }); };
  $('#gNote').onclick = () => { if (gps.last) startNote('pin', [[gps.last.lon, gps.last.lat]]); };
  $('#gFollow').onclick = () => {
    gps.follow = !gps.follow;
    $('#gFollow').textContent = gps.follow ? 'Seguindo' : 'Seguir';
    if (gps.follow && gps.last) m.easeTo({ center: [gps.last.lon, gps.last.lat], zoom: Math.max(m.getZoom(), 17.5) });
  };
  if (gps.follow && E.mapReady) m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 17.5), duration: 600 });
  if (gps.loc && gps.loc.lane !== null && gps.loc.out < 40 && gps.autoSel) select(gps.loc.p.id, gps.loc.i, gps.loc.lane);
}

function setGpsUi() {
  const b = $('#btnGps');
  b.setAttribute('aria-pressed', String(gps.on));
  b.classList.toggle('live', gps.on);
}

/** watchPosition com alta precisão, modo seguir e wakeLock. Exige HTTPS e permissão do navegador. */
export async function gpsToggle(force?: boolean) {
  const on = force !== undefined ? force : !gps.on;
  if (!on) {
    if (gps.id != null) navigator.geolocation.clearWatch(gps.id);
    gps.id = null; gps.on = false;
    if (gps.lock) { try { await gps.lock.release(); } catch { /* já liberado */ } gps.lock = null; }
    if (E.mapReady) setData('gps', { type: 'FeatureCollection', features: [] });
    $('#gpschip').hidden = true;
    setGpsUi();
    return;
  }
  if (!navigator.geolocation) { toast('Este navegador não oferece localização'); return; }
  gps.on = true; gps.follow = true; gps.autoSel = true;
  setGpsUi();
  toast('Buscando sua posição...');
  gps.id = navigator.geolocation.watchPosition(onFix, (err) => {
    gps.on = false; gps.id = null; setGpsUi();
    toast(err?.code === 1 ? 'Localização bloqueada. Com HTTPS o navegador pede permissão.' : 'Não foi possível obter a posição', 5000);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  try { if (navigator.wakeLock) gps.lock = await navigator.wakeLock.request('screen'); } catch { /* sem wakeLock */ }
}
