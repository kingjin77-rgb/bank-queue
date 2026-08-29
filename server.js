const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

let currentTicketSeq = 100;
let queue = [];
let activeCounters = 4;
let bankName = "우리은행";
let counterStatus = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };

function broadcastState() {
  io.emit('state_update', {
    bankName,
    activeCounters,
    totalWaiting: queue.length,
    counterStatus,
    queueList: queue.map((q, idx) => ({ ticketNo: q.ticketNo, order: idx + 1 }))
  });
}

io.on('connection', (socket) => {
  // 고객 발권
  socket.on('issue_ticket', () => {
    currentTicketSeq += 1;
    const ticket = {
      ticketNo: currentTicketSeq,
      socketId: socket.id,
      delayCount: 0
    };
    queue.push(ticket);

    socket.emit('ticket_issued', {
      ticketNo: ticket.ticketNo,
      order: queue.length,
      delayCount: 3
    });

    broadcastState();
  });

  // 고객 순서 미루기 (3칸 뒤로, 최대 3회)
  socket.on('delay_order', ({ ticketNo }) => {
    const itemIdx = queue.findIndex(q => q.ticketNo === ticketNo);
    if (itemIdx === -1) return;

    const item = queue[itemIdx];
    if (item.delayCount >= 3) {
      return socket.emit('error_msg', '더 이상 순서를 미룰 수 없습니다.');
    }

    item.delayCount += 1;
    queue.splice(itemIdx, 1);

    const targetIdx = Math.min(queue.length, itemIdx + 3);
    queue.splice(targetIdx, 0, item);

    socket.emit('order_delayed', {
      ticketNo: item.ticketNo,
      delayCount: 3 - item.delayCount,
      newOrder: targetIdx + 1
    });

    broadcastState();
  });

  // 상담사 호출
  socket.on('call_next', ({ counterId }) => {
    if (queue.length === 0) {
      return socket.emit('error_msg', '대기 중인 고객이 없습니다.');
    }

    const servedCustomer = queue.shift();
    counterStatus[counterId] = {
      ticketNo: servedCustomer.ticketNo,
      status: 'CALLED'
    };

    io.to(servedCustomer.socketId).emit('customer_called', {
      ticketNo: servedCustomer.ticketNo,
      counterId,
      bankName
    });

    socket.emit('call_success', { ticketNo: servedCustomer.ticketNo });
    broadcastState();
  });

  // 상담 시작
  socket.on('start_consult', ({ counterId }) => {
    if (counterStatus[counterId]) {
      counterStatus[counterId].status = 'IN_PROGRESS';
      broadcastState();
    }
  });

  // 상담 종료
  socket.on('finish_consult', ({ counterId }) => {
    counterStatus[counterId] = null;
    socket.emit('consult_finished');
    broadcastState();
  });

  // 관리자 설정 변경
  socket.on('update_admin_settings', ({ newBankName, newActiveCounters }) => {
    if (newBankName) bankName = newBankName;
    if (newActiveCounters) activeCounters = Number(newActiveCounters);
    broadcastState();
  });

  socket.emit('init_state', {
    bankName,
    activeCounters,
    totalWaiting: queue.length,
    counterStatus,
    queueList: queue.map((q, idx) => ({ ticketNo: q.ticketNo, order: idx + 1 }))
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});