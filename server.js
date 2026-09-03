const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'database.json');

// 기본 데이터 구조
const defaultQueues = {
  "우리은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0 },
      { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0 }
    ]
  },
  "신한은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0 },
      { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0 }
    ]
  },
  "국민은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0 },
      { id: 2, name: "2번 창구", current: 0, status: "대기중", completedCount: 0 }
    ]
  },
  "푸본현대생명": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0 }
    ]
  }
};

let queues = defaultQueues;

// 서버 재시작 시 데이터 복구 (초기화 방지)
if (fs.existsSync(DB_FILE)) {
  try {
    queues = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    queues = defaultQueues;
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(queues, null, 2), 'utf8');
  } catch (e) {}
}

io.on('connection', (socket) => {
  socket.emit('init_state', queues);

  socket.on('get_all_state', () => {
    socket.emit('init_state', queues);
  });

  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const ticketNo = queues[bank].nextNumber++;
    queues[bank].waiting.push(ticketNo);
    saveDB();

    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('new_customer_waiting', { bank, ticketNo, waitingCount: queues[bank].waiting.length });
    if (cb) cb({ success: true, ticketNo });
  });

  socket.on('cancel_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return;
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      saveDB();
      io.emit('queue_update', { bank, data: queues[bank] });
    }
    if (cb) cb({ success: true });
  });

  socket.on('delay_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      queues[bank].waiting.push(ticketNo);
      saveDB();
      io.emit('queue_update', { bank, data: queues[bank] });
      if (cb) cb({ success: true });
    } else {
      if (cb) cb({ success: false });
    }
  });

  socket.on('call_next_desk', ({ bank, deskId }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false, message: '은행 정보가 없습니다.' });
    const desk = queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false, message: '창구를 찾을 수 없습니다.' });

    if (desk.status === '상담중') {
      return cb && cb({ success: false, message: '현재 상담 중입니다. 먼저 상담종료를 눌러주세요.' });
    }

    if (queues[bank].waiting.length === 0) {
      return cb && cb({ success: false, message: '대기 중인 고객이 없습니다.' });
    }

    const nextNum = queues[bank].waiting.shift();
    desk.current = nextNum;
    desk.status = '상담중';
    saveDB();

    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('voice_call', { bank, deskName: desk.name, ticketNo: nextNum });
    io.emit('customer_called_dismiss', { bank });
    if (cb) cb({ success: true, ticketNo: nextNum });
  });

  socket.on('recall_desk', ({ bank, deskId }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const desk = queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk || !desk.current) return cb && cb({ success: false, message: '호출할 고객 번호가 없습니다.' });

    io.emit('voice_call', { bank, deskName: desk.name, ticketNo: desk.current });
    if (cb) cb({ success: true, ticketNo: desk.current });
  });

  socket.on('transfer_desk', ({ bank, fromDeskId, toDeskId }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false, message: '은행 오류' });
    const fromDesk = queues[bank].desks.find(d => d.id === Number(fromDeskId));
    const toDesk = queues[bank].desks.find(d => d.id === Number(toDeskId));

    if (!fromDesk || !fromDesk.current) return cb && cb({ success: false, message: '이동시킬 고객이 없습니다.' });
    if (!toDesk) return cb && cb({ success: false, message: '대상 창구가 없습니다.' });

    const movingTicket = fromDesk.current;
    fromDesk.current = 0;
    fromDesk.status = '대기중';

    toDesk.current = movingTicket;
    toDesk.status = '상담중';
    saveDB();

    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true, ticketNo: movingTicket });
  });

  socket.on('update_desk_status', ({ bank, deskId, status }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const desk = queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false });

    const targetTicket = desk.current;

    if (status === '상담완료') {
      desk.completedCount = (desk.completedCount || 0) + 1;
      desk.current = 0;
      desk.status = '대기중';
      if (targetTicket > 0) {
        io.emit('ticket_finished', { bank, ticketNo: targetTicket, reason: '상담완료' });
      }
    } else if (status === '부재중') {
      desk.current = 0;
      desk.status = '대기중';
      if (targetTicket > 0) {
        const wIdx = queues[bank].waiting.indexOf(targetTicket);
        if (wIdx > -1) queues[bank].waiting.splice(wIdx, 1);
        io.emit('ticket_finished', { bank, ticketNo: targetTicket, reason: '부재중' });
      }
    } else {
      desk.status = status;
    }
    saveDB();

    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  socket.on('adjust_desk_count', ({ bank, change }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const currentDesks = queues[bank].desks;

    if (change > 0) {
      const nextId = currentDesks.length > 0 ? Math.max(...currentDesks.map(d => d.id)) + 1 : 1;
      currentDesks.push({ id: nextId, name: `${currentDesks.length + 1}번 창구`, current: 0, status: "대기중", completedCount: 0 });
    } else if (change < 0) {
      if (currentDesks.length <= 1) return cb && cb({ success: false, message: '최소 1개 창구는 유지해야 합니다.' });
      currentDesks.pop();
    }
    saveDB();

    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  socket.on('add_bank', ({ newBank }, cb) => {
    if (!newBank || queues[newBank]) return cb && cb({ success: false, message: '중복되거나 잘못된 이름입니다.' });
    queues[newBank] = {
      nextNumber: 1,
      waiting: [],
      desks: [{ id: 1, name: "1번 창구", current: 0, status: "대기중", completedCount: 0 }]
    };
    saveDB();
    io.emit('init_state', queues);
    if (cb) cb({ success: true });
  });

  socket.on('reset_queue', ({ bank }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    queues[bank].nextNumber = 1;
    queues[bank].waiting = [];
    queues[bank].desks.forEach(d => { d.current = 0; d.status = '대기중'; d.completedCount = 0; });
    saveDB();
    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  socket.on('reset_all_queues', (cb) => {
    Object.keys(queues).forEach(b => {
      queues[b].nextNumber = 1;
      queues[b].waiting = [];
      queues[b].desks.forEach(d => { d.current = 0; d.status = '대기중'; d.completedCount = 0; });
    });
    saveDB();
    io.emit('init_state', queues);
    if (cb) cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));