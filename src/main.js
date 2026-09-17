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
    this.store = makeStore(this);

    this.registerView(VIEW_TYPE, leaf => new NudgeView(leaf, this));
    this.ribbonEl = this.addRibbonIcon('bell', 'Open Nudge', () => this.activateView());

    this.addCommand({ id: 'open', name: 'Open Nudge', callback: () => this.activateView() });
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
       sync. Our own writes are stamped so they don't bounce back. */
    this.registerEvent(this.app.vault.on('modify', file => {
      if (!file || !this.store.isOurs(file.path)) return;
      if (Date.now() - this._lastWrite < 1200) return;
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
    window.setTimeout(() => this.tick(), 4000);
  }

  onunload() {}

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
        this.refreshViews();
        this.updateBadge();
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
