#!/usr/bin/env bash
# Regenera os fixtures anonimizados a partir de dados-reais/ (pasta ignorada pelo git). Os arquivos reais nunca entram no repositório.
set -euo pipefail
cd "$(dirname "$0")/.."
R=dados-reais; F=testes/fixtures
node scripts/anonimizar.cjs planservi  $R/planservi_TH50.xlsx $F/planservi_amostra_1.xlsx --codigo TH01 --km 10
node scripts/anonimizar.cjs planservi  $R/planservi_TH51.xlsx $F/planservi_amostra_2.xlsx --codigo TH02 --km 60
node scripts/anonimizar.cjs roadrunner $R/U_BR-050_GO_Crescente.xlsx   $F/rr_go_crescente.xlsx
node scripts/anonimizar.cjs roadrunner $R/U_BR-050_GO_Decrescente.xlsx $F/rr_go_decrescente.xlsx
for j in go_c go_d mg_c mg_d mg_ms; do node scripts/anonimizar.cjs json $R/$j.json referencia/dados/$j.json; done
