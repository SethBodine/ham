(function () {
  'use strict';

  var app = document.getElementById('app');
  var KEY_STORAGE = 'calllog-access-key';

  var STANDARD_FIELDS = [
    { key: 'callsign', label: 'Callsign worked', type: 'text' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'time', label: 'Time (UTC)', type: 'text', placeholder: 'e.g. 0930z' },
    { key: 'frequency', label: 'Frequency', type: 'text', placeholder: 'e.g. 14.245' },
    { key: 'mode', label: 'Mode', type: 'text', placeholder: 'e.g. SSB, FM, FT8' },
    { key: 'sigRcvd', label: 'Signal rcvd', type: 'text', placeholder: 'e.g. 59' },
    { key: 'sigSent', label: 'Signal sent', type: 'text', placeholder: 'e.g. 59' },
    { key: 'notes', label: 'Notes', type: 'text' },
  ];
  var COLUMN_ORDER = STANDARD_FIELDS.map(function (f) { return f.key; });

  var state = {
    key: null,
    entries: [],
    settings: { stationCallsign: '' },
    editingId: null,
    extraFields: [], // [{key, value}] for the add/edit form
    error: null,
  };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Authorization': 'Bearer ' + state.key }, opts.headers || {});
    if (opts.body) headers['content-type'] = 'application/json';
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (r.status === 401) {
        clearKey();
        renderLogin('Your access key was rejected. Please re-enter it.');
        throw new Error('unauthorized');
      }
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function clearKey() {
    state.key = null;
    try { localStorage.removeItem(KEY_STORAGE); } catch (e) {}
  }

  // ---------- Login ----------
  function renderLogin(errorMsg) {
    app.innerHTML = '';
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', {}, ['Enter your access key']));
    panel.appendChild(el('p', { class: 'muted' }, ['This key was generated with openssl and shared with you separately. It unlocks this private log for your browser only.']));
    if (errorMsg) panel.appendChild(el('div', { class: 'error' }, [errorMsg]));

    var input = el('input', { type: 'password', id: 'key-input', autocomplete: 'off', placeholder: 'Access key' });
    var field = el('div', { class: 'field' }, [
      el('label', { for: 'key-input' }, ['Access key']),
      input,
    ]);
    panel.appendChild(field);

    var btn = el('button', { class: 'btn', type: 'button', onclick: function () { attemptLogin(input.value.trim()); } }, ['Unlock']);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptLogin(input.value.trim()); });
    panel.appendChild(btn);

    app.appendChild(panel);
    input.focus();
  }

  function attemptLogin(key) {
    if (!key) return;
    state.key = key;
    api('/verify')
      .then(function () {
        try { localStorage.setItem(KEY_STORAGE, key); } catch (e) {}
        loadAndRender();
      })
      .catch(function () {
        if (state.key) renderLogin('Could not verify that key. Please check it and try again.');
      });
  }

  // ---------- Data loading ----------
  function loadAndRender() {
    app.innerHTML = '';
    app.appendChild(el('p', { class: 'loading' }, ['Loading your log…']));
    Promise.all([api('/entries'), api('/settings')])
      .then(function (results) {
        state.entries = results[0].entries || [];
        state.settings = results[1].settings || { stationCallsign: '' };
        renderApp();
      })
      .catch(function (err) {
        if (err.message !== 'unauthorized') {
          app.innerHTML = '';
          app.appendChild(el('div', { class: 'error' }, ['Could not load your log: ' + err.message]));
        }
      });
  }

  // ---------- Main app ----------
  function renderApp() {
    app.innerHTML = '';

    var top = el('div', { class: 'toprow' });
    var stationInput = el('input', { type: 'text', id: 'station-callsign', placeholder: 'Your station callsign' });
    stationInput.value = state.settings.stationCallsign || '';
    stationInput.style.maxWidth = '200px';
    stationInput.addEventListener('change', function () {
      api('/settings', { method: 'PUT', body: { stationCallsign: stationInput.value.trim() } })
        .then(function (r) { state.settings = r.settings; });
    });
    top.appendChild(el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { for: 'station-callsign' }, ['Station callsign']),
      stationInput,
    ]));
    top.appendChild(el('button', {
      class: 'btn secondary small', type: 'button',
      onclick: function () { clearKey(); renderLogin(); }
    }, ['Log out']));
    app.appendChild(top);

    app.appendChild(renderForm());
    app.appendChild(renderTable());
  }

  // ---------- Add/edit form ----------
  function renderForm() {
    var editing = state.editingId ? state.entries.find(function (e) { return e.id === state.editingId; }) : null;

    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', {}, [editing ? 'Edit contact' : 'Add contact']));

    var inputs = {};
    var grid = el('div', { class: 'grid cols-4' });
    STANDARD_FIELDS.forEach(function (f) {
      var input = el('input', { type: f.type === 'date' ? 'date' : 'text', id: 'f-' + f.key });
      if (f.placeholder) input.setAttribute('placeholder', f.placeholder);
      input.value = editing ? (editing[f.key] || '') : '';
      inputs[f.key] = input;
      grid.appendChild(el('div', { class: 'field' }, [
        el('label', { for: 'f-' + f.key }, [f.label]),
        input,
      ]));
    });
    panel.appendChild(grid);

    // Extra / custom fields
    if (editing) {
      state.extraFields = Object.keys(editing)
        .filter(function (k) { return COLUMN_ORDER.indexOf(k) === -1 && ['id', 'createdAt', 'updatedAt'].indexOf(k) === -1; })
        .map(function (k) { return { key: k, value: String(editing[k]) }; });
    }

    var extraWrap = el('div', { class: 'extra-fields' });
    function renderExtraRows() {
      extraWrap.innerHTML = '';
      state.extraFields.forEach(function (pair, idx) {
        var kInput = el('input', { type: 'text', placeholder: 'Field name' });
        kInput.value = pair.key;
        var vInput = el('input', { type: 'text', placeholder: 'Value' });
        vInput.value = pair.value;
        kInput.addEventListener('input', function () { pair.key = kInput.value; });
        vInput.addEventListener('input', function () { pair.value = vInput.value; });
        var removeBtn = el('button', {
          class: 'btn secondary small', type: 'button',
          onclick: function () { state.extraFields.splice(idx, 1); renderExtraRows(); }
        }, ['Remove']);
        extraWrap.appendChild(el('div', { class: 'extra-field-row' }, [kInput, vInput, removeBtn]));
      });
    }
    renderExtraRows();
    panel.appendChild(el('label', {}, ['Additional fields']));
    panel.appendChild(extraWrap);
    panel.appendChild(el('button', {
      class: 'btn secondary small', type: 'button', style: 'margin-top:8px',
      onclick: function () { state.extraFields.push({ key: '', value: '' }); renderExtraRows(); }
    }, ['+ Add field']));

    var actions = el('div', { style: 'margin-top:16px;display:flex;gap:10px' });
    actions.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () { submitForm(inputs, editing); }
    }, [editing ? 'Save changes' : 'Add contact']));
    if (editing) {
      actions.appendChild(el('button', {
        class: 'btn secondary', type: 'button',
        onclick: function () { state.editingId = null; state.extraFields = []; renderApp(); }
      }, ['Cancel']));
    }
    panel.appendChild(actions);

    return panel;
  }

  function submitForm(inputs, editing) {
    var payload = {};
    STANDARD_FIELDS.forEach(function (f) {
      var v = inputs[f.key].value.trim();
      if (v) payload[f.key] = v;
    });
    state.extraFields.forEach(function (pair) {
      var k = pair.key.trim();
      if (k) payload[k] = pair.value;
    });

    var req = editing
      ? api('/entries/' + editing.id, { method: 'PUT', body: payload })
      : api('/entries', { method: 'POST', body: payload });

    req.then(function (r) {
      var entry = r.entry;
      if (editing) {
        state.entries = state.entries.map(function (e) { return e.id === entry.id ? entry : e; });
      } else {
        state.entries.push(entry);
      }
      state.editingId = null;
      state.extraFields = [];
      renderApp();
    }).catch(function (err) {
      if (err.message !== 'unauthorized') alert('Could not save: ' + err.message);
    });
  }

  // ---------- Table ----------
  function renderTable() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', {}, ['Contacts (' + state.entries.length + ')']));

    if (state.entries.length === 0) {
      panel.appendChild(el('p', { class: 'muted' }, ['No contacts logged yet.']));
      return panel;
    }

    // Determine columns: standard fields first, then any extra fields seen anywhere, in first-seen order.
    var extraCols = [];
    state.entries.forEach(function (e) {
      Object.keys(e).forEach(function (k) {
        if (COLUMN_ORDER.indexOf(k) === -1 && ['id', 'createdAt', 'updatedAt'].indexOf(k) === -1 && extraCols.indexOf(k) === -1) {
          extraCols.push(k);
        }
      });
    });
    var columns = STANDARD_FIELDS.map(function (f) { return f; }).concat(
      extraCols.map(function (k) { return { key: k, label: k }; })
    );

    var scroll = el('div', { class: 'table-scroll' });
    var table = el('table');
    var thead = el('thead', {}, [
      el('tr', {}, ['#'].concat(columns.map(function (c) { return c.label; })).concat(['']).map(function (t) { return el('th', {}, [t]); }))
    ]);
    table.appendChild(thead);

    var tbody = el('tbody');
    var sorted = state.entries.slice().sort(function (a, b) {
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    sorted.forEach(function (entry, i) {
      var cells = [el('td', {}, [String(i + 1)])];
      columns.forEach(function (c) {
        var v = entry[c.key];
        cells.push(el('td', {}, [v === undefined || v === null || v === '' ? '—' : String(v)]));
      });
      var actions = el('td', { class: 'actions-cell' }, [
        el('button', { class: 'btn secondary small', type: 'button', onclick: function () { state.editingId = entry.id; state.extraFields = []; renderApp(); window.scrollTo(0, 0); } }, ['Edit']),
        el('button', { class: 'btn danger small', type: 'button', onclick: function () { deleteEntry(entry.id); } }, ['Delete']),
      ]);
      cells.push(actions);
      tbody.appendChild(el('tr', {}, cells));
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    return panel;
  }

  function deleteEntry(id) {
    if (!confirm('Delete this contact? This cannot be undone.')) return;
    api('/entries/' + id, { method: 'DELETE' }).then(function () {
      state.entries = state.entries.filter(function (e) { return e.id !== id; });
      renderApp();
    }).catch(function (err) {
      if (err.message !== 'unauthorized') alert('Could not delete: ' + err.message);
    });
  }

  // ---------- Boot ----------
  var savedKey = null;
  try { savedKey = localStorage.getItem(KEY_STORAGE); } catch (e) {}
  if (savedKey) {
    state.key = savedKey;
    api('/verify').then(loadAndRender).catch(function () {
      if (state.key) renderLogin();
    });
  } else {
    renderLogin();
  }
})();
