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
    var vals = sh.getRange(1, 1, peek, Math.min(cols, 14)).getValues();
    for (var i = 0; i < peek; i++) {
      var line = vals[i].map(function (v) {
        var s = String(v == null ? '' : v);
        return s.length > 14 ? s.slice(0, 14) + '…' : s;
      }).join(' | ');
      if (line.replace(/[ |]/g, '') === '') line = '（整列空白）';
      out.push('    第' + (i + 1) + '列  ' + line);
    }
    if (rows > peek) out.push('    …還有 ' + (rows - peek) + ' 列');
  });
  console.log(out.join('\n'));
  return out.join('\n');
}
