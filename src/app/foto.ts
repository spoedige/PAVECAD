import { dimensoesReduzidas, FOTO_QUALIDADE } from '../dominio/imagem';

/** Lê o arquivo da câmera e devolve a foto reduzida (lado maior de 1600 px, JPEG com qualidade 0,8) como data URL. Respeita a orientação do EXIF. */
export async function reduzirImagem(arq: Blob): Promise<string> {
  let fonte: CanvasImageSource & { width: number; height: number }, liberar = () => {};
  try {
    const bmp = await createImageBitmap(arq, { imageOrientation: 'from-image' });
    fonte = bmp; liberar = () => bmp.close?.();
  } catch {
    const url = URL.createObjectURL(arq);
    const img = new Image();
    await new Promise<void>((ok, erro) => { img.onload = () => ok(); img.onerror = () => erro(new Error('imagem inválida')); img.src = url; });
    fonte = img; liberar = () => URL.revokeObjectURL(url);
  }
  try {
    const { w, h } = dimensoesReduzidas(fonte.width, fonte.height);
    if (!w || !h) throw new Error('imagem vazia');
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(fonte, 0, 0, w, h);
    return c.toDataURL('image/jpeg', FOTO_QUALIDADE);
  } finally { liberar(); }
}
