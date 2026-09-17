'use strict';
/* Vault IO. The note belongs to the user: we edit the ONE line we mean to
   edit and leave every other byte — prose, headings, other plugins' tasks —
   exactly where it was. */
require('./_stub.cjs');
const assert = require('node:assert');
const { makeStore } = require('../src/store');

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

  console.log('store OK');
})().catch(e => { console.error(e); process.exit(1); });
