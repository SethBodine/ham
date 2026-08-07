(function () {
  'use strict';

  var app = document.getElementById('app');
  var STORAGE_KEY = 'nzart-study-progress-v1';
  var REVEAL_DELAY_STORAGE_KEY = 'nzart-learn-reveal-delay-ms';
  var AUTO_ADVANCE_MS = 30000; // fixed 30s idle countdown after the answer is revealed in Learn mode

  function loadRevealDelay() {
    var v = null;
    try { v = parseInt(localStorage.getItem(REVEAL_DELAY_STORAGE_KEY), 10); } catch (e) {}
    return [20000, 30000, 45000, 60000].indexOf(v) !== -1 ? v : 30000;
  }
  function saveRevealDelay(ms) {
    try { localStorage.setItem(REVEAL_DELAY_STORAGE_KEY, String(ms)); } catch (e) {}
  }

  // Real exam draws exactly 1 question per 10 in the bank, per topic (60 total).
  var EXAM_DRAW_RATIO = 10;

  var state = {
    questions: [],
    diagrams: {},
    topics: [],
    screen: 'home',          // 'home' | 'topics' | 'session' | 'summary'
    mode: null,              // 'learn' | 'test' | 'exam'
    selectedTopics: new Set(),
    queue: [],
    index: 0,
    revealed: false,
    answered: false,
    selectedOption: null,
    sessionCorrect: 0,
    sessionSeen: 0,
    sessionResults: {},
    examAnswers: {},         // qid -> chosen letter, for exam review at the end
    revealTimer: null,
    revealDelayMs: loadRevealDelay(),
    autoAdvanceTimer: null,
    autoAdvanceInterval: null,
    autoAdvanceRemainingMs: 0,
  };

  function loadProgress() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; } }
  function saveProgress(p) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) {} }
  function recordAnswer(qid, correct) {
    var p = loadProgress();
    var rec = p[qid] || { seen: 0, correct: 0 };
    rec.seen += 1;
    if (correct) rec.correct += 1;
    p[qid] = rec;
    saveProgress(p);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'disabled') e.disabled = !!attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  Promise.all([
    fetch('data/questions.json').then(function (r) {
      if (!r.ok) throw new Error('Could not load question data (' + r.status + ')');
      return r.json();
    }),
    fetch('data/diagrams.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
  ])
    .then(function (results) {
      var data = results[0];
      state.diagrams = results[1] || {};
      state.questions = data;
      var byTopic = {};
      data.forEach(function (q) {
        if (!byTopic[q.topic]) byTopic[q.topic] = { num: q.topic, name: q.topicName, count: 0 };
        byTopic[q.topic].count++;
      });
      state.topics = Object.values(byTopic).sort(function (a, b) { return a.num - b.num; });
      state.selectedTopics = new Set(state.topics.map(function (t) { return t.num; }));
      renderHome();
    })
    .catch(function (err) {
      app.innerHTML = '';
      app.appendChild(el('p', { class: 'loading' }, ['Sorry — ' + err.message + '.']));
    });

  // ================= HOME =================
  function renderHome() {
    clearTimeout(state.revealTimer);
    clearAutoAdvance();
    state.screen = 'home';
    app.innerHTML = '';

    var intro = el('p', { class: 'home-intro' }, [
      'Pick one thing to do. You can switch any time — nothing here is locked in.'
    ]);
    app.appendChild(intro);

    var grid = el('div', { class: 'home-grid' });

    grid.appendChild(el('button', {
      class: 'home-card', type: 'button',
      onclick: function () { state.mode = 'learn'; renderTopics(); }
    }, [
      el('span', { class: 'home-card-kicker' }, ['Speed learn']),
      el('h2', {}, ['Learn']),
      el('p', {}, ['Flip through questions. The answer reveals itself — you just read and move on.']),
    ]));

    grid.appendChild(el('button', {
      class: 'home-card', type: 'button',
      onclick: function () { state.mode = 'test'; renderTopics(); }
    }, [
      el('span', { class: 'home-card-kicker' }, ['Check yourself']),
      el('h2', {}, ['Test']),
      el('p', {}, ['Answer each question yourself. Find out right away if you got it, and why.']),
    ]));

    grid.appendChild(el('button', {
      class: 'home-card featured', type: 'button',
      onclick: startMockExam
    }, [
      el('span', { class: 'home-card-kicker' }, ['The real format']),
      el('h2', {}, ['Mock Exam']),
      el('p', {}, ['60 questions, drawn the same way the real exam is built. Pass mark: 40/60. No hints until the end.']),
    ]));

    app.appendChild(grid);
  }

  // ================= TOPIC PICKER (Learn / Test only) =================
  function renderTopics() {
    state.screen = 'topics';
    app.innerHTML = '';

    var panel = el('div', { class: 'setup' });
    var title = state.mode === 'learn' ? 'Learn — pick your topics' : 'Test — pick your topics';
    panel.appendChild(el('h2', {}, [title]));

    if (state.mode === 'learn') {
      var delayWrap = el('div', { class: 'field', style: 'max-width:260px;margin-bottom:18px' });
      delayWrap.appendChild(el('label', { for: 'reveal-delay' }, ['Answer reveal delay']));
      var delaySelect = el('select', { id: 'reveal-delay' });
      [20000, 30000, 45000, 60000].forEach(function (ms) {
        var opt = el('option', { value: String(ms) }, [(ms / 1000) + ' seconds']);
        if (ms === state.revealDelayMs) opt.setAttribute('selected', 'selected');
        delaySelect.appendChild(opt);
      });
      delaySelect.addEventListener('change', function () {
        state.revealDelayMs = parseInt(delaySelect.value, 10);
        saveRevealDelay(state.revealDelayMs);
      });
      delayWrap.appendChild(delaySelect);
      panel.appendChild(delayWrap);
    }

    var actions = el('div', { class: 'topic-actions' }, [
      el('button', { type: 'button', onclick: function () {
        state.selectedTopics = new Set(state.topics.map(function (t) { return t.num; }));
        renderTopics();
      } }, ['Select all']),
      el('button', { type: 'button', onclick: function () {
        state.selectedTopics = new Set();
        renderTopics();
      } }, ['Clear all'])
    ]);
    panel.appendChild(actions);

    var topicsWrap = el('div', { class: 'topics' });
    state.topics.forEach(function (t) {
      var id = 'topic-' + t.num;
      var checked = state.selectedTopics.has(t.num);
      var row = el('div', { class: 'topic-row' });
      var cb = el('input', { type: 'checkbox', id: id });
      cb.checked = checked;
      cb.addEventListener('change', function () {
        if (cb.checked) state.selectedTopics.add(t.num);
        else state.selectedTopics.delete(t.num);
        startBtn.disabled = state.selectedTopics.size === 0;
        startBtn.textContent = startLabel();
      });
      row.appendChild(cb);
      row.appendChild(el('label', { for: id }, [t.num + '. ' + t.name]));
      row.appendChild(el('span', { class: 'count' }, ['(' + t.count + ')']));
      topicsWrap.appendChild(row);
    });
    panel.appendChild(topicsWrap);

    function startLabel() {
      var count = state.questions.filter(function (q) { return state.selectedTopics.has(q.topic); }).length;
      return 'Start (' + count + ' question' + (count === 1 ? '' : 's') + ')';
    }

    var startBtn = el('button', { class: 'btn', type: 'button', onclick: startSession }, [startLabel()]);
    startBtn.disabled = state.selectedTopics.size === 0;
    panel.appendChild(startBtn);
    panel.appendChild(el('button', { class: 'btn secondary', type: 'button', onclick: renderHome, style: 'margin-left:10px' }, ['← Back']));

    app.appendChild(panel);
  }

  function startSession() {
    var pool = state.questions.filter(function (q) { return state.selectedTopics.has(q.topic); });
    beginQueue(shuffle(pool));
  }

  // ================= MOCK EXAM =================
  function startMockExam() {
    state.mode = 'exam';
    var byTopic = {};
    state.questions.forEach(function (q) {
      (byTopic[q.topic] = byTopic[q.topic] || []).push(q);
    });
    var drawn = [];
    Object.keys(byTopic).forEach(function (topicNum) {
      var pool = byTopic[topicNum];
      var n = Math.round(pool.length / EXAM_DRAW_RATIO);
      drawn = drawn.concat(shuffle(pool).slice(0, n));
    });
    beginQueue(shuffle(drawn));
  }

  function beginQueue(queue) {
    state.queue = queue;
    state.index = 0;
    state.revealed = false;
    state.answered = false;
    state.selectedOption = null;
    state.sessionCorrect = 0;
    state.sessionSeen = 0;
    state.sessionResults = {};
    state.examAnswers = {};
    renderQuestion();
  }

  // ================= QUESTION SCREEN =================
  function renderQuestion() {
    clearTimeout(state.revealTimer);
    clearAutoAdvance();
    state.screen = 'session';

    if (state.index >= state.queue.length) {
      renderSummary();
      return;
    }
    var q = state.queue[state.index];
    app.innerHTML = '';

    var modeLabel = state.mode === 'learn' ? 'Learn' : state.mode === 'test' ? 'Test' : 'Mock Exam';
    var scoreText = state.mode === 'test' ? (' · Score ' + state.sessionCorrect + '/' + state.sessionSeen) : '';
    var head = el('div', { class: 'session-head' }, [
      el('span', { class: 'progress-text' }, [modeLabel + ' · Question ' + (state.index + 1) + ' of ' + state.queue.length + scoreText]),
      el('button', { class: 'btn secondary', type: 'button', onclick: function () { if (confirm('End this session and go back?')) renderHome(); } }, ['End session'])
    ]);
    app.appendChild(head);

    var pct = Math.round((state.index / state.queue.length) * 100);
    app.appendChild(el('div', { class: 'progress-bar' }, [
      el('div', { class: 'progress-fill', style: 'width:' + pct + '%' })
    ]));

    var card = el('div', { class: 'qcard' });
    card.appendChild(el('div', { class: 'qtopic' }, [q.topic + '. ' + q.topicName]));
    if (q.diagram && state.diagrams[q.diagram]) {
      var diagramWrap = el('div', { class: 'diagram-wrap' });
      diagramWrap.innerHTML = state.diagrams[q.diagram];
      card.appendChild(diagramWrap);
    }
    card.appendChild(el('p', { class: 'qtext' }, [q.question]));

    var optionsWrap = el('div', { class: 'options' });
    var letters = ['a', 'b', 'c', 'd'];
    var showAnswer = (state.mode === 'learn' && state.revealed) || (state.mode === 'test' && state.answered);

    letters.forEach(function (letter) {
      var isCorrect = letter === q.answer;
      var classes = 'opt';
      if (showAnswer && isCorrect) classes += ' correct';
      if (state.mode === 'test' && state.answered && letter === state.selectedOption && !isCorrect) classes += ' incorrect';
      if (state.mode === 'exam' && state.selectedOption === letter) classes += ' picked';

      var disabled = (state.mode === 'test' && state.answered) || (state.mode === 'learn' && state.revealed);
      var btn = el('button', {
        class: classes, type: 'button', disabled: disabled
      }, [
        el('span', { class: 'letter' }, [letter.toUpperCase()]),
        el('span', {}, [q.options[letter]])
      ]);
      if (state.mode === 'test' && !state.answered) {
        btn.addEventListener('click', function () { answerTest(letter); });
      }
      if (state.mode === 'learn' && !state.revealed) {
        btn.addEventListener('click', revealLearnNow);
      }
      if (state.mode === 'exam') {
        btn.addEventListener('click', function () { answerExam(letter); });
      }
      optionsWrap.appendChild(btn);
    });
    card.appendChild(optionsWrap);

    if (state.mode === 'test' && state.answered) {
      var correctOpt = q.options[q.answer];
      var wasRight = state.selectedOption === q.answer;
      card.appendChild(el('div', { class: 'explain' }, [
        el('span', { class: 'label' }, [wasRight ? 'Correct!' : 'Not quite.']),
        el('span', {}, ['The correct answer is ' + q.answer.toUpperCase() + ': ' + correctOpt + '.']),
        q.explanation ? el('p', { class: 'why' }, [q.explanation]) : null
      ]));
    }
    if (state.mode === 'learn') {
      if (state.revealed) {
        card.appendChild(el('div', { class: 'explain' }, [
          el('span', { class: 'label' }, ['Why']),
          q.explanation ? el('p', { class: 'why' }, [q.explanation]) : el('p', { class: 'why' }, ['Answer highlighted above.'])
        ]));
        var autoBar = el('div', { class: 'auto-advance' }, [
          el('div', { class: 'auto-advance-fill', id: 'auto-advance-fill' }),
        ]);
        card.appendChild(autoBar);
        card.appendChild(el('p', { class: 'auto-advance-note', id: 'auto-advance-note' }, ['Moving on automatically in 30s…']));
        startAutoAdvance();
      } else {
        var pendingNote = el('div', { class: 'learn-note pending' }, ['Revealing the answer in ' + Math.round(state.revealDelayMs / 1000) + 's… (click here to reveal now)']);
        pendingNote.addEventListener('click', revealLearnNow);
        card.appendChild(pendingNote);
        state.revealTimer = setTimeout(revealLearnNow, state.revealDelayMs);
      }
    }
    if (state.mode === 'exam') {
      card.appendChild(el('div', { class: 'learn-note' }, [state.selectedOption ? 'Answer recorded.' : 'Pick an answer, or skip to move on.']));
    }

    var actions = el('div', { class: 'card-actions' });
    var showNext =
      (state.mode === 'test' && state.answered) ||
      (state.mode === 'learn' && state.revealed) ||
      (state.mode === 'exam');
    if (showNext) {
      actions.appendChild(el('button', {
        class: 'btn', type: 'button',
        onclick: advance
      }, [state.index + 1 >= state.queue.length ? 'Finish' : 'Next question →']));
    }
    card.appendChild(actions);

    app.appendChild(card);
  }

  function clearAutoAdvance() {
    clearTimeout(state.autoAdvanceTimer);
    clearInterval(state.autoAdvanceInterval);
    state.autoAdvanceTimer = null;
    state.autoAdvanceInterval = null;
  }

  function startAutoAdvance() {
    clearAutoAdvance();
    state.autoAdvanceRemainingMs = AUTO_ADVANCE_MS;
    var tickMs = 250;
    state.autoAdvanceInterval = setInterval(function () {
      state.autoAdvanceRemainingMs -= tickMs;
      var fill = document.getElementById('auto-advance-fill');
      var note = document.getElementById('auto-advance-note');
      var pct = Math.max(0, (state.autoAdvanceRemainingMs / AUTO_ADVANCE_MS) * 100);
      if (fill) fill.style.width = pct + '%';
      if (note) note.textContent = 'Moving on automatically in ' + Math.max(0, Math.ceil(state.autoAdvanceRemainingMs / 1000)) + 's… (click a button to stay)';
      if (state.autoAdvanceRemainingMs <= 0) {
        clearAutoAdvance();
        advance();
      }
    }, tickMs);
  }

  function revealLearnNow() {
    clearTimeout(state.revealTimer);
    if (state.revealed) return;
    state.revealed = true;
    renderQuestion();
  }

  function advance() {
    clearAutoAdvance();
    state.index++;
    state.revealed = false;
    state.answered = false;
    state.selectedOption = null;
    renderQuestion();
  }

  function answerTest(letter) {
    var q = state.queue[state.index];
    state.answered = true;
    state.selectedOption = letter;
    var correct = letter === q.answer;
    state.sessionSeen++;
    if (correct) state.sessionCorrect++;
    if (!state.sessionResults[q.topic]) state.sessionResults[q.topic] = { correct: 0, total: 0 };
    state.sessionResults[q.topic].total++;
    if (correct) state.sessionResults[q.topic].correct++;
    recordAnswer(q.id, correct);
    renderQuestion();
  }

  function answerExam(letter) {
    var q = state.queue[state.index];
    state.selectedOption = letter;
    state.examAnswers[q.id] = letter;
    renderQuestion();
  }

  // ================= SUMMARY =================
  function renderSummary() {
    state.screen = 'summary';
    app.innerHTML = '';
    var panel = el('div', { class: 'summary' });

    if (state.mode === 'test') {
      panel.appendChild(el('h2', {}, ['Session complete']));
      var pct = state.sessionSeen ? Math.round((state.sessionCorrect / state.sessionSeen) * 100) : 0;
      panel.appendChild(el('div', { class: 'score' }, [state.sessionCorrect + ' / ' + state.sessionSeen + ' (' + pct + '%)']));
      panel.appendChild(topicBreakdown());
    } else if (state.mode === 'learn') {
      panel.appendChild(el('h2', {}, ['Session complete']));
      panel.appendChild(el('p', {}, ['You worked through ' + state.queue.length + ' questions in Learn mode.']));
    } else {
      // exam
      var correct = 0;
      state.queue.forEach(function (q) {
        var given = state.examAnswers[q.id];
        var isCorrect = given === q.answer;
        if (isCorrect) correct++;
        if (!state.sessionResults[q.topic]) state.sessionResults[q.topic] = { correct: 0, total: 0 };
        state.sessionResults[q.topic].total++;
        if (isCorrect) state.sessionResults[q.topic].correct++;
        recordAnswer(q.id, isCorrect);
      });
      var passed = correct >= 40;
      panel.appendChild(el('h2', {}, [passed ? 'Pass! 🎉' : 'Not quite — keep at it']));
      panel.appendChild(el('div', { class: 'score' }, [correct + ' / ' + state.queue.length]));
      panel.appendChild(el('p', { class: 'muted' }, ['Pass mark is 40/60. ' + (passed ? 'That would be a pass in the real exam.' : (40 - correct) + ' more correct would have passed.')]));
      panel.appendChild(topicBreakdown());

      var missed = state.queue.filter(function (q) { return state.examAnswers[q.id] !== q.answer; });
      if (missed.length) {
        var review = el('div', { class: 'topic-breakdown' });
        review.appendChild(el('h3', { style: 'margin-top:0' }, ['Review what you missed (' + missed.length + ')']));
        missed.forEach(function (q) {
          var given = state.examAnswers[q.id];
          var row = el('div', { class: 'review-row' });
          row.appendChild(el('p', { class: 'review-q' }, [q.topic + '. ' + q.question]));
          if (q.diagram && state.diagrams[q.diagram]) {
            var dw = el('div', { class: 'diagram-wrap review-diagram' });
            dw.innerHTML = state.diagrams[q.diagram];
            row.appendChild(dw);
          }
          row.appendChild(el('p', { class: 'review-a' }, [
            'Correct: ' + q.answer.toUpperCase() + ' — ' + q.options[q.answer] +
            (given ? ('. You chose: ' + given.toUpperCase() + ' — ' + q.options[given]) : '. You skipped this one.')
          ]));
          if (q.explanation) row.appendChild(el('p', { class: 'review-why' }, [q.explanation]));
          review.appendChild(row);
        });
        panel.appendChild(review);
      }
    }

    var actions = el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn', type: 'button', onclick: function () {
        if (state.mode === 'exam') startMockExam(); else startSession();
      } }, ['Go again']),
      el('button', { class: 'btn secondary', type: 'button', onclick: renderHome }, ['← Back home'])
    ]);
    panel.appendChild(actions);

    app.appendChild(panel);
  }

  function topicBreakdown() {
    var breakdown = el('div', { class: 'topic-breakdown' });
    Object.keys(state.sessionResults).map(Number).sort(function (a, b) { return a - b; }).forEach(function (topicNum) {
      var r = state.sessionResults[topicNum];
      var t = state.topics.find(function (t) { return t.num === topicNum; });
      breakdown.appendChild(el('div', { class: 'row' }, [
        el('span', {}, [topicNum + '. ' + (t ? t.name : '')]),
        el('span', {}, [r.correct + '/' + r.total])
      ]));
    });
    return breakdown;
  }
})();
