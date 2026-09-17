'use strict';
/* The line format IS the storage. Every reminder is one Obsidian Tasks
   checkbox line, so the Tasks plugin, a grep and a human all read the same
   file. Parsing must be lossless: anything we don't understand round-trips
   untouched rather than being deleted. */
const assert = require('node:assert');
const T = require('../src/tasks');

/* ---- parse ---------------------------------------------------------- */
const a = T.parseLine("- [ ] Sign papers for mom's medical aid 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family");
assert.ok(a);
assert.strictEqual(a.title, "Sign papers for mom's medical aid");
assert.strictEqual(a.due, '2026-09-20');
assert.strictEqual(a.time, '09:00');
assert.strictEqual(a.priority, 'high');
assert.strictEqual(a.repeat, 'every month');
assert.deepStrictEqual(a.tags, ['#family']);
assert.strictEqual(a.done, false);

const b = T.parseLine('  * [x] Renew licence disc 📅 2026-09-01 ✅ 2026-09-02');
assert.strictEqual(b.indent, '  ');
assert.strictEqual(b.marker, '*');
assert.strictEqual(b.done, true);
assert.strictEqual(b.doneDate, '2026-09-02');
assert.strictEqual(b.priority, 'normal');

assert.strictEqual(T.parseLine('Just a paragraph'), null);
assert.strictEqual(T.parseLine('## A heading'), null);
assert.strictEqual(T.parseLine('- a plain bullet'), null);
assert.strictEqual(T.parseLine('- [/] In progress'), null, 'only open and done lines are reminders');
assert.strictEqual(T.parseLine('1. [ ] Numbered').marker, '1.');

/* Priorities, all five of them plus the unmarked middle. */
for (const [emoji, name] of [['🔺', 'highest'], ['⏫', 'high'], ['🔼', 'medium'], ['🔽', 'low'], ['⏬', 'lowest']]) {
  assert.strictEqual(T.parseLine(`- [ ] X ${emoji}`).priority, name, emoji);
}
assert.ok(T.rank('highest') > T.rank('high'));
assert.ok(T.rank('high') > T.rank('normal'));
assert.ok(T.rank('normal') > T.rank('low'));
assert.ok(T.rank('low') > T.rank('lowest'));

/* Tokens we don't drive the UI from are still parsed, so they survive a save. */
const c = T.parseLine('- [ ] Pay rates ➕ 2026-09-01 🛫 2026-09-05 ⏳ 2026-09-10 📅 2026-09-13 🆔 abc123');
assert.strictEqual(c.title, 'Pay rates');
assert.strictEqual(c.created, '2026-09-01');
assert.strictEqual(c.start, '2026-09-05');
assert.strictEqual(c.scheduled, '2026-09-10');
assert.strictEqual(c.id, 'abc123');

/* A due date with no space before the emoji, and a trailing link. */
const d = T.parseLine('- [ ] Read [[Some Note]] 📅 2026-09-20');
assert.strictEqual(d.title, 'Read [[Some Note]]');
assert.strictEqual(d.due, '2026-09-20');

/* ---- serialize ------------------------------------------------------ */
assert.strictEqual(
  T.serializeLine({ title: 'Buy milk', due: '2026-09-20', priority: 'normal' }),
  '- [ ] Buy milk 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Buy milk', done: true, doneDate: '2026-09-21', due: '2026-09-20' }),
  '- [x] Buy milk 📅 2026-09-20 ✅ 2026-09-21');
assert.strictEqual(
  T.serializeLine({ title: 'Walk', priority: 'lowest' }),
  '- [ ] Walk ⏬');
assert.strictEqual(
  T.serializeLine({ indent: '  ', marker: '*', title: 'Nested', due: '2026-09-20' }),
  '  * [ ] Nested 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Tagged', tags: ['#family', '#health'], due: '2026-09-20' }),
  '- [ ] Tagged #family #health 📅 2026-09-20');
assert.strictEqual(
  T.serializeLine({ title: 'Timed', due: '2026-09-20', time: '09:00' }),
  '- [ ] Timed 📅 2026-09-20 ⏰ 09:00');

/* ---- round trip ----------------------------------------------------- */
const LINES = [
  "- [ ] Sign papers for mom's medical aid 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family",
  '  * [x] Renew licence disc 📅 2026-09-01 ✅ 2026-09-02',
  '- [ ] Pay rates ➕ 2026-09-01 🛫 2026-09-05 ⏳ 2026-09-10 📅 2026-09-13 🆔 abc123',
  '- [ ] Bare',
  '- [ ] Read [[Some Note]] 📅 2026-09-20 🔽',
];
for (const raw of LINES) {
  const once = T.serializeLine(T.parseLine(raw));
  const twice = T.serializeLine(T.parseLine(once));
  assert.strictEqual(twice, once, `serialize is idempotent for: ${raw}`);
  const re = T.parseLine(once);
  const orig = T.parseLine(raw);
  for (const k of ['title', 'due', 'time', 'priority', 'repeat', 'created', 'start', 'scheduled', 'doneDate', 'id', 'done']) {
    assert.deepStrictEqual(re[k], orig[k], `${k} survives a round trip of: ${raw}`);
  }
  assert.deepStrictEqual(re.tags, orig.tags, `tags survive: ${raw}`);
}

/* ---- reading a whole note ------------------------------------------ */
const NOTE = [
  '# Reminders',
  '',
  'Anything above a heading is left alone.',
  '',
  '## Family',
  "- [ ] Sign papers for mom's medical aid 📅 2026-09-20 ⏫",
  '- [x] Fetch the prescription 📅 2026-09-10 ✅ 2026-09-10',
  '',
  '## Admin',
  '- [ ] Renew the licence disc 📅 2026-10-01',
  'not a task',
].join('\n');
const items = T.parseNote(NOTE);
assert.strictEqual(items.length, 3);
assert.strictEqual(items[0].group, 'Family');
assert.strictEqual(items[0].line, 5, 'the zero-based line number it came from');
assert.strictEqual(items[2].group, 'Admin');
assert.strictEqual(T.parseNote('- [ ] Loose\n')[0].group, '', 'no heading yet is no group');
assert.deepStrictEqual(T.groupsOf(NOTE), ['Family', 'Admin']);
/* A single # is the note's title, not a section: people head the note
   "# Reminders", and everything under it is ungrouped until a ## says
   otherwise. */
assert.strictEqual(T.parseNote('# Reminders\n- [ ] Loose\n')[0].group, '');
assert.deepStrictEqual(T.groupsOf('# Reminders\n- [ ] Loose\n'), []);
assert.strictEqual(T.parseNote('## Family\n- [ ] A\n# Reminders\n- [ ] B\n')[1].group, '',
  'a title further down ends the section above it');
console.log('tasks OK');
