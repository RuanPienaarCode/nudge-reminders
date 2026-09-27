'use strict';
/* The board. Everything the user actually touches lives here; every decision
   about WHAT to show was made in model.js, so this file only arranges.

   Rendering is a full rebuild of the list on each change — the lists are tens
   of rows, not thousands, and a rebuild cannot drift out of step with the
   file the way a patched DOM can. */

const { Notice, Menu } = require('obsidian');
const { el, icon, button, input, clear } = require('./dom');
const { makeStore } = require('./store');
const { FILTERS, SNOOZE, isLightLook } = require('./constants');
const M = require('./model');
const D = require('./dates');
const R = require('./recur');
const { parseQuick } = require('./quickparse');
const { openEditor } = require('./modals');

const SECTIONS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'someday', label: 'Someday' },
];
const FOR_FILTER = { overdue: ['overdue'], today: ['overdue', 'today'], week: ['overdue', 'today', 'tomorrow', 'week'], someday: ['someday'], done: ['done'] };

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function mountBoard(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const store = makeStore(plugin);
  const root = view.contentEl;

  const state = { items: [], groups: [], lists: [], filter: 'all', group: '', query: '', tag: '', today: D.todayISO(), loaded: false, narrow: false, drawer: false, naming: false };
  let nodes = {};
  let timer = null;
  let sizer = null;

  /* ---- shell ---------------------------------------------------------- */

  /* Surface, tint and light/dark. Cheap, so Obsidian's theme switch can call
     it without rebuilding the board. */
  function applyLook() {
    const s = plugin.settings;
    root.classList.toggle('is-plain', s.surface === 'plain');
    root.classList.toggle('is-light', isLightLook(s.mode, document.body.classList.contains('theme-light')));
    root.setAttribute('data-tint', s.tint || 'aurora');
  }

  function build() {
    clear(root);
    root.classList.add('nd-app');
    applyLook();

    el(root, 'div', 'nd-bg');
    el(root, 'div', 'nd-veil');
    const shell = el(root, 'div', 'nd-shell');
    nodes.side = el(shell, 'aside', 'nd-side');
    nodes.side.setAttribute('aria-label', 'Lists');
    const scrim = el(shell, 'div', 'nd-scrim');
    scrim.addEventListener('click', () => { state.drawer = false; applySide(); });
    const scroll = el(shell, 'div', 'nd-scroll');
    const page = el(scroll, 'div', 'nd-page');

    /* header */
    const head = el(page, 'header', 'nd-head');
    const ht = el(head, 'div', 'nd-head-text');
    const hl = el(ht, 'div', 'nd-head-line');
    nodes.sideToggle = button(hl, 'nd-side-toggle', '', () => toggleSide(), 'panel-left', 'Show or hide the sidebar');
    nodes.greet = el(hl, 'h1', 'nd-greet', greeting(plugin.settings.name));
    nodes.sub = el(ht, 'div', 'nd-sub', '');
    const hr = el(head, 'div', 'nd-head-right');
    nodes.count = el(hr, 'div', 'nd-count');
    el(hr, 'div', 'nd-date', D.shortDate(state.today, state.today));

    /* quick add */
    const add = el(page, 'div', 'nd-add nd-glass');
    icon(add, 'plus', 'nd-add-icon');
    /* The long placeholder teaches the syntax; on a phone it only truncates,
       so the short one earns its place there instead. */
    const narrow = document.body && document.body.classList.contains('is-mobile');
    nodes.addInput = input(add, 'nd-add-input', {
      type: 'text',
      placeholder: narrow ? 'Add a reminder…' : 'Sign papers for mom tomorrow at 9am !high #family',
      'aria-label': 'Add a reminder',
    });
    nodes.addHint = el(add, 'div', 'nd-add-hint');
    button(add, 'nd-add-go', 'Add', () => commitQuickAdd(), null, 'Add this reminder');

    nodes.addInput.addEventListener('input', () => renderHint());
    nodes.addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(); }
      if (e.key === 'Escape') { nodes.addInput.value = ''; renderHint(); }
    });

    /* filter bar */
    const bar = el(page, 'div', 'nd-bar');
    nodes.chips = el(bar, 'div', 'nd-chips');
    const search = el(bar, 'div', 'nd-search nd-glass');
    icon(search, 'search', 'nd-search-icon');
    nodes.search = input(search, 'nd-search-input', { type: 'text', placeholder: 'Search reminders', 'aria-label': 'Search reminders' });
    nodes.search.addEventListener('input', () => { state.query = nodes.search.value; renderList(); });
    nodes.clearSearch = button(search, 'nd-search-clear', '', () => {
      nodes.search.value = ''; state.query = ''; renderList(); nodes.search.focus();
    }, 'x', 'Clear the search');

    nodes.tags = el(page, 'div', 'nd-tags');
    nodes.listHead = el(page, 'div', 'nd-list-head');
    nodes.list = el(page, 'div', 'nd-list');

    /* footer */
    const foot = el(page, 'footer', 'nd-foot');
    button(foot, 'nd-link', 'Open the note', () => openNote(), 'pencil', 'Open Reminders.md');
    button(foot, 'nd-link', 'Export to calendar', () => exportICS(), 'download', 'Write the .ics file your phone can import');
    nodes.footNote = el(foot, 'div', 'nd-foot-note', '');

    applySide();
  }

  /* ---- the sidebar ------------------------------------------------------ */

  /* Beside the board when the pane is wide and the setting is on; a drawer
     over it when the pane is narrow, opened and closed per visit. The width
     that matters is the pane's, not the window's — Obsidian splits panes. */
  function applySide() {
    const on = plugin.settings.sidebar !== false;
    root.classList.toggle('is-narrow', state.narrow);
    root.classList.toggle('has-side', !state.narrow && on);
    root.classList.toggle('is-drawer', state.narrow && state.drawer);
    if (nodes.sideToggle) nodes.sideToggle.setAttribute('aria-expanded', String(state.narrow ? state.drawer : on));
  }

  async function toggleSide() {
    if (state.narrow) { state.drawer = !state.drawer; applySide(); return; }
    plugin.settings.sidebar = plugin.settings.sidebar === false;
    applySide();
    await plugin.saveSettings();
  }

  function measure() {
    const narrow = (root.clientWidth || 0) < 720 || !!(document.body && document.body.classList.contains('is-mobile'));
    if (narrow === state.narrow) return;
    state.narrow = narrow;
    if (!narrow) state.drawer = false;
    applySide();
  }

  function pick(filter, group) {
    state.filter = filter;
    state.group = group;
    state.drawer = false;
    applySide();
    renderSide();
    renderChips();
    renderList();
  }

  function sideItem(parent, label, iconName, n, on, onClick) {
    const b = button(parent, 'nd-side-item' + (on ? ' is-on' : ''), label, onClick, iconName);
    b.setAttribute('aria-current', on ? 'true' : 'false');
    el(b, 'span', 'nd-side-n', n ? n : '');
    return b;
  }

  function renderSide() {
    const side = nodes.side;
    clear(side);
    const b = M.board(state.items, state.today);
    const n = M.viewCounts(b);
    const views = el(side, 'nav', 'nd-side-group');
    for (const f of FILTERS) {
      sideItem(views, f.label, f.icon, n[f.key], !state.group && state.filter === f.key, () => pick(f.key, ''));
    }

    el(side, 'div', 'nd-side-label', 'Lists');
    const lists = el(side, 'nav', 'nd-side-group');
    for (const l of M.listCounts(state.items, state.lists)) {
      sideItem(lists, l.name, l.name === 'Inbox' ? 'inbox' : 'list', l.open, state.group === l.name, () => pick('all', l.name));
    }

    if (state.naming) {
      const box = el(side, 'div', 'nd-side-new');
      icon(box, 'folder-plus');
      const inp = input(box, 'nd-side-input', { type: 'text', placeholder: 'List name', 'aria-label': 'New list name' });
      let done = false;
      const finish = async commit => {
        if (done) return;
        done = true;
        state.naming = false;
        const name = inp.value;
        if (commit && name.trim()) {
          const r = await store.addList(name);
          if (r.ok) { state.group = r.name; state.filter = 'all'; }
          await reload();
        } else renderSide();
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      inp.addEventListener('blur', () => finish(true));
      setTimeout(() => inp.focus(), 0);
    } else {
      button(side, 'nd-side-item nd-side-add', 'New list', () => { state.naming = true; renderSide(); }, 'folder-plus');
    }
  }

  /* ---- data ----------------------------------------------------------- */

  async function reload() {
    const r = await store.load();
    state.items = r.items;
    state.groups = r.groups;
    state.lists = r.lists || r.groups;
    /* The list on screen was renamed or removed in the note. */
    if (state.group && state.lists.indexOf(state.group) === -1) state.group = '';
    state.today = D.todayISO();
    state.loaded = true;
    renderAll();
  }

  /* ---- render --------------------------------------------------------- */

  function renderAll() {
    renderSide();
    renderChips();
    renderTags();
    renderHeader();
    renderList();
  }

  function renderHeader() {
    const b = M.board(state.items, state.today);
    nodes.greet.textContent = greeting(plugin.settings.name);
    nodes.sub.textContent = M.summary(b);
    clear(nodes.count);
    const n = b.counts.due;
    const pill = el(nodes.count, 'div', 'nd-pill nd-pill-count' + (b.counts.overdue ? ' is-late' : n ? ' is-due' : ' is-clear'));
    icon(pill, b.counts.overdue ? 'bell-ring' : 'bell');
    el(pill, 'span', null, n ? `${n} to do` : 'Clear');
    nodes.footNote.textContent = `${b.counts.open} open · ${b.counts.done} done · ${store.path()}`;
  }

  function renderChips() {
    clear(nodes.chips);
    const n = M.viewCounts(M.board(state.items, state.today));
    for (const f of FILTERS) {
      const c = button(nodes.chips, 'nd-chip' + (!state.group && state.filter === f.key ? ' is-on' : ''), f.label, () => pick(f.key, ''), f.icon);
      if (n[f.key]) el(c, 'span', 'nd-chip-n', n[f.key]);
    }
  }

  function renderTags() {
    clear(nodes.tags);
    const tags = M.tagsOf(state.items);
    if (!tags.length) { nodes.tags.classList.add('is-hidden'); return; }
    nodes.tags.classList.remove('is-hidden');
    for (const t of tags.slice(0, 12)) {
      button(nodes.tags, 'nd-tag' + (state.tag === t ? ' is-on' : ''), t, () => {
        state.tag = state.tag === t ? '' : t; renderTags(); renderList();
      });
    }
  }

  function renderHint() {
    const raw = nodes.addInput.value.trim();
    clear(nodes.addHint);
    if (!raw) { nodes.addHint.classList.remove('is-on'); return; }
    const q = parseQuick(raw, state.today);
    const bits = [];
    if (q.due) bits.push(D.relative(q.due, state.today));
    if (q.time) bits.push(q.time);
    if (q.priority !== 'normal') bits.push(q.priority);
    if (q.repeat) bits.push(R.describe(q.repeat).toLowerCase());
    for (const t of q.tags) bits.push(t);
    nodes.addHint.classList.toggle('is-on', bits.length > 0);
    for (const b of bits) el(nodes.addHint, 'span', 'nd-hint-bit', b);
  }

  function renderList() {
    clear(nodes.list);
    renderListHead();
    if (!state.loaded) { el(nodes.list, 'div', 'nd-empty', 'Reading your reminders…'); return; }

    const filtered = M.filterItems(state.items, { query: state.query, tag: state.tag, group: state.group });
    const b = M.board(filtered, state.today);
    const keys = FOR_FILTER[state.filter] || SECTIONS.map(s => s.key);
    let shown = 0;

    for (const key of keys) {
      const items = key === 'done' ? b.done : b[key];
      if (!items || !items.length) continue;
      shown += items.length;
      const sec = el(nodes.list, 'section', 'nd-sec');
      const h = el(sec, 'div', 'nd-sec-head');
      el(h, 'span', 'nd-sec-title', key === 'done' ? 'Done' : (SECTIONS.find(s => s.key === key) || {}).label);
      el(h, 'span', 'nd-sec-n', items.length);
      const rows = el(sec, 'div', 'nd-rows');
      for (const it of items) renderRow(rows, it);
    }

    /* Done is a record, not a queue: it stays out of the way unless asked for. */
    if (state.filter === 'all' && plugin.settings.showDone && b.done.length) {
      const sec = el(nodes.list, 'section', 'nd-sec is-muted');
      const h = el(sec, 'div', 'nd-sec-head');
      el(h, 'span', 'nd-sec-title', 'Done');
      el(h, 'span', 'nd-sec-n', b.done.length);
      const rows = el(sec, 'div', 'nd-rows');
      for (const it of b.done.slice(0, 20)) renderRow(rows, it);
      shown += b.done.length;
    }

    if (!shown) renderEmpty();
  }

  /* Which list is on screen — and, with the sidebar hidden, the way back. */
  function renderListHead() {
    clear(nodes.listHead);
    nodes.listHead.classList.toggle('is-hidden', !state.group);
    if (!state.group) return;
    icon(nodes.listHead, state.group === 'Inbox' ? 'inbox' : 'list', 'nd-list-head-icon');
    el(nodes.listHead, 'h2', 'nd-list-title', state.group);
    button(nodes.listHead, 'nd-list-clear', 'All reminders', () => pick('all', ''), 'x', 'Back to every reminder');
  }

  function renderEmpty() {
    const e = el(nodes.list, 'div', 'nd-empty nd-glass');
    if (state.query || state.tag) {
      icon(e, 'search', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', 'Nothing matches');
      el(e, 'div', 'nd-empty-sub', 'Try a different word, or clear the filters.');
      return;
    }
    if (state.group && state.filter === 'all') {
      icon(e, 'list', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', `Nothing in ${state.group} yet`);
      el(e, 'div', 'nd-empty-sub', 'Anything you add above goes into this list.');
      return;
    }
    if (!state.items.length) {
      icon(e, 'bell', 'nd-empty-icon');
      el(e, 'div', 'nd-empty-title', 'Nothing on the list yet');
      el(e, 'div', 'nd-empty-sub', 'Type what you must not forget in the box above — "Sign papers for mom tomorrow at 9am".');
      return;
    }
    icon(e, 'check', 'nd-empty-icon');
    el(e, 'div', 'nd-empty-title', state.filter === 'done' ? 'Nothing ticked off yet' : 'All clear here');
    el(e, 'div', 'nd-empty-sub', state.filter === 'done' ? 'Ticked reminders collect here.' : 'Nothing in this list needs you right now.');
  }

  function renderRow(parent, it) {
    const late = M.overdueDays(it, state.today);
    const row = el(parent, 'div', 'nd-row' + (it.done ? ' is-done' : '') + (late ? ' is-late' : ''));
    row.setAttribute('data-priority', it.priority || 'normal');

    const check = button(row, 'nd-check', '', () => tick(it, row), null, it.done ? 'Mark as not done' : 'Mark as done');
    check.setAttribute('aria-pressed', it.done ? 'true' : 'false');
    icon(check, 'check', 'nd-check-mark');

    const main = el(row, 'div', 'nd-row-main');
    const title = button(main, 'nd-row-title', it.title || '(untitled)', () => edit(it), null, 'Edit this reminder');
    if (it.done) title.classList.add('is-done');

    const meta = el(main, 'div', 'nd-row-meta');
    if (it.due) {
      const pill = el(meta, 'span', 'nd-pill nd-due' + (late ? ' is-late' : D.diffDays(state.today, it.due) === 0 ? ' is-today' : ''));
      icon(pill, late ? 'flag' : 'calendar');
      el(pill, 'span', null, D.relative(it.due, state.today));
      if (late > 0) el(pill, 'span', 'nd-late-n', late === 1 ? '1 day late' : `${late} days late`);
    }
    if (it.time) { const p = el(meta, 'span', 'nd-pill nd-time'); icon(p, 'clock'); el(p, 'span', null, it.time); }
    if (it.repeat) { const p = el(meta, 'span', 'nd-pill nd-repeat'); icon(p, 'repeat'); el(p, 'span', null, R.describe(it.repeat) || it.repeat); }
    if (it.group) el(meta, 'span', 'nd-pill nd-group', it.group);
    for (const t of it.tags || []) el(meta, 'span', 'nd-pill nd-tagpill', t);
    if (it.done && it.doneDate) el(meta, 'span', 'nd-pill nd-donepill', `Done ${D.relative(it.doneDate, state.today).toLowerCase()}`);

    const acts = el(row, 'div', 'nd-row-acts');
    if (!it.done) button(acts, 'nd-act', '', e => snoozeMenu(it, e), 'alarm-clock', 'Snooze');
    button(acts, 'nd-act', '', e => rowMenu(it, e), 'more-horizontal', 'More');
    return row;
  }

  /* ---- actions --------------------------------------------------------- */

  async function commitQuickAdd() {
    const raw = nodes.addInput.value.trim();
    if (!raw) return;
    const q = parseQuick(raw, state.today);
    if (!q.title) { new Notice('Nudge: give the reminder something to say.'); return; }
    await store.add({
      title: q.title, due: q.due, time: q.time, priority: q.priority,
      repeat: q.repeat, tags: q.tags, group: state.group || plugin.settings.defaultGroup || '',
    });
    nodes.addInput.value = '';
    renderHint();
    await reload();
    await maybeExport();
  }

  async function tick(it, row) {
    row.classList.add(it.done ? 'is-unticking' : 'is-ticking');
    const r = await store.toggle(it, D.todayISO());
    if (!r.ok) { new Notice(tickRefused(r)); await reload(); return; }
    if (r.rolled) new Notice(`Nudge: next one ${D.relative(r.rolled.due, state.today).toLowerCase()}.`);
    await reload();
    await maybeExport();
  }

  /* Why a tick didn't happen. A repeat we can't read is left open on
     purpose — ticking it would end the series without a word. */
  function tickRefused(r) {
    if (r && r.reason === 'repeat') return `Nudge: can't work out when "🔁 ${r.repeat}" comes round next, so it was left open. Edit the repeat, or tick it off in the note.`;
    return 'Nudge: that line is no longer in the note.';
  }

  function snoozeMenu(it, e) {
    const m = new Menu();
    for (const s of SNOOZE) {
      m.addItem(i => i.setTitle(s.label).setIcon('alarm-clock').onClick(async () => {
        await store.snooze(it, s.days, D.todayISO());
        await reload();
        await maybeExport();
      }));
    }
    m.addItem(i => i.setTitle('Pick a date…').setIcon('calendar-days').onClick(() => edit(it)));
    showMenu(m, e);
  }

  function rowMenu(it, e) {
    const m = new Menu();
    m.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => edit(it)));
    m.addItem(i => i.setTitle(it.done ? 'Mark as not done' : 'Mark as done').setIcon('check').onClick(async () => {
      const r = await store.toggle(it, D.todayISO());
      if (!r.ok) new Notice(tickRefused(r));
      await reload(); await maybeExport();
    }));
    m.addItem(i => i.setTitle('Open in the note').setIcon('pencil').onClick(() => openNote(it)));
    m.addItem(i => i.setTitle('Delete').setIcon('trash-2').onClick(async () => {
      const r = await store.remove(it);
      if (r.ok) new Notice(`Nudge: removed "${it.title}".`);
      await reload();
      await maybeExport();
    }));
    showMenu(m, e);
  }

  function showMenu(m, e) {
    if (e && e.clientX !== undefined && m.showAtMouseEvent) m.showAtMouseEvent(e);
    else if (m.showAtPosition) m.showAtPosition({ x: 0, y: 0 });
  }

  function edit(it) {
    openEditor(app, {
      item: it,
      groups: state.groups,
      today: state.today,
      onSave: async fields => { await store.update(it, fields); await reload(); await maybeExport(); },
      onDelete: async () => { await store.remove(it); await reload(); await maybeExport(); },
    });
  }

  function add(prefill) {
    openEditor(app, {
      item: Object.assign({ title: '', due: '', time: '', priority: 'normal', repeat: '', tags: [], group: state.group || plugin.settings.defaultGroup || '' }, prefill || {}),
      groups: state.groups,
      today: state.today,
      isNew: true,
      onSave: async fields => { await store.add(fields); await reload(); await maybeExport(); },
    });
  }

  async function openNote(it) {
    const f = app.vault.getFileByPath(store.path()) || await store.ensureFile();
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(app.vault.getFileByPath(store.path()) || f);
    if (it && leaf.view && leaf.view.editor) {
      try { leaf.view.editor.setCursor({ line: it.line, ch: 0 }); } catch (e) { /* not an editor view */ }
    }
  }

  async function exportICS() {
    const r = await store.exportICS();
    new Notice(`Nudge: ${r.count} reminder${r.count === 1 ? '' : 's'} written to ${r.path}. Open it on your phone to add them to your calendar.`);
  }

  async function maybeExport() {
    if (!plugin.settings.autoExport) return;
    try { await store.exportICS(); } catch (e) { console.error('nudge export', e); }
  }

  function focusAdd() { if (nodes.addInput) nodes.addInput.focus(); }
  function setFilter(key) { if (FOR_FILTER[key] || key === 'all') pick(key, ''); }

  /* ---- lifecycle ------------------------------------------------------- */

  const ctx = { reload, add, focusAdd, setFilter, exportICS, openNote, store, state };

  async function start() {
    build();
    measure();
    if (typeof ResizeObserver === 'function') { sizer = new ResizeObserver(() => measure()); sizer.observe(root); }
    await store.ensureFile();
    await reload();
    /* The date can change while the board is open; so can the greeting. */
    timer = setInterval(() => {
      const t = D.todayISO();
      if (t !== state.today) { state.today = t; renderAll(); }
      else renderHeader();
    }, 60000);
    if (view.registerInterval) view.registerInterval(timer);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (sizer) { sizer.disconnect(); sizer = null; }
    clear(root);
    root.classList.remove('nd-app', 'is-plain', 'is-light', 'is-narrow', 'has-side', 'is-drawer');
  }

  return { start, stop, refresh: reload, look: () => { applyLook(); applySide(); }, ctx };
}

module.exports = { mountBoard, greeting };
