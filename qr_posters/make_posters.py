# 전주 현장 QR 게시물 (A4 세로, 300dpi) 5장 + 합본 PDF
# 사용: python3 -I make_posters.py <아이콘 폴더> <출력 폴더>
import sys, os
import qrcode
from qrcode.constants import ERROR_CORRECT_Q
from PIL import Image, ImageDraw, ImageFont

ICON_DIR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

BASE = 'https://bank-queue.onrender.com/index.html?b='
W, H = 2480, 3508            # A4 @ 300dpi
CM = 300 / 2.54
M = 170                      # 좌우 여백
FD = '/usr/share/fonts/truetype/nanum/'
def F(name, size): return ImageFont.truetype(FD + name, size)
B, R, SQB = 'NanumSquareRoundB.ttf', 'NanumSquareRoundR.ttf', 'NanumSquareB.ttf'

INK = (34, 34, 34)
GREY = (95, 95, 95)

# server.js INITIAL_BANKS 와 같은 이름·색
ORGS = [
    ('jl', '1_제이엘', '법무법인 제이엘', '#8b0029', None),
    ('nh', '2_농협', 'NH농협은행', '#1f8a3b', None),
    ('shinhan', '3_신한', '신한은행', '#0046ff', None),
    ('kb', '4_국민', '국민은행', '#ffbc00', '#8a6500'),   # 노란 바탕 → 흰 종이 위 글자는 진한 황토색
    ('fubon', '5_푸본', '푸본현대생명', '#00A88F', '#00806d'),
]

def rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def tint(c, a): return tuple(round(255 - (255 - v) * a) for v in c)

def text_w(d, s, f):
    x0, _, x1, _ = d.textbbox((0, 0), s, font=f)
    return x1 - x0

def center(d, y, s, f, fill, cx=W / 2):
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=f)
    d.text((cx - (x1 - x0) / 2 - x0, y - y0), s, font=f, fill=fill)
    return y + (y1 - y0)

def wrap(d, s, f, maxw):
    """띄어쓰기 기준 줄바꿈(한 어절이 너무 길면 글자 단위)."""
    lines, cur = [], ''
    for word in s.split(' '):
        cand = (cur + ' ' + word).strip()
        if text_w(d, cand, f) <= maxw:
            cur = cand
            continue
        if cur:
            lines.append(cur)
        cur = ''
        for ch in word:
            if text_w(d, cur + ch, f) > maxw:
                lines.append(cur); cur = ch
            else:
                cur += ch
    if cur:
        lines.append(cur)
    return lines

def make_qr(url, px):
    q = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, border=4, box_size=1)
    q.add_data(url)
    q.make(fit=True)
    img = q.make_image(fill_color='black', back_color='white').convert('RGB')
    n = img.size[0]
    box = px // n                                  # 모듈이 정수 픽셀이 되도록
    return img.resize((n * box, n * box), Image.NEAREST)

