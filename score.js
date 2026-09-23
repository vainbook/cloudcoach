/* UC Cloud Coach — 計分核心
   移植自 4_行銷用心理測驗/site/engine.js:23-101。原版是「單一綜合分數決定一個型別」，
   五維能力圖不需要綜合分，所以丟掉 rawOf / CALIB.cuts / levels / types，
   每維度各自走百分位再分級。保留三件事，因為那是踩過才知道的：

   1. 累加值刻意不夾 0..100 —— 夾了之後大量答法會等於同一個值，連百分位都排不出先後
   2. 顯示值走百分位而不是累加原始值 —— 原始值會撞頂，讓好幾條指標變成常數（白佔位）
   3. 固定種子 —— 同樣答案永遠得到同樣結果，教練覆盤時才有可比較性
*/
window.UC_SCORE = (function () {
  'use strict';

  var SEED = 20260820, N_CALIB = 4000;
  var DIMS = window.UC_DIMENSIONS.dims;
  var KEYS = DIMS.map(function (d) { return d.k; });
  var Q = window.UC_QUESTIONS.items;

  /* scale 型只寫一行，在這裡展開成 5 個選項，
     讓 calibrate 與 selftest 只需要面對「挑一個索引」這一種形狀。 */
  var SCALE_LABELS = ['完全不符合', '不太符合', '一半一半', '比較符合', '非常符合'];
  Q.forEach(function (q) {
    if (q.type !== 'scale') return;
    var w = q.w || 6, inv = q.invert ? -1 : 1;
    q.o = SCALE_LABELS.map(function (t, i) {
      var d = {}; d[q.dim] = (i - 2) * w * inv;
      return { t: t, d: d };
    });
  });

  var SCORED = Q.filter(function (q) { return q.type !== 'info'; });

  function dimsOf(pick) {
    var s = {};
    KEYS.forEach(function (k) { s[k] = 50; });
    SCORED.forEach(function (q, i) {
      var idx = pick(q, i);
      if (idx == null || !q.o[idx]) return;
      var d = q.o[idx].d;
      for (var k in d) s[k] += d[k];
    });
    return s;
  }

  var CAL = (function () {
    var seed = SEED;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var byDim = {};
    KEYS.forEach(function (k) { byDim[k] = []; });
    for (var n = 0; n < N_CALIB; n++) {
      var s = dimsOf(function (q) { return Math.floor(rnd() * q.o.length); });
      KEYS.forEach(function (k) { byDim[k].push(s[k]); });
    }
    KEYS.forEach(function (k) { byDim[k].sort(function (a, b) { return a - b; }); });
    return byDim;
  })();

  function pctOf(k, v) {
    var a = CAL[k], lo = 0, hi = a.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
    var ties = 0;
    while (lo + ties < a.length && a[lo + ties] === v) ties++;
    return Math.max(1, Math.min(99, Math.round((lo + ties / 2) / a.length * 100)));
  }

  /* 三級：低 / 中 / 高。切點放在百分位而不是原始值。
     ponytail: 先做三級（15 段文本）而非五級（25 段）。分級的表現力靠交叉規則補足，
     等教練審過三級文本再升級。 */
  var CUTS = [34, 67];
  function bandOf(p) { return p < CUTS[0] ? 0 : p < CUTS[1] ? 1 : 2; }

  /* ── 星等（對外唯一的顯示單位）───────────────────────
     使用者定調：不對外顯示實際分數，只給 1–5 顆星。這也順手解決一個矛盾 ——
     報告的分數是百分位、教練評分是主觀分，兩種量尺長得一樣；星等本來就粗，不必假裝精確。

     切點刻意跟 CUTS 對齊，所以星等與三級文本永不矛盾：
       1–2 星 → 低段　3 星 → 中段　4–5 星 → 高段
     （#selftest 會逐格驗證這件事） */
  var STAR_EDGE = [20, CUTS[0], CUTS[1], 84];        // 1★|2★ 2★|3★ 3★|4★ 4★|5★
  var STAR_MID  = [10, 27, 50, 75, 92];              // 教練用星等打分時存回的代表值

  function starOf(p) {
    for (var i = 0; i < STAR_EDGE.length; i++) if (p < STAR_EDGE[i]) return i + 1;
    return 5;
  }
  /* 連續版：給雷達圖的幾何用。整數交界剛好落在星等邊界上，
     所以「碰到第 3 圈」就等於「3 星」，而且補間時頂點是滑過去而不是跳格。 */
  function starPos(p) {
    var xs = [0].concat(STAR_EDGE, [100]);
    for (var i = 0; i < xs.length - 1; i++) {
      if (p <= xs[i + 1]) return i + (p - xs[i]) / ((xs[i + 1] - xs[i]) || 1);
    }
    return 5;
  }
  function starText(p) {
    var n = starOf(p);
    return new Array(n + 1).join('★') + new Array(6 - n).join('☆');
  }

  function score(answers) {
    answers = answers || {};
    var raw = dimsOf(function (q) { var v = answers[q.id]; return typeof v === 'number' ? v : null; });
    var show = {}, band = {};
    KEYS.forEach(function (k) { show[k] = pctOf(k, raw[k]); band[k] = bandOf(show[k]); });

    var answered = SCORED.filter(function (q) { return typeof answers[q.id] === 'number'; }).length;
    var order = KEYS.slice().sort(function (a, b) { return show[b] - show[a]; });

    return {
      show: show, band: band, raw: raw,
      top: order[0], low: order[order.length - 1], order: order,
      answered: answered, total: SCORED.length,
      complete: answered === SCORED.length
    };
  }

  function questionsBySection() {
    var out = [];
    window.UC_QUESTIONS.sections.forEach(function (s) {
      out.push({ sec: s, items: Q.filter(function (q) { return q.sec === s.k; }) });
    });
    return out;
  }

  return {
    dims: DIMS, keys: KEYS, questions: Q, scored: SCORED,
    score: score, pctOf: pctOf, bandOf: bandOf, cuts: CUTS,
    starOf: starOf, starPos: starPos, starText: starText, starMid: STAR_MID, starEdge: STAR_EDGE,
    bySection: questionsBySection, scaleLabels: SCALE_LABELS,
    dist: CAL          // 每維度 raw 分數的排序陣列，供報告畫基準分佈曲線
  };
})();

