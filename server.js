const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 기본 은행 및 상태 데이터 구조
const queues = {
  "우리은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staff: ["상담창구 1"] },
  "신한은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staff: ["상담창구 1"] },
  "국민은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staff: ["상담창구 1"] },
  "푸본현대생명": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staff: ["상담창구 1"] }
};

io.on('connection', (socket) => {
  // 초기 데이터 전달
  socket.emit('init_state', queues);

  socket.on('get_all_state', () => {
    socket.emit('init_state', queues);
  });

  // 1. 발권 (고객 모바일 & 관리자 대리발권 공용)
  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false, message: '존재하지 않는 은행입니다.' });
    const ticketNo = queues[bank].nextNumber++;
    queues[bank].waiting.push(ticketNo);
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true, ticketNo });
  });

  // 2. 고객 취소
  socket.on('cancel_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return;
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      io.emit('queue_update', { bank, data: queues[bank] });
    }
    cb({ success: true });
  });

  // 3. 순번 미루기
  socket.on('delay_ticket', ({ bank, ticketNo }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    const idx = queues[bank].waiting.indexOf(ticketNo);
    if (idx > -1) {
      queues[bank].waiting.splice(idx, 1);
      queues[bank].waiting.push(ticketNo);
      io.emit('queue_update', { bank, data: queues[bank] });
      cb({ success: true });
    } else {
      cb({ success: false });
    }
  });

  // 4. 다음 고객 호출
  socket.on('call_next', ({ bank, staffName }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    if (queues[bank].waiting.length === 0) {
      return cb({ success: false, message: '대기 중인 고객이 없습니다.' });
    }
    const nextNum = queues[bank].waiting.shift();
    queues[bank].current = nextNum;
    queues[bank].status = '호출중';
    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('voice_call', { bank, ticketNo: nextNum, staffName: staffName || '' });
    cb({ success: true, ticketNo: nextNum });
  });

  // 5. 상담 상태 변경 (상담시작, 상담완료, 부재중)
  socket.on('update_status', ({ bank, status }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    if (queues[bank].current === 0 && status !== '대기중') {
      return cb({ success: false, message: '현재 호출된 고객 번호가 없습니다.' });
    }
    queues[bank].status = status;
    if (status === '상담완료') {
      queues[bank].current = 0;
      queues[bank].status = '대기중';
    }
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true });
  });

  // 6. 관리자: 새 은행 추가
  socket.on('add_bank', ({ newBank }, cb) => {
    if (!newBank || queues[newBank]) {
      return cb({ success: false, message: '이미 존재하거나 잘못된 이름입니다.' });
    }
    queues[newBank] = { current: 0, nextNumber: 1, waiting: [], status: '대기중', staff: ["상담창구 1"] };
    io.emit('init_state', queues);
    cb({ success: true });
  });

  // 7. 관리자: 특정 은행에 상담사 추가
  socket.on('add_staff', ({ bank, staffName }, cb) => {
    if (!queues[bank] || !staffName) return cb({ success: false });
    if (!queues[bank].staff.includes(staffName)) {
      queues[bank].staff.push(staffName);
      io.emit('queue_update', { bank, data: queues[bank] });
    }
    cb({ success: true });
  });

  // 8. 관리자: 번호표 초기화 (1번부터)
  socket.on('reset_queue', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    queues[bank].current = 0;
    queues[bank].nextNumber = 1;
    queues[bank].waiting = [];
    queues[bank].status = '대기중';
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));