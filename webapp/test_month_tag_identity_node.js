// Accepted numeric calendar spellings share file identity without rewriting raw JSON.
// Synthetic in-memory folder; real import/autosave/lookup/catalog and merge code.
// Static-authored for post52; not executed during preparation.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elements = new Map(), el = key => {
  if (!elements.has(key)) elements.set(key, { value: '確認版', innerHTML: '', textContent: '', className: '', hidden: false, dataset: {}, addEventListener() {} });
  return elements.get(key);
};
globalThis.document = { querySelector: el, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/month-tag.html', protocol: 'file:', href: 'file:///synthetic/month-tag.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(file === 'app-core.js' && process.env.TOBAN_MONTH_TAG_SOURCE || path.join(__dirname, 'src', file), 'utf8'), { filename: file });
for (const file of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', file), 'utf8'), { filename: file });
T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, 'lang/ja.json'), 'utf8'))); T.setLang('ja');
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
const alerts = []; globalThis.alert = text => alerts.push(String(text));
for (const key of ['readAll', 'renderAll', 'toast', 'showTab', 'clearUndo']) A[key] = () => {};
A.choose = async () => { throw new Error('Unexpected whole-version/conflict choice'); };
T.plugins = { beginFolder() {}, stamp: () => [] };
const rules = { profile: { id: 'synthetic-month-tag', label: 'Synthetic', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'night', on: 'all' }] }, doctors: [{ name: 'Synthetic A', team: 'S', quota: 10 }] };
T.fillDefaultRules(rules);
const missing = () => Object.assign(new Error('Synthetic missing'), { name: 'NotFoundError' });
function folder() {
  const root = { name: 'Synthetic folder', kind: 'directory', dirs: new Map(), files: new Map(), writes: [],
    async *entries() { yield* root.dirs; },
    async getDirectoryHandle(name, options = {}) {
      if (!root.dirs.has(name)) { if (!options.create) throw missing(); const files = new Map(); root.dirs.set(name, { name, kind: 'directory', files, getFileHandle: (n, o = {}) => handle(files, name + '/' + n, n, o) }); }
      return root.dirs.get(name);
    }, getFileHandle: (n, o = {}) => handle(root.files, n, n, o) };
  async function handle(files, full, name, options) {
    if (!options.create && !files.has(name)) throw missing();
    return { getFile: async () => ({ text: async () => files.get(name) }), createWritable: async () => {
      let content; return { async write(blob) { content = typeof blob === 'string' ? blob : await blob.text(); }, async close() { files.set(name, content); root.writes.push(full); } };
    } };
  }
  return root;
}
function reset(root = folder()) {
  clearTimeout(A.autosaveTimer); alerts.length = 0;
  Object.assign(A.state, { rules: clone(rules), month: T.normalizeMonth({ year: 2026, month: 12 }, rules), result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = root; A.dirGen++; A.monthDirs = []; return root;
}
const payload = (year, month) => ({ rules: clone(rules), month: { year, month, duty_days: {}, next_first_day_in_calendar: true, notes: 'Synthetic imported note' }, result: null, saved_at: '2026-10-01T00:00:00.000Z' });
const stored = (root, tag) => JSON.parse(root.dirs.get(tag).files.get(tag + '_data.json'));
const cases = [
  [2026, 11, '202611'], ['2026', '11', '202611'], [2026, '011', '202611'], ['02026', '011', '202611'],
  [' 2026 ', ' 11 ', '202611'], ['2026.0', '11.0', '202611'], ['2.026e3', '1.1e1', '202611'],
  [2026, 1, '202601'], ['2026', '01', '202601'], ['2026.0', '001.0', '202601'],
];
const tests = [], test = (name, fn) => tests.push([name, fn]);
for (const [year, month, tag] of cases) test(`import/save/catalog/reopen ${JSON.stringify([year, month])}`, async () => {
  const root = reset(), input = payload(year, month), original = JSON.stringify(input);
  assert(T.isValidMonth(input.month));
  A.applyLoaded(input, 'Synthetic import', { fromFolder: false }); clearTimeout(A.autosaveTimer);
  assert.strictEqual(alerts.length, 0); assert.strictEqual(JSON.stringify(input), original);
  assert.strictEqual(A.tag(), tag); assert.strictEqual(A.state.month.year, year); assert.strictEqual(A.state.month.month, month);
  assert.strictEqual(await A.autosaveJson(), 'saved');
  assert.deepStrictEqual([...root.dirs.keys()], [tag]); assert.deepStrictEqual(root.writes, [tag + '/' + tag + '_data.json']);
  assert.strictEqual(stored(root, tag).month.year, year); assert.strictEqual(stored(root, tag).month.month, month);
  assert.strictEqual(A.isDirty(), false);
  await A.refreshMonths(); assert.deepStrictEqual(A.monthDirs, [tag]);
  const header = el('#monthTitle').innerHTML; assert(header.includes(`value="${tag}" selected`));
  assert(!header.includes('（未保存）'), 'saved month catalog is not a phantom unsaved entry');
  const found = await A.findMonthData(tag); assert(found.data && !found.corrupt); assert.strictEqual(found.data.month.notes, input.month.notes);
  // Drop recovery state and switch away: reopen must use the actual canonical file.
  reset(root); A.monthDirs = [tag]; A.markSaved('Synthetic other month checkpoint');
  assert.strictEqual(await A.openMonth(tag), true);
  clearTimeout(A.autosaveTimer);
  assert.strictEqual(A.tag(), tag); assert.strictEqual(A.state.month.notes, input.month.notes); assert.strictEqual(A.isDirty(), false);
  assert.strictEqual(await A.autosaveJson(), 'skipped'); assert.strictEqual(root.writes.length, 1);
});
test('canonical filename accepts raw strings and merges independent peer edits', async () => {
  const root = reset(), dir = await root.getDirectoryHandle('202611', { create: true }), input = payload('02026', '011');
  dir.files.set('202611_data.json', JSON.stringify(input)); A.monthDirs = ['202611'];
  const found = await A.findMonthData('202611'); assert(found.data && !found.corrupt);
  A.applyLoaded(found.data, 'Synthetic folder load'); clearTimeout(A.autosaveTimer);
  A.state.month.notes = 'Synthetic local change';
  const peer = clone(input); peer.month.year = 2026; peer.month.month = 11; peer.month.day_notes = { 3: 'Synthetic peer change' }; peer.saved_at = '2026-10-02T00:00:00.000Z';
  dir.files.set('202611_data.json', JSON.stringify(peer));
  assert.strictEqual(await A.autosaveJson(), 'saved');
  assert.strictEqual(stored(root, '202611').month.notes, 'Synthetic local change');
  assert.strictEqual(stored(root, '202611').month.day_notes[3], 'Synthetic peer change');
  assert.deepStrictEqual([...root.dirs.keys()], ['202611']); assert.strictEqual(A.isDirty(), false);
});
test('genuine wrong month remains blocked without writes', async () => {
  const root = reset(), dir = await root.getDirectoryHandle('202611', { create: true });
  dir.files.set('202611_data.json', JSON.stringify(payload('2026.0', '012')));
  A.state.month = T.normalizeMonth({ year: '02026', month: '011' }, rules);
  const before = dir.files.get('202611_data.json'), found = await A.findMonthData('202611');
  assert(found.mismatch); assert.strictEqual(await A.autosaveJson(), 'skipped');
  assert.strictEqual(dir.files.get('202611_data.json'), before); assert.deepStrictEqual(root.writes, []);
});
test('invalid dates retain admission rejection and state', () => {
  reset(); const before = JSON.stringify(A.state);
  for (const [year, month] of [[2026, 13], [2026, '11.5'], [2026, ''], [2026, ' '], [2026, true], [2026, []], [2026, {}], [26, 11], [0, 11], ['2026.5', 11]]) {
    const input = payload(year, month); assert.strictEqual(T.isValidMonth(input.month), false);
    A.applyLoaded(input, 'Synthetic invalid import', { fromFolder: false });
    assert.strictEqual(JSON.stringify(A.state), before);
  }
  assert.strictEqual(alerts.length, 10);
});
test('three-digit valid year has four-digit identity without changing admission', () => {
  assert(T.isValidMonth({ year: 100, month: 1 })); assert.strictEqual(A.tag({ year: '0100.0', month: '01' }), '010001');
});
test('larger years are not truncated or newly rejected (catalog limit out of scope)', () => {
  assert(T.isValidMonth({ year: 10000, month: 11 })); assert.strictEqual(A.tag({ year: '010000.0', month: '011' }), '1000011');
});
test('existing malformed directory is not automatically renamed or overwritten', async () => {
  const root = reset(), old = await root.getDirectoryHandle('2026011', { create: true });
  const raw = JSON.stringify(payload(2026, '011')); old.files.set('2026011_data.json', raw);
  A.state.month = T.normalizeMonth(payload(2026, '011').month, rules);
  assert.strictEqual(await A.autosaveJson(), 'saved');
  assert.strictEqual(old.files.get('2026011_data.json'), raw); assert.deepStrictEqual([...root.dirs.keys()], ['2026011', '202611']);
  assert.deepStrictEqual(root.writes, ['202611/202611_data.json']);
});
const EXPECTED = 16; let completed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('month tag test timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || completed !== EXPECTED || failed) process.exitCode = 1; });
(async () => {
  assert.strictEqual(tests.length, EXPECTED);
  for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } finally { completed++; clearTimeout(A.autosaveTimer); } }
  finished = true; clearTimeout(watchdog); console.log(`month tag identity: ${completed - failed}/${EXPECTED} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
