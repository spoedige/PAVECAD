/** Reconstrução das coordenadas de um sentido do Planservi.
 *
 *  As coordenadas das pontas (e, às vezes, do meio) vêm pouco confiáveis: ponto repetido, salto, retrocesso.
 *  O quilômetro de cada linha é confiável, então ele dá o comprimento esperado de cada passo e serve de
 *  parâmetro para interpolar. Função pura, sem DOM: o Planservi chama no fim da leitura de cada sentido. */

export interface PontoBruto {
  /** Quilometragem da linha, em metros. */
  km: number;
  lat: number;
  lon: number;
}

export type TipoCorrecao = 'repetido' | 'salto' | 'retrocedendo' | 'inicial' | 'final';

export interface Correcao {
  /** Índice da linha. */
  i: number;
  tipo: TipoCorrecao;
  /** Nas pontas, o que havia de errado com o ponto original. */
  causa?: 'repetido' | 'salto' | 'retrocedendo' | 'terminal';
  lat: number;
  lon: number;
  /** Distância entre a coordenada original e a nova, em metros. */
  deslocamento: number;
  /** Coordenada original. */
  orig: [number, number];
}

/** Descontinuidade real: a linha é cortada antes da linha `i`. */
export interface Corte { i: number; dist: number; esperado: number }

/** Anomalia que não foi corrigida: trecho parado (coordenadas quase iguais com o km avançando) ou passo atípico. */
export interface Aviso { tipo: 'estacionario' | 'passo'; i0: number; i1: number; dist: number; esperado: number }

export interface Reconstrucao {
  lat: number[];
  lon: number[];
  corrigidos: Correcao[];
  cortes: Corte[];
  avisos: Aviso[];
}

export const LIM = {
  /** Faixa aceita para o passo, em fração do comprimento esperado. */
  min: 0.5, max: 1.5,
  /** Desvio angular máximo do passo em relação ao rumo médio dos vizinhos (graus). */
  angulo: 45,
  /** Tolerância de medida (m) nos limites do passo: 30,1 m é o passo de 30 m, não um salto. */
  tolerancia: 0.5,
  /** Quantos passos de cada lado entram no rumo médio. */
  janela: 3,
  /** Pontos suspeitos seguidos que ainda se interpolam. Acima disso o trecho é longo demais para adivinhar. */
  corrida: 8,
  /** Excesso de um passo isolado (m) a partir do qual ele vira corte e não só aviso. */
  corteExcesso: 30,
  /** Deslocamento mínimo (m) para listar o ponto final entre os corrigidos. */
  finalMin: 1,
};

const R = 6371000, RAD = Math.PI / 180;

