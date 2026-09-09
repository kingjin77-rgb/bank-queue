const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
const httpMod = require('http');

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

// ===== 홈 화면 앱 설치용 매니페스트 =====
// 역할과 은행에 따라 앱 이름/아이콘/시작주소가 달라지므로 서버에서 만들어 준다.
const ROLE_MANIFEST = {
  teller:   { name: '창구 상담사', short: '창구', page: '/teller.html', icon: null,       theme: null,      bg: '#f2f4f6' },
  customer: { name: '번호표',      short: '번호표', page: '/kiosk.html', icon: null,      theme: null,      bg: '#f2f4f6' },
  admin:    { name: '관리자 콘솔', short: '관리자', page: '/admin.html', icon: 'admin',    theme: '#0f172a', bg: '#0f172a' },
  operator: { name: '진행요원 패널', short: '진행요원', page: '/operator.html', icon: 'operator', theme: '#0b101b', bg: '#0b101b' },
  board:    { name: '전광판',      short: '전광판', page: '/display.html', icon: 'board', theme: '#05080f', bg: '#05080f' },
  leader:   { name: '우리은행 팀장', short: '팀장', page: '/woori_leader.html', icon: 'woori', theme: '#0067ac', bg: '#f2f4f6' },
  hub:      { name: '현장 포털',   short: '포털',  page: '/hub.html',    icon: 'operator', theme: '#0b101b', bg: '#0b101b' }
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

const BACKUP_FILE = path.join(__dirname, 'queue_db_backup.json');

// 푸본현대생명 공식 그린(#00A88F) 적용
const INITIAL_BANKS = {
  kb: { name: '국민은행', color: '#ffbc00', sub: '#fff9e6', btnText: '#2b2b2b' },
  shinhan: { name: '신한은행', color: '#0046ff', sub: '#e8f0fe', btnText: '#ffffff' },
  woori: { name: '우리은행', color: '#0067ac', sub: '#e6f3fa', btnText: '#ffffff' },
  fubon: { name: '푸본현대생명', color: '#00A88F', sub: '#e6f7f4', btnText: '#ffffff' }
};

const INITIAL_DESKS = {
  kb: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null }
  ],
  shinhan: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null }
  ],
  woori: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null }
  ],
  fubon: [
    { desk: 1, name: '단일 창구', status: 'idle', currentCustomer: null }
  ]
};

// 현장 운영 기본 설정 (관리자 콘솔에서 실시간 변경)
const INITIAL_SETTINGS = {
  // 당일 상담 운영시간 (예: 16시 ~ 20시). 시간대별 상담 실적 집계의 기준이 된다.
  openHour: 9,
  closeHour: 18,
  // 대기 고객에게 보여줄 1인당 예상 상담 소요시간(분). 예상 대기시간 계산과 창구 지연 표시에 쓴다.
  standardMinutes: 15,
  repeatCount: 2         // 호출 방송 반복 횟수
};

let db = {
  bankInfo: JSON.parse(JSON.stringify(INITIAL_BANKS)),
  queues: { woori: [], fubon: [], shinhan: [], kb: [] },
  desks: JSON.parse(JSON.stringify(INITIAL_DESKS)),
  ticketSequence: { woori: 0, fubon: 0, shinhan: 0, kb: 0 },
  completedLogs: [],
  passedLogs: [],
  settings: { ...INITIAL_SETTINGS }
};

function loadBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.queues) {
        db = parsed;
        db.bankInfo = JSON.parse(JSON.stringify(INITIAL_BANKS));
        // 이전 버전 백업 호환
        if (!Array.isArray(db.completedLogs)) db.completedLogs = [];
        if (!Array.isArray(db.passedLogs)) db.passedLogs = [];
        db.settings = { ...INITIAL_SETTINGS, ...(db.settings || {}) };
      }
    }
  } catch (err) {}
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

// 현장은 한국이고 Render 서버는 UTC로 돌아가므로, 시간대별 집계는 항상 한국시간 기준으로 계산한다.
const SEOUL_HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false });
function hourInSeoul(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  const h = parseInt(SEOUL_HOUR_FMT.format(d), 10);
  return isNaN(h) ? -1 : (h === 24 ? 0 : h);
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
}

// 일일보고 통계: 은행별 / 창구별 / 시간대별 건수, 평균 상담시간, 평균 대기시간, 부재패스
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
    totalWaiting: Object.keys(db.queues).reduce((n, b) => n + (db.queues[b] || []).filter(c => c.status === 'waiting').length, 0),
    avgDurationSec: avg(logs.map(l => l.durationSec || 0)),
    avgWaitSec: avg(logs.map(l => l.waitSec || 0)),
    peakHour: peak.count > 0 ? peak.hour : null,
    peakCount: peak.count,
    banks,
    hourlyTotal,
    logs
  };
}

function sanitizeBank(b) {
  const bank = (b || 'kb').toLowerCase().trim();
  return db.bankInfo[bank] ? bank : 'kb';
}

