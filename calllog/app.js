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
  var STANDARD_KEYS = STANDARD_FIELDS.map(function (f) { return f.key; });
  var RESERVED_KEYS = ['id', 'createdAt', 'updatedAt'];

  var state = {
    key: null,
    entries: [],
    settings: { stationCallsign: '' },
    fieldDefs: [],       // [{key, label, type, maxLength}] — the custom field registry
    editingId: null,
    showNewFieldForm: false,
    error: null,
  };

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

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Authorization': 'Bearer ' + state.key }, opts.headers || {});
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
    Promise.all([api('/entries'), api('/settings'), api('/fields')])
      .then(function (results) {
        state.entries = results[0].entries || [];
        state.settings = results[1].settings || { stationCallsign: '' };
        state.fieldDefs = results[2].fields || [];
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

    // Registry-defined custom fields — always shown, populated from the entry when editing.
    var registryInputs = {};
    if (state.fieldDefs.length) {
      panel.appendChild(el('h3', { style: 'margin:18px 0 8px;font-size:.92rem' }, ['Custom fields']));
      var cgrid = el('div', { class: 'grid cols-4' });
      state.fieldDefs.forEach(function (f) {
        var htmlType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        var attrs = { type: htmlType, id: 'cf-' + f.key };
        if (f.type === 'text' && f.maxLength) attrs.maxlength = String(f.maxLength);
        var input = el('input', attrs);
        input.value = editing ? (editing[f.key] !== undefined && editing[f.key] !== null ? String(editing[f.key]) : '') : '';
        registryInputs[f.key] = input;
        cgrid.appendChild(el('div', { class: 'field' }, [
          el('label', { for: 'cf-' + f.key }, [f.label]),
          input,
        ]));
      });
      panel.appendChild(cgrid);
    }

    // Legacy fields: present on this entry but no longer in the registry (i.e. their
    // definition was deleted). Shown read-only with a note; saving this record removes them.
    var legacyKeys = [];
    if (editing) {
      var knownKeys = STANDARD_KEYS.concat(RESERVED_KEYS).concat(state.fieldDefs.map(function (f) { return f.key; }));
      legacyKeys = Object.keys(editing).filter(function (k) { return knownKeys.indexOf(k) === -1; });
    }
    if (legacyKeys.length) {
      var legacyBox = el('div', { class: 'legacy-fields' });
      legacyBox.appendChild(el('p', { class: 'muted', style: 'margin:0 0 6px' }, [
        'These fields were removed from the field list. Saving this contact will remove them from it.'
      ]));
      legacyKeys.forEach(function (k) {
        legacyBox.appendChild(el('div', { class: 'legacy-row' }, [
          el('span', { class: 'legacy-key' }, [k]),
          el('span', { class: 'legacy-val' }, [String(editing[k])]),
        ]));
      });
      panel.appendChild(legacyBox);
    }

    // "+ Add field" — define a brand new custom field (name, type, char cap for text).
    panel.appendChild(renderNewFieldControl());

    var actions = el('div', { style: 'margin-top:16px;display:flex;gap:10px' });
    actions.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () { submitForm(inputs, registryInputs, legacyKeys, editing); }
    }, [editing ? 'Save changes' : 'Add contact']));
    if (editing) {
      actions.appendChild(el('button', {
        class: 'btn secondary', type: 'button',
        onclick: function () { state.editingId = null; renderApp(); }
      }, ['Cancel']));
    }
    panel.appendChild(actions);

    return panel;
  }

  function renderNewFieldControl() {
    var wrap = el('div', { style: 'margin-top:16px' });
    if (!state.showNewFieldForm) {
      wrap.appendChild(el('button', {
        class: 'btn secondary small', type: 'button',
        onclick: function () { state.showNewFieldForm = true; renderApp(); }
      }, ['+ Add field']));
      return wrap;
    }

    var nameInput = el('input', { type: 'text', placeholder: 'Field name (e.g. Weather)', maxlength: '64' });
    var typeSelect = el('select', {});
    [['text', 'Text'], ['number', 'Number'], ['date', 'Date']].forEach(function (pair) {
      typeSelect.appendChild(el('option', { value: pair[0] }, [pair[1]]));
    });
    var maxLenInput = el('input', { type: 'number', placeholder: 'Max characters (default 200)', min: '1', max: '2000' });
    var maxLenField = el('div', { class: 'field', style: 'max-width:220px' }, [
      el('label', {}, ['Character cap (text fields only)']),
      maxLenInput,
    ]);
    typeSelect.addEventListener('change', function () {
      maxLenField.style.display = typeSelect.value === 'text' ? 'block' : 'none';
    });

    var errorSlot = el('div');

    var row = el('div', { class: 'new-field-row' }, [
      el('div', { class: 'field', style: 'max-width:220px' }, [el('label', {}, ['Field name']), nameInput]),
      el('div', { class: 'field', style: 'max-width:140px' }, [el('label', {}, ['Type']), typeSelect]),
      maxLenField,
    ]);

    var createBtn = el('button', {
      class: 'btn small', type: 'button',
      onclick: function () {
        var key = nameInput.value.trim();
        if (!key) { nameInput.focus(); return; }
        var body = { key: key, type: typeSelect.value };
        if (typeSelect.value === 'text' && maxLenInput.value) body.maxLength = parseInt(maxLenInput.value, 10);
        createBtn.disabled = true;
        api('/fields', { method: 'POST', body: body })
          .then(function (r) {
            state.fieldDefs = r.fields;
            state.showNewFieldForm = false;
            renderApp();
          })
          .catch(function (err) {
            createBtn.disabled = false;
            if (err.message !== 'unauthorized') {
              errorSlot.innerHTML = '';
              errorSlot.appendChild(el('div', { class: 'error', style: 'margin-top:8px' }, [err.message]));
            }
          });
      }
    }, ['Create field']);
    var cancelBtn = el('button', {
      class: 'btn secondary small', type: 'button',
      onclick: function () { state.showNewFieldForm = false; renderApp(); }
    }, ['Cancel']);

    wrap.appendChild(el('div', { class: 'panel-inset' }, [row, el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [createBtn, cancelBtn]), errorSlot]));
    return wrap;
  }

  function submitForm(inputs, registryInputs, legacyKeys, editing) {
    var payload = {};
    STANDARD_FIELDS.forEach(function (f) {
      var v = inputs[f.key].value.trim();
      if (v) payload[f.key] = v;
    });
    state.fieldDefs.forEach(function (f) {
      var raw = registryInputs[f.key] ? registryInputs[f.key].value.trim() : '';
      if (editing) {
        // Editing: send the value even if blank, so a field can be intentionally cleared.
        payload[f.key] = raw === '' ? null : (f.type === 'number' ? Number(raw) : raw);
      } else if (raw !== '') {
        payload[f.key] = f.type === 'number' ? Number(raw) : raw;
      }
    });
    if (editing && legacyKeys && legacyKeys.length) {
      legacyKeys.forEach(function (k) { payload[k] = null; });
    }

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

    // Columns: standard fields, then registry fields (in registry order), then any
    // leftover "legacy" keys still present on some entry but no longer in the registry.
    var registryKeys = state.fieldDefs.map(function (f) { return f.key; });
    var knownKeys = STANDARD_KEYS.concat(RESERVED_KEYS).concat(registryKeys);
    var legacyCols = [];
    state.entries.forEach(function (e) {
      Object.keys(e).forEach(function (k) {
        if (knownKeys.indexOf(k) === -1 && legacyCols.indexOf(k) === -1) legacyCols.push(k);
      });
    });
    var columns = STANDARD_FIELDS.slice()
      .concat(state.fieldDefs.map(function (f) { return { key: f.key, label: f.label, custom: true }; }))
      .concat(legacyCols.map(function (k) { return { key: k, label: k, legacy: true }; }));

    var scroll = el('div', { class: 'table-scroll' });
    var table = el('table');

    var headerCells = [el('th', {}, ['#'])];
    columns.forEach(function (c) {
      var cellChildren = [document.createTextNode(c.label)];
      if (c.custom) {
        cellChildren.push(el('button', {
          class: 'col-delete', type: 'button', title: 'Remove this field from the field list',
          onclick: function () { deleteFieldDef(c.key); }
        }, ['×']));
      }
      if (c.legacy) {
        cellChildren.push(el('span', { class: 'col-legacy-mark', title: 'Removed field — clears next time each contact is edited & saved' }, ['†']));
      }
      headerCells.push(el('th', {}, cellChildren));
    });
    headerCells.push(el('th', {}, ['']));
    table.appendChild(el('thead', {}, [el('tr', {}, headerCells)]));

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
        el('button', { class: 'btn secondary small', type: 'button', onclick: function () { state.editingId = entry.id; renderApp(); window.scrollTo(0, 0); } }, ['Edit']),
        el('button', { class: 'btn danger small', type: 'button', onclick: function () { deleteEntry(entry.id); } }, ['Delete']),
      ]);
      cells.push(actions);
      tbody.appendChild(el('tr', {}, cells));
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    if (legacyCols.length) {
      panel.appendChild(el('p', { class: 'muted', style: 'font-size:.78rem;margin-top:10px' }, [
        '† marks a field that was removed from the field list. Its old values will clear from each contact the next time that contact is edited and saved.'
      ]));
    }
    return panel;
  }

  function deleteFieldDef(key) {
    var affected = state.entries.filter(function (e) { return Object.prototype.hasOwnProperty.call(e, key) && e[key] !== undefined && e[key] !== null && e[key] !== ''; }).length;
    var msg = 'Remove "' + key + '" from the field list? It will no longer appear on new or edited contacts. ' +
      (affected > 0
        ? affected + ' existing contact' + (affected === 1 ? '' : 's') + ' currently ' + (affected === 1 ? 'has' : 'have') + ' a value in this field — that value will stay until each contact is next edited and saved, at which point it will be removed.'
        : 'No existing contacts currently have a value in this field.');
    if (!confirm(msg)) return;
    api('/fields/' + encodeURIComponent(key), { method: 'DELETE' })
      .then(function (r) {
        state.fieldDefs = r.fields;
        renderApp();
      })
      .catch(function (err) {
        if (err.message !== 'unauthorized') alert('Could not remove field: ' + err.message);
      });
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
