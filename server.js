const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// 상태 변수
let currentTicketSeq = 100;
let queue = []; // [{ ticketNo: 101, socketId: '...', delayCount: 0, bank: '우리은행' }]
let banks = ['우리은행', '국민은행', '신한은행', '하나은행'];
let tellers = [
  { id: 1, name: '1번 창구 (김상담)', bank: '우리은행' },
  { id: 2, name: '2번 창구 (이상담)', bank: '우리은행' },
  { id: 3, name: '3번 창구 (박상담)', bank: '우리은행' },
  { id: 4, name: '4번 창구 (최상담)', bank: '우리은행' }
];
let counterStatus = {}; // { 1: { ticketNo: 101, status: 'CALLED' } }

function broadcastState() {
  io.emit('state_update', {
    banks,
    tellers,
    counterStatus,
    totalWaiting: queue.length,
    queueList: queue.map((q, idx) => ({
      ticketNo: q.ticketNo,
      order: idx + 1,
      bank: q.bank,
      delayCount: q.delayCount
    }))
  });
}

io.on('connection', (socket) => {
  // 1. 발권 (은행 선택 가능)
  socket.on('issue_ticket', ({ selectedBank } = {}) => {
    currentTicketSeq += 1;
    const ticket = {
      ticketNo: currentTicketSeq,
      socketId: socket.id,
      delayCount: 0,
      bank: selectedBank || banks[0] || '우리은행'
    };
    queue.push(ticket);

    socket.emit('ticket_issued', {
      ticketNo: ticket.ticketNo,
      order: queue.length,
      delayCount: 3,
      bank: ticket.bank
    });

    broadcastState();
  });

  // 2. 순서 미루기 (최대 3회, 3칸 뒤로 이동)
  socket.on('delay_order', ({ ticketNo }) => {
    const itemIdx = queue.findIndex(q => q.ticketNo === Number(ticketNo));
    if (itemIdx === -1) {
      return socket.emit('error_msg', '대기열에 해당 번호표가 존재하지 않습니다.');
    }

    const item = queue[itemIdx];
    if (item.delayCount >= 3) {
      return socket.emit('error_msg', '순서 미루기는 최대 3회까지만 가능합니다.');
    }

    item.delayCount += 1;
    queue.splice(itemIdx, 1);

    // 3칸 뒤로 삽입 (맨 뒤 초과 시 맨 끝으로)
    const targetIdx = Math.min(queue.length, itemIdx + 3);
    queue.splice(targetIdx, 0, item);

    socket.emit('order_delayed', {
      ticketNo: item.ticketNo,
      delayRemaining: 3 - item.delayCount,
      newOrder: targetIdx + 1
    });

    broadcastState();
  });

  // 3. 상담사 호출
  socket.on('call_next', ({ tellerId }) => {
    if (queue.length === 0) {
      return socket.emit('error_msg', '대기 중인 고객이 없습니다.');
    }

    const teller = tellers.find(t => t.id === Number(tellerId));
    const tellerName = teller ? teller.name : `${tellerId}번 창구`;
    const tellerBank = teller ? teller.bank : '우리은행';

    const servedCustomer = queue.shift();
    counterStatus[tellerId] = {
      ticketNo: servedCustomer.ticketNo,
      status: 'CALLED',
      tellerName,
      bank: tellerBank
    };

    // 고객 단말기로 호출 신호 전송
    io.to(servedCustomer.socketId).emit('customer_called', {
      ticketNo: servedCustomer.ticketNo,
      counterName: tellerName,
      bankName: tellerBank
    });

    socket.emit('call_success', { ticketNo: servedCustomer.ticketNo });
    broadcastState();
  });

  // 4. 상담 시작
  socket.on('start_consult', ({ tellerId }) => {
    if (counterStatus[tellerId]) {
      counterStatus[tellerId].status = 'IN_PROGRESS';
      broadcastState();
    }
  });

  // 5. 상담 종료
  socket.on('finish_consult', ({ tellerId }) => {
    delete counterStatus[tellerId];
    socket.emit('consult_finished');
    broadcastState();
  });

  // 6. [관리자] 은행 추가 / 삭제
  socket.on('admin_add_bank', ({ bankName }) => {
    if (bankName && !banks.includes(bankName)) {
      banks.push(bankName);
      broadcastState();
    }
  });

  socket.on('admin_delete_bank', ({ bankName }) => {
    banks = banks.filter(b => b !== bankName);
    broadcastState();
  });

  // 7. [관리자] 상담원 추가 / 삭제
  socket.on('admin_add_teller', ({ name, bank }) => {
    const newId = tellers.length > 0 ? Math.max(...tellers.map(t => t.id)) + 1 : 1;
    tellers.push({ id: newId, name, bank });
    broadcastState();
  });

  socket.on('admin_delete_teller', ({ tellerId }) => {
    tellers = tellers.filter(t => t.id !== Number(tellerId));
    delete counterStatus[tellerId];
    broadcastState();
  });

  // 8. [관리자] 대기열 전체 초기화 (리셋)
  socket.on('admin_reset_queue', () => {
    currentTicketSeq = 100;
    queue = [];
    counterStatus = {};
    io.emit('system_reset_alert');
    broadcastState();
  });

  // 초기 상태 전달
  socket.emit('state_update', {
    banks,
    tellers,
    counterStatus,
    totalWaiting: queue.length,
    queueList: queue.map((q, idx) => ({
      ticketNo: q.ticketNo,
      order: idx + 1,
      bank: q.bank,
      delayCount: q.delayCount
    }))
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});