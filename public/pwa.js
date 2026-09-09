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

  // 카카오톡·네이버 같은 앱 안에 들어 있는 브라우저인지 확인.
  // 이 안에서는 앱 설치가 안 되고 알림음과 음성도 막히는 경우가 많다.
  function inAppBrowser() {
    var ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(ua)) return '카카오톡';
    if (/NAVER\(inapp/i.test(ua) || /NAVER/i.test(ua)) return '네이버 앱';
    if (/DaumApps|DaumDevice/i.test(ua)) return '다음 앱';
    if (/Line\//i.test(ua)) return '라인';
    if (/Instagram/i.test(ua)) return '인스타그램';
    if (/FBAN|FBAV/i.test(ua)) return '페이스북';
    if (/everytimeApp|zumapp|trill/i.test(ua)) return '앱 내 브라우저';
    return null;
  }

  function isAndroid() { return /android/i.test(navigator.userAgent); }

  function isMacSafari() {
    var ua = navigator.userAgent || '';
    return /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua);
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // 앱 안 브라우저면 제일 먼저 크게 알려준다. 소리가 안 나는 대부분의 원인이다.
  var inApp = inAppBrowser();
  if (inApp) {
    showInAppWarning(inApp);
    return;
  }

  if (isStandalone()) return;   // 이미 앱으로 실행 중

  var dismissKey = 'pwa_dismissed_' + role + '_' + (bank || 'all');
  if (localStorage.getItem(dismissKey) === '1') return;

  function showInAppWarning(appName) {
    function render() {
      if (document.getElementById('pwaInAppWarn')) return;
      var bar = document.createElement('div');
      bar.id = 'pwaInAppWarn';
      bar.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:996',
        'background:#7f1d1d', 'color:#fff', 'padding:16px 18px calc(env(safe-area-inset-bottom) + 16px)',
        'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif',
        'box-shadow:0 -8px 24px rgba(0,0,0,0.4)'
      ].join(';');

      var openLabel = isAndroid()
        ? '크롬으로 열기'
        : '사파리로 열기';
      var howto = isAndroid()
        ? '오른쪽 위 ⋮ 를 누르고 <b>다른 브라우저로 열기</b> 를 선택하세요.'
        : '오른쪽 아래 <b>공유 버튼</b>을 누르고 <b>Safari로 열기</b> 를 선택하세요.';

      bar.innerHTML =
        '<div style="font-size:16px;font-weight:900;margin-bottom:6px;">⚠️ ' + appName + ' 안에서 열려 있습니다</div>' +
        '<div style="font-size:14px;font-weight:700;line-height:1.6;opacity:0.95;">' +
          '이 상태에서는 <b>호출 음성과 알림음이 나오지 않을 수 있습니다.</b><br>' + howto +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
          (isAndroid()
            ? '<button id="pwaOpenExternal" style="flex:1;min-height:52px;border:none;border-radius:14px;background:#fff;color:#7f1d1d;font-size:16px;font-weight:900;cursor:pointer;">' + openLabel + '</button>'
            : '') +
          '<button id="pwaCopyUrl" style="flex:1;min-height:52px;border:2px solid rgba(255,255,255,0.6);border-radius:14px;background:transparent;color:#fff;font-size:16px;font-weight:900;cursor:pointer;">주소 복사</button>' +
          '<button id="pwaInAppClose" style="min-width:64px;min-height:52px;border:none;border-radius:14px;background:rgba(0,0,0,0.25);color:#fff;font-size:16px;font-weight:900;cursor:pointer;">닫기</button>' +
        '</div>';
      document.body.appendChild(bar);

      var ext = document.getElementById('pwaOpenExternal');
      if (ext) {
        ext.onclick = function () {
          // 안드로이드는 크롬으로 직접 넘길 수 있다.
          var u = window.location.href.replace(/^https?:\/\//, '');
          window.location.href = 'intent://' + u + '#Intent;scheme=https;package=com.android.chrome;end';
        };
      }
      document.getElementById('pwaCopyUrl').onclick = function () {
        var url = window.location.href;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url)
            .then(function () { alert('주소를 복사했습니다.\n크롬이나 사파리 주소창에 붙여넣어 주세요.'); })
            .catch(function () { prompt('아래 주소를 길게 눌러 복사하세요.', url); });
        } else {
          prompt('아래 주소를 길게 눌러 복사하세요.', url);
        }
      };
      document.getElementById('pwaInAppClose').onclick = function () { bar.remove(); };
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', render);
    } else {
      render();
    }
  }

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
    var mac = isMacSafari();
    var box = document.createElement('div');
    box.id = 'pwaIosGuide';
    box.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:995', 'background:rgba(0,0,0,0.82)',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
      'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif'
    ].join(';');
    box.innerHTML =
      '<div style="background:#fff;color:#191f28;border-radius:26px;padding:26px 22px;max-width:400px;width:100%;">' +
        '<div style="font-size:21px;font-weight:900;margin-bottom:12px;">' +
          (mac ? 'Dock 에 앱으로 추가' : '홈 화면에 앱으로 추가') + '</div>' +
        '<div style="font-size:15px;font-weight:700;color:#4e5968;line-height:1.7;">' +
          (mac
            ? '1. 주소창 옆 <b>공유 버튼</b>을 누릅니다.<br>2. <b>Dock에 추가</b>를 선택합니다.<br>3. <b>추가</b>를 누르면 앱처럼 실행됩니다.'
            : '1. 화면 아래 <b>공유 버튼</b>을 누릅니다.<br>2. <b>홈 화면에 추가</b>를 선택합니다.<br>3. <b>추가</b>를 누르면 앱처럼 실행됩니다.') +
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

  // 아이폰과 맥 사파리는 beforeinstallprompt 가 없으므로 안내 버튼을 직접 띄운다.
  if (isIos() || isMacSafari()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', makeButton);
    } else {
      makeButton();
    }
  }
})();
