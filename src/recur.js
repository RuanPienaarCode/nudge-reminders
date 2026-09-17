'use strict';
/* Repeats, in the subset of Obsidian Tasks' phrasing we can honour exactly.

   An unparseable rule returns '' — the caller then keeps the reminder rather
   than inventing a date for it. Guessing here would silently move something
   the user needs to do. */

const D = require('./dates');

const DAY_NAMES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const UNITS = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year' };

const RULE_RE = /^every\s+(?:(\d+)\s+)?([a-z]+)(\s+when\s+done)?$/;

function parse(rule) {
  const s = String(rule || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = RULE_RE.exec(s);
  if (!m) return null;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  if (!(n > 0)) return null;
  const word = m[2];
  const whenDone = !!m[3];
  if (word === 'weekday' || word === 'weekdays') return { kind: 'weekday', n, whenDone };
  if (DAY_NAMES[word] !== undefined) return { kind: 'dayOfWeek', day: DAY_NAMES[word], name: word, n, whenDone };
  if (UNITS[word]) return { kind: UNITS[word], n, whenDone };
  return null;
}

function step(r, from) {
  switch (r.kind) {
    case 'day': return D.addDays(from, r.n);
    case 'week': return D.addDays(from, 7 * r.n);
    case 'month': return D.addMonths(from, r.n);
    case 'year': return D.addMonths(from, 12 * r.n);
    case 'weekday': {
      let d = D.addDays(from, 1);
      while (D.dow(d) === 0 || D.dow(d) === 6) d = D.addDays(d, 1);
      return d;
    }
    case 'dayOfWeek': {
      const delta = ((r.day - D.dow(from)) + 7) % 7;
      return D.addDays(from, delta === 0 ? 7 : delta);
    }
    default: return '';
  }
}

/* The next due date after this one was met.

   `whenDone` rules count from the day it was actually ticked (a chore);
   everything else counts from the date it was due (a deadline, which must
   not drift every time you are late).

   `today` is optional: when given, a repeat that has fallen behind is walked
   forward until it lands in the future, so ticking a month-old daily chore
   gives you tomorrow rather than a date that is still overdue. */
function nextDue(rule, due, doneDate, today) {
  const r = parse(rule);
  if (!r || !D.isISO(due)) return '';
  const base = r.whenDone && D.isISO(doneDate) ? doneDate : due;
  let next = step(r, base);
  if (!next) return '';
  if (D.isISO(today)) {
    let guard = 0;
    while (D.diffDays(today, next) <= 0 && guard++ < 500) {
      const advanced = step(r, next);
      if (!advanced || advanced === next) break;
      next = advanced;
    }
  }
  return next;
}

function describe(rule) {
  const r = parse(rule);
  if (!r) return '';
  let body;
  if (r.kind === 'weekday') body = 'weekday';
  else if (r.kind === 'dayOfWeek') body = D.DAYS[r.day];
  else body = r.n > 1 ? `${r.n} ${r.kind}s` : r.kind;
  if (r.n > 1 && (r.kind === 'weekday' || r.kind === 'dayOfWeek')) body = `${r.n} ${body}s`;
  return `Every ${body}${r.whenDone ? ' when done' : ''}`;
}

const PRESETS = [
  { rule: 'every day', label: 'Every day' },
  { rule: 'every week', label: 'Every week' },
  { rule: 'every month', label: 'Every month' },
  { rule: 'every 3 months', label: 'Every 3 months' },
  { rule: 'every year', label: 'Every year' },
  { rule: 'every weekday', label: 'Every weekday' },
];

module.exports = { nextDue, describe, parse, PRESETS };
