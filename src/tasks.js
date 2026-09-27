'use strict';
/* THE LINE IS THE STORAGE.

   Every reminder is one Obsidian Tasks checkbox line in a plain note, so the
   Tasks plugin, a grep, a phone and a human all read the same file:

     - [ ] Sign papers for mom's medical aid ⏰ 09:00 #family 📅 2026-09-20 ⏫ 🔁 every month

   Tasks' emoji vocabulary is used as-is. ⏰ is the one addition (Tasks has no
   clock time); to Tasks it is simply part of the description — but ONLY while
   it sits before the fields. Tasks reads fields from the end of the line and
   stops at the first non-field, so ⏰ must never land in that trailing run.
   Old-order lines (📅 … ⏰ …) still parse — the parser is order-agnostic —
   and the next save rewrites them into this order.

   Parsing is LOSSLESS by design: tokens this plugin never shows — 🛫 🆔 ⛔ —
   are still read, held, and written back out. A reminder edited here must
   never come back smaller than it went in. That includes the things that
   only LOOK like fields: a marker whose value doesn't parse (📅 tomorrow)
   stays in the title marker and all, and `code spans` and [[wikilinks]] are
   masked before any marker is looked for, so a 📅 quoted inside one is text.
   A trailing ^block-id is held apart and always written last, because
   Obsidian only resolves it at the very end of the line. */

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
const MARKER_RE = /((?:🔺|⏫|🔼|🔽|⏬|📅|📆|🗓|⏰|✅|➕|🛫|⏳|⌛|🔁|🆔|⛔)\uFE0F?)/;
const MARKER_SPLIT = new RegExp(MARKER_RE.source, 'g');
const DATE_HEAD = /^(\d{4}-\d{2}-\d{2})\s*([\s\S]*)$/;
const TIME_HEAD = /^(\d{1,2}:\d{2})\s*([\s\S]*)$/;
const WORD_HEAD = /^(\S+)\s*([\s\S]*)$/;
/* No lookbehind anywhere: iOS 15 WebKit throws on the literal and takes the
   whole bundle with it. The leading boundary is captured instead. */
/* Obsidian does not count an all-digit #12 as a tag ("issue #12"), so a tag
   needs at least one character that isn't a digit. */
