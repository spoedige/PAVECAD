"""Gera index3.html a partir de template3.html.
Uso: python3 build3.py  (precisa de node_modules/maplibre-gl e dos JSON em ../dados)
Os dados vêm dos JSON anonimizados de ../dados (gzip + base64 feitos aqui). index3.html não é versionado.
"""
import json,os,gzip,base64
b=os.path.dirname(os.path.abspath(__file__))
t=open(os.path.join(b,'template3.html'),encoding='utf-8').read()
css=open(os.path.join(b,'node_modules/maplibre-gl/dist/maplibre-gl.css'),encoding='utf-8').read()
emb={k:base64.b64encode(gzip.compress(open(os.path.join(b,'..','dados',k+'.json'),'rb').read(),9)).decode() for k in ['mg_c','mg_d','mg_ms','go_c','go_d']}
open(os.path.join(b,'index3.html'),'w',encoding='utf-8').write(t.replace('__MLCSS__',css).replace('__EMBED__',json.dumps(emb)))
