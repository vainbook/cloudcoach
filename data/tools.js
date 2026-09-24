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

  /* 新版共用寫作器是一題一份整合內容。舊版四欄 id 留在 legacyFields，
     讓已填過的故事可以先合併顯示，不會因介面改版而消失。 */
  function storyFocusFields() {
    var sections = {};
    STORY_SECTIONS.forEach(function (section) { sections[section.id] = section; });
    return storyGroups().map(function (group) {
      var section = sections[group.section] || {};
      var example = group.example
        ? '頭條式標題：' + group.example.headline
          + '\n\n具體事件與劇情：' + group.example.event
          + '\n\n故事傳遞的價值：' + group.example.value
          + '\n\n對話脈絡與引導問句：' + group.example.context
        : '';
      return {
        id: group.id + '-content', t: group.t, parent: section.t || '',
        sub: '從「' + group.t + '」找出一件你真的經歷過、也願意分享的事。',
        scope: '依序整理頭條式標題、具體事件與劇情、故事傳遞的價值，以及對話脈絡與引導問句。',
        ph: '頭條式標題：\n\n具體事件與劇情：\n\n故事傳遞的價值：\n\n對話脈絡與引導問句：',
        example: example,
        legacyFields: group.fields.map(function (field) { return { id: field.id, t: field.t }; })
      };
    });
  }

  function repeatedFocusFields(prefix, count, title, config) {
    return Array.from({ length: count }, function (_, i) {
      var no = ('0' + (i + 1)).slice(-2);
      var field = {
        id: prefix + '-' + no,
        t: title + ' ' + (i + 1),
        sub: config.sub,
        scope: config.scope,
        ph: config.ph,
        formatGuide: config.formatGuide || [],
        example: config.example || ''
      };
      if (i === 0 && Array.isArray(config.legacyFields)) field.legacyFields = config.legacyFields;
      return field;
    });
  }

  function listEntryFields(prefix, count, label) {
    return Array.from({ length: count }, function (_, i) {
      var no = ('0' + (i + 1)).slice(-2);
      return { id: prefix + '-' + no, t: label + ' ' + no };
    });
  }

  var PERSONALITY_TRAITS = [
    '真誠', '開放', '勇敢', '自信', '善良', '溫柔', '熱情', '樂觀',
    '幽默', '好奇', '可靠', '負責', '堅定', '耐心', '細心', '體貼',
    '同理', '自律', '創意', '行動力', '包容', '獨立', '謙遜', '沉著'
  ];

  function personalityFields() {
    return Array.from({ length: 3 }, function (_, i) {
      return {
        id: 'personality-' + ('0' + (i + 1)).slice(-2),
        t: '人格特質 ' + (i + 1),
        sub: '選一個真的曾經在你的選擇與行動裡出現過的特質，再用故事說明它。',
        scope: '不用挑「最好聽」的詞，而是找一個你真正認得出來的自己。想想你曾經在什麼時候因為這個特質做了一個選擇，以及你準備如何在這次課程中主動表達它。',
        ph: '為什麼這是我：\n\n代表我的故事：\n\n這次課程中的應用：',
        choiceRequired: true,
        options: PERSONALITY_TRAITS,
        formatGuide: [
          { t: '為什麼這是我', body: '寫下這個特質平常如何出現在你的行動、選擇或與人相處的方式裡。重點不是證明自己完美，而是把真實的自己說清楚。' },
          { t: '代表我的故事', body: '選一件具體事件：當時發生了什麼、你做了什麼，這個特質又如何被看見。' },
          { t: '這次課程中的應用', body: '寫下一個能實際行動的做法。例如在練習、人際互動或完成作業時，你會怎麼運用與傳遞這個特質。' }
        ]
      };
    });
  }

  window.UC_TOOLS = {
    review: false,

    items: [
      { k: 'selfknowledge', t: '認識自己', en: 'Know Yourself', status: 'active',
        cover: 'assets/course-covers/01-awareness-abstract-color-v3.webp',
        lead: '找出三個已經存在於你身上、也能代表你的特質。',
        body: '自信不是勉強把自己說得很好，而是認得出來：我是誰，我曾經怎麼做出選擇，又希望別人看見什麼樣的我。\n\n這些特質不需要重新發明，它們可能早已出現在你的生活。這份作業會幫你從故事中把它們找回來，並在這次課程中更主動地運用與傳遞。',
        assignment: {
          id: 'selfknowledge', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '認識自己',
          title: '找出代表你的三個特質', progressUnit: '個特質',
          note: '三題請選擇不同特質。不用追求最理想的形容詞，先從你真的做過、也能說出故事的部分開始。',
          prompt: '從特質清單中選出三個最能代表你的詞。每個特質都寫下：為什麼這是你、哪一個故事能代表，以及你會怎麼把它應用在這次課程。',
          fields: personalityFields()
        } },

      { k: 'lifeblueprint', t: '生活藍圖', en: 'Life Blueprint', status: 'active',
        cover: 'assets/course-covers/tool-01-life-blueprint-v1.webp',
        lead: '先設計一種你自己也會喜歡的生活。',
        body: '真正的魅力，不只是會不會聊天，更來自你正在過什麼樣的生活。一個人對自己的日子有好奇、有投入，也有想前往的方向，就會自然有故事、想法和生命力可以與人分享。\n\n社交技巧是傳遞這些內容的工具，但它不能代替生活本身。只有當你先喜歡自己的生活，別人才有機會看見你、理解你，也喜歡和你一起經歷這樣的生活。',
        assignment: {
          id: 'lifeblueprint', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '生活藍圖',
          title: '描寫你的生活藍圖', progressUnit: '個主題',
          placeholder: '目前狀況：\n\n想達到的目標：\n\n準備如何實踐：\n\n為什麼想要：',
          formatGuide: [
            { t: '目前狀況', body: '先寫這個主題現在真實的樣子，包括已經做到的部分與仍然卡住的地方。' },
            { t: '想達到的目標', body: '寫下你希望未來出現的具體改變，讓人能看見你想過的生活。' },
            { t: '準備如何實踐', body: '寫下一個可以開始執行的做法，也可以補上頻率或時間安排。' },
            { t: '為什麼想要', body: '寫下這個改變對你的生活或關係有什麼意義。' }
          ],
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
          id: 'chattopics', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '聊天話題庫',
          title: '建立你的聊天話題庫', progressUnit: '個故事',
          note: '先完成第一輪，再回來補第二輪。〈戀愛三步驟〉先替十二個題目各選一件重大事件；上完〈說故事〉後，再補齊劇情細節、想傳遞的價值與對話脈絡。',
          prompt: '三大主軸共十二個題目。每個題目都要完成「頭條式標題、具體事件與劇情、故事傳遞的價值、對話脈絡與引導問句」四欄。',
          formatGuide: STORY_FIELDS.map(function (field) {
            return { t: field.t, body: field.help };
          }),
          steps: [
            { no: '01', t: '戀愛三步驟', body: '先找出每個題目中最想分享的重大事件，寫下標題與事件骨架。' },
            { no: '02', t: '說故事', body: '回來做減法與加法，補足感受、價值和能自然帶出故事的引導問句。' }
          ],
          sections: STORY_SECTIONS,
          groups: storyGroups(),
          fields: storyFocusFields()
        } },

      { k: 'beliefs', t: '信念系統', en: 'Belief System', status: 'active',
        cover: 'assets/course-covers/tool-04-belief-system-v1.webp',
        lead: '看見限制自己的信念，才有機會做出不同選擇。',
        body: '一件重大事件，可能讓我們對自己、女生或感情下了一個結論。結論久了會變成信念，遇到相似情境時，就會自動帶出同一種反應。這份作業不是要用正面口號否定過去，而是看懂這個迴圈，再替自己留下新的選擇。',
        assignment: {
          id: 'beliefs', version: 2, kind: 'focus-editor', scene: 'moon', topicLabel: '限制性信念',
          title: '找到你的限制性信念', progressUnit: '次練習',
          note: '請完成三次練習。每次只處理一件具體事件，不用一次解決所有想法。',
          prompt: '先寫出事件、當時形成的信念與自動化反應，再思考：如果不再照原本的方式反應，可能發生什麼？你願意做出哪一個新選擇？',
          fields: repeatedFocusFields('belief', 3, '信念練習', {
            sub: '從一件具體的感情事件，看懂信念如何帶出你的自動反應。',
            scope: '受限信念先整理重大事件、你從中相信了什麼，以及之後遇到類似情況會自動做什麼。新的發現與選擇，則思考不再照原本方式反應時，可能出現什麼不同結果。',
            ph: '受限信念：\n\n新的發現與選擇：',
            formatGuide: [
              { t: '受限信念', body: '寫下重大事件、你從事件中形成的信念，以及它帶出的自動化反應。信念可能是對自己、女生或感情的結論；它不一定是完整事實，但可能正在限制你的行動。' },
              { t: '新的發現與選擇', body: '想一想：如果不再照原本的自動反應做，會怎麼樣？你看見了什麼新的可能，又願意先嘗試哪一個簡單、可執行的選擇？' }
            ],
            legacyFields: [
              { id: 'stage2-event', t: '重大事件' }, { id: 'stage1-origin', t: '形成過程' },
              { id: 'stage1-core', t: '受限信念' }, { id: 'stage2-belief', t: '事件中的信念' },
              { id: 'stage2-behavior', t: '自動化反應' }, { id: 'stage2-result', t: '原本的結果' },
              { id: 'stage2-exception', t: '新的發現' }, { id: 'stage2-new-belief', t: '新的說法' },
              { id: 'stage2-action', t: '新的選擇' }, { id: 'stage2-imagine', t: '想像與感受' },
              { id: 'stage2-review', t: '行動後的新證據' }
            ]
          })
        } },

      { k: 'responsible', t: '負責任心態', en: 'Responsible Mindset', status: 'active',
        cover: 'assets/course-covers/tool-05-responsible-version-v1.webp',
        lead: '承認自己受過的傷，也把未來的選擇拿回手上。',
        body: '負責任不是把所有錯都怪到自己身上，也不是替傷害你的人找理由。它是在承認事情真的發生、自己真的有感受之後，重新看見：我從中學到了什麼，接下來想怎麼選擇。',
        assignment: {
          id: 'responsible', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '負責任心態',
          title: '練習負責任心態', progressUnit: '次練習',
          note: '請完成三次練習。若事件涉及暴力、性侵害、詐騙或其他非自願傷害，不需要逼自己替傷害負責；請另外與教練討論安全與支持。',
          prompt: '先誠實寫出自己最受害的故事，再整理：這段經驗讓你學到什麼？未來你想用什麼心態與選擇面對？',
          fields: repeatedFocusFields('responsible', 3, '心態練習', {
            sub: '把同一件事的受害者故事與負責任心態寫在一起。',
            scope: '受害者故事不是不能說，而是先看見自己如何描述這段經驗。接著把焦點放回自己能帶走的學習與未來的選擇。',
            ph: '我的受害者故事：\n\n我的負責任心態：',
            formatGuide: [
              { t: '我的受害者故事', body: '這件事怎麼發生？你最覺得自己受害、委屈或無能為力的地方是什麼？先如實寫下來，不需要急著合理化。' },
              { t: '我的負責任心態', body: '這不等於承認都是你的錯。請寫下你從中學到什麼，以及未來想採取什麼心態或選擇，讓自己不只停在受害的位置。' }
            ]
          })
        } },

      { k: 'relationshipvalues', t: '感情價值觀', en: 'Relationship Values', status: 'active',
        cover: 'assets/course-covers/tool-06-relationship-values-v1.webp',
        lead: '用三道門，分清楚喜歡、交往與長期承諾需要看見的事情。',
        body: '感情價值觀不是列一張完美條件表，而是讓自己在關係的不同階段，知道正在了解什麼、重視什麼，以及有哪些界線。這一版先建立三門框架，進入與離開各階段的細節之後再補。',
        assignment: {
          id: 'relationshipvalues', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '感情價值觀',
          title: '整理你的感情三門', progressUnit: '道門',
          note: '目前先寫下框架，不需要急著訂出所有進出標準。之後會再補上每一門更完整的定義。',
          prompt: '分別思考這個階段重視什麼、能從相處中觀察什麼，以及有哪些不能忽略的界線。',
          formatGuide: [
            { t: '我重視什麼', body: '寫下這個階段對你真正重要的特質、相處感受或共同方向。' },
            { t: '我會如何從相處中觀察', body: '不要只寫抽象形容詞，想想你會從哪些實際互動看見它。' },
            { t: '我的界線是什麼', body: '寫下你不願勉強自己接受，或需要再討論清楚的事情。' }
          ],
          fields: [
            { id: 'potential', t: '潛在對象', sub: '還在認識彼此時，你想看見什麼？', scope: '先整理什麼會讓你願意繼續認識一個人，以及初期相處中不能忽略的訊號。', ph: '我重視什麼：\n\n我會如何從相處中觀察：\n\n我的界線是什麼：' },
            { id: 'relationship', t: '穩定交往', sub: '進入關係後，你希望怎麼一起經營？', scope: '思考穩定交往需要的互動、溝通與投入，而不只是在意是否有名分。', ph: '我重視什麼：\n\n我會如何從相處中觀察：\n\n我的界線是什麼：' },
            { id: 'lifepartner', t: '終身伴侶', sub: '面對長期共同生活，你最在意什麼？', scope: '思考長期承諾、生活方向與共同面對現實時，需要確認的核心價值。', ph: '我重視什麼：\n\n我會如何從相處中觀察：\n\n我的界線是什麼：' }
          ]
        } },

      { k: 'datemap', t: '約會地圖', en: 'Date Map', status: 'active',
        cover: 'assets/course-covers/tool-03-date-map-v1.webp',
        lead: '主動設計一段值得一起經歷的時間，而不是只把地點排在一起。',
        body: '好的約會行程，不只是在找一間餐廳或一個景點，而是先想清楚：希望兩個人怎麼相處、留下什麼感受，又能從過程中認識彼此的哪一面。',
        assignment: {
          id: 'datemap', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '約會地圖',
          title: '設計三種約會行程', progressUnit: '份行程',
          note: '每個主題規劃一份就好。重點不是安排得很滿，而是讓彼此有足夠的相處、聊天與互動。',
          prompt: '先寫主要行程，再補一個自然的轉場活動。最後寫下這次行程想創造的感受，或想認識彼此的哪一個面向。',
          formatGuide: [
            { t: '約會行程', body: '寫下主要行程與轉場活動。主要行程可能無法完成所有聊天與互動，轉場可以是散步、找地方坐坐或一起移動，替彼此保留繼續相處的空間。' },
            { t: '約會目的', body: '寫下這次行程希望創造什麼感受，或希望從相處中認識彼此的哪一個面向。' }
          ],
          fields: [
            { id: 'friends', t: '朋友見面', sub: '為已經認識的朋友設計一段自在、有互動的相處。', scope: '想像你要主動發起一次見面：除了主要活動，還能怎麼自然延續聊天與互動？', ph: '約會行程：\n\n約會目的：' },
            { id: 'dating', t: '曖昧約會', sub: '讓彼此有機會靠近，也保留舒服自然的節奏。', scope: '思考這次約會想創造的氣氛，以及如何透過行程多認識彼此。', ph: '約會行程：\n\n約會目的：' },
            { id: 'couple', t: '情侶行程', sub: '替穩定關係創造新的共同體驗。', scope: '不要只複製平常的行程，想一件能讓兩個人重新交流或一起留下記憶的事。', ph: '約會行程：\n\n約會目的：' }
          ]
        } },

      { k: 'movies', t: '電影清單', en: 'Film List', status: 'active',
        cover: 'assets/course-covers/tool-07-film-list-v1.webp',
        lead: '借用電影裡的關係，整理自己對感情的感受、期待與學習。',
        body: '即使還沒有很多戀愛經驗，也能透過電影觀察關係、形成自己的想法。這不是影評作業；你可以從一部或多部電影裡，挑出真正讓你有感覺的劇情來談。',
        assignment: {
          id: 'movies', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '電影清單',
          title: '從電影整理感情觀', progressUnit: '個主題',
          note: '推薦片單在冒險下方「電子書與書單」的〈推薦電影〉。三個主題可以來自同一部電影，也可以分別使用不同電影。',
          prompt: '先簡單說明讓你有感覺的劇情，再寫它讓你想到什麼。重點是你的理解，不需要完整重述電影。',
          formatGuide: [
            { t: '劇情是什麼？', body: '簡單交代角色、關係與發生的關鍵事件，只留下理解你心得所需要的劇情。' },
            { t: '我的心得是什麼？', body: '寫下這段劇情讓你怎麼理解愛、自己的期待，或關係裡值得學習的事。' }
          ],
          referenceTitle: '推薦電影', referenceLead: '推薦片單在「電子書與書單」的〈推薦電影〉；也可以用自己看過、確實有感觸的電影完成作業。',
          fields: [
            { id: 'feeling', t: '感情的感受', sub: '從電影思考：什麼是愛？', scope: '選一段讓你感受到愛、靠近、失去或被理解的劇情，寫出你對「愛」的認識。', ph: '劇情是什麼？\n\n我的心得是什麼？' },
            { id: 'expectation', t: '感情的期待', sub: '從電影思考：我期待什麼？', scope: '選一段讓你看見關係樣貌的劇情，整理自己真正期待的相處與感受。', ph: '劇情是什麼？\n\n我的心得是什麼？' },
            { id: 'learning', t: '感情的學習', sub: '從電影思考：我學到什麼？', scope: '選一段讓你重新理解關係的劇情，寫下你想帶進未來感情裡的學習。', ph: '劇情是什麼？\n\n我的心得是什麼？' }
          ]
        } },

      { k: 'interests', t: '興趣清單', en: 'Interest List', status: 'active',
        cover: 'assets/course-covers/tool-08-interest-list-v1.webp',
        lead: '找到真的願意去做的活動，讓生活多一點投入，也多一點可以分享的內容。',
        body: '興趣不是為了讓履歷看起來豐富，而是讓你從行動中獲得體驗、能力與樂趣。實際做過之後，這些經驗也會自然成為能和別人分享的聊天話題。',
        assignment: {
          id: 'interests', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '興趣清單',
          title: '建立你的興趣清單', progressUnit: '項興趣',
          note: '分成「地點」和「活動」兩個子主題，各五項。可以先寫想去、想嘗試的，實際行動後再回來補上體驗。',
          prompt: '不要只收藏資料。請寫下為什麼想去、想做，並替自己留下真的去體驗一次的方向。',
          sectionLabel: '兩個子主題', sectionLead: '選一格開始寫。',
          /* ⚠️ 活動沿用舊的 interest-01～05：改版前學員寫的全是活動，id 不換，舊內容才不會變孤兒。 */
          sections: [
            { id: 'place', no: '01', t: '地點', en: 'Places' },
            { id: 'activity', no: '02', t: '活動', en: 'Activities' }
          ],
          fields: repeatedFocusFields('place', 5, '地點', {
            sub: '挑一個你想去、也有機會真的去一次的地方。',
            scope: '先記下地點與相關資料，再寫為什麼想去。去過之後回來補上真實體驗：你感受到什麼、還想不想再去？',
            ph: '想去的地點：\n\n相關資料：\n\n為什麼想去：\n\n去過之後的體驗：',
            formatGuide: [
              { t: '想去的地點', body: '寫下明確的店名或地點，例如一間酒吧、一座步道、一間展覽館，不只寫「咖啡廳」。' },
              { t: '相關資料', body: '記下地址、營業時間、費用、連結，或任何能幫你真的出發的資訊。' },
              { t: '為什麼想去', body: '寫下它吸引你的地方，以及你希望在那裡獲得什麼。' },
              { t: '去過之後的體驗', body: '實際去過再回來補：現場的感受、有沒有認識人、是否想再去或帶人去。' }
            ]
          }).map(function (f) { f.parent = '地點'; return f; }).concat(
          repeatedFocusFields('interest', 5, '活動', {
            sub: '挑一件你有興趣、也有機會實際嘗試的活動。',
            scope: '先記下活動與相關資料，再寫為什麼想做。行動之後回來補上真實體驗：你感受到什麼、得到什麼，還想不想繼續？',
            ph: '感興趣的活動：\n\n相關資料：\n\n為什麼想做：\n\n行動後的體驗：',
            formatGuide: [
              { t: '感興趣的活動', body: '寫下明確的活動名稱，不只寫「運動」或「旅行」這種大分類。' },
              { t: '相關資料', body: '記下地點、課程、社群、費用、連結或其他能幫助你真的開始的資訊。' },
              { t: '為什麼想做', body: '寫下它吸引你的地方，以及你希望從活動中獲得什麼。' },
              { t: '行動後的體驗', body: '實際做完再回來補：過程有什麼感受、學到什麼，是否想繼續。' }
            ]
          }).map(function (f) { f.parent = '活動'; return f; }))
        } },

      { k: 'humor', t: '幽默清單', en: 'Humor List', status: 'active',
        cover: 'assets/course-covers/tool-09-humor-list-v1.webp',
        lead: '先建立自己的有趣素材庫，聊天時才有東西可以自然分享。',
        body: '幽默不只是一句完整笑話，也可以是一個有趣觀察、一段影片、一張圖片或生活裡發生的小事。先收集真正讓你覺得有趣的內容，再慢慢找到適合自己的表達方式。',
        assignment: {
          id: 'humor', version: 1, kind: 'focus-editor', mode: 'list', scene: 'moon', topicLabel: '幽默清單',
          title: '收集十個有趣的東西', progressUnit: '則素材',
          note: '可以貼連結，也可以寫下影片、圖片、簡短笑話、有趣觀察或生活事件。十格會整合成同一份作業回報。',
          prompt: '選擇你自己真的覺得有趣、也願意在聊天中分享的內容。幽默六梗之後再補，現在先專心累積素材。',
          listPlaceholder: '貼上連結，或寫下有趣的內容',
          fields: listEntryFields('humor', 10, '幽默素材')
        } },

      { k: 'curiosity', t: '好奇心話題庫', en: 'Curiosity Library', status: 'active',
        cover: 'assets/course-covers/tool-10-curiosity-library-v1.webp',
        lead: '準備能讓彼此分享想法、故事與感受的問題。',
        body: '好的好奇心不是連續盤問，而是真的想知道對方怎麼看世界。問題要能打開一段分享，你也願意回答同一題，讓聊天成為雙向交流。',
        source: '題庫依 Aron 等人（1997）的親密感研究整理；中文為本網站的改寫草稿。',
        assignment: {
          id: 'curiosity', version: 1, kind: 'focus-editor', mode: 'list', scene: 'moon', topicLabel: '好奇心話題庫',
          title: '想出十個有趣的話題', progressUnit: '個話題',
          note: '下方的 36 題可以作為參考，不需要照抄。最後請留下十個你真的想問、也願意自己回答的問題。',
          prompt: '優先寫能邀請對方分享想法、故事或感受的問題。避免像身家調查，也不要只追求問題看起來很深。',
          referenceTitle: '參考題庫｜36 題愛上你',
          referenceLead: '觀察這些問題如何從日常偏好，慢慢走向人生經驗與內在感受。',
          referenceTopics: Q36,
          listPlaceholder: '寫下一個你真的想聊的問題',
          fields: listEntryFields('curiosity', 10, '好奇話題')
        } },

      /* ── 準備階段的練習型作業（使用者 2026-09-24）─────────────
         OKR 的方向是「先具備能力」：這三份都是在熟人身上先練幾次，
         之後才帶到社交與約會。格式比照興趣清單：一格一次，四段紀錄。 */
      { k: 'praise', t: '稱讚練習', en: 'Appreciation Practice', status: 'active', cover: '',
        lead: '練習看見別人的好，並且說出口。',
        body: '欣賞是一種能力：先注意到對方做得好、讓你喜歡的地方，再用具體的話告訴他。先從身邊的人開始，稱讚 10 個人，說得自然了，之後遇到新朋友也能真誠地開口。',
        assignment: {
          id: 'praise', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '主動欣賞',
          title: '稱讚 10 個身邊的人', progressUnit: '人稱讚',
          note: '一格一個人。家人、朋友、同事都可以，但要是 10 個不同的人。',
          prompt: '稱讚要具體、要真心。與其說「你很棒」，不如說出你看見的那件事，以及它讓你有什麼感受。',
          fields: repeatedFocusFields('praise', 10, '稱讚', {
            sub: '記下一次你主動稱讚身邊的人的經過。',
            scope: '寫下你稱讚了誰、欣賞他的哪一點、實際怎麼說，以及對方的反應。',
            ph: '對象與關係：\n\n我欣賞他的地方：\n\n我說了什麼：\n\n對方的反應：\n\n我的感受：',
            formatGuide: [
              { t: '對象與關係', body: '是誰、你們平常怎麼相處。' },
              { t: '我欣賞他的地方', body: '一件具體的事、一個行為或特質，而不只是外表。' },
              { t: '我說了什麼', body: '盡量寫出原句，也可以記下你是當面說還是傳訊息。' },
              { t: '對方的反應', body: '對方怎麼回應，是開心、害羞，還是有點意外。' },
              { t: '我的感受', body: '開口前後的心情，以及下次想怎麼說得更自然。' }
            ]
          })
        } },

      { k: 'caring', t: '關心練習', en: 'Caring Practice', status: 'active', cover: '',
        lead: '先從身邊的人開始，練習把注意力放在別人身上。',
        body: '同理心不是一個想法，而是一個動作：注意到對方的狀態，然後主動問一句、做一件事。先在朋友、家人或同事身上練習，累積到自然了，再帶進新認識的人。',
        assignment: {
          id: 'caring', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '同理心',
          title: '主動關心他人 10 次', progressUnit: '次關心',
          note: '對象可以重複，但每一格都是一次真的發生過的關心。做完當天就回來記，細節最清楚。',
          prompt: '關心的重點是對方，不是展現你自己。先注意到對方的狀態，再決定要問什麼、做什麼。',
          fields: repeatedFocusFields('caring', 10, '關心', {
            sub: '記下一次你主動關心別人的經過。',
            scope: '寫清楚你注意到了什麼、怎麼開口，以及對方的反應。最後留一句給自己：下次會想怎麼做？',
            ph: '對象與情境：\n\n我注意到什麼：\n\n我說了或做了什麼：\n\n對方的反應：\n\n我的感受與下次調整：',
            formatGuide: [
              { t: '對象與情境', body: '是誰、在什麼時候、透過什麼方式（見面、訊息、電話）。' },
              { t: '我注意到什麼', body: '讓你想關心他的那個訊號：一句話、一個表情、最近發生的事。' },
              { t: '我說了或做了什麼', body: '盡量寫出原句或具體動作，而不是「我關心了他」。' },
              { t: '對方的反應', body: '對方怎麼回應、有沒有多說一些，或是反應比你想的冷淡。' },
              { t: '我的感受與下次調整', body: '這次哪裡自然、哪裡卡住，下次想換什麼方式。' }
            ]
          })
        } },

      { k: 'feedback', t: '回饋收集', en: 'Feedback Collection', status: 'active', cover: '',
        lead: '主動請別人說說看你，把別人眼中的你收集起來。',
        body: '開放上進的起點，是願意聽見自己看不到的部分。找 10 個人，請他們給你回應或建議：你給人的感覺、你的優點、你可以調整的地方。先聽完、記下來，不急著解釋。',
        assignment: {
          id: 'feedback', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '開放上進',
          title: '蒐集 10 個人給你的回應／建議', progressUnit: '人回應',
          note: '一格一個人。對象越多元越好：朋友、家人、同事，或是認識不久的人。',
          prompt: '收到回應時先說謝謝，不要當場辯解。回饋不一定都對，但每一則都值得先記下來再判斷。',
          fields: repeatedFocusFields('feedback', 10, '回應', {
            sub: '記下一個人給你的回應或建議。',
            scope: '寫下你問了誰、怎麼問，對方實際說了什麼，以及你聽完的想法。',
            ph: '詢問對象與關係：\n\n我怎麼問：\n\n對方的回應／建議：\n\n我的收穫與想嘗試的調整：',
            formatGuide: [
              { t: '詢問對象與關係', body: '是誰、認識多久、平常怎麼相處。' },
              { t: '我怎麼問', body: '寫下你的問法，例如「你覺得我給人的第一印象是什麼？」。' },
              { t: '對方的回應／建議', body: '盡量照原意記錄，好的和不好聽的都寫。' },
              { t: '我的收穫與想嘗試的調整', body: '哪一句讓你意外、哪一句想先試著改。' }
            ]
          })
        } },

      { k: 'thanksapology', t: '感謝與道歉', en: 'Thanks & Apology', status: 'active', cover: '',
        lead: '把平常放在心裡的謝謝和對不起，真的說出口。',
        body: '真誠需要一點冒險：主動向人表達感謝，或為自己做過的事道歉，都是把真實的自己拿出來。對象可以是家人、朋友、以前的同學或同事。說出口之後，把過程記下來。',
        assignment: {
          id: 'thanksapology', version: 1, kind: 'focus-editor', scene: 'moon', topicLabel: '真誠冒險',
          title: '主動向人表達感謝／道歉 3 次', progressUnit: '次表達',
          note: '感謝和道歉可以混著算，總共三次。重點是主動，不是等對方先開口。',
          prompt: '不需要準備完美的講稿。說出具體的事，比說很多形容詞更有力量。',
          fields: repeatedFocusFields('thanksapology', 3, '表達', {
            sub: '記下一次你主動感謝或道歉的經過。',
            scope: '寫下對象、你為了什麼事感謝或道歉、實際說了什麼，以及說完之後的感受。',
            ph: '對象與關係：\n\n感謝還是道歉？為了什麼事：\n\n我說了什麼：\n\n對方的反應：\n\n說完之後的感受：',
            formatGuide: [
              { t: '對象與關係', body: '是誰、你們現在的關係如何。' },
              { t: '感謝還是道歉？為了什麼事', body: '寫出一件具體的事，而不是「謝謝你一直以來的照顧」。' },
              { t: '我說了什麼', body: '盡量寫出原句，也可以記下你是當面、打電話還是傳訊息。' },
              { t: '對方的反應', body: '對方怎麼回應，有沒有出乎你的意料。' },
              { t: '說完之後的感受', body: '開口前後的心情有什麼不同，下次會不會更容易。' }
            ]
          })
        } }
    ]
  };
})();
