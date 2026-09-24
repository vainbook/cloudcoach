/* 課程資源庫
   課名以使用者確認的網站課表為準（必修 4 堂 ＋ 選修 14 堂），

   ⚠️ **id 與 no 是兩回事，不要合併。**
   - `id` 是**身分**：課程連結分頁用它當鍵（課程代號），一旦發出去就不再改。
     所以「感情價值觀」從選修搬到必修，id 仍然是 opt-06 —— 貼好的連結照樣接得上。
   - `no` 是**畫面上的編號**：跟著排序走，重排就會變。
   2026-09-18 之前這兩件事共用同一個欄位，重新排序會讓已經貼好的連結
   接到別堂課上 —— 那是無聲的錯誤，比壞掉更難發現。

   書單來自 1_關係科學資料庫/02_書單/課程推薦書單.md，
   全部是真實存在的標題；14 門課使用同一套品牌色紙雕封面，不放假截圖。
   dims = 這堂課對應哪些能力維度（31 筆裡有 14 筆掛了）。

   ⚠️ **課程沒有「章數」。** 每堂就是一支獨立影片（使用者 2026-09-18 確認）。
   舊資料裡的「4 章／3 章」是沒有來源的數字，卻一直印在學員看得到的卡片上，
   2026-09-18 整批移除。`len` 現在只給電子書用（「必修」「11 本」是真的分類）。
   **目前介面沒有在用它** —— 原本的「為你安排」推薦區已依使用者要求刪除（「有點多餘」）。
   資料留著是因為它是真的課程歸類，不是為了那一區才存在；`#selftest` 仍會檢查
   維度代號有效、且每一維至少掛得到一堂課。要做「點菜單」之類的功能可以直接接。
   src 留空 = 檔案／連結待補；點擊會顯示「內容待補」而不是壞掉的播放器。 */
