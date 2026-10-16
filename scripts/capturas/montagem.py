"""Monta a folha de contato (3 temas x 4 viewports) de uma rodada de capturas.
Uso: python3 montagem.py <pasta> <cenario> <saida.png>"""
import sys, glob, os
from PIL import Image, ImageDraw

pasta, cen, saida = sys.argv[1:4]
VPS = ['1568x760', '1366x768', '1920x1080', 'tablet-h-1024x768', 'tablet-v-820x1180']
TEMAS = ['claro', 'escuro', 'campo']
VPS = [v for v in VPS if os.path.exists(os.path.join(pasta, f'{cen}_{v}_claro.png'))] or VPS
CW, CH, PAD, TOP = 560, 340, 10, 22
W = len(TEMAS) * (CW + PAD) + PAD
H = len(VPS) * (CH + TOP + PAD) + PAD + 26
folha = Image.new('RGB', (W, H), (40, 40, 44))
d = ImageDraw.Draw(folha)
d.text((PAD, 6), f'{os.path.basename(os.path.dirname(pasta.rstrip("/")))} / {os.path.basename(pasta.rstrip("/"))} / {cen}', fill=(255, 255, 255))
for r, vp in enumerate(VPS):
    for c, tema in enumerate(TEMAS):
        f = os.path.join(pasta, f'{cen}_{vp}_{tema}.png')
        x = PAD + c * (CW + PAD)
        y = 26 + PAD + r * (CH + TOP + PAD)
        d.text((x, y), f'{vp}  {tema}', fill=(200, 200, 210))
        if not os.path.exists(f):
            continue
        im = Image.open(f).convert('RGB')
        im.thumbnail((CW, CH), Image.LANCZOS)
        folha.paste(im, (x, y + TOP))
folha.save(saida)
