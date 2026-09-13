/* 課程資源庫
   課名以使用者確認的網站課表為準（必修 3 堂 ＋ 選修 11 堂），
   書單來自 1_關係科學資料庫/02_書單/課程推薦書單.md，
   全部是真實存在的標題；14 門課使用同一套品牌色紙雕封面，不放假截圖。
   dims = 這堂課對應哪些能力維度（31 筆裡有 14 筆掛了）。
   **目前介面沒有在用它** —— 原本的「為你安排」推薦區已依使用者要求刪除（「有點多餘」）。
   資料留著是因為它是真的課程歸類，不是為了那一區才存在；`#selftest` 仍會檢查
   維度代號有效、且每一維至少掛得到一堂課。要做「點菜單」之類的功能可以直接接。
   src 留空 = 檔案／連結待補；點擊會顯示「內容待補」而不是壞掉的播放器。 */
window.UC_LIBRARY = {
  review: false,

  tabs: [
    { k: 'req', name: '必修課程', en: 'Required', note: '雲端教練三個月必須看完的三堂。' },
    { k: 'opt', name: '選修課程', en: 'Electives', note: '11 堂私塾課，永久觀看、可重複播放。教練會依 OKR 指定順序。' },
    { k: 'book', name: '電子書與書單', en: 'Reading', note: 'UC 原創電子書與四階段推薦書單。' },
    { k: 'tool', name: '課程工具', en: 'Tools',    note: '教練在陪跑過程會用到的工具。目前多數還在人工進行，以下標出各自的狀態。' }
  ],

  items: [
    /* 必修 */
    { tab: 'req', no: '01', t: '戀愛三步驟', dims: ['values'], sub: '邂逅吸引 → 走入心房 → 親密關係', len: '4 章', src: '', cover: 'assets/course-covers/03-chat-abstract-v1.webp' },
    { tab: 'req', no: '02', t: '信念系統', dims: ['values'], sub: '信念 → 行為 → 結果', len: '4 章', src: '', cover: 'assets/course-covers/01-awareness-abstract-color-v3.webp' },
    { tab: 'req', no: '03', t: '負責任版本', dims: ['flirt'], sub: '受害者 → 負責任', len: '5 章', src: '', cover: 'assets/course-covers/03-responsible-version-dark-v1.webp' },

    /* 選修 */
    { tab: 'opt', no: '04', t: '冷讀聊天', dims: ['flirt','emo'], sub: '不是要讀得準，是更容易切入', len: '3 章', src: '', cover: 'assets/course-covers/04-cold-reading-abstract-v1.webp' },
    { tab: 'opt', no: '05', t: '說故事', dims: ['values','emo'], sub: '故事模版與畫故事', len: '4 章', src: '', cover: 'assets/course-covers/05-storytelling-coffee-abstract-v1.webp' },
    { tab: 'opt', no: '06', t: '感情價值觀', dims: ['values'], sub: '認識吸引・經營關係・終身伴侶', len: '3 章', src: '', cover: 'assets/course-covers/06-relationship-values-doors-abstract-v1.webp' },
    { tab: 'opt', no: '07', t: '約會地圖', dims: ['flirt','circle'], sub: '地點、動線、峰終安排', len: '3 章', src: '', cover: 'assets/course-covers/07-date-map-toast-abstract-v1.webp' },
    { tab: 'opt', no: '08', t: '調情系統', dims: ['flirt'], sub: '好感測試 → 升溫 → 釋放', len: '4 章', src: '', cover: 'assets/course-covers/08-flirting-hands-abstract-v1.webp' },
    { tab: 'opt', no: '09', t: '好奇心', dims: ['emo'], sub: '好奇心 vs 身家調查', len: '2 章', src: '', cover: 'assets/course-covers/09-curiosity-apple-abstract-v1.webp' },
    { tab: 'opt', no: '10', t: '演化心理學', dims: ['image','values'], sub: '四大價值與 be / do / have', len: '3 章', src: '', cover: 'assets/course-covers/10-evolutionary-psychology-brain-abstract-v1.webp' },
    { tab: 'opt', no: '11', t: '幽默系統', dims: ['emo'], sub: '幽默六梗與推拉黃金法則', len: '3 章', src: '', cover: 'assets/course-covers/11-humor-microphone-abstract-v1.webp' },
    { tab: 'opt', no: '12', t: '約會攝影', dims: ['image'], sub: '替她拍好照片這件事', len: '2 章', src: '', cover: 'assets/course-covers/12-date-photography-camera-abstract-v1.webp' },
    { tab: 'opt', no: '13', t: '網聊救台灣', dims: ['flirt','circle'], sub: '學員實際對話診斷', len: '5 章', src: '', cover: 'assets/course-covers/13-online-chat-phone-abstract-v1.webp' },
    { tab: 'opt', no: '14', t: '性事課', dims: ['flirt'], sub: '安排在最後段的課程', len: '3 章', src: '', cover: 'assets/course-covers/14-sexual-wellbeing-bed-abstract-v1.webp' },

    /* 電子書與書單 */
    { tab: 'book', no: 'E', t: 'UC 原創電子書', sub: '11 本・待補上檔案', len: '11 本', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'A1', t: '《被討厭的勇氣》', sub: '岸見一郎・阿德勒｜冒險', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'A2', t: '《薩提爾的對話練習》', sub: '李崇建｜冒險', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'A3', t: '《愛無能》', sub: '吳姵瑩｜冒險', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'B1', t: '《脆弱的力量》', sub: 'Brené Brown｜擁有', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'B2', t: '《關係黑洞》', sub: '吳姵瑩｜擁有', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'B3', t: '《非暴力溝通》', sub: 'Marshall Rosenberg｜擁有', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'B4', t: '《蛤蟆先生去看心理師》', sub: 'Robert de Board｜擁有', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'C1', t: '《社會性動物》', sub: 'David Aronson｜理想', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'C2', t: '《魅力學》', sub: 'Olivia Fox Cabane｜理想', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'C3', t: '《關鍵對話》', sub: 'Kerry Patterson｜理想', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D1', t: '《幸福的婚姻》', sub: 'John Gottman｜自由', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D2', t: '《調情學》', sub: 'Jean Smith｜自由', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D3', t: '《愛之語》', sub: 'Gary Chapman｜自由', len: '必修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D4', t: '《親密關係：通往靈魂的橋樑》', sub: '克里斯多福・孟｜自由', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D5', t: '《讓愛情長久的八堂約會》', sub: 'John Gottman｜自由', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' },
    { tab: 'book', no: 'D6', t: '《哈佛 ✕ Google 行為科學家的脫單指南》', sub: 'Logan Ury｜自由', len: '選修', src: '', cover: 'assets/course-covers/15-reading-books-fullbleed-v3.webp' }
  ]
};