function broadcastAll() {
  io.emit('all_state_update', {
    bankInfo: db.bankInfo,
    queues: db.queues,
    desks: db.desks,
    logs: db.completedLogs,
    passes: db.passedLogs,
    settings: db.settings,
    serverTime: new Date().toISOString()
  });
  saveBackup();
}

// 설정 변경처럼 전 화면에 영향을 주는 변경은 은행별 state_update 까지 함께 보낸다.
// (상담사앱과 고객화면은 state_update 로 동작하므로 이게 없으면 설정이 늦게 반영된다)
function broadcastEverywhere() {
  Object.keys(db.bankInfo).forEach((b) => {
    io.emit('state_update', {
      bank: b,
      bankInfo: db.bankInfo[b],
      queue: db.queues[b] || [],
      desks: db.desks[b] || [],
      settings: db.settings,
      logs: (db.completedLogs || []).filter(l => l.bank === b),
      serverTime: new Date().toISOString()
    });
  });
  broadcastAll();
}

function broadcastBank(bank) {
  const b = sanitizeBank(bank);
  io.emit('state_update', {
    bank: b,
    bankInfo: db.bankInfo[b],
    queue: db.queues[b] || [],
    desks: db.desks[b] || [],
    settings: db.settings,
    logs: (db.completedLogs || []).filter(l => l.bank === b),
    serverTime: new Date().toISOString()
  });
  broadcastAll();
}

