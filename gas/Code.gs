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
 *
 * 2026-09-12 起這支腳本**綁定在「高級雲端教練後台」底下**（容器繫結）——
 * 從試算表「擴充功能 → Apps Script」直接打得開，不必去雲端硬碟翻。
 * 綁定另一個好處是可以用簡單的 onOpen() 加選單，不必安裝觸發條件。
 *
 * ⚠️ 但**權限還是廣的**。容器繫結理論上可以把 scope 縮成
 * `spreadsheets.currentonly`（Google 強制只能碰容器），前提是
 * `SpreadsheetApp.getActive()` 在**匿名 web app 情境**下回傳得到容器 ——
 * 那一點沒有官方保證。所以這一版先維持 `openById` ＋ 完整 `spreadsheets`，
 * 並在 doGet 順手量 `getActive()` 的結果（`activeOk` / `activeNameMatches`）。
 * 量到 true 之後才值得花一次重新授權去把權限縮小。
 *
 * 在那之前，安全仍然靠三道程式鎖：
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

/* 所有教練共用的範例學員。使用者 2026-09-12：
   「設定一個按鈕只有在教練帳號有，點了就能開啟同一個範例學員帳號。」
   它就是「學員」分頁裡那位示範學員，不是特例帳號 —— 教練本來就能開任何學員，
   這顆按鈕只是省得從清單裡找。 */
var DEMO_STUDENT_ID = 'STU-DEMO-001';

/* 帳號綁定的欄位。前十個是 BACKEND-WORKFLOW.md §3 定的，順序不要改。
   後三個是教練實際用得到的（§3 沒列，2026-09-12 加）：

   student_name           學員自己在評測裡填的稱呼（B01）。接上作答後端之後自動帶入，
                          在那之前留空。**發碼時不需要填** —— 教練不用先知道學員叫什麼。
   line_display_name      LINE 的顯示名稱，綁定時自動記下來。純給教練認人用。
   reusable               TRUE 代表這一列是**可重複使用的樣板**（教練共用的授權碼）。
                          用掉不會作廢，而是替每個綁進來的 LINE 帳號另外長一列。
                          學員的碼一律留空 —— 一次性才是對的。
   activation_code_plain  ⚠️ **明碼**，只存在「發出」到「第一次使用」之間，
                          用掉的瞬間由 authBind_ 清空。
   note                   備註，純給人看。LINE 名稱跟本人對不起來的時候寫在這裡。

   ── 為什麼敢存明碼 ──
   原本只在執行紀錄印一次，教練沒抄到就得重發，實務上很痛。
   這份表是私人的，看得到它的人就是教練本人；而且碼一旦用掉就自動消失，
   殘留窗口只有「發出後、學員還沒綁」那段。
   ⚠️ 但**驗證永遠比對 activation_code_hash，不是比對明碼** ——
   明碼欄純粹是給人看的便條，被手動改掉也不會影響驗證。 */
var BINDING_COLS = ['binding_id', 'line_user_id', 'student_id', 'student_name',
                    'line_display_name',
                    'access_scope', 'reusable', 'status', 'activation_code_hash',
                    'activation_code_plain', 'activation_expires_at',
                    'activation_used_at', 'linked_at', 'last_login_at', 'note'];

/* 允許回給前端的錯誤分類（BACKEND-WORKFLOW.md §5）。
   不在這張表裡的一律變成 INTERNAL_ERROR —— 白名單，不是黑名單。 */
var KNOWN_ERRORS = ['UNAUTHENTICATED', 'UNBOUND_ACCOUNT', 'FORBIDDEN_STUDENT',
                    'INVALID_INPUT', 'CONFLICT'];