const TAG_RE = /(^|\s)(#[^\s#]*[^\s#\d][^\s#]*)/g;
/* A block id Obsidian can link to: " ^abc-1" at the very end of the line. */
const BLOCK_RE = /(\s+)(\^[A-Za-z0-9-]+)[ \t]*$/;

/* Code spans and wikilinks are quoted text: swap each for a placeholder of
   private-use characters before looking for markers or tags, and put them
   back afterwards. The placeholder holds no marker, no #, no space. */
const SPAN_RE = /`[^`\n]*`|\[\[[^\]\n]*\]\]/g;
const HOLE_RE = /\uE000(\d+)\uE001/g;
function maskSpans(text) {
  const spans = [];
  const masked = String(text || '').replace(SPAN_RE, m => { spans.push(m); return `\uE000${spans.length - 1}\uE001`; });
  const restore = s => String(s || '').replace(HOLE_RE, (all, n) => (spans[+n] === undefined ? all : spans[+n]));
  return { masked, restore };
}

/* Split a line into [everything, trailing block id]. The id comes back with
   its leading space so re-joining is byte-true. */
function splitBlock(line) {
  const s = String(line || '');
  const b = BLOCK_RE.exec(s);
  return b ? [s.slice(0, b.index), s.slice(b.index)] : [s, ''];
}

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
  const src = String(raw === undefined || raw === null ? '' : raw).replace(/\r$/, '');
  const m = LINE_RE.exec(src);
  if (!m) return null;
  const [, indent, marker, box, rest] = m;

  const { masked, restore } = maskSpans(rest);
  const b = BLOCK_RE.exec(masked);
  const body = b ? masked.slice(0, b.index) : masked;
  const { tags, rest: untagged } = extractTags(body);
  const parts = untagged.split(MARKER_SPLIT);

  const t = {
    raw: String(raw), indent, marker,
    done: box.toLowerCase() === 'x',
    title: '', tags: tags.map(restore),
    due: '', time: '', priority: 'normal', repeat: '',
    start: '', scheduled: '', created: '', doneDate: '', id: '', blockedBy: '',
    blockId: b ? b[2] : '',
    group: '', line: -1,
  };

  /* Anything a token's value does not account for goes back onto the title
     rather than being dropped on the floor — and a marker whose value does
     not parse at all goes back WITH its marker, or the next save would
     quietly delete the emoji. */
  let title = parts[0] || '';
  const take = (mark, val, re) => {
    const g = re.exec(String(val || '').trim());
    if (!g) { title += ' ' + mark + val; return ''; }
    if (g[2]) title += ' ' + g[2];
    return g[1];
  };

  for (let i = 1; i < parts.length; i += 2) {
    const mark = parts[i], val = parts[i + 1] === undefined ? '' : parts[i + 1];
    const key = mark.replace(/\uFE0F/g, '');
    if (PRIORITY_EMOJI[key]) { t.priority = PRIORITY_EMOJI[key]; title += ' ' + val; continue; }
    switch (key) {
      case '📅': case '📆': case '🗓': t.due = take(mark, val, DATE_HEAD) || t.due; break;
      case '⏰': t.time = take(mark, val, TIME_HEAD) || t.time; break;
      case '✅': t.doneDate = take(mark, val, DATE_HEAD) || t.doneDate; break;
      case '➕': t.created = take(mark, val, DATE_HEAD) || t.created; break;
      case '🛫': t.start = take(mark, val, DATE_HEAD) || t.start; break;
      case '⏳': case '⌛': t.scheduled = take(mark, val, DATE_HEAD) || t.scheduled; break;
      case '🆔': t.id = take(mark, val, WORD_HEAD) || t.id; break;
      case '⛔': t.blockedBy = take(mark, val, WORD_HEAD) || t.blockedBy; break;
      case '🔁': t.repeat = restore(squash(val)); break;
      default: title += ' ' + mark + val;
    }
  }
  t.title = restore(squash(title));
  t.id = restore(t.id);
  t.blockedBy = restore(t.blockedBy);
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
  /* ⏰ goes BEFORE everything Tasks reads. Tasks peels fields off the END of
     the line and stops at the first thing that isn't one — a ⏰ after 📅
     hides the due date (and every field before it) from Tasks. */
  if (t.time) bits.push('⏰ ' + t.time);
  for (const tag of t.tags || []) bits.push(tag);
  if (t.due) bits.push('📅 ' + t.due);
  const pe = EMOJI_FOR[t.priority || 'normal'];
  if (pe) bits.push(pe);
  if (t.repeat) bits.push('🔁 ' + t.repeat);
  if (t.start) bits.push('🛫 ' + t.start);
  if (t.scheduled) bits.push('⏳ ' + t.scheduled);
  if (t.created) bits.push('➕ ' + t.created);
  if (t.id) bits.push('🆔 ' + t.id);
  if (t.blockedBy) bits.push('⛔ ' + t.blockedBy);
  if (t.done && t.doneDate) bits.push('✅ ' + t.doneDate);
  if (t.blockId) bits.push(t.blockId);
  return bits.join(' ');
}

/* Obsidian Tasks reads a line from the END: it peels fields and tags off the
   tail until it meets something that is neither, and everything before that
   is description. This is that walk, cut down to the fields we know. Takes a
   masked body with no block id; returns where the trailing run begins (the
   body's length when there is no run). */
const TRAILING = [
  /\s*(?:🔺|⏫|🔼|🔽|⏬)\uFE0F?$/,
  /(?:📅|📆|🗓|✅|➕|🛫|⏳|⌛)\uFE0F? *\d{4}-\d{2}-\d{2}$/,
  /🔁\uFE0F? *[a-zA-Z0-9, !]+$/,
  /🆔\uFE0F? *[a-zA-Z0-9_-]+$/,
  /⛔\uFE0F? *[a-zA-Z0-9_-]+(?: *, *[a-zA-Z0-9_-]+ *)*$/,
  /(^|\s)#[^\s#]+$/,
];
function trailingRunStart(body) {
  let s = String(body || '').replace(/\s+$/, '');
  for (let moved = true; moved;) {
    moved = false;
    for (const re of TRAILING) {
      const m = re.exec(s);
      if (!m) continue;
      s = s.slice(0, m.index).replace(/\s+$/, '');
      moved = true;
      break;
    }
  }
  let at = s.length;
  while (at < body.length && /\s/.test(body[at])) at++;
  return at;
}

/* Read a whole note. Headings become groups — the user's own structure, not
   a taxonomy this plugin imposes. */
function parseNote(text) {
  const lines = String(text || '').split(/\r?\n/);
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
  for (const l of String(text || '').split(/\r?\n/)) {
    const g = GROUP_RE.exec(l);
    if (g && seen.indexOf(g[1].trim()) === -1) seen.push(g[1].trim());
  }
  return seen;
}

module.exports = {
  parseLine, serializeLine, parseNote, groupsOf, listsOf, extractTags,
  maskSpans, splitBlock, trailingRunStart,
  rank, PRIORITIES, PRIORITY_EMOJI, EMOJI_FOR, LINE_RE, HEADING_RE, GROUP_RE,
};