def poster(code, label, name, color, accent):
    brand = rgb(color)
    acc = rgb(accent) if accent else brand
    on_brand = INK if code == 'kb' else (255, 255, 255)
    url = BASE + code
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)

    # 1) 상단 색 띠: 아이콘 + 기관명
    band = 520
    d.rectangle((0, 0, W, band), fill=brand)
    icon = Image.open(os.path.join(ICON_DIR, code + '-512.png')).convert('RGB').resize((300, 300), Image.LANCZOS)
    mask = Image.new('L', (300, 300), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 299, 299), 64, fill=255)
    fname = F(B, 150)
    nw = text_w(d, name, fname)
    total = 300 + 70 + nw
    ix = int((W - total) / 2)
    iy = int((band - 300) / 2)
    d.rounded_rectangle((ix - 12, iy - 12, ix + 312, iy + 312), 76, fill=(255, 255, 255))
    img.paste(icon, (ix, iy), mask)
    x0, y0, x1, y1 = d.textbbox((0, 0), name, font=fname)
    d.text((ix + 370 - x0, band / 2 - (y1 - y0) / 2 - y0), name, font=fname, fill=on_brand)

    # 2) 제목
    y = band + (120 if code == 'jl' else 95)
    title = '분양전환 상담 번호표' if code == 'jl' else name + ' 상담 번호표'
    y = center(d, y, title, F(B, 140), INK) + 60
    y = center(d, y, '휴대폰 카메라로 QR 을 찍어 주세요', F(B, 84), acc) + 60

    # 3) QR (테두리 액자)
    qr = make_qr(url, int((12.5 if code == 'jl' else 11) * CM))   # 은행 장은 안내 박스 자리만큼 작게
    q = qr.size[0]
    qx = (W - q) // 2
    pad = 30
    d.rounded_rectangle((qx - pad - 16, y - 16, qx + q + pad + 16, y + q + 2 * pad + 16), 70, fill=brand)
    d.rounded_rectangle((qx - pad, y, qx + q + pad, y + q + 2 * pad), 56, fill=(255, 255, 255))
    img.paste(qr, (qx, y + pad))
    y += q + 2 * pad + 16 + 80

    # 4) 은행 장: 제이엘 먼저 안내 박스
    if code != 'jl':
        jl = rgb('#8b0029')
        f = F(B, 58)
        lines = wrap(d, '분양전환 상담(법무법인 제이엘)을 먼저 받으신 뒤 은행 상담이 진행됩니다.', f, W - 2 * M - 120)
        f2 = F(R, 50)
        lines2 = wrap(d, '아직 제이엘 상담 전이시면 QR 을 찍었을 때 제이엘 번호표가 먼저 나옵니다.', f2, W - 2 * M - 120)
        lh, lh2 = 80, 70
        bh = 60 + len(lines) * lh + 18 + len(lines2) * lh2 + 50
        d.rounded_rectangle((M, y, W - M, y + bh), 40, fill=tint(jl, 0.09), outline=jl, width=8)
        ty = y + 60
        for s in lines:
            center(d, ty, s, f, jl); ty += lh
        ty += 18
        for s in lines2:
            center(d, ty, s, f2, INK); ty += lh2
        y += bh + 50

    # 5) 이용 순서 3단계 (가로 3칸)
    if code == 'jl':
        y += 80          # 안내 박스가 없는 장은 남는 공간을 위아래로 나눔
    if code == 'jl':
        steps = [('QR 을 찍어', '번호표 받기', '화면을 켜 두세요'),
                 ('번호가 불리면', '제이엘 창구로', '안내 방송·전광판'),
                 ('상담이 끝나면', '폰에서 은행 선택', '은행 번호표가 나옵니다')]
    else:
        steps = [('QR 을 찍어', '번호표 받기', '화면을 켜 두세요'),
                 ('번호가 불리면', name + ' 창구로', '안내 방송·전광판'),
                 ('번호를 놓치셨으면', '폰에서 다시 받기', '또는 안내 직원에게')]
    gap = 40
    cw = (W - 2 * M - 2 * gap) / 3
    ch = 410
    for i, (a, b, c) in enumerate(steps):
        cx0 = M + i * (cw + gap)
        d.rounded_rectangle((cx0, y, cx0 + cw, y + ch), 40, fill=tint(brand, 0.10))
        r = 56
        ccx = cx0 + cw / 2
        d.ellipse((ccx - r, y + 40, ccx + r, y + 40 + 2 * r), fill=brand)
        center(d, y + 40 + r - 34, str(i + 1), F(SQB, 68), on_brand, cx=ccx)
        ty = y + 40 + 2 * r + 36
        ty = center(d, ty, a, F(B, 52), INK, cx=ccx) + 24
        fb = F(B, 56)
        if text_w(d, b, fb) > cw - 40:
            fb = F(B, 46)
        ty = center(d, ty, b, fb, acc, cx=ccx) + 30
        center(d, ty, c, F(R, 40), GREY, cx=ccx)
        if i < 2:   # 화살표
            ax = cx0 + cw + gap / 2
            ay = y + ch / 2
            d.polygon([(ax - 12, ay - 22), (ax + 14, ay), (ax - 12, ay + 22)], fill=tint(brand, 0.55) if code != 'kb' else acc)
    y += ch

    # 6) 하단 띠: 대리발권 안내 + 직접 입력 주소
    fb = 300
    d.rectangle((0, H - fb, W, H), fill=(246, 246, 246))
    d.rectangle((0, H - fb, W, H - fb + 10), fill=brand)
    yy = center(d, H - fb + 60, '휴대폰이 없거나 QR 이 어려우시면 안내 직원에게 말씀해 주세요', F(B, 56), INK) + 44
    center(d, yy, '직접 입력: bank-queue.onrender.com/index.html?b=' + code, F(R, 44), GREY)

    assert y + 40 < H - fb, (label, y, H - fb)   # 내용이 하단 띠를 덮지 않음
    return img, url, y

pages = []
for o in ORGS:
    img, url, used = poster(*o)
    path = os.path.join(OUT, o[1] + '.png')
    img.save(path, dpi=(300, 300), optimize=True)
    pages.append(img)
    print('saved', path, url, 'content bottom', used)
pdf = os.path.join(OUT, '전주_QR게시물_전체.pdf')
pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=300)
print('saved', pdf)