/* ── 對外入口 ──────────────────────────────────────── */

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || '');

    if (action === 'auth.exchange')  return ok_(authExchange_(body));
    if (action === 'auth.bind')      return ok_(authBind_(body));
    if (action === 'student.load')   return ok_(studentLoad_(body));
    /* ⚠️ 藍圖雖然是全體共用、沒有個資，仍然**要先驗身分** ——
       不驗的話任何人都能用一個亂打的 Token 叫 GAS 去動你的試算表
       （blueprintSheet_() 會建分頁）。踩過：上線第一次探測就中。 */
    if (action === 'blueprint.load') {
      requireBinding_(body);
      return ok_({ blueprint: blueprintLoad_() });
    }
    if (action === 'state.save')     return ok_(stateSaveAction_(body));
    if (action === 'student.list')   return ok_(studentListAction_(body));

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

  /* 探針：容器繫結的腳本在**匿名 web app**情境下，getActive() 拿不拿得到容器？
     拿得到才有機會把 scope 縮成 spreadsheets.currentonly。
     ⚠️ 只回布林，不回 ID —— 試算表名稱本來就是程式裡的公開常數，不算洩漏。 */
  var activeOk = false, activeNameMatches = false;
  try {
    var act = SpreadsheetApp.getActive();
    activeOk = !!act;
    activeNameMatches = !!act && act.getName() === EXPECTED_SHEET_NAME;
  } catch (e) {}

  return ok_({
    service: 'uc-cloud-coach',
    stage: 3,
    bound: true,
    activeOk: activeOk,
    activeNameMatches: activeNameMatches,
    channelConfigured: !!channelId_(),
    channelSource: prop_('LINE_CHANNEL_ID') ? 'script-property' : 'default-constant',
    sheetReady: sheetReady,
    hint: '這個端點只接 POST。action：auth.exchange / auth.bind / student.load / student.list / blueprint.load / state.save'
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
    var map = colMap_(sh);
    var rows = sh.getDataRange().getValues();
    var hash = hashCode_(code);
    var now = new Date();

    for (var i = 1; i < rows.length; i++) {
      var r = rowObj_(rows[i], map);
      if (String(r.activation_code_hash) !== hash) continue;

      /* 找到碼了。三道檢查，**順序不能反** ——
         先確認沒用過、再確認沒過期，最後才確認狀態。
         ⚠️ 可重複使用的樣板列跳過「用過了」那一關 —— 它本來就會被用很多次。 */
      var reusable = r.reusable === true || String(r.reusable).toUpperCase() === 'TRUE';
      if (!reusable && r.activation_used_at) {
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
      if (r.access_scope === 'self' && hasSelfBinding_(rows, map, v.sub)) {
        throw new AppError('CONFLICT', '這個 LINE 帳號已經綁定其他學員');
      }

      /* ⚠️ 樣板列**不可以就地改**。改下去的話第一個綁進來的人會把樣板吃掉，
         下一個教練就用不了同一組碼了。改成另外長一列，樣板原封不動。 */
      if (reusable) {
        var nrow = [], w = sh.getLastColumn();
        for (var c = 0; c < w; c++) nrow[c] = '';
        function put(col, val) { if (map[col]) nrow[map[col] - 1] = val; }
        put('binding_id', 'BND-' + Utilities.getUuid().slice(0, 8).toUpperCase());
        put('line_user_id', v.sub);
        put('student_id', r.student_id || '');
        put('access_scope', r.access_scope || 'manage');
        put('status', 'active');
        put('linked_at', now);
        put('last_login_at', now);
        put('note', '用共用授權碼綁定');
        if (body.displayName) put('line_display_name', String(body.displayName).slice(0, 40));
        sh.appendRow(nrow);
        SpreadsheetApp.flush();
        console.log('共用碼綁定成功 scope=' + (r.access_scope || 'manage')
                    + ' sub=' + maskSub_(v.sub));
        return { bound: true, studentId: r.student_id || '',
                 accessScope: r.access_scope || 'manage', linkedAt: now.toISOString() };
      }

      var line = i + 1;   /* 試算表列號（1-based，且第 1 列是標題） */
      setCell_(sh, line, 'line_user_id', v.sub);
      setCell_(sh, line, 'activation_used_at', now);
      setCell_(sh, line, 'linked_at', now);
      setCell_(sh, line, 'last_login_at', now);
      setCell_(sh, line, 'status', 'active');
      /* ⚠️ 明碼用掉就清掉。殘留窗口只該存在於「發出 → 第一次使用」之間。 */
      setCell_(sh, line, 'activation_code_plain', '');
      /* 前端若帶了 LINE 顯示名稱就順手記下來，表裡只有 student_id 對教練不好認人。
         ⚠️ 這是 **LINE 名稱**，不是本名 —— 兩者常常對不起來，所以分開存，
         不要覆蓋 student_name（那一欄是學員在評測裡自己填的稱呼）。 */
      if (body.displayName) {
        setCell_(sh, line, 'line_display_name', String(body.displayName).slice(0, 40));
      }
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

/* ══ 資料動作 ═══════════════════════════════════════════
   ⚠️ **studentId 一律從綁定表推出來，不從請求裡拿。**
   前端送什麼名字、什麼 ID 都不採信 —— 那是最容易被繞過的一環。
   只有 access_scope === 'manage' 的帳號才可以指定別人。 */

function requireBinding_(body) {
  var v = verifyToken_(body.idToken);
  var b = findBindingByLine_(v.sub);
  if (!b) throw new AppError('UNBOUND_ACCOUNT', '這個 LINE 帳號還沒有綁定學員');
  if (b.status !== 'active') throw new AppError('FORBIDDEN_STUDENT', '這個帳號已被停用');
  return b;
}

/** 這次請求可以動哪位學員。manage 才能指定別人，其餘一律是自己。 */
function targetStudent_(b, body) {
  var want = String(body.studentId || '').trim();
  if (!want || want === String(b.student_id)) return String(b.student_id);
  if (b.access_scope !== 'manage') {
    console.warn('越權存取被擋 from=' + b.student_id);
    throw new AppError('FORBIDDEN_STUDENT', '這個帳號不能存取那位學員的資料');
  }
  return want;
}

/* student.load —— 一次把這一頁要的東西全拿回去。
   ⚠️ 不可以讓 53 題各打一個請求（BACKEND-WORKFLOW.md §4）。
   藍圖也一起帶回來，省一個來回；要單獨重讀才用 blueprint.load。 */
function studentLoad_(body) {
  var b = requireBinding_(body);
  var sid = targetStudent_(b, body);
  touchLastLogin_(b.row);

  var answers = {}, raw = stateLoad_('assessment', sid);
  for (var q in raw) answers[q] = raw[q].answer;

  return {
    studentId: sid,
    /* 所有教練共用的範例學員。前端據此顯示「開啟範例學員」那顆按鈕。
       ⚠️ 回傳 id 不等於給權限 —— 真正能不能開，還是 targetStudent_() 說了算。 */
    demoStudentId: b.access_scope === 'manage' ? DEMO_STUDENT_ID : '',
    studentName: String(b.student_name || ''),
    lineDisplayName: String(b.line_display_name || ''),
    accessScope: b.access_scope || 'self',
    answers: answers,
    report: (stateLoad_('report', sid).report || {}),
    tasks: stateLoad_('task', sid),
    log: growthLoad_(sid),
    blueprint: blueprintLoad_()
  };
}

/* student.list —— 只有教練（access_scope === 'manage'）叫得動。
   ⚠️ 這個動作會回傳**所有學員的 id 與姓名**，是全站最該守的一道門。 */
function studentListAction_(body) {
  var b = requireBinding_(body);
  if (b.access_scope !== 'manage') {
    console.warn('非教練嘗試讀學員清單 from=' + b.student_id);
    throw new AppError('FORBIDDEN_STUDENT', '這個帳號不能查看學員清單');
  }
  return { students: studentList_() };
}

/* state.save —— 單格 patch。
   scope 決定寫哪張分頁，field 走哪張白名單。 */
function stateSaveAction_(body) {
  var b = requireBinding_(body);
  var sid = targetStudent_(b, body);

  var scope = String(body.scope || '');
  if (!STATE_SHEETS[scope]) throw new AppError('INVALID_INPUT', '不認識的資料範圍');

  var itemId = String(body.itemId || '').trim();
  var field = String(body.field || '').trim();
  if (!itemId || itemId.length > 60) throw new AppError('INVALID_INPUT', '項目 id 不正確');
  if (!field || field.length > 40) throw new AppError('INVALID_INPUT', '欄位名稱不正確');

  if (scope === 'assessment' && field !== 'answer') {
    throw new AppError('INVALID_INPUT', '評測只接受 answer 欄位');
  }
  if (scope === 'report') {
    if (itemId !== 'report') throw new AppError('INVALID_INPUT', '教練報告的項目 id 必須是 report');
    if (REPORT_FIELDS.indexOf(field) < 0) throw new AppError('INVALID_INPUT', '不認識的報告欄位');
  }
  if (scope === 'task' && TASK_FIELDS.indexOf(field) < 0) {
    throw new AppError('INVALID_INPUT', '不認識的任務欄位');
  }
  if (scope === 'growth' && field !== 'event') {
    throw new AppError('INVALID_INPUT', '成長紀錄只接受 event 欄位');
  }

  var value = body.value;
  /* 成長紀錄送的是整個事件物件，其他 scope 送的是單一值。 */
  if (scope !== 'growth' && value !== null && typeof value === 'object') {
    throw new AppError('INVALID_INPUT', '這個欄位不接受物件');
  }
  if (typeof value === 'string' && value.length > 8000) {
    throw new AppError('INVALID_INPUT', '內容太長');
  }

  /* ⚠️ 「報告完成」不能由前端說了算。前端也會檢查，但那是為了體驗（早點跳提示）；
     真正算數的是這裡 —— 五段說明與一封信都在表裡，才准設成 true。 */
  if (scope === 'report' && field === 'complete' && value === true) {
    var have = stateLoad_('report', sid).report || {};
    var missing = ['values', 'emo', 'image', 'circle', 'flirt'].filter(function (k) {
      var t = have['note.' + k];
      return typeof t !== 'string' || t.trim() === '';
    });
    if (typeof have.letter !== 'string' || have.letter.trim() === '') missing.push('letter');
    if (missing.length) {
      throw new AppError('INVALID_INPUT', '還有 ' + missing.length + ' 個欄位沒填完，不能開放報告');
    }
  }

  /* ⚠️ 「找列 → 新增／更新」整段包在鎖裡，否則兩個請求會各自新增一列。 */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError('CONFLICT', '系統忙碌，請再試一次');
  try {
    var at = stateSave_(scope, sid, itemId, field,
                        String(body.label || '').slice(0, 60), value,
                        String(body.requestId || '').slice(0, 60),
                        String(body.display == null ? '' : body.display).slice(0, 200));
    SpreadsheetApp.flush();
    /* ⚠️ now_() 回的是**字串**（Utilities.formatDate），不是 Date。
       這裡原本寫 at.toISOString()，於是每一次 state.save 都丟 TypeError，
       被 doPost 的 catch 收成 INTERNAL_ERROR —— 前端看到的是「連不上伺服器」。
       更糟的是格子其實已經寫進去了，只有回應炸掉，所以會一直重試（踩過）。 */
    return { saved: true, scope: scope, itemId: itemId, field: field,
             value: value, updatedAt: at };
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

/** 取得「帳號綁定」分頁；不存在就建，欄位不齊就補齊。 */
function bindingSheet_() {
  var ss = sheet_();
  var sh = ss.getSheetByName(BINDING_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BINDING_SHEET);
    sh.getRange(1, 1, 1, BINDING_COLS.length).setValues([BINDING_COLS]);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 130);
    console.log('已建立「' + BINDING_SHEET + '」分頁');
    return sh;
  }

  /* ⚠️ 既有的表要能就地升級。第一版只有 10 欄，後來加了姓名、明碼、備註。
     不做這段的話，rowObj_ 會把欄位對到錯的格子 —— 那是無聲的資料錯亂。
     只補在**最後面**，不重排既有欄位。 */
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x || ''); });
  var missing = BINDING_COLS.filter(function (c) { return have.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    console.log('「' + BINDING_SHEET + '」補上欄位：' + missing.join('、'));
  }
  return sh;
}

/** 讀表頭，回「欄名 → 欄號(1-based)」。**不要假設欄序跟 BINDING_COLS 一樣** ——
    舊表升級後新欄在最後面，寫死順序會對錯格子。 */
function colMap_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  for (var i = 0; i < head.length; i++) m[String(head[i])] = i + 1;
  return m;
}

function rowObj_(arr, map) {
  var o = {};
  for (var k in map) o[k] = arr[map[k] - 1];
  return o;
}

function setCell_(sh, line, col, value) {
  var c = colMap_(sh)[col];
  if (!c) throw new AppError('INTERNAL_ERROR', '「帳號綁定」缺欄位 ' + col);
  sh.getRange(line, c).setValue(value);
}

function findBindingByLine_(sub) {
  var sh = bindingSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.line_user_id) === String(sub) && r.student_id) {
      r.row = i + 1;
      return r;
    }
  }
  return null;
}

