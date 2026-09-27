'use strict';
/* Vault IO. The note belongs to the user: we edit the ONE line we mean to
   edit and leave every other byte — prose, headings, other plugins' tasks —
   exactly where it was. */
require('./_stub.cjs');
const assert = require('node:assert');
const { makeStore, liftTime } = require('../src/store');

const START = [
  '# Reminders',
  '',
  'Things I must not forget.',
  '',
  '## Family',
  "- [ ] Sign papers for mom's medical aid 📅 2026-09-10 ⏫ #family",
  '- [ ] Water the plants 📅 2026-09-13 🔁 every week',
  '',
  '## Admin',
  '- [ ] Renew the licence disc 📅 2026-10-01',
  ''].join('\n');

function host(text) {
  const files = new Map(text === null ? [] : [['Reminders.md', text]]);
  const plugin = {
    settings: { file: 'Reminders.md', icsFile: 'Reminders.ics', alarmMinutes: 10, allDayAlarmTime: '09:00' },
    _lastWrite: 0,
    async saveSettings() {},
    app: {
      vault: {
        getFileByPath: p => (files.has(p) ? { path: p, name: p.split('/').pop() } : null),
        getFolderByPath: p => (p === '' ? { path: '', children: [] } : null),
        read: async f => files.get(f.path),
        cachedRead: async f => files.get(f.path),
        modify: async (f, t) => { files.set(f.path, t); },
        create: async (p, t) => { files.set(p, t); return { path: p }; },
        createFolder: async () => {},
        adapter: { write: async (p, t) => { files.set(p, t); }, exists: async p => files.has(p) },
      },
    },
  };
  return { plugin, files, store: makeStore(plugin) };
}

