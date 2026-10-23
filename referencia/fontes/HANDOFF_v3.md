# Mapa de Soluções de Restauração: handoff para o Claude Code

Protótipo de referência: `mapa-solucoes-prototipo.html` (arquivo único, MapLibre GL 4.7.1 e SheetJS 0.18.5 via CDN).
Extração de referência em Python: `extract.py` (mesmo mapeamento de colunas que o JavaScript do protótipo).

## Objetivo

Ler a planilha padrão de unifilar de restauração (abas `Unifilar` e `Solução`) e mostrar, em mapa, cada faixa de cada segmento de 20 m com sua solução e seus parâmetros. Coloração por solução, IRI, ATR, D0, Rc e % de defeitos. Painel lateral por segmento e unifilar de km na base.

## Contrato de dados (planilha exemplo BR-900/MG Crescente)

Índices de coluna começam em 0. Linhas de dados: aba `Unifilar` a partir da linha 11 (índice 10), filtrando linhas com número na coluna 13. Aba `Solução` a partir da linha 10, filtrando número na coluna 2. O vínculo entre as abas é o hodômetro em metros (`round(km*1000)`).

| Aba | Coluna | Conteúdo |
|---|---|---|
| Unifilar | 13 | Hodômetro contínuo (km) |
| Unifilar | 15, 16 | Latitude, longitude (na borda esquerda da Fx 1, 0 m da seção) |
| Unifilar | 19 | Observação |
| Unifilar | 176 a 181 | Largura de Fx 1 a Fx 6 (m). Faixa existe se largura > 0 |
| Unifilar | 182 | Largura do acostamento externo (m) |
| Unifilar | 21 + 17(n−1) | Bloco da faixa n: IRI (+0), % defeitos (+1, fração 0 a 1), ATR máx (+2), O/P/R/D (+3), EX/AF/E (+4), HR (+5), D0 (+6), Rc (+7), D120 (+8), depois 7 colunas de tratamento (+9 a +15: Estrutural, Fresagem funcional, Fresagem estrutural, Selagem, Microfresagem, Fresagem fina, Revestimento) |
| Solução | 2 | km inicial do segmento |
| Solução | 7 a 12 | Código da solução em Fx 1 a Fx 6 (`FSE(50%)+Micro`, `FS4(100%)`, `GAP(3,0)`, `MFS+Micro`, `RP`, `Micro`) |
| Solução | 13 | Solução do acostamento (`Micro`, `GAP(3,0)`) |
| Solução | 21 | Plataforma / observação (por exemplo OAE) |
| Solução | C2, C3, C4 | Rodovia, km inicial, km final |

Interpretação do código da solução: tratamento principal (`MFS`, `FS4`, `FSE`, `RP`, `Micro`, `GAP`), percentual de área entre parênteses quando existir (50% ou 100%), e complemento após o `+`.

Descontinuidades: o exemplo tem dois trechos contínuos (km 0 a 65,78 e km 135 a 179,98). Quebrar em trechos quando a diferença entre hodômetros consecutivos for maior que 21,5 m e nunca ligar pontos entre trechos.

## Geometria: deslocamento lateral por faixa

Premissa confirmada: a coordenada está na borda esquerda da Fx 1 (0 m da seção) e as faixas crescem para a direita no sentido do tráfego. O acostamento externo (2,5 m) fica depois da última faixa.

Para cada ponto i de um trecho:

1. Azimute local `θ = atan2(ΔE, ΔN)` entre os pontos `i−w` e `i+w` (w = 2 no protótipo, 40 m), em metros locais (`mLon = 111320·cos(lat)`, `mLat = 111132`).
2. Normal à direita: `nE = cos θ`, `nN = −sin θ`.
3. Bordas acumuladas: `e0 = 0`, `e(n) = e(n−1) + largura(n)`. Acostamento: de `e(N)` a `e(N) + largura_acostamento`.
4. Posição deslocada: `lon = lon_i + e·nE/mLon`, `lat = lat_i + e·nN/mLat`.
5. Polígono da faixa n no segmento i, i+1: bordas `e(n−1)` e `e(n)` nos dois pontos, formando um quadrilátero. Com isso as faixas ficam coladas, sem sobreposição.

