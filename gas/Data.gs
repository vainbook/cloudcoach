/* ═══════════════════════════════════════════════════════════════
   資料層：課程藍圖（共用）＋ 三張既有的學員分頁

   ⚠️ 這個檔案**不自己開試算表**。所有存取一律經過 Code.gs 的 sheet_()，
   那裡有「只准碰高級雲端教練後台」那三道鎖（使用者的硬性要求）。

   ── 為什麼寫進既有分頁，而不是自己開新的 ──────────────
   「學員填寫／教練填寫／任務狀態」在骨架裡本來就存在，而且**表頭在第 5 列**
   （第 1–4 列是標題與說明）。第一版把空白的第 1 列當表頭，於是把新欄位
   接到 J 欄、資料塞到第 124 列 —— 兩套結構疊在同一張表上，而且完全沒報錯。
   那是無聲的資料錯亂，正是最該避免的一種。

   現在一律寫進**原本那幾欄**：
     學員填寫  entry_id｜student_id｜module_id｜field_id｜欄位名稱｜儲存值｜顯示文字｜已填｜更新時間
     教練填寫  entry_id｜student_id｜module_id｜field_id｜欄位名稱｜教練內容｜更新時間　(＋儲存值)
     任務狀態  state_id｜student_id｜dimension_key｜kr_id｜任務｜當前任務｜已完成｜已隱藏｜…　(＋加入書本｜書本重點)

   括號裡那幾欄是新加的，補在**該分頁最右邊**，不重排既有欄位。

   ── 儲存值 vs 顯示文字 ──────────────────────────
   儲存值   JSON 字串，機器用。直接存原值的話 Sheet 會把 "01" 變成 1。
   顯示文字 給人看的。單選存選項文字、複選用「、」串起來、階梯題翻成那一級的敘述。
            **由前端帶上來，不可信任** —— 任何判斷都讀儲存值，不讀這一欄。
   ═══════════════════════════════════════════════════════════════ */

var BLUEPRINT_SHEET = '藍圖內容';

/* 人的主檔。姓名以學員在評測 B01 填的為準，這張表跟著更新。 */
var STUDENT_SHEET = '學員';

/* 日常只要編輯「目標 O、KR、教材、作業」四欄；kr_id 不可修改 —— 它是永久的鍵，
   學員的任務狀態全部掛在它上面，改了等於把既有紀錄全部變成孤兒。 */
var BLUEPRINT_COLS = ['kr_id', '能力', '目標 O', 'KR', '教材', '作業',
                      '排序', '啟用', '次數', '短標', '教練備註'];

/* 跟其他後台分頁一樣：第 2 列標題、第 3 列說明、第 5 列表頭。 */
var BLUEPRINT_HEADER_ROW = 5;
var BLUEPRINT_NOTES = {
  kr_id: '每條 KR 的永久識別碼。必填、不可重複；新增可用 V-10、C-07 這類格式。已上線的 id 不要改。',
  '能力': '必填。只能填：人格魅力、情緒價值、形象魅力、生活圈、調情升溫。',
  '目標 O': '這條 KR 服務的目標（Objective）。同一能力下文字完全相同的 O 會自動分在同一組。',
  KR: '必填。學員在藍圖上看到的具體任務。',
  '教材': '可選。與任務相關的課程、文章或教材名稱，目前作為文字顯示。',
  '作業': '可選。填入已建立的作業名稱，例如：＃生活藍圖。有程式對應時，「執行任務」會開啟該工具；否則改為聯絡教練。',
  '排序': '必填數字。數字越小越前面；建議每條間隔 10，方便之後插入新任務。',
  '啟用': 'TRUE ＝網站可顯示；FALSE ＝暫時不顯示。',
  '次數': '可選。需要重複完成的目標次數；單次作業可留空。',
  '短標': '可選。畫面空間較小時顯示的簡短名稱。',
  '教練備註': '可選。教練查看任務時的補充說明，不是學員的作答欄位。'
};

/* ═══ 課程連結 ═══════════════════════════════════════
   使用者 2026-09-17：「目前有一些課程連結都沒有實際連動，我需要插入超連結。
   把設定做在 sheet 上，目前是 google drive 連結，但不用在這個網頁中瀏覽，
   就讓他轉跳出去。」

   ⚠️ **課程代號是永久的鍵**（分類-編號，例如 req-01）。改了等於把你貼好的
   連結變成孤兒 —— 跟 kr_id 同一個道理。日常只要編輯「連結」那一欄。
   跟藍圖一樣是全體共用、幾乎不變，所以同樣進快取。 */
/* ⚠️ 藍圖 1004 列、課程連結 31 列，都是**全體共用、幾乎不變**的資料。
   原本 900 秒，實測一旦過期就是 讀藍圖 1155ms ＋ 讀連結 290ms 的尖刺，
   而一天登入一次的學員每次都會撞到。拉到 CacheService 上限的 6 小時，
   改完內容就跑選單的「清除快取」—— 那個選單會連帳號綁定一起清。 */
var CACHE_TTL = 21600;

var LINKS_SHEET = '課程連結';
var LINKS_HEADER_ROW = 5;
var LINKS_COLS = ['課程代號', '分類', '編號', '名稱', '連結'];
var LINKS_NOTES = {
  '課程代號': '永久識別碼，網站靠它對應到課程。**不要修改**，改了那一列的連結就失效。',
  '分類': '必修課程／選修課程／電子書與書單。只是給人看的，網站不讀這一欄。',
  '編號': '同上，給人看的。',
  '名稱': '同上，給人看的。改課程名稱要改 site/data/library.js，不是這裡。',
  '連結': '**你要填的就是這一欄。** 貼 Google Drive 或任何網址，學員點課程卡就會開新分頁過去。留空的話點下去會顯示「內容待補」。'
};

/* 骨架分頁的表頭在第 5 列，不是第 1 列。 */
var SKEL_HEADER_ROW = 5;