function hasSelfBinding_(rows, map, sub) {
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
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
  rehashPlainCodes_();

  /* 資料分頁。藍圖只在空的時候灌一次，之後試算表上的內容才是唯一來源。 */
  blueprintSheet_();
  seedBlueprint_();
  /* 三張骨架分頁本來就存在，只補缺的欄位，既有版面一格不動。 */
  for (var scope in SKEL) skelSheet_(scope);

  /* 容器繫結用簡單 onOpen，不需要安裝觸發條件。 */

  /* ⚠️ **不要在這裡自動發新的啟用碼。** 舊版會，結果每跑一次 setup
     就往正式表塞一列測試資料。發碼改用選單或 newActivationCode()。 */
  console.log('setup 完成。分頁：' + ss.getSheets().map(function (s) {
    return s.getName();
  }).join('、'));
  console.log('要發啟用碼：試算表上的「UC 雲端教練」選單，或執行 newActivationCode(\'STU-001\')');
}

/**
 * 用目前的 CODE_SALT 重算「還沒用掉」的啟用碼雜湊。
 *
 * ⚠️ 這是搬家用的。指令碼屬性不會跟著程式走，所以新專案的 CODE_SALT 是新的，
 * 而表裡既有的 activation_code_hash 是用**舊鹽**算的 —— 不處理的話，
 * 所有還沒用掉的碼會突然全部「不正確」，而且看不出原因。
 *
 * 因為 activation_code_plain 還留著（用掉才清空），所以可以無損重算。
 * 已經用掉的列不碰：明碼早就清了，hash 也不再被查詢。
 * 沒有明碼可依據的未使用列會被列出來 —— 那些只能重發。
 */
