"""把 demo 截圖裡的電話塗黑（避免暴露測試號碼）"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

BASE = os.path.dirname(__file__)

def redact_rect(img, boxes, color=(40, 40, 40), label='09XX-XXX-XXX'):
    """在指定位置畫深灰底色塊 + 遮罩字"""
    draw = ImageDraw.Draw(img)
    for box in boxes:
        x1, y1, x2, y2 = box
        draw.rectangle([x1, y1, x2, y2], fill=color)
        # 寫遮罩字
        try:
            # 字型大小依高度估
            h = y2 - y1
            try:
                font = ImageFont.truetype('msjh.ttc', int(h * 0.55))
            except Exception:
                font = ImageFont.load_default()
            bbox = draw.textbbox((0, 0), label, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            tx = x1 + (x2 - x1 - tw) // 2
            ty = y1 + (y2 - y1 - th) // 2 - int(h * 0.1)
            draw.text((tx, ty), label, fill=(220, 220, 220), font=font)
        except Exception as e:
            print('skip label:', e)
    return img

def process(fn, boxes, label='09XX-XXX-XXX'):
    path = os.path.join(BASE, fn)
    img = Image.open(path).convert('RGB')
    img = redact_rect(img, boxes, label=label)
    img.save(path, 'JPEG', quality=88)
    print(f'[OK] {fn} - {len(boxes)} 塊')

# 05 結帳 — 電話輸入框的 0912345678
process('05-checkout.jpg', [
    (78, 960, 690, 1070),
])

# 07 後台訂單 — eva / KENT111 兩個電話
process('07-admin-orders.jpg', [
    (135, 625, 430, 700),    # eva 電話
    (210, 1200, 525, 1285),  # KENT111 電話
])

# 08 本週報表 — KENT111 / eva 兩個電話
process('08-admin-report.jpg', [
    (260, 700, 620, 770),   # KENT111
    (170, 1060, 500, 1135), # eva
])

print('全部處理完成')