var SKEL = {
  assessment: { sheet: '學員填寫', prefix: 'ANS',
                need: ['entry_id', 'student_id', 'module_id', 'field_id', '欄位名稱',
                       '儲存值', '顯示文字', '已填', '更新時間'] },
  report:     { sheet: '教練填寫', prefix: 'COACH',
                need: ['entry_id', 'student_id', 'module_id', 'field_id', '欄位名稱',
                       '教練內容', '更新時間', '儲存值'] },
  task:       { sheet: '任務狀態', prefix: 'TASK',
                need: ['state_id', 'student_id', 'dimension_key', 'kr_id', '任務',
                       '當前任務', '已完成', '已隱藏', '更新時間',
                       '加入書本', '書本重點'] },
  /* 成長紀錄跟前三張不一樣：一列是**一整筆事件**，不是一個欄位。
     所以它不走 stateSave_，另外有 growthSave_／growthLoad_。 */
  growth:     { sheet: '成長紀錄', prefix: 'EVT',
                need: ['event_id', 'student_id', 'author_role', 'kind', '日期', '週次',
                       '標題', '狀況', '成果', '補充', '更新時間'] },
  /* 一位學員的一份作業一列；不為每個題目增加試算表欄位。 */
  assignment: { sheet: '課程工具', prefix: 'SUB',
                need: ['record_id', 'student_id', 'tool_id', 'table_id', 'row_id', 'field_id',
                       '學員內容', '更新時間', '狀態', '版本'] }
};

/* 任務狀態：我的 field → 那張表的欄名。白名單，不是黑名單。 */
var TASK_COL = { current: '當前任務', done: '已完成', hidden: '已隱藏',
                 picked: '加入書本', key: '書本重點' };
var TASK_FIELDS = ['current', 'done', 'hidden', 'picked', 'key'];

/* 教練報告允許的 field。 */
var REPORT_FIELDS = ['letter', 'complete'];
(function () {
  ['values', 'emo', 'image', 'circle', 'flirt'].forEach(function (k) {
    REPORT_FIELDS.push('adjust.' + k, 'score.' + k, 'note.' + k);
  });
})();

/* scope → 分頁名。前端只送 scope，送不進來的名字就進不了。 */
var STATE_SHEETS = {
  assessment: SKEL.assessment.sheet,
  report:     SKEL.report.sheet,
  task:       SKEL.task.sheet,
  growth:     SKEL.growth.sheet,
  assignment: SKEL.assignment.sheet
};

/* ── 分頁 ──────────────────────────────────────────── */

/** 表頭在第 1 列的分頁（目前只有藍圖內容）。缺欄補在最右邊。 */
function ensureSheet_(name, cols) {
  var ss = sheet_();                       /* ← 唯一的開檔入口，別繞過 */
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
    console.log('已建立「' + name + '」分頁');
    return sh;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x || ''); });

  /* ⚠️ **不要接管一張形狀不一樣的既有分頁。** 踩過一次，見檔頭。 */
  var hit = cols.filter(function (c) { return have.indexOf(c) >= 0; }).length;
  if (hit === 0 && sh.getLastRow() > 0) {
    throw new AppError('INTERNAL_ERROR',
      '分頁「' + name + '」已經存在而且結構不同，為了不覆蓋你的資料已中止');
  }
  var missing = cols.filter(function (c) { return have.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    console.log('「' + name + '」補上欄位：' + missing.join('、'));
  }
  return sh;
}

function blueprintMap_(sh) {
  var head = sh.getRange(BLUEPRINT_HEADER_ROW, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var key = String(head[i] || '');
    if (key && !map[key]) map[key] = i + 1;
  }
  return map;
}

/* 就地把舊版第 1 列表頭搬到第 5 列；只插入列，不重建也不覆蓋資料。 */
function migrateBlueprintLayout_(sh) {
  if (String(sh.getRange(1, 1).getValue() || '') !== 'kr_id') return false;
  sh.insertRowsBefore(1, BLUEPRINT_HEADER_ROW - 1);
  console.log('「' + BLUEPRINT_SHEET + '」表頭已從第 1 列移到第 ' + BLUEPRINT_HEADER_ROW + ' 列');
  return true;
}

function blueprintSheet_() {
  var ss = sheet_();
  var sh = ss.getSheetByName(BLUEPRINT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BLUEPRINT_SHEET);
    sh.getRange(BLUEPRINT_HEADER_ROW, 1, 1, BLUEPRINT_COLS.length).setValues([BLUEPRINT_COLS]);
    return sh;
  }
  migrateBlueprintLayout_(sh);
  var map = blueprintMap_(sh);
  var missing = BLUEPRINT_COLS.filter(function (c) { return !map[c]; });
  if (missing.length) {
    sh.getRange(BLUEPRINT_HEADER_ROW, sh.getLastColumn() + 1, 1, missing.length).setValues([missing]);
    console.log('「' + BLUEPRINT_SHEET + '」補上欄位：' + missing.join('、'));
  }
  return sh;
}

/** 骨架分頁：表頭在第 5 列。缺的欄補在最右邊，既有欄位一格不動。 */
function skelSheet_(scope) {
  var def = SKEL[scope];
  if (!def) throw new AppError('INVALID_INPUT', '不認識的資料範圍');
  var sh = sheetByName_(def.sheet);
  if (!sh) throw new AppError('INTERNAL_ERROR', '找不到「' + def.sheet + '」分頁');

  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(SKEL_HEADER_ROW, 1, 1, width).getValues()[0]
    .map(function (x) { return String(x || ''); });
  var missing = def.need.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    /* 補在表頭列的最右邊。⚠️ 用 head.length 不是 getLastColumn() ——
       右邊可能還殘留著上一版誤加的欄位。 */
    sh.getRange(SKEL_HEADER_ROW, head.length + 1, 1, missing.length).setValues([missing]);
    console.log('「' + def.sheet + '」補上欄位：' + missing.join('、'));
  }
  return sh;
}

/* ═══ 一次請求內的讀取快取 ═══════════════════════════
   實測校準（2026-09-13，真實登入）：**每一次試算表呼叫約 110 毫秒**。
   讀藍圖那一段 497ms 只做 4 次呼叫，換算出來就是這個數字 ——
   比原本推估的 10~50ms 高一倍以上。

   所以要砍的是**呼叫次數**，不是資料量（整包回應才 7 KB）。

   原本每個 scope 要六次呼叫，其中只有一次在讀資料：
     getSheetByName → 讀表頭(skelSheet_) → 又讀一次表頭(skelMap_)
     → getLastRow → getLastColumn → 才真的 getRange().getValues()

   getDataRange() 一次就全拿到（表頭和資料都在裡面），配合分頁清單快取，
   一個 scope 從 6 次降到 1 次。 */

