const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// 4개 은행 및 독립 창구(책상) 데이터
const queues = {
  "우리은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중" },
      { id: 2, name: "2번 창구", current: 0, status: "대기중" }
    ]
  },
  "신한은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중" },
      { id: 2, name: "2번 창구", current: 0, status: "대기중" }
    ]
  },
  "국민은행": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중" },
      { id: 2, name: "2번 창구", current: 0, status: "대기중" }
    ]
  },
  "푸본현대생명": {
    nextNumber: 1,
    waiting: [],
    desks: [
      { id: 1, name: "1번 창구", current: 0, status: "대기중" }
    ]
  }
};

io.on('connection', (socket) => {
  socket.emit('init_state', queues);

  socket.on('get_all_state', () => {
    socket.emit('init_state', queues);
  });

  // 발권
  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const ticketNo = queues[bank].nextNumber++;
    queues[bank].waiting.push(ticketNo);
    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true, ticketNo });
  });

  // 취소
  socket.on('cancel_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return;
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      io.emit('queue_update', { bank, data: queues[bank] });
    }
    if (cb) cb({ success: true });
  });

  // 미루기
  socket.on('delay_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      queues[bank].waiting.push(ticketNo);
      io.emit('queue_update', { bank, data: queues[bank] });
      if (cb) cb({ success: true });
    } else {
      if (cb) cb({ success: false });
    }
  });

  // 창구별 고객 호출
  socket.on('call_next_desk', ({ bank, deskId }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    if (queues[bank].waiting.length === 0) {
      return cb && cb({ success: false, message: '대기 고객이 없습니다.' });
    }
    const desk = queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false, message: '창구를 찾을 수 없습니다.' });

    const nextNum = queues[bank].waiting.shift();
    desk.current = nextNum;
    desk.status = '호출중';

    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('voice_call', { bank, deskName: desk.name, ticketNo: nextNum });
    if (cb) cb({ success: true, ticketNo: nextNum });
  });

  // 창구 상담 상태 변경
  socket.on('update_desk_status', ({ bank, deskId, status }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const desk = queues[bank].desks.find(d => d.id === Number(deskId));
    if (!desk) return cb && cb({ success: false });

    desk.status = status;
    if (status === '상담완료') {
      desk.current = 0;
      desk.status = '대기중';
    }
    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  // 관리자: 창구 인원 증감
  socket.on('adjust_desk_count', ({ bank, change }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    const currentDesks = queues[bank].desks;
    
    if (change > 0) {
      const nextId = currentDesks.length > 0 ? Math.max(...currentDesks.map(d => d.id)) + 1 : 1;
      currentDesks.push({ id: nextId, name: `${currentDesks.length + 1}번 창구`, current: 0, status: "대기중" });
    } else if (change < 0) {
      if (currentDesks.length <= 1) {
        return cb && cb({ success: false, message: '최소 1개 창구는 유지해야 합니다.' });
      }
      currentDesks.pop();
    }

    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  // 관리자: 은행 추가
  socket.on('add_bank', ({ newBank }, cb) => {
    if (!newBank || queues[newBank]) return cb && cb({ success: false, message: '중복되거나 잘못된 이름입니다.' });
    queues[newBank] = {
      nextNumber: 1,
      waiting: [],
      desks: [{ id: 1, name: "1번 창구", current: 0, status: "대기중" }]
    };
    io.emit('init_state', queues);
    if (cb) cb({ success: true });
  });

  // 관리자: 개별 리셋
  socket.on('reset_queue', ({ bank }, cb) => {
    if (!queues[bank]) return cb && cb({ success: false });
    queues[bank].nextNumber = 1;
    queues[bank].waiting = [];
    queues[bank].desks.forEach(d => { d.current = 0; d.status = '대기중'; });
    io.emit('queue_update', { bank, data: queues[bank] });
    if (cb) cb({ success: true });
  });

  // 관리자: 전체 리셋
  socket.on('reset_all_queues', (cb) => {
    Object.keys(queues).forEach(b => {
      queues[b].nextNumber = 1;
      queues[b].waiting = [];
      queues[b].desks.forEach(d => { d.current = 0; d.status = '대기중'; });
    });
    io.emit('init_state', queues);
    if (cb) cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));