# -*- coding: utf-8 -*-
"""头像压缩：D:\Desktop 中「仙途头像」开头的两张 → public/avatars/male|female.webp"""
import os
from PIL import Image, ImageDraw

SRC_DIR = r'D:\Desktop'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'avatars')
os.makedirs(OUT, exist_ok=True)

found = {}
for f in os.listdir(SRC_DIR):
    if ('头像' in f) and f.endswith('.png'):
        if '女' in f:
            found['female'] = os.path.join(SRC_DIR, f)
        elif '男' in f:
            found['male'] = os.path.join(SRC_DIR, f)
print('找到:', found)

for name, src in found.items():
    img = Image.open(src).convert('RGB')
    s = min(img.size)
    img = img.crop(((img.width - s) // 2, (img.height - s) // 2, (img.width + s) // 2, (img.height + s) // 2))
    img = img.resize((160, 160), Image.LANCZOS)
    mask = Image.new('L', (160, 160), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 160, 160), fill=255)
    out = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    dst = os.path.join(OUT, f'{name}.webp')
    out.save(dst, 'WEBP', quality=85, method=6)
    print(f'{name}.webp {os.path.getsize(dst)/1024:.0f}KB')
print('完成')

