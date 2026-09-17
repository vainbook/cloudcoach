/* 課程工具區。已建立的作業使用通用作業引擎；尚未建立的工具保留資料結構預覽。
   每張表與作業先標出穩定 id、rowIds 與各欄 owner，讓前端和後端能辨認欄位，
   不必拿顯示文字當資料鍵。
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

  var STORY_SECTIONS = [
    { id: 'encounter', no: '01', t: '邂逅吸引', en: 'Encounter & Attraction',
      topics: [
        { id: 'interest', t: '興趣' }, { id: 'life', t: '生活' },
        { id: 'education', t: '學涯' }, { id: 'career', t: '職涯' }
      ] },
    { id: 'heart', no: '02', t: '走入心房', en: 'Into the Heart',
      topics: [
        { id: 'relationships', t: '人際' }, { id: 'family', t: '家庭' },
        { id: 'vulnerability', t: '脆弱' }, { id: 'childhood', t: '童年' }
      ] },
    { id: 'intimacy', no: '03', t: '親密關係', en: 'Intimate Relationship',
      topics: [
        { id: 'first-love', t: '初戀' }, { id: 'romance', t: '浪漫' },
        { id: 'heartbreak', t: '情傷' }, { id: 'sensuality', t: '情趣' }
      ] }
  ];

  var STORY_FIELDS = [
    { id: 'headline', t: '頭條式標題', rows: 3,
      help: '用 1–3 句話表達故事核心，要讓人想繼續聽下去。',
      ph: '用 1–3 句寫出這個故事的核心' },
    { id: 'event', t: '具體事件與劇情', rows: 7,
      help: '先做減法，拿掉不影響因果的內容；再做加法，補上有助於理解的內心小聲音與個人感受。',
      ph: '事情怎麼開始、發生了什麼、最後留下什麼？' },
    { id: 'value', t: '故事傳遞的價值', rows: 4,
      help: '聽完這個故事，對方會對故事裡的你多一個什麼認識？',
      ph: '寫下對方會認識到的能力、個性或生活狀態' },
    { id: 'context', t: '對話脈絡與引導問句', rows: 4,
      help: '前面可以聊什麼？用哪一個問句，能自然延伸到分享這個故事？',
      ph: '先寫前面的話題，再寫一句可以接到故事的問句' }
  ];

  function storyGroups() {
    var out = [];
    STORY_SECTIONS.forEach(function (section) {
      section.topics.forEach(function (topic) {
        var group = {
          id: section.id + '-' + topic.id,
          section: section.id,
          t: topic.t,
          fields: STORY_FIELDS.map(function (field) {
            return {
              id: section.id + '-' + topic.id + '-' + field.id,
              key: field.id, t: field.t, rows: field.rows, help: field.help, ph: field.ph
            };
          })
        };
        if (section.id === 'encounter' && topic.id === 'interest') {
          group.example = {
            headline: '去宿霧看鯨鯊',
            event: '有一陣子在玩自由潛水，常常會和別人一起去玩。有一次跟了一個團去菲律賓宿霧潛水，看見世界上最大的魚類——鯨鯊，印象很深刻。',
            value: '會潛水、有朋友、喜歡動物的個性。',
            context: '聊興趣、聊潛水。可以問：「你有沒有一個玩到現在，還會想一直精進的興趣？」'
          };
        }
        out.push(group);
      });
    });
    return out;
  }

  window.UC_TOOLS = {
    review: false,

    items: [
      { k: 'lifeblueprint', t: '生活藍圖', en: 'Life Blueprint', status: 'active',
        cover: 'assets/course-covers/tool-01-life-blueprint-v1.webp',
        lead: '先設計一種你自己也會喜歡的生活。',
        body: '真正的魅力，不只是會不會聊天，更來自你正在過什麼樣的生活。一個人對自己的日子有好奇、有投入，也有想前往的方向，就會自然有故事、想法和生命力可以與人分享。\n\n社交技巧是傳遞這些內容的工具，但它不能代替生活本身。只有當你先喜歡自己的生活，別人才有機會看見你、理解你，也喜歡和你一起經歷這樣的生活。',
        assignment: {
          id: 'lifeblueprint', version: 1,
          note: '這份作業不是承諾書，課程不會要求你立刻實踐寫下的每件事。但你至少要能夠說清楚：你期待自己過什麼樣的生活，以及為什麼這件事對你重要。',
          prompt: '請在同一格內依序寫下：① 目前的狀況、② 想達到的目標、③ 準備如何實踐、④ 為什麼想要。可以挑一個或多個細項來寫，也可以補充下方沒有提到的內容。',
          fields: [
            { id: 'health', t: '健康', sub: '照顧自己的身、心與內在狀態',
              scope: '可以寫飲食、運動、睡眠、情緒、壓力、信念，或任何讓你感到安定、有精神的習慣。',
              example: '現況：最近常熬夜，工作壓力大時也很少運動。\n目標：希望作息穩定，每週運動兩次。\n如何實踐：平日十二點前睡，週三和週六去健身房。\n為什麼：我希望出遊和約會時更有體力，也想讓自己每天醒來更有精神。' },
            { id: 'resources', t: '資源', sub: '建立你與外在世界的連結',
              scope: '可以寫事業、財富、興趣、愛好、技能，或任何能增加生活選擇的累積。',
              example: '現況：工作穩定，但下班後多半滑手機，沒有持續累積自己的興趣。\n目標：今年學會做幾道拿手料理，也開始固定存旅行基金。\n如何實踐：每兩週學一道菜，每月薪水入帳後先轉一筆錢到旅行帳戶。\n為什麼：我想讓生活有值得期待的內容，也能自然和別人分享自己的興趣。' },
            { id: 'community', t: '社群', sub: '經營你重視的人際關係',
              scope: '可以寫家庭、朋友圈、志工參與、社團，或任何你想投入與歸屬的群體。',
              example: '現況：平常主要和同事往來，很少主動聯絡老朋友。\n目標：和家人、朋友維持更有品質的相處，也認識不同生活圈的人。\n如何實踐：每週主動約一位朋友，每月安排一次家庭聚餐，並嘗試參加一場志工或社團活動。\n為什麼：我希望生活裡有能互相支持、一起經歷事情的人。' }
          ]
        } },

      { k: 'chattopics', t: '聊天話題庫', en: 'Conversation Library', status: 'active',
        cover: 'assets/course-covers/tool-02-conversation-library-v1.webp',
        lead: '認識自己的故事，再把故事整理成可以自然展開的聊天素材。',
        body: '這份作業同時對應〈戀愛三步驟〉與〈說故事〉課。先為十二個題目各找出一件人生重大事件，再把故事整理成有核心、有價值，也能從對話自然延伸的素材。',
        assignment: {
          id: 'chattopics', version: 1, title: '建立你的聊天話題庫', progressUnit: '個故事',
          note: '先完成第一輪，再回來補第二輪。〈戀愛三步驟〉先替十二個題目各選一件重大事件；上完〈說故事〉後，再補齊劇情細節、想傳遞的價值與對話脈絡。',
          prompt: '三大主軸共十二個題目。每個題目都要完成「頭條式標題、具體事件與劇情、故事傳遞的價值、對話脈絡與引導問句」四欄。',
          steps: [
            { no: '01', t: '戀愛三步驟', body: '先找出每個題目中最想分享的重大事件，寫下標題與事件骨架。' },
            { no: '02', t: '說故事', body: '回來做減法與加法，補足感受、價值和能自然帶出故事的引導問句。' }
          ],
          sections: STORY_SECTIONS,
          groups: storyGroups()
        } },

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

      { k: 'beliefs', t: '信念系統', en: 'Belief System', status: 'active',
        cover: 'assets/course-covers/tool-04-belief-system-v1.webp',
        lead: '看見自己在感情裡反覆默念的話，再用一個新行動驗證別的可能。',
        body: '信念會影響我們怎麼解讀一件事，也會影響接下來的行為與結果。這份作業不是要你用正面口號說服自己，而是先找到那句常自動出現的話，再透過一個小而具體的行動，給自己一次新體驗。',
        assignment: {
          id: 'beliefs', version: 1, kind: 'belief-cycle', title: '找到你在感情裡的負面信念', progressUnit: '個階段',
          note: '下面列的句子是常見的自動想法，不是對任何性別或關係的事實判斷。先誠實看見它曾經出現，才有機會不再被它牽著走。',
          prompt: '先完成「看見標籤」，再用一件具體的感情事件完成「跳出信念」。不用一次把所有想法處理完，這次只挑一句最有影響的話。',
          steps: [
            { no: '01', t: '看見標籤', body: '從常見想法中辨認自己的句子，找到它形成的來源。' },
            { no: '02', t: '跳出信念', body: '用一件事看懂舊迴圈，選擇新信念與一個可執行的小行動。' }
          ],
          belief: {
            stage1: {
              no: '01', t: '看見標籤', en: 'Notice the Label',
              body: '請勾選曾經在腦中出現過的句子。你不需要認同它，只要判斷它有沒有在感情不順時自動跑出來。',
              categories: [
                { id: 'relationship', t: '對女生與關係的標籤', items: [
                  { id: 'belief-label-r01', text: '女生只看外表。' },
                  { id: 'belief-label-r02', text: '女生只在意收入與條件。' },
                  { id: 'belief-label-r03', text: '女生只喜歡很會說話或看起來很壞的男生。' },
                  { id: 'belief-label-r04', text: '對一個人太好，反而不會被珍惜。' },
                  { id: 'belief-label-r05', text: '女生說想要穩定，其實只想要刺激。' },
                  { id: 'belief-label-r06', text: '感情裡先主動的人總是比較吃虧。' },
                  { id: 'belief-label-r07', text: '感情裡比較認真的人，最後一定會受傷。' },
                  { id: 'belief-label-r08', text: '女生有太多選擇，不會真心看見我。' },
                  { id: 'belief-label-r09', text: '只要表現出脆弱，就會失去吸引力。' },
                  { id: 'belief-label-r10', text: '對方沒有馬上回應，就代表她對我沒興趣。' }
                ] },
                { id: 'self', t: '對自己的不自信標籤', items: [
                  { id: 'belief-label-s01', text: '我不夠帥或不夠高，所以不會被喜歡。' },
                  { id: 'belief-label-s02', text: '我的收入或成就不夠好，沒有競爭力。' },
                  { id: 'belief-label-s03', text: '我不會聊天，跟我相處會很無聊。' },
                  { id: 'belief-label-s04', text: '我太內向、太老實，所以不會被選擇。' },
                  { id: 'belief-label-s05', text: '我沒有戀愛經驗，被知道後會被看不起。' },
                  { id: 'belief-label-s06', text: '我不會調情或製造氣氛，所以只能當朋友。' },
                  { id: 'belief-label-s07', text: '只要我先主動，就一定會被拒絕。' },
                  { id: 'belief-label-s08', text: '真實的我不值得被喜歡。' },
                  { id: 'belief-label-s09', text: '我要先變得更好，才有資格談感情。' },
                  { id: 'belief-label-s10', text: '只要關係開始靠近，我最後就會把它搞砸。' }
                ] }
              ],
              fields: [
                { id: 'stage1-other', t: '還有其他常出現的句子嗎？', rows: 3, required: false,
                  help: '如果上面沒有寫到，請用你平常在心裡說話的方式寫下來。', ph: '例如：只要我太認真，對方就會想逃。' },
                { id: 'stage1-core', t: '這次最想處理的一句話', rows: 3,
                  help: '從勾選的句子中選一句最常出現、或最影響你行動的。', ph: '直接抄下那句話，不用先修飾它。' },
                { id: 'stage1-origin', t: '你認為它是怎麼形成的？', rows: 6,
                  help: '可以回想最早或最強烈的一次經驗，也可以是多次被拒絕、家庭、朋友或網路言論的累積。', ph: '那時發生了什麼？你從中學到了什麼？' }
              ]
            },
            stage2: {
              no: '02', t: '跳出信念', en: 'Create a New Experience',
              body: '選一件具體的感情事件，寫下當時的負面信念如何影響你。接著不急著否定它，先設計一個小行動，讓新經驗替你提供新證據。',
              loopTitle: '先看懂舊迴圈',
              loopLead: '把當時的過程拆開，看見信念如何影響行為，又如何用結果證明自己。',
              loopFields: [
                { id: 'stage2-event', t: '具體事件', rows: 5, help: '選一次最近或印象深刻的感情經驗，只寫得到的事實。', ph: '在哪裡、跟誰、發生了什麼？' },
                { id: 'stage2-belief', t: '當時出現的負面信念', rows: 4, help: '寫下那一刻你對自己、對女生或對關係下的結論。可以直接沿用第一階段的句子。', ph: '例如：她沒有馬上回應，一定是我很無聊。' },
                { id: 'stage2-feeling', t: '情緒與身體反應', rows: 4, help: '不只寫「不開心」，也回想胸口、肩膀、胃或呼吸發生了什麼。', ph: '例如：焦慮，胸口很緊，一直重看對話。' },
                { id: 'stage2-behavior', t: '你接著做了什麼？', rows: 4, help: '也可以寫你因此沒做什麼，例如沒邀約、沒說真話或刻意拉開距離。', ph: '你做了什麼，或避開了什麼？' },
                { id: 'stage2-result', t: '最後得到什麼結果？', rows: 4, help: '這個結果又怎麼讓你更相信原本那句話？', ph: '寫下結果，以及它怎麼把信念變得更真。' }
              ],
              pivotTitle: '在這裡停一下',
              pivotBody: '不再證明舊信念，開始設計一次新體驗。',
              exitTitle: '再創造一次新經驗',
              exitLead: '新信念不需要很正面，只要比舊信念多一點空間，並且能帶你做出不同選擇。',
              exitFields: [
                { id: 'stage2-protection', t: '這個舊信念想保護你避開什麼？', rows: 4, help: '例如被拒絕、丟臉、失望，或讓別人看見自己的不安。', ph: '如果繼續相信它，你就不用面對什麼？' },
                { id: 'stage2-exception', t: '有沒有不符合它的例外？', rows: 4, help: '回想自己或身邊的真實經驗。只要有一個例外，這句話就不是全部的事實。', ph: '哪一次經驗曾經與這句話不一樣？' },
                { id: 'stage2-new-belief', t: '你想試著相信的新說法', rows: 4, help: '不用寫「我很棒」。寫一句真實、有彈性，而且會帶來新行動的話。', ph: '例如：一次回應不代表我的全部，我可以清楚表達好感，也尊重對方的選擇。' },
                { id: 'stage2-action', t: '一個可執行的簡易動作', rows: 4, help: '設計一個七天內做得到、也能清楚判斷有沒有完成的動作。', ph: '什麼時間、在哪裡、你會做哪一個小動作？' },
                { id: 'stage2-imagine', t: '先想像自己真的去做', rows: 4, help: '你可能還是緊張。請想像行動當下的畫面、身體感受，以及做完後想怎麼看待自己。', ph: '我可能會感到……當我做完，我希望自己記得……' },
                { id: 'stage2-review', t: '行動後的新證據', rows: 5, required: false, help: '行動後再回來填。結果不一定要成功，重點是你做了與過去不同的選擇。', ph: '實際發生了什麼？這次經驗讓你多看見了什麼？' }
              ]
            }
          }
        } },

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
