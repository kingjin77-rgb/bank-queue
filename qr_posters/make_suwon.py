# 수원역푸르지오자이 분양전환 (우리은행 단독 5창구, 선착순) 현장 자료
#  - 고객 QR 게시물(A4 세로) · 창구번호판 5장(A4 가로) · 직원용 접속 QR · 링크모음 · 톡방 안내
# 사용: python3 -I make_suwon.py <아이콘 폴더> <출력 폴더>
import sys, os
import qrcode
from qrcode.constants import ERROR_CORRECT_Q, ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

ICON_DIR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SITE = 'https://bank-queue.onrender.com'
DANJI = '수원역푸르지오자이 분양전환'
CODE, NAME, COLOR, DESKS = 'woori', '우리은행', '#0067AC', 5
FD = '/usr/share/fonts/truetype/nanum/'
def F(name, size): return ImageFont.truetype(FD + name, size)
B, R, SQB = 'NanumSquareRoundB.ttf', 'NanumSquareRoundR.ttf', 'NanumSquareB.ttf'
INK, GREY, WHITE = (34, 34, 34), (95, 95, 95), (255, 255, 255)
def rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def tint(c, a): return tuple(round(255 - (255 - v) * a) for v in c)
BRAND = rgb(COLOR)

def tw(d, s, f):
    x0, _, x1, _ = d.textbbox((0, 0), s, font=f); return x1 - x0
def center(d, cx, y, s, f, fill):
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=f)
    d.text((cx - (x1 - x0) / 2 - x0, y - y0), s, font=f, fill=fill)
    return y + (y1 - y0)
def icon(size):
    im = Image.open(os.path.join(ICON_DIR, CODE + '-512.png')).convert('RGB').resize((size, size), Image.LANCZOS)
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), size // 5, fill=255)
    return im, m
