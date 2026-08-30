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
let noShowList = []; 
let banks = ['우리은행', '국민은행', '신한은행', '하나은행', '농협은행'];
let tellers = [
  { id: 1, name: '우리은행 1번 창구', bank: '우리은행' },
  { id: 2, name: '우리은행 2번 창구', bank: '우리은행' },
  { id: 3, name: '국민은행 1번 창구', bank: '국민은행' },
  { id: 4, name: '국민은행 2번 창구', bank: '국민은행' }
];
let counterStatus = {}; 
let consultHistory = []; 

function broadcastState() {
  io.emit('state_update', {
    banks,
    tellers,
    counterStatus,
    noShowList,
    totalWaiting: queue.length,
    queueList: queue.map((q, idx) => ({
      ticketNo: q.ticketNo,
      order: idx + 1,
      bank: q.bank,
      delayCount: q.delayCount
    })),
    stats: banks.map(b => ({
      bank: b,
      waiting: queue.filter(q => q.bank === b).length,
      completed: consultHistory.filter(h => h.bank === b).length
    }))
  });
}

io.on('connection', (socket) => {
  // 발권
  socket.on('issue_ticket', ({ selectedBank }) => {
    currentTicketSeq += 1;
    const ticket = {
      ticketNo: currentTicketSeq,
      bank: selectedBank || banks[0] || '우리은행',
      delayCount: 0,
      issuedAt: new Date().toLocaleTimeString('ko-KR')
    };
    queue.push(ticket);

    const bankQueue = queue.filter(q => q.bank === ticket.bank);
    const bankOrder = bankQueue.findIndex(q => q.ticketNo === ticket.ticketNo) + 1;

    socket.emit('ticket_issued', {
      ticketNo: ticket.ticketNo,
      bank: ticket.bank,
      order: bankOrder,
      delayCount: 3
    });

    broadcastState();
  });

  // 미루기
  socket.on('delay_order', ({ ticketNo }) => {
    const itemIdx = queue.findIndex(q => Number(q.ticketNo) === Number(ticketNo));
    if (itemIdx === -1) return socket.emit('error_msg', '대기열에 번호표가 없습니다.');

    const item = queue[itemIdx];
    if (item.delayCount >= 3) return socket.emit('error_msg', '미루기는 최대 3회만 가능합니다.');

    item.delayCount += 1;
    queue.splice(itemIdx, 1);

    const sameBankIndices = [];
    queue.forEach((q, idx) => { if (q.bank === item.bank) sameBankIndices.push(idx); });

    let insertIdx = queue.length;
    if (sameBankIndices.length >= 3) {
      insertIdx = sameBankIndices[2] + 1;
    }
    queue.splice(insertIdx, 0, item);

    socket.emit('order_delayed', {
      ticketNo: item.ticketNo,
      delayRemaining: 3 - item.delayCount
    });

    broadcastState();
  });

  // 고객 호출
  socket.on('call_next', ({ tellerId }) => {
    const tid = String(tellerId);
    const teller = tellers.find(t => String(t.id) === tid);
    if (!teller) return socket.emit('error_msg', '창구 정보가 올바르지 않습니다.');

    const customerIdx = queue.findIndex(q => q.bank === teller.bank);
    if (customerIdx === -1) {
      return socket.emit('error_msg', `${teller.bank} 대기 고객이 없습니다.`);
    }

    const servedCustomer = queue.splice(customerIdx, 1)[0];
    counterStatus[tid] = {
      ticketNo: servedCustomer.ticketNo,
      status: 'CALLED',
      tellerName: teller.name,
      bank: teller.bank,
      callStartTime: Date.now()
    };

    io.emit('customer_called', {
      ticketNo: servedCustomer.ticketNo,
      counterName: teller.name,
      bankName: teller.bank
    });

    socket.emit('call_success', { 
      ticketNo: servedCustomer.ticketNo,
      counterName: teller.name,
      bankName: teller.bank
    });
    broadcastState();
  });

  // 상담 시작
  socket.on('start_consult', ({ tellerId }) => {
    const tid = String(tellerId);
    if (counterStatus[tid]) {
      counterStatus[tid].status = 'IN_PROGRESS';
      counterStatus[tid].consultStartTime = Date.now();
      broadcastState();
    }
  });

  // 부재 처리
  socket.on('mark_no_show', ({ tellerId }) => {
    const tid = String(tellerId);
    if (counterStatus[tid]) {
      const missed = counterStatus[tid];
      noShowList.push({
        ticketNo: missed.ticketNo,
        bank: missed.bank,
        tellerName: missed.tellerName,
        noShowAt: new Date().toLocaleTimeString('ko-KR')
      });
      delete counterStatus[tid];
      socket.emit('consult_finished');
      broadcastState();
    }
  });

  // 부재 재호출
  socket.on('recall_no_show', ({ tellerId, ticketNo }) => {
    const tid = String(tellerId);
    const teller = tellers.find(t => String(t.id) === tid);
    const idx = noShowList.findIndex(n => Number(n.ticketNo) === Number(ticketNo));
    if (idx !== -1 && teller) {
      const recalled = noShowList.splice(idx, 1)[0];
      counterStatus[tid] = {
        ticketNo: recalled.ticketNo,
        status: 'CALLED',
        tellerName: teller.name,
        bank: teller.bank,
        callStartTime: Date.now()
      };
      io.emit('customer_called', {
        ticketNo: recalled.ticketNo,
        counterName: teller.name,
        bankName: teller.bank
      });
      socket.emit('call_success', { 
        ticketNo: recalled.ticketNo,
        counterName: teller.name,
        bankName: teller.bank
      });
      broadcastState();
    }
  });

  // 상담 종료
  socket.on('finish_consult', ({ tellerId }) => {
    const tid = String(tellerId);
    if (counterStatus[tid]) {
      const current = counterStatus[tid];
      const durationSec = current.consultStartTime ? Math.round((Date.now() - current.consultStartTime) / 1000) : 0;
      consultHistory.push({
        ticketNo: current.ticketNo,
        bank: current.bank,
        tellerName: current.tellerName,
        duration: `${Math.floor(durationSec / 60)}분 ${durationSec % 60}초`,
        finishedAt: new Date().toLocaleTimeString('ko-KR')
      });

      io.emit('customer_finished', { ticketNo: current.ticketNo });
      delete counterStatus[tid];
      socket.emit('consult_finished');
      broadcastState();
    }
  });

  // 관리자 은행 관리
  socket.on('admin_add_bank', ({ bankName }) => {
    if (bankName && !banks.includes(bankName)) {
      banks.push(bankName);
      broadcastState();
    }
  });
  socket.on('admin_delete_bank', ({ bankName }) => {
    banks = banks.filter(b => b !== bankName);
    tellers = tellers.filter(t => t.bank !== bankName);
    broadcastState();
  });

  // 관리자: 자동 창구 순번 생성 (+1 카운팅)
  socket.on('admin_add_auto_teller', ({ bank }) => {
    if (!bank) return;
    const sameBankTellers = tellers.filter(t => t.bank === bank);
    const nextNumber = sameBankTellers.length + 1;
    const autoName = `${bank} ${nextNumber}번 창구`;
    const newId = tellers.length > 0 ? Math.max(...tellers.map(t => Number(t.id))) + 1 : 1;
    
    tellers.push({ id: newId, name: autoName, bank });
    broadcastState();
  });

  socket.on('admin_delete_teller', ({ tellerId }) => {
    const tid = String(tellerId);
    tellers = tellers.filter(t => String(t.id) !== tid);
    delete counterStatus[tid];
    broadcastState();
  });

  // 엑셀 다운로드
  socket.on('admin_request_csv', () => {
    let csv = '\uFEFF번호표,은행,담당창구,상담소요시간,종료시각\n';
    consultHistory.forEach(h => {
      csv += `${h.ticketNo},${h.bank},${h.tellerName},${h.duration},${h.finishedAt}\n`;
    });
    socket.emit('admin_download_csv', { csvData: csv });
  });

  // 전체 초기화
  socket.on('admin_reset_queue', () => {
    currentTicketSeq = 100;
    queue = [];
    noShowList = [];
    counterStatus = {};
    consultHistory = [];
    io.emit('system_reset_alert');
    broadcastState();
  });

  socket.emit('state_update', {
    banks,
    tellers,
    counterStatus,
    noShowList,
    totalWaiting: queue.length,
    queueList: queue.map((q, idx) => ({
      ticketNo: q.ticketNo,
      order: idx + 1,
      bank: q.bank,
      delayCount: q.delayCount
    })),
    stats: banks.map(b => ({
      bank: b,
      waiting: queue.filter(q => q.bank === b).length,
      completed: consultHistory.filter(h => h.bank === b).length
    }))
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});