var _sheets = {};

/**
 * 取分頁，同一個名字只問一次。
 *
 * ⚠️ **不要用 sheet_().getSheets() 一次撈全部。** 我試過，那是淨損失：
 * 它會把全部 11 張分頁的物件都載進來，實測讓第一個呼叫它的人多付約 470ms，
 * 而我們一次請求其實只用到 5～6 張。成本只是從「讀答案」搬到「查綁定」，
 * 總和還變多了（2026-09-13 兩次實測對照出來的）。
 *
 * 逐個 getSheetByName 反而便宜，而且省下來的是真的省下來。
 */
function sheetByName_(name) {
  if (!_sheets[name]) _sheets[name] = sheet_().getSheetByName(name) || null;
  return _sheets[name];
}

var _skel = {};

/* skelPreload_ 先塞好的原始值。跟 _skel 一樣只活在這一次執行裡。
   ⚠️ 兩個都只給讀用，所以不需要在寫入之後失效 —— 寫走的是 skelSheet_。 */
var _pre = {};

/**
 * 一個 HTTPS 請求抓多張分頁（Sheets 進階服務）。
 *
 * ⚠️ **省的是來回次數，不是資料量。** 2026-09-17 實測：
 * 藍圖內容 11044 格讀 219ms，學員填寫 2178 格讀 241ms —— 五倍資料、一樣的時間。
 * 真正貴的是「每張分頁在這次執行裡第一次被碰到」（380～2072ms），
 * 而正式請求每張表剛好只碰一次，所以每次都在付那筆錢。
 * 分開讀三張 380+334+726 = 1440ms，batchGet 一次 437ms。
 *
 * ⚠️ 只給 assessment／report／task 用。成長紀錄有「日期」欄，
 * batchGet 回的是序號不是 Date 物件，fmtDate_ 認不得 —— 要用得先改那裡。
 * ⚠️ 失敗一律退回逐張讀。登入能不能成功不該取決於這個最佳化。
 */
function skelPreload_(scopes) {
  var want = [];
  for (var i = 0; i < scopes.length; i++) {
    var sc = scopes[i];
    if (!SKEL[sc] || _skel[sc] || _pre[sc]) continue;
    want.push(sc);
  }
  if (want.length < 2) return;                      /* 一張表不值得繞路 */
  try {
    var res = Sheets.Spreadsheets.Values.batchGet(sheet_().getId(), {
      ranges: want.map(function (sc) {
        return "'" + String(SKEL[sc].sheet).replace(/'/g, "''") + "'";
      }),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    var vr = (res && res.valueRanges) || [];
    for (var j = 0; j < want.length; j++) {
      var v = vr[j] && vr[j].values;
      if (v && v.length) _pre[want[j]] = v;
    }
  } catch (e) {
    console.warn('batchGet 失敗，改用逐張讀：' + e);
  }
}

/**
 * 讀路徑的唯一入口：一次 getDataRange 拿到表頭與資料。
 * 回 { sh, map, body, first }。body[0] 在試算表上的列號就是 first。
 * ⚠️ **只給讀用。** 要寫的話還是走 skelSheet_，那裡會補缺的欄位。
 * ⚠️ 走 skelPreload_ 進來的時候 sh 是 null（batchGet 沒有 Sheet 物件）。
 *    目前沒有人讀這個欄位；要用它之前先自己 sheetByName_。
 */
function skelRead_(scope) {
  if (_skel[scope]) return _skel[scope];
  var def = SKEL[scope];
  if (!def) throw new AppError('INVALID_INPUT', '不認識的資料範圍');

  var all = _pre[scope] || null, sh = null;
  if (!all) {
    sh = sheetByName_(def.sheet);
    if (!sh) throw new AppError('INTERNAL_ERROR', '找不到「' + def.sheet + '」分頁');
    all = sh.getDataRange().getValues();            /* ← 這一整段就這一次呼叫 */
  }

  var head = all.length >= SKEL_HEADER_ROW ? all[SKEL_HEADER_ROW - 1] : [];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var k = String(head[i] || '');
    if (k && !map[k]) map[k] = i + 1;
  }
  var body = all.slice(SKEL_HEADER_ROW);
  /* ⚠️ batchGet 會省略每一列尾端的空格，列長會參差不齊。
     不補的話 rowObj_ 取到 undefined，而 String(undefined) 是 "undefined"
     —— 那會變成一個看起來很像資料的字串，無聲地混進比對裡。 */
  if (_pre[scope]) {
    for (var r = 0; r < body.length; r++) {
      if (!body[r]) { body[r] = []; }
      while (body[r].length < head.length) body[r].push('');
    }
  }
  var out = { sh: sh, map: map, body: body, first: SKEL_HEADER_ROW + 1 };
  _skel[scope] = out;
  return out;
}

function skelMap_(sh) {
  var head = sh.getRange(SKEL_HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  for (var i = 0; i < head.length; i++) {
    var k = String(head[i] || '');
    if (k && !m[k]) m[k] = i + 1;
  }
  return m;
}

/* ── 課程藍圖 ───────────────────────────────────────
   全體學員共用一份。個別學員看得到哪幾條，是任務狀態的 已隱藏 在管，
   **不複製整份藍圖**（複製的話你改一次要改 N 份）。 */

/* 藍圖是**全體共用、幾乎不變**的資料，卻每次 student.load 都整份重讀。
   實測那一段 497ms（約 4 次試算表呼叫）。換成快取之後剩下一次快取讀取。
   ⚠️ TTL 只給 15 分鐘 —— 你在試算表上改藍圖之後，最多等一刻鐘就會生效；
   不想等就按選單的「清掉藍圖快取」。
   ⚠️ 快取壞掉或超過 100KB 上限時要能自己退回去重讀，不能讓它擋住登入。 */
function blueprintLoad_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get('bp');
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }

  var out = blueprintLoadRaw_();
  try {
    if (cache) {
      var j = JSON.stringify(out);
      if (j.length < 95000) cache.put('bp', j, CACHE_TTL);   /* 單值上限 100KB */
    }
  } catch (e) {}
  return out;
}

/** 課程代號 → 連結。全體共用、幾乎不變，所以跟藍圖一樣進快取。 */
function linksLoad_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get('links');
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }

  var out = {};
  try {
    var sh = sheetByName_(LINKS_SHEET);
    if (sh) {
      var all = sh.getDataRange().getValues();
      var head = all.length >= LINKS_HEADER_ROW ? all[LINKS_HEADER_ROW - 1] : [];
      var map = {};
      for (var i = 0; i < head.length; i++) {
        var k = String(head[i] || '');
        if (k && !map[k]) map[k] = i + 1;
      }
      if (map['課程代號'] && map['連結']) {
        all.slice(LINKS_HEADER_ROW).forEach(function (row) {
          var id = String(row[map['課程代號'] - 1] || '').trim();
          var url = String(row[map['連結'] - 1] || '').trim();
          /* ⚠️ 只收 http(s)。試算表上可能被貼成純文字備註，
             那種東西丟給 openWindow 沒有意義，還可能變成注入面。 */
          if (id && /^https?:\/\//i.test(url)) out[id] = url;
        });
      }
    }
  } catch (e) { console.warn('讀課程連結失敗（不影響其他資料）：' + e); }

  try { if (cache) cache.put('links', JSON.stringify(out), CACHE_TTL); } catch (e) {}
  return out;
}

