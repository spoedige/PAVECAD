# Auditoria de responsividade (Sessão 5)

Script: `npm run auditoria-ui` (fora do CI obrigatório). Aceita `-- --vp 360x640,1366x768` e `-- --estados planilha,dashboard`.
Saída local, ignorada pelo git: `capturas/auditoria-ui/` (capturas por viewport e estado, `achados.json`, `relatorio.md` com a tabela viewport, estado, problema, gravidade).

Matriz: 360x640, 390x844, 412x915, 915x412, 600x960, 768x1024, 820x1180, 1024x768, 1180x820, 1366x768 e 1920x1080, com toque até 1024 px.
Estados: mapa vazio, planilha carregada, painel aberto e recolhido, gaveta fechada, meia e cheia, abas Segmento, Análise, Revisão, Exportar e Ajustes, dashboard, menu pressionável, Ajustes (Soluções e Campo e offline) e offline.
Detectores: rolagem horizontal, elemento cortado ou fora da tela, alvo de toque abaixo de 44 px (a área de toque estendida conta), texto abaixo de 12 px, controle coberto ou sobreposto, texto sobreposto e truncamento de rótulo.

## Resultado final

P1: 0. P2: 0. P3: 507 ocorrências, em 5 problemas distintos (abaixo).

## Critérios de aceite do celular (Parte 6)

| Viewport | Mapa livre (mínimo 70%) | Trocar fundo | Trocar camada | Ir para km | Abrir Exportar | Abrir Projetos |
|---|---|---|---|---|---|---|
| 360x640 | 80,4% | 2 toques | 2 toques | 2 toques | 2 toques | 2 toques |
| 390x844 | 85,4% | 2 toques | 2 toques | 2 toques | 2 toques | 2 toques |
| 412x915 | 86,5% | 2 toques | 2 toques | 2 toques | 2 toques | 2 toques |
| 915x412 | 82,2% | 2 toques | 2 toques | 2 toques | 2 toques | 2 toques |

## Corrigido (P1 e P2 da primeira rodada)

| Viewport | Estado | Problema | Gravidade | Correção |
|---|---|---|---|---|
| 360x640 a 600x960 | gaveta cheia | coluna do polegar (GPS, tela limpa) saía da tela e cobria o botão Mapa | P1 | some com a gaveta cheia em retrato |
| 360x640 a 915x412, 600x960 | offline | selo Offline não aparecia no celular | P2 | selo próprio abaixo da barra superior |
| 412x915 a 1024x768 | Ajustes | botões 400/500/700 ms encolhiam abaixo do texto e se sobrepunham | P2 | botões segmentados não encolhem; a linha quebra |
| 768x1024 a 1180x820 | todos | subtítulo do título (área de toque estendida) cruzava o campo "Ir para km" | P2 | respiro de 6 px |
| 768x1024 a 1024x768 | mapa | botão "Entendi" do aviso de zoom com 36 px de altura | P2 | 44 px |
| 360x640, 390x844 | todos | chip de localização truncado ("BR-900 · GO km 170+040") | P2 | km primeiro; rodovia só acima de 400 px |
| todos | dashboard | cartões truncavam "km 164+000 a 181+000 · 17,0 km" e o resumo se sobrepunha | P2 | texto quebra; resumo em linhas flexíveis |

## P3 (não corrigidos)

| Viewports | Problema | Motivo |
|---|---|---|
| 360x640 a 600x960 | resumo da gaveta fechada (`#gavTxt`) e legenda de cores (`#gavCores`) truncados com reticências | resumo compacto de uma linha por desenho; o texto completo está na gaveta aberta |
| 1180x820, 1366x768, 1920x1080 (sem toque) | 120 controles com 28 a 40 px de altura (botões de 32 px, chaves de 46x28, abas de 32 px) | tamanho de desktop com mouse; os alvos de 44 px valem para toque, onde estão cumpridos |

Observações da ferramenta: em 1920x1080 a pressão longa sintética do script às vezes não abre o menu (abre pelo botão direito, que o script usa como alternativa); a pressão longa real é coberta pela suíte e2e.
