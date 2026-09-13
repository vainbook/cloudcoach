/* UC_STORE —— 資料的唯一出口。
   ═══════════════════════════════════════════════════════════════
   app.js 管畫面，這裡管「這一筆存哪裡、什麼時候存、失敗怎麼辦」。

   ── 為什麼不去改 app.js 那 21 個寫入點 ──────────────
   那 21 個地方每一個都會呼叫 save()，所以只要接住 save() 就等於接住全部。
   逐點改寫的代價是：漏掉一個就是某個欄位悄悄不存了（無聲），
   而且教練報告那邊用的是 `var cr = S.coachReport` 的閉包別名，
   任何靠攔截 S 屬性的做法都抓不到它。比對整份 S 的差異沒有這兩個問題。
   比對成本：50 幾題 ＋ 十幾個欄位，一次幾百個 key，比一次 JSON.stringify 還便宜。

   ── 兩種模式 ─────────────────────────────────────
   local （預設）  跟以前完全一樣：整份寫進 localStorage，不碰網路。
                   「載入範例學員」永遠走這條。
   remote          從 LINE 進來、而且綁定成功之後才會切過去。
                   ⚠️ remote 模式**不寫 localStorage** —— LINE 要求把使用者
                   資料寫進瀏覽器儲存前必須先取得同意，第一版直接不寫最省事。
                   離線時未送出的 patch 留在記憶體佇列裡，連上就補送。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DEBOUNCE = 600;          /* 打字停手多久才真的送。BACKEND-WORKFLOW.md §4 訂的 */
  /* 連兩次失敗就出聲。設 4 的話要等 14 秒才有反應 —— 使用者早就以為存好了（實測）。 */
  var MAX_RETRY = 2;

  var APP = null;
  var api = '';                /* GAS 的 /exec。空的就是 local 模式 */
  var idToken = '';
  var studentId = '';
  var snap = null;             /* 上一次已知的狀態，用來比對差異 */
  var queue = [];              /* 還沒送出去的 patch */
  var pending = {};            /* key → 佇列裡那一筆，同一格只留最新的 */
  var timer = null;
  var sending = false;
  var failed = 0;

  /* ⚠️ 「有端點」不等於「已經接上」。綁定畫面還開著的時候 api 已經設好了，
     但還沒有 studentId —— 這時候 save() 必須照舊寫 localStorage，
     否則使用者在綁定前的操作會直接蒸發。 */
  function isRemote() { return !!api && !!studentId; }

  /* ── S 的哪一格對到後端的哪一格 ────────────────────
     item_id 全部是穩定 ID（question_id / kr_id / 維度 key），
     不是顯示文字 —— 改文案不會影響資料。 */

  function flatten(S) {
    var out = {};
    var Q = window.UC_SCORE ? window.UC_SCORE.questions : [];
    var byId = {};
    Q.forEach(function (q) { byId[q.id] = q; });

    Object.keys(S.answers || {}).forEach(function (qid) {
      out['assessment|' + qid + '|answer'] = {
        scope: 'assessment', itemId: qid, field: 'answer',
        label: (byId[qid] && (byId[qid].name || byId[qid].q)) || qid,
        value: S.answers[qid],
        display: answerText(byId[qid], S.answers[qid])
      };
    });

    var cr = S.coachReport || {};
    var D = window.UC_DIMENSIONS ? window.UC_DIMENSIONS.dims : [];
    D.forEach(function (d) {
      push('adjust.' + d.k, d.label + '／教練加減', num(cr.adjust && cr.adjust[d.k]));
      push('score.' + d.k, d.label + '／分數', num(cr.scores && cr.scores[d.k]));
      push('note.' + d.k, d.label + '／說明', str(cr.notes && cr.notes[d.k]));
    });
    push('letter', '寫給學員的一封信', str(cr.letter));
    push('complete', '報告完成', cr.complete === true);

    function push(field, label, value) {
      out['report|report|' + field] = { scope: 'report', itemId: 'report',
                                        field: field, label: label, value: value };
    }

    /* 任務狀態。taskNow 的 key 是維度，其餘三個的 key 是 kr_id。 */
    Object.keys(S.taskNow || {}).forEach(function (dim) {
      add('task', dim, 'current', dim + '／當前任務', S.taskNow[dim]);
    });
    Object.keys(S.done || {}).forEach(function (kr) {
      add('task', kr, 'done', kr + '／完成', !!S.done[kr]);
    });
    Object.keys(S.hidden || {}).forEach(function (kr) {
      add('task', kr, 'hidden', kr + '／隱藏', !!S.hidden[kr]);
    });
    /* 書本狀態：使用者說暫時不用但不刪，所以照樣同步 —— 之後要拿回來資料才在。 */
    (S.picked || []).forEach(function (kr) {
      add('task', kr, 'picked', kr + '／加入書本', true);
    });
    Object.keys(S.key || {}).forEach(function (kr) {
      add('task', kr, 'key', kr + '／書本重點', !!S.key[kr]);
    });

    function add(scope, itemId, field, label, value) {
      out[scope + '|' + itemId + '|' + field] =
        { scope: scope, itemId: itemId, field: field, label: label, value: value };
    }

    /* 成長紀錄：一筆事件送一整個物件，不是拆成欄位 ——
       ⚠️ remote 模式不寫 localStorage，這裡不同步的話
       在 LINE 裡記的東西重新整理就沒了。 */
    (S.log || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      out['growth|' + ev.id + '|event'] = {
        scope: 'growth', itemId: String(ev.id), field: 'event',
        label: String(ev.t || '').slice(0, 60),
        display: String(ev.outcome || ev.t || '').slice(0, 200),
        value: ev
      };
    });
    return out;
  }

  /* 試算表上要看得懂。階梯題存的是選項索引，光看數字沒有意義 ——
     把那一級的敘述一起帶上去（只給人看，後端任何判斷都讀 value）。 */
  function answerText(q, v) {
    if (v == null || v === '') return '';
    if (q && q.ladder && q.o && typeof v === 'number' && q.o[v]) return q.o[v].t;
    if (Object.prototype.toString.call(v) === '[object Array]') return v.join('、');
    return String(v);
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ── 對外：每次 save() 都會進來 ──────────────────── */

  function push(S) {
    if (!isRemote()) return;
    var now = flatten(S);
    if (!snap) { snap = now; return; }           /* 第一次只記基準，不送 */

    Object.keys(now).forEach(function (k) {
      if (snap[k] && same(snap[k].value, now[k].value)) return;
      enqueue(now[k]);
    });
    /* 被刪掉的格子（例如取消加入書本）要送一筆 false／null 過去，
       不然後端會停在舊值，重新載入之後那一條又活過來。 */
    Object.keys(snap).forEach(function (k) {
      if (now[k]) return;
      var old = snap[k];
      enqueue({ scope: old.scope, itemId: old.itemId, field: old.field,
                label: old.label, value: typeof old.value === 'boolean' ? false : null });
    });
    snap = now;
    schedule();
  }

  function enqueue(p) {
    var k = p.scope + '|' + p.itemId + '|' + p.field;
    /* 同一格連打只留最新的 —— 打字時不要每按一鍵排一筆。 */
    if (pending[k]) {
      pending[k].value = p.value; pending[k].label = p.label; pending[k].display = p.display;
      return;
    }
    p.key = k;
    p.requestId = k + '#' + Date.now();          /* 重送時同一筆，後端不會多長一列 */
    pending[k] = p;
    queue.push(p);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE);
  }

  /* ⚠️ 「報告完成」一定要排在說明與信的後面 ——
     後端會檢查那些欄位在不在表裡，先送 complete 一定被打回 INVALID_INPUT。 */
  function nextPatch() {
    for (var i = 0; i < queue.length; i++) {
      if (!(queue[i].scope === 'report' && queue[i].field === 'complete')) return i;
    }
    return queue.length ? 0 : -1;
  }

  function run() {
    if (sending || !queue.length || !isRemote()) return;
    var i = nextPatch();
    if (i < 0) return;
    var p = queue[i];
    sending = true;

    call({ action: 'state.save', scope: p.scope, itemId: p.itemId, field: p.field,
           label: p.label, display: p.display || '', value: p.value, requestId: p.requestId })
      .then(function () {
        queue.splice(i, 1); delete pending[p.key];
        sending = false; failed = 0;
        if (queue.length) run();
      })
      .catch(function (err) {
        sending = false;
        failed++;
        /* 資料本身不合法就別再重試了 —— 重試一百次還是一樣的結果。 */
        if (err && err.code === 'INVALID_INPUT') {
          queue.splice(i, 1); delete pending[p.key];
          say('有一個欄位沒能存檔：' + (err.message || '內容不正確'));
          if (queue.length) run();
          return;
        }
        if (failed >= MAX_RETRY) {
          /* ⚠️ **不可以靜靜失敗。** 舊的 save() 是空 catch，
             存瀏覽器失敗無所謂，網路寫入失敗沒聲音就是資料不見了。 */
          say('目前連不上伺服器，還有 ' + queue.length + ' 筆沒存。會自動重試。');
          failed = 0;
        }
        setTimeout(run, Math.min(30000, 1000 * Math.pow(2, failed)));
      });
  }

  /** 離開頁面前把剩下的送完。keepalive 讓請求在分頁關掉之後仍然送得出去。 */
  function flush() {
    clearTimeout(timer);
    if (!isRemote() || !queue.length) return;
    queue.forEach(function (p) {
      try {
        fetch(api, {
          method: 'POST', keepalive: true, mode: 'cors', redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'state.save', idToken: idToken,
                                 studentId: studentId, scope: p.scope, itemId: p.itemId,
                                 field: p.field, label: p.label, display: p.display || '',
                                 value: p.value, requestId: p.requestId })
        });
      } catch (e) {}
    });
  }

  /* ── 跟 GAS 說話 ──────────────────────────────────
     ⚠️ Content-Type 必須是 text/plain —— 用 application/json 會觸發 preflight，
     而 GAS 設不了回應標頭，OPTIONS 一定失敗。
     ⚠️ redirect 要 follow —— GAS 會 302 到 googleusercontent。 */
  /* 每次呼叫的耗時紀錄。⚠️ 存在記憶體就好，不要寫進任何儲存空間 ——
     這是除錯資料，不是使用者資料。 */
  var perf = [];

  function call(payload) {
    var t0 = Date.now();
    /* ⚠️ **不要覆蓋呼叫端已經給的 Token。**
       第一版寫死 `payload.idToken = idToken`，而 store.js 自己的 idToken
       要到 connect() 才有值 —— 結果 auth.exchange／auth.bind（都在 connect 之前）
       送出去的 Token 一律是空字串，後端回「沒有帶 idToken」。
       本機測不出來，因為當時的假 fetch 只檢查 action，沒檢查 Token 在不在（踩過）。 */
    if (!payload.idToken) payload.idToken = idToken;
    if (studentId && !payload.studentId) payload.studentId = studentId;
    return fetch(api + (api.indexOf('?') < 0 ? '?' : '&') + '_ts=' + Date.now(), {
      method: 'POST', mode: 'cors', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        var p = j && j.data && j.data._perf;
        /* 前端量到的總時間減掉伺服器回報的腳本時間 = 平台啟動 ＋ 302 ＋ 網路。
           那三樣我們改不動，但要知道它佔多少，才不會去改錯地方。 */
        perf.push({ action: payload.action, total: Date.now() - t0,
                    server: p ? p.ms : null, laps: p ? p.laps : [] });
        if (perf.length > 40) perf.shift();
        if (j && j.ok) return j.data;
        var e = new Error((j && j.error && j.error.message) || '伺服器錯誤');
        e.code = (j && j.error && j.error.code) || 'INTERNAL_ERROR';
        throw e;
      });
  }

  function say(msg) {
    if (APP && APP.toast) APP.toast(msg);
    else console.warn('[UC_STORE] ' + msg);
  }

  /* ── 啟動 ─────────────────────────────────────────
     由 boot.js（LIFF）在驗證完成之後呼叫。沒有人呼叫就永遠是 local 模式，
     網站跟以前一模一樣。 */
  function connect(opts) {
    api = opts.api || '';
    idToken = opts.idToken || '';
    studentId = opts.studentId || '';
    snap = null;
    /* 已經有整包了就不要再打一次 —— 那是這次最佳化的重點。 */
    return opts.payload ? hydrate(opts.payload, opts.render !== false) : load_(opts.render !== false);
  }

  var demoId = '';

  function load_(shouldRender) {
    return call({ action: 'student.load' }).then(function (data) {
      return hydrate(data, shouldRender !== false);
    });
  }

  /* ⚠️ 把「拿資料」與「吃資料」分開。
     auth.exchange 現在會順手把整包帶回來（省掉一次 GAS 往返，實測每次 1.5～2.5 秒），
     那條路已經有資料了，不該再打一次網路。 */
  function hydrate(data, shouldRender) {
    return Promise.resolve().then(function () {
      studentId = data.studentId || studentId;
      if (data.demoStudentId) demoId = data.demoStudentId;
      var S = {
        name: data.studentName || data.lineDisplayName || '',
        answers: data.answers || {},
        coachReport: unpackReport(data.report || {}),
        picked: [], key: {}, taskNow: {}, hidden: {}, done: {},
        log: Array.isArray(data.log) ? data.log : []
      };
      unpackTasks(data.tasks || {}, S);
      if (data.blueprint && data.blueprint.length) applyBlueprint(data.blueprint);
      if (APP) APP.replaceState(S, shouldRender !== false);
      /* ⚠️ 基準要取「app 實際拿到的那一份」，不是這裡組出來的那一份 ——
         replaceState 會再過一次形狀檢查（補空欄位、正規化教練報告），
         拿組出來的那份當基準會讓第一次 save() 把整份資料重送一遍。 */
      snap = flatten(APP ? APP.S() : S);
      return data;
    });
  }

  function unpackReport(flat) {
    var cr = { adjust: {}, scores: {}, notes: {}, letter: '', complete: false };
    Object.keys(flat).forEach(function (f) {
      var v = flat[f];
      if (f === 'letter') cr.letter = typeof v === 'string' ? v : '';
      else if (f === 'complete') cr.complete = v === true;
      else {
        var parts = f.split('.');
        if (parts[0] === 'adjust') cr.adjust[parts[1]] = Number(v) || 0;
        else if (parts[0] === 'score') cr.scores[parts[1]] = Number(v) || 0;
        else if (parts[0] === 'note') cr.notes[parts[1]] = typeof v === 'string' ? v : '';
      }
    });
    return cr;
  }

  function unpackTasks(tasks, S) {
    Object.keys(tasks).forEach(function (item) {
      var f = tasks[item];
      if (f.current) S.taskNow[item] = f.current;
      if (f.done === true) S.done[item] = 1;
      if (f.hidden === true) S.hidden[item] = 1;
      if (f.picked === true) S.picked.push(item);
      if (f.key === true) S.key[item] = 1;
    });
  }

  /* 藍圖以試算表為準。只覆蓋你在表上會編輯的那幾欄，
     ⚠️ **id 與 dim 不動** —— dim 是用中文能力名反查的，查不到就保留原本的，
     不然打錯一個字整條 KR 會從雷達上消失。 */
  function applyBlueprint(rows) {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS;
    if (!O || !D) return;
    var byLabel = {};
    D.dims.forEach(function (d) { byLabel[d.label] = d.k; });
    var byId = {};
    O.items.forEach(function (it) { byId[it.id] = it; });

    var next = [];
    rows.forEach(function (r) {
      var it = byId[r.id];
      if (!it) return;                       /* 表上多出來的 id 先不處理 */
      it.sub = r.sub || it.sub;
      it.kr = r.kr || it.kr;
      it.tool = r.tool || it.tool;
      it.sheet = r.sheet || it.sheet;
      if (r.short) it.short = r.short;
      if (r.note) it.note = r.note;
      if (r.n != null) it.n = r.n;
      if (byLabel[r.dimLabel]) it.dim = byLabel[r.dimLabel];
      next.push(it);
    });
    if (next.length) O.items = next;         /* 表上停用的條目就不會出現 */
  }

  /* 先告訴它端點，但還不算 remote —— auth.exchange／auth.bind 在綁定成功
     之前就要能打，而那時候還沒有學員資料可以同步。 */
  function endpoint(url) { api = url || ''; }

  /* 驗證成功之後把 Token 交給 store，之後所有請求都用它。
     呼叫端還是可以在單一 payload 裡自己帶，那個優先。 */
  function token(t) { idToken = t || ''; }

  /* ── 教練切換學員 ──────────────────────────────────
     ⚠️ 真正的權限在後端 —— 這裡送什麼 studentId，GAS 都會再對一次
     綁定表的 access_scope。前端改這個值換不到別人的資料。 */
  function listStudents() {
    return call({ action: 'student.list', studentId: '' })
      .then(function (d) { return d.students || []; });
  }

  function switchStudent(id) {
    if (!id || id === studentId) return Promise.resolve();
    /* ⚠️ 先把還沒送出去的 patch 清乾淨，否則 A 的答案會寫到 B 頭上。 */
    var stuck = queue.length;
    if (stuck) say('還有 ' + stuck + ' 筆沒存完，先送出再切換。');
    return drain().then(function () {
      var prev = studentId;
      studentId = id;
      snap = null;
      return load_().catch(function (e) {
        studentId = prev;               /* 換失敗就換回去，不要停在半空中 */
        throw e;
      });
    });
  }

  /* 把佇列送完再繼續。逾時就放棄等待（資料還在佇列裡，不會掉）。 */
  function drain() {
    if (!queue.length) return Promise.resolve();
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() {
        if (!queue.length || Date.now() - t0 > 8000) return res();
        run();
        setTimeout(tick, 300);
      })();
    });
  }

  window.UC_STORE = {
    endpoint: endpoint,
    token: token,
    listStudents: listStudents,
    switchStudent: switchStudent,
    isRemote: isRemote,
    push: push,
    flush: flush,
    connect: connect,
    call: call,
    perf: function () { return perf.slice(); },
    studentId: function () { return studentId; },
    demoStudentId: function () { return demoId; },
    attach: function (app) { APP = app; }
  };

  /* 分頁被切走或關掉時補送最後一筆。pagehide 在手機上比 beforeunload 可靠。 */
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('online', function () { if (queue.length) run(); });
})();
