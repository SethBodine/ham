(function () {
  'use strict';
  // Cheat Sheets: one scrolling page per section. Primer first, then each question
  // reduced to its correct answer + a short "why". No timer, no scoring.
  var KNOWN_KEY = 'nzart-cheat-known-v1';
  var PREF_KEY = 'nzart-cheat-prefs-v1';
  var notes = null;
  var view = { topic: null, hide: false, onlyUnknown: false };

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function getNotes() {
    if (notes) return Promise.resolve(notes);
    return fetch('data/notes.json').then(function (r) { return r.ok ? r.json() : { topics: {}, hooks: {} }; })
      .catch(function () { return { topics: {}, hooks: {} }; })
      .then(function (n) { notes = n; return n; });
  }

  function open(ctx) {
    var prefs = load(PREF_KEY, {});
    view.hide = !!prefs.hide;
    view.onlyUnknown = !!prefs.onlyUnknown;
    if (view.topic == null) view.topic = ctx.state.topics[0].num;
    getNotes().then(function () { render(ctx); });
  }

  function render(ctx) {
    var el = ctx.el, app = ctx.app, state = ctx.state;
    state.screen = 'cheat';
    app.innerHTML = '';
    var known = load(KNOWN_KEY, {});
    var topic = state.topics.find(function (t) { return t.num === view.topic; });
    var tn = (notes.topics || {})[String(view.topic)] || {};
    var qs = state.questions.filter(function (q) { return q.topic === view.topic; });

    // toolbar
    var bar = el('div', { class: 'cs-bar' });
    bar.appendChild(el('button', { class: 'btn secondary', type: 'button', onclick: ctx.home }, ['← Home']));
    var sel = el('select', { 'aria-label': 'Section' });
    state.topics.forEach(function (t) {
      var o = el('option', { value: String(t.num) }, [t.num + '. ' + t.name]);
      if (t.num === view.topic) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { view.topic = parseInt(sel.value, 10); render(ctx); window.scrollTo(0, 0); });
    bar.appendChild(sel);
    app.appendChild(bar);

    var opts = el('div', { class: 'cs-opts' });
    function toggle(label, key) {
      var id = 'cs-' + key;
      var cb = el('input', { type: 'checkbox', id: id });
      cb.checked = view[key];
      cb.addEventListener('change', function () {
        view[key] = cb.checked;
        save(PREF_KEY, { hide: view.hide, onlyUnknown: view.onlyUnknown });
        var y = window.scrollY;
        render(ctx);
        window.scrollTo(0, y);
      });
      return el('label', { for: id }, [cb, ' ' + label]);
    }
    opts.appendChild(toggle('Hide answers (self-test)', 'hide'));
    opts.appendChild(toggle('Only show ones I haven\u2019t marked known', 'onlyUnknown'));
    app.appendChild(opts);

    var done = qs.filter(function (q) { return known[q.id]; }).length;
    app.appendChild(el('h2', { class: 'cs-title' }, [view.topic + '. ' + (tn.title || topic.name)]));
    app.appendChild(el('p', { class: 'cs-progress' }, [done + ' of ' + qs.length + ' marked known']));

    // primer
    if (tn.primer) {
      var card = el('section', { class: 'cs-primer' });
      card.appendChild(el('h3', {}, ['Know this first']));
      var ul = el('ul');
      tn.primer.forEach(function (t) { ul.appendChild(el('li', {}, [t])); });
      card.appendChild(ul);
      (tn.mnemonics || []).forEach(function (m) { card.appendChild(el('p', { class: 'cs-mnem' }, ['Memory aid: ' + m])); });
      app.appendChild(card);
    }

    // questions
    var list = el('ol', { class: 'cs-list' });
    qs.forEach(function (q) {
      if (view.onlyUnknown && known[q.id]) return;
      var li = el('li', { class: 'cs-q' + (known[q.id] ? ' known' : '') });
      li.appendChild(el('p', { class: 'cs-stem' }, [q.question]));
      if (q.diagram && state.diagrams[q.diagram]) {
        var dw = el('div', { class: 'diagram-wrap review-diagram' });
        dw.innerHTML = state.diagrams[q.diagram];
        li.appendChild(dw);
      }
      var ans = el('p', { class: 'cs-ans' }, ['\u2713 ' + q.options[q.answer]]);
      if (view.hide) {
        ans.hidden = true;
        var show = el('button', { class: 'cs-show', type: 'button', onclick: function () { ans.hidden = false; extra.hidden = false; show.hidden = true; } }, ['Show answer']);
        li.appendChild(show);
      }
      li.appendChild(ans);
      var extra = el('div', { class: 'cs-extra' });
      var hook = (notes.hooks || {})[q.id];
      var key = (notes.keys || {})[q.id];
      if (key) extra.appendChild(el('p', { class: 'cs-key' }, [key]));
      if (hook && hook !== key) extra.appendChild(el('p', { class: 'cs-hook' }, ['Hook: ' + hook]));
      if (q.explanation) {
        if (key) {
          var det = el('details', { class: 'cs-more' }, [el('summary', {}, ['Why']), el('p', { class: 'cs-why' }, [q.explanation])]);
          extra.appendChild(det);
        } else {
          extra.appendChild(el('p', { class: 'cs-why' }, [q.explanation]));
        }
      }
      if (view.hide) extra.hidden = true;
      li.appendChild(extra);
      var cb = el('input', { type: 'checkbox', id: 'k-' + q.id });
      cb.checked = !!known[q.id];
      cb.addEventListener('change', function () {
        var k = load(KNOWN_KEY, {});
        if (cb.checked) k[q.id] = 1; else delete k[q.id];
        save(KNOWN_KEY, k);
        li.classList.toggle('known', cb.checked);
        var n = qs.filter(function (x) { return k[x.id]; }).length;
        var p = app.querySelector('.cs-progress');
        if (p) p.textContent = n + ' of ' + qs.length + ' marked known';
      });
      li.appendChild(el('label', { class: 'cs-known', for: 'k-' + q.id }, [cb, ' I know this']));
      list.appendChild(li);
    });
    app.appendChild(list);

    // prev / next
    var idx = state.topics.findIndex(function (t) { return t.num === view.topic; });
    var nav = el('div', { class: 'cs-nav' });
    if (idx > 0) nav.appendChild(el('button', { class: 'btn secondary', type: 'button', onclick: function () { view.topic = state.topics[idx - 1].num; render(ctx); window.scrollTo(0, 0); } }, ['\u2190 Previous section']));
    if (idx < state.topics.length - 1) nav.appendChild(el('button', { class: 'btn', type: 'button', onclick: function () { view.topic = state.topics[idx + 1].num; render(ctx); window.scrollTo(0, 0); } }, ['Next section \u2192']));
    app.appendChild(nav);
  }

  window.NZCheat = { open: open };
})();
