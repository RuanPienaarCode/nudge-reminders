'use strict';
/* Vault IO. Every read and write of the reminders note goes through here.

   THE NOTE BELONGS TO THE USER. Two rules follow from that, and both are
   pinned by tests:

   1. Line surgery, never a rebuild. We edit the one line we mean to edit and
      leave every other byte — prose, headings, other plugins' tasks, blank
      lines — exactly where it was.
   2. Ticking, snoozing and rolling a repeat REWRITE THE RAW LINE rather than
      re-serialising it, so the user's own spacing and token order survive
      being touched by this plugin. Only an explicit edit re-spells a line.

   Vault API only: this runs on iOS as well as the desktop. */

const { normalizePath } = require('obsidian');
const T = require('./tasks');
const D = require('./dates');
const R = require('./recur');
const { buildICS, countEvents } = require('./ics');

const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Where an ungrouped reminder goes once the note has sections of its own. */
const INBOX = 'Inbox';
const DATE = '\\d{4}-\\d{2}-\\d{2}';

/* ---- raw-line surgery ------------------------------------------------ */

function flipBox(raw, done) {
  return String(raw).replace(/^(\s*(?:[-*+]|\d+\.)[ \t]+\[)[ xX](\])/, `$1${done ? 'x' : ' '}$2`);
}

function dropToken(raw, emoji) {
  return String(raw).replace(new RegExp(`\\s*${reEsc(emoji)}\\s*${DATE}`, 'g'), '').replace(/[ \t]+$/, '');
}

function setDateToken(raw, emoji, value) {
  const re = new RegExp(`(${reEsc(emoji)}\\s*)${DATE}`);
  if (re.test(raw)) return String(raw).replace(re, `$1${value}`);
  return `${String(raw).replace(/[ \t]+$/, '')} ${emoji} ${value}`;
}

/* ---- the store -------------------------------------------------------- */

