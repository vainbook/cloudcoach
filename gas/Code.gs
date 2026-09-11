/**
 * UC 雲端教練 — Apps Script 後端
 * BACKEND-WORKFLOW.md 第 2 階段：**只做 auth.exchange，不碰 Sheet。**
 *
 * 這一版刻意什麼都不讀。它只回答一個問題：
 *   「這個 ID Token 是不是 LINE 發的、是不是發給我們這個 Channel 的、有沒有過期？」
 * 帳號綁定（第 3 階段）與學員資料（第 6 階段）都還沒接。
 *
 * ── 為什麼不能像 line_group_activity_system 那樣做 ──
 * 那套是前端 liff.getProfile() 拿 userId，再把 userId 送來當身分。
 * 前端說的話不能當登入證明 —— 任何人都能改請求裡的 userId。
 * 活動布告欄最壞是有人幫別人報名；雲端教練的表要裝性經驗、家庭相處狀況、
 * 財務狀態，偽造一個 student_id 就讀走別人整份訪談。
 * 所以這裡只接受**原始 ID Token**，而且一定要向 LINE 驗過才算數。
 *
 * ── Channel ID 為什麼是常數，不是 Script Property ──
 * 因為它**不是密鑰**：它是 LIFF ID `2011543667-p1MX4tl7` 的前半段，
 * 已經印在每一個瀏覽器拿到的 liff-test.html 裡，也已經在公開 repo 裡。
 * 放進 Script Properties 保護不到任何東西，卻讓部署多一個手動步驟。
 *
 * Script Properties 留給**真正的密鑰**（之後才會出現）：
 *   SHEET_ID          私人 Google Sheet 的 ID（第 3 階段）
 *   SESSION_SECRET    本站 Session 的簽章密鑰（第 3 階段）
 * 那些一律不進程式碼、不進 Git。
 *
 * 指令碼屬性若有設 LINE_CHANNEL_ID，會**蓋過**下面的常數 —— 換 Channel
 * 或開測試用 Channel 時不必改程式。
 * Channel secret 這一版用不到，不要放進來。
 *
 * ── 部署方式 ──
 * 部署 → 新增部署作業 → 類型「網頁應用程式」
 *   執行身分：我
 *   誰可以存取：**任何人**（LIFF 頁是匿名前端，必須匿名可打）
 * 拿到 /exec 結尾的網址，填進 site/liff-test.html 的 CONFIG.GAS_API_URL。
 *
 * ⚠️ 改完程式一定要「新增部署作業」或更新現有部署版本，
 * 只按儲存不會更新 /exec 的內容。
 */

'use strict';

var LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

/* 預設 Channel ID。指令碼屬性 LINE_CHANNEL_ID 存在時以它為準。 */
var DEFAULT_CHANNEL_ID = '2011543667';

/* ── 對外入口 ──────────────────────────────────────── */

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || '');

    if (action === 'auth.exchange') return ok_(authExchange_(body));

    return fail_('INVALID_INPUT', '不認識的 action：' + (action || '（空白）'));
  } catch (err) {
    /* ⚠️ 絕對不要把 err.stack、Sheet 內容或 Token 回給前端。
       細節留在 Apps Script 的執行紀錄裡，前端只拿到分類。 */
    console.error('doPost 失敗', err);
    return fail_('INTERNAL_ERROR', '伺服器處理失敗');
  }
}

/**
 * doGet 只當健康檢查用。
 * 刻意不接受任何 action —— GET 的參數會進伺服器日誌與瀏覽器歷史，
 * Token 絕對不能走 GET（BACKEND-WORKFLOW.md §3）。
 */
function doGet() {
  return ok_({
    service: 'uc-cloud-coach',
    stage: 2,
    channelConfigured: !!channelId_(),
    channelSource: prop_('LINE_CHANNEL_ID') ? 'script-property' : 'default-constant',
    hint: '這個端點只接 POST，body 要 JSON、action 目前只有 auth.exchange'
  });
}

/* ── auth.exchange ─────────────────────────────────── */

function authExchange_(body) {
  var channelId = channelId_();
  if (!channelId) {
    throw new AppError('INTERNAL_ERROR', '沒有可用的 Channel ID');
  }

  var idToken = String(body.idToken || '');
  if (!idToken) throw new AppError('UNAUTHENTICATED', '沒有帶 idToken');

  var v = verifyLineIdToken_(idToken, channelId);

  /* 第 2 階段只回遮罩後的 sub 與綁定狀態，不讀學員資料。
     bound 現在恆為 false —— 綁定表是第 3 階段才建。 */
  return {
    verified: true,
    subMasked: maskSub_(v.sub),
    audMatches: true,          /* verifyLineIdToken_ 沒丟錯就代表 aud 對得上 */
    expiresInSec: v.exp ? Math.max(0, v.exp - Math.floor(Date.now() / 1000)) : null,
    bound: false,
    nextStage: '第 3 階段：帳號綁定（一次性啟用碼）'
  };
}

