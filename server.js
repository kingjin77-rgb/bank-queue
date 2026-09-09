const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const BACKUP_FILE = path.join(__dirname, 'queue_db_backup.json');

// 모든 은행 2개 창구, 푸본만 단일 창구(1개)
const INITIAL_DESKS = {
  woori: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null }
  ],
  shinhan: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null }
  ],
  kb: [
    { desk: 1, name: '1번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null },
    { desk: 2, name: '2번 창구', status: 'idle', currentCustomer: null, duration: 10, startTime: null }
  ],
  fubon: [
    { desk: 1, name: '단일 창구', status: 'idle', currentCustomer: null, duration: 15, startTime: null }
  ]
};

let db = {
  queues: { woori: [], fubon: [], shinhan: [], kb: [] },
  desks: JSON.parse(JSON.stringify(INITIAL_DESKS)),
  ticketSequence: { woori: 100, fubon: 100, shinhan: 100, kb: 100 },
  completedLogs: []
};

// 파일 백업 자동 복구
function loadBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.queues) {
        db = parsed;
        // 창구 규격 강제 동기화 (우리2, 신한2, 국민2, 푸본1)
        db.desks = JSON.parse(JSON.stringify(INITIAL_DESKS));
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

function sanitizeBank(b) {
  const bank = (b || 'kb').toLowerCase().trim();
  return ['woori', 'fubon', 'shinhan', 'kb'].includes(bank) ? bank : 'kb';
}

function broadcastBank(bank) {
  const b = sanitizeBank(bank);
  io.emit('state_update', {
    bank: b,
    queue: db.queues[b] || [],
    desks: db.desks[b] || []
  });
  io.emit('all_state_update', {
    queues: db.queues,
    desks: db.desks,
    logs: db.completedLogs
  });
  saveBackup();
}

io.on('connection', (socket) => {
  // 개별 은행 상태
  socket.on('get_state', ({ bank }) => {
    const b = sanitizeBank(bank);
    socket.emit('state_update', {
      bank: b,
      queue: db.queues[b] || [],
      desks: db.desks[b] || []
    });
  });

  // 통합 상태
  socket.on('get_all_state', () => {
    socket.emit('all_state_update', {
      queues: db.queues,
      desks: db.desks,
      logs: db.completedLogs
    });
  });

  // 번호표 발권
  socket.on('issue_ticket', ({ bank, phone, name }, callback) => {
    const b = sanitizeBank(bank);
    db.ticketSequence[b] += 1;
    const ticketNumber = db.ticketSequence[b];
    const ticket = {
      id: `${b}-${ticketNumber}-${Date.now()}`,
      ticketNumber,
      bank: b,
      phone: phone || '',
      name: name || '고객',
      status: 'waiting',
      createdAt: new Date().toISOString()
    };

    db.queues[b].push(ticket);
    broadcastBank(b);
    if (callback) callback({ success: true, ticket });
  });

  // 고객 호출
  socket.on('call_customer', ({ bank, deskNumber, customerId }) => {
    const b = sanitizeBank(bank);
    const desk = db.desks[b].find(d => d.desk === parseInt(deskNumber));
    if (!desk) return;

    let target = customerId ? db.queues[b].find(c => c.id === customerId) : db.queues[b].find(c => c.status === 'waiting');
    if (!target) return;

    target.status = 'called';
    target.desk = desk.desk;
    target.deskName = desk.name;
    target.calledAt = new Date().toISOString();

    desk.status = 'consulting';
    desk.currentCustomer = target;
    desk.startTime = new Date().toISOString();

    io.emit('customer_called', {
      bank: b,
      desk: desk.desk,
      deskName: desk.name,
      customer: target
    });
    broadcastBank(b);
  });

  // 재호출
  socket.on('recall_customer', ({ bank, deskNumber }) => {
    const b = sanitizeBank(bank);
    const desk = db.desks[b].find(d => d.desk === parseInt(deskNumber));
    if (!desk || !desk.currentCustomer) return;

    io.emit('customer_called', {
      bank: b,
      desk: desk.desk,
      deskName: desk.name,
      customer: desk.currentCustomer
    });
  });

  // 상담 종료 및 자동 다음호출
  socket.on('complete_consultation', ({ bank, deskNumber, autoCall }) => {
    const b = sanitizeBank(bank);
    const desk = db.desks[b].find(d => d.desk === parseInt(deskNumber));
    if (!desk || !desk.currentCustomer) return;

    const completedCust = desk.currentCustomer;
    const durationMin = desk.startTime ? Math.max(1, Math.round((new Date() - new Date(desk.startTime)) / 60000)) : 10;

    db.completedLogs.push({
      bank: b,
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: completedCust.ticketNumber,
      consultDuration: durationMin,
      completedAt: new Date().toISOString()
    });

    db.queues[b] = db.queues[b].filter(c => c.id !== completedCust.id);
    desk.status = 'idle';
    desk.currentCustomer = null;
    desk.startTime = null;

    broadcastBank(b);

    if (autoCall) {
      const nextCust = db.queues[b].find(c => c.status === 'waiting');
      if (nextCust) {
        nextCust.status = 'called';
        nextCust.desk = desk.desk;
        nextCust.deskName = desk.name;
        nextCust.calledAt = new Date().toISOString();

        desk.status = 'consulting';
        desk.currentCustomer = nextCust;
        desk.startTime = new Date().toISOString();

        io.emit('customer_called', {
          bank: b,
          desk: desk.desk,
          deskName: desk.name,
          customer: nextCust
        });
        broadcastBank(b);
      }
    }
  });

  // 손님 창구 전달(이관)
  socket.on('transfer_customer', ({ bank, fromDesk, toDesk }) => {
    const b = sanitizeBank(bank);
    const sourceDesk = db.desks[b].find(d => d.desk === parseInt(fromDesk));
    const targetDesk = db.desks[b].find(d => d.desk === parseInt(toDesk));

    if (!sourceDesk || !sourceDesk.currentCustomer || !targetDesk) return;

    const cust = sourceDesk.currentCustomer;
    cust.desk = targetDesk.desk;
    cust.deskName = targetDesk.name;

    sourceDesk.status = 'idle';
    sourceDesk.currentCustomer = null;
    sourceDesk.startTime = null;

    targetDesk.status = 'consulting';
    targetDesk.currentCustomer = cust;
    targetDesk.startTime = new Date().toISOString();

    io.emit('customer_called', {
      bank: b,
      desk: targetDesk.desk,
      deskName: targetDesk.name,
      customer: cust
    });
    broadcastBank(b);
  });

  // 상담시간 조정
  socket.on('update_duration', ({ bank, deskNumber, duration }) => {
    const b = sanitizeBank(bank);
    const desk = db.desks[b].find(d => d.desk === parseInt(deskNumber));
    if (desk) {
      desk.duration = parseInt(duration) || 10;
      broadcastBank(b);
    }
  });

  // [관리자] 번호표 초기화
  socket.on('admin_reset_tickets', ({ bank }) => {
    const targetBanks = (bank === 'all') ? ['woori', 'fubon', 'shinhan', 'kb'] : [sanitizeBank(bank)];
    targetBanks.forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 100;
      db.desks[b].forEach(d => { d.status = 'idle'; d.currentCustomer = null; d.startTime = null; });
      broadcastBank(b);
    });
  });

  // [관리자] 비상 긴급 복구
  socket.on('admin_emergency_repair', () => {
    ['woori', 'fubon', 'shinhan', 'kb'].forEach(b => {
      db.queues[b] = [];
      db.desks[b] = JSON.parse(JSON.stringify(INITIAL_DESKS[b]));
      db.ticketSequence[b] = 100;
    });
    io.emit('emergency_repaired');
    ['woori', 'fubon', 'shinhan', 'kb'].forEach(broadcastBank);
  });

  // [관리자] 일마감
  socket.on('admin_day_close', () => {
    const report = {
      closedAt: new Date().toISOString(),
      totalCount: db.completedLogs.length,
      logs: db.completedLogs
    };
    ['woori', 'fubon', 'shinhan', 'kb'].forEach(b => {
      db.queues[b] = [];
      db.desks[b].forEach(d => { d.status = 'idle'; d.currentCustomer = null; d.startTime = null; });
      broadcastBank(b);
    });
    io.emit('day_closed', report);
  });
});

// Render 슬립 방지 10분 자체 핑
setInterval(() => {
  https.get('https://bank-queue.onrender.com', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});