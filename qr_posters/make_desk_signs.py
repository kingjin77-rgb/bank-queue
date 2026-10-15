# 전주 현장 창구번호판(A4 가로) + 직원용 접속 QR(A4 세로) + 링크모음
# 사용: python3 -I make_desk_signs.py <아이콘 폴더> <출력 폴더>
import sys, os
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

ICON_DIR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SITE = 'https://bank-queue.onrender.com'
FD = '/usr/share/fonts/truetype/nanum/'
def F(name, size): return ImageFont.truetype(FD + name, size)
B, R, SQB = 'NanumSquareRoundB.ttf', 'NanumSquareRoundR.ttf', 'NanumSquareB.ttf'
INK, GREY = (34, 34, 34), (95, 95, 95)

# server.js INITIAL_BANKS 와 같은 이름·색, 창구 수는 현장 배치
ORGS = [
    ('jl', '법무법인 제이엘', '#8b0029', 5, '분양전환 상담'),
    ('nh', 'NH농협은행', '#1f8a3b', 2, '은행 상담'),
    ('shinhan', '신한은행', '#0046ff', 3, '은행 상담'),
    ('kb', '국민은행', '#ffbc00', 2, '은행 상담'),
    ('fubon', '푸본현대생명', '#00A88F', 1, '상담 창구'),
]
def rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def tint(c, a): return tuple(round(255 - (255 - v) * a) for v in c)

def center(d, cx, y, s, f, fill):
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=f)
    d.text((cx - (x1 - x0) / 2 - x0, y - y0), s, font=f, fill=fill)
    return y + (y1 - y0)

def icon(code, size):
    im = Image.open(os.path.join(ICON_DIR, code + '-512.png')).convert('RGB').resize((size, size), Image.LANCZOS)
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), size // 5, fill=255)
    return im, m

# ---------- 창구번호판 (A4 가로 3508x2480) ----------
def desk_sign(code, name, color, n, kind):
    W, H = 3508, 2480
    brand = rgb(color)
    on_brand = INK if code == 'kb' else (255, 255, 255)
    acc = (138, 101, 0) if code == 'kb' else brand
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    band = 520
    d.rectangle((0, 0, W, band), fill=brand)
    im, m = icon(code, 320)
    fn = F(B, 190)
    x0, y0, x1, y1 = d.textbbox((0, 0), name, font=fn)
    total = 320 + 80 + (x1 - x0)
    ix = int((W - total) / 2); iy = (band - 320) // 2
    d.rounded_rectangle((ix - 14, iy - 14, ix + 334, iy + 334), 78, fill=(255, 255, 255))
    img.paste(im, (ix, iy), m)
    d.text((ix + 400 - x0, band / 2 - (y1 - y0) / 2 - y0), name, font=fn, fill=on_brand)
    # 아주 큰 창구 번호
    f_num = F(SQB, 1250)
    f_unit = F(B, 380)
    num = str(n)
    nx0, ny0, nx1, ny1 = d.textbbox((0, 0), num, font=f_num)
    ux0, uy0, ux1, uy1 = d.textbbox((0, 0), '번 창구', font=f_unit)
    gap = 60
    tw = (nx1 - nx0) + gap + (ux1 - ux0)
    sx = (W - tw) / 2
    base_y = band + 220 + (ny1 - ny0)          # 숫자 아랫선
    d.text((sx - nx0, base_y - ny1), num, font=f_num, fill=acc)
    d.text((sx + (nx1 - nx0) + gap - ux0, base_y - uy1), '번 창구', font=f_unit, fill=INK)
    # 하단 띠
    fb = 330
    d.rectangle((0, H - fb, W, H), fill=tint(brand, 0.12))
    d.rectangle((0, H - fb, W, H - fb + 14), fill=brand)
    center(d, W / 2, H - fb + 95, name + ' · ' + kind, F(B, 120), INK)
    assert base_y + 40 < H - fb, (code, n, base_y)
    return img

signs, names = [], []
for code, name, color, count, kind in ORGS:
    for n in range(1, count + 1):
        im = desk_sign(code, name, color, n, kind)
        fn = os.path.join(OUT, f'창구번호판_{name}_{n}번.png')
        im.save(fn, dpi=(300, 300), optimize=True)
        signs.append(im); names.append(fn)
pdf = os.path.join(OUT, '전주_창구번호판_전체_A4가로.pdf')
signs[0].save(pdf, save_all=True, append_images=signs[1:], resolution=300)
print('signs', len(signs), pdf)

