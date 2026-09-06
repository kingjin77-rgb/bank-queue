// [동일 기관 내 창구 이동] 1번 창구 -> 2번 창구로 고객 전달
socket.on('transfer_customer_desk', ({ bank, fromDeskId, toDeskId }) => {
  const bId = initBankState(bank);
  const bState = global.queueState[bId];
  if (!bState) return;

  const fDesk = bState.desks.find(d => d.id === parseInt(fromDeskId, 10));
  const tDesk = bState.desks.find(d => d.id === parseInt(toDeskId, 10));

  if (!fDesk || !fDesk.currentTicket || !tDesk) return;

  const movingTicket = fDesk.currentTicket;

  // 보낸 창구는 빈 상태로 전환
  fDesk.status = 'idle';
  fDesk.currentTicket = null;

  // 받는 창구의 현재 고객으로 바로 꽂아주거나(비어있을 때), 대기 1순위로 즉시 전달
  if (!tDesk.currentTicket) {
    tDesk.status = 'calling';
    tDesk.currentTicket = movingTicket;
  } else {
    // 받는 창구에 이미 손님이 있으면 해당 창구 대기 1순위로 삽입
    bState.waiting.unshift({ ticketNo: movingTicket, targetDeskId: tDesk.id, issuedAt: new Date().toISOString() });
  }

  const bankObj = global.bankMasterList.find(b => b.id === bId) || { name: bId };

  // 상태 전체 전파
  io.emit('queue_update', { bankId: bId, state: bState });

  // 공용 앰프 및 고객에게 "O번 창구로 이동하세요" 방송
  io.emit('customer_called', {
    bankId: bId,
    bankName: bankObj.name,
    ticketNo: movingTicket,
    deskId: tDesk.id,
    isTransfer: true
  });
});