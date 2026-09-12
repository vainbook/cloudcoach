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