function rehashPlainCodes_() {
  var sh = bindingSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var fixed = 0, orphan = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (r.activation_used_at) continue;              /* 用過了，不管 */
    if (!r.activation_code_hash) continue;           /* 空列 */
    if (!r.activation_code_plain) { orphan.push(r.student_id || ('第 ' + (i + 1) + ' 列')); continue; }
    var want = hashCode_(String(r.activation_code_plain).trim().toUpperCase());
    if (String(r.activation_code_hash) === want) continue;   /* 已經對了 */
    setCell_(sh, i + 1, 'activation_code_hash', want);
    fixed++;
  }
  if (fixed) console.log('已用新的 CODE_SALT 重算 ' + fixed + ' 組還沒用掉的啟用碼');
  if (orphan.length) {
    console.warn('這些未使用的碼沒有明碼可依據，只能重發：' + orphan.join('、'));
  }
  return { fixed: fixed, orphan: orphan };
}

/**
 * 發一組一次性啟用碼給某位學員，寫進「帳號綁定」分頁。
 * 明碼會同時寫進表裡（用掉自動清空），所以不必急著抄執行紀錄。
 * @param {string} studentId  學員 ID，例如 STU-TEST-001
 * @param {string} name       學員姓名（通常省略 —— 綁定時會自動帶 LINE 名稱進來）
 * @param {number} days       幾天後過期，預設 14
 */