# ---------- 직원용 접속 QR (A4 세로 2480x3508) ----------
def qr_img(url, px):
    q = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=4, box_size=1)
    q.add_data(url); q.make(fit=True)
    im = q.make_image(fill_color='black', back_color='white').convert('RGB')
    box = max(1, px // im.size[0])
    return im.resize((im.size[0] * box, im.size[0] * box), Image.NEAREST)

def qr_page(title, sub, items, cols, qpx, label_size):
    W, H = 2480, 3508
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 300), fill=rgb('#0f172a'))
    center(d, W / 2, 70, title, F(B, 96), (255, 255, 255))
    center(d, W / 2, 200, sub, F(R, 50), (203, 213, 225))
    rows = (len(items) + cols - 1) // cols
    top, bottom, M = 360, 120, 90
    cw = (W - 2 * M) / cols
    ch = (H - top - bottom) / rows
    for i, (lab, url, color) in enumerate(items):
        r, c = divmod(i, cols)
        cx = M + c * cw + cw / 2
        y = top + r * ch
        q = qr_img(url, qpx)
        d.rounded_rectangle((cx - cw / 2 + 18, y + 10, cx + cw / 2 - 18, y + ch - 10), 40, outline=rgb(color), width=8)
        img.paste(q, (int(cx - q.size[0] / 2), int(y + 40)))
        ty = y + 40 + q.size[0] + 14
        center(d, cx, ty, lab, F(B, label_size), INK)
        if ty + label_size + 80 < y + ch - 20:      # 칸에 자리가 있을 때만 주소를 작게 적는다
            short = url.replace('https://', '')
            center(d, cx, ty + label_size + 20, short.replace('bank-queue.onrender.com', ''), F(R, max(30, label_size // 2)), GREY)
    return img

teller_items = []
for code, name, color, count, kind in ORGS:
    for n in range(1, count + 1):
        teller_items.append((f'{name} {n}번 창구', f'{SITE}/teller.html?b={code}&desk={n}', color))
admin_items = [
    ('현장알림앱 (스피커·관리자)', f'{SITE}/admin.html', '#0f172a'),
    ('현장안내앱 (예약자 확인·대리발권)', f'{SITE}/reserve.html', '#8b0029'),
    ('전광판 (TV)', f'{SITE}/display.html', '#334155'),
    ('진행요원 (창구 현황·대리발권)', f'{SITE}/operator.html', '#3182f6'),
]
p1 = qr_page('상담사 접속 QR (직원용 · 게시 금지)', '각 상담사는 자기 창구 QR 을 찍으면 그 창구로 바로 열립니다', teller_items, 3, 470, 52)
p2 = qr_page('현장 관리 앱 접속 QR (직원용 · 게시 금지)', '스피커 PC · 안내 직원 · TV 에서 찍어 여세요', admin_items, 2, 900, 60)
p1.save(os.path.join(OUT, '직원용_상담사_QR.png'), dpi=(300, 300), optimize=True)
p2.save(os.path.join(OUT, '직원용_관리앱_QR.png'), dpi=(300, 300), optimize=True)
p1.save(os.path.join(OUT, '전주_직원용_접속QR_A4.pdf'), save_all=True, append_images=[p2], resolution=300)
print('staff qr ok')

# ---------- 링크모음 (카톡 붙여넣기용) ----------
L = []
L.append('■ 전주 현장 링크 모음 (법무법인 제이엘 상담 대기 시스템)')
L.append('')
L.append('[1] 현장알림앱 · 스피커 연결 (관리자 PC 1대, 하루 종일 켜두기)')
L.append(f'{SITE}/admin.html')
L.append('')
L.append('[2] 현장안내앱 · 예약자 확인 + 대리발권 (안내 직원 여러 명 동시 사용)')
L.append(f'{SITE}/reserve.html')
L.append('')
L.append('[3] 상담사앱 (자기 창구 링크만 여세요 · 열면 그 창구로 바로 시작)')
for code, name, color, count, kind in ORGS:
    for n in range(1, count + 1):
        L.append(f'- {name} {n}번 창구: {SITE}/teller.html?b={code}&desk={n}')
L.append('')
L.append('[4] 전광판 (TV) · 관리자 스피커와 같은 공간이면 소리는 한쪽만 켜기')
L.append(f'{SITE}/display.html')
L.append('')
L.append('[5] 진행요원 (전체 창구 현황 · 대리발권)')
L.append(f'{SITE}/operator.html')
L.append('')
L.append('[6] 고객 QR 주소 (게시물에 인쇄된 주소)')
for code, name, color, count, kind in ORGS:
    L.append(f'- {name}: {SITE}/index.html?b={code}')
L.append('')
L.append('[7] 전체 포털 (모든 링크 한 화면)')
L.append(f'{SITE}/hub.html')
open(os.path.join(OUT, '링크모음.txt'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print('links ok')
