/* ═══════════════════════════════════════════════════════════════
   資料層：課程藍圖（共用）＋ 三張學員資料分頁

   ⚠️ 這個檔案**不自己開試算表**。所有存取一律經過 Code.gs 的 sheet_()，
   那裡有「只准碰高級雲端教練後台」那三道鎖（使用者的硬性要求）。

   ── 為什麼三張學員分頁長得一模一樣 ──────────────────
   學員填寫、教練填寫、任務狀態存的都是「這位學員的某一格＝某個值」，
   差別只在那一格叫什麼。做成同一種形狀之後，新增／更新／讀取
   各只要寫一次，而不是抄三遍（抄三遍的版本一定會有一份先腐爛）。

   每張都是：student_id ｜ <項目 id> ｜ field ｜ 顯示 ｜ value ｜ updated_at ｜ request_id

     顯示      給人看的中文，例如「陌生社交」或「人格魅力／說明」。
               **由前端帶上來，不可信任** —— 只拿來讓你打開表看得懂，
               任何判斷都用 field 與 value，絕不讀「顯示」。
     value     一律存 JSON 字串，讀出來再 parse。
               直接存原值的話，Sheet 會把 "01" 變成 1、把長數字變成科學記號。
     request_id 同一個 request_id 重送只會更新同一列，不會多長一列。
   ═══════════════════════════════════════════════════════════════ */

var BLUEPRINT_SHEET = '藍圖內容';

/* 日常只要編輯「目標 O、KR、教材、作業」四欄；kr_id 不可修改 —— 它是永久的鍵，
   學員的任務狀態全部掛在它上面，改了等於把既有紀錄全部變成孤兒。 */
var BLUEPRINT_COLS = ['kr_id', '能力', '目標 O', 'KR', '教材', '作業',
                      '排序', '啟用', '次數', '短標', '教練備註'];

var STATE_COLS = ['student_id', 'item_id', 'field', '顯示', 'value',
                  'updated_at', 'request_id'];

/* scope → 分頁名。前端只送 scope，送不進來的名字就進不了。 */
var STATE_SHEETS = {
  assessment: '學員填寫',
  report:     '教練填寫',
  task:       '任務狀態'
};

/* 教練報告允許的 field。白名單，不是黑名單。 */
var REPORT_FIELDS = ['letter', 'complete'];
(function () {
  ['values', 'emo', 'image', 'circle', 'flirt'].forEach(function (k) {
    REPORT_FIELDS.push('adjust.' + k, 'score.' + k, 'note.' + k);
  });
})();

var TASK_FIELDS = ['current', 'done', 'hidden', 'picked', 'key'];

/* ── 分頁 ──────────────────────────────────────────── */

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
  /* 就地升級：缺的欄補在**最後面**，不重排既有欄位
     （重排會讓既有資料整排對到錯的格子，而且是無聲的）。 */
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x || ''); });
  var missing = cols.filter(function (c) { return have.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    console.log('「' + name + '」補上欄位：' + missing.join('、'));
  }
  return sh;
}

function blueprintSheet_() { return ensureSheet_(BLUEPRINT_SHEET, BLUEPRINT_COLS); }

function stateSheet_(scope) {
  var name = STATE_SHEETS[scope];
  if (!name) throw new AppError('INVALID_INPUT', '不認識的資料範圍');
  return ensureSheet_(name, STATE_COLS);
}

/* ── 課程藍圖 ───────────────────────────────────────
   全體學員共用一份。個別學員看得到哪幾條，是「任務狀態」的 hidden／picked
   在管，**不複製整份藍圖**（複製的話你改一次要改 N 份）。 */

function blueprintLoad_() {
  var sh = blueprintSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    var id = String(r.kr_id || '').trim();
    if (!id) continue;                                  /* 空白列直接跳過 */
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
  /* ⚠️ 照**表頭**排，不要照 BLUEPRINT_COLS 排 —— 既有表升級後新欄在最後面。 */
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

/* ── 學員資料的讀寫 ─────────────────────────────────── */

function encodeValue_(v) { return JSON.stringify(v === undefined ? null : v); }

function decodeValue_(s) {
  if (s === '' || s == null) return null;
  try { return JSON.parse(String(s)); } catch (e) { return String(s); }
}

/** 讀某位學員在某個 scope 的所有格子 → { item_id: { field: value } } */
function stateLoad_(scope, studentId) {
  var sh = stateSheet_(scope), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.student_id) !== String(studentId)) continue;
    var item = String(r.item_id || ''), f = String(r.field || '');
    if (!item) continue;
    (out[item] = out[item] || {})[f] = decodeValue_(r.value);
  }
  return out;
}

/**
 * 寫一格。**單格 patch，不是整份覆寫** ——
 * 整份覆寫的話教練跟學員同時操作會互相吃掉（BACKEND-WORKFLOW.md §4 明文禁止）。
 */
function stateSave_(scope, studentId, itemId, field, label, value, requestId) {
  var sh = stateSheet_(scope), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var line = 0;
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.student_id) === String(studentId)
        && String(r.item_id) === String(itemId)
        && String(r.field) === String(field)) { line = i + 1; break; }
    /* 同一個 request_id 重送 → 認定是同一筆，更新而不是新增。 */
    if (requestId && String(r.request_id) === String(requestId)) { line = i + 1; break; }
  }
  var now = now_();
  if (!line) {
    var width = sh.getLastColumn(), row = [];
    for (var j = 0; j < width; j++) row[j] = '';
    function put(c, v) { if (map[c]) row[map[c] - 1] = v; }
    put('student_id', studentId); put('item_id', itemId); put('field', field);
    put('顯示', label); put('value', encodeValue_(value));
    put('updated_at', now); put('request_id', requestId || '');
    sh.appendRow(row);
  } else {
    setCell_(sh, line, 'value', encodeValue_(value));
    setCell_(sh, line, 'updated_at', now);
    if (label) setCell_(sh, line, '顯示', label);
    if (requestId) setCell_(sh, line, 'request_id', requestId);
  }
  return now;
}
