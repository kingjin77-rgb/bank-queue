const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
const httpMod = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// 발권 전용 링크(/kiosk.html?b=xx)는 고객 발권 화면(index.html)과 동일 - 기존 QR/주소 유지
app.get(['/kiosk', '/kiosk.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 관리 화면이 열려 있는 동안 서버가 절전으로 내려가지 않도록 하는 확인용 주소
app.get('/healthz', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), uptimeSec: Math.round(process.uptime()) });
});

// 법무법인 제이엘 상담을 먼저 받아야 은행 번호표를 받을 수 있다.
const JL = 'jl';

// 현장에 QR 로 안내하는 상담처. 여기 등록된 곳만 서버가 재시작해도(배포, 절전 후 재기동,
// 비상 복구) 그대로 유지된다. 모든 화면이 이 순서대로 그리므로 제이엘을 맨 앞에 둔다.
const INITIAL_BANKS = {
  jl: { name: '법무법인 제이엘', color: '#8b0029', sub: '#fbe9ee', btnText: '#ffffff' },
  nh: { name: 'NH농협은행', color: '#1f8a3b', sub: '#e7f5ea', btnText: '#ffffff' },
  shinhan: { name: '신한은행', color: '#0046ff', sub: '#e8f0fe', btnText: '#ffffff' },
  kb: { name: '국민은행', color: '#ffbc00', sub: '#fff9e6', btnText: '#2b2b2b' },
  fubon: { name: '푸본현대생명', color: '#00A88F', sub: '#e6f7f4', btnText: '#ffffff' }
};

// 상담처별 기본 창구 수. 현장에서 관리자 콘솔로 늘리고 줄일 수 있다.
// 배포하면 저장 파일이 사라지므로 상시 운영 창구 수가 바뀌면 이 값도 고친다.
const INITIAL_DESK_COUNTS = { jl: 5, nh: 2, shinhan: 2, kb: 2, fubon: 1 };

function makeDesks(count) {
  return Array.from({ length: count }, (_, i) => ({
    desk: i + 1, name: `${i + 1}번 창구`, status: 'idle', currentCustomer: null, away: false
  }));
}