Opções que o protótipo expõe para teste: sentido de crescimento (direita ou esquerda), coordenada na borda ou no eixo da Fx 1, suavização do azimute (±1, ±2, ±4 pontos) e mostrar ou ocultar acostamento.

Verificado no exemplo: raio mínimo de curva estimado de cerca de 75 m, bem acima do deslocamento máximo de 9,7 m. Em alças e ramos de interseção com raio menor que o deslocamento, o polígono se inverte. Tratar quando o projeto tiver esses elementos.

## Renderização

- Fonte GeoJSON com `tolerance: 0`. Sem isso, o MapLibre simplifica segmentos de 20 m a nada em zoom baixo.
- Duas camadas visuais: polígonos reais (visíveis a partir de cerca de zoom 15,5) e linhas por faixa com `line-offset` em pixels (visão geral). Cruzamento de opacidade entre os zooms 15,6 e 16,6.
- Cada feature carrega classes pré-calculadas (`c_iri`, `c_atr`, `c_d0`, `c_rc`, `c_def`, valores 0 a 4, −1 sem leitura) e `main`/`pct` da solução. Trocar o modo de cor só troca a expressão de pintura, sem recarregar dados.
- Cerca de 16 mil polígonos para 2 faixas + acostamento em 110 km. Com 6 faixas e 180 km, avaliar vector tiles (tippecanoe ou geojson-vt em worker).

## Limiares de classe usados (ajustar ao critério do projeto)

- IRI (m/km): ≤1,5 · ≤2,0 · ≤2,7 · ≤3,5 · >3,5
- ATR (mm): ≤3 · ≤5 · ≤8 · ≤12 · >12
- D0 (0,01 mm): ≤20 · ≤30 · ≤40 · ≤50 · >50
- Rc (m): ≥500 · ≥300 · ≥200 · ≥150 · <150
- % defeitos: 0 · ≤5% · ≤15% · ≤30% · >30%

## Pendências e próximos passos

1. Base de mapa: o artefato bloqueia imagens externas. No deploy próprio (Vercel), ligar OSM e satélite (já há fontes e seletor no código).
2. Hachura por tratamento (`fill-pattern` com texturas geradas em canvas) para diferenciar 50% e 100% de área sem depender de opacidade.
3. Inventário de defeitos pontuais (como "Fissura de canto", "Placa 208" da tela de referência). A planilha exemplo só traz parâmetros e soluções por segmento de 20 m. Definir a aba de origem desses dados (km, faixa, tipo, severidade).
4. Pista decrescente: repetir a regra com o arquivo próprio (coordenada na borda esquerda no sentido do tráfego). Confirmar a convenção.
5. Aba `Quantidades` e `Orçamento`: ligar o resumo do painel às quantidades já calculadas na planilha, em vez de recalcular por área.
6. Unifilar: hoje agrega por pixel pegando a pior classe. Para zoom no unifilar, usar janela de km.
7. Validar a leitura de `.xlsx` com planilhas de outros projetos (número de faixas, abas ausentes, linhas em branco).

## Interface (versão 2, estilo Apple)

- Mapa em tela cheia, controles e painéis flutuando com vidro fosco (`backdrop-filter`), raios de 12 a 16 px, sombras suaves.
- Tokens de cor no `:root`, claro primeiro, escuro em `prefers-color-scheme` e `data-theme`. Cores semânticas do sistema iOS (verde, amarelo, laranja, vermelho) para classes de qualidade.
- Controle segmentado com pílula deslizante (modos de cor, abas do painel, seletor de faixa).
- Legenda interativa: clicar em um item oculta ou isola aquela classe no mapa e no unifilar.
- Dica flutuante ao passar o mouse sobre uma faixa (km, faixa e valor do modo ativo).
- Painel do segmento com anterior e próximo, copiar localização e escala de 5 classes sob cada parâmetro.
- Lista "Maiores" (ou "Menores" para Rc) do parâmetro ativo, clicável.
- Atalhos: setas esquerda e direita navegam segmentos (Shift pula 200 m), setas para cima e para baixo trocam de faixa, 1 a 6 trocam a cor, `/` foca "Ir para km", Esc limpa a seleção.
- Unifilar com cursor de km ao passar o mouse e janela da vista atual do mapa.
- Celular: o painel e o unifilar descem para baixo do mapa em largura única.