/** setup() 用：分頁不存在或空的時候建一次，之後不覆蓋。 */
function seedLinks_() {
  var ss = sheet_();
  var sh = ss.getSheetByName(LINKS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LINKS_SHEET);
    sh.getRange(LINKS_HEADER_ROW, 1, 1, LINKS_COLS.length).setValues([LINKS_COLS]);
  }
  decorateLinks_(sh);
  if (sh.getLastRow() > LINKS_HEADER_ROW) {
    console.log('「' + LINKS_SHEET + '」已經有 ' + (sh.getLastRow() - LINKS_HEADER_ROW)
                + ' 列，不覆蓋（你貼的連結不會被蓋掉）');
    return 0;
  }
  if (typeof LINK_SEED === 'undefined') {
    console.warn('找不到 LINK_SEED（Links.gs 沒推上來？）');
    return 0;
  }
  sh.getRange(LINKS_HEADER_ROW + 1, 1, LINK_SEED.length, LINKS_COLS.length).setValues(LINK_SEED);
  console.log('已灌入 ' + LINK_SEED.length + ' 筆課程，請在「連結」欄貼網址');
  return LINK_SEED.length;
}

/**
 * 把「課程連結」分頁的標籤對回程式裡的課表：缺的列補上，既有列的
 * 分類／編號／名稱更新成最新的。
 *
 * ⚠️ **連結那一欄一格都不動。** 那是教練貼的，程式沒有資格覆蓋。
 * ⚠️ 配對只看**課程代號**。課程重新排序時編號會變、課名也可能改，
 * 但代號是身分，一旦發出去就不再變（見 site/data/library.js 的 id）。
 */
/**
 * 在某一欄套上下拉選單。
 *
 * ⚠️ **允許自由輸入**（setAllowInvalid(true)）。使用者 2026-09-18：
 * 「做成下拉式選單，然後也可以讓我輸入純文字。」
 * 用 requireValueInList 會把沒在清單上的字直接擋掉，那會讓教練沒辦法
 * 臨時寫一個還沒建好的教材名稱 —— 選單是**給選**，不是**限制**。
 * 打錯的代價在網頁上是「那一格沒有傳送鈕」，不是資料壞掉。
 */
function dropdown_(sh, col, list, rows) {
  if (!col || !list || !list.length) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(list, true)      /* true = 顯示下拉箭頭 */
    .setAllowInvalid(true)               /* ⚠️ 不擋自由輸入，只在格子角落給一個提示 */
    .setHelpText('可以從清單選，也可以自己打字。打字的話網頁上不會有「傳送」按鈕。')
    .build();
  sh.getRange(BLUEPRINT_HEADER_ROW + 1, col, rows, 1).setDataValidation(rule);
}

/** 「藍圖內容」的作業與教材兩欄套上下拉。跟著整理選單一起跑。 */
function blueprintDropdowns_(sh) {
  var map = blueprintMap_(sh);
  var rows = Math.max(sh.getMaxRows() - BLUEPRINT_HEADER_ROW, 1);
  dropdown_(sh, map['作業'], typeof TASK_NAMES !== 'undefined' ? TASK_NAMES : [], rows);
  dropdown_(sh, map['教材'], typeof COURSE_NAMES !== 'undefined' ? COURSE_NAMES : [], rows);
}

function syncLinks_() {
  var sh = sheet_().getSheetByName(LINKS_SHEET);
  if (!sh) throw new AppError('INTERNAL_ERROR', '還沒有「' + LINKS_SHEET + '」分頁，先跑 setup()');

  var all = sh.getDataRange().getValues();
  var head = all.length >= LINKS_HEADER_ROW ? all[LINKS_HEADER_ROW - 1] : [];
  var col = {};
  for (var h = 0; h < head.length; h++) if (head[h]) col[String(head[h])] = h;

  var need = ['課程代號', '分類', '編號', '名稱', '連結'];
  for (var n = 0; n < need.length; n++) {
    if (col[need[n]] === undefined) throw new AppError('INTERNAL_ERROR', '「' + LINKS_SHEET + '」缺欄位：' + need[n]);
  }

  var body = all.slice(LINKS_HEADER_ROW);
  var at = {};
  for (var i = 0; i < body.length; i++) {
    var code = String(body[i][col['課程代號']] || '').trim();
    if (code) at[code] = i;
  }

  var updated = 0, added = [];
  for (var k = 0; k < LINK_SEED.length; k++) {
    var row = LINK_SEED[k], code2 = String(row[0]);
    if (at[code2] === undefined) { added.push(row); continue; }
    var r = body[at[code2]], changed = false;
    if (String(r[col['分類']] || '') !== String(row[1])) { r[col['分類']] = row[1]; changed = true; }
    if (String(r[col['編號']] || '') !== String(row[2])) { r[col['編號']] = row[2]; changed = true; }
    if (String(r[col['名稱']] || '') !== String(row[3])) { r[col['名稱']] = row[3]; changed = true; }
    if (changed) updated++;
  }

  if (body.length) {
    sh.getRange(LINKS_HEADER_ROW + 1, 1, body.length, head.length).setValues(body);
  }
  if (added.length) {
    var start = LINKS_HEADER_ROW + 1 + body.length;
    var fill = added.map(function (row) {
      var line = [];
      for (var c = 0; c < head.length; c++) line.push('');
      line[col['課程代號']] = row[0]; line[col['分類']] = row[1];
      line[col['編號']] = row[2];     line[col['名稱']] = row[3];
      return line;
    });
    sh.getRange(start, 1, fill.length, head.length).setValues(fill);
  }

  try { CacheService.getScriptCache().remove('links'); } catch (e) {}
  return { updated: updated, added: added.map(function (r) { return r[0] + ' ' + r[3]; }) };
}

