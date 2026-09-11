/**
 * UC 雲端教練 — Apps Script 後端
 * BACKEND-WORKFLOW.md 第 2～3 階段。
 *
 *   第 2 階段（完成）auth.exchange —— 只驗 LINE ID Token，不碰試算表。
 *   第 3 階段（本檔）  帳號綁定 —— 一次性啟用碼把 LINE 帳號綁到一位學員。
 *
 * 學員資料的讀寫（student.load 等）是第 6 階段，還沒做。
 *
 * ── 為什麼不能像 line_group_activity_system 那樣做 ──
 * 那套是前端 liff.getProfile() 拿 userId，再把 userId 送來當身分。
 * 前端說的話不能當登入證明 —— 任何人都能改請求裡的 userId。
 * 活動布告欄最壞是有人幫別人報名；雲端教練的表要裝性經驗、家庭相處狀況、
 * 財務狀態，偽造一個 student_id 就讀走別人整份訪談。
 * 所以這裡只接受**原始 ID Token**，而且一定要向 LINE 驗過才算數。
 *
 * ── ⚠️ 只准碰一份試算表 ──
 * 使用者明確要求：千萬不要動到別的表單。
 * Google 沒有給獨立式腳本「只授權單一檔案」的權限，`spreadsheets` scope
 * 涵蓋帳號底下所有試算表。所以改用三道程式鎖：
 *   ① SHEET_ID 只從 Script Properties 讀，**任何路徑都不接受請求帶來的 ID 或網址**
 *   ② 開檔後比對名稱必須等於 EXPECTED_SHEET_NAME，不符立刻中止，不做任何讀寫
 *   ③ selftest() 逐項驗證上面兩件事
 * 之後新增功能時**一律透過 sheet_()**，不要自己呼叫 SpreadsheetApp.openById。
 *
 * ── Script Properties ──
 *   SHEET_ID    高級雲端教練後台的試算表 ID。**這是密鑰，不進程式碼、不進 Git。**
 *   CODE_SALT   啟用碼雜湊用的鹽。由 setup() 自動生成，不用手動設。
 *   LINE_CHANNEL_ID（選填）沒設就用下面的常數 —— 它不是密鑰，
 *               是公開 LIFF ID 的前半段，已經印在前端與公開 repo 裡。
 *
 * ── 部署 ──
 * clasp push → clasp update-deployment <id>（用 update 不要用 create，
 * /exec 網址才不會變）。只 push 不會更新 /exec 的內容。
 */

'use strict';

var LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
var DEFAULT_CHANNEL_ID = '2011543667';

/** ⚠️ 第二道鎖。開檔後名稱不符就中止 —— SHEET_ID 貼錯也不會寫到別人的表。 */
var EXPECTED_SHEET_NAME = '高級雲端教練後台';
var BINDING_SHEET = '帳號綁定';

/* 帳號綁定的欄位（BACKEND-WORKFLOW.md §3）。順序就是試算表的欄序，不要改。 */
var BINDING_COLS = ['binding_id', 'line_user_id', 'student_id', 'access_scope',
                    'status', 'activation_code_hash', 'activation_expires_at',
                    'activation_used_at', 'linked_at', 'last_login_at'];

/* 允許回給前端的錯誤分類（BACKEND-WORKFLOW.md §5）。
   不在這張表裡的一律變成 INTERNAL_ERROR —— 白名單，不是黑名單。 */
var KNOWN_ERRORS = ['UNAUTHENTICATED', 'UNBOUND_ACCOUNT', 'FORBIDDEN_STUDENT',
                    'INVALID_INPUT', 'CONFLICT'];

/* ── 對外入口 ──────────────────────────────────────── */

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || '');

    if (action === 'auth.exchange') return ok_(authExchange_(body));
    if (action === 'auth.bind')     return ok_(authBind_(body));

    return fail_('INVALID_INPUT', '不認識的 action：' + (action || '（空白）'));
  } catch (err) {
    /* ⚠️ 絕對不要把 err.stack、Sheet 內容或 Token 回給前端。
       細節留在 Apps Script 的執行紀錄裡，前端只拿到分類。

       ⚠️ 但**分類要保留**。原本這裡一律回 INTERNAL_ERROR，
       結果「Token 過期」跟「伺服器壞了」在前端長得一模一樣 ——
       前者該叫使用者重新登入，後者該叫他等一下再試（踩過）。
       我們自己丟的 AppError 帶著分類，照原樣回；只有非預期的例外才是 INTERNAL_ERROR。 */
    if (err instanceof AppError && KNOWN_ERRORS.indexOf(err.code) >= 0) {
      console.warn('doPost 已知錯誤 ' + err.code);
      return fail_(err.code, err.message, err.detail);
    }
    console.error('doPost 未預期例外', err);
    return fail_('INTERNAL_ERROR', '伺服器處理失敗');
  }
}