io.on('connection', (socket) => {
  socket.on('get_state', ({ bank }) => {
    const b = sanitizeBank(bank);
    socket.emit('state_update', {
      bank: b,
      bankInfo: db.bankInfo[b],
      queue: db.queues[b] || [],
      desks: db.desks[b] || [],
      settings: db.settings,
      logs: (db.completedLogs || []).filter(l => l.bank === b),
      serverTime: new Date().toISOString()
    });
  });

  socket.on('get_all_state', () => {
    socket.emit('all_state_update', {
      bankInfo: db.bankInfo,
      queues: db.queues,
      desks: db.desks,
      logs: db.completedLogs,
      passes: db.passedLogs,
      settings: db.settings,
      serverTime: new Date().toISOString()
    });
  });

  socket.on('issue_ticket', ({ bank, phone, name }, callback) => {
    const b = sanitizeBank(bank);
    if (db.ticketSequence[b] == null) db.ticketSequence[b] = 0;
    if (!db.queues[b]) db.queues[b] = [];

    db.ticketSequence[b] += 1;
    const ticketNumber = db.ticketSequence[b];
    const ticket = {
      id: `${b}-${ticketNumber}-${Date.now()}`,
      ticketNumber,
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      phone: phone || '',
      name: name || '고객',
      status: 'waiting',
      createdAt: new Date().toISOString()
    };

    db.queues[b].push(ticket);

    // 상담사 앱 접수 알림용 (자기 은행만 골라 쓰도록 bank 를 함께 보낸다)
    io.emit('ticket_issued', {
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      ticket,
      waitingCount: db.queues[b].filter(c => c.status === 'waiting').length
    });

    broadcastBank(b);
    if (callback) callback({ success: true, ticket });
  });

  socket.on('call_customer', ({ bank, deskNumber, customerId }) => {
    const b = sanitizeBank(bank);
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(deskNumber));
    if (!desk) return;

    let target = customerId ? db.queues[b].find(c => c.id === customerId) : (db.queues[b] || []).find(c => c.status === 'waiting');
    if (!target) return;

    target.status = 'called';
    target.desk = desk.desk;
    target.deskName = desk.name;
    target.calledAt = new Date().toISOString();

    desk.status = 'consulting';
    desk.currentCustomer = target;

    io.emit('customer_called', {
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      customer: target
    });
    broadcastBank(b);
  });

  socket.on('recall_customer', ({ bank, deskNumber }) => {
    const b = sanitizeBank(bank);
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(deskNumber));
    if (!desk || !desk.currentCustomer) return;

    io.emit('customer_called', {
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      customer: desk.currentCustomer
    });
  });

  socket.on('complete_consultation', ({ bank, deskNumber, autoCall }) => {
    const b = sanitizeBank(bank);
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const completedCust = desk.currentCustomer;
    const completedAt = new Date().toISOString();
    db.completedLogs.push({
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: completedCust.ticketNumber,
      createdAt: completedCust.createdAt,
      calledAt: completedCust.calledAt,
      completedAt,
      // 상담 소요시간(호출 -> 완료), 대기시간(발권 -> 호출)
      durationSec: completedCust.calledAt ? secBetween(completedCust.calledAt, completedAt) : 0,
      waitSec: completedCust.createdAt && completedCust.calledAt ? secBetween(completedCust.createdAt, completedCust.calledAt) : 0
    });

    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== completedCust.id);
    desk.status = 'idle';
    desk.currentCustomer = null;

    broadcastBank(b);

    if (autoCall) {
      const nextCust = (db.queues[b] || []).find(c => c.status === 'waiting');
      if (nextCust) {
        nextCust.status = 'called';
        nextCust.desk = desk.desk;
        nextCust.deskName = desk.name;
        nextCust.calledAt = new Date().toISOString();

        desk.status = 'consulting';
        desk.currentCustomer = nextCust;

        io.emit('customer_called', {
          bank: b,
          bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
          desk: desk.desk,
          deskName: desk.name,
          customer: nextCust
        });
        broadcastBank(b);
      }
    }
  });

  // 부재 패스: 호출했는데 오지 않은 고객을 창구에서 내리고 대기열에서 제외
  socket.on('pass_customer', ({ bank, deskNumber }) => {
    const b = sanitizeBank(bank);
    const desk = (db.desks[b] || []).find(d => d.desk === parseInt(deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const passed = desk.currentCustomer;
    if (!Array.isArray(db.passedLogs)) db.passedLogs = [];
    db.passedLogs.push({
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: passed.ticketNumber,
      passedAt: new Date().toISOString()
    });
    db.queues[b] = (db.queues[b] || []).filter(c => c.id !== passed.id);
    desk.status = 'idle';
    desk.currentCustomer = null;

    io.emit('customer_passed', {
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      customer: passed
    });
    broadcastBank(b);
  });

  socket.on('transfer_customer', ({ bank, fromDesk, toDesk }) => {
    const b = sanitizeBank(bank);
    const sourceDesk = (db.desks[b] || []).find(d => d.desk === parseInt(fromDesk));
    const targetDesk = (db.desks[b] || []).find(d => d.desk === parseInt(toDesk));

    if (!sourceDesk || !sourceDesk.currentCustomer || !targetDesk) return;

    const cust = sourceDesk.currentCustomer;
    cust.desk = targetDesk.desk;
    cust.deskName = targetDesk.name;

    sourceDesk.status = 'idle';
    sourceDesk.currentCustomer = null;

    targetDesk.status = 'consulting';
    targetDesk.currentCustomer = cust;

    io.emit('customer_called', {
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: targetDesk.desk,
      deskName: targetDesk.name,
      customer: cust
    });
    broadcastBank(b);
  });

  socket.on('modify_desk_count', ({ bank, action }) => {
    const b = sanitizeBank(bank);
    if (!db.desks[b]) db.desks[b] = [];
    const list = db.desks[b];

    let removedDesk = null;
    if (action === 'add') {
      // 번호가 겹치지 않도록 현재 최대 번호 다음으로 만든다.
      const nextNum = list.reduce((m, d) => Math.max(m, d.desk), 0) + 1;
      list.push({ desk: nextNum, name: `${nextNum}번 창구`, status: 'idle', currentCustomer: null });
    } else if (action === 'remove' && list.length > 1) {
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
    }

    io.emit('desks_changed', {
      bank: b,
      action,
      removedDesk,
      desks: list.map(d => ({ desk: d.desk, name: d.name }))
    });
    broadcastBank(b);
  });

  socket.on('admin_add_bank', ({ code, name, color }) => {
    const c = (code || '').toLowerCase().trim();
    if (!c || db.bankInfo[c]) return;

    db.bankInfo[c] = {
      name: name.trim() || c.toUpperCase(),
      color: color || '#38bdf8',
      sub: '#f2f4f6',
      btnText: '#ffffff'
    };
    db.queues[c] = [];
    db.desks[c] = [
      { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null }
    ];
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

  socket.on('admin_reset_tickets', ({ bank }) => {
    const targetBanks = (bank === 'all') ? Object.keys(db.bankInfo) : [sanitizeBank(bank)];
    targetBanks.forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 0;
      (db.desks[b] || []).forEach(d => { d.status = 'idle'; d.currentCustomer = null; });
      broadcastBank(b);
    });
  });

  socket.on('admin_emergency_repair', () => {
    db.bankInfo = JSON.parse(JSON.stringify(INITIAL_BANKS));
    db.desks = JSON.parse(JSON.stringify(INITIAL_DESKS));
    db.completedLogs = [];
    db.passedLogs = [];
    db.settings = { ...INITIAL_SETTINGS, ...db.settings };
    Object.keys(db.bankInfo).forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 0;
    });
    io.emit('emergency_repaired');
    broadcastEverywhere();
  });

  socket.on('admin_day_close', () => {
    const report = buildReport();
    report.closedAt = new Date().toISOString();

    // 대기열과 창구만 비우고, 보고 통계(로그)는 유지한다.
    Object.keys(db.bankInfo).forEach(b => {
      db.queues[b] = [];
      (db.desks[b] || []).forEach(d => { d.status = 'idle'; d.currentCustomer = null; });
    });
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
  } catch (err) {
    // 현장 운영 중에는 어떤 경우에도 서버가 죽으면 안 된다.
  }
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