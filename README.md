# PaveCAD

Mapa de soluções de restauração a partir de planilhas de unifilar. Vite + TypeScript.

```
npm install
npm run dev        # mapa; carregue planilhas .xlsx em "Planilhas"
npm test           # vitest (leitura e geometria)
npm run typecheck
```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/formats/` | Registro `FORMATS` (um item por padrão de planilha), modelo normalizado, trechos e marcos. Primeiro padrão: RoadRunner. |
| `src/geometry/` | Núcleo de geometria sem dependência de mapa: UTM SIRGAS 2000, normais, polígonos por faixa e drenos. `geojson.ts` adapta para MapLibre. |
| `src/mapa/` | Camadas GeoJSON (`camadas.ts`) e worker que lê a planilha e calcula a geometria fora da thread da tela. |
| `src/app/` | Mapa MapLibre, legenda, dicas, estacas, rotação e estado da aplicação. |
| `src/dominio/` | Indicadores e classes, catálogo padrão de soluções, modelo por linha. |
| `testes/` | Testes com as planilhas BR-050/GO em `testes/fixtures/`. |
| `referencia/` | Protótipo (`fontes/template3.html`, `index3.html`), leitor Python, handoffs e JSON das 5 planilhas de exemplo. Não é código do app. |

## Regras de leitura (handoff v3.2)

- Acostamento 0 no primeiro ponto de um trecho assume o próximo valor diferente de zero do mesmo trecho.
- Linha da Solução sem par no Unifilar é ignorada e registrada no log de importação.
- Km exibido vem do marco da coluna 14, normalizado por metros totais (`9+1000` vira `10+000`).
- Drenos: as colunas 15 e 16 da Solução são lidas e unidas. A 15 vem sempre vazia nas planilhas conferidas, e os nomes "Crescente" e "Decrescente" dessas colunas não descrevem o sentido da pista. Significado de `R` e `P` ainda não confirmado: exibir o texto como está.
- Qualquer código principal alfanumérico é aceito. Os códigos lidos ficam em `ParsedProject.codes` para alimentar o catálogo de soluções.

## Preparação para KMZ e IFC

O núcleo de geometria devolve polígonos em metros projetados (`Project.crs`, EPSG 31982 ou 31983). `Row.z` existe e fica vazio até haver perfil longitudinal. `Row.he`, `Lane.fsEsp` e `Lane.gapCm` guardam as espessuras da planilha.

## Próximos passos

Renderização MapLibre, catálogo de soluções editável, largura de faixa editável por projeto e por km, e interface, migrando de `referencia/fontes/template3.html`.
