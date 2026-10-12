// Actual autosave timer / header-save entries and rendered header, using synthetic in-memory FS.
// No real roster data or browser/FS dependency. Override TOBAN_SAVE_FOLDER_SOURCE for old-fail evidence.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elems = new Map(), el = key => {
  if (!elems.has(key)) elems.set(key, { value: '確認版', innerHTML: '', textContent: '', className: '', hidden: false,
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
  return elems.get(key);
};
globalThis.document = { querySelector: el, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/toban.html', protocol: 'file:', href: 'file:///synthetic/toban.html' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_SAVE_FOLDER_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, 'lang/ja.json'), 'utf8'))); T.setLang('ja');
const A = T.app;
const toasts = []; A.readAll = A.renderAll = () => {}; A.toast = x => { toasts.push(String(x)); }; A.choose = async () => null;
T.plugins = { beginFolder() {}, stamp: () => [] };
const missing = () => Object.assign(new Error('synthetic missing'), { name: 'NotFoundError' });
const denied = () => Object.assign(new Error('synthetic denied'), { name: 'NotAllowedError' });
const gate = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), get resolve() { return resolve; } }; };
function folder(name) {
  const dirs = new Map(), files = new Map();
  const root = { name, kind: 'directory', dirs, files, writes: [], fail: null, beforeClose: null,
    async *entries() { for (const entry of dirs) yield entry; },
    async getDirectoryHandle(n, options = {}) {
      if (!dirs.has(n)) { if (!options.create) throw missing(); if (root.fail === 'permission') throw denied(); dirs.set(n, directory(n)); }
      return dirs.get(n);
    },
    async getFileHandle(n, options = {}) { return fileHandle(files, n, options); }
  };
  function directory(name) { const files = new Map(); return { name, kind: 'directory', files, getFileHandle: (n, o = {}) => fileHandle(files, n, o) }; }
  async function fileHandle(files, n, options) {
    if (!options.create && !files.has(n)) throw missing();
    return { getFile: async () => ({ text: async () => files.get(n) }), createWritable: async () => {
      if (root.fail === 'open') throw denied();
      let staged;
      return { async write(blob) { if (root.fail === 'write') throw new Error('synthetic write failure'); staged = typeof blob === 'string' ? blob : await blob.text(); },
        async close() { if (root.beforeClose) await root.beforeClose(n); if (root.fail === 'close') throw new Error('synthetic close failure'); files.set(n, staged); root.writes.push(n); if (root.fail === 'ambiguous') throw new Error('synthetic uncertain close'); } };
    } };
  }
  return root;
}
function reset(root = folder('synthetic root')) {
  clearTimeout(A.autosaveTimer);
  Object.assign(A.state, { rules: { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [{ name: 'Synthetic A', team: 'I' }] }, month: { year: 2026, month: 11, notes: 'synthetic saved content' }, result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = root; A.dirGen++; A.monthDirs = []; A.renderHeader(); return root;
}
function option(tag) {
  const match = el('#monthTitle').innerHTML.match(new RegExp('<option value="' + tag + '"[^>]*>([^<]*)</option>', 'g')) || [];
  assert.strictEqual(match.length, 1, 'exactly one option per month'); return match[0];
}
const savedFile = (root, tag = '202611') => JSON.parse(root.dirs.get(tag).files.get(tag + '_data.json'));
// Exercise A.save's actual scheduled autosave callback, without a three-second wait.
async function timerSave() {
  const original = globalThis.setTimeout; let callback;
  globalThis.setTimeout = (fn, delay) => { assert.strictEqual(delay, 3000); callback = fn; return 123; };
  try { A.save(); } finally { globalThis.setTimeout = original; }
  assert.ok(callback, 'dirty connected edit schedules autosave'); return callback();
}
const entry = mode => mode === 'auto' ? timerSave() : el('#btnHeaderSave').listeners.click();
const tests = [], test = (name, fn) => tests.push([name, fn]);
for (const mode of ['auto', 'header']) {
  test(mode + ': first save, other month, repeat and persisted content', async () => {
    const root = reset(); await root.getDirectoryHandle('202610', { create: true }); A.monthDirs = ['202610']; A.renderHeader(); assert.match(option('202611'), /未保存/);
    assert.strictEqual(await entry(mode), 'saved');
    assert.doesNotMatch(option('202611'), /未保存/); assert.strictEqual(el('#saveState').className, 'saved');
    assert.deepStrictEqual(A.monthDirs, ['202610', '202611']); assert.strictEqual(savedFile(root).month.notes, 'synthetic saved content');
    A.state.month.notes = 'synthetic second edit'; A.renderHeader(); assert.strictEqual(await entry(mode), 'saved');
    assert.deepStrictEqual(A.monthDirs, ['202610', '202611']); assert.strictEqual(savedFile(root).month.notes, 'synthetic second edit');
    assert.strictEqual(await A.autosaveJson(), 'skipped'); assert.deepStrictEqual(A.monthDirs, ['202610', '202611']);
  });
  for (const failure of ['permission', 'open', 'write', 'close', 'ambiguous']) test(mode + ': ' + failure + ' never publishes success', async () => {
    const root = reset(); root.fail = failure; assert.strictEqual(await entry(mode), 'failed');
    assert.deepStrictEqual(A.monthDirs, []); assert.match(option('202611'), /未保存/); assert.strictEqual(A.isDirty(), true);
    assert.strictEqual(A.state.meta, null); assert.strictEqual(A.state.month.notes, 'synthetic saved content');
    if (failure === 'ambiguous') assert.strictEqual(savedFile(root).month.notes, 'synthetic saved content', 'uncertain result does not claim success even if disk changed');
  });
  for (const change of ['edit', 'month', 'folder', 'reconnect']) test(mode + ': in-flight ' + change, async () => {
    const root = reset(), entered = gate(), release = gate();
    root.beforeClose = async () => { entered.resolve(); await release.promise; };
    const saving = entry(mode); await entered.promise;
    if (change === 'edit') A.state.month.notes = 'synthetic later draft';
    if (change === 'month') A.state.month = { year: 2026, month: 12, notes: 'synthetic current month draft' };
    if (change === 'folder' || change === 'reconnect') { A.dirHandle = change === 'folder' ? folder('new root') : root; A.dirGen++; A.monthDirs = ['202609']; }
    A.renderHeader(); release.resolve(); assert.strictEqual(await saving, 'saved');
    assert.strictEqual(savedFile(root).month.notes, 'synthetic saved content');
    assert.strictEqual(A.isDirty(), true, 'later/current draft is never marked saved');
    if (change === 'folder' || change === 'reconnect') assert.deepStrictEqual(A.monthDirs, ['202609']);
    else { assert.deepStrictEqual(A.monthDirs, ['202611']); assert.doesNotMatch(option('202611'), /未保存/); }
    if (change === 'month') { assert.match(option('202612'), /未保存/); assert.strictEqual(A.state.month.notes, 'synthetic current month draft'); }
    if (change === 'edit') assert.strictEqual(A.state.month.notes, 'synthetic later draft');
  });
}
for (const mode of ['auto', 'header']) test(mode + ': current-month bookkeeping precedes every header render', async () => {
  const root = reset(), title = el('#monthTitle'); let html = title.innerHTML, renders = 0;
  Object.defineProperty(title, 'innerHTML', { configurable: true, get: () => html, set(value) {
    renders++;
    // A renderer that cannot handle a half-committed save must not prevent saved bookkeeping.
    if (!A.state.meta) throw new Error('synthetic premature precommit render');
    html = value;
  } });
  try {
    const result = await (mode === 'auto' ? A.autosaveJson() : entry(mode));
    // How often the header is drawn is an implementation detail (a manual save also lists the folder again).
    // What matters: it is never drawn from a half-committed save (the setter above throws), and the result is right.
    assert.strictEqual(result, 'saved'); assert.ok(renders >= 1, 'the header was drawn after the commit');
    assert.strictEqual(A.isDirty(), false); assert.strictEqual(el('#saveState').className, 'saved'); assert.doesNotMatch(option('202611'), /未保存/); assert.deepStrictEqual(A.monthDirs, ['202611']);
    assert.strictEqual(savedFile(root).month.notes, 'synthetic saved content');
  } finally { Object.defineProperty(title, 'innerHTML', { configurable: true, writable: true, value: html }); }
});
// A manual save lists the folder again, so that months saved by another window or PC show up (as before 5a2ef07).
const otherWindowSaves = async (root, tag) => { const d = await root.getDirectoryHandle(tag, { create: true }); d.files.set(tag + '_data.json', JSON.stringify({ rules: A.state.rules, month: { year: +tag.slice(0, 4), month: +tag.slice(4), notes: 'synthetic other window' }, result: null, saved_at: '2026-10-02T00:00:00.000Z' })); };
// The kept failed-save record lives in the module; earlier cases in this file leave records behind, so dismiss them first.
const failureRecord = () => el('#saveFail').innerHTML, dismissFailureRecords = () => { const ok = el('#saveFailOk').listeners.click; if (failureRecord() && ok) ok(); assert.strictEqual(failureRecord(), ''); };
test('header: a month saved by another window appears after a manual save; an autosave alone does not list', async () => {
  const root = reset(); assert.strictEqual(await entry('header'), 'saved'); assert.deepStrictEqual(A.monthDirs, ['202611']);
  await otherWindowSaves(root, '202612'); A.state.month.notes = 'synthetic edit after the other window saved'; A.renderHeader();
  assert.strictEqual(await timerSave(), 'saved'); assert.deepStrictEqual(A.monthDirs, ['202611'], 'the JSON-only autosave keeps the list as it was');
  A.state.month.notes = 'synthetic edit before the manual save'; A.renderHeader(); assert.strictEqual(await entry('header'), 'saved');
  assert.deepStrictEqual(A.monthDirs, ['202611', '202612']); assert.doesNotMatch(option('202612'), /未保存|作成/, 'December is listed as a saved month');
  assert.doesNotMatch(option('202611'), /未保存/); assert.strictEqual(el('#saveState').className, 'saved'); assert.strictEqual(A.isDirty(), false);
  assert.strictEqual(savedFile(root).month.notes, 'synthetic edit before the manual save'); assert.strictEqual(savedFile(root, '202612').month.notes, 'synthetic other window', 'the other month is untouched');
});
test('header: a listing that fails after the month data was written is not a save failure', async () => {
  const root = reset(); A.monthDirs = ['202610']; A.renderHeader(); toasts.length = 0; dismissFailureRecords();
  root.entries = async function* () { throw denied(); };
  assert.strictEqual(await entry('header'), 'saved', 'the save itself succeeded');
  assert.strictEqual(savedFile(root).month.notes, 'synthetic saved content'); assert.strictEqual(A.isDirty(), false); assert.strictEqual(el('#saveState').className, 'saved');
  assert.deepStrictEqual(A.monthDirs, ['202610', '202611'], 'the previous list stays, with the month just saved'); assert.doesNotMatch(option('202611'), /未保存/);
  assert.strictEqual(failureRecord(), '', 'no failed-save record'); assert.ok(!toasts.some(x => /保存できませんでした|失敗/.test(x)), 'no failure is announced: ' + toasts.join(' | ')); assert.ok(toasts.some(x => /フォルダに保存しました/.test(x)));
});
test('header: an older scan still running cannot replace the list made by the save, and the save keeps its own month', async () => {
  const root = reset(), entered = gate(), release = gate(); await otherWindowSaves(root, '202612');
  const listAll = root.entries.bind(root);
  root.entries = async function* () { yield ['202608', { kind: 'directory' }]; entered.resolve(); await release.promise; yield ['202609', { kind: 'directory' }]; };
  const scan = A.refreshMonths(); await entered.promise; root.entries = listAll;
  assert.strictEqual(await entry('header'), 'saved'); assert.deepStrictEqual(A.monthDirs, ['202611', '202612']);
  release.resolve(); await scan; assert.deepStrictEqual(A.monthDirs, ['202611', '202612'], 'the older scan is discarded'); assert.doesNotMatch(option('202611'), /未保存/);
});
test('stale folder enumeration cannot replace the new folder catalog', async () => {
  const root = reset(), entered = gate(), release = gate();
  root.entries = async function* () { yield ['202608', { kind: 'directory' }]; entered.resolve(); await release.promise; yield ['202609', { kind: 'directory' }]; };
  const scan = A.refreshMonths(); await entered.promise;
  const next = folder('new folder'); await next.getDirectoryHandle('202610', { create: true }); A.dirHandle = next; A.dirGen++;
  await A.refreshMonths(); release.resolve(); await scan;
  assert.deepStrictEqual(A.monthDirs, ['202610']); assert.match(option('202611'), /未保存/);
});
test('scan started before successful save cannot erase newly saved month', async () => {
  const root = reset(), entered = gate(), release = gate();
  let pluginStarts = 0; T.plugins.beginFolder = () => { pluginStarts++; };
  root.entries = async function* () { yield ['202610', { kind: 'directory' }]; entered.resolve(); await release.promise; };
  const scan = A.refreshMonths(); await entered.promise;
  assert.strictEqual(await timerSave(), 'saved'); release.resolve(); await scan;
  assert.strictEqual(pluginStarts, 1, 'initial folder plugins still initialize');
  assert.deepStrictEqual(A.monthDirs, ['202610', '202611']); assert.doesNotMatch(option('202611'), /未保存/);
});
test('stale failed enumeration does not report a new-folder failure', async () => {
  const root = reset(), entered = gate(), release = gate();
  root.entries = async function* () { entered.resolve(); await release.promise; throw denied(); };
  const scan = A.refreshMonths(); await entered.promise;
  A.dirHandle = folder('new folder'); A.dirGen++; A.monthDirs = ['202610'];
  release.resolve(); await scan; assert.deepStrictEqual(A.monthDirs, ['202610']);
});
test('a slower earlier scan cannot replace a newer catalog', async () => {
  const root = reset(), entered = gate(), release = gate();
  root.entries = async function* () { entered.resolve(); await release.promise; yield ['202608', { kind: 'directory' }]; };
  const scan = A.refreshMonths(); await entered.promise;
  root.entries = async function* () { yield ['202610', { kind: 'directory' }]; };
  await A.refreshMonths(); release.resolve(); await scan; assert.deepStrictEqual(A.monthDirs, ['202610']);
});
test('failed enumeration preserves the complete previous catalog', async () => {
  const root = reset(); A.monthDirs = ['202609'];
  root.entries = async function* () { yield ['202610', { kind: 'directory' }]; throw denied(); };
  await assert.rejects(A.refreshMonths(), /synthetic denied/); assert.deepStrictEqual(A.monthDirs, ['202609']);
});
// The run must reach its end: if a step never settles Node simply drains the event loop and would exit 0.
// The exit hook turns "not every case ran", "the list of cases shrank" and "any case failed" into a non-zero status.
const EXPECTED_CASES = 30; let ran = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || ran !== tests.length || tests.length !== EXPECTED_CASES) { console.error(`NOT COMPLETED: ${ran}/${tests.length} cases ran (expected ${EXPECTED_CASES}), ${failed} failed, finished=${finished}`); process.exitCode = 1; }
  else if (failed) process.exitCode = 1;
});
(async () => { for (const [name, fn] of tests) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } ran++; }
  clearTimeout(A.autosaveTimer); console.log(`${tests.length - failed}/${tests.length} save/catalog cases passed`); finished = true;
})();