## Atualização v3: padrão RoadRunner, várias planilhas, campo

Arquivos: `index3.html` (protótipo), `template3.html` + `build3.py` (fonte), `extract_roadrunner.py` (adaptador Python), JSON das 5 planilhas de exemplo.

**Padrão RoadRunner.** É o modelo de planilha com abas `Unifilar` e `Solução` descrito acima. No código, `FORMATS` é o registro de padrões: cada item tem `detect(wb)` e `parse(wb)` e devolve `{meta, rows}`. Novo padrão = novo item, sem mexer no resto. Linha normalizada: `[hod, lat, lon, larguras[], acostamento, solAcost, obs, obsPlataforma, faixas[], marco, dreno, [heC,heD]]`.

**Sentido e várias planilhas.** Cada planilha vira um projeto com `travel` (+1 crescente, −1 decrescente, lido do nome). Nas decrescentes as linhas vêm em km crescente, então a normal lateral é invertida. Marginal Sul usa as mesmas coordenadas da pista principal; entra com deslocamento adicional de 12 m (editável em Ajustes). Confirmar a posição real.

**Km exibido.** Usar o rótulo de marco da coluna 14 do Unifilar (`59+940`), normalizado por metros totais (`9+1000` vira `10+000`). O hodômetro contínuo só serve para o vínculo entre abas.

**Drenos.** Solução col 15 (Crescente) e 16 (Decrescente) marcam presença; col 18/19 trazem o tipo (R ou P). Desenho: linha rosa na borda externa, cheia para R, tracejada para P. Lado: coluna Crescente no lado direito do sentido de tráfego, coluna Decrescente no esquerdo, com opção de inverter. Significado de R e P e o lado real precisam ser confirmados.

**Anotações.** Ponto, linha, área e medição. Categoria, texto e até 4 fotos (JPEG reduzido). Persistência em IndexedDB, exportação e importação GeoJSON. Vínculo automático com planilha, km e faixa quando o ponto cai na pista.

**GPS.** `watchPosition` com alta precisão, projeção do ponto na normal local para achar planilha, km e faixa, modo seguir, `wakeLock`. Exige HTTPS e permissão do navegador.

**Modo campo (sol).** `data-contrast="field"`: fundo branco, texto preto, bordas de 1,5 px, sem transparência, paleta saturada (`Q5F`, `TR.f`), alvos de toque de 44 px, fonte 15 px. Lembrado em localStorage.

**Aba Análise.** Matriz solução × classe do indicador (IRI, ATR, D0, Rc, defeitos), barras empilhadas por classe e seis regras de coerência provisórias. Clique em célula ou regra filtra o mapa via `feature-state`.

**Para o deploy (Claude Code).**
1. Base de mapa: OSM só para teste, tem política de uso. Produção: provedor com chave (MapTiler, Mapbox) ou tiles próprios.
2. PWA offline: service worker, cache do app e dos tiles da área da obra. Essencial em campo sem sinal.
3. Dados grandes: planilha de 14 MB demora na leitura no navegador. Melhor converter no servidor para JSON e ler o JSON.
4. Mais de 30 mil polígonos: avaliar vector tiles.
5. Sincronização das notas entre aparelhos (hoje só exportação manual).
6. Pendências de regra: limiares de classe, regras de coerência, origem do inventário de defeitos pontuais.

