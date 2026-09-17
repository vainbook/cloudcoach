/* 一次性的診斷工具。**唯讀，不改任何東西。**
 *
 * 為什麼需要它：程式碼看不到線上試算表長怎樣。
 * 「學員填寫」這幾個分頁在骨架裡本來就存在、而且表頭不在第 1 列，
 * 結果 ensureSheet_() 把第 1 列當表頭，把新欄位接到右邊去了。
 * 修之前要先確定每一張的實際形狀，不能用猜的。
 *
 * 用法：在編輯器選 inspectTabs 執行，把執行紀錄整段貼回來。
 */
function inspectTabs() {
  var ss = sheet_();
  var out = ['試算表：' + ss.getName(), ''];
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    out.push('── ' + n + '　' + rows + ' 列 × ' + cols + ' 欄');
    if (!rows || !cols) { out.push('    （空的）'); return; }
    var peek = Math.min(rows, 6);
    /* ⚠️ 一定要印**到最後一欄**。上次只印 14 欄，結果「學員填寫」誤加的
       updated_at／request_id（O、P 欄）被截掉，看起來像沒問題。 */
    var vals = sh.getRange(1, 1, peek, Math.min(cols, 26)).getValues();
    for (var i = 0; i < peek; i++) {
      var line = vals[i].map(function (v) {
        var s = String(v == null ? '' : v);
        return s.length > 14 ? s.slice(0, 14) + '…' : s;
      }).map(function (v, i) { return colLetter_(i + 1) + ':' + v; }).join(' | ');
      if (line.replace(/[A-Z0-9: |]/g, '') === '') line = '（整列空白）';
      out.push('    第' + (i + 1) + '列  ' + line);
    }
    if (rows > peek) out.push('    …還有 ' + (rows - peek) + ' 列');
  });
  console.log(out.join('\n'));
  return out.join('\n');
}

/* 1 → A，27 → AA。印出來要看得出是哪一欄，不然對不到畫面上。 */
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/* 「總覽」到底是公式還是靜態值？（TODO 7-2 要先知道這件事）
   ⚠️ 唯讀。如果是公式，動「學員／帳號綁定」會把它算壞，整合前必須先搞清楚。 */
function inspectFormulas() {
  var ss = sheet_();
  var out = [];
  ['總覽', '學員', '欄位定義'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push('── ' + name + '：沒有這張分頁'); return; }
    var r = sh.getLastRow(), c = sh.getLastColumn();
    var f = sh.getRange(1, 1, r, c).getFormulas();
    var hits = [];
    for (var i = 0; i < f.length; i++) {
      for (var j = 0; j < f[i].length; j++) {
        if (f[i][j]) hits.push(colLetter_(j + 1) + (i + 1) + '  ' + f[i][j].slice(0, 90));
      }
    }
    out.push('── ' + name + '　' + r + '×' + c + '　公式 ' + hits.length + ' 格');
    hits.slice(0, 20).forEach(function (h) { out.push('    ' + h); });
    if (hits.length > 20) out.push('    …還有 ' + (hits.length - 20) + ' 格');
  });
  console.log(out.join('\n'));
  return out.join('\n');
}

/* 「讀答案」為什麼是 553～1993ms？兩種可能，解法完全不同：
 *   資料量大 → 要縮資料（骨架列太多、或一張表塞了全部學員）
 *   呼叫本身慢 → 要縮次數（batchGet 把三張表併成一個請求）
 *
 * 這支把每張表讀三次，印出「幾列幾欄、幾格、每次幾毫秒」。
 * **唯讀，不改任何東西。** 在編輯器選 measureReads 執行，把紀錄貼回來。
 */