/**
 * 向 LINE 驗證 ID Token。
 * ⚠️ **不要自己解 JWT 來信任裡面的欄位。** 自己解等於只是讀了一段 base64，
 * 簽章、發行者、有效期都沒有檢查。一定要打 LINE 的端點。
 * client_id 傳進去，LINE 會順便幫我們比對 aud —— 不符會回 400。
 */
function verifyLineIdToken_(idToken, channelId) {
  var res = UrlFetchApp.fetch(LINE_VERIFY_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code !== 200) {
    /* LINE 會回 { error, error_description }。原文留在日誌，
       前端只拿到分類 —— 「哪裡不對」對攻擊者是資訊。 */
    console.warn('LINE verify 失敗 code=' + code + ' body=' + text);
    throw new AppError('UNAUTHENTICATED', 'ID Token 未通過 LINE 驗證');
  }

  var data;
  try { data = JSON.parse(text); }
  catch (e) { throw new AppError('INTERNAL_ERROR', 'LINE 回應無法解析'); }

  if (!data.sub) throw new AppError('UNAUTHENTICATED', 'LINE 回應沒有 sub');

  /* 再自己檢一次 aud 與 exp。LINE 已經檢過，但這裡是唯一的授權關口，
     多一道成本是零，少一道就沒有第二層。 */
  if (String(data.aud) !== String(channelId)) {
    console.warn('aud 不符 aud=' + data.aud);
    throw new AppError('UNAUTHENTICATED', 'ID Token 不是發給本 Channel 的');
  }
  if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
    throw new AppError('UNAUTHENTICATED', 'ID Token 已過期');
  }

  return data;
}

/* ── 共用小工具 ────────────────────────────────────── */

function AppError(code, message) { this.code = code; this.message = message; }
AppError.prototype = Object.create(Error.prototype);

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

/** 指令碼屬性優先，沒設就用常數。 */
function channelId_() {
  return prop_('LINE_CHANNEL_ID') || DEFAULT_CHANNEL_ID;
}

/**
 * 前端送的是 Content-Type: text/plain（為了避開 CORS preflight），
 * 所以這裡不能靠 e.postData.type 判斷，直接當 JSON 解。
 */
function parseBody_(e) {
  var raw = (e && e.postData && e.postData.contents) || '';
  if (!raw) throw new AppError('INVALID_INPUT', 'request body 是空的');
  try { return JSON.parse(raw); }
  catch (err) { throw new AppError('INVALID_INPUT', 'request body 不是合法 JSON'); }
}

/** LINE user ID 是個人資料。日誌與回應一律只留前後各 4 字。 */
function maskSub_(sub) {
  var s = String(sub || '');
  return s.length <= 10 ? '（異常短）' : s.slice(0, 5) + '…' + s.slice(-4);
}

/* 統一回應格式（BACKEND-WORKFLOW.md §5）。
   錯誤分類：UNAUTHENTICATED / UNBOUND_ACCOUNT / FORBIDDEN_STUDENT /
             INVALID_INPUT / CONFLICT / INTERNAL_ERROR */

function ok_(data) {
  return out_({ ok: true, data: data, error: null, server_time: now_() });
}

function fail_(code, message) {
  return out_({ ok: false, data: null,
                error: { code: code, message: message }, server_time: now_() });
}

function out_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ── 本機自我檢查 ──────────────────────────────────
   在 Apps Script 編輯器裡選這個函式按執行。不需要真的 Token。
   驗的是「錯誤路徑會不會乖乖回錯誤」，那是這一版唯一會動的邏輯。 */

function selftest() {
  var log = [], ok = true;
  function t(name, cond) { log.push((cond ? '  ok   ' : '  FAIL ') + name); if (!cond) ok = false; }

  t('有可用的 Channel ID', !!channelId_());

  var r1 = JSON.parse(doPost({ postData: { contents: '{}' } }).getContent());
  t('空 action → INVALID_INPUT', r1.ok === false && r1.error.code === 'INVALID_INPUT');

  var r2 = JSON.parse(doPost({ postData: { contents: 'not json' } }).getContent());
  t('壞 JSON → INTERNAL_ERROR 或 INVALID_INPUT',
    r2.ok === false && ['INVALID_INPUT', 'INTERNAL_ERROR'].indexOf(r2.error.code) >= 0);

  var r3 = JSON.parse(doPost({ postData: { contents:
    JSON.stringify({ action: 'auth.exchange' }) } }).getContent());
  t('缺 idToken → 回錯誤', r3.ok === false);

  var r4 = JSON.parse(doPost({ postData: { contents:
    JSON.stringify({ action: 'auth.exchange', idToken: 'obviously.not.a.token' }) } }).getContent());
  t('假 Token → 回錯誤（不是 200 ok）', r4.ok === false);
  t('假 Token 的錯誤訊息不含 Token 原文',
    JSON.stringify(r4).indexOf('obviously.not.a.token') < 0);

  var r5 = JSON.parse(doGet().getContent());
  t('doGet 健康檢查可用', r5.ok === true && r5.data.stage === 2);
  t('doGet 不洩漏 Channel ID', JSON.stringify(r5).indexOf(channelId_()) < 0);

  console.log('UC GAS selftest ' + (ok ? 'PASS' : 'FAIL') + '\n' + log.join('\n'));
  return ok;
}
