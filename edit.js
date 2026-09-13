/* ══════════════════════════════════════════════════════════════════════
   文案直接編輯（內部工具）　uc_copy_v1

   開啟方式：網址加上 ?edit=1。正常網站與 ?audit=1 都不啟用。

   用途：不用先把所有文案想好 —— 直接在畫面上打字改，改完自動存，重開還在。

   ⚠️ **畫面上不能出現任何「可以編輯」的痕跡**（使用者指定）：
   沒有鉛筆、沒有虛線框、沒有 hover 高亮、沒有焦點外框、沒有拼字紅底線。
   所以這一份只做兩件事：把「一段文字」標成 contenteditable、把改動記進 localStorage。
   `spellcheck=false` 與 `outline:none` 是為了這條要求，不是隨手加的（uc.css 末尾）。

   ── 為什麼用「原文」當 key，不用選擇器或索引 ──
   這個 app 換頁、換檢視、勾一條 KR 都會重寫 innerHTML，DOM 整批換新。
   選擇器或索引當 key，清單長度一變就全部對不上。
   改用**元素原本的 innerHTML 當 key**：資料檔吐出來的原文永遠一樣，
   所以重繪幾次都對得上，順序變了也不影響。
   代價：**同一句話出現在兩個地方會一起改** —— 對「改文案」而言通常正是想要的。

   ── 三個刻意的行為 ──
   1. **把一段文字全部刪光 = 還原那一段**（改回資料檔的原文）。
      這是唯一的「復原」手勢，因為畫面上不能放復原鈕。
   2. **按鈕與連結要 Alt＋點擊才進入編輯** —— 平常點它就是按它。
      不然「點一下藍圖分頁」會變成「把游標插進分頁的標籤裡」。
   3. **`#selftest` 整個跳過**，那一頁會重寫整個 body。

   ── 存在哪 ──
   `uc_copy_v1`，跟學員狀態 `uc_coach_v1` **分開兩個 key**：
   清掉文案不會清掉作答，清掉作答也不會清掉文案。

   ── 主控台（畫面上沒有入口，只有這裡）──
   `UC_COPY.dump()`   印出全部改動的 JSON（要搬回 data/*.js 時用）
   `UC_COPY.count()`  改過幾段
   `UC_COPY.reset()`  全部還原
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  var enabled = false;
  try { enabled = new URLSearchParams(location.search).get('edit') === '1'; } catch (e) {}
  if (!enabled || location.hash === '#selftest') return;

  var KEY = 'uc_copy_v1';
  /* 可以留在「一段文字」裡面的行內標籤。有其他標籤就代表它是容器不是文字。 */
  var INLINE = /^(B|I|S|EM|STRONG|SPAN|SMALL|U|BR|CODE|SUP|SUB)$/;
  /* 互動元素：照樣套用改過的文案，但不常駐編輯（見上面第 2 點）。 */
  var HOT = /^(BUTTON|A|LABEL|SUMMARY)$/;
  var NEVER = /^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|SVG)$/;
  var HTML = 'http://www.w3.org/1999/xhtml';

  var map = read();
  var ORIG = new WeakMap();   /* 元素 → 它原本的 innerHTML（也就是 map 的 key） */
  var timer = null;

  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY));
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {}
  }

  /* 「一段文字」＝ 底下只有文字與行內標籤的元素。
     ⚠️ 已經在編輯區裡面的元素一律跳過 —— 不然套用改動之後，
     觀察器會看到新塞進去的 <b>，把它也當成一段文字（key 就毀了）。 */
  function isText(el) {
    if (el.namespaceURI !== HTML) return false;
    if (NEVER.test(el.tagName)) return false;
    if (el.closest('[data-no-copy-edit]')) return false;
    if (el.closest('svg')) return false;
    if (el.parentElement && el.parentElement.closest('[contenteditable]')) return false;
    if (!el.firstChild) return false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && !INLINE.test(n.tagName)) return false;
    }
    var t = el.textContent.trim();
    /* 純數字／純符號不是文案（星等、計數、週次都會落在這裡） */
    return t.length >= 2 && /[^\d\s.,:%\/／·・—–\-]/.test(t);
  }

  function mark(el) {
    if (ORIG.has(el)) return;
    var src = el.innerHTML;
    ORIG.set(el, src);
    if (Object.prototype.hasOwnProperty.call(map, src) && map[src] !== src) {
      el.innerHTML = map[src];
    }
    if (HOT.test(el.tagName)) return;          /* 按鈕與連結：Alt＋點擊才編輯 */
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('spellcheck', 'false');
  }

  function scan() {
    timer = null;
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (isText(all[i])) mark(all[i]);
  }
  function soon() { if (!timer) timer = setTimeout(scan, 0); }

  /* 改動落地。空白 = 還原那一段（畫面上不能放復原鈕，所以刪光就是復原）。 */
  function commit(el) {
    var src = ORIG.get(el);
    if (src == null) return;
    var now = el.innerHTML;
    if (!el.textContent.trim()) { delete map[src]; el.innerHTML = src; }
    else if (now === src) delete map[src];
    else map[src] = now;
    write();
  }

  document.addEventListener('input', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[contenteditable]');
    if (el) commit(el);
  });

  /* Alt＋點擊：暫時把按鈕／連結變成可編輯，失焦就收回去。
     捕獲階段攔下來，這一次點擊不會觸發按鈕本來的動作。 */
  document.addEventListener('mousedown', function (e) {
    if (!e.altKey) return;
    var el = e.target.closest && e.target.closest('button, a, label, summary');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!ORIG.has(el)) ORIG.set(el, el.innerHTML);
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('spellcheck', 'false');
    el.focus();
  }, true);

  /* 失焦：存檔；按鈕與連結還要把 contenteditable 收回去，不然它會一直是可編輯的。
     ⚠️ 用 document 上的 focusout（會冒泡），不要在元素上掛 blur ——
     元素被重繪換掉時 blur 不一定會發生，屬性就永遠留在那裡了（踩過）。 */
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('contenteditable')) return;
    commit(el);
    if (HOT.test(el.tagName)) el.removeAttribute('contenteditable');
  });

  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  scan();

  window.UC_COPY = {
    dump:  function () { return JSON.stringify(map, null, 2); },
    count: function () { return Object.keys(map).length; },
    reset: function () { map = {}; write(); location.reload(); },
    /* 文字稽核模式共用這套辨識邏輯。只暴露唯讀查詢，
       不讓稽核工具直接改動文案編輯的 map。 */
    isText: isText,
    sourceOf: function (el) { return ORIG.get(el) || null; }
  };
})();
