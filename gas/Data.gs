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

/* 日常只要編輯「目標 O、KR、教材、作業」四欄；kr_id 不可修改 —— 它是永久的鍵，
   學員的任務狀態全部掛在它上面，改了等於把既有紀錄全部變成孤兒。 */
var BLUEPRINT_COLS = ['kr_id', '能力', '目標 O', 'KR', '教材', '作業',
                      '排序', '啟用', '次數', '短標', '教練備註'];

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
                       '加入書本', '書本重點'] }
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
  task:       SKEL.task.sheet
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

function blueprintSheet_() { return ensureSheet_(BLUEPRINT_SHEET, BLUEPRINT_COLS); }

/** 骨架分頁：表頭在第 5 列。缺的欄補在最右邊，既有欄位一格不動。 */
function skelSheet_(scope) {
  var def = SKEL[scope];
  if (!def) throw new AppError('INVALID_INPUT', '不認識的資料範圍');
  var sh = sheet_().getSheetByName(def.sheet);
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

function blueprintLoad_() {
  var sh = blueprintSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
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
  if (sh.getLastRow() > 1) {
    console.log('「' + BLUEPRINT_SHEET + '」已經有 ' + (sh.getLastRow() - 1) + ' 列，不覆蓋');
    return 0;
  }
  if (typeof BLUEPRINT_SEED === 'undefined') {
    console.warn('找不到 BLUEPRINT_SEED（Blueprint.gs 沒推上來？），跳過灌種子');
    return 0;
  }
  var map = colMap_(sh), width = sh.getLastColumn();
  var rows = BLUEPRINT_SEED.map(function (seed) {
    var row = [];
    for (var j = 0; j < width; j++) row[j] = '';
    BLUEPRINT_COLS.forEach(function (c, i) { if (map[c]) row[map[c] - 1] = seed[i]; });
    return row;
  });
  sh.getRange(2, 1, rows.length, width).setValues(rows);
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
  var sh = skelSheet_(scope), map = skelMap_(sh);
  var last = sh.getLastRow();
  if (last <= SKEL_HEADER_ROW) return {};
  var rows = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW,
                         sh.getLastColumn()).getValues();
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

    var fid = String(r.field_id || '');
    if (!fid) continue;
    var val = decodeValue_(r['儲存值']);
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
  if (scope === 'task') return taskSave_(studentId, itemId, field, value);
  return entrySave_(scope, studentId, itemId, field, label, value, requestId, display);
}

/* 學員填寫／教練填寫：一列 = 一個 field_id。 */
function entrySave_(scope, studentId, itemId, field, label, value, requestId, display) {
  var def = SKEL[scope];
  var sh = skelSheet_(scope), map = skelMap_(sh);
  var fid = scope === 'assessment' ? 'assessment.' + itemId : 'report.' + field;
  var line = findRow_(sh, map, function (r) {
    return String(r.student_id) === String(studentId) && String(r.field_id) === fid;
  });
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
  return now;
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
  for (var c in set) if (map[c]) sh.getRange(line, map[c]).setValue(set[c]);
}

/** 沒有 display 的時候，把值翻成還算能看的文字。 */
function plain_(v) {
  if (v == null) return '';
  if (v === true) return '是';
  if (v === false) return '否';
  if (Object.prototype.toString.call(v) === '[object Array]') return v.join('、');
  return String(v);
}
