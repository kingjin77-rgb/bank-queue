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

// 발권 전용 링크(/kiosk.html?bank=xx)는 고객 발권 화면(index.html)과 동일 - 기존 QR/주소 유지
app.get(['/kiosk', '/kiosk.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

let db = {
  bankInfo: JSON.parse(JSON.stringify(INITIAL_BANKS)),
  queues: { woori: [], fubon: [], shinhan: [], kb: [] },
  desks: JSON.parse(JSON.stringify(INITIAL_DESKS)),
  ticketSequence: { woori: 0, fubon: 0, shinhan: 0, kb: 0 },
  completedLogs: []
};

function loadBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.queues) {
        db = parsed;
        db.bankInfo = JSON.parse(JSON.stringify(INITIAL_BANKS));
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
  return db.bankInfo[bank] ? bank : 'kb';
}

function broadcastAll() {
  io.emit('all_state_update', {
    bankInfo: db.bankInfo,
    queues: db.queues,
    desks: db.desks,
    logs: db.completedLogs
  });
  saveBackup();
}

function broadcastBank(bank) {
  const b = sanitizeBank(bank);
  io.emit('state_update', {
    bank: b,
    bankInfo: db.bankInfo[b],
    queue: db.queues[b] || [],
    desks: db.desks[b] || []
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
      desks: db.desks[b] || []
    });
  });

  socket.on('get_all_state', () => {
    socket.emit('all_state_update', {
      bankInfo: db.bankInfo,
      queues: db.queues,
      desks: db.desks,
      logs: db.completedLogs
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
    db.completedLogs.push({
      bank: b,
      bankName: db.bankInfo[b] ? db.bankInfo[b].name : b.toUpperCase(),
      desk: desk.desk,
      deskName: desk.name,
      ticketNumber: completedCust.ticketNumber,
      completedAt: new Date().toISOString()
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

    if (action === 'add') {
      const nextNum = list.length + 1;
      list.push({ desk: nextNum, name: `${nextNum}번 창구`, status: 'idle', currentCustomer: null });
    } else if (action === 'remove' && list.length > 1) {
      list.pop();
    }
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
    broadcastAll();
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
    Object.keys(db.bankInfo).forEach(b => {
      db.queues[b] = [];
      db.ticketSequence[b] = 0;
    });
    io.emit('emergency_repaired');
    broadcastAll();
  });

  socket.on('admin_day_close', () => {
    const report = {
      closedAt: new Date().toISOString(),
      totalCount: db.completedLogs.length,
      logs: db.completedLogs
    };
    Object.keys(db.bankInfo).forEach(b => {
      db.queues[b] = [];
      (db.desks[b] || []).forEach(d => { d.status = 'idle'; d.currentCustomer = null; });
    });
    broadcastAll();
    io.emit('day_closed', report);
  });
});

setInterval(() => {
  https.get('https://bank-queue.onrender.com', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});