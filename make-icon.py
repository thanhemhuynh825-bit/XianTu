# -*- coding: utf-8 -*-
"""生成《仙途》圆形印章图标（无底部文字，避免被遮挡）：
输出 build/icon.ico（多尺寸） + public/logo.png（页面 Logo）"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(BASE, 'build')
PUBLIC = os.path.join(BASE, 'public')
os.makedirs(BUILD, exist_ok=True)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\STKAITI.TTF',
    r'C:\Windows\Fonts\KAIU.TTF',
    r'C:\Windows\Fonts\simkai.ttf',
]
FONT = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)

S = 1024
def draw_logo(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / S
    c = size / 2
    r = size / 2 - 30 * s
    # 深墨渐变圆底（两层圆模拟渐变）
    d.ellipse([c - r, c - r, c + r, c + r], fill=(10, 9, 7, 255))
    d.ellipse([c - r * 0.86, c - r * 0.86, c + r * 0.86, c + r * 0.86], fill=(18, 15, 11, 255))
    # 金色外环
    d.ellipse([c - r, c - r, c + r, c + r], outline=(201, 168, 106, 255), width=max(6, int(14 * s)))
    d.ellipse([c - r * 0.92, c - r * 0.92, c + r * 0.92, c + r * 0.92], outline=(201, 168, 106, 90), width=max(2, int(4 * s)))
    # 左上朱砂小印「仙」
    seal = 150 * s
    sx, sy = c - r * 0.68, c - r * 0.68
    d.rounded_rectangle([sx, sy, sx + seal, sy + seal], radius=16 * s, fill=(192, 82, 58, 255))
    sf = ImageFont.truetype(FONT, int(seal * 0.6)) if FONT else ImageFont.load_default()
    d.text((sx + seal / 2, sy + seal / 2), '仙', font=sf, fill=(245, 234, 210, 255),
           anchor='mm', stroke_width=max(1, int(3 * s)), stroke_fill=(120, 40, 30, 255))
    # 中央大「仙」（金，中心略偏下以容纳顶部小印视觉平衡）
    cf = ImageFont.truetype(FONT, int(size * 0.5)) if FONT else ImageFont.load_default()
    d.text((c, c + size * 0.02), '仙', font=cf, fill=(232, 200, 136, 255),
           anchor='mm', stroke_width=max(2, int(8 * s)), stroke_fill=(60, 42, 18, 255))
    # 底部云纹点缀（两段弧）
    for i in range(3):
        ax = c - 60 * s + i * 60 * s
        d.arc([ax, c + r * 0.62, ax + 60 * s, c + r * 0.62 + 40 * s], start=20, end=160,
              fill=(201, 168, 106, 70), width=max(2, int(4 * s)))
    return img

logo = draw_logo(1024)
logo.save(os.path.join(PUBLIC, 'logo.png'))
logo.save(os.path.join(BUILD, 'icon.png'))
icon = draw_logo(512)
icon.save(os.path.join(BUILD, 'icon.ico'),
          sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256), (512, 512)])
print('已生成：public/logo.png（圆形印章无底部文字）· build/icon.ico · build/icon.png')
