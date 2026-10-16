# PaveCAD

Mapa de soluções de restauração a partir de planilhas de unifilar. Vite + TypeScript.

```
npm install
npm run dev        # mapa; carregue .xlsx em "Planilhas". Em desenvolvimento há também "Carregar exemplo" (referencia/dados)
npm test           # vitest (leitura, geometria, domínio, configurações)
npm run typecheck
```

## Testes de interface e capturas

Com o servidor de desenvolvimento rodando (`npm run dev -- --port 5199`) e o Chromium do Playwright instalado:

```
npm run e2e                       # testes de interface (Playwright) por grupo de correção
npm run capturas -- g01 antes     # 4 viewports x 3 temas, 2 planilhas; folha de contato em capturas/ (fora do git)
```

As capturas também rodam um verificador de sobreposição e corte de texto (`scripts/capturas/overlap.js`). O gancho `window.__pavecad` existe só em desenvolvimento.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/formats/` | Registro `FORMATS` (um item por padrão de planilha), modelo normalizado, trechos e marcos. Primeiro padrão: RoadRunner. |
| `src/geometry/` | Núcleo de geometria sem dependência de mapa: UTM SIRGAS 2000, normais, polígonos por faixa e drenos. `geojson.ts` adapta para MapLibre. |
| `src/mapa/` | Camadas GeoJSON (`camadas.ts`) e worker que lê a planilha e calcula a geometria fora da thread da tela. |
| `src/app/` | Mapa MapLibre, painéis (Resumo, Segmento, Análise, Revisão, Ajustes), unifilar, GPS, modo campo, IndexedDB e estado. |
| `src/dominio/` | Indicadores e classes, catálogo padrão de soluções, análise, propostas, localização e medidas (puros, testados). |
| `testes/` | Testes com as planilhas BR-050/GO em `testes/fixtures/`. |
| `referencia/` | Protótipo (`fontes/template3.html`, `index3.html`), leitor Python, handoffs e JSON das 5 planilhas de exemplo. Não é código do app. |

## Base do mapa

A base usa o MapTiler quando `VITE_MAPTILER_KEY` está definida no ambiente de build (painel da Vercel, ou `.env.local` em desenvolvimento; veja `.env.example`). Sem a chave, cai no OpenStreetMap (ruas) e na Esri (satélite). A chave nunca entra no repositório. Como todo token de tiles em app de navegador, ela fica visível no bundle: restrinja-a ao domínio do app no painel do MapTiler.

## Deploy na Vercel

1. Na Vercel: **Add New > Project**, importe `spoedige/pavecad`. O `vercel.json` já define o framework (Vite), o build (`npm run build`) e a saída (`dist`), além dos cabeçalhos do service worker.
2. Branch de produção: a que você escolher no projeto (a Vercel gera um endereço de preview para cada branch).
3. **Variável do MapTiler** (quando tiver a chave): Vercel > projeto > **Settings > Environment Variables** > nome `VITE_MAPTILER_KEY`, valor da chave, ambientes Production e Preview > Save > **Deployments > Redeploy**. É variável de build: só vale depois de um novo deploy. Sem ela, o app usa OpenStreetMap e Esri.
4. No painel do MapTiler: **Account > API keys >** a chave > **Allowed HTTP origins**, e cadastre o domínio do app (e o domínio de preview, se for usá-lo). A chave aparece no bundle, então a restrição por domínio é o que a protege.
5. HTTPS é automático na Vercel, e o GPS do aparelho só funciona com HTTPS.

## Uso sem internet (PWA)

O build gera um service worker que guarda o app inteiro (HTML, código, worker de cálculo, ícones, fontes) e os tiles do mapa que você já viu (até 3.000 tiles ou 30 dias). As planilhas abertas ficam no IndexedDB e reabrem sem o arquivo. Para campo: abra o app com sinal uma vez, abra as planilhas, percorra o trecho no mapa (ou use a base lisa) e instale na tela inicial. Não há download em massa de tiles: as políticas do OpenStreetMap e da Esri proíbem, e o MapTiler depende do plano contratado.

## Dados salvos no aparelho

Anotações (com fotos reduzidas), propostas de solução, planilhas abertas e configurações (catálogo, limiares, larguras) ficam no IndexedDB (`pavecad`: `notes`, `props`, `projetos`, `config`). As propostas se ligam à planilha pelo nome e ao trecho pelo km (marco normalizado), não pelo índice da linha: se a planilha mudar, elas se reposicionam; se o km sumir, aparecem como órfãs na aba Revisão, sem apagar. Modo campo e legenda recolhida ficam no localStorage.

## Regras de leitura (handoff v3.2)

- Acostamento 0 no primeiro ponto de um trecho assume o próximo valor diferente de zero do mesmo trecho.
- Linha da Solução sem par no Unifilar é ignorada e registrada no log de importação.
- Km exibido vem do marco da coluna 14, normalizado por metros totais (`9+1000` vira `10+000`).
- Drenos: as colunas 15 e 16 da Solução são lidas e unidas. A 15 vem sempre vazia nas planilhas conferidas, e os nomes "Crescente" e "Decrescente" dessas colunas não descrevem o sentido da pista. Significado de `R` e `P` ainda não confirmado: exibir o texto como está.
- Qualquer código principal alfanumérico é aceito. Os códigos lidos ficam em `ParsedProject.codes` para alimentar o catálogo de soluções.

## Preparação para KMZ e IFC

O núcleo de geometria devolve polígonos em metros projetados (`Project.crs`, EPSG 31982 ou 31983). `Row.z` existe e fica vazio até haver perfil longitudinal. `Row.he`, `Lane.fsEsp` e `Lane.gapCm` guardam as espessuras da planilha.

## Próximos passos

Exportação KMZ e IFC (a estrutura já está separada: geometria em metros projetados, campo `z` vazio), regras de coerência editáveis, sincronização de notas e propostas entre aparelhos.
