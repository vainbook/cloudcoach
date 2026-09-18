/* 一次性的收拾工具。跑完就可以刪掉這個檔案。
 *
 * 要收拾什麼：第一版把「學員填寫／教練填寫／任務狀態」的**第 1 列**當表頭
 * （實際上表頭在第 5 列），於是在每張表的右邊硬接了 7 個欄位
 *   student_id｜item_id｜field｜顯示｜value｜updated_at｜request_id
 * 資料也塞在原本表格下面。
 *
 * 這支程式做三件事，順序不能換：
 *   1. 把那些誤放的資料**搬進**正確的欄位（不是直接刪掉）
 *   2. 刪掉第 1 列那幾個欄位（整欄，由右往左刪）
 *   3. 刪掉被清空的殘留列
 *
 * ⚠️ 只動第 1 列標著那 7 個名字的欄。你自己的 A–I（表頭在第 5 列）一格不碰。
 *
 * 用法：在編輯器選 repairMisplaced 執行，先看執行紀錄確認搬了幾筆。
 */

var STRAY_COLS = ['student_id', 'item_id', 'field', '顯示', 'value',
                  'updated_at', 'request_id'];

function repairMisplaced() {
  var log = [];
  ['assessment', 'report', 'task'].forEach(function (scope) {
    var name = SKEL[scope].sheet;
    var sh = sheet_().getSheetByName(name);
    if (!sh) { log.push('── ' + name + '：找不到分頁，略過'); return; }

    var width = sh.getLastColumn();
    var head1 = sh.getRange(1, 1, 1, width).getValues()[0]
      .map(function (x) { return String(x || ''); });

    /* 第 1 列有 student_id 才算中招。沒有就代表這張是乾淨的。 */
    var map = {};
    head1.forEach(function (h, i) { if (STRAY_COLS.indexOf(h) >= 0 && !map[h]) map[h] = i + 1; });
    if (!map.student_id) { log.push('── ' + name + '：乾淨，沒有要收拾的'); return; }

    /* 1. 搬資料。誤放的列一定在原表下面，但保險起見整張掃。 */
    var moved = 0, skipped = 0;
    var rows = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
    for (var i = 0; i < rows.length; i++) {
      var sid = String(rows[i][map.student_id - 1] || '').trim();
      if (!sid || sid === 'student_id') continue;
      var item = String(rows[i][map.item_id - 1] || '').trim();
      var field = String(rows[i][map.field - 1] || '').trim();
      var label = map['顯示'] ? String(rows[i][map['顯示'] - 1] || '') : '';
      var raw = map.value ? rows[i][map.value - 1] : '';
      if (!item || !field) { skipped++; continue; }
      try {
        stateSave_(scope, sid, item, field, label, decodeValue_(raw), '', '');
        moved++;
      } catch (e) {
        skipped++;
        console.warn('搬不動 ' + sid + '/' + item + '/' + field + '：' + e);
      }
    }
    log.push('── ' + name + '：搬了 ' + moved + ' 筆'
             + (skipped ? '，' + skipped + ' 筆搬不動（看上面的警告）' : ''));

    /* 2. 刪欄。⚠️ **由右往左刪** —— 由左往右刪的話刪完第一欄，
       後面每一欄的編號都會往左位移一格，第二次就刪錯人。 */
    var nums = STRAY_COLS.map(function (c) { return map[c] || 0; })
      .filter(function (n) { return n > 0; })
      .sort(function (a, b) { return b - a; });
    nums.forEach(function (n) { sh.deleteColumn(n); });
    log.push('   刪掉誤加的 ' + nums.length + ' 欄');

    /* 3. 刪掉被清空的殘留列（整列全空、而且在原表下面）。 */
    var last = sh.getLastRow(), w2 = sh.getLastColumn(), gone = 0;
    if (last > SKEL_HEADER_ROW) {
      var r2 = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW, w2).getValues();
      for (var k = r2.length - 1; k >= 0; k--) {
        var empty = r2[k].every(function (v) { return v === '' || v == null; });
        if (empty) { sh.deleteRow(SKEL_HEADER_ROW + 1 + k); gone++; }
      }
    }
    log.push('   刪掉 ' + gone + ' 個空列');
  });

  SpreadsheetApp.flush();
  console.log('收拾完成\n' + log.join('\n'));
  return log.join('\n');
}

