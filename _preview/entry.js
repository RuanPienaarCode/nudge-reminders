/* Harness entry: mounts the REAL board (src/board.js) on a fake plugin host
   whose vault holds one real Reminders.md. Every write goes through the real
   store, so what you click here is what the plugin does.
     ?tint=dusk|moss|ember|ink   ?surface=plain   ?theme=light   ?mode=light|dark   ?mobile=1   ?empty=1 */
const { mountBoard } = require('../src/board');
const { DEFAULT_SETTINGS } = require('../src/constants');
const D = require('../src/dates');

const q = new URLSearchParams(location.search);
if (q.get('mobile') === '1') document.body.classList.add('is-mobile');
if (q.get('theme') === 'light') { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); }

const T = D.todayISO();
const d = n => D.addDays(T, n);

const NOTE = q.get('empty') === '1' ? '# Reminders\n\n' : [
  '# Reminders',
  '',
  'The things I must not forget.',
  '',
  '## Family',
  `- [ ] Sign papers for mom's medical aid 📅 ${d(-3)} ⏫ #family`,
  `- [ ] Phone the medical aid about the referral ⏰ 09:30 #family 📅 ${T}`,
  `- [ ] Collect mom's scans from the radiologist 📅 ${T} 🔺 #family #health`,
  `- [x] Fetch the prescription 📅 ${d(-4)} ✅ ${d(-4)} #family`,
  '',
  '## Admin',
  `- [ ] Renew the licence disc 📅 ${d(1)} #car`,
  `- [ ] Pay the rates 📅 ${d(5)} 🔁 every month`,
  `- [ ] Book the car service 📅 ${d(47)} 🔽 #car`,
  '- [ ] One day, sort out the garage',
  '',
  '## Work',
  `- [ ] Send the quarterly invoice ⏰ 16:00 #work 📅 ${d(2)} 🔼`,
  `- [ ] Water the office plants 📅 ${d(-1)} 🔁 every week #work`,
  '',
].join('\n');

const files = new Map([['Reminders.md', NOTE]]);
const fileOf = p => ({ path: p, name: p.split('/').pop(), basename: p.replace(/\.md$/, ''), extension: 'md' });

const app = {
  vault: {
    getFileByPath: p => (files.has(p) ? fileOf(p) : null),
    getFolderByPath: p => (p === '' ? { path: '', children: [] } : null),
    read: async f => files.get(f.path),
    cachedRead: async f => files.get(f.path),
    modify: async (f, t) => { files.set(f.path, t); log(t); },
    create: async (p, t) => { files.set(p, t); log(t); return fileOf(p); },
    createFolder: async () => {},
    adapter: { write: async (p, t) => { files.set(p, t); console.log('[ics]', p, '\n' + t); }, exists: async p => files.has(p) },
    on: () => ({}),
  },
  workspace: { getLeaf: () => ({ openFile: async f => alert('Would open ' + f.path) }), on: () => ({}) },
  metadataCache: { on: () => ({}) },
};

function log(text) {
  const pane = document.getElementById('note');
  if (pane) pane.textContent = text;
  console.log('[Reminders.md]\n' + text);
}

const settings = Object.assign({}, DEFAULT_SETTINGS, { name: 'Ruan', showDone: true });
if (q.get('tint')) settings.tint = q.get('tint');
if (q.get('surface')) settings.surface = q.get('surface');
if (q.get('mode')) settings.mode = q.get('mode');

const plugin = { app, settings, _lastWrite: 0, async saveSettings() {}, refreshViews() { ctl.refresh(); } };
const view = { plugin, contentEl: document.getElementById('app'), registerEvent() {}, registerInterval() {} };
const ctl = mountBoard(view);
window.__nd = { ctl, plugin, app, files };
ctl.start().then(() => log(files.get('Reminders.md')));