function decorateLinks_(sh) {
  var NAVY = '#131B2E', BEIGE = '#E8E4DC', SALMON = '#E8A898';
  sh.getRange(2, 1).setValue('課程連結')
    .setFontSize(16).setFontWeight('bold').setFontColor(NAVY);
  sh.getRange(3, 1).setValue(
    '學員在「資源與工具」點課程卡時要開啟的網址。你只需要編輯「連結」那一欄，'
    + '貼上 Google Drive 或任何網址即可；留空的話點下去會顯示「內容待補」。'
    + '　⚠️ 課程代號是永久的鍵，改了連結就失效。')
    .setFontSize(10).setFontStyle('italic').setFontColor('#6B7280');
  sh.setFrozenRows(LINKS_HEADER_ROW);
  var w = Math.max(sh.getLastColumn(), LINKS_COLS.length);
  sh.getRange(LINKS_HEADER_ROW, 1, 1, w)
    .setBackground(NAVY).setFontColor(BEIGE).setFontWeight('bold');
  var map = mapAt_(sh, LINKS_HEADER_ROW);
  for (var col in LINKS_NOTES) {
    if (map[col]) sh.getRange(LINKS_HEADER_ROW, map[col]).setNote(LINKS_NOTES[col]);
  }
  /* 你真的要改的那一欄標鮭粉底，其餘是給人看的。 */
  if (map['連結']) {
    sh.getRange(LINKS_HEADER_ROW, map['連結']).setBackground(SALMON).setFontColor(NAVY);
    sh.setColumnWidth(map['連結'], 320);
  }
}

function blueprintLoadRaw_() {
  var sh = blueprintSheet_(), map = blueprintMap_(sh);
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = BLUEPRINT_HEADER_ROW; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    var id = String(r.kr_id || '').trim();
    if (!id) continue;
    if (r['啟用'] === false || r['啟用'] === 'FALSE') continue;
    out.push({
      id: id,
      dimLabel: String(r['能力'] || ''),
      sub: String(r['目標 O'] || ''),
      kr: String(r['KR'] || ''),
      tool: String(r['教材'] || ''),
      sheet: String(r['作業'] || ''),
      order: Number(r['排序']) || 0,
      n: r['次數'] === '' || r['次數'] == null ? null : Number(r['次數']),
      short: String(r['短標'] || ''),
      note: String(r['教練備註'] || '')
    });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out;
}

/** kr_id → { 能力, KR }，寫任務狀態時要填 dimension_key 與 任務 兩欄。 */
var _krIndex = null;
function krIndex_() {
  if (_krIndex) return _krIndex;
  _krIndex = {};
  blueprintLoad_().forEach(function (x) { _krIndex[x.id] = x; });
  return _krIndex;
}

/** setup() 用：分頁空的時候灌一次種子，之後永遠不覆蓋。 */
function seedBlueprint_() {
  var sh = blueprintSheet_();
  if (sh.getLastRow() > BLUEPRINT_HEADER_ROW) {
    console.log('「' + BLUEPRINT_SHEET + '」已經有 ' + (sh.getLastRow() - BLUEPRINT_HEADER_ROW) + ' 列，不覆蓋');
    return 0;
  }
  if (typeof BLUEPRINT_SEED === 'undefined') {
    console.warn('找不到 BLUEPRINT_SEED（Blueprint.gs 沒推上來？），跳過灌種子');
    return 0;
  }
  var map = blueprintMap_(sh), width = sh.getLastColumn();
  var rows = BLUEPRINT_SEED.map(function (seed) {
    var row = [];
    for (var j = 0; j < width; j++) row[j] = '';
    BLUEPRINT_COLS.forEach(function (c, i) { if (map[c]) row[map[c] - 1] = seed[i]; });
    return row;
  });
  sh.getRange(BLUEPRINT_HEADER_ROW + 1, 1, rows.length, width).setValues(rows);
  console.log('已灌入 ' + rows.length + ' 條 KR');
  return rows.length;
}

/* ── 值的編碼 ──────────────────────────────────────── */

function encodeValue_(v) { return JSON.stringify(v === undefined ? null : v); }

function decodeValue_(s) {
  if (s === '' || s == null) return null;
  if (typeof s === 'boolean' || typeof s === 'number') return s;   /* Sheet 已經給了型別 */
  try { return JSON.parse(String(s)); } catch (e) { return String(s); }
}

function isBlank_(v) {
  return v == null || v === '' || (Object.prototype.toString.call(v) === '[object Array]' && !v.length);
}

/* ── 讀 ────────────────────────────────────────────── */

/** 讀某位學員在某個 scope 的所有格子 → { item_id: { field: value } } */
function stateLoad_(scope, studentId) {
  var r0 = skelRead_(scope);
  var map = r0.map, rows = r0.body;
  if (!rows.length) return {};
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.student_id) !== String(studentId)) continue;

    if (scope === 'task') {
      var kr = String(r.kr_id || '');
      if (!kr) continue;
      var box = out[kr] = out[kr] || {};
      ['done', 'hidden', 'picked', 'key'].forEach(function (f) {
        if (r[TASK_COL[f]] === true || r[TASK_COL[f]] === 'TRUE') box[f] = true;
      });
      /* 當前任務在表上是「這一列是不是」，在前端是「這個維度指向哪一條」。 */
      if (r[TASK_COL.current] === true || r[TASK_COL.current] === 'TRUE') {
        var dim = String(r.dimension_key || '');
        if (dim) (out[dim] = out[dim] || {}).current = kr;
      }
      continue;
    }

    if (scope === 'assignment') {
      var aid = String(r.tool_id || '');
      if (!aid) continue;
      try {
        var submission = JSON.parse(String(r['學員內容'] || ''));
        if (submission && typeof submission === 'object' && !Array.isArray(submission)) out[aid] = submission;
      } catch (e) {}
      continue;
    }

    var fid = String(r.field_id || '');
    if (!fid) continue;
    var val = decodeValue_(r['儲存值']);
    /* 讀的時候把前綴剝掉，裸 id 與前綴版都會落到同一個 key。 */
    if (scope === 'assessment') {
      out[fid.replace(/^assessment\./, '')] = { answer: val };
    } else {
      (out.report = out.report || {})[fid.replace(/^report\./, '')] = val;
    }
  }
  return out;
}

