import { precisaLembrar } from '../dominio/notaRapida';
import { baixarCsv, baixarXlsx, compartilharNotas } from './exportNotas';
import { E } from './estado';
import { notasNovasSemExportar } from './notaRapida';
import { baixarPropostasCsv, copiarPropostasCsv, totalExportavel, totalPropostas } from './revisao';
import { baixarBackupCompleto } from './backup';
import { htmlCartaoGeo, ligarCartoesGeo } from './exportarGeo';
import { $ } from './ui';

/** Aba Exportar: um cartão por formato, cada um com o botão "Baixar". */
function cartao(o: { id: string; titulo: string; texto: string; n?: number; extra?: string; botoes: string }) {
  return `<section class="xcard" id="${o.id}"><div class="xc-h"><h3>${o.titulo}</h3>${o.n !== undefined ? `<span class="num muted">${o.n}</span>` : ''}</div><p class="note">${o.texto}</p>${o.extra ?? ''}<div class="btns">${o.botoes}</div></section>`;
}

/** Notas de campo entram por padrão em CSV e XLSX. */
let notasPlanilha = true;

export function renderExp() {
  const el = document.getElementById('t-exp');
  if (!el) return;
  const nNotas = totalExportavel(), nProps = totalPropostas(), novas = notasNovasSemExportar();
  const lembrete = precisaLembrar(novas) ? `<p class="nrl-lembrete">${novas} notas novas sem exportar. Baixe a planilha para guardar uma cópia.</p>` : '';
  const off = (n: number) => (n ? '' : 'disabled');
  const nLinhas = notasPlanilha ? nNotas : nProps;
  el.innerHTML = `${lembrete}
    ${cartao({ id: 'xBackup', titulo: 'Backup completo (.json)', n: E.notes.length, texto: 'Planilhas, notas com fotos, propostas, catálogo e limiares deste aparelho. Use para guardar uma cópia ou levar tudo a outro aparelho.',
      botoes: '<button class="btn p" id="bkDown">Baixar</button><button class="btn" id="bkImp">Importar backup</button>' })}
    ${cartao({ id: 'xPlanilhas', titulo: 'CSV e XLSX', n: nLinhas, texto: 'Notas e alterações de solução: data, hora, tipo, local, solução atual e nova, efeito, coordenadas em graus e UTM. O CSV usa UTF-8 com BOM, ";" e vírgula decimal (Excel em português). Funciona sem internet.',
      extra: `<div class="xg"><span class="xg-l">Conteúdo</span><div class="xchips"><button type="button" class="xchip" id="xcNotas" aria-pressed="${notasPlanilha}">Notas de campo</button></div></div>`,
      botoes: `<button class="btn p" id="exXlsx" ${off(nLinhas)}>Baixar XLSX</button><button class="btn p" id="exCsv" ${off(nLinhas)}>Baixar CSV</button><button class="btn" id="exShare" ${off(nLinhas)}>Compartilhar</button>` })}
    ${cartao({ id: 'xProps', titulo: 'Propostas de solução (.csv)', n: nProps, texto: 'Trechos propostos, com código e solução atual e proposta, extensão, largura, área e as coordenadas do eixo da faixa.',
      botoes: `<button class="btn p" id="pCsvDown" ${off(nProps)}>Baixar</button><button class="btn" id="pCsv" ${off(nProps)}>Copiar tabela</button>` })}
    ${htmlCartaoGeo('kmz')}
    ${htmlCartaoGeo('ifc')}`;
  $('#xcNotas').onclick = () => { notasPlanilha = !notasPlanilha; renderExp(); };
  $('#exXlsx').onclick = () => void baixarXlsx(notasPlanilha);
  $('#exCsv').onclick = () => baixarCsv(notasPlanilha);
  $('#exShare').onclick = () => void compartilharNotas(notasPlanilha);
  $('#pCsvDown').onclick = () => baixarPropostasCsv();
  $('#pCsv').onclick = () => copiarPropostasCsv();
  $('#bkDown').onclick = () => void baixarBackupCompleto();
  $('#bkImp').onclick = () => $('#importIn').click();
  ligarCartoesGeo(el, renderExp);
}
