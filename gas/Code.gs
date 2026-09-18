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

/* ⚠️ selftest 會故意送空 body、壞 JSON 與假 Token 進去撞錯誤路徑，
   所以執行紀錄裡會出現一整排黃色警告 —— 那些是**預期的**。
   問題是：真的出事的時候也會混在那堆黃字裡，看不出來。
   所以自我檢查期間把訊息標起來、降成 info。 */
var IN_SELFTEST = false;

function logProbe_(msg) {
  if (IN_SELFTEST) console.log('　（自我檢查的預期錯誤）' + msg);
  else console.warn(msg);
}

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
  /* ⚠️ **每個請求都記耗時。** 效能問題在 GAS 上特別難查：
     使用者只知道「很慢」，而平台固定成本（1.5～2.5 秒）跟我們的程式碼
     混在同一個數字裡。有了這一行，執行紀錄就能直接看出
     「腳本裡花了幾毫秒」，跟瀏覽器量到的總時間相減就是平台與網路的部分。 */
  var t0 = Date.now();
  lapReset_();
  try {
    var body = parseBody_(e);
    var action = String(body.action || '');

    if (action === 'auth.exchange')  return ok_(perf_(t0, action, authExchange_(body)));
    if (action === 'auth.bind')      return ok_(perf_(t0, action, authBind_(body)));
    if (action === 'student.load')   return ok_(perf_(t0, action, studentLoad_(body)));
    /* ⚠️ 藍圖雖然是全體共用、沒有個資，仍然**要先驗身分** ——
       不驗的話任何人都能用一個亂打的 Token 叫 GAS 去動你的試算表
       （blueprintSheet_() 會建分頁）。踩過：上線第一次探測就中。 */
    if (action === 'blueprint.load') {
      requireBinding_(body);
      return ok_(perf_(t0, action, { blueprint: blueprintLoad_() }));
    }
    if (action === 'state.save')     return ok_(perf_(t0, action, stateSaveAction_(body)));
    if (action === 'growth.delete')  return ok_(perf_(t0, action, growthDeleteAction_(body)));
    if (action === 'student.list')   return ok_(perf_(t0, action, studentListAction_(body)));

    return fail_('INVALID_INPUT', '不認識的 action：' + (action || '（空白）'));
  } catch (err) {
    /* ⚠️ 絕對不要把 err.stack、Sheet 內容或 Token 回給前端。
       細節留在 Apps Script 的執行紀錄裡，前端只拿到分類。

       ⚠️ 但**分類要保留**。原本這裡一律回 INTERNAL_ERROR，
       結果「Token 過期」跟「伺服器壞了」在前端長得一模一樣 ——
       前者該叫使用者重新登入，後者該叫他等一下再試（踩過）。
       我們自己丟的 AppError 帶著分類，照原樣回；只有非預期的例外才是 INTERNAL_ERROR。 */
    if (err instanceof AppError && KNOWN_ERRORS.indexOf(err.code) >= 0) {
      logProbe_('doPost 已知錯誤 ' + err.code);
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

  lap_('查綁定');
  /* 從快取來的列號不可信（見 findBindingByLine_）。兩分鐘內本來就記過了。 */
  if (!b.fromCache) touchLastLogin_(b.row);
  lap_('記登入時間');

  var out = {
    verified: true,
    subMasked: maskSub_(v.sub),
    expiresInSec: expIn_(v),
    bound: true,
    studentId: b.student_id,
    accessScope: b.access_scope,
    linkedAt: String(b.linked_at || '')
  };

  /* ⚠️ **順手把 student.load 的整包一起帶回去。**
     登入本來要兩支連續請求（auth.exchange 再 student.load），
     而 GAS 每支請求的固定成本就是 1.5～2.5 秒（實測），
     所以「有兩支」這件事本身就是 3～5 秒，還沒開始做事。

     這裡手上已經有驗過的綁定 b，組 payload 只多幾次讀取、不多一次往返。
     前端拿到 payload 就直接用，跳過第二支。

     ⚠️ 失敗**不要讓整個登入跟著失敗** —— 拿不到就退回舊流程（前端自己再打一次），
     登入能不能成功不該取決於這個最佳化。 */
  try {
    /* 只帶登入要用的那幾包；成長與作業由前端畫完之後在背景補。
       ⚠️ **教練也一樣。** 原本教練一次載齊，理由是他會到處跳 ——
       但 2026-09-17 量到「讀作業 ＋ 讀成長」在登入路徑上是 1.3～2.4 秒
       （每次 getDataRange 本身就要 300～2000ms 而且會抖），
       而前端本來就會在畫完之後自己補。多等的是背景，不是使用者。 */
    out.payload = studentPayload_(b, String(b.student_id || ''), 'boot');

    /* ⚠️ **教練登入的第一件事是挑學員，不是看自己的資料。**
       2026-09-18 實測：教練登入要打三次請求（exchange / load / list），
       每一次都付一遍 1.4～1.9 秒的平台地板 —— 平台成本現在比腳本還大，
       所以能省的是「次數」，不是「每次跑多快」。

       清單順手帶回來幾乎不用錢：兩張進度表在上面的 boot 已經讀進 _skel，
       綁定表也在 requireBinding_ 時讀過了（_bread），
       真正多花的只有「學員」那一張（實測 292～627ms）——
       換掉的是一整趟 2.7～3.2 秒的往返。 */
    if (b.access_scope === 'manage') {
      out.students = studentList_();
      lap_('順手帶學員清單');
    }
  } catch (e) {
    console.warn('auth.exchange 順帶載入失敗，前端會自己再打一次：' + e);
  }
  return out;
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
    var b = bindingBody_(sh);
    var map = b.map, rows = b.rows;
    var hash = hashCode_(code);
    var now = new Date();

    for (var i = 0; i < rows.length; i++) {
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

      var line = b.first + i;   /* 試算表上的實際列號 */
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
      bindingCacheClear_();      /* 綁定關係變了，舊的世代一次全部作廢 */
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
  lap_('查綁定');
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
  /* ⚠️ **不要在這裡 touchLastLogin_。** auth.exchange 已經記過了（同一次登入），
     而這一行會再開一次 bindingSheet_ → 又一輪寫入。
     而且教練用 switchStudent 切換學員也走這條路，那更不該把「最後登入時間」往後推。 */
  var part = String(body.part || '');
  return studentPayload_(b, sid, part === 'boot' || part === 'rest' ? part : null);
}

/** 組一位學員的整包資料。auth.exchange 與 student.load 共用同一份實作。 */
/**
 * 組一位學員的資料。
 *
 * ⚠️ **不要一次讀六張表。** 實測一次試算表讀取約 300ms，六次就是 1.8 秒，
 * 而那是 5.5 秒總時間裡最大的一塊。
 *
 * 但登入後第一眼落地的頁面（評測／報告／藍圖）**一定用不到成長紀錄與作業** ——
 * 那兩包只有 #/growth 與作業頁會碰。所以分成兩段：
 *
 *   part = 'boot'  登入要的：答案、報告、任務、藍圖（藍圖有快取，約 36ms）
 *   part = 'rest'  背景補的：成長紀錄、作業
 *   不給 part      全部（教練那條路照舊一次載齊，他本來就會到處看）
 *
 * 前端畫完第一頁之後才去要 'rest'，所以使用者完全等不到它。
 * ⚠️ 'rest' 回來只能**填空的那幾格**，不可以整包蓋掉 ——
 * 中間那兩秒使用者可能已經在填東西了（見 store.js 的 mergeRest）。
 */
function studentPayload_(b, sid, part) {
  var wantBoot = part !== 'rest';
  var wantRest = part !== 'boot';

  var out = {
    studentId: sid,
    part: part || 'all',
    /* 所有教練共用的範例學員。前端據此顯示「開啟範例學員」那顆按鈕。
       ⚠️ 回傳 id 不等於給權限 —— 真正能不能開，還是 targetStudent_() 說了算。 */
    demoStudentId: b.access_scope === 'manage' ? DEMO_STUDENT_ID : '',
    studentName: String(b.student_name || ''),
    lineDisplayName: String(b.line_display_name || ''),
    accessScope: b.access_scope || 'self'
  };

  if (wantBoot) {
    /* 三張表一個請求抓完（見 Data.gs 的 skelPreload_）。
       失敗的話 skelRead_ 自己會逐張讀，行為不變、只是慢回原本的樣子。 */
    skelPreload_(['assessment', 'report', 'task']);
    lap_('批次讀三表');

    var answers = {}, raw = stateLoad_('assessment', sid);
    for (var q in raw) answers[q] = raw[q].answer;
    out.answers = answers;
    lap_('讀答案');

    out.report = (stateLoad_('report', sid).report || {});
    lap_('讀報告');
    out.tasks = stateLoad_('task', sid);
    lap_('讀任務');
    out.blueprint = blueprintLoad_();
    lap_('讀藍圖');
    /* 課程連結跟藍圖一樣是全體共用、有快取，所以放在 boot 幾乎不花時間。 */
    out.links = linksLoad_();
    lap_('讀連結');
  }

  if (wantRest) {
    out.assignments = stateLoad_('assignment', sid);
    lap_('讀作業');
    out.log = growthLoad_(sid);
    lap_('讀成長');
  }
  return out;
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

/* 欄位的寫入角色由後端決定，不能只靠前端 disabled。
   self：自己的評測、成長紀錄與作業；manage：上述全部，另可寫報告與任務設定。 */
function canWriteScope_(binding, scope) {
  if (!binding) return false;
  if (scope === 'report' || scope === 'task') return binding.access_scope === 'manage';
  return ['assessment', 'growth', 'assignment'].indexOf(scope) >= 0;
}

function requireWriteScope_(binding, scope) {
  if (!canWriteScope_(binding, scope)) {
    throw new AppError('FORBIDDEN_FIELD', '只有教練可以修改這項內容');
  }
}

/* growth.delete —— 刪掉一筆成長紀錄。
   ⚠️ **真的刪掉那一列**，不是在本機隱藏。前端的 mergeRest 是「以 id 做聯集」，
   伺服器上還在的話，下一次同步就會把它撈回來，使用者會以為刪除壞掉了。
   ⚠️ 學員只能刪自己寫的；教練誰的都能刪。判斷依據是**表上的 author_role**，
   不是前端送來的值 —— 前端送什麼都不採信。 */
function growthDeleteAction_(body) {
  var b = requireBinding_(body);
  var sid = targetStudent_(b, body);
  requireWriteScope_(b, 'growth');

  var id = String(body.eventId || '').trim();
  if (!id) throw new AppError('INVALID_INPUT', '沒有指定要刪除的紀錄');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = skelSheet_('growth'), map = skelMap_(sh);
    var line = findRow_(sh, map, function (r) {
      return String(r.student_id) === String(sid) && String(r.event_id) === id;
    });
    if (!line) return { deleted: false, reason: 'not_found' };   /* 找不到＝已經刪過，不是錯誤 */

    var row = sh.getRange(line, 1, 1, sh.getLastColumn()).getValues()[0];
    var owner = String(rowObj_(row, map).author_role || 'student');
    if (b.access_scope !== 'manage' && owner !== 'student') {
      throw new AppError('FORBIDDEN_FIELD', '這筆紀錄是教練寫的，只有教練可以刪除');
    }
    sh.deleteRow(line);
    skelDrop_('growth');          /* 刪完之後同一次執行再讀要拿到新的 */
    console.log('刪除成長紀錄 student=' + sid + ' event=' + id);
    return { deleted: true, eventId: id };
  } finally {
    lock.releaseLock();
  }
}

/* state.save —— 單格 patch。
   scope 決定寫哪張分頁，field 走哪張白名單。 */
function stateSaveAction_(body) {
  var b = requireBinding_(body);
  var sid = targetStudent_(b, body);

  var scope = String(body.scope || '');
  if (!STATE_SHEETS[scope]) throw new AppError('INVALID_INPUT', '不認識的資料範圍');
  requireWriteScope_(b, scope);

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
  if (scope === 'assignment' && field !== 'submission') {
    throw new AppError('INVALID_INPUT', '作業只接受 submission 欄位');
  }

  var value = body.value;
  if (scope === 'growth') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppError('INVALID_INPUT', '成長紀錄格式不正確');
    }
    /* author_role 只相信已驗證的帳號，不相信前端送來的 by。 */
    value.by = b.access_scope === 'manage' ? 'coach' : 'student';
  }
  /* 成長紀錄送的是整個事件物件，其他 scope 送的是單一值。 */
  if (scope !== 'growth' && value !== null && typeof value === 'object') {
    throw new AppError('INVALID_INPUT', '這個欄位不接受物件');
  }
  if (typeof value === 'string' && value.length > (scope === 'assignment' ? 40000 : 8000)) {
    throw new AppError('INVALID_INPUT', '內容太長');
  }
  if (scope === 'assignment') {
    var submission;
    try { submission = JSON.parse(String(value || '')); }
    catch (e) { throw new AppError('INVALID_INPUT', '作業內容格式不正確'); }
    if (!submission || typeof submission !== 'object' || Array.isArray(submission)
        || String(submission.assignmentId || '') !== itemId
        || ['draft', 'submitted', 'completed'].indexOf(String(submission.status || '')) < 0
        || !submission.answers || typeof submission.answers !== 'object' || Array.isArray(submission.answers)) {
      throw new AppError('INVALID_INPUT', '作業內容格式不正確');
    }
    if (submission.status === 'completed' && b.access_scope !== 'manage') {
      throw new AppError('FORBIDDEN_STUDENT', '只有教練可以標記作業完成');
    }
    for (var answerId in submission.answers) {
      if (!/^[a-z0-9-]{1,40}$/.test(answerId)
          || typeof submission.answers[answerId] !== 'string'
          || submission.answers[answerId].length > 12000) {
        throw new AppError('INVALID_INPUT', '作業回答格式不正確');
      }
    }
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
/* 欄名 → 中文說明。掛成儲存格註解（滑過去才出現），
   不另外加一列 —— 多一列就多一種表頭位置，那正是要消滅的東西。 */
var BINDING_NOTES = {
  binding_id: '這一列的編號。自動產生，不用管。',
  line_user_id: 'LINE 驗證後給的使用者 ID。⚠️ 這是個資，不要外流、不要貼進任何地方。',
  student_id: '對應「學員」分頁的學員 ID。教練列可以留空。',
  student_name: '學員在評測第一題（稱呼）自己填的。**以評測填的為準**，這裡只是快照。',
  line_display_name: 'LINE 的顯示名稱，綁定時自動記。跟本人常常對不起來，只拿來認人。',
  access_scope: 'self ＝ 只能看自己　manage ＝ 教練，看得到所有學員。用選單「把某個帳號升級成教練」改。',
  reusable: 'TRUE ＝ 這是可重複使用的樣板（教練共用授權碼），用掉不會作廢。學員的碼一律留空。',
  status: 'active 才能登入。要停用某個帳號就改成 disabled。',
  activation_code_hash: '啟用碼的雜湊。**驗證只看這一欄**，不看明碼。不要手動改。',
  activation_code_plain: '啟用碼的明碼，方便你抄給學員。**用掉的瞬間會自動清空。**',
  activation_expires_at: '啟用碼的到期時間。',
  activation_used_at: '啟用碼被用掉的時間。空的代表還沒人用。',
  linked_at: '第一次綁定成功的時間。',
  last_login_at: '最後一次開啟網站的時間。',
  note: '你自己寫的備註。LINE 名稱跟本人對不起來的時候寫在這裡。'
};

/* 標題與說明，跟骨架其他分頁同一個形狀：
   第 1 列空、第 2 列標題、第 3 列說明、第 4 列空、第 5 列表頭。 */
function decorateBinding_(sh) {
  var NAVY = '#131B2E', BEIGE = '#E8E4DC', SALMON = '#E8A898';
  var w = Math.max(sh.getLastColumn(), BINDING_COLS.length);

  sh.getRange(2, 1).setValue('帳號綁定')
    .setFontSize(16).setFontWeight('bold').setFontColor(NAVY);
  sh.getRange(3, 1).setValue(
    '一列 ＝ 一個 LINE 帳號對到哪位學員。這張表由程式維護，'
    + '你平常只需要改 access_scope、status 與 note 三欄。'
    + '　⚠️ 人的主檔在「學員」分頁；姓名以學員在評測填的為準。')
    .setFontSize(10).setFontStyle('italic').setFontColor('#6B7280');

  /* 表頭的深藍色塊 —— 跟「學員」「學員填寫」那幾張同一套，
     四色之外不引入新顏色。上緣的鮭粉細線是骨架原本就有的分隔。 */
  sh.getRange(4, 1, 1, w).setBorder(null, null, true, null, null, null,
                                    SALMON, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(BINDING_HEADER_ROW, 1, 1, w)
    .setBackground(NAVY).setFontColor(BEIGE).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sh.setRowHeight(BINDING_HEADER_ROW, 30);
  sh.setFrozenRows(BINDING_HEADER_ROW);
  sh.setColumnWidth(1, 130);

  var map = mapAt_(sh, BINDING_HEADER_ROW);
  for (var col in BINDING_NOTES) {
    if (map[col]) sh.getRange(BINDING_HEADER_ROW, map[col]).setNote(BINDING_NOTES[col]);
  }
  /* 你平常真的要改的三欄標成鮭粉底 —— 其他欄是程式在寫，不要手動碰。 */
  ['access_scope', 'status', 'note'].forEach(function (c) {
    if (map[c]) sh.getRange(BINDING_HEADER_ROW, map[c]).setBackground(SALMON).setFontColor(NAVY);
  });
  /* ⚠️ line_user_id 是個資，標出來提醒不要外流。 */
  if (map.line_user_id) {
    sh.getRange(BINDING_HEADER_ROW, map.line_user_id).setFontColor(SALMON);
  }
}

/* 藍圖內容是教練會直接維護的全域資料。排版跟其他分頁一致，
   但鮮粉表頭代表「可手動編輯」，kr_id 則特別標出不可改既有值。 */
function decorateBlueprint_(sh) {
  var NAVY = '#131B2E', BEIGE = '#E8E4DC', SALMON = '#E8A898';
  var w = Math.max(sh.getLastColumn(), BLUEPRINT_COLS.length);
  sh.getRange(2, 1).setValue('課程藍圖內容')
    .setFontSize(16).setFontWeight('bold').setFontColor(NAVY);
  sh.getRange(3, 1).setValue(
    '一列 ＝ 一條 KR。網站會依「能力 → 目標 O → KR」顯示。'
    + '新增任務至少要填 kr_id、能力、KR、排序與啟用；已上線的 kr_id 不可更改。'
    + '修改後請用上方「UC 雲端教練 → 整理並檢查藍圖內容」，再重新開啟網站。')
    .setFontSize(10).setFontStyle('italic').setFontColor('#6B7280').setWrap(true);
  sh.setRowHeight(3, 44);
  sh.getRange(4, 1, 1, w).setBorder(null, null, true, null, null, null,
                                    SALMON, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(BLUEPRINT_HEADER_ROW, 1, 1, w)
    .setBackground(NAVY).setFontColor(BEIGE).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sh.setRowHeight(BLUEPRINT_HEADER_ROW, 30);
  sh.setFrozenRows(BLUEPRINT_HEADER_ROW);

  var map = blueprintMap_(sh);
  for (var col in BLUEPRINT_NOTES) {
    if (map[col]) sh.getRange(BLUEPRINT_HEADER_ROW, map[col]).setNote(BLUEPRINT_NOTES[col]);
  }
  ['能力', '目標 O', 'KR', '教材', '作業', '排序', '啟用', '次數', '短標', '教練備註'].forEach(function (c) {
    if (map[c]) sh.getRange(BLUEPRINT_HEADER_ROW, map[c]).setBackground(SALMON).setFontColor(NAVY);
  });
  if (map.kr_id) sh.getRange(BLUEPRINT_HEADER_ROW, map.kr_id).setFontColor(SALMON);

  var dataRows = Math.max(200, sh.getMaxRows() - BLUEPRINT_HEADER_ROW);
  if (map['能力']) {
    sh.getRange(BLUEPRINT_HEADER_ROW + 1, map['能力'], dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['人格魅力', '情緒價值', '形象魅力', '生活圈', '調情升溫'], true)
        .setAllowInvalid(false).build());
  }
  if (map['啟用']) {
    sh.getRange(BLUEPRINT_HEADER_ROW + 1, map['啟用'], dataRows, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  var widths = { kr_id: 80, '能力': 105, '目標 O': 175, KR: 250, '教材': 220,
                 '作業': 145, '排序': 70, '啟用': 65, '次數': 65, '短標': 120, '教練備註': 320 };
  for (var name in widths) if (map[name]) sh.setColumnWidth(map[name], widths[name]);
}

function validateBlueprint_() {
  var sh = blueprintSheet_(), map = blueprintMap_(sh);
  var errors = [], warnings = [], seen = {}, count = 0;
  var missing = BLUEPRINT_COLS.filter(function (c) { return !map[c]; });
  if (missing.length) errors.push('缺少欄位：' + missing.join('、'));
  var last = sh.getLastRow();
  if (last <= BLUEPRINT_HEADER_ROW) return { count: 0, errors: errors, warnings: ['還沒有任務資料'] };
  var rows = sh.getRange(BLUEPRINT_HEADER_ROW + 1, 1, last - BLUEPRINT_HEADER_ROW,
                         Math.max(sh.getLastColumn(), 1)).getValues();
  var abilities = ['人格魅力', '情緒價值', '形象魅力', '生活圈', '調情升溫'];
  rows.forEach(function (row, i) {
    var line = BLUEPRINT_HEADER_ROW + 1 + i;
    /* 空白列也會因為「啟用」欄套了核取方塊而讀成 false。
       判斷是否有任務內容時忽略該欄，避免把所有預留列誤報為缺 kr_id。 */
    var any = BLUEPRINT_COLS.some(function (name) {
      if (name === '啟用' || !map[name]) return false;
      var v = row[map[name] - 1];
      return v !== '' && v != null;
    });
    if (!any) return;
    var r = rowObj_(row, map), id = String(r.kr_id || '').trim();
    if (!id) { errors.push('第 ' + line + ' 列：缺 kr_id'); return; }
    count++;
    if (seen[id]) errors.push('第 ' + line + ' 列：kr_id 與第 ' + seen[id] + ' 列重複（' + id + '）');
    else seen[id] = line;
    if (abilities.indexOf(String(r['能力'] || '')) < 0) errors.push('第 ' + line + ' 列：能力名稱不正確');
    if (!String(r.KR || '').trim()) errors.push('第 ' + line + ' 列：缺 KR');
    if (!isFinite(Number(r['排序'])) || Number(r['排序']) <= 0) errors.push('第 ' + line + ' 列：排序必須是大於 0 的數字');
    if (!(r['啟用'] === true || r['啟用'] === false || r['啟用'] === 'TRUE' || r['啟用'] === 'FALSE')) {
      errors.push('第 ' + line + ' 列：啟用必須勾選 TRUE 或 FALSE');
    }
    if (!String(r['目標 O'] || '').trim()) warnings.push('第 ' + line + ' 列：目標 O 留空');

    /* ⚠️ 「教材」與「作業」是**用文字比對**的：對得上才會在任務視窗出現「傳送」。
       課程改名之後，還寫著舊名字的列會**安靜地失去按鈕** —— 不報錯、按鈕就是不見了。
       所以在這裡把對不上的列出來。自由輸入是允許的，所以這是提醒不是錯誤。 */
    var tool = String(r['教材'] || '').trim();
    if (tool && typeof COURSE_NAMES !== 'undefined' && COURSE_NAMES.indexOf(tool) < 0) {
      warnings.push('第 ' + line + ' 列：教材「' + tool + '」對不上任何課程，不會有傳送按鈕');
    }
    var work = String(r['作業'] || '').trim();
    if (work && typeof TASK_NAMES !== 'undefined' && TASK_NAMES.indexOf(work) < 0) {
      warnings.push('第 ' + line + ' 列：作業「' + work + '」對不上任何工具，不會有傳送按鈕');
    }
  });
  return { count: count, errors: errors, warnings: warnings };
}

/**
 * 把表頭在第 1 列的舊版搬成第 5 列。
 * ⚠️ 用 insertRowsBefore 而不是重建 —— 既有的綁定資料一格都不能動，
 * 那裡面有真的 line_user_id 與還沒用掉的啟用碼。
 */
function migrateBindingLayout_(sh) {
  if (bindingHeadRow_(sh) !== 1) return false;
  sh.insertRowsBefore(1, BINDING_HEADER_ROW - 1);
  decorateBinding_(sh);
  console.log('「' + BINDING_SHEET + '」已改成跟其他分頁一樣：表頭移到第 '
              + BINDING_HEADER_ROW + ' 列');
  return true;
}

var _bsh = null;

function bindingSheet_() {
  if (_bsh) return _bsh;
  var ss = sheet_();
  var sh = ss.getSheetByName(BINDING_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BINDING_SHEET);
    sh.getRange(BINDING_HEADER_ROW, 1, 1, BINDING_COLS.length).setValues([BINDING_COLS]);
    decorateBinding_(sh);
    console.log('已建立「' + BINDING_SHEET + '」分頁');
    _bsh = sh;
    return sh;
  }
  migrateBindingLayout_(sh);

  /* ⚠️ 既有的表要能就地升級。第一版只有 10 欄，後來加了姓名、明碼、備註。
     不做這段的話，rowObj_ 會把欄位對到錯的格子 —— 那是無聲的資料錯亂。
     只補在**最後面**，不重排既有欄位。 */
  var hrow = bindingHeadRow_(sh);
  var have = sh.getRange(hrow, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x || ''); });
  var missing = BINDING_COLS.filter(function (c) { return have.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(hrow, have.length + 1, 1, missing.length).setValues([missing]);
    console.log('「' + BINDING_SHEET + '」補上欄位：' + missing.join('、'));
  }
  /* ⚠️ **這裡不可以呼叫 decorateBinding_。**
     它做 38 次格式寫入（表頭底色、15 個欄位註解、鮭粉標記），
     而 bindingSheet_() 在一次 student.load 裡會被呼叫兩次
     → 光「把表弄好看」就是 76 次寫入，每個請求都做一遍。

     逐行數過：student.load 約 147 次 RPC，其中 77 次是寫入，
     而這個請求在語意上是**純讀取**。這是登入 10 秒裡最大的一塊。
     （2026-09-13 加的，當天就量到，直接移掉。）

     排版現在只在三個地方做：新建分頁、遷移版面、以及選單上的
     「修復分頁排版」。註解與底色不會自己消失，沒有理由每次重畫。 */
  _bsh = sh;
  return sh;
}

/** 讀表頭，回「欄名 → 欄號(1-based)」。**不要假設欄序跟 BINDING_COLS 一樣** ——
    舊表升級後新欄在最後面，寫死順序會對錯格子。 */
/* 表頭在第 5 列（第 1–4 列是標題與說明）。骨架的每一張都是這樣，
   「帳號綁定」2026-09-13 也改成一樣 —— 一份試算表只該有一種慣例。 */
var BINDING_HEADER_ROW = 5;

/** 讀任一列當表頭，回「欄名 → 欄號(1-based)」。 */
function mapAt_(sh, row) {
  var head = sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var m = {};
  for (var i = 0; i < head.length; i++) {
    var k = String(head[i] || '');
    if (k && !m[k]) m[k] = i + 1;
  }
  return m;
}

/* ⚠️ **相容舊版。** 遷移前表頭在第 1 列，遷移後在第 5 列。
   靠「第 1 列第 1 格是不是 binding_id」判斷，不要用版本號猜。 */
function bindingHeadRow_(sh) {
  return String(sh.getRange(1, 1).getValue()) === BINDING_COLS[0] ? 1 : BINDING_HEADER_ROW;
}

function bindingMap_(sh) { return mapAt_(sh, bindingHeadRow_(sh)); }

/**
 * 綁定表的資料列。**所有掃這張表的地方都要用它**，
 * 不要自己 getDataRange().getValues() 然後從索引 1 開始 ——
 * 表頭一移位那些迴圈就會把標題列當成資料（無聲）。
 * 回傳 { map, rows, first }：rows[0] 在試算表上的列號就是 first。
 */
/* ⚠️ **這張表只有兩列，卻花了 876 毫秒**（2026-09-13 實測）。
   原因是七次呼叫才讀到資料：問分頁 → 讀 A1 判斷表頭在第幾列 → 讀表頭
   → 再讀一次表頭檢查缺欄 → 問最後一列 → 問最後一欄 → 才真的讀。

   一次 getDataRange() 就全拿到了：A1、表頭、資料都在同一包裡。
   跟 skelRead_ 同一招，只是當初漏掉了這張表（它不在 SKEL 裡）。

   ⚠️ 讀路徑不補缺欄、不遷移版面 —— 那是寫路徑的事（bindingSheet_）。
   萬一表頭找不到（還沒遷移過的舊表），退回去走完整的 bindingSheet_。 */
var _bread = null;

function bindingBody_(sh) {
  if (!sh && _bread) return _bread;

  if (!sh) {
    var s0 = sheetByName_(BINDING_SHEET);
    if (s0) {
      var all = s0.getDataRange().getValues();       /* ← 這一整段就這一次呼叫 */
      /* 表頭在第 1 列（舊版）還是第 5 列（現行）？直接從已經拿到的資料判斷。 */
      var hr = (all.length && String(all[0][0]) === BINDING_COLS[0]) ? 1
             : (all.length >= BINDING_HEADER_ROW
                && String(all[BINDING_HEADER_ROW - 1][0]) === BINDING_COLS[0])
               ? BINDING_HEADER_ROW : 0;
      if (hr) {
        var head = all[hr - 1], map = {};
        for (var i = 0; i < head.length; i++) {
          var k = String(head[i] || '');
          if (k && !map[k]) map[k] = i + 1;
        }
        _bread = { map: map, rows: all.slice(hr), first: hr + 1 };
        return _bread;
      }
    }
  }

  sh = sh || bindingSheet_();
  var hrow = bindingHeadRow_(sh);
  var map2 = mapAt_(sh, hrow);
  var last = sh.getLastRow();
  var rows = last > hrow
    ? sh.getRange(hrow + 1, 1, last - hrow, Math.max(sh.getLastColumn(), 1)).getValues()
    : [];
  return { map: map2, rows: rows, first: hrow + 1 };
}

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
  /* ⚠️ 寫過之後那份「一次讀完」的快取就過期了，丟掉重讀。
     不丟的話同一個請求裡後面的讀取會拿到舊值（無聲的錯誤）。
     **不要用 sh.getName() 去判斷是不是綁定表** —— 那本身就是一次呼叫，
     為了省錢又花一筆。無條件清掉：清錯最多多讀一次，判斷錯是資料錯。 */
  _bread = null;
  /* 綁定表的表頭不在第 1 列，所以不能用 colMap_。 */
  var c = (sh.getName() === BINDING_SHEET ? bindingMap_(sh) : colMap_(sh))[col];
  if (!c) throw new AppError('INTERNAL_ERROR', '「帳號綁定」缺欄位 ' + col);
  sh.getRange(line, c).setValue(value);
}

/* ⚠️ 每一次請求都要查一次綁定表，實測 700～1135ms —— 那是一整趟 getDataRange。
   而「這個 LINE 對應哪位學員」平常根本不會變，所以放快取。

   ⚠️ **TTL 長，但要有開關。** 一天登入一次的學員，兩分鐘的 TTL 等於永遠沒命中，
   每次都付那 1.1 秒。所以拉到 6 小時（CacheService 上限），
   代價是「解除綁定」不會立刻生效 —— 用 epoch 解決：
   鍵裡帶一個世代號，把世代號清掉，所有舊鍵就一次全部作廢。
   綁定、升級教練、選單清快取都會清它。
   ⚠️ 鍵用 sub 的雜湊，不存原始 LINE user id。 */
var BINDING_TTL = 21600;

function bindingEpoch_() {
  try {
    var c = CacheService.getScriptCache();
    var e = c.get('bepoch');
    if (!e) { e = String(Date.now()); c.put('bepoch', e, BINDING_TTL); }
    return e;
  } catch (err) { return '0'; }
}

/* 一次作廢所有綁定快取。世代號沒了，舊鍵就再也拼不出來。 */
function bindingCacheClear_() {
  try { CacheService.getScriptCache().remove('bepoch'); } catch (e) {}
}

function bindingCacheKey_(sub) {
  return 'b:' + bindingEpoch_() + ':'
    + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(sub))
      .map(function (x) { return ('0' + (x & 0xFF).toString(16)).slice(-2); }).join('');
}

function findBindingByLine_(sub) {
  var cache = null, key = '';
  try {
    cache = CacheService.getScriptCache();
    key = bindingCacheKey_(sub);
    var hit = cache.get(key);
    if (hit) {
      var cached = JSON.parse(hit);
      /* ⚠️ 標記來源。快取裡的 row 是「兩分鐘前的列號」——
         中間有人在試算表刪過列的話它就指錯地方，所以寫入一律不准用它。 */
      if (cached && cached.student_id) { cached.fromCache = true; return cached; }
    }
  } catch (e) { cache = null; }

  var found = findBindingByLineFresh_(sub);
  try {
    if (cache && found) cache.put(key, JSON.stringify(found), BINDING_TTL);
  } catch (e) {}
  return found;
}

function findBindingByLineFresh_(sub) {
  var b = bindingBody_();
  for (var i = 0; i < b.rows.length; i++) {
    var r = rowObj_(b.rows[i], b.map);
    if (String(r.line_user_id) === String(sub) && r.student_id) {
      r.row = b.first + i;
      return r;
    }
  }
  return null;
}

function hasSelfBinding_(rows, map, sub) {
  for (var i = 0; i < rows.length; i++) {
    var r = rowObj_(rows[i], map);
    if (String(r.line_user_id) === String(sub) && r.access_scope === 'self'
        && r.activation_used_at) return true;
  }
  return false;
}

/* ⚠️ 這是**唯一在讀取路徑上的寫入**，實測 219ms（開綁定表 ＋ 讀表頭 ＋ 寫 ＋ flush）。
   而它記的東西是「這個人今天有沒有來」—— 秒級精度完全不需要。
   用 CacheService 節流成每人每小時最多寫一次，其餘時候直接跳過。
   ⚠️ 快取壞掉就照舊寫，不要讓節流變成「永遠不記」。 */
function touchLastLogin_(line) {
  try {
    var c = CacheService.getScriptCache(), k = 'll:' + line;
    if (c.get(k)) return;              /* 一小時內來過了，不用再記一次 */
    c.put(k, '1', 3600);
  } catch (e) {}
  return touchLastLoginNow_(line);
}

function touchLastLoginNow_(line) {
  try { setCell_(bindingSheet_(), line, 'last_login_at', new Date()); }
  catch (e) { console.warn('更新 last_login_at 失敗', e); }   /* 不該因此擋住登入 */
}

/* ── LINE ID Token 驗證 ────────────────────────────── */

/* ⚠️ **每一次需要認證的動作都會打一次 LINE**（登入、讀資料、每一筆存檔）。
   學員填完 53 題會產生 53 筆 patch → 53 次外部 HTTP，每次 0.15～0.5 秒。
   所以驗過的結果要快取。

   安全上為什麼可以：快取的有效期**取 Token 自己的 exp**（最多 6 小時，
   那是 CacheService 的上限）。也就是說，快取期間內這個 Token 本來就還有效，
   拿它換到的身分跟重新問一次 LINE 完全一樣。過了 exp 就一定會重問。

   ⚠️ **絕對不要拿原始 Token 當快取的 key。** 那等於把憑證存進 Google 的
   共用快取。用 SHA-256 的十六進位摘要 —— 同一個 Token 對到同一個 key，
   但 key 本身洩漏也換不回 Token。 */
function verifyToken_(idToken) {
  var t = String(idToken || '');
  if (!t) throw new AppError('UNAUTHENTICATED', '沒有帶 idToken');

  var cache = null, key = '';
  try {
    cache = CacheService.getScriptCache();
    key = 'v:' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t)
      .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
    var hit = cache.get(key);
    if (hit) {
      var d = JSON.parse(hit);
      /* 快取裡的也要再檢一次 exp —— TTL 與 exp 不一定同時到期。 */
      if (d && d.sub && (!d.exp || d.exp > Math.floor(Date.now() / 1000))) {
        lap_('驗證(快取命中)');
        return d;
      }
    }
  } catch (e) { cache = null; }        /* 快取壞掉不該擋住登入 */

  var data = verifyLineIdToken_(t, channelId_());
  lap_('驗證(打LINE)');

  try {
    if (cache && data.exp) {
      var ttl = Math.min(data.exp - Math.floor(Date.now() / 1000), 21600);
      if (ttl > 30) cache.put(key, JSON.stringify(data), ttl);
    }
  } catch (e) {}
  return data;
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
    logProbe_('LINE verify 失敗 code=' + code + ' error=' + le.error);
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

/* ── 分段計時 ────────────────────────────────────────
   只記總時間的話，看到「1.8 秒」還是不知道該改哪裡。
   分段之後一次執行就看得出時間分佈，不必來回猜。
   Date.now() 本身沒有成本，可以長期留著。 */
var _laps = [], _lapT = 0;

function lapReset_() { _laps = []; _lapT = Date.now(); }

function lap_(name) {
  var n = Date.now();
  _laps.push(name + ' ' + (n - _lapT));
  _lapT = n;
}

/* 記一筆耗時，**同時塞進回應裡**再交出去。
   ⚠️ 只印在 Apps Script 的執行紀錄是不夠的 —— 那個畫面不一定展得開，
   而且使用者在手機上根本看不到（2026-09-13 實際踩到）。
   放進回應，網站就能自己顯示，量測不必依賴另一個工具。
   內容只有毫秒數與階段名稱，沒有任何資料，可以長期留著。 */
function perf_(t0, action, data) {
  var ms = Date.now() - t0;
  console.log('⏱ ' + action + ' 共 ' + ms + ' ms'
    + (_laps.length ? '　｜　' + _laps.join(' ・ ') + '（單位 ms）' : ''));
  try {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      data._perf = { action: action, ms: ms, laps: _laps.slice() };
    }
  } catch (e) {}
  return data;
}

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
  decorateBinding_(bindingSheet_());   /* 熱路徑不做，setup 做一次 */
  rehashPlainCodes_();

  /* 資料分頁。藍圖只在空的時候灌一次，之後試算表上的內容才是唯一來源。 */
  blueprintSheet_();
  decorateBlueprint_(blueprintSheet_());
  seedBlueprint_();
  seedLinks_();
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
  var sh = bindingSheet_(), b = bindingBody_(sh);
  var fixed = 0, orphan = [];
  for (var i = 0; i < b.rows.length; i++) {
    var r = rowObj_(b.rows[i], b.map), line = b.first + i;
    if (r.activation_used_at) continue;              /* 用過了，不管 */
    if (!r.activation_code_hash) continue;           /* 空列 */
    if (!r.activation_code_plain) { orphan.push(r.student_id || ('第 ' + line + ' 列')); continue; }
    var want = hashCode_(String(r.activation_code_plain).trim().toUpperCase());
    if (String(r.activation_code_hash) === want) continue;   /* 已經對了 */
    setCell_(sh, line, 'activation_code_hash', want);
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
  var map = bindingMap_(sh);

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
    .addItem('修復「帳號綁定」的排版', 'menuDecorate')
    .addItem('整理並檢查「藍圖內容」', 'menuBlueprintSetup')
    .addItem('同步「課程連結」的課表（不動你貼的網址）', 'menuSyncLinks')
    .addItem('清掉藍圖與連結快取（改完想立刻生效）', 'menuClearBlueprintCache')
    .addItem('查這份表的狀態', 'menuStatus')
    .addSeparator()
    .addItem('改善「總覽」的公式…', 'menuUpgradeOverview')
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
  var sh = bindingSheet_(), b = bindingBody_(sh);

  /* 先把現有的綁定列出來，讓你照著抄，不要用猜的。 */
  var list = [], lineOf = {};
  for (var i = 0; i < b.rows.length; i++) {
    var r = rowObj_(b.rows[i], b.map);
    if (!r.line_user_id) continue;                 /* 還沒有人綁的樣板列跳過 */
    var who = String(r.student_id || '（沒有學員 id）');
    list.push(who + '　' + (r.line_display_name || '') + '　目前：' + (r.access_scope || 'self'));
    lineOf[who] = b.first + i;
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
  bindingCacheClear_();          /* 不清的話那個帳號最多 6 小時還是學員身分 */
  ui.alert('已升級：' + id + ' → 教練（manage）\n\n'
    + '請那個 LINE 帳號重新開一次網站，就會看到「學員」分頁與所有學員清單。\n'
    + '要降回學員的話，把那一列的 access_scope 改回 self。');
}

/* 排版不再每次請求自動補（那是登入慢的主因）。手動刪掉了就按這個。 */
function menuDecorate() {
  decorateBinding_(bindingSheet_());
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('「' + BINDING_SHEET + '」的標題、說明、欄位註解與底色都補回來了。');
}

/* 藍圖內容的單一維護入口：舊版會安全搬表頭、補說明與下拉選單，
   接著檢查欄位與每條 KR，最後清掉快取。 */
function menuBlueprintSetup() {
  var sh = blueprintSheet_();
  decorateBlueprint_(sh);
  blueprintDropdowns_(sh);        /* 作業與教材套下拉，但不擋自由輸入 */
  var result = validateBlueprint_();
  try { CacheService.getScriptCache().remove('bp'); } catch (e) {}
  SpreadsheetApp.flush();
  var message = '已整理「' + BLUEPRINT_SHEET + '」，目前 ' + result.count + ' 條 KR。\n'
    + '「作業」與「教材」已套上下拉選單（仍可自己打字）。\n'
    + '藍圖快取已清除。';
  if (result.errors.length) message += '\n\n需要修正：\n• ' + result.errors.join('\n• ');
  else message += '\n\n必要欄位檢查通過。';
  if (result.warnings.length) message += '\n\n提醒：\n• ' + result.warnings.join('\n• ');
  message += '\n\n修正完後請再執行一次這個檢查，然後重新開啟網站。';
  SpreadsheetApp.getUi().alert(result.errors.length ? '藍圖內容還有問題' : '藍圖內容檢查完成',
                               message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* 藍圖有 15 分鐘的快取（那一段實測 497ms，是登入時間裡很大一塊）。
   改完藍圖不想等就按這個。 */
/* 課程改名或重新排序之後，把試算表上的標籤對回來、缺的課補上。
   ⚠️ 連結那一欄不會被動到 —— 那是教練貼的。 */
function menuSyncLinks() {
  var r = syncLinks_();
  SpreadsheetApp.getUi().alert(
    '「' + LINKS_SHEET + '」已同步。\n\n'
    + '更新了 ' + r.updated + ' 列的分類／編號／名稱\n'
    + '新增了 ' + r.added.length + ' 列'
    + (r.added.length ? '：\n　' + r.added.join('\n　') : '')
    + '\n\n⚠️ 「連結」那一欄一格都沒有動。新增的課要自己貼網址。');
}

function menuClearBlueprintCache() {
  try { CacheService.getScriptCache().removeAll(['bp', 'links']); } catch (e) {}
  bindingCacheClear_();
  SpreadsheetApp.getUi().alert('快取已清除：藍圖、課程連結、帳號綁定。\n\n'
    + '下一次載入會重新讀試算表（那一次會比較慢，之後恢復）。\n'
    + '改過連結、藍圖內容，或在「帳號綁定」動過列，就跑這個。');
}

function menuStatus() {
  var b = bindingBody_();
  var issued = 0, used = 0, pending = 0;
  for (var i = 0; i < b.rows.length; i++) {
    var r = rowObj_(b.rows[i], b.map);
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

/* 把原始碼裡的註解拿掉再比對。護欄是要看「有沒有真的呼叫」，
   不是「有沒有提到這個名字」—— 提到它的往往正是說明為什麼不該呼叫的那行註解。 */
function srcNoComments_(fn) {
  return String(fn.toString())
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/* ── 本機自我檢查 ──────────────────────────────────
   在編輯器裡選這個函式按執行。不需要真的 Token。
   驗「錯誤路徑會不會乖乖回錯誤」與「試算表的鎖有沒有生效」。 */

function selftest() {
  _ss = null;                    /* 清掉快取，確保這次是真的重開一次 */
  IN_SELFTEST = true;            /* 故意撞出來的錯誤降成 info，不要混進真的警告裡 */
  try { return runSelftest_(); } finally { IN_SELFTEST = false; }
}

function runSelftest_() {
  var log = [], ok = true;
  function t(name, cond) { log.push((cond ? '  ok   ' : '  FAIL ') + name); if (!cond) ok = false; }
  function post(o) {
    return JSON.parse(doPost({ postData: { contents:
      typeof o === 'string' ? o : JSON.stringify(o) } }).getContent());
  }

  t('有可用的 Channel ID', !!channelId_());
  t('指令碼屬性有 SHEET_ID', !!prop_('SHEET_ID'));
  t('指令碼屬性有 CODE_SALT', !!prop_('CODE_SALT'));
  t('學員可以寫自己的評測', canWriteScope_({ access_scope: 'self' }, 'assessment'));
  t('學員不能修改教練報告', !canWriteScope_({ access_scope: 'self' }, 'report'));
  t('學員不能修改任務設定', !canWriteScope_({ access_scope: 'self' }, 'task'));
  t('學員可以寫作業與成長紀錄',
    canWriteScope_({ access_scope: 'self' }, 'assignment')
    && canWriteScope_({ access_scope: 'self' }, 'growth'));
  t('教練可以修改所有資料範圍',
    ['assessment', 'report', 'task', 'growth', 'assignment'].every(function (scope) {
      return canWriteScope_({ access_scope: 'manage' }, scope);
    }));

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
    var cm = bindingMap_(bindingSheet_());
    miss = BINDING_COLS.filter(function (c) { return !cm[c]; });
  }
  t('「' + BINDING_SHEET + '」欄位齊全' + (miss.length ? '（缺 ' + miss.join('、') + '）' : ''),
    miss.length === 0);

  /* 搬家之後最容易無聲壞掉的一件事：鹽換了，舊 hash 對不上。
     有明碼可以驗，就一定要驗。 */
  var mismatch = [];
  try {
    var b3 = bindingBody_();
    for (var k = 0; k < b3.rows.length; k++) {
      var rw = rowObj_(b3.rows[k], b3.map);
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
    var b2 = bindingBody_();
    for (var i = 0; i < b2.rows.length; i++) {
      var rr = rowObj_(b2.rows[i], b2.map);
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
  t('綁定表有 reusable 欄位', !!(ss && bindingMap_(bindingSheet_()).reusable));

  /* 遷移之後最該怕的事：迴圈把標題列當成資料，或表頭讀錯列。 */
  var bsh = bindingSheet_();
  t('綁定表的表頭在第 ' + BINDING_HEADER_ROW + ' 列', bindingHeadRow_(bsh) === BINDING_HEADER_ROW);
  var bb = bindingBody_(bsh);
  t('綁定表的資料列不含標題列', bb.rows.every(function (row) {
    var r = rowObj_(row, bb.map);
    return !r.binding_id || String(r.binding_id).indexOf('BND-') === 0;
  }));
  t('綁定表的表頭有中文註解',
    !!bsh.getRange(BINDING_HEADER_ROW, bindingMap_(bsh).access_scope || 1).getNote());

  /* ⚠️ 效能回歸的護欄：排版**不可以**再被放回熱路徑。
     bindingSheet_() 一次 student.load 會被呼叫兩次，每次 38 個格式寫入 ——
     那是登入 10 秒裡最大的一塊（2026-09-13 量到並移除）。 */
  /* ⚠️ 這兩項本來是純文字搜尋，連**註解**跟「分頁不存在才會跑」的分支都算進去，
     所以一直在誤報（2026-09-17 發現）。護欄誤報比沒有護欄更糟 ——
     會讓人習慣性忽略 FAIL。先把註解拿掉，再只看真正的熱路徑。 */
  var hot = srcNoComments_(bindingSheet_).split('migrateBindingLayout_')[1] || '';
  t('排版沒有被放回 bindingSheet_ 的熱路徑', hot.indexOf('decorateBinding_') < 0);
  t('student.load 不再寫 last_login_at',
    srcNoComments_(studentLoad_).indexOf('touchLastLogin_') < 0);
  t('auth.exchange 會順手帶回資料（省一次往返）',
    String(authExchange_.toString()).indexOf('studentPayload_') >= 0);

  /* ⚠️ 2026-09-17 實測：登入的腳本時間 4.2～5.3 秒，全部是讀表，
     而且同一段來回可以差六倍。能砍的只有次數。 */
  /* ⚠️ 教練登入原本要打三次（exchange / load / list），每次一遍平台地板。
     清單跟著登入回來之後只剩一次 —— 這個守門是防它被改回去。 */
  t('教練登入時清單跟著一起回來',
    srcNoComments_(authExchange_).indexOf('studentList_') >= 0);
  t('只有教練才帶清單（學員不需要，也不該拿得到）',
    srcNoComments_(authExchange_).indexOf("access_scope === 'manage'") >= 0);
  t('登入不分角色都只帶 boot（教練也不例外）',
    String(authExchange_.toString()).indexOf("'boot'") >= 0
    && String(authExchange_.toString()).indexOf("access_scope === 'manage' ? null") < 0);
  t('綁定查詢有走快取（每次 700～900ms）',
    String(findBindingByLine_.toString()).indexOf('CacheService') >= 0);
  t('登入的三張表是一個請求抓完',
    String(studentPayload_.toString()).indexOf('skelPreload_') >= 0);
  t('batchGet 失敗會自己退回逐張讀',
    String(skelPreload_.toString()).indexOf('catch') >= 0
    && String(skelRead_.toString()).indexOf('getDataRange') >= 0);
  t('batchGet 的短列有補齊（不然會取到 undefined）',
    String(skelRead_.toString()).indexOf('body[r].push') >= 0);
  t('成長紀錄不走 batchGet（日期型別會變）',
    String(studentPayload_.toString()).indexOf("skelPreload_(['assessment', 'report', 'task'])") >= 0);
  t('綁定快取的鍵是雜湊，不存原始 LINE id',
    String(bindingCacheKey_.toString()).indexOf('computeDigest') >= 0);
  /* ⚠️ 快取 6 小時，所以「一次全部作廢」的開關必須真的接上去。
     沒接的話解除綁定要等到明天才生效 —— 那是權限問題，不是效能問題。 */
  t('綁定快取有世代號（可以一次全部作廢）',
    String(bindingCacheKey_.toString()).indexOf('bindingEpoch_') >= 0);
  t('寫完會丟掉讀取快取（不然同一次執行裡寫完再讀是舊值）',
    srcNoComments_(stateSave_).indexOf('skelDrop_') >= 0);
  /* ⚠️ 刪除是不可逆的，把關一定要在後端。 */
  var r10 = post({ action: 'growth.delete', idToken: 'x.y.z', eventId: 'G1' });
  t('growth.delete 要先驗 Token', r10.error && r10.error.code === 'UNAUTHENTICATED');
  t('growth.delete 真的刪列，不是標記',
    String(growthDeleteAction_.toString()).indexOf('deleteRow') >= 0);
  t('growth.delete 有鎖',
    String(growthDeleteAction_.toString()).indexOf('getScriptLock') >= 0);
  t('學員不能刪教練寫的紀錄',
    String(growthDeleteAction_.toString()).indexOf("access_scope !== 'manage'") >= 0);
  t('刪除的權限看表上的 author_role，不看前端送什麼',
    String(growthDeleteAction_.toString()).indexOf('author_role') >= 0);
  t('刪完會丟掉讀取快取',
    String(growthDeleteAction_.toString()).indexOf('skelDrop_') >= 0);

  t('綁定變動會清掉快取',
    String(authBind_.toString()).indexOf('bindingCacheClear_') >= 0
    && String(menuMakeCoach.toString()).indexOf('bindingCacheClear_') >= 0
    && String(menuClearBlueprintCache.toString()).indexOf('bindingCacheClear_') >= 0);
  t('快取來的綁定不會拿去寫（列號可能已經移位）',
    String(authExchange_.toString()).indexOf('!b.fromCache') >= 0);

  /* ⚠️ 登入只讀第一眼要用的四包。成長與作業由前端畫完之後背景補 ——
     一次試算表讀取約 300ms，少讀兩張就是少 0.6 秒，而那兩包第一眼一定用不到。 */
  var bootKeys = null, restKeys = null, allKeys = null;
  try {
    var fakeB = { student_name: '', line_display_name: '', access_scope: 'self' };
    bootKeys = Object.keys(studentPayload_(fakeB, '__selftest_part__', 'boot'));
    restKeys = Object.keys(studentPayload_(fakeB, '__selftest_part__', 'rest'));
    allKeys = Object.keys(studentPayload_(fakeB, '__selftest_part__', null));
  } catch (e) {}
  t('boot 不含成長與作業',
    !!bootKeys && bootKeys.indexOf('log') < 0 && bootKeys.indexOf('assignments') < 0);
  t('boot 含答案／報告／任務／藍圖',
    !!bootKeys && ['answers', 'report', 'tasks', 'blueprint']
      .every(function (k) { return bootKeys.indexOf(k) >= 0; }));
  t('rest 只有成長與作業',
    !!restKeys && restKeys.indexOf('log') >= 0 && restKeys.indexOf('assignments') >= 0
    && restKeys.indexOf('answers') < 0 && restKeys.indexOf('tasks') < 0);
  t('不給 part 時仍然是全部',
    !!allKeys && ['answers', 'report', 'tasks', 'blueprint', 'log', 'assignments']
      .every(function (k) { return allKeys.indexOf(k) >= 0; }));
  t('LINE 驗證有走快取', String(verifyToken_.toString()).indexOf('CacheService') >= 0);
  t('快取的 key 不是 Token 原文',
    String(verifyToken_.toString()).indexOf('computeDigest') >= 0);
  t('讀路徑用 skelRead_（一次 getDataRange，不是六次呼叫）',
    String(stateLoad_.toString()).indexOf('skelRead_') >= 0
    && String(growthLoad_.toString()).indexOf('skelRead_') >= 0);
  t('藍圖有走快取', String(blueprintLoad_.toString()).indexOf('CacheService') >= 0);

  /* 課程連結：分頁在不在、只收 http(s)、有沒有進快取。 */
  t('有「' + LINKS_SHEET + '」分頁', !!(ss && ss.getSheetByName(LINKS_SHEET)));
  t('課程連結有走快取', String(linksLoad_.toString()).indexOf('CacheService') >= 0);
  /* ⚠️ 不可以用「有沒有提到『連結』」來判斷 —— 欄位檢查那段本來就會提到它，
     那種寫法必然誤報（規則 58）。要看的是**有沒有寫進去**。 */
  /* ⚠️ 下拉是「給選」不是「限制」—— 擋掉自由輸入的話，教練連一個
     還沒建好的教材名稱都寫不進去。 */
  t('下拉選單允許自由輸入',
    String(dropdown_.toString()).indexOf('setAllowInvalid(true)') >= 0);
  t('作業的下拉來自工具對照表', typeof TASK_NAMES !== 'undefined' && TASK_NAMES.length >= 10);
  t('教材的下拉來自課表', typeof COURSE_NAMES !== 'undefined' && COURSE_NAMES.length >= 15);
  /* ⚠️ 課程改名之後，藍圖裡還寫著舊名字的列會安靜失去傳送鈕。
     檢查一定要把它們列出來，不然改名這件事沒有任何回饋。 */
  t('藍圖檢查會抓出對不上的教材與作業',
    String(validateBlueprint_.toString()).indexOf('對不上任何課程') >= 0
    && String(validateBlueprint_.toString()).indexOf('對不上任何工具') >= 0);
  t('對不上只是提醒，不是錯誤（自由輸入是允許的）',
    String(validateBlueprint_.toString()).indexOf("warnings.push('第 ' + line + ' 列：教材") >= 0);
  t('整理藍圖時會套下拉',
    String(menuBlueprintSetup.toString()).indexOf('blueprintDropdowns_') >= 0);

  t('同步課表不會寫到連結那一欄',
    String(syncLinks_.toString()).indexOf("col['連結']] =") < 0);
  t('同步課表是用課程代號配對，不是用編號',
    String(syncLinks_.toString()).indexOf("at[code2]") >= 0);
  t('課程連結只收 http(s)', String(linksLoad_.toString()).indexOf('^https?:') >= 0);
  var lk = null;
  try { lk = linksLoad_(); } catch (e) {}
  t('課程連結讀得出來（目前填了 ' + (lk ? Object.keys(lk).length : 0) + ' 筆）', !!lk);
  t('課程連結的值都是網址',
    !!lk && Object.keys(lk).every(function (k) { return /^https?:\/\//i.test(lk[k]); }));
  /* ⚠️ getSheets() 是淨損失（實測多付約 470ms），不要再放回來。 */
  t('取分頁不用 getSheets（那會載入全部分頁）',
    String(sheetByName_.toString()).indexOf('getSheets()') < 0);
  t('last_login_at 有節流', String(touchLastLogin_.toString()).indexOf('CacheService') >= 0);

  /* ⚠️ 鎖握得越久，別的學員排得越久。writeRow_ 更新既有列時**不可以**
     退回逐格 setValue —— 一次評測存檔要寫 7 格就是 7 次呼叫。 */
  t('writeRow_ 更新既有列是整段寫回，不是逐格',
    String(writeRow_.toString()).indexOf('span.setValues') >= 0);

  /* 真的跑一次「只改兩欄、其餘不動」，這是批次寫回最容易弄壞的語意。 */
  var wsh2 = skelSheet_('assessment'), wmap2 = skelMap_(wsh2);
  var SENT2 = '__selftest_row__';
  var before2 = wsh2.getLastRow();
  writeRow_(wsh2, wmap2, 0, { student_id: SENT2, field_id: 'assessment.X',
                              '欄位名稱': '原本', '儲存值': '"a"', '已填': 1 });
  var ln2 = findRow_(wsh2, wmap2, function (r) { return String(r.student_id) === SENT2; });
  t('批次寫回：新增列成功', !!ln2);
  if (ln2) {
    writeRow_(wsh2, wmap2, ln2, { '儲存值': '"b"', '已填': 0 });
    var back2 = rowObj_(wsh2.getRange(ln2, 1, 1, wsh2.getLastColumn()).getValues()[0], wmap2);
    t('批次寫回：指定的欄位有改到',
      String(back2['儲存值']) === '"b"' && Number(back2['已填']) === 0);
    t('批次寫回：沒指定的欄位一格不動',
      String(back2['欄位名稱']) === '原本' && String(back2.field_id) === 'assessment.X');
    wsh2.deleteRow(ln2);
  }
  t('批次寫回：測試列已清掉', wsh2.getLastRow() === before2);

  /* 讀路徑重構最容易壞的地方：表頭列對錯、body 多切或少切一列。
     直接驗一次真實讀取的形狀。 */
  var sr = null;
  try { sr = skelRead_('assessment'); } catch (e) {}
  t('skelRead_ 取得表頭與資料', !!(sr && sr.map && sr.map.student_id && sr.body));
  t('skelRead_ 的 body 不含表頭列',
    !!sr && sr.body.every(function (row) {
      return String(row[(sr.map.student_id || 1) - 1]) !== 'student_id';
    }));
  t('skelRead_ 與 skelSheet_ 讀到同一組欄位', (function () {
    if (!sr) return false;
    var m2 = skelMap_(skelSheet_('assessment'));
    return SKEL.assessment.need.every(function (c) { return sr.map[c] === m2[c]; });
  })());

  /* 綁定表也改成一次讀完（原本七次呼叫讀兩列，實測 876ms）。
     ⚠️ 這條路繞過 bindingSheet_，所以要驗它跟完整路徑讀到的是同一份。 */
  _bread = null;
  var fast = bindingBody_();
  _bread = null;
  var slow = bindingBody_(bindingSheet_());
  t('綁定表的快路徑與完整路徑列數相同',
    fast.rows.length === slow.rows.length);
  t('綁定表的快路徑與完整路徑欄位對應相同',
    BINDING_COLS.every(function (c) { return fast.map[c] === slow.map[c]; }));
  t('綁定表的快路徑起始列號正確', fast.first === slow.first);
  t('綁定表的快路徑讀到同一筆資料', (function () {
    if (!fast.rows.length) return true;
    return String(rowObj_(fast.rows[0], fast.map).binding_id)
        === String(rowObj_(slow.rows[0], slow.map).binding_id);
  })());
  _bread = null;

  t('有「' + BLUEPRINT_SHEET + '」分頁', !!(ss && ss.getSheetByName(BLUEPRINT_SHEET)));
  var bpMiss = [];
  if (ss && ss.getSheetByName(BLUEPRINT_SHEET)) {
    var bm = blueprintMap_(blueprintSheet_());
    bpMiss = BLUEPRINT_COLS.filter(function (c) { return !bm[c]; });
  }
  t('「' + BLUEPRINT_SHEET + '」欄位齊全' + (bpMiss.length ? '（缺 ' + bpMiss.join('、') + '）' : ''),
    bpMiss.length === 0);
  t('「' + BLUEPRINT_SHEET + '」表頭在第 5 列', BLUEPRINT_HEADER_ROW === 5);

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
    /* ⚠️ 這裡是**直接動試算表**（deleteRow），沒有經過 stateSave_，
       所以那邊的快取失效蓋不到 —— 不自己丟的話這一行讀到的是刪之前的快取，
       資料明明清乾淨了卻回報 FAIL（2026-09-17 踩到）。
       規則很簡單：**繞過 stateSave_ 動資料的人，自己負責 skelDrop_。** */
    skelDrop_('assessment');
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

  console.log('UC GAS selftest ' + (ok ? 'PASS' : 'FAIL') + '\n' + log.join('\n')
    + (ok ? '\n\n（上面那排「自我檢查的預期錯誤」是這支程式自己撞出來的，不是問題）' : ''));
  return ok;
}