/* ── 寫 ────────────────────────────────────────────── */

/**
 * 寫一格。**單格 patch，不是整份覆寫** ——
 * 整份覆寫的話教練跟學員同時操作會互相吃掉（BACKEND-WORKFLOW.md §4 明文禁止）。
 * 回傳更新時間（字串）。
 */
function stateSave_(scope, studentId, itemId, field, label, value, requestId, display) {
  try {
    if (scope === 'task') return taskSave_(studentId, itemId, field, value);
    if (scope === 'growth') return growthSave_(studentId, itemId, value);
    if (scope === 'assignment') return assignmentSave_(studentId, itemId, value);
    return entrySave_(scope, studentId, itemId, field, label, value, requestId, display);
  } finally {
    /* ⚠️ **寫完一定要把讀取快取丟掉。** `_skel` 只在第一次讀的時候填，
       寫入走的是另一條路（skelSheet_），兩邊不通。
       不丟的話同一次執行裡「寫完再讀」會拿到寫之前的資料 —— 無聲的錯誤。
       目前正式流程剛好沒有寫完接著讀，所以一直沒爆；
       2026-09-17 是 selftest 的寫入檢查把它抓出來的（那支就是寫完馬上讀）。 */
    skelDrop_(scope);
  }
}

/* 丟掉某個 scope 這一次執行的讀取快取。失敗的寫入也要丟 —— 寧可多讀一次。 */
function skelDrop_(scope) {
  if (_skel[scope]) delete _skel[scope];
  if (_pre[scope]) delete _pre[scope];
}

/* 通用作業：整份 submission JSON 寫進一格，用 student_id + tool_id upsert。 */
function assignmentSave_(studentId, assignmentId, value) {
  var submission;
  try { submission = JSON.parse(String(value || '')); }
  catch (e) { throw new AppError('INVALID_INPUT', '作業內容格式不正確'); }
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    throw new AppError('INVALID_INPUT', '作業內容格式不正確');
  }
  var sh = skelSheet_('assignment'), map = skelMap_(sh);
  var line = findRow_(sh, map, function (r) {
    return String(r.student_id) === String(studentId) && String(r.tool_id) === String(assignmentId);
  });
  var now = now_();
  writeRow_(sh, map, line, {
    record_id: 'SUB-' + studentId + '-' + assignmentId,
    student_id: studentId,
    tool_id: assignmentId,
    table_id: 'assignment',
    row_id: 'v' + Math.max(1, Math.round(Number(submission.version) || 1)),
    field_id: 'assignment.' + assignmentId,
    '學員內容': JSON.stringify(submission),
    '狀態': String(submission.status || 'draft'),
    '版本': Math.max(1, Math.round(Number(submission.version) || 1)),
    '更新時間': now
  });
  return now;
}

/* ── 成長紀錄 ───────────────────────────────────────
   一列 = 一筆事件（通話記錄／外出社交／實際約會）。
   ⚠️ 這張表**教練與學員共用**，author_role 決定是誰寫的 —— 不要用它做權限判斷，
   權限是 access_scope 在管；author_role 只是給人看「這筆是誰記的」。 */

function growthSave_(studentId, eventId, ev) {
  var sh = skelSheet_('growth'), map = skelMap_(sh);
  var now = now_();
  if (!ev || typeof ev !== 'object') throw new AppError('INVALID_INPUT', '成長紀錄的內容不正確');

  var line = findRow_(sh, map, function (r) {
    return String(r.student_id) === String(studentId) && String(r.event_id) === String(eventId);
  });
  var role = ev.by === 'coach' ? 'coach' : 'student';
  var kind = ['call', 'social', 'date'].indexOf(String(ev.kind)) >= 0 ? String(ev.kind) : 'call';
  var lv = Math.max(1, Math.min(3, Math.round(Number(ev.lv) || 2)));

  writeRow_(sh, map, line, {
    event_id: String(eventId), student_id: studentId,
    author_role: role, kind: kind,
    '日期': String(ev.d || ''), '週次': Number(ev.w) || 0,
    '標題': String(ev.t || '').slice(0, 120), '狀況': lv,
    '成果': String(ev.outcome || '').slice(0, 4000),
    '補充': String(ev.note || '').slice(0, 4000),
    '更新時間': now
  });
  return now;
}

function growthLoad_(studentId) {
  var r0 = skelRead_('growth');
  var map = r0.map, rows = r0.body;
  if (!rows.length) return [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.student_id) !== String(studentId)) continue;
    var id = String(r.event_id || '');
    if (!id) continue;
    out.push({
      id: id, by: String(r.author_role || 'student'), kind: String(r.kind || 'call'),
      d: fmtDate_(r['日期']), w: Number(r['週次']) || 0,
      t: String(r['標題'] || ''), lv: Number(r['狀況']) || 2,
      outcome: String(r['成果'] || '') || undefined,
      note: String(r['補充'] || '') || undefined
    });
  }
  return out;
}

/* Sheet 會把看起來像日期的字串轉成 Date 物件，前端要的是 YYYY-MM-DD。 */
function fmtDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(v);
}