/**
 * doGet 只當健康檢查用。
 * 刻意不接受任何 action —— GET 的參數會進伺服器日誌與瀏覽器歷史，
 * Token 絕對不能走 GET（BACKEND-WORKFLOW.md §3）。
 */
function doGet() {
  var sheetReady = false;
  try { sheet_(); sheetReady = true; } catch (e) {}
  return ok_({
    service: 'uc-cloud-coach',
    stage: 3,
    channelConfigured: !!channelId_(),
    channelSource: prop_('LINE_CHANNEL_ID') ? 'script-property' : 'default-constant',
    sheetReady: sheetReady,
    hint: '這個端點只接 POST。action：auth.exchange / auth.bind'
  });
}

/* ── auth.exchange：驗 Token，回綁定狀態 ───────────── */

function authExchange_(body) {
  var v = verifyToken_(body.idToken);
  var b = findBindingByLine_(v.sub);

  if (!b) {
    /* 沒綁過 —— 前端據此顯示啟用碼輸入畫面。
       ⚠️ 這不是失敗，是正常的新使用者流程，所以照樣回 ok:true。 */
    return {
      verified: true,
      subMasked: maskSub_(v.sub),
      expiresInSec: expIn_(v),
      bound: false,
      nextAction: 'auth.bind',
      hint: '這個 LINE 帳號還沒有綁定學員，需要教練提供的一次性啟用碼。'
    };
  }

  if (b.status !== 'active') {
    throw new AppError('FORBIDDEN_STUDENT', '這個帳號已被停用');
  }

  touchLastLogin_(b.row);
  return {
    verified: true,
    subMasked: maskSub_(v.sub),
    expiresInSec: expIn_(v),
    bound: true,
    studentId: b.student_id,
    accessScope: b.access_scope,
    linkedAt: String(b.linked_at || '')
  };
}

/* ── auth.bind：一次性啟用碼 ───────────────────────── */

function authBind_(body) {
  var v = verifyToken_(body.idToken);
  var code = String(body.activationCode || '').trim().toUpperCase();
  if (!code) throw new AppError('INVALID_INPUT', '沒有帶啟用碼');

  /* ⚠️ 整段「找列 → 檢查 → 寫回」都要在鎖裡。
     兩個人同時送同一個啟用碼的話，沒有鎖就會兩個都綁成功。 */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError('CONFLICT', '系統忙碌，請再試一次');

  try {
    /* 已經綁過就不要重複綁 —— 直接回現況，當成冪等。 */
    var exist = findBindingByLine_(v.sub);
    if (exist && exist.status === 'active') {
      return { bound: true, studentId: exist.student_id,
               accessScope: exist.access_scope, note: '這個帳號先前已經綁定過' };
    }

    var sh = bindingSheet_();
    var rows = sh.getDataRange().getValues();
    var hash = hashCode_(code);
    var now = new Date();

    for (var i = 1; i < rows.length; i++) {
      var r = rowObj_(rows[i]);
      if (String(r.activation_code_hash) !== hash) continue;

      /* 找到碼了。三道檢查，**順序不能反** ——
         先確認沒用過、再確認沒過期，最後才確認狀態。 */
      if (r.activation_used_at) {
        throw new AppError('UNAUTHENTICATED', '這個啟用碼已經使用過了');
      }
      if (r.activation_expires_at && new Date(r.activation_expires_at) < now) {
        throw new AppError('UNAUTHENTICATED', '這個啟用碼已經過期');
      }
      if (r.status && r.status !== 'active') {
        throw new AppError('FORBIDDEN_STUDENT', '這筆綁定已被停用');
      }

      /* ⚠️ 一個 LINE 帳號只能有一筆 self。
         教練要管多位學員是 manage，那可以有多筆（§3）。 */
      if (r.access_scope === 'self' && hasSelfBinding_(rows, v.sub)) {
        throw new AppError('CONFLICT', '這個 LINE 帳號已經綁定其他學員');
      }

      var line = i + 1;   /* 試算表列號（1-based，且第 1 列是標題） */
      setCell_(sh, line, 'line_user_id', v.sub);
      setCell_(sh, line, 'activation_used_at', now);
      setCell_(sh, line, 'linked_at', now);
      setCell_(sh, line, 'last_login_at', now);
      setCell_(sh, line, 'status', 'active');
      SpreadsheetApp.flush();

      console.log('綁定成功 student=' + r.student_id + ' sub=' + maskSub_(v.sub));
      return { bound: true, studentId: r.student_id,
               accessScope: r.access_scope || 'self', linkedAt: now.toISOString() };
    }

    /* 找不到對應的雜湊。訊息刻意跟「已使用」「已過期」不同 ——
       那三種情況教練要用不同方式處理。 */
    throw new AppError('UNAUTHENTICATED', '啟用碼不正確');
  } finally {
    lock.releaseLock();
  }
}

