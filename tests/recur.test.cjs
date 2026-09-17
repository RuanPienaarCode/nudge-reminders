'use strict';
/* Repeats. Only the phrasings we can honour are accepted — an unparseable
   rule returns '' so the caller keeps the reminder instead of inventing a
   date for it. */
const assert = require('node:assert');
const R = require('../src/recur');

const n = (rule, from, done) => R.nextDue(rule, from, done || from);

assert.strictEqual(n('every day', '2026-09-20'), '2026-09-21');
assert.strictEqual(n('every 3 days', '2026-09-20'), '2026-09-23');
assert.strictEqual(n('every week', '2026-09-20'), '2026-09-27');
assert.strictEqual(n('every 2 weeks', '2026-09-20'), '2026-10-04');
assert.strictEqual(n('every month', '2026-09-20'), '2026-10-20');
assert.strictEqual(n('every month', '2026-01-31'), '2026-02-28', 'month-end clamps');
assert.strictEqual(n('every 3 months', '2026-09-20'), '2026-12-20');
assert.strictEqual(n('every year', '2026-09-20'), '2027-09-20');
assert.strictEqual(n('every 2 years', '2026-09-20'), '2028-09-20');

assert.strictEqual(n('every weekday', '2026-09-18'), '2026-09-21', 'Friday jumps the weekend');
assert.strictEqual(n('every weekday', '2026-09-21'), '2026-09-22');
assert.strictEqual(n('every monday', '2026-09-14'), '2026-09-21', 'a Monday goes to the next one');
assert.strictEqual(n('every mon', '2026-09-16'), '2026-09-21');
assert.strictEqual(n('every sunday', '2026-09-16'), '2026-09-20');

/* "when done" bases the next date on the day it was actually ticked, not on
   the date it was due — the difference between a chore and a deadline. */
assert.strictEqual(n('every month when done', '2026-09-01', '2026-09-25'), '2026-10-25');
assert.strictEqual(n('every 2 days when done', '2026-09-01', '2026-09-25'), '2026-09-27');
assert.strictEqual(n('every month', '2026-09-01', '2026-09-25'), '2026-10-01', 'without it the schedule holds');

/* A repeat that has fallen behind catches up to the future rather than
   handing back a date that is still overdue. */
assert.strictEqual(R.nextDue('every day', '2026-09-01', '2026-09-01', '2026-09-20'), '2026-09-21');
assert.strictEqual(R.nextDue('every week', '2026-09-01', '2026-09-01', '2026-09-20'), '2026-09-22');

assert.strictEqual(n('', '2026-09-20'), '');
assert.strictEqual(n('every blue moon', '2026-09-20'), '');
assert.strictEqual(n('every day', ''), '', 'no due date, nothing to advance');

assert.strictEqual(R.describe('every 2 weeks'), 'Every 2 weeks');
assert.strictEqual(R.describe('every monday'), 'Every Monday');
assert.strictEqual(R.describe(''), '');
assert.deepStrictEqual(R.PRESETS.map(p => p.rule).slice(0, 3), ['every day', 'every week', 'every month']);
console.log('recur OK');