**Estacas.** Rótulos por zoom, calculados no entorno da vista (`updateStakes`): 500 m a partir do zoom 14, 100 m a partir de 15,8 e 20 m (uma estaca) a partir de 18,2. Cada estaca tem um traço cruzando todas as faixas e um rótulo `km+metros` na borda externa do sentido (esquerda na crescente, direita na decrescente). Marcos de km inteiros em azul. Ligado e desligado em Ajustes, Camadas.

## Atualização v3.1

**Drenos.** Sempre no lado externo da pista (borda direita do sentido de tráfego, depois do acostamento). As duas colunas da planilha (Crescente e Decrescente) são unidas: vale o tipo da primeira preenchida. Passar o mouse mostra tipo, extensão e km inicial e final; clicar abre o segmento. Em Ajustes dá para trocar para lado interno.

**Legenda.** Compacta, nomes abreviados, recolhível (lembra o estado em localStorage). Fechada vira uma faixa de pontos coloridos.

**Propor solução (substitui régua, linha e área).** Botão no alto do mapa ou tecla N. Modo "Solução inteira" seleciona o trecho contínuo com o mesmo código de solução na faixa clicada; modo "20 m" seleciona um segmento. Cliques seguidos montam um lote. Escolhe-se a nova solução (FS3, FS4, FSE, MFS, RP, REC, Micro, GAP, sem intervenção) e uma observação. A proposta aparece sobre o mapa na cor da nova solução, com contorno tracejado, e na aba Revisão (de, para, km, extensão, área, totais por solução, CSV com `;` para o Excel). Propostas ficam em IndexedDB (store `props`) ligadas ao nome da planilha, então voltam ao reabrir. Uma proposta nova sobre área já proposta substitui só a parte sobreposta.
Pendente para o deploy: sincronizar propostas entre aparelhos, exportar para planilha de volta ao padrão RoadRunner, e regra de custo (quantidade x preço unitário por solução).

**Rotação.** Arrastar com botão direito, girar com dois dedos no tablet, ou usar os botões (15 graus, tecla Q e E), norte para cima e "Alinhar à pista" (tecla R), que deixa o sentido de tráfego do trecho selecionado, ou do mais próximo do centro, apontando para cima. Rótulos continuam na horizontal.

## Atualização v3.2: respostas da leitura das planilhas GO e novos requisitos

### Respostas aos pontos levantados na conferência das planilhas GO
1. **Acostamento zero na primeira linha:** usar o valor de cada linha. Quando for 0 no primeiro ponto de um trecho, assumir o próximo valor diferente de zero do mesmo trecho.
2. **Linha extra na Solução (851 contra 850):** ignorar linhas da Solução sem par no Unifilar e registrar no log de importação ("1 linha ignorada").
3. **Marco `180+1000` e `181+0`:** normalizar por metros totais, como no protótipo (`9+1000` vira `10+000`).
4. **Drenos:** conferi as cinco planilhas. Todos os drenos estão só na coluna 16 (tipo na coluna 19). A coluna 15 nunca é preenchida, em nenhuma pista. Portanto os nomes "Crescente" e "Decrescente" dessas colunas não descrevem o sentido da pista. Regra: ler as duas colunas, unir, desenhar no lado externo. Significado de R e P ainda não confirmado: exibir o texto como está. Confirmar com quem montou a planilha.
5. **FS3, REC, RP+GAP:** o protótipo já aceita. O parser deve aceitar qualquer código principal (letras e números) e cadastrar o que não conhecer no catálogo de soluções (item abaixo).
6. **Base do projeto:** reaproveitar `index3.html` (já testado em claro, escuro, campo e celular) e separar em módulos: leitura (`FORMATS`), geometria, catálogo, renderização e interface. Os arquivos `template3.html`, `build3.py` e `extract_roadrunner.py` precisam ir para o repositório.