window.UC_LIBRARY = {
  review: false,

  tabs: [
    { k: 'req', name: '必修課程', en: 'Required', note: '雲端教練三個月必須看完的四堂。' },
    { k: 'opt', name: '選修課程', en: 'Electives', note: '14 堂私塾課，永久觀看、可重複播放。教練會依 OKR 指定順序。' },
    { k: 'book', name: '電子書與書單', en: 'Reading', note: 'UC 原創電子書與四階段推薦書單。' },
    { k: 'tool', name: '課程工具', en: 'Tools',    note: '教練在陪跑過程會用到的工具。目前多數還在人工進行，以下標出各自的狀態。' }
  ],

  items: [
    /* 必修 */
    { tab: 'req', id: 'req-01', no: '01', t: '戀愛三步驟', dims: ['values'], sub: '邂逅吸引 → 走入心房 → 親密關係', src: '', cover: 'assets/course-covers/03-chat-abstract-v1.webp' },
    { tab: 'req', id: 'req-02', no: '02', t: '信念系統', dims: ['values'], sub: '信念 → 行為 → 結果', src: '', cover: 'assets/course-covers/01-awareness-abstract-color-v3.webp' },
    { tab: 'req', id: 'req-03', no: '03', t: '負責任版本', dims: ['flirt'], sub: '受害者 → 負責任', src: '', cover: 'assets/course-covers/03-responsible-version-dark-v1.webp' },
    /* ⚠️ 從選修搬到必修，但 id 保持 opt-06 —— 換 id 等於換一堂課，連結會接錯。 */
    { tab: 'req', id: 'opt-06', no: '04', t: '感情價值觀｜三門', dims: ['values'], sub: '認識吸引・經營關係・終身伴侶', src: '', cover: 'assets/course-covers/06-relationship-values-doors-abstract-v1.webp' },

    /* 選修 */
    { tab: 'opt', id: 'opt-05', no: '05', t: '說故事技巧', dims: ['values','emo'], sub: '故事模版與畫故事', src: '', cover: 'assets/course-covers/05-storytelling-coffee-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-13', no: '06', t: '網聊救台灣', dims: ['flirt','circle'], sub: '學員實際對話診斷', src: '', cover: 'assets/course-covers/13-online-chat-phone-abstract-v1.webp' },
    /* 冷讀拆成三階，三張封面先共用同一張（使用者指定）。 */
    { tab: 'opt', id: 'opt-04', no: '07', t: '冷讀聊天｜入門', dims: ['flirt','emo'], sub: '不是要讀得準，是更容易切入', src: '', cover: 'assets/course-covers/04-cold-reading-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-16', no: '08', t: '冷讀聊天｜進階', dims: ['flirt','emo'], sub: '冷讀的兩面性', src: '', cover: 'assets/course-covers/04-cold-reading-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-17', no: '09', t: '冷讀聊天｜高階', dims: ['flirt','emo'], sub: '工具冷讀技巧', src: '', cover: 'assets/course-covers/04-cold-reading-abstract-v1.webp' },
    /* 封面還沒有：cover 留空，卡片會退成純文字版，不會變成破圖。 */
    { tab: 'opt', id: 'opt-15', no: '10', t: '型男穿搭', dims: ['image'], sub: '你的外表是你內在世界的呈現', src: '', cover: '' },
    { tab: 'opt', id: 'opt-07', no: '11', t: '約會地圖', dims: ['flirt','circle'], sub: '地點、動線、峰終安排', src: '', cover: 'assets/course-covers/07-date-map-toast-abstract-v1.webp' },
    /* 調情系統拆成兩堂（使用者 2026-09-18）。聊天那堂沿用 opt-08 —— 換 id 會讓
       已經貼好的連結變孤兒；肢體接觸是新的一堂，拿新的 opt-18。
       ⚠️ 原本的副標與章數是「整堂」的，拆開之後兩邊都不適用，先標待補。
       封面比照冷讀的作法，兩堂共用原本那一張。 */
    { tab: 'opt', id: 'opt-08', no: '12', t: '調情｜聊天', dims: ['flirt'], sub: '測試 → 調情 → 升溫', src: '', cover: 'assets/course-covers/08-flirting-hands-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-18', no: '13', t: '調情｜肢體接觸', dims: ['flirt'], sub: '測試 → 調情 → 升溫', src: '', cover: 'assets/course-covers/08-flirting-hands-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-09', no: '14', t: '好奇心', dims: ['emo'], sub: '好奇心 vs 身家調查', src: '', cover: 'assets/course-covers/09-curiosity-apple-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-10', no: '15', t: '演化心理學', dims: ['image','values'], sub: '四大價值與 be / do / have', src: '', cover: 'assets/course-covers/10-evolutionary-psychology-brain-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-11', no: '16', t: '幽默系統', dims: ['emo'], sub: '幽默六梗與推拉黃金法則', src: '', cover: 'assets/course-covers/11-humor-microphone-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-12', no: '17', t: '約會攝影', dims: ['image'], sub: '替她拍好照片這件事', src: '', cover: 'assets/course-covers/12-date-photography-camera-abstract-v1.webp' },
    { tab: 'opt', id: 'opt-14', no: '18', t: '性事課', dims: ['flirt'], sub: '安排在最後段的課程', src: '', cover: 'assets/course-covers/14-sexual-wellbeing-bed-abstract-v1.webp' },

    /* 電子書與書單 */
    { tab: 'book', id: 'book-E', no: 'E', t: 'UC 原創電子書', sub: '11 本・待補上檔案', len: '11 本', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    /* ⚠️ 推薦書單原本是 16 張一樣封面的卡（使用者 2026-09-24：「一大堆圖片」），
       併成一張卡，點開是文字清單。每本書的 id 留著 —— 課程連結分頁用它當鍵。 */
    { tab: 'book', id: 'book-list', no: 'B', t: '推薦書單', sub: '四階段推薦書・16 本', src: '',
      cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp',
      listLead: '依 UC 四個階段整理的推薦書。',
      listLinks: true,     /* 清單裡每本書各自可以貼連結（課程連結分頁沿用 book-A1…） */
      list: [
        { id: 'book-A1', no: 'A1', t: '《被討厭的勇氣》', sub: '岸見一郎・阿德勒｜冒險', len: '必修' },
        { id: 'book-A2', no: 'A2', t: '《薩提爾的對話練習》', sub: '李崇建｜冒險', len: '必修' },
        { id: 'book-A3', no: 'A3', t: '《愛無能》', sub: '吳姵瑩｜冒險', len: '必修' },
        { id: 'book-B1', no: 'B1', t: '《脆弱的力量》', sub: 'Brené Brown｜擁有', len: '必修' },
        { id: 'book-B2', no: 'B2', t: '《關係黑洞》', sub: '吳姵瑩｜擁有', len: '必修' },
        { id: 'book-B3', no: 'B3', t: '《非暴力溝通》', sub: 'Marshall Rosenberg｜擁有', len: '選修' },
        { id: 'book-B4', no: 'B4', t: '《蛤蟆先生去看心理師》', sub: 'Robert de Board｜擁有', len: '選修' },
        { id: 'book-C1', no: 'C1', t: '《社會性動物》', sub: 'David Aronson｜理想', len: '必修' },
        { id: 'book-C2', no: 'C2', t: '《魅力學》', sub: 'Olivia Fox Cabane｜理想', len: '選修' },
        { id: 'book-C3', no: 'C3', t: '《關鍵對話》', sub: 'Kerry Patterson｜理想', len: '選修' },
        { id: 'book-D1', no: 'D1', t: '《幸福的婚姻》', sub: 'John Gottman｜自由', len: '必修' },
        { id: 'book-D2', no: 'D2', t: '《調情學》', sub: 'Jean Smith｜自由', len: '選修' },
        { id: 'book-D3', no: 'D3', t: '《愛之語》', sub: 'Gary Chapman｜自由', len: '必修' },
        { id: 'book-D4', no: 'D4', t: '《親密關係：通往靈魂的橋樑》', sub: '克里斯多福・孟｜自由', len: '選修' },
        { id: 'book-D5', no: 'D5', t: '《讓愛情長久的八堂約會》', sub: 'John Gottman｜自由', len: '選修' },
        { id: 'book-D6', no: 'D6', t: '《哈佛 ✕ Google 行為科學家的脫單指南》', sub: 'Logan Ury｜自由', len: '選修' }
      ] },
    /* 教材「推薦電影」：只推薦、說明它和愛情的關係，不教學員去哪裡找片（使用者 2026-09-24）。
       封面沿用電影清單作業的圖。 */
    { tab: 'book', id: 'book-films', no: 'F', t: '推薦電影', sub: '8 部和愛情有關的電影', src: '',
      cover: 'assets/course-covers/tool-07-film-list-v1.webp',
      listLead: '這些電影各自呈現了愛情的一個面向。',
      list: [
        { id: 'film-01', t: '愛在黎明破曉時', sub: 'Before Sunrise・1995',
          body: '兩個陌生人在火車上相遇，在維也納走了一整夜、聊了一整夜。心動不一定來自浪漫的安排，往往來自一段真誠、願意交換想法的對話。' },
        { id: 'film-02', t: '珍愛每一天', sub: 'About Time・2013',
          body: '能回到過去的男主角，最後發現值得反覆重來的不是完美的告白，而是和所愛的人一起度過的平凡日子。' },
        { id: 'film-03', t: '我的失憶女友', sub: '50 First Dates・2004',
          body: '她每天醒來都會忘記他，他只好每天重新追她一次。愛不是一次贏得對方，而是每天重新選擇、重新投入。' },
        { id: 'film-04', t: '我們的愛情一言難盡', sub: '', body: '' },
        { id: 'film-05', t: '愛情藥不藥', sub: 'Love & Other Drugs・2010',
          body: '一個習慣不認真的業務員，遇上一個不想拖累別人的女孩。真正的親密，是在知道對方的脆弱與限制之後，仍然決定留下來。' },
        { id: 'film-06', t: '全民情聖', sub: 'Hitch・2005',
          body: '專門教人追求的約會顧問，輪到自己時卻處處出錯。技巧可以打開一扇門，但讓關係走下去的，是願意被看見真實的自己。' },
        { id: 'film-07', t: '手札情緣', sub: 'The Notebook・2004',
          body: '跨越階級與歲月的一段感情。愛情除了一開始的激情，也是幾十年來一次又一次的承諾與守候。' },
        { id: 'film-08', t: '熟男型不型', sub: 'Crazy, Stupid, Love・2011',
          body: '婚姻觸礁的中年男人向情場老手學打扮與搭訕，卻發現外在可以改造，真正讓人心動的仍是真心與在乎。' }
      ] }
  ]
};
