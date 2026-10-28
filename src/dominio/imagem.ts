/** Redução das fotos de campo: lado maior de 1600 px, JPEG com qualidade 0,8. Funções puras; o desenho em canvas está em app/foto.ts. */
export const FOTO_LADO_MAX = 1600;
export const FOTO_QUALIDADE = 0.8;

/** Dimensões da foto reduzida: o lado maior vira `max` (nunca amplia) e a proporção se mantém. */
export function dimensoesReduzidas(w: number, h: number, max = FOTO_LADO_MAX): { w: number; h: number } {
  const maior = Math.max(w, h);
  if (!(maior > 0)) return { w: 0, h: 0 };
  if (maior <= max) return { w: Math.round(w), h: Math.round(h) };
  const k = max / maior;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Bytes de uma data URL base64, sem decodificar. */
export const bytesDeDataUrl = (d: string) => { const i = d.indexOf(','); const b = d.length - (i + 1); return Math.max(0, Math.floor((b * 3) / 4) - (d.endsWith('==') ? 2 : d.endsWith('=') ? 1 : 0)); };

export function bytesDeDataUrlParaArray(d: string): Uint8Array {
  const i = d.indexOf(','), bin = atob(d.slice(i + 1)), out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}