function measureReads() {
  var names = ['學員填寫', '教練填寫', '任務狀態', '帳號綁定', '成長紀錄', '藍圖內容'];
  var out = ['分頁　　　　　列×欄　　格數　　三次讀取(ms)', ''];
  names.forEach(function (n) {
    var sh = sheet_().getSheetByName(n);
    if (!sh) { out.push(n + '　（沒有這張分頁）'); return; }
    var times = [], cells = 0, shape = '';
    for (var i = 0; i < 3; i++) {
      var t = Date.now();
      var v = sh.getDataRange().getValues();
      times.push(Date.now() - t);
      if (!i) { shape = v.length + '×' + (v[0] ? v[0].length : 0); cells = v.length * (v[0] ? v[0].length : 0); }
    }
    out.push(n + '　' + shape + '　' + cells + ' 格　' + times.join(' / '));
  });

  /* 對照組：同樣三張表，用進階服務一個請求抓完。
     沒開進階服務就會拋錯 —— 那也是一種答案（表示這條路要先開服務）。 */
  try {
    var t2 = Date.now();
    var res = Sheets.Spreadsheets.Values.batchGet(sheet_().getId(),
      { ranges: ["'學員填寫'", "'教練填寫'", "'任務狀態'"] });
    var got = (res.valueRanges || []).map(function (r) { return (r.values || []).length; });
    out.push('', 'batchGet 三張一次　' + (Date.now() - t2) + ' ms　列數 ' + got.join('/'));
  } catch (e) {
    out.push('', 'batchGet 走不通：' + e);
  }
  console.log(out.join('\n'));
  return out.join('\n');
}

/* 換門之前的對照測試。**唯讀。**
 *
 * batchGet 跟 getDataRange 是兩套型別規則（Date、布林、數字、尾端空格都可能不同）。
 * 所以不能只看「快了多少」，要先確認**兩條路拿到的資料完全一樣**。
 * 這支拿資料最多的那位學員，兩條路各跑一次 stateLoad_，逐字比對。
 *
 * 在編輯器選 verifyBatch 執行，把紀錄貼回來。
 */
function verifyBatch() {
  var out = [];

  /* 挑一位真的有資料的學員，不然比對的是兩包空的。 */
  var sh = sheet_().getSheetByName(SKEL.assessment.sheet);
  var all = sh.getDataRange().getValues();
  var map = {}, head = all[SKEL_HEADER_ROW - 1] || [];
  for (var i = 0; i < head.length; i++) if (head[i]) map[String(head[i])] = i + 1;
  var count = {};
  all.slice(SKEL_HEADER_ROW).forEach(function (row) {
    var id = String(row[map.student_id - 1] || '');
    if (id) count[id] = (count[id] || 0) + 1;
  });
  var sid = '', best = -1;
  for (var k in count) if (count[k] > best) { best = count[k]; sid = k; }
  if (!sid) { console.log('學員填寫裡沒有任何資料，沒得比。'); return; }
  out.push('拿 ' + sid + ' 來比（' + best + ' 列）', '');

  var scopes = ['assessment', 'report', 'task'];

  _skel = {}; _pre = {};
  var t1 = Date.now(), oldOne = {};
  scopes.forEach(function (s) { oldOne[s] = JSON.stringify(stateLoad_(s, sid)); });
  var ms1 = Date.now() - t1;

  _skel = {}; _pre = {};
  var t2 = Date.now();
  skelPreload_(scopes);
  var pre = Date.now() - t2, newOne = {};
  scopes.forEach(function (s) { newOne[s] = JSON.stringify(stateLoad_(s, sid)); });
  var ms2 = Date.now() - t2;

  out.push('逐張讀　' + ms1 + ' ms');
  out.push('batchGet ' + ms2 + ' ms（其中抓取 ' + pre + ' ms）');
  out.push('省下　　' + (ms1 - ms2) + ' ms', '');

  var bad = 0;
  scopes.forEach(function (s) {
    var same = oldOne[s] === newOne[s];
    if (!same) bad++;
    out.push((same ? '✓ ' : '✗ ') + s + '　' + oldOne[s].length + ' 字 vs ' + newOne[s].length + ' 字');
    if (!same) {
      for (var i = 0; i < Math.max(oldOne[s].length, newOne[s].length); i++) {
        if (oldOne[s][i] !== newOne[s][i]) {
          out.push('    第一處不同在第 ' + i + ' 字');
          out.push('    舊：…' + oldOne[s].slice(Math.max(0, i - 30), i + 60));
          out.push('    新：…' + newOne[s].slice(Math.max(0, i - 30), i + 60));
          break;
        }
      }
    }
  });
  out.push('', bad ? '⚠️ 有 ' + bad + ' 個 scope 對不起來，先不要上線。' : '✅ 三個 scope 完全一致。');

  _skel = {}; _pre = {};
  console.log(out.join('\n'));
  return out.join('\n');
}