/* ── 試算表存取（唯一入口）─────────────────────────── */

var _ss = null;

/**
 * ⚠️ **全站只有這一個函式可以打開試算表。**
 * 新增功能時不要自己呼叫 SpreadsheetApp.openById —— 那會繞過名稱檢查。
 */
function sheet_() {
  if (_ss) return _ss;

  var id = prop_('SHEET_ID');
  if (!id) throw new AppError('INTERNAL_ERROR', '指令碼屬性缺 SHEET_ID');

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw new AppError('INTERNAL_ERROR', '打不開指定的試算表'); }

  /* 第二道鎖：名字不對就中止。SHEET_ID 貼錯時，這行擋住所有讀寫。 */
  if (ss.getName() !== EXPECTED_SHEET_NAME) {
    console.error('試算表名稱不符，已中止。期待「' + EXPECTED_SHEET_NAME + '」');
    throw new AppError('INTERNAL_ERROR', '試算表設定有誤，已中止操作');
  }
  _ss = ss;
  return ss;
}

/** 取得「帳號綁定」分頁；不存在就照 §3 的欄位建一個。 */
function bindingSheet_() {
  var ss = sheet_();
  var sh = ss.getSheetByName(BINDING_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BINDING_SHEET);
    sh.getRange(1, 1, 1, BINDING_COLS.length).setValues([BINDING_COLS]);
    sh.setFrozenRows(1);
    console.log('已建立「' + BINDING_SHEET + '」分頁');
  }
  return sh;
}

function rowObj_(arr) {
  var o = {};
  for (var i = 0; i < BINDING_COLS.length; i++) o[BINDING_COLS[i]] = arr[i];
  return o;
}

function setCell_(sh, line, col, value) {
  sh.getRange(line, BINDING_COLS.indexOf(col) + 1).setValue(value);
}

function findBindingByLine_(sub) {
  var rows = bindingSheet_().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i]);
    if (String(r.line_user_id) === String(sub) && r.student_id) {
      r.row = i + 1;
      return r;
    }
  }
  return null;
}

function hasSelfBinding_(rows, sub) {
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i]);
    if (String(r.line_user_id) === String(sub) && r.access_scope === 'self'
        && r.activation_used_at) return true;
  }
  return false;
}

function touchLastLogin_(line) {
  try { setCell_(bindingSheet_(), line, 'last_login_at', new Date()); }
  catch (e) { console.warn('更新 last_login_at 失敗', e); }   /* 不該因此擋住登入 */
}

/* ── LINE ID Token 驗證 ────────────────────────────── */

function verifyToken_(idToken) {
  var t = String(idToken || '');
  if (!t) throw new AppError('UNAUTHENTICATED', '沒有帶 idToken');
  return verifyLineIdToken_(t, channelId_());
}

/**
 * 向 LINE 驗證 ID Token。
 * ⚠️ **不要自己解 JWT 來信任裡面的欄位。** 自己解等於只是讀了一段 base64，
 * 簽章、發行者、有效期都沒有檢查。一定要打 LINE 的端點。
 * client_id 傳進去，LINE 會順便幫我們比對 aud —— 不符會回 400。
 */
