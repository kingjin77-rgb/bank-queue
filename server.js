const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let banks = ['우리은행', '신한은행', '국민은행', '푸본현대생명'];
let counters = [
  { id: 'C1', name: '우리은행 1번 창구', bank: '우리은행' },
  { id: 'C2', name: '신한은행 1번 창구', bank: '신한은행' },
  { id: 'C3', name: '국민은행 1번 창구', bank: '국민은행' },
  { id: 'C4', name: '푸본현대생명 1번 창구', bank: '푸본현대생명' }
];

let queue = [];
let ticketCounter = 100;

function getStats() {
  return banks.map(bank => ({
    bank,
    waiting: queue.filter(q => q.bank === bank && q.status === 'WAITING').length,
    calling: queue.filter(q => q.bank === bank && q.status === 'CALLING').length,
    completed: queue.filter(q => q.bank === bank && q.status === 'COMPLETED').length
  }));
}

function broadcastState() {
  io.emit('state_update', {
    banks,
    counters,
    queue,
    stats: getStats()
  });
}

io.on('connection', (socket) => {
  socket.emit('state_update', {
    banks,
    counters,
    queue,
    stats: getStats()
  });

  socket.on('issue_ticket', ({ selectedBank }) => {
    if (!banks.includes(selectedBank)) return;
    ticketCounter += 1;
    const newTicket = {
      ticketNo: ticketCounter,
      bank: selectedBank,
      status: 'WAITING',
      createdAt: new Date().toISOString(),
      counterName: null
    };
    queue.push(newTicket);
    socket.emit('ticket_issued', newTicket);
    broadcastState();
  });

  socket.on('call_next', ({ counterId }) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter) return;

    const targetTicket = queue.find(q => q.bank === counter.bank && q.status === 'WAITING');
    if (targetTicket) {
      targetTicket.status = 'CALLING';
      targetTicket.counterName = counter.name;

      io.emit('customer_called', {
        ticketNo: targetTicket.ticketNo,
        bank: targetTicket.bank,
        counterName: counter.name
      });
      broadcastState();
    }
  });

  socket.on('recall_customer', ({ counterId }) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter) return;

    const callingTicket = queue.find(q => q.bank === counter.bank && q.counterName === counter.name && q.status === 'CALLING');
    if (callingTicket) {
      io.emit('customer_called', {
        ticketNo: callingTicket.ticketNo,
        bank: callingTicket.bank,
        counterName: counter.name
      });
    }
  });

  socket.on('complete_service', ({ counterId }) => {
    const counter = counters.find(c => c.id === counterId);
    if (!counter) return;

    const callingTicket = queue.find(q => q.bank === counter.bank && q.counterName === counter.name && q.status === 'CALLING');
    if (callingTicket) {
      callingTicket.status = 'COMPLETED';
      broadcastState();
    }
  });

  socket.on('add_bank', ({ bankName }) => {
    if (bankName && !banks.includes(bankName)) {
      banks.push(bankName);
      const newCounterId = 'C_' + Date.now();
      counters.push({ id: newCounterId, name: `${bankName} 1번 창구`, bank: bankName });
      broadcastState();
    }
  });

  socket.on('remove_bank', ({ bankName }) => {
    banks = banks.filter(b => b !== bankName);
    counters = counters.filter(c => c.bank !== bankName);
    broadcastState();
  });

  socket.on('reset_system', () => {
    queue = [];
    ticketCounter = 100;
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});