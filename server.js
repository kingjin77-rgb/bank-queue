const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const DB_FILE = path.join(__dirname, 'database.json');

const defaultData = {
  queues: {
    "우리은행": {
      nextNumber: 1,
      waiting: [],
      desks: [
        { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null },
        { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null }
      ]
    },
    "신한은행": {
      nextNumber: 1,
      waiting: [],
      desks: [
        { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null },
        { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null }
      ]
    },
    "국민은행": {
      nextNumber: 1,
      waiting: [],
      desks: [
        { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null },
        { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null }
      ]
    },
    "푸본현대생명": {
      nextNumber: 1,
      waiting: [],
      desks: [
        { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0, isActive: true, currentStartTime: null }
      ]
    }
  },
  logs: [],
  reportsHistory: []
};

let db = defaultData;

if (fs.existsSync(DB_FILE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = {
      queues: parsed.queues || defaultData.queues,
      logs: parsed.logs || [],
      reportsHistory: parsed.reportsHistory || []
    };
  } catch (e) {
    db = defaultData;
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {}
}

function getHourlyDistribution(logs, targetBank = null) {
  const hours = {};
  for (let i = 8; i <= 18; i++) {
    const key = `${String(i).padStart(2, '0')}:00`;
    hours[key] = 0;
  }
  logs.forEach(log => {
    if (targetBank && log.bank !== targetBank) return;
    if (log.calledTime) {
      const h = new Date(log.calledTime).getHours();
      const key = `${String(h).padStart(2, '0')}:00`;
      if (hours[key] !== undefined) hours[key]++;
    }
  });
  return hours;
}

function buildReport(targetBank = null) {
  const filteredLogs = targetBank ? db.logs.filter(l => l.bank === targetBank) : db.logs;
  const totalCompleted = filteredLogs.filter(l => l.status === '상담완료').length;
  const totalCancelled = filteredLogs.filter(l => l.status === '부재중' || l.status === '대기취소').length;

  const bankStats = {};
  const deskStats = {};

  const banks = targetBank ? [targetBank] : Object.keys(db.queues);
  banks.forEach(b => {
    bankStats[b] = { total: 0, completed: 0, cancelled: 0 };
    db.queues[b].desks.forEach(d => {
      const key = `${b} - ${d.name}`;
      deskStats[key] = { bank: b, deskName: d.name, count: d.completedCount || 0, isActive: d.isActive };
    });
  });

  filteredLogs.forEach(l => {
    if (!bankStats[l.bank]) bankStats[l.bank] = { total: 0, completed: 0, cancelled: 0 };
    bankStats[l.bank].total++;
    if (l.status === '상담완료') bankStats[l.bank].completed++;
    if (l.status === '부재중' || l.status === '대기취소') bankStats[l.bank].cancelled++;
  });

  return {
    generatedAt: new Date().toISOString(),
    targetBank: targetBank || "전체은행",
    totalCompleted,
    totalCancelled,
    bankStats,
    deskStats,
    hourlyDistribution: getHourlyDistribution(db.logs, targetBank),
    logs: filteredLogs
  };
}

io.on('connection', (socket) => {
  socket.emit('init_state', { queues: db.queues, report: buildReport() });

  socket.on('get_all_state', () => {
    socket.emit('init_state', { queues: db.queues, report: buildReport() });
  });

  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const ticketNo = db.queues[bank].nextNumber++;
    db.queues[bank].waiting.push(ticketNo);

    db.logs.push({
      bank,
      ticketNo,
      issuedTime: new Date().toISOString(),
      calledTime: null,
      finishedTime: null,
      deskName: null,
      status: '대기중'
    });
    saveDB();

    io.emit('queue_update', { bank, data: db.queues[bank] });
    io.emit('new_customer_waiting', { bank, ticketNo, waitingCount: db.queues[bank].waiting.length });
    io.emit('report_update', buildReport());
    if (cb) cb({ success: true, ticketNo });
  });

  socket.on('cancel_ticket', ({ bank, ticketNo }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const num = Number(ticketNo);
    const idx = db.queues[bank].waiting.indexOf(num);
    if (idx > -1) {
      db.queues[bank].waiting.splice(idx, 1);
      const log = db.logs.find(l => l.bank === bank && l.ticketNo === num && l.status === '대기중');
      if (log) {
        log.status = '대기취소';
        log.finishedTime = new Date().toISOString();
      }
      saveDB();
      io.emit('queue_update', { bank, data: db.queues[bank] });
      io.emit('customer_action_notice', { bank, action: 'cancel', ticketNo: num, waitingCount: db.queues[bank].waiting.length });
      io.emit('report_update', buildReport());
    }
    if (cb) cb({ success: true });
  });

  socket.on('delay_ticket', ({ bank, ticketNo }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const num = Number(ticketNo);
    const idx = db.queues[bank].waiting.indexOf(num);
    if (idx > -1) {
      db.queues[bank].waiting.splice(idx, 1);
      db.queues[bank].waiting.push(num);
      saveDB();
      io.emit('queue_update', { bank, data: db.queues[bank] });
      io.emit('customer_action_notice', { bank, action: 'delay', ticketNo: num, waitingCount: db.queues[bank].waiting.length });
      if (cb) cb({ success: true });
    } else {
      if (cb) cb({ success: false });
    }
  });

  socket.on('call_next_desk', ({ bank, deskId }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false, message: '은행 정보가 없습니다.' });
    const desk = db.queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false, message: '창구를 찾을 수 없습니다.' });

    if (desk.status === '상담중') {
      return cb && cb({ success: false, message: '현재 상담 중입니다. 상담종료를 먼저 눌러주세요.' });
    }

    if (db.queues[bank].waiting.length === 0) {
      return cb && cb({ success: false, message: '대기 중인 고객이 없습니다.' });
    }

    const nextNum = db.queues[bank].waiting.shift();
    desk.current = nextNum;
    desk.status = '상담중';
    desk.currentStartTime = new Date().toISOString();

    const log = db.logs.find(l => l.bank === bank && l.ticketNo === nextNum && l.status === '대기중');
    if (log) {
      log.calledTime = desk.currentStartTime;
      log.deskName = desk.name;
      log.status = '상담중';
    }
    saveDB();

    io.emit('queue_update', { bank, data: db.queues[bank] });
    io.emit('voice_call', { bank, deskName: desk.name, ticketNo: nextNum });
    io.emit('customer_called_dismiss', { bank });
    io.emit('report_update', buildReport());
    if (cb) cb({ success: true, ticketNo: nextNum });
  });

  socket.on('recall_desk', ({ bank, deskId }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const desk = db.queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk || !desk.current) return cb && cb({ success: false, message: '호출할 고객 번호가 없습니다.' });

    io.emit('voice_call', { bank, deskName: desk.name, ticketNo: desk.current });
    if (cb) cb({ success: true, ticketNo: desk.current });
  });

  socket.on('transfer_desk', ({ bank, fromDeskId, toDeskId }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false, message: '은행 정보 오류' });
    const fromDesk = db.queues[bank].desks.find(d => d.id === Number(fromDeskId));
    const toDesk = db.queues[bank].desks.find(d => d.id === Number(toDeskId));

    if (!fromDesk || !fromDesk.current) return cb && cb({ success: false, message: '이동시킬 고객이 없습니다.' });
    if (!toDesk) return cb && cb({ success: false, message: '대상 창구가 없습니다.' });

    const movingTicket = fromDesk.current;
    fromDesk.current = 0;
    fromDesk.status = '대기중';
    fromDesk.currentStartTime = null;

    toDesk.current = movingTicket;
    toDesk.status = '상담중';
    toDesk.currentStartTime = new Date().toISOString();

    const log = db.logs.find(l => l.bank === bank && l.ticketNo === movingTicket && l.status === '상담중');
    if (log) log.deskName = toDesk.name;

    saveDB();
    io.emit('queue_update', { bank, data: db.queues[bank] });
    if (cb) cb({ success: true, ticketNo: movingTicket });
  });

  socket.on('update_desk_status', ({ bank, deskId, status }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const desk = db.queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false });

    const targetTicket = desk.current;
    const now = new Date().toISOString();

    if (status === '상담완료') {
      desk.completedCount = (desk.completedCount || 0) + 1;
      desk.current = 0;
      desk.status = '대기중';
      desk.currentStartTime = null;

      if (targetTicket > 0) {
        const log = db.logs.find(l => l.bank === bank && l.ticketNo === targetTicket && l.status === '상담중');
        if (log) {
          log.finishedTime = now;
          log.status = '상담완료';
        }
        io.emit('ticket_finished', { bank, ticketNo: targetTicket, reason: '상담완료' });
      }
    } else if (status === '부재중') {
      desk.current = 0;
      desk.status = '대기중';
      desk.currentStartTime = null;

      if (targetTicket > 0) {
        const log = db.logs.find(l => l.bank === bank && l.ticketNo === targetTicket && l.status === '상담중');
        if (log) {
          log.finishedTime = now;
          log.status = '부재중';
        }
        io.emit('ticket_finished', { bank, ticketNo: targetTicket, reason: '부재중' });
      }
    } else {
      desk.status = status;
    }
    saveDB();

    io.emit('queue_update', { bank, data: db.queues[bank] });
    io.emit('report_update', buildReport());
    if (cb) cb({ success: true });
  });

  // 창구 수 조절: 실적 보존을 위해 삭제 대신 비활성화(isActive) 처리
  socket.on('adjust_desk_count', ({ bank, change }, cb) => {
    if (!db.queues[bank]) return cb && cb({ success: false });
    const desks = db.queues[bank].desks;

    if (change > 0) {
      const inactiveDesk = desks.find(d => !d.isActive);
      if (inactiveDesk) {
        inactiveDesk.isActive = true;
      } else {
        const nextId = desks.length > 0 ? Math.max(...desks.map(d => d.id)) + 1 : 1;
        desks.push({
          id: nextId,
          name: `${nextId}번 창구`,
          current: 0,
          status: "대기중",
          completedCount: 0,
          isActive: true,
          currentStartTime: null
        });
      }
    } else if (change < 0) {
      const activeDesks = desks.filter(d => d.isActive);
      if (activeDesks.length <= 1) return cb && cb({ success: false, message: '최소 1개 창구는 활성화되어야 합니다.' });
      const lastActive = activeDesks[activeDesks.length - 1];
      lastActive.isActive = false;
      lastActive.current = 0;
      lastActive.status = '대기중';
    }
    saveDB();

    io.emit('queue_update', { bank, data: db.queues[bank] });
    io.emit('report_update', buildReport());
    if (cb) cb({ success: true });
  });

  // 하루 상담 마감 버튼: 최종 보고서 생성 및 번호표 리셋
  socket.on('close_daily_business', (cb) => {
    const finalReport = buildReport();
    db.reportsHistory.push(finalReport);

    // 번호표 및 대기열 리셋
    Object.keys(db.queues).forEach(b => {
      db.queues[b].nextNumber = 1;
      db.queues[b].waiting = [];
      db.queues[b].desks.forEach(d => {
        d.current = 0;
        d.status = '대기중';
        d.completedCount = 0;
        d.currentStartTime = null;
      });
    });
    db.logs = [];
    saveDB();

    io.emit('daily_business_closed', finalReport);
    io.emit('init_state', { queues: db.queues, report: buildReport() });
    if (cb) cb({ success: true, report: finalReport });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));