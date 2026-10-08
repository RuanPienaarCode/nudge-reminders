'use strict';
/* ============================================================================
   NUDGE — Obsidian plugin (entry point)

   The things you must not forget, kept as plain checkbox lines in one note.
   Vault API only — desktop and iOS/Android. Source lives in src/ as CommonJS
   modules; esbuild bundles them into main.js (target safari15 — the real
   engine floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin, Notice } = require('obsidian');
const { VIEW_TYPE, PROTOCOL, DEFAULT_SETTINGS } = require('./constants');
const { NudgeView } = require('./view');
const { NudgeSettingTab } = require('./settings-tab');
const { makeStore } = require('./store');
const { openEditor } = require('./modals');
const M = require('./model');
const N = require('./notify');
const D = require('./dates');

class NudgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;
    /* Said once is said — but only for this run. A restart is a good enough
       reason to be told again about something still overdue. */
    this._fired = new Set();
    this.store = this.seam(makeStore(this));

    this.registerView(VIEW_TYPE, leaf => new NudgeView(leaf, this));
    /* Obsidian prefixes a command with the plugin's name, so neither the
       command nor the tooltip repeats it. */
    this.ribbonEl = this.addRibbonIcon('bell', 'Open reminders board', () => this.activateView());
    /* The count badge is absolutely positioned against this node. */
    if (this.ribbonEl && this.ribbonEl.classList) this.ribbonEl.classList.add('nd-ribbon');

    this.addCommand({ id: 'open', name: 'Open reminders board', callback: () => this.activateView() });
    this.addCommand({
      id: 'add', name: 'Add a reminder',
      callback: async () => {
        await this.activateView();
        const done = this.forEachView(ctl => ctl.ctx.focusAdd());
        if (!done) this.addStandalone();
      },
    });
    this.addCommand({
      id: 'add-dialog', name: 'Add a reminder (full editor)',
      callback: () => this.addStandalone(),
    });
    this.addCommand({
      id: 'open-note', name: 'Open the reminders note',
      callback: async () => {
        const f = await this.store.ensureFile();
        await this.app.workspace.getLeaf('tab').openFile(this.app.vault.getFileByPath(this.store.path()) || f);
      },
    });
    this.addCommand({
      id: 'export-ics', name: 'Export reminders to a calendar file',
      callback: async () => {
        const r = await this.exportICS();
        new Notice(`Nudge: ${r.count} reminder${r.count === 1 ? '' : 's'} written to ${r.path}. Open it on your phone to add them to your calendar.`);
      },
    });
    this.addCommand({
      id: 'lift-times', name: 'Fix timed reminders for the Tasks plugin',
      callback: async () => {
        const { changed } = await this.store.liftTimes();
        if (!changed) { new Notice('Nudge: every timed reminder already reads right in Tasks.'); return; }
        new Notice(`Nudge: moved the time on ${changed} reminder${changed === 1 ? '' : 's'} so Tasks can see ${changed === 1 ? 'its' : 'their'} dates.`);
      },
    });
    this.addCommand({
      id: 'copy-deep-link', name: 'Copy the deep link (for a Shortcuts automation)',
      callback: async () => {
        const link = `obsidian://${PROTOCOL}`;
        try { await navigator.clipboard.writeText(link); new Notice('Nudge: link copied.'); }
        catch (e) { new Notice(`Nudge: ${link}`); }
      },
    });

    this.addSettingTab(new NudgeSettingTab(this.app, this));

    this.registerObsidianProtocolHandler(PROTOCOL, async params => {
      await this.activateView();
      if (params && params.filter) this.forEachView(ctl => ctl.ctx.setFilter(params.filter));
      if (params && params.add) this.forEachView(ctl => ctl.ctx.focusAdd());
    });

    /* Someone edited the note by hand — including on another device, via
       sync. Our own write is recognised by its CONTENT, not by a time window:
       an edit that arrives by sync a moment after we saved must still show. */
    this.registerEvent(this.app.vault.on('modify', async file => {
      if (!file || file.path !== this.store.path()) return;
      if (this._lastText !== undefined) {
        try { if (await this.app.vault.cachedRead(file) === this._lastText) return; }
        catch (e) { /* unreadable for a moment: refresh anyway */ }
      }
      this.refreshViews();
      this.updateBadge();
    }));

    /* Obsidian switched light/dark (or the theme changed). */
    this.registerEvent(this.app.workspace.on('css-change', () => this.forEachView(ctl => ctl.look && ctl.look())));

    this.app.workspace.onLayoutReady(() => {
      this.updateBadge();
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
    });

    /* One timer for the whole plugin. */
    this.registerInterval(window.setInterval(() => this.tick(), 60000));
    this._startTimer = window.setTimeout(() => { this._startTimer = null; this.tick(); }, 4000);
  }

  onunload() {
    if (this._startTimer !== null && this._startTimer !== undefined) window.clearTimeout(this._startTimer);
    this._startTimer = null;
  }

  /* plugin.store is the seam other plugins (Vista, Fortnight) write through,
     and the commands here use it too. The store records every write's text
     as ours, so the modify handler above cannot tell it from the board's own
     — which means a write made here never refreshed an open board or the
     ribbon badge. So a write that landed refreshes both, here, once. The
     board's own store is a separate instance and refreshes itself. */
  seam(store) {
    const writes = ['add', 'addList', 'toggle', 'update', 'snooze', 'setDue', 'setDate', 'remove', 'liftTimes'];
    const wrapped = Object.assign({}, store);
    for (const name of writes) {
      const inner = store[name];
      wrapped[name] = async (...args) => {
        const r = await inner(...args);
        /* { ok: false } and { changed: 0 } wrote nothing. */
        const wrote = !(r && (r.ok === false || r.changed === 0));
        if (wrote) { this.refreshViews(); this.updateBadge(); }
        return r;
      };
    }
    return wrapped;
  }

  async tick() {
    let items = [];
    try { items = (await this.store.load()).items; } catch (e) { return; }
    this.paintBadge(M.board(items, D.todayISO()).counts);
    if (!this.settings.notify) return;
    const today = D.todayISO();
    const due = N.pending(items, {
      today, now: D.nowHM(), fired: this._fired,
      leadMinutes: this.settings.alarmMinutes, allDayAlarmTime: this.settings.allDayAlarmTime,
    });
    if (!due.length) return;
    for (const i of due) this._fired.add(N.keyFor(i, today));
    new Notice(`Nudge — ${N.message(due)}`, 12000);
  }

  async updateBadge() {
    try {
      const items = (await this.store.load()).items;
      this.paintBadge(M.board(items, D.todayISO()).counts);
    } catch (e) { /* the note may not exist yet */ }
  }

  paintBadge(counts) {
    if (!this.ribbonEl) return;
    const old = this.ribbonEl.querySelector('.nd-badge');
    if (old) old.remove();
    const n = counts ? counts.due : 0;
    if (!n || !this.settings.ribbonBadge) return;
    const b = document.createElement('span');
    b.className = 'nd-badge' + (counts.overdue ? ' is-late' : '');
    b.textContent = n > 99 ? '99+' : String(n);
    this.ribbonEl.appendChild(b);
  }

  addStandalone() {
    openEditor(this.app, {
      item: { title: '', due: D.todayISO(), time: '', priority: 'normal', repeat: '', tags: [], group: this.settings.defaultGroup || '' },
      groups: [],
      today: D.todayISO(),
      isNew: true,
      onSave: async fields => {
        await this.store.add(fields);
        new Notice(`Nudge: "${fields.title}" added.`);
        if (this.settings.autoExport) await this.exportICS();
      },
    });
  }

  async exportICS() {
    const r = await this.store.exportICS();
    return r;
  }

  forEachView(fn) {
    let any = false;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v && v.appCtl) { fn(v.appCtl); any = true; }
    }
    return any;
  }

  refreshViews() { this.forEachView(ctl => ctl.refresh()); }

  async activateView() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { ws.revealLeaf(existing[0]); return; }
    const leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
}

module.exports = NudgePlugin;
