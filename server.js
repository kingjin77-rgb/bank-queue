const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

global.bankMasterList = [
  { id: 'woori', name: '우리은행', color: '#0067ac', active: true, order: 1 },
  { id: 'shinhan', name: '신한은행', color: '#0046ff', active: true, order: 2 },
  { id: 'kb', name: '국민은행', color: '#ffbc00', active: true, order: 3 },
  { id: 'hana', name: '하나은행', color: '#008485', active: true, order: 4 },
  { id: 'fubon', name: '푸본현대생명', color: '#00a0e9', active: true, order: 5 },
  { id: 'jl', name: '법무법인 제이엘', color: '#1e293b', active: true, order: 6 },
  { id: 'nh', name: 'NH농협은행', color: '#02a850', active: true, order: 7 },
  { id: 'sh', name: '수협은행', color: '#0072ce', active: true, order: 8 },
  { id: 'hyundai', name: '현대캐피탈', color: '#002c6c', active: true, order: 9 }
];

global.queueState = {};

function initBankState(bankId) {
  const b = bankId.toLowerCase().trim();
  if (!global.queueState[b]) {
    global.queueState[b] = {
      currentSeq: 100,
      waiting: [],
      calling: null,
      completedCount: 0,
      hourlyStats: {},
      desks: [
        { id: 1, name: '1번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 2, name: '2번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 3, name: '3번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 4, name: '4번 창구', status: 'idle', currentTicket: null, completedCount: 0 }
      ]
    };
  }
  return b;
}

global.bankMasterList.forEach(b => initBankState(b.id));

let operatingHours = { startHour: 9, endHour: 20 };

io.on('connection', (socket) => {
  socket.emit('bank_list_sync', global.bankMasterList);
  socket.emit('operating_hours_update', operatingHours);
  socket.emit('full_state_sync', global.queueState);

  // 번호표 발권
  socket.on('issue_ticket', ({ bank }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    bState.currentSeq += 1;
    const ticketNo = bState.currentSeq;

    bState.waiting.push({ ticketNo, issuedAt: new Date().toISOString() });

    io.emit('queue_update', { bankId: bId, state: bState });
    io.emit('new_ticket_issued', { bankId: bId, ticketNo });
    socket.emit('ticket_issued_success', { bankId: bId, ticketNo });
  });

  // 호출
  socket.on('call_next_customer', ({ bank, deskId }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    const targetDeskId = parseInt(deskId, 10) || 1;
    const desk = bState.desks.find(d => d.id === targetDeskId);

    if (bState.waiting.length > 0 && desk) {
      const nextClient = bState.waiting.shift();
      desk.status = 'calling';
      desk.currentTicket = nextClient.ticketNo;
      bState.calling = { ticketNo: nextClient.ticketNo, deskId: desk.id };

      const bankObj = global.bankMasterList.find(b => b.id === bId) || { name: bId };

      io.emit('queue_update', { bankId: bId, state: bState });
      io.emit('customer_called', {
        bankId: bId,
        bankName: bankObj.name,
        ticketNo: nextClient.ticketNo,
        deskId: desk.id
      });
    }
  });

  // 재호출
  socket.on('recall_customer', ({ bank, deskId }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    const targetDeskId = parseInt(deskId, 10) || 1;
    const desk = bState.desks.find(d => d.id === targetDeskId);

    if (desk && desk.currentTicket) {
      const bankObj = global.bankMasterList.find(b => b.id === bId) || { name: bId };
      io.emit('customer_recalled', {
        bankId: bId,
        bankName: bankObj.name,
        ticketNo: desk.currentTicket,
        deskId: desk.id
      });
    }
  });

  // 부재패스
  socket.on('pass_customer', ({ bank, deskId }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    const targetDeskId = parseInt(deskId, 10) || 1;
    const desk = bState.desks.find(d => d.id === targetDeskId);

    if (desk && desk.currentTicket) {
      const passedTicket = desk.currentTicket;
      desk.status = 'idle';
      desk.currentTicket = null;
      bState.calling = null;

      io.emit('queue_update', { bankId: bId, state: bState });
      io.emit('customer_passed', { bankId: bId, ticketNo: passedTicket });
    }
  });

  // 상담종료
  socket.on('complete_consultation', ({ bank, deskId }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    const targetDeskId = parseInt(deskId, 10) || 1;
    const desk = bState.desks.find(d => d.id === targetDeskId);
    const finishedTicket = desk ? desk.currentTicket : null;

    bState.completedCount += 1;
    const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const curHour = nowKST.getHours();
    bState.hourlyStats[curHour] = (bState.hourlyStats[curHour] || 0) + 1;

    if (desk) {
      desk.status = 'idle';
      desk.currentTicket = null;
      desk.completedCount = (desk.completedCount || 0) + 1;
    }
    bState.calling = null;

    io.emit('queue_update', { bankId: bId, state: bState });

    if (finishedTicket) {
      io.emit('consultation_finished', { bankId: bId, ticketNo: finishedTicket });
    }
  });

  // 창구 간 고객 이동
  socket.on('transfer_customer_desk', ({ bank, fromDeskId, toDeskId }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    if (!bState) return;

    const fDesk = bState.desks.find(d => d.id === parseInt(fromDeskId, 10));
    const tDesk = bState.desks.find(d => d.id === parseInt(toDeskId, 10));

    if (!fDesk || !fDesk.currentTicket || !tDesk) return;

    const movingTicket = fDesk.currentTicket;
    fDesk.status = 'idle';
    fDesk.currentTicket = null;

    if (!tDesk.currentTicket) {
      tDesk.status = 'calling';
      tDesk.currentTicket = movingTicket;
    } else {
      bState.waiting.unshift({ ticketNo: movingTicket, targetDeskId: tDesk.id, issuedAt: new Date().toISOString() });
    }

    const bankObj = global.bankMasterList.find(b => b.id === bId) || { name: bId };

    io.emit('queue_update', { bankId: bId, state: bState });
    io.emit('customer_called', {
      bankId: bId,
      bankName: bankObj.name,
      ticketNo: movingTicket,
      deskId: tDesk.id,
      isTransfer: true
    });
  });

  // ================= [관리자 admin 기능] =================

  // 창구(상담사) 1개 추가
  socket.on('admin_add_desk', ({ bank }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    const newId = bState.desks.length + 1;
    bState.desks.push({
      id: newId,
      name: `${newId}번 창구`,
      status: 'idle',
      currentTicket: null,
      completedCount: 0
    });
    io.emit('queue_update', { bankId: bId, state: bState });
    io.emit('full_state_sync', global.queueState);
  });

  // 창구 1개 제거
  socket.on('admin_remove_desk', ({ bank }) => {
    const bId = initBankState(bank);
    const bState = global.queueState[bId];
    if (bState.desks.length > 1) {
      bState.desks.pop();
      io.emit('queue_update', { bankId: bId, state: bState });
      io.emit('full_state_sync', global.queueState);
    }
  });

  // 단일 기관 초기화
  socket.on('reset_bank_queue', ({ bank }) => {
    const bId = bank.toLowerCase().trim();
    const curDesks = (global.queueState[bId] && global.queueState[bId].desks) ? global.queueState[bId].desks : [
      { id: 1, name: '1번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
      { id: 2, name: '2번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
      { id: 3, name: '3번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
      { id: 4, name: '4번 창구', status: 'idle', currentTicket: null, completedCount: 0 }
    ];

    curDesks.forEach(d => { d.status = 'idle'; d.currentTicket = null; d.completedCount = 0; });

    global.queueState[bId] = {
      currentSeq: 100,
      waiting: [],
      calling: null,
      completedCount: 0,
      hourlyStats: {},
      desks: curDesks
    };
    io.emit('queue_update', { bankId: bId, state: global.queueState[bId] });
    io.emit('full_state_sync', global.queueState);
  });

  // 전체 기관 일괄 초기화
  socket.on('reset_all_queues', () => {
    global.bankMasterList.forEach(b => {
      const curDesks = (global.queueState[b.id] && global.queueState[b.id].desks) ? global.queueState[b.id].desks : [
        { id: 1, name: '1번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 2, name: '2번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 3, name: '3번 창구', status: 'idle', currentTicket: null, completedCount: 0 },
        { id: 4, name: '4번 창구', status: 'idle', currentTicket: null, completedCount: 0 }
      ];
      curDesks.forEach(d => { d.status = 'idle'; d.currentTicket = null; d.completedCount = 0; });

      global.queueState[b.id] = {
        currentSeq: 100,
        waiting: [],
        calling: null,
        completedCount: 0,
        hourlyStats: {},
        desks: curDesks
      };
    });
    io.emit('full_state_sync', global.queueState);
  });

  // 기관 마스터 목록 갱신
  socket.on('update_bank_list', (newList) => {
    if (Array.isArray(newList)) {
      global.bankMasterList = newList;
      newList.forEach(b => initBankState(b.id));
      io.emit('bank_list_sync', global.bankMasterList);
    }
  });

  // 운영시간 갱신
  socket.on('update_operating_hours', (newHours) => {
    operatingHours = newHours;
    io.emit('operating_hours_update', operatingHours);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});