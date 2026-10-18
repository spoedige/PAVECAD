"""Monta, por tema, a folha antes x depois nas três visões (normal, deuteranopia, protanopia).
Uso: python3 cores-montagem.py <pasta com antes_*.png e depois_*.png> <saida>
Simulação: Machado et al. 2009, severidade 1, aplicada em RGB linear."""
import sys, os
import numpy as np
from PIL import Image, ImageDraw

pasta, saida = sys.argv[1:3]
os.makedirs(saida, exist_ok=True)
M = {
    'normal': None,
    'deuteranopia': np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]),
    'protanopia': np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]),
}

def lin(c): c = c / 255.0; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def gam(c): c = np.clip(c, 0, 1); return 255 * np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)

def sim(im, m):
    if m is None: return im
    a = lin(np.asarray(im.convert('RGB'), dtype=float)) @ m.T
    return Image.fromarray(gam(a).round().astype('uint8'))

CW, CH = 1000, 120
TOMADAS = [('A1', 'Planservi sintético, trecho 1'), ('A2', 'Planservi sintético, trecho 2'), ('B', 'RoadRunner (GO anonimizado)')]
for tema in ['claro', 'escuro', 'campo']:
    linhas = []
    for cena, titulo in TOMADAS:
        for visao, m in M.items():
            par = []
            for v in ['antes', 'depois']:
                f = os.path.join(pasta, f'{v}_{cena}_{tema}.png'); fl = os.path.join(pasta, f'{v}_{cena}_{tema}_leg.png')
                if not os.path.exists(f): par = None; break
                im = Image.open(f).convert('RGB'); w, h = im.size
                mapa = sim(im.crop((w // 2 - CW // 2, h // 2 - CH // 2, w // 2 + CW // 2, h // 2 + CH // 2)), m)
                leg = sim(Image.open(fl).convert('RGB'), m)
                par.append((mapa, leg))
            if par: linhas.append((titulo, visao, par))
    if not linhas: continue
    legw = max(l.size[0] for _, _, p in linhas for _, l in p); legh = max(l.size[1] for _, _, p in linhas for _, l in p)
    cell_h = max(CH, legh)
    W = 120 + 2 * (CW + legw + 16) + 10; H = 40 + len(linhas) * (cell_h + 22)
    folha = Image.new('RGB', (W, H), (36, 36, 40)); d = ImageDraw.Draw(folha)
    d.text((10, 8), f'Tema {tema}: antes (esquerda) e depois (direita), padrão além da cor ligado', fill=(255, 255, 255))
    d.text((130, 24), 'ANTES', fill=(255, 210, 120)); d.text((130 + CW + legw + 16, 24), 'DEPOIS', fill=(120, 220, 160))
    y = 40
    for titulo, visao, par in linhas:
        d.text((6, y + 4), f'{titulo}\n{visao}', fill=(200, 200, 210))
        for k, (mapa, leg) in enumerate(par):
            x = 120 + k * (CW + legw + 16)
            folha.paste(mapa, (x, y)); folha.paste(leg, (x + CW + 8, y))
        y += cell_h + 22
    folha.save(os.path.join(saida, f'cores-{tema}.png'))
    print('ok', tema, folha.size)
