/* UC Cloud Coach — 路由、狀態、各頁渲染
   狀態全部在 localStorage，沒有後端。教學文本全部來自 data/*.js。 */
(function () {
  'use strict';

  var KEY = 'uc_coach_v1';
  /* 只記介面位置，不記姓名、答案、分數、報告或作業。正式資料仍只在記憶體與後端。 */
  var ROUTE_KEY = 'uc_last_route_v1';
  var S = load();
  var LINE_PROFILE = { displayName: '', pictureUrl: '' };
  var SYNC_STATE = { state: 'local', text: '本機模式' };
  /* 只記作業書寫器目前選到哪個細節、正在編輯哪一題，不寫入存檔。 */
  var ASSIGNMENT_CHOOSING = {};
  var ASSIGNMENT_GROUP = {};
  var ASSIGNMENT_SELECTED = {};
  var ASSIGNMENT_OPEN = {};
  /* 「冒險」上方共用螢幕目前開啟的作業。null 代表只看月面入口。 */
  var ADVENTURE_TOOL = null;

  /* ⚠️ 舊版只 try/catch JSON.parse —— 那只擋得住「壞掉的 JSON」，
     擋不住**合法 JSON 但形狀不對**（`[]`、`"字串"`、舊版存檔少欄位、
     `picked` 被寫成字串…）。實測 localStorage 放 `[]` 時藍圖頁會整頁空白。
     所以逐欄檢查型別，壞的那一欄換成空值，**其他欄位保留** —— 不要整份丟掉。 */
  function load() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
    return hydrate(raw);
  }

  /* 把「來路不明的一包東西」整成合法的 S。
     ⚠️ 後端載回來的資料也走這裡 —— 網路上的東西一樣不能假設形狀正確。 */
  function hydrate(raw) {
    var b = blank();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return b;
    var answers = obj(raw.answers);
    /* 題庫精簡後保留舊存檔的內容，但轉成新欄位的格式。 */
    if (answers.L01 === '單身，沒有在認識對象'
        || answers.L01 === '單身，有在認識對象') answers.L01 = '單身';
    if (typeof answers.L02 === 'string') {
      var count = answers.L02.match(/^\d+/);
      if (count) answers.L02 = count[0];
    }
    if (answers.C11) {
      answers.C10 = [answers.C10, answers.C11].filter(Boolean).join('\n');
      delete answers.C11;
    }
    return {
      name:    typeof raw.name === 'string' ? raw.name : b.name,
      answers: answers,
      picked:  Array.isArray(raw.picked) ? raw.picked.filter(function (x) {
                 return typeof x === 'string'; }) : b.picked,
      key:     obj(raw.key),
      taskNow: normalizeTaskNow(raw.taskNow),
      hidden:  obj(raw.hidden),
      done:    obj(raw.done),
      assignments: normalizeAssignments(raw.assignments),
      coachReport: normalizeCoachReport(raw.coachReport),
      log:     Array.isArray(raw.log) ? raw.log : b.log
    };
    function obj(v) {
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }
  }
  /* picked／key 是暫時保留的書本狀態；taskNow 以 KR id 為 key，可同時勾選多條；
     hidden ＝不給學員看的任務。 */
  function blank() {
    return {
      name: '', answers: {}, picked: [], key: {}, taskNow: {}, hidden: {}, done: {},
      assignments: {}, coachReport: normalizeCoachReport(), log: []
    };
  }
  function normalizeTaskNow(v) {
    var out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).forEach(function (k) {
      /* 新格式：{ "V-01": true }。舊格式：{ values: "V-01" }。 */
      /* 值是勾選時間（毫秒）；舊資料只有 true／1，排在所有有時間的後面。 */
      if (typeof v[k] === 'number' && v[k] > 0) out[k] = v[k];
      else if (v[k] === true) out[k] = 1;
      else if (typeof v[k] === 'string' && v[k]) out[v[k]] = 1;
    });
    return out;
  }
  function normalizeAssignments(v) {
    var out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).forEach(function (id) {
      var raw = v[id];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      var answers = {};
      if (raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers)) {
        Object.keys(raw.answers).forEach(function (field) {
          if (typeof raw.answers[field] === 'string') answers[field] = raw.answers[field];
        });
      }
      out[id] = {
        assignmentId: id,
        version: Math.max(1, Math.round(Number(raw.version) || 1)),
        status: ['draft', 'submitted', 'completed'].indexOf(raw.status) >= 0 ? raw.status : 'draft',
        answers: answers,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
      };
    });
    return out;
  }
  function normalizeCoachReport(v) {
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    var scores = v.scores && typeof v.scores === 'object' && !Array.isArray(v.scores) ? v.scores : {};
    var notes = v.notes && typeof v.notes === 'object' && !Array.isArray(v.notes) ? v.notes : {};
    var adjust = v.adjust && typeof v.adjust === 'object' && !Array.isArray(v.adjust) ? v.adjust : {};
    var progress = v.progress && typeof v.progress === 'object' && !Array.isArray(v.progress) ? v.progress : {};
    return {
      /* progress ＝ 課程中教練記下的**進步**（+0～+4 級），跟 adjust 分開存。
         ⚠️ 兩者目的不同：adjust 是評測時的校準（讓起點更真實），progress 是後來的成長。
         混在同一格，學員看到的「進步」裡會混著當初的校準，進步感就不準了。 */
      progress: progress,
      /* adjust ＝ 教練在題目算出來的基準上加減幾級（-2～+2，預設 0）。
         scores ＝ 加減之後的最終星等，由 syncCoachScores() 自動算出來寫回，
         **不是教練直接填的** —— 它只是給後端／試算表用的快照。 */
      adjust: adjust,
      scores: scores,
      notes: notes,
      letter: typeof v.letter === 'string' ? v.letter : '',
      coachName: typeof v.coachName === 'string' ? v.coachName : ((window.UC_COACH && window.UC_COACH.name) || ''),
      coachEnglishName: typeof v.coachEnglishName === 'string' ? v.coachEnglishName : '',
      growthStart: /^\d{4}-\d{2}-\d{2}$/.test(String(v.growthStart || ''))
        ? String(v.growthStart) : ((window.UC_GROWTH && window.UC_GROWTH.start) || ''),
      complete: v.complete === true
    };
  }
  /* ⚠️ **所有寫入都經過這裡。** 程式裡 21 個地方在改 S，但它們每一個都會
     呼叫 save()，所以要接後端只要接這一個出口 —— 不必去改那 21 個地方，
     也不會漏掉 cr 那種閉包別名（app.js 的教練報告寫的是 cr.xxx 不是 S.coachReport.xxx）。 */
  function save() {
    /* demo／離線照舊寫瀏覽器。配額爆掉不影響使用，所以這個 catch 是故意空的。 */
    if (!(window.UC_STORE && window.UC_STORE.isRemote())) {
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    }
    /* 接上後端之後，把「這次動到的那幾格」送出去（UC_STORE 自己做比對與節流）。 */
    if (window.UC_STORE) window.UC_STORE.push(S);
    updateNavAccess();
  }

  /* 後端載回來之後換掉整份狀態。
     ⚠️ **就地換內容，不換物件** —— 教練報告那邊有 `var cr = S.coachReport` 這種
     閉包別名，直接 S = next 的話別名還指著舊物件，畫面會寫到一份沒人看的資料。 */
  function replaceState(next, shouldRender) {
    var b = hydrate(next);
    Object.keys(S).forEach(function (k) { delete S[k]; });
    Object.keys(b).forEach(function (k) { S[k] = b[k]; });
    if (shouldRender !== false) go(location.hash || '#/');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  /* 右上角只顯示 LINE 公開頭像與目前同步狀態，不把 profile 寫進任何儲存空間。
     LINE profile 是視覺身分提示；真正的登入與權限仍由後端驗證 ID Token。 */
  function renderSession() {
    var name = LINE_PROFILE.displayName || S.name || (ACTOR_ROLE === 'coach' ? '教練' : '學員');
    var fallback = (name.trim().charAt(0) || 'UC').toUpperCase();
    [].forEach.call(document.querySelectorAll('[data-uc-session]'), function (box) {
      box.innerHTML = '<span class="uc-avatar"><img alt="" hidden><span>' + esc(fallback) + '</span></span>'
        + '<span class="uc-session-copy"><b class="who">' + esc(name) + '</b>'
        + '<small class="uc-sync" data-state="' + esc(SYNC_STATE.state) + '"><i></i><span>'
        + esc(SYNC_STATE.text) + '</span></small></span>';
      var img = box.querySelector('img'), fb = box.querySelector('.uc-avatar span');
      if (img && LINE_PROFILE.pictureUrl) {
        img.onload = function () { img.hidden = false; if (fb) fb.hidden = true; };
        img.onerror = function () { img.hidden = true; if (fb) fb.hidden = false; };
        img.src = LINE_PROFILE.pictureUrl;
      }
    });
  }

  function setIdentity(profile) {
    profile = profile && typeof profile === 'object' ? profile : {};
    LINE_PROFILE = {
      displayName: typeof profile.displayName === 'string' ? profile.displayName : '',
      pictureUrl: typeof profile.pictureUrl === 'string' ? profile.pictureUrl : ''
    };
    renderSession();
  }

  function setSyncStatus(state, text) {
    var allowed = ['local', 'connecting', 'saving', 'saved', 'offline', 'error'];
    SYNC_STATE.state = allowed.indexOf(state) >= 0 ? state : 'connecting';
    SYNC_STATE.text = String(text || '連線中');
    renderSession();

    /* 失敗或離線 → 立刻提醒。 */
    if (SYNC_STATE.state === 'error' || SYNC_STATE.state === 'offline') {
      clearSlowSave();
      syncWarn(true);
      return;
    }
    /* ⚠️ **還沒失敗、但太久** 也要提醒（使用者 2026-09-18：
       「正常使用下應該不會放超過 10 秒，如果 10 秒後都還沒有儲存就應該提醒勿關」）。
       單筆實測 2～3 秒，10 秒代表已經不正常了 —— 等它失敗才說話太慢
       （掛住的請求要 25 秒才會被逾時砍掉）。
       ⚠️ **不可以每一筆都重設計時器** —— 佇列裡有十筆的話就永遠到不了 10 秒。
       從「開始有東西在送」算起，中間一直是 saving 就繼續計時。 */
    if (SYNC_STATE.state === 'saving') {
      if (!slowSaveTimer) {
        slowSaveTimer = setTimeout(function () {
          slowSaveTimer = null;
          if (SYNC_STATE.state === 'saving') syncWarn(true);
        }, SLOW_SAVE_MS);
      }
      return;
    }
    clearSlowSave();
    syncWarn(false);
  }

  var SLOW_SAVE_MS = 10000;
  var slowSaveTimer = null;
  function clearSlowSave() {
    if (slowSaveTimer) { clearTimeout(slowSaveTimer); slowSaveTimer = null; }
  }

  /* ⚠️ 存不上去的時候要**大聲說**。
     使用者 2026-09-18 決定不把未送出的佇列存進瀏覽器（那會帶來「寫到別的學員
     頭上」的風險），所以**這條橫幅就是唯一的保護** —— 在還沒送出去的時候
     關掉頁面，那幾筆就沒了。
     原本只有標題列一行 9px 小字和一次就消失的 toast，放著看不到。 */
  function syncWarn(show) {
    var box = document.getElementById('syncWarn');
    if (!show) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'syncWarn';
      box.className = 'syncwarn';
      box.setAttribute('role', 'status');
      box.innerHTML = '<b></b><span>網路回來會自動送。<u>先不要關掉這個頁面</u> ——'
        + '還沒送出去的內容只留在這個畫面上。</span>';
      document.body.appendChild(box);
    }
    /* 現在的狀態字（例：儲存中・3 筆／連線不穩・3 筆）。每次都重讀，
       不要用計時器建立時的那一份 —— 筆數會變。 */
    box.querySelector('b').textContent = SYNC_STATE.text;
    box.hidden = false;
  }

  /* ── 同一介面的欄位權限 ─────────────────────────────
     頁面不分教練版／學員版；每個資料欄位用 data-field-owner 表示誰能寫。
     正式登入完成後呼叫 UC_APP.setRole('coach'|'student')。
     這裡只避免誤操作，真正的授權仍要由 GAS 依 Session 再驗證。 */
  var ACTOR_ROLE = window.UC_ROLE === 'coach' || window.UC_ROLE === 'student' ? window.UC_ROLE : '';
  var fieldTimer = null;

  function writableBy(owner) {
    if (!ACTOR_ROLE) return true;          /* 本機 demo 尚未登入時不鎖欄位 */
    if (owner === 'shared') return true;
    /* ⚠️ **教練改得動學員的欄位。**
       2026-09-13 使用者升級成教練之後回報「評測的選項點了沒反應」——
       原因就是這裡：評測題掛的是 owner='student'，教練被擋掉，
       而畫面上**完全沒有任何提示**，看起來就像壞掉。

       教練本來就會在訪談時幫學員補答案、修錯字，擋掉沒有道理；
       而且前端從一開始就不分教練端與學員端（AGENTS.md）。
       真正的邊界在後端：GAS 的 targetStudent_() 決定這個帳號**動得了誰**，
       那個擋不掉才是安全問題，前端這一層只是介面。
       反過來不成立 —— 學員仍然改不了 owner='coach' 的欄位（分數、評語、信）。 */
    if (ACTOR_ROLE === 'coach') return owner === 'coach' || owner === 'student';
    return owner === ACTOR_ROLE;
  }

  function fieldControls(field) {
    var out = [];
    if (field.matches('input,select,textarea,.opt,.chk')) out.push(field);
    return out.concat([].slice.call(field.querySelectorAll('input,select,textarea,.opt,.chk')));
  }

  function applyFieldAccess(root) {
    var fields = (root || document).querySelectorAll('[data-field-owner]');
    [].forEach.call(fields, function (field) {
      var owner = field.dataset.fieldOwner || '';
      var locked = !!ACTOR_ROLE && (owner === 'state' || !writableBy(owner));
      field.dataset.fieldAccess = locked ? 'read' : 'write';
      field.classList.toggle('field-locked', locked);
      fieldControls(field).forEach(function (control) {
        var textLike = control.matches('textarea,input[type="text"],input[type="number"],input[type="password"]');
        if (locked) {
          if (textLike) {
            if (!control.readOnly) control.dataset.roleReadonly = '1';
            control.readOnly = true;
          } else {
            if (!control.disabled) control.dataset.roleDisabled = '1';
            control.disabled = true;
          }
          control.setAttribute('aria-readonly', 'true');
        } else {
          if (control.dataset.roleReadonly === '1') { control.readOnly = false; delete control.dataset.roleReadonly; }
          if (control.dataset.roleDisabled === '1') { control.disabled = false; delete control.dataset.roleDisabled; }
          control.removeAttribute('aria-readonly');
        }
      });
    });
    /* 記錄者不是手填內容；正式登入時固定由目前身分帶入。 */
    if (ACTOR_ROLE) {
      [].forEach.call((root || document).querySelectorAll('#fBy'), function (by) {
        by.value = ACTOR_ROLE;
        if (!by.disabled) by.dataset.roleDisabled = '1';
        by.disabled = true;
        by.setAttribute('aria-readonly', 'true');
      });
    }
  }

  function setRole(role) {
    ACTOR_ROLE = role === 'coach' || role === 'student' ? role : '';
    document.documentElement.dataset.ucRole = ACTOR_ROLE || 'demo';
    applyFieldAccess(document);
  }

  new MutationObserver(function () {
    if (!ACTOR_ROLE || fieldTimer) return;
    fieldTimer = setTimeout(function () { fieldTimer = null; applyFieldAccess(document); }, 0);
  }).observe(document.body, { childList: true, subtree: true });

  /* ── 捲動揭示 ─────────────────────────────────────── */
  var io = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '-8% 0px -6% 0px' })
    : null;
  function reveal(root) {
    var ns = (root || document).querySelectorAll('.rv:not(.in)');
    if (!io) { [].forEach.call(ns, function (n) { n.classList.add('in'); }); return; }
    [].forEach.call(ns, function (n) { io.observe(n); });
  }

  /* ── 背景補資料的狀態 ──────────────────────────────
     成長日誌與作業不在登入那一包裡，是畫面出來之後才補的（省 1.5～2.5 秒）。
     ⚠️ **還沒補到的時候不能裝成空的。** 空白畫面跟「還沒填」長得一模一樣，
     學員會以為自己寫的東西不見了 —— 而作業那頁更糟：空表單被填一個字就整包
     蓋回伺服器。等不到就要說等不到。 */
  function restPending() {
    var st = window.UC_STORE;
    if (!st || !st.isRemote() || !st.restState) return '';
    var s = st.restState();
    return s === 'ok' ? '' : s;
  }

  function restNoticeHTML(what) {
    var s = restPending();
    if (!s) return '';
    return s === 'loading'
      ? '<p class="restnote">正在讀取' + esc(what) + '…</p>'
      : '<p class="restnote is-bad">' + esc(what) + '讀取失敗，畫面上顯示的可能不完整。'
        + '<button type="button" data-rest-retry>重新讀取</button></p>';
  }

  /* 一個監聽器管兩頁的重試鍵 —— 那兩頁各自重畫，逐頁綁會漏。 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rest-retry]');
    if (!b) return;
    if (window.UC_STORE && window.UC_STORE.retryRest) window.UC_STORE.retryRest();
  });

  /* ── 路由 ─────────────────────────────────────────── */
  var ROUTES = {
    '#/':        { view: 'v-home' },
    '#/assess':  { view: 'v-assess',  render: renderAssess },
    '#/okr':     { view: 'v-okr',     render: renderOkr },
    '#/growth':  { view: 'v-growth',  render: renderGrowth },
    '#/library': { view: 'v-library', render: renderLibrary },
    '#/tools':   { view: 'v-library', render: function () { LIBTAB = 'tool'; renderLibrary(); } },
    '#/students': { view: 'v-students', render: renderStudents }
  };
  var ACTIVE_ROUTE = '';

  function savedRoute(role) {
    try {
      var v = JSON.parse(localStorage.getItem(ROUTE_KEY));
      return v && typeof v[role] === 'string' ? v[role] : '';
    } catch (e) { return ''; }
  }

  function routeAllowed(hash, role) {
    if (!ROUTES[hash] || hash === '#/') return false;
    if (hash === '#/students') return role === 'coach';
    if (hash === '#/assess') return true;
    /* 藍圖採半開放：入口永遠可進，資料尚未完成時由頁面自己解釋缺哪一步。 */
    if (hash === '#/okr') return true;
    var assessed = answeredCount() === window.UC_SCORE.questions.length;
    if (['#/growth', '#/library', '#/tools'].indexOf(hash) >= 0) {
      return assessed && coachReportReady();
    }
    return false;
  }

  function routeFallback(hash, role) {
    if (role === 'coach' && hash === '#/students') return '#/students';
    if (answeredCount() < window.UC_SCORE.questions.length) return '#/assess';
    if (!coachReportReady()) return '#/assess';
    return role === 'coach' ? '#/students' : '#/okr';
  }

  /* 分頁列呈現課程流程，但真正的限制仍由 routeAllowed() 擋住直接網址。
     鎖住時保留文字，讓學員知道後面還有哪些內容。 */
  function updateNavAccess() {
    var role = ACTOR_ROLE === 'coach' ? 'coach' : 'student';
    var assessed = answeredCount() === window.UC_SCORE.questions.length;
    [].forEach.call(document.querySelectorAll('#nav a'), function (a) {
      var hash = a.getAttribute('href') || '';
      if (hash === '#/' || hash === '#/students') return;
      var allowed = routeAllowed(hash, role);
      a.setAttribute('aria-disabled', allowed ? 'false' : 'true');
      if (allowed) {
        a.removeAttribute('tabindex');
        a.removeAttribute('title');
      } else {
        a.setAttribute('tabindex', '-1');
        a.setAttribute('title', assessed ? '教練完成並送出報告後開放' : '完成所有評測題目後開放');
      }
    });
  }

  function rememberRoute(hash) {
    if (!(window.UC_STORE && window.UC_STORE.isRemote())) return;
    var role = ACTOR_ROLE === 'coach' ? 'coach' : 'student';
    if (!routeAllowed(hash, role)) return;
    if (hash === '#/tools') hash = '#/library';
    try {
      var v = JSON.parse(localStorage.getItem(ROUTE_KEY)) || {};
      if (!v || typeof v !== 'object' || Array.isArray(v)) v = {};
      v[role] = hash;
      localStorage.setItem(ROUTE_KEY, JSON.stringify(v));
    } catch (e) {}
  }

  /* 從 LINE 進來的落點：教練先看清單；未填完先續填；完成後預設回課程藍圖。 */
  function landing() {
    if (ACTOR_ROLE === 'coach') return '#/students';
    var total = window.UC_SCORE.questions.length;
    if (answeredCount() < total) return '#/assess';
    if (!coachReportReady()) return '#/assess';
    var last = savedRoute('student');
    return routeAllowed(last, 'student') ? last : '#/okr';
  }

  function entryRoute(requested) {
    var role = ACTOR_ROLE === 'coach' ? 'coach' : 'student';
    return routeAllowed(requested, role) ? requested : landing();
  }

  function go(hash) {
    /* ⚠️ **從 LINE 進來不需要「輸入名字」那一頁。**
       身分是 LINE 決定的，稱呼是學員在評測 B01 自己填的 ——
       再讓他打一次名字，那個名字還誰都不採信，只是白打。
       放在 go() 而不是只在登入後跳轉，是因為使用者可能按上一頁回到 #/。 */
    /* 舊書籤相容：報告已拆回評測與藍圖，不留下第三個頁面。 */
    if (hash === '#/report') {
      hash = '#/assess';
      history.replaceState(null, '', location.pathname + location.search + hash);
    }
    if (hash === '#/' && window.UC_STORE && window.UC_STORE.isRemote()) {
      var to = landing();
      if (location.hash !== to) {
        history.replaceState(null, '', location.pathname + location.search + to);
      }
      hash = to;
    }
    var role = ACTOR_ROLE === 'coach' ? 'coach' : 'student';
    if (hash !== '#/' && !routeAllowed(hash, role)) {
      hash = routeFallback(hash, role);
      history.replaceState(null, '', location.pathname + location.search + hash);
    }
    var r = ROUTES[hash] || ROUTES['#/'];
    /* 只有真正「進入」冒險頁時才回月面入口。後台同步觸發的重畫
       不能把學員正在寫的作業踢回第一層。 */
    if (hash !== ACTIVE_ROUTE && (hash === '#/library' || hash === '#/tools')) ADVENTURE_TOOL = null;
    ACTIVE_ROUTE = hash;
    [].forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.remove('on'); });
    el(r.view).classList.add('on');

    var home = r === ROUTES['#/'];
    el('nav').hidden = home;
    [].forEach.call(document.querySelectorAll('#nav a'), function (a) {
      if (a.getAttribute('href') === hash) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    updateNavAccess();
    renderSession();
    var ns = el('navStudents');
    if (ns) ns.hidden = !(ACTOR_ROLE === 'coach' && window.UC_STORE && window.UC_STORE.isRemote());

    /* 走進要用到那包資料的頁面就再試一次。補過了的話這是空操作。 */
    if ((hash === '#/growth' || hash === '#/tools')
        && window.UC_STORE && window.UC_STORE.retryRest) window.UC_STORE.retryRest();
    if (r.render) r.render();
    rememberRoute(hash);
    window.scrollTo(0, 0);
    reveal(el(r.view));
  }

  function nav(hash) {
    if (location.hash === hash) go(hash);
    else location.hash = hash;
  }

  /* 「輸入名字」那個表單連同處理器一起拿掉了（2026-09-19）——
     稱呼由 LINE 決定，或在評測 B01 自己填。 */

  /* ── 登出 ─────────────────────────────────────────
     ⚠️ demo 時代它只是 `<a href="#/">`，回首頁就等於登出。
     接上 LINE 之後那條路**原地彈回來** —— go() 會把 remote 模式的 #/ 跳走
     （2026-09-13 使用者回報「按登出鍵沒有任何反應」，是我上一輪弄壞的）。
     真的登出要做三件事：把沒送完的存檔送出去、跟 LIFF 說登出、重新載入。 */
  el('navOut').addEventListener('click', function (e) {
    if (!(window.UC_STORE && window.UC_STORE.isRemote())) return;   /* demo 照舊 */
    e.preventDefault();
    if (!confirm('登出後要重新從 LINE 進來。確定嗎？')) return;
    window.UC_STORE.flush();                 /* 佇列裡的東西不能跟著消失 */
    try { sessionStorage.removeItem('uc_line_pending_v1'); } catch (err) {}
    try { if (window.liff && liff.isLoggedIn()) liff.logout(); } catch (err) {}
    /* replace 而不是 assign —— 不要讓上一頁按回去又回到已登出的畫面。 */
    location.replace(location.pathname);
  });

  el('nav').addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[aria-disabled="true"]');
    if (!a) return;
    e.preventDefault();
    toast(answeredCount() < window.UC_SCORE.questions.length
      ? '完成全部評測題目後才會開放'
      : '教練完成並送出報告後才會開放');
  });

  function enterDemo() {
    /* Logo 是本機檢查用的隱藏入口。先切成 demo，避免尚未開始的 LINE 流程
       繼續蓋住畫面；資料仍使用同一份 UC_SAMPLE，不另造第二套示範資料。 */
    document.documentElement.dataset.ucBoot = 'demo';
    document.documentElement.dataset.ucLineState = 'ready';
    if (window.UC_STORE) {
      window.UC_STORE.endpoint('');
      window.UC_STORE.token('');
    }
    /* ⚠️ 用 replaceState 就地換內容，**不要 `S = ...`** ——
       教練報告那邊有 `var cr = S.coachReport` 的閉包別名，
       換掉整個物件的話別名還指著舊的，畫面會寫到一份沒人看的資料。 */
    replaceState(window.UC_SAMPLE ? window.UC_SAMPLE() : blank());
    save();
    nav('#/okr');
  }

  /* ⚠️ demo 的入口**只有 logo**。首頁那顆「載入範例學員」拿掉了 ——
     看得見的 demo 鈕，學員一定會按到（使用者 2026-09-19）。 */
  el('logoDemoBtn').addEventListener('click', enterDemo);

  /* ── 評測頁 ───────────────────────────────────────── */

  function hasValue(v) {
    return typeof v === 'string' ? v.trim() !== '' : v != null && v !== '';
  }

  function answeredCount() {
    return window.UC_SCORE.questions.filter(function (q) {
      return hasValue(S.answers[q.id]);
    }).length;
  }

  /* ── 評測（一頁式）───────────────────────────────────
     五區全部攤在同一頁往下捲，最上面那排是**跳躍錨點不是分頁**。
     每一題預設收合，只露出「短標題 ＋ 你的答案」；點開才出現題目與選項。
     這樣教練讀到的和學員填的是同一塊 —— 不需要另外做一份訪談摘要。
     ⚠️ 收合狀態不存進 S.answers，重整就全部收回去。那是刻意的：
     這一頁的預設樣貌就是「摘要」，展開是臨時動作。 */
  function renderAssess() {
    var E = window.UC_SCORE, groups = E.bySection();
    var total = E.questions.length;

    function secFull(g) {
      return g.items.every(function (q) { return hasValue(S.answers[q.id]); });
    }

    var h = '<div class="asbar">'
      + '<div class="secnav">' + groups.map(function (x) {
          return '<button class="pip' + (secFull(x) ? ' full' : '') + '" data-jump="sec-' + x.sec.k
            + '" title="' + esc(x.sec.name) + '"><b>' + x.sec.no + '</b><s>'
            + esc(x.sec.name) + '</s></button>';
        }).join('') + '</div>'
      + '<div class="prog"><i style="width:' + Math.round(answeredCount() / total * 100) + '%"></i></div>'
      + '<p class="ey aspct">已填 ' + answeredCount() + ' / ' + total + '</p>'
      + '</div>';

    h += groups.map(function (g) {
      return '<section class="assec" id="sec-' + g.sec.k + '">'
        + '<header class="sechead"><p class="ey">' + g.sec.no + ' ・ ' + g.sec.en + '</p>'
        + '<h2>' + esc(g.sec.name) + '</h2>'
        + '<div class="divider"><i></i><s></s></div></header>'
        + '<div class="qlist">' + g.items.map(qRow).join('') + '</div>'
        + '</section>';
    }).join('');

    var assessFull = answeredCount() === total;
    if (!assessFull) {
      h += '<div class="secfoot"><span></span><button class="btn pri" id="toReport" disabled>'
        + '完成全部題目後通知教練</button></div>';
    } else {
      /* 完成後預設收合：答案仍能隨時打開修改，但不再把 54 題壓在教練信上面。 */
      h = '<details class="assessfold"><summary><span><b>我的評測回答</b>'
        + '<small>54 / 54 已完成・點擊展開修改</small></span><i aria-hidden="true"></i></summary>'
        + '<div class="assessfold-body">' + h + '</div></details>'
        + (ACTOR_ROLE === 'student' ? '<div class="assessnotify"><div><p class="ey">Assessment Complete</p>'
          + '<h2>已完成評測</h2><p>通知教練後，就可以等待教練完成評測與回信。</p></div>'
          + '<button type="button" class="btn pri" id="notifyCoach">通知教練</button></div>' : '')
        + '<div id="assessReview"></div>';
    }

    var body = el('assessBody');
    body.innerHTML = h;

    [].forEach.call(body.querySelectorAll('[data-jump]'), function (b) {
      b.addEventListener('click', function () {
        var t = document.getElementById(b.dataset.jump);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    /* 選擇類的題目：點了在**原地彈出**一個浮層，不往下展開。
       展開會把下面所有東西推走，答一題畫面就跳一次（使用者指定要改掉）。 */
    [].forEach.call(body.querySelectorAll('.qsum[aria-haspopup]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var row = b.closest('.qrow');
        if (row === POPROW) { closePop(); return; }
        openPop(row);
      });
    });

    /* 填空題：格子本身就是輸入框，會跟著內容長高。 */
    [].forEach.call(body.querySelectorAll('.qfield'), function (t) {
      grow(t);
      t.addEventListener('input', function () { grow(t); });
      t.addEventListener('focus', function () { t.closest('.qrow').classList.add('focus'); });
      t.addEventListener('blur',  function () { t.closest('.qrow').classList.remove('focus'); });
    });

    var notify = el('notifyCoach');
    if (notify) notify.addEventListener('click', notifyCoachAssessment);
    var finishAssess = el('toReport');
    if (finishAssess) finishAssess.addEventListener('click', function () {
      if (answeredCount() !== total) return;
      notifyCoachAssessment();
      renderAssess();
    });

    body.removeEventListener('input', onAnswer);
    body.removeEventListener('change', onAnswer);
    body.addEventListener('input', onAnswer);
    body.addEventListener('change', onAnswer);
    /* 目前捲到哪一區，最上面那排就標哪一個。
       ⚠️ 原本用 IntersectionObserver，改成直接量 rect —— 兩個理由：
       ① IO 在 document.hidden 的分頁裡**完全不回呼**，切回來時標記是舊的；
       ② 量 rect 的版本可以在任何時候主動叫一次（渲染完、切回分頁），IO 不行。
       九個區塊 × 一次 getBoundingClientRect，用 rAF 節流之後成本可以忽略。 */
    /* ⚠️ 渲染當下量到的 scrollHeight 是**錯的** —— 那一刻版面還沒定案
       （grid 欄寬未定、頁面可能還沒顯示），每一格都會算成單行高（踩過）。
       所以排到下一個 tick 再算一次；換視窗寬度時也要重算，換行位置會變。 */
    setTimeout(growAll, 0);
    if (renderAssess._onResize) window.removeEventListener('resize', renderAssess._onResize);
    renderAssess._onResize = growAll;
    window.addEventListener('resize', renderAssess._onResize);

    markSection();
    /* ⚠️ **不要用 requestAnimationFrame 節流**。分頁被切到背景時 rAF 完全不執行，
       「有沒有待處理的 rAF」那個旗標會永遠卡在 true，切回來之後 scroll 就再也不處理了
       （踩過，而且不只發生在測試環境）。九個 getBoundingClientRect 本來就很便宜，
       瀏覽器每一格都在做同樣的事，直接算不需要節流。
       重繪時要先移掉舊的監聽，不然會一直疊上去。 */
    if (renderAssess._onScroll) window.removeEventListener('scroll', renderAssess._onScroll);
    renderAssess._onScroll = markSection;
    window.addEventListener('scroll', renderAssess._onScroll, { passive: true });
    if (assessFull) renderAssessReview(el('assessReview'));
    reveal(body);
  }

  /* 感應帶取畫面高度的 30%–40%。**取最後一個**碰到帶子的區塊，不是第一個 ——
     相鄰兩區會同時碰到（上一區的結尾和下一區的開頭），取第一個永遠慢一格。 */
  function markSection() {
    var body = el('assessBody');
    if (!body) return;
    var vh = window.innerHeight, top = vh * 0.30, bot = vh * 0.40, hit = null;
    [].forEach.call(body.querySelectorAll('.assec'), function (x) {
      var r = x.getBoundingClientRect();
      if (r.bottom > top && r.top < bot) hit = x.id;
    });
    if (!hit) return;                    /* 帶子外面就維持原樣，不要全部熄掉 */
    [].forEach.call(body.querySelectorAll('.pip'), function (p) {
      p.classList.toggle('on', p.dataset.jump === hit);
    });
  }

  function onAnswer(e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.q || t.classList.contains('opt')) return;
    S.answers[t.dataset.q] = t.value; save();
    var row = t.closest('.qrow');
    row.classList.toggle('answered', hasValue(t.value));
    /* 填空題的格子就是輸入框本身，沒有另一格要重畫。 */
    if (!row.classList.contains('free')) refreshVal(row);
    syncProgress();
  }

  /* 輸入框跟著內容長高。先歸零再讀 scrollHeight —— 不歸零的話只會愈長愈高，
     刪字不會縮回去（踩過的經典）。 */
  function grow(t) {
    if (!t || t.tagName !== 'TEXTAREA') return;
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
  }
  function growAll() {
    [].forEach.call(document.querySelectorAll('#assessBody .qfield'), grow);
  }

  /* 收合時顯示的那一格。答案一改就要重畫，不然收起來還是舊的。 */
  function refreshVal(row) {
    var q = qById(row.dataset.qid), slot = row.querySelector('.qval');
    if (q && slot) slot.innerHTML = valHTML(q, S.answers[q.id]);
  }
  var QBYID = null;
  function qById(id) {
    if (!QBYID) {
      QBYID = {};
      window.UC_SCORE.questions.forEach(function (q) { QBYID[q.id] = q; });
    }
    return QBYID[id];
  }

  function syncProgress() {
    var E = window.UC_SCORE, total = E.questions.length, n = answeredCount();
    var bar = document.querySelector('#v-assess .prog i');
    if (bar) bar.style.width = Math.round(n / total * 100) + '%';
    var lbl = document.querySelector('#v-assess .aspct');
    if (lbl) lbl.textContent = '已填 ' + n + ' / ' + total;
    E.bySection().forEach(function (g) {
      var pip = document.querySelector('#v-assess .pip[data-jump="sec-' + g.sec.k + '"]');
      if (!pip) return;
      pip.classList.toggle('full', g.items.every(function (q) {
        return hasValue(S.answers[q.id]);
      }));
    });
    var rep = el('toReport');
    if (rep) {
      rep.disabled = n !== total;
      rep.textContent = n === total ? '完成評測並通知教練' : '完成全部題目後通知教練';
    }
  }

  /* 收合時的答案格。
     `ladder: true`（05 情感能力那 25 題）畫五顆菱形標出級數，**再接上選到的那句話** ——
     只有菱形的話教練得回頭點開才知道他選了什麼，那就違背「收合狀態就是一份摘要」。
     ⚠️ **沒有 ladder 的選擇題不要畫菱形**。菱形是刻度，只有選項真的由低到高排的題目
     才能用；其他題的選項沒有順序，畫成刻度會騙人。 */
  function valHTML(q, v) {
    var has = hasValue(v);
    if (!has) return '<em class="qnil">未填</em>';
    if (q.type === 'choice' || q.type === 'number') {
      var o = q.o[+v];
      if (!o) return '';
      var dots = '';
      if (q.ladder) {
        for (var i = 0; i < q.o.length; i++) dots += '<i' + (i === +v ? ' class="on"' : '') + '></i>';
        dots = '<span class="qdots">' + dots + '</span>';
      }
      return dots + '<span class="qtxt">' + esc(o.t) + '</span>';
    }
    return '<span class="qtxt">' + esc(String(v)) + '</span>';
  }

  function qRow(q) {
    var v = S.answers[q.id];
    var has = hasValue(v);
    /* 兩種列，行為完全不同：
       free  —— 填空題。格子本身就是輸入框，直接在原位打字，會跟著內容長高。
                 提示文字放在格子裡（placeholder），不再另外寫「未填」。
       其餘 —— 選擇／複選。點了在原地彈出浮層，不往下展開。 */
    var free = q.type === 'info' && (q.input === 'text' || q.input === 'textarea' || q.input === 'number');
    var h = '<div class="qrow' + (has ? ' answered' : '') + (free ? ' free' : '')
      + '" data-qid="' + q.id + '" data-field-id="assessment.answer.' + q.id
      + '" data-field-owner="student" data-field-label="' + esc(q.name) + '"'
      + (q.col ? ' data-col="' + q.col + '"' : '') + '>';
    if (free) {
      h += '<div class="qsum"><span class="qname">' + esc(q.name) + '</span>'
        + '<div class="qval">'
        + (q.input === 'number'
          ? '<input class="qfield" type="number" inputmode="numeric" step="1" data-q="' + q.id + '"'
            + (q.min != null ? ' min="' + q.min + '"' : '')
            + ' placeholder="' + esc(q.ph || q.q) + '" value="' + esc(v == null ? '' : v) + '">'
          : '<textarea class="qfield" rows="1" data-q="' + q.id + '" placeholder="'
            + esc(q.ph || q.q) + '">' + esc(v || '') + '</textarea>')
        + (q.note ? '<p class="qhint">' + esc(q.note) + '</p>' : '')
        + '</div></div>';
    } else {
      h += '<button type="button" class="qsum" aria-haspopup="true" aria-expanded="false">'
        + '<span class="qname">' + esc(q.name) + '</span>'
        + '<span class="qval">' + valHTML(q, v) + '</span>'
        + '<span class="qcar" aria-hidden="true"></span>'
        + '</button>';
    }
    return h + '</div>';
  }

  /* ── 原地彈出的選項浮層 ───────────────────────────────
     position: fixed，所以它完全不參與版面 —— 開、關、換題目都不會推動任何東西。
     ⚠️ 只有一個浮層，重複使用。每一列各自帶一個的話，53 個隱藏節點會拖慢
     整頁的 reflow，而且同時只會開一個。 */
  var POP = null, POPROW = null;

  function ensurePop() {
    if (POP) return POP;
    POP = document.createElement('div');
    POP.className = 'qpop';
    document.body.appendChild(POP);
    /* 點浮層裡面不能關掉（要能連續勾複選），點外面才關。 */
    POP.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { closePop(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
    /* 捲動時跟著走，不要直接關掉 —— 手機上輕輕一滑就消失會很煩。 */
    window.addEventListener('scroll', placePop, { passive: true });
    window.addEventListener('resize', placePop);
    return POP;
  }

  function closePop() {
    if (!POP || !POPROW) return;
    POP.classList.remove('on');
    var b = POPROW.querySelector('.qsum');
    if (b) b.setAttribute('aria-expanded', 'false');
    POPROW.classList.remove('popped');
    POPROW = null;
  }

  function placePop() {
    if (!POP || !POPROW) return;
    var r = POPROW.getBoundingClientRect();
    /* 寬度夾在 300–560：太窄選項會折行，太寬（整排題目的 820）就不像浮層，
       像又一塊面板 —— 那就失去「浮出來、等一下就收」的感覺了。 */
    var w = Math.min(Math.max(r.width, 300), 560, window.innerWidth - 20);
    POP.style.width = w + 'px';
    var left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
    POP.style.left = left + 'px';
    var h = POP.offsetHeight;
    /* 下面放得下就放下面，放不下才翻到上面。兩邊都放不下就貼齊視窗頂端捲動。 */
    var below = window.innerHeight - r.bottom - 12;
    POP.style.top = (below >= h ? r.bottom + 6
      : Math.max(8, Math.min(r.top - h - 6, window.innerHeight - h - 8))) + 'px';
  }

  function openPop(row) {
    closePop();
    var q = qById(row.dataset.qid);
    if (!q) return;
    var pop = ensurePop();
    pop.setAttribute('data-field-id', row.getAttribute('data-field-id') || 'assessment.answer.' + row.dataset.qid);
    pop.setAttribute('data-field-owner', row.getAttribute('data-field-owner') || 'student');
    pop.setAttribute('data-field-label', row.getAttribute('data-field-label') || q.name || q.id);
    pop.innerHTML = qFields(q, S.answers[q.id]);
    pop.classList.add('on');
    POPROW = row;
    row.classList.add('popped');
    row.querySelector('.qsum').setAttribute('aria-expanded', 'true');
    placePop();

    [].forEach.call(pop.querySelectorAll('.opt'), function (b) {
      b.addEventListener('click', function () {
        /* data-i = 計分題的選項索引（數字）；data-v = 資料題的字串。 */
        S.answers[q.id] = b.dataset.i != null ? +b.dataset.i : b.dataset.v;
        save();
        [].forEach.call(pop.querySelectorAll('.opt'), function (x) { x.classList.toggle('sel', x === b); });
        row.classList.add('answered');
        refreshVal(row);
        syncProgress();
        /* 單選選完就關 —— 一題一個動作。複選不關，要能連續勾。 */
        setTimeout(closePop, 260);
      });
    });
    [].forEach.call(pop.querySelectorAll('.chk'), function (b) {
      b.addEventListener('click', function () {
        var turningOn = !b.classList.contains('sel');
        if (turningOn && q.exclusive) {
          if (b.dataset.v === q.exclusive) {
            [].forEach.call(pop.querySelectorAll('.chk.sel'), function (x) { x.classList.remove('sel'); });
          } else {
            var exclusive = pop.querySelector('.chk[data-v="' + q.exclusive + '"]');
            if (exclusive) exclusive.classList.remove('sel');
          }
        }
        if (turningOn && q.max && pop.querySelectorAll('.chk.sel').length >= q.max) return;
        b.classList.toggle('sel');
        var picked = [].map.call(pop.querySelectorAll('.chk.sel'), function (x) { return x.dataset.v; });
        S.answers[q.id] = picked.join('、'); save();
        row.classList.toggle('answered', picked.length > 0);
        refreshVal(row);
        syncProgress();
        placePop();
      });
    });
  }

  /* 浮層裡的內容：完整題目 ＋ 補充 ＋ 選項。
     ⚠️ 原生 <select> 已經不用了 —— 選單在浮層裡開第二層下拉很怪，
     而且它是全站唯一一個沒有 salmon 選中態的控制項。一律改成選項按鈕。 */
  function qFields(q, v) {
    var h = '<p class="qh">' + esc(q.q) + '</p>'
      + (q.note ? '<p class="qnote">' + esc(q.note) + '</p>' : '');
    /* 選項都很短的題目（星座、MBTI、級距）排成一排一排的標籤，不要一個一條。
       13 個星座直排下去會是一個 600px 高的浮層 —— 那比原本的往下展開還糟。 */
    var texts = q.type === 'info' ? (q.opts || []) : q.o.map(function (o) { return o.t; });
    var tight = texts.length > 0 && texts.every(function (t) { return Array.from(t).length <= 8; });
    if (q.type === 'info' && q.input === 'checks') {
      var on = String(v || '').split('、').filter(Boolean);
      h += '<div class="checks">' + q.opts.map(function (o) {
        return '<button type="button" class="chk' + (on.indexOf(o) >= 0 ? ' sel' : '') + '"'
          + ' data-v="' + esc(o) + '">' + esc(o) + '</button>';
      }).join('') + '</div>'
        + (q.max ? '<p class="qhelp">最多選 ' + q.max + ' 個</p>' : '')
        + (q.helpText ? '<p class="qhelp">' + (q.helpUrl
          ? '<a href="' + esc(q.helpUrl) + '" target="_blank" rel="noopener">' + esc(q.helpText) + ' →</a>'
          : esc(q.helpText) + '<em>（連結待補）</em>') + '</p>' : '');
    } else if (q.type === 'info') {
      h += '<div class="opts' + (tight ? ' tight' : '') + '">' + q.opts.map(function (o) {
        return '<button type="button" class="opt' + (v === o ? ' sel' : '') + '"'
          + ' data-v="' + esc(o) + '"><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
      if (q.helpText) h += '<p class="qhelp">' + (q.helpUrl
        ? '<a href="' + esc(q.helpUrl) + '" target="_blank" rel="noopener">' + esc(q.helpText) + ' →</a>'
        : esc(q.helpText) + '<em>（連結待補）</em>') + '</p>';
    } else {
      h += '<div class="opts' + (tight ? ' tight' : '') + '">' + q.o.map(function (o, i) {
        return '<button type="button" class="opt' + (v === i ? ' sel' : '') + '" data-i="' + i + '">'
          + '<span>' + esc(o.t) + '</span></button>';
      }).join('') + '</div>';
    }
    /* 題目底下的參考清單。空陣列不渲染 —— 一個打開來是空的摺疊區比沒有更糟。 */
    if (q.ref && q.ref.length) {
      h += '<details class="qref"><summary>想不到的話，看看這些</summary><div>'
        + q.ref.map(function (r) { return '<p><b>' + esc(r.k) + '</b>' + esc(r.v) + '</p>'; }).join('')
        + '</div></details>';
    }
    return h;
  }

  /* ── 共用小工具 ───────────────────────────────────── */

  function wrap(inner, cls) {
    return '<section class="' + (cls || '') + '"><div class="wrap">' + inner + '</div></section>';
  }
  function copyProgressText(text, success) {
    var action = window.UC_SHARE && window.UC_SHARE.copy
      ? window.UC_SHARE.copy(text) : Promise.resolve('fail');
    return action.then(function (how) {
      toast(how === 'copy' ? (success || '回報文字已複製，可以貼到群組')
        : '無法自動複製，請手動選取文字');
      return how;
    });
  }
  function reportProgressText(text, copied) {
    var action = window.UC_SHARE && window.UC_SHARE.group
      ? window.UC_SHARE.group(text)
      : window.UC_SHARE && window.UC_SHARE.copy ? window.UC_SHARE.copy(text) : Promise.resolve('fail');
    return action.then(function (how) {
      if (how === 'send') toast('已回傳到目前的 LINE 群組');
      else if (how === 'copy') toast(copied || '回報文字已複製，可以貼到群組');
      else toast('無法自動回報，請手動複製文字');
      return how;
    });
  }
  function head(no, en, title) {
    return '<p class="ey">' + no + ' ・ ' + en + '</p><h2>' + esc(title) + '</h2>'
      + '<div class="divider"><i></i><s></s></div>';
  }

  /* 對外程度符號。數值仍沿用既有 1–5 星等切點，只換成較中性的菱形語彙。 */
  function degreeText(v) {
    var n = window.UC_SCORE.starOf(v);
    return new Array(n + 1).join('◆') + new Array(6 - n).join('◇');
  }
  function diamondPoints(x, y, r) {
    return x.toFixed(1) + ',' + (y - r).toFixed(1) + ' '
      + (x + r).toFixed(1) + ',' + y.toFixed(1) + ' '
      + x.toFixed(1) + ',' + (y + r).toFixed(1) + ' '
      + (x - r).toFixed(1) + ',' + y.toFixed(1);
  }

  /* ── 五邊形能力圖 ─────────────────────────────────────
     酷炫全部來自動態，色票只有 navy / beige / salmon。
     光暈用多層 stroke 疊，不用 SVG filter —— html2canvas 不吃 filter，先留著這條路。
     vals / opts.ghost 都是 {維度key: 0–100}。ghost 用米白細線畫在底層（前後對照用）。 */
  function drawRadar(node, vals, opts) {
    opts = opts || {};
    var D = window.UC_SCORE.dims;
    var W = 400, CX = 200, CY = 196, R = 128, N = D.length;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function pt(i, k) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      return [CX + Math.cos(a) * R * k, CY + Math.sin(a) * R * k];
    }
    var SC = window.UC_SCORE;
    /* 半徑從 RIN 起跳，不是從圓心。原本是 starPos/5，1 星的頂點半徑只剩 0.2R，
       落在該級下緣時**會直接坐到圓心上**，五邊形塌成一片尖片。
       兩個後果：面積是半徑的平方，1★ 對 5★ 在眼睛裡是 25 倍不是 5 倍；
       而且塌掉的形狀讀起來是「我壞掉了」，不是「我在第一級」。
       給地板之後，最弱的一角仍然明顯最短，但形狀永遠還是五邊形。
       圈仍然畫在星等邊界上（rr(1..5)），所以「碰到第 3 圈＝3 星」沒有變。 */
    var RIN = 0.3;
    function rr(star) { return RIN + (1 - RIN) * star / 5; }
    function rad(v) { return rr(SC.starPos(v)); }
    function poly(k, v) {
      return D.map(function (d, i) {
        var p = pt(i, (v ? rad(v[d.k]) : 1) * k);
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ');
    }

    /* 徑向漸層：頂點亮、圓心透明。單色平塗在這種凹陷的形狀上會糊成一片。 */
    var g = '<defs><radialGradient id="rgFill">'
      + '<stop offset="0" stop-color="var(--salmon)" stop-opacity=".04"/>'
      + '<stop offset="1" stop-color="var(--salmon)" stop-opacity=".26"/>'
      + '</radialGradient>'
      + '</defs>';
    /* 五圈＝五顆星。淡入掛在群組上，不能掛在 polygon 上 ——
       @keyframes fade 的終點是 opacity:1，會把每一圈刻意調低的透明度吹掉，
       結果五圈全部同一個重量，中間糊成一張蜘蛛網。（.bands 那邊已經踩過同一個坑。） */
    g += '<g class="rings">';
    [0, 1, 2, 3, 4, 5].forEach(function (star) {
      g += '<polygon class="ring" points="' + poly(rr(star)) + '"/>';
    });
    g += '</g>';
    if (opts.ghost) {
      g += '<polygon class="ghost" points="' + poly(1, opts.ghost) + '"/>';
      D.forEach(function (d, i) {
        var p = pt(i, rad(opts.ghost[d.k]));
        g += '<polygon class="gvtx" points="' + diamondPoints(p[0], p[1], 2.2) + '"/>';
      });
    }
    var finalPts = poly(1, vals);
    g += '<polygon class="fill" points="' + finalPts + '"/>'
       + '<polygon class="glow2" points="' + finalPts + '"/>'
       + '<polygon class="glow1" points="' + finalPts + '"/>'
       + '<polygon class="line" points="' + finalPts + '"/>';
    /* 五個膠囊**一律同寬**（取最長的維度名算），寬度不一致的一組晶片看起來就是沒對齊。
       ⚠️ 要跟「五顆菱形」的寬度取較大者 —— 只照字數算的話三個字的維度
       （生活圈）會比底下那排菱形還窄。 */
    /* 藍圖的能力卡只負責標示維度，不該跟人物或任務牌搶主角。
       它的字級會由 .bpcradar 一起縮小，因此卡寬也改用較小的字寬估算。 */
    /* 桌機卡片退到輔助層；手機的整張 SVG 會再縮一次，因此補回一級字與卡面，
       否則實際中文字不到 9px。 */
    var bpMobile = !!opts.blueprint && window.matchMedia('(max-width: 780px)').matches;
    var labelUnit = opts.blueprint ? (bpMobile ? 11.5 : 9.8) : 13.5;
    var PILLW = Math.max(opts.blueprint ? (bpMobile ? 43 : 37) : 47, Math.max.apply(null, D.map(function (d) {
      return d.label.length * labelUnit;
    }))) + (opts.blueprint ? (bpMobile ? 20 : 18) : 24), PILLH = opts.blueprint ? (bpMobile ? 36 : 32) : 41;
    /* 維度名離圓心多遠。有膠囊時要再往外推 —— 1.15 時膠囊會貼著五邊形的頂點，很擠。 */
    var LABF = opts.comment ? 1.25 : 1.15;

    /* 維度名下方放小型菱形程度。它只提示 1–5 級，不搶走形狀本身的主角位置。 */
    D.forEach(function (d, i) {
      /* 手機的人物與雷達採不同縮放比例；最上方卡片若仍用桌機的 1.25，
         會剛好壓到頭頂。這裡刻意拉到 1.54，保留可辨識的空隙，
         不是只移幾個像素；其餘四張不動。 */
      var labelFactor = opts.blueprint
        ? (i === 0 ? (bpMobile ? 1.54 : LABF) : 1.20)
        : LABF;
      var p = pt(i, rad(vals[d.k])), lp = pt(i, labelFactor);
      var anchor = Math.abs(lp[0] - CX) < 6 ? 'middle' : (lp[0] > CX ? 'start' : 'end');
      /* 膠囊尺寸是算出來的，不是量出來的。用 getBBox() 會在畫面還沒顯示時回傳 0，
         這張圖是切到報告頁才渲染的，量不到（踩過同類的坑太多次）。
         ⚠️ 寬度要取「維度名」和「五顆菱形」的**較大者**。只照字數算的話，
         三個字的維度（生活圈）膠囊比底下那排菱形還窄，看起來就是排壞了。 */
      /* 藍圖五張維度卡維持同一規格。人格魅力不再額外放大，整組才不會頭重腳輕。 */
      var bw = PILLW, bh = PILLH;
      var bx = anchor === 'middle' ? lp[0] - bw / 2 : (anchor === 'start' ? lp[0] - 8 : lp[0] - bw + 8);
      /* ⚠️ 兩行字一律 text-anchor="middle" 對齊**膠囊中心**，不能沿用外圈的
         start/end —— 沿用的話左右兩側的菱形會貼著膠囊邊緣，只有維度名是滿的，
         整個看起來歪掉（踩過，這就是「文字沒有置中」的原因）。 */
      var tx = (bx + bw / 2).toFixed(1);
      /* 垂直也要對齊：中文字幾乎佔滿字身，內容實際是 lp[1]-11.9 到 lp[1]+14，
         中心在 lp[1]+1，所以 y = lp[1]+1-bh/2。照 lp[1] 減半高會偏低 2px。 */
      var by = (lp[1] + 1 - bh / 2).toFixed(1);
      /* 分工：**低段用膠囊底色**（整顆泛 salmon，一眼掃得到），
         **最低的那一條用頂點菱形的脈動**（把視線拉回圖上）。
         細棒維持五顆一致 —— 只改細棒顏色太不明顯（試過）。
         ⚠️ lead 一定要宣告在這裡，不能放到下面 —— var 會被 hoist，
         放在 vtx 後面不會報錯，但值是 undefined，data-lead 永遠不會出現。 */
      var lead = opts.lead === d.k;
      /* 最低那顆菱形本身也放大 —— 只靠閃爍的話，閃到暗的那半個週期就找不到它了。 */
      g += '<polygon class="vtx" style="--i:' + i + '"' + (lead ? ' data-lead' : '') + ' points="'
          + diamondPoints(p[0], p[1], lead ? 5.6 : 4.2) + '"/>';
      /* 外形照抄藍圖的能力卡（.bpcdim）：右上角斜切、直角框、左邊一條 salmon 細棒。
         卡片切 16px／高約 100，等比縮到 41 高的膠囊就是 9。 */
      var CUT = opts.blueprint ? (bpMobile ? 7 : 6) : 9, x2 = bx + bw, y2 = +by + bh;
      var pd = 'M' + bx.toFixed(1) + ',' + by + 'H' + (x2 - CUT).toFixed(1)
        + 'L' + x2.toFixed(1) + ',' + (+by + CUT).toFixed(1)
        + 'V' + y2.toFixed(1) + 'H' + bx.toFixed(1) + 'Z';
      var mid = opts.comment ? 'middle' : anchor, ltx = opts.comment ? tx : lp[0].toFixed(1);
      var levelOffset = opts.blueprint ? (bpMobile ? 11 : 9.5) : 14;
      var lab = '<text class="lb" style="--i:' + i + '" x="' + ltx + '" y="'
          + lp[1].toFixed(1) + '" text-anchor="' + mid + '">' + d.label + '</text>'
        + '<text class="lv" style="--i:' + i + '" x="' + ltx + '" y="'
          + (lp[1] + levelOffset).toFixed(1) + '" text-anchor="' + mid + '">'
          + degreeText(vals[d.k]) + '</text>';
      /* 只有評語模式才把維度名包成按鈕；其他呼叫點（評測頁的小圖）維持純文字。 */
      g += opts.comment
        ? '<g class="lbtn" style="--i:' + i + '" data-k="' + d.k + '"'
            + ' data-band="' + SC.bandOf(vals[d.k]) + '"' + (lead ? ' data-lead' : '')
            + ' role="button" tabindex="0"'
            + ' aria-label="看 ' + d.label + ' 的評語'
            + (lead ? '（最需要先動的一條）' : '') + '">'
            + '<path class="pillbg" d="' + pd + '"/><path class="pill" d="' + pd + '"/>'
            + '<rect class="pillbar" x="' + bx.toFixed(1) + '" y="' + (+by + (opts.blueprint ? (bpMobile ? 8 : 7) : 10)).toFixed(1)
            + '" width="' + (opts.blueprint ? (bpMobile ? 1.6 : 1.4) : 2) + '" height="' + (bh - (opts.blueprint ? (bpMobile ? 16 : 14) : 20)) + '"/>'
            + lab + '</g>'
        : lab;
    });

    /* ⚠️ viewBox 要跟著膠囊算，不能寫死 —— 膠囊往外推之後左右兩顆會超出 0..400
       被切掉（`overflow: visible` 只是讓它畫出去，會壓到旁邊的東西）。
       右邊那顆最遠：lp[0] - 8 + PILLW；上下同理各留 PILLH/2。MARG 是呼吸空間。 */
    /* 手機第 1 張卡片上移後要同步把 viewBox 的上界打開；
       否則位置雖然正確，卡片仍會被 SVG 自己裁掉。 */
    var VB = opts.blueprint && bpMobile ? '0 -24 ' + W + ' 372' : '0 18 ' + W + ' 330';
    if (opts.comment && !opts.blueprint) {
      var MARG = 6, LR = R * LABF;
      var halfW = Math.cos(Math.PI / 10) * LR + PILLW - 8 + MARG;
      var vy = CY - LR - PILLH / 2 + 1 - MARG;
      var vh = (CY + Math.sin(Math.PI * 0.3) * LR + PILLH / 2 + 1 + MARG) - vy;
      VB = (CX - halfW).toFixed(1) + ' ' + vy.toFixed(1) + ' '
         + (halfW * 2).toFixed(1) + ' ' + vh.toFixed(1);
    }
    node.innerHTML = '<svg viewBox="' + VB + '" class="radar" role="img" aria-label="'
      + D.map(function (d) { return d.label + ' 程度 ' + SC.starOf(vals[d.k]) + '／5'; }).join('、') + '">' + g + '</svg>';

    /* ── 中央評語 ─────────────────────────────────────
       滑到（或點到）某一維，就在雷達圖正中央顯示那一維的教練評語。
       ⚠️ 文字用 **HTML 疊層**不用 SVG <text> —— SVG 沒有自動換行，
       中文評語一定要換行。疊層的百分比是對著 .chart 算的，
       所以 .chart 的 max-width 必須跟 .radar 一樣（420），兩者才會同心。 */
    if (opts.comment) {
      var box = document.createElement('div');
      box.className = 'rcmt';
      node.appendChild(box);       /* 一開始是空的 —— 沒有提示字，點了才出現 */
      var cur = null;
      function show(k) {
        var btns = node.querySelectorAll('.lbtn');
        [].forEach.call(btns, function (b) { b.classList.toggle('sel', b.getAttribute('data-k') === k); });
        cur = k;
        if (!k) { box.classList.remove('on'); box.textContent = ''; return; }
        var d = null;
        D.forEach(function (x) { if (x.k === k) d = x; });
        if (!d) return;
        var comment = opts.comments && typeof opts.comments[k] === 'string' ? opts.comments[k] : '';
        /* 報告只顯示教練親自填寫的維度說明，不再從 bands 自動生成評語。 */
        box.innerHTML = '<b>' + esc(d.label) + '</b><p>' + esc(comment) + '</p>'
          + '<button type="button" class="rx" aria-label="收起評語">×</button>';
        /* 換維度時要重播動畫。animation 不會因為改內容自己重跑，
           必須先拿掉 class、強迫重排、再加回去（.bands 那邊踩過同一個坑）。 */
        box.classList.remove('on');
        void box.offsetWidth;
        box.classList.add('on');
        var hint = document.getElementById('chint');
        if (hint) hint.classList.add('used');   /* 用 opacity 不用 display —— 版面不能跳 */
      }
      /* 收起來的方式：點面板、點右上角 ×、再點一次同一個維度名、
         或**點畫面上任何其他地方**。維度名自己有 handler，要放行。
         ⚠️ 監聽掛在 document 上，而報告頁每次重繪都會再跑一次 drawRadar，
         不先移除舊的就會一直疊上去（舊的閉包還抓著已經被換掉的 box）。 */
      if (drawRadar._off) document.removeEventListener('click', drawRadar._off);
      drawRadar._off = function (e) {
        if (!cur) return;
        if (e.target.closest && e.target.closest('.lbtn')) return;
        show(null);
      };
      document.addEventListener('click', drawRadar._off);
      [].forEach.call(node.querySelectorAll('.lbtn'), function (b) {
        var k = b.getAttribute('data-k');
        function toggle() { show(cur === k ? null : k); }
        b.addEventListener('click', toggle);
        /* SVG <g> 不是原生按鈕，Enter／空白鍵要自己接，不然只有滑鼠能用。 */
        b.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      });
    }

    var shapes = node.querySelectorAll('.fill,.glow1,.glow2,.line');
    var vtx = node.querySelectorAll('.vtx');
    var levels = node.querySelectorAll('.lv');
    var cur = {}, anim = 0;        // anim 是動畫代號：新的動畫一開始就讓舊的失效
    D.forEach(function (d) { cur[d.k] = vals[d.k]; });

    function setPts(x) { [].forEach.call(shapes, function (n) { n.setAttribute('points', x); }); }

    /* 畫出一組值：多邊形、頂點、數字、差值。播放時只走這條路，不重建 DOM。 */
    function draw(v, ghost) {        // 純繪製，動畫每一帧都走這裡
      setPts(poly(1, v));
      D.forEach(function (d, i) {
        var p = pt(i, rad(v[d.k]));
        if (vtx[i]) vtx[i].setAttribute('points', diamondPoints(p[0], p[1], 4.2));
        if (levels[i]) levels[i].textContent = degreeText(v[d.k]);
      });
    }
    function paint(v, ghost) {       // 立即定版：作廢進行中的動畫再畫
      anim++;
      draw(v, ghost);
    }

    /* 補間到下一組值。播放時用這個，所以不會有「跳一下」的感覺。 */
    function tween(next, dur, ghost) {
      var from = {}, me = ++anim;
      D.forEach(function (d) { from[d.k] = cur[d.k]; });
      D.forEach(function (d) { cur[d.k] = next[d.k]; });
      if (reduce) { draw(next, ghost); return; }
      var t0 = null, done = false, mix = {};
      function step(t) {
        if (done || me !== anim) return;
        if (t0 === null) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        D.forEach(function (d) { mix[d.k] = from[d.k] + (next[d.k] - from[d.k]) * e; });
        draw(mix, ghost);
        if (k < 1) requestAnimationFrame(step); else done = true;
      }
      requestAnimationFrame(step);
      setTimeout(function () {          // rAF 節流時保底
        done = true;
        if (me === anim) draw(next, ghost);
      }, dur + 200);
    }

    if (!(reduce || opts.animate === false)) {
      /* 首次進場：從圓心長出來。先畫最終形狀，rAF 真的跑起來才縮回圓心，並用計時器保底。 */
      var t0 = null, dur = 1200, delay = 400, done = false, me = ++anim;
      (function () {
        function step(t) {
          if (done || me !== anim) return;
          if (t0 === null) { t0 = t; setPts(poly(0)); }
          var e = t - t0 - delay;
          if (e < 0) return requestAnimationFrame(step);
          var k = Math.min(1, e / dur);
          setPts(poly(1 - Math.pow(1 - k, 3), vals));
          if (k < 1) requestAnimationFrame(step); else done = true;
        }
        requestAnimationFrame(step);
        setTimeout(function () {
          done = true;
          if (me === anim) setPts(finalPts);
        }, delay + dur + 250);
      })();
    }

    return { paint: paint, tween: tween };
  }

  /* ── 基準分佈曲線 ─────────────────────────────────────
     畫的是 raw 分數的分佈（鐘形），不是百分位 —— 百分位依建構就是 1–99 均勻，
     畫出來會是一條直線。標記位置用 r.raw[k]，標籤寫百分位。
     ⚠️ **這條曲線是模擬作答（亂數）跑出來的，不是真人的分佈。**
     文案必須說清楚，否則會被讀成「我贏過多少人」。見 SCORING.md。 */

  /* ── 報告頁 ───────────────────────────────────────── */

  var REPORT_EDIT = false;

  /* ── 雷達的分數從哪裡來 ──────────────────────────────
     2026-09-12 使用者：「雷達的分數是基於前面的題目測出來的，
     而教練可以手動再調整加減。」
     所以基準 = 25 道計分題算出來的百分位，教練只動 adjust（±級）。
     ⚠️ 教練**不是**從零填分數 —— 那會讓 25 道計分題失去意義。 */

  function reportBase() {
    return window.UC_SCORE.score(S.answers);
  }

  /** 某一維在雷達上要畫的值（百分位）。沒調整就用原始測出來的值。 */
  function reportValue(k, r, cr) {
    var adj = reportAdjust(k, cr);
    if (!adj) return r.show[k];
    var n = reportStar(k, r, cr);
    return window.UC_SCORE.starMid[n - 1];
  }

  function reportAdjust(k, cr) {
    var a = Math.round(Number(cr.adjust[k]) || 0);
    return Math.max(-2, Math.min(2, a));
  }

  /** 加減之後的最終星等 1–5。 */
  function reportStar(k, r, cr) {
    var base = window.UC_SCORE.starOf(r.show[k]);
    return Math.max(1, Math.min(5, base + reportAdjust(k, cr)));
  }

  /** 起點星等加上教練記下的進步，封頂 5。 */
  function progressStar(k, r, cr) {
    var p = Math.max(0, Math.round(Number((cr.progress || {})[k]) || 0));
    return Math.min(5, reportStar(k, r, cr) + p);
  }

  /* 最終星等寫回 cr.scores —— 後端的 report.score.<k> 欄位讀的是這個。
     每次 adjust 變動或作答變動都要跑一次，否則試算表會存到過期的分數。 */
  function syncCoachScores(cr, r) {
    window.UC_DIMENSIONS.dims.forEach(function (d) {
      cr.scores[d.k] = reportStar(d.k, r, cr);
    });
  }

  function coachReportValid() {
    /* 分數不再是「要填的欄位」—— 題目已經算出基準，adjust 預設 0 本來就合法。
       教練真正要交的是五段維度說明和一封信。 */
    var cr = S.coachReport || normalizeCoachReport();
    return window.UC_DIMENSIONS.dims.every(function (d) {
      return typeof cr.notes[d.k] === 'string' && cr.notes[d.k].trim() !== '';
    }) && typeof cr.letter === 'string' && cr.letter.trim() !== '';
  }

  function coachReportReady() {
    return !!(S.coachReport && S.coachReport.complete && coachReportValid());
  }

  function coachReportValues(r, cr) {
    cr = cr || S.coachReport || normalizeCoachReport();
    r = r || reportBase();
    var vals = {};
    window.UC_DIMENSIONS.dims.forEach(function (d) { vals[d.k] = reportValue(d.k, r, cr); });
    return vals;
  }

  function coachReportLow(r, cr) {
    cr = cr || S.coachReport || normalizeCoachReport();
    r = r || reportBase();
    var dims = window.UC_DIMENSIONS.dims;
    return dims.slice().sort(function (a, b) {
      return reportValue(a.k, r, cr) - reportValue(b.k, r, cr);
    })[0].k;
  }

  /* 舊資料曾把中英文署名拆成兩欄；畫面改成單欄後仍先合併顯示，
     等教練下一次編輯時再收斂成 coachName，避免既有英文署名消失。 */
  function coachSignature(cr) {
    return [cr.coachName, cr.coachEnglishName].map(function (v) {
      return String(v || '').trim();
    }).filter(Boolean).join(' ');
  }

  /* 一列的星等顯示：題目測出來的基準、教練的加減、最終結果。
     **只重畫這一小塊**，不動 textarea（重畫會讓游標跳掉）。 */
  function crRowScoreHTML(d, r, cr) {
    var base = window.UC_SCORE.starOf(r.show[d.k]);
    var adj = reportAdjust(d.k, cr);
    var fin = reportStar(d.k, r, cr);
    return '<span class="crbase">題目測出 <b>' + base + '</b></span>'
      + '<span class="crstep">'
      + '<button type="button" data-report-adj="' + d.k + '" data-d="-1" aria-label="調降一級"'
      + (adj <= -2 || fin <= 1 ? ' disabled' : '') + '>−</button>'
      + '<i class="crfin">' + fin + '<s>／5</s></i>'
      + '<button type="button" data-report-adj="' + d.k + '" data-d="1" aria-label="調升一級"'
      + (adj >= 2 || fin >= 5 ? ' disabled' : '') + '>＋</button></span>'
      + '<span class="cradj' + (adj ? ' on' : '') + '">'
      + (adj ? '教練 ' + (adj > 0 ? '+' : '') + adj + ' 級' : '未調整') + '</span>';
  }

  function renderCoachReportEditor(body) {
    var dims = window.UC_DIMENSIONS.dims;
    var cr = S.coachReport || normalizeCoachReport();
    S.coachReport = cr;
    var r = reportBase();
    syncCoachScores(cr, r);

    var rows = dims.map(function (d) {
      return '<section class="crrow">'
        + '<div class="crmeta"><div><p class="ey">Dimension</p><h3>' + esc(d.label) + '</h3></div>'
        + '<div class="crscore" data-report-score="' + d.k + '"'
        + ' data-field-id="report.score.' + d.k + '" data-field-owner="coach">'
        + crRowScoreHTML(d, r, cr) + '</div></div>'
        + (d.facets && d.facets.length ? '<p class="crfacet">' + esc(d.facets.join('・')) + '</p>' : '')
        + '<label class="crnote">維度說明<textarea rows="4" data-report-note="' + d.k + '"'
        + ' data-field-id="report.note.' + d.k + '" data-field-owner="coach"'
        + ' placeholder="請填寫這個維度目前的狀態、觀察與建議。">'
        + esc(cr.notes[d.k] || '') + '</textarea></label></section>';
    }).join('');

    body.innerHTML = '<section class="assessreport">' + wrap('<header class="rhead">'
      + '<p class="ey">Coach Review ・ ' + answeredCount() + '/' + window.UC_SCORE.questions.length + ' 題</p>'
      + '<h1>完成教練評測</h1><div class="divider"><i></i><s></s></div>'
      + '<p class="lead">五個維度的分數已經由 25 道計分題算出來了。看完之後如果跟你實際互動的判斷不同，用 ＋／− 調整；'
      + '再替每個維度寫說明，最後寫一封信。全部完成後，學員才會看到報告。</p>'
      + '</header>')
      + '<div class="paper"><section><div class="wrap creview">'
      + '<div class="crstatus"><p class="fieldtag coach">教練填寫</p><p id="crProgress"></p></div>'
      + '<div class="crgrid">' + rows + '</div>'
      + '<label class="crletter">寫給學員的一封信<textarea rows="8" data-report-letter'
      + ' data-field-id="report.letter" data-field-owner="coach"'
      + ' placeholder="請寫下你對這位學員整體狀況的理解，以及接下來最重要的一步。">'
      + esc(cr.letter) + '</textarea></label>'
      + '<section class="crsignature"><div><p class="ey">Coach Signature</p><h3>教練署名</h3>'
      + '<p>中文或英文都填在同一格，會以同一款手寫簽名字體呈現。</p></div>'
      + '<label>署名<input type="text" data-report-coach-name'
      + ' data-field-id="report.coachName" data-field-owner="coach" placeholder="例如：王大明 Daniel" value="'
      + esc(coachSignature(cr)) + '"></label>'
      + '<div class="sigpreview"><span>' + esc(coachSignature(cr) || 'Coach Signature') + '</span></div></section>'
      + '<div class="crfoot"><p>未完成前，學員不會看到任何評測內容。</p>'
      + '<button type="button" class="btn pri" id="finishReport">完成評測並開放藍圖</button></div>'
      + '</div></section></div></section>';

    function syncReview() {
      /* 分數不算進待填欄位 —— 題目已經給了基準，教練要交的是 5 段說明＋1 封信。 */
      var filled = 0;
      dims.forEach(function (d) {
        if (typeof cr.notes[d.k] === 'string' && cr.notes[d.k].trim()) filled++;
      });
      if (cr.letter.trim()) filled++;
      var p = el('crProgress'), done = coachReportValid();
      if (p) p.textContent = '已完成 ' + filled + ' / 6 個欄位（五段說明＋一封信）';
      var btn = el('finishReport');
      if (btn) btn.disabled = !done;
    }

    /* ⚠️ 事件委派掛在 .crgrid 上，不是掛在每顆按鈕上 ——
       按一下就要重畫那一列（禁用狀態會變），掛在按鈕上重畫後監聽就沒了。 */
    var grid = body.querySelector('.crgrid');
    if (grid) grid.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-report-adj]');
      if (!b || b.disabled) return;
      var k = b.dataset.reportAdj;
      var box = grid.querySelector('.crscore[data-report-score="' + k + '"]');
      if (box && box.dataset.fieldAccess === 'read') return;
      var d = null;
      dims.forEach(function (x) { if (x.k === k) d = x; });
      var next = reportAdjust(k, cr) + Number(b.dataset.d);
      /* 已經頂到 1★ 或 5★ 就不再累積 adjust —— 否則會存進一個看不見的偏移，
         之後學員改答案基準變了，分數會突然跳好幾級。 */
      var wouldBe = window.UC_SCORE.starOf(r.show[k]) + next;
      if (wouldBe < 1 || wouldBe > 5 || next < -2 || next > 2) return;
      cr.adjust[k] = next;
      syncCoachScores(cr, r);
      cr.complete = false; save();
      box.innerHTML = crRowScoreHTML(d, r, cr);
    });
    [].forEach.call(body.querySelectorAll('[data-report-note]'), function (textarea) {
      grow(textarea);
      textarea.addEventListener('input', function () {
        cr.notes[textarea.dataset.reportNote] = textarea.value;
        cr.complete = false; save(); grow(textarea); syncReview();
      });
    });
    var letter = body.querySelector('[data-report-letter]');
    if (letter) {
      grow(letter);
      letter.addEventListener('input', function () {
        cr.letter = letter.value; cr.complete = false; save(); grow(letter); syncReview();
      });
    }
    var coachName = body.querySelector('[data-report-coach-name]');
    function syncSignature() {
      var preview = body.querySelector('.sigpreview');
      if (!preview) return;
      preview.querySelector('span').textContent = coachSignature(cr) || 'Coach Signature';
    }
    if (coachName) coachName.addEventListener('input', function () {
      cr.coachName = coachName.value;
      cr.coachEnglishName = '';
      cr.complete = false; save(); syncSignature();
    });
    el('finishReport').addEventListener('click', function () {
      if (!coachReportValid()) return;
      cr.complete = true; REPORT_EDIT = false; save(); renderAssess();
    });
    syncReview();
    applyFieldAccess(body);
    reveal(body);
  }

  function notifyCoachAssessment() {
    var text = '【評測完成通知】\n我是' + (S.name || '學員') + '，已完成情感能力評測，請教練查看。';
    var action = window.UC_SHARE && window.UC_SHARE.current
      ? window.UC_SHARE.current(text)
      : window.UC_SHARE && window.UC_SHARE.copy ? window.UC_SHARE.copy(text) : Promise.resolve('fail');
    action.then(function (how) {
      if (how === 'send') toast('已通知教練');
      else if (how === 'copy') toast('通知文字已複製，可以貼到教練群組');
      else toast('無法傳送，請手動通知教練');
    });
  }

  function renderAssessReview(body) {
    if (!body) return;
    if (!coachReportReady()) {
      if (ACTOR_ROLE === 'student') {
        body.innerHTML = wrap('<div class="empty assesswaiting"><p class="ey">Coach Review</p>'
          + '<h1>教練正在完成評測</h1><div class="divider"><i></i><s></s></div>'
          + '<p>教練完成五個維度的判讀、說明與一封信後，能力雷達會在藍圖開放。</p></div>');
        return;
      }
      renderCoachReportEditor(body);
      return;
    }
    if (REPORT_EDIT && ACTOR_ROLE !== 'student') {
      renderCoachReportEditor(body);
      return;
    }

    var CO = window.UC_COACH, cr = S.coachReport;
    body.innerHTML = '<section class="assessreport assessletter">'
      + wrap('<header class="rhead"><p class="ey">Coach Review ・ Complete</p>'
        + '<h1>教練的信</h1><div class="divider"><i></i><s></s></div></header>')
      + '<div class="paper">' + wrap('<div class="letter">'
        + '<p class="lsalu">' + esc(S.name || '學員') + '，你好：</p>'
        + '<div class="lbody"><p class="lpara">' + esc(cr.letter) + '</p></div>'
        + '<div class="lsign"><span>' + esc(coachSignature(cr) || CO.name) + '</span>'
        + '<small>' + esc(CO.title) + '</small></div>'
        + (CO.signedOn ? '<p class="ldate">' + esc(CO.signedOn) + '</p>' : '')
        + '</div>', 'rv') + '</div>'
      /* ⚠️ 這顆原本「看不到但按得到」：評測頁是米白底，而 .btn.gh 是米白字、米白框 ——
         同色疊在一起就隱形了（使用者 2026-09-24：「對著空氣按有開啟」）。
         樣式在 .assessreport-actions 裡改成深藍。 */
      + (ACTOR_ROLE !== 'student' ? '<div class="assessreport-actions"><button type="button" class="btn gh"'
        + ' id="editReport">編輯教練評測</button></div>' : '') + '</section>';
    var edit = el('editReport');
    if (edit) edit.addEventListener('click', function () { REPORT_EDIT = true; renderAssess(); });
    reveal(body);
  }

  /* ── 學員清單（只有教練看得到）─────────────────────
     ⚠️ 這一頁只是**入口**，不是權限。真正的權限在 GAS：
     student.list 與 student.load 都會對綁定表的 access_scope。
     前端把 nav 的 hidden 拿掉也讀不到別人的資料。 */

  var STUDENTS = null;
  var ST_SORTS = { start: '開始日', name: '名字', progress: '進度' };
  var ST_SORT = (function () { try { return localStorage.getItem('uc_stsort') || 'start'; } catch (e) { return 'start'; } })();

  /* 換學員時的讀取狀態。
     ⚠️ **不要做假的百分比。** 條子只表示「相對於實測的常態值跑到哪」，
     跑到 88% 就停住 —— 剩下那段本來就不知道還要多久，畫滿只是在騙人。
     一旦超過常態值就改報**實際秒數**，超過 8 秒直說「比平常久」。
     常態值 2600ms 是 2026-09-18 量出來的（student.load 約 2.4～2.9 秒）。 */
  var ST_EXPECT = 2600;

  function stBusy(btn) {
    btn.classList.add('is-busy');
    var stage = btn.querySelector('.ststage');
    var bar = btn.querySelector('.stbar u');
    var was = stage ? stage.textContent : '';
    var t0 = Date.now();
    if (bar) bar.classList.add('is-load');

    function tick() {
      var ms = Date.now() - t0, sec = (ms / 1000).toFixed(1);
      if (bar) bar.style.width = Math.min(88, Math.round(ms / ST_EXPECT * 88)) + '%';
      if (!stage) return;
      stage.textContent = ms < ST_EXPECT ? '讀取中…'
        : (ms < 8000 ? '讀取中　' + sec + ' 秒' : '比平常久　' + sec + ' 秒');
    }
    tick();
    var timer = setInterval(tick, 120);

    return function (ok) {
      clearInterval(timer);
      if (bar) { bar.style.width = ok ? '100%' : '0%'; bar.classList.remove('is-load'); }
      if (!ok) {
        btn.classList.remove('is-busy');
        if (stage) stage.textContent = was;      /* 失敗就把原本的階段字還回去 */
      }
    };
  }

  function renderStudents() {
    var body = el('studentsBody');
    if (!window.UC_STORE || !window.UC_STORE.isRemote()) {
      body.innerHTML = wrap('<div class="empty"><p class="ey">Coach</p>'
        + '<h1>還沒連上後端</h1><div class="divider"><i></i><s></s></div>'
        + '<p>這一頁要從 LINE 登入才看得到。</p></div>');
      return;
    }
    if (!STUDENTS) {
      body.innerHTML = wrap('<div class="empty"><p class="ey">Coach</p>'
        + '<h1>載入學員清單…</h1></div>');
      window.UC_STORE.listStudents().then(function (list) {
        STUDENTS = list; renderStudents();
      }).catch(function (e) {
        body.innerHTML = wrap('<div class="empty"><p class="ey">Coach</p>'
          + '<h1>讀不到學員清單</h1><div class="divider"><i></i><s></s></div>'
          + '<p>' + esc((e && e.message) || '') + '</p></div>');
      });
      return;
    }

    var total = window.UC_SCORE.questions.length;
    var cur = window.UC_STORE.studentId();
    /* 範例學員只用下面那顆按鈕開，不在清單裡再出現一次（使用者 2026-09-17）。 */
    var demo = window.UC_STORE.demoStudentId();
    var list = STUDENTS.filter(function (x) { return x.id !== demo; });
    /* 排序只是看法，不存後端；沒設開始日的一律排最後。 */
    var by = ST_SORTS[ST_SORT] ? ST_SORT : 'start';
    list.sort(function (p, q) {
      if (by === 'name') return String(p.name || p.lineName || p.id).localeCompare(String(q.name || q.lineName || q.id), 'zh-Hant');
      if (by === 'progress') return (q.answered - p.answered) || (q.reportComplete - p.reportComplete);
      if (!p.growthStart !== !q.growthStart) return p.growthStart ? -1 : 1;
      return p.growthStart < q.growthStart ? 1 : p.growthStart > q.growthStart ? -1 : 0;
    });
    var sortBar = '<div class="stsort" role="group" aria-label="排序">' + Object.keys(ST_SORTS).map(function (k) {
      return '<button type="button" data-stsort="' + k + '"' + (k === by ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"')
        + '>' + ST_SORTS[k] + '</button>';
    }).join('') + '</div>';
    var rows = list.map(function (x) {
      /* ⚠️ 上限 100 —— 後端如果又算進不是題目的列，至少不要讓進度條爆出格子外。
         真正的修法在 studentList_ 的 NOT_A_QUESTION，這裡只是防線。 */
      var pct = total ? Math.min(100, Math.round(x.answered / total * 100)) : 0;
      var stage = x.reportComplete ? '報告已開放'
                : (x.answered >= total ? '等你評測' : '填答中');
      return '<button type="button" class="strow' + (x.id === cur ? ' is-cur' : '') + '"'
        + ' data-student="' + esc(x.id) + '" title="' + esc(x.id) + '">'
        /* ⚠️ 一列 = 一個人，塞得下就不要換行（使用者 2026-09-18：挑學員要更快）。
           id 從主要位置拿掉 —— 挑人用的是名字，id 只有對帳時才需要。
           LINE 名稱只在「跟姓名不一樣」時才補一句。 */
        + '<b class="stname">' + esc(x.name || x.lineName || x.id) + '</b>'
        + (x.lineName && x.name && x.lineName !== x.name
            ? '<s class="stid">' + esc(x.lineName) + '</s>' : '')
        + '<span class="ststart">' + (x.growthStart ? esc(x.growthStart.replace(/-/g, '.')) + ' 開始' : '未設開始日') + '</span>'
        + '<em class="ststage">' + esc(stage) + '</em>'
        + '<span class="stnum">' + x.answered + '/' + total + '</span>'
        + '<i class="stbar"><u style="width:' + pct + '%"></u></i>'
        + '</button>';
    }).join('');

    /* 範例學員：所有教練共用同一位，拿來練手或給人看都不會動到真學員。
       id 由後端給（只有 manage 拿得到），前端不寫死。 */
    var demoBtn = demo
      ? '<button type="button" class="stdemo' + (demo === cur ? ' is-cur' : '') + '"'
        + ' data-student="' + esc(demo) + '">開啟示範學員'
        + '<s>' + esc(demo) + '　所有教練共用，可以隨便改</s></button>'
      : '';

    body.innerHTML = wrap('<header class="rhead"><p class="ey">Coach ・ ' + list.length + ' 位</p>'
      + '<h1>學員清單</h1><div class="divider"><i></i><s></s></div>'
      + '<p class="lead">點一位學員，下面每一頁看到的就是他的資料。</p></header>')
      /* 範例學員放最上面（使用者 2026-09-18）。 */
      + wrap(demoBtn + (list.length > 1 ? sortBar : '') + '<div class="stlist">'
             + (rows || '<p class="bpnone">還沒有學員綁定。</p>') + '</div>', 'rv');

    [].forEach.call(body.querySelectorAll('[data-stsort]'), function (b) {
      b.addEventListener('click', function () {
        ST_SORT = b.dataset.stsort;
        try { localStorage.setItem('uc_stsort', ST_SORT); } catch (e) {}
        renderStudents();
      });
    });
    [].forEach.call(body.querySelectorAll('[data-student]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.student;
        var done = stBusy(b);
        window.UC_STORE.switchStudent(id).then(function () {
          done(true);
          STUDENTS = null;                  /* 進度會變，下次重讀 */
          toast('目前看的是 ' + id);
          nav('#/assess');
        }).catch(function (e) {
          done(false);
          toast((e && e.message) || '換不過去，請再試一次');
        });
      });
    });
    reveal(body);
  }

  /* ── 課程藍圖 ─────────────────────────────────────────
     主畫面把人物與當前任務合在一起；任務卡可超過五張，卡片區自行捲動。
     「書」仍保留完整藍圖；人物不會帶進書頁，也不在這裡放週次或成長縮圖。 */
  var OKRVIEW = 'tasks', OKRSEL = null;
  var BKLEVEL = 'idx', BKOPEN = null;   /* 書：左頁在哪一層／看哪一維 */
  var TASKMODAL = null, TASKRETURN = null;

  function isCurrentTask(id) {
    return !!(S.taskNow && S.taskNow[id]) && !isHidden(id) && !(S.done && S.done[id]);
  }

  function currentTaskItems() {
    /* 越晚勾的排越上面；同一時間（或舊資料沒時間）照藍圖順序。Array#sort 是穩定的。 */
    return window.UC_OKR.items.filter(function (it) { return isCurrentTask(it.id); })
      .sort(function (a, b) { return (S.taskNow[b.id] || 0) - (S.taskNow[a.id] || 0); });
  }

  function blueprintProgressText() {
    var dims = {};
    window.UC_DIMENSIONS.dims.forEach(function (d) { dims[d.k] = d.label; });
    var items = currentTaskItems();
    var lines = ['【' + (S.name || '學員') + '的目前任務】'];
    if (!items.length) lines.push('目前尚未安排任務。');
    items.forEach(function (it, i) {
      lines.push((i + 1) + '. ' + it.kr);
      lines.push('主題：' + (it.sub || dims[it.dim] || it.dim));
      if (it.tool) lines.push('教材：' + it.tool);
      if (it.sheet) lines.push('作業：' + it.sheet);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function taskItem(id) {
    if (!isCurrentTask(id)) return null;
    return window.UC_OKR.items.filter(function (it) { return it.id === id; })[0] || null;
  }

  function isHidden(id) {
    return !!(S.hidden && S.hidden[id]);
  }

  function completedCount() {
    return window.UC_OKR.items.filter(function (it) { return S.done && S.done[it.id]; }).length;
  }

  function taskDetail(it) {
    var ui = window.UC_OKR.taskUI;
    return it.note || ui.defaultDetail;
  }

  function taskToolKey(it) {
    if (!it || !it.sheet) return '';
    return window.UC_OKR.taskToolMap[it.sheet] || '';
  }

  /* 教材欄對得到哪一堂課的連結。對得到才會出現「傳送」。
     ⚠️ 用**課名**比對，不是 id —— 教練在試算表上看到與選到的就是課名。
     課名改了、連結還沒貼、或教練自己打了一段字 —— 都只是沒有按鈕，不會壞。 */
  function taskCourseUrl(it) {
    var L = window.UC_LIBRARY;
    if (!it || !it.tool || !L || !L.items) return '';
    var hit = L.items.filter(function (i) { return i.t === it.tool; })[0];
    return hit && /^https?:\/\//i.test(hit.src || '') ? hit.src : '';
  }

  /* 教材對到的是清單型的卡（推薦電影、推薦書單）—— 傳送就是打開那份清單。 */
  function taskCourseList(it) {
    var L = window.UC_LIBRARY;
    if (!it || !it.tool || !L || !L.items) return '';
    var hit = L.items.filter(function (i) { return i.t === it.tool && i.list; })[0];
    return hit ? hit.id : '';
  }

  /* 清單型教材：借任務視窗的外框顯示一頁文字清單。
     ⚠️ 不另做一套浮層 —— 焦點、Esc、點背景關閉都跟任務視窗同一條路。 */
  function openLibList(id, trigger) {
    var i = window.UC_LIBRARY.items.filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    var m = ensureTaskModal();
    TASKRETURN = trigger || document.activeElement;
    var rows = (i.list || []).map(function (x) {
      var url = /^https?:\/\//i.test(x.src || '') ? x.src : '';
      return '<li><div class="liblist-head"><b>' + esc(x.t) + '</b>'
        + (x.sub ? '<s>' + esc(x.sub) + '</s>' : '')
        + (x.len ? '<em class="num">' + esc(x.len) + '</em>' : '')
        + (url ? '<button type="button" class="taskgo" data-task-url="' + esc(url) + '">開啟</button>' : '')
        + '</div>' + (x.body ? '<p>' + esc(x.body) + '</p>' : '') + '</li>';
    }).join('');
    m.innerHTML = '<section class="taskpanel liblist" role="dialog" aria-modal="true" aria-labelledby="libListTitle" tabindex="-1">'
      + '<i class="taskbrk taskbrk-tl" aria-hidden="true"></i><i class="taskbrk taskbrk-tr" aria-hidden="true"></i>'
      + '<i class="taskbrk taskbrk-bl" aria-hidden="true"></i><i class="taskbrk taskbrk-br" aria-hidden="true"></i>'
      + '<button type="button" class="taskx" data-task-close="1" aria-label="關閉">×</button>'
      + '<p class="taskey">Reading ・ ' + esc(i.no) + '</p>'
      + '<h2 id="libListTitle">' + esc(i.t) + '</h2>'
      + '<div class="taskrule"><i></i><s></s></div>'
      + (i.listLead ? '<p class="taskbody">' + esc(i.listLead) + '</p>' : '')
      + '<ol class="liblist-items">' + rows + '</ol>'
      + '<div class="taskactions"><button type="button" class="btn pri" data-task-close="1">關閉</button></div></section>';
    m.hidden = false;
    m.classList.add('on');
    document.documentElement.classList.add('task-open');
    var panel = m.querySelector('.taskpanel');
    if (panel) panel.focus();
  }

  function clearCurrentId(id) {
    if (S.taskNow) delete S.taskNow[id];
  }

  function ensureTaskModal() {
    if (TASKMODAL) return TASKMODAL;
    TASKMODAL = document.createElement('div');
    TASKMODAL.className = 'taskveil';
    TASKMODAL.id = 'taskModal';
    TASKMODAL.hidden = true;
    TASKMODAL.setAttribute('data-no-copy-edit', '1');
    document.body.appendChild(TASKMODAL);
    TASKMODAL.addEventListener('click', function (e) {
      if (e.target === TASKMODAL || e.target.closest('[data-task-close]')) closeTaskModal();
      var edit = e.target.closest('[data-task-edit]');
      if (edit) {
        closeTaskModal(false);
        okrTo('list');
        return;
      }
      var toUrl = e.target.closest('[data-task-url]');
      if (toUrl) { openExternal(toUrl.dataset.taskUrl); return; }
      var toList = e.target.closest('[data-task-list]');
      if (toList) { openLibList(toList.dataset.taskList, TASKRETURN); return; }

      var toTool = e.target.closest('[data-task-tool]');
      if (!toTool) return;
      closeTaskModal(false);
      LIBOPEN = toTool.dataset.taskTool;
      LIBTAB = 'tool';
      nav('#/library');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && TASKMODAL && !TASKMODAL.hidden) closeTaskModal();
    });
    return TASKMODAL;
  }

  function openTaskModal(id, trigger) {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS, ui = O.taskUI;
    var it = taskItem(id);
    var dim = it && it.dim;
    var d = D.dims.filter(function (x) { return x.k === dim; })[0];
    if (!d) return;
    var m = ensureTaskModal();
    TASKRETURN = trigger || document.activeElement;
    var meta = '';
    if (it) {
      /* ⚠️ 「執行任務」那顆大鈕拿掉了（使用者 2026-09-18）。
         轉跳改成貼在該欄旁邊的小「傳送」—— 要去哪裡由那一格的內容決定，
         而不是一顆不知道會帶你去哪的按鈕。對不上就沒有按鈕，不會有死路。 */
      var courseUrl = taskCourseUrl(it), courseList = taskCourseList(it), toolKey = taskToolKey(it);
      var go = function (attr, val) {
        return ' <button type="button" class="taskgo" ' + attr + '="' + esc(val) + '">傳送</button>';
      };
      meta = '<dl class="taskmeta">'
        + (it.sub ? '<dt>主題</dt><dd>' + esc(it.sub) + '</dd>' : '')
        + (it.tool ? '<dt>教材</dt><dd>' + esc(it.tool)
            + (courseUrl ? go('data-task-url', courseUrl) : courseList ? go('data-task-list', courseList) : '') + '</dd>' : '')
        + (it.sheet ? '<dt>作業</dt><dd>' + esc(it.sheet)
            + (toolKey ? go('data-task-tool', toolKey) : '') + '</dd>' : '')
        + '</dl>';
    }
    m.innerHTML = '<section class="taskpanel" role="dialog" aria-modal="true" aria-labelledby="taskTitle" tabindex="-1">'
      + '<i class="taskbrk taskbrk-tl" aria-hidden="true"></i><i class="taskbrk taskbrk-tr" aria-hidden="true"></i>'
      + '<i class="taskbrk taskbrk-bl" aria-hidden="true"></i><i class="taskbrk taskbrk-br" aria-hidden="true"></i>'
      + '<span class="taskscan" aria-hidden="true"></span>'
      + '<button type="button" class="taskx" data-task-close="1" aria-label="' + esc(ui.closeAction) + '">×</button>'
      + '<p class="taskey">Current Mission · ' + esc(d.en) + '</p>'
      + '<div class="taskhead"><span>' + esc(ui.themeLabel) + '</span><b>' + esc(d.label) + '</b></div>'
      + '<h2 id="taskTitle">' + esc(it ? it.kr : ui.emptyTitle) + '</h2>'
      + '<div class="taskrule"><i></i><s></s></div>'
      + '<p class="taskbody">' + esc(it ? taskDetail(it) : ui.emptyBody) + '</p>'
      + meta
      + '<div class="taskactions"><button type="button" class="btn ' + (it ? 'pri' : 'gh')
      + '" data-task-close="1">' + esc(ui.closeAction) + '</button>'
      + (it ? '' : '<button type="button" class="btn pri" data-task-edit="1">'
          + esc(ui.editAction) + '</button>') + '</div>'
      + '<span class="taskfolio num">' + esc(it ? it.id : dim.toUpperCase()) + '</span></section>';
    m.hidden = false;
    m.classList.add('on');
    document.documentElement.classList.add('task-open');
    figLit(dim);                 /* 面板開著的時候那一塊要一直亮著 */
    var panel = m.querySelector('.taskpanel');
    if (panel) panel.focus();
  }

  function closeTaskModal(restore) {
    if (!TASKMODAL || TASKMODAL.hidden) return;
    TASKMODAL.classList.remove('on');
    TASKMODAL.hidden = true;
    figLit(null);
    document.documentElement.classList.remove('task-open');
    if (restore !== false && TASKRETURN && document.contains(TASKRETURN)) TASKRETURN.focus();
    TASKRETURN = null;
  }

  function okrViewHTML(view, O, D, r, hasScore, byK) {
    if (view === 'cover' || view === 'tasks') return okrTasks(O, D, byK);
    if (view === 'book') return okrBook(O, D, byK);
    return okrList(O, D, r, hasScore, byK);
  }

  function renderOkr() {
    /* 每次從主導覽進入都先回「人物＋任務」主畫面。 */
    OKRVIEW = 'tasks'; BKLEVEL = 'idx'; BKOPEN = null; OKRSEL = null;
    var O = window.UC_OKR, E = window.UC_SCORE, D = window.UC_DIMENSIONS;
    var r = E.score(S.answers), byK = {};
    D.dims.forEach(function (d) { byK[d.k] = d; });
    var hasScore = r.answered >= 5;
    var total = E.questions.length, filled = answeredCount();

    if (filled !== total) {
      var locked = el('okrBody');
      locked.innerHTML = wrap('<div class="empty blueprint-lock"><p class="ey">Blueprint Locked</p>'
        + '<h1>請先完成評測</h1><div class="divider"><i></i><s></s></div>'
        + '<p>完成全部 ' + total + ' 題後，教練才能整理能力雷達與接下來的課程任務。'
        + '目前已填 ' + filled + ' / ' + total + ' 題。</p>'
        + '<button type="button" class="btn pri" id="okrGoAssess">繼續評測</button></div>');
      el('okrGoAssess').addEventListener('click', function () { nav('#/assess'); });
      reveal(locked);
      return;
    }
    if (!coachReportReady()) {
      var pending = el('okrBody');
      pending.innerHTML = wrap('<div class="empty blueprint-lock"><p class="ey">Coach Review</p>'
        + '<h1>' + (ACTOR_ROLE === 'student' ? '教練正在整理藍圖' : '先完成教練評測') + '</h1>'
        + '<div class="divider"><i></i><s></s></div><p>'
        + (ACTOR_ROLE === 'student' ? '教練完成五個維度的判讀與回信後，能力雷達與課程任務會在這裡開放。'
          : '請回到評測頁完成五個維度的說明與教練的信。') + '</p>'
        + '<button type="button" class="btn pri" id="okrGoAssess">前往評測</button></div>');
      el('okrGoAssess').addEventListener('click', function () { nav('#/assess'); });
      reveal(pending);
      return;
    }

    var h = wrap('<header class="rhead"><p class="ey">Course Blueprint ・ ' + esc(O.source) + '</p>'
      + '<h1>課程藍圖</h1><div class="divider"><i></i><s></s></div>'
      /* 頁首只有標題；操作說明貼在人物或書本旁邊。 */
      /* ⚠️ 「任務／總覽」切換器**從頁首拿掉了**（使用者 2026-09-19）——
         它佔掉 54px，而主視覺正在跟第一屏搶空間。兩邊各留一顆轉跳鈕：
         任務頁在牌組底下、總覽頁在最上面。書仍然只從總覽右下角進去。 */
      + '</header>');

    h += '<div id="okrPane">' + okrViewHTML(OKRVIEW, O, D, r, hasScore, byK) + '</div>';

    var body = el('okrBody');
    body.innerHTML = h;
    bindOkr(body);
    paintBlueprintRadar(body);
    reveal(body);
  }

  function bindOkr(body) {
    [].forEach.call(body.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { okrTo(b.dataset.view); });
    });
    bindOkrPane(el('okrPane'));
  }

  /* 換檢視只重畫主內容，不重建頁首與整頁。 */
  function okrTo(view, dim) {
    var pane = el('okrPane'); if (!pane) return;
    OKRVIEW = view;
    if (dim) { BKOPEN = dim; BKLEVEL = 'grp'; OKRSEL = null; }
    /* 「書」已經不在切換器裡，它是從總覽右下角進去的 —— 開著書的時候
       讓「總覽」維持亮著，不然兩顆都暗，看起來像沒選任何一頁。 */
    var lit = (OKRVIEW === 'book') ? 'list' : OKRVIEW;
    [].forEach.call(el('okrBody').querySelectorAll('[data-view]'), function (b) {
      b.classList.toggle('on', b.dataset.view === lit);
    });
    var O = window.UC_OKR, E = window.UC_SCORE, D = window.UC_DIMENSIONS, byK = {};
    D.dims.forEach(function (d) { byK[d.k] = d; });
    var r = E.score(S.answers), hasScore = r.answered >= 5;
    pane.innerHTML = okrViewHTML(OKRVIEW, O, D, r, hasScore, byK);
    bindOkrPane(pane);
    paintBlueprintRadar(pane);
    /* 分頁切換本身就是動作，不再等 IntersectionObserver；先落最終可見狀態。 */
    [].forEach.call(pane.querySelectorAll('.rv'), function (n) { n.classList.add('in'); });
    reveal(pane);
  }

  function bindOkrPane(pane) {
    if (!pane) return;
    /* ⚠️ 轉跳鈕現在**在 pane 裡面**（以前的 `.vsw` 在頁首，不會被重畫）。
       okrTo() 每次都把 pane 的 innerHTML 整個換掉，這裡不重綁的話
       第一次切過去就再也回不來（2026-09-19 踩到）。 */
    [].forEach.call(pane.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { okrTo(b.dataset.view); });
    });
    bindBook(pane);
    /* 右下角的書入口。只有「總覽」畫得出來，換檢視時整個 pane 重畫，按鈕自然消失。 */
    [].forEach.call(pane.querySelectorAll('[data-openbook]'), function (b) {
      b.addEventListener('click', function () { okrTo('book'); });
    });
    [].forEach.call(pane.querySelectorAll('[data-task-id]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.taskId, k = b.dataset.figureDim;
        /* ⚠️ 手機沒有 hover，人物那組動畫**從來沒有機會播**（使用者 2026-09-13）。
           所以點下去先亮人物，等它跑完再開面板 —— 面板一開就蓋住人物的話，
           那組動畫等於白做。 */
        figLit(k);
        var quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function () { openTaskModal(id, b); },
                   quick ? 0 : (figToTop() ? FIG_LEAD + 180 : FIG_LEAD));
      });
    });
    bindFigure(pane);
    bindFigDims(pane);
    [].forEach.call(pane.querySelectorAll('[data-blueprint-report]'), function (b) {
      b.addEventListener('click', function () {
        copyProgressText(blueprintProgressText(), '目前任務已複製，可以貼給學員');
      });
    });
    /* 總覽頁：平常設定「當前任務」與「完成」；需要時才開啟隱藏管理。
       ⚠️ 這裡**不 renderOkr()** —— 勾一條就重建整頁會讓捲動歸零，
       教練連續設定時會失去位置。只改列的 class、控制項與頂端計數。 */
    [].forEach.call(pane.querySelectorAll('[data-hidden]'), function (c) {
      c.addEventListener('change', function () {
        var id = c.dataset.hidden, row = c.closest('.edtr');
        var now = row.querySelector('[data-current]');
        S.hidden = S.hidden || {};
        if (c.checked) {
          S.hidden[id] = 1;
          clearCurrentId(id);
          var i = S.picked.indexOf(id);
          if (i >= 0) S.picked.splice(i, 1);
          delete S.key[id];
          now.checked = false;
          now.disabled = true;
          row.classList.remove('is-current');
        } else {
          delete S.hidden[id];
          now.disabled = !!(S.done && S.done[id]);
        }
        row.classList.toggle('is-hidden', c.checked);
        edtGroupVisibility(row);
        save(); edtCount(pane);
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-current]'), function (c) {
      c.addEventListener('change', function () {
        var id = c.dataset.current;
        if (isHidden(id) || (S.done && S.done[id])) { c.checked = false; return; }
        if (c.checked) {
          S.taskNow[id] = Date.now();
          c.closest('.edtr').classList.add('is-current');
          c.closest('.edtr').classList.remove('is-hidden');
        } else {
          delete S.taskNow[id];
          c.closest('.edtr').classList.remove('is-current');
        }
        save(); edtCount(pane);
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-done]'), function (c) {
      c.addEventListener('change', function () {
        var id = c.dataset.done, row = c.closest('.edtr');
        var now = row.querySelector('[data-current]');
        if (c.checked) {
          S.done[id] = 1;
          clearCurrentId(id);
          now.checked = false;
          now.disabled = true;
          row.classList.remove('is-current');
          row.classList.add('is-done');
        } else {
          delete S.done[id];
          now.disabled = isHidden(id);
          row.classList.remove('is-done');
        }
        var doneText = c.closest('.donecheck');
        if (doneText) doneText.querySelector('span').textContent = '完成';
        save(); edtCount(pane);
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-edtmode]'), function (b) {
      b.addEventListener('click', function () {
        var root = b.closest('.edt');
        var on = root.classList.toggle('is-hide-mode');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.textContent = on ? b.dataset.closeLabel : b.dataset.openLabel;
      });
    });
  }

  function edtGroupVisibility(row) {
    [row.closest('.edtgrp'), row.closest('.edtdim')].forEach(function (box) {
      if (box) box.classList.toggle('is-all-hidden', !box.querySelector('.edtr:not(.is-hidden)'));
    });
  }

  /* 頂端的計數。只改兩個數字，不重建列表。 */
  function edtCount(body) {
    var b = body.querySelectorAll('.edth b');
    if (b.length < 3) return;
    b[0].textContent = Object.keys(S.hidden || {}).length;
    b[1].textContent = currentTaskItems().length;
    b[2].textContent = completedCount();
  }

  /* 書的事件。⚠️ **全部都不呼叫 renderOkr()** ——
     這一頁其他檢視每次操作都重建整個 body，但書重建會讓左頁捲動歸零、掃線重播，
     讀起來像整頁重載。所以切層／選取／加菜單一律只切 class 與重畫右頁。 */
  function bindBook(body) {
    var left = body.querySelector('#bkLeftIn');
    if (!left) return;
    left.addEventListener('click', function (e) {
      var m = e.target.closest('[data-bopen]');
      if (m) { BKOPEN = m.dataset.bopen; BKLEVEL = 'grp'; bkShowLevel(); return; }
      if (e.target.closest('[data-bback]')) { BKLEVEL = 'idx'; bkShowLevel(); return; }
      var t = e.target.closest('[data-bnode]');
      if (!t) return;
      OKRSEL = (OKRSEL === t.dataset.bnode) ? null : t.dataset.bnode;
      paintBookPage();
    });
    body.querySelector('#bkRight').addEventListener('click', function (e) {
      var p = e.target.closest('[data-bpick]'), k = e.target.closest('[data-bkey]');
      if (p) {
        var id = p.dataset.bpick, i = S.picked.indexOf(id);
        if (i < 0) S.picked.push(id);
        else { S.picked.splice(i, 1); delete S.key[id]; }
      } else if (k) {
        var kid = k.dataset.bkey;
        if (S.key[kid]) delete S.key[kid]; else S.key[kid] = 1;
      } else return;
      save();
      paintBookPage();
    });
    paintBookPage();
    bkMarkScroll();
  }

  /* ── 課程藍圖：人物＋任務 ───────────────────────────
     能力卡已取消；右側只放教練勾選的任務卡，而且數量不限。
     卡片區有固定高度，超過範圍時自己捲動，不把人物與整頁一起拉長。 */
  function okrTasks(O, D, byK) {
    var items = currentTaskItems();
    var cards = items.map(function (it, i) {
      var d = byK[it.dim];
      /* ⚠️ 權重：**O 與 KR 一樣重**，大主題只是分類提示（使用者 2026-09-18）。
         舊版剛好相反 —— 大主題 12px 粗體＋鮭紅底標籤最吵，
         而 O 只有 10.5px 淡色，是整張卡最弱的東西。
         O 先於 KR：目標先框住方向，KR 才是這一步要做的事。
         兩行各帶一個很小的標籤，不然同樣大小會分不出誰是誰。 */
      return '<button class="bpcdim bpctask has-task" data-task-id="' + esc(it.id)
        + '" data-figure-dim="' + esc(it.dim) + '" aria-haspopup="dialog" aria-controls="taskModal">'
        + '<span class="bpcey">' + ('0' + (i + 1)).slice(-2) + ' · ' + esc(it.id) + '</span>'
        /* ⚠️ 這一格原本寫「當前任務」—— 但這個牌組裡**每一張都是**當前任務，
           那四個字在每張卡上重複一次，等於沒說（使用者 2026-09-18）。
           換成「屬於哪個能力」，同一個位置才真的帶資訊。 */
        + '<span class="bpctaskstate">' + esc(d ? d.label : it.dim) + '</span>'
        + (it.sub ? '<span class="bpclabel">主題</span>'
            + '<span class="bpcgoal">' + esc(it.sub) + '</span>' : '')
        + '<span class="bpclabel">任務</span>'
        + '<strong>' + esc(it.kr) + '</strong>'
        + '<i aria-hidden="true">↗</i></button>';
    }).join('');
    /* 空狀態不放按鈕：學員沒有權限安排，教練自己會去總覽（使用者 2026-09-17）。 */
    var empty = '<div class="bpctaskempty"><p>目前還沒有安排任務。</p>'
      + '<span>' + (ACTOR_ROLE === 'student' ? '教練安排後，任務卡會出現在這裡。'
        : '在總覽勾選「當前任務」就會出現在這裡。') + '</span></div>';

    /* 「Current Missions」那行小標拿掉了（使用者 2026-09-19）——
       下面的牌組自己就寫著「目前任務」，重複一次只是佔掉人物的高度。 */
    return wrap('<div class="bpcover bpcover-task">'
      + '<div class="bpctasklayout"><div class="bpcradar" id="bpcRadar"></div>' + figureHTML()
      + '<section class="bpctaskdeck"><header><div><p class="ey">Mission Deck</p><h2>目前任務</h2></div>'
      + '<strong class="num">' + items.length + '</strong></header>'
      + '<div class="bpctaskscroll">' + (cards || empty) + '</div></section>'
      /* ⚠️ 轉跳鈕在**牌組外面**（下緣那條線之下）。放進牌組裡的話它會吃掉
         一張卡的高度 —— 而它本來就可以掉出第一屏（使用者 2026-09-19）。 */
      + (ACTOR_ROLE !== 'student' ? '<button type="button" class="bpc-report" data-blueprint-report>回報目前任務</button>' : '')
      + '<button type="button" class="bpcswitch" data-view="list">總覽　<i aria-hidden="true">→</i></button>'
      + '</div>'
      /* 說明那一行拿掉了（使用者 2026-09-19）—— 人物與任務卡自己說得夠清楚，
         多一行字只是把主視覺往上擠。 */
      + '</div>', 'bpcover-sec');
  }

  /* 人物：**一張手繪線稿**（`assets/figure/line-front.webp`，242×698、48KB）。
     滑到某一項能力，人物就只亮那一塊 —— 人物本身就是目錄。

     ⚠️ 這裡曾經是 13 張 Blender 算的 3D 影格（滑鼠可以轉 ±45°）。
     換回線稿是使用者的決定：「線圖看起來比較帥」。
     **代價是不能轉了** —— 手繪稿只有正面一個角度，那正是當初做 3D 的原因。
     3D 的影格 `turn-*.webp` 先留著沒刪。

     亮起來**不另外出圖**：同一張圖疊兩層，底層壓暗、上層加光暈再用漸層遮罩框出區域。
     ⚠️ 遮罩要用漸層衰減，不要用 clip-path —— 矩形裁切會在腰部留一條直邊，
     看起來像被切掉而不是被照亮（踩過）。 */
  var FIGREGION = {
    values: 'head',    /* 人格魅力 → 腦袋 */
    emo:    'upper',   /* 情緒價值 → 上半身 */
    flirt:  'limbs',   /* 調情升溫 → 四肢 */
    image:  'aura',    /* 形象魅力 → 只有外圈發光（剪影＋外光暈） */
    circle: 'net'      /* 生活圈   → 人物背後的大網絡（唯一不在身體上的） */
  };
  var FIGSRC = 'assets/figure/line-front.webp';
  var FILLSRC = 'assets/figure/figure-fill.webp';   /* 實心剪影：遮擋 ＋ 外圈光暈 */
  var FILLSOFTSRC = 'assets/figure/figure-fill-46.png';

  /* 生活圈的塗鴉：生活裡的東西，白色手繪線條，亮在人物後面。
     使用者指定的七樣：蠟筆圖紙、飛機、玩具車、棒球、酒杯、腳踏車、汽車模型。
     ⚠️ 手繪感靠**三件事**，不是靠抖動濾鏡：線條不對稱（左右不等長）、
     轉角用圓端點、封閉的形狀刻意不封死（留一點縫）。 */
  /* 生活圈：人物**背後**一個大網絡。
     ⚠️ 光靠 z 序不夠 —— 人物是線稿、中間透空，線會直接穿過身體，
     眼睛就判定它跟人物同一層。要一張**實心剪影當遮擋**夾在中間（figure-fill.webp），
     身體等於在網絡上挖掉一塊，前後才讀得出來。 */
  function rnd(seed) {
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function netSVG() {
    var CX = 202, CY = 222, RX = 176, RY = 200, N = 56, R = rnd(9), P = [];
    /* 黃金角螺旋鋪點：圓內分佈最均勻的簡單解法，純亂數會結塊 */
    for (var i = 0; i < N; i++) {
      var t = Math.sqrt((i + 0.5) / N), a = i * 2.39996 + R() * 0.5;
      P.push({ x: CX + Math.cos(a) * t * RX * (1 + (R() - .5) * .12),
               y: CY + Math.sin(a) * t * RY * (1 + (R() - .5) * .12),
               hub: R() < .12 });
    }
    P.forEach(function (p) { p.r = p.hub ? 2.1 + R() * 1.5 : 0.9 + R() * 0.9; });
    /* ⚠️ 連線用**最近鄰**，不要用中央樞紐放射 —— 放射會變成一朵花，
       而且所有線匯聚在人物身上同一點。最近鄰長出來的才像有機的網。 */
    var seen = {}, ed = [];
    P.forEach(function (p, i) {
      var d = P.map(function (q, j) { return { j: j, d: Math.hypot(p.x - q.x, p.y - q.y) }; })
               .filter(function (o) { return o.j !== i; })
               .sort(function (x, y) { return x.d - y.d; });
      for (var k = 0; k < 2 && k < d.length; k++) {
        var key = Math.min(i, d[k].j) + '-' + Math.max(i, d[k].j);
        if (seen[key]) continue;
        seen[key] = 1; ed.push([P[i], P[d[k].j]]);
      }
    });
    return '<svg class="fxnet" viewBox="0 0 404 454" aria-hidden="true">'
      + '<defs><filter id="fxglow" x="-40%" y="-40%" width="180%" height="180%">'
      + '<feGaussianBlur stdDeviation="1.3" result="b"/>'
      + '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
      + '</filter><radialGradient id="fxcore">'
      + '<stop offset="0" stop-color="rgba(232,168,152,.10)"/>'
      + '<stop offset="1" stop-color="rgba(232,168,152,0)"/></radialGradient></defs>'
      + '<ellipse cx="202" cy="222" rx="176" ry="200" fill="url(#fxcore)"/>'
      + '<g fill="none" stroke="var(--salmon)" stroke-width=".85" opacity=".24"'
      + ' stroke-linecap="round">'
      + ed.map(function (e) { return '<path d="M' + e[0].x.toFixed(1) + ' ' + e[0].y.toFixed(1)
          + ' L' + e[1].x.toFixed(1) + ' ' + e[1].y.toFixed(1) + '"/>'; }).join('')
      + '</g><g fill="var(--salmon)" filter="url(#fxglow)">'
      + P.map(function (p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1)
          + '" r="' + p.r.toFixed(2) + '" opacity="' + (p.hub ? 1 : .6) + '"/>'; }).join('')
      + '</g></svg>';
  }

  /* 情緒價值的心臟。用跟人物同一套語言：細線、青色、不填色。
     ⚠️ viewBox 用線稿的原始尺寸 242×698 ＋ preserveAspectRatio，
     這樣它的縮放與留白會跟 object-fit:contain 的圖片**完全一致**，
     心臟才會準確落在胸口（用百分比定位會因為信箱式留白而偏掉）。 */
  function heartSVG() {
    return '<svg class="fxheart" viewBox="0 0 242 698" preserveAspectRatio="xMidYMid meet"'
      + ' aria-hidden="true"><g transform="translate(103,182) scale(1.5)">'
      + '<path d="M12 21 C4 14 1 10.4 1 7.2 C1 3.7 3.6 1 7 1 C9.2 1 11 2.2 12 4'
      + ' C13 2.2 14.8 1 17 1 C20.4 1 23 3.7 23 7.2 C23 10.4 20 14 12 21 Z"'
      + ' fill="none" stroke="rgba(140,242,255,.95)" stroke-width="1.4"'
      + ' stroke-linejoin="round"/></g></svg>';
  }

  function figureHTML() {
    /* ⚠️ 疊法由下而上：網絡 → 遮擋剪影 → **外圈光暈** → 線稿本體 → 高亮層 → 心臟。
       同一個 grid 格子裡先寫的在底下。
       ⚠️ 外圈光暈那層一定要在**線稿下面** —— 它是實心深藍的剪影，
       放在線稿上面會把人物自己的肌肉線整片蓋掉（踩過）。
       放在下面剛好：剪影擋住往內的光，只留往外那一圈，線稿照常畫在最上面。 */
    var h = '<div class="bpcfigure has-radar" id="bpcFig">' + netSVG()
          + '<img class="fxfill" src="' + FILLSRC + '" alt="" draggable="false">'
          + '<img class="fxradarsoft" src="' + FILLSOFTSRC + '" alt="" draggable="false">'
          + '<img class="fxhi fx-aura" src="' + FILLSRC + '" alt="" draggable="false">'
          + '<img class="fxbase" src="' + FIGSRC + '" alt="" draggable="false">';
    ['head', 'upper', 'limbs'].forEach(function (r) {
      h += '<img class="fxhi fx-' + r + '" src="' + FIGSRC + '" alt="" draggable="false">';
    });
    h += heartSVG();
    return h + '<span class="vh">代表學員虛擬成長的中性人物線稿。'
      + '滑到或聚焦某一項能力，人物對應的部位會亮起來。</span></div>';
  }

  /* 能力卡 ←→ 人物部位。只改容器上的 data-lit，其餘交給 CSS。
     滑鼠與鍵盤都要接（focus/blur），不然只有滑鼠使用者看得到這個對應。 */
  /* 人物的高亮。**模組層級，不是 bindFigure 的區域函式** ——
     點格子開面板時也要用它（見 bindOkrPane 的 click）。 */
  /* 人物左上角的能力切換（使用者 2026-09-18：「五排星號即可」）。
     ⚠️ 它同時是**圖例**也是**開關**：看得到五維各幾顆星，點一下就把人物
     對應的部位點亮。再點同一個會關掉 —— 不然點過就沒辦法回到「全暗」。
     星等用的是報告裡的最終值（含教練加減），跟報告頁看到的同一組數字。 */
  function figDimsHTML() {
    var r = reportBase(), cr = S.coachReport || normalizeCoachReport();
    return '<div class="figdims">' + window.UC_DIMENSIONS.dims.map(function (d) {
      var n = reportStar(d.k, r, cr);
      return '<button type="button" class="figdim" data-figdim="' + esc(d.k) + '"'
        + ' aria-pressed="false" title="' + esc(d.label) + '　' + n + ' 顆星">'
        + '<b>' + esc(d.label) + '</b>'
        + '<s>' + new Array(n + 1).join('★') + new Array(6 - n).join('☆') + '</s>'
        + '</button>';
    }).join('') + '</div>';
  }

  /* 目前點亮的是哪一維（null＝全暗）。 */
  var FIGDIM = null;

  function bindFigDims(root) {
    [].forEach.call(root.querySelectorAll('[data-figdim]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.figdim;
        FIGDIM = (FIGDIM === k) ? null : k;
        figLit(FIGDIM);
        [].forEach.call(root.querySelectorAll('[data-figdim]'), function (x) {
          var on = x.dataset.figdim === FIGDIM;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
  }

  /* 教練記錄進步的小控制列，只有教練看得到。每維 ＋／－，封頂到 5 星。 */
  function paintProgressEditor(root, r, cr) {
    var host = root.querySelector('#bpcProgress');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bpcProgress'; host.className = 'bpcprogress';
      var radar = root.querySelector('#bpcRadar');
      if (!radar) return;
      radar.parentNode.insertBefore(host, radar.nextSibling);
    }
    host.innerHTML = '<p class="ey">教練記錄進步</p>' + window.UC_DIMENSIONS.dims.map(function (d) {
      var base = reportStar(d.k, r, cr), now = progressStar(d.k, r, cr);
      return '<div class="bpcpg"><b>' + esc(d.label) + '</b>'
        + '<button type="button" data-pg="' + d.k + '" data-d="-1"' + (now <= base ? ' disabled' : '') + ' aria-label="' + esc(d.label) + '減一級">－</button>'
        + '<span>' + (now > base ? '+' + (now - base) : '0') + '</span>'
        + '<button type="button" data-pg="' + d.k + '" data-d="1"' + (now >= 5 ? ' disabled' : '') + ' aria-label="' + esc(d.label) + '加一級">＋</button></div>';
    }).join('');
    host.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      var k = b.dataset.pg, cur = Math.max(0, Math.round(Number(cr.progress[k]) || 0));
      var next = Math.max(0, cur + Number(b.dataset.d));
      if (reportStar(k, r, cr) + next > 5) return;
      if (next) cr.progress[k] = next; else delete cr.progress[k];
      save();
      paintBlueprintRadar(root);
    };
  }

  function paintBlueprintRadar(root) {
    var host = root && root.querySelector('#bpcRadar');
    if (!host) return;
    var r = reportBase(), cr = S.coachReport || normalizeCoachReport();
    /* 有記錄進步的話：起點降成淡虛線（ghost），現在的形狀用實線疊在上面。
       多出來的那一塊就是學員的進步 —— 成就感要看得見（使用者 2026-09-24）。 */
    var start = coachReportValues(r, cr), now = {}, grew = false;
    window.UC_DIMENSIONS.dims.forEach(function (d) {
      var n = progressStar(d.k, r, cr);
      if (n > reportStar(d.k, r, cr)) { grew = true; now[d.k] = window.UC_SCORE.starMid[n - 1]; }
      else now[d.k] = start[d.k];
    });
    drawRadar(host, now, { comment: true, blueprint: true, ghost: grew ? start : null,
      comments: cr.notes, lead: coachReportLow(r, cr), animate: false });
    if (ACTOR_ROLE === 'coach') paintProgressEditor(root, r, cr);
    [].forEach.call(host.querySelectorAll('.lbtn'), function (b) {
      function toggle() {
        var fig = document.getElementById('bpcFig');
        var k = b.getAttribute('data-k');
        FIGDIM = FIGDIM === k ? null : k;
        [].forEach.call(host.querySelectorAll('.lbtn'), function (x) {
          x.classList.toggle('sel', x.getAttribute('data-k') === FIGDIM);
        });
        if (fig) {
          if (FIGDIM) fig.setAttribute('data-radar-open', '1');
          else fig.removeAttribute('data-radar-open');
        }
      }
      b.addEventListener('click', toggle);
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  function figLit(k) {
    var fig = document.getElementById('bpcFig');
    if (!fig) return;
    var r = k && FIGREGION[k];
    if (r) fig.setAttribute('data-lit', r); else fig.removeAttribute('data-lit');
  }

  /* 點下去到面板出現之間留多久給人物。
     .fxhi 的 transition 是 .18s，留到 360ms 才看得出「亮起來」這件事。 */
  var FIG_LEAD = 360;

  /* 手機上面板貼底，人物如果停在畫面下半部就只露出一小截，那盞燈等於白點。
     所以開面板前先把人物捲到上方。回傳「有沒有真的捲」——
     有捲的話要多留一點時間給捲動跑完，不然面板會追上來。
     ⚠️ 桌機不捲：那邊面板是置中的，本來就看得到人物。 */
  function figToTop() {
    if (innerWidth > 720) return false;
    var fig = document.getElementById('bpcFig');
    if (!fig) return false;
    var r = fig.getBoundingClientRect(), want = 56;
    if (Math.abs(r.top - want) < 28) return false;
    /* 捲完之後高亮的位置會變，但 data-lit 是 class 不是座標，不用重算。 */
    /* ⚠️ **不要用 behavior: 'smooth'。** 平滑捲動是靠 rAF 一格一格跑的，
       而面板一開就會套上 `html.task-open { overflow: hidden }` 把捲動鎖死 ——
       捲到一半被腰斬，停在哪裡看運氣。直接跳過去，反正面板馬上蓋上來。 */
    window.scrollTo(0, Math.max(0, scrollY + r.top - want));
    return false;          /* 瞬間完成，不必多等 */
  }

  function bindFigure(pane) {
    if (!pane.querySelector('#bpcFig')) return;
    /* 桌機有 hover，滑過去就亮；手機沒有，所以另外靠點擊（見 bindOkrPane）。 */
    [].forEach.call(pane.querySelectorAll('[data-cover-dim], [data-figure-dim]'), function (b) {
      var k = b.dataset.coverDim || b.dataset.figureDim;
      b.addEventListener('mouseenter', function () { figLit(k); });
      b.addEventListener('focus',      function () { figLit(k); });
      /* ⚠️ 面板開著的時候不要把燈關掉 —— 那盞燈正在說明面板講的是哪一塊。 */
      b.addEventListener('mouseleave', function () { if (!taskOpen()) figLit(null); });
      b.addEventListener('blur',       function () { if (!taskOpen()) figLit(null); });
    });
  }

  function taskOpen() { return !!(TASKMODAL && !TASKMODAL.hidden); }

  /* ── 課程藍圖：攤開的書 ───────────────────────────────
     左頁是目錄（五個大主題的橫幅書籤）與那一維的 KR 清單，右頁是選到的那一條。
     兩頁**同一套材質，由同一個 panelArt() 產生**，只差缺角在外側哪一邊 ——
     材質一致不是靠手動對數值，是靠共用程式碼。
     幾何：左頁 354 ＋ 書溝 22 ＋ 右頁 424 ＋ 邊界 40×2 = 880（= --maxw），兩頁同高 600。

     ⚠️ **左頁兩層一次全部渲染，切層只切 class**（見 bindBook）——
     這一頁其他檢視是每次操作都 renderOkr() 重建，但書不能：
     重建會讓捲動歸零、掃線重播，讀起來像整頁重載。 */
  function panelArt(w, h, notch, key) {
    var N = 26, L = 20, gi = 'g' + key, gm = 'm' + key, cp = 'c' + key;
    var d = (notch === 'tr')
      ? 'M1 1H' + (w - N) + 'L' + (w - 1) + ' ' + N + 'V' + (h - 1) + 'H1Z'
      : 'M' + N + ' 1H' + (w - 1) + 'V' + (h - 1) + 'H1V' + N + 'Z';
    var cr = (notch === 'tr')
      ? '<path class="pgcrop" d="M1 ' + (1 + L) + 'V1h' + L + '"/>'
        + '<path class="pgcrop" d="M' + (w - 1) + ' ' + (N + L) + 'V' + N + '"/>'
      : '<path class="pgcrop" d="M1 ' + (N + L) + 'V' + N + '"/>'
        + '<path class="pgcrop" d="M' + (w - 1) + ' ' + (1 + L) + 'V1h-' + L + '"/>';
    cr += '<path class="pgcrop" d="M1 ' + (h - 1 - L) + 'V' + (h - 1) + 'h' + L + '"/>'
        + '<path class="pgcrop" d="M' + (w - 1) + ' ' + (h - 1 - L) + 'V' + (h - 1) + 'h-' + L + '"/>';
    /* 頁首短棒放在靠書溝那一側 —— 左頁在右、右頁在左，框住書溝 */
    var bx = (notch === 'tr') ? 56 : (w - 56 - 46);
    return '<svg class="pgart" viewBox="0 0 ' + w + ' ' + h + '"'
      + ' preserveAspectRatio="none" aria-hidden="true"><defs>'
      + '<pattern id="' + gi + '" width="28" height="28" patternUnits="userSpaceOnUse">'
      + '<path d="M0 0H28M0 0V28" fill="none" stroke="rgba(232,228,220,.07)"'
      + ' stroke-width="1" vector-effect="non-scaling-stroke"/></pattern>'
      /* 主線每 5 格一條、亮一階 —— 只有一種粗細會讀成方格紙 */
      + '<pattern id="' + gm + '" width="140" height="140" patternUnits="userSpaceOnUse">'
      + '<path d="M0 0H140M0 0V140" fill="none" stroke="rgba(232,168,152,.13)"'
      + ' stroke-width="1" vector-effect="non-scaling-stroke"/></pattern>'
      + '<clipPath id="' + cp + '"><path d="' + d + '"/></clipPath></defs>'
      + '<path class="pgpanel" d="' + d + '" vector-effect="non-scaling-stroke"/>'
      + '<rect fill="url(#' + gi + ')" x="0" y="0" width="' + w + '" height="' + h + '"'
      + ' clip-path="url(#' + cp + ')"/>'
      + '<rect fill="url(#' + gm + ')" x="0" y="0" width="' + w + '" height="' + h + '"'
      + ' clip-path="url(#' + cp + ')"/>'
      + cr + '<rect class="pgbar" x="' + bx + '" y="42" width="46" height="3"/></svg>';
  }

  function okrBook(O, D, byK) {
    var by = {}, also = {};
    var visible = O.items.filter(function (i) { return !isHidden(i.id); });
    if (!visible.length) {
      return wrap('<div class="bpnone">目前沒有顯示的任務。到「總覽」開啟「管理隱藏任務」即可恢復。</div>', 'rv');
    }
    visible.forEach(function (i) { (by[i.dim] = by[i.dim] || []).push(i); });
    O.themes.forEach(function (t) { if (t.also) also[t.dim] = t.also; });
    var dims = D.dims.map(function (d) { return d.k; }).filter(function (k) { return by[k]; });
    if (!BKOPEN || !by[BKOPEN]) BKOPEN = dims[0];

    /* 第一層：目錄。第一列是**本期菜單** —— 教練排好之後要能一眼看完，
       不必逐維翻。頁腳是藍圖原文的三句格言（真資料，不是填空用的裝飾）。 */
    var lv = '<div class="blv blv1' + (BKLEVEL === 'idx' ? ' is-on' : '') + '">'
      + '<p class="blvh">' + esc(O.source) + '<s>目錄</s></p>'
      + '<button class="bmk bmk-pick" data-bopen="__pick"><b>本期菜單</b>'
      + '<s>PICKED · <i class="bpn">' + S.picked.filter(function (id) { return !isHidden(id); }).length + '</i> 條</s><u></u></button>'
      + dims.map(function (k) {
          return '<button class="bmk" data-bopen="' + k + '"><b>' + esc(byK[k].label) + '</b>'
            + (also[k] ? '<em>＋' + esc(also[k]) + '</em>' : '')
            + '<s>' + k + ' · ' + by[k].length + ' KR</s><u></u></button>';
        }).join('')
      + '<div class="blvep">' + O.epigraphs.map(function (e) {
          return '<p>' + esc(e) + '</p>';
        }).join('') + '</div></div>';

    /* 本期菜單那一層。內容會隨勾選變動，所以由 renderPickLevel() 單獨重畫 */
    lv += '<div class="blv blv2' + (BKLEVEL === 'grp' && BKOPEN === '__pick' ? ' is-on' : '') + '"'
      + ' data-bgrp="__pick">'
      + '<button class="blvback" data-bback="1"><u></u>返回目錄</button>'
      + '<div class="blvhead"><p class="blvey">PICKED</p>'
      + '<h2 class="blvttl">本期菜單</h2><div class="blvrule"></div></div>'
      + '<div class="bpick"></div></div>';

    /* 第二層：每一維一份，切 class 顯示。KR 依 O 分組（AGENTS 規則 23）*/
    lv += dims.map(function (k) {
      return '<div class="blv blv2' + (BKLEVEL === 'grp' && k === BKOPEN ? ' is-on' : '') + '"'
        + ' data-bgrp="' + k + '">'
        + '<button class="blvback" data-bback="1"><u></u>返回目錄</button>'
        + '<div class="blvhead"><p class="blvey">' + k + ' · ' + by[k].length + ' KR</p>'
        + '<h2 class="blvttl">' + esc(byK[k].label) + '</h2><div class="blvrule"></div></div>'
        /* 序列鏈：一條連續的線穿過所有膠囊 —— 順序看得出來。
           深／淺交替**不是每隔一個換，是換 O 才換**，
           所以交替本身就在講「這幾條屬於同一個目標」。
           膠囊是 28×28 的固定槽，序號只是它現在的內容（之後換小圖示不用改幾何：
           鏈的 x = 內距 16 ＋ 半徑 14 = 30，跟膠囊中心綁在一起）。 */
        + '<div class="bchain">'
        + (function () {
            var n = 0, gi = -1;
            return byObjective(by[k]).map(function (g) {
              gi++;
              return (g.o ? '<p class="bsub">' + esc(g.o) + '</p>' : '')
                + g.items.map(function (it) {
                    n++;
                    return '<button class="btask ' + (gi % 2 ? 'g-b' : 'g-a') + '"'
                      + ' data-bnode="' + esc(it.id) + '" title="' + esc(it.kr) + '">'
                      + '<i class="btno">' + ('0' + n).slice(-2) + '</i>'
                      + '<u class="btkr">' + esc(it.kr) + '</u></button>';
                  }).join('');
            }).join('');
          }())
        + '</div></div>';
    }).join('');

    /* 沒有外框、沒有底色、沒有折角 —— 書要落在頁面上，不是嵌在頁面上 */
    return '<div class="bkspread"><div class="bkbody">'
      + '<div class="pg" id="bkLeft">' + panelArt(354, 600, 'tl', 'L')
      + '<div class="pgin" id="bkLeftIn">' + lv + '</div></div>'
      + '<div class="bkgutter"></div>'
      + '<div class="pg bkwrap" id="bkRight">' + panelArt(424, 600, 'tr', 'R')
      + '<div class="bksweep" id="bkSweep"></div>'
      + '<div class="bkpage" id="bkPage"></div><div class="bkfol" id="bkFol"></div></div>'
      + '</div></div>';
  }

  /* 右頁：只換內容，不重建左頁。狀態接的是真的 S.picked／S.key，不是示範值。 */
  function paintBookPage() {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS, byK = {};
    D.dims.forEach(function (d) { byK[d.k] = d; });
    var page = el('bkPage'); if (!page) return;
    var it = OKRSEL ? O.items.filter(function (x) { return x.id === OKRSEL && !isHidden(x.id); })[0] : null;

    if (!it) {
      page.innerHTML = '<p class="bkey">' + esc(O.source) + '</p>'
        + '<h3 class="bktitle">課程藍圖</h3><div class="bkrule"></div>'
        + '<p class="bkkr">五個維度、' + O.items.filter(function (x) { return !isHidden(x.id); }).length + ' 條 KR。'
        + '點左頁的大主題，再選一條 KR，這一頁就翻到那一條。</p>';
    } else {
      var pick = S.picked.indexOf(it.id) >= 0;
      page.innerHTML = '<p class="bkey">' + esc(byK[it.dim].label) + ' · ' + esc(it.id) + '</p>'
        + '<h3 class="bktitle">' + esc(it.kr) + '</h3><div class="bkrule"></div>'
        + '<div class="bkmeta">'
          + '<b>目標 O</b><span>' + esc(it.sub || '（原表未分組）') + '</span>'
          + (it.tool ? '<b>工具</b><span>' + esc(it.tool) + '</span>' : '')
          + (it.sheet ? '<b>作業</b><span>' + esc(it.sheet) + '</span>' : '')
        + '</div>'
        + '<div class="bkact"><button class="bkpick' + (pick ? ' on' : '') + '"'
        + ' data-bpick="' + esc(it.id) + '">' + (pick ? '在書裡　✓' : '加入書本') + '</button>'
        + (pick ? '<button class="bkpick key' + (S.key[it.id] ? ' on' : '') + '"'
            + ' data-bkey="' + esc(it.id) + '">' + (S.key[it.id] ? '重點　★' : '標成重點') + '</button>' : '')
        + '</div>'
        + (it.note ? '<p class="bknote">' + esc(it.note) + '</p>' : '');
    }

    /* 掃線跑一次。remove → 讀 offsetWidth → add 是重跑 CSS 動畫的標準做法
       （不讀一次版面，瀏覽器會把兩次 class 變更合併，動畫不會重播）。 */
    var sw = el('bkSweep');
    if (sw) { sw.classList.remove('is-run'); void sw.offsetWidth; sw.classList.add('is-run'); }
    el('bkFol').textContent = ('00' + (it ? O.items.indexOf(it) + 1 : 0)).slice(-3);

    renderPickLevel();
    [].forEach.call(document.querySelectorAll('.btask'), function (n) {
      var id = n.dataset.bnode;
      var base = n.className.match(/\bg-[ab]\b/);
      n.className = 'btask ' + (base ? base[0] : '') + (n.classList.contains('bp') ? ' bp' : '')
        + (id === OKRSEL ? ' is-sel' : '')
        + (S.picked.indexOf(id) >= 0 ? ' is-pick' : '')
        + (S.key[id] ? ' is-key' : '');
    });
  }

  /* 本期菜單的內容。**只重畫這一小塊**，不動左頁其他東西。
     依維度分段，重點排在該維度的最前面並標 ★。 */
  function renderPickLevel() {
    var box = document.querySelector('.bpick');
    if (!box) return;
    var O = window.UC_OKR, D = window.UC_DIMENSIONS, byK = {};
    D.dims.forEach(function (d) { byK[d.k] = d; });
    var n = document.querySelector('.bpn');
    if (n) n.textContent = S.picked.filter(function (id) { return !isHidden(id); }).length;

    var picked = S.picked.map(function (id) {
      return O.items.filter(function (x) { return x.id === id; })[0];
    }).filter(function (it) { return it && !isHidden(it.id); });
    if (!picked.length) {
      box.innerHTML = '<p class="bpnone">還沒排。到任一個維度裡點一條，'
        + '在右頁按「加入書本」。</p>';
      return;
    }
    var by = {};
    picked.forEach(function (i) { (by[i.dim] = by[i.dim] || []).push(i); });
    box.innerHTML = D.dims.map(function (d) { return d.k; })
      .filter(function (k) { return by[k]; })
      .map(function (k) {
        var list = by[k].slice().sort(function (a, b) {
          return (S.key[b.id] ? 1 : 0) - (S.key[a.id] ? 1 : 0);
        });
        return '<p class="bsub">' + esc(byK[k].label) + '</p>'
          + list.map(function (it) {
              return '<button class="btask bp' + (S.key[it.id] ? ' is-key' : '')
                + (it.id === OKRSEL ? ' is-sel' : '') + '" data-bnode="' + esc(it.id) + '">'
                + '<u class="btkr">' + esc(it.kr) + '</u></button>';
            }).join('');
      }).join('');
  }

  /* 下緣淡出只在真的會捲時才掛 —— 量一次，不要無條件 */
  function bkMarkScroll() {
    var r = el('bkLeftIn'); if (!r) return;
    r.classList.toggle('is-scroll', r.scrollHeight > r.clientHeight);
  }
  function bkShowLevel() {
    [].forEach.call(document.querySelectorAll('.blv'), function (n) {
      var on = n.classList.contains('blv1')
        ? (BKLEVEL === 'idx') : (BKLEVEL === 'grp' && n.dataset.bgrp === BKOPEN);
      n.classList.toggle('is-on', on);
    });
    el('bkLeftIn').scrollTop = 0;
    bkMarkScroll();
  }

  /* ── O（Objective）分組 ──────────────────────────────
     層級是 維度 → 目標 O（sub）→ 關鍵結果 KR（item）。
     照原表的順序掃過去，sub 一變就開新的一組（同一個 sub 不重複標題）。
     ⚠️ 生活圈有 4 條原表沒給 O（sub 是空字串）—— 這些直接掛在維度底下，
     **不自己編名字**；#selftest 會把數量報出來。 */
  function byObjective(items) {
    var out = [], last = null;
    items.forEach(function (it) {
      var o = it.sub || '';
      if (!out.length || o !== last) { out.push({ o: o, items: [] }); last = o; }
      out[out.length - 1].items.push(it);
    });
    return out;
  }

  /* ── 總覽（教練設定當前任務）─────────────────────────
     所有 KR 預設可見；平常每列有「當前任務」與「完成」。教練按下管理按鈕後，
     兩者才收起並切成「隱藏任務」。任務文字仍只讀 data/okr.js。 */
  function okrList(O, D, r, hasScore, byK) {
    var by = {};
    O.items.forEach(function (i) { (by[i.dim] = by[i.dim] || []).push(i); });
    var dims = D.dims.map(function (d) { return d.k; }).filter(function (k) { return by[k]; });
    var ui = O.editUI;
    if (ACTOR_ROLE === 'student') {
      return wrap('<div class="studenttasks"><div class="studenttasks-head">'
        + '<p class="ey">Your Full Journey</p><h2>這裡就是你的全部任務</h2>'
        + '<p>任務會依教練安排逐步展開；這裡就是目前完整的任務清單。</p></div>'
        + dims.map(function (k) {
          var rows = by[k].filter(function (it) { return !isHidden(it.id); });
          if (!rows.length) return '';
          return '<section class="studenttask-dim"><h3>' + esc(byK[k].label) + '</h3>'
            + rows.map(function (it) {
              var done = !!(S.done && S.done[it.id]);
              var current = !done && isCurrentTask(it.id);
              return '<div class="studenttask' + (current ? ' is-current' : '') + (done ? ' is-done' : '') + '">'
                + '<span class="num">' + esc(it.id) + '</span><b>' + esc(it.kr) + '</b>'
                + (current ? '<em>目前</em>' : (done ? '<em>完成</em>' : ''))
                + '</div>';
            }).join('') + '</section>';
        }).join('') + '</div>', 'rv');
    }
    var nHidden = Object.keys(S.hidden || {}).length;
    var nNow = currentTaskItems().length;
    var nDone = completedCount();

    /* 書的入口。收在右下角、不佔版面 —— 平常沒人用，需要時找得到就好。 */
    var corner = '<button class="bkcorner" type="button" data-openbook="1" title="開啟書本檢視">書</button>';
    /* 回任務頁的路。頁首的切換器拿掉之後，這是唯一的入口，所以放在最上面。 */
    var back = wrap('<div class="bpcswitchrow"><button type="button" class="bpcswitch is-back"'
      + ' data-view="tasks"><i aria-hidden="true">←</i>　任務</button></div>', 'bpcswitchsec');

    return corner + back + wrap('<div class="edt" data-no-copy-edit="1" data-field-scope="blueprint.coach-settings">'
      + '<p class="fieldtag coach">教練填寫</p>'
      + '<div class="edth"><span>' + esc(ui.total) + ' ' + O.items.length + ' 條</span>'
      + '<span>' + esc(ui.hiddenCount) + ' <b>' + nHidden + '</b></span>'
      + '<span>' + esc(ui.currentCount) + ' <b>' + nNow + '</b></span>'
      + '<span>' + esc(ui.doneCount) + ' <b>' + nDone + '</b></span>'
      + '<span class="edtworkhint">' + esc(ui.workHint) + '</span>'
      + '<span class="edtmodehint">' + esc(ui.hideHint) + '</span>'
      + '<button class="edtmode" type="button" data-edtmode="1" aria-pressed="false"'
      + ' data-open-label="' + esc(ui.manageHidden) + '" data-close-label="' + esc(ui.finishHidden) + '">'
      + esc(ui.manageHidden) + '</button></div>'
      + dims.map(function (k) {
          var dimHidden = by[k].every(function (it) { return isHidden(it.id); });
          return '<section class="edtdim' + (dimHidden ? ' is-all-hidden' : '') + '">'
            + '<p class="edtd">' + esc(byK[k].label)
            + '<s>' + k + ' · ' + by[k].length + '</s>'
            + '</p>'
            + byObjective(by[k]).map(function (g) {
                var groupHidden = g.items.every(function (it) { return isHidden(it.id); });
                return '<div class="edtgrp' + (groupHidden ? ' is-all-hidden' : '') + '">'
                  + (g.o ? '<p class="edto">' + esc(g.o) + '</p>' : '')
                  + g.items.map(function (it) {
                      var hidden = isHidden(it.id);
                      var done = !!(S.done && S.done[it.id]);
                      var current = !hidden && !done && isCurrentTask(it.id);
                      return '<div class="edtr' + (hidden ? ' is-hidden' : '') + (current ? ' is-current' : '')
                        + (done ? ' is-done' : '')
                        + '" data-dim="' + k + '">'
                        + '<label class="edtcheck nowcheck"><input type="checkbox" class="now" data-current="' + it.id
                        + '" aria-label="設為當前任務：' + esc(it.kr) + '"'
                        + ' data-field-id="blueprint.current.' + it.id + '" data-field-owner="coach"'
                        + ' data-field-label="當前任務：' + esc(it.kr) + '"'
                        + (current ? ' checked' : '') + (hidden || done ? ' disabled' : '') + '><span>當前</span></label>'
                        + '<label class="edtcheck donecheck"><input type="checkbox" class="done" data-done="' + it.id
                        + '" aria-label="' + esc(ui.doneLabel) + '：' + esc(it.kr) + '"'
                        + ' data-field-id="blueprint.done.' + it.id + '" data-field-owner="coach"'
                        + ' data-field-label="' + esc(ui.doneLabel) + '：' + esc(it.kr) + '"'
                        + (done ? ' checked' : '') + '><span>完成</span></label>'
                        + '<input type="checkbox" class="hide" data-hidden="' + it.id
                        + '" aria-label="' + esc(ui.hideLabel) + '：' + esc(it.kr) + '"'
                        + ' data-field-id="blueprint.hidden.' + it.id + '" data-field-owner="coach"'
                        + ' data-field-label="' + esc(ui.hideLabel) + '：' + esc(it.kr) + '"'
                        + (hidden ? ' checked' : '') + '>'
                        + '<b>' + esc(it.kr) + '</b>'
                        + '<em class="edthidden">' + esc(ui.hiddenMark) + '</em>'
                        + '<em class="edtdone">' + esc(ui.doneMark) + '</em>'
                        + '<s>' + esc(it.id) + '</s></div>';
                    }).join('') + '</div>';
              }).join('') + '</section>';
        }).join('') + '</div>', 'rv');
  }


  /* ── 成長日誌：90 天回顧日曆 ─────────────────────── */
  /* GFORM = 正在填哪一類（call／social／date）；GEDIT = 正在改哪一筆（null＝新增）。 */
  var GCALMODE = 'number', GSELECT = null, GFORM = null, GEDIT = null;
  var GTYPES = [
    { k: 'call', label: '通話記錄', short: '通話' },
    { k: 'social', label: '外出社交', short: '社交' },
    { k: 'date', label: '實際約會', short: '約會' }
  ];

  function isoToday() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
      + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isoAdd(iso, n) {
    var a = String(iso).split('-');
    var d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2]) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function isoDiff(a, b) {
    function utc(x) { var p = String(x).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    return Math.round((utc(a) - utc(b)) / 86400000);
  }
  /* 教練有沒有設過 90 天起始日。沒設過的話畫面要說清楚，不能裝作有。 */
  function growthStartSet() {
    return /^\d{4}-\d{2}-\d{2}$/.test(String((S.coachReport && S.coachReport.growthStart) || ''));
  }

  function growthStart() {
    if (growthStartSet()) return S.coachReport.growthStart;
    /* ⚠️ **沒設定就不要拿示範資料的日期當真人的起點。**
       舊版退回 UC_GROWTH.start（2026-05-25，那是 demo 事件掛的日期），
       於是新學員一進來就看到「90 / 90 已完成」——
       今天距離那個日期早就超過 90 天了（2026-09-18 使用者回報）。
       正式站退回「今天」＝第 1 天；demo 仍用 UC_GROWTH.start，
       不然範例事件全部落在範圍外，整張日曆會是空的。 */
    return (window.UC_STORE && window.UC_STORE.isRemote())
      ? isoToday() : window.UC_GROWTH.start;
  }
  function growthRecords() {
    /* ⚠️ **不要再疊一層唯讀範例。** 範例紀錄現在由 UC_SAMPLE() 灌進 S.log，
       這裡再 concat 一次的話每一筆都會出現兩遍（2026-09-19 改動）。 */
    return (S.log || []).filter(function (e) {
      return e && GTYPES.some(function (t) { return t.k === e.kind; });
    }).map(function (e) {
      if (e.d) return e;
      var copy = {}; Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
      copy.d = isoAdd(growthStart(), Math.max(0, ((Number(e.w) || 1) - 1) * 7 + 2));
      return copy;
    });
  }
  function growthType(kind) {
    return GTYPES.filter(function (t) { return t.k === kind; })[0] || GTYPES[0];
  }
  function growthIcon(kind) {
    var body;
    if (kind === 'call') {
      body = '<path class="gy bubble" d="M5.2 5.2h13.6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.1L7.2 21v-3.8h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/>'
        + '<circle class="gy pk" cx="8" cy="11.2" r="1"/>'
        + '<circle class="gy pk" cx="12" cy="11.2" r="1"/>'
        + '<circle class="gy pk" cx="16" cy="11.2" r="1"/>';
    } else if (kind === 'social') {
      body = '<circle class="gy tr" cx="12" cy="8.16" r="2.72"/>'
        + '<circle class="gy tr" cx="7.68" cy="15.2" r="2.72"/>'
        + '<circle class="gy tr" cx="16.32" cy="15.2" r="2.72"/>';
    } else {
      body = '<path class="gy h" style="stroke-width:2.16px" d="M12,18.56C-.4,10 5.76,0 12,8.64C18.24,0 24.4,10 12,18.56Z"/>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }
  function growthDateLabel(iso) {
    var a = String(iso).split('-');
    var wd = '日一二三四五六'[new Date(iso + 'T00:00:00').getDay()];
    return (+a[1]) + '/' + (+a[2]) + '（' + wd + '）';
  }
  function growthText(records) {
    var lines = ['【' + (S.name || '學員') + '的 90 天成長日誌】',
      '起始日期：' + growthStart(), ''];
    records.slice().sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); })
      .forEach(function (e) {
        lines.push(growthDateLabel(e.d) + '｜' + growthType(e.kind).label);
        if (e.t) lines.push('標題：' + e.t);
        if (e.outcome) lines.push('內容：' + e.outcome);
        if (e.note) lines.push('補充：' + e.note);
        lines.push('');
      });
    if (!records.length) lines.push('目前還沒有紀錄。');
    return lines.join('\n');
  }
  function growthEntryText(e) {
    /* ⚠️ 欄位名要跟表單上看到的一致（使用者 2026-09-18）。
       表單寫「標題」「紀錄」，複製出來卻是「發生了什麼」「想留下的觀察」——
       那是舊版的欄位名，改欄位時漏掉了這裡。 */
    var lines = ['【' + (S.name || '學員') + '的成長日誌】',
      growthDateLabel(e.d) + '｜' + growthType(e.kind).label,
      '標題：' + (e.t || '')];
    if (e.outcome) lines.push('內容：' + e.outcome);
    if (e.note) lines.push('補充：' + e.note);
    return lines.join('\n');
  }
  function reportGrowth(records) {
    return copyProgressText(growthText(records), '整份日誌已複製，可以貼到群組回報');
  }

  /* 面板的讀數區。90 天之外不要硬湊出一個天數 ——
     還沒開始就說還沒開始，走完就說走完，那才是使用者想知道的。
     ⚠️ 進度條做成 13 格（一格一週），不是連續長條 ——
     刻度看得出「走到第幾週」，連續的只看得出一個模糊比例。 */
  function ghudHTML(start, today, records) {
    var n = isoDiff(today, start) + 1;
    var state, doneWeeks;
    if (!growthStartSet()) {
      /* ⚠️ 起始日還沒設定 —— 說出來，不要用一個看起來很正常的數字混過去。 */
      state = '<span>冒險第</span><b>' + n + '</b><span>天　·　起始日未設定</span>';
      doneWeeks = Math.min(13, Math.ceil(Math.max(n, 1) / 7));
    }
    else if (n < 1) { state = '<b>還沒開始</b><span>' + esc(start) + ' 起算</span>'; doneWeeks = 0; }
    /* 超過 90 天照樣報實際天數 —— 冒險沒有結束，只是 13 格都亮了。 */
    else { state = '<span>冒險第</span><b>' + n + '</b><span>天</span>'; doneWeeks = Math.min(13, Math.ceil(n / 7)); }

    var seg = '';
    for (var w = 0; w < 13; w++) {
      seg += '<i class="' + (w < doneWeeks ? 'on' : '') + '"></i>';
    }

    var by = {};
    records.forEach(function (e) { by[e.kind] = (by[e.kind] || 0) + 1; });
    var counts = GTYPES.map(function (t) {
      return '<span class="gcount' + (by[t.k] ? ' has' : '') + '">'
        + '<i class="gmark ' + t.k + '">' + growthIcon(t.k) + '</i>'
        + '<b>' + (by[t.k] || 0) + '</b><s>' + esc(t.short) + '</s></span>';
    }).join('');

    return '<div class="ghud">'
      + '<div class="ghudtop"><p class="ghudtag">90-Day Grid</p>'
      + '<p class="ghudday">' + state + '</p></div>'
      + '<div class="ghudbar">' + seg + '</div>'
      + '<div class="ghudcounts">' + counts
      + '<span class="ghudtotal"><b>' + records.length + '</b><s>總筆數</s></span></div></div>';
  }

  /* 刪除。線條跟其他圖示同一套。 */
  function trashIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path class="gy" d="M4.5 6.5h15"/>'
      + '<path class="gy" d="M9.5 6.5V4.8h5v1.7"/>'
      + '<path class="gy" d="M6.6 6.5l.9 12.2a1.4 1.4 0 0 0 1.4 1.3h6.2a1.4 1.4 0 0 0 1.4-1.3l.9-12.2"/>'
      + '<path class="gy" d="M10.4 10v6.4M13.6 10v6.4"/>'
      + '</svg>';
  }

  /* 窗外的星空。**滿版**（使用者 2026-09-18：「整個螢幕都是對著外面」）。
     ⚠️ 用 preserveAspectRatio="slice" 填滿並裁切 —— 直的橫的都填得滿，
     代價是邊緣會被切掉，所以重要的東西（星系核心、行星）要放在中央偏內，
     被切到的只能是星點與航道。
     ⚠️ 窗框不畫在圖裡：圖會被裁，框就跟著跑掉了。框交給 CSS 畫在螢幕邊緣。 */
  /* 星點。**用亂數生但固定種子** —— 手寫二十顆一定會擺得太平均，
     而平均正是「假」的主因。r 用 rnd()*rnd() 壓向小值：真實的天空絕大多數
     是很暗的小星，亮星只有幾顆。 */
  function skyStars(n, seed, width, height) {
    var s = seed, out = '';
    width = width || 400;
    height = height || 260;
    function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
    for (var i = 0; i < n; i++) {
      var x = (rnd() * width).toFixed(1), y = (rnd() * height).toFixed(1);
      /* r 是**光暈**的半徑，不是星的大小。 */
      var r = (0.9 + rnd() * rnd() * 3.6).toFixed(2);
      /* ⚠️ 上限壓到 .74。亮度一高，小圓點就從「星」變回「點」。 */
      var o = (0.14 + rnd() * rnd() * 0.6).toFixed(2);
      /* ⚠️ **一顆星 = 光暈 ＋ 核心，兩個圓。**
         漸層是等比例縮放的，所以只用一個圓的話，大星的實心核心會跟著變大，
         看起來是「有柔邊的圓盤」而不是「很亮的一點」（使用者 2026-09-19：
         「越大顆的改善越少」）。真實的光相反：亮星的**光暈**大，核心永遠是一個點。
         所以核心半徑**固定**在 0.42，只有光暈跟著亮度長。 */
      out += '<circle class="star" cx="' + x + '" cy="' + y + '" r="' + r + '" opacity="' + o + '"/>'
        + '<circle class="starcore" cx="' + x + '" cy="' + y + '" r="0.42" opacity="'
        + Math.min(1, o * 1.5).toFixed(2) + '"/>';
    }
    return out;
  }

  /* 月面細節。真實感不是靠「多畫幾個坑」，而是三件事：
     1. 同一個方向光；2. 不規則的大尺度明暗；3. 細碎但不搜搜叫的月壤顆粒。
     所以這裡不再用上下兩條弧線「畫出」環形山；每個凹陷改用一層受光邊與
     一層內陰影疊出來，最後整組再用很小的 displacement 打破完美橢圓。 */
  function moonDetail(seed) {
    var st = seed, out = '';
    function rnd() { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; }
    /* 站在月面上時，地平線很遠，視覺上應該接近水平，只有低矮的地形起伏。
       這個函式是給程序生成的環形山定位用，與 SVG 裡的視覺路徑保持約 ±5px。 */
    function horizonY(x) {
      return 261 + Math.sin((x + 70) / 118) * 4.5 + Math.sin((x + 10) / 43) * 2.2;
    }
    var BOT = 462;

    /* ① 大尺度月海。少、大、互相疊；很多個完整的橢圓反而會像貼紙。 */
    out += '<g class="am-maria" filter="url(#amTerrainWarp)">';
    for (var m = 0; m < 4; m++) {
      var mx = -120 + rnd() * 1140, my = 282 + rnd() * 155;
      var mr = -10 + rnd() * 20;
      out += '<ellipse class="am-mare" cx="' + mx.toFixed(0) + '" cy="' + my.toFixed(0)
        + '" rx="' + (190 + rnd() * 230).toFixed(0) + '" ry="' + (35 + rnd() * 50).toFixed(0)
        + '" opacity="' + (0.07 + rnd() * 0.09).toFixed(2) + '" transform="rotate(' + mr.toFixed(1)
        + ' ' + mx.toFixed(0) + ' ' + my.toFixed(0) + ')"/>';
    }
    out += '</g>';

    /* ② 環形山。遠處多而小，近處少而大；影子統一往畫面右下方落。 */
    out += '<g class="am-craters" filter="url(#amTerrainWarp)">';
    for (var i = 0; i < 34; i++) {
      var x = -70 + rnd() * 1040;
      var hy = horizonY(x) + 5;
      var t = Math.pow(rnd(), 2.15);
      var y = hy + t * (BOT - hy);
      var near = (y - hy) / (BOT - hy);
      var rx = 3 + Math.pow(near, 1.45) * 72 + rnd() * 8;
      var ry = rx * (0.1 + near * 0.16);
      var angle = -9 + rnd() * 18;
      var transform = 'rotate(' + angle.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')';
      out += '<g transform="' + transform + '" opacity="' + (0.13 + near * 0.3).toFixed(2) + '">'
        /* 左上方的受光邊是一塊面，不是一條線。 */
        + '<ellipse class="am-crater-rim" cx="' + (x - rx * .05).toFixed(1) + '" cy="'
        + (y - ry * .32).toFixed(1) + '" rx="' + rx.toFixed(1) + '" ry="' + ry.toFixed(1) + '"/>'
        /* 陰影往右下偏，才會被讀成凹陷。 */
        + '<ellipse class="am-crater-core" cx="' + (x + rx * .08).toFixed(1) + '" cy="'
        + (y + ry * .27).toFixed(1) + '" rx="' + (rx * .86).toFixed(1) + '" ry="'
        + (ry * .82).toFixed(1) + '"/></g>';
    }
    out += '</g>';

    /* ③ 前景只留少量亮點。大部分顆粒交給 fractalNoise，否則會像撒芝麻。 */
    for (var g = 0; g < 16; g++) {
      var gx = -40 + rnd() * 980, gy = 372 + rnd() * 86;
      out += '<ellipse class="am-grit" cx="' + gx.toFixed(0) + '" cy="' + gy.toFixed(0)
        + '" rx="' + (0.8 + rnd() * 2.2).toFixed(1) + '" ry="' + (0.4 + rnd()).toFixed(1)
        + '" opacity="' + (0.1 + rnd() * 0.18).toFixed(2) + '"/>';
    }
    return out;
  }

  /* ⚠️ 舊版是「用線條畫出來的星系」：兩道描邊旋臂、一圈虛線航道、一個描邊行星。
     那些都是**圖解的語彙**，所以看起來像示意圖不像天空（使用者 2026-09-19：
     「目前的 svg 太假」）。改成用漸層堆光暈 —— 天體是光，不是輪廓。 */
  function skySVG() {
    return '<svg class="gsky" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
      + '<defs>'
      /* 星系：核心亮、往外化開。三段而不是兩段，中間那段才是「臂」的感覺。 */
      + '<radialGradient id="gxyCore">'
      +   '<stop offset="0%" stop-color="#E8A898" stop-opacity=".62"/>'
      +   '<stop offset="22%" stop-color="#E8A898" stop-opacity=".2"/>'
      +   '<stop offset="58%" stop-color="#E8A898" stop-opacity=".055"/>'
      +   '<stop offset="100%" stop-color="#E8A898" stop-opacity="0"/>'
      + '</radialGradient>'
      /* 星雲：大、極淡、偏米白。它的作用是讓黑不是純黑。 */
      + '<radialGradient id="gxyNeb">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".07"/>'
      +   '<stop offset="60%" stop-color="#E8E4DC" stop-opacity=".022"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      /* 行星：受光的那一側亮一點點，背光側沉進背景。 */
      + '<linearGradient id="gplanet" x1="0" y1="0" x2=".7" y2="1">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".085"/>'
      +   '<stop offset="46%" stop-color="#E8E4DC" stop-opacity=".022"/>'
      +   '<stop offset="100%" stop-color="#131B2E" stop-opacity=".5"/>'
      + '</linearGradient>'
      /* 大氣：只在邊緣一圈，中間必須透明，否則整顆會糊掉。 */
      /* ⚠️ 星點**不能是實心圓**。銳利的邊就是「這是一個 UI 圓點」的訊號
         （使用者 2026-09-19：「點點還是偏假，我覺得是邊緣太銳利了」）。
         中心實、四成處開始收、邊緣歸零 —— 那才是一團光。 */
      + '<radialGradient id="gstar">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".95"/>'
      +   '<stop offset="12%" stop-color="#E8E4DC" stop-opacity=".62"/>'
      +   '<stop offset="30%" stop-color="#E8E4DC" stop-opacity=".2"/>'
      +   '<stop offset="60%" stop-color="#E8E4DC" stop-opacity=".045"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      + '<radialGradient id="gair">'
      +   '<stop offset="82%" stop-color="#E8E4DC" stop-opacity="0"/>'
      +   '<stop offset="94%" stop-color="#E8E4DC" stop-opacity=".07"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      + '</defs>'

      /* 最遠的一層：星雲。先畫，讓後面的東西壓在它上面。 */
      + '<ellipse cx="238" cy="96" rx="180" ry="96" fill="url(#gxyNeb)"/>'
      + '<ellipse cx="72" cy="196" rx="120" ry="74" fill="url(#gxyNeb)" opacity=".7"/>'

      /* 星點分兩批：遠景很多很小，近景少而亮 —— 深度是靠兩層疊出來的。 */
      + skyStars(64, 20260919)
      + '<g opacity=".55">' + skyStars(26, 77315) + '</g>'

      /* 星系本體：一個旋轉的橢圓光暈 ＋ 一顆核心。沒有描邊。 */
      + '<g transform="rotate(-17 252 100)">'
      +   '<ellipse cx="252" cy="100" rx="96" ry="34" fill="url(#gxyCore)"/>'
      +   '<ellipse cx="252" cy="100" rx="52" ry="15" fill="url(#gxyCore)" opacity=".8"/>'
      + '</g>'
      /* 核心小一點、再讓它化進光暈裡 —— 實心的一點會看起來像 UI 的圓點。 */
      + '<circle class="core" cx="252" cy="100" r="3.4"/>'

      /* 行星：左下角，大半沉在畫面外。受光邊只有一道很細的弧。 */
      + '<circle cx="76" cy="262" r="86" fill="url(#gair)"/>'
      + '<circle class="planet" cx="76" cy="262" r="78" fill="url(#gplanet)"/>'
      + '<path class="limb" d="M-2 262a78 78 0 0 1 128-60"/>'

      /* 一顆會呼吸的星。只要一顆 —— 整片都在閃就變成雜訊。
         ⚠️ 它是**米白的不是鮭粉的**。飽和的橘點在星空裡一眼就假。 */
      + '<circle class="star s-lit" cx="206" cy="168" r="4.6"/>'
      + '<circle class="starcore s-lit" cx="206" cy="168" r="0.5"/>'
      + '</svg>';
  }

  /* 主視覺螢幕。三種狀態輪流佔用同一塊畫面：
       閒置 → 太空船　｜　填寫 → 輸入面板　｜　翻閱 → 那一天的日誌
     ⚠️ 三種狀態**共用同一個高度** —— 高度一變整頁就會跳一下，
     而使用者的手指剛按完的地方就跑掉了。那個跳動比任何裝飾都傷。 */
  function gscreenHTML(formHTML, logHTML, logCount, dayNo, start, today, total, kinds) {
    var n = isoDiff(today, start) + 1;
    var stat = n < 1 ? '待啟程' : (n > 90 ? '航程完成' : 'DAY ' + n + ' / 90');
    var inner, mode, badge;
    /* ⚠️ **窗外那片天三種狀態都要在。** 原本只有閒置狀態畫 skySVG()，所以一按
       「留一筆」，玻璃裡的銀河就整個不見，只剩一個空的暗盒子 —— 表單當然搭不起來
       （使用者 2026-09-19：「從銀河跳過去的填寫面板搭不太起來」）。
       正確的關係是：**天窗一直開著，面板浮在上面**，後面的景失焦但還在。 */
    var view = skySVG() + '<i class="gport" aria-hidden="true"></i>';
    var veil = '<i class="gveil" aria-hidden="true"></i>';
    if (formHTML) { inner = view + veil + formHTML; mode = 'form'; badge = 'NEW RECORD'; }
    else if (logCount) { inner = view + veil + logHTML; mode = 'log'; badge = 'DAY ' + dayNo + ' LOG'; }
    else {
      mode = 'idle'; badge = stat;
      inner = view
        + '<div class="gidle"><p class="gidlel">UC Training</p>'
        + '<p class="gidles">' + (n < 1 || n > 90 ? '選一天看紀錄，或按下面留一筆'
            : 'Day ' + dayNo + ' 還沒有紀錄　·　按下面留下第一筆') + '</p></div>';
    }
    /* 四角的 L 型括號（品牌元素）。⚠️ 用四個節點不是四個 ::before ——
       一個元素只有兩個偽元素，而暗角與邊光已經佔掉了。 */
    /* ⚠️ 修飾詞要**帶前綴**。第一版寫成 `tl / tr / bl / br`，結果撞到樣式表裡
       一個全域的 `.tl`（成長軌跡用的，`margin: 30px 0 26px`）——
       左上那個括號就被推下去 30px，四個角對不齊（2026-09-19 踩到）。
       兩個字母的 class 太便宜了，遲早跟別人撞。 */
    var corners = '<i class="gcorner gc-tl"></i><i class="gcorner gc-tr"></i>'
      + '<i class="gcorner gc-bl"></i><i class="gcorner gc-br"></i>';
    /* ⚠️ 三顆鍵**在螢幕裡面**（使用者 2026-09-19：「按鈕是在螢幕內部，
       像是 HUD 的一部分」）。放在外面的話，螢幕再怎麼做成玻璃，
       下面那排實體鍵都會把它打回「一台機器」。 */
    return '<div class="gscreen is-' + mode + '">'
      + '<div class="gscreenbar"><span class="gled"></span><b>UC-90</b><s>' + esc(badge) + '</s>'
      + '<em>' + total + ' REC</em></div>'
      /* ⚠️ 括號畫在**內容區**不是整塊面板上 —— 掛在面板上的話它會貼著外緣，
         跟狀態列與 HUD 撞在一起，看起來就是沒對齊（使用者 2026-09-19）。
         框住「看出去的那片天」才是它該框的東西。 */
      + '<div class="gscreenin">' + corners + inner + '</div>'
      + '<div class="gkinds">' + (kinds || '') + '</div>'
      + '<i class="gscanline" aria-hidden="true"></i></div>';
  }

  function renderGrowth() {
    var body = el('growthBody'), start = growthStart(), end = isoAdd(start, 89);
    var today = isoToday(), records = growthRecords();
    if (!GSELECT || isoDiff(GSELECT, start) < 0 || isoDiff(GSELECT, start) > 89) {
      GSELECT = isoDiff(today, start) >= 0 && isoDiff(today, start) <= 89 ? today : start;
    }
    var byDate = {};
    records.forEach(function (e) { (byDate[e.d] = byDate[e.d] || []).push(e); });
    var startDow = new Date(start + 'T00:00:00').getDay();
    var lead = (startDow + 6) % 7;
    var rowTotal = Math.ceil((lead + 90) / 7);

    /* ⚠️ 左邊的週次軌與右邊的密度條**拿掉了**（使用者 2026-09-18：
       「周次不必要、量條有點多、裝飾元素太多」）。主視覺移到上面的螢幕，
       日曆這裡只留資訊，不再自己搶戲。 */
    var cells = '';
    for (var row = 0; row < rowTotal; row++) {
      for (var c = 0; c < 7; c++) {
        var i = row * 7 + c - lead;
        if (i < 0 || i >= 90) { cells += '<span class="gblank" aria-hidden="true"></span>'; continue; }
        var iso = isoAdd(start, i), dayRecords = byDate[iso] || [];
        /* ⚠️ **有沒有紀錄都用同一套版面。** 舊版空格子畫一個大數字、有紀錄的格子
           改畫圖示、數字縮到角落 —— 同一個網格裡兩種版面，眼睛沒辦法掃。
           現在日期永遠在左上同一個位置，紀錄永遠在左下，格子安靜、紀錄大聲。 */
        var marks = dayRecords.slice(0, 3).map(function (e) {
          return '<i class="gmark ' + e.kind + '" title="' + esc(growthType(e.kind).label) + '">'
            + growthIcon(e.kind) + '</i>';
        }).join('');
        if (dayRecords.length > 3) marks += '<b class="gmore">+' + (dayRecords.length - 3) + '</b>';
        cells += '<button type="button" class="gday' + (iso === GSELECT ? ' is-selected' : '')
          + (iso === today ? ' is-today' : '') + (iso > today ? ' is-future' : '')
          + (dayRecords.length ? ' has-records' : '') + '" data-gdate="' + iso + '">'
          + '<small class="gdayn"><span class="n">' + (i + 1) + '</span>'
          + '<span class="dt">' + (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '</span></small>'
          + '<span class="gmarks">' + marks + '</span></button>';
      }
    }

    /* 能不能刪這一筆。三個條件都要成立：
       ① 它真的在 S.log 裡（範例資料不在狀態裡，刪了也存不住）
       ② 教練誰的都能刪；學員只能刪自己寫的
       ⚠️ 前端這層只是把按鈕藏起來，真正的把關在後端（送什麼都不採信）。 */
    function canDelete(e) {
      if (!e || !e.id) return false;
      if (!(S.log || []).some(function (x) { return x && x.id === e.id; })) return false;
      return ACTOR_ROLE === 'coach' || e.by !== 'coach';
    }

    function logHTML(list, no) {
      return '<div class="glog"><div class="gloghead"><div><p class="ey">Day ' + no + '</p>'
        + '<h2>' + esc(growthDateLabel(GSELECT)) + '</h2></div>'
        + '<span>' + list.length + ' 筆紀錄</span></div>'
        + '<div class="glogbody">' + list.map(function (e) {
            return '<article class="gentry"><span class="gentryicon ' + e.kind + '">' + growthIcon(e.kind) + '</span>'
              + '<div><p>' + esc(growthType(e.kind).label) + '</p><h3>' + esc(e.t || '這一天的紀錄') + '</h3>'
              + (e.outcome ? '<div>' + esc(e.outcome) + '</div>' : '')
              + (e.note ? '<small>' + esc(e.note) + '</small>' : '') + '</div>'
              + '<span class="gacts">'
              /* ⚠️ 複製**不看權限** —— 教練寫的紀錄學員也該能複製去群組討論。
                 只有刪除才分角色。複製做得比刪除明顯：帶文字、有外框；
                 刪除維持淡淡的圖示，不可逆的動作不該一直在招手。 */
              + '<button type="button" class="gcopy" data-gcopy="' + esc(e.id) + '">回報</button>'
              /* 能不能改跟能不能刪是同一組條件：要在 S.log 裡，而且學員不能動教練寫的。 */
              + (canDelete(e) ? '<button type="button" class="gedit" data-gedit="' + esc(e.id) + '">編輯</button>' : '')
              + (canDelete(e) ? '<button type="button" class="gdel" data-gdel="' + esc(e.id) + '"'
                  + ' title="刪除這一筆" aria-label="刪除這一筆">' + trashIcon() + '</button>' : '')
              + '</span></article>';
          }).join('') + '</div></div>';
    }
    var selectedRecords = byDate[GSELECT] || [];
    var dayNo = isoDiff(GSELECT, start) + 1;
    var log = logHTML(selectedRecords, dayNo);

    /* ⚠️ 表單**只有這一份實作**。初次繪製與局部重畫都叫它 ——
       之前兩邊各寫一份，改一邊就會走鐘。新增與編輯也共用同一份：
       差別只有「有沒有帶既有的值」跟「按鈕上寫什麼」。

       ⚠️ 只留三格（使用者 2026-09-18：「只要有日期、標題、紀錄就好」）。
       「補充」拿掉了 —— 兩個都是自由文字，使用者只會猶豫該寫在哪一格。
       舊資料的 note 仍然讀得出來、也還畫得出來，只是不再有地方新增。 */
    function formHTML() {
      if (!GFORM) return '';
      var gt = growthType(GFORM);
      var rec = GEDIT ? (S.log || []).filter(function (x) { return x && x.id === GEDIT; })[0] : null;
      var d0 = rec ? rec.d
        : (isoDiff(today, start) >= 0 && isoDiff(today, start) <= 89 ? today : GSELECT);
      return '<form class="gcalform" id="growthForm">'
        + '<h2>' + esc(gt.label) + (rec ? '　·　編輯' : '') + '</h2>'
        + '<label><span>日期</span><input type="date" name="date" min="' + start + '" max="' + end
          + '" value="' + esc(d0) + '" required></label>'
        + '<label><span>標題</span><input type="text" name="title" maxlength="120"'
          + ' placeholder="用一句話留下情境" value="' + esc(rec ? (rec.t || '') : '') + '" required></label>'
        + '<label><span>紀錄</span><textarea name="outcome" rows="5" maxlength="4000"'
          + ' placeholder="你感受到什麼、學到什麼，或下次想怎麼做">'
          + esc(rec ? (rec.outcome || '') : '') + '</textarea></label>'
        + '<div><button type="button" class="btn gh" data-gcancel>取消</button>'
        + '<button class="btn pri" type="submit">' + (rec ? '儲存修改' : '儲存紀錄') + '</button></div></form>';
    }
    var form = formHTML();

    var canSetStart = ACTOR_ROLE !== 'student';
    /* 以圖案為主、文字縮到最小（使用者 2026-09-18）。
       ⚠️ 文字不整個拿掉 —— 三個圖案在第一次看到時分不出誰是誰，
       title 只有滑鼠停留才看得到，手機根本沒有。留一行小字是最便宜的保險。 */
    var kinds = GTYPES.map(function (t) {
      return '<button type="button" class="gkind' + (GFORM === t.k ? ' on' : '') + '" data-gopen="' + t.k + '"'
        + ' title="' + esc(t.label) + '" aria-label="' + esc(t.label) + '">'
        + '<span class="gkico">' + growthIcon(t.k) + '</span><b>' + esc(t.short) + '</b></button>';
    }).join('');

    var tools = '<div class="gcaltools">'
      + (canSetStart ? '<label class="gstart">90 天起始日<input type="date" data-growth-start value="' + start + '"'
          + ' data-field-id="report.growthStart" data-field-owner="coach"></label>' : '')
      + '<div class="gmode" role="group" aria-label="日期顯示模式"><button type="button" data-gmode="number" class="'
      + (GCALMODE === 'number' ? 'on' : '') + '">第幾天</button><button type="button" data-gmode="date" class="'
      + (GCALMODE === 'date' ? 'on' : '') + '">日期</button></div>'
      + '<button type="button" class="btn gh gexport" data-gexport>進度回報</button></div>';

    /* ⚠️ **整頁只有兩塊**（使用者 2026-09-18）：
       上面是主機（螢幕 ＋ 三顆鍵），下面是日曆（讀數 ＋ 控制 ＋ 格子 ＋ 圖例）。
       填寫與翻閱都發生在螢幕裡，不要再有第三塊散在頁尾。 */
    body.innerHTML = wrap('<header class="rhead"><p class="ey">90-Day Journal</p><h1>成長日誌</h1>'
      /* 導言拿掉了（使用者 2026-09-19）—— 它把螢幕往下推，而螢幕自己就說得清楚。 */
      + '<div class="divider"><i></i><s></s></div>'
      + restNoticeHTML('成長日誌') + '</header>')
      + wrap('<div class="gconsole">'
      + gscreenHTML(form, log, selectedRecords.length, dayNo, start, today, records.length, kinds)
      + '</div>'
      + '<div class="gcalendar">'
      + ghudHTML(start, today, records)
      + '<div class="gweekdays"><span>一</span><span>二</span><span>三</span><span>四</span>'
      + '<span>五</span><span>六</span><span>日</span></div>'
      + '<div class="gdays' + (GCALMODE === 'date' ? ' mode-date' : '') + '">' + cells + '</div>'
      /* 設定類的東西放右下角：要用的時候找得到，平常不擋路。 */
      + '<div class="gcalfoot"><div class="gcallegend">'
      + '<span>格內圖示最多顯示三筆</span></div>' + tools + '</div></div>', 'rv growthcal');

    /* ⚠️ **只換該動的那一塊。** 舊版每按一顆鍵就重寫整個 body，
       於是 .rv 的淡入重播一次、捲動位置被拉回去 —— 體感就是「整頁重新整理」。
       （同樣的坑在資源頁也踩過，那裡的解法一樣：只換窗格。）
       畫面上真正會變的只有三樣：螢幕的內容、哪顆鍵亮著、哪一格被選。 */
    function screenHTML() {
      var sel = byDate[GSELECT] || [];
      var no = isoDiff(GSELECT, start) + 1;
      return gscreenHTML(formHTML(), logHTML(sel, no), sel.length, no, start, today,
                         records.length, kinds);
    }

    function paintScreen() {
      var host = body.querySelector('.gscreen');
      if (!host) { renderGrowth(); return; }
      var box = document.createElement('div');
      box.innerHTML = screenHTML();
      host.parentNode.replaceChild(box.firstChild, host);
      bindScreen();
      bindKinds();                 /* 鍵在螢幕裡，重畫後要重綁 */
      [].forEach.call(body.querySelectorAll('[data-gopen]'), function (x) {
        x.classList.toggle('on', x.dataset.gopen === GFORM);
      });
      [].forEach.call(body.querySelectorAll('[data-gdate]'), function (x) {
        x.classList.toggle('is-selected', x.dataset.gdate === GSELECT);
      });
    }

    bindKinds();
    /* ⚠️ 三顆鍵搬進螢幕之後，**每次 paintScreen 都會把它們換成新節點**。
       綁在這裡（只跑一次）就只有第一次有效 —— 所以真正的綁定在 bindKinds()，
       由 bindScreen() 每次重畫後再叫一次（2026-09-19）。 */
    function bindKinds() {
    [].forEach.call(body.querySelectorAll('[data-gopen]'), function (b) {
      b.addEventListener('click', function () {
        GFORM = b.dataset.gopen;
        GEDIT = null;              /* 按新增就是新增，不要沿用上一次的編輯對象 */
        paintScreen();
        /* ⚠️ 只有螢幕沒完全看得到才捲。看得到還硬捲一下，就是使用者說的「彈一下」。 */
        var sc = body.querySelector('.gscreen');
        if (sc) {
          var r = sc.getBoundingClientRect();
          if (r.top < 60 || r.bottom > window.innerHeight) {
            sc.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      });
    });
    }
    [].forEach.call(body.querySelectorAll('[data-gdate]'), function (b) {
      b.addEventListener('click', function () { GSELECT = b.dataset.gdate; GFORM = null; GEDIT = null; paintScreen(); });
    });
    /* 顯示方式只是換一個 class，連螢幕都不用重畫。 */
    [].forEach.call(body.querySelectorAll('[data-gmode]'), function (b) {
      b.addEventListener('click', function () {
        GCALMODE = b.dataset.gmode;
        var days = body.querySelector('.gdays');
        if (days) days.classList.toggle('mode-date', GCALMODE === 'date');
        [].forEach.call(body.querySelectorAll('[data-gmode]'), function (x) {
          x.classList.toggle('on', x.dataset.gmode === GCALMODE);
        });
      });
    });
    var startInput = body.querySelector('[data-growth-start]');
    if (startInput) startInput.addEventListener('change', function () {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startInput.value)) return;
      S.coachReport.growthStart = startInput.value; GSELECT = startInput.value; save(); renderGrowth();
    });
    /* 螢幕重畫之後，裡面的處理器要重新綁一次。 */
    function bindScreen() {
    /* ⚠️ 刪除是**不可逆**的，所以一定要先問一次。
       ⚠️ 先問後端、成功了才動本機 —— 反過來的話後端失敗時畫面已經少一筆，
       使用者以為刪掉了，下次登入又冒出來。 */
    [].forEach.call(body.querySelectorAll('[data-gcopy]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.gcopy;
        /* 範例資料也要複製得到，所以從畫面上那一份（records）找，不是只找 S.log。 */
        var one = records.filter(function (x) { return x && x.id === id; })[0];
        if (!one) return;
        var how = window.UC_SHARE && window.UC_SHARE.copy
          ? window.UC_SHARE.copy(growthEntryText(one)) : Promise.resolve('fail');
        how.then(function (r) {
          if (r === 'fail') { toast('這個瀏覽器不讓我複製，請手動選取'); return; }
          btn.classList.add('is-ok');
          btn.textContent = '已複製';
          setTimeout(function () {
            if (!btn.isConnected) return;
            btn.classList.remove('is-ok');
            btn.textContent = '回報';
          }, 1800);
          toast('已複製，可以貼到群組跟教練討論');
        });
      });
    });

    [].forEach.call(body.querySelectorAll('[data-gedit]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.gedit;
        var one = (S.log || []).filter(function (x) { return x && x.id === id; })[0];
        if (!one) return;
        GEDIT = id;
        GFORM = one.kind;          /* 表單的標題與類別跟著那一筆走 */
        paintScreen();
      });
    });

    [].forEach.call(body.querySelectorAll('[data-gdel]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.gdel;
        var one = (S.log || []).filter(function (x) { return x && x.id === id; })[0];
        if (!one) return;
        if (!confirm('刪除「' + (one.t || '這一筆紀錄') + '」？刪掉就救不回來了。')) return;
        btn.disabled = true;
        var done = window.UC_STORE && window.UC_STORE.deleteGrowth
          ? window.UC_STORE.deleteGrowth(id) : Promise.resolve({ deleted: true });
        done.then(function () {
          S.log = (S.log || []).filter(function (x) { return !(x && x.id === id); });
          save();
          renderGrowth();            /* 資料真的變了：日曆上的圖示也要跟著少 */
          toast('已刪除');
        }).catch(function (err) {
          btn.disabled = false;
          toast('刪不掉：' + ((err && err.message) || '連不上伺服器'));
        });
      });
    });

    var cancel = body.querySelector('[data-gcancel]');
    if (cancel) cancel.addEventListener('click', function () { GFORM = null; GEDIT = null; paintScreen(); });
    var formEl = el('growthForm');
    if (formEl) formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(formEl), d = String(fd.get('date') || '');
      var title = String(fd.get('title') || '').trim();
      var outcome = String(fd.get('outcome') || '').trim();
      if (!title || isoDiff(d, start) < 0 || isoDiff(d, start) > 89) return;

      var old = GEDIT ? (S.log || []).filter(function (x) { return x && x.id === GEDIT; })[0] : null;
      var ev;
      if (old) {
        /* ⚠️ 編輯是**改那一筆**，不是刪掉再新增一筆。
           id 一定要留著 —— 後端是用 event_id 找列的，換了 id 就會多出一列，
           而舊的那列還躺在試算表上（多一筆鬼紀錄）。
           by 也不改：那是「這筆是誰寫的」，不是「誰最後動過」。 */
        old.d = d; old.t = title; old.outcome = outcome;
        old.w = Math.floor(isoDiff(d, start) / 7) + 1;
        ev = old;
      } else {
        ev = { id: 'G' + Date.now(), by: ACTOR_ROLE === 'coach' ? 'coach' : 'student',
          kind: GFORM, d: d, w: Math.floor(isoDiff(d, start) / 7) + 1,
          t: title, outcome: outcome, note: '', lv: 2 };
        S.log.push(ev);
      }

      /* 新增才順手複製。改一個錯字也跳出「已複製」會很吵。 */
      var copied = (!old && window.UC_SHARE && window.UC_SHARE.copy)
        ? window.UC_SHARE.copy(growthEntryText(ev)) : null;

      GSELECT = d; GFORM = null; GEDIT = null;
      save(); renderGrowth();

      if (!copied) { toast('已儲存修改'); return; }
      copied.then(function (how) {
        toast(how === 'copy' ? '紀錄已儲存，文字已複製，可以貼到群組'
          : '紀錄已儲存，但文字沒有複製成功');
      });
    });
    }
    bindScreen();

    var exp = body.querySelector('[data-gexport]');
    if (exp) exp.addEventListener('click', function () { reportGrowth(records); });
    applyFieldAccess(body); reveal(body);
  }

  /* ── 課程資源與工具 ───────────────────────────────────
     切分頁**不重建整頁**：舊版每次點分頁都重寫 body，於是捲動位置被拉回頂端、
     淡入動畫重播一次，體感就像整頁重新整理。現在只換分頁窗格的內容。 */
  var LIBTAB = 'req', LIBOPEN = null, LIBRETURN_Y = null;

  function renderLibrary() {
    var L = window.UC_LIBRARY;

    /* ⚠️ **頁首只有標題。** 原本那句「30+ 小時錄播、12+ 堂…」是**銷售話術**，
       而且數量在下面的分頁鈕上本來就有（每個分頁都帶筆數）—— 重複又多餘。 */
    var h = wrap('<header class="rhead"><p class="ey">Adventure</p><h1>冒險</h1>'
      + '<div class="divider"><i></i><s></s></div></header>');

    /* 共用作業螢幕是冒險的第一個主體；舊卡片與分類全數保留在下方。 */
    h += wrap('<div id="adventureScreen"></div>', 'rv adventure-stage');
    /* 「課程工具」分頁拿掉了（使用者 2026-09-24）—— 十一份作業全部改在上方螢幕裡寫，
       下面再放一份入口就是重複。封面圖與 UC_TOOLS 資料都留著。 */
    h += wrap('<div class="adventure-library"><div class="tabs" id="libTabs">' + libTabs().map(function (t) {
        var n = t.k === 'tool' ? window.UC_TOOLS.items.length
              : L.items.filter(function (i) { return i.tab === t.k; }).length;
        return '<button class="tab" data-tab="' + t.k + '">'
          + esc(t.name) + '<b class="num">' + n + '</b></button>';
      }).join('') + '</div><div id="libPane"></div></div>', 'rv adventure-cards');

    var body = el('libBody');
    body.innerHTML = h;

    [].forEach.call(body.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { libTo(b.dataset.tab); });
    });
    renderAdventureScreen();
    libTo(LIBTAB, true);                 // 卡片都在窗格裡，由 libTo 綁
    if (LIBOPEN) {
      var pendingTool = LIBOPEN;
      LIBOPEN = null;
      if (!openAdventureTool(pendingTool, true)) toolTo(pendingTool);
    }
    reveal(body);
  }

  /* 換分頁。只換窗格內容，不動捲動位置、不重建整頁。 */
  function libTabs() {
    return window.UC_LIBRARY.tabs.filter(function (t) { return t.k !== 'tool'; });
  }

  function libTo(k, initial) {
    var L = window.UC_LIBRARY;
    /* 舊連結（#/tools、任務卡）還會要 'tool' —— 落回第一個分頁，作業本身由上方螢幕打開。 */
    if (!libTabs().some(function (t) { return t.k === k; })) k = libTabs()[0].k;
    LIBTAB = k;
    var tab = L.tabs.filter(function (t) { return t.k === k; })[0] || L.tabs[0];

    [].forEach.call(el('libTabs').children, function (b) {
      b.className = 'tab' + (b.dataset.tab === k ? ' on' : '');
    });

    var pane = el('libPane');
    /* 分頁的那行灰字說明拿掉了（使用者 2026-09-19：「不用解釋」）——
       分頁名稱與卡片自己說得清楚，多一行字只是把卡片往下推。
       文案還留在 data/library.js 的 note，要用再接回來。 */
    pane.innerHTML = (k === 'tool' ? toolsHtml()
                      : '<div class="grid">' + L.items.filter(function (i) { return i.tab === k; })
                          .map(function (i) { return tile(i); }).join('') + '</div>');

    bindTiles(pane);
    if (!initial) reveal(pane);          // 新內容淡入，但捲動位置不動
  }

  function bindTiles(root) {
    [].forEach.call(root.querySelectorAll('.tile[data-tool]'), function (b) {
      b.addEventListener('click', function () {
        if (!openAdventureTool(b.dataset.tool, true)) toolTo(b.dataset.tool);
      });
    });
    [].forEach.call(root.querySelectorAll('.tile[data-t]'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.list) { openLibList(b.dataset.list, b); return; }
        var url = b.dataset.src || '';
        if (!url) { toast('「' + b.dataset.t + '」的內容待補'); return; }
        openExternal(url);
      });
    });
  }

  /* 課程連結一律**開到外面**，不要在這個網頁裡瀏覽（使用者 2026-09-17）。
     ⚠️ 在 LINE 裡要用 liff.openWindow({ external: true })，把它交給系統瀏覽器 ——
     window.open 在 LINE 的內建瀏覽器裡常常被擋，而且 Google Drive 在 webview
     裡本來就不好用（要登入、有些格式開不起來）。
     沒有 LIFF 的環境（demo、桌機）退回 window.open。 */
  function openExternal(url) {
    try {
      if (window.liff && liff.openWindow && liff.isInClient && liff.isInClient()) {
        liff.openWindow({ url: url, external: true });
        return;
      }
    } catch (e) {}
    var w = window.open(url, '_blank', 'noopener');
    if (!w) toast('瀏覽器擋住了新分頁，請允許彈出視窗');
  }

  function tile(i) {
    return '<button type="button" class="tile"' + (i.list ? ' data-list="' + esc(i.id) + '"' : '')
      + ' data-src="' + esc(i.src) + '" data-t="' + esc(i.t) + '">'
      + '<span class="thumb' + (i.cover ? ' has-cover' : '') + '">'
      + (i.cover ? '<img src="' + esc(i.cover) + '" alt="" loading="lazy" decoding="async">' : '')
      + '<i class="num">' + esc(i.no) + '</i></span>'
      + '<b>' + esc(i.t) + '</b><s>' + esc(i.sub) + '</s>'
      /* 沒有 len 就整個不畫 —— 課程沒有章數（使用者 2026-09-18），
         留一個空的 <em> 會在卡片底部留一條莫名其妙的空行。 */
      + (i.len ? '<em class="num">' + esc(i.len) + '</em>' : '') + '</button>';
  }

  /* ── 課程工具（資源頁的一個分頁）──────────────────────
     跟其他分頁一樣是卡牌，點開才是內容（使用者指定）。
     內容展開在同一個窗格裡，不另開浮層 —— 換分頁本來就走這條路，
     不需要多一套 modal 的焦點與捲動鎖定。 */
  function toolsHtml() {
    return '<div class="grid">' + window.UC_TOOLS.items.map(function (t, i) {
      return '<button type="button" class="tile" data-tool="' + esc(t.k) + '">'
        + '<span class="thumb' + (t.cover ? ' has-cover' : '') + '">'
        + (t.cover ? '<img src="' + esc(t.cover) + '" alt="" loading="lazy" decoding="async">' : '')
        + '<i class="num">' + ('0' + (i + 1)).slice(-2) + '</i>'
        + '<u>' + (t.status === 'active' ? '可填寫' : t.status === 'preview' ? '結構示意' : '內容待補') + '</u></span>'
        + '<b>' + esc(t.t) + '</b><s>' + esc(t.lead) + '</s>'
        + '<em class="num">' + esc(t.en) + '</em></button>';
    }).join('') + '</div>';
  }

  function assignmentState(t) {
    var a = t.assignment;
    var saved = S.assignments[a.id];
    if (!saved) {
      saved = S.assignments[a.id] = {
        assignmentId: a.id, version: a.version || 1, status: 'draft', answers: {}, updatedAt: ''
      };
    }
    return saved;
  }

  function assignmentStatusText(status) {
    return status === 'completed' ? '已完成' : status === 'submitted' ? '已交作業' : '草稿';
  }

  function assignmentFields(a) {
    if (a.kind === 'focus-editor') return Array.isArray(a.fields) ? a.fields : [];
    if (a.kind === 'belief-cycle' && a.belief) {
      return [].concat(
        a.belief.stage1 && a.belief.stage1.fields || [],
        a.belief.stage2 && a.belief.stage2.loopFields || [],
        a.belief.stage2 && a.belief.stage2.exitFields || []
      );
    }
    if (Array.isArray(a.groups) && a.kind !== 'focus-editor') {
      return a.groups.reduce(function (out, g) {
        return out.concat(Array.isArray(g.fields) ? g.fields : []);
      }, []);
    }
    return Array.isArray(a.fields) ? a.fields : [];
  }

  function assignmentAnswerValue(saved, field) {
    if (Object.prototype.hasOwnProperty.call(saved.answers, field.id)) {
      return String(saved.answers[field.id] || '');
    }
    if (!Array.isArray(field.legacyFields)) return '';
    return field.legacyFields.map(function (legacy) {
      var value = String(saved.answers[legacy.id] || '').trim();
      return value ? legacy.t + '：' + value : '';
    }).filter(Boolean).join('\n\n');
  }

  function assignmentChoiceValue(saved, field) {
    if (!field || !field.choiceRequired) return '';
    return String(saved.answers[field.id + '-choice'] || '').trim();
  }

  function assignmentFieldComplete(saved, field) {
    return !!assignmentAnswerValue(saved, field).trim()
      && (!field.choiceRequired || !!assignmentChoiceValue(saved, field));
  }

  function assignmentFieldLabel(saved, field) {
    var choice = assignmentChoiceValue(saved, field);
    return choice || field.t;
  }

  function assignmentProgress(a, saved) {
    if (a.kind === 'belief-cycle' && a.belief) {
      var selected = beliefChoiceIds(a).filter(function (id) { return saved.answers[id] === '1'; }).length;
      var stage1 = a.belief.stage1;
      var stage2 = a.belief.stage2;
      var firstComplete = (selected > 0 || String(saved.answers['stage1-other'] || '').trim())
        && String(saved.answers['stage1-core'] || '').trim()
        && String(saved.answers['stage1-origin'] || '').trim();
      var secondRequired = [].concat(stage2.loopFields || [], stage2.exitFields || []).filter(function (f) {
        return f.required !== false;
      });
      var secondComplete = secondRequired.every(function (f) {
        return String(saved.answers[f.id] || '').trim();
      });
      return { answered: (firstComplete ? 1 : 0) + (secondComplete ? 1 : 0), total: 2,
        complete: firstComplete && secondComplete, stage1Complete: firstComplete,
        stage2Complete: secondComplete, selected: selected };
    }
    var fields = assignmentFields(a);
    var required = fields.filter(function (f) { return f.required !== false; });
    var complete = required.every(function (f) { return assignmentFieldComplete(saved, f); });
    if (Array.isArray(a.groups) && a.kind !== 'focus-editor') {
      var done = a.groups.filter(function (g) {
        return (g.fields || []).every(function (f) { return String(saved.answers[f.id] || '').trim(); });
      }).length;
      return { answered: done, total: a.groups.length, complete: complete };
    }
    return {
      answered: fields.filter(function (f) { return assignmentFieldComplete(saved, f); }).length,
      total: fields.length,
      complete: complete
    };
  }

  function assignmentFieldText(t, fieldId) {
    var a = t.assignment, saved = assignmentState(t);
    var field = assignmentFields(a).filter(function (f) { return f.id === fieldId; })[0];
    if (!field) return '';
    var choice = assignmentChoiceValue(saved, field);
    var label = (field.parent ? field.parent + '｜' : '') + field.t + (choice ? '｜' + choice : '');
    var lines = ['【' + (a.title || t.t) + '】', label];
    var value = assignmentAnswerValue(saved, field).trim();
    lines.push(value || '尚未填寫');
    return lines.join('\n');
  }

  function assignmentGroupText(t, groupId) {
    var a = t.assignment, saved = assignmentState(t);
    var group = (a.groups || []).filter(function (g) { return g.id === groupId; })[0];
    if (!group) return '';
    var lines = ['【' + (a.title || t.t) + '】', group.t];
    (group.fields || []).forEach(function (field) {
      var value = String(saved.answers[field.id] || '').trim();
      if (value) lines.push(field.t + '：' + value);
    });
    if (lines.length === 2) lines.push('尚未填寫');
    return lines.join('\n');
  }

  function assignmentReportText(t) {
    var a = t.assignment, saved = assignmentState(t), progress = assignmentProgress(a, saved);
    var lines = ['【' + (S.name || '學員') + '的作業進度】', a.title || t.t,
      '進度：' + progress.answered + ' / ' + progress.total, ''];
    assignmentFields(a).forEach(function (field) {
      var value = assignmentAnswerValue(saved, field).trim();
      if (!value) return;
      var choice = assignmentChoiceValue(saved, field);
      lines.push((field.parent ? field.parent + '｜' : '') + field.t + (choice ? '｜' + choice : ''));
      lines.push(value, '');
    });
    if (lines.length === 4) lines.push('目前尚未填寫內容。');
    return lines.join('\n').trim();
  }

  function adventureReportText() {
    var lines = ['【' + (S.name || '學員') + '的冒險進度】'];
    window.UC_TOOLS.items.filter(function (t) { return !!t.assignment; }).forEach(function (t) {
      var saved = assignmentState(t), progress = assignmentProgress(t.assignment, saved);
      lines.push('', t.assignment.title || t.t, '進度：' + progress.answered + ' / ' + progress.total);
      assignmentFields(t.assignment).forEach(function (field) {
        var value = assignmentAnswerValue(saved, field).trim();
        if (value) {
          var choice = assignmentChoiceValue(saved, field);
          lines.push('・' + (field.parent ? field.parent + '／' : '') + field.t
            + (choice ? '／' + choice : '') + '：' + value);
        }
      });
    });
    return lines.join('\n').trim();
  }

  function beliefChoiceIds(a) {
    var stage = a.belief && a.belief.stage1;
    return (stage && stage.categories || []).reduce(function (out, category) {
      return out.concat((category.items || []).map(function (item) { return item.id; }));
    }, []);
  }

  function assignmentStepsHTML(a) {
    if (!Array.isArray(a.steps) || !a.steps.length) return '';
    return '<div class="assignment-steps">' + a.steps.map(function (step) {
      return '<section><span class="num">' + esc(step.no) + '</span><div><h4>' + esc(step.t)
        + '</h4><p>' + esc(step.body) + '</p></div></section>';
    }).join('') + '</div>';
  }

  function assignmentLegacyFieldsHTML(a, saved) {
    return '<div class="assignment-fields">' + (a.fields || []).map(function (f, i) {
      return '<section class="assignment-field" data-field-id="assignment.' + esc(a.id) + '.' + esc(f.id)
        + '" data-field-owner="student" data-field-label="' + esc(f.t) + '">'
        + '<div class="assignment-number num">' + ('0' + (i + 1)).slice(-2) + '</div>'
        + '<div class="assignment-copy"><h3>' + esc(f.t) + '</h3><p class="assignment-sub">' + esc(f.sub) + '</p>'
        + '<p class="assignment-scope">' + esc(f.scope) + '</p></div>'
        + '<div class="assignment-answer"><textarea rows="7" data-assignment-answer="' + esc(f.id)
        + '" placeholder="' + esc(f.ph || '請依序寫下：現況、目標、如何實踐、為什麼想要。') + '">'
        + esc(saved.answers[f.id] || '') + '</textarea><div class="assignment-report-actions"><span></span>'
        + '<button type="button" class="btn gh" data-assignment-field-report="' + esc(f.id)
        + '">回報這一題</button></div></div>'
        + (f.example ? '<details class="assignment-example"><summary>看一個填寫範例</summary><p>'
          + esc(f.example).replace(/\n/g, '<br>') + '</p></details>' : '') + '</section>';
    }).join('') + '</div>';
  }

  /* 通用作業書寫室一次只顯示一個文字框。生活藍圖沿用既有 field id；
     戀愛三步驟則透過 legacyFields 合併讀取舊版四欄答案。 */
  /* 月面。⚠️ 跟星系圖同一條原則：**天體是光，不是輪廓**（規則 60）。
     這裡的攝影機已經落在月面上：遠方地平線接近水平，月壤從遠方一路延伸到
     畫面底部。大圓弧會被讀成「人在太空看月球」，不是「站在月球遠眺」。
     天空只放很淡的銀河和少量暗星；它們提供尺度，不搶作業文字。 */
  function assignmentMoonSVG() {
    var horizonPath = 'M-40 263 C45 257 108 250 185 259 C270 267 340 251 430 257 C520 264 590 256 645 249 C696 246 735 254 780 257 C835 262 875 258 940 253';
    var groundPath = horizonPath + ' L940 470 L-40 470 Z';
    return '<svg class="assignment-moon" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
      + '<defs>'
      /* 地表是偏左的單一光源，不再是均勻往下變暗的「灰色漸層板」。 */
      + '<radialGradient id="amSurf" gradientUnits="userSpaceOnUse" cx="245" cy="220" r="690" fx="170" fy="210">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".34"/>'
      +   '<stop offset="24%" stop-color="#E8E4DC" stop-opacity=".2"/>'
      +   '<stop offset="56%" stop-color="#E8E4DC" stop-opacity=".07"/>'
      +   '<stop offset="100%" stop-color="#131B2E" stop-opacity=".72"/>'
      + '</radialGradient>'
      + '<linearGradient id="amDepth" gradientUnits="userSpaceOnUse" x1="0" y1="232" x2="0" y2="462">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".02"/>'
      +   '<stop offset="44%" stop-color="#131B2E" stop-opacity=".12"/>'
      +   '<stop offset="100%" stop-color="#131B2E" stop-opacity=".7"/>'
      + '</linearGradient>'
      /* 掠過地表的低角度光，讓近處與遠處不是同一塊平灰色。 */
      + '<linearGradient id="amRake" gradientUnits="userSpaceOnUse" x1="105" y1="430" x2="790" y2="245">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".11"/>'
      +   '<stop offset="42%" stop-color="#E8E4DC" stop-opacity=".025"/>'
      +   '<stop offset="76%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</linearGradient>'
      /* 星點：中心實、四成處收、邊緣歸零（跟成長日誌同一顆）。 */
      + '<radialGradient id="amStar">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".95"/>'
      +   '<stop offset="12%" stop-color="#E8E4DC" stop-opacity=".62"/>'
      +   '<stop offset="30%" stop-color="#E8E4DC" stop-opacity=".2"/>'
      +   '<stop offset="60%" stop-color="#E8E4DC" stop-opacity=".045"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      /* 銀河只靠光暈成形，不畫外框。 */
      + '<radialGradient id="amNebula">'
      +   '<stop offset="0%" stop-color="#E8E4DC" stop-opacity=".12"/>'
      +   '<stop offset="34%" stop-color="#E8E4DC" stop-opacity=".045"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      + '<radialGradient id="amGalaxyCore">'
      +   '<stop offset="0%" stop-color="#E8A898" stop-opacity=".42"/>'
      +   '<stop offset="18%" stop-color="#E8E4DC" stop-opacity=".16"/>'
      +   '<stop offset="100%" stop-color="#E8E4DC" stop-opacity="0"/>'
      + '</radialGradient>'
      /* 月面圈定所有紋理，避免顆粒浮到天上。 */
      + '<clipPath id="amGroundClip"><path d="' + groundPath + '"/></clipPath>'
      /* 一個靜態 fractalNoise 取代數十個人工描邊；是質感不是特效，所以不動畫。 */
      + '<filter id="amDust" x="-80" y="220" width="1060" height="260" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">'
      +   '<feTurbulence type="fractalNoise" baseFrequency=".018 .052" numOctaves="3" seed="29" stitchTiles="stitch"/>'
      +   '<feColorMatrix type="matrix" values="0 0 0 0 .91  0 0 0 0 .89  0 0 0 0 .86  .3 0 0 0 -.08"/>'
      + '</filter>'
      /* 很小的位移打破完美橢圓，並加 .3px 模糊把銳利邊緣收掉。 */
      + '<filter id="amTerrainWarp" x="-100" y="210" width="1100" height="280" filterUnits="userSpaceOnUse">'
      +   '<feTurbulence type="fractalNoise" baseFrequency=".016 .04" numOctaves="2" seed="17" result="warp"/>'
      +   '<feDisplacementMap in="SourceGraphic" in2="warp" scale="4" xChannelSelector="R" yChannelSelector="G"/>'
      +   '<feGaussianBlur stdDeviation=".3"/>'
      + '</filter>'
      + '</defs>'

      /* 多數是 barely visible 的暗星，再用五顆固定亮星建立節奏；不做十字光芒。 */
      + '<g opacity=".6">' + skyStars(28, 903112, 900, 248) + '</g>'
      + '<g class="am-anchor-stars">'
      +   '<circle class="star" cx="428" cy="82" r="2.2" opacity=".54"/><circle class="starcore" cx="428" cy="82" r=".42" opacity=".78"/>'
      +   '<circle class="star" cx="526" cy="42" r="2.8" opacity=".62"/><circle class="starcore" cx="526" cy="42" r=".42" opacity=".9"/>'
      +   '<circle class="star" cx="716" cy="48" r="2.1" opacity=".48"/><circle class="starcore" cx="716" cy="48" r=".42" opacity=".72"/>'
      +   '<circle class="star" cx="592" cy="187" r="2.5" opacity=".52"/><circle class="starcore" cx="592" cy="187" r=".42" opacity=".8"/>'
      +   '<circle class="star" cx="812" cy="154" r="2.3" opacity=".5"/><circle class="starcore" cx="812" cy="154" r=".42" opacity=".76"/>'
      + '</g>'
      /* 銀河放在文字之外的右上方，只是一道視線深度，不做完整可辨識的圖案。 */
      + '<g class="am-galaxy" transform="rotate(-13 620 112)">'
      +   '<ellipse cx="620" cy="112" rx="250" ry="64" fill="url(#amNebula)"/>'
      +   '<ellipse cx="628" cy="108" rx="118" ry="24" fill="url(#amGalaxyCore)"/>'
      +   '<ellipse class="am-galaxy-core" cx="628" cy="108" rx="3.2" ry="1.6"/>'
      + '</g>'
      /* ── 站在月面的視角 ─────────────────────────────
         地平線只有低矮、不規則的起伏；地表延伸到鏡頭腳下，建立前後距離。 */
      + '<path class="am-surface" d="' + groundPath + '" fill="url(#amSurf)"/>'
      + '<path class="am-depth" d="' + groundPath + '" fill="url(#amDepth)"/>'
      + '<path class="am-rake" d="' + groundPath + '" fill="url(#amRake)"/>'
      + '<path class="am-limb" d="' + horizonPath + '" fill="none"/>'

      /* 月海與凹陷先畫，最後鋪一層月壤顆粒，所有形狀才會沉進同一塊地表。 */
      + '<g class="am-landmarks" filter="url(#amTerrainWarp)">'
      +   '<g transform="rotate(4 190 398)" opacity=".34"><ellipse class="am-crater-rim" cx="185" cy="392" rx="98" ry="20"/><ellipse class="am-crater-core" cx="199" cy="402" rx="82" ry="16"/></g>'
      +   '<g transform="rotate(-6 724 386)" opacity=".3"><ellipse class="am-crater-rim" cx="720" cy="382" rx="79" ry="16"/><ellipse class="am-crater-core" cx="732" cy="391" rx="66" ry="13"/></g>'
      + '</g>'
      + moonDetail(903112)
      + '<rect class="am-dust" x="-40" y="248" width="980" height="222" clip-path="url(#amGroundClip)" filter="url(#amDust)"/>'
      + '</svg>';
  }


  function assignmentSelectedField(a) {
    var id = ASSIGNMENT_SELECTED[a.id];
    return (a.fields || []).filter(function (f) { return f.id === id; })[0] || null;
  }

  function focusAssignmentTools() {
    return (window.UC_TOOLS && window.UC_TOOLS.items || []).filter(function (tool) {
      return tool.assignment && tool.assignment.kind === 'focus-editor';
    });
  }

  function assignmentCornersHTML() {
    return '<i class="afcorner afc-tl"></i><i class="afcorner afc-tr"></i>'
      + '<i class="afcorner afc-bl"></i><i class="afcorner afc-br"></i>';
  }

  function resetAssignmentNavigation(t) {
    if (!t || !t.assignment) return;
    var id = t.assignment.id;
    delete ASSIGNMENT_CHOOSING[id];
    delete ASSIGNMENT_GROUP[id];
    delete ASSIGNMENT_SELECTED[id];
    delete ASSIGNMENT_OPEN[id];
  }

  /* 用自製 HUD 選單取代原生 <select>。iOS／LIFF 的系統選單會強制變成
     白底視窗，幾乎無法套用 UC 深色視覺；按鈕清單才能保證各端一致。 */
  function assignmentThemePickerHTML(selectedKey, currentLabel) {
    var tools = focusAssignmentTools();
    var homeOn = !selectedKey;
    return '<div class="assignment-pickers"><div class="assignment-theme-control" data-theme-picker>'
      + '<button type="button" class="assignment-theme-toggle" data-theme-toggle aria-expanded="false">'
      + '<span class="assignment-theme-index">01</span><span class="assignment-theme-label">作業主題</span>'
      + '<strong>' + esc(currentLabel || '選擇一個主題') + '</strong><i aria-hidden="true"></i></button>'
      + '<div class="assignment-theme-menu" data-theme-menu hidden><div class="assignment-theme-menu-head">'
      + '<span>Choose a mission</span><b>選擇作業主題</b></div>'
      + '<button type="button" data-theme-choice="__adventure__"'
      + (homeOn ? ' class="is-current" aria-current="true"' : '') + '><span class="num">00</span>'
      + '<span><b>冒險首頁</b><small>Adventure Home</small></span><em>'
      + (homeOn ? '目前' : '返回') + '</em></button>'
      + tools.map(function (tool, i) {
        var label = tool.assignment.topicLabel || tool.t;
        var on = tool.k === selectedKey;
        return '<button type="button" data-theme-choice="' + esc(tool.k) + '"'
          + (on ? ' class="is-current" aria-current="true"' : '') + '><span class="num">'
          + ('0' + (i + 1)).slice(-2) + '</span><span><b>' + esc(label) + '</b><small>'
          + esc(tool.en || 'Assignment') + '</small></span><em>' + (on ? '目前' : '開啟') + '</em></button>';
      }).join('') + '</div></div></div>';
  }

  function bindAssignmentThemePicker(root, onPick) {
    var picker = root && root.querySelector('[data-theme-picker]');
    if (!picker) return;
    var toggle = picker.querySelector('[data-theme-toggle]');
    var menu = picker.querySelector('[data-theme-menu]');
    if (!toggle || !menu) return;
    function closeMenu() {
      menu.hidden = true;
      picker.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', function () {
      var open = menu.hidden;
      menu.hidden = !open;
      picker.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    [].forEach.call(menu.querySelectorAll('[data-theme-choice]'), function (choice) {
      choice.addEventListener('click', function () {
        var key = choice.dataset.themeChoice;
        closeMenu();
        if (key && onPick) onPick(key);
      });
    });
    var screen = picker.closest('.assignment-focus-screen');
    if (screen) screen.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) closeMenu();
    });
    picker.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMenu(); toggle.focus(); }
    });
  }

  /* 冒險的第一層：只給月面、一個清楚的名稱與主題選擇。
     選好後才進各作業原本的三層流程，避免一進頁面就要處理大量資訊。 */
  /* 冒險的進度：一份作業一顆點，寫完變實心（使用者 2026-09-24：要有成就感，
     容易看到又不搶戲）。放在螢幕首頁的主內容裡，進入寫作時跟月面一起退後。
     ⚠️ 讀 S.assignments 就好，**不要呼叫 assignmentState()** —— 那會塞空殼草稿。
     ⚠️ 背景資料還沒補到時不畫：畫出 0 / 11 會讓人以為寫過的東西不見了（規則 65）。 */
  function adventureProgressHTML() {
    if (restPending()) return '';
    var tools = focusAssignmentTools();
    if (!tools.length) return '';
    var done = 0, dots = tools.map(function (t) {
      var saved = (S.assignments || {})[t.assignment.id];
      var ok = !!(saved && saved.answers && assignmentProgress(t.assignment, saved).complete);
      if (ok) done++;
      return '<i class="' + (ok ? 'on' : '') + '" title="' + esc(t.t) + (ok ? '（完成）' : '') + '"></i>';
    }).join('');
    /* 一行就好：點在前、數字在後，跟標題同一條左緣。
       ⚠️ 第一版拆成「大數字／說明／一排點」三行並置中 —— 標題區是靠左的，
       置中的那塊就歪在一邊，還壓到月面的地平線（使用者 2026-09-24）。 */
    return '<p class="adventure-progress" aria-label="已完成 ' + done + ' / ' + tools.length + ' 份作業">'
      + '<span class="apdots" aria-hidden="true">' + dots + '</span>'
      + '<span class="apnum">' + done + ' / ' + tools.length + ' 完成</span></p>';
  }

  function adventureHomeHTML() {
    return '<section class="assignment assignment-focus adventure-workspace">'
      + '<div class="assignment-focus-shell"><div class="assignment-focus-screen is-idle adventure-screen">'
      + '<div class="assignment-screenbar"><span class="gled"></span><b>UC-ADVENTURE</b>'
      + '<s>READY</s><em>SELECT THEME</em></div>'
      + '<div class="assignment-screenin">' + assignmentCornersHTML() + assignmentMoonSVG()
      + '<div class="assignment-home adventure-home"><div class="assignment-home-copy">'
      + '<p class="ey">Adventure</p><h3>冒險</h3>'
      + '<p>選擇一個主題，從這裡開始這次探索。</p>' + adventureProgressHTML()
      + '</div><i class="assignment-home-beacon" aria-hidden="true"></i></div></div>'
      + '<div class="assignment-focus-footer">' + assignmentThemePickerHTML('', '冒險首頁')
      + '<div class="assignment-screen-reports"><button type="button" data-adventure-report>進度回報</button></div></div>'
      + '<i class="gscanline" aria-hidden="true"></i></div></div></section>';
  }

  function renderAdventureScreen() {
    var host = el('adventureScreen');
    if (!host) return;
    if (!ADVENTURE_TOOL) {
      host.innerHTML = adventureHomeHTML();
      bindAssignmentThemePicker(host, function (key) {
        if (key !== '__adventure__') openAdventureTool(key, false);
      });
      var all = host.querySelector('[data-adventure-report]');
      if (all) all.addEventListener('click', function () { reportProgressText(adventureReportText()); });
      return;
    }
    var t = focusAssignmentTools().filter(function (tool) { return tool.k === ADVENTURE_TOOL; })[0];
    if (!t) {
      ADVENTURE_TOOL = null;
      renderAdventureScreen();
      return;
    }
    host.innerHTML = assignmentHTML(t);
    bindAssignment(t, host);
  }

  /* 只有新式「單一書寫螢幕」作業會被接進上方冒險螢幕。
     其他舊工具仍保留原本卡片詳情，不假裝它們已經兼容新流程。 */
  function openAdventureTool(k, shouldScroll) {
    var t = focusAssignmentTools().filter(function (tool) { return tool.k === k; })[0];
    var host = el('adventureScreen');
    if (!t || !host) return false;
    resetAssignmentNavigation(t);
    ADVENTURE_TOOL = t.k;
    renderAdventureScreen();
    if (shouldScroll) requestAnimationFrame(function () {
      var top = Math.max(0, window.scrollY + host.getBoundingClientRect().top - 70);
      window.scrollTo(0, top);
    });
    return true;
  }

  function assignmentFocusHTML(t, saved) {
    var a = t.assignment;
    var listMode = a.mode === 'list';
    var listWriting = listMode && !!ASSIGNMENT_CHOOSING[a.id];
    var chosen = listMode ? null : assignmentSelectedField(a);
    var selected = chosen;
    var isChoosing = !listMode && !chosen && !!ASSIGNMENT_CHOOSING[a.id];
    var isHome = listMode ? !listWriting : !chosen && !isChoosing;
    var fields = a.fields || [];
    var sections = Array.isArray(a.sections) ? a.sections : [];
    var grouped = fields.length > 8 && sections.length;
    var activeGroup = grouped && ASSIGNMENT_GROUP[a.id]
      ? sections.filter(function (section) { return section.id === ASSIGNMENT_GROUP[a.id]; })[0] || null
      : null;
    var progress = assignmentProgress(a, saved);
    var topicLabel = a.topicLabel || t.t;
    /* ⚠️ 角括號與暗幕都用**真的節點**。一個元素只有兩個偽元素，
       而 ::before/::after 要留給「上緣的光」與「斜向反光」（規則 60 的玻璃處方）。
       修飾詞帶前綴（afc-tl 不是 tl）—— 兩個字母的 class 遲早撞名，見規則 67。 */
    var corners = assignmentCornersHTML();
    var mainBody = String(t.body || '').split(/\n\n+/).filter(Boolean).map(function (p) {
      return '<p>' + esc(p) + '</p>';
    }).join('');
    var steps = (a.steps || []).length ? '<div class="assignment-brief-steps">' + a.steps.map(function (step) {
      return '<section><span class="num">' + esc(step.no) + '</span><div><b>' + esc(step.t)
        + '</b><p>' + esc(step.body) + '</p></div></section>';
    }).join('') + '</div>' : '';
    var homeBody = '<div class="assignment-home"><div class="assignment-home-copy"><p class="ey">'
      + esc(t.en || 'Assignment') + '</p><h3>' + esc(a.title || t.t) + '</h3>'
      + (t.lead ? '<p>' + esc(t.lead) + '</p>' : '')
      + '<button type="button" class="assignment-home-start" data-assignment-choose><small>BEGIN</small><span>'
      + (progress.answered ? '繼續這份作業' : '開始這份作業')
      + '</span><b>→</b></button></div><i class="assignment-home-beacon" aria-hidden="true"></i></div>';
    function topicButtons(list) {
      return list.map(function (field) {
        var i = fields.indexOf(field);
        var written = assignmentAnswerValue(saved, field).trim();
        var choice = assignmentChoiceValue(saved, field);
        var complete = assignmentFieldComplete(saved, field);
        var state = complete ? '編輯' : choice ? '待補故事' : written ? '已開始' : '尚未填寫';
        return '<button type="button" data-assignment-detail="' + esc(field.id) + '"><span class="num">'
          + ('0' + (i + 1)).slice(-2) + '</span><b>' + esc(choice || field.t) + '</b><small>'
          + esc((field.parent ? field.parent + ' · ' : '') + state)
          + '</small></button>';
      }).join('');
    }
    var chooserBody;
    if (activeGroup) {
      var groupFields = fields.filter(function (field) { return field.parent === activeGroup.t; });
      chooserBody = '<div class="assignment-chooser"><button type="button" class="assignment-detail-back"'
        + ' data-assignment-groups>← 回到作業說明</button><div class="assignment-choice-panel">'
        + '<div class="assignment-brief assignment-group-brief"><p class="ey">'
        + esc(activeGroup.en || topicLabel) + '</p><h3>' + esc(activeGroup.t)
        + '</h3><p class="assignment-chooser-lead">' + esc(a.sectionLead || '選一個題目，開始整理這段人生故事。') + '</p></div>'
        + '<div class="assignment-overview-topics" aria-label="選擇作業子主題">'
        + topicButtons(groupFields) + '</div></div></div>';
    } else {
      var choices = grouped ? sections.map(function (section) {
        var groupFields = fields.filter(function (field) { return field.parent === section.t; });
        var done = groupFields.filter(function (field) { return assignmentFieldComplete(saved, field); }).length;
        return '<button type="button" data-assignment-group="' + esc(section.id) + '"><span class="num">'
          + esc(section.no) + '</span><b>' + esc(section.t) + '</b><small>'
          + esc(done ? done + ' / ' + groupFields.length + ' 已開始' : section.en || '選擇主軸')
          + '</small></button>';
      }).join('') : topicButtons(fields);
      chooserBody = '<div class="assignment-chooser"><button type="button" class="assignment-detail-back"'
        + ' data-assignment-home>← 作業首頁</button><div class="assignment-choice-panel"><div class="assignment-brief"><p class="ey">'
        + esc(topicLabel) + '</p><h3>' + esc(a.title || t.t) + '</h3>'
        + (t.lead ? '<p class="assignment-brief-lead">' + esc(t.lead) + '</p>' : '')
        + '<div class="assignment-brief-body">' + mainBody + (a.note ? '<p>' + esc(a.note) + '</p>' : '')
        + '</div>' + steps + '</div><div class="assignment-chooser-heading"><p class="ey">'
        + (grouped ? esc(a.sectionLabel || '三大主軸') : '作業題目') + '</p><h4>'
        + (grouped ? (a.sectionLabel ? '先選擇一個子主題' : '先選擇一個主軸') : '選擇現在要寫的主題')
        + '</h4><p>不用照順序，從現在最想整理的部分開始。</p></div>'
        + '<div class="assignment-overview-topics" aria-label="選擇作業主題">' + choices + '</div></div></div>';
    }
    var formatItems = selected ? String(selected.ph || a.placeholder || '').split(/\n+/).map(function (line) {
      return line.trim().replace(/[：:]\s*$/, '');
    }).filter(Boolean) : [];
    var formatGuide = selected ? (selected.formatGuide || a.formatGuide || []) : [];
    var formatDefinitions = formatGuide.length ? '<dl class="assignment-write-definitions">'
      + formatGuide.map(function (item) {
        return '<div><dt>' + esc(item.t) + '</dt><dd>' + esc(item.body) + '</dd></div>';
      }).join('') + '</dl>' : '';
    var example = selected && selected.example
      ? '<details class="assignment-write-fold assignment-write-example-fold"><summary><span><b>填寫範例</b>'
        + '<small>看看完成後會長什麼樣子</small></span><i></i></summary>'
        + '<div class="assignment-write-fold-body"><div class="assignment-write-example">'
        + esc(selected.example).replace(/\n/g, '<br>') + '</div></div></details>' : '';
    var selectedChoice = selected ? assignmentChoiceValue(saved, selected) : '';
    var usedChoices = fields.reduce(function (out, field) {
      var choice = field.id === (selected && selected.id) ? '' : assignmentChoiceValue(saved, field);
      if (choice) out[choice] = true;
      return out;
    }, {});
    var choicePicker = selected && selected.choiceRequired && Array.isArray(selected.options)
      ? '<section class="assignment-trait-picker"><div><p class="ey">選擇人格特質</p>'
        + '<h4>' + esc(selectedChoice || '哪一個詞最像你？') + '</h4>'
        + '<p>三題請選不同的特質。先選一個，再用故事說明它為什麼是你。</p></div>'
        + '<div class="assignment-trait-options" role="listbox" aria-label="人格特質清單">'
        + selected.options.map(function (option) {
          var on = option === selectedChoice;
          var disabled = !on && !!usedChoices[option];
          return '<button type="button" data-assignment-choice-field="' + esc(selected.id)
            + '" data-assignment-choice="' + esc(option) + '" class="' + (on ? 'is-selected' : '')
            + '" aria-selected="' + (on ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '')
            + '>' + esc(option) + '</button>';
        }).join('') + '</div></section>' : '';
    var detailBody = selected ? '<div class="assignment-compose" data-field-id="assignment.' + esc(a.id) + '.' + esc(selected.id)
      + '" data-field-owner="student" data-field-label="' + esc(selected.t) + '">'
      + '<button type="button" class="assignment-detail-back" data-assignment-return>← 選擇其他主題</button>'
      + '<header class="assignment-compose-head"><div><p class="ey">' + esc(selected.parent || topicLabel)
      + '</p><h3>' + esc(selectedChoice || selected.t) + '</h3></div></header>'
      + choicePicker
      + '<details class="assignment-write-fold"><summary><span><b>作業說明</b>'
      + '<small>先看清楚這題在找什麼</small></span><i></i></summary>'
      + '<div class="assignment-write-fold-body">'
      + (selected.sub ? '<strong>' + esc(selected.sub) + '</strong>' : '')
      + '<p>' + esc(selected.scope || a.prompt || '把想法集中寫在這一頁。') + '</p>'
      + (a.prompt && a.prompt !== selected.scope ? '<p>' + esc(a.prompt) + '</p>' : '')
      + formatDefinitions + '</div></details>'
      + example
      + (formatItems.length ? '<section class="assignment-write-section"><p class="ey">書寫格式</p><ol class="assignment-write-format">'
        + formatItems.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ol></section>' : '')
      + '<textarea data-assignment-answer="' + esc(selected.id) + '" data-assignment-fixed="1" aria-label="'
      + esc(topicLabel + '：' + selected.t) + '" placeholder="在此填寫">'
      + esc(assignmentAnswerValue(saved, selected)) + '</textarea><div class="assignment-report-actions">'
      + '<p class="assignment-autosave">內容會自動儲存，可以隨時回來修改。</p></div></div>' : '';
    var referenceBlock = listMode && Array.isArray(a.referenceTopics) && a.referenceTopics.length
      ? '<details class="assignment-write-fold assignment-list-reference"><summary><span><b>'
        + esc(a.referenceTitle || '參考內容') + '</b><small>'
        + esc(a.referenceLead || '需要靈感時再打開來看') + '</small></span><i></i></summary>'
        + '<div class="assignment-write-fold-body"><ol>' + a.referenceTopics.map(function (topic) {
          return '<li>' + esc(topic) + '</li>';
        }).join('') + '</ol></div></details>'
      : '';
    var listBody = listWriting ? '<div class="assignment-compose assignment-list-compose">'
      + '<button type="button" class="assignment-detail-back" data-assignment-home>← 作業首頁</button>'
      + '<header class="assignment-compose-head"><div><p class="ey">' + esc(topicLabel)
      + '</p><h3>' + esc(a.title || t.t) + '</h3></div></header>'
      + '<details class="assignment-write-fold"><summary><span><b>先看整理方式</b>'
      + '<small>需要方向時，再打開來看</small></span><i></i></summary>'
      + '<div class="assignment-write-fold-body"><strong>' + esc(t.lead || '') + '</strong><p>'
      + esc(a.prompt || '') + '</p>' + (a.note ? '<p>' + esc(a.note) + '</p>' : '') + '</div></details>'
      + referenceBlock + '<div class="assignment-list-grid">' + fields.map(function (field, i) {
        return '<label class="assignment-list-entry" data-field-id="assignment.' + esc(a.id) + '.' + esc(field.id)
          + '" data-field-owner="student" data-field-label="' + esc(field.t) + '"><span><b class="num">'
          + ('0' + (i + 1)).slice(-2) + '</b><em>' + esc(field.t) + '</em></span><textarea rows="3"'
          + ' data-assignment-answer="' + esc(field.id) + '" data-assignment-fixed="1" placeholder="'
          + esc(a.listPlaceholder || '在此填寫') + '">' + esc(assignmentAnswerValue(saved, field))
          + '</textarea></label>';
      }).join('') + '</div><p class="assignment-autosave">內容會自動儲存，可以隨時回來修改。</p></div>' : '';
    var screenBody = isHome ? homeBody : listMode ? listBody : isChoosing ? chooserBody : detailBody;
    var pickers = assignmentThemePickerHTML(t.k, topicLabel);
    /* 三層流程的底部都必須是真的選單。舊版在作業首頁換成純文字外觀，
       看起來跟可點 HUD 一樣，實際上卻完全不能按。 */
    var reportButton = selected
      ? '<button type="button" data-assignment-field-report="' + esc(selected.id) + '">回報這一題</button>'
      : '<button type="button" data-assignment-report>進度回報</button>';
    var footer = '<div class="assignment-focus-footer">' + pickers + '<div class="assignment-screen-reports">'
      + reportButton + '</div></div>';
    var writing = !!selected || listWriting;
    var screen = '<div class="assignment-focus-screen' + (writing ? ' is-writing' : ' is-idle')
      + '" data-assignment-focus><div class="assignment-screenbar"><span class="gled"></span><b>UC-WRITE</b>'
      + '<s>' + (writing ? 'WRITING' : isHome ? 'READY' : 'SELECT') + '</s><em id="assignmentProgress">' + progress.answered + ' / '
      + progress.total + '</em></div><div class="assignment-screenin">' + corners + assignmentMoonSVG()
      + screenBody + '</div>'
      + footer + '<i class="gscanline" aria-hidden="true"></i></div>';
    return '<div class="assignment-focus-shell">' + screen + '</div>';
  }

  function assignmentStoryExampleHTML(g) {
    if (!g.example) return '';
    return '<details class="assignment-example assignment-story-example"><summary>看完整填寫範例</summary><dl>'
      + (g.fields || []).map(function (f) {
        return '<div><dt>' + esc(f.t) + '</dt><dd>' + esc(g.example[f.key] || '') + '</dd></div>';
      }).join('') + '</dl></details>';
  }

  function assignmentStoryFilled(g, saved) {
    return (g.fields || []).filter(function (f) {
      return String(saved.answers[f.id] || '').trim();
    }).length;
  }

  function assignmentStoryOverviewHTML(a, saved, openId) {
    var sections = Array.isArray(a.sections) ? a.sections : [];
    return '<div class="assignment-story-overview"><p class="assignment-overview-intro">'
      + '先看全部故事，再選一個想整理的主題。不用一次寫完。</p>'
      + '<div class="assignment-story-matrix">' + sections.map(function (section) {
      var groups = a.groups.filter(function (g) { return g.section === section.id; });
      return '<section class="assignment-story-column"><header><span class="num">' + esc(section.no) + '</span>'
        + '<p class="ey">' + esc(section.en) + '</p><h3>' + esc(section.t) + '</h3></header>'
        + '<div class="assignment-story-topics">' + groups.map(function (g) {
          var index = a.groups.indexOf(g) + 1;
          var filled = assignmentStoryFilled(g, saved);
          var complete = filled === g.fields.length;
          var state = complete ? '編輯' : filled ? '整理中' : '';
          return '<button type="button" class="assignment-story-cell' + (complete ? ' is-complete' : filled ? ' is-started' : '')
            + (g.id === openId ? ' is-open' : '')
            + '" data-assignment-open="' + esc(g.id) + '" data-story-id="' + esc(g.id)
            + '" aria-expanded="' + (g.id === openId ? 'true' : 'false') + '"'
            + '" aria-label="填寫' + esc(section.t + g.t) + '"><span class="num">' + ('0' + index).slice(-2) + '</span>'
            + '<strong>' + esc(g.t) + '</strong><span class="assignment-story-state" data-story-progress="'
            + esc(g.id) + '" data-progress-quiet="1">' + state + '</span></button>';
        }).join('') + '</div></section>';
      }).join('') + '</div><p class="assignment-overview-foot">'
      + '有寫過的主題會標記為「整理中」；四欄都填完才顯示「完成」。</p></div>';
  }

  function assignmentStoryEditorHTML(a, saved, g) {
    var section = (a.sections || []).filter(function (x) { return x.id === g.section; })[0] || {};
    var index = a.groups.indexOf(g) + 1;
    var filled = assignmentStoryFilled(g, saved);
    return '<div class="assignment-story-editor" data-assignment-editor><button type="button" class="btn gh assignment-story-back"'
      + ' data-assignment-back>收起這一則</button>'
      + '<article class="assignment-story' + (filled === g.fields.length ? ' is-complete' : '')
      + '" data-story-id="' + esc(g.id) + '"><header><span class="num">' + ('0' + index).slice(-2) + '</span>'
      + '<div><p>' + esc(section.t || '') + '</p><h4>' + esc(g.t) + '</h4></div>'
      + '<span class="assignment-story-progress" data-story-progress="' + esc(g.id) + '">'
      + filled + ' / ' + g.fields.length + '</span></header>'
      + '<div class="assignment-story-inputs">' + g.fields.map(function (f) {
        return '<label class="assignment-story-input" data-field-id="assignment.' + esc(a.id) + '.' + esc(f.id)
          + '" data-field-owner="student" data-field-label="' + esc(g.t + '／' + f.t) + '">'
          + '<span><b>' + esc(f.t) + '</b><small>' + esc(f.help) + '</small></span>'
          + '<textarea rows="' + Math.max(2, Math.min(10, Number(f.rows) || 4))
          + '" data-assignment-answer="' + esc(f.id) + '" placeholder="' + esc(f.ph) + '">'
          + esc(saved.answers[f.id] || '') + '</textarea></label>';
      }).join('') + '</div><div class="assignment-report-actions"><span></span><button type="button" class="btn gh"'
      + ' data-assignment-field-report="' + esc(g.fields[0] ? g.fields[0].id : '') + '" data-assignment-group-report="'
      + esc(g.id) + '">回報這一題</button></div>' + assignmentStoryExampleHTML(g) + '</article>'
      + '<p class="assignment-editor-hint">內容會隨填寫自動儲存。上面的清單一直在，想換主題直接點下一個。</p></div>';
  }

  /* ⚠️ **總表不可以被編輯區換掉。**
     舊版是「點一個主題 → 整張總表消失、換成那一題的編輯畫面 → 要按返回才回得去」。
     12 個主題就是 12 次來回，使用者回報「每次點一個話題都是轉跳頁面，太麻煩」。

     改成總表永遠在上面（點過的主題有標記），編輯區接在它下面換內容 ——
     想換主題直接點下一個，不用先退回去。 */
  function assignmentGroupedFieldsHTML(a, saved) {
    var openId = ASSIGNMENT_OPEN[a.id];
    var group = (a.groups || []).filter(function (g) { return g.id === openId; })[0];
    return assignmentStoryOverviewHTML(a, saved, openId)
      + '<div data-assignment-editor-slot>'
      + (group ? assignmentStoryEditorHTML(a, saved, group) : '')
      + '</div>';
  }

  function assignmentBeliefFieldHTML(a, saved, f, extraClass) {
    return '<label class="belief-field' + (extraClass ? ' ' + extraClass : '')
      + '" data-field-id="assignment.' + esc(a.id) + '.' + esc(f.id)
      + '" data-field-owner="student" data-field-label="' + esc(f.t) + '">'
      + '<span><b>' + esc(f.t) + '</b><small>' + esc(f.help || '') + '</small></span>'
      + '<textarea rows="' + Math.max(2, Math.min(9, Number(f.rows) || 4))
      + '" data-assignment-answer="' + esc(f.id) + '" placeholder="' + esc(f.ph || '') + '">'
      + esc(saved.answers[f.id] || '') + '</textarea></label>';
  }

  function assignmentBeliefHTML(a, saved) {
    var belief = a.belief, stage1 = belief.stage1, stage2 = belief.stage2;
    var active = ASSIGNMENT_OPEN[a.id] === 'stage2' ? 'stage2' : 'stage1';
    var progress = assignmentProgress(a, saved);
    return '<div class="belief-workbook" data-belief-workbook data-belief-stage="' + active + '">'
      + '<div class="belief-tabs" role="tablist" aria-label="信念系統兩階段">'
      + '<button type="button" role="tab" data-belief-tab="stage1" aria-selected="'
      + (active === 'stage1' ? 'true' : 'false') + '" class="' + (active === 'stage1' ? 'is-on' : '') + '">'
      + '<span class="num">' + esc(stage1.no) + '</span><b>' + esc(stage1.t) + '</b><small>'
      + '<span data-belief-tab-state="stage1">' + (progress.stage1Complete ? '編輯' : '先從這裡開始') + '</span></small></button>'
      + '<i aria-hidden="true"></i>'
      + '<button type="button" role="tab" data-belief-tab="stage2" aria-selected="'
      + (active === 'stage2' ? 'true' : 'false') + '" class="' + (active === 'stage2' ? 'is-on' : '') + '">'
      + '<span class="num">' + esc(stage2.no) + '</span><b>' + esc(stage2.t) + '</b><small>'
      + '<span data-belief-tab-state="stage2">' + (progress.stage2Complete ? '編輯' : '用一件事練習') + '</span></small></button></div>'
      + '<section class="belief-stage" role="tabpanel" data-belief-panel="stage1"'
      + (active === 'stage1' ? '' : ' hidden') + '><header class="belief-stage-head"><p class="ey">'
      + esc(stage1.en) + '</p><h3>' + esc(stage1.t) + '</h3><p>' + esc(stage1.body) + '</p></header>'
      + '<div class="belief-categories">' + (stage1.categories || []).map(function (category) {
        return '<section class="belief-category"><header><h4>' + esc(category.t) + '</h4><span>'
          + (category.items || []).length + ' 個句子</span></header><div class="belief-choices">'
          + (category.items || []).map(function (item) {
            var checked = saved.answers[item.id] === '1';
            return '<label class="belief-choice' + (checked ? ' is-checked' : '')
              + '" data-field-id="assignment.' + esc(a.id) + '.' + esc(item.id)
              + '" data-field-owner="student" data-field-label="常見信念句">'
              + '<input type="checkbox" data-belief-choice="' + esc(item.id) + '"'
              + (checked ? ' checked' : '') + '><i aria-hidden="true"></i><span>' + esc(item.text)
              + '</span></label>';
          }).join('') + '</div></section>';
      }).join('') + '</div><p class="belief-selected"><span data-belief-selected>' + progress.selected
      + '</span> 個想法曾經出現過</p>'
      + '<div class="belief-fields belief-stage1-fields">' + (stage1.fields || []).map(function (f) {
        return assignmentBeliefFieldHTML(a, saved, f, f.id === 'stage1-other' ? 'is-optional' : '');
      }).join('') + '</div><div class="belief-stage-actions"><span>內容會自動儲存</span>'
      + '<button type="button" class="btn pri" data-belief-next>進入第二階段 →</button></div></section>'
      + '<section class="belief-stage" role="tabpanel" data-belief-panel="stage2"'
      + (active === 'stage2' ? '' : ' hidden') + '><header class="belief-stage-head"><p class="ey">'
      + esc(stage2.en) + '</p><h3>' + esc(stage2.t) + '</h3><p>' + esc(stage2.body) + '</p></header>'
      + '<div class="belief-cycle-section"><header><span class="num">A</span><div><h4>'
      + esc(stage2.loopTitle) + '</h4><p>' + esc(stage2.loopLead) + '</p></div></header>'
      + '<div class="belief-cycle-fields">' + (stage2.loopFields || []).map(function (f, i) {
        return assignmentBeliefFieldHTML(a, saved, f, 'belief-cycle-field belief-cycle-' + (i + 1));
      }).join('') + '</div></div>'
      + '<div class="belief-pivot"><span aria-hidden="true">↓</span><b>' + esc(stage2.pivotTitle)
      + '</b><p>' + esc(stage2.pivotBody) + '</p></div>'
      + '<div class="belief-cycle-section belief-new-path"><header><span class="num">B</span><div><h4>'
      + esc(stage2.exitTitle) + '</h4><p>' + esc(stage2.exitLead) + '</p></div></header>'
      + '<div class="belief-exit-fields">' + (stage2.exitFields || []).map(function (f) {
        return assignmentBeliefFieldHTML(a, saved, f, f.required === false ? 'is-optional' : '');
      }).join('') + '</div></div>'
      + '<div class="belief-stage-actions"><button type="button" class="btn gh" data-belief-back>← 回看第一階段</button>'
      + '<span>行動後可以再回來補上新證據</span></div></section></div>';
  }

  function assignmentHTML(t) {
    var a = t.assignment;
    /* ⚠️ **資料沒到就不要開表單。** assignmentState() 會先塞一份空草稿佔位，
       使用者在上面打一個字，那一整包空的就會覆蓋掉他之前寫好的作業（無聲）。
       擋在這裡，比在四個欄位渲染器裡各擋一次省事，也不會漏。 */
    var wait = restPending();
    if (wait) {
      return '<section class="assignment" data-assignment="' + esc(a.id) + '">'
        + '<div class="assignment-head"><div><p class="ey">這次的作業</p><h3>'
        + esc(a.title || '完成這份作業') + '</h3></div></div>'
        + (wait === 'loading'
          ? '<p class="restnote">正在讀取你之前寫的內容…好了才會開放填寫，避免蓋掉。</p>'
          : '<p class="restnote is-bad">讀不到你之前寫的內容。先不開放填寫，以免覆蓋掉。'
            + '<button type="button" data-rest-retry>重新讀取</button></p>') + '</section>';
    }
    var saved = assignmentState(t);
    var progress = assignmentProgress(a, saved);
    var progressUnit = a.progressUnit ? ' ' + a.progressUnit : '';
    var editingStory = Array.isArray(a.groups) && a.groups.some(function (g) {
      return g.id === ASSIGNMENT_OPEN[a.id];
    });
    var focusEditor = a.kind === 'focus-editor';
    if (focusEditor) {
      return '<section class="assignment assignment-focus" data-assignment="' + esc(a.id) + '">'
        + assignmentFocusHTML(t, saved) + '</section>';
    }
    return '<section class="assignment" data-assignment="' + esc(a.id) + '">'
      + (editingStory || focusEditor ? '' : '<div class="assignment-note"><p>' + esc(a.note) + '</p></div>')
      + '<div class="assignment-head"><div><p class="ey">這次的作業</p><h3>'
      + esc(a.title || '完成這份作業') + '</h3></div>'
      + '<div class="assignment-meta"><span id="assignmentProgress">' + progress.answered + ' / '
      + progress.total + progressUnit + '</span>'
      + '<span id="assignmentStatus">' + assignmentStatusText(saved.status) + '</span></div></div>'
      + (editingStory || focusEditor ? '' : assignmentStepsHTML(a) + '<p class="assignment-guide">' + esc(a.prompt) + '</p>')
      + (a.kind === 'belief-cycle' ? assignmentBeliefHTML(a, saved)
        : Array.isArray(a.groups) ? assignmentGroupedFieldsHTML(a, saved) : assignmentLegacyFieldsHTML(a, saved))
      + (editingStory || focusEditor ? '' : '<div class="assignment-actions"><p id="assignmentSaveHint">內容會隨填寫自動儲存。</p>'
        + '<button type="button" class="btn gh" data-assignment-report>進度回報</button>'
        + '<button type="button" class="btn pri" id="assignmentSubmit">'
        + (ACTOR_ROLE === 'coach' ? '標記完成' : '交作業') + '</button></div>') + '</section>';
  }

  function refreshAssignment(t, pane, selector) {
    var current = pane.querySelector('[data-assignment="' + t.assignment.id + '"]');
    if (!current) return;
    var holder = document.createElement('div');
    holder.innerHTML = assignmentHTML(t);
    current.parentNode.replaceChild(holder.firstElementChild, current);
    bindAssignment(t, pane);
    var target = selector && pane.querySelector(selector);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindAssignment(t, pane) {
    var a = t.assignment, saved = assignmentState(t), fields = assignmentFields(a);
    var button = pane.querySelector('#assignmentSubmit');
    [].forEach.call(pane.querySelectorAll('[data-assignment-field-report]'), function (report) {
      report.addEventListener('click', function () {
        var text = report.dataset.assignmentGroupReport
          ? assignmentGroupText(t, report.dataset.assignmentGroupReport)
          : assignmentFieldText(t, report.dataset.assignmentFieldReport);
        reportProgressText(text, '這一題已複製，可以貼到群組回報');
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-report]'), function (report) {
      report.addEventListener('click', function () {
        reportProgressText(assignmentReportText(t), '這份作業已複製，可以貼到群組回報');
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-adventure-report]'), function (report) {
      report.addEventListener('click', function () { reportProgressText(adventureReportText()); });
    });
    function sync() {
      var progressInfo = assignmentProgress(a, saved);
      var progress = pane.querySelector('#assignmentProgress');
      var status = pane.querySelector('#assignmentStatus');
      if (progress) progress.textContent = progressInfo.answered + ' / ' + progressInfo.total
        + (a.progressUnit ? ' ' + a.progressUnit : '');
      if (status) status.textContent = assignmentStatusText(saved.status);
      if (button) {
        button.disabled = !progressInfo.complete || saved.status === 'completed'
          || (ACTOR_ROLE !== 'coach' && saved.status === 'submitted');
        button.textContent = saved.status === 'completed' ? '已完成'
          : ACTOR_ROLE === 'coach' ? '標記完成' : saved.status === 'submitted' ? '已交作業' : '交作業';
      }
      (a.groups || []).forEach(function (g) {
        var filled = assignmentStoryFilled(g, saved);
        var node = pane.querySelector('[data-story-progress="' + g.id + '"]');
        if (node) node.textContent = node.dataset.progressQuiet
          ? (filled === g.fields.length ? '編輯' : filled ? '整理中' : '')
          : filled + ' / ' + g.fields.length;
        var card = pane.querySelector('[data-story-id="' + g.id + '"]');
        if (card) {
          card.classList.toggle('is-started', filled > 0 && filled < g.fields.length);
          card.classList.toggle('is-complete', filled === g.fields.length);
        }
      });
      if (a.kind === 'belief-cycle') {
        var selected = pane.querySelector('[data-belief-selected]');
        if (selected) selected.textContent = progressInfo.selected;
        [].forEach.call(pane.querySelectorAll('[data-belief-choice]'), function (choice) {
          var choiceOn = saved.answers[choice.dataset.beliefChoice] === '1';
          choice.checked = choiceOn;
          if (choice.parentNode) choice.parentNode.classList.toggle('is-checked', choiceOn);
        });
        var stage1State = pane.querySelector('[data-belief-tab-state="stage1"]');
        var stage2State = pane.querySelector('[data-belief-tab-state="stage2"]');
        if (stage1State) stage1State.textContent = progressInfo.stage1Complete ? '編輯' : '先從這裡開始';
        if (stage2State) stage2State.textContent = progressInfo.stage2Complete ? '編輯' : '用一件事練習';
      }
      if (a.kind === 'focus-editor') {
        [].forEach.call(pane.querySelectorAll('[data-assignment-topic]'), function (topic) {
          topic.classList.toggle('is-started', !!String(saved.answers[topic.dataset.assignmentTopic] || '').trim());
        });
      }
    }
    function showFocusDetail(id) {
      if (!id) return;
      delete ASSIGNMENT_CHOOSING[a.id];
      ASSIGNMENT_SELECTED[a.id] = id;
      refreshAssignment(t, pane, '[data-assignment-focus]');
    }
    function showFocusChoose() {
      ASSIGNMENT_CHOOSING[a.id] = true;
      delete ASSIGNMENT_GROUP[a.id];
      delete ASSIGNMENT_SELECTED[a.id];
      refreshAssignment(t, pane, '[data-assignment-focus]');
    }
    function showFocusReturn() {
      var field = assignmentSelectedField(a);
      var section = field && (a.sections || []).filter(function (item) { return item.t === field.parent; })[0];
      ASSIGNMENT_CHOOSING[a.id] = true;
      if (section && fields.length > 8) ASSIGNMENT_GROUP[a.id] = section.id;
      else delete ASSIGNMENT_GROUP[a.id];
      delete ASSIGNMENT_SELECTED[a.id];
      refreshAssignment(t, pane, '[data-assignment-focus]');
    }
    function showFocusHome() {
      delete ASSIGNMENT_CHOOSING[a.id];
      delete ASSIGNMENT_GROUP[a.id];
      delete ASSIGNMENT_SELECTED[a.id];
      refreshAssignment(t, pane, '[data-assignment-focus]');
    }
    [].forEach.call(pane.querySelectorAll('[data-assignment-topic]'), function (topic) {
      topic.addEventListener('click', function () { showFocusDetail(topic.dataset.assignmentTopic); });
    });
    bindAssignmentThemePicker(pane, function (key) {
      if (!key || key === t.k) return;
      if (key === '__adventure__') {
        ADVENTURE_TOOL = null;
        renderAdventureScreen();
        return;
      }
      if (pane.id === 'adventureScreen' || (pane.closest && pane.closest('#adventureScreen'))) {
        openAdventureTool(key, false);
      } else {
        toolTo(key);
      }
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-detail]'), function (detail) {
      detail.addEventListener('click', function () { showFocusDetail(detail.dataset.assignmentDetail); });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-choose]'), function (choose) {
      choose.addEventListener('click', showFocusChoose);
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-home]'), function (home) {
      home.addEventListener('click', showFocusHome);
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-group]'), function (group) {
      group.addEventListener('click', function () {
        ASSIGNMENT_GROUP[a.id] = group.dataset.assignmentGroup;
        refreshAssignment(t, pane, '[data-assignment-focus]');
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-groups]'), function (groups) {
      groups.addEventListener('click', function () {
        delete ASSIGNMENT_GROUP[a.id];
        refreshAssignment(t, pane, '[data-assignment-focus]');
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-return]'), function (back) {
      back.addEventListener('click', showFocusReturn);
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-jump]'), function (jump) {
      jump.addEventListener('click', function () { showFocusDetail(jump.dataset.assignmentJump); });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-open]'), function (open) {
      open.addEventListener('click', function () {
        var id = open.dataset.assignmentOpen;
        /* 再點一次同一個就收起來 —— 跟「收起這一則」同一件事。 */
        var opening = ASSIGNMENT_OPEN[a.id] !== id;
        if (opening) ASSIGNMENT_OPEN[a.id] = id;
        else delete ASSIGNMENT_OPEN[a.id];
        /* 收起來的時候不要捲 —— 那會把畫面拉到一個空的容器上。 */
        refreshAssignment(t, pane, opening ? '[data-assignment-editor]' : null);
      });
    });
    var back = pane.querySelector('[data-assignment-back]');
    if (back) back.addEventListener('click', function () {
      delete ASSIGNMENT_OPEN[a.id];
      refreshAssignment(t, pane, '.assignment-story-overview');
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-choice]'), function (choice) {
      choice.addEventListener('click', function () {
        if (choice.disabled) return;
        var fieldId = choice.dataset.assignmentChoiceField;
        if (!fieldId) return;
        saved.answers[fieldId + '-choice'] = choice.dataset.assignmentChoice;
        saved.status = 'draft';
        saved.updatedAt = new Date().toISOString();
        save();
        refreshAssignment(t, pane, '[data-assignment-focus]');
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-assignment-answer]'), function (textarea) {
      if (!textarea.dataset.assignmentFixed) grow(textarea);
      textarea.addEventListener('input', function () {
        saved.answers[textarea.dataset.assignmentAnswer] = textarea.value;
        saved.status = 'draft';
        saved.updatedAt = new Date().toISOString();
        save();
        if (!textarea.dataset.assignmentFixed) grow(textarea);
        sync();
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-belief-choice]'), function (checkbox) {
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) saved.answers[checkbox.dataset.beliefChoice] = '1';
        else delete saved.answers[checkbox.dataset.beliefChoice];
        saved.status = 'draft';
        saved.updatedAt = new Date().toISOString();
        save(); sync();
      });
    });
    if (a.kind === 'belief-cycle') {
      var workbook = pane.querySelector('[data-belief-workbook]');
      function setBeliefStage(stage, shouldScroll) {
        if (!workbook || ['stage1', 'stage2'].indexOf(stage) < 0) return;
        ASSIGNMENT_OPEN[a.id] = stage;
        workbook.dataset.beliefStage = stage;
        [].forEach.call(workbook.querySelectorAll('[data-belief-panel]'), function (panel) {
          panel.hidden = panel.dataset.beliefPanel !== stage;
        });
        [].forEach.call(workbook.querySelectorAll('[data-belief-tab]'), function (tab) {
          var on = tab.dataset.beliefTab === stage;
          tab.classList.toggle('is-on', on);
          tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        if (shouldScroll) workbook.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      [].forEach.call(pane.querySelectorAll('[data-belief-tab]'), function (tab) {
        tab.addEventListener('click', function () { setBeliefStage(tab.dataset.beliefTab, true); });
      });
      var next = pane.querySelector('[data-belief-next]');
      if (next) next.addEventListener('click', function () {
        if (!String(saved.answers['stage2-belief'] || '').trim()
            && String(saved.answers['stage1-core'] || '').trim()) {
          saved.answers['stage2-belief'] = saved.answers['stage1-core'];
          saved.status = 'draft';
          saved.updatedAt = new Date().toISOString();
          var beliefInput = pane.querySelector('[data-assignment-answer="stage2-belief"]');
          if (beliefInput) { beliefInput.value = saved.answers['stage2-belief']; grow(beliefInput); }
          save(); sync();
        }
        setBeliefStage('stage2', true);
      });
      var backBelief = pane.querySelector('[data-belief-back]');
      if (backBelief) backBelief.addEventListener('click', function () { setBeliefStage('stage1', true); });
    }
    if (button) button.addEventListener('click', function () {
      if (button.disabled) return;
      saved.status = ACTOR_ROLE === 'coach' ? 'completed' : 'submitted';
      saved.updatedAt = new Date().toISOString();
      save(); sync();
      toast(saved.status === 'completed' ? '已標記為完成' : '作業已送出');
    });
    applyFieldAccess(pane);
    sync();
  }

  /* 點開一張工具卡。詳情一定從標題開始，不可繼承卡片在清單中的高度；
     但返回清單時要回到原來那張卡的位置，才不用重新往下找。 */
  function toolTo(k) {
    var t = window.UC_TOOLS.items.filter(function (x) { return x.k === k; })[0];
    if (!t) return;
    LIBRETURN_Y = window.scrollY;
    /* 每次重新進入這類作業都先回總表；填過的內容仍在，只是不讓使用者被直接丟回長表單。 */
    if (t.assignment) resetAssignmentNavigation(t);
    var badge = t.status === 'active' ? '可填寫' : t.status === 'preview' ? '結構示意' : '內容待補';
    var backHTML = '<button class="btn gh bk" id="toolBack">← 回到課程工具</button>';
    var introHTML = '<div class="assignment-tool-context"><div class="thead"><div><p class="ey">' + t.en + '</p><h2>' + esc(t.t) + '</h2></div>'
      + '<span class="badge ' + t.status + '">' + badge + '</span></div>'
      + '<div class="divider"><i></i><s></s></div>'
      + '<p class="tlead">' + esc(t.lead) + '</p>'
      + String(t.body || '').split(/\n\n+/).map(function (p) { return '<p class="tbody">' + esc(p) + '</p>'; }).join('')
      + '</div>';
    var focusEditor = t.assignment && t.assignment.kind === 'focus-editor';
    var x = backHTML + (focusEditor ? assignmentHTML(t) : introHTML);
    if (t.assignment && !focusEditor) x += assignmentHTML(t);
    if (t.preview) {
      x += '<p class="snote">' + esc(t.preview.note) + '</p><div class="legs">'
        + t.preview.legs.map(function (g) {
            return '<div class="leg"><span class="num">' + g.no + '</span>'
              + '<div><h3>' + esc(g.phase) + '</h3><p class="lplace">' + esc(g.place) + '</p>'
              + '<p class="lwhy">' + esc(g.why) + '</p></div></div>';
          }).join('') + '</div>';
    }
    if (t.tables && t.tables.length) {
      x += '<div class="tplans">' + t.tables.map(function (p, pi) {
        var tableId = p.id || ('table-' + (pi + 1));
        return '<section class="tplan"><h3>' + esc(p.t) + '</h3><div class="tplan-scroll"><table>'
          + '<thead><tr>' + p.cols.map(function (c, ci) {
              var owner = p.owners && p.owners[ci] || 'system';
              var tag = owner === 'coach' ? '教練填寫' : owner === 'student' ? '學員填寫' : '';
              return '<th>' + esc(c) + (tag ? '<small class="fieldtag ' + owner + ' compact">' + tag + '</small>' : '') + '</th>';
            }).join('') + '</tr></thead>'
          + '<tbody>' + p.rows.map(function (row, ri) {
              var rowId = p.rowIds && p.rowIds[ri] || ('row-' + (ri + 1));
              return '<tr>' + row.map(function (cell, ci) {
                var owner = p.owners && p.owners[ci] || 'system';
                var colId = p.colIds && p.colIds[ci] || ('col-' + (ci + 1));
                var field = owner === 'system' ? ''
                  : ' class="fieldcell ' + owner + '" data-field-id="tool.' + esc(t.k) + '.' + esc(tableId)
                    + '.' + esc(rowId) + '.' + esc(colId) + '" data-field-owner="' + owner
                    + '" data-field-label="' + esc(p.cols[ci]) + '"';
                return '<td' + field + '>' + esc(cell || '') + '</td>';
              }).join('') + '</tr>';
            }).join('') + '</tbody></table></div></section>';
      }).join('') + '</div>';
    }
    if (t.source) x += '<p class="snote tsource">' + esc(t.source) + '</p>';
    var pane = el('libPane');
    pane.innerHTML = '<div class="tool">' + x + '</div>';
    el('toolBack').addEventListener('click', function () {
      var y = LIBRETURN_Y;
      LIBRETURN_Y = null;
      libTo('tool');
      requestAnimationFrame(function () { window.scrollTo(0, y == null ? 0 : y); });
    });
    if (t.assignment) bindAssignment(t, pane);
    reveal(pane);
    requestAnimationFrame(function () {
      var top = Math.max(0, window.scrollY + pane.getBoundingClientRect().top - 70);
      window.scrollTo(0, top);
    });
  }

  /* 輕量 toast，取代 alert */
  var toastT;
  function toast(msg) {
    var n = el('toast');
    if (!n) {
      n = document.createElement('div');
      n.id = 'toast'; n.className = 'toast';
      n.setAttribute('role', 'status');
      document.body.appendChild(n);
    }
    n.textContent = msg;
    n.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { n.classList.remove('on'); }, 2400);
  }

  /* ── 啟動 ─────────────────────────────────────────── */
  window.addEventListener('hashchange', function () { go(location.hash); });

  /* iOS／LIFF 會把 fixed 導覽列抬到軟體鍵盤上方。只要文字欄位取得焦點，窄螢幕
     就先把導覽列收起；離開欄位後再放回來，避免它佔掉作答空間。 */
  function isTypingField(node) {
    return !!(node && node.matches && node.matches(
      'textarea,[contenteditable="true"],input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"])'));
  }
  function syncKeyboardClass() {
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 900px)').matches : innerWidth <= 900;
    document.documentElement.classList.toggle('uc-keyboard-open', narrow && isTypingField(document.activeElement));
  }
  document.addEventListener('focusin', syncKeyboardClass);
  document.addEventListener('focusout', function () { setTimeout(syncKeyboardClass, 80); });
  window.addEventListener('resize', syncKeyboardClass);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncKeyboardClass);

  if (location.hash === '#selftest') { window.UC_SELFTEST && window.UC_SELFTEST(); return; }
  go(location.hash || '#/');

  document.documentElement.dataset.ucRole = ACTOR_ROLE || 'demo';
  applyFieldAccess(document);
  window.UC_APP = {
    S: function () { return S; }, save: save, esc: esc, reveal: reveal, nav: nav, el: el,
    setRole: setRole, role: function () { return ACTOR_ROLE; }, applyFieldAccess: applyFieldAccess,
    replaceState: replaceState, landing: landing, entryRoute: entryRoute,
    setIdentity: setIdentity, setSyncStatus: setSyncStatus,
    toast: toast, render: function () { go(location.hash || '#/'); }
  };
  /* store.js 比 app.js 先載入（它不能依賴 UC_APP），所以在這裡回頭叫它一次。 */
  if (window.UC_STORE && window.UC_STORE.attach) window.UC_STORE.attach(window.UC_APP);
})();
