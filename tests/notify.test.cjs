'use strict';
/* Which reminders Obsidian should speak up about, right now. Pure, so the
   awkward cases — midnight, a reminder ticked five minutes ago, the app left
   open for three days — are decided here rather than by a timer. */
const assert = require('node:assert');
const N = require('../src/notify');

const item = (title, due, time, done) => ({ title, due, time: time || '', done: !!done, tags: [], priority: 'normal', group: '' });
const opts = (now, fired) => ({ today: '2026-09-13', now, fired: fired || [], leadMinutes: 10, allDayAlarmTime: '09:00' });

const items = [
  item('Timed', '2026-09-13', '09:30'),
  item('All day', '2026-09-13'),
  item('Overdue', '2026-09-10'),
  item('Tomorrow', '2026-09-14', '08:00'),
  item('Ticked', '2026-09-13', '09:30', true),
];

assert.deepStrictEqual(N.pending(items, opts('06:00')).map(i => i.title), [], 'nothing before the hour');
assert.deepStrictEqual(N.pending(items, opts('09:00')).map(i => i.title), ['All day', 'Overdue'],
  'the daily hour covers what is undated in time and what is late');
assert.deepStrictEqual(N.pending(items, opts('09:20')).map(i => i.title), ['Timed', 'All day', 'Overdue'],
  'a timed reminder speaks ten minutes ahead');
assert.deepStrictEqual(N.pending(items, opts('23:59')).map(i => i.title), ['Timed', 'All day', 'Overdue']);
assert.ok(!N.pending(items, opts('09:20')).some(i => i.title === 'Ticked'), 'a ticked reminder is silent');
assert.ok(!N.pending(items, opts('09:20')).some(i => i.title === 'Tomorrow'), 'tomorrow is not today');

/* Said once is said. The key survives a restart because it is derived, not
   remembered. */
const keys = N.pending(items, opts('09:20')).map(i => N.keyFor(i, '2026-09-13'));
assert.deepStrictEqual(N.pending(items, opts('09:30', keys)).map(i => i.title), []);
assert.strictEqual(N.keyFor(items[0], '2026-09-13'), N.keyFor(items[0], '2026-09-13'));
assert.notStrictEqual(N.keyFor(items[0], '2026-09-13'), N.keyFor(items[0], '2026-09-14'), 'a new day speaks again');

assert.strictEqual(N.message([items[0]]), 'Timed');
assert.strictEqual(N.message([items[0], items[1]]), 'Timed, All day');
assert.strictEqual(N.message([items[0], items[1], items[2], items[3]]), 'Timed, All day, Overdue and 1 more');
assert.strictEqual(N.message([]), '');
console.log('notify OK');