/* ── 範例學員 ────────────────────────────────────────
   不手寫 70 個答案（題庫一改就過期）。給每個維度一個目標方向，
   逐題挑最貼近該方向的選項並加一點雜訊，讓側面圖有起伏而不是一條平線。
   目標刻意做成「形象與調情高、生活圈與價值觀低」——那是雲端教練最典型的來客側面
   （高功能但情感能力失衡），而且會命中兩條交叉規則，示範時那一段才不是空的。 */
window.UC_SAMPLE = function () {
  var E = window.UC_SCORE, seed = 424242;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var target = { emo: .46, circle: .06, image: .84, values: .10, flirt: .84 };
  var answers = {};

  /* ⚠️ 舊的挑法是「找 delta 最接近目標的選項」，在新題庫會壞掉：
     五級階梯的中間那個選項 delta = 0，`Math.abs(0)` 讓 want 和 got 都是 0，
     gap 永遠是 0，於是每一題都選中間，五個維度全部停在 50（踩過）。
     新題庫是乾淨的等距階梯，直接照目標比例挑索引就好，順便加一點雜訊讓側面圖有起伏。 */
  E.scored.forEach(function (q) {
    var k = Object.keys(q.o[0].d)[0], n = q.o.length;
    var idx = Math.round(target[k] * (n - 1) + (rnd() - .5) * 1.4);
    answers[q.id] = Math.max(0, Math.min(n - 1, idx));
  });

  window.UC_QUESTIONS.items.filter(function (q) { return q.type === 'info'; })
    .forEach(function (q) { if (q.sample != null) answers[q.id] = q.sample; });

  return {
    name: '示範學員 ・ 阿睿', answers: answers, picked: [], key: {},
    taskNow: {}, hidden: {}, done: {},
    /* Logo 的共用 Demo 要能直接瀏覽全站，不讓每位檢查者都先填六格。
       這些只是範例資料，正式學員的報告仍必須由教練完成。 */
    coachReport: {
      adjust: {}, scores: {},
      notes: {
        values: '你目前最需要先補的是內在方向：把想成為的人、想過的生活和關係判準說清楚，後面的練習才有骨架。',
        emo: '你已經能接住一部分情緒，但還需要練習把自己的感受放進對話，讓別人不只覺得你會聽，也真正認識你。',
        image: '你的外在整理與場合感已經很成熟，接下來重點不是繼續加配件，而是讓形象和真實生活一致。',
        circle: '目前最大的限制不是聊天技巧，而是缺少穩定認識新朋友的場域，先建立每週可重複參與的生活圈。',
        flirt: '你掌握互動節奏與升溫訊號，下一步要把技巧放回真誠與尊重裡，確認彼此都自在且願意靠近。'
      },
      letter: '阿睿，你已經具備很好的形象與互動能力，接下來三個月我們會先建立內在方向與穩定生活圈，讓你不只會開始一段互動，也能走進真正想要的關係。',
      coachName: 'UC Coach', complete: true
    },
    /* ⚠️ 成長紀錄**要真的放進 log**，不是在畫面上疊一層唯讀的範例
       （使用者 2026-09-19：「demo 版也要有完整的功能與內容，就是學員的實際畫面」）。
       原本它們只從 UC_GROWTH.events 疊在畫面上，不在狀態裡 ——
       於是編輯與刪除的按鈕全部不出現，那兩個功能在 demo 裡等於不存在。
       深拷貝：demo 可以隨便改，不要動到那份原始資料。 */
    log: (window.UC_GROWTH && window.UC_GROWTH.events)
      ? JSON.parse(JSON.stringify(window.UC_GROWTH.events)) : []
  };
};

