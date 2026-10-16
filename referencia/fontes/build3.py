"""Gera index3.html a partir de template3.html.
Uso: python3 build3.py  (precisa de node_modules/maplibre-gl e dos arquivos .gz.b64 em ../dados)
Os .gz.b64 são os JSON gzipados e em base64: gzip -9 -c x.json | base64 -w0 > x.gz.b64
"""
import json,os
b=os.path.dirname(os.path.abspath(__file__))
t=open(os.path.join(b,'template3.html'),encoding='utf-8').read()
css=open(os.path.join(b,'node_modules/maplibre-gl/dist/maplibre-gl.css'),encoding='utf-8').read()
emb={k:open(os.path.join(b,'..','dados',k+'.gz.b64')).read().strip() for k in ['mg_c','mg_d','mg_ms','go_c','go_d']}
open(os.path.join(b,'index3.html'),'w',encoding='utf-8').write(t.replace('__MLCSS__',css).replace('__EMBED__',json.dumps(emb)))
