/* 正式站的 LINE 登入。
   ═══════════════════════════════════════════════════════════════
   只有「從 LINE 開啟」而且綁定成功之後才會接後端；其餘情況一律維持
   原本的離線 demo，網站跟以前一模一樣（`?demo=1` 可以強制）。

   ⚠️ 前端**只負責轉交 LINE 給的原始 ID Token**。
   liff.getProfile() 或 getDecodedIDToken() 拿到的 user ID 不可以拿來當登入證明 ——
   那是前端自己解出來的，誰都能偽造。真正的驗證在 GAS 那邊向 LINE 做。

   ⚠️ Token 不進網址、不進 localStorage、不印進 console。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LIFF_ID = '2011543667-p1MX4tl7';
  var GAS_API = 'https://script.google.com/macros/s/AKfycbygTGmjIeJaaMhOWMd2xNL-yL03xdQE60c9b9Ex9sQjKg_vNENvOhZsD_EZdigonoML/exec';
  /* ⚠️ 網域是 **static.line-scdn.net**，不是 static.line-login.jp。
     後者根本不存在（NXDOMAIN），寫錯的話就是「載入 LINE 的程式失敗」，
     而且看起來很像網路問題 —— 上線第一次就踩到。
     liff-test.html 從頭到尾用的都是對的那個，抄它就好。 */
  var SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

  /* ═══ 傳文字到 LINE 對話 ═══════════════════════════════
     使用者 2026-09-13：「可以讓他按一個鈕，就發送文字到 line 對話中？」

     LIFF 有兩條路，能不能用**取決於 LINE Developers 的設定**，所以三段降級：

       1. shareTargetPicker  跳出選擇對象的畫面，使用者自己挑要傳給誰。
                             最通用，但要在 LIFF 設定裡把這個功能打開。
       2. sendMessages       直接送進「開啟這個 LIFF 的那個聊天室」。
                             只有從官方帳號的聊天室點進來才有 context，
                             而且要有 chat_message.write 權限。
       3. 複製到剪貼簿        什麼都不能用時（桌機瀏覽器、demo）至少讓他貼得出去。

     ⚠️ **不要預設第 1、2 條一定能用。** isApiAvailable 會說實話，照著問就好。
     ⚠️ 回傳的 Promise 永遠 resolve，給的是 'share' / 'send' / 'copy' / 'fail'，
        呼叫端據此決定要說什麼 —— 不要讓一顆分享鈕丟出未捕捉的例外。 */
  /* ⚠️ **`liff.isApiAvailable()` 只認得少數幾個名稱**（shareTargetPicker、
     multipleLiffTransition、subwindowOpen、scanCodeV2…）。
     拿 'sendMessages' 去問它會直接丟 `Unexpected API name.` ——
     第一版就是這樣，例外被 try/catch 吞掉，於是永遠判定「不能用」，
     明明 context 是 utou、功能一直都在（2026-09-13 靠 ?diag=1 才抓到）。

     sendMessages 沒有 isApiAvailable 可以問，判斷條件是**文件寫死的**：
     必須在 LINE 裡面（isInClient），而且 context.type 是 utou／room／group。 */
  function hasPicker() {
    try {
      return !!(window.liff && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker'));
    } catch (e) { return false; }
  }

  /* ⚠️ **預設關掉。** sendMessages 只送得進「官方帳號的聊天室」，
     而這個專案的 LIFF 是從一般群組／對話開的（使用者 2026-09-13 確認），
     所以它必定回 INVALID_RECEIVER。留著只會每次先失敗一輪再退回去，
     使用者看到的是「按鈕說傳到 LINE，結果跳複製」——「不確定」比「做不到」更糟。

     什麼時候可以打開：等這個 LINE Login channel 連動了官方帳號（Linked OA），
     而且學員是從那個官方帳號的聊天室點進來的。把這裡改成 true 就會生效。 */
  var USE_SEND_MESSAGES = false;

  function hasSend() {
    if (!USE_SEND_MESSAGES) return false;
    try {
      if (!window.liff || !liff.isInClient || !liff.isInClient()) return false;
      var c = liff.getContext();
      return !!c && ['utou', 'room', 'group'].indexOf(c.type) >= 0;
    } catch (e) { return false; }
  }

  function shareText(text) {
    text = String(text == null ? '' : text).trim();
    if (!text) return Promise.resolve('fail');
    lastError = '';

    var msg = [{ type: 'text', text: text.slice(0, 4900) }];   /* LINE 單則上限 5000 */

    /* 先試選對象（可以傳給任何人），沒有才退回「送進目前這個聊天室」。 */
    try {
      if (hasPicker()) {
        return liff.shareTargetPicker(msg)
          .then(function (res) { return res ? 'share' : 'cancel'; })
          .catch(function () { return sendOrCopy(msg, text); });
      }
      return sendOrCopy(msg, text);
    } catch (e) {}
    return copyText(text);
  }

  /* ⚠️ **被拒絕的理由一定要留下來。**
     第一版直接 .catch(→ copyText)，於是按鈕寫「傳到 LINE」、按下去卻說
     「已複製」，而完全看不出 LINE 為什麼不肯送（2026-09-13 使用者回報）。
     最常見的原因是 **scope 還沒被使用者同意** —— 在 Developers Console
     把 chat_message.write 打開只是「可以要求」，既有的授權不會自動包含它，
     使用者必須重新登入一次才會跳出同意畫面。 */
  var lastError = '';

  function sendOrCopy(msg, text) {
    if (!hasSend()) return sysShare(text);
    try {
      return liff.sendMessages(msg)
        .then(function () { lastError = ''; return 'send'; })
        .catch(function (e) {
          lastError = friendly(e);
          return sysShare(text);
        });
    } catch (e) {
      lastError = friendly(e);
      return sysShare(text);
    }
  }

  /* LINE 的錯誤碼翻成看得懂的話。
     ⚠️ INVALID_RECEIVER 很容易被誤讀成「權限沒開」，其實是收件者不對 ——
     sendMessages 只能送進**官方帳號的聊天室**，從別的對話開就一定是這個錯。 */
  function friendly(e) {
    var code = (e && (e.code || e.message)) || '';
    if (/INVALID_RECEIVER/.test(code)) {
      return '這個對話不是官方帳號的聊天室，LINE 不讓程式往這裡送';
    }
    if (/chat_message\.write|FORBIDDEN|permission/i.test(code)) {
      return '還沒同意「傳送訊息」的權限，登出再登入一次';
    }
    return String(code || '未知');
  }

  /* ── 系統分享（不依賴任何 LINE 設定）────────────────
     shareTargetPicker 要在 Console 開、sendMessages 只能送進官方帳號的聊天室，
     兩條路都有前提。navigator.share 沒有 —— 它會叫出手機自己的分享選單，
     裡面就有 LINE，選了之後可以挑任何對話。
     ⚠️ 必須在使用者的點擊裡直接呼叫，隔一個 await 就會被瀏覽器擋掉；
     這裡是 .catch 接下來的同一個微任務，還算在同一次使用者手勢裡。 */
  function sysShare(text) {
    try {
      if (navigator.share) {
        return navigator.share({ text: text })
          .then(function () { return 'system'; })
          .catch(function (e) {
            /* 使用者自己按取消不算失敗，不要再退一層去複製。 */
            if (e && e.name === 'AbortError') return 'cancel';
            return copyText(text);
          });
      }
    } catch (e) {}
    return copyText(text);
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
          .then(function () { return 'copy'; })
          .catch(function () { return fallbackCopyText(text); });
      }
    } catch (e) {}
    return fallbackCopyText(text);
  }

  /* 舊版 WebView／file:// 預覽可能沒有 Clipboard API；保留一次同步複製的退路。
     這條路仍由使用者按下「儲存紀錄」觸發，不在背景任意碰剪貼簿。 */
  function fallbackCopyText(text) {
    var input;
    try {
      input = document.createElement('textarea');
      input.value = String(text == null ? '' : text);
      input.setAttribute('readonly', '');
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(input);
      input.focus(); input.select();
      var ok = document.execCommand && document.execCommand('copy');
      input.remove();
      return Promise.resolve(ok ? 'copy' : 'fail');
    } catch (e) {
      if (input && input.parentNode) input.parentNode.removeChild(input);
      return Promise.resolve('fail');
    }
  }

  /* 對外。⚠️ 即使沒有 LINE 也要掛上去 —— 呼叫端只要 UC_SHARE 在就能用，
     不必自己判斷現在是不是 LIFF 模式（降級在這裡面處理掉了）。 */
  /* 為什麼「傳到 LINE」不能用？**不要猜，問它。**
     sendMessages 只有在 LIFF **開在聊天室裡**才有（context.type 是
     utou／room／group）。直接開 GitHub Pages 的網址，就算是在 LINE 的
     內建瀏覽器裡，context 也是 external —— 那條路一定不可用。
     真正的入口是 LIFF 網址 https://liff.line.me/<LIFF_ID>。

     網址加 ?diag=1 會在畫面上印出這一整包，截圖就能判斷卡在哪。 */
  function diag() {
    var d = { liffSdk: !!window.liff, liffId: LIFF_ID };
    try {
      d.inClient = liff.isInClient();
      d.loggedIn = liff.isLoggedIn();
      d.os = liff.getOS();
      d.lineVersion = liff.getLineVersion();
      var c = liff.getContext();
      d.contextType = c ? c.type : '(null)';
    } catch (e) { d.error = String(e && e.message || e); }
    /* ⚠️ 這兩項**各自包 try**。第一版全部包在同一個 try 裡，
       結果 isApiAvailable('sendMessages') 一丟例外，後面就全部沒印出來 ——
       而那一項正好是我們要看的（踩過）。 */
    d.shareTargetPicker = hasPicker();
    d.sendMessages = hasSend();
    d.systemShare = !!navigator.share;
    d.sendMessagesEnabled = USE_SEND_MESSAGES;
    d.willUse = window.UC_SHARE ? window.UC_SHARE.how() : '(未初始化)';
    d.lastShareError = lastError || '(無)';
    /* ⚠️ 本機解碼**只拿來顯示剩幾秒**，不能拿來當登入證明 ——
       前端解出來的東西誰都能偽造，真正的驗證在 GAS 那邊向 LINE 做。 */
    try {
      var tk = liff.getIDToken();
      d.idToken = tk ? '有（' + tk.length + ' 字元）' : '沒有';
      var exp = tk && JSON.parse(atob(tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
      if (exp) {
        var left = Math.round(exp - Date.now() / 1000);
        d.idTokenExpiresIn = left + ' 秒' + (left <= 0 ? '　⚠️ 已過期' : '');
      }
    } catch (e) { d.idToken = '讀不到（' + String(e && e.message || e) + '）'; }
    return d;
  }

  function showDiag() {
    var d = diag();
    var rows = Object.keys(d).map(function (k) {
      return '<tr><td>' + esc(k) + '</td><td>' + esc(String(d[k])) + '</td></tr>';
    }).join('');
    ui('<p class="ey">Diagnostics</p><h2>分享功能診斷</h2>'
      + '<table class="diagt">' + rows + '</table>'
      + '<button type="button" class="btn" id="diagClose">關掉</button>');
    /* ⚠️ 自己接關閉，**不要用 data-gate** —— 那個委派監聽在下面的
       early return 之後才註冊，走診斷這條路的話根本沒跑到。 */
    var c = document.getElementById('diagClose');
    if (c) c.addEventListener('click', done);
  }

  window.UC_SHARE = {
    text: shareText,
    copy: copyText,
    diag: diag,
    /* 這一台裝置到底能不能真的送進 LINE。前端用它決定按鈕要寫「傳到 LINE」還是「複製」。 */
    canSend: function () { return hasPicker() || hasSend() || !!navigator.share; },
    /* 按鈕要照**實際會走的那條路**命名，不要一律寫「傳到 LINE」然後跳複製。 */
    how: function () {
      if (hasPicker()) return 'picker';
      if (hasSend()) return 'send';
      if (navigator.share) return 'system';
      return 'copy';
    },
    /* 上一次為什麼沒能送出去。空字串代表沒問題。 */
    lastError: function () { return lastError; }
  };

  /* ⚠️ UC_SHARE 要在下面那幾個 early return **之前**掛好。
     demo 與 #selftest 不走 LINE 登入，但分享按鈕仍然存在（會降級成複製）——
     掛在後面的話那兩種情況下 UC_SHARE 是 undefined，按鈕直接爆掉。 */

  var q = location.search;
  /* ?diag=1：LIFF 初始化完就把診斷印出來，不進登入流程。 */
  if (/[?&]diag=1/.test(q)) {
    sdkReady()
      .then(initReady)
      .then(showDiag)
      .catch(function (e) { fatal('診斷失敗', (e && e.message) || ''); });
    return;
  }

  if (/[?&]demo=1/.test(q)) {                    /* 明講要 demo 就不要碰 LINE */
    document.documentElement.dataset.ucBoot = 'demo';
    return;
  }
  /* ⚠️ 自我檢查與文字稽核**不可以觸發登入**。
     `#selftest` 會把整個 body 換掉，而 liff.login() 會直接把頁面導去 LINE ——
     結果是打不開自我檢查（踩過）。 */
  if (location.hash === '#selftest' || /[?&]audit=1/.test(q)) return;

  /* ⚠️ **首頁那個名字輸入框在這一刻就要藏起來。**
     app.js 是同步跑的，它會先把首頁畫出來（含名字欄），boot.js 才開始問 LINE ——
     中間那一瞬間使用者會看到「請輸入你的名字」，而正式流程根本不需要它。
     用 html 的屬性控制，CSS 那邊一條規則就藏得掉，不必等 JS。 */
  document.documentElement.dataset.ucBoot = 'line';
  document.documentElement.dataset.ucLineState = 'ready';

  /* 登入期間一律留在歡迎頁，避免網址若帶著舊 hash 時先閃出本機 demo 資料。
     原本要求的頁面先記下來，驗證完成後再判斷能不能回去。 */
  var requestedRoute = location.hash || '#/';
  if (requestedRoute !== '#/') {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (window.UC_APP && window.UC_APP.render) window.UC_APP.render();
  }

  var box = null, idToken = '';

  /* 端點先給 —— auth.exchange／auth.bind 在 connect 之前就要打得出去。
     這時候還不算「已接上」，save() 照舊寫 localStorage。 */
  window.UC_STORE.endpoint(GAS_API);

  function ui(html) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'gate';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      document.body.appendChild(box);
    }
    box.innerHTML = '<div class="gatebox">' + html + '</div>';
    box.classList.add('on');
  }
  function done() { if (box) { box.classList.remove('on'); box.innerHTML = ''; } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fatal(msg, hint) {
    clearWaiting();
    document.documentElement.dataset.ucLineState = 'error';
    ui('<p class="ey">Sign-in</p><h2>' + esc(msg) + '</h2>'
      + '<p>' + esc(hint || '') + '</p>'
      + '<button type="button" class="btn" data-gate="retry">再試一次</button>'
      + '<button type="button" class="btn ghost" data-gate="demo">先看 demo</button>');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-gate]');
    if (!b) return;
    if (b.dataset.gate === 'retry') { location.reload(); return; }
    if (b.dataset.gate === 'demo') {
      /* 退回 demo：名字欄要放行，那條路本來就需要它。 */
      document.documentElement.dataset.ucBoot = 'demo';
      document.documentElement.dataset.ucLineState = 'ready';
      done();
      if (window.UC_APP && window.UC_APP.render) window.UC_APP.render();
      return;
    }
    if (b.dataset.gate === 'bind') bind();
  });

  /* index.html 已在 head 先下載 SDK；這裡只等它完成。
     保留動態建立作為舊版 HTML 沒有預載標籤時的相容退路。 */
  function sdkReady() {
    if (window.liff) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.getElementById('uc-liff-sdk');
      if (s && s.dataset.failed === '1') {
        rej(new Error('載入 LINE 的程式失敗'));
        return;
      }
      if (!s) {
        s = document.createElement('script');
        s.id = 'uc-liff-sdk'; s.src = SDK; s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', res, { once: true });
      s.addEventListener('error', function () {
        rej(new Error('載入 LINE 的程式失敗'));
      }, { once: true });
    });
  }

  function initReady() {
    if (window.UC_START_LIFF) {
      return window.UC_START_LIFF().then(function () {
        var state = window.UC_LIFF_INIT_STATE;
        if (state && state.error) throw state.error;
      });
    }
    return liff.init({ liffId: LIFF_ID });
  }

  /* ⚠️ **卡住的時候一定要看得出卡在哪一關。**
     第一版只寫「現在沒辦法登入」，結果什麼線索都沒有 ——
     「LINE 的程式沒載到」跟「後端拒絕」長得一模一樣（踩過）。
     step 會隨著流程往前推，出錯時直接顯示。 */
  var step = 'SDK', started = false, initError = null;
  var slowTimer = null, retryTimer = null;
  var PENDING_KEY = 'uc_line_pending_v1';

  function storageGet(store, key) {
    try { return store.getItem(key) === '1'; } catch (e) { return false; }
  }
  function storageSet(store, key) {
    try { store.setItem(key, '1'); } catch (e) {}
  }
  function storageClear(store, key) {
    try { store.removeItem(key); } catch (e) {}
  }

  function lineStage(stageName, routeText) {
    var names = ['login', 'sync', 'route'];
    var ids = ['lineStepLogin', 'lineStepSync', 'lineStepRoute'];
    var active = stageName === 'done' ? names.length : names.indexOf(stageName);
    document.documentElement.dataset.ucLineStep = stageName;
    ids.forEach(function (id, i) {
      var n = document.getElementById(id);
      if (!n) return;
      n.classList.toggle('is-done', i < active || stageName === 'done');
      n.classList.toggle('is-active', i === active && stageName !== 'done');
      if (i === active && stageName !== 'done') n.setAttribute('aria-current', 'step');
      else n.removeAttribute('aria-current');
    });
    if (routeText) {
      var route = document.querySelector('#lineStepRoute span');
      if (route) route.textContent = routeText;
    }
  }

  function clearWaiting() {
    clearTimeout(slowTimer); clearTimeout(retryTimer);
    slowTimer = retryTimer = null;
    var slow = document.getElementById('lineSlow');
    var retry = document.getElementById('lineRetry');
    if (slow) slow.hidden = true;
    if (retry) retry.hidden = true;
  }

  function startWaiting(stageName) {
    clearWaiting();
    document.documentElement.dataset.ucLineState = 'loading';
    lineStage(stageName || 'login');
    slowTimer = setTimeout(function () {
      var n = document.getElementById('lineSlow');
      if (n) n.hidden = false;
    }, 6000);
    retryTimer = setTimeout(function () {
      var n = document.getElementById('lineRetry');
      if (n) n.hidden = false;
    }, 12000);
  }

  function routeLabel(hash) {
    if (hash === '#/students') return '準備學員清單';
    if (hash === '#/assess') return '準備情感能力評測';
    if (hash === '#/report') return '準備評測報告';
    if (hash === '#/okr') return '回到課程藍圖';
    return '回到上次的位置';
  }

  function completeLogin() {
    var destination = window.UC_APP && window.UC_APP.entryRoute
      ? window.UC_APP.entryRoute(requestedRoute) : '#/okr';
    lineStage('route', routeLabel(destination));
    storageClear(sessionStorage, PENDING_KEY);
    setTimeout(function () {
      lineStage('done');
      clearWaiting();
      if (window.UC_APP && window.UC_APP.nav) window.UC_APP.nav(destination);
      /* ⚠️ 從 LINE 開 liff.line.me/...?perf=1 時，網址有機會先變成
         `?liff.state=%3Fperf%3D1`。SDK 通常會在 init 之後還原，
         但解碼後再比對一次比較保險，兩種寫法都認得。 */
      if (/[?&]perf=1/.test(decodeURIComponent(location.search))) {
        setTimeout(function () {
          try { showPerf(); } catch (e) { console.warn('perf 面板失敗', e); }
        }, 0);
      }
    }, window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
  }

  /* SDK 下載與 init 從頁面出現就先跑；第一次使用者仍保有明確的「進入」動作。 */
  var initPromise = sdkReady()
    .then(function () { step = 'INIT'; return initReady(); })
    .catch(function (e) { initError = e; });

  /* ── 先跑，不要等按鈕 ──────────────────────────────
     使用者 2026-09-17：「從按登入按鈕前就在跑登入資訊了，體感上就會更短。」

     auth.exchange 要 5 秒上下（平台地板約 2.1 秒改不掉），而使用者按下按鈕之前
     還要讀首頁、找到按鈕、抬手 —— 那幾秒本來就是空的，拿來跑剛好。

     ⚠️ **只有已經登入才能先跑。** 沒登入的話下一步是 liff.login()，
     那會把整頁導去 LINE —— 絕對不可以在使用者沒有動作的時候做。
     所以未登入就什麼都不做，等按鈕。

     ⚠️ 這支要**冪等**：按鈕、自動回訪、重試都可能叫到它，只能真的跑一次。 */
  var warmPromise = null;

  function warmup() {
    if (warmPromise) return warmPromise;
    warmPromise = initPromise.then(function () {
      if (initError) throw initError;
      step = 'LOGIN';
      if (!liff.isLoggedIn()) return { needsLogin: true };
      step = 'TOKEN';
      idToken = liff.getIDToken();
      window.UC_STORE.token(idToken);          /* 之後每個請求都用它 */
      clearRetried();                          /* 這次拿到了，下次過期還能再救一次 */
      if (!idToken) {
        throw new Error('LINE 沒有給 ID Token —— LIFF 的 scope 要開 openid。');
      }
      /* ⚠️ ID Token 大約一小時就過期，但 isLoggedIn() 還是 true。
         過期的話 auth.exchange 一定被後端退回 —— 那趟來回是純浪費，
         而且失敗後才重新登入，使用者會在莫名其妙的時間點看到頁面重整。
         先在本機看 exp，過期就直接回旗標，等按下去再一次導頁。 */
      if (tokenExpired()) return { needsLogin: true, expired: true };
      /* 頭像只用來讓使用者確認「現在是哪個 LINE 帳號」，不參與認證。
         讀不到 profile 不應該卡住登入；後端驗證 ID Token 才是權限依據。 */
      try {
        liff.getProfile().then(function (profile) {
          if (window.UC_APP && window.UC_APP.setIdentity) {
            window.UC_APP.setIdentity({
              displayName: profile && profile.displayName || '',
              pictureUrl: profile && profile.pictureUrl || ''
            });
          }
        }).catch(function () {});
      } catch (e) {}
      step = 'EXCHANGE';
      return window.UC_STORE.call({ action: 'auth.exchange', idToken: idToken });
    });
    return warmPromise;
  }

  function beginLogin() {
    if (started) return;
    started = true;
    startWaiting('login');
    warmup()
      .then(function (data) {
        /* 沒登入才走這條 —— 導頁一定要在使用者按下之後。 */
        if (data && data.needsLogin) {
          storageSet(sessionStorage, PENDING_KEY);
          /* 過期的憑證要先登出，不然 LINE 會把同一張舊的再發回來。 */
          if (data.expired && !retried()) {
            markRetried();
            try { liff.logout(); } catch (e) {}
          }
          liff.login({ redirectUri: location.href });
          return null;
        }
        lineStage('sync');
        return data;
      })
      .then(function (data) {
        if (!data) return;
        if (data.bound) return enter(data.studentId, data.accessScope, data.payload, data.students);
        askCode();
      })
      .catch(function (err) {
        /* ID Token 過期時自動重新登入一次；sessionStorage 防止無限迴圈。 */
        if (step === 'EXCHANGE' && err && err.code === 'UNAUTHENTICATED' && !retried()) {
          markRetried();
          storageSet(sessionStorage, PENDING_KEY);
          try { if (liff.isLoggedIn()) liff.logout(); } catch (e) {}
          try { liff.login({ redirectUri: location.href }); return; } catch (e) {}
        }
        fatal('現在沒辦法登入', explain(step, err));
      });
  }

  var enterButton = document.getElementById('lineEnterBtn');
  var retryButton = document.getElementById('lineRetry');
  if (enterButton) enterButton.addEventListener('click', beginLogin);
  if (retryButton) retryButton.addEventListener('click', function () { location.reload(); });

  /* ⚠️ 只有「剛從 LINE 授權頁導回來」才自動接續 —— 那一下使用者已經按過了。
     用過的裝置**不再自動進去**：使用者 2026-09-17 要的就是「先看到按鈕再按」。
     自動進去的話，畫面會卡在載入中乾等整趟 auth.exchange；
     留著按鈕，那幾秒會跟「讀畫面、抬手按下去」重疊，按下時多半已經跑完了。 */
  if (storageGet(sessionStorage, PENDING_KEY)) {
    setTimeout(beginLogin, 0);
  } else {
    /* 第一次進來（還沒按按鈕）也先把 auth.exchange 跑掉。
       ⚠️ warmup 在未登入時只會回 { needsLogin: true }，不會導頁。
       失敗先收著 —— 使用者按下去時 beginLogin 會接到同一個 promise 的錯誤，
       那裡才有完整的錯誤畫面。這裡不接的話是未捕捉的 rejection。 */
    setTimeout(function () { warmup().catch(function () {}); }, 0);
  }

  /* 只看有沒有過期，不拿裡面的任何欄位當身分 ——
     解出來的內容沒有驗過簽章，身分一律以後端驗證的結果為準。 */
  function tokenExpired() {
    try {
      var d = liff.getDecodedIDToken();
      if (!d || !d.exp) return false;          /* 讀不到就照舊送出去讓後端判斷 */
      return (d.exp * 1000) - Date.now() < 30000;   /* 30 秒內到期也算過期 */
    } catch (e) { return false; }
  }

  var RETRY_KEY = 'uc_liff_retry';
  function retried() {
    try { return sessionStorage.getItem(RETRY_KEY) === '1'; } catch (e) { return false; }
  }
  function markRetried() {
    try { sessionStorage.setItem(RETRY_KEY, '1'); } catch (e) {}
  }
  function clearRetried() {
    try { sessionStorage.removeItem(RETRY_KEY); } catch (e) {}
  }

  /* 把錯誤翻成「卡在哪一關、下一步做什麼」。
     ⚠️ 不要把 Token 原文或伺服器細節印出來。 */
  function explain(step, err) {
    var raw = (err && (err.message || err.code)) || '';
    var where = {
      SDK: '載不到 LINE 的程式。網路不通，或這個環境擋掉了 LINE 的網域。',
      INIT: 'LIFF 初始化失敗。最常見的原因是 LINE Developers 上的 '
          + 'Endpoint URL 還指著別的網址 —— 要跟現在這一頁同一個路徑底下。',
      LOGIN: '導去 LINE 登入的時候出錯。',
      TOKEN: '拿不到 LINE 的登入憑證。',
      EXCHANGE: '後端拒絕了這次登入。如果寫「ID Token 未通過驗證」，'
              + '多半是憑證過期了 —— 重新整理一次通常就好。',
      LOAD: '登入已完成，但課程資料沒有載入。請確認網路後重新連線。'
    }[step] || '';
    return '［' + step + '］' + where + (raw ? '（' + raw + '）' : '');
  }

  function askCode() {
    clearWaiting();
    ui('<p class="ey">First time</p><h2>綁定你的學員資料</h2>'
      + '<p>這個 LINE 帳號將與你的雲端教練學員資料綁定，之後從 LINE 開啟就會自動登入。</p>'
      + '<input id="gateCode" type="text" inputmode="latin" autocapitalize="characters"'
      + ' maxlength="8" placeholder="教練給的 8 碼啟用碼" aria-label="啟用碼">'
      + '<p class="gateerr" id="gateErr"></p>'
      + '<button type="button" class="btn pri" data-gate="bind">綁定</button>');
    var i = document.getElementById('gateCode');
    if (i) i.focus();
  }

  function bind() {
    var i = document.getElementById('gateCode');
    var err = document.getElementById('gateErr');
    var code = (i && i.value || '').trim().toUpperCase();
    if (!code) { if (err) err.textContent = '請輸入啟用碼。'; return; }
    if (err) err.textContent = '綁定中…';
    done();
    startWaiting('sync');
    window.UC_STORE.call({ action: 'auth.bind', idToken: idToken, activationCode: code })
      .then(function (data) { return enter(data.studentId, data.accessScope); })
      .catch(function (e) {
        if (step === 'LOAD') {
          fatal('載入資料失敗', (e && e.message) || '請重新連線。');
          return;
        }
        askCode();
        var nextErr = document.getElementById('gateErr');
        if (nextErr) nextErr.textContent = e.code === 'UNAUTHENTICATED'
          ? '啟用碼不正確，或已經用過、過期了。跟教練要一組新的。'
          : (e.message || '綁定失敗，請再試一次。');
      });
  }

  /* ?perf=1：登入完成後把每一次 GAS 呼叫的耗時攤開來看。
     ⚠️ 做成畫面上的面板，不要只 console.log —— 手機上看不到 console，
     而慢的問題偏偏只在手機上明顯（2026-09-13 踩到，靠執行紀錄查不動）。 */
  function showPerf() {
    var rows = (window.UC_STORE.perf() || []).map(function (p) {
      var net = p.server != null ? (p.total - p.server) : null;
      return '<tr><td>' + esc(p.action) + '</td>'
        + '<td>' + p.total + ' ms</td>'
        + '<td>' + (p.server != null ? p.server + ' ms' : '—') + '</td>'
        + '<td>' + (net != null ? net + ' ms' : '—') + '</td></tr>'
        + (p.laps && p.laps.length
          ? '<tr><td colspan="4" class="perflaps">' + esc(p.laps.join('　・　')) + '</td></tr>' : '');
    }).join('');
    ui('<p class="ey">Performance</p><h2>這次的時間分佈</h2>'
      + '<table class="diagt perft"><tr><th>動作</th><th>總計</th><th>腳本內</th><th>平台＋網路</th></tr>'
      + (rows || '<tr><td colspan="4">還沒有呼叫紀錄</td></tr>') + '</table>'
      + '<p>「腳本內」是 GAS 自己跑的時間，那是我改得動的部分；'
      + '「平台＋網路」是啟動、302 重導與連線，那是地板。</p>'
      + '<p class="perfhint">關掉之後照常使用，之後每一次呼叫都會記下來；'
      + '想再看就按右下角的 ⏱。</p>'
      + '<button type="button" class="btn" id="perfClose">關掉</button>');
    var c = document.getElementById('perfClose');
    if (c) c.addEventListener('click', function () { done(); perfTab(); });
  }

  /* ⚠️ 面板原本是**登入那一刻的快照**，關掉就沒了。
     但慢的地方不一定在登入 —— 教練點「學員」是登入之後才發生的事，
     那一筆永遠進不了面板（2026-09-18 使用者反映「沒辦法這樣點」）。
     所以關掉之後留一顆小按鈕，隨時可以把最新的分佈叫回來。 */
  var perfBtn = null;
  function perfTab() {
    if (perfBtn) { perfBtn.hidden = false; return; }
    perfBtn = document.createElement('button');
    perfBtn.type = 'button';
    perfBtn.className = 'perftab';
    perfBtn.title = '看時間分佈';
    perfBtn.textContent = '⏱';
    perfBtn.addEventListener('click', function () {
      perfBtn.hidden = true;
      showPerf();
    });
    document.body.appendChild(perfBtn);
  }

  function enter(studentId, scope, payload, students) {
    step = 'LOAD';
    lineStage('sync');
    /* ⚠️ **身分要在 connect() 之前設。** connect 載完會立刻重畫，
       而「教練先看清單、學員直接進自己的頁」是靠 ACTOR_ROLE 判斷的 ——
       設晚了教練會先被丟到評測頁（踩過）。
       accessScope 在 auth.exchange 就拿得到，不必等 student.load。
       真正的權限仍在後端，前端改這個值讀不到別人的資料。 */
    if (window.UC_APP && window.UC_APP.setRole) {
      window.UC_APP.setRole(scope === 'manage' ? 'coach' : 'student');
    }
    /* payload 是 auth.exchange 順手帶回來的整包 —— 有的話就不用再打一次
       student.load（每次 GAS 往返實測 1.5～2.5 秒）。
       ⚠️ 後端組 payload 失敗時不會帶這個欄位，connect 會自動退回去自己打。 */
    return window.UC_STORE.connect({ api: GAS_API, idToken: idToken,
                                     studentId: studentId, payload: payload,
                                     /* 教練的清單跟著登入一起回來了，省一趟往返。 */
                                     students: students, accessScope: scope, render: false })
      .then(function () {
        done();
        completeLogin();
      });
  }
})();