/* ── 自我檢查（網址加 #selftest）───────────────────────
   移植自 engine.js:390。這裡抓的問題都不會讓程式報錯，只會讓報告變爛：
   指標變成常數、分級擠在一區、文案欄位缺一塊、delta 指到不存在的維度。
   **改題庫、改 delta、改分級文本之後一定要跑。** */
window.UC_SELFTEST = function () {
  var E = window.UC_SCORE, D = window.UC_DIMENSIONS, O = window.UC_OKR;
  var Q = window.UC_QUESTIONS, L = window.UC_LIBRARY, T = window.UC_TOOLS;
  var CO = window.UC_COACH, G = window.UC_GROWTH;
  var ok = true, log = [], fails = [];
  function t(name, cond) { if (!cond) { ok = false; fails.push(name); } }

  /* 1. 分佈：隨機作答 20000 次 */
  var seed = 99, N = 20000, vals = {}, bands = {};
  E.keys.forEach(function (k) { vals[k] = []; bands[k] = [0, 0, 0]; });
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var n = 0; n < N; n++) {
    var a = {};
    E.scored.forEach(function (q) { a[q.id] = Math.floor(rnd() * q.o.length); });
    var r = E.score(a);
    E.keys.forEach(function (k) { vals[k].push(r.show[k]); bands[k][r.band[k]]++; });
  }
  log.push('── 分佈（隨機作答 ' + N.toLocaleString('en-US') + ' 次）');
  D.dims.forEach(function (d) {
    var arr = vals[d.k];
    var m = arr.reduce(function (x, y) { return x + y; }, 0) / arr.length;
    var sd = Math.sqrt(arr.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / arr.length);
    var f = {}, mx = 0;
    arr.forEach(function (v) { f[v] = (f[v] || 0) + 1; if (f[v] > mx) mx = f[v]; });
    var share = mx / N;
    var bp = bands[d.k].map(function (h) { return (h / N * 100).toFixed(1); });
    t(d.label + ' 有離散度（sd ' + sd.toFixed(1) + ' > 12）', sd > 12);
    t(d.label + ' 沒有單一值吃掉 >40%（' + (share * 100).toFixed(1) + '%）', share <= .4);
    bp.forEach(function (p, i) {
      t(d.label + ' ' + ['低', '中', '高'][i] + '段出現率 ' + p + '% 在 15–55%', +p >= 15 && +p <= 55);
    });
    log.push('  ' + d.label + '　mean ' + m.toFixed(1) + '　sd ' + sd.toFixed(1)
      + '　低/中/高 ' + bp.join(' / ') + '%');
  });

  /* 2. 極端答法要真的落在兩端 */
  function extreme(dim, sign) {
    var a = {};
    E.scored.forEach(function (q) {
      var best = 0, bestV = -Infinity;
      q.o.forEach(function (o, i) {
        var v = (o.d[dim] || 0) * sign;
        if (v > bestV) { bestV = v; best = i; }
      });
      a[q.id] = best;
    });
    return E.score(a);
  }
  log.push('── 極端答法');
  D.dims.forEach(function (d) {
    var lo = extreme(d.k, -1), hi = extreme(d.k, 1);
    t(d.label + ' 最低答法落在低段（' + lo.show[d.k] + '）', lo.band[d.k] === 0);
    t(d.label + ' 最高答法落在高段（' + hi.show[d.k] + '）', hi.band[d.k] === 2);
    log.push('  ' + d.label + '　最低 ' + lo.show[d.k] + '　最高 ' + hi.show[d.k]);
  });

  /* 3. 題庫完整性 */
  var dimSet = {};
  E.keys.forEach(function (k) { dimSet[k] = 1; });
  var secSet = {};
  Q.sections.forEach(function (s) { secSet[s.k] = 1; });
  Q.items.forEach(function (q) {
    t(q.id + ' 有題目文字', typeof q.q === 'string' && q.q.length > 0);
    t(q.id + ' 的 sec「' + q.sec + '」存在', !!secSet[q.sec]);
    if (q.type === 'info') {
      t(q.id + ' info 題有 input', ['text', 'textarea', 'number', 'select', 'checks'].indexOf(q.input) >= 0);
      if (q.input === 'select') t(q.id + ' select 有 opts', q.opts && q.opts.length > 1);
      if (q.input === 'checks') t(q.id + ' checks 有 opts', q.opts && q.opts.length > 1);
      if (q.max != null) t(q.id + ' max 只用於 checks', q.input === 'checks' && q.max > 0);
      t(q.id + ' info 題不該帶 delta', !q.o);
      return;
    }
    if (q.type === 'scale') t(q.id + ' scale 題的 dim「' + q.dim + '」存在', !!dimSet[q.dim]);
    t(q.id + ' 有至少 2 個選項', q.o && q.o.length >= 2);
    (q.o || []).forEach(function (o, i) {
      var cnt = 0;
      for (var k in o.d) { cnt++; t(q.id + '.' + (i + 1) + ' 維度「' + k + '」存在', !!dimSet[k]); }
      t(q.id + '.' + (i + 1) + ' 有 delta', cnt > 0);
      t(q.id + '.' + (i + 1) + ' 有選項文字', typeof o.t === 'string' && o.t.length > 0);
    });
  });
  var ids = {}, dup = [];
  Q.items.forEach(function (q) { if (ids[q.id]) dup.push(q.id); ids[q.id] = 1; });
  t('沒有重複的題號' + (dup.length ? '（' + dup.join(',') + '）' : ''), !dup.length);
  Q.sections.forEach(function (s) {
    t('分區「' + s.name + '」至少有 1 題', Q.items.filter(function (q) { return q.sec === s.k; }).length > 0);
  });
  log.push('── 題庫　' + Q.items.length + ' 題（計分 ' + E.scored.length
    + ' ／ 訪談 ' + (Q.items.length - E.scored.length) + '）'
    + '\n  各維度受影響題數（含交叉載荷，非主題數）　'
    + D.dims.map(function (d) {
        return d.label + ' ' + E.scored.filter(function (q) {
          return q.o.some(function (o) { return o.d[d.k]; });
        }).length;
      }).join('　'));

  /* 4. 文本完整性 */
  D.dims.forEach(function (d) {
    ['label', 'en', 'blurb', 'enemy', 'define', 'image'].forEach(function (f) {
      t('維度 ' + d.k + '.' + f, typeof d[f] === 'string' && d[f].length > 0);
    });
    t('維度 ' + d.k + ' 有 facets', d.facets && d.facets.length >= 3);
    t('維度 ' + d.k + ' 有理論引用', d.theory && d.theory.length >= 1);
    (d.theory || []).forEach(function (x, i) {
      ['name', 'en', 'note'].forEach(function (f) {
        t('維度 ' + d.k + '.theory[' + i + '].' + f, typeof x[f] === 'string' && x[f].length > 0);
      });
    });
    t('維度 ' + d.k + ' 有 3 級文本', d.bands && d.bands.length === 3);
    (d.bands || []).forEach(function (b, i) {
      t('維度 ' + d.k + '.bands[' + i + '].title', typeof b.title === 'string' && b.title.length > 0);
      ['read', 'trap', 'core'].forEach(function (f) {
        /* 門檻只擋空白與殘句。刻意的短句（14 字）是文風不是缺漏 —— 不要為了過檢查把句子灌長 */
        t('維度 ' + d.k + '.bands[' + i + '].' + f, typeof b[f] === 'string' && b[f].length > 12);
      });
    });
  });
  D.crosses.forEach(function (c, i) {
    t('crosses[' + i + '] 有 title 與 text', c.title && c.text && c.text.length > 20);
    t('crosses[' + i + '] 至少有一個條件', (c.hi || []).length + (c.lo || []).length > 0);
    (c.hi || []).concat(c.lo || []).forEach(function (k) {
      t('crosses[' + i + '] 的維度「' + k + '」存在', !!dimSet[k]);
    });
  });
  Object.keys(D.lenses).forEach(function (qid) {
    if (qid === 'note') return;
    t('透鏡 ' + qid + ' 對應的題目存在', !!ids[qid]);
    var spec = D.lenses[qid], q = Q.items.filter(function (x) { return x.id === qid; })[0];
    t('透鏡 ' + qid + ' 有 label', !!spec.label);
    t('透鏡 ' + qid + ' 不計分', !q || q.type === 'info');
    if (spec.map && q && q.opts) {
      q.opts.forEach(function (o) { t('透鏡 ' + qid + ' 缺選項「' + o + '」的文本', !!spec.map[o]); });
    }
  });
  log.push('── 文本　' + D.dims.length + ' 維 × 3 級 = ' + D.dims.length * 3 + ' 段　交叉規則 '
    + D.crosses.length + ' 條　透鏡 ' + (Object.keys(D.lenses).length - 1) + ' 項');

  /* 5. 藍圖（真資料）與資源 */
  var itemIds = {};
  O.items.forEach(function (it) {
    itemIds[it.id] = 1;
    t('藍圖 ' + it.id + ' 的維度存在', !!dimSet[it.dim]);
    t('藍圖 ' + it.id + ' 有 KR 文字', typeof it.kr === 'string' && it.kr.length > 0);
    t('藍圖 ' + it.id + ' 的章節在範圍內', it.ch >= 0 && it.ch < O.epigraphs.length);
    if (it.sheet) t('藍圖 ' + it.id + ' 的工作表 ' + it.sheet + ' 在 sheets 裡找得到',
      O.sheets.some(function (x) { return x.k === it.sheet; }));
  });
  t('三句章節格言齊全', O.epigraphs.length === 3 && O.epigraphs.every(function (x) { return x.length > 6; }));
  E.keys.forEach(function (k) {
    t('維度 ' + k + ' 至少有 3 條藍圖項目', O.items.filter(function (it) { return it.dim === k; }).length >= 3);
  });
  O.sheets.forEach(function (x) { t('工作表 ' + x.k + ' 有欄位說明', x.where && x.cols); });
  t('當前任務有關閉與執行按鈕文案', O.taskUI.closeAction === '關閉' && O.taskUI.runAction === '執行任務');
  t('沒有工具時有聯絡教練提示', O.taskUI.contactTitle && O.taskUI.contactBody);
  t('總覽有當前任務與隱藏管理文案', O.editUI.currentCount && O.editUI.manageHidden && O.editUI.hideLabel);
  t('總覽有當前與完成任務文案', O.editUI.currentCount && O.editUI.doneCount && O.editUI.doneLabel);
  /* 憑證與本名不得進公開檔案（工作區 AGENTS.md） */
  var leak = JSON.stringify(O).match(/兌換碼[：:]\s*\S+/);
  t('藍圖沒有夾帶課程兌換碼', !leak);

  var tabSet = {};
  L.tabs.forEach(function (x) { tabSet[x.k] = 1; });
  L.items.forEach(function (i) {
    t('資源「' + i.t + '」的分頁存在', !!tabSet[i.tab]);
    t('資源「' + i.t + '」有標題與副標', i.t && i.sub);
    (i.dims || []).forEach(function (k) { t('資源「' + i.t + '」的維度 ' + k + ' 存在', !!dimSet[k]); });
  });
  L.tabs.forEach(function (x) {
    /* 'tool' 分頁的內容來自 UC_TOOLS，不是 library.items */
    var n = x.k === 'tool' ? T.items.length : L.items.filter(function (i) { return i.tab === x.k; }).length;
    t('資源分頁「' + x.name + '」至少有 1 筆', n > 0);
  });
  t('資源頁有工具分頁（工具已併入資源頁）', L.tabs.some(function (x) { return x.k === 'tool'; }));

  /* ⚠️ id 是課程連結的鍵，重複或漏掉都會讓教練貼的網址接錯課。
     no 只是畫面上的編號，會跟著排序變 —— 兩者不可以混用。 */
  var seenId = {}, dupId = [], noId = [];
  L.items.forEach(function (i) {
    if (!i.id) { noId.push(i.t); return; }
    if (seenId[i.id]) dupId.push(i.id);
    seenId[i.id] = 1;
  });
  t('每個資源都有 id（課程連結的鍵）' + (noId.length ? '：缺 ' + noId.join('、') : ''), !noId.length);
  t('資源 id 沒有重複' + (dupId.length ? '：' + dupId.join('、') : ''), !dupId.length);
  /* 「為你安排」要對每個維度都排得出課，否則某些學員會看到空的推薦 */
  E.keys.forEach(function (k) {
    t('維度 ' + k + ' 至少有 1 堂指定課程',
      L.items.filter(function (i) { return i.dims && i.dims.indexOf(k) >= 0; }).length >= 1);
  });
  T.items.forEach(function (x) {
    t('工具「' + x.t + '」有狀態標記', ['active', 'preview', 'soon'].indexOf(x.status) >= 0);
    if (x.assignment) {
      t('作業「' + x.t + '」有穩定 id', /^[a-z0-9-]+$/.test(x.assignment.id || ''));
      var fields = x.assignment.kind === 'belief-cycle' && x.assignment.belief
        ? [].concat(x.assignment.belief.stage1 && x.assignment.belief.stage1.fields || [],
          x.assignment.belief.stage2 && x.assignment.belief.stage2.loopFields || [],
          x.assignment.belief.stage2 && x.assignment.belief.stage2.exitFields || [])
        : Array.isArray(x.assignment.groups)
          ? x.assignment.groups.reduce(function (out, g) { return out.concat(g.fields || []); }, [])
          : (x.assignment.fields || []);
      t('作業「' + x.t + '」有題目', fields.length > 0);
      var assignmentFields = {};
      fields.forEach(function (f) {
        t('作業「' + x.t + '」題目 ' + f.id + ' 的 id 不重複', !!f.id && !assignmentFields[f.id]);
        assignmentFields[f.id] = 1;
        t('作業「' + x.t + '」題目 ' + f.id + ' 的 id 符合後端規格', /^[a-z0-9-]{1,40}$/.test(f.id || ''));
        if (Array.isArray(x.assignment.groups) || x.assignment.kind === 'belief-cycle') {
          t('作業「' + x.t + '」題目 ' + f.id + ' 有填寫引導', !!f.help && !!f.ph);
        } else if (x.assignment.mode === 'list') {
          t('作業「' + x.t + '」題目 ' + f.id + ' 有清單填寫提示',
            typeof x.assignment.listPlaceholder === 'string' && x.assignment.listPlaceholder.length > 0);
        } else {
          var guide = f.formatGuide || x.assignment.formatGuide || [];
          t('作業「' + x.t + '」題目 ' + f.id + ' 有引導與書寫格式',
            !!f.sub && !!f.scope && !!(f.ph || x.assignment.placeholder) && guide.length > 0);
        }
      });
      (x.assignment.groups || []).forEach(function (g) {
        t('作業「' + x.t + '」故事組 ' + g.id + ' 有四個欄位', (g.fields || []).length === 4);
      });
    }
    t('工具「' + x.t + '」有說明', x.lead && x.body);
  });
  var chatAssignment = T.items.filter(function (x) { return x.k === 'chattopics'; })[0];
  t('聊天話題庫已開放填寫', !!chatAssignment && chatAssignment.status === 'active' && !!chatAssignment.assignment);
  t('聊天話題庫有三大主軸', !!chatAssignment && !!chatAssignment.assignment
    && chatAssignment.assignment.sections.length === 3);
  t('聊天話題庫有十二個故事題目', !!chatAssignment && !!chatAssignment.assignment
    && chatAssignment.assignment.groups.length === 12);
  var beliefAssignment = T.items.filter(function (x) { return x.k === 'beliefs'; })[0];
  t('信念系統已開放填寫', !!beliefAssignment && beliefAssignment.status === 'active'
    && beliefAssignment.assignment && beliefAssignment.assignment.kind === 'focus-editor');
  var beliefFields = beliefAssignment && beliefAssignment.assignment && beliefAssignment.assignment.fields || [];
  t('信念系統有三次練習', beliefFields.length === 3);
  t('信念系統同時處理受限信念與新選擇', beliefFields.every(function (field) {
    return String(field.ph || '').indexOf('受限信念') >= 0
      && String(field.ph || '').indexOf('新的發現與選擇') >= 0;
  }));
  var toolKeys = {};
  T.items.forEach(function (x) { toolKeys[x.k] = 1; });
  Object.keys(O.taskToolMap || {}).forEach(function (sheet) {
    t('任務工具對應的工作表「' + sheet + '」存在', O.sheets.some(function (x) { return x.k === sheet; }));
    t('任務工具對應「' + sheet + ' → ' + O.taskToolMap[sheet] + '」存在', !!toolKeys[O.taskToolMap[sheet]]);
  });
  log.push('── 藍圖　' + O.items.length + ' 條 KR　工作表 ' + O.sheets.length
    + '　資源 ' + L.items.length + '（已掛維度 ' + L.items.filter(function (i) { return i.dims; }).length
    + '）　工具 ' + T.items.length);

  /* 5a2. 星等與分級文本的一致性（逐格驗證，1..99） */
  var starBand = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 };
  var mism = [];
  for (var pp = 1; pp <= 99; pp++) {
    if (starBand[E.starOf(pp)] !== E.bandOf(pp)) mism.push(pp);
  }
  t('星等與三級文本不矛盾（1–2★=低、3★=中、4–5★=高）', mism.length === 0);
  t('starPos 單調遞增', (function () {
    for (var q = 2; q <= 99; q++) if (E.starPos(q) < E.starPos(q - 1)) return false;
    return true;
  })());
  t('starPos 的整數交界對齊星等邊界', (function () {
    return E.starEdge.every(function (edge, i) { return Math.abs(E.starPos(edge) - (i + 1)) < 0.001; });
  })());
  t('每一級星等都有代表值', E.starMid.length === 5 && E.starMid.every(function (v, i) {
    return E.starOf(v) === i + 1;
  }));
  log.push('── 星等　' + [1, 2, 3, 4, 5].map(function (n) {
    var lo = n === 1 ? 1 : E.starEdge[n - 2], hi = n === 5 ? 99 : E.starEdge[n - 1] - 1;
    return n + '★ ' + lo + '–' + hi;
  }).join('　'));

  /* 5b. 引言（quoteFor）——2026-09-01 移除。
     那個功能是報告頁「03 逐條解讀」裡「你自己寫下的」那一塊，整節已經拿掉；
     新題庫也沒有任何 quoteFor。檢查一個不存在的功能只會讓 selftest 永遠紅。
     dimensions.js 的 quoteNote 欄位還留著（沒有畫面在用），要復原就把這段接回去。 */

  /* 5c. 教練署名 */
  ['name', 'title', 'note'].forEach(function (f) {
    t('coach.' + f + ' 非空', typeof CO[f] === 'string' && CO[f].length > 0);
  });

  /* 5d. 成長紀錄（三條時間帶） */
  var KINDS = { call: 1, social: 1, date: 1 };
  var evIds = {}, byKind = { call: 0, social: 0, date: 0 }, noOutcome = [];

  t('成長紀錄的週數為 12', G.weeks === 12);
  /* 日期：事件的 x 位置是用 d 算的，w 只是給既有程式用的衍生值。
     兩個都存就有走鐘的風險 —— 在這裡交叉比對，不一致直接擋。 */
  var DAYS = G.weeks * 7;
  t('有課程起點 start（YYYY-MM-DD）', /^\d{4}-\d{2}-\d{2}$/.test(G.start || ''));
  var st = Date.parse(G.start + 'T00:00:00Z');
  t('起點是星期一', new Date(st).getUTCDay() === 1);
  var dayIdx = function (iso) { return Math.round((Date.parse(iso + 'T00:00:00Z') - st) / 86400000); };
  var laneDay = {};
  t('教練評分已取消（不應有 rating 事件）', !G.events.some(function (e) { return e.kind === 'rating'; }));
  t('紙雕標記宣告已移除', !G.art);
  /* 使用者：「沒有成就」—— 每一筆都是一樣的紀錄，不分等級 */
  t('成就的概念已移除（不應有 milestone 欄位）',
    !G.events.some(function (e) { return 'milestone' in e || 'msBy' in e; }));

  G.events.forEach(function (e) {
    t('事件 ' + e.id + ' 的 id 不重複', !evIds[e.id]); evIds[e.id] = 1;
    t('事件 ' + e.id + ' 的週次在 1..12', e.w >= 1 && e.w <= G.weeks);
    t('事件 ' + e.id + ' 的類型 ' + e.kind + ' 合法', !!KINDS[e.kind]);
    t('事件 ' + e.id + ' 的記錄者合法', e.by === 'coach' || e.by === 'student');
    t('事件 ' + e.id + ' 有標題', typeof e.t === 'string' && e.t.length > 0);
    /* lv 是電平段段數的唯一來源（1 差／2 好／3 優），缺了圖就畫不出段 */
    t('事件 ' + e.id + ' 的狀況 lv 是 1..3', e.lv === 1 || e.lv === 2 || e.lv === 3);
    t('事件 ' + e.id + ' 有日期 d', /^\d{4}-\d{2}-\d{2}$/.test(e.d || ''));
    if (e.d) {
      var di = dayIdx(e.d);
      t('事件 ' + e.id + ' 的日期在 12 週內', di >= 0 && di < DAYS);
      t('事件 ' + e.id + ' 的日期推出的週次等於 w', Math.floor(di / 7) + 1 === e.w);
      var lk = e.kind + '@' + di;
      t('同一軌同一天沒有兩筆（' + e.id + '）', !laneDay[lk]); laneDay[lk] = 1;
    }
    /* 「過程也以成果呈現」—— 三種事件都必須寫得出成果 */
    if (!e.outcome) noOutcome.push(e.id);
    byKind[e.kind]++;
  });

  /* 三軌的節奏：只確認範例有通話記錄；不把通話頻率寫成產品規則。 */
  t('範例有通話記錄', byKind.call > 0);
  var firstSocial = Math.min.apply(null, G.events.filter(function (e) { return e.kind === 'social'; }).map(function (e) { return e.w; }));
  var firstDate = Math.min.apply(null, G.events.filter(function (e) { return e.kind === 'date'; }).map(function (e) { return e.w; }));
  t('社交在第 ' + firstSocial + ' 週才出現（不是第 1 週）', firstSocial > 1);
  t('約會在第 ' + firstDate + ' 週才出現，且晚於社交', firstDate > firstSocial);
  /* 三個程度都要用到，否則起伏形同虛設 */
  [1, 2, 3].forEach(function (v) {
    t('狀況 ' + v + ' 至少用到一次', G.events.some(function (e) { return e.lv === v; }));
  });

  log.push('── 成長　' + G.events.length + ' 筆事件　通話記錄 ' + byKind.call + '／社交 ' + byKind.social
    + '／約會 ' + byKind.date);
  /* 同一軌相鄰兩筆至少隔 2 天 —— 一天只有 span/84 寬，太近段堆會疊在一起。
     （第九版之後重疊不會弄壞圖形了，但資料仍然該保持乾淨） */
  ['call', 'social', 'date'].forEach(function (k) {
    var ds = G.events.filter(function (e) { return e.kind === k && e.d; })
      .map(function (e) { return dayIdx(e.d); }).sort(function (a, b) { return a - b; });
    var min = 99;
    for (var i = 1; i < ds.length; i++) min = Math.min(min, ds[i] - ds[i - 1]);
    t(k + ' 軌相鄰兩筆至少隔 2 天（實際 ' + min + '）', min >= 2);
  });

  log.push('　　狀況分佈　差 ' + G.events.filter(function (e) { return e.lv === 1; }).length
    + '／好 ' + G.events.filter(function (e) { return e.lv === 2; }).length
    + '／優 ' + G.events.filter(function (e) { return e.lv === 3; }).length
    + '（電平段的段數就是這個值）');
  log.push('　　期間 ' + G.start + ' 起 ' + DAYS + ' 天（事件按實際日期定位，軸線只標 12 週）');
  log.push('　　首次社交 第 ' + firstSocial + ' 週　首次約會 第 ' + firstDate + ' 週'
    + '（三軌的密度差就是診斷）');

  /* 6. 範例學員（拍影片用的那一組，必須完整而且要命中交叉規則） */
  var sm = window.UC_SAMPLE(), sr = E.score(sm.answers);
  t('範例學員答完所有計分題', sr.complete);
  t('範例學員有名字', !!sm.name);
  t('範例學員的教練報告已完成', !!(sm.coachReport && sm.coachReport.complete));
  t('範例學員的五維說明已填寫', D.dims.every(function (d) {
    return sm.coachReport.notes && typeof sm.coachReport.notes[d.k] === 'string'
      && sm.coachReport.notes[d.k].trim();
  }));
  t('範例學員的教練信已填寫', !!(sm.coachReport.letter && sm.coachReport.letter.trim()));
  var hits = D.crosses.filter(function (c) {
    return (c.hi || []).every(function (k) { return sr.band[k] === 2; })
        && (c.lo || []).every(function (k) { return sr.band[k] === 0; });
  });
  t('範例學員至少命中 1 條交叉規則', hits.length >= 1);
  Object.keys(D.lenses).forEach(function (qid) {
    if (qid === 'note') return;
    t('範例學員填了透鏡題 ' + qid, !!sm.answers[qid]);
  });
  log.push('── 範例學員　' + sm.name);
  log.push('  ' + D.dims.map(function (d) {
    return d.label + ' ' + sr.show[d.k] + '(' + ['低', '中', '高'][sr.band[d.k]] + ')';
  }).join('　'));
  log.push('  命中規則　' + (hits.map(function (c) { return c.title; }).join(' ／ ') || '（無）'));

  /* 7. 待審提醒（不算失敗，但一定要看得到） */
  var pend = [];
  [['questions', Q], ['dimensions', D], ['okr', O], ['library', L], ['tools', T],
   ['coach', CO], ['growth', G]]
    .forEach(function (p) { if (p[1].review === false) pend.push(p[0]); });
  var noHelp = Q.items.filter(function (q) { return q.helpText && !q.helpUrl; }).map(function (q) { return q.id; });
  var noSrc = L.items.filter(function (i) { return !i.src; }).length;

  /* 選項長度階梯。STYLE.md 標了「值得加自動檢查」—— 加在這裡。
     ⚠️ 判準不是「極差多少字」，是**「最高分的選項是不是同時最長」的比例**。
     四選一的話亂寫應該落在 25% 附近；越接近 100% 就越等於
     「不用讀內容，挑最長的就得分」。目前是 21/22。
     不列為失敗（現在全站都是這樣，列失敗會讓 selftest 永遠紅），但一定要看得到。 */
  var ladder = (function () {
    var ch = Q.items.filter(function (q) { return q.type === 'choice'; });
    var bad = [], diff = 0;
    ch.forEach(function (q) {
      var rows = q.o.map(function (o) {
        var d = 0; for (var k in (o.d || {})) d += o.d[k];
        return { len: Array.from(o.t).length, d: d };
      });
      var lens = rows.map(function (r) { return r.len; });
      diff += Math.max.apply(null, lens) - Math.min.apply(null, lens);
      var best = rows.reduce(function (a, b) { return b.d > a.d ? b : a; });
      var longest = rows.reduce(function (a, b) { return b.len > a.len ? b : a; });
      if (best === longest) bad.push(q.id);
    });
    return { n: ch.length, bad: bad, avg: (diff / (ch.length || 1)).toFixed(1) };
  }());
  /* O（Objective）＝ item.sub。層級是 維度 → O → KR。
     原表沒給 O 的條目**不自己編名字**，在這裡報出來等教練補。 */
  var noObj = O.items.filter(function (i) { return !i.sub; }).map(function (i) { return i.id; });
  var objCount = (function () {
    var seen = {}, n = 0;
    O.items.forEach(function (i) { if (i.sub && !seen[i.sub]) { seen[i.sub] = 1; n++; } });
    return n;
  }());

  var out = 'UC Cloud Coach selftest　' + (ok ? 'PASS' : 'FAIL')
    + '\n\n' + log.join('\n')
    + (fails.length ? '\n\n── 失敗 ' + fails.length + ' 項\n  ' + fails.join('\n  ') : '')
    + '\n\n── 待補（不算失敗）'
    + '\n  文案未經教練審閱：' + (pend.join(', ') || '無')
    + '\n  缺外部測驗連結（helpUrl）：' + (noHelp.join(', ') || '無')
    + '\n  資源缺實際檔案／連結：' + noSrc + ' / ' + L.items.length + ' 筆'
    + '\n  目標 O 分組：' + objCount + ' 個 O ／ ' + O.items.length + ' 條 KR'
    + '\n  缺目標 O（原表未分組）：' + (noObj.join(', ') || '無')
    + '\n  選項長度階梯：最高分選項同時最長 ' + ladder.bad.length + ' / ' + ladder.n
    + '（亂寫應接近 25%，越高越等於「挑最長的就得分」）　平均極差 ' + ladder.avg + ' 字'
    + (ladder.bad.length ? '\n    ' + ladder.bad.join(', ') : '')
    + '\n  事件缺成果（outcome）：' + (noOutcome.join(', ') || '無')
    + '\n  紙雕標記檔案：見 coach_portal/ASSETS.md（缺圖時畫面會退回 SVG 形狀，不會破）';

  if (fails.length) console.error(fails.join('\n'));
  console.log(out);
  document.body.innerHTML = '<pre style="margin:0;padding:24px;font:13px/1.75 ui-monospace,monospace;'
    + 'white-space:pre-wrap;color:' + (ok ? '#E8A898' : '#ff8a6b') + ';background:#131B2E;min-height:100vh">'
    + out.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; })
    + '</pre>';
  /* #selftest 把整個 body 換掉了，所以之後改 hash 不會重新渲染 ——
     監聽一次 hashchange 直接整頁重載，離開 selftest 就回到正常畫面。 */
  window.addEventListener('hashchange', function () { location.reload(); }, { once: true });
  return ok;
};
