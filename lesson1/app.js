(() => {
  const L = () => window.LESSON;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const player = $('#player');

  let activeSent = 0;
  let queue = [];
  let mode = null; // 'word' | 'sentence' | null
  let karaokeOn = false;
  let lastWordIdx = -1;
  /** シャッフルされた出題順（元 quizzes の index） */
  let quizOrder = [];
  /** quizOrder 上の位置 */
  let quizCursor = 0;
  /** 正解済みの数 */
  let quizSolved = 0;
  let quizLocked = false;
  /** 不正解後：同じ問題を再挑戦する待ち */
  let quizAwaitRetry = false;
  /** 並べ替え・マッチング用の一時状態 */
  let quizState = {};

  const show = {
    words: { py: true, ja: true },
    sents: { py: true, ja: true }
  };

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function normalizeAnswer(s) {
    return String(s || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[。．.！!？?，,、]/g, '');
  }

  function setStatus(msg) {
    const el = $('#status-text');
    if (el) el.textContent = msg;
  }

  function currentSpeed() {
    if (mode === 'word') return Number($('#speed-words').value);
    return Number($('#speed-sents').value);
  }

  function stopAll(msg = '再生を停止しました。') {
    queue = [];
    karaokeOn = false;
    lastWordIdx = -1;
    player.pause();
    player.removeAttribute('src');
    try { player.load(); } catch (_) { /* ignore */ }
    $$('.word-card.is-playing').forEach((el) => el.classList.remove('is-playing'));
    clearKaraokeClasses();
    mode = null;
    setStatus(msg);
  }

  function clearKaraokeClasses() {
    $$('#sent-zh .word').forEach((el) => el.classList.remove('is-current', 'is-spoken'));
  }

  function playQueue(items, label, nextMode) {
    mode = nextMode;
    queue = [...items];
    setStatus(label);
    playNext();
  }

  function playNext() {
    const item = queue.shift();
    if (!item) {
      karaokeOn = false;
      clearKaraokeClasses();
      $$('.word-card.is-playing').forEach((el) => el.classList.remove('is-playing'));
      setStatus('再生が終わりました。もう一度でも、自分で言ってみてもOKです。');
      mode = null;
      return;
    }

    if (item.kind === 'word') {
      karaokeOn = false;
      clearKaraokeClasses();
      $$('.word-card').forEach((el) => {
        el.classList.toggle('is-playing', Number(el.dataset.id) === item.id);
      });
      const card = $(`.word-card[data-id="${item.id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (item.kind === 'sentence') {
      activeSent = L().sentences.findIndex((s) => s.id === item.id);
      if (activeSent < 0) activeSent = 0;
      renderSentenceStage();
      startKaraoke();
      $('#sent-stage')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    player.src = item.audio;
    player.playbackRate = currentSpeed();
    const p = player.play();
    if (p?.catch) {
      p.catch(() => setStatus('再生できませんでした。もう一度ボタンを押してください。'));
    }
  }

  /* —— Words —— */
  function renderWords() {
    const grid = $('#word-grid');
    grid.innerHTML = L().words.map((w) => {
      const pyOff = show.words.py ? '' : ' py-off';
      const jaOff = show.words.ja ? '' : ' ja-off';
      return `<button type="button" class="word-card${pyOff}${jaOff}" data-id="${w.id}" aria-label="${w.zh} ${w.py} ${w.ja} を再生">
        <span class="no">${String(w.id).padStart(2, '0')}</span>
        <span class="zh" lang="zh-CN">${w.zh}</span>
        <span class="py">${w.pyList ? w.pyList.join(' ') : w.py}</span>
        <span class="ja">${w.ja}</span>
        <span class="play-hint">▶ タップして聴く</span>
      </button>`;
    }).join('');
  }

  /* —— Sentences —— */
  function isHan(ch) {
    return /[\u3400-\u9fff]/.test(ch);
  }

  function wordEntry(word) {
    return L().words.find((w) => w.zh === word) || null;
  }

  function wordPy(word) {
    const found = wordEntry(word);
    if (found?.py) return found.py;
    if (window.pinyinPro?.pinyin) return window.pinyinPro.pinyin(word, { toneType: 'symbol' });
    return '—';
  }

  function charPinyinList(word) {
    const chars = [...word].filter(isHan);
    const found = wordEntry(word);
    if (found?.pyList && found.pyList.length === chars.length) {
      return found.pyList.slice();
    }
    if (window.pinyinPro?.pinyin) {
      const arr = window.pinyinPro.pinyin(word, {
        toneType: 'symbol',
        type: 'array',
        nonZh: 'removed'
      });
      if (Array.isArray(arr) && arr.length === chars.length) return arr;
      return chars.map((ch) => window.pinyinPro.pinyin(ch, { toneType: 'symbol' }) || '—');
    }
    return chars.map(() => '—');
  }

  function wordRubyHtml(word) {
    const pys = charPinyinList(word);
    let i = 0;
    return [...word].map((ch) => {
      if (!isHan(ch)) return ch;
      const py = pys[i++] || '—';
      return `<ruby>${ch}<rt>${py}</rt></ruby>`;
    }).join('');
  }

  function buildSentenceHtml(sent) {
    const tokens = [];
    let pos = 0;
    let wi = 0;
    const text = sent.zh;
    const words = sent.words;

    while (pos < text.length) {
      const ch = text[pos];
      if (!isHan(ch)) {
        tokens.push(`<span class="punct">${ch}</span>`);
        pos += 1;
        continue;
      }
      if (wi < words.length && text.startsWith(words[wi], pos)) {
        const w = words[wi];
        const py = wordPy(w);
        const weight = Math.max(1, [...w].filter(isHan).length);
        const ruby = wordRubyHtml(w);
        tokens.push(
          `<button type="button" class="word" data-wi="${wi}" data-word="${w}" data-pinyin="${py}" data-weight="${weight}" aria-label="${w} ${py}">${ruby}</button>`
        );
        pos += w.length;
        wi += 1;
        continue;
      }
      const py = charPinyinList(ch)[0] || '—';
      tokens.push(
        `<button type="button" class="word" data-wi="${wi}" data-word="${ch}" data-pinyin="${py}" data-weight="1" aria-label="${ch} ${py}"><ruby>${ch}<rt>${py}</rt></ruby></button>`
      );
      pos += 1;
      wi += 1;
    }
    return tokens.join('');
  }

  function renderSentList() {
    $('#sent-list').innerHTML = L().sentences.map((s, i) =>
      `<button type="button" data-index="${i}" class="${i === activeSent ? 'is-active' : ''}">
        <b>${String(s.id).padStart(2, '0')}</b>${s.zh}
      </button>`
    ).join('');
  }

  function renderSentenceStage() {
    const s = L().sentences[activeSent];
    const stage = $('#sent-stage');
    stage.classList.toggle('py-off', !show.sents.py);
    stage.classList.toggle('ja-off', !show.sents.ja);
    $('#sent-no').textContent = String(s.id).padStart(2, '0');
    const sentPy = $('#sent-py');
    if (sentPy) {
      sentPy.hidden = true;
      sentPy.textContent = '';
    }
    $('#sent-zh').innerHTML = buildSentenceHtml(s);
    $('#sent-zh').classList.toggle('pinyin-hidden', !show.sents.py);
    $('#sent-ja').textContent = s.ja;
    if (!karaokeOn) {
      $('#now-word').textContent = '再生すると、いまの単語がここに出ます。';
      clearKaraokeClasses();
    }
    renderSentList();
  }

  function startKaraoke() {
    karaokeOn = true;
    lastWordIdx = -1;
    clearKaraokeClasses();
    $('#now-word').textContent = '再生中… オレンジの単語を追いましょう。';
  }

  function wordIndexFromProgress(progress, nodes) {
    const weights = nodes.map((n) => Number(n.dataset.weight) || 1);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const target = Math.min(1, Math.max(0, progress)) * total;
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (target < acc) return i;
    }
    return weights.length - 1;
  }

  function updateKaraoke() {
    if (!karaokeOn || mode !== 'sentence') return;
    const nodes = $$('#sent-zh .word[data-wi]');
    if (!nodes.length) return;
    const duration = player.duration;
    if (!duration || !Number.isFinite(duration)) return;

    const lead = Math.min(0.1, duration * 0.05);
    const tail = Math.min(0.18, duration * 0.07);
    const usable = Math.max(0.01, duration - lead - tail);
    const t = Math.min(Math.max(player.currentTime - lead, 0), usable);
    const idx = wordIndexFromProgress(t / usable, nodes);
    if (idx === lastWordIdx) return;
    lastWordIdx = idx;

    nodes.forEach((el, i) => {
      el.classList.toggle('is-spoken', i < idx);
      el.classList.toggle('is-current', i === idx);
    });

    const cur = nodes[idx];
    if (cur) {
      $('#now-word').innerHTML = `<span class="label">いまの単語</span><span class="zh" lang="zh-CN">${cur.dataset.word}</span><span class="py">${cur.dataset.pinyin}</span>`;
    }
  }

  /* —— Quiz —— */
  function currentQuiz() {
    if (!quizOrder.length) return null;
    return L().quizzes[quizOrder[quizCursor]] || null;
  }

  function startQuizSession() {
    const n = L().quizzes.length;
    quizOrder = shuffle([...Array(n).keys()]);
    quizCursor = 0;
    quizSolved = 0;
    quizAwaitRetry = false;
    quizLocked = false;
    updateQuizNav();
    renderQuiz();
    setStatus('確認問題をシャッフルしました。ランダムに出題します。');
  }

  function updateQuizNav() {
    const total = L().quizzes.length;
    const pos = Math.min(quizCursor + 1, total);
    $('#quiz-pos').textContent = `正解 ${quizSolved} / ${total}　（いま ${pos} 問目）`;
    const next = $('#btn-quiz-next');
    const prev = $('#btn-quiz-prev');
    if (prev) {
      prev.textContent = '🔀 最初から';
      prev.disabled = false;
    }
    if (next) {
      next.textContent = quizSolved >= total ? 'もう一周' : '次の問題 →';
      // 正解済みで次へ進める、または一周完了
      next.disabled = !(quizLocked && !quizAwaitRetry) && quizSolved < total;
      if (quizSolved >= total) next.disabled = false;
      if (quizAwaitRetry) next.disabled = true;
    }
  }

  function showExplain(ok, detailHtml) {
    const box = $('#quiz-explain');
    if (!box) return;
    box.classList.add('is-show');
    if (ok) {
      quizAwaitRetry = false;
      const done = quizSolved >= L().quizzes.length;
      box.innerHTML = `
        <strong>正解！</strong> ${detailHtml}
        <div class="quiz-after">
          ${done
            ? '<button type="button" class="btn btn--teal" data-quiz-restart>もう一周（ランダム）</button>'
            : '<button type="button" class="btn btn--teal" data-quiz-advance>次の問題へ →</button>'}
        </div>`;
      setStatus(done ? '全問クリア！もう一周できます。' : '確認問題：正解です。次の問題へ進みましょう。');
    } else {
      quizAwaitRetry = true;
      box.innerHTML = `
        <strong>残念…</strong> ${detailHtml}
        <div class="quiz-after">
          <button type="button" class="btn btn--teal" data-quiz-retry>もう一度この問題に挑戦</button>
        </div>`;
      setStatus('確認問題：正解を確認したら、同じ問題にもう一度挑戦しましょう。');
    }
    updateQuizNav();
  }

  function advanceQuiz() {
    if (quizSolved >= L().quizzes.length || quizCursor + 1 >= quizOrder.length) {
      startQuizSession();
      setStatus('全問終了！新しくシャッフルして最初から出題します。');
      return;
    }
    quizCursor += 1;
    quizAwaitRetry = false;
    quizLocked = false;
    renderQuiz();
  }

  function retryQuiz() {
    quizAwaitRetry = false;
    quizLocked = false;
    renderQuiz();
    setStatus('同じ問題に再挑戦です。');
  }

  function audioBar(q) {
    if (!q.audio) return '';
    const hint = q.type === 'listen' ? '何度でも再生可能' : 'ヒント音声（お手本）';
    return `<div class="quiz-listen-row">
      <button type="button" class="btn btn--teal" data-quiz-listen="${q.audio}">▶ 音声を聴く</button>
      <span class="quiz-listen-hint">${hint}</span>
    </div>`;
  }

  function renderQuiz() {
    if (!quizOrder.length) {
      startQuizSession();
      return;
    }
    const q = currentQuiz();
    if (!q) return;
    quizLocked = false;
    quizAwaitRetry = false;
    quizState = {};
    updateQuizNav();

    const label = q.label || (
      { choice: '四択', truefalse: '○×', listen: '聴き取り', fill: '穴埋め', order: '並べ替え', match: '組み合わせ' }[q.type] || '問題'
    );

    let body = '';
    if (q.type === 'choice' || q.type === 'listen') {
      body = `
        ${audioBar(q)}
        <div class="quiz-choices">
          ${q.choices.map((c, i) =>
            `<button type="button" data-choice="${i}">${String.fromCharCode(65 + i)}. ${c}</button>`
          ).join('')}
        </div>`;
    } else if (q.type === 'truefalse') {
      body = `
        ${audioBar(q)}
        <div class="quiz-choices quiz-choices--tf">
          <button type="button" data-tf="true">○ 正しい</button>
          <button type="button" data-tf="false">× 正しくない</button>
        </div>`;
    } else if (q.type === 'fill') {
      body = `
        ${audioBar(q)}
        <p class="quiz-hint">${q.hint || '空欄に中国語を入力'}</p>
        <div class="quiz-fill-row">
          <input class="quiz-input" id="quiz-fill-input" type="text" inputmode="text" autocomplete="off" placeholder="ここに入力" aria-label="答え">
          <button type="button" class="btn btn--teal" data-quiz-check="fill">答え合わせ</button>
        </div>`;
    } else if (q.type === 'order') {
      const pool = shuffle(q.tokens.map((t, i) => ({ t, i: `${t}-${i}` })));
      quizState = { built: [], pool };
      body = `
        ${audioBar(q)}
        ${q.promptJa ? `<p class="quiz-prompt-ja">意味：${q.promptJa}</p>` : ''}
        <div class="quiz-order-built" id="quiz-order-built" aria-label="並べた語"></div>
        <div class="quiz-order-pool" id="quiz-order-pool">
          ${pool.map((x) =>
            `<button type="button" class="quiz-chip" data-order-token="${x.t}" data-order-key="${x.i}">${x.t}</button>`
          ).join('')}
        </div>
        <div class="quiz-fill-row">
          <button type="button" class="btn btn--soft" data-quiz-reset="order">やり直す</button>
          <button type="button" class="btn btn--teal" data-quiz-check="order">答え合わせ</button>
        </div>`;
    } else if (q.type === 'match') {
      const rights = shuffle(q.pairs.map((p) => p.right));
      quizState = {
        pairs: q.pairs,
        selectedLeft: null,
        links: {}
      };
      body = `
        <div class="quiz-match">
          <div class="quiz-match-col" id="quiz-match-left">
            ${q.pairs.map((p) =>
              `<button type="button" class="quiz-match-item" data-match-left="${p.left}">${p.left}</button>`
            ).join('')}
          </div>
          <div class="quiz-match-col" id="quiz-match-right">
            ${rights.map((r) =>
              `<button type="button" class="quiz-match-item" data-match-right="${r}">${r}</button>`
            ).join('')}
          </div>
        </div>
        <p class="quiz-match-status" id="quiz-match-status">左の語をタップ → 右の語をタップ</p>
        <div class="quiz-fill-row">
          <button type="button" class="btn btn--soft" data-quiz-reset="match">やり直す</button>
          <button type="button" class="btn btn--teal" data-quiz-check="match">答え合わせ</button>
        </div>`;
    } else {
      body = `<p>未対応の問題タイプです。</p>`;
    }

    $('#quiz-card').innerHTML = `
      <div class="quiz-type-badge">${label} · ランダム出題</div>
      <h3>${q.q}</h3>
      ${body}
      <div class="quiz-explain" id="quiz-explain"></div>
    `;

    if (q.type === 'order') renderOrderBuilt();

    // 聴き取りは最初に自動再生
    if (q.type === 'listen' && q.audio) {
      setTimeout(() => playQuizAudio(q.audio), 200);
    }
  }

  function renderOrderBuilt() {
    const box = $('#quiz-order-built');
    if (!box) return;
    if (!quizState.built?.length) {
      box.innerHTML = '<span class="quiz-placeholder">ここに語が並びます</span>';
      return;
    }
    box.innerHTML = quizState.built.map((t, i) =>
      `<button type="button" class="quiz-chip is-built" data-order-remove="${i}">${t}</button>`
    ).join('');
  }

  function markSolvedIfOk(ok) {
    if (ok) {
      quizSolved = Math.min(L().quizzes.length, quizSolved + 1);
      updateQuizNav();
    }
  }

  function finishChoiceLike(selected, correct, correctLabel, explain) {
    if (quizLocked) return;
    quizLocked = true;
    $$('#quiz-card [data-choice], #quiz-card [data-tf]').forEach((btn) => {
      let val;
      if (btn.dataset.choice !== undefined) val = Number(btn.dataset.choice);
      else val = btn.dataset.tf === 'true';
      if (val === correct) btn.classList.add('is-correct');
      if (val === selected && selected !== correct) btn.classList.add('is-wrong');
      btn.disabled = true;
    });
    const ok = selected === correct;
    markSolvedIfOk(ok);
    showExplain(ok, ok ? explain : `正解は <b>${correctLabel}</b>。<br>${explain}`);
  }

  function onQuizChoice(i) {
    const q = currentQuiz();
    finishChoiceLike(i, q.answer, q.choices[q.answer], q.explain);
  }

  function onTrueFalse(val) {
    const q = currentQuiz();
    const correctLabel = q.answer ? '○ 正しい' : '× 正しくない';
    finishChoiceLike(val, q.answer, correctLabel, q.explain);
  }

  function checkFill() {
    if (quizLocked) return;
    const q = currentQuiz();
    const input = $('#quiz-fill-input');
    const raw = input?.value || '';
    const ok = (q.accept || []).some((a) => normalizeAnswer(a) === normalizeAnswer(raw));
    quizLocked = true;
    if (input) {
      input.disabled = true;
      input.classList.add(ok ? 'is-correct' : 'is-wrong');
    }
    markSolvedIfOk(ok);
    showExplain(ok, ok ? q.explain : `正解は <b>${(q.accept || []).join(' / ')}</b>。<br>${q.explain}`);
  }

  function checkOrder() {
    if (quizLocked) return;
    const q = currentQuiz();
    const built = quizState.built || [];
    const ok = built.length === q.answer.length && built.every((t, i) => t === q.answer[i]);
    quizLocked = true;
    $$('#quiz-order-pool .quiz-chip, #quiz-order-built .quiz-chip').forEach((b) => { b.disabled = true; });
    markSolvedIfOk(ok);
    showExplain(ok, ok ? q.explain : `正解は <b>${q.answer.join(' + ')}</b>。<br>${q.explain}`);
  }

  function checkMatch() {
    if (quizLocked) return;
    const q = currentQuiz();
    const links = quizState.links || {};
    let ok = true;
    for (const p of q.pairs) {
      if (links[p.left] !== p.right) { ok = false; break; }
    }
    if (Object.keys(links).length !== q.pairs.length) ok = false;
    quizLocked = true;
    $$('#quiz-card .quiz-match-item').forEach((b) => { b.disabled = true; });
    q.pairs.forEach((p) => {
      const leftBtn = $(`#quiz-card [data-match-left="${p.left}"]`);
      const rightBtn = $(`#quiz-card [data-match-right="${p.right}"]`);
      if (links[p.left] === p.right) {
        leftBtn?.classList.add('is-correct');
        rightBtn?.classList.add('is-correct');
      } else {
        leftBtn?.classList.add('is-wrong');
      }
    });
    const map = q.pairs.map((p) => `${p.left} → ${p.right}`).join('、');
    markSolvedIfOk(ok);
    showExplain(ok, ok ? q.explain : `正解：${map}<br>${q.explain}`);
  }

  function resetOrder() {
    if (quizLocked) return;
    const q = currentQuiz();
    const pool = shuffle(q.tokens.map((t, i) => ({ t, i: `${t}-${i}` })));
    quizState = { built: [], pool };
    const poolEl = $('#quiz-order-pool');
    if (poolEl) {
      poolEl.innerHTML = pool.map((x) =>
        `<button type="button" class="quiz-chip" data-order-token="${x.t}" data-order-key="${x.i}">${x.t}</button>`
      ).join('');
    }
    renderOrderBuilt();
  }

  function resetMatch() {
    if (quizLocked) return;
    renderQuiz();
  }

  function playQuizAudio(src) {
    if (!src) return;
    try {
      player.pause();
      player.src = src;
      player.playbackRate = 1;
      player.play()?.catch?.(() => setStatus('音声を再生できませんでした。'));
      setStatus('確認問題の音声を再生中…');
    } catch (_) {
      setStatus('音声を再生できませんでした。');
    }
  }

  /* —— Events —— */
  function bind() {
    $('#word-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.word-card');
      if (!card) return;
      const id = Number(card.dataset.id);
      const w = L().words.find((x) => x.id === id);
      if (!w) return;
      playQueue([{ kind: 'word', id: w.id, audio: w.audio }], `単語：${w.zh}`, 'word');
    });

    $('#btn-play-all-words').addEventListener('click', () => {
      const items = L().words.map((w) => ({ kind: 'word', id: w.id, audio: w.audio }));
      playQueue(items, '単語を順番に再生中…', 'word');
    });

    $('#sent-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-index]');
      if (!btn) return;
      if (mode === 'sentence') stopAll('文を切り替えました。');
      activeSent = Number(btn.dataset.index);
      renderSentenceStage();
    });

    $('#btn-sent-play').addEventListener('click', () => {
      const s = L().sentences[activeSent];
      playQueue([{ kind: 'sentence', id: s.id, audio: s.audio }], `本文 ${s.id} を再生中`, 'sentence');
    });

    $('#btn-sent-stop').addEventListener('click', () => stopAll());
    $('#btn-stop-global')?.addEventListener('click', () => stopAll());

    $('#btn-play-all-sents').addEventListener('click', () => {
      const items = L().sentences.map((s) => ({ kind: 'sentence', id: s.id, audio: s.audio }));
      playQueue(items, '本文を順番に再生中…', 'sentence');
    });

    $('#sent-zh').addEventListener('click', (e) => {
      const w = e.target.closest('.word');
      if (!w) return;
      $('#now-word').innerHTML = `<span class="label">選択</span><span class="zh" lang="zh-CN">${w.dataset.word}</span><span class="py">${w.dataset.pinyin}</span>`;
      const vocab = L().words.find((x) => x.zh === w.dataset.word);
      if (vocab) {
        playQueue([{ kind: 'word', id: vocab.id, audio: vocab.audio }], `単語：${vocab.zh}`, 'word');
      }
    });

    $$('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        const target = btn.dataset.target;
        show[target][key] = !show[target][key];
        btn.classList.toggle('is-on', show[target][key]);
        btn.textContent = key === 'py'
          ? (show[target].py ? 'ピンインON' : 'ピンインOFF')
          : (show[target].ja ? '日本語ON' : '日本語OFF');
        if (target === 'words') renderWords();
        else renderSentenceStage();
      });
    });

    $('#speed-words').addEventListener('change', () => {
      if (mode === 'word') player.playbackRate = currentSpeed();
    });
    $('#speed-sents').addEventListener('change', () => {
      if (mode === 'sentence') player.playbackRate = currentSpeed();
    });

    $('#quiz-card').addEventListener('click', (e) => {
      if (e.target.closest('[data-quiz-retry]')) {
        retryQuiz();
        return;
      }
      if (e.target.closest('[data-quiz-advance]')) {
        advanceQuiz();
        return;
      }
      if (e.target.closest('[data-quiz-restart]')) {
        startQuizSession();
        return;
      }

      const listen = e.target.closest('[data-quiz-listen]');
      if (listen) {
        playQuizAudio(listen.dataset.quizListen);
        return;
      }

      const choice = e.target.closest('[data-choice]');
      if (choice && !quizLocked) {
        onQuizChoice(Number(choice.dataset.choice));
        return;
      }

      const tf = e.target.closest('[data-tf]');
      if (tf && !quizLocked) {
        onTrueFalse(tf.dataset.tf === 'true');
        return;
      }

      const check = e.target.closest('[data-quiz-check]');
      if (check) {
        const kind = check.dataset.quizCheck;
        if (kind === 'fill') checkFill();
        if (kind === 'order') checkOrder();
        if (kind === 'match') checkMatch();
        return;
      }

      const reset = e.target.closest('[data-quiz-reset]');
      if (reset) {
        if (reset.dataset.quizReset === 'order') resetOrder();
        if (reset.dataset.quizReset === 'match') resetMatch();
        return;
      }

      // 並べ替え：プールから追加
      const token = e.target.closest('[data-order-token]');
      if (token && !quizLocked && !token.disabled) {
        quizState.built.push(token.dataset.orderToken);
        token.remove();
        renderOrderBuilt();
        return;
      }
      // 並べ替え：取り消す
      const remove = e.target.closest('[data-order-remove]');
      if (remove && !quizLocked) {
        const i = Number(remove.dataset.orderRemove);
        const [t] = quizState.built.splice(i, 1);
        const poolEl = $('#quiz-order-pool');
        if (poolEl && t) {
          const key = `${t}-${Date.now()}`;
          poolEl.insertAdjacentHTML(
            'beforeend',
            `<button type="button" class="quiz-chip" data-order-token="${t}" data-order-key="${key}">${t}</button>`
          );
        }
        renderOrderBuilt();
        return;
      }

      // マッチング
      const left = e.target.closest('[data-match-left]');
      if (left && !quizLocked && !left.disabled) {
        $$('#quiz-match-left .quiz-match-item').forEach((b) => b.classList.remove('is-selected'));
        left.classList.add('is-selected');
        quizState.selectedLeft = left.dataset.matchLeft;
        const st = $('#quiz-match-status');
        if (st) st.textContent = `「${quizState.selectedLeft}」に対応する右の語をタップ`;
        return;
      }
      const right = e.target.closest('[data-match-right]');
      if (right && !quizLocked && !right.disabled && quizState.selectedLeft) {
        const Lft = quizState.selectedLeft;
        const Rgt = right.dataset.matchRight;
        // 既に別の左がこの右を使っていたら外す
        Object.keys(quizState.links).forEach((k) => {
          if (quizState.links[k] === Rgt) delete quizState.links[k];
        });
        quizState.links[Lft] = Rgt;
        // UI: mark linked
        $$('#quiz-match-left .quiz-match-item').forEach((b) => {
          b.classList.toggle('is-linked', !!quizState.links[b.dataset.matchLeft]);
          b.classList.remove('is-selected');
        });
        $$('#quiz-match-right .quiz-match-item').forEach((b) => {
          const used = Object.values(quizState.links).includes(b.dataset.matchRight);
          b.classList.toggle('is-linked', used);
        });
        quizState.selectedLeft = null;
        const st = $('#quiz-match-status');
        const n = Object.keys(quizState.links).length;
        const totalPairs = currentQuiz()?.pairs?.length || 0;
        if (st) st.textContent = `組み合わせ ${n} / ${totalPairs}　（答え合わせを押す）`;
      }
    });

    $('#quiz-card').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'quiz-fill-input') {
        e.preventDefault();
        checkFill();
      }
    });

    $('#btn-quiz-prev').addEventListener('click', () => {
      startQuizSession();
    });
    $('#btn-quiz-next').addEventListener('click', () => {
      if (quizSolved >= L().quizzes.length) {
        startQuizSession();
        return;
      }
      if (quizLocked && !quizAwaitRetry) {
        advanceQuiz();
      }
    });

    player.addEventListener('ended', playNext);
    player.addEventListener('timeupdate', updateKaraoke);
    player.addEventListener('seeked', updateKaraoke);
    player.addEventListener('error', () => {
      setStatus('音声を読み込めませんでした。通信やファイル配置を確認してください。');
    });
  }

  function setupMobileDock() {
    const links = $$('.mobile-dock [data-dock]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const map = {};
    links.forEach((a) => { map[a.dataset.dock] = a; });
    const sections = ['words', 'sentences', 'quiz']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const id = en.target.id;
        links.forEach((a) => a.classList.toggle('is-active', a.dataset.dock === id));
      });
    }, { rootMargin: '-35% 0px -50% 0px', threshold: 0.01 });
    sections.forEach((s) => io.observe(s));
  }

  function boot() {
    if (!window.LESSON) {
      setTimeout(boot, 30);
      return;
    }
    renderWords();
    renderSentenceStage();
    startQuizSession();
    bind();
    setupMobileDock();
    setStatus('準備OK。単語カードをタップして始めましょう。');
  }

  boot();
})();
