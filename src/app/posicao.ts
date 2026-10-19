import { E } from './estado';
import { gps } from './gps';

export interface Posicao { lat: number; lon: number; acc: number }
export type FalhaPosicao = 'negada' | 'tempo' | 'indisponivel' | 'erro' | 'imprecisa';
export type ResultadoPosicao = { ok: true; pos: Posicao } | { ok: false; motivo: FalhaPosicao; pos?: Posicao };

/** Precisão (m) acima da qual a posição do GPS não serve para anotar: cai para o centro do mapa. */
export const PRECISAO_MAX_M = 50;
/** Tempo máximo (ms) esperando a posição. */
export const TEMPO_MAX_MS = 8000;

export const MOTIVO_TXT: Record<FalhaPosicao, string> = {
  negada: 'Localização negada',
  tempo: 'Sem posição do GPS em 8 s',
  indisponivel: 'Este aparelho não oferece localização',
  erro: 'Erro ao obter a posição',
  imprecisa: 'Precisão do GPS pior que 50 m',
};

/** Posição atual para anotar. Reaproveita a do GPS ligado quando for recente; senão pede uma leitura única.
 *  Nunca lança: a falha vem com o motivo, e quem chama abre o menu no centro do mapa. */
export function obterPosicao(): Promise<ResultadoPosicao> {
  const recente = gps.on && gps.last && Date.now() - (gps.ultima ?? 0) < 10000 ? gps.last : null;
  const julgar = (pos: Posicao): ResultadoPosicao => (pos.acc > PRECISAO_MAX_M ? { ok: false, motivo: 'imprecisa', pos } : { ok: true, pos });
  if (recente) return Promise.resolve(julgar(recente));
  return new Promise((res) => {
    if (!navigator.geolocation) return res({ ok: false, motivo: 'indisponivel' });
    let fim = false;
    const acabar = (r: ResultadoPosicao) => { if (!fim) { fim = true; clearTimeout(tm); res(r); } };
    const tm = setTimeout(() => acabar({ ok: false, motivo: 'tempo' }), TEMPO_MAX_MS);
    navigator.geolocation.getCurrentPosition(
      (p) => acabar(julgar({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy })),
      (err) => acabar({ ok: false, motivo: err.code === 1 ? 'negada' : err.code === 3 ? 'tempo' : 'erro' }),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: TEMPO_MAX_MS },
    );
  });
}

/** Centro do mapa, para quando o GPS falha. */
export function centroDoMapa(map: { getCenter(): { lat: number; lng: number } }): Posicao {
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, acc: 0 };
}
void E;