function verifyLineIdToken_(idToken, channelId) {
  if (!channelId) throw new AppError('INTERNAL_ERROR', '沒有可用的 Channel ID');

  var res = UrlFetchApp.fetch(LINE_VERIFY_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code !== 200) {
    /* LINE 回 { error, error_description }，例如
       invalid_request / "Invalid IdToken." 或 "IdToken expired."。
       ⚠️ 這兩個欄位**描述的是請求，不是使用者**，也不會回吐 Token，
       所以可以帶給前端 —— 沒有它，「過期了重登一次」和「Channel 設錯」
       在畫面上完全一樣，等於每次都要翻 Apps Script 的紀錄才知道發生什麼事。
       真正不能外流的是 stack、Sheet 內容與 Token 原文，那些仍然不回。 */
    var le = {};
    try { le = JSON.parse(text) || {}; } catch (e) {}
    console.warn('LINE verify 失敗 code=' + code + ' error=' + le.error);
    throw new AppError('UNAUTHENTICATED', 'ID Token 未通過 LINE 驗證',
      { httpStatus: code, lineError: le.error || null,
        lineErrorDescription: le.error_description || null });
  }

  var data;
  try { data = JSON.parse(text); }
  catch (e) { throw new AppError('INTERNAL_ERROR', 'LINE 回應無法解析'); }

  if (!data.sub) throw new AppError('UNAUTHENTICATED', 'LINE 回應沒有 sub');

  /* 再自己檢一次 aud 與 exp。LINE 已經檢過，但這裡是唯一的授權關口，
     多一道成本是零，少一道就沒有第二層。 */
  if (String(data.aud) !== String(channelId)) {
    console.warn('aud 不符 aud=' + data.aud);
    throw new AppError('UNAUTHENTICATED', 'ID Token 不是發給本 Channel 的',
      { expectedChannelTail: String(channelId).slice(-4),
        tokenAudTail: String(data.aud || '').slice(-4) });
  }
  if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
    throw new AppError('UNAUTHENTICATED', 'ID Token 已過期',
      { expiredSecAgo: Math.floor(Date.now() / 1000) - data.exp });
  }

  return data;
}

/* ── 共用小工具 ────────────────────────────────────── */

function AppError(code, message, detail) {
  this.code = code; this.message = message; this.detail = detail || null;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function channelId_() {
  return prop_('LINE_CHANNEL_ID') || DEFAULT_CHANNEL_ID;
}

function expIn_(v) {
  return v.exp ? Math.max(0, v.exp - Math.floor(Date.now() / 1000)) : null;
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

/**
 * 啟用碼只存雜湊，不存明碼（§3）。
 * 加鹽是因為啟用碼很短（8 碼），沒有鹽的話一張彩虹表就反查完了。
 * 鹽由 setup() 生成後存進 Script Properties，不進程式碼。
 */
function hashCode_(code) {
  var salt = prop_('CODE_SALT');
  if (!salt) throw new AppError('INTERNAL_ERROR', '指令碼屬性缺 CODE_SALT，請先跑 setup()');
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + code);
  return raw.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/** LINE user ID 是個人資料。日誌與回應一律只留前後各 4 字。 */
function maskSub_(sub) {
  var s = String(sub || '');
  return s.length <= 10 ? '（異常短）' : s.slice(0, 5) + '…' + s.slice(-4);
}

/* 統一回應格式（BACKEND-WORKFLOW.md §5）。 */

function ok_(data) {
  return out_({ ok: true, data: data, error: null, server_time: now_() });
}

function fail_(code, message, detail) {
  var e = { code: code, message: message };
  if (detail) e.detail = detail;
  return out_({ ok: false, data: null, error: e, server_time: now_() });
}

function out_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ══ 教練用的工具（在編輯器裡執行）══════════════════ */

/**
 * 第一次設定。做四件事：
 *   驗 SHEET_ID 與試算表名稱、生 CODE_SALT、建「帳號綁定」分頁、
 *   發一組給 STU-TEST-001 的啟用碼。
 *
 * ⚠️ 啟用碼**只會在執行紀錄裡出現這一次**（表裡只存雜湊）。
 * 沒抄到就再跑一次 newActivationCode('STU-TEST-001')。
 */
function setup() {
  var ss = sheet_();                       /* 這行同時驗了 SHEET_ID 與名稱 */
  console.log('試算表：' + ss.getName());

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CODE_SALT')) {
    props.setProperty('CODE_SALT', Utilities.getUuid() + Utilities.getUuid());
    console.log('已生成 CODE_SALT');
  } else {
    console.log('CODE_SALT 已存在，沿用');
  }

  bindingSheet_();
  var code = newActivationCode('STU-TEST-001', 14);
  console.log('setup 完成。分頁：' + ss.getSheets().map(function (s) {
    return s.getName();
  }).join('、'));
  return code;
}

/**
 * 發一組一次性啟用碼給某位學員。回傳明碼（只有這一次看得到）。
 * @param {string} studentId  學員 ID，例如 STU-TEST-001
 * @param {number} days       幾天後過期，預設 14
 */
function newActivationCode(studentId, days) {
  if (!studentId) throw new Error('要給 studentId');
  var sh = bindingSheet_();

  /* 避開容易看錯的字元：0/O、1/I/L。教練要用口頭或訊息把碼給學員。 */
  var ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 8; i++) code += ABC.charAt(Math.floor(Math.random() * ABC.length));

  var exp = new Date();
  exp.setDate(exp.getDate() + (days || 14));

  var row = [];
  for (var j = 0; j < BINDING_COLS.length; j++) row[j] = '';
  row[BINDING_COLS.indexOf('binding_id')] = 'BND-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  row[BINDING_COLS.indexOf('student_id')] = studentId;
  row[BINDING_COLS.indexOf('access_scope')] = 'self';
  row[BINDING_COLS.indexOf('status')] = 'active';
  row[BINDING_COLS.indexOf('activation_code_hash')] = hashCode_(code);
  row[BINDING_COLS.indexOf('activation_expires_at')] = exp;

  sh.appendRow(row);
  console.log('啟用碼（只顯示這一次）　' + studentId + ' → ' + code
    + '　有效至 ' + Utilities.formatDate(exp, 'Asia/Taipei', 'yyyy-MM-dd'));
  return code;
}

