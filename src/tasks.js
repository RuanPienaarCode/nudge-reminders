'use strict';
/* THE LINE IS THE STORAGE.

   Every reminder is one Obsidian Tasks checkbox line in a plain note, so the
   Tasks plugin, a grep, a phone and a human all read the same file:

     - [ ] Sign papers for mom's medical aid 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family

   Tasks' emoji vocabulary is used as-is. ⏰ is the one addition (Tasks has no
   clock time); to Tasks it is simply part of the description, which is why it
   is safe.

   Parsing is LOSSLESS by design: tokens this plugin never shows — 🛫 🆔 ⛔ —
   are still read, held, and written back out. A reminder edited here must
   never come back smaller than it went in. */

const PRIORITY_EMOJI = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
const EMOJI_FOR = { highest: '🔺', high: '⏫', medium: '🔼', normal: '', low: '🔽', lowest: '⏬' };
const RANK = { highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0 };
const PRIORITIES = ['highest', 'high', 'medium', 'normal', 'low', 'lowest'];

const rank = p => (RANK[p] === undefined ? RANK.normal : RANK[p]);

/* A checkbox line, open or done. [/] and [-] belong to other workflows and
   are deliberately not ours to move. */
const LINE_RE = /^(\s*)([-*+]|\d+\.)[ \t]+\[([ xX])\][ \t]*(.*)$/;
const HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t]*$/;
/* Only ## and below are groups. A single # is the note's title — people head
   their reminders note "# Reminders", and that is not a section. */
const GROUP_RE = /^#{2,6}[ \t]+(.+?)[ \t]*$/;
/* Splitting on the markers keeps them (capturing group), so a token's value
   is simply the text up to the next marker. */
const MARKER_RE = /(🔺|⏫|🔼|🔽|⏬|📅|📆|🗓️|🗓|⏰|✅|➕|🛫|⏳|⌛|🔁|🆔|⛔)/;
const MARKER_SPLIT = new RegExp(MARKER_RE.source, 'g');
const DATE_HEAD = /^(\d{4}-\d{2}-\d{2})\s*([\s\S]*)$/;
const TIME_HEAD = /^(\d{1,2}:\d{2})\s*([\s\S]*)$/;
const WORD_HEAD = /^(\S+)\s*([\s\S]*)$/;
/* No lookbehind anywhere: iOS 15 WebKit throws on the literal and takes the
   whole bundle with it. The leading boundary is captured instead. */
const TAG_RE = /(^|\s)(#[^\s#]+)/g;

const squash = s => String(s || '').replace(/\s+/g, ' ').trim();

/* Pull every #tag out of the line, wherever it sits, and hand back the text
   without them. They are re-emitted in one place on the way out. */
function extractTags(text) {
  const tags = [];
  const rest = String(text || '').replace(TAG_RE, (all, pre, tag) => {
    tags.push(tag);
    return pre;
  });
  return { tags, rest };
}

function parseLine(raw) {
  const m = LINE_RE.exec(String(raw === undefined || raw === null ? '' : raw));
  if (!m) return null;
  const [, indent, marker, box, rest] = m;

  const { tags, rest: untagged } = extractTags(rest);
  const parts = untagged.split(MARKER_SPLIT);

  const t = {
    raw: String(raw), indent, marker,
    done: box.toLowerCase() === 'x',
    title: '', tags,
    due: '', time: '', priority: 'normal', repeat: '',
    start: '', scheduled: '', created: '', doneDate: '', id: '', blockedBy: '',
    group: '', line: -1,
  };

  /* Anything a token's value does not account for goes back onto the title
     rather than being dropped on the floor. */
  let title = parts[0] || '';
  const take = (val, re) => {
    const g = re.exec(String(val || '').trim());
    if (!g) { title += ' ' + val; return ''; }
    if (g[2]) title += ' ' + g[2];
    return g[1];
  };

  for (let i = 1; i < parts.length; i += 2) {
    const mark = parts[i], val = parts[i + 1] === undefined ? '' : parts[i + 1];
    if (PRIORITY_EMOJI[mark]) { t.priority = PRIORITY_EMOJI[mark]; title += ' ' + val; continue; }
    switch (mark) {
      case '📅': case '📆': case '🗓': case '🗓️': t.due = take(val, DATE_HEAD); break;
      case '⏰': t.time = take(val, TIME_HEAD); break;
      case '✅': t.doneDate = take(val, DATE_HEAD); break;
      case '➕': t.created = take(val, DATE_HEAD); break;
      case '🛫': t.start = take(val, DATE_HEAD); break;
      case '⏳': case '⌛': t.scheduled = take(val, DATE_HEAD); break;
      case '🆔': t.id = take(val, WORD_HEAD); break;
      case '⛔': t.blockedBy = take(val, WORD_HEAD); break;
      case '🔁': t.repeat = squash(val); break;
      default: title += ' ' + val;
    }
  }
  t.title = squash(title);
  if (t.time && /^\d:/.test(t.time)) t.time = '0' + t.time;
  return t;
}

/* The canonical spelling. Order is fixed so that two saves of the same
   reminder produce byte-identical lines — a moving target here would show up
   as spurious diffs in the user's vault history. */
function serializeLine(t) {
  const indent = t.indent || '';
  const marker = t.marker || '-';
  const box = t.done ? 'x' : ' ';
  const bits = [`${indent}${marker} [${box}]`];
  const title = squash(t.title);
  if (title) bits.push(title);
  for (const tag of t.tags || []) bits.push(tag);
  if (t.due) bits.push('📅 ' + t.due);
  if (t.time) bits.push('⏰ ' + t.time);
  const pe = EMOJI_FOR[t.priority || 'normal'];
  if (pe) bits.push(pe);
  if (t.repeat) bits.push('🔁 ' + t.repeat);
  if (t.start) bits.push('🛫 ' + t.start);
  if (t.scheduled) bits.push('⏳ ' + t.scheduled);
  if (t.created) bits.push('➕ ' + t.created);
  if (t.id) bits.push('🆔 ' + t.id);
  if (t.blockedBy) bits.push('⛔ ' + t.blockedBy);
  if (t.done && t.doneDate) bits.push('✅ ' + t.doneDate);
  return bits.join(' ');
}

/* Read a whole note. Headings become groups — the user's own structure, not
   a taxonomy this plugin imposes. */
function parseNote(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      const g = GROUP_RE.exec(lines[i]);
      group = g ? g[1].trim() : '';
      continue;
    }
    const t = parseLine(lines[i]);
    if (!t) continue;
    t.line = i;
    t.group = group;
    out.push(t);
  }
  return out;
}

/* Only headings that actually hold reminders, in the order they appear. */
function groupsOf(text) {
  const seen = [];
  for (const t of parseNote(text)) if (t.group && seen.indexOf(t.group) === -1) seen.push(t.group);
  return seen;
}

/* Every section heading (## and below), holding reminders or not — the lists
   the sidebar offers, so a list made a moment ago shows before it has rows. */
function listsOf(text) {
  const seen = [];
  for (const l of String(text || '').split('\n')) {
    const g = GROUP_RE.exec(l);
    if (g && seen.indexOf(g[1].trim()) === -1) seen.push(g[1].trim());
  }
  return seen;
}

module.exports = {
  parseLine, serializeLine, parseNote, groupsOf, listsOf, extractTags,
  rank, PRIORITIES, PRIORITY_EMOJI, EMOJI_FOR, LINE_RE, HEADING_RE, GROUP_RE,
};
