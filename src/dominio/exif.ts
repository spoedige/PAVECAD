/** Escreve a posição (EXIF GPS) e a data num JPEG, para a foto abrir georreferenciada em outros programas. Funções puras.
 *  Gera um segmento APP1 "Exif" em little-endian com o IFD0 (apontando para o IFD de GPS e para o IFD Exif com DateTimeOriginal) e o IFD de GPS
 *  (versão, referências e valores de latitude e longitude em graus, minutos e segundos). Um EXIF que já exista no arquivo é substituído. */

const TIPO_ASCII = 2, TIPO_SHORT = 3, TIPO_LONG = 4, TIPO_BYTE = 1, TIPO_RATIONAL = 5;

interface Entrada { tag: number; tipo: number; n: number; dados: Uint8Array }
const u16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
const u32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const ascii = (s: string) => { const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 127; return b; };
const racionais = (vs: [number, number][]) => { const b = new Uint8Array(vs.length * 8); vs.forEach(([a, d], i) => { b.set(u32(a), i * 8); b.set(u32(d), i * 8 + 4); }); return b; };

/** Graus decimais em graus, minutos e segundos (segundos com 4 casas, como racional x/10000). */
export function grausMinSeg(valor: number): [number, number, number] {
  const a = Math.abs(valor), g = Math.floor(a), mm = (a - g) * 60, m = Math.floor(mm), s = Math.round((mm - m) * 60 * 10000) / 10000;
  return s >= 60 ? [g, m + 1, 0] : [g, m, s];
}

/** Um IFD com os dados maiores que 4 bytes depois da tabela; `base` é o deslocamento do início do IFD no bloco TIFF. */
function montarIfd(entradas: Entrada[], base: number): Uint8Array {
  const es = [...entradas].sort((a, b) => a.tag - b.tag);
  const tabela = 2 + es.length * 12 + 4;
  let extra = 0;
  const partes: Uint8Array[] = [u16(es.length)];
  const fora: Uint8Array[] = [];
  for (const e of es) {
    const tam = e.dados.length;
    partes.push(u16(e.tag), u16(e.tipo), u32(e.n));
    if (tam <= 4) { const v = new Uint8Array(4); v.set(e.dados); partes.push(v); }
    else { partes.push(u32(base + tabela + extra)); fora.push(e.dados); extra += tam + (tam % 2); if (tam % 2) fora.push(new Uint8Array(1)); }
  }
  partes.push(u32(0), ...fora);
  return concat(partes);
}
const concat = (as: Uint8Array[]) => { const n = as.reduce((s, a) => s + a.length, 0), o = new Uint8Array(n); let p = 0; for (const a of as) { o.set(a, p); p += a.length; } return o; };

/** O bloco "Exif\0\0" + TIFF. */
export function montarExif(lat: number, lon: number, quando?: Date): Uint8Array {
  const z = (v: number, n = 2) => String(v).padStart(n, '0');
  const dt = quando ? `${quando.getFullYear()}:${z(quando.getMonth() + 1)}:${z(quando.getDate())} ${z(quando.getHours())}:${z(quando.getMinutes())}:${z(quando.getSeconds())}` : '';
  const gps: Entrada[] = [
    { tag: 0, tipo: TIPO_BYTE, n: 4, dados: new Uint8Array([2, 3, 0, 0]) },
    { tag: 1, tipo: TIPO_ASCII, n: 2, dados: ascii(lat >= 0 ? 'N' : 'S') },
    { tag: 2, tipo: TIPO_RATIONAL, n: 3, dados: racionais(grausMinSeg(lat).map((v, i) => (i === 2 ? [Math.round(v * 10000), 10000] : [v, 1])) as [number, number][]) },
    { tag: 3, tipo: TIPO_ASCII, n: 2, dados: ascii(lon >= 0 ? 'E' : 'W') },
    { tag: 4, tipo: TIPO_RATIONAL, n: 3, dados: racionais(grausMinSeg(lon).map((v, i) => (i === 2 ? [Math.round(v * 10000), 10000] : [v, 1])) as [number, number][]) },
    { tag: 18, tipo: TIPO_ASCII, n: 6, dados: ascii('WGS84') },
  ];
  const tem = !!dt;
  // layout: cabeçalho TIFF (8) | IFD0 | IFD Exif | IFD GPS
  const ifd0Tam = 2 + (tem ? 2 : 1) * 12 + 4;
  const exifTam = tem ? 2 + 12 + 4 + (dt.length + 1) + ((dt.length + 1) % 2) : 0;
  const ofExif = 8 + ifd0Tam, ofGps = ofExif + exifTam;
  const ifd0: Entrada[] = [{ tag: 0x8825, tipo: TIPO_LONG, n: 1, dados: u32(ofGps) }];
  if (tem) ifd0.push({ tag: 0x8769, tipo: TIPO_LONG, n: 1, dados: u32(ofExif) });
  const ifdExif = tem ? montarIfd([{ tag: 0x9003, tipo: TIPO_ASCII, n: dt.length + 1, dados: ascii(dt) }], ofExif) : new Uint8Array(0);
  const tiff = concat([new Uint8Array([0x49, 0x49, 42, 0]), u32(8), montarIfd(ifd0, 8), ifdExif, montarIfd(gps, ofGps)]);
  const cab = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]);
  void TIPO_SHORT;
  return concat([cab, tiff]);
}

