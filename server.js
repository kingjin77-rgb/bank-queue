const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const banks = {
  kb: { name: '국민은행', prefix: 'KB', currentNumber: 0, waiting: [], counters: {} },
  woori: { name: '우리은행', prefix: 'WOORI', currentNumber: 0, waiting: [], counters: {} },
  shinhan: { name: '신한은행', prefix: 'SHINHAN', currentNumber: 0, waiting: [], counters: {} },
  fubon: { name: '푸본현대', prefix: 'FUBON', currentNumber: 0, waiting: [], counters: {} }
};

io.on('connection', (socket) => {
  socket.emit('sync_state', banks);

  socket.on('issue_ticket', (data, callback) => {
    const { bank, name } = data;
    if (!banks[bank]) return;

    banks[bank].currentNumber++;
    const ticketNumber = banks[bank].currentNumber;
    const ticket = { id: Date.now(), ticketNumber, name: name || '일반고객', time: new Date().toLocaleTimeString() };

    banks[bank].waiting.push(ticket);
    io.emit('ticket_issued', { bank, ticket, totalWaiting: banks[bank].waiting.length });
    io.emit('sync_state', banks);

    if (typeof callback === 'function') callback({ success: true, ticket });
  });

  socket.on('call_customer', (data) => {
    const { bank, deskNumber } = data;
    if (!banks[bank] || banks[bank].waiting.length === 0) return;

    const customer = banks[bank].waiting.shift();
    const deskName = `${deskNumber}번 창구`;
    banks[bank].counters[deskNumber] = { customer, calledAt: new Date().toLocaleTimeString() };

    io.emit('customer_called', {
      bankKey: bank,
      bankName: banks[bank].name,
      customer,
      deskName,
      totalWaiting: banks[bank].waiting.length
    });
    io.emit('sync_state', banks);
  });

  socket.on('complete_consultation', (data) => {
    const { bank, deskNumber } = data;
    if (!banks[bank]) return;
    delete banks[bank].counters[deskNumber];
    io.emit('sync_state', banks);
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});