def make_qr(url, px, ec=ERROR_CORRECT_Q):
    q = qrcode.QRCode(error_correction=ec, border=4, box_size=1)
    q.add_data(url); q.make(fit=True)
    im = q.make_image(fill_color='black', back_color='white').convert('RGB')
    box = max(1, px // im.size[0])
    return im.resize((im.size[0] * box, im.size[0] * box), Image.NEAREST)
def header(img, d, W, band, title_size):
    d.rectangle((0, 0, W, band), fill=BRAND)
    s = int(band * 0.58)
    im, m = icon(s)
    fn = F(B, title_size)
    x0, y0, x1, y1 = d.textbbox((0, 0), NAME, font=fn)
    total = s + 70 + (x1 - x0)
    ix = int((W - total) / 2); iy = (band - s) // 2
    d.rounded_rectangle((ix - 12, iy - 12, ix + s + 12, iy + s + 12), s // 4, fill=WHITE)
    img.paste(im, (ix, iy), m)
    d.text((ix + s + 70 - x0, band / 2 - (y1 - y0) / 2 - y0), NAME, font=fn, fill=WHITE)

# ---------- 1) 고객 QR 게시물 (A4 세로) ----------
def poster():
    W, H = 2480, 3508
    CM = 300 / 2.54
    M = 170
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    band = 520
    header(img, d, W, band, 150)
    y = band + 90
    y = center(d, W / 2, y, DANJI, F(B, 96), INK) + 40
    y = center(d, W / 2, y, NAME + ' 상담 번호표', F(B, 140), INK) + 50
    y = center(d, W / 2, y, '휴대폰 카메라로 QR 을 찍어 주세요', F(B, 84), BRAND) + 60
    url = f'{SITE}/index.html?b={CODE}'
    qr = make_qr(url, int(12.5 * CM)); q = qr.size[0]; qx = (W - q) // 2; pad = 30
    d.rounded_rectangle((qx - pad - 16, y - 16, qx + q + pad + 16, y + q + 2 * pad + 16), 70, fill=BRAND)
    d.rounded_rectangle((qx - pad, y, qx + q + pad, y + q + 2 * pad), 56, fill=WHITE)
    img.paste(qr, (qx, y + pad))
    y += q + 2 * pad + 16 + 110
    steps = [('QR 을 찍어', '번호표 받기', '오신 순서대로 번호'),
             ('번호가 불리면', NAME + ' 창구로', '안내 방송·전광판'),
             ('번호를 놓치셨으면', '폰에서 다시 받기', '또는 안내 직원에게')]
    gap = 40; cw = (W - 2 * M - 2 * gap) / 3; ch = 410
    for i, (a, b, c) in enumerate(steps):
        cx0 = M + i * (cw + gap)
        d.rounded_rectangle((cx0, y, cx0 + cw, y + ch), 40, fill=tint(BRAND, 0.10))
        r = 56; ccx = cx0 + cw / 2
        d.ellipse((ccx - r, y + 40, ccx + r, y + 40 + 2 * r), fill=BRAND)
        center(d, ccx, y + 40 + r - 34, str(i + 1), F(SQB, 68), WHITE)
        ty = y + 40 + 2 * r + 36
        ty = center(d, ccx, ty, a, F(B, 52), INK) + 24
        fb = F(B, 56) if tw(d, b, F(B, 56)) <= cw - 40 else F(B, 46)
        ty = center(d, ccx, ty, b, fb, BRAND) + 30
        center(d, ccx, ty, c, F(R, 40), GREY)
        if i < 2:
            ax = cx0 + cw + gap / 2; ay = y + ch / 2
            d.polygon([(ax - 12, ay - 22), (ax + 14, ay), (ax - 12, ay + 22)], fill=tint(BRAND, 0.55))
    y += ch
    fbh = 300
    d.rectangle((0, H - fbh, W, H), fill=(246, 246, 246))
    d.rectangle((0, H - fbh, W, H - fbh + 10), fill=BRAND)
    yy = center(d, W / 2, H - fbh + 60, '휴대폰이 없거나 QR 이 어려우시면 안내 직원에게 말씀해 주세요', F(B, 56), INK) + 44
    center(d, W / 2, yy, '직접 입력: bank-queue.onrender.com/index.html?b=' + CODE, F(R, 44), GREY)
    assert y + 40 < H - fbh, ('poster overflow', y)
    return img, url

# ---------- 2) 창구번호판 (A4 가로) ----------
def desk_sign(n):
    W, H = 3508, 2480
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    band = 520
    header(img, d, W, band, 190)
    f_num, f_unit = F(SQB, 1250), F(B, 380)
    num = str(n)
    nx0, ny0, nx1, ny1 = d.textbbox((0, 0), num, font=f_num)
    ux0, uy0, ux1, uy1 = d.textbbox((0, 0), '번 창구', font=f_unit)
    gap = 60; total = (nx1 - nx0) + gap + (ux1 - ux0); sx = (W - total) / 2
    base_y = band + 220 + (ny1 - ny0)
    d.text((sx - nx0, base_y - ny1), num, font=f_num, fill=BRAND)
    d.text((sx + (nx1 - nx0) + gap - ux0, base_y - uy1), '번 창구', font=f_unit, fill=INK)
    fb = 330
    d.rectangle((0, H - fb, W, H), fill=tint(BRAND, 0.12))
    d.rectangle((0, H - fb, W, H - fb + 14), fill=BRAND)
    center(d, W / 2, H - fb + 95, DANJI + ' · ' + NAME + ' 상담', F(B, 110), INK)
    assert base_y + 40 < H - fb
    return img

# ---------- 3) 직원용 접속 QR (A4 세로) ----------
def qr_page(title, sub, items, cols, qpx, label_size):
    W, H = 2480, 3508
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 300), fill=rgb('#0f172a'))
    center(d, W / 2, 70, title, F(B, 92), WHITE)
    center(d, W / 2, 200, sub, F(R, 50), (203, 213, 225))
    rows = (len(items) + cols - 1) // cols
    top, bottom, M = 360, 120, 90
    cw = (W - 2 * M) / cols; ch = (H - top - bottom) / rows
    for i, (lab, url, color) in enumerate(items):
        r, c = divmod(i, cols)
        cx = M + c * cw + cw / 2; y = top + r * ch
        q = make_qr(url, qpx, ERROR_CORRECT_M)
        d.rounded_rectangle((cx - cw / 2 + 18, y + 10, cx + cw / 2 - 18, y + ch - 10), 40, outline=rgb(color), width=8)
        img.paste(q, (int(cx - q.size[0] / 2), int(y + 40)))
        ty = y + 40 + q.size[0] + 14
        center(d, cx, ty, lab, F(B, label_size), INK)
        if ty + label_size + 80 < y + ch - 20:
            center(d, cx, ty + label_size + 20, url.replace('https://bank-queue.onrender.com', ''), F(R, max(30, label_size // 2)), GREY)
    return img

if __name__ == '__main__':
    urls = []
    p, u = poster(); urls.append(('poster', u))
    p.save(os.path.join(OUT, '1_고객QR_우리은행.png'), dpi=(300, 300), optimize=True)
    p.save(os.path.join(OUT, '1_고객QR게시물_A4세로.pdf'), resolution=300)
    signs = [desk_sign(n) for n in range(1, DESKS + 1)]
    for n, im in enumerate(signs, 1):
        im.save(os.path.join(OUT, f'창구번호판_우리은행_{n}번.png'), dpi=(300, 300), optimize=True)
    signs[0].save(os.path.join(OUT, '2_창구번호판_A4가로.pdf'), save_all=True, append_images=signs[1:], resolution=300)
    teller = [(f'{NAME} {n}번 창구', f'{SITE}/teller.html?b={CODE}&desk={n}', COLOR) for n in range(1, DESKS + 1)]
    admin = [('현장알림앱 (스피커·관리자)', f'{SITE}/admin.html', '#0f172a'),
             ('현장안내앱 (대리발권·안내방송)', f'{SITE}/reserve.html', COLOR),
             ('전광판 (TV)', f'{SITE}/display.html', '#334155'),
             ('진행요원 (창구 현황·대리발권)', f'{SITE}/operator.html', '#3182f6')]
    urls += [(l, x) for l, x, _ in teller + admin]
    p1 = qr_page('상담사 접속 QR (직원용 · 게시 금지)', '각 상담사는 자기 창구 QR 을 찍으면 그 창구로 바로 열립니다', teller, 2, 700, 58)
    p2 = qr_page('현장 관리 앱 접속 QR (직원용 · 게시 금지)', '스피커 PC · 안내 직원 · TV 에서 찍어 여세요', admin, 2, 900, 60)
    p1.save(os.path.join(OUT, '직원용_상담사_QR.png'), dpi=(300, 300), optimize=True)
    p2.save(os.path.join(OUT, '직원용_관리앱_QR.png'), dpi=(300, 300), optimize=True)
    p1.save(os.path.join(OUT, '3_직원용_접속QR_게시금지.pdf'), save_all=True, append_images=[p2], resolution=300)
    with open(os.path.join(OUT, 'qr_urls.txt'), 'w', encoding='utf-8') as f:
        for l, x in urls: f.write(x + '\n')
    print('ok', OUT)
