# 전주 현장 사용법 한 장 (A4 세로): 위 제이엘 상담사 / 아래 현장 안내 직원
# 사용: python3 -I make_manual.py <출력 폴더>
import sys, os
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
SITE = 'https://bank-queue.onrender.com'
FD = '/usr/share/fonts/truetype/nanum/'
def F(name, size): return ImageFont.truetype(FD + name, size)
B, R = 'NanumSquareRoundB.ttf', 'NanumSquareRoundR.ttf'
INK, GREY, WHITE = (25, 31, 40), (90, 98, 110), (255, 255, 255)
JL, DARK, NAVY = (139, 0, 41), (51, 65, 85), (15, 23, 42)
W, H, M = 2480, 3508, 120

img = Image.new('RGB', (W, H), WHITE)
d = ImageDraw.Draw(img)

def tw(s, f):
    x0, _, x1, _ = d.textbbox((0, 0), s, font=f)
    return x1 - x0

def wrap(s, f, maxw):
    lines, cur = [], ''
    for word in s.split(' '):
        cand = (cur + ' ' + word).strip()
        if tw(cand, f) <= maxw: cur = cand; continue
        if cur: lines.append(cur)
        cur = word
    if cur: lines.append(cur)
    return lines

def text(x, y, s, f, fill):
    _, y0, _, y1 = d.textbbox((0, 0), '가Ag', font=f)
    d.text((x, y - y0), s, font=f, fill=fill)
    return y + (y1 - y0)

