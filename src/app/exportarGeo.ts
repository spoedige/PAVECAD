import * as catalogo from '../dominio/catalogo';
import {
  fontesFiltradas, montarModelo, nomeArquivo, opcoesEfetivas, opcoesPadrao, relatorioDe, totalFeicoes,
  type FonteExport, type OpcoesExport, type Relatorio,
} from '../dominio/exportGeo';
import { estimarIfc, gerarIfc, LIMITACAO_Z, MOTIVO_SEM_ALINHAMENTO, verificarIfc } from '../formats/ifc';
import { estimarKml, gerarKml, verificarKml, type NotaKml } from '../formats/kml';
import { TIPOS_RAPIDOS } from '../dominio/notaRapida';
import { E, NOTE_CATS, baseOf, kmFmt, projName, rodoviaNome, visibleProjects } from './estado';
import { fotosAtuais } from './exportNotas';
import { esc, toast } from './ui';

/** Cartões KMZ/KML e IFC da aba Exportar: chips de camada, filtro e detalhe, tamanho estimado, geração em lotes e relatório. */

type Cartao = 'kmz' | 'ifc';

const est: Record<Cartao, OpcoesExport> = { kmz: opcoesPadrao('kmz'), ifc: opcoesPadrao('ifc') };
const relatorios: Partial<Record<Cartao, string>> = {};
let gerando: Cartao | null = null;

