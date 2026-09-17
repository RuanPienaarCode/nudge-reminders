'use strict';
/* The calendar feed. This file is what puts a real alert on a phone, so it
   has to be RFC 5545 correct — Apple Calendar rejects the whole file, not
   the offending line. */
const assert = require('node:assert');
const I = require('../src/ics');

const items = [
  { title: "Sign papers for mom's medical aid", due: '2026-09-20', time: '', priority: 'high', done: false, tags: ['#family'], group: 'Family' },
  { title: 'Phone the doctor; ask about the referral, please', due: '2026-09-21', time: '09:30', priority: 'normal', done: false, tags: [], group: 'Family' },
  { title: 'Already done', due: '2026-09-01', done: true, doneDate: '2026-09-01', tags: [] },
  { title: 'No date', due: '', done: false, tags: [] },
];
const ics = I.buildICS(items, { name: 'Nudge', alarmMinutes: 10, allDayAlarmTime: '09:00', now: '2026-09-13T08:00:00Z' });
const lines = ics.split('\r\n');

assert.ok(ics.includes('\r\n') && !/[^\r]\n/.test(ics), 'every break is CRLF');
assert.strictEqual(lines[0], 'BEGIN:VCALENDAR');
assert.strictEqual(lines[lines.length - 1], '', 'the file ends with a break');
assert.strictEqual(lines[lines.length - 2], 'END:VCALENDAR');
assert.ok(ics.includes('VERSION:2.0'));
assert.ok(ics.includes('PRODID:'));
assert.ok(ics.includes('X-WR-CALNAME:Nudge'));

assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'done and undated reminders are not events');
assert.ok(!ics.includes('Already done'));
assert.ok(!ics.includes('No date'));

/* All day: a DATE start, an exclusive DATE end, and an alarm at the hour we
   chose rather than at midnight. */
assert.ok(ics.includes('DTSTART;VALUE=DATE:20260920'));
assert.ok(ics.includes('DTEND;VALUE=DATE:20260921'), 'DTEND is exclusive');
assert.ok(ics.includes('TRIGGER;RELATED=START:PT9H'), 'an all-day reminder alerts at 09:00, not midnight');

/* Timed: floating local time, so 09:30 is 09:30 wherever the phone is. */
assert.ok(ics.includes('DTSTART:20260921T093000'));
assert.ok(ics.includes('DTEND:20260921T094500'));
assert.ok(ics.includes('TRIGGER:-PT10M'));
assert.ok(ics.includes('BEGIN:VALARM') && ics.includes('ACTION:DISPLAY'));

/* Escaping: a semicolon or comma in a summary must not split the property. */
const summary = lines.find(l => l.startsWith('SUMMARY:Phone the doctor'));
assert.ok(summary, 'the summary is a single unfolded line here');
assert.ok(summary.includes('\;') && summary.includes('\\,'), 'semicolons and commas are escaped');

/* The same reminder keeps the same UID, so a re-import updates the event it
   already made instead of adding a second one. */
const again = I.buildICS(items, { name: 'Nudge', alarmMinutes: 10, allDayAlarmTime: '09:00', now: '2026-09-14T08:00:00Z' });
const uid = s => (s.match(/^UID:.*$/m) || [''])[0];
assert.strictEqual(uid(ics), uid(again), 'the UID does not depend on when we exported');
assert.notStrictEqual(uid(ics), '');
const moved = I.buildICS([{ ...items[0], due: '2026-09-27' }], { name: 'Nudge', now: '2026-09-13T08:00:00Z' });
assert.strictEqual(uid(moved), uid(ics), 'moving the date keeps the same event');

/* Long values are folded at 75 octets with a leading space. */
const long = I.buildICS([{ title: 'x'.repeat(200), due: '2026-09-20', done: false, tags: [] }], { name: 'N', now: '2026-09-13T08:00:00Z' });
for (const l of long.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `folded: ${l.length}`);
assert.ok(long.includes('\r\n x'), 'a continuation line begins with a space');
assert.ok(I.buildICS([], { name: 'N', now: '2026-09-13T08:00:00Z' }).includes('END:VCALENDAR'), 'an empty list is still a valid calendar');
console.log('ics OK');