function newActivationCode(studentId, name, days, scope, reusable) {
  if (!studentId && scope !== 'manage') throw new Error('要給 studentId');
  var sh = bindingSheet_();
  var map = colMap_(sh);

  /* 避開容易看錯的字元：0/O、1/I/L。教練要用口頭或訊息把碼給學員。 */
  var ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 8; i++) code += ABC.charAt(Math.floor(Math.random() * ABC.length));

  var exp = new Date();
  exp.setDate(exp.getDate() + (days || 14));

  /* ⚠️ 照**表頭**排，不要照 BINDING_COLS 排 —— 舊表升級後新欄在最後面。 */
  var width = sh.getLastColumn();
  var row = [];
  for (var j = 0; j < width; j++) row[j] = '';
  function put(col, val) { if (map[col]) row[map[col] - 1] = val; }
  put('binding_id', 'BND-' + Utilities.getUuid().slice(0, 8).toUpperCase());
  put('student_id', studentId || '');
  put('student_name', name || '');
  put('access_scope', scope === 'manage' ? 'manage' : 'self');
  put('reusable', reusable === true);
  put('status', 'active');
  put('activation_code_hash', hashCode_(code));
  put('activation_code_plain', code);
  put('activation_expires_at', exp);

  sh.appendRow(row);
  console.log('啟用碼　' + studentId + (name ? '（' + name + '）' : '') + ' → ' + code
    + '　有效至 ' + Utilities.formatDate(exp, 'Asia/Taipei', 'yyyy-MM-dd')
    + '　（也已寫進「帳號綁定」分頁）');
  return code;
}

/* ── 試算表上的選單 ────────────────────────────────
   讓教練不用進 Apps Script 編輯器就能發碼。
   容器繫結之後可以用**簡單觸發條件** —— 不必安裝、不必 script.scriptapp 權限。
   （獨立式的舊版要靠 ScriptApp.newTrigger 安裝，那段已經拿掉。） */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('UC 雲端教練')
    .addItem('發新的啟用碼…', 'menuNewCode')
    .addItem('發教練用的共用授權碼…', 'menuCoachCode')
    .addItem('把某個帳號升級成教練…', 'menuMakeCoach')
    .addItem('查這份表的狀態', 'menuStatus')
    .addToUi();
}