const INITIAL_SETTINGS = {
  openHour: 9,
  closeHour: 18,
  standardMinutes: 15,
  repeatCount: 1          // 호출 방송 반복 횟수
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

// ===== 홈 화면 앱 설치용 매니페스트 =====
// 역할과 상담처에 따라 앱 이름/아이콘/시작주소가 달라지므로 서버에서 만들어 준다.
const ROLE_MANIFEST = {
  teller:   { name: '창구 상담사', short: '창구', page: '/teller.html', icon: null, theme: null, bg: '#f2f4f6' },
  customer: { name: '번호표', short: '번호표', page: '/kiosk.html', icon: null, theme: null, bg: '#f2f4f6' },
  admin:    { name: '관리자 콘솔', short: '관리자', page: '/admin.html', icon: 'admin', theme: '#0f172a', bg: '#0f172a' },
  operator: { name: '진행요원 패널', short: '진행요원', page: '/operator.html', icon: 'operator', theme: '#0b101b', bg: '#0b101b' },
  board:    { name: '전광판', short: '전광판', page: '/display.html', icon: 'board', theme: '#05080f', bg: '#05080f' },
  hub:      { name: '현장 포털', short: '포털', page: '/hub.html', icon: 'operator', theme: '#0b101b', bg: '#0b101b' }
};

app.get('/manifest.webmanifest', (req, res) => {
  const role = ROLE_MANIFEST[req.query.role] ? req.query.role : 'hub';
  const cfg = ROLE_MANIFEST[role];
  const bankKey = String(req.query.b || req.query.bank || '').toLowerCase().trim();
  const bank = db.bankInfo[bankKey];

  const iconName = cfg.icon || (bank ? bankKey : 'default');
  const themeColor = cfg.theme || (bank ? bank.color : '#3182f6');
  const label = bank ? bank.name : '현장 상담';
  const startUrl = cfg.page + (bank ? '?b=' + bankKey : '');

  res.type('application/manifest+json').json({
    name: label + ' ' + cfg.name,
    short_name: bank ? bank.name.slice(0, 6) : cfg.short,
    description: '법무법인 제이엘 현장 상담 대기·호출 시스템',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: role === 'board' ? 'landscape' : 'portrait',
    background_color: cfg.bg,
    theme_color: themeColor,
    lang: 'ko',
    icons: [
      { src: '/icons/' + iconName + '-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/' + iconName + '-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/' + iconName + '-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
});

// 기본값은 앱 폴더라 재배포하면 사라진다. Render 에 영구 디스크를 붙이고 DATA_DIR 을
// 그 경로(예: /data)로 지정하면 재배포·재기동에도 저장 파일이 그대로 남는다.
const DATA_DIR = process.env.DATA_DIR || __dirname;
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {}
const BACKUP_FILE = path.join(DATA_DIR, 'queue_db_backup.json');

let db = {
  bankInfo: {},
  queues: {},
  desks: {},
  ticketSequence: {},
  completedLogs: [],
  passedLogs: [],
  settings: { ...INITIAL_SETTINGS }
};

// 등록된 상담처마다 대기열/창구/번호가 있게 하고, 지난 현장의 상담처(예: 우리은행) 자료는 지운다.
function normalizeDb() {
  db.bankInfo = clone(INITIAL_BANKS);
  ['queues', 'desks', 'ticketSequence'].forEach(k => {
    if (!db[k] || typeof db[k] !== 'object' || Array.isArray(db[k])) db[k] = {};
  });
  Object.keys(INITIAL_BANKS).forEach(b => {
    if (!Array.isArray(db.queues[b])) db.queues[b] = [];
    if (!Array.isArray(db.desks[b]) || db.desks[b].length === 0) db.desks[b] = makeDesks(INITIAL_DESK_COUNTS[b]);
    if (typeof db.ticketSequence[b] !== 'number') db.ticketSequence[b] = 0;
  });
  ['queues', 'desks', 'ticketSequence'].forEach(k => {
    Object.keys(db[k]).forEach(b => { if (!INITIAL_BANKS[b]) delete db[k][b]; });
  });
  if (!Array.isArray(db.completedLogs)) db.completedLogs = [];
  if (!Array.isArray(db.passedLogs)) db.passedLogs = [];
  db.completedLogs = db.completedLogs.filter(l => l && INITIAL_BANKS[l.bank]);
  db.passedLogs = db.passedLogs.filter(l => l && INITIAL_BANKS[l.bank]);
  db.settings = { ...INITIAL_SETTINGS, ...(db.settings || {}) };
}

function loadBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      if (parsed && parsed.queues) db = parsed;
    }
  } catch (err) {}
  normalizeDb();
}
loadBackup();

function saveBackup() {
  try {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {}
}

// 초 단위 차이 (안전하게 0 이상)
function secBetween(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b2 = new Date(toIso).getTime();
  if (isNaN(a) || isNaN(b2)) return 0;
  return Math.max(0, Math.round((b2 - a) / 1000));
}

// 현장은 한국이고 Render 서버는 UTC 로 돌아가므로 시간·날짜는 항상 한국 기준으로 계산한다.
const SEOUL_HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false });
function hourInSeoul(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  const h = parseInt(SEOUL_HOUR_FMT.format(d), 10);
  return isNaN(h) ? -1 : (h === 24 ? 0 : h);
}

const SEOUL_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
function seoulDate(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : SEOUL_DATE_FMT.format(d);
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
}

// 일일보고 통계: 기관별 / 창구별 / 시간대별 건수, 평균 상담시간, 평균 대기시간, 부재
function buildReport() {
  const logs = db.completedLogs || [];
  const passes = db.passedLogs || [];
  const openHour = db.settings.openHour;
  const closeHour = db.settings.closeHour;

  const hours = [];
  for (let h = openHour; h <= closeHour; h++) hours.push(h);
  // 설정한 영업시간 밖에 완료된 상담도 표에서 빠지지 않도록 실제 기록 시간대를 합친다.
  logs.forEach(l => {
    const h = hourInSeoul(l.completedAt);
    if (h >= 0 && !hours.includes(h)) hours.push(h);
  });
  hours.sort((a, b) => a - b);

  const banks = Object.keys(db.bankInfo).map(b => {
    const bankLogs = logs.filter(l => l.bank === b);
    const bankPasses = passes.filter(l => l.bank === b);
    const desks = (db.desks[b] || []).map(d => {
      const deskLogs = bankLogs.filter(l => l.desk === d.desk);
      return {
        desk: d.desk,
        name: d.name,
        count: deskLogs.length,
        avgDurationSec: avg(deskLogs.map(l => l.durationSec || 0)),
        totalDurationSec: deskLogs.reduce((x, l) => x + (l.durationSec || 0), 0)
      };
    });

    const hourly = hours.map(h => ({
      hour: h,
      count: bankLogs.filter(l => hourInSeoul(l.completedAt) === h).length
    }));

    return {
      bank: b,
      bankName: db.bankInfo[b].name,
      color: db.bankInfo[b].color,
      count: bankLogs.length,
      passCount: bankPasses.length,
      waitingCount: (db.queues[b] || []).filter(c => c.status === 'waiting').length,
      deskCount: (db.desks[b] || []).length,
      activeDeskCount: (db.desks[b] || []).filter(d => !d.away).length,
      avgDurationSec: avg(bankLogs.map(l => l.durationSec || 0)),
      maxDurationSec: bankLogs.reduce((m, l) => Math.max(m, l.durationSec || 0), 0),
      avgWaitSec: avg(bankLogs.map(l => l.waitSec || 0)),
      maxWaitSec: bankLogs.reduce((m, l) => Math.max(m, l.waitSec || 0), 0),
      desks,
      hourly
    };
  });

  const hourlyTotal = hours.map(h => ({
    hour: h,
    count: logs.filter(l => hourInSeoul(l.completedAt) === h).length
  }));

  const peak = hourlyTotal.reduce((m, x) => (x.count > m.count ? x : m), { hour: openHour, count: 0 });

  return {
    generatedAt: new Date().toISOString(),
    openHour: openHour,
    closeHour: closeHour,
    standardMinutes: db.settings.standardMinutes,
    totalCount: logs.length,
    totalPassCount: passes.length,
    totalWaiting: Object.keys(db.bankInfo).reduce((n, b) => n + (db.queues[b] || []).filter(c => c.status === 'waiting').length, 0),
    avgDurationSec: avg(logs.map(l => l.durationSec || 0)),
    avgWaitSec: avg(logs.map(l => l.waitSec || 0)),
    peakHour: peak.count > 0 ? peak.hour : null,
    peakCount: peak.count,
    banks,
    hourlyTotal,
    logs: publicLogs(logs)
  };
}

// ===== 호출 방송 =====
// 같은 손님을 짧은 시간 안에 두 번 방송하지 않는다(버튼 연타, 중복 신호).
let lastAnnouncedId = null;
let lastAnnouncedTime = 0;

function queueAnnouncement(payload) {
  const customerId = payload.customer && payload.customer.id;
  const now = Date.now();
  if (customerId && customerId === lastAnnouncedId && now - lastAnnouncedTime < 2500) return;
  if (customerId) {
    lastAnnouncedId = customerId;
    lastAnnouncedTime = now;
  }
  payload.repeatCount = (db.settings && db.settings.repeatCount) ? Math.max(1, db.settings.repeatCount) : 1;
  io.emit('play_announcement', payload);
}

function resetAnnounceQueue() {
  lastAnnouncedId = null;
  lastAnnouncedTime = 0;
}

// 등록된 상담처면 그 코드를, 아니면 null 을 돌려준다.
// 바꾸는 동작(발권·호출·완료 등)은 모르는 코드를 다른 기관으로 바꿔 처리하면 안 된다.
function knownBank(b) {
  const bank = String(b || '').toLowerCase().trim();
  return db.bankInfo[bank] ? bank : null;
}

function sanitizeBank(b) {
  return knownBank(b) || JL;
}

function hasLiveData() {
  const banks = Object.keys(db.bankInfo);
  if (banks.some(b => (db.queues[b] || []).length > 0)) return true;
  if (banks.some(b => (db.ticketSequence[b] || 0) > 0)) return true;
  if ((db.completedLogs || []).length > 0) return true;
  return banks.some(b => (db.desks[b] || []).some(d => d.currentCustomer));
}

// ===== 서버 재시작 직후 복구 대기 =====
// 서버가 빈 상태로 뜨면 잠시 손님 발권을 멈춘다. 손님 폰이 관리자 콘솔보다 먼저 붙어
// 발권해 버리면 서버가 '데이터 있음'이 되어 관리자 콘솔의 자동 복구가 거절되기 때문이다.
// 복구가 끝나거나, 관리자 콘솔이 '오늘 백업 없음'을 알리거나, 20초가 지나면 풀린다.
const RESTORE_WINDOW_MS = 20000;
let restorePending = !hasLiveData();
let restoreDeadline = Date.now() + RESTORE_WINDOW_MS;

function restoring() {
  if (restorePending && Date.now() > restoreDeadline) restorePending = false;
  return restorePending;
}

function safeText(v, max, fallback) {
  const s = (v == null ? '' : String(v)).slice(0, max);
  return s || fallback;
}

function safeTime(v) {
  const t = new Date(v);
  return isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

function safeCount(v, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// 손님 폰마다 만드는 식별값. 영문/숫자/하이픈만, 64자까지.
function safeDeviceId(v) {
  const s = String(v == null ? '' : v).slice(0, 64);
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : '';
}

function restoreCustomer(raw, bank) {
  if (!raw || typeof raw !== 'object') return null;
  const ticketNumber = parseInt(raw.ticketNumber, 10);
  if (!Number.isFinite(ticketNumber) || ticketNumber <= 0 || ticketNumber > 100000) return null;

  const customer = {
    id: safeText(raw.id, 80, `${bank}-${ticketNumber}-${Date.now()}`),
    ticketNumber,
    bank,
    bankName: db.bankInfo[bank].name,
    phone: safeText(raw.phone, 30, ''),
    name: safeText(raw.name, 30, '고객'),
    deviceId: safeDeviceId(raw.deviceId),
    status: raw.status === 'called' ? 'called' : 'waiting',
    createdAt: safeTime(raw.createdAt)
  };

  const desk = parseInt(raw.desk, 10);
  if (Number.isFinite(desk) && desk > 0 && desk <= 50) {
    customer.desk = desk;
    customer.deskName = safeText(raw.deskName, 20, `${desk}번 창구`);
    customer.calledAt = safeTime(raw.calledAt);
  }
  return customer;
}

function restoreLogs(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.slice(-3000).map(l => {
    if (!l || typeof l !== 'object' || !db.bankInfo[l.bank]) return null;
    return {
      bank: l.bank,
      bankName: db.bankInfo[l.bank].name,
      ticketNumber: safeCount(l.ticketNumber, 100000),
      ticketId: safeText(l.ticketId, 80, ''),
      deviceId: safeDeviceId(l.deviceId),
      name: safeText(l.name, 30, '고객'),
      desk: safeCount(l.desk, 50),
      deskName: safeText(l.deskName, 20, ''),
      durationSec: safeCount(l.durationSec, 86400),
      waitSec: safeCount(l.waitSec, 86400),
      completedAt: safeTime(l.completedAt || l.passedAt),
      passedAt: l.passedAt ? safeTime(l.passedAt) : undefined
    };
  }).filter(Boolean);
}

// ===== 손님 번호표 조회 =====

// 이 폰이 그 상담처에 지금 살아있는 번호(대기 중이거나 창구에서 상담 중)를 갖고 있는지
function liveTicketOf(deviceId, bank) {
  if (!deviceId) return null;
  const q = (db.queues[bank] || []).find(c => c.deviceId === deviceId);
  if (q) return q;
  const d = (db.desks[bank] || []).find(x => x.currentCustomer && x.currentCustomer.deviceId === deviceId);
  return d ? d.currentCustomer : null;
}

function deviceAtJl(deviceId) {
  return !!liveTicketOf(deviceId, JL);
}

// 다른 상담처에 살아있는 번호가 있으면 첫 번째 것을 돌려준다.
function liveTicketElsewhere(deviceId, exceptBank) {
  if (!deviceId) return null;
  for (const b of Object.keys(db.bankInfo)) {
    if (b === exceptBank) continue;
    const t = liveTicketOf(deviceId, b);
    if (t) return t;
  }
  return null;
}

function ticketBrief(t) {
  return t ? { bank: t.bank, bankName: t.bankName, ticketNumber: t.ticketNumber, id: t.id } : null;
}

function isLiveId(bank, id) {
  if ((db.queues[bank] || []).some(c => c.id === id)) return true;
  return (db.desks[bank] || []).some(d => d.currentCustomer && d.currentCustomer.id === id);
}

// 제이엘 완료 증명: 서버만 만들 수 있고, 그 폰에서만 통한다(번호표 ID + 폰 식별값 서명).
const PROOF_SECRET = process.env.JL_PROOF_SECRET || 'jl-jeonju-queue-proof-v1';
function signProof(deviceId, ticketId) {
  const mac = crypto.createHmac('sha256', PROOF_SECRET).update(deviceId + '|' + ticketId).digest('hex').slice(0, 20);
  return ticketId + '.' + mac;
}

// 오늘(한국 기준) 이 폰이 제이엘 상담을 마쳤으면 완료 증명을, 아니면 null.
// 1순위는 서버의 완료 기록. 통계를 지웠거나 재시작 후 복구가 안 됐을 때를 대비해
// 서버가 예전에 내려준 증명(attest)을 폰이 다시 보내면 확인 후 인정한다.
function jlProof(deviceId, attest) {
  if (!deviceId) return null;
  const today = seoulDate(Date.now());
  for (let i = db.completedLogs.length - 1; i >= 0; i--) {
    const l = db.completedLogs[i];
    if (l.bank === JL && l.ticketId && l.deviceId === deviceId && seoulDate(l.completedAt) === today) {
      return signProof(deviceId, l.ticketId);
    }
  }
  const a = typeof attest === 'string' ? attest.slice(0, 120) : '';
  const dot = a.lastIndexOf('.');
  if (dot < 0) return null;
  const ticketId = a.slice(0, dot);
  if (signProof(deviceId, ticketId) !== a) return null;           // 서버가 이 폰에 준 증명이 아님
  const m = /^jl-\d+-(\d{12,14})$/.exec(ticketId);
  if (!m) return null;
  if (seoulDate(parseInt(m[1], 10)) !== today) return null;       // 어제 받은 번호는 인정하지 않는다
  if (isLiveId(JL, ticketId)) return null;                         // 완료를 되돌려 다시 상담 중
  if ((db.passedLogs || []).some(l => l.ticketId === ticketId)) return null;  // 부재 처리된 번호
  return a;
}

// 은행 대기 손님이 지금 제이엘에서 상담 중(또는 제이엘 대기 중)이면 은행은 부르면 안 된다.
function isHeldAtJl(bank, cust) {
  return bank !== JL && !!cust && !!cust.deviceId && deviceAtJl(cust.deviceId);
}

function heldIdsOf(bank) {
  if (bank === JL) return [];
  return (db.queues[bank] || []).filter(c => c.status === 'waiting' && isHeldAtJl(bank, c)).map(c => c.id);
}

function pickNext(bank) {
  return (db.queues[bank] || []).find(c => c.status === 'waiting' && !isHeldAtJl(bank, c)) || null;
}

// 화면으로 보내는 완료/부재 기록에서는 되돌리기용 손님 사본을 뺀다(서버에는 남긴다).
// 하루 종일 모든 손님 폰이 받는 데이터라 크기가 커지면 연결이 끊기기 쉽다.
function publicLogs(list) {
  return (list || []).map(l => {
    const { customer, ...rest } = l;
    return rest;
  });
}

function bankPayload(b) {
  return {
    bank: b,
    bankInfo: db.bankInfo[b],
    queue: db.queues[b] || [],
    desks: db.desks[b] || [],
    heldIds: heldIdsOf(b),
    settings: db.settings,
    logs: publicLogs((db.completedLogs || []).filter(l => l.bank === b)),
    passed: publicLogs((db.passedLogs || []).filter(l => l.bank === b)),
    serverTime: new Date().toISOString()
  };
}

function allPayload() {
  return {
    bankInfo: db.bankInfo,
    queues: db.queues,
    desks: db.desks,
    ticketSequence: db.ticketSequence,   // 관리자 콘솔 백업이 발권 번호를 그대로 이어가는 데 쓴다
    logs: publicLogs(db.completedLogs),
    passes: publicLogs(db.passedLogs),
    settings: db.settings,
    restoring: restoring(),
    serverTime: new Date().toISOString()
  };
}

function broadcastAll() {
  io.emit('all_state_update', allPayload());
  saveBackup();
}

function broadcastEverywhere() {
  Object.keys(db.bankInfo).forEach(b => io.emit('state_update', bankPayload(b)));
  broadcastAll();
}

// 제이엘 상태가 바뀌면 은행들의 '제이엘 상담중' 표시도 바뀌므로 전 기관을 다시 보낸다.
function broadcastBank(bank) {
  const b = sanitizeBank(bank);
  if (b === JL) return broadcastEverywhere();
  io.emit('state_update', bankPayload(b));
  broadcastAll();
}

function createTicket(b, deviceId, name, phone) {
  if (db.ticketSequence[b] == null) db.ticketSequence[b] = 0;
  if (!db.queues[b]) db.queues[b] = [];
  db.ticketSequence[b] += 1;
  const ticketNumber = db.ticketSequence[b];
  const ticket = {
    id: `${b}-${ticketNumber}-${Date.now()}`,
    ticketNumber,
    bank: b,
    bankName: db.bankInfo[b].name,
    phone: safeText(phone, 30, ''),
    name: safeText(name, 30, '고객'),
    deviceId: deviceId || '',
    status: 'waiting',
    createdAt: new Date().toISOString()
  };
  db.queues[b].push(ticket);

  // 상담사 앱 접수 알림용 (자기 기관만 골라 쓰도록 bank 를 함께 보낸다)
  io.emit('ticket_issued', {
    bank: b,
    bankName: db.bankInfo[b].name,
    ticket,
    waitingCount: db.queues[b].filter(c => c.status === 'waiting').length
  });
  broadcastBank(b);
  return ticket;
}

const callThrottle = {};

function callerBlocked(b, deskNumber) {
  const deskKey = `${b}_${deskNumber}`;
  const now = Date.now();
  if (callThrottle[deskKey] && now - callThrottle[deskKey] < 1500) return true;
  callThrottle[deskKey] = now;
  return false;
}

function callPayload(b, desk, customer) {
  return { bank: b, bankName: db.bankInfo[b].name, desk: desk.desk, deskName: desk.name, customer };
}

function seatCustomer(desk, cust) {
  cust.status = 'called';
  cust.desk = desk.desk;
  cust.deskName = desk.name;
  cust.calledAt = new Date().toISOString();
  desk.status = 'consulting';
  desk.away = false;
  desk.currentCustomer = cust;
}

io.on('connection', (socket) => {
  socket.on('get_state', (payload) => {
    const b = knownBank(payload && payload.bank);
    if (!b) return;
    socket.emit('state_update', bankPayload(b));
  });

  socket.on('get_all_state', () => {
    socket.emit('all_state_update', allPayload());
  });

  // 발권. 손님 폰은 서버의 판정 결과(status) 하나를 받아 그대로 화면에 보여준다.
  //  ticket       번호표 (이 기관에 살아있는 번호가 이미 있으면 그 번호를 그대로 돌려준다)
  //  blocked      다른 기관 번호가 아직 살아있음
  //  jl_required  오늘 제이엘 상담을 마치지 않음 -> 제이엘로
  //  jl_done      제이엘 QR 을 다시 찍었는데 이미 마침 -> 은행 선택
  //  completed    폰이 들고 있던 번호가 상담 완료됨
  //  passed       폰이 들고 있던 번호가 부재 처리됨
  //  wait         서버 재시작 직후 복구 대기 중
  //  unknown_bank 등록되지 않은 기관 코드
  // 대리 발권(proxy)은 직원 판단이므로 모든 관문을 건너뛴다.
  socket.on('issue_ticket', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return ack({ success: false, status: 'unknown_bank' });

    if (p.proxy) {
      if (restoring()) return ack({ success: false, status: 'wait', message: '서버 복구 중입니다. 잠시 후 다시 눌러 주세요.' });
      const t = createTicket(b, '', p.name || '대리발권', p.phone);
      return ack({ success: true, status: 'ticket', ticket: t });
    }

    const deviceId = safeDeviceId(p.deviceId);
    if (!deviceId) return ack({ success: false, status: 'reload' });
    if (restoring()) return ack({ success: false, status: 'wait' });

    const own = liveTicketOf(deviceId, b);
    if (own) {
      return ack({
        success: true, status: 'ticket', ticket: own,
        held: isHeldAtJl(b, own),
        jlProof: jlProof(deviceId, p.jlAttest)
      });
    }

    // 폰이 들고 있던 번호가 사라졌다면 이유를 알려준다. 새 번호를 자동으로 주지 않는다.
    // (호출될 때 화면이 꺼져 있던 손님이 화면을 켜는 순간 새 번호를 받아버리는 문제 방지)
    const prev = typeof p.prevTicketId === 'string' ? p.prevTicketId : '';
    if (!p.fresh && prev && prev.indexOf(b + '-') === 0) {
      if ((db.completedLogs || []).some(l => l.ticketId === prev)) {
        return ack({
          success: false, status: 'completed', bank: b,
          jlProof: jlProof(deviceId, p.jlAttest),
          heldElsewhere: ticketBrief(liveTicketElsewhere(deviceId, b))
        });
      }
      if ((db.passedLogs || []).some(l => l.ticketId === prev)) {
        return ack({ success: false, status: 'passed', bank: b });
      }
      // 번호 초기화·일마감·재시작으로 사라진 번호는 아래에서 새로 판정한다.
    }

    const jlId = jlProof(deviceId, p.jlAttest);
    if (b === JL && jlId) {
      return ack({
        success: false, status: 'jl_done', jlProof: jlId,
        heldElsewhere: ticketBrief(liveTicketElsewhere(deviceId, JL))
      });
    }

    const elsewhere = liveTicketElsewhere(deviceId, b);
    if (elsewhere) return ack({ success: false, status: 'blocked', held: ticketBrief(elsewhere) });

    if (b !== JL && !jlId) return ack({ success: false, status: 'jl_required' });

    // 폰에 번호가 있었는데 서버에서 사라진 경우(번호 초기화·일마감 등)는 새 번호를 자동으로 주지 않는다.
    // 화면이 열려 있던 손님 폰들이 한꺼번에 새 번호를 뽑아 대기열이 유령 번호로 차는 것을 막는다.
    if (p.checkOnly) return ack({ success: false, status: 'gone' });

    const t = createTicket(b, deviceId, p.name, p.phone);
    return ack({ success: true, status: 'ticket', ticket: t, jlProof: jlId });
  });

  socket.on('call_customer', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    if (callerBlocked(b, p.deskNumber)) return;

    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk) return;

    let target;
    if (p.customerId) {
      target = (db.queues[b] || []).find(c => c.id === p.customerId);
      if (!target) return;
      if (isHeldAtJl(b, target)) {
        return socket.emit('call_refused', { bank: b, message: `${target.ticketNumber}번 손님은 지금 법무법인 제이엘 상담 중입니다. 제이엘 상담이 끝나면 호출할 수 있습니다.` });
      }
    } else {
      target = pickNext(b);
      if (!target) {
        if (heldIdsOf(b).length > 0) {
          socket.emit('call_refused', { bank: b, message: '대기 손님이 모두 법무법인 제이엘 상담 중입니다. 제이엘 상담이 끝나면 호출할 수 있습니다.' });
        }
        return;
      }
    }

    seatCustomer(desk, target);
    const calledPayload = callPayload(b, desk, target);
    io.emit('customer_called', calledPayload);
    queueAnnouncement(calledPayload);
    broadcastBank(b);
  });

  socket.on('recall_customer', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    if (callerBlocked(b, p.deskNumber)) return;

    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const recalledPayload = callPayload(b, desk, desk.currentCustomer);
    io.emit('customer_called', recalledPayload);
    queueAnnouncement(recalledPayload);
  });

  socket.on('complete_consultation', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const completedCust = desk.currentCustomer;
    const completedAt = new Date().toISOString();
    db.completedLogs.push({
      bank: b,
      bankName: db.bankInfo[b].name,
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: completedCust.ticketNumber,
      ticketId: completedCust.id,
      deviceId: completedCust.deviceId || '',
      createdAt: completedCust.createdAt,
      calledAt: completedCust.calledAt,
      completedAt,
      // 상담 소요시간(호출 -> 완료), 대기시간(발권 -> 호출)
      durationSec: completedCust.calledAt ? secBetween(completedCust.calledAt, completedAt) : 0,
      waitSec: completedCust.createdAt && completedCust.calledAt ? secBetween(completedCust.createdAt, completedCust.calledAt) : 0,
      customer: clone(completedCust)   // 실수로 완료했을 때 되돌리기 위해 보관
    });

    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== completedCust.id);
    desk.status = 'idle';
    desk.currentCustomer = null;

    broadcastBank(b);

    if (p.autoCall) {
      const nextCust = pickNext(b);
      if (nextCust) {
        seatCustomer(desk, nextCust);
        const autoPayload = callPayload(b, desk, nextCust);
        io.emit('customer_called', autoPayload);
        queueAnnouncement(autoPayload);
        broadcastBank(b);
      }
    }
  });

  // 부재: 호출했는데 오지 않은 고객을 창구에서 내리고 대기열에서 제외
  socket.on('pass_customer', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const passed = desk.currentCustomer;
    if (!Array.isArray(db.passedLogs)) db.passedLogs = [];
    db.passedLogs.push({
      bank: b,
      bankName: db.bankInfo[b].name,
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: passed.ticketNumber,
      ticketId: passed.id,
      deviceId: passed.deviceId || '',
      passedAt: new Date().toISOString(),
      customer: clone(passed)          // 손님이 다시 오면 되살리기 위해 보관
    });
    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== passed.id);
    desk.status = 'idle';
    desk.currentCustomer = null;

    io.emit('customer_passed', {
      bank: b,
      bankName: db.bankInfo[b].name,
      desk: desk.desk,
      deskName: desk.name,
      customer: passed
    });
    broadcastBank(b);
  });

  // 자리 비움 / 복귀. 비운 창구는 예상 대기시간 계산에서 빠진다.
  socket.on('set_desk_away', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk) return;
    if (p.away && desk.currentCustomer) return;
    desk.away = !!p.away;
    broadcastBank(b);
  });

  // 상담 완료를 잘못 눌렀을 때 되돌리기 (5분 이내)
  socket.on('undo_complete', (payload, callback) => {
    const p = payload || {};
    const done = (typeof callback === 'function') ? callback : () => {};
    const b = knownBank(p.bank);
    if (!b) return done({ success: false, message: '등록되지 않은 상담처입니다.' });
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(p.deskNumber));
    if (!desk) return done({ success: false, message: '창구를 찾을 수 없습니다.' });

    let idx = -1;
    for (let i = db.completedLogs.length - 1; i >= 0; i--) {
      const l = db.completedLogs[i];
      if (l.bank === b && l.desk === desk.desk) { idx = i; break; }
    }
    if (idx < 0) return done({ success: false, message: '되돌릴 완료 내역이 없습니다.' });

    const log = db.completedLogs[idx];
    if (!log.customer) return done({ success: false, message: '되돌릴 수 없는 내역입니다.' });
    if (secBetween(log.completedAt, new Date().toISOString()) > 300) {
      return done({ success: false, message: '완료한 지 5분이 지나 되돌릴 수 없습니다.' });
    }

    // 제이엘 완료를 되돌리는데 그 손님이 이미 은행 창구에서 상담 중이면 막는다.
    if (b === JL && log.customer.deviceId) {
      for (const other of Object.keys(db.bankInfo)) {
        if (other === JL) continue;
        const atDesk = (db.desks[other] || []).find(d => d.currentCustomer && d.currentCustomer.deviceId === log.customer.deviceId);
        if (atDesk) {
          return done({ success: false, message: `이 손님은 이미 ${db.bankInfo[other].name} ${atDesk.name}에서 상담 중이라 되돌릴 수 없습니다.` });
        }
      }
    }

    // 완료 후 자동으로 다음 고객을 부른 상태라면 그 고객을 대기열 맨 앞으로 돌려놓는다.
    if (desk.currentCustomer) {
      const cur = desk.currentCustomer;
      cur.status = 'waiting';
      delete cur.desk; delete cur.deskName; delete cur.calledAt;
      db.queues[b] = (db.queues[b] || []).filter(c => c.id !== cur.id);
      db.queues[b].unshift(cur);
    }

    const restored = log.customer;
    restored.status = 'called';
    restored.desk = desk.desk;
    restored.deskName = desk.name;

    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== restored.id);
    db.queues[b].unshift(restored);
    desk.status = 'consulting';
    desk.away = false;
    desk.currentCustomer = restored;

    db.completedLogs.splice(idx, 1);
    broadcastBank(b);
    done({ success: true, ticketNumber: restored.ticketNumber });
  });

  // 부재 처리했던 손님이 다시 왔을 때 대기열 맨 앞으로 되살리기
  socket.on('restore_passed', (payload, callback) => {
    const p = payload || {};
    const done = (typeof callback === 'function') ? callback : () => {};
    const b = knownBank(p.bank);
    if (!b) return done({ success: false, message: '등록되지 않은 상담처입니다.' });

    let idx = -1;
    for (let i = db.passedLogs.length - 1; i >= 0; i--) {
      const l = db.passedLogs[i];
      if (l.bank === b && l.ticketNumber === parseInt(p.ticketNumber)) { idx = i; break; }
    }
    if (idx < 0) return done({ success: false, message: '부재 내역을 찾을 수 없습니다.' });

    const log = db.passedLogs[idx];
    if (!log.customer) return done({ success: false, message: '되살릴 수 없는 내역입니다.' });

    // 그 손님이 이미 이 기관 번호를 새로 받았다면 되살리면 번호가 두 개가 된다.
    const devId = log.customer.deviceId;
    if (devId && liveTicketOf(devId, b)) {
      return done({ success: false, message: '이 손님은 이미 새 번호표를 받았습니다.' });
    }

    const cust = log.customer;
    cust.status = 'waiting';
    delete cust.desk; delete cust.deskName; delete cust.calledAt;

    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== cust.id);
    db.queues[b].unshift(cust);   // 기다리셨던 분이므로 맨 앞으로
    db.passedLogs.splice(idx, 1);

    broadcastBank(b);
    done({ success: true, ticketNumber: cust.ticketNumber });
  });

  socket.on('transfer_customer', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    const sourceDesk = (db.desks[b] || []).find(d => d.desk === parseInt(p.fromDesk));
    const targetDesk = (db.desks[b] || []).find(d => d.desk === parseInt(p.toDesk));
    if (!sourceDesk || !sourceDesk.currentCustomer || !targetDesk || targetDesk.currentCustomer) return;

    const cust = sourceDesk.currentCustomer;
    cust.desk = targetDesk.desk;
    cust.deskName = targetDesk.name;

    sourceDesk.status = 'idle';
    sourceDesk.currentCustomer = null;

    targetDesk.status = 'consulting';
    targetDesk.away = false;
    targetDesk.currentCustomer = cust;

    const transferPayload = callPayload(b, targetDesk, cust);
    io.emit('customer_called', transferPayload);
    queueAnnouncement(transferPayload);
    broadcastBank(b);
  });

  socket.on('modify_desk_count', (payload) => {
    const p = payload || {};
    const b = knownBank(p.bank);
    if (!b) return;
    if (!db.desks[b]) db.desks[b] = [];
    const list = db.desks[b];

    let removedDesk = null;
    if (p.action === 'add') {
      if (list.length >= 50) return;
      // 번호가 겹치지 않도록 현재 최대 번호 다음으로 만든다.
      const nextNum = list.reduce((m, d) => Math.max(m, d.desk), 0) + 1;
      list.push({ desk: nextNum, name: `${nextNum}번 창구`, status: 'idle', currentCustomer: null, away: false });
    } else if (p.action === 'remove' && list.length > 1) {
      const last = list[list.length - 1];
      // 상담 중인 고객이 있으면 대기열 맨 앞으로 되돌린 뒤 창구를 없앤다.
      if (last.currentCustomer) {
        const cust = last.currentCustomer;
        cust.status = 'waiting';
        delete cust.desk;
        delete cust.deskName;
        delete cust.calledAt;
        db.queues[b] = (db.queues[b] || []).filter(c => c.id !== cust.id);
        db.queues[b].unshift(cust);
      }
      removedDesk = last.desk;
      list.pop();
    } else {
      return;
    }

    io.emit('desks_changed', {
      bank: b,
      action: p.action,
      removedDesk,
      desks: list.map(d => ({ desk: d.desk, name: d.name }))
    });
    broadcastBank(b);
  });

  // 현장에서 임시로 기관을 추가 (메모리에만 있어 재배포하면 사라진다)
  socket.on('admin_add_bank', (payload) => {
    const p = payload || {};
    const c = String(p.code || '').toLowerCase().trim();
    if (!/^[a-z0-9]{1,20}$/.test(c) || db.bankInfo[c]) return;

    db.bankInfo[c] = {
      name: safeText(String(p.name || '').trim(), 30, c.toUpperCase()),
      color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#38bdf8',
      sub: '#f2f4f6',
      btnText: '#ffffff'
    };
    db.queues[c] = [];
    db.desks[c] = makeDesks(1);
    db.ticketSequence[c] = 0;
    broadcastEverywhere();
  });

  // 표준 상담시간 등 현장 설정 변경
  socket.on('admin_set_settings', (patch) => {
    const next = { ...db.settings };
    if (patch && patch.standardMinutes != null) {
      const m = parseInt(patch.standardMinutes, 10);
      if (!isNaN(m) && m >= 1 && m <= 180) next.standardMinutes = m;
    }
    if (patch && patch.repeatCount != null) {
      const r = parseInt(patch.repeatCount, 10);
      if (!isNaN(r) && r >= 1 && r <= 3) next.repeatCount = r;
    }
    if (patch && patch.openHour != null) {
      const h = parseInt(patch.openHour, 10);
      if (!isNaN(h) && h >= 0 && h <= 23) next.openHour = h;
    }
    if (patch && patch.closeHour != null) {
      const h = parseInt(patch.closeHour, 10);
      if (!isNaN(h) && h >= 0 && h <= 23) next.closeHour = h;
    }
    // 종료 시각이 시작보다 빠르면 설정을 받아들이지 않는다.
    if (next.closeHour < next.openHour) return;
    db.settings = next;
    broadcastEverywhere();
  });

  // 마감 전에도 언제든 중간 보고서 조회
  socket.on('admin_get_report', () => {
    socket.emit('report_data', buildReport());
  });

  socket.on('admin_reset_tickets', (payload) => {
    const p = payload || {};
    let targetBanks;
    if (p.bank === 'all') {
      targetBanks = Object.keys(db.bankInfo);
    } else {
      const b = knownBank(p.bank);
      if (!b) return;
      targetBanks = [b];
    }
    targetBanks.forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 0;
      (db.desks[b] || []).forEach(d => { d.status = 'idle'; d.currentCustomer = null; });
    });
    db.passedLogs = (db.passedLogs || []).filter(l => !targetBanks.includes(l.bank));
    // 은행별로 나눠 방송하면 '일부만 비워진 상태'가 밖으로 나가고, 관리자 콘솔이 그걸
    // 백업으로 저장해 리셋한 대기가 되살아난다. 다 비운 뒤 한 번에 방송한다.
    broadcastEverywhere();
  });

  // 비상 복구: 멈춘 창구 상태와 방송만 정리한다. 대기 손님과 당일 실적은 지우지 않는다.
  socket.on('admin_emergency_repair', () => {
    db.bankInfo = clone(INITIAL_BANKS);
    const repairedDesks = {};
    Object.keys(db.bankInfo).forEach(b => {
      // 창구에서 상담 중이던 고객은 사라지지 않도록 대기열 맨 앞으로 돌려놓는다.
      const backToQueue = (db.desks[b] || [])
        .map(d => d.currentCustomer)
        .filter(Boolean)
        .map(c => {
          const cust = { ...c, status: 'waiting' };
          delete cust.desk;
          delete cust.deskName;
          delete cust.calledAt;
          return cust;
        });
      if (backToQueue.length > 0) {
        const ids = backToQueue.map(c => c.id);
        db.queues[b] = backToQueue.concat((db.queues[b] || []).filter(c => !ids.includes(c.id)));
      }
      // 창구 '개수'는 그날의 인원 배치이므로 유지하고, 하나도 없을 때만 기본값으로 둔다.
      const current = Array.isArray(db.desks[b]) ? db.desks[b].length : 0;
      repairedDesks[b] = makeDesks(current > 0 ? current : INITIAL_DESK_COUNTS[b]);
    });
    db.desks = repairedDesks;
    normalizeDb();
    resetAnnounceQueue();
    io.emit('emergency_repaired');
    broadcastEverywhere();
  });

  // 관리자 콘솔에 오늘 백업이 없으면 바로 발권을 열어준다.
  socket.on('admin_restore_none', () => {
    if (!restorePending) return;
    restorePending = false;
    broadcastAll();
  });

  // 관리자 콘솔이 보관하던 마지막 상태로 대기 데이터를 되살린다.
  // 이미 데이터가 들어있는 서버에는 적용하지 않으므로, 관리자 화면이 여러 대 열려 있어도
  // 먼저 도착한 한 번만 반영되고 나머지는 조용히 무시된다.
  socket.on('admin_restore_state', (snapshot, callback) => {
    const done = (ok, reason, restored) => {
      if (typeof callback === 'function') callback({ ok, reason: reason || '', restored: restored || 0 });
    };
    if (!snapshot || typeof snapshot !== 'object') return done(false, 'invalid');
    if (hasLiveData()) {
      restorePending = false;
      broadcastAll();
      return done(false, 'server_not_empty');
    }

    let restored = 0;
    Object.keys(db.bankInfo).forEach((b) => {
      const rawQueue = Array.isArray((snapshot.queues || {})[b]) ? snapshot.queues[b] : [];
      const queue = rawQueue.slice(0, 500).map(c => restoreCustomer(c, b)).filter(Boolean);
      db.queues[b] = queue;
      restored += queue.length;

      // 창구 배치(개수)와 상담 중이던 고객도 함께 되살린다.
      const rawDesks = Array.isArray((snapshot.desks || {})[b]) ? snapshot.desks[b] : [];
      const deskCount = rawDesks.length > 0 ? Math.min(rawDesks.length, 50) : (db.desks[b] || []).length;
      db.desks[b] = Array.from({ length: deskCount }, (_, i) => {
        const src = rawDesks[i] || {};
        const current = restoreCustomer(src.currentCustomer, b);
        if (current) {
          // 상담 중인 손님은 대기열에도 같은 객체로 있어야 한다.
          const inQueue = db.queues[b].findIndex(c => c.id === current.id);
          if (inQueue >= 0) db.queues[b][inQueue] = current;
          else restored += 1;
        }
        return {
          desk: i + 1,
          name: `${i + 1}번 창구`,
          status: current ? 'consulting' : 'idle',
          currentCustomer: current,
          away: src.away === true
        };
      });

      // 번호가 겹치지 않도록, 저장된 발권 번호와 실제 남은 번호 중 큰 값에서 이어간다.
      const savedSeq = safeCount((snapshot.ticketSequence || {})[b], 100000);
      const maxInQueue = db.queues[b].reduce((m, c) => Math.max(m, c.ticketNumber), 0);
      const maxAtDesk = db.desks[b].reduce(
        (m, d) => Math.max(m, d.currentCustomer ? d.currentCustomer.ticketNumber : 0), 0);
      db.ticketSequence[b] = Math.max(savedSeq, maxInQueue, maxAtDesk);
    });

    db.completedLogs = restoreLogs(snapshot.completedLogs);
    db.passedLogs = restoreLogs(snapshot.passedLogs);
    if (snapshot.settings && typeof snapshot.settings === 'object') {
      const open = safeCount(snapshot.settings.openHour, 23);
      const close = safeCount(snapshot.settings.closeHour, 23);
      db.settings = {
        ...db.settings,
        openHour: close >= open ? open : db.settings.openHour,
        closeHour: close >= open ? close : db.settings.closeHour,
        standardMinutes: Math.min(safeCount(snapshot.settings.standardMinutes, 180), 180) || db.settings.standardMinutes,
        repeatCount: Math.min(safeCount(snapshot.settings.repeatCount, 3), 3) || db.settings.repeatCount
      };
    }

    restorePending = false;
    io.emit('state_restored', { restored });
    broadcastEverywhere();
    done(true, '', restored);
  });

  // 일마감: 대기열과 창구를 비우고 번호를 1번부터 다시 시작한다. 완료 실적은 보고서용으로 남긴다.
  socket.on('admin_day_close', () => {
    const report = buildReport();
    report.closedAt = new Date().toISOString();

    Object.keys(db.bankInfo).forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 0;
      (db.desks[b] || []).forEach(d => { d.status = 'idle'; d.currentCustomer = null; d.away = false; });
    });
    db.passedLogs = [];
    resetAnnounceQueue();

    broadcastEverywhere();
    io.emit('day_closed', report);
  });

  // 마감 보고까지 끝낸 뒤 통계를 완전히 비우는 별도 동작
  socket.on('admin_clear_logs', () => {
    db.completedLogs = [];
    db.passedLogs = [];
    broadcastEverywhere();
  });
});

// Render 무료 플랜 슬립 방지 (15분 무접속 시 서버가 잠들어 현장에서 첫 접속이 느려짐)
const SELF_URL = process.env.SELF_URL || 'https://bank-queue.onrender.com';
setInterval(() => {
  try {
    const client = SELF_URL.startsWith('https:') ? https : httpMod;
    const req = client.get(SELF_URL, (res) => res.resume());
    req.on('error', () => {});
    req.setTimeout(15000, () => req.destroy());
  } catch (err) {}
}, 10 * 60 * 1000);

// 현장 운영 중 예기치 못한 오류로 서버가 내려가는 것을 막는 안전장치.
// (상담 대기열은 메모리에 있으므로 프로세스가 죽으면 전체 현장이 멈춘다)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
