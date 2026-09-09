/*
 * 홈 화면 앱 설치 지원.
 * 각 화면에서 <script src="/pwa.js" data-role="teller"></script> 처럼 역할만 지정하면 된다.
 * - 역할과 은행에 맞는 매니페스트를 연결한다.
 * - 서비스 워커를 등록해 현장 네트워크가 흔들려도 화면이 뜨게 한다.
 * - 안드로이드는 설치 버튼, 아이폰은 홈 화면 추가 안내를 띄운다.
 */
(function () {
  var me = document.currentScript;
  var role = (me && me.getAttribute('data-role')) || 'hub';

  var params = new URLSearchParams(window.location.search);
  var bank = (params.get('bank') || params.get('b') || '').toLowerCase().trim();

  // 1) 매니페스트 연결
  var href = '/manifest.webmanifest?role=' + encodeURIComponent(role) + (bank ? '&b=' + encodeURIComponent(bank) : '');
  var link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = href;

  // 2) 서비스 워커 등록
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  if (isStandalone()) return;   // 이미 앱으로 실행 중

  var dismissKey = 'pwa_dismissed_' + role + '_' + (bank || 'all');
  if (localStorage.getItem(dismissKey) === '1') return;

  var deferredPrompt = null;

  function makeButton() {
    if (document.getElementById('pwaInstallBtn')) return;
    var wrap = document.createElement('div');
    wrap.id = 'pwaInstallBtn';
    wrap.style.cssText = [
      'position:fixed', 'left:14px', 'bottom:calc(env(safe-area-inset-bottom) + 14px)',
      'z-index:990', 'display:flex', 'align-items:center', 'gap:8px',
      'background:#111827', 'color:#fff', 'border-radius:999px',
      'padding:13px 18px', 'font-size:15px', 'font-weight:900',
      'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,0.35)', 'cursor:pointer', 'max-width:calc(100vw - 28px)'
    ].join(';');
    wrap.innerHTML = '<span>📲 앱으로 설치</span>' +
      '<span id="pwaClose" style="opacity:0.55;padding:0 4px;font-size:18px;">✕</span>';

    wrap.onclick = function (e) {
      if (e.target && e.target.id === 'pwaClose') {
        try { localStorage.setItem(dismissKey, '1'); } catch (err) {}
        wrap.remove();
        return;
      }
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') wrap.remove();
          deferredPrompt = null;
        }).catch(function () {});
      } else {
        showIosGuide();
      }
    };
    document.body.appendChild(wrap);
  }

  function showIosGuide() {
    if (document.getElementById('pwaIosGuide')) return;
    var box = document.createElement('div');
    box.id = 'pwaIosGuide';
    box.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:995', 'background:rgba(0,0,0,0.82)',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
      'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif'
    ].join(';');
    box.innerHTML =
      '<div style="background:#fff;color:#191f28;border-radius:26px;padding:26px 22px;max-width:400px;width:100%;">' +
        '<div style="font-size:21px;font-weight:900;margin-bottom:12px;">홈 화면에 앱으로 추가</div>' +
        '<div style="font-size:15px;font-weight:700;color:#4e5968;line-height:1.7;">' +
          '1. 화면 아래 <b>공유 버튼</b>을 누릅니다.<br>' +
          '2. <b>홈 화면에 추가</b>를 선택합니다.<br>' +
          '3. <b>추가</b>를 누르면 앱처럼 실행됩니다.' +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;color:#8b95a1;margin-top:14px;line-height:1.6;">' +
          '사파리(Safari)에서 열어야 추가할 수 있습니다.' +
        '</div>' +
        '<button id="pwaIosClose" style="width:100%;min-height:56px;margin-top:20px;border:none;border-radius:16px;' +
        'background:#191f28;color:#fff;font-size:17px;font-weight:900;cursor:pointer;">확인</button>' +
      '</div>';
    box.onclick = function (e) {
      if (e.target === box || (e.target && e.target.id === 'pwaIosClose')) box.remove();
    };
    document.body.appendChild(box);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    makeButton();
  });

  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('pwaInstallBtn');
    if (b) b.remove();
  });

  // 아이폰은 beforeinstallprompt 가 없으므로 안내 버튼을 직접 띄운다.
  if (isIos()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', makeButton);
    } else {
      makeButton();
    }
  }
})();
