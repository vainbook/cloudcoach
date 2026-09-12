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