function menuNewCode() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('發新的啟用碼', '學員 ID（例如 STU-001）', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var id = a.getResponseText().trim();
  if (!id) { ui.alert('沒有輸入學員 ID'); return; }

  /* 姓名不問。學員綁定時會帶 LINE 名稱進來，評測填完之後 student_name 也會自己長出來。
     教練要備註「這個 LINE 名稱是誰」就直接在表裡的 note 欄寫。 */
  var code = newActivationCode(id);
  ui.alert('啟用碼：' + code
    + '\n\n已經寫進「' + BINDING_SHEET + '」分頁，學員用掉之後那一格會自動清空。'
    + '\n14 天後過期。');
}

/* 教練用的授權碼：可重複使用、access_scope = manage、不綁特定學員。
   使用者 2026-09-12：「教練可以都用同一個驗證碼授權身份。」 */
function menuCoachCode() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.alert('發教練用的共用授權碼',
    '這組碼可以**重複使用**，拿到的人都會變成教練身分（看得到所有學員）。\n\n'
    + '⚠️ 跟學員用的一次性啟用碼不一樣，不要混著給。\n\n要繼續嗎？',
    ui.ButtonSet.OK_CANCEL);
  if (a !== ui.Button.OK) return;
  var code = newActivationCode('', '教練共用', 3650, 'manage', true);
  ui.alert('教練授權碼：' + code
    + '\n\n可重複使用，十年後過期。\n'
    + '要作廢的話，去「' + BINDING_SHEET + '」把那一列的 status 改成 disabled。');
}

/* 把既有的綁定升級成教練。
   使用者 2026-09-12：「我現在用的這個帳號可以轉換成教練認證帳號」——
   已經綁好的帳號不需要重發碼、重綁一次，把 access_scope 改掉就好。

   ⚠️ 只改 access_scope 這一格，line_user_id 與 student_id 一律不動 ——
   動了等於把這個人換成另一個人。 */
function menuMakeCoach() {
  var ui = SpreadsheetApp.getUi();
  var sh = bindingSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();

  /* 先把現有的綁定列出來，讓你照著抄，不要用猜的。 */
  var list = [], lineOf = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (!r.line_user_id) continue;                 /* 還沒有人綁的樣板列跳過 */
    var who = String(r.student_id || '（沒有學員 id）');
    list.push(who + '　' + (r.line_display_name || '') + '　目前：' + (r.access_scope || 'self'));
    lineOf[who] = i + 1;
  }
  if (!list.length) { ui.alert('「' + BINDING_SHEET + '」裡還沒有任何已綁定的帳號。'); return; }

  var a = ui.prompt('把某個帳號升級成教練',
    '已綁定的帳號：\n' + list.join('\n')
    + '\n\n輸入要升級的 student_id：', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var id = a.getResponseText().trim();
  var line = lineOf[id];
  if (!line) { ui.alert('找不到 student_id「' + id + '」的綁定。'); return; }

  setCell_(sh, line, 'access_scope', 'manage');
  SpreadsheetApp.flush();
  ui.alert('已升級：' + id + ' → 教練（manage）\n\n'
    + '請那個 LINE 帳號重新開一次網站，就會看到「學員」分頁與所有學員清單。\n'
    + '要降回學員的話，把那一列的 access_scope 改回 self。');
}

function menuStatus() {
  var sh = bindingSheet_(), map = colMap_(sh);
  var rows = sh.getDataRange().getValues();
  var issued = 0, used = 0, pending = 0;
  for (var i = 1; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (!r.activation_code_hash) continue;
    issued++;
    if (r.activation_used_at) used++; else pending++;
  }
  SpreadsheetApp.getUi().alert(
    '試算表：' + sheet_().getName()
    + '\n已發出的啟用碼：' + issued
    + '\n　已綁定：' + used
    + '\n　還沒用：' + pending);
}

/* ── 本機自我檢查 ──────────────────────────────────
   在編輯器裡選這個函式按執行。不需要真的 Token。
   驗「錯誤路徑會不會乖乖回錯誤」與「試算表的鎖有沒有生效」。 */

