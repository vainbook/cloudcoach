/* UC Cloud Coach — 路由、狀態、各頁渲染
   狀態全部在 localStorage，沒有後端。教學文本全部來自 data/*.js。 */
(function () {
  'use strict';

  var KEY = 'uc_coach_v1';
  /* 只記介面位置，不記姓名、答案、分數、報告或作業。正式資料仍只在記憶體與後端。 */
  var ROUTE_KEY = 'uc_last_route_v1';
  var S = load();

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
      taskNow: obj(raw.taskNow),
      hidden:  obj(raw.hidden),
      done:    obj(raw.done),
      coachReport: normalizeCoachReport(raw.coachReport),
      log:     Array.isArray(raw.log) ? raw.log : b.log
    };
    function obj(v) {
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }
  }
  /* picked／key 是暫時保留的書本狀態；taskNow ＝各能力的當前任務；hidden ＝不給學員看的任務。 */
  function blank() {
    return {
      name: '', answers: {}, picked: [], key: {}, taskNow: {}, hidden: {}, done: {},
      coachReport: normalizeCoachReport(), log: []
    };
  }
  function normalizeCoachReport(v) {
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    var scores = v.scores && typeof v.scores === 'object' && !Array.isArray(v.scores) ? v.scores : {};
    var notes = v.notes && typeof v.notes === 'object' && !Array.isArray(v.notes) ? v.notes : {};
    var adjust = v.adjust && typeof v.adjust === 'object' && !Array.isArray(v.adjust) ? v.adjust : {};
    return {
      /* adjust ＝ 教練在題目算出來的基準上加減幾級（-2～+2，預設 0）。
         scores ＝ 加減之後的最終星等，由 syncCoachScores() 自動算出來寫回，
         **不是教練直接填的** —— 它只是給後端／試算表用的快照。 */
      adjust: adjust,
      scores: scores,
      notes: notes,
      letter: typeof v.letter === 'string' ? v.letter : '',
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

  /* ── 路由 ─────────────────────────────────────────── */
  var ROUTES = {
    '#/':        { view: 'v-home' },
    '#/assess':  { view: 'v-assess',  render: renderAssess },
    '#/report':  { view: 'v-report',  render: renderReport },
    '#/okr':     { view: 'v-okr',     render: renderOkr },
    '#/growth':  { view: 'v-growth',  render: renderGrowth },
    '#/library': { view: 'v-library', render: renderLibrary },
    '#/tools':   { view: 'v-library', render: function () { LIBTAB = 'tool'; renderLibrary(); } },
    '#/students': { view: 'v-students', render: renderStudents }
  };

  function savedRoute(role) {
    try {
      var v = JSON.parse(localStorage.getItem(ROUTE_KEY));
      return v && typeof v[role] === 'string' ? v[role] : '';
    } catch (e) { return ''; }
  }

  function routeAllowed(hash, role) {
    if (!ROUTES[hash] || hash === '#/') return false;
    if (role === 'coach') return hash === '#/students';
    return ['#/assess', '#/report', '#/okr', '#/growth', '#/library', '#/tools'].indexOf(hash) >= 0;
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
    if (hash === '#/' && window.UC_STORE && window.UC_STORE.isRemote()) {
      var to = landing();
      if (location.hash !== to) {
        history.replaceState(null, '', location.pathname + location.search + to);
      }
      hash = to;
    }
    var r = ROUTES[hash] || ROUTES['#/'];
    [].forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.remove('on'); });
    el(r.view).classList.add('on');

    var home = r === ROUTES['#/'];
    el('nav').hidden = home;
    [].forEach.call(document.querySelectorAll('#nav a'), function (a) {
      if (a.getAttribute('href') === hash) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    [].forEach.call(document.querySelectorAll('.who'), function (n) { n.textContent = S.name || ''; });
    var ns = el('navStudents');
    if (ns) ns.hidden = !(ACTOR_ROLE === 'coach' && window.UC_STORE && window.UC_STORE.isRemote());

    if (r.render) r.render();
    rememberRoute(hash);
    window.scrollTo(0, 0);
    reveal(el(r.view));
  }

  function nav(hash) {
    if (location.hash === hash) go(hash);
    else location.hash = hash;
  }

  /* ── 登入頁 ───────────────────────────────────────── */
  el('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    /* 接上後端之後這一頁根本進不來（go() 會先跳走），保險起見再擋一次。 */
    if (window.UC_STORE && window.UC_STORE.isRemote()) { nav(landing()); return; }
    var v = el('loginName').value.trim();
    if (!v) return;
    S.name = v; save();
    nav('#/assess');
  });

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
    try { localStorage.removeItem('uc_line_returning_v1'); } catch (err) {}
    try { sessionStorage.removeItem('uc_line_pending_v1'); } catch (err) {}
    try { if (window.liff && liff.isLoggedIn()) liff.logout(); } catch (err) {}
    /* replace 而不是 assign —— 不要讓上一頁按回去又回到已登出的畫面。 */
    location.replace(location.pathname);
  });

  el('demoBtn').addEventListener('click', function () {
    /* ⚠️ 用 replaceState 就地換內容，**不要 `S = ...`** ——
       教練報告那邊有 `var cr = S.coachReport` 的閉包別名，
       換掉整個物件的話別名還指著舊的，畫面會寫到一份沒人看的資料。 */
    replaceState(window.UC_SAMPLE ? window.UC_SAMPLE() : blank());
    save();
    nav('#/report');
  });

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
     六區全部攤在同一頁往下捲，最上面那排是**跳躍錨點不是分頁**。
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
        + '<div class="divider"><i></i><s></s></div>'
        + '<p class="lead">' + esc(g.sec.lead) + '</p></header>'
        + '<div class="qlist">' + g.items.map(qRow).join('') + '</div>'
        + '</section>';
    }).join('');

    var assessFull = answeredCount() === total;
    h += '<div class="secfoot"><span></span>'
      + '<button class="btn pri" id="toReport"' + (assessFull ? '' : ' disabled') + '>'
      + (assessFull ? '前往報告' : '完成全部題目後查看報告') + '</button></div>';

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

    var rep = el('toReport');
    if (rep) rep.addEventListener('click', function () { nav('#/report'); });

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
      rep.textContent = n === total ? '前往報告' : '完成全部題目後查看報告';
    }
  }

  /* 收合時的答案格。
     `ladder: true`（06 情感能力那 25 題）畫五顆菱形標出級數，**再接上選到的那句話** ——
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
    var PILLW = Math.max(47, Math.max.apply(null, D.map(function (d) {
      return d.label.length * 13.5;
    }))) + 24, PILLH = 41;
    /* 維度名離圓心多遠。有膠囊時要再往外推 —— 1.15 時膠囊會貼著五邊形的頂點，很擠。 */
    var LABF = opts.comment ? 1.25 : 1.15;

    /* 維度名下方放小型菱形程度。它只提示 1–5 級，不搶走形狀本身的主角位置。 */
    D.forEach(function (d, i) {
      var p = pt(i, rad(vals[d.k])), lp = pt(i, LABF);
      var anchor = Math.abs(lp[0] - CX) < 6 ? 'middle' : (lp[0] > CX ? 'start' : 'end');
      /* 膠囊尺寸是算出來的，不是量出來的。用 getBBox() 會在畫面還沒顯示時回傳 0，
         這張圖是切到報告頁才渲染的，量不到（踩過同類的坑太多次）。
         ⚠️ 寬度要取「維度名」和「五顆菱形」的**較大者**。只照字數算的話，
         三個字的維度（生活圈）膠囊比底下那排菱形還窄，看起來就是排壞了。 */
      var bw = PILLW, bh = PILLH;                 /* 36 時上緣只剩 1.3px，字貼著框 */
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
      var CUT = 9, x2 = bx + bw, y2 = +by + bh;
      var pd = 'M' + bx.toFixed(1) + ',' + by + 'H' + (x2 - CUT).toFixed(1)
        + 'L' + x2.toFixed(1) + ',' + (+by + CUT).toFixed(1)
        + 'V' + y2.toFixed(1) + 'H' + bx.toFixed(1) + 'Z';
      var mid = opts.comment ? 'middle' : anchor, ltx = opts.comment ? tx : lp[0].toFixed(1);
      var lab = '<text class="lb" style="--i:' + i + '" x="' + ltx + '" y="'
          + lp[1].toFixed(1) + '" text-anchor="' + mid + '">' + d.label + '</text>'
        + '<text class="lv" style="--i:' + i + '" x="' + ltx + '" y="'
          + (lp[1] + 14).toFixed(1) + '" text-anchor="' + mid + '">'
          + degreeText(vals[d.k]) + '</text>';
      /* 只有評語模式才把維度名包成按鈕；其他呼叫點（評測頁的小圖）維持純文字。 */
      g += opts.comment
        ? '<g class="lbtn" style="--i:' + i + '" data-k="' + d.k + '"'
            + ' data-band="' + SC.bandOf(vals[d.k]) + '"' + (lead ? ' data-lead' : '')
            + ' role="button" tabindex="0"'
            + ' aria-label="看 ' + d.label + ' 的評語'
            + (lead ? '（最需要先動的一條）' : '') + '">'
            + '<path class="pillbg" d="' + pd + '"/><path class="pill" d="' + pd + '"/>'
            + '<rect class="pillbar" x="' + bx.toFixed(1) + '" y="' + (+by + 10).toFixed(1)
            + '" width="2" height="' + (bh - 20) + '"/>'
            + lab + '</g>'
        : lab;
    });

    /* ⚠️ viewBox 要跟著膠囊算，不能寫死 —— 膠囊往外推之後左右兩顆會超出 0..400
       被切掉（`overflow: visible` 只是讓它畫出去，會壓到旁邊的東西）。
       右邊那顆最遠：lp[0] - 8 + PILLW；上下同理各留 PILLH/2。MARG 是呼吸空間。 */
    var VB = '0 18 ' + W + ' 330';
    if (opts.comment) {
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

    body.innerHTML = wrap('<header class="rhead">'
      + '<p class="ey">Coach Review ・ ' + answeredCount() + '/' + window.UC_SCORE.questions.length + ' 題</p>'
      + '<h1>完成教練評測</h1><div class="divider"><i></i><s></s></div>'
      + '<p class="lead">五個維度的分數已經由 25 道計分題算出來了。看完之後如果跟你實際互動的判斷不同，用 ＋／− 調整；'
      + '再替每個維度寫說明，最後寫一封信。全部完成後，學員才會看到報告。</p>'
      + '</header>')
      /* ⚠️ 雷達是這一頁的核心，編輯的時候也要看得到 ——
         教練要邊看形狀邊決定加減，不然是在盲調。 */
      + wrap(head('01', 'Ability Map', '情感能力')
        + '<div class="chart" id="crChart"></div>'
        + '<p class="chint" id="chint">點維度名　·　看你寫的說明</p>', 'rv chartwrap')
      + '<div class="paper"><section><div class="wrap creview">'
      + '<div class="crstatus"><p class="fieldtag coach">教練填寫</p><p id="crProgress"></p></div>'
      + '<div class="crgrid">' + rows + '</div>'
      + '<label class="crletter">寫給學員的一封信<textarea rows="8" data-report-letter'
      + ' data-field-id="report.letter" data-field-owner="coach"'
      + ' placeholder="請寫下你對這位學員整體狀況的理解，以及接下來最重要的一步。">'
      + esc(cr.letter) + '</textarea></label>'
      + '<div class="crfoot"><p>未完成前，學員不會看到任何評測內容。</p>'
      + '<button type="button" class="btn pri" id="finishReport">完成評測並開放報告</button></div>'
      + '</div></section></div>';

    function paintRadar() {
      drawRadar(el('crChart'), coachReportValues(r, cr),
                { comment: true, comments: cr.notes, lead: coachReportLow(r, cr) });
    }

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
      paintRadar();
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
    el('finishReport').addEventListener('click', function () {
      if (!coachReportValid()) return;
      cr.complete = true; REPORT_EDIT = false; save(); renderReport();
    });
    syncReview();
    applyFieldAccess(body);
    paintRadar();
    reveal(body);
  }

  function renderReport() {
    var E = window.UC_SCORE, CO = window.UC_COACH;
    var body = el('reportBody');
    var total = E.questions.length, filled = answeredCount();

    if (filled !== total) {
      body.innerHTML = wrap('<div class="empty"><p class="ey">Assessment Incomplete</p>'
        + '<h1>評測尚未完成</h1><div class="divider"><i></i><s></s></div>'
        + '<p>必須完成全部題目，教練才能開始評測。目前已填 ' + filled + ' / ' + total + ' 題。</p>'
        + '<button class="btn pri" id="goAssess">回到評測</button></div>');
      el('goAssess').addEventListener('click', function () { nav('#/assess'); });
      return;
    }

    if (!coachReportReady()) {
      if (ACTOR_ROLE === 'student') {
        body.innerHTML = wrap('<div class="empty"><p class="ey">Coach Review</p>'
          + '<h1>教練正在完成評測</h1><div class="divider"><i></i><s></s></div>'
          + '<p>教練完成五個維度的評分、說明與一封信後，報告會在這裡開放。</p>'
          + '<button class="btn" id="goAssess">查看我的回答</button></div>');
        el('goAssess').addEventListener('click', function () { nav('#/assess'); });
        return;
      }
      renderCoachReportEditor(body);
      return;
    }

    if (REPORT_EDIT && ACTOR_ROLE !== 'student') {
      renderCoachReportEditor(body);
      return;
    }

    var cr = S.coachReport, r = reportBase();
    /* 學員改過答案的話基準會變 —— 進報告時重算一次，順便把 scores 快照更新。 */
    syncCoachScores(cr, r);
    var vals = coachReportValues(r, cr), low = coachReportLow(r, cr);
    var h = wrap('<header class="rhead">'
      + '<p class="ey">Assessment Report ・ 教練評測完成</p>'
      + '<h1>' + esc(S.name || '學員') + '　情感能力評測</h1>'
      + '<div class="divider"><i></i><s></s></div>'
      + '<div class="rhact">'
      + (ACTOR_ROLE === 'student' ? '' : '<button type="button" class="btn" id="editReport">編輯評測</button>')
      + '<button type="button" class="btn gh" id="shareReport">' + esc(shareLabel()) + '</button>'
      + '</div></header>');

    h += wrap(head('01', 'Ability Map', '情感能力')
      + '<div class="chart" id="chart"></div>'
      + '<p class="chint" id="chint">點維度名　·　看教練說明</p>', 'rv chartwrap');

    var paper = wrap(head('02', 'Coach Letter', '教練的信')
      + '<div class="letter">'
      + '<p class="lsalu">' + esc(S.name || '學員') + '，你好：</p>'
      + '<div class="lbody"><p class="lpara">' + esc(cr.letter) + '</p></div>'
      + '<p class="lsign">' + esc(CO.title) + '　' + esc(CO.name) + '</p>'
      + (CO.signedOn ? '<p class="ldate">' + esc(CO.signedOn) + '</p>' : '')
      + '</div>', 'rv');

    h += '<div class="paper">' + paper + '</div>';

    body.innerHTML = h;
    drawRadar(el('chart'), vals, { comment: true, comments: cr.notes, lead: low });
    var edit = el('editReport');
    if (edit) edit.addEventListener('click', function () { REPORT_EDIT = true; renderReport(); });
    bindShare(el('shareReport'), function () { return reportAsText(cr, r); });
    reveal(body);
  }

  /* ── 學員清單（只有教練看得到）─────────────────────
     ⚠️ 這一頁只是**入口**，不是權限。真正的權限在 GAS：
     student.list 與 student.load 都會對綁定表的 access_scope。
     前端把 nav 的 hidden 拿掉也讀不到別人的資料。 */

  var STUDENTS = null;

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
    var rows = STUDENTS.map(function (x) {
      var pct = total ? Math.round(x.answered / total * 100) : 0;
      var stage = x.reportComplete ? '報告已開放'
                : (x.answered >= total ? '等你評測' : '填答中');
      return '<button type="button" class="strow' + (x.id === cur ? ' is-cur' : '') + '"'
        + ' data-student="' + esc(x.id) + '">'
        + '<b class="stname">' + esc(x.name || x.lineName || x.id) + '</b>'
        + '<s class="stid">' + esc(x.id) + (x.lineName && x.name ? ' ・ LINE：' + esc(x.lineName) : '') + '</s>'
        + '<i class="stbar"><u style="width:' + pct + '%"></u></i>'
        + '<em class="ststage">' + esc(stage) + '　' + x.answered + '/' + total + '</em>'
        + '</button>';
    }).join('');

    /* 範例學員：所有教練共用同一位，拿來練手或給人看都不會動到真學員。
       id 由後端給（只有 manage 拿得到），前端不寫死。 */
    var demo = window.UC_STORE.demoStudentId();
    var demoBtn = demo
      ? '<button type="button" class="stdemo' + (demo === cur ? ' is-cur' : '') + '"'
        + ' data-student="' + esc(demo) + '">開啟範例學員'
        + '<s>' + esc(demo) + '　所有教練共用，可以隨便改</s></button>'
      : '';

    body.innerHTML = wrap('<header class="rhead"><p class="ey">Coach ・ ' + STUDENTS.length + ' 位</p>'
      + '<h1>學員清單</h1><div class="divider"><i></i><s></s></div>'
      + '<p class="lead">點一位學員，下面每一頁看到的就是他的資料。</p></header>')
      + wrap('<div class="stlist">' + (rows || '<p class="bpnone">還沒有學員綁定。</p>') + '</div>'
             + demoBtn, 'rv');

    [].forEach.call(body.querySelectorAll('[data-student]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.student;
        b.classList.add('is-busy');
        window.UC_STORE.switchStudent(id).then(function () {
          STUDENTS = null;                  /* 進度會變，下次重讀 */
          toast('目前看的是 ' + id);
          nav('#/assess');
        }).catch(function (e) {
          b.classList.remove('is-busy');
          toast((e && e.message) || '換不過去，請再試一次');
        });
      });
    });
    reveal(body);
  }

  /* ── 傳到 LINE ─────────────────────────────────────
     UC_SHARE 在 boot.js，三段降級（選對象 → 送進當前聊天室 → 複製）。
     這裡只負責「按鈕長什麼樣」與「要送什麼字」。
     ⚠️ 內容**在按下去的當下才組**，不要在 render 時先組好 ——
     教練可能剛改完評語，先組好的會是舊的。 */

  /* 按鈕的字要說出**實際會發生什麼事**。
     使用者 2026-09-13：「我只是要確認好。」—— 按鈕寫「傳到 LINE」卻跳出複製，
     那不是功能不足，是介面在說謊。 */
  function shareLabel() {
    if (!window.UC_SHARE || !window.UC_SHARE.how) return '複製內容';
    return { picker: '傳到 LINE', send: '傳回這個對話',
             system: '分享', copy: '複製內容' }[window.UC_SHARE.how()] || '複製內容';
  }

  function bindShare(btn, build) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!window.UC_SHARE) { toast('這個環境沒辦法分享'); return; }
      btn.disabled = true;
      window.UC_SHARE.text(build()).then(function (how) {
        btn.disabled = false;
        var why = window.UC_SHARE.lastError && window.UC_SHARE.lastError();
        /* ⚠️ 退回複製的時候**要講為什麼**。只說「已複製」的話，
           按鈕明明寫「傳到 LINE」卻複製給你，看起來就是壞了（踩過）。 */
        toast({ share: '已經送出去了', send: '已經送進聊天室',
                system: '已交給手機的分享選單',
                copy: why ? '傳不出去（' + why + '），已改成複製' : '已複製，貼到聊天室就好',
                cancel: '取消了',
                /* 連複製都失敗時也要講理由 —— 「這個環境沒辦法分享」等於沒說。 */
                fail: why ? '傳不出去：' + why : '這個環境沒辦法分享'
              }[how] || '完成');
      });
    });
  }

  /* 報告的純文字版。LINE 訊息沒有排版，所以用空行與破折號分段。 */
  function reportAsText(cr, r) {
    var D = window.UC_DIMENSIONS.dims, CO = window.UC_COACH;
    var lines = ['【' + (S.name || '學員') + '　情感能力評測】', ''];
    D.forEach(function (d) {
      lines.push('・' + d.label + '　' + reportStar(d.k, r, cr) + '／5');
    });
    lines.push('', '—— 教練的信 ——', '', cr.letter || '', '', CO.title + '　' + CO.name);
    return lines.join('\n');
  }

  /* ── 課程藍圖 ─────────────────────────────────────────
     入口是代表學員自己的成長人物；點能力卡會先看該能力的當前任務。
     「書」仍保留完整藍圖；人物不會帶進書頁，也不在這裡放週次或成長縮圖。 */
  var OKRVIEW = 'cover', OKRSEL = null;
  var BKLEVEL = 'idx', BKOPEN = null;   /* 書：左頁在哪一層／看哪一維 */
  var TASKMODAL = null, TASKRETURN = null;

  function taskItem(dim) {
    var id = S.taskNow && S.taskNow[dim];
    if (!id || isHidden(id) || (S.done && S.done[id])) return null;
    return window.UC_OKR.items.filter(function (it) { return it.id === id && it.dim === dim; })[0] || null;
  }

  function isHidden(id) {
    return !!(S.hidden && S.hidden[id]);
  }

  function taskGain(it) {
    var n = it && it.gain != null ? Number(it.gain) : Number(window.UC_OKR.taskProgress.defaultGain);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function abilityGain(dim) {
    return window.UC_OKR.items.filter(function (it) {
      return it.dim === dim && S.done && S.done[it.id];
    }).reduce(function (sum, it) { return sum + taskGain(it); }, 0);
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

  function clearCurrentId(id) {
    if (!S.taskNow) return;
    Object.keys(S.taskNow).forEach(function (k) {
      if (S.taskNow[k] === id) delete S.taskNow[k];
    });
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
      var run = e.target.closest('[data-task-run]');
      if (!run) return;
      var dim = run.dataset.taskDim;
      var it = taskItem(dim);
      var toolKey = taskToolKey(it);
      if (!toolKey) {
        openTaskContact(dim, it);
        return;
      }
      closeTaskModal(false);
      LIBOPEN = toolKey;
      LIBTAB = 'tool';
      nav('#/library');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && TASKMODAL && !TASKMODAL.hidden) closeTaskModal();
    });
    return TASKMODAL;
  }

  function openTaskModal(dim, trigger) {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS, ui = O.taskUI;
    var d = D.dims.filter(function (x) { return x.k === dim; })[0];
    if (!d) return;
    var it = taskItem(dim), m = ensureTaskModal();
    TASKRETURN = trigger || document.activeElement;
    var meta = '';
    if (it) {
      meta = '<dl class="taskmeta">'
        + (it.sub ? '<dt>目標</dt><dd>' + esc(it.sub) + '</dd>' : '')
        + (it.n ? '<dt>檢核</dt><dd>完成 ' + esc(it.n) + ' 次</dd>' : '')
        + (it.tool ? '<dt>教材</dt><dd>' + esc(it.tool) + '</dd>' : '')
        + (it.sheet ? '<dt>工具</dt><dd>' + esc(it.sheet) + '</dd>' : '')
        + '</dl>';
    }
    m.innerHTML = '<section class="taskpanel" role="dialog" aria-modal="true" aria-labelledby="taskTitle" tabindex="-1">'
      + '<i class="taskbrk taskbrk-tl" aria-hidden="true"></i><i class="taskbrk taskbrk-tr" aria-hidden="true"></i>'
      + '<i class="taskbrk taskbrk-bl" aria-hidden="true"></i><i class="taskbrk taskbrk-br" aria-hidden="true"></i>'
      + '<span class="taskscan" aria-hidden="true"></span>'
      + '<button type="button" class="taskx" data-task-close="1" aria-label="' + esc(ui.closeAction) + '">×</button>'
      + '<p class="taskey">Current Mission · ' + esc(d.en) + '</p>'
      + '<div class="taskhead"><span>' + esc(ui.label) + '</span><b>' + esc(d.label) + '</b></div>'
      + '<h2 id="taskTitle">' + esc(it ? it.kr : ui.emptyTitle) + '</h2>'
      + '<div class="taskrule"><i></i><s></s></div>'
      + '<p class="taskbody">' + esc(it ? taskDetail(it) : ui.emptyBody) + '</p>'
      + meta
      + '<div class="taskactions"><button type="button" class="btn gh" data-task-close="1">' + esc(ui.closeAction) + '</button>'
      + '<button type="button" class="btn pri" ' + (it ? 'data-task-run="1" data-task-dim="' + dim + '"'
        : 'data-task-edit="1"') + '>' + esc(it ? ui.runAction : ui.editAction) + '</button></div>'
      + '<span class="taskfolio num">' + esc(it ? it.id : dim.toUpperCase()) + '</span></section>';
    m.hidden = false;
    m.classList.add('on');
    document.documentElement.classList.add('task-open');
    figLit(dim);                 /* 面板開著的時候那一塊要一直亮著 */
    var panel = m.querySelector('.taskpanel');
    if (panel) panel.focus();
  }

  function openTaskContact(dim, it) {
    var O = window.UC_OKR, D = window.UC_DIMENSIONS, ui = O.taskUI;
    var d = D.dims.filter(function (x) { return x.k === dim; })[0];
    var m = ensureTaskModal();
    if (!d || !it) return;
    m.innerHTML = '<section class="taskpanel" role="dialog" aria-modal="true" aria-labelledby="taskTitle" tabindex="-1">'
      + '<i class="taskbrk taskbrk-tl" aria-hidden="true"></i><i class="taskbrk taskbrk-tr" aria-hidden="true"></i>'
      + '<i class="taskbrk taskbrk-bl" aria-hidden="true"></i><i class="taskbrk taskbrk-br" aria-hidden="true"></i>'
      + '<span class="taskscan" aria-hidden="true"></span>'
      + '<button type="button" class="taskx" data-task-close="1" aria-label="' + esc(ui.closeAction) + '">×</button>'
      + '<p class="taskey">' + esc(ui.contactEyebrow) + ' · ' + esc(d.en) + '</p>'
      + '<div class="taskhead"><span>' + esc(ui.label) + '</span><b>' + esc(d.label) + '</b></div>'
      + '<h2 id="taskTitle">' + esc(ui.contactTitle) + '</h2>'
      + '<div class="taskrule"><i></i><s></s></div>'
      + '<p class="taskbody">' + esc(ui.contactBody) + '</p>'
      + '<dl class="taskmeta"><dt>目前任務</dt><dd>' + esc(it.kr) + '</dd></dl>'
      + '<div class="taskactions"><button type="button" class="btn pri" data-task-close="1">' + esc(ui.closeAction) + '</button></div>'
      + '<span class="taskfolio num">' + esc(it.id) + '</span></section>';
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
    if (view === 'cover') return okrCover(O, D, r, hasScore, byK);
    if (view === 'book') return okrBook(O, D, byK);
    return okrList(O, D, r, hasScore, byK);
  }

  function renderOkr() {
    /* 每次從主導覽進入都先回人物封面；封面內的切換才保留當次閱讀狀態。 */
    OKRVIEW = 'cover'; BKLEVEL = 'idx'; BKOPEN = null; OKRSEL = null;
    var O = window.UC_OKR, E = window.UC_SCORE, D = window.UC_DIMENSIONS;
    var r = E.score(S.answers), byK = {};
    D.dims.forEach(function (d) { byK[d.k] = d; });
    var hasScore = r.answered >= 5;

    var h = wrap('<header class="rhead"><p class="ey">Course Blueprint ・ ' + esc(O.source) + '</p>'
      + '<h1>課程藍圖</h1><div class="divider"><i></i><s></s></div>'
      /* 頁首只有標題；操作說明貼在人物或書本旁邊。 */
      /* ⚠️ 「書」**不放在這裡**。使用者 2026-09-12：書暫時不用但不刪，
         入口收進「總覽」右下角的小按鈕（okrList 最後那顆 .bkcorner）。 */
      + '<div class="vsw"><button class="vb' + (OKRVIEW === 'cover' ? ' on' : '') + '" data-view="cover">藍圖</button>'
      + '<button class="vb' + (OKRVIEW === 'list' || OKRVIEW === 'book' ? ' on' : '') + '" data-view="list">總覽</button></div>'
      + '</header>');

    h += '<div id="okrPane">' + okrViewHTML(OKRVIEW, O, D, r, hasScore, byK) + '</div>';

    var body = el('okrBody');
    body.innerHTML = h;
    bindOkr(body);
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
    /* 分頁切換本身就是動作，不再等 IntersectionObserver；先落最終可見狀態。 */
    [].forEach.call(pane.querySelectorAll('.rv'), function (n) { n.classList.add('in'); });
    reveal(pane);
  }

  function bindOkrPane(pane) {
    if (!pane) return;
    bindBook(pane);
    /* 右下角的書入口。只有「總覽」畫得出來，換檢視時整個 pane 重畫，按鈕自然消失。 */
    [].forEach.call(pane.querySelectorAll('[data-openbook]'), function (b) {
      b.addEventListener('click', function () { okrTo('book'); });
    });
    [].forEach.call(pane.querySelectorAll('[data-cover-dim]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.coverDim;
        /* ⚠️ 手機沒有 hover，人物那組動畫**從來沒有機會播**（使用者 2026-09-13）。
           所以點下去先亮人物，等它跑完再開面板 —— 面板一開就蓋住人物的話，
           那組動畫等於白做。 */
        figLit(k);
        var quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function () { openTaskModal(k, b); },
                   quick ? 0 : (figToTop() ? FIG_LEAD + 180 : FIG_LEAD));
      });
    });
    bindFigure(pane);
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
        var dim = c.dataset.currentDim, id = c.dataset.current;
        if (isHidden(id) || (S.done && S.done[id])) { c.checked = false; return; }
        if (c.checked) {
          S.taskNow[dim] = id;
          [].forEach.call(pane.querySelectorAll('[data-current-dim="' + dim + '"]'), function (x) {
            var on = x === c;
            x.checked = on;
            x.closest('.edtr').classList.toggle('is-current', on);
          });
          c.closest('.edtr').classList.remove('is-hidden');
        } else if (S.taskNow[dim] === id) {
          delete S.taskNow[dim];
          c.closest('.edtr').classList.remove('is-current');
        }
        save(); edtCount(pane);
      });
    });
    [].forEach.call(pane.querySelectorAll('[data-done]'), function (c) {
      c.addEventListener('change', function () {
        var id = c.dataset.done, row = c.closest('.edtr');
        var it = window.UC_OKR.items.filter(function (x) { return x.id === id; })[0];
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
        var gain = pane.querySelector('[data-dim-gain="' + it.dim + '"]');
        if (gain) gain.textContent = window.UC_OKR.editUI.abilityLabel + ' +' + abilityGain(it.dim);
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
    b[1].textContent = Object.keys(S.taskNow || {}).filter(function (k) {
      return !isHidden(S.taskNow[k]) && !(S.done && S.done[S.taskNow[k]]);
    }).length;
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

  /* ── 課程藍圖：人物總覽封面 ─────────────────────────
     五個能力取自真實評測結果；菱形只顯示粗略程度，不公開百分位。
     點能力會打開該能力的半透明任務框；完整藍圖仍從上方「書」進入。 */
  function okrCover(O, D, r, hasScore, byK) {
    var pos = ['values', 'circle', 'emo', 'image', 'flirt'];
    var order = {};
    D.dims.forEach(function (d, i) { order[d.k] = i + 1; });

    var abilities = pos.map(function (k) {
      var d = byK[k], n = hasScore ? window.UC_SCORE.starOf(r.show[k]) : 0;
      var marks = hasScore ? degreeText(r.show[k]) : '◇◇◇◇◇';
      var gain = abilityGain(k);
      var current = taskItem(k), ui = O.taskUI;
      return '<button class="bpcdim bpc-' + k + (current ? ' has-task' : '')
        + '" data-cover-dim="' + k + '" aria-haspopup="dialog" aria-controls="taskModal"'
        + ' aria-label="查看' + esc(d.label) + '的當前任務，'
        + (hasScore ? '目前程度 ' + n + '／5' : '尚未完成評測') + '">'
        + '<span class="bpcey">' + ('0' + order[k]).slice(-2) + ' · ' + esc(d.en) + '</span>'
        + '<b>' + esc(d.label) + '</b>'
        + '<span class="bpclv" aria-hidden="true">' + marks + '</span>'
        + (gain ? '<span class="bpcgain">' + esc(O.editUI.abilityLabel) + ' +' + gain + '</span>' : '')
        + '<span class="bpccur"><small>' + esc(ui.label) + '</small>'
        + '<span>' + esc(current ? current.short : ui.unsetShort) + '</span></span>'
        + '<i aria-hidden="true">' + (k === 'image' || k === 'circle' ? '←' : '→') + '</i>'
        + '</button>';
    }).join('');

    return wrap('<div class="bpcover">'
      + '<p class="bpctag">My Growth Image</p>'
      + '<div class="bpcgrid">' + abilities
      + figureHTML() + '</div>'
      + '<p class="cap bpccap">' + esc(O.taskUI.coverHint) + '</p>'
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
    var h = '<div class="bpcfigure" id="bpcFig">' + netSVG()
          + '<img class="fxfill" src="' + FILLSRC + '" alt="" draggable="false">'
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
    [].forEach.call(pane.querySelectorAll('[data-cover-dim]'), function (b) {
      var k = b.dataset.coverDim;
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
        + '<h3 class="bktitle">' + esc(it.short) + '</h3><div class="bkrule"></div>'
        + '<p class="bkkr">' + esc(it.kr) + '</p>'
        + '<div class="bkmeta">'
          + '<b>目標 O</b><span>' + esc(it.sub || '（原表未分組）') + '</span>'
          + (it.n != null ? '<b>次數</b><span>' + esc(it.n) + '</span>' : '')
          + (it.tool ? '<b>工具</b><span>' + esc(it.tool) + '</span>' : '')
          + (it.sheet ? '<b>工作表</b><span>' + esc(it.sheet) + '</span>' : '')
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
    var nHidden = Object.keys(S.hidden || {}).length;
    var nNow = Object.keys(S.taskNow || {}).filter(function (k) {
      return !isHidden(S.taskNow[k]) && !(S.done && S.done[S.taskNow[k]]);
    }).length;
    var nDone = completedCount();

    /* 書的入口。收在右下角、不佔版面 —— 平常沒人用，需要時找得到就好。 */
    var corner = '<button class="bkcorner" type="button" data-openbook="1" title="開啟書本檢視">書</button>';

    return corner + wrap('<div class="edt" data-no-copy-edit="1" data-field-scope="blueprint.coach-settings">'
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
            + '<em class="edtdgain" data-dim-gain="' + k + '">' + esc(ui.abilityLabel) + ' +' + abilityGain(k) + '</em></p>'
            + byObjective(by[k]).map(function (g) {
                var groupHidden = g.items.every(function (it) { return isHidden(it.id); });
                return '<div class="edtgrp' + (groupHidden ? ' is-all-hidden' : '') + '">'
                  + (g.o ? '<p class="edto">' + esc(g.o) + '</p>' : '')
                  + g.items.map(function (it) {
                      var hidden = isHidden(it.id);
                      var done = !!(S.done && S.done[it.id]);
                      var current = !hidden && !done && S.taskNow && S.taskNow[k] === it.id;
                      var gain = taskGain(it);
                      return '<div class="edtr' + (hidden ? ' is-hidden' : '') + (current ? ' is-current' : '')
                        + (done ? ' is-done' : '')
                        + '" data-dim="' + k + '">'
                        + '<input type="checkbox" class="now" data-current="' + it.id
                        + '" data-current-dim="' + k + '" aria-label="設為' + esc(byK[k].label) + '的當前任務"'
                        + ' data-field-id="blueprint.current.' + k + '" data-field-owner="coach"'
                        + ' data-field-label="' + esc(byK[k].label) + '當前任務"'
                        + (current ? ' checked' : '') + (hidden || done ? ' disabled' : '') + '>'
                        + '<input type="checkbox" class="done" data-done="' + it.id
                        + '" aria-label="' + esc(ui.doneLabel) + '：' + esc(it.kr) + '"'
                        + ' data-field-id="blueprint.done.' + it.id + '" data-field-owner="coach"'
                        + ' data-field-label="' + esc(ui.doneLabel) + '：' + esc(it.kr) + '"'
                        + (done ? ' checked' : '') + '>'
                        + '<input type="checkbox" class="hide" data-hidden="' + it.id
                        + '" aria-label="' + esc(ui.hideLabel) + '：' + esc(it.kr) + '"'
                        + ' data-field-id="blueprint.hidden.' + it.id + '" data-field-owner="coach"'
                        + ' data-field-label="' + esc(ui.hideLabel) + '：' + esc(it.kr) + '"'
                        + (hidden ? ' checked' : '') + '>'
                        + '<b>' + esc(it.kr) + '</b>'
                        + '<em class="edthidden">' + esc(ui.hiddenMark) + '</em>'
                        + '<em class="edtdone">' + esc(ui.doneMark) + '</em>'
                        + '<span class="edtgain num">+' + gain + '</span>'
                        + (it.n ? '<i class="num">×' + it.n + '</i>' : '')
                        + '<s>' + esc(it.id) + '</s></div>';
                    }).join('') + '</div>';
              }).join('') + '</section>';
        }).join('') + '</div>', 'rv');
  }


  /* ── 成長紀錄：三條時間帶 ─────────────────────────────
     使用者定調（第五版）：x 軸是時間推進，**y 的起伏純屬美術**，
     紀錄是時間帶上的獨立標記，而且每一種事件走自己那一條線。

     前四版死在兩件事：一條線扛全部標記（第 9 週擠了四種東西），
     以及用 SVG 線稿假裝插畫。三軌解掉前者；後者靠「標記就是小圖案、
     視覺重量交給線與排版」解掉 —— 不再賭圖案。

     切週次不重建 DOM，改篩選或新增紀錄只重畫 paintBands()。 */
  /* GFORM 現在存的是**要記哪一種**（'call'／'social'／'date'），null 代表沒開。
     舊版是布林值，因為類型是在表單裡的下拉選的。 */
  var GW = 1, GEL = null, GSEL = null, GFORM = null;
  var GKIND = 'all';  // 下方紀錄要回看哪一種
  /* 成就的概念已移除（使用者：「沒有成就」）—— 每一筆都是一樣的紀錄 */
  var GPOS = {};                          // 週次色帶的幾何（x0／每週寬），供就地更新

  /* 三軌。順序由使用者指定：通話記錄在上，社交第二，約會第三。 */
  var GLANE = [
    { k: 'call',   label: '通話記錄', who: 'coach',   glyph: 'phone' },
    { k: 'social', label: '外出社交', who: 'student', glyph: 'trio' },
    { k: 'date',   label: '實際約會', who: 'student', glyph: 'heart' }
  ];

  /* 狀況的三個程度。**電平段的段數就是 lv 本身** —— 所以這裡不再帶高度。
     軌與軌之間不能互相比較，只在同一軌內比。 */
  var GLV = { 1: { t: '差' }, 2: { t: '好' }, 3: { t: '優' } };
  function lvOf(e) { return GLV[e.lv] || GLV[2]; }

  function gEvents() { return window.UC_GROWTH.events.concat(S.log || []); }

  /* ── 日期 ────────────────────────────────────────────
     事件的 x 位置由實際日期算，不是靠週次對齊。12 週 = 84 天，所以刻度細到「天」。
     w 仍然存在（既有程式全部照用），但它是 d 推出來的，#selftest 會交叉比對。 */
  var GDAYS = window.UC_GROWTH.weeks * 7;
  function gDay(iso) {
    var a = String(iso).split('-');
    return Math.round(
      (Date.UTC(+a[0], +a[1] - 1, +a[2]) - Date.UTC.apply(null, (function (b) {
        return [+b[0], +b[1] - 1, +b[2]];
      })(window.UC_GROWTH.start.split('-')))) / 86400000);
  }
  function gWeekOf(day) { return Math.floor(day / 7) + 1; }
  function gIso(day) {
    var a = window.UC_GROWTH.start.split('-');
    var t = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2]) + day * 86400000);
    return t.toISOString().slice(0, 10);
  }
  var G0 = window.UC_GROWTH.start, G1 = gIso(GDAYS - 1);   // 課程起訖，夾住 <input type=date>
  /* 事件沒寫日期時（舊資料或手動新增）退回那一週的第三天，位置仍然合理 */
  function dayOf(e) { return e.d ? gDay(e.d) : (e.w - 1) * 7 + 3; }
  function gDateStr(e) {
    if (!e.d) return '';
    var a = e.d.split('-'), wd = '日一二三四五六'[new Date(e.d + 'T00:00:00').getDay()];
    return (+a[1]) + '/' + (+a[2]) + '（' + wd + '）';
  }

  /* ── 標記圖案 ─────────────────────────────────────────
     電話＝話筒　社交＝三個小圓（一群人）　約會＝愛心（使用者指定）。

     三個要像同一家人：都是簡單的封閉形狀、9px 下讀得出來、語意直白。
     舊版的 ★ 與 ◉ 被換掉的原因：星星跟「外出社交」沒有語意連結，而且 ★ 在報告頁
     已經是能力星等的單位；雙圈圈跟「電話」也沒有連結。愛心成立是因為它同時
     語意直白、又跟這張圖的隱喻互相加強。 */
  function glyphSvg(kind, cx, cy, r) {
    var g = GLANE.filter(function (l) { return l.k === kind; })[0];
    var t = (g && g.glyph) || 'phone';
    /* 線寬也要跟 r 成比例，而且得用 inline style —— CSS 規則會蓋掉 presentation
       attribute，寫成 stroke-width="…" 會被 .gy 的固定值吃掉（踩過）。 */
    var w = function (k) { return ' style="stroke-width:' + (r * k).toFixed(2) + 'px"'; };

    if (t === 'phone') {
      /* 話筒：一道弓 ＋ 兩端各一顆聽筒。兩端約 2.2 倍寬是話筒的辨識特徵；
         弓身寫死成絕對線寬、聽筒卻隨 r 放大，大尺寸下會變成啞鈴（踩過）。 */
      var x1 = cx - r * 0.6, y1 = cy - r * 0.6, x2 = cx + r * 0.6, y2 = cy + r * 0.6;
      var pk = (r * 0.33).toFixed(2);
      return '<path class="gy ph"' + w(0.3) + ' d="M' + x1.toFixed(1) + ',' + y1.toFixed(1)
          + 'A' + (r * 0.95).toFixed(1) + ',' + (r * 0.95).toFixed(1) + ' 0 0 0 '
          + x2.toFixed(1) + ',' + y2.toFixed(1) + '"/>'
        + '<circle class="gy pk" cx="' + x1.toFixed(1) + '" cy="' + y1.toFixed(1) + '" r="' + pk + '"/>'
        + '<circle class="gy pk" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="' + pk + '"/>';
    }

    if (t === 'trio') {
      /* 三個小圓排成三角＝一群人。最小尺寸下辨識度最好的「群」表示法 */
      var tr = (r * 0.34).toFixed(2), sw = w(0.26);
      return '<circle class="gy tr"' + sw + ' cx="' + cx.toFixed(1) + '" cy="' + (cy - r * 0.48).toFixed(1) + '" r="' + tr + '"/>'
        + '<circle class="gy tr"' + sw + ' cx="' + (cx - r * 0.54).toFixed(1) + '" cy="' + (cy + r * 0.4).toFixed(1) + '" r="' + tr + '"/>'
        + '<circle class="gy tr"' + sw + ' cx="' + (cx + r * 0.54).toFixed(1) + '" cy="' + (cy + r * 0.4).toFixed(1) + '" r="' + tr + '"/>';
    }

    /* heart */
    var bt = cy + r * 0.82, tp = cy - r * 0.42;
    return '<path class="gy h"' + w(0.27) + ' d="M' + cx.toFixed(1) + ',' + bt.toFixed(1)
      + 'C' + (cx - r * 1.55).toFixed(1) + ',' + (cy - r * 0.25).toFixed(1)
      + ' ' + (cx - r * 0.78).toFixed(1) + ',' + (cy - r * 1.5).toFixed(1)
      + ' ' + cx.toFixed(1) + ',' + tp.toFixed(1)
      + 'C' + (cx + r * 0.78).toFixed(1) + ',' + (cy - r * 1.5).toFixed(1)
      + ' ' + (cx + r * 1.55).toFixed(1) + ',' + (cy - r * 0.25).toFixed(1)
      + ' ' + cx.toFixed(1) + ',' + bt.toFixed(1) + 'Z"/>';
  }

  function renderGrowth() {
    var G = window.UC_GROWTH;

    var h = wrap('<header class="rhead"><p class="ey">Progress Record</p>'
      /* ⚠️ **頁首只有標題。** 三條線怎麼讀，說明搬到圖底下（圖例本來就在那裡）。 */
      + '<h1>成長紀錄</h1><div class="divider"><i></i><s></s></div>'
      + '<p class="demo-note">demo 沒有後端，紀錄都存在這台裝置。上線時接試算表就會是真的雙向。</p>'
      + '</header>');

    /* 類型篩選 chip 在下方紀錄區當「回看哪一種」。圖上一律全部畫，沒有工具列。 */
    h += wrap('<div class="rdframe">'
        + '<i class="brk brk-tl"></i><i class="brk brk-tr"></i>'
        + '<i class="brk brk-bl"></i><i class="brk brk-br"></i>'
        + '<div class="rdwrap" id="rdWrap"><div class="rdinner" id="rdInner"></div></div>'
      + '</div>'
      + '<p class="rdhint">← 左右捲動看完十二週 →</p>'
      /* 這段原本在頁首。它講的是**這張圖**，所以放在圖底下。 */
      + '<p class="cap">三條軌由上而下是<b>通話記錄</b>、<b>外出社交</b>、<b>實際約會</b>，'
      + '由左到右十二週。前幾週靜音的那兩條不是留白，是還沒開始。'
      + '一筆紀錄＝一組電平段，<b>段數就是那一筆的狀況</b>（一段差／兩段好／三段優）'
      + '—— 同一條軌內比才有意義。</p>'
      /* ⚠️ 入口是**三顆大按鈕**，不是一顆「新增」再從下拉選類型。
         使用者 2026-09-12：「變成通話記錄、外出社交、實際約會，三個大按鈕，
         點下去開始寫紀錄。」—— 要記的當下你早就知道是哪一種了，
         先問「要不要新增」再問「哪一種」是多一層。 */
      + '<div class="gkinds">'
      + GLANE.map(function (ln) {
          return '<button type="button" class="gkind" data-kind="' + ln.k + '">'
            + '<i class="gkico"><svg viewBox="0 0 32 32" aria-hidden="true">'
            + glyphSvg(ln.k, 16, 16, 11) + '</svg></i>'
            + '<b>' + ln.label + '</b><s>' + esc(GKHINT[ln.k]) + '</s></button>';
        }).join('')
      + '</div>'
      + '<div class="tlact">'
      + '<button class="btn gh" id="gReplay">↻ 重播</button>'
      + '</div>'
      + '<div id="gForm"></div>'
      + '<div id="gPanel" class="gpanel"></div>', 'rv');

    var body = el('growthBody');
    body.innerHTML = h;

    GEL = {
      band: el('rdInner'), wrap: el('rdWrap'),
      form: el('gForm'), panel: el('gPanel')
    };

    [].forEach.call(body.querySelectorAll('[data-kind]'), function (b) {
      b.addEventListener('click', function () {
        GFORM = (GFORM === b.dataset.kind) ? null : b.dataset.kind;   /* 再點一次收起來 */
        renderForm();
        if (GFORM && GEL.form.firstChild) GEL.form.scrollIntoView({ block: 'nearest' });
      });
    });
    el('gReplay').addEventListener('click', function () { sweep(); });

    GEL.band.addEventListener('click', function (e) {
      var pin = e.target.closest('[data-ev]');
      if (pin) { GSEL = pin.dataset.ev; growthTo(+pin.dataset.w); return; }
      var col = e.target.closest('[data-week]');
      if (col) { GSEL = null; growthTo(+col.dataset.week); }
    });
    paintBands();
    growthTo(GW);
    reveal(body);
  }


  /* ── 三條軌跡（多軌錄音，第九版）───────────────────────
     前八版是心率圖。換掉的理由不是執行品質，是隱喻本身有兩個結構性問題：

     ① **心電圖是即時生理訊號，這頁是已經結束的三個月。** 舊版自己撞到過 ——
        循環掃描被砍掉，理由就是「那會假裝是即時訊號」。形式必須壓抑自己
        最有力的部分（持續走紙）才能不說謊。
     ② **平線在醫療語彙裡是 flatline，是死。** 用平線解稀疏資料很聰明，
        但「約會那條前八週完全平坦」讀起來是「沒有生命跡象」，
        而要說的是「還沒開始」—— 看圖的人正好就是那個前八週沒有約會的人。

     改成錄音軌：CH-01/02/03 本來就是混音台的語彙，一條軌配一個電平表是
     同一台機器上的東西。錄音本來就是記錄、本來就是過去式；靜音不等於死亡；
     「重播」鍵終於名正言順。

     稀疏仍然是合理的（靜音段），密度差仍然是診斷。
     **一筆紀錄＝一組電平段，段數＝lv（差 1／好 2／優 3）** ——
     等級變成可以數的，不再是目測高低。仍然沒有 Y 軸，軌與軌之間不可比較。

     每一筆是獨立的圖形，不再是「一條 lane 一條連續 path」。所以舊版為了
     「path 的 x 不能回頭」而存在的一整套（gJit 抖動、hw 夾鄰居、優雅退化、
     離散變體）全部刪掉了 —— 同一天兩筆重疊在錄音軌上本來就是對的。 */
  var GSWEEP = 0;                                   // 播放頭代號，新的一次讓舊的失效
  /* 電平段：段高／段距／段寬／**中央間隙**（兩堆各自離基線多遠，中央空隙是它的兩倍）。
     ⚠️ **判準是「中央空隙 ÷ 堆內空隙」要在 3～4 倍**，不是絕對值。
     太小 → 上下黏成一整根，三段被看成六段；太大 → 整筆浮離線外像聲納訊號。
     調整史：SEGMID ≈3.0（黏住）→ 6.5（太遠，使用者回報）→ 3.4 → **2.6（現在，使用者要更薄更近）**。
     現在：中央空隙 5.2、堆內空隙 3.8−2.4=1.4 → 3.7 倍，仍然一眼看得出鏡射。
     lv3 總高 = 2*(2.6 + 2*3.8 + 2.4) = 25.2，軌距 64，留 39px 給鄰軌。 */
  var SEGH = 2.4, SEGGAP = 3.8, SEGW = 7.5, SEGMID = 2.6;

  function paintBands() {
    var N = window.UC_GROWTH.weeks, ev = gEvents();
    /* LAB 是最左邊的示意欄（圖案＋軌名）。三條線都從 LAB 起筆，所以起點對齊。
       圖案只在這一欄出現一次 —— 使用者：「放在上面太眼花撩亂了」。 */
    /* 幾何。W 從 1000 縮到 820 —— viewBox 變窄、CSS 寬度仍是 100%，
       所以整張圖（線、字、刻度、段）等比放大約 22%，不是只把畫布拉長。
       H 260 是為了塞上下兩條刻度桿：三段的段堆上下各約 19px，跟刻度桿之間還有餘裕。 */
    var W = 820, H = 260, LAB = 96, PADR = 26;
    var span = W - LAB - PADR, wkw = span / N;
    var ROW = [74, 138, 202];
    var TOP = 20, BOT = 226, GT = 24, GB = 220;   // 頂桿／底桿／格線上下界

    /* bx(day) 把 0..84 的天數映到畫布。整週的交界落在 7 的倍數上，
       事件落在當天的正中間（day + 0.5），所以不會壓在交界線上。 */
    function bx(day) { return LAB + (day / GDAYS) * span; }
    GPOS = { x0: LAB, wkw: wkw };                 // 供 markWeek 就地移動週次色帶

    var g = '';

    /* 格線：現在的最小單位是「天」。84 條細線，密度是原本 step/8 的兩倍多。 */
    var gd = '';
    for (var d0 = 0; d0 <= GDAYS; d0++) {
      gd += 'M' + bx(d0).toFixed(1) + ',' + GT + 'V' + GB + ' ';
    }
    for (var gy = GT + 4; gy <= GB; gy += 16) {
      gd += 'M' + LAB + ',' + gy + 'H' + (W - PADR) + ' ';
    }
    g += '<path class="grid" d="' + gd + '"/>';
    /* 粗格線只在每週的交界（13 條），下方軸線仍然只講 12 週 */
    var gd2 = '';
    for (var w0 = 0; w0 <= N; w0++) gd2 += 'M' + bx(w0 * 7).toFixed(1) + ',' + GT + 'V' + GB + ' ';
    g += '<path class="grid2" d="' + gd2 + '"/>';

    /* 儀器刻度：上下兩條桿。主齒在每週交界，次齒每一天。
       裝飾一律放在框上，不放在資料上 —— 第四版死在「在資料上疊東西」。 */
    g += '<g class="chrome">'
      + '<path class="rail" d="M' + LAB + ',' + TOP + 'H' + (W - PADR)
      + ' M' + LAB + ',' + BOT + 'H' + (W - PADR) + '"/>';
    var tM = '';
    for (var w1 = 0; w1 <= N; w1++) {
      var xm = bx(w1 * 7).toFixed(1);
      tM += 'M' + xm + ',' + TOP + 'v7 M' + xm + ',' + BOT + 'v-7 ';
    }
    g += '<path class="tkM" d="' + tM + '"/>';
    var tm = '';
    for (var d1 = 0; d1 <= GDAYS; d1++) {
      var xn = bx(d1).toFixed(1);
      tm += 'M' + xn + ',' + TOP + 'v3 M' + xn + ',' + BOT + 'v-3 ';
    }
    g += '<path class="tkm" d="' + tm + '"/></g>';

    /* 選定週次的貫穿線 */
    g += '<rect class="bcur" x="' + bx((GW - 1) * 7).toFixed(1) + '" y="' + GT
      + '" width="' + wkw.toFixed(1) + '" height="' + (GB - GT) + '"/>';

    GLANE.forEach(function (ln, li) {
      var base = ROW[li];

      /* 這一軌的紀錄。**不管有沒有被篩掉都要產生** —— 以前這裡包過 if (!dim)，
         關掉某軌之後只要發生任何重畫，再開回來就永久消失了。圖上一律全部畫。 */
      var marks = [];
      var mine = ev.filter(function (e) { return e.kind === ln.k; });
      /* 同一天同一軌有多筆時才需要錯開，其餘各就各位。
         ⚠️ 間距要**至少大於段寬**，否則同日的幾筆會互相疊掉。
         原本只寫 `dw * 0.62`（一天寬 8.3 → 5.15），段寬 7.5 時每兩筆重疊 2.4px，
         同一天五筆就糊成一團（實測）。取 max 之後同日五筆是 4×8.7 = 34.8px，
         一週有 58px，還放得下。 */
      var perDay = {};
      mine.forEach(function (e) { var k = dayOf(e); perDay[k] = (perDay[k] || 0) + 1; });
      var seen = {};
      mine.forEach(function (e) {
        var day = dayOf(e), n = perDay[day], i = (seen[day] = (seen[day] || 0));
        seen[day]++;
        var dw = span / GDAYS;                     // 一天的寬度
        var step = n > 1 ? Math.max(SEGW + 1.2, dw * 0.62) : 0;
        marks.push({
          e: e, lv: e.lv || 2, w: e.w,
          cx: bx(day + 0.5) + (i - (n - 1) / 2) * step
        });
      });
      marks.sort(function (p, q) { return p.cx - q.cx; });

      /* ── 靜音線 ─────────────────────────────────────
         **一條直線。**
         ⚠️ 這裡曾經是三個正弦疊加的「底噪」（振幅 1.1，使用者早期要過兩次），
         2026-08 使用者改口要簡潔：「線條改成直線」。舊做法連同 140 個取樣點一起拿掉。
         不要因為看到「錄音的靜音段本來就有底噪」這種說法就加回去。 */
      var nf = 'M' + LAB + ',' + base + ' L' + (W - PADR) + ',' + base;

      g += '<g class="lane ' + ln.k + '" style="--i:' + li + '">'
        /* 示意欄：圖案＋軌名＋道號。整條軌只有這裡有圖案。 */
        + '<g class="lkey">' + glyphSvg(ln.k, 17, base, 9)
        + '<text class="lkt" x="36" y="' + (base - 3) + '">' + ln.label + '</text>'
        + '<text class="lkc" x="36" y="' + (base + 10) + '">CH-0' + (li + 1) + '</text></g>'
        + '<path class="silence" d="' + nf + '"/>';

      /* ── 「還沒開始」──────────────────────────────────
         空白之所以危險，是因為它沒有說明 —— 一條什麼都沒有的線讀起來像「沒了」，
         但這裡要說的是「還沒輪到」。補三個字，空白就從缺席變成序幕。
         只在夠寬時才放，擠的時候寧可不放。 */
      if (marks.length) {
        var gap = marks[0].cx - LAB;
        if (gap > 96) {
          g += '<text class="notyet" x="' + (LAB + gap / 2).toFixed(1) + '" y="'
            + (base - 13) + '" text-anchor="middle">還沒開始</text>';
        }
      }

      /* ── 電平段 ─────────────────────────────────────
         一筆紀錄＝以軌線為中心、上下各堆 lv 段。**段數就是差／好／優** ——
         等級變成可以數的，不再是目測高低。
         每一筆是獨立的圖形，所以同一天兩筆重疊就是自然疊在一起 ——
         舊版「一條 lane 只有一條連續 path」的那套限制（夾鄰居、x 單調）全部不需要了。
         --d 是播放頭掃到這裡的時間，CSS 拿去當 animation-delay。 */
      marks.forEach(function (mk) {
        var x = mk.cx - SEGW / 2, seg = '';
        for (var n = 0; n < mk.lv; n++) {
          var off = SEGMID + n * SEGGAP;
          seg += '<rect x="' + x.toFixed(1) + '" y="' + (base - off - SEGH).toFixed(1) + '"'
              + ' width="' + SEGW + '" height="' + SEGH + '" rx="' + (SEGH / 2) + '"/>'
              + '<rect x="' + x.toFixed(1) + '" y="' + (base + off).toFixed(1) + '"'
              + ' width="' + SEGW + '" height="' + SEGH + '" rx="' + (SEGH / 2) + '"/>';
        }
        /* ⚠️ 尖端原本有一顆 `.gdot` 小圓點當 hover／選中的指示器。
           電平段變薄變近之後，那顆點浮在最上面、跟段之間有空隙，
           被使用者問「最上面為什麼有一個圓點」—— 它讀起來像多餘的裝飾。
           拿掉了，回饋改由**電平段自己**變亮／變白（見 uc.css 的 .gmk:hover .seg）。
           少一個元素，而且選中的是哪一筆更直接。 */
        g += '<g class="gmk' + (GSEL === mk.e.id ? ' sel' : '')
          + '" data-ev="' + mk.e.id + '" data-w="' + mk.w + '"'
          + ' style="--d:' + ((mk.cx - LAB) / span).toFixed(3) + '">'
          + '<g class="seg">' + seg + '</g>'
          + '<circle class="ghit" cx="' + mk.cx.toFixed(1) + '" cy="' + base + '" r="16"/></g>';
      });
      g += '</g>';
    });

    /* 週次刻度 */
    for (var w3 = 1; w3 <= N; w3++) {
      /* 一週是一段跨距（七天），不是一個點。點擊區＝整段，數字置中在跨距裡。
         當前週次框起來（沿用 .onum 的作法），靠 markWeek 的 class 切換，不重畫。 */
      var wx0 = bx((w3 - 1) * 7), wxc = bx((w3 - 1) * 7 + 3.5);
      g += '<g class="bwk' + (w3 === GW ? ' on' : '') + '" data-week="' + w3 + '">'
        + '<rect class="bhit" x="' + wx0.toFixed(1) + '" y="0" width="'
          + wkw.toFixed(1) + '" height="' + H + '"/>'
        + '<rect class="bwbox" x="' + (wxc - 12).toFixed(1) + '" y="' + (H - 24)
          + '" width="24" height="16" rx="2"/>'
        + '<text class="bwt" x="' + wxc.toFixed(1) + '" y="' + (H - 12)
          + '" text-anchor="middle">' + ('0' + w3).slice(-2) + '</text></g>';
    }

    /* 播放頭。畫在最後 → 疊在最上層。位置由 sweep() 每一帧改 x1/x2。 */
    g += '<line class="playhead" x1="' + LAB + '" y1="' + TOP + '" x2="' + LAB
      + '" y2="' + BOT + '"/>';

    GEL.band.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bands" role="img"'
      + ' aria-label="十二週的三條紀錄軌跡：通話記錄、外出社交、實際約會">' + g + '</svg>';

    sweep();
    markWeek();
  }

  /* 掃描：三條依序從左往右描繪，前端有一顆發光的點。
     rAF 在被節流的頁籤只跑一次就停，所以用計時器保底把最終狀態補上。 */
  /* ── 播放頭 ─────────────────────────────────────────
     舊版是 strokeDasharray 描一條連續 path。段是離散的圖形，描不了 ——
     改成一條播放頭由左往右掃，段隨它經過依序亮起（`--d` 是那一筆的正規化 x）。
     這比描線更像 DAW 播放，而且不用 getTotalLength()。
     **掃一次就停** —— 這是已經發生完的三個月，不做持續循環（那會假裝是即時訊號）。 */
  function sweep() {
    var me = ++GSWEEP;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var head = GEL.band.querySelector('.playhead');
    var marks = [].slice.call(GEL.band.querySelectorAll('.gmk'));
    var sil = [].slice.call(GEL.band.querySelectorAll('.silence'));
    var box = GEL.band.querySelector('.bands');
    if (!box) return;
    var vb = box.getAttribute('viewBox').split(' ');
    var x0 = 96, x1 = +vb[2] - 26;                    // LAB / W - PADR

    /* 每一筆的正規化位置。--d 是 paintBands 寫進 style 的，讀不到就當 0。 */
    var at = marks.map(function (m) { return +(m.style.getPropertyValue('--d') || 0); });

    function finish() {
      marks.forEach(function (m) { m.classList.add('on'); });
      sil.forEach(function (n) { n.style.strokeDasharray = 'none'; n.style.strokeDashoffset = 0; });
      if (head) head.classList.add('done');
    }
    if (reduce) { finish(); return; }

    marks.forEach(function (m) { m.classList.remove('on'); });
    sil.forEach(function (n) {
      var L = 0;
      try { L = n.getTotalLength(); } catch (e) { L = x1 - x0; }
      n.style.strokeDasharray = L; n.style.strokeDashoffset = L;
      n.dataset.len = L;
    });
    if (head) head.classList.remove('done');

    var dur = 1500, t0 = null, done = false;
    function step(t) {
      if (done || me !== GSWEEP) return;
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      if (head) {
        var x = x0 + (x1 - x0) * k;
        head.setAttribute('x1', x.toFixed(1)); head.setAttribute('x2', x.toFixed(1));
      }
      sil.forEach(function (n) {
        var L = +n.dataset.len || 0;
        n.style.strokeDashoffset = L * (1 - k);
      });
      /* 段亮起交給 CSS transition，這裡只切 class —— 不要每一帧寫 28 個 opacity */
      marks.forEach(function (m, i) { if (k >= at[i]) m.classList.add('on'); });
      if (k < 1) requestAnimationFrame(step); else { done = true; finish(); }
    }
    requestAnimationFrame(step);
    setTimeout(function () {                       // rAF 被節流時保底
      done = true;
      if (me === GSWEEP) finish();
    }, dur + 260);
  }

  function markWeek() {
    [].forEach.call(GEL.band.querySelectorAll('.bwk'), function (c) {
      c.classList.toggle('on', +c.dataset.week === GW);
    });
    [].forEach.call(GEL.band.querySelectorAll('[data-ev]'), function (p) {
      p.classList.toggle('sel', p.dataset.ev === GSEL);
    });
    /* 貫穿線就地移動，不重建 SVG */
    var cur = GEL.band.querySelector('.bcur');
    if (cur && GPOS.wkw) cur.setAttribute('x', (GPOS.x0 + (GW - 1) * GPOS.wkw).toFixed(1));
  }

  function growthTo(w) {
    GW = w;
    markWeek();
    paintPanel();
  }

  /* 下方紀錄區。類型選擇（含總筆數）就在這裡 —— 圖上不再做篩選。
     「全部」看選定那一週；選了某一種就把十二週該類型的紀錄全部攤開來回看。 */
  function paintPanel() {
    var ev = gEvents();
    var n = function (k) {
      return k === 'all' ? ev.length
                         : ev.filter(function (e) { return e.kind === k; }).length;
    };
    var tabs = [{ k: 'all', label: '全部' }].concat(GLANE);
    var head = '<div class="rkind" id="gKind">' + tabs.map(function (t) {
      return '<button class="rk' + (GKIND === t.k ? ' on' : '') + '" data-kind="' + t.k + '">'
        + (t.k === 'all' ? '' : '<svg class="cgy" viewBox="0 0 16 16" aria-hidden="true">'
            + glyphSvg(t.k, 8, 8, 5.6) + '</svg>')
        + t.label + '<b class="num">' + n(t.k) + '</b></button>';
    }).join('') + '</div>';

    var body;
    var one = GSEL ? ev.filter(function (e) { return e.id === GSEL; })[0] : null;
    if (one) {
      body = evCard(one);
    } else if (GKIND === 'all') {
      var wk = ev.filter(function (e) { return e.w === GW; });
      body = '<p class="ey">第 ' + GW + ' 週　共 ' + wk.length + ' 筆</p>'
        + (wk.length ? wk.map(function (e) { return evCard(e, true); }).join('')
                     : '<p class="snote">這一週還沒有紀錄。</p>');
    } else {
      var ln = GLANE.filter(function (l) { return l.k === GKIND; })[0];
      var all = ev.filter(function (e) { return e.kind === GKIND; })
        .sort(function (a, b) { return dayOf(a) - dayOf(b); });
      body = '<p class="ey">' + ln.label + '　十二週共 ' + all.length + ' 筆</p>'
        + (all.length ? all.map(function (e) { return evCard(e, true); }).join('')
                      : '<p class="snote">還沒有這一類的紀錄。</p>');
    }

    GEL.panel.innerHTML = head + body;
    el('gKind').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (!b || b.dataset.kind === GKIND) return;
      GKIND = b.dataset.kind;
      GSEL = null;                 // 換類型就離開「單筆」檢視
      markWeek();                  // 取消圖上的選取highlight
      paintPanel();
    });
  }

  function evCard(e, compact) {
    var ln = GLANE.filter(function (x) { return x.k === e.kind; })[0] || { label: e.kind };
    return '<div class="evc' + (compact ? ' cmp' : '') + '">'
      + '<p class="ey"><span class="ek">' + ln.label + '</span>'
      + '第 ' + e.w + ' 週' + (e.d ? '　' + gDateStr(e) : '')
      + '　・　' + (e.by === 'coach' ? '教練記錄' : '學員記錄')
      + '　・　狀況 <b class="lv' + (e.lv || 2) + '">' + lvOf(e).t + '</b></p>'
      /* ⚠️ 新版表單只有「紀錄」一個文字欄（存在 outcome），沒有標題。
         舊資料還有 t，所以兩種都要畫得出來 —— 有 t 就當小標，沒有就直接是內文。 */
      + (e.t ? '<p class="evt">' + esc(e.t) + '</p>' : '')
      + (e.outcome ? '<h3 class="evo">' + esc(e.outcome) + '</h3>' : '')
      + (e.note ? '<p class="evn">' + esc(e.note) + '</p>' : '')
      + '</div>';
  }

  /* ── 雙向紀錄表單 ─────────────────────────────────── */
  /* 三種類型只差這一句提示 —— 欄位本身完全一樣，不要為了差異而多開欄位。 */
  var OUTPH = {
    call:   '這次通話確認了什麼調整？一句就好。',
    social: '去了哪裡、認識了誰？一句就好。',
    date:   '跟誰、做了什麼、進展到哪？一句就好。'
  };

  /* 預設今天。⚠️ 要夾在課程的 12 週範圍內 —— 超出去 gDay() 會回負數，
     存檔會被自己的檢查擋掉，而使用者只會看到「日期要落在這 12 週裡」很困惑。 */
  function todayIso() {
    var t = new Date();
    var iso = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2)
            + '-' + ('0' + t.getDate()).slice(-2);
    var day = gDay(iso);
    if (day >= 0 && day < GDAYS) return iso;
    return gIso(Math.min(GDAYS - 1, Math.max(0, (GW - 1) * 7 + 3)));
  }

  var GKHINT = {
    call:   '跟教練通話之後記一筆',
    social: '出門認識人、參加活動',
    date:   '約出來見面'
  };

  function renderForm() {
    if (!GFORM) { GEL.form.innerHTML = ''; return; }
    /* 類型在按按鈕的時候就決定了，表單裡不再問一次。 */
    var lane = GLANE.filter(function (l) { return l.k === GFORM; })[0] || GLANE[0];

    var h = '<div class="gfm" data-field-scope="growth.event"><p class="ey">新增紀錄</p>'
      + '<h3 class="gfkind">' + esc(lane.label) + '</h3>'
      + '<p class="fieldtag shared">教練與學員皆可填寫</p>'
      + '<input type="hidden" id="fKind" value="' + esc(lane.k) + '">'
      /* 正式登入後記錄者由 LIFF 身分決定，沒得選 —— 選單只留給本機範例模式。 */
      + (ACTOR_ROLE
        ? '<input type="hidden" id="fBy" value="' + esc(ACTOR_ROLE) + '">'
        : '<div class="gfr"><label for="fBy">記錄者</label><select id="fBy" data-field-id="growth.event.author" data-field-owner="state" data-field-label="記錄者">'
          + '<option value="coach">教練</option><option value="student">學員</option>'
          + '</select><s class="gfh">正式登入後會自動使用目前身分；範例模式可切換</s></div>')
      /* ⚠️ **只有三格。** 使用者 2026-09-13：「這個填表功能應該是每週都會用到的，
         所以要確保他很容易填寫。只需要日期、狀況、紀錄。」
         類型不問（按哪顆按鈕就是哪一種）、記錄者不問（由身分決定）、
         標題與補充都拿掉 —— 每週要填的東西多一格就少一分會填。 */
      + '<div class="gfr"><label for="fDate">日期</label><input type="date" id="fDate" data-field-id="growth.event.date" data-field-owner="shared" data-field-label="紀錄日期"'
      + ' min="' + G0 + '" max="' + G1 + '" value="' + esc(todayIso()) + '">'
      + '<s class="gfh">預設今天</s></div>'
      + '<div class="gfr"><label>狀況</label><div class="gflv" id="fLvBox">'
      + [1, 2, 3].map(function (n) {
          return '<button type="button" class="gflvb' + (n === 2 ? ' on' : '') + '"'
            + ' data-lv="' + n + '">' + esc(GLV[n].t) + '</button>';
        }).join('')
      + '</div><input type="hidden" id="fLv" value="2"></div>'
      + '<div class="gfr"><label for="fO">紀錄</label><textarea id="fO" rows="4" data-field-id="growth.event.outcome" data-field-owner="shared" data-field-label="紀錄內容" placeholder="' + esc(OUTPH[lane.k]) + '"></textarea></div>';

    h += '<div class="gfb"><button class="btn pri" id="fSave">記下來</button>'
      + '<button class="btn gh" id="fCancel">取消</button></div></div>';
    GEL.form.innerHTML = h;

    if (!ACTOR_ROLE) el('fBy').value = lane.who;
    /* 狀況用三顆按鈕不用下拉 —— 手機上點一下比「開下拉、捲、選、關」快得多。 */
    el('fLvBox').addEventListener('click', function (e) {
      var b = e.target.closest('[data-lv]'); if (!b) return;
      el('fLv').value = b.dataset.lv;
      [].forEach.call(el('fLvBox').children, function (x) { x.classList.toggle('on', x === b); });
    });
    el('fO').focus();
    el('fCancel').addEventListener('click', function () { GFORM = null; renderForm(); });
    el('fSave').addEventListener('click', function () {
      var body = el('fO').value.trim();
      if (!body) { toast('寫一句就好，不用長'); el('fO').focus(); return; }
      var iso = el('fDate').value;
      var day = iso ? gDay(iso) : -1;
      if (day < 0 || day >= GDAYS) { toast('日期要落在這 12 週裡'); return; }
      var e = {
        id: 'U' + Date.now(), w: gWeekOf(day), d: iso, by: el('fBy').value,
        kind: el('fKind').value, lv: +el('fLv').value,
        outcome: body
      };
      S.log = (S.log || []).concat([e]); save();
      GFORM = null; GSEL = e.id;
      renderForm(); paintBands(); growthTo(e.w);
      toast('已加到第 ' + e.w + ' 週');
    });
  }

  /* ── 課程資源與工具 ───────────────────────────────────
     切分頁**不重建整頁**：舊版每次點分頁都重寫 body，於是捲動位置被拉回頂端、
     淡入動畫重播一次，體感就像整頁重新整理。現在只換分頁窗格的內容。 */
  var LIBTAB = 'req', LIBOPEN = null;

  function renderLibrary() {
    var L = window.UC_LIBRARY;

    /* ⚠️ **頁首只有標題。** 原本那句「30+ 小時錄播、12+ 堂…」是**銷售話術**，
       而且數量在下面的分頁鈕上本來就有（每個分頁都帶筆數）—— 重複又多餘。 */
    var h = wrap('<header class="rhead"><p class="ey">Resource Library</p><h1>資源與工具</h1>'
      + '<div class="divider"><i></i><s></s></div></header>');

    h += wrap('<div class="tabs" id="libTabs">' + L.tabs.map(function (t) {
        var n = t.k === 'tool' ? window.UC_TOOLS.items.length
              : L.items.filter(function (i) { return i.tab === t.k; }).length;
        return '<button class="tab" data-tab="' + t.k + '">'
          + esc(t.name) + '<b class="num">' + n + '</b></button>';
      }).join('') + '</div><div id="libPane"></div>', 'rv');

    var body = el('libBody');
    body.innerHTML = h;

    [].forEach.call(body.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { libTo(b.dataset.tab); });
    });
    libTo(LIBTAB, true);                 // 卡片都在窗格裡，由 libTo 綁
    if (LIBOPEN) {
      var pendingTool = LIBOPEN;
      LIBOPEN = null;
      toolTo(pendingTool);
    }
    reveal(body);
  }

  /* 換分頁。只換窗格內容，不動捲動位置、不重建整頁。 */
  function libTo(k, initial) {
    var L = window.UC_LIBRARY;
    LIBTAB = k;
    var tab = L.tabs.filter(function (t) { return t.k === k; })[0] || L.tabs[0];

    [].forEach.call(el('libTabs').children, function (b) {
      b.className = 'tab' + (b.dataset.tab === k ? ' on' : '');
    });

    var pane = el('libPane');
    pane.innerHTML = '<p class="snote">' + esc(tab.note) + '</p>'
      + (k === 'tool' ? toolsHtml()
                      : '<div class="grid">' + L.items.filter(function (i) { return i.tab === k; })
                          .map(function (i) { return tile(i); }).join('') + '</div>');
    bindTiles(pane);
    if (!initial) reveal(pane);          // 新內容淡入，但捲動位置不動
  }

  function bindTiles(root) {
    [].forEach.call(root.querySelectorAll('.tile[data-tool]'), function (b) {
      b.addEventListener('click', function () { toolTo(b.dataset.tool); });
    });
    [].forEach.call(root.querySelectorAll('.tile[data-t]'), function (b) {
      b.addEventListener('click', function () {
        toast(b.dataset.src ? '開啟：' + b.dataset.t : '「' + b.dataset.t + '」的內容待補');
      });
    });
  }

  function tile(i) {
    return '<button type="button" class="tile" data-src="' + esc(i.src) + '" data-t="' + esc(i.t) + '">'
      + '<span class="thumb' + (i.cover ? ' has-cover' : '') + '">'
      + (i.cover ? '<img src="' + esc(i.cover) + '" alt="" loading="lazy" decoding="async">' : '')
      + '<i class="num">' + esc(i.no) + '</i></span>'
      + '<b>' + esc(i.t) + '</b><s>' + esc(i.sub) + '</s>'
      + '<em class="num">' + esc(i.len) + '</em></button>';
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
        + '<i class="num">' + ('0' + (i + 1)) + '</i>'
        + '<u>' + (t.status === 'preview' ? '結構示意' : '內容待補') + '</u></span>'
        + '<b>' + esc(t.t) + '</b><s>' + esc(t.lead) + '</s>'
        + '<em class="num">' + esc(t.en) + '</em></button>';
    }).join('') + '</div>';
  }

  /* 點開一張工具卡。只換窗格內容，捲動位置不動。 */
  function toolTo(k) {
    var t = window.UC_TOOLS.items.filter(function (x) { return x.k === k; })[0];
    if (!t) return;
    var badge = t.status === 'preview' ? '結構示意' : '內容待補';
    var x = '<button class="btn gh bk" id="toolBack">← 回到課程工具</button>'
      + '<div class="thead"><div><p class="ey">' + t.en + '</p><h2>' + esc(t.t) + '</h2></div>'
      + '<span class="badge ' + t.status + '">' + badge + '</span></div>'
      + '<div class="divider"><i></i><s></s></div>'
      + '<p class="tlead">' + esc(t.lead) + '</p><p class="tbody">' + esc(t.body) + '</p>';
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
    el('toolBack').addEventListener('click', function () { libTo('tool'); });
    reveal(pane);
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

  if (location.hash === '#selftest') { window.UC_SELFTEST && window.UC_SELFTEST(); return; }
  go(location.hash || '#/');

  document.documentElement.dataset.ucRole = ACTOR_ROLE || 'demo';
  applyFieldAccess(document);
  window.UC_APP = {
    S: function () { return S; }, save: save, esc: esc, reveal: reveal, nav: nav, el: el,
    setRole: setRole, role: function () { return ACTOR_ROLE; }, applyFieldAccess: applyFieldAccess,
    replaceState: replaceState, landing: landing, entryRoute: entryRoute,
    toast: toast, render: function () { go(location.hash || '#/'); }
  };
  /* store.js 比 app.js 先載入（它不能依賴 UC_APP），所以在這裡回頭叫它一次。 */
  if (window.UC_STORE && window.UC_STORE.attach) window.UC_STORE.attach(window.UC_APP);
})();
