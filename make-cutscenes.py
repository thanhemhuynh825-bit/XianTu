# -*- coding: utf-8 -*-
"""压缩过场素材：D:\Desktop\仙途 过场素材1-4.png → public/cutscenes/1-4.webp
输出 1600x900 WebP（约 300KB/张），原图保留不动"""
from PIL import Image
import os

SRC_DIR = r'D:\Desktop'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'cutscenes')
os.makedirs(OUT, exist_ok=True)

for i in range(1, 5):
    src = os.path.join(SRC_DIR, f'仙途 过场素材{i}.png')
    if not os.path.exists(src):
        print('缺失:', src)
        continue
    img = Image.open(src).convert('RGB')
    img = img.resize((1600, 900), Image.LANCZOS)
    dst = os.path.join(OUT, f'{i}.webp')
    img.save(dst, 'WEBP', quality=80, method=6)
    print(f'{i}.webp {os.path.getsize(dst)/1024:.0f}KB')
print('完成')