/* ═══ 總覽改成會自己長 ═══════════════════════════════════
   現況（2026-09-12 用 inspectFormulas 量的）有三個問題：

   ① **只有兩列有公式**（第 6、7 列）。第三位學員加進來就是空白，
      而且不會有任何提示 —— 你只會覺得「他怎麼沒出現」。
   ② **範圍寫死**：學員填寫只到第 246 列。53 題 × 4 位就滿了，
      滿了之後多出來的人統計永遠是 0，一樣沒有提示。
   ③ `E6 =COUNTIF('學員填寫'!$B$6:$B$246,$A6)` 把「評測總數」定義成
      **這位學員已經有幾列**，所以進度永遠是「已填 ÷ 有幾列」。
      一題都還沒填的人是 0/0，看起來跟填完的人一樣（IFERROR 吃掉了）。

   改法：整欄用一條 ARRAYFORMULA，範圍開到 1000 列，
   評測總數改成固定的 53（從「欄位定義」數 module_id = assessment 的列）。

   ⚠️ 只改第 6 列往下的 A–J 欄，標題、說明、右邊那塊「檢核流程」都不碰。
   跑之前建議先「檔案 → 建立副本」。
*/
function upgradeOverview_() {
  var ss = sheet_();
  var sh = ss.getSheetByName('總覽');
  if (!sh) return '找不到「總覽」分頁';

  var HEAD = 5, FIRST = HEAD + 1;

  /* 評測總數＝題庫題數。寫死在這裡不好，所以從「欄位定義」數出來。 */
  var fd = ss.getSheetByName('欄位定義');
  var total = 0;
  if (fd && fd.getLastRow() > HEAD) {
    var m = mapAt_(fd, HEAD);
    var v = fd.getRange(FIRST, 1, fd.getLastRow() - HEAD, fd.getLastColumn()).getValues();
    for (var i = 0; i < v.length; i++) {
      var r = rowObj_(v[i], m);
      if (String(r.module_id) === 'assessment' && String(r.owner) === 'student') total++;
    }
  }
  if (!total) return '從「欄位定義」數不出評測題數，先不動總覽';

  /* 先把舊的逐列公式清掉，再放一組 ARRAYFORMULA 在第一列。 */
  var last = Math.max(sh.getLastRow(), FIRST);
  sh.getRange(FIRST, 1, last - HEAD, 10).clearContent();

  var S = "'學員'!", A = "'學員填寫'!", T = "'任務狀態'!", G = "'成長紀錄'!", C = "'課程工具'!";
  var ids = S + '$A$6:$A$1000';

  function arr(expr) {
    /* 空白列不要算 —— 沒有這層 IF，下面 900 列會全部長出 0。 */
    return '=ARRAYFORMULA(IF(' + ids + '="","",' + expr + '))';
  }
  var put = [
    [1, arr(ids)],
    [2, arr(S + '$B$6:$B$1000')],
    [3, arr(S + '$D$6:$D$1000')],
    [4, arr('SUMIF(' + A + '$B$6:$B$5000,' + ids + ',' + A + '$H$6:$H$5000)')],
    [5, arr(total)],
    [6, arr('SUMIF(' + A + '$B$6:$B$5000,' + ids + ',' + A + '$H$6:$H$5000)/' + total)],
    [7, arr('COUNTIFS(' + T + '$B$6:$B$3000,' + ids + ',' + T + '$F$6:$F$3000,TRUE)')],
    [8, arr('COUNTIFS(' + T + '$B$6:$B$3000,' + ids + ',' + T + '$G$6:$G$3000,TRUE)')],
    [9, arr('COUNTIF(' + G + '$B$6:$B$3000,' + ids + ')')],
    [10, arr('COUNTIF(' + C + '$B$6:$B$3000,' + ids + ')')]
  ];
  put.forEach(function (p) { sh.getRange(FIRST, p[0]).setFormula(p[1]); });

  /* 進度那一欄是比例，給它百分比格式，不然會顯示 0.43 */
  sh.getRange(FIRST, 6, 1, 1).setNumberFormat('0%');

  SpreadsheetApp.flush();
  var msg = '「總覽」已改成 ARRAYFORMULA：學員加進「學員」分頁就會自動出現，'
    + '最多 995 位。評測總數固定為 ' + total + ' 題（從「欄位定義」數出來的）。';
  console.log(msg);
  return msg;
}

