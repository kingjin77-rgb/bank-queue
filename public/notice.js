/*
 * 현장 안내 방송 패널 (현장안내 앱 · 관리자 앱 공용)
 * 버튼을 누르면 서버가 'play_notice' 로 보내고, 스피커를 켠 관리자 PC 와 소리를 켠 전광판에서만 읽는다.
 * 사용: mountNoticePanel(document.getElementById('noticeBox'), socket, { dark: true })
 */
(function () {
  // 운영 방식(사전예약 / 일반)에 따라 앞 두 멘트가 바뀐다. 나머지는 공통.
  var FIRST = {
    reserve: [
      ['예약자 안내', '사전 예약하신 고객님께서는 QR코드를 찍고 예약하신 동·호수를 입력해 주십시오. 예약 확인 후 바로 번호표가 발급됩니다.'],
      ['현장 접수 안내', '예약하지 않으신 고객님께서는 현장 접수 버튼을 눌러 번호표를 받아 주십시오. 예약 고객님이 먼저 호출되는 점 양해 부탁드립니다.']
    ],
    general: [
      ['번호표 안내', 'QR코드를 찍으시면 바로 번호표가 발급됩니다. 오신 순서대로 호출해 드립니다.'],
      ['상담 순서 안내', '법무법인 제이엘 상담을 먼저 받으신 뒤 은행 상담이 진행됩니다.']
    ]
  };
  // 제이엘 상담이 없는 현장(예: 은행 단독)에서는 제이엘 관련 멘트를 뺀다.
  function jlText(t) { return /제이엘/.test(t[1]); }
  var COMMON = [
    ['호출 알림 켜기', '번호표를 받으신 후 호출 알림 켜기를 꼭 눌러 주십시오. 순서가 되면 휴대폰과 방송으로 안내해 드립니다.'],
    ['은행 번호표', '법무법인 제이엘 상담을 마치신 고객님께서는 휴대폰에서 은행을 선택하시고 은행 번호표를 받아 주십시오.'],
    ['휴대폰 없는 분', '휴대폰이 없으시거나 번호표 받기가 어려우신 고객님께서는 안내 직원에게 말씀해 주십시오.']
  ];
  window.mountNoticePanel = function (box, socket, opt) {
    opt = opt || {};
    var dark = !!opt.dark;
    var c = {
      bg: dark ? '#111827' : '#fff', text: dark ? '#fff' : '#191f28', sub: dark ? '#94a3b8' : '#6b7684',
      btn: dark ? '#1e293b' : '#f2f4f6', border: dark ? '#334155' : '#e5e8eb'
    };
    box.innerHTML =
      '<div style="font-size:13px;color:' + c.sub + ';line-height:1.5;margin-bottom:10px;">누르면 스피커 PC(스피커 방송 켜진 관리자 화면)와 전광판에서 한 번 방송됩니다.</div>' +
      '<div class="nt-grid" style="display:grid;grid-template-columns:1fr;gap:8px;"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<input class="nt-input" type="text" maxlength="200" placeholder="직접 입력할 안내 문장" style="flex:1;min-width:0;padding:12px;border-radius:12px;border:1px solid ' + c.border + ';background:' + c.bg + ';color:' + c.text + ';font-size:16px;">' +
        '<button class="nt-send" style="padding:0 18px;border:none;border-radius:12px;background:#3182f6;color:#fff;font-size:16px;font-weight:900;cursor:pointer;">방송</button>' +
      '</div>' +
      '<div class="nt-msg" style="margin-top:8px;font-size:14px;font-weight:800;min-height:20px;color:#22c55e;"></div>';
    var grid = box.querySelector('.nt-grid');
    var msg = box.querySelector('.nt-msg');
    function send(text) {
      text = String(text || '').trim();
      if (!text) { msg.style.color = '#f87171'; msg.innerText = '방송할 문장을 넣어 주세요.'; return; }
      if (!socket.connected) { msg.style.color = '#f87171'; msg.innerText = '연결 중입니다. 잠시 후 다시 눌러 주세요.'; return; }
      socket.timeout(5000).emit('staff_notice', { text: text }, function (err, res) {
        if (err || !res) { msg.style.color = '#f87171'; msg.innerText = '방송되지 않았습니다. 다시 눌러 주세요.'; return; }
        if (!res.ok && res.reason === 'repeat') { msg.style.color = '#fbbf24'; msg.innerText = '방금 같은 안내를 방송했습니다(5초 뒤 다시 가능).'; return; }
        if (!res.ok) { msg.style.color = '#f87171'; msg.innerText = '방송되지 않았습니다.'; return; }
        msg.style.color = '#22c55e';
        msg.innerText = '📢 방송했습니다 · ' + new Date().toLocaleTimeString('ko-KR');
      });
    }
    var mode = '', hasJl = true;
    function renderButtons(m, jl) {
      m = m === 'reserve' ? 'reserve' : 'general';
      if (typeof jl === 'boolean') jl = jl; else jl = hasJl;
      if (m === mode && jl === hasJl && grid.children.length) return;
      mode = m; hasJl = jl;
      grid.innerHTML = '';
      FIRST[m].concat(COMMON).filter(function (t) { return hasJl || !jlText(t); }).forEach(addButton);
    }
    function addButton(p, i) {
      var b = document.createElement('button');
      b.className = 'nt-btn';
      b.setAttribute('data-i', i);
      b.style.cssText = 'text-align:left;padding:12px 14px;border-radius:14px;border:1px solid ' + c.border + ';background:' + c.btn + ';color:' + c.text + ';cursor:pointer;line-height:1.4;';
      b.innerHTML = '<div style="font-size:16px;font-weight:900;">📢 ' + p[0] + '</div><div style="font-size:13px;color:' + c.sub + ';margin-top:3px;">' + p[1] + '</div>';
      b.onclick = function () { send(p[1]); };
      grid.appendChild(b);
    }
    renderButtons(opt.mode || 'general');
    socket.on('all_state_update', function (d) { if (d && d.settings) renderButtons(d.settings.siteMode, !!(d.bankInfo && d.bankInfo.jl)); });
    socket.on('reserve_state', function (d) { if (d && d.siteMode) renderButtons(d.siteMode); });
    box.querySelector('.nt-send').onclick = function () {
      var inp = box.querySelector('.nt-input');
      send(inp.value);
    };
  };
})();
