const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 4개 은행 대기열 데이터
const queues = {
  "우리은행": { current: 0, nextNumber: 1, waiting: [] },
  "신한은행": { current: 0, nextNumber: 1, waiting: [] },
  "국민은행": { current: 0, nextNumber: 1, waiting: [] },
  "푸본현대생명": { current: 0, nextNumber: 1, waiting: [] }
};

io.on('connection', (socket) => {
  // 초기 데이터 전달
  socket.emit('init_state', queues);

  socket.on('get_all_state', () => {
    socket.emit('init_state', queues);
  });

  // 1. 발권
  socket.on('issue_ticket', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    const ticketNo = queues[bank].nextNumber++;
    queues[bank].waiting.push(ticketNo);
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

  // 3. 미루기
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

  // 4. 호출
  socket.on('call_next', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    if (queues[bank].waiting.length === 0) {
      return cb({ success: false, message: '대기 고객이 없습니다.' });
    }
    const nextNum = queues[bank].waiting.shift();
    queues[bank].current = nextNum;
    io.emit('queue_update', { bank, data: queues[bank] });
    io.emit('voice_call', { bank, ticketNo: nextNum });
    cb({ success: true, ticketNo: nextNum });
  });

  // 5. 초기화
  socket.on('reset_queue', ({ bank }, cb) => {
    if (!queues[bank]) return cb({ success: false });
    queues[bank].current = 0;
    queues[bank].nextNumber = 1;
    queues[bank].waiting = [];
    io.emit('queue_update', { bank, data: queues[bank] });
    cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));