type V = [number, number];
const len = (v: V) => Math.hypot(v[0], v[1]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const unit = (v: V): V | null => { const l = len(v); return l > 1e-9 ? [v[0] / l, v[1] / l] : null; };

export function reconstruir(pts: PontoBruto[], terminal: boolean): Reconstrucao {
  const N = pts.length, M = terminal ? N - 1 : N;
  const lat = pts.map((p) => p.lat), lon = pts.map((p) => p.lon);
  const out: Reconstrucao = { lat, lon, corrigidos: [], cortes: [], avisos: [] };
  if (M < 4) return out;

  // plano local em metros em torno do primeiro ponto
  const lat0 = pts[0].lat, lon0 = pts[0].lon, cl = Math.cos(lat0 * RAD);
  const x = pts.map((p) => (p.lon - lon0) * RAD * cl * R);
  const y = pts.map((p) => (p.lat - lat0) * RAD * R);
  const volta = (px: number, py: number): [number, number] => [lat0 + py / (RAD * R), lon0 + px / (RAD * R * cl)];

  const passo = (j: number): V => [x[j + 1] - x[j], y[j + 1] - y[j]];
  const esp = Array.from({ length: M - 1 }, (_, j) => Math.max(pts[j + 1].km - pts[j].km, 1));
  const dist = Array.from({ length: M - 1 }, (_, j) => len(passo(j)));
  const razaoOk = (j: number) => dist[j] >= LIM.min * esp[j] - LIM.tolerancia && dist[j] <= LIM.max * esp[j] + LIM.tolerancia;

  // rumo médio dos vizinhos: soma dos passos próximos que têm comprimento plausível
  const rumoAo = (j: number): V | null => {
    let sx = 0, sy = 0;
    for (let k = Math.max(0, j - LIM.janela); k <= Math.min(M - 2, j + LIM.janela); k++) {
      if (k === j || !razaoOk(k)) continue;
      const u = unit(passo(k));
      if (u) { sx += u[0]; sy += u[1]; }
    }
    return unit([sx, sy]);
  };
  const cosMin = Math.cos(LIM.angulo * RAD);
  const ruim: boolean[] = [], retro: boolean[] = [];
  for (let j = 0; j < M - 1; j++) {
    const ref = rumoAo(j), s = passo(j);
    const proj = ref ? dot(s, ref) : 1;
    retro[j] = !!ref && proj <= 0;
    let bad = !razaoOk(j) || retro[j];
    if (!bad && ref && dist[j] > 0 && proj / dist[j] < cosMin) bad = true;
    ruim[j] = bad;
  }

  // pontos suspeitos
  const susp = new Array<boolean>(M).fill(false);
  for (let i = 1; i < M - 1; i++) susp[i] = ruim[i - 1] && ruim[i];
  if (ruim[0] && !ruim[1]) susp[0] = true;
  if (ruim[M - 2] && !ruim[M - 3]) susp[M - 1] = true;

  const causaDe = (i: number): 'repetido' | 'salto' | 'retrocedendo' => {
    const vizinhos = [i - 1, i].filter((j) => j >= 0 && j < M - 1);
    if (vizinhos.some((j) => dist[j] < 1)) return 'repetido';
    if (vizinhos.some((j) => retro[j])) return 'retrocedendo';
    return 'salto';
  };
  const nx = x.slice(), ny = y.slice();
  const registrar = (i: number, tipo: TipoCorrecao, causa: Correcao['causa']) => {
    const [la, lo] = volta(nx[i], ny[i]);
    const d = Math.hypot(nx[i] - x[i], ny[i] - y[i]);
    out.corrigidos.push({ i, tipo, causa, lat: la, lon: lo, deslocamento: d, orig: [pts[i].lat, pts[i].lon] });
    lat[i] = la; lon[i] = lo;
  };

  // rumo médio dos três primeiros (ou últimos) passos válidos, entre pontos não suspeitos
  const passoValido = (j: number) => !ruim[j] && !susp[j] && !susp[j + 1];
  const rumoPontas = (desdeInicio: boolean): V | null => {
    let sx = 0, sy = 0, n = 0;
    for (let k = 0; k < M - 1 && n < 3; k++) {
      const j = desdeInicio ? k : M - 2 - k;
      if (!passoValido(j)) continue;
      const u = unit(passo(j));
      if (u) { sx += u[0]; sy += u[1]; n++; }
    }
    return unit([sx, sy]);
  };

  // pontas: extrapola a partir dos vizinhos válidos
  if (susp[0]) {
    const h = rumoPontas(true);
    if (h) {
      const causa = causaDe(0);
      nx[0] = x[1] - h[0] * esp[0]; ny[0] = y[1] - h[1] * esp[0];
      registrar(0, 'inicial', causa);
    }
  }
  if (susp[M - 1]) {
    const h = rumoPontas(false);
    if (h) {
      const causa = causaDe(M - 1);
      nx[M - 1] = x[M - 2] + h[0] * esp[M - 2]; ny[M - 1] = y[M - 2] + h[1] * esp[M - 2];
      registrar(M - 1, 'final', causa);
    }
  }

  // corridas de suspeitos no meio: interpola pelo km entre os vizinhos válidos, ou corta, ou só avisa
  for (let i = 1; i < M - 1; i++) {
    if (!susp[i]) continue;
    const a = i - 1;
    let b = i;
    while (b < M - 1 && susp[b]) b++;
    const k = b - a - 1, delta = Math.max(pts[b].km - pts[a].km, 1);
    const chord = Math.hypot(x[b] - x[a], y[b] - y[a]), r = chord / delta;
    if (r >= LIM.min && r <= LIM.max && k <= LIM.corrida) {
      for (let q = a + 1; q < b; q++) {
        const t = (pts[q].km - pts[a].km) / delta;
        nx[q] = x[a] + t * (x[b] - x[a]); ny[q] = y[a] + t * (y[b] - y[a]);
        registrar(q, causaDe(q), undefined);
      }
    } else if (r > LIM.max) {
      let jm = a;
      for (let j = a; j < b; j++) if (dist[j] > dist[jm]) jm = j;
      out.cortes.push({ i: jm + 1, dist: dist[jm], esperado: esp[jm] });
    } else {
      out.avisos.push({ tipo: 'estacionario', i0: a, i1: b, dist: chord, esperado: delta });
    }
    i = b;
  }

  // passos atípicos isolados (os dois pontos são válidos): salto grande real corta, o resto só avisa
  for (let j = 0; j < M - 1; j++) {
    if (!ruim[j] || susp[j] || susp[j + 1]) continue;
    if (dist[j] > LIM.max * esp[j] && dist[j] - esp[j] > LIM.corteExcesso) out.cortes.push({ i: j + 1, dist: dist[j], esperado: esp[j] });
    else out.avisos.push({ tipo: 'passo', i0: j, i1: j + 1, dist: dist[j], esperado: esp[j] });
  }
  out.cortes.sort((p, q) => p.i - q.i);

  // ponto final (sem número de segmento): a coordenada da planilha é ignorada
  if (terminal) {
    const t = N - 1, ult = M - 1;
    // rumo médio dos últimos passos plausíveis, já com os pontos corrigidos
    let sx = 0, sy = 0, n = 0;
    for (let j = M - 2; j >= 0 && n < 3; j--) {
      const v: V = [nx[j + 1] - nx[j], ny[j + 1] - ny[j]], d = len(v);
      if (d < LIM.min * esp[j] - LIM.tolerancia || d > LIM.max * esp[j] + LIM.tolerancia) continue;
      const u = unit(v);
      if (u) { sx += u[0]; sy += u[1]; n++; }
    }
    const h = unit([sx, sy]) ?? unit([nx[ult] - nx[ult - 1], ny[ult] - ny[ult - 1]]);
    if (h) {
      const e = Math.max(pts[t].km - pts[ult].km, 1);
      nx[t] = nx[ult] + h[0] * e; ny[t] = ny[ult] + h[1] * e;
      const d = Math.hypot(nx[t] - x[t], ny[t] - y[t]);
      const [la, lo] = volta(nx[t], ny[t]);
      lat[t] = la; lon[t] = lo;
      if (d > LIM.finalMin) out.corrigidos.push({ i: t, tipo: 'final', causa: 'terminal', lat: la, lon: lo, deslocamento: d, orig: [pts[t].lat, pts[t].lon] });
    }
  }
  out.corrigidos.sort((p, q) => p.i - q.i);
  return out;
}
