(function () {
  'use strict';

  var app = document.getElementById('app');
  var KEY_STORAGE = 'calllog-access-key';

  var STANDARD_FIELDS = [
    { key: 'callsign', label: 'Callsign worked', type: 'text', required: true, upper: true },
    { key: 'firstName', label: 'First name', type: 'text' },
    { key: 'surname', label: 'Surname', type: 'text', placeholder: 'Optional' },
    { key: 'contactDateTime', label: 'Date & Time', type: 'datetime', required: true, span2: true },
    { key: 'frequency', label: 'Frequency (TX)', type: 'text', placeholder: 'MHz, e.g. 14.245' },
    { key: 'mode', label: 'Mode', type: 'text', placeholder: 'e.g. SSB, FM, FT8', upper: true },
    { key: 'freqRx', label: 'RX frequency', type: 'text', placeholder: 'only if different', split: true },
    { key: 'sigRcvd', label: 'Signal rcvd', type: 'text', placeholder: 'e.g. 59', rst: 'rcvd' },
    { key: 'sigSent', label: 'Signal sent', type: 'text', placeholder: 'e.g. 59', rst: 'sent' },
    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Anything worth remembering about this contact\u2026', wide: true },
  ];
  var STANDARD_KEYS = STANDARD_FIELDS.map(function (f) { return f.key; });
  var RESERVED_KEYS = ['id', 'createdAt', 'updatedAt'];

  // ---------- Date/time helpers ----------
  // Entries store contactDateTime as a UTC ISO string. The <input type="datetime-local">
  // control always shows/accepts *local* wall-clock time with no timezone info, so we
  // convert on the way in and out. This is what gives us "seamless" local display while
  // keeping a single, unambiguous UTC value in storage.
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function isoToLocalInputValue(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function localInputValueToIso(val) {
    if (!val) return '';
    // "YYYY-MM-DDTHH:MM" with no zone suffix is parsed by Date() as local time.
    var d = new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  function formatLocalDisplay(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var datePart = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    var timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return datePart + ' ' + timePart;
  }

  // Callsigns and modes are always upper case. Keeps the caret where it was while converting.
  function forceUpper(input) {
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.addEventListener('input', function () {
      var u = input.value.toUpperCase();
      if (u !== input.value) {
        var a = input.selectionStart, b = input.selectionEnd;
        input.value = u;
        try { input.setSelectionRange(a, b); } catch (e) { /* not all input types support it */ }
      }
    });
  }

  // MHz string <-> integer Hz (avoids floating-point noise when adding offsets).
  function mhzToHz(str) {
    var n = parseFloat(String(str || '').replace(',', '.'));
    return isFinite(n) ? Math.round(n * 1e6) : NaN;
  }
  function hzToMhz(hz) { return String(Number((hz / 1e6).toFixed(6))); }
  function describeSplit(txStr, rxStr) {
    var tx = mhzToHz(txStr), rx = mhzToHz(rxStr);
    if (!isFinite(tx) || !isFinite(rx) || tx === rx) return '';
    var d = rx - tx, abs = Math.abs(d);
    var size = abs >= 1e6 && abs % 1e6 === 0 ? (abs / 1e6) + ' MHz' : String(Number((abs / 1000).toFixed(3))) + ' kHz';
    return 'Split: RX is ' + size + (d > 0 ? ' above' : ' below') + ' TX.';
  }

  function localTimezoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch (e) { return 'local time'; }
  }

  function utcHintText(localVal) {
    var iso = localInputValueToIso(localVal);
    var tz = 'Local time (' + localTimezoneName() + ')';
    return iso ? tz + ' \u2014 stored as ' + iso.slice(0, 10) + ' ' + iso.slice(11, 16) + ' UTC' : tz + ' \u2014 stored in UTC';
  }

  var state = {
    key: null,
    entries: [],
    settings: { stationCallsign: '' },
    fieldDefs: [],       // [{key, label, type, maxLength}] — the custom field registry
    editingId: null,
    showNewFieldForm: false,
    draft: null,         // unsaved form values, kept across re-renders
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

  // Hover/focus explanation of an RS(T) signal report (see en.wikipedia.org/wiki/R-S-T_system).
  function rstHelp(side) {
    var id = 'tip-rst-' + side;
    function p(nodes) { return el('p', {}, nodes); }
    var tip = el('div', { class: 'tip', id: id, role: 'tooltip' }, [
      el('strong', {}, ['RS(T) signal report']),
      p(['Voice uses two digits (e.g. 59). CW and digital modes add a third digit for tone (e.g. 599).']),
      p([el('b', {}, ['R \u2013 Readability, 1\u20135: ']), '1 unreadable \u00B7 2 barely readable, occasional words \u00B7 3 readable with considerable difficulty \u00B7 4 readable with practically no difficulty \u00B7 5 perfectly readable.']),
      p([el('b', {}, ['S \u2013 Strength, 1\u20139: ']), '1 faint, barely perceptible \u00B7 3 weak \u00B7 5 fairly good \u00B7 7 moderately strong \u00B7 9 extremely strong. One S-point is about 6 dB; \u201C20 over 9\u201D means 20 dB above S9.']),
      p([el('b', {}, ['T \u2013 Tone, 1\u20139 (CW/digital only): ']), '1 very rough, harsh note \u00B7 9 perfect tone, no trace of ripple.']),
      p([el('b', {}, [side === 'rcvd' ? 'Signal rcvd: ' : 'Signal sent: ']),
        side === 'rcvd' ? 'the report you were given \u2014 how well they heard you.' : 'the report you gave them \u2014 how well you heard them.']),
    ]);
    var btn = el('span', { class: 'info', tabindex: '0', role: 'button', 'aria-label': 'What do the signal report numbers mean?', 'aria-describedby': id }, ['i']);
    var wrap = el('span', { class: 'info-wrap' }, [btn, tip]);
    // The tip is position:fixed and clamped to the viewport, so it never runs off either edge.
    function place() {
      var ir = btn.getBoundingClientRect();
      var vw = document.documentElement.clientWidth;   // excludes any scrollbar
      tip.style.width = Math.min(340, vw - 16) + 'px';
      var tw = tip.offsetWidth;
      var left = Math.max(8, Math.min(ir.left, vw - tw - 8));
      var top = ir.bottom + 8;
      if (top + tip.offsetHeight > window.innerHeight - 8 && ir.top - 8 - tip.offsetHeight > 8) top = ir.top - 8 - tip.offsetHeight;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function show() { place(); window.addEventListener('scroll', place, true); window.addEventListener('resize', place); }
    function hide() { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); }
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('focusin', show);
    wrap.addEventListener('mouseleave', hide);
    wrap.addEventListener('focusout', hide);
    return wrap;
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
    forceUpper(stationInput);
    stationInput.value = stationInput.value.toUpperCase();
    stationInput.addEventListener('change', function () {
      api('/settings', { method: 'PUT', body: { stationCallsign: stationInput.value.trim().toUpperCase() } })
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
    panel.appendChild(el('p', { class: 'muted', style: 'margin-top:-8px' }, [
      'Fields marked * are required. Date & Time is entered and shown in your local timezone, but stored in UTC.'
    ]));

    var formErrorSlot = el('div');
    panel.appendChild(formErrorSlot);

    // Unsaved values survive a re-render (e.g. removing a custom field mid-entry).
    var ctx = editing ? 'edit:' + editing.id : 'new';
    if (!state.draft || state.draft.ctx !== ctx) state.draft = { ctx: ctx, values: {}, legacy: {} };
    var draft = state.draft;
    function remember(input, dkey) {
      if (Object.prototype.hasOwnProperty.call(draft.values, dkey)) input.value = draft.values[dkey];
      input.addEventListener('input', function () { draft.values[dkey] = input.value; });
    }

    var inputs = {};
    var grid = el('div', { class: 'grid cols-4' });
    var lastWorkedInput = el('input', { type: 'text', id: 'f-lastWorked', readonly: 'readonly', class: 'readonly-field' });
    STANDARD_FIELDS.forEach(function (f) {
      var input;
      if (f.type === 'textarea') {
        input = el('textarea', { id: 'f-' + f.key, rows: '3', maxlength: '2000' });
      } else {
        input = el('input', { type: f.type === 'datetime' ? 'datetime-local' : (f.type === 'date' ? 'date' : 'text'), id: 'f-' + f.key });
      }
      if (f.placeholder) input.setAttribute('placeholder', f.placeholder);
      if (f.upper) forceUpper(input);   // registered before remember() so drafts store upper case
      if (f.type === 'datetime') {
        // A new contact defaults to "now" when the page/form loads: shown in local time, stored as UTC.
        input.value = editing ? isoToLocalInputValue(editing[f.key]) : isoToLocalInputValue(new Date().toISOString());
      } else {
        input.value = editing ? (editing[f.key] || '') : '';
      }
      remember(input, f.key);
      if (f.upper) input.value = input.value.toUpperCase();
      inputs[f.key] = input;
      if (f.required) {
        input.addEventListener('input', function () { input.classList.remove('invalid'); });
      }

      var labelEl = el('label', { for: 'f-' + f.key }, [f.label + (f.required ? ' *' : '')]);
      var head = f.rst ? el('div', { class: 'label-row' }, [labelEl, rstHelp(f.rst)]) : labelEl;
      var cell = el('div', { class: 'field' + (f.wide ? ' field-wide' : '') + (f.span2 ? ' field-span2' : '') }, [head, input]);
      if (f.type === 'datetime') {
        var hint = el('div', { class: 'hint', id: 'utc-hint' });
        var nowBtn = el('button', { class: 'link-btn', type: 'button', onclick: function () {
          input.value = isoToLocalInputValue(new Date().toISOString());
          draft.values[f.key] = input.value;
          setHint();
        } }, ['Use current time']);
        var setHint = function () { hint.textContent = utcHintText(input.value) + ' \u00B7 '; hint.appendChild(nowBtn); };
        input.addEventListener('input', setHint);
        input.addEventListener('change', setHint);
        setHint();
        cell.appendChild(hint);
      }
      if (f.split) {
        // RX frequency (only when it differs from TX): live "split" description + quick presets.
        var splitHint = el('div', { class: 'hint', id: 'split-hint' });
        var refreshSplit = function () { splitHint.textContent = describeSplit(inputs.frequency.value, input.value); };
        input.addEventListener('input', refreshSplit);
        inputs.frequency.addEventListener('input', refreshSplit);
        refreshSplit();
        cell.appendChild(splitHint);
      }
      grid.appendChild(cell);
      if (f.split) {
        var presets = el('select', { id: 'f-quicksplit', 'aria-label': 'Quick split presets' }, [
          el('option', { value: '' }, ['Choose\u2026']),
          el('option', { value: 'simplex' }, ['Simplex (RX same as TX)']),
          el('option', { value: '-600' }, ['RX 600 kHz below TX']),
          el('option', { value: '600' }, ['RX 600 kHz above TX']),
          el('option', { value: '-5000' }, ['RX 5 MHz below TX']),
          el('option', { value: '5000' }, ['RX 5 MHz above TX']),
        ]);
        presets.addEventListener('change', function () {
          var v = presets.value; presets.value = '';
          if (!v) return;
          var rxInput = inputs.freqRx;
          if (v === 'simplex') {
            rxInput.value = '';
          } else {
            var tx = mhzToHz(inputs.frequency.value);
            if (!isFinite(tx)) { document.getElementById('split-hint').textContent = 'Enter the TX frequency (MHz) first.'; return; }
            rxInput.value = hzToMhz(tx + Number(v) * 1000);
          }
          rxInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        grid.appendChild(el('div', { class: 'field' }, [
          el('label', { for: 'f-quicksplit' }, ['Quick split']),
          presets,
          el('div', { class: 'hint' }, ['Repeaters: 2 m is \u00B1600 kHz, 70 cm \u00B15 MHz. SSB: use for split operation.'])
        ]));
      }
      // Drop the read-only "last worked" lookup right after the callsign field.
      if (f.key === 'callsign') {
        grid.appendChild(el('div', { class: 'field' }, [
          el('label', { for: 'f-lastWorked' }, ['Last worked (this callsign)']),
          lastWorkedInput,
        ]));
      }
    });
    panel.appendChild(grid);

    // Look up when this callsign was last logged. If it's never been logged before,
    // treat it as a new callsign and default the date/time field to right now.
    // If it has been logged before, use that most recent record to fill in the
    // operator's name and usual mode, as long as the operator hasn't already typed
    // something into those fields themselves.
    function updateLastWorked() {
      var cs = inputs.callsign.value.trim().toUpperCase();
      if (!cs) { lastWorkedInput.value = ''; return; }
      var matches = state.entries.filter(function (e) {
        if (editing && e.id === editing.id) return false;
        return (e.callsign || '').trim().toUpperCase() === cs;
      });
      if (matches.length === 0) {
        lastWorkedInput.value = 'New callsign — not logged before';
        if (!editing && !inputs.contactDateTime.value) {
          inputs.contactDateTime.value = isoToLocalInputValue(new Date().toISOString());
        }
      } else {
        matches.sort(function (a, b) {
          return (b.contactDateTime || b.createdAt || '').localeCompare(a.contactDateTime || a.createdAt || '');
        });
        var last = matches[0];
        var when = last.contactDateTime || last.createdAt;
        lastWorkedInput.value = formatLocalDisplay(when) + ' local';
        ['firstName', 'surname', 'mode'].forEach(function (k) {
          if (!inputs[k].value.trim() && last[k]) inputs[k].value = k === 'mode' ? String(last[k]).toUpperCase() : last[k];
        });
      }
    }
    inputs.callsign.addEventListener('input', updateLastWorked);
    updateLastWorked();

    // Registry-defined custom fields — always shown, populated from the entry when editing.
    // Each has a remove (×) control: it only removes the field from the field list;
    // existing contacts keep whatever value they already hold.
    var registryInputs = {};
    if (state.fieldDefs.length) {
      panel.appendChild(el('h3', { style: 'margin:18px 0 2px;font-size:.92rem' }, ['Custom fields']));
      panel.appendChild(el('p', { class: 'muted', style: 'margin:0 0 8px' }, [
        'Use \u00D7 to remove a field from this form. Contacts you have already saved keep their values.'
      ]));
      var cgrid = el('div', { class: 'grid cols-4' });
      state.fieldDefs.forEach(function (f) {
        var htmlType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        var attrs = { type: htmlType, id: 'cf-' + f.key };
        if (f.type === 'text' && f.maxLength) attrs.maxlength = String(f.maxLength);
        var input = el('input', attrs);
        input.value = editing ? (editing[f.key] !== undefined && editing[f.key] !== null ? String(editing[f.key]) : '') : '';
        remember(input, 'cf:' + f.key);
        registryInputs[f.key] = input;
        var removeBtn = el('button', {
          class: 'field-remove', type: 'button',
          title: 'Remove this field from the field list (saved contacts keep their values)',
          'aria-label': 'Remove field ' + f.label,
          onclick: function () { deleteFieldDef(f.key); }
        }, ['\u00D7']);
        cgrid.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'label-row' }, [el('label', { for: 'cf-' + f.key }, [f.label]), removeBtn]),
          input,
        ]));
      });
      panel.appendChild(cgrid);
    }

    // Legacy fields: present on this entry but no longer in the field list (their definition
    // was removed). The value is KEPT on this contact unless you choose to remove it here.
    var legacyKeys = [];
    if (editing) {
      var knownKeys = STANDARD_KEYS.concat(RESERVED_KEYS).concat(state.fieldDefs.map(function (f) { return f.key; }));
      legacyKeys = Object.keys(editing).filter(function (k) { return knownKeys.indexOf(k) === -1; });
    }
    if (legacyKeys.length) {
      var legacyBox = el('div', { class: 'legacy-fields' });
      legacyBox.appendChild(el('p', { class: 'muted', style: 'margin:0 0 6px' }, [
        'These values belong to fields that are no longer in your field list. They are kept on this contact unless you remove them here. Restore brings a field back as an editable custom field.'
      ]));
      legacyKeys.forEach(function (k) {
        var row = el('div', { class: 'legacy-row' });
        var removeBtn = el('button', { class: 'btn secondary small', type: 'button' }, []);
        function paint() {
          var on = !!draft.legacy[k];
          row.classList.toggle('will-remove', on);
          removeBtn.textContent = on ? 'Will be removed \u2014 undo' : 'Remove from this contact';
        }
        removeBtn.addEventListener('click', function () { draft.legacy[k] = !draft.legacy[k]; paint(); });
        paint();
        var restoreBtn = el('button', {
          class: 'btn secondary small', type: 'button',
          onclick: function () { restoreFieldDef(k, editing[k]); }
        }, ['Restore']);
        [el('span', { class: 'legacy-key' }, [k]), el('span', { class: 'legacy-val' }, [String(editing[k])]), restoreBtn, removeBtn]
          .forEach(function (n) { row.appendChild(n); });
        legacyBox.appendChild(row);
      });
      panel.appendChild(legacyBox);
    }

    // "+ Add field" — define a brand new custom field (name, type, char cap for text).
    panel.appendChild(renderNewFieldControl());

    var actions = el('div', { class: 'form-actions' });
    actions.appendChild(el('button', {
      class: 'btn', type: 'button',
      onclick: function () {
        if (!validateRequired(inputs, formErrorSlot)) return;
        submitForm(inputs, registryInputs, draft.legacy, editing);
      }
    }, [editing ? 'Save changes' : 'Add contact']));
    if (editing) {
      actions.appendChild(el('button', {
        class: 'btn secondary', type: 'button',
        onclick: function () { state.editingId = null; state.draft = null; renderApp(); }
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

  function validateRequired(inputs, errorSlot) {
    var missing = [];
    STANDARD_FIELDS.forEach(function (f) {
      if (!f.required) return;
      var empty = inputs[f.key].value.trim() === '';
      inputs[f.key].classList.toggle('invalid', empty);
      if (empty) missing.push(f.label);
    });
    errorSlot.innerHTML = '';
    if (missing.length) {
      errorSlot.appendChild(el('div', { class: 'error', style: 'margin-bottom:12px' }, [
        'Please fill in: ' + missing.join(', ') + '.'
      ]));
      inputs[STANDARD_FIELDS.filter(function (f) { return f.required; })
        .find(function (f) { return inputs[f.key].value.trim() === ''; }).key].focus();
      return false;
    }
    return true;
  }

  function submitForm(inputs, registryInputs, removeLegacy, editing) {
    var payload = {};
    STANDARD_FIELDS.forEach(function (f) {
      if (f.type === 'datetime') {
        var iso = localInputValueToIso(inputs[f.key].value);
        if (iso) payload[f.key] = iso;
        return;
      }
      var v = inputs[f.key].value.trim();
      if (f.upper) v = v.toUpperCase();
      if (v) payload[f.key] = v;
      else if (editing && editing[f.key] !== undefined && editing[f.key] !== null && editing[f.key] !== '') payload[f.key] = null;   // blank on edit = clear it
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
    // Values under removed fields are only cleared when the operator explicitly asks.
    if (editing && removeLegacy) {
      Object.keys(removeLegacy).forEach(function (k) { if (removeLegacy[k]) payload[k] = null; });
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
      state.draft = null;
      renderApp();
    }).catch(function (err) {
      if (err.message !== 'unauthorized') alert('Could not save: ' + err.message);
    });
  }

  // ---------- Table ----------
  function renderTable() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-head' }, [
      el('h2', {}, ['Contacts (' + state.entries.length + ')']),
      renderExportControl()
    ]));
    panel.appendChild(el('p', { class: 'muted', style: 'margin-top:-8px' }, [
      'Date & time is stored in UTC and shown here in your browser\u2019s local timezone. Hover a date/time cell to see the UTC value.'
    ]));

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

    // On narrow screens the header row is hidden (rows become cards), so custom/legacy
    // columns are also offered here as chips; CSS hides this on wider screens.
    var chips = null;
    var manageable = columns.filter(function (c) { return c.custom || c.legacy; });
    if (manageable.length) {
      chips = el('div', { class: 'field-chips' }, [el('span', { class: 'muted' }, ['Custom fields:'])]);
      manageable.forEach(function (c) {
        chips.appendChild(el('span', { class: 'chip' }, [
          c.label + (c.legacy ? ' \u2020' : ''),
          c.legacy
            ? el('button', { class: 'col-restore', type: 'button', title: 'Restore this field to the active field list', 'aria-label': 'Restore field ' + c.label,
                onclick: function () { restoreFieldDef(c.key, findSampleValue(c.key)); } }, ['\u21BA'])
            : el('button', { class: 'col-delete', type: 'button', title: 'Remove this field from the field list', 'aria-label': 'Remove field ' + c.label,
                onclick: function () { deleteFieldDef(c.key); } }, ['\u00D7'])
        ]));
      });
    }

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
        cellChildren.push(el('button', {
          class: 'col-restore', type: 'button', title: 'Restore this field to the active field list',
          onclick: function () { restoreFieldDef(c.key, findSampleValue(c.key)); }
        }, ['↺']));
        cellChildren.push(el('span', { class: 'col-legacy-mark', title: 'Removed field — contacts keep this value until you remove it from each one' }, ['†']));
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
      var cells = [el('td', { 'data-label': '#' }, [String(i + 1)])];
      columns.forEach(function (c) {
        var v = entry[c.key];
        var display;
        var titleAttr = {};
        if (c.key === 'contactDateTime') {
          display = v ? formatLocalDisplay(v) : '—';
          if (v) titleAttr.title = v + ' UTC';
        } else {
          display = v === undefined || v === null || v === '' ? '—' : String(v);
          if (c.key === 'callsign' || c.key === 'mode') display = display.toUpperCase();
        }
        titleAttr['data-label'] = c.label;
        if (c.key === 'notes') { titleAttr['class'] = 'notes-cell'; if (v) titleAttr.title = String(v); }
        cells.push(el('td', titleAttr, [display]));
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
    if (chips) panel.appendChild(chips);
    panel.appendChild(scroll);
    if (legacyCols.length) {
      panel.appendChild(el('p', { class: 'muted', style: 'font-size:.78rem;margin-top:10px' }, [
        '† marks a field that is no longer in the field list. Contacts keep its values until you remove them from each contact (Edit → Remove from this contact) — or click ↺ to bring the field back.'
      ]));
    }
    return panel;
  }

  function findSampleValue(key) {
    for (var i = 0; i < state.entries.length; i++) {
      var v = state.entries[i][key];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  }

  function restoreFieldDef(key, sampleValue) {
    var type = typeof sampleValue === 'number' ? 'number' : 'text';
    api('/fields', { method: 'POST', body: { key: key, type: type } })
      .then(function (r) {
        state.fieldDefs = r.fields;
        renderApp();
      })
      .catch(function (err) {
        if (err.message !== 'unauthorized') alert('Could not restore field: ' + err.message);
      });
  }

  function deleteFieldDef(key) {
    var affected = state.entries.filter(function (e) { return Object.prototype.hasOwnProperty.call(e, key) && e[key] !== undefined && e[key] !== null && e[key] !== ''; }).length;
    var msg = 'Remove "' + key + '" from the field list? It will no longer appear when adding or editing contacts. ' +
      (affected > 0
        ? 'Your saved contacts are not changed: ' + affected + ' contact' + (affected === 1 ? '' : 's') + ' currently ' + (affected === 1 ? 'has' : 'have') + ' a value in this field and will keep it until you remove it from each one (Edit the contact, then Remove from this contact).'
        : 'No saved contacts currently have a value in this field.');
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

  // ---------- Export / backup ----------
  function sortedEntries() {
    return state.entries.map(function (e) {
      var c = Object.assign({}, e);
      if (typeof c.callsign === 'string') c.callsign = c.callsign.toUpperCase();
      if (typeof c.mode === 'string') c.mode = c.mode.toUpperCase();
      return c;
    }).sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  }

  function exportKeys(entries) {
    var keys = STANDARD_KEYS.slice();
    state.fieldDefs.forEach(function (f) { if (keys.indexOf(f.key) === -1) keys.push(f.key); });
    entries.forEach(function (e) {
      Object.keys(e).forEach(function (k) {
        if (keys.indexOf(k) === -1 && RESERVED_KEYS.indexOf(k) === -1) keys.push(k);  // removed fields' data is still exported
      });
    });
    return keys.concat(RESERVED_KEYS);
  }

  function csvCell(v) {
    if (v === undefined || v === null) return '';
    var t = String(v);
    // Guard against spreadsheet formula injection (leave plain negative numbers alone).
    if (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && !/^-?\d+(\.\d+)?$/.test(t))) t = "'" + t;
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function buildCsv(entries) {
    var keys = exportKeys(entries);
    var cols = keys.slice();
    cols.splice(cols.indexOf('contactDateTime') + 1, 0, 'contactDateTimeLocal');
    var lines = [cols.map(csvCell).join(',')];
    entries.forEach(function (e) {
      lines.push(cols.map(function (k) {
        if (k === 'contactDateTimeLocal') return isoToLocalInputValue(e.contactDateTime).replace('T', ' ');
        return csvCell(e[k]);
      }).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';   // BOM so Excel reads UTF-8 correctly
  }

  function buildJson(entries) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      stationCallsign: state.settings.stationCallsign || '',
      timezone: localTimezoneName(),
      note: 'Date & time values are stored and exported in UTC.',
      fields: state.fieldDefs,
      entries: entries
    }, null, 2) + '\n';
  }

  function exportFileName(ext) {
    var d = new Date();
    var stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    var cs = (state.settings.stationCallsign || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return 'calllog' + (cs ? '-' + cs : '') + '-' + stamp + '.' + ext;
  }

  function exportData(fmt) {
    var entries = sortedEntries();
    var isCsv = fmt === 'csv';
    var blob = new Blob([isCsv ? buildCsv(entries) : buildJson(entries)],
      { type: isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: exportFileName(isCsv ? 'csv' : 'json') });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  // Split button: main part exports CSV; the arrow opens a menu with CSV and JSON.
  function renderExportControl() {
    var hasData = state.entries.length > 0;
    var wrap = el('div', { class: 'split-btn' });
    var main = el('button', {
      class: 'btn small split-main', type: 'button', disabled: !hasData,
      title: hasData ? 'Download all contacts as CSV' : 'No contacts to export yet',
      onclick: function () { closeMenu(); exportData('csv'); }
    }, ['Export CSV']);
    var toggle = el('button', {
      class: 'btn small split-toggle', type: 'button', disabled: !hasData,
      'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Choose export format'
    }, ['\u25BE']);
    function item(fmt, title, desc) {
      return el('button', { class: 'menu-item', type: 'button', role: 'menuitem',
        onclick: function () { closeMenu(); exportData(fmt); } },
        [el('strong', {}, [title]), el('span', { class: 'menu-desc' }, [desc])]);
    }
    var menu = el('div', { class: 'split-menu', role: 'menu' }, [
      item('csv', 'Export as CSV', 'For spreadsheets (Excel, Google Sheets)'),
      item('json', 'Export as JSON', 'Full backup, includes your field list'),
    ]);
    menu.hidden = true;
    function onDocClick(e) { if (!wrap.contains(e.target)) closeMenu(); }
    function onKey(e) { if (e.key === 'Escape') { closeMenu(); toggle.focus(); } }
    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
    }
    toggle.addEventListener('click', function () {
      if (!menu.hidden) { closeMenu(); return; }
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
    });
    wrap.appendChild(main);
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
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
