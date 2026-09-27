'use strict';
/* The quick-add bar. You type one line the way you'd say it; the date, time,
   priority, tags and repeat come out, and whatever is left is the reminder.
   Anything it does not recognise stays in the title — it must never eat a
   word it did not understand. */
const assert = require('node:assert');
const Q = require('../src/quickparse');
const T = '2026-09-13'; // a Sunday

const p = (s, today) => Q.parseQuick(s, today || T);

assert.deepStrictEqual(p('Buy milk'), { title: 'Buy milk', due: '', time: '', priority: 'normal', repeat: '', tags: [] });

assert.strictEqual(p('Sign papers tomorrow').due, '2026-09-14');
assert.strictEqual(p('Sign papers tomorrow').title, 'Sign papers');
assert.strictEqual(p('Call the doctor today').due, T);
assert.strictEqual(p('Ring mom tonight').due, T);
assert.strictEqual(p('Ring mom tonight').time, '20:00');
assert.strictEqual(p('Pay rates next week').due, '2026-09-20');
assert.strictEqual(p('Renew licence next month').due, '2026-10-13');
assert.strictEqual(p('Book service in 3 days').due, '2026-09-16');
assert.strictEqual(p('Book service in 2 weeks').due, '2026-09-27');
assert.strictEqual(p('Check on monday').due, '2026-09-14', 'the next Monday, not today');
assert.strictEqual(p('Check on monday').title, 'Check');
assert.strictEqual(p('Collect scans on friday').due, '2026-09-18');
assert.strictEqual(p('Submit 2026-10-01').due, '2026-10-01');
assert.strictEqual(p('Submit on 25 Sep').due, '2026-09-25');
assert.strictEqual(p('Submit on Sep 25').due, '2026-09-25');
assert.strictEqual(p('Submit on 4 Jan').due, '2027-01-04', 'a date already past rolls into next year');

assert.strictEqual(p('Meet Sam tomorrow at 9am').time, '09:00');
assert.strictEqual(p('Meet Sam tomorrow at 9am').title, 'Meet Sam');
assert.strictEqual(p('Meet Sam tomorrow 9:30am').time, '09:30');
assert.strictEqual(p('Meet Sam tomorrow 5pm').time, '17:00');
assert.strictEqual(p('Meet Sam tomorrow 12pm').time, '12:00');
assert.strictEqual(p('Meet Sam tomorrow 12am').time, '00:00');
assert.strictEqual(p('Standup 09:15 tomorrow').time, '09:15');
assert.strictEqual(p('Read chapter 9 of the book').time, '', 'a bare number is not a time');
assert.strictEqual(p('Read chapter 9 of the book').title, 'Read chapter 9 of the book');

assert.strictEqual(p('Fix the roof !high').priority, 'high');
assert.strictEqual(p('Fix the roof !high').title, 'Fix the roof');
assert.strictEqual(p('Fix the roof !!').priority, 'high');
assert.strictEqual(p('Fix the roof !!!').priority, 'highest');
assert.strictEqual(p('Fix the roof !urgent').priority, 'highest');
assert.strictEqual(p('Fix the roof !low').priority, 'low');

assert.deepStrictEqual(p('Sign papers #family #health').tags, ['#family', '#health']);
assert.strictEqual(p('Sign papers #family').title, 'Sign papers');

assert.strictEqual(p('Water the plants every week').repeat, 'every week');
assert.strictEqual(p('Water the plants every week').title, 'Water the plants');
assert.strictEqual(p('Check the post every monday').repeat, 'every monday');
assert.strictEqual(p('Check the post every monday').due, '2026-09-14', 'a repeat also sets the first date');
assert.strictEqual(p('Pay the bond every month when done').repeat, 'every month when done');

/* The whole thing at once, the way it would really be typed. */
const all = p("Sign papers for mom's medical aid tomorrow at 9am !high #family every month");
assert.strictEqual(all.title, "Sign papers for mom's medical aid");
assert.strictEqual(all.due, '2026-09-14');
assert.strictEqual(all.time, '09:00');
assert.strictEqual(all.priority, 'high');
assert.deepStrictEqual(all.tags, ['#family']);
assert.strictEqual(all.repeat, 'every month');

/* Words that merely look like keywords are left alone. */
assert.strictEqual(p('Plan the day').title, 'Plan the day');
assert.strictEqual(p('Read about the Monday Club').title, 'Read about the Monday Club', 'a capitalised weekday inside a name is not a date');
assert.strictEqual(p('').title, '');
assert.strictEqual(p('   ').title, '');
/* ---- words that start like months are not months (audit, 27 Sep 2026) ---- */
const TD = '2026-09-27';
for (const text of ['Buy 3 decks of cards', 'Buy 2 mayonnaise', 'Get 2 novels from library', 'Buy 12 marbles', 'Buy 6 octopus toys', 'Order 4 junctions']) {
  const q = Q.parseQuick(text, TD);
  assert.strictEqual(q.due, '', `no date in "${text}"`);
  assert.strictEqual(q.title, text, `and every word kept in "${text}"`);
}
assert.deepStrictEqual([Q.parseQuick('Sale 10 aug 2028', TD).due, Q.parseQuick('Sale 10 aug 2028', TD).title], ['2028-08-10', 'Sale'], 'a year is read, not left in the title');
assert.strictEqual(Q.parseQuick('Pay on 3 September', TD).due, '2027-09-03');
assert.strictEqual(Q.parseQuick('Pay 15th of October', TD).due, '2026-10-15');
assert.strictEqual(Q.parseQuick('Meet 29 feb', TD).due, '2028-02-29', '29 Feb waits for a leap year');
assert.deepStrictEqual([Q.parseQuick('Meet 31 apr', TD).due, Q.parseQuick('Meet 31 apr', TD).title], ['', 'Meet 31 apr'], 'no such date: nothing eaten');
assert.deepStrictEqual(Q.parseQuick('Fix issue #12 today', TD).tags, [], 'an all-digit #12 is not a tag');
console.log('quickparse OK');