/** Devolve o JPEG com o EXIF de posição (e data, se vier). Sem SOI ("FFD8"), devolve o arquivo como veio. */
export function jpegComGps(jpeg: Uint8Array, lat: number, lon: number, quando?: Date): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const exif = montarExif(lat, lon, quando), seg = concat([new Uint8Array([0xff, 0xe1]), new Uint8Array([((exif.length + 2) >> 8) & 255, (exif.length + 2) & 255]), exif]);
  // copia os segmentos iniciais, descartando um APP1 Exif anterior; o novo entra logo depois do JFIF (APP0), se houver
  let p = 2;
  const antes: Uint8Array[] = [jpeg.subarray(0, 2)];
  let inseriu = false;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marc = jpeg[p + 1], len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (marc === 0xda || marc === 0xd9) break;
    const fim = p + 2 + len, ehExif = marc === 0xe1 && jpeg[p + 4] === 0x45 && jpeg[p + 5] === 0x78;
    if (marc === 0xe0) { antes.push(jpeg.subarray(p, fim)); p = fim; continue; }
    if (!inseriu) { antes.push(seg); inseriu = true; }
    if (!ehExif) antes.push(jpeg.subarray(p, fim));
    p = fim;
  }
  if (!inseriu) antes.push(seg);
  return concat([...antes, jpeg.subarray(p)]);
}

/** Lê de volta a posição de um JPEG com o EXIF acima (usado nos testes e na conferência). */
export function lerGps(jpeg: Uint8Array): { lat: number; lon: number } | null {
  let p = 2;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marc = jpeg[p + 1], len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (marc === 0xe1 && jpeg[p + 4] === 0x45 && jpeg[p + 5] === 0x78) return lerTiff(jpeg.subarray(p + 10, p + 2 + len));
    if (marc === 0xda) break;
    p += 2 + len;
  }
  return null;
}
function lerTiff(t: Uint8Array): { lat: number; lon: number } | null {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength), le = t[0] === 0x49;
  const g16 = (o: number) => dv.getUint16(o, le), g32 = (o: number) => dv.getUint32(o, le);
  const ifd = (o: number) => { const n = g16(o), m = new Map<number, { tipo: number; n: number; o: number }>(); for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; m.set(g16(e), { tipo: g16(e + 2), n: g32(e + 4), o: e + 8 }); } return m; };
  const i0 = ifd(g32(4)), gp = i0.get(0x8825);
  if (!gp) return null;
  const g = ifd(g32(gp.o));
  const rat = (e: { o: number }) => { const b = g32(e.o); return [0, 1, 2].map((i) => g32(b + i * 8) / g32(b + i * 8 + 4)); };
  const ref = (e: { o: number }) => String.fromCharCode(t[e.o]);
  const la = g.get(2), lo = g.get(4), lr = g.get(1), or = g.get(3);
  if (!la || !lo || !lr || !or) return null;
  const dec = ([d, m, s]: number[]) => d + m / 60 + s / 3600;
  return { lat: dec(rat(la)) * (ref(lr) === 'S' ? -1 : 1), lon: dec(rat(lo)) * (ref(or) === 'W' ? -1 : 1) };
}