(async () => {
  /* ---- load ---- */
  let h = host(START);
  let { items, groups } = await h.store.load();
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(groups, ['Family', 'Admin']);
  assert.strictEqual(items[0].group, 'Family');

  /* ---- add: into an existing group, under its last task ---- */
  await h.store.add({ title: 'Book the MRI', due: '2026-09-25', group: 'Family', priority: 'high' });
  let text = h.files.get('Reminders.md');
  assert.ok(text.includes('- [ ] Book the MRI 📅 2026-09-25 ⏫'));
  assert.ok(text.indexOf('Book the MRI') > text.indexOf('Water the plants'), 'appended under its own heading');
  assert.ok(text.indexOf('Book the MRI') < text.indexOf('## Admin'), 'and not into the next one');
  assert.ok(text.startsWith('# Reminders\n\nThings I must not forget.\n'), 'the prose above is untouched');

  /* ---- add: a group that does not exist yet gets its heading ---- */
  h = host(START);
  await h.store.add({ title: 'Renew passport', due: '2027-01-04', group: 'Travel' });
  text = h.files.get('Reminders.md');
  assert.ok(/## Travel\n- \[ \] Renew passport 📅 2027-01-04/.test(text));
  assert.ok(text.indexOf('## Travel') > text.indexOf('## Admin'), 'a new heading goes at the end');

  /* ---- add: no group at all ----
     It must NOT fall under whatever heading happens to be last — a reminder
     with no group would silently join someone else's section and come back
     wearing its name. It gets an Inbox of its own instead. */
  h = host(START);
  await h.store.add({ title: 'Loose end' });
  text = h.files.get('Reminders.md');
  assert.ok(/## Inbox\n- \[ \] Loose end/.test(text), 'an ungrouped reminder lands in Inbox');
  assert.ok(text.indexOf('## Inbox') > text.indexOf('## Admin'), 'which sits at the end');
  ({ items } = await h.store.load());
  assert.strictEqual(items.find(i => i.title === 'Loose end').group, 'Inbox');
  /* and a second one joins the Inbox already there rather than making another */
  await h.store.add({ title: 'Another loose end' });
  text = h.files.get('Reminders.md');
  assert.strictEqual((text.match(/## Inbox/g) || []).length, 1);
  assert.ok(text.indexOf('Another loose end') > text.indexOf('Loose end'));

  /* A note with no headings at all stays flat — no ceremony is imposed. */
  h = host('- [ ] Just a list\n');
  await h.store.add({ title: 'Second thing' });
  assert.strictEqual(h.files.get('Reminders.md').trim(), '- [ ] Just a list\n- [ ] Second thing');

  /* ---- add: the note does not exist yet ---- */
  h = host(null);
  await h.store.add({ title: 'First ever', due: '2026-09-20' });
  assert.ok(h.files.get('Reminders.md').includes('- [ ] First ever 📅 2026-09-20'));

  /* ---- toggle: a plain reminder is ticked with today's date ---- */
  h = host(START);
  ({ items } = await h.store.load());
  let res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rolled, null);
  text = h.files.get('Reminders.md');
  assert.ok(text.includes("- [x] Sign papers for mom's medical aid 📅 2026-09-10 ⏫ #family ✅ 2026-09-13"));
  assert.strictEqual(text.split('\n').length, START.split('\n').length, 'no line added or lost');

  /* ---- toggle: a repeating reminder leaves the next one behind ---- */
  h = host(START);
  ({ items } = await h.store.load());
  res = await h.store.toggle(items[1], '2026-09-13');
  assert.strictEqual(res.rolled.due, '2026-09-20');
  text = h.files.get('Reminders.md');
  const l = text.split('\n');
  assert.strictEqual(l[6], '- [ ] Water the plants 📅 2026-09-20 🔁 every week', 'the next instance sits where the old one was');
  assert.strictEqual(l[7], '- [x] Water the plants 📅 2026-09-13 🔁 every week ✅ 2026-09-13', 'the tick stays as a record');

  /* ---- toggle back ---- */
  h = host(START.replace('- [ ] Renew the licence disc 📅 2026-10-01', '- [x] Renew the licence disc 📅 2026-10-01 ✅ 2026-09-12'));
  ({ items } = await h.store.load());
  await h.store.toggle(items.find(i => i.done), '2026-09-13');
  assert.ok(h.files.get('Reminders.md').includes('- [ ] Renew the licence disc 📅 2026-10-01'));
  assert.ok(!h.files.get('Reminders.md').includes('✅'), 'un-ticking clears the completion date');

  /* ---- the line moved under us ---- */
  h = host(START);
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '- [ ] A new line at the top\n' + START);
  res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, true, 'found by its content, not its line number');
  assert.ok(h.files.get('Reminders.md').includes("- [x] Sign papers for mom's medical aid"));

  /* ---- the line is gone ---- */
  h = host(START);
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '# Reminders\n');
  res = await h.store.toggle(items[0], '2026-09-13');
  assert.strictEqual(res.ok, false, 'a vanished line is reported, never re-created');
  assert.strictEqual(h.files.get('Reminders.md'), '# Reminders\n', 'and nothing is written');

  /* ---- update ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.update(items[0], { due: '2026-09-30', priority: 'highest', title: 'Sign the medical aid papers' });
  text = h.files.get('Reminders.md');
  assert.ok(text.includes('- [ ] Sign the medical aid papers #family 📅 2026-09-30 🔺'));
  assert.strictEqual(text.split('\n').length, START.split('\n').length);

  /* ---- snooze ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.snooze(items[0], 1, '2026-09-13');
  assert.ok(h.files.get('Reminders.md').includes('📅 2026-09-14'), 'snoozing moves the due date from TODAY, not from an overdue one');

  /* ---- remove ---- */
  h = host(START);
  ({ items } = await h.store.load());
  await h.store.remove(items[0]);
  text = h.files.get('Reminders.md');
  assert.ok(!text.includes('Sign papers'));
  assert.strictEqual(text.split('\n').length, START.split('\n').length - 1);
  assert.ok(text.includes('## Family'), 'the heading stays');

  /* ---- the calendar file ---- */
  h = host(START);
  const out = await h.store.exportICS('2026-09-13T08:00:00Z');
  assert.strictEqual(out.path, 'Reminders.ics');
  assert.strictEqual(out.count, 3);
  assert.ok(h.files.get('Reminders.ics').startsWith('BEGIN:VCALENDAR'));

  /* ---- a new list is a heading, added once, nothing else touched ---- */
  h = host(START);
  let r = await h.store.addList('  ## Car  stuff ');
  assert.deepStrictEqual([r.ok, r.name, r.existed], [true, 'Car stuff', false]);
  text = h.files.get('Reminders.md');
  assert.ok(text.startsWith(START.replace(/\n+$/, '')), 'every existing byte stays where it was');
  assert.ok(text.endsWith('\n\n## Car stuff\n'));
  let loaded = await h.store.load();
  assert.deepStrictEqual(loaded.lists, ['Family', 'Admin', 'Car stuff'], 'an empty list still shows');
  assert.deepStrictEqual(loaded.groups, ['Family', 'Admin'], 'groups stay the ones holding reminders');
  r = await h.store.addList('Family');
  assert.strictEqual(r.existed, true);
  assert.strictEqual(h.files.get('Reminders.md'), text, 'an existing list is not added twice');
  assert.strictEqual((await h.store.addList('   ')).ok, false);
  await h.store.add({ title: 'Check the tyres', group: 'Car stuff' });
  loaded = await h.store.load();
  assert.strictEqual(loaded.items.find(i => i.title === 'Check the tyres').group, 'Car stuff', 'a reminder lands in the new list');

  /* ---- lifting ⏰ out of the Tasks field run ---- */
  /* Tasks reads fields from the END of the line and stops at the first thing
     that isn't one, so a ⏰ after 📅 hides the due date. The fix moves only
     the ⏰ token to just before the first Tasks field — surgery, not a
     re-spelling: the rest of the line keeps its own order and spacing. */
  assert.strictEqual(liftTime('- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30'),
    '- [ ] Phone the dentist #health ⏰ 09:30 📅 2026-10-01');
  assert.strictEqual(liftTime('  * [x] Timed 📅 2026-10-01 ⏰ 09:30 ✅ 2026-10-02'),
    '  * [x] Timed ⏰ 09:30 📅 2026-10-01 ✅ 2026-10-02', 'done lines too, indent and marker kept');
  assert.strictEqual(liftTime('- [ ] Call ⏫ 📅 2026-10-01 ⏰ 9:30 ^abc123'),
    '- [ ] Call ⏰ 9:30 ⏫ 📅 2026-10-01 ^abc123', 'a block id stays at the end, where Obsidian needs it');
  assert.strictEqual(liftTime('- [ ] 📅 2026-10-01 ⏰ 09:30'), '- [ ] ⏰ 09:30 📅 2026-10-01', 'no title');
  for (const fine of [
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [ ] Only a time ⏰ 09:00',
    '- [ ] No time 📅 2026-09-20',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
  ]) assert.strictEqual(liftTime(fine), fine, `left alone: ${fine}`);

  const TIMED = [
    '# Reminders',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
    '## Health',
    '- [ ] Phone the dentist #health 📅 2026-10-01 ⏰ 09:30',
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [x] Pills 📅 2026-09-25  ⏰ 08:00 🔁 every day ✅ 2026-09-25',
    '- [ ] Someone else’s task 🔼 📅 2026-10-03',
    ''].join('\n');
  h = host(TIMED);
  r = await h.store.liftTimes();
  assert.strictEqual(r.changed, 2);
  assert.strictEqual(h.files.get('Reminders.md'), [
    '# Reminders',
    'Prose that mentions 📅 2026-09-20 ⏰ 09:00 is not a task',
    '## Health',
    '- [ ] Phone the dentist #health ⏰ 09:30 📅 2026-10-01',
    '- [ ] Timed ⏰ 09:00 📅 2026-09-20',
    '- [x] Pills ⏰ 08:00 📅 2026-09-25 🔁 every day ✅ 2026-09-25',
    '- [ ] Someone else’s task 🔼 📅 2026-10-03',
    ''].join('\n'));
  loaded = await h.store.load();
  const dentist = loaded.items.find(i => i.title === 'Phone the dentist');
  assert.deepStrictEqual([dentist.due, dentist.time, dentist.tags], ['2026-10-01', '09:30', ['#health']]);
  h.plugin._lastWrite = 0;
  r = await h.store.liftTimes();
  assert.strictEqual(r.changed, 0, 'a second run finds nothing');
  assert.strictEqual(h.plugin._lastWrite, 0, 'and writes nothing');
  assert.deepStrictEqual(await host(null).store.liftTimes(), { changed: 0 }, 'no note, no harm');

  /* ---- audit, 27 Sep 2026 ------------------------------------------ */

  /* A vault that behaves like the real one: reads and writes take a turn of
     the event loop, and process() is atomic. */
  function realHost(text) {
    const files = new Map([['Reminders.md', text]]);
    const tick = () => new Promise(res => setTimeout(res, 1));
    const plugin = {
      settings: { file: 'Reminders.md', icsFile: 'Reminders.ics' }, _lastWrite: 0,
      app: { vault: {
        getFileByPath: p => (files.has(p) ? { path: p } : null),
        getFolderByPath: () => ({ path: '', children: [] }),
        read: async f => { await tick(); return files.get(f.path); },
        modify: async (f, t) => { await tick(); files.set(f.path, t); },
        process: async (f, fn) => { await tick(); const t = fn(files.get(f.path)); files.set(f.path, t); return t; },
        create: async (p, t) => { files.set(p, t); return { path: p }; },
        createFolder: async () => {},
      } },
    };
    return { plugin, files, store: makeStore(plugin) };
  }

  /* two quick ticks both land */
  h = realHost('- [ ] A 📅 2026-10-01\n- [ ] B 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  await Promise.all([h.store.toggle(items[0], '2026-09-27'), h.store.toggle(items[1], '2026-09-27')]);
  assert.strictEqual(h.files.get('Reminders.md'), '- [x] A 📅 2026-10-01 ✅ 2026-09-27\n- [x] B 📅 2026-10-01 ✅ 2026-09-27\n', 'no tick is lost');

  /* an identical line in another list is not the one removed */
  h = host('## Home\n- [ ] Take pills 📅 2026-10-01\n## Work\n- [ ] Take pills 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  const work = items.find(i => i.group === 'Work');
  h.files.set('Reminders.md', 'A line typed above\n' + h.files.get('Reminders.md'));
  assert.strictEqual((await h.store.remove(work)).ok, true);
  assert.strictEqual(h.files.get('Reminders.md'), 'A line typed above\n## Home\n- [ ] Take pills 📅 2026-10-01\n## Work\n', 'Home keeps its pills');

  /* a date edited by hand while the board was open is still found — once */
  h = host('## Home\n- [ ] Call mum 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  h.files.set('Reminders.md', '## Home\n- [ ] Call mum 📅 2026-10-03\n');
  assert.strictEqual((await h.store.toggle(items[0], '2026-09-27')).ok, true);
  assert.ok(h.files.get('Reminders.md').includes('- [x] Call mum 📅 2026-10-03 ✅ 2026-09-27'));

  /* a repeat we cannot read is refused, and the note is left alone */
  const odd = '- [ ] Water ferns 📅 2026-10-01 🔁 every blue moon\n';
  h = host(odd);
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.deepStrictEqual([r.ok, r.reason, r.repeat], [false, 'repeat', 'every blue moon']);
  assert.strictEqual(h.files.get('Reminders.md'), odd, 'the series is not ended');

  /* a Tasks-style repeat rolls */
  h = host('- [ ] Bins 📅 2026-10-01 🔁 every week on Monday\n');
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(r.rolled.due, '2026-10-05');

  /* a repeat with no due date counts from today */
  h = host('- [ ] Stretch 🔁 every day\n');
  ({ items } = await h.store.load());
  r = await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Stretch 🔁 every day 📅 2026-09-28\n- [x] Stretch 🔁 every day ✅ 2026-09-27\n');

  /* a roll moves 🛫 and ⏳ with the due date */
  h = host('- [ ] Bill 🛫 2026-09-25 ⏳ 2026-09-28 📅 2026-10-01 🔁 every month\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md').split('\n')[0], '- [ ] Bill 🛫 2026-10-26 ⏳ 2026-10-29 📅 2026-11-01 🔁 every month');

  /* ^block-ids stay at the end; on a roll the link follows the open one */
  h = host('- [ ] Pay rent 📅 2026-10-01 ^rent1\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [x] Pay rent 📅 2026-10-01 ✅ 2026-09-27 ^rent1\n');
  h = host('- [ ] Pay rent 📅 2026-10-01 🔁 every month ^rent1\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Pay rent 📅 2026-11-01 🔁 every month ^rent1\n- [x] Pay rent 📅 2026-10-01 🔁 every month ✅ 2026-09-27\n');

  /* snooze changes the date the board reads — the last one, outside code */
  h = host('- [ ] Check `📅 2020-01-01` format 📅 2026-10-01\n');
  ({ items } = await h.store.load());
  await h.store.snooze(items[0], 1, '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '- [ ] Check `📅 2020-01-01` format 📅 2026-09-28\n');

  /* a CRLF note is read and stays CRLF */
  h = host('## Home\r\n- [ ] Crlf 📅 2026-10-01\r\n');
  ({ items } = await h.store.load());
  assert.strictEqual(items.length, 1);
  await h.store.toggle(items[0], '2026-09-27');
  assert.strictEqual(h.files.get('Reminders.md'), '## Home\r\n- [x] Crlf 📅 2026-10-01 ✅ 2026-09-27\r\n');

  /* changing the list in the editor moves the line */
  h = host(START);
  ({ items } = await h.store.load());
  const plants = items.find(i => i.title === 'Water the plants');
  assert.strictEqual((await h.store.update(plants, { group: 'Admin' })).moved, true);
  ({ items } = await h.store.load());
  assert.strictEqual(items.find(i => i.title === 'Water the plants').group, 'Admin');

  /* ⏰ inside a wikilink or a code span is not ours to move */
  assert.strictEqual(liftTime('- [ ] See [[Plan 📅 draft]] notes 📅 2026-10-01 ⏰ 09:00'),
    '- [ ] See [[Plan 📅 draft]] notes ⏰ 09:00 📅 2026-10-01');
  assert.strictEqual(liftTime('- [ ] Use `⏫` icon 📅 2026-10-01 ⏰ 09:00'), '- [ ] Use `⏫` icon ⏰ 09:00 📅 2026-10-01');
  assert.strictEqual(liftTime('- [ ] a 📅 2026-10-01 ⏰ 09:00\r'), '- [ ] a ⏰ 09:00 📅 2026-10-01\r');
  assert.strictEqual(liftTime('- [ ] Call 📅 2026-10-01 ⏰ 09:00 🔁 every week'), '- [ ] Call ⏰ 09:00 📅 2026-10-01 🔁 every week', 'a ⏰ in the middle of the run');

  /* ---- ⏰ stays out of the field run on every date write --------------- */
  /* Found reviewing Fortnight, which moves reminders through store.setDue:
     a 📅 added to a line that had none was appended AFTER ⏰, putting ⏰ back
     inside the run and hiding every field before it from Tasks. This reader
     is written independently of src/: it peels fields off the END of the
     line the way Tasks does and stops at the first thing that isn't one. */
  const FIELD_TAIL = /\s+((?:📅|⏳|🛫|✅|➕)\s*\d{4}-\d{2}-\d{2}|🔁\s*[a-zA-Z0-9, !]+|🔺|⏫|🔼|🔽|⏬|#[^\s#]+)$/;
  function tasksRead(line) {
    let s = line.replace(/\s+\^[A-Za-z0-9-]+$/, '');
    const fields = [];
    for (let m = FIELD_TAIL.exec(s); m; m = FIELD_TAIL.exec(s)) {
      fields.unshift(m[1].replace(/\s+/g, ' '));
      s = s.slice(0, m.index);
    }
    return fields;
  }
  assert.deepStrictEqual(tasksRead('- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00 📅 2026-10-07'), ['📅 2026-10-07'],
    'the reader sees the bug: ⏰ in the run hides ⏳');

  for (const [name, line, act, want, fields] of [
    ['setDue adds 📅 to a line with ⏳ and ⏰',
      '- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01 📅 2026-10-07', ['⏳ 2026-10-01', '📅 2026-10-07']],
    ['setDue moves 📅 on a line already in order',
      '- [ ] Pills ⏰ 08:00 📅 2026-10-01 ⏳ 2026-09-30', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 📅 2026-10-07 ⏳ 2026-09-30', ['📅 2026-10-07', '⏳ 2026-09-30']],
    ['setDue moves 📅 on an old-order line and repairs it',
      '- [ ] Pills 📅 2026-10-01 ⏰ 08:00 ⏳ 2026-09-30', (st, it) => st.setDue(it, '2026-10-07'),
      '- [ ] Pills ⏰ 08:00 📅 2026-10-07 ⏳ 2026-09-30', ['📅 2026-10-07', '⏳ 2026-09-30']],
    ['setDue clears 📅 and keeps ⏳',
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01 📅 2026-10-07', (st, it) => st.setDue(it, ''),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01', ['⏳ 2026-10-01']],
    ['setDue clears 📅 on a line the old bug wrote',
      '- [ ] Pills ⏳ 2026-10-01 ⏰ 08:00 📅 2026-10-07', (st, it) => st.setDue(it, null),
      '- [ ] Pills ⏰ 08:00 ⏳ 2026-10-01', ['⏳ 2026-10-01']],
    ['snooze adds 📅 the same way',
      '- [ ] Pills #meds ⏫ ⏰ 08:00 ^pills', (st, it) => st.snooze(it, 1, '2026-09-27'),
      /* #meds stays in the description, where Tasks still reads a tag */
      '- [ ] Pills #meds ⏰ 08:00 ⏫ 📅 2026-09-28 ^pills', ['⏫', '📅 2026-09-28']],
  ]) {
    h = host(`## Health\n${line}\n`);
    ({ items } = await h.store.load());
    await act(h.store, items[0]);
    const out = h.files.get('Reminders.md').split('\n')[1];
    assert.strictEqual(out, want, name);
    assert.deepStrictEqual(tasksRead(out), fields, `${name}: Tasks reads every field`);
    ({ items } = await h.store.load());
    assert.strictEqual(items[0].time, '08:00', `${name}: the board still reads the time`);
  }

  /* ticking a repeat that had no 📅: both the tick and the next one */
  h = host('## Health\n- [ ] Pills ⏳ 2026-09-27 ⏰ 08:00 🔁 every day\n');
  ({ items } = await h.store.load());
  await h.store.toggle(items[0], '2026-09-27');
  const [fresh, ticked] = h.files.get('Reminders.md').split('\n').slice(1, 3);
  assert.strictEqual(fresh, '- [ ] Pills ⏰ 08:00 ⏳ 2026-09-28 🔁 every day 📅 2026-09-28');
  assert.deepStrictEqual(tasksRead(fresh), ['⏳ 2026-09-28', '🔁 every day', '📅 2026-09-28']);
  assert.strictEqual(ticked, '- [x] Pills ⏰ 08:00 ⏳ 2026-09-27 🔁 every day ✅ 2026-09-27');
  assert.deepStrictEqual(tasksRead(ticked), ['⏳ 2026-09-27', '🔁 every day', '✅ 2026-09-27']);

  /* the calendar file goes through the vault, not the adapter */
  h = host(START);
  let adapterUsed = false;
  h.plugin.app.vault.adapter.write = async () => { adapterUsed = true; };
  await h.store.exportICS('2026-09-27T08:00:00Z');
  assert.ok(h.files.get('Reminders.ics').startsWith('BEGIN:VCALENDAR'));
  assert.strictEqual(adapterUsed, false);

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