### Tela de configurações (separada do mapa)
**Catálogo de soluções.** Tabela editável, uma linha por código principal encontrado nas planilhas.
- Colunas: código original (somente leitura), nome exibido, nome curto, cor, categoria (por exemplo restauração, reforço, reparo), contagem de ocorrências.
- Exemplo pedido: `GAP` exibido como "Reforço" (ou "Reforço (gap graded)"). Só muda o rótulo. O código original continua nas exportações, porque gap graded é um tipo de mistura e reforço é uma função.
- Código novo, nunca visto: entra automaticamente como "Não mapeado", cinza, com selo e um aviso "3 códigos sem cadastro". Um clique abre a edição.
- O alias é aplicado só na camada de exibição. Os dados lidos da planilha não são alterados.
- Salvar e carregar o catálogo em JSON (por organização ou por projeto). Padrões futuros de planilha trazem o próprio catálogo inicial.
- Mesma tela, outras abas: limiares de classe (IRI, ATR, D0, Rc, defeitos), regras de coerência, base de mapa.

### Largura das faixas editável
- A planilha traz a largura por segmento (colunas 176 a 181) e o acostamento (182). Isso vira o valor padrão.
- Hierarquia de sobreposição: planilha, depois largura por projeto e faixa, depois largura por intervalo de km e faixa. Exemplo: Fx 1 com 3,50 m do km 120 ao 135.
- Também editáveis: largura do acostamento e posição da coordenada (borda ou eixo da Fx 1).
- Alterar a largura recalcula geometria, áreas e quantidades do painel. Aviso na tela: "quantidades da planilha original não mudam".
- Desenho: tabela com projeto, faixa, intervalo, largura, e uma pré-visualização da seção transversal.

### Preparação para KML/KMZ e IFC (não implementar agora)
**Princípio:** separar o núcleo de geometria do mapa. Uma função pura recebe linhas, larguras e opções e devolve, para cada segmento e faixa, um polígono em metros locais com atributos (solução, parâmetros, camadas). MapLibre, KML e IFC consomem esse mesmo resultado.

**Preparar já, sem custo:**
- Guardar junto de lat/lon o sistema de coordenadas projetado do projeto (SIRGAS 2000 UTM, fuso 22S ou 23S conforme o trecho). IFC e topografia trabalham em metros projetados.
- Campo opcional `z` (cota do eixo) em cada ponto, vazio por enquanto.
- Guardar as espessuras já presentes na planilha: revestimento existente (He), profundidade de fresagem (cm) e gap graded (cm). Dão a variação de altura por faixa.
- Modelo de camadas por faixa (existente e proposta) em vez de só um código de solução.

**KML e KMZ:** viável direto. Um polígono por segmento e faixa, estilo por solução (cores do catálogo), dados estendidos com km, faixa, solução e parâmetros, pastas por planilha e por faixa. KMZ é o KML compactado. Estacas e drenos como linhas e pontos.

**IFC e eixo Z:**
- O formato certo é IFC4x3, que tem `IfcAlignment` (traçado horizontal e perfil vertical), `IfcRoad` e `IfcPavement` com camadas (`IfcCourse`). As faixas viram sólidos varridos ao longo do alinhamento.
- A cota existente não está nas planilhas. Fontes possíveis: perfil longitudinal do projeto geométrico (CSV, LandXML ou exportação do Civil 3D), levantamento com laser ou drone. Modelo digital de terreno aberto (SRTM, Copernicus) tem erro de metros e não serve para gabarito.
- Altura pós-restauração por faixa: cota existente, mais espessura nova (reforço, gap, revestimento), menos espessura fresada. As espessuras já estão na planilha.
- Gabarito vertical de uma OAE: cota inferior da OAE menos a cota nova do pavimento. A cota da OAE não existe na planilha e precisaria de cadastro (km, cota da face inferior, vão).
- Ferramentas: IfcOpenShell (Python, no servidor) para gerar o arquivo; web-ifc ou That Open para visualizar no navegador. Gerar IFC no servidor é mais seguro que no navegador.
- Validação: abrir o resultado em um leitor (por exemplo BIMvision ou Solibri) e conferir a cota sobre o perfil existente.