/* 學員填寫／教練填寫：一列 = 一個 field_id。 */
function entrySave_(scope, studentId, itemId, field, label, value, requestId, display) {
  var def = SKEL[scope];
  var sh = skelSheet_(scope), map = skelMap_(sh);
  /* ⚠️ **同一個欄位有兩種寫法。** 骨架裡示範學員的列寫的是裸 id（`B01`），
     而「欄位定義」登記的是加了模組前綴的（`assessment.B01`）。
     找列的時候兩種都要認 —— 只認一種的話，一開示範學員去填，
     會在既有那一列旁邊長出重複的第二列（而且兩列都有值，看不出誰是真的）。
     新列一律寫前綴版；既有列不改它的 field_id。 */
  var fid = scope === 'assessment' ? 'assessment.' + itemId : 'report.' + field;
  var bare = scope === 'assessment' ? String(itemId) : String(field);
  var hit = null;
  var line = findRow_(sh, map, function (r) {
    if (String(r.student_id) !== String(studentId)) return false;
    var got = String(r.field_id || '');
    if (got !== fid && got !== bare) return false;
    hit = got;
    return true;
  });
  if (line && hit) fid = hit;          /* 既有列保留它原本的寫法 */
  var now = now_();
  var text = display != null && display !== '' ? String(display) : plain_(value);

  var set = {
    entry_id: def.prefix + '-' + studentId + '-' + (scope === 'assessment' ? itemId : field),
    student_id: studentId,
    module_id: scope,
    field_id: fid,
    '欄位名稱': label || '',
    '儲存值': encodeValue_(value),
    '更新時間': now
  };
  if (scope === 'assessment') {
    set['顯示文字'] = text;
    set['已填'] = isBlank_(value) ? 0 : 1;
  } else {
    set['教練內容'] = text;
  }
  writeRow_(sh, map, line, set);

  /* ⚠️ **姓名以學員在評測 B01 填的為準**（使用者 2026-09-13 定調）。
     所以一存 B01 就順手同步到「帳號綁定」與「學員」兩張表 ——
     不然教練在那兩張表只看得到 id 跟 LINE 暱稱，對不上人。
     反過來不成立：那兩張表被手動改了**不會**回寫評測答案。 */
  if (scope === 'assessment' && String(itemId) === 'B01') {
    syncStudentName_(studentId, typeof value === 'string' ? value : '');
  }
  return now;
}

/** B01 的稱呼 → 帳號綁定.student_name ＋ 學員.學員名稱。 */
function syncStudentName_(studentId, name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return;
  try {
    var bsh = bindingSheet_(), bb = bindingBody_(bsh);
    for (var i = 0; i < bb.rows.length; i++) {
      var r = rowObj_(bb.rows[i], bb.map);
      if (String(r.student_id) !== String(studentId)) continue;
      if (String(r.student_name || '') === name) continue;
      setCell_(bsh, bb.first + i, 'student_name', name);
    }
    upsertStudentRow_(studentId, name);
  } catch (e) {
    /* 同步姓名失敗不該擋住存檔 —— 答案本身已經寫進去了。 */
    console.warn('同步姓名失敗 ' + studentId + '：' + e);
  }
}

/** 「學員」分頁缺這個人就補一列，有就只更新名字。 */
function upsertStudentRow_(studentId, name) {
  var sh = sheet_().getSheetByName(STUDENT_SHEET);
  if (!sh) return;
  var map = skelMap_(sh);
  if (!map.student_id || !map['學員名稱']) return;
  var line = findRow_(sh, map, function (r) {
    return String(r.student_id) === String(studentId);
  });
  if (line) {
    if (String(sh.getRange(line, map['學員名稱']).getValue() || '') !== name) {
      sh.getRange(line, map['學員名稱']).setValue(name);
      if (map['最後更新']) sh.getRange(line, map['最後更新']).setValue(now_());
    }
    return;
  }
  writeRow_(sh, map, 0, {
    student_id: studentId, '學員名稱': name,
    '開始日期': now_(), '狀態': '啟用', '最後更新': now_()
  });
  console.log('「' + STUDENT_SHEET + '」新增一列：' + studentId + ' ' + name);
}

/* 任務狀態：一列 = 一條 KR。 */
function taskSave_(studentId, itemId, field, value) {
  var col = TASK_COL[field];
  if (!col) throw new AppError('INVALID_INPUT', '不認識的任務欄位');
  var sh = skelSheet_('task'), map = skelMap_(sh);
  var now = now_();

  /* current 特別處理：前端送的 itemId 是**維度**，value 才是 kr_id。
     同一個維度只能有一條當前任務，所以要先把同維度的其他列關掉。 */
  if (field === 'current') {
    var dim = String(itemId);
    clearDimCurrent_(sh, map, studentId, dim, now);
    if (isBlank_(value)) return now;
    touchTaskRow_(sh, map, studentId, String(value), col, true, now);
    return now;
  }

  touchTaskRow_(sh, map, studentId, String(itemId), col, value === true, now);
  return now;
}

function clearDimCurrent_(sh, map, studentId, dim, now) {
  var last = sh.getLastRow();
  if (last <= SKEL_HEADER_ROW) return;
  var rows = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW,
                         sh.getLastColumn()).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.student_id) !== String(studentId)) continue;
    if (String(r.dimension_key) !== dim) continue;
    if (r[TASK_COL.current] !== true && r[TASK_COL.current] !== 'TRUE') continue;
    var line = SKEL_HEADER_ROW + 1 + i;
    sh.getRange(line, map[TASK_COL.current]).setValue(false);
    sh.getRange(line, map['更新時間']).setValue(now);
  }
}

function touchTaskRow_(sh, map, studentId, krId, col, on, now) {
  var line = findRow_(sh, map, function (r) {
    return String(r.student_id) === String(studentId) && String(r.kr_id) === krId;
  });
  var kr = krIndex_()[krId];
  writeRow_(sh, map, line, (function () {
    var set = { state_id: 'TASK-' + studentId + '-' + krId, student_id: studentId,
                kr_id: krId, '更新時間': now };
    /* 新列才補維度與任務名稱；既有列不覆蓋（你可能改過藍圖文字）。 */
    if (!line && kr) {
      set.dimension_key = dimKeyOf_(kr.dimLabel);
      set['任務'] = kr.kr;
    }
    set[col] = on;
    return set;
  })());
}

/* 能力的中文名 → 維度 key。藍圖表上填的是中文，程式裡用的是 key。 */
var DIM_KEY = { '人格魅力': 'values', '情緒價值': 'emo', '形象魅力': 'image',
                '生活圈': 'circle', '調情升溫': 'flirt' };