/** 選單用的包裝：先確認再動，並且回報結果。 */
function menuUpgradeOverview() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.alert('改善「總覽」',
    '會把第 6 列以下的 A–J 欄換成 ARRAYFORMULA：\n\n'
    + '・學員加進「學員」分頁就自動出現（現在只有前兩位有公式）\n'
    + '・範圍從 246 列放寬到 5000 列\n'
    + '・評測進度改用固定題數當分母（現在是「已填÷有幾列」，0/0 看起來像滿分）\n\n'
    + '⚠️ 標題、說明與右邊的「檢核流程」都不會動。\n'
    + '建議先「檔案 → 建立副本」。要繼續嗎？',
    ui.ButtonSet.OK_CANCEL);
  if (a !== ui.Button.OK) return;
  ui.alert(upgradeOverview_());
}

/* 一次性清理：把「任務狀態」裡 kr_id 是 true / false 的垃圾列刪掉。
 *
 * 那是 2026-09-18 之前的寫入 bug 留下來的 —— taskSave_ 誤把 value（true）
 * 當成 kr_id，於是每勾一次當前任務就往那一列寫。新版不會再產生。
 *
 * ⚠️ 唯讀之外的動作：**會刪列**。只刪 kr_id 正好是 true/false 的，
 * 其他一格不動。在編輯器選 cleanTaskJunk 執行，紀錄會列出刪了哪幾列。
 */
function cleanTaskJunk() {
  var sh = skelSheet_('task'), map = skelMap_(sh);
  var last = sh.getLastRow();
  if (last <= SKEL_HEADER_ROW) { console.log('「任務狀態」沒有資料列。'); return; }

  var rows = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW,
                         sh.getLastColumn()).getValues();
  var killed = [];
  /* 由下往上刪，不然刪一列之後下面的列號全部往上移。 */
  for (var i = rows.length - 1; i >= 0; i--) {
    var kr = String(rowObj_(rows[i], map).kr_id || '').trim();
    if (kr !== 'true' && kr !== 'false') continue;
    var line = SKEL_HEADER_ROW + 1 + i;
    killed.push(line + '（kr_id=' + kr + '）');
    sh.deleteRow(line);
  }
  skelDrop_('task');          /* 直接動表就要自己丟快取（規則 57） */
  console.log(killed.length
    ? '刪掉 ' + killed.length + ' 列垃圾：\n  ' + killed.reverse().join('\n  ')
    : '沒有垃圾列，不用清。');
  return killed.length;
}

/* 把「學員填寫」裡殘留的 activity_days 列刪掉。
 *
 * 那是 2026-09-18 之前的設計 —— 編輯簽到借住在評測那張表，於是任何
 * 「數那張表有幾列」的地方都會多算一題（學員清單出現過「55 / 54」，
 * 總覽的公式多半也一起錯）。
 *
 * 現在日曆上的記號改成**登入日**，資料在「帳號綁定」的「登入日」欄，
 * 由登入時順手蓋章，所以這些舊列不用搬、直接刪。
 *
 * ⚠️ **會刪列。** 只刪 field_id 是 activity_days（或 assessment.activity_days）的那幾列。
 * 在編輯器選 dropActivityRows 執行，紀錄會列出刪了哪幾列。
 */
function dropActivityRows() {
  var sh = skelSheet_('assessment'), map = skelMap_(sh);
  var last = sh.getLastRow();
  if (last <= SKEL_HEADER_ROW) { console.log('「學員填寫」沒有資料列。'); return 0; }

  var rows = sh.getRange(SKEL_HEADER_ROW + 1, 1, last - SKEL_HEADER_ROW,
                         sh.getLastColumn()).getValues();
  var lines = [], who = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.field_id || '').replace(/^assessment\./, '') !== 'activity_days') continue;
    lines.push(SKEL_HEADER_ROW + 1 + i);
    who.push(String(r.student_id || '（沒有學員 id）'));
  }
  if (!lines.length) { console.log('沒有殘留的 activity_days 列。'); return 0; }

  /* ⚠️ 由下往上刪，不然刪一列之後下面的列號全部往上移。 */
  for (var k = lines.length - 1; k >= 0; k--) sh.deleteRow(lines[k]);
  skelDrop_('assessment');          /* 直接動表就要自己丟快取（規則 57） */

  console.log('刪掉 ' + lines.length + ' 列：' + who.join('、')
    + '\n「學員填寫」現在只剩題目，進度計數與總覽公式都會跟著正確。');
  return lines.length;
}