function makeStore(plugin) {
  const app = plugin.app;
  const v = app.vault;

  const path = () => normalizePath(plugin.settings.file || 'Reminders.md');
  const icsPath = () => normalizePath(plugin.settings.icsFile || 'Reminders.ics');
  const stamp = () => { plugin._lastWrite = Date.now(); };
  const file = () => v.getFileByPath(path());

  async function readText() {
    const f = file();
    if (!f) return { file: null, text: '' };
    return { file: f, text: await v.read(f) };
  }

  async function writeText(text) {
    stamp();
    const f = file();
    if (f) { await v.modify(f, text); return f; }
    await ensureFolder(path());
    return v.create(path(), text);
  }

  async function ensureFolder(p) {
    const slash = String(p).lastIndexOf('/');
    if (slash <= 0) return;
    const dir = p.slice(0, slash);
    if (v.getFolderByPath(dir)) return;
    try { stamp(); await v.createFolder(dir); }
    catch (e) { if (!v.getFolderByPath(dir)) throw e; }
  }

  async function ensureFile() {
    if (file()) return file();
    return writeText(`# ${plugin.settings.title || 'Reminders'}\n\nThe things I must not forget.\n\n`);
  }

  async function load() {
    const { text } = await readText();
    const items = T.parseNote(text);
    return { text, items, groups: T.groupsOf(text), lists: T.listsOf(text) };
  }

  /* Find the line again by content when its number no longer matches — the
     user may have typed above it since we rendered. */
  function locate(lines, item) {
    if (!item) return -1;
    if (lines[item.line] === item.raw) return item.line;
    const i = lines.indexOf(item.raw);
    if (i !== -1) return i;
    /* Last resort: the same reminder with a different tail (someone edited
       the date in the note while the board was open). */
    const t = T.parseLine(item.raw);
    if (!t) return -1;
    for (let n = 0; n < lines.length; n++) {
      const c = T.parseLine(lines[n]);
      if (c && c.title === t.title && c.group === undefined) return n;
    }
    return -1;
  }

  async function withLines(item, fn) {
    const { text } = await readText();
    if (!text) return { ok: false };
    const lines = text.split('\n');
    const i = locate(lines, item);
    if (i === -1) return { ok: false };
    const res = fn(lines, i) || {};
    await writeText(lines.join('\n'));
    return Object.assign({ ok: true }, res);
  }

  /* ---- add ------------------------------------------------------------ */

  async function add(fields) {
    const item = Object.assign({ priority: 'normal', tags: [] }, fields);
    const line = T.serializeLine(item);
    await ensureFile();
    const { text } = await readText();
    const lines = text.split('\n');
    /* A reminder with no group of its own must not fall under whatever
       heading happens to be last in the note — it would silently join that
       section and come back wearing its name. Once the note uses sections at
       all, an ungrouped reminder gets an Inbox of its own; a flat note stays
       flat, because no ceremony is owed to a list that has none. */
    let group = String(fields.group || '').trim();
    if (!group && T.groupsOf(text).length) group = INBOX;

    if (group) {
      const at = lines.findIndex(l => {
        const h = T.HEADING_RE.exec(l);
        return !!h && h[1].trim() === group;
      });
      if (at !== -1) {
        /* Under this heading, after its last real line — not into the next
           section, and not on top of the blank line that separates them. */
        let end = at + 1;
        let last = at;
        while (end < lines.length && !T.HEADING_RE.test(lines[end])) {
          if (lines[end].trim()) last = end;
          end++;
        }
        lines.splice(last + 1, 0, line);
        await writeText(lines.join('\n'));
        return line;
      }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('', `## ${group}`, line, '');
      await writeText(lines.join('\n'));
      return line;
    }

    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(line, '');
    await writeText(lines.join('\n'));
    return line;
  }

  /* A new list is a new ## heading at the foot of the note. Nothing else is
     touched; a name already there is not added twice. */
  async function addList(name) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
    if (!n) return { ok: false, name: '' };
    await ensureFile();
    const { text } = await readText();
    if (T.listsOf(text).indexOf(n) !== -1) return { ok: true, name: n, existed: true };
    const lines = text.split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', `## ${n}`, '');
    await writeText(lines.join('\n'));
    return { ok: true, name: n, existed: false };
  }

  /* ---- tick ------------------------------------------------------------ */

  /* Ticking a repeating reminder leaves the next one behind, in the place the
     old one held, and keeps the tick itself as a record. */
  async function toggle(item, today) {
    const day = D.isISO(today) ? today : D.todayISO();
    let rolled = null;
    const res = await withLines(item, (lines, i) => {
      const raw = lines[i];
      const cur = T.parseLine(raw);
      const wasDone = cur ? cur.done : item.done;
      if (wasDone) {
        lines[i] = dropToken(flipBox(raw, false), '✅');
        return {};
      }
      const next = cur && cur.repeat ? R.nextDue(cur.repeat, cur.due, day, day) : '';
      lines[i] = setDateToken(dropToken(flipBox(raw, true), '✅'), '✅', day);
      if (next) {
        const fresh = setDateToken(dropToken(raw, '✅'), '📅', next);
        lines.splice(i, 0, fresh);
        rolled = T.parseLine(fresh);
      }
      return {};
    });
    return { ok: res.ok, rolled: res.ok ? rolled : null };
  }

  /* ---- edit ------------------------------------------------------------ */

  async function update(item, fields) {
    return withLines(item, (lines, i) => {
      const cur = T.parseLine(lines[i]) || item;
      lines[i] = T.serializeLine(Object.assign({}, cur, fields));
    });
  }

  /* Snoozing counts from TODAY, not from a due date that has already passed:
     "tomorrow" must mean tomorrow, whatever this thing's history. */
  async function snooze(item, days, today) {
    const day = D.isISO(today) ? today : D.todayISO();
    const due = D.addDays(day, days);
    return withLines(item, (lines, i) => {
      lines[i] = setDateToken(lines[i], '📅', due);
    });
  }

  async function setDue(item, due) {
    return withLines(item, (lines, i) => {
      lines[i] = due ? setDateToken(lines[i], '📅', due) : dropToken(lines[i], '📅');
    });
  }

  async function remove(item) {
    return withLines(item, (lines, i) => { lines.splice(i, 1); });
  }

  /* ---- the calendar file ----------------------------------------------- */

  async function exportICS(now) {
    const { items } = await load();
    const text = buildICS(items, {
      name: plugin.settings.calendarName || 'Nudge',
      alarmMinutes: plugin.settings.alarmMinutes,
      allDayAlarmTime: plugin.settings.allDayAlarmTime,
      now,
    });
    const p = icsPath();
    await ensureFolder(p);
    stamp();
    await v.adapter.write(p, text);
    return { path: p, count: countEvents(items) };
  }

  const isOurs = p => typeof p === 'string' && (p === path() || p === icsPath());

  return { path, icsPath, load, ensureFile, add, addList, toggle, update, snooze, setDue, remove, exportICS, isOurs };
}

module.exports = { makeStore, flipBox, dropToken, setDateToken };
