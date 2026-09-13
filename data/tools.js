/* 課程工具區。這一版只記錄已確認的十種工具與預計表格，
   不做假的輸入、勾選或儲存功能。每張表先標出穩定 id、rowIds 與各欄 owner，
   讓前端和後端能辨認欄位，不必拿顯示文字當資料鍵。
   owner: system 固定內容／coach 教練填寫／student 學員填寫。 */
(function () {
  var Q36 = [
    '如果可以邀請世界上的任何人吃一頓飯，你會選誰？',
    '你想成名嗎？如果想，希望因為什麼而被認識？',
    '打電話前，你會先在心裡排練要說的話嗎？為什麼？',
    '你心中理想的一天會怎麼度過？',
    '你最近一次唱歌給自己聽是什麼時候？唱給別人聽呢？',
    '如果能活到九十歲，後六十年只能保留三十歲的心智或身體，你會選哪一個？',
    '你曾經想像過自己可能會怎麼離開這個世界嗎？',
    '說出三個你和眼前這個人看起來共有的地方。',
    '目前的人生裡，你最感激的是什麼？',
    '如果能改變成長過程中的一件事，你想改變什麼？',
    '用四分鐘，盡可能完整地說出你一路走來的人生故事。',
    '如果明天醒來能多一種特質或能力，你最想得到什麼？',
    '如果水晶球能告訴你一件關於自己、人生或未來的真相，你想問什麼？',
    '有沒有一件想做很久卻還沒做的事？是什麼攔住了你？',
    '到目前為止，你最有成就感的一件事是什麼？',
    '一段友情裡，你最看重的是什麼？',
    '你最珍惜的一段回憶是什麼？',
    '你最不願意再經歷的一段回憶是什麼？',
    '如果知道自己只剩一年，你會改變現在的生活方式嗎？為什麼？',
    '友情對你而言代表什麼？',
    '愛與被愛在你的人生中扮演什麼角色？',
    '輪流說出你欣賞對方的地方，總共分享五項。',
    '你的家庭親近而溫暖嗎？你覺得自己的童年比多數人幸福嗎？',
    '你怎麼看自己和母親之間的關係？',
    '一起完成三句以「我們」開頭、而且此刻真實成立的話。',
    '完成這句話：「我希望有一個人，可以和我分享……」',
    '如果你們準備成為親近的朋友，有什麼事是對方應該先了解的？',
    '坦白告訴對方你欣賞他／她的地方，包括平常不會對剛認識的人說的部分。',
    '分享一次讓你覺得尷尬的經驗。',
    '你最近一次在別人面前哭是什麼時候？自己一個人哭呢？',
    '說一件你現在已經喜歡對方的地方。',
    '有什麼事情對你而言太嚴肅，不能拿來開玩笑？',
    '如果今晚就要離開，你最遺憾哪句話還沒對某個人說？為什麼還沒說？',
    '家裡失火，重要的人和寵物都安全後，你只能再救出一件物品，會選什麼？',
    '家人之中，失去誰最讓你難以承受？為什麼？',
    '分享一個正在困擾你的問題，請對方給建議，也請他／她說說你看起來正有什麼感受。'
  ];

  function qRows() {
    return Q36.map(function (q, i) {
      return [('0' + (i + 1)).slice(-2), i < 12 ? '第一組' : i < 24 ? '第二組' : '第三組', q];
    });
  }

  window.UC_TOOLS = {
    review: false,

    items: [
      { k: 'lifeblueprint', t: '生活藍圖', en: 'Life Blueprint', status: 'preview',
        cover: 'assets/course-covers/tool-01-life-blueprint-v1.webp',
        lead: '整理生活現況、想去的方向，以及下一步怎麼實踐。',
        body: '從健康、生活與人際關係三大議題盤點自己，讓生活有規劃，也把真實經驗累積成能與人分享的內容。',
        tables: [
          { id: 'life-overview', t: '生活藍圖',
            cols: ['議題', '子題', '現況描述', '目標設定', '如何實踐'],
            colIds: ['topic', 'subtopic', 'current', 'target', 'action'],
            owners: ['system', 'system', 'student', 'student', 'student'],
            rowIds: ['health-food', 'health-exercise', 'life-interest', 'life-career', 'relationships'], rows: [
            ['健康', '飲食', '', '', ''], ['健康', '運動', '', '', ''],
            ['生活', '興趣', '', '', ''], ['生活', '事業', '', '', ''],
            ['人際關係', '重要關係', '', '', '']
          ] }
        ] },

      { k: 'chattopics', t: '聊天話題庫', en: 'Conversation Library', status: 'preview',
        cover: 'assets/course-covers/tool-02-conversation-library-v1.webp',
        lead: '認識自己的故事，再把故事整理成可以自然展開的聊天素材。',
        body: '整合「人生重大話題」與「對話脈絡」：先整理事件與感受，再為每個故事補上能引導對方分享的問題。',
        tables: [
          { id: 'life-stories', t: '人生重大話題',
            cols: ['面向', '故事主題', '重大事件', '感受', '我的故事'],
            colIds: ['aspect', 'theme', 'event', 'feeling', 'story'],
            owners: ['system', 'system', 'student', 'student', 'student'],
            rowIds: ['attraction', 'connection', 'intimacy'], rows: [
            ['吸引', '興趣／生活／專業', '', '', ''],
            ['談心', '人際／家庭／脆弱', '', '', ''],
            ['曖昧親密', '初戀／浪漫／情傷', '', '', '']
          ] },
          { id: 'conversation-context', t: '對話脈絡',
            cols: ['故事標題', '情緒', '人格特質', '故事中的價值', '引導問題'],
            colIds: ['title', 'emotion', 'trait', 'value', 'prompt'],
            owners: ['student', 'student', 'student', 'student', 'student'],
            rowIds: ['entry-01'], rows: [['', '', '', '', '']] }
        ] },

      { k: 'datemap', t: '約會地圖', en: 'Date Map', status: 'preview',
        cover: 'assets/course-covers/tool-03-date-map-v1.webp',
        lead: '把一次約會的地點、順序與轉場整理成完整行程。',
        body: '分成朋友聚會、曖昧約會與情侶約會三種情境，分別規劃適合的行程與結束方式。',
        tables: [
          { id: 'date-itinerary', t: '約會行程',
            cols: ['類型', '出發', '行程一', '轉場', '行程二', '結束'],
            colIds: ['type', 'start', 'stop-01', 'transition', 'stop-02', 'ending'],
            owners: ['system', 'student', 'student', 'student', 'student', 'student'],
            rowIds: ['friends', 'dating', 'couple'], rows: [
            ['朋友聚會', '', '', '', '', ''], ['曖昧約會', '', '', '', '', ''], ['情侶約會', '', '', '', '', '']
          ] }
        ] },

      { k: 'beliefs', t: '信念系統', en: 'Belief System', status: 'preview',
        cover: 'assets/course-covers/tool-04-belief-system-v1.webp',
        lead: '從負面標籤與不自信，找出正在影響自己的信念。',
        body: '記下自己怎麼看女生、怎麼看自己，再回到形成這些看法的經驗，整理信念如何影響行為與結果。',
        tables: [
          { id: 'belief-review', t: '信念整理',
            cols: ['負面標籤／不自信', '形成經驗', '我的信念', '帶來的行為', '造成的結果'],
            colIds: ['label', 'origin', 'belief', 'behavior', 'result'],
            owners: ['student', 'student', 'student', 'student', 'student'],
            rowIds: ['entry-01'], rows: [['', '', '', '', '']] }
        ] },

      { k: 'responsible', t: '負責任版本', en: 'Responsible Version', status: 'preview',
        cover: 'assets/course-covers/tool-05-responsible-version-v1.webp',
        lead: '寫下自己的脆弱面故事，再整理成能為自己選擇負責的版本。',
        body: '負責任不是把錯都攬在身上，而是分清發生了什麼、自己能負責什麼，以及接下來要做什麼。',
        tables: [
          { id: 'story-rewrite', t: '故事改寫',
            cols: ['發生的事', '當時的感受', '受害者版本', '我能負責的部分', '負責任版本', '下一步'],
            colIds: ['event', 'feeling', 'victim-version', 'responsibility', 'responsible-version', 'next-step'],
            owners: ['student', 'student', 'student', 'student', 'student', 'student'],
            rowIds: ['entry-01'], rows: [['', '', '', '', '', '']] }
        ] },

      { k: 'relationshipvalues', t: '感情價值觀', en: 'Relationship Values', status: 'preview',
        cover: 'assets/course-covers/tool-06-relationship-values-v1.webp',
        lead: '透過三門，整理喜歡的對象、想經營的關係與長期檢核方式。',
        body: '這裡同時包含情感目標，讓選擇對象、經營關係與判斷長期適配有一套自己的標準。',
        tables: [
          { id: 'relationship-three-doors', t: '感情價值觀三門',
            cols: ['門', '核心問題', '我的答案', '檢核方式'],
            colIds: ['door', 'question', 'answer', 'review'],
            owners: ['system', 'system', 'student', 'student'],
            rowIds: ['door-01', 'door-02', 'door-03'], rows: [
            ['第一門', '我喜歡什麼樣的對象？', '', ''],
            ['第二門', '我想經營怎樣的關係？', '', ''],
            ['第三門', '我如何檢核長期關係？', '', '']
          ] }
        ] },

      { k: 'movies', t: '電影清單', en: 'Film List', status: 'preview',
        cover: 'assets/course-covers/tool-07-film-list-v1.webp',
        lead: '觀看教練推薦的電影，記下自己的感受與心得。',
        body: '電影清單之後由教練補上；這裡先保留觀看狀態與心得欄位，不把心得寫成電影評論。',
        tables: [
          { id: 'recommended-films', t: '推薦電影',
            cols: ['電影', '觀看狀態', '觀看日期', '心得感想'],
            colIds: ['film', 'status', 'date', 'reflection'],
            owners: ['coach', 'student', 'student', 'student'],
            rowIds: ['film-01'], rows: [['教練片單待補', '', '', '']] }
        ] },

      { k: 'interests', t: '興趣清單', en: 'Interest List', status: 'preview',
        cover: 'assets/course-covers/tool-08-interest-list-v1.webp',
        lead: '從教練推薦的活動中，勾出自己願意實際嘗試的項目。',
        body: '先建立活動清單，再記錄是否有興趣與想嘗試的原因；推薦內容之後由教練補上。',
        tables: [
          { id: 'recommended-activities', t: '推薦活動',
            cols: ['活動', '類型', '有興趣', '為什麼想嘗試'],
            colIds: ['activity', 'type', 'interested', 'reason'],
            owners: ['coach', 'coach', 'student', 'student'],
            rowIds: ['activity-01'], rows: [['教練清單待補', '', '', '']] }
        ] },

      { k: 'humor', t: '幽默清單', en: 'Humor List', status: 'preview',
        cover: 'assets/course-covers/tool-09-humor-list-v1.webp',
        lead: '把聽過、想到或實際用過的笑話記錄下來。',
        body: '先累積素材，再慢慢看出哪些幽默適合自己、適合什麼情境。',
        tables: [
          { id: 'humor-notes', t: '笑話紀錄',
            cols: ['笑話／素材', '來源', '適合情境', '使用心得'],
            colIds: ['material', 'source', 'context', 'reflection'],
            owners: ['student', 'student', 'student', 'student'],
            rowIds: ['entry-01'], rows: [['', '', '', '']] }
        ] },

      { k: 'curiosity', t: '好奇心話題庫', en: 'Curiosity Library', status: 'preview',
        cover: 'assets/course-covers/tool-10-curiosity-library-v1.webp',
        lead: '準備能讓彼此分享更多的有趣問題，也整理不同情緒裡的故事。',
        body: '第一版先放入「36 題愛上你」的三組漸進題庫，再保留傷心、驕傲、緊張、甜蜜與無厘頭五種情緒話題。',
        source: '題庫依 Aron 等人（1997）的親密感研究整理；中文為本網站的改寫草稿。',
        tables: [
          { id: 'questions-36', t: '36 題愛上你', cols: ['題號', '組別', '問題'],
            colIds: ['number', 'group', 'question'],
            owners: ['system', 'system', 'system'],
            rowIds: Q36.map(function (_, i) { return 'question-' + ('0' + (i + 1)).slice(-2); }), rows: qRows() },
          { id: 'emotion-topics', t: '情緒話題',
            cols: ['情緒', '引導問題', '我的故事', '對方的故事'],
            colIds: ['emotion', 'prompt', 'my-story', 'partner-story'],
            owners: ['system', 'coach', 'student', 'student'],
            rowIds: ['sad', 'proud', 'nervous', 'sweet', 'playful'], rows: [
            ['傷心', '', '', ''], ['驕傲', '', '', ''], ['緊張', '', '', ''], ['甜蜜', '', '', ''], ['無厘頭', '', '', '']
          ] }
        ] }
    ]
  };
})();
