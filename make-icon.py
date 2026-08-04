# -*- coding: utf-8 -*-
"""生成《仙途》图标：墨底金框朱印「仙」字（印章风）
输出：build/icon.ico（多尺寸） + public/logo.png（页面 Logo）"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(BASE, 'build')
PUBLIC = os.path.join(BASE, 'public')
os.makedirs(BUILD, exist_ok=True)

# 中文字体（楷体优先，兜底宋体）
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\STKAITI.TTF',
    r'C:\Windows\Fonts\KAIU.TTF',
    r'C:\Windows\Fonts\simkai.ttf',
    r'C:\Windows\Fonts\msyh.ttc',
]
FONT = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)
print('使用字体:', FONT)

S = 1024  # 大图基准
def draw_logo(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / S
    # 墨色圆角方底（中心 0.06 缩放，深墨渐变感用两圈）
    pad = 46 * s
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=190 * s,
                        fill=(13, 11, 9, 255), outline=(201, 168, 106, 255), width=max(6, int(14 * s)))
    # 内层细金线
    d.rounded_rectangle([pad + 30 * s, pad + 30 * s, size - pad - 30 * s, size - pad - 30 * s],
                        radius=160 * s, outline=(201, 168, 106, 130), width=max(2, int(4 * s)))
    # 左上角朱砂小印
    seal = 150 * s
    sx, sy = pad + 26 * s, pad + 26 * s
    d.rounded_rectangle([sx, sy, sx + seal, sy + seal], radius=18 * s, fill=(192, 82, 58, 255))
    try:
        sf = ImageFont.truetype(FONT, int(seal * 0.62))
    except Exception:
        sf = ImageFont.load_default()
    d.text((sx + seal / 2, sy + seal / 2), '仙', font=sf, fill=(245, 234, 210, 255),
           anchor='mm', stroke_width=max(1, int(3 * s)), stroke_fill=(120, 40, 30, 255))
    # 中央大「仙」字（金色）
    try:
        cf = ImageFont.truetype(FONT, int(size * 0.52))
    except Exception:
        cf = ImageFont.load_default()
    d.text((size / 2, size / 2 + 10 * s), '仙', font=cf, fill=(232, 200, 136, 255),
           anchor='mm', stroke_width=max(2, int(8 * s)), stroke_fill=(60, 42, 18, 255))
    # 底部小字「仙途」
    try:
        tf = ImageFont.truetype(FONT, int(size * 0.11))
    except Exception:
        tf = ImageFont.load_default()
    d.text((size / 2, size - pad + 42 * s), '仙 途', font=tf, fill=(148, 137, 122, 255),
           anchor='mm', stroke_width=max(1, int(2 * s)), stroke_fill=(20, 16, 12, 255))
    return img

# PNG（页面 Logo 与打包源）
logo = draw_logo(1024)
logo.save(os.path.join(PUBLIC, 'logo.png'))
logo.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, 'icon.png'))

# ICO 多尺寸
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256), (512, 512)]
icon = draw_logo(512)
icon.save(os.path.join(BUILD, 'icon.ico'), sizes=sizes)
print('已生成: build/icon.ico, build/icon.png, public/logo.png')
