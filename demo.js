'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const dictionary = {
    small: ['小的；微小的', '/smɔːl/'], steps: ['步伐；行动', '/steps/'], make: ['产生；使成为', '/meɪk/'], a: ['一个（不定冠词）'], difference: ['改变；影响。make a difference：带来改变', '/ˈdɪfrəns/'],
    you: ['你；你们'], do: ['助动词，与 not 构成否定'], not: ['不'], need: ['需要', '/niːd/'], to: ['用于动词前，表示不定式'], learn: ['学习；学会', '/lɜːrn/'], everything: ['一切；所有事情', '/ˈevriθɪŋ/'], today: ['今天', '/təˈdeɪ/'],
    start: ['开始', '/stɑːrt/'], with: ['和；用；从……开始'], one: ['一个'], useful: ['有用的；实用的', '/ˈjuːsfəl/'], sentence: ['句子', '/ˈsentəns/'],
    say: ['说；说出', '/seɪ/'], it: ['它；这里指前面的句子'], out: ['向外。out loud：大声地'], loud: ['响亮地。out loud：大声地', '/laʊd/'], and: ['和；并且'], your: ['你的'], own: ['自己的。make it your own：融入自己的表达', '/oʊn/'],
    little: ['少量的；一点点', '/ˈlɪtəl/'], practice: ['练习', '/ˈpræktɪs/'], every: ['每一个'], day: ['一天；日子'], builds: ['建立；培养', '/bɪldz/'], habit: ['习惯', '/ˈhæbɪt/'],
    stay: ['保持', '/steɪ/'], curious: ['好奇的；求知欲强的', '/ˈkjʊriəs/'], next: ['接下来的'], step: ['一步；行动', '/step/'], starts: ['开始', '/stɑːrts/'], here: ['这里；此处']
  };
  const storageKey = 'jude-demo-favorites-v1';
  let lessons = [], saved = new Set(), selected = null, active = -1, following = true, toastTimer;
  const clean = word => word.toLowerCase().replace(/[^a-z]/g, '');
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function toast(message) {
    $('toast').textContent = message; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify([...saved])); }
    catch { toast('当前浏览器无法保存，收藏暂留在本次页面中。'); }
  }
  function toggle(key) {
    const adding = !saved.has(key);
    adding ? saved.add(key) : saved.delete(key);
    toast(adding ? '已加入收藏' : '已移出收藏'); persist(); updateSaved();
  }
  function updateSaved() {
    $('count').textContent = saved.size;
    document.querySelectorAll('.save-sentence').forEach((button, i) => {
      const on = saved.has(`s:${i}`);
      button.classList.toggle('saved', on); button.textContent = on ? '♥' : '♡';
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', `${on ? '取消收藏' : '收藏'}第 ${i + 1} 句`);
    });
    if (selected) {
      const on = saved.has(`w:${selected.word}`);
      $('save-word').textContent = on ? '♥ 已收藏 · 点击取消' : '♡ 收藏单词';
      $('save-word').setAttribute('aria-pressed', String(on));
    }
    const list = $('saved-list'); list.replaceChildren();
    if (!saved.size) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('span', '♡'), element('h3', '把喜欢的表达留在这里'), element('p', '去字幕里点一个单词，或收藏一整句话。'));
      list.append(empty); return;
    }
    [...saved].reverse().forEach(key => {
      const card = element('article', undefined, 'saved-card');
      const [kind, id] = key.split(':');
      const title = kind === 'w' ? id : lessons[Number(id)].en;
      const meaning = kind === 'w' ? dictionary[id][0] : lessons[Number(id)].zh;
      card.append(element('span', kind === 'w' ? 'WORD · 单词' : 'SENTENCE · 整句', 'eyebrow'), element('h3', title), element('p', meaning));
      const remove = element('button', '移出收藏');
      remove.setAttribute('aria-label', `移出收藏：${title}`); remove.addEventListener('click', () => toggle(key));
      card.append(remove); list.append(card);
    });
  }
  function showWord(word, i) {
    if (!dictionary[word]) return;
    selected = { word, i };
    $('word').textContent = word; $('phonetic').textContent = dictionary[word][1] || '示例词义';
    $('meaning').textContent = dictionary[word][0];
    $('example-en').textContent = lessons[i].en; $('example-zh').textContent = lessons[i].zh;
    updateSaved(); $('word-dialog').showModal();
  }
  function render() {
    lessons.forEach((lesson, i) => {
      const row = element('article', undefined, 'row'); row.id = `sentence-${i}`;
      const seconds = Math.floor(lesson.start);
      const time = element('button', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 'timestamp');
      time.setAttribute('aria-label', `从第 ${i + 1} 句播放`);
      time.addEventListener('click', () => {
        $('video').currentTime = lesson.start;
        $('video').play().catch(() => toast('请点击视频上的播放按钮。'));
      });
      const content = element('div', undefined, 'sentence-content');
      const english = element('p', undefined, 'sentence');
      lesson.en.split(/(\s+)/).forEach(token => {
        const word = clean(token);
        if (!word) { english.append(document.createTextNode(token)); return; }
        const button = element('button', token, 'word-button');
        button.setAttribute('aria-label', `查看 ${word} 的释义`);
        button.addEventListener('click', () => { if (window.getSelection()?.isCollapsed !== false) showWord(word, i); });
        english.append(button);
      });
      content.append(english, element('p', lesson.zh, 'translation'));
      const heart = element('button', '♡', 'save-sentence'); heart.addEventListener('click', () => toggle(`s:${i}`));
      row.append(time, content, heart); $('transcript').append(row);
    });
    updateSaved(); highlight();
  }
  function highlight() {
    const time = $('video').currentTime;
    const index = lessons.findIndex((line, i) => time >= line.start && (time < line.end || i === lessons.length - 1));
    if (index === active) return;
    active = index;
    document.querySelectorAll('.row').forEach((row, i) => row.classList.toggle('current', i === index));
    // Scroll within the transcript pane so playback remains in place.
    if (following && index >= 0 && !$('transcript-panel').hidden) {
      const row = $(`sentence-${index}`), container = $('transcript');
      container.scrollTop = Math.max(0, row.offsetTop - container.offsetTop - 24);
    }
  }
  $('video').addEventListener('timeupdate', highlight);
  $('video').addEventListener('error', () => toast('示例视频未能加载，请检查网络后刷新。'));
  $('save-word').addEventListener('click', () => { if (selected) toggle(`w:${selected.word}`); });
  $('speak').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) { toast('此浏览器暂不支持语音朗读。'); return; }
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(selected.word); utterance.lang = 'en-US'; utterance.rate = 0.85;
    utterance.onerror = () => toast('语音暂不可用，可以播放示例听原句。'); speechSynthesis.speak(utterance);
  });
  ['english', 'bilingual'].forEach(id => $(id).addEventListener('click', () => {
    ['english', 'bilingual'].forEach(option => { $(option).classList.toggle('active', option === id); $(option).setAttribute('aria-pressed', String(option === id)); });
    document.querySelectorAll('.translation').forEach(line => { line.hidden = id === 'english'; });
  }));
  ['transcript', 'saved'].forEach(id => $(`${id}-tab`).addEventListener('click', () => {
    ['transcript', 'saved'].forEach(option => { $(`${option}-panel`).hidden = option !== id; $(`${option}-tab`).classList.toggle('active', option === id); $(`${option}-tab`).setAttribute('aria-pressed', String(option === id)); });
  }));
  $('follow').addEventListener('click', () => { following = !following; $('follow').setAttribute('aria-pressed', String(following)); $('follow').textContent = following ? '跟随播放' : '自由阅读'; });
  $('word-dialog').setAttribute('aria-labelledby', 'word');
  $('about').addEventListener('click', () => $('about-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  fetch('lesson.json').then(response => { if (!response.ok) throw Error('lesson'); return response.json(); }).then(data => {
    lessons = data;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(stored)) saved = new Set(stored.filter(key => typeof key === 'string' && (/^s:\d+$/.test(key) ? Number(key.slice(2)) < lessons.length : key.startsWith('w:') && Object.hasOwn(dictionary, key.slice(2)))));
    } catch { /* Corrupt or unavailable browser storage starts empty. */ }
    render();
  }).catch(() => { $('transcript').textContent = '示例字幕暂时未能加载，请检查网络后刷新。'; });
})();