function selftest() {
  var log = [], ok = true;
  _ss = null;                    /* 清掉快取，確保這次是真的重開一次 */
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

  /* 欄位齊不齊很重要 —— 缺一欄的話 rowObj_ 會把值對到別的欄位，
     那是無聲的資料錯亂，不會報錯。 */
  var miss = [];
  if (ss && ss.getSheetByName(BINDING_SHEET)) {
    var cm = colMap_(bindingSheet_());
    miss = BINDING_COLS.filter(function (c) { return !cm[c]; });
  }
  t('「' + BINDING_SHEET + '」欄位齊全' + (miss.length ? '（缺 ' + miss.join('、') + '）' : ''),
    miss.length === 0);

  /* 搬家之後最容易無聲壞掉的一件事：鹽換了，舊 hash 對不上。
     有明碼可以驗，就一定要驗。 */
  var mismatch = [];
  try {
    var s3 = bindingSheet_(), m3 = colMap_(s3), r3 = s3.getDataRange().getValues();
    for (var k = 1; k < r3.length; k++) {
      var rw = rowObj_(r3[k], m3);
      if (rw.activation_used_at || !rw.activation_code_hash || !rw.activation_code_plain) continue;
      if (hashCode_(String(rw.activation_code_plain).trim().toUpperCase())
          !== String(rw.activation_code_hash)) mismatch.push(rw.student_id);
    }
  } catch (e) {}
  t('未使用的啟用碼雜湊對得上目前的鹽' + (mismatch.length ? '（' + mismatch.join('、') + '）' : ''),
    mismatch.length === 0);

  /* 已經用掉的碼不該還留著明碼。 */
  var leaked = [];
  try {
    var sh2 = bindingSheet_(), m2 = colMap_(sh2), rs = sh2.getDataRange().getValues();
    for (var i = 1; i < rs.length; i++) {
      var rr = rowObj_(rs[i], m2);
      if (rr.activation_used_at && rr.activation_code_plain) leaked.push(rr.student_id);
    }
  } catch (e) {}
  t('已使用的啟用碼沒有殘留明碼' + (leaked.length ? '（' + leaked.join('、') + '）' : ''),
    leaked.length === 0);

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

  /* ── 資料層 ────────────────────────────────────── */

  var r8 = post({ action: 'student.load', idToken: 'x.y.z' });
  t('student.load 要先驗 Token', !r8.ok && r8.error.code === 'UNAUTHENTICATED');
  var r9 = post({ action: 'state.save', idToken: 'x.y.z', scope: 'assessment' });
  t('state.save 要先驗 Token', !r9.ok && r9.error.code === 'UNAUTHENTICATED');
  var r9b = post({ action: 'student.list', idToken: 'x.y.z' });
  t('student.list 要先驗 Token', !r9b.ok && r9b.error.code === 'UNAUTHENTICATED');

  /* 學員清單是全站最該守的門 —— 不是 manage 就不能叫。 */
  var scopeOk = true;
  try {
    studentListAction_.call(null, {});
    scopeOk = false;
  } catch (e) { scopeOk = e instanceof AppError; }
  t('student.list 沒有 Token 時丟的是 AppError', scopeOk);
  t('綁定表有 reusable 欄位', !!(ss && colMap_(bindingSheet_()).reusable));

  t('有「' + BLUEPRINT_SHEET + '」分頁', !!(ss && ss.getSheetByName(BLUEPRINT_SHEET)));
  var bpMiss = [];
  if (ss && ss.getSheetByName(BLUEPRINT_SHEET)) {
    var bm = colMap_(blueprintSheet_());
    bpMiss = BLUEPRINT_COLS.filter(function (c) { return !bm[c]; });
  }
  t('「' + BLUEPRINT_SHEET + '」欄位齊全' + (bpMiss.length ? '（缺 ' + bpMiss.join('、') + '）' : ''),
    bpMiss.length === 0);

  var bp = [];
  try { bp = blueprintLoad_(); } catch (e) {}
  t('藍圖讀得到內容（目前 ' + bp.length + ' 條）', bp.length > 0);
  var dupe = {}, dupeIds = [];
  bp.forEach(function (x) { if (dupe[x.id]) dupeIds.push(x.id); dupe[x.id] = 1; });
  t('kr_id 沒有重複' + (dupeIds.length ? '（' + dupeIds.join('、') + '）' : ''), dupeIds.length === 0);
  t('每條 KR 都有內容', bp.every(function (x) { return x.kr !== ''; }));

  var scMiss = [];
  for (var sc in SKEL) {
    var shx = ss && ss.getSheetByName(SKEL[sc].sheet);
    if (!shx) { scMiss.push(SKEL[sc].sheet + '（沒有分頁）'); continue; }
    var cmx = skelMap_(skelSheet_(sc));
    SKEL[sc].need.forEach(function (c) { if (!cmx[c]) scMiss.push(SKEL[sc].sheet + '/' + c); });
  }
  t('三張學員分頁欄位齊全' + (scMiss.length ? '（缺 ' + scMiss.join('、') + '）' : ''),
    scMiss.length === 0);
  t('骨架分頁的表頭讀的是第 5 列', SKEL_HEADER_ROW === 5);

  /* value 一律 JSON —— 直接存原值的話 Sheet 會把 "01" 變成 1（踩過）。 */
  t('value 編碼可往返', decodeValue_(encodeValue_('01')) === '01'
    && decodeValue_(encodeValue_(0)) === 0
    && decodeValue_(encodeValue_(false)) === false
    && String(decodeValue_(encodeValue_([1, 2]))) === '1,2');

  t('報告欄位白名單涵蓋五維與信',
    REPORT_FIELDS.indexOf('note.values') >= 0 && REPORT_FIELDS.indexOf('adjust.flirt') >= 0
    && REPORT_FIELDS.indexOf('letter') >= 0 && REPORT_FIELDS.indexOf('complete') >= 0
    && REPORT_FIELDS.indexOf('letter; DROP') < 0);

  /* ⚠️ **寫入路徑一定要真的寫一次。**
     原本 selftest 只驗「沒有 Token 會被擋」，所以 state.save 裡
     `at.toISOString()`（now_() 其實回字串）這種錯完全測不到 ——
     上線之後每一次存檔都失敗，前端顯示「連不上伺服器」（踩過）。
     用一個哨兵 student_id 寫進去、讀回來、再刪掉。 */
  var SENTINEL = '__selftest__';
  try {
    var wsh = skelSheet_('assessment');
    var before = wsh.getLastRow();
    var at = stateSave_('assessment', SENTINEL, 'Q-TEST', 'answer', '自我檢查', '01', 'req-1', '零一');
    t('state.save 寫得進去', !!at);
    t('updated_at 是可以直接放進 JSON 的值', typeof at === 'string' && at.length > 10);
    var back = stateLoad_('assessment', SENTINEL);
    t('寫進去的值讀得回來，而且沒被 Sheet 改型別',
      !!back['Q-TEST'] && back['Q-TEST'].answer === '01');
    /* 同一個 request_id 重送不可以多長一列。 */
    stateSave_('assessment', SENTINEL, 'Q-TEST', 'answer', '自我檢查', '02', 'req-1', '零二');
    var after = stateLoad_('assessment', SENTINEL);
    t('重送同一筆是更新不是新增', after['Q-TEST'].answer === '02');
    t('哨兵只佔一列', wsh.getLastRow() === before + 1);

    /* 整個回應組得出來嗎 —— 這一步才是當初炸掉的地方。 */
    var packed = null, packErr = '';
    try {
      packed = JSON.parse(ok_({ saved: true, updatedAt: at }).getContent());
    } catch (e) { packErr = String(e); }
    t('存檔回應組得出 JSON' + (packErr ? '（' + packErr + '）' : ''),
      !!packed && packed.ok === true);

    /* 收尾：把哨兵列刪掉，不要留在正式表裡。 */
    var wmap = skelMap_(wsh);
    var wlast = wsh.getLastRow();
    var wrows = wsh.getRange(SKEL_HEADER_ROW + 1, 1, wlast - SKEL_HEADER_ROW,
                             wsh.getLastColumn()).getValues();
    for (var w = wrows.length - 1; w >= 0; w--) {
      if (String(rowObj_(wrows[w], wmap).student_id) === SENTINEL) {
        wsh.deleteRow(SKEL_HEADER_ROW + 1 + w);
      }
    }
    var left = stateLoad_('assessment', SENTINEL);
    t('哨兵資料已經清乾淨', Object.keys(left).length === 0);
  } catch (e) {
    t('寫入路徑自我檢查沒有丟例外（' + String(e) + '）', false);
  }

  var r7 = JSON.parse(doGet().getContent());
  t('doGet 健康檢查可用', r7.ok === true && r7.data.stage === 3);
  t('doGet 不洩漏 Channel ID', JSON.stringify(r7).indexOf(channelId_()) < 0);
  t('doGet 不洩漏 SHEET_ID',
    !prop_('SHEET_ID') || JSON.stringify(r7).indexOf(prop_('SHEET_ID')) < 0);

  console.log('UC GAS selftest ' + (ok ? 'PASS' : 'FAIL') + '\n' + log.join('\n'));
  return ok;
}