def qr(url, px):
    q = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=3, box_size=1)
    q.add_data(url); q.make(fit=True)
    im = q.make_image(fill_color='black', back_color='white').convert('RGB')
    b = max(1, px // im.size[0])
    return im.resize((im.size[0] * b, im.size[0] * b), Image.NEAREST)

def steps(x, y, items, width, color):
    """번호 원 + 굵은 제목 + 설명(줄바꿈)."""
    fT, fD = F(B, 50), F(R, 44)
    for i, (title, desc) in enumerate(items):
        r = 30
        d.ellipse((x, y + 2, x + 2 * r, y + 2 + 2 * r), fill=color)
        n = str(i + 1)
        d.text((x + r - tw(n, F(B, 38)) / 2, y + 10), n, font=F(B, 38), fill=WHITE)
        tx = x + 2 * r + 24
        yy = text(tx, y + 6, title, fT, INK) + 12
        for line in wrap(desc, fD, width - (tx - x)):
            yy = text(tx, yy, line, fD, GREY) + 10
        y = yy + 22
    return y

# ---- 머리 ----
d.rectangle((0, 0, W, 250), fill=NAVY)
text(M, 58, '법무법인 제이엘 · 현장 직원 사용법', F(B, 84), WHITE)
text(M, 170, '전주 분양전환 상담  |  10/17(토) 13~20시 · 10/18(일) 10~13시  |  순서: 제이엘 상담 → 은행 상담', F(R, 40), (203, 213, 225))

# ---- A. 제이엘 상담사 ----
y = 300
d.rounded_rectangle((M - 20, y, W - M + 20, y + 100), 26, fill=JL)
text(M + 20, y + 24, 'A. 법무법인 제이엘 상담사 (1~5번 창구)', F(B, 56), WHITE)
y += 140
A = [
    ('시작: 아래 자기 창구 QR 찍기', '그 창구로 바로 열립니다. 다른 창구 링크는 열지 마세요(호출이 꼬입니다).'),
    ('대기 목록은 두 줄로 나뉩니다', "'예약 고객' / '현장 접수 고객'. 번호를 누르면 그 손님을 바로 부릅니다."),
    ('호출: [다음 예약 고객 호출]이 기본', "상황을 보고 [현장 접수 고객 호출] 또는 번호를 눌러 현장 손님을 부르세요. 방송은 '예약 고객 N번 / 현장 접수 고객 N번'으로 구분됩니다."),
    ('상담 끝: [상담 완료 + 다음 호출]', '손님 폰에 은행 선택 화면이 뜹니다. 은행 상담은 손님이 폰에서 고릅니다.'),
    ('손님이 안 오면: [재호출] → [부재 패스]', '잘못 눌렀으면 [실수 취소]. 자리를 비울 땐 [자리 비움], 호출하면 자동 복귀.'),
]
y = steps(M, y, A, W - 2 * M, JL)
# 제이엘 창구 QR 5개
y += 20
qpx, gap = 330, 40
total = 5 * qpx + 4 * gap
x0 = (W - total) // 2
for i in range(5):
    q = qr(f'{SITE}/teller.html?b=jl&desk={i + 1}', qpx)
    x = x0 + i * (qpx + gap)
    d.rounded_rectangle((x - 12, y - 12, x + q.size[0] + 12, y + q.size[0] + 80), 22, outline=JL, width=5)
    img.paste(q, (x, y))
    lab = f'{i + 1}번 창구'
    text(x + (q.size[0] - tw(lab, F(B, 42))) / 2, y + q.size[0] + 14, lab, F(B, 42), JL)
y += qpx + 130

# ---- B. 현장 안내 직원 ----
d.rounded_rectangle((M - 20, y, W - M + 20, y + 100), 26, fill=DARK)
text(M + 20, y + 24, 'B. 현장 안내 직원 (예약자 확인 · 대리발권)', F(B, 56), WHITE)
y += 140
qbig = 470
B_ = [
    ('시작: 오른쪽 QR(현장안내앱) 찍기', '여러 명이 같이 씁니다. 처음 [확인]을 누를 때 이름을 한 번 입력합니다.'),
    ('손님께: "QR 찍고 동·호수 넣어 주세요"', '예약 시간이면 번호표가 바로 나오고 예약자 화면에 자동으로 확인됩니다.'),
    ('예약이 없거나 시간이 다르면', "손님 폰의 [현장 접수 번호표 받기]를 누르게 안내하세요. '예약 고객이 우선 호출됩니다'라고 함께 말씀해 주세요."),
    ('휴대폰 없는 분: 위쪽 [대리발권]', "제이엘은 '예약자' 또는 '현장접수' 선택 → 큰 번호를 손님께 알려주기. 은행 대리발권은 제이엘 상담 마친 분만."),
    ('번호 받고 안 오는 손님: [번호 강제종료]', "기관·번호 조회 → '상담 끝남'(제이엘이면 손님 폰에 은행 선택이 떠서 은행 상담 가능) 또는 '번호 취소'."),
    ('"예약했는데 확인 안 돼요": 전화 뒷 4자리로 찾기', "명단 동·호수가 틀린 분이 있습니다. 검색창에 전화 뒷 4자리 → 찾으면 [확인] 누르고 [대리발권] 제이엘 '예약자'로 번호를 드리세요."),
    ('예약 인정 시간', '각 타임 10분 전 ~ 끝. 첫 타임(토 13시·일 10시)은 30분 전부터, 마지막 타임(토 18시·일 12시)은 끝나고 30분까지.'),
]
yb = steps(M, y, B_, W - 2 * M - qbig - 60, DARK)
q = qr(f'{SITE}/reserve.html', qbig)
qx = W - M - q.size[0]
d.rounded_rectangle((qx - 16, y - 16, qx + q.size[0] + 16, y + q.size[0] + 120), 26, outline=DARK, width=6)
img.paste(q, (qx, y))
lab = '현장안내앱'
text(qx + (q.size[0] - tw(lab, F(B, 48))) / 2, y + q.size[0] + 22, lab, F(B, 48), INK)
y = max(yb, y + q.size[0] + 140) + 10

# ---- 이럴 땐 ----
fh = F(B, 44); fd = F(R, 40)
tips = [
    ('화면이 멈추면', '새로고침하세요. 번호표와 대기 손님은 지워지지 않습니다.'),
    ('"왜 뒷번호가 먼저 불려요?"', '"시간예약 고객이 우선입니다"라고 안내해 주세요.'),
    ('시스템 문제', '바로 관리자에게 알려 주세요(관리자는 필요하면 [예약 확인 끄기]).'),
]
bh = 90 + len(tips) * 66
d.rounded_rectangle((M - 20, y, W - M + 20, y + bh), 30, fill=(255, 244, 230), outline=(253, 186, 116), width=5)
yy = text(M + 20, y + 26, '이럴 땐', F(B, 50), (194, 65, 12)) + 22
for t, s in tips:
    text(M + 20, yy, '· ' + t, fh, INK)
    text(M + 20 + 640, yy + 3, s, fd, GREY)
    yy += 66
y += bh
assert y < H - 40, y
print('bottom', y, 'of', H)

png = os.path.join(OUT, '전주_현장사용법_1장.png')
img.save(png, dpi=(300, 300), optimize=True)
img.save(os.path.join(OUT, '전주_현장사용법_1장.pdf'), resolution=300)
print('saved', png)