function dimKeyOf_(label) { return DIM_KEY[String(label || '')] || ''; }

/* ── 列的共用操作 ───────────────────────────────────── */

function findRow_(sh, map, match) {
  var last = sh.getLastRow();
  if (last <= SKEL_HEADER_ROW) return 0;
  var rows = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW,
                         sh.getLastColumn()).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (match(rowObj_(rows[i], map))) return SKEL_HEADER_ROW + 1 + i;
  }
  return 0;
}

/** line 為 0 就新增一列，否則只改指定的那幾格（其他欄位一格不動）。 */
function writeRow_(sh, map, line, set) {
  var width = sh.getLastColumn();
  if (!line) {
    var row = [];
    for (var j = 0; j < width; j++) row[j] = '';
    for (var k in set) if (map[k]) row[map[k] - 1] = set[k];
    /* ⚠️ 不要用 appendRow —— 它會找「最後一列有資料的地方」，
       右邊如果殘留著別的欄位就會算錯。直接寫到 getLastRow()+1。 */
    sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([row]);
    return;
  }
  /* ⚠️ **逐格 setValue 是一格一次呼叫。**
     一次評測存檔要寫 7 格 → 7 次呼叫，而這整段包在**全站唯一的那把鎖**裡
     （Code.gs 的 stateSaveAction_）。鎖握得越久，別的學員就排得越久。

     改成「整列讀一次 → 在記憶體改 → 整列寫一次」＝ 2 次呼叫。
     ⚠️ 讀回來的其他欄位原樣寫回去，所以**仍然是「其他欄位一格不動」** ——
     這是原本逐格寫的用意，不能弄丟。而且讀與寫都在同一把鎖裡，
     中間沒有別人插得進來。 */
  var cols = [];
  for (var c in set) if (map[c]) cols.push(map[c]);
  if (!cols.length) return;
  if (cols.length === 1) {                 /* 只寫一格就不必來回讀 */
    sh.getRange(line, cols[0]).setValue(set[Object.keys(set)[0]]);
    return;
  }
  var lo = Math.min.apply(null, cols), hi = Math.max.apply(null, cols);
  var span = sh.getRange(line, lo, 1, hi - lo + 1);
  var vals = span.getValues()[0];
  for (var c2 in set) if (map[c2]) vals[map[c2] - lo] = set[c2];
  span.setValues([vals]);
}

/** 沒有 display 的時候，把值翻成還算能看的文字。 */
function plain_(v) {
  if (v == null) return '';
  if (v === true) return '是';
  if (v === false) return '否';
  if (Object.prototype.toString.call(v) === '[object Array]') return v.join('、');
  return String(v);
}

/* ── 學員清單（教練用）─────────────────────────────
   來源是「學員」分頁（表頭也在第 5 列）。順便算每個人的評測進度，
   讓教練一眼看得出誰卡住了。
   ⚠️ 只掃「學員填寫」一次就把所有人的進度算完 ——
   一人一次查詢的話，學員一多就會逾時。 */

/* 宣告移到檔頭，因為 syncStudentName_ 也要用。 */

function studentList_() {
  /* ⚠️ 這一支是「教練挑學員」那條路 —— 原本要掃三張表、每張六次呼叫。
     以實測的 110ms/次算，光固定開銷就一秒多。全部改走 skelRead_。 */
  var sh = sheetByName_(STUDENT_SHEET);
  var rows = [];
  if (sh) {
    var all = sh.getDataRange().getValues();
    var head = all.length >= SKEL_HEADER_ROW ? all[SKEL_HEADER_ROW - 1] : [];
    var map = {};
    for (var h = 0; h < head.length; h++) {
      var hk = String(head[h] || '');
      if (hk && !map[hk]) map[hk] = h + 1;
    }
    var vals = all.slice(SKEL_HEADER_ROW);
    for (var i = 0; i < vals.length; i++) {
      var r = rowObj_(vals[i], map);
      var id = String(r.student_id || '').trim();
      if (!id) continue;
      rows.push({ id: id, name: String(r['學員名稱'] || ''),
                  status: String(r['狀態'] || ''), startedAt: String(r['開始日期'] || '') });
    }
  }

  /* 綁定表裡出現、但「學員」分頁還沒建檔的，也要列出來 ——
     不然教練發了碼、學員綁好了，清單上卻看不到他。 */
  var seen = {};
  rows.forEach(function (x) { seen[x.id] = x; });
  var bb = bindingBody_();
  for (var b = 0; b < bb.rows.length; b++) {
    var br = rowObj_(bb.rows[b], bb.map);
    var bid = String(br.student_id || '').trim();
    if (!bid || String(br.access_scope) === 'manage') continue;
    if (!seen[bid]) {
      seen[bid] = { id: bid, name: '', status: String(br.status || ''), startedAt: '' };
      rows.push(seen[bid]);
    }
    seen[bid].lineName = String(br.line_display_name || '');
    if (br.student_name) seen[bid].name = seen[bid].name || String(br.student_name);
    seen[bid].lastLogin = String(br.last_login_at || '');
  }

  /* 進度：一次掃完，不要一人一次。 */
  var filled = {}, reportDone = {};
  var ar0 = skelRead_('assessment'), amap = ar0.map;
  {
    var av = ar0.body;
    for (var a = 0; a < av.length; a++) {
      var ar = rowObj_(av[a], amap);
      var sid = String(ar.student_id || '');
      if (!sid) continue;
      if (ar['已填'] === 1 || ar['已填'] === '1' || ar['已填'] === true) {
        filled[sid] = (filled[sid] || 0) + 1;
      }
    }
  }
  var rr0 = skelRead_('report'), rmap = rr0.map;
  {
    var rv = rr0.body;
    for (var k = 0; k < rv.length; k++) {
      var rr = rowObj_(rv[k], rmap);
      if (String(rr.field_id) !== 'report.complete') continue;
      if (decodeValue_(rr['儲存值']) === true) reportDone[String(rr.student_id || '')] = true;
    }
  }

  rows.forEach(function (x) {
    x.answered = filled[x.id] || 0;
    x.reportComplete = !!reportDone[x.id];
  });
  rows.sort(function (p, q) { return p.id < q.id ? -1 : 1; });
  return rows;
}
