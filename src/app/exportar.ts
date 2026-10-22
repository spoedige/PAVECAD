import { precisaLembrar } from '../dominio/notaRapida';
import { baixarCsv, baixarXlsx, compartilharNotas } from './exportNotas';
import { E } from './estado';
import { notasNovasSemExportar } from './notaRapida';
import { baixarBackup, baixarPropostasCsv, copiarPropostasCsv, totalExportavel, totalPropostas } from './revisao';
import { $ } from './ui';

/** Aba Exportar: um cartão por formato, cada um com o botão "Baixar". KMZ, KML e IFC entram depois, nos mesmos cartões. */
function cartao(o: { id: string; titulo: string; texto: string; n?: number; botoes: string }) {
  return `<section class="xcard" id="${o.id}"><div class="xc-h"><h3>${o.titulo}</h3>${o.n !== undefined ? `<span class="num muted">${o.n}</span>` : ''}</div><p class="note">${o.texto}</p><div class="btns">${o.botoes}</div></section>`;
}

export function renderExp() {
  const el = document.getElementById('t-exp');
  if (!el) return;
  const nNotas = totalExportavel(), nProps = totalPropostas(), novas = notasNovasSemExportar();
  const lembrete = precisaLembrar(novas) ? `<p class="nrl-lembrete">${novas} notas novas sem exportar. Baixe a planilha para guardar uma cópia.</p>` : '';
  const off = (n: number) => (n ? '' : 'disabled');
  el.innerHTML = `${lembrete}
    ${cartao({ id: 'xNotasXlsx', titulo: 'Notas e alterações (.xlsx)', n: nNotas, texto: 'Planilha com data, hora, tipo, local, solução atual e nova, efeito, coordenadas em graus e UTM. Funciona sem internet.',
      botoes: `<button class="btn p" id="exXlsx" ${off(nNotas)}>Baixar</button><button class="btn" id="exShare" ${off(nNotas)}>Compartilhar</button>` })}
    ${cartao({ id: 'xNotasCsv', titulo: 'Notas e alterações (.csv)', n: nNotas, texto: 'Mesmas colunas da planilha, em UTF-8 com BOM, separador ";" e vírgula decimal (Excel em português).',
      botoes: `<button class="btn p" id="exCsv" ${off(nNotas)}>Baixar</button>` })}
    ${cartao({ id: 'xProps', titulo: 'Propostas de solução (.csv)', n: nProps, texto: 'Trechos propostos, com código e solução atual e proposta, extensão, largura, área e as coordenadas do eixo da faixa.',
      botoes: `<button class="btn p" id="pCsvDown" ${off(nProps)}>Baixar</button><button class="btn" id="pCsv" ${off(nProps)}>Copiar tabela</button>` })}
    ${cartao({ id: 'xBackup', titulo: 'Backup completo (.json)', n: E.notes.length, texto: 'Cópia das notas deste aparelho, com fotos, para guardar ou levar a outro aparelho.',
      botoes: '<button class="btn p" id="bkDown">Baixar</button><button class="btn" id="bkImp">Importar backup</button>' })}`;
  $('#exXlsx').onclick = () => void baixarXlsx();
  $('#exCsv').onclick = () => baixarCsv();
  $('#exShare').onclick = () => void compartilharNotas();
  $('#pCsvDown').onclick = () => baixarPropostasCsv();
  $('#pCsv').onclick = () => copiarPropostasCsv();
  $('#bkDown').onclick = () => baixarBackup();
  $('#bkImp').onclick = () => $('#importIn').click();
}
