const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// 은행별 대기열 및 인원수 관리 (staffCount)
const queues = {
  "우리은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staffCount: 2 },
  "신한은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staffCount: 2 },
  "국민은행": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staffCount: 2 },
  "푸본현대생명": { current: 0, nextNumber: 1, waiting: [], status: '대기중', staffCount: 1 }
};

io.on('connection', (socket) => {
  // 접속 즉시 현재 전체 상태 전달
  socket.emit('init_state', queues);

  socket.on('get_all_state', () => {
    socket.emit('init_state', queues);
  });

  // 1. 발권 (고객 / 관리자 대리발권) -> 모든 접속자에게 즉각 브로드캐스트
  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false, message: '존재하지 않는 은행' });
    const ticketNo = queues[bank].nextNumber++;
    queues[bank].waiting.push(ticketNo);
    
    // 전체 즉시 전송
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true, ticketNo });
  });

  // 2. 취소
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
  socket.on('call_next', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    if (queues[bank].waiting.length === 0) {
      return cb({ success: false, message: '대기 고객이 없습니다.' });
    }
    const nextNum = queues[bank].waiting.shift();
    queues[bank].current = nextNum;
    queues[bank].status = '호출중';
    
    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('voice_call', { bank, ticketNo: nextNum });
    cb({ success: true, ticketNo: nextNum });
  });

  // 5. 상담 상태 변경
  socket.on('update_status', ({ bank, status }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    queues[bank].status = status;
    if (status === '상담완료') {
      queues[bank].current = 0;
      queues[bank].status = '대기중';
    }
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true });
  });

  // 6. 관리자: 상담사 인원 수 증감 (+1 / -1)
  socket.on('adjust_staff_count', ({ bank, change }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    const newCount = (queues[bank].staffCount || 1) + change;
    if (newCount < 1) return cb({ success: false, message: '최소 1명 이상이어야 합니다.' });
    
    queues[bank].staffCount = newCount;
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true, count: newCount });
  });

  // 7. 관리자: 신규 은행 추가
  socket.on('add_bank', ({ newBank }, cb) => {
    if (!newBank || queues[newBank]) return cb({ success: false, message: '중복되거나 올바르지 않은 이름입니다.' });
    queues[newBank] = { current: 0, nextNumber: 1, waiting: [], status: '대기중', staffCount: 1 };
    io.emit('init_state', queues);
    cb({ success: true });
  });

  // 8. 관리자: 개별 은행 리셋
  socket.on('reset_queue', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    queues[bank].current = 0;
    queues[bank].nextNumber = 1;
    queues[bank].waiting = [];
    queues[bank].status = '대기중';
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true });
  });

  // 9. 관리자: 모든 은행 전체 일괄 리셋
  socket.on('reset_all_queues', (cb) => {
    Object.keys(queues).forEach(bank => {
      queues[bank].current = 0;
      queues[bank].nextNumber = 1;
      queues[bank].waiting = [];
      queues[bank].status = '대기중';
    });
    io.emit('init_state', queues);
    cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));