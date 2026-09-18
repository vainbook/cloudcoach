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
  var syncState = { state: 'local', text: '本機模式' };

  function notify(state, text) {
    syncState = { state: state, text: text };
    if (APP && APP.setSyncStatus) APP.setSyncStatus(state, text);
  }

  function queuedText(prefix) {
    return prefix + (queue.length ? '・' + queue.length + ' 筆' : '');
  }

  /* ⚠️ 「有端點」不等於「已經接上」。綁定畫面還開著的時候 api 已經設好了，
     但還沒有 studentId —— 這時候 save() 必須照舊寫 localStorage，
     否則使用者在綁定前的操作會直接蒸發。 */
  function isRemote() { return !!api && !!studentId; }

  /* ── S 的哪一格對到後端的哪一格 ────────────────────
     item_id 全部是穩定 ID（question_id / kr_id），
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
    out['assessment|activity_days|answer'] = {
      scope: 'assessment', itemId: 'activity_days', field: 'answer',
      label: '90 天編輯簽到', value: (S.activityDays || []).join(','), display: ''
    };

    var cr = S.coachReport || {};
    var D = window.UC_DIMENSIONS ? window.UC_DIMENSIONS.dims : [];
    D.forEach(function (d) {
      push('adjust.' + d.k, d.label + '／教練加減', num(cr.adjust && cr.adjust[d.k]));
      push('score.' + d.k, d.label + '／分數', num(cr.scores && cr.scores[d.k]));
      push('note.' + d.k, d.label + '／說明', str(cr.notes && cr.notes[d.k]));
    });
    push('letter', '寫給學員的一封信', str(cr.letter));
    push('coachName', '教練中文署名', str(cr.coachName));
    push('coachEnglishName', '教練英文署名', str(cr.coachEnglishName));
    push('growthStart', '90 天起始日期', str(cr.growthStart));
    push('complete', '報告完成', cr.complete === true);

    function push(field, label, value) {
      out['report|report|' + field] = { scope: 'report', itemId: 'report',
                                        field: field, label: label, value: value };
    }

    /* 任務狀態全部以 kr_id 為 key；每一條都能獨立成為當前任務。 */
    Object.keys(S.taskNow || {}).forEach(function (kr) {
      if (S.taskNow[kr]) add('task', kr, 'current', kr + '／當前任務', true);
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

    /* 通用作業：一位學員的一份作業只送一包 JSON。
       題目文字可以改，穩定的 assignmentId / field id 不跟著改。 */
    Object.keys(S.assignments || {}).forEach(function (assignmentId) {
      var submission = S.assignments[assignmentId];
      if (!submission || typeof submission !== 'object') return;
      add('assignment', assignmentId, 'submission', assignmentId + '／作業作答', JSON.stringify(submission));
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
    if (queue.length) notify('saving', queuedText('等待儲存'));
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
    var sentValue = JSON.stringify(p.value);
    sending = true;
    notify('saving', queuedText('儲存中'));

    call({ action: 'state.save', scope: p.scope, itemId: p.itemId, field: p.field,
           label: p.label, display: p.display || '', value: p.value, requestId: p.requestId })
      .then(function () {
        /* 這一格送出的途中可能又被繼續輸入。只有伺服器收到的確實是目前最新版，
           才能移出佇列；否則保留並換 requestId，再送一次最新內容。 */
        if (JSON.stringify(p.value) === sentValue) {
          queue.splice(i, 1); delete pending[p.key];
        } else {
          p.requestId = p.key + '#' + Date.now();
        }
        sending = false; failed = 0;
        if (queue.length) run();
        else notify('saved', '已儲存');
      })
      .catch(function (err) {
        sending = false;
        failed++;
        /* 資料本身不合法就別再重試了 —— 重試一百次還是一樣的結果。 */
        if (err && ['INVALID_INPUT', 'FORBIDDEN_FIELD', 'FORBIDDEN_STUDENT'].indexOf(err.code) >= 0) {
          queue.splice(i, 1); delete pending[p.key];
          say('有一個欄位沒能存檔：' + (err.message || '內容不正確'));
          notify('error', queuedText('尚未儲存'));
          if (queue.length) run();
          return;
        }
        /* ⚠️ **不可以靜靜失敗。** 舊的 save() 是空 catch，
           存瀏覽器失敗無所謂，網路寫入失敗沒聲音就是資料不見了。
           ⚠️ 但也**不可以把 failed 歸零** —— 歸零之後退避就永遠回到第一格，
           實際行為變成 2 秒→1 秒→2 秒→1 秒的無限熱迴圈（踩過）。
           而單筆存檔本來就要三秒，每秒重試只是把後端擠得更慢。
           提示只在剛好跨過門檻那一次講一次，之後安靜地退避。 */
        if (failed === MAX_RETRY) {
          say('目前連不上伺服器，還有 ' + queue.length + ' 筆沒存。會自動重試。');
        }
        notify(navigator.onLine === false ? 'offline' : 'error',
               queuedText(navigator.onLine === false ? '離線待同步' : '連線不穩'));
        /* 上限 30 秒。指數從 failed 算，而 failed 不再歸零，所以真的會退避：
           2 → 4 → 8 → 16 → 30 → 30…（斷線時不要一直敲門） */
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
    notify('connecting', '同步資料中');
    /* 已經有整包了就不要再打一次 —— 那是這次最佳化的重點。 */
    var first = opts.payload ? hydrate(opts.payload, opts.render !== false)
                             : load_(opts.render !== false);
    return first.then(function (data) {
      /* 畫面已經出來了，剩下的在背景補。使用者等不到它。
         ⚠️ 只有拿到 'boot' 那一包才需要補；教練或完整載入不必。 */
      if (data && data.part === 'boot') prefetchRest();
      return data;
    });
  }

  /* ── 背景補齊 ─────────────────────────────────────
     登入只讀第一眼要用的四包（答案／報告／任務／藍圖），
     成長紀錄與作業等畫完之後才抓 —— 它們只有 #/growth 與作業頁會用到，
     而使用者走到那裡至少要幾秒，補得完。
     ⚠️ 失敗不吵使用者：那兩頁進去時本來就會是空的，
     跟「還沒填」長得一樣，不是錯誤狀態。下次登入會再補一次。 */
  var restDone = false;

  function prefetchRest() {
    if (restDone || !isRemote()) return;
    restDone = true;
    call({ action: 'student.load', part: 'rest' })
      .then(mergeRest)
      .catch(function (e) {
        restDone = false;                /* 讓下一次切換學員還能再試 */
        console.warn('背景補資料失敗（不影響現在這一頁）', e && e.message);
      });
  }

  /**
   * ⚠️ **只填，不蓋。**
   * 從發出請求到回來大約兩秒，使用者可能已經在那兩頁裡寫東西了。
   * 走 replaceState 會把他寫的蓋掉，而且 snap 會跟著重設 ——
   * 那個「蓋回去」還會被 push() 當成一筆新修改送進試算表。
   */
  function mergeRest(data) {
    if (!data || !APP) return data;
    var S = APP.S();
    if (!S) return data;
    var touched = false;

    /* 逐筆合併，不是「空的才填」。
       ⚠️ 「空的才填」會反過來吃掉伺服器的資料：使用者在這兩秒內加了一筆成長紀錄，
       S.log 就不是空的，於是伺服器上原有的五筆全部被跳過，畫面上看起來像消失了。
       以 id 為準做聯集，本機那一份優先（那是還沒送出去的最新版）。 */
    if (data.log && data.log.length) {
      var mine = S.log || [], have = {};
      mine.forEach(function (e) { if (e && e.id) have[e.id] = 1; });
      var add = data.log.filter(function (e) { return e && e.id && !have[e.id]; });
      if (add.length) {
        /* 依日期排回去，不要讓補進來的全部黏在尾巴。 */
        S.log = mine.concat(add).sort(function (a, b) {
          return String(a.d || '') < String(b.d || '') ? -1 : 1;
        });
        touched = true;
      }
    }
    if (data.assignments) {
      S.assignments = S.assignments || {};
      Object.keys(data.assignments).forEach(function (k) {
        if (!S.assignments[k]) { S.assignments[k] = data.assignments[k]; touched = true; }
      });
    }
    if (touched) {
      /* 補進來的是伺服器上本來就有的東西，不是新的修改 ——
         要一起算進基準，否則下一次 save() 會把它們整包再送回去一次。 */
      snap = flatten(S);
      if (APP.render) APP.render();
    }
    return data;
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
      var rawAnswers = data.answers || {};
      var activityDays = String(rawAnswers.activity_days || '').split(',').filter(Boolean);
      delete rawAnswers.activity_days;
      /* ⚠️ data 可能只是 'boot' 那一包（沒有 log／assignments）——
         缺的就給空值，等 prefetchRest 補。不要因此把已經有的清掉。 */
      var prev = (APP && APP.S()) || {};
      var S = {
        name: data.studentName || data.lineDisplayName || '',
        answers: rawAnswers,
        coachReport: unpackReport(data.report || {}),
        picked: [], key: {}, taskNow: {}, hidden: {}, done: {},
        assignments: data.assignments || {},
        log: Array.isArray(data.log) ? data.log : [],
        activityDays: activityDays
      };
      if (!data.assignments && prev.assignments) S.assignments = prev.assignments;
      if (!data.log && Array.isArray(prev.log)) S.log = prev.log;
      unpackTasks(data.tasks || {}, S);
      if (data.blueprint && data.blueprint.length) applyBlueprint(data.blueprint);
      if (data.links) applyLinks(data.links);
      if (APP) APP.replaceState(S, shouldRender !== false);
      /* ⚠️ 基準要取「app 實際拿到的那一份」，不是這裡組出來的那一份 ——
         replaceState 會再過一次形狀檢查（補空欄位、正規化教練報告），
         拿組出來的那份當基準會讓第一次 save() 把整份資料重送一遍。 */
      snap = flatten(APP ? APP.S() : S);
      notify('saved', '已同步');
      return data;
    });
  }

  function unpackReport(flat) {
    var cr = { adjust: {}, scores: {}, notes: {}, letter: '', coachName: '',
               coachEnglishName: '', growthStart: '', complete: false };
    Object.keys(flat).forEach(function (f) {
      var v = flat[f];
      if (f === 'letter') cr.letter = typeof v === 'string' ? v : '';
      else if (f === 'coachName') cr.coachName = typeof v === 'string' ? v : '';
      else if (f === 'coachEnglishName') cr.coachEnglishName = typeof v === 'string' ? v : '';
      else if (f === 'growthStart') cr.growthStart = typeof v === 'string' ? v : '';
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
      if (f.current === true) S.taskNow[item] = 1;
      if (f.done === true) S.done[item] = 1;
      if (f.hidden === true) S.hidden[item] = 1;
      if (f.picked === true) S.picked.push(item);
      if (f.key === true) S.key[item] = 1;
    });
  }

  /* 藍圖以試算表為準。既有 kr_id 會更新原任務，新 kr_id 會建立新任務。
     能力名稱必須對得上五個維度；填錯的列不顯示，並由 Sheet 的檢查功能列出。 */
  function applyBlueprint(rows) {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS;
    if (!O || !D) return;
    var byLabel = {};
    D.dims.forEach(function (d) { byLabel[d.label] = d.k; });
    var byId = {};
    O.items.forEach(function (it) { byId[it.id] = it; });

    var next = [];
    rows.forEach(function (r) {
      var dim = byLabel[r.dimLabel];
      if (!r.id || !dim || !r.kr) return;    /* 後台檢查會列出哪一列不完整 */
      var it = byId[r.id];
      if (!it) {
        /* Sheet 是藍圖的正式來源；新 kr_id 不需要再回頭改 okr.js。
           ch 只供暫時保留的書頁分章，依能力放入現有三章。 */
        it = { id: r.id, ch: dim === 'flirt' ? 2 : (dim === 'circle' || dim === 'emo' ? 1 : 0) };
      }
      it.dim = dim;
      it.sub = r.sub || '';
      it.kr = r.kr;
      it.tool = r.tool || '';
      it.sheet = r.sheet || '';
      it.short = r.short || r.kr;
      it.note = r.note || '';
      it.n = r.n == null ? null : r.n;
      next.push(it);
    });
    if (next.length) O.items = next;         /* 表上停用的條目就不會出現 */
  }

  /* 先告訴它端點，但還不算 remote —— auth.exchange／auth.bind 在綁定成功
     之前就要能打，而那時候還沒有學員資料可以同步。 */
  function endpoint(url) {
    api = url || '';
    notify(api ? 'connecting' : 'local', api ? '準備連線' : '本機模式');
  }

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
      restDone = false;            /* 換人了，那一份要重補 */
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

  /* 課程連結由試算表決定（教練自己貼 Google Drive 網址）。
     ⚠️ 只認 http(s)，而且**只填 src，不動其他欄位** ——
     課程名稱、封面、分類都還是 data/library.js 說了算。 */
  function applyLinks(map) {
    var L = window.UC_LIBRARY;
    if (!L || !L.items) return;
    L.items.forEach(function (i) {
      var url = map[i.tab + '-' + i.no];
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) i.src = url;
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
    /* 刪掉一筆成長紀錄。⚠️ **一定要讓伺服器也刪掉** ——
       mergeRest 是以 id 做聯集，只刪本機的話下一次同步就會把它撈回來。
       本機／demo 模式沒有伺服器，直接回成功讓前端自己處理狀態。 */
    deleteGrowth: function (eventId) {
      if (!isRemote()) return Promise.resolve({ deleted: true, eventId: eventId });
      return call({ action: 'growth.delete', eventId: String(eventId) }).then(function (r) {
        /* 快照裡還留著那一筆的話，下一次 push 會把它寫回去。 */
        if (snap) delete snap['growth|' + eventId + '|event'];
        return r;
      });
    },
    attach: function (app) {
      APP = app;
      if (APP && APP.setSyncStatus) APP.setSyncStatus(syncState.state, syncState.text);
    }
  };

  /* 分頁被切走或關掉時補送最後一筆。pagehide 在手機上比 beforeunload 可靠。 */
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('offline', function () {
    if (isRemote()) notify('offline', queuedText('離線待同步'));
  });
  window.addEventListener('online', function () {
    if (!isRemote()) return;
    if (queue.length) { notify('saving', queuedText('重新連線')); run(); }
    else notify('saved', '已連線');
  });
})();