const MB = 1024 * 1024;
const tamanho = (b: number) => (b >= MB ? `${(b / MB).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ceder = () => new Promise<void>((r) => setTimeout(r));

export function fontesAtuais(): FonteExport[] {
  return visibleProjects().map((p) => ({
    id: p.id, planilha: projName(p), rodovia: rodoviaNome(p.meta.uf), sentido: p.meta.travel > 0 ? 'Crescente' : 'Decrescente',
    base: baseOf(p), opts: p.opts, model: p.model, km: (i: number) => kmFmt(p.kmNum[i]),
  }));
}

/** KMZ: as fotos das notas só entram com o chip "Incluir fotos" (e com as notas de campo ligadas). */
let fotosKmz = false;

function notasKml(foto?: Map<string, string>): NotaKml[] {
  return E.notes.map((n) => {
    const p = n.loc ? E.P.find((x) => x.id === n.loc!.pid) : undefined;
    return {
      tipo: n.type, coords: n.coords, categoria: n.rapida ? TIPOS_RAPIDOS[n.rapida.tipo].rotulo : NOTE_CATS[n.cat].l, texto: n.text, criado: n.t,
      planilha: p && !E.privacidade ? projName(p) : null, km: n.loc && !E.privacidade ? n.loc.km : null,
      ...(foto?.has(n.id) ? { foto: foto.get(n.id) } : {}),
    };
  });
}

const infoCor = (c: string) => { const i = catalogo.get(c); return { nome: i.nome, cor: i.cor, categoria: i.categoria }; };
const infoIfc = (c: string) => { const i = catalogo.get(c); return { nome: i.nome, categoria: i.categoria, nivel: i.nivel, espessura: i.espessura }; };

/* ---- interface ---- */

const chip = (g: string, v: string | number, rotulo: string, ligado: boolean) =>
  `<button type="button" class="xchip" data-g="${g}" data-v="${esc(String(v))}" aria-pressed="${ligado}">${esc(rotulo)}</button>`;
const grupo = (rotulo: string, chips: string) => `<div class="xg"><span class="xg-l">${rotulo}</span><div class="xchips">${chips}</div></div>`;

function chipsDe(fmt: Cartao, fontes: FonteExport[]): string {
  const o = est[fmt];
  const camadas: [keyof OpcoesExport['camadas'], string][] = fmt === 'ifc'
    ? [['faixas', 'Faixas com solução'], ['propostas', 'Propostas']]
    : [['faixas', 'Faixas com solução'], ['patologias', 'Patologias'], ['drenos', 'Drenos'], ['estacas', 'Estacas'], ['propostas', 'Propostas']];
  const rodovias = [...new Set(fontes.map((f) => f.rodovia))];
  const nFaixas = Math.max(0, ...fontes.map((f) => Math.max(...f.base.rows.map((r) => r.widths.length), 0)));
  const faixas = [chip('faixa', 'todas', 'Todas', o.faixa === 'todas'), chip('faixa', 0, 'Acostamento', o.faixa === 0),
    ...Array.from({ length: nFaixas }, (_, i) => chip('faixa', i + 1, `Faixa ${i + 1}`, o.faixa === i + 1))];
  const detalhes: [string, string][] = fmt === 'ifc'
    ? [['resumido', 'Resumido'], ['trecho', 'Por trecho de 20 m']]
    : [['resumido', 'Resumido'], ['trecho', 'Por trecho de 20 m'], ['completo', 'Com estacas e patologias']];
  return [
    grupo('Camadas', camadas.map(([k, r]) => chip('camada', k, r, o.camadas[k])).join('')),
    rodovias.length > 1 ? grupo('Rodovia', rodovias.map((r) => chip('rodovia', r, r, !o.rodovias || o.rodovias.includes(r))).join('')) : '',
    grupo('Sentido', [['todos', 'Todos'], ['crescente', 'Crescente'], ['decrescente', 'Decrescente']].map(([v, r]) => chip('sentido', v, r, o.sentido === v)).join('')),
    grupo('Faixa', faixas.join('')),
    grupo('Nível de detalhe', detalhes.map(([v, r]) => chip('detalhe', v, r, o.detalhe === v)).join('')),
    grupo('Notas de campo', chip('notas', 'notas', 'Incluir notas de campo', o.notas) + (fmt === 'kmz' ? chip('fotos', 'fotos', 'Incluir fotos', fotosKmz && o.notas) : '')),
  ].join('');
}

export function htmlCartaoGeo(fmt: Cartao): string {
  const fontes = fontesAtuais();
  const off = fontes.length ? '' : 'disabled';
  const kmz = fmt === 'kmz';
  const titulo = kmz ? 'KMZ / KML' : 'IFC (IFC4X3_ADD2)';
  const texto = kmz
    ? 'Para Google Earth, QGIS e celular. KMZ é o KML compactado (mais leve); KML puro é a opção secundária. Geometria em metros, a mesma da tela, com o Alinhar aplicado. Notas de campo ficam de fora, salvo se você ligar o chip.'
    : `Para BIM e topografia: IfcProject, IfcSite, IfcRoad, IfcRoadPart (por sentido e faixa) e IfcPavement, com IfcMapConversion no fuso UTM da planilha. ${LIMITACAO_Z} O arquivo registra essa limitação.`;
  return `<section class="xcard" id="${kmz ? 'xKmz' : 'xIfc'}"><div class="xc-h"><h3>${titulo}</h3><span class="num muted">${fontes.length ? `${fontes.length} planilha${fontes.length > 1 ? 's' : ''}` : 'sem planilha'}</span></div>
    <p class="note">${texto}</p>${chipsDe(fmt, fontes)}
    <p class="note xest" id="${kmz ? 'xEstKmz' : 'xEstIfc'}" aria-live="polite"></p>
    <div class="btns">${kmz ? `<button class="btn p" id="exKmz" ${off}>Baixar KMZ</button><button class="btn" id="exKml" ${off}>Baixar KML</button>` : `<button class="btn p" id="exIfc" ${off}>Baixar IFC</button>`}</div>
    <div class="xrel" id="${kmz ? 'xRelKmz' : 'xRelIfc'}" ${relatorios[fmt] ? '' : 'hidden'}>${relatorios[fmt] ?? ''}</div></section>`;
}

/** Atualiza a estimativa de tamanho (e o aviso do IFC) sem travar a interface. */
function atualizarEstimativa(fmt: Cartao) {
  const el = document.getElementById(fmt === 'kmz' ? 'xEstKmz' : 'xEstIfc');
  if (!el) return;
  const fontes = fontesAtuais();
  if (!fontes.length) { el.textContent = ''; return; }
  el.textContent = 'Calculando o tamanho estimado';
  setTimeout(() => {
    if (!el.isConnected) return;
    const o = opcoesEfetivas(fmt, est[fmt]);
    const m = montarModelo(fontes, o, E.props);
    const n = o.notas ? notasKml().length : 0;
    if (fmt === 'kmz') {
      const t = estimarKml(m, n);
      el.textContent = `${totalFeicoes(m, n).toLocaleString('pt-BR')} feições. Tamanho estimado: KMZ ${tamanho(t.kmz)}, KML ${tamanho(t.kml)}.`;
    } else {
      const b = estimarIfc(m, n);
      const aviso = b > 25 * MB ? ' Arquivo grande: pode demorar para gerar e abrir no tablet. Use "Resumido" ou filtre rodovia e faixa.' : '';
      el.textContent = `${(m.faixas.length + m.propostas.length).toLocaleString('pt-BR')} pavimentos. Tamanho estimado: ${tamanho(b)}.${aviso}`;
    }
  }, 0);
}

function relatorioHtml(r: Relatorio, tam: number, nome: string, extras: string[] = []): string {
  const v = r.validacao;
  return `<b>${esc(nome)}</b> · ${tamanho(tam)}<br>${r.elementos.toLocaleString('pt-BR')} elemento${r.elementos === 1 ? '' : 's'} · ${r.unidos.toLocaleString('pt-BR')} trecho${r.unidos === 1 ? '' : 's'} de 20 m unido${r.unidos === 1 ? '' : 's'}
    <br><span class="${v.ok ? 'xok' : 'xerr'}">${v.ok ? 'Verificação interna aprovada' : 'Verificação interna falhou'}</span>: ${esc(v.detalhe)}
    ${[...r.avisos, ...extras].map((a) => `<br><span class="muted">Aviso: ${esc(a)}</span>`).join('')}`;
}

function baixarArquivo(blob: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function gerar(fmt: 'kmz' | 'kml' | 'ifc', rerender: () => void) {
  const cartao: Cartao = fmt === 'ifc' ? 'ifc' : 'kmz';
  if (gerando) return;
  const fontes = fontesAtuais();
  if (!fontes.length) { toast('Abra uma planilha para exportar'); return; }
  const o = opcoesEfetivas(fmt, est[cartao]);
  const incluidas = fontesFiltradas(fontes, o);
  if (!incluidas.length) { toast('Nenhuma planilha atende ao filtro'); return; }
  if (fmt === 'ifc' && new Set(incluidas.map((f) => f.base.crs.zone)).size > 1) {
    toast('As planilhas estão em fusos UTM diferentes. Filtre uma rodovia por vez para gerar o IFC', 6000);
    return;
  }
  gerando = cartao;
  const botao = document.getElementById(fmt === 'ifc' ? 'exIfc' : fmt === 'kmz' ? 'exKmz' : 'exKml') as HTMLButtonElement | null;
  const rotulo = botao?.textContent ?? '';
  document.querySelectorAll<HTMLButtonElement>('#xKmz .btn, #xIfc .btn').forEach((b) => { b.disabled = true; });
  if (botao) botao.textContent = 'Gerando';
  try {
    await ceder();
    const modelo = montarModelo(fontes, o, E.props);
    // fotos no KMZ: só com o chip e só no KMZ (no KML puro o caminho relativo não existiria)
    const fotos = fmt === 'kmz' && fotosKmz && o.notas ? fotosAtuais() : [];
    const notas = o.notas ? notasKml(new Map(fotos.map((f) => [f.id, 'fotos/' + f.nome]))) : [];
    const titulo = incluidas.length === 1 ? incluidas[0].planilha : `${incluidas.length} planilhas`;
    if (fmt === 'ifc') {
      if (!modelo.faixas.length && !modelo.propostas.length) { toast('Nada para exportar com estas opções'); return; }
      const saida = await gerarIfc({ titulo, modelo, opcoes: o, info: infoIfc, crs: incluidas[0].base.crs, notas, ceder });
      const nome = nomeArquivo('PAVECAD', 'ifc', titulo);
      baixarArquivo(new Blob([saida.texto], { type: 'application/x-step' }), nome);
      const v = verificarIfc(saida.texto, saida);
      const r = { ...relatorioDe(modelo, { ok: v.ok, detalhe: v.detalhe }, saida.avisos), elementos: saida.pavimentos + saida.propostas + saida.anotacoes };
      relatorios.ifc = relatorioHtml(r, saida.texto.length, nome, [LIMITACAO_Z, MOTIVO_SEM_ALINHAMENTO]);
      toast(`${nome} gerado`, 4000);
    } else {
      if (!totalFeicoes(modelo, notas.length)) { toast('Nada para exportar com estas opções'); return; }
      const kml = await gerarKml({ titulo, modelo, opcoes: o, info: infoCor, notas, ceder });
      const v = verificarKml(kml, totalFeicoes(modelo, o.notas ? notas.length : 0));
      let blob: Blob, nome: string;
      if (fmt === 'kmz') {
        const { zipSync, strToU8 } = await import('fflate');
        const ent: Record<string, Uint8Array | [Uint8Array, { level: 0 | 9 }]> = { 'doc.kml': [strToU8(kml), { level: 9 }] };
        for (const f of fotos) ent['fotos/' + f.nome] = [f.bytes, { level: 0 }];
        blob = new Blob([zipSync(ent) as BlobPart], { type: 'application/vnd.google-earth.kmz' });
        nome = nomeArquivo('PAVECAD', 'kmz', titulo);
      } else {
        blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        nome = nomeArquivo('PAVECAD', 'kml', titulo);
      }
      baixarArquivo(blob, nome);
      const r = { ...relatorioDe(modelo, { ok: v.ok, detalhe: v.detalhe }), elementos: totalFeicoes(modelo, o.notas ? notas.length : 0) };
      relatorios.kmz = relatorioHtml(r, blob.size, nome);
      toast(`${nome} gerado`, 4000);
    }
  } catch (e) {
    console.error(e);
    toast('Não foi possível gerar o arquivo');
  } finally {
    gerando = null;
    if (botao) botao.textContent = rotulo;
    rerender();
  }
}

/** Liga os chips e os botões dos dois cartões. `rerender` redesenha a aba. */
export function ligarCartoesGeo(raiz: HTMLElement, rerender: () => void) {
  for (const fmt of ['kmz', 'ifc'] as Cartao[]) {
    const c = raiz.querySelector<HTMLElement>(fmt === 'kmz' ? '#xKmz' : '#xIfc');
    if (!c) continue;
    c.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('.xchip');
      if (!b) return;
      const o = est[fmt], g = b.dataset.g, v = b.dataset.v!;
      if (g === 'camada') o.camadas[v as keyof OpcoesExport['camadas']] = !o.camadas[v as keyof OpcoesExport['camadas']];
      else if (g === 'sentido') o.sentido = v as OpcoesExport['sentido'];
      else if (g === 'faixa') o.faixa = v === 'todas' ? 'todas' : Number(v);
      else if (g === 'detalhe') o.detalhe = v as OpcoesExport['detalhe'];
      else if (g === 'notas') { o.notas = !o.notas; if (!o.notas) fotosKmz = false; }
      else if (g === 'fotos') { fotosKmz = !(fotosKmz && o.notas); if (fotosKmz) o.notas = true; }
      else if (g === 'rodovia') {
        const todas = [...new Set(fontesAtuais().map((f) => f.rodovia))];
        const atual = new Set(o.rodovias ?? todas);
        if (atual.has(v)) { if (atual.size > 1) atual.delete(v); } else atual.add(v);
        o.rodovias = atual.size === todas.length ? null : [...atual];
      }
      delete relatorios[fmt];
      rerender();
    });
    atualizarEstimativa(fmt);
  }
  raiz.querySelector<HTMLElement>('#exKmz')?.addEventListener('click', () => void gerar('kmz', rerender));
  raiz.querySelector<HTMLElement>('#exKml')?.addEventListener('click', () => void gerar('kml', rerender));
  raiz.querySelector<HTMLElement>('#exIfc')?.addEventListener('click', () => void gerar('ifc', rerender));
}