/* ── 本機自我檢查 ──────────────────────────────────
   在編輯器裡選這個函式按執行。不需要真的 Token。
   驗「錯誤路徑會不會乖乖回錯誤」與「試算表的鎖有沒有生效」。 */

function selftest() {
  var log = [], ok = true;
  function t(name, cond) { log.push((cond ? '  ok   ' : '  FAIL ') + name); if (!cond) ok = false; }
  function post(o) {
    return JSON.parse(doPost({ postData: { contents:
      typeof o === 'string' ? o : JSON.stringify(o) } }).getContent());
  }

  t('有可用的 Channel ID', !!channelId_());
  t('指令碼屬性有 SHEET_ID', !!prop_('SHEET_ID'));
  t('指令碼屬性有 CODE_SALT', !!prop_('CODE_SALT'));

  /* ⚠️ 只准碰一份表 —— 使用者的硬性要求，不能讓它靜靜壞掉。 */
  var ss = null;
  try { ss = sheet_(); } catch (e) {}
  t('打得開指定的試算表', !!ss);
  t('試算表名稱正是「' + EXPECTED_SHEET_NAME + '」',
    !!ss && ss.getName() === EXPECTED_SHEET_NAME);
  t('有「' + BINDING_SHEET + '」分頁', !!(ss && ss.getSheetByName(BINDING_SHEET)));

  var r0 = post('');
  t('空 body → INVALID_INPUT', !r0.ok && r0.error.code === 'INVALID_INPUT');
  var r1 = post({});
  t('空 action → INVALID_INPUT', !r1.ok && r1.error.code === 'INVALID_INPUT');
  var r2 = post('not json');
  t('壞 JSON → INVALID_INPUT', !r2.ok && r2.error.code === 'INVALID_INPUT');
  var r3 = post({ action: 'auth.exchange' });
  t('缺 idToken → UNAUTHENTICATED', !r3.ok && r3.error.code === 'UNAUTHENTICATED');
  var r4 = post({ action: 'auth.exchange', idToken: 'obviously.not.a.token' });
  t('假 Token → UNAUTHENTICATED', !r4.ok && r4.error.code === 'UNAUTHENTICATED');
  t('假 Token 的錯誤訊息不含 Token 原文',
    JSON.stringify(r4).indexOf('obviously.not.a.token') < 0);
  t('假 Token 有帶 LINE 的診斷欄位', !!(r4.error.detail && r4.error.detail.lineError));

  var r5 = post({ action: 'auth.bind', idToken: 'x.y.z' });
  t('auth.bind 也會先驗 Token', !r5.ok && r5.error.code === 'UNAUTHENTICATED');
  var r6 = post({ action: 'auth.bind', idToken: 'x.y.z', activationCode: 'AAAAAAAA' });
  t('Token 沒過就不會去檢查啟用碼', !r6.ok && r6.error.code === 'UNAUTHENTICATED');

  var r7 = JSON.parse(doGet().getContent());
  t('doGet 健康檢查可用', r7.ok === true && r7.data.stage === 3);
  t('doGet 不洩漏 Channel ID', JSON.stringify(r7).indexOf(channelId_()) < 0);
  t('doGet 不洩漏 SHEET_ID',
    !prop_('SHEET_ID') || JSON.stringify(r7).indexOf(prop_('SHEET_ID')) < 0);

  console.log('UC GAS selftest ' + (ok ? 'PASS' : 'FAIL') + '\n' + log.join('\n'));
  return ok;
}
