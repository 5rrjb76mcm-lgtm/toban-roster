// Same-month input changes while a save/merge choice is pending must not be lost.
// Synthetic data and in-memory files only.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elems = new Map(), element = key => {
  if (!elems.has(key)) elems.set(key, { value: '確認版', innerHTML: '', textContent: '', className: '', hidden: false, addEventListener() {} });
  return elems.get(key);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/toban.html', protocol: 'file:', href: 'file:///synthetic/toban.html' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = { esc: String };
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js', 'app-month.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
A.readAll = A.renderHeader = A.renderAll = A.showTab = A.clearUndo = A.toast = () => {};
T.plugins = { beginFolder() {}, stamp: () => [] };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const missing = () => Object.assign(new Error('synthetic file missing'), { name: 'NotFoundError' });
const fileName = '202611_data.json', baseAt = '2026-10-01T00:00:00.000Z';
function folder(name, data) {
  const files = new Map([[fileName, JSON.stringify(data)]]), writes = [];
  const dir = {
    name, files, writes, readHook: null, failWrite: false,
    async *entries() { yield ['202611', { kind: 'directory' }]; },
    async getDirectoryHandle(n) { if (n === 'plugins') throw missing(); return dir; },
    async getFileHandle(n, options = {}) {
      if (!options.create && !files.has(n)) throw missing();
      return {
        getFile: async () => ({ text: async () => {
          const text = files.get(n);
          if (dir.readHook) await dir.readHook(n);
          return text;
        } }),
        createWritable: async () => ({
          async write(blob) { if (dir.failWrite) throw new Error('synthetic write failure'); files.set(n, typeof blob === 'string' ? blob : await blob.text()); writes.push(n); },
          async close() {}
        })
      };
    }
  };
  return dir;
}
function pauseRead(dir) {
  const entered = gate(), release = gate();
  dir.readHook = async n => { if (n === fileName) { dir.readHook = null; entered.resolve(); await release.promise; } };
  return { entered: entered.promise, release: release.resolve };
}
function setup() {
  clearTimeout(A.autosaveTimer);
  const rules = { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [{ name: 'Synthetic A', team: 'I' }] };
  T.fillDefaultRules(rules);
  const month = { year: 2026, month: 11, notes: 'synthetic base', next_first_day_in_calendar: true };
  T.normalizeMonth(month, rules);
  const oldData = { rules, month, result: null, saved_at: baseAt };
  const newData = clone(oldData); newData.month.notes = 'synthetic other folder'; newData.saved_at = '2026-10-02T00:00:00.000Z';
  const oldFolder = folder('synthetic-old', oldData), newFolder = folder('synthetic-new', newData);
  Object.assign(A.state, { rules: clone(rules), month: clone(month), result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = oldFolder; A.dirGen++; A.monthDirs = ['202611'];
  A.markSaved(undefined, baseAt); A.state.month.notes = 'synthetic local edit';
  A.choose = async () => null;
  return { oldFolder, newFolder, oldData, newData };
}
const save = mode => mode === 'manual' ? A.saveToFolder() : A.autosaveJson();



let finished = false;
process.on('exit', () => { if (!finished) { console.error('same-timestamp tests did not complete'); process.exitCode = 1; } });
(async () => {
  for (const mode of ['auto', 'manual']) {
    const f = setup(), peer = clone(f.oldData);
    peer.month.day_notes = { 7: 'synthetic peer note' }; // same saved_at, different content
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    assert.strictEqual(await save(mode), 'saved', mode);
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.month.notes, 'synthetic local edit', mode);
    assert.strictEqual(saved.month.day_notes['7'], 'synthetic peer note', mode + ': peer edit lost');
    assert.strictEqual(A.isDirty(), false); clearTimeout(A.autosaveTimer);
    console.log('ok save ' + mode);
  }
  {
    const f = setup(), peer = clone(f.oldData); let choices = 0;
    peer.month.notes = 'synthetic conflicting peer note';
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    A.choose = async (_msg, opts) => { choices++; assert(opts.some(x => x.value === 'theirs')); return 'theirs'; };
    assert.strictEqual(await save('auto'), 'saved');
    assert.strictEqual(choices, 1, 'conflicting same-time changes require a choice');
    assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).month.notes, peer.month.notes);
    clearTimeout(A.autosaveTimer);
    console.log('ok same-time conflict choice');
  }
  {
    const f = setup(), peer = clone(f.oldData);
    peer.rules.weights.target_deviation = 99;
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    assert.strictEqual(await save('auto'), 'saved');
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.rules.weights.target_deviation, 99, 'peer rules change survives');
    assert.strictEqual(saved.month.notes, 'synthetic local edit');
    clearTimeout(A.autosaveTimer);
    console.log('ok rules-only peer change');
  }
  {
    const f = setup(); let choices = 0;
    A.choose = async () => { choices++; throw new Error('same saved snapshot must not prompt'); };
    assert.strictEqual(await save('auto'), 'saved');
    assert.strictEqual(choices, 0);
    assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).month.notes, 'synthetic local edit');
    clearTimeout(A.autosaveTimer);
    console.log('ok identical saved snapshot');
  }
  {
    const f = setup(), peer = clone(f.oldData);
    delete A.state.baseResult; // browser state created by an older version
    peer.month.day_notes = { 8: 'synthetic legacy peer note' };
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    assert.strictEqual(await save('auto'), 'saved');
    assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).month.day_notes['8'], 'synthetic legacy peer note');
    clearTimeout(A.autosaveTimer);
    console.log('ok legacy missing result baseline');
  }
  {
    const f = setup(), peer = clone(f.oldData);
    peer.month.day_notes = { 9: 'synthetic reconnect note' };
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    await A.reconcileWithFolder();
    assert.strictEqual(A.state.month.notes, 'synthetic local edit');
    assert.strictEqual(A.state.month.day_notes['9'], 'synthetic reconnect note');
    assert.strictEqual(A.isDirty(), true, 'merged input remains pending until saved');
    clearTimeout(A.autosaveTimer);
    console.log('ok reconnect dirty');
  }
  {
    const f = setup(), peer = clone(f.oldData);
    A.state.month.notes = 'synthetic base'; // no local changes
    peer.month.notes = 'synthetic peer replacement';
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    await A.reconcileWithFolder();
    assert.strictEqual(A.state.month.notes, 'synthetic peer replacement', 'reconnect must load changed same-time file');
    clearTimeout(A.autosaveTimer);
    console.log('ok reconnect clean');
  }
  for (const [kind, mineSeconds, peerSeconds] of [['peer', 1, 2], ['mine', 2, 1], ['same', 2, 2], ['both', 2, 3], ['legacy', 1, 2]]) {
    const f = setup(), baseResult = { at: '2026-11-01T00:00:00.000Z', asg: {}, seconds: 1 };
    A.state.baseResult = clone(baseResult); A.state.result = { ...baseResult, seconds: mineSeconds };
    f.oldData.result = clone(baseResult); const peer = clone(f.oldData); peer.result.seconds = peerSeconds;
    if (kind === 'legacy') delete A.state.baseResult;
    const peerText = JSON.stringify(peer); f.oldFolder.files.set(fileName, peerText);
    let choices = 0; A.choose = async (_msg, opts) => { choices++; assert(opts.some(x => x.value === 'overwrite')); return null; };
    const status = await save('auto');
    if (kind === 'both' || kind === 'legacy') {
      assert.strictEqual(status, 'skipped', kind); assert.strictEqual(choices, 1);
      assert.strictEqual(f.oldFolder.files.get(fileName), peerText, 'no write when result winner unknown');
      assert.strictEqual(A.state.result.seconds, mineSeconds); assert.strictEqual(f.oldFolder.writes.length, 0);
    } else {
      assert.strictEqual(status, 'saved', kind); assert.strictEqual(choices, 0);
      assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).result.seconds, kind === 'peer' ? peerSeconds : mineSeconds, kind);
    }
    clearTimeout(A.autosaveTimer); console.log('ok same-time result ' + kind);
  }
  {
    const f = setup(), baseResult = { at: '2026-11-01T00:00:00.000Z', asg: {}, seconds: 1 };
    A.state.baseResult = clone(baseResult); A.state.result = clone(baseResult);
    const peer = clone(f.oldData); peer.result = { ...baseResult, seconds: 2 };
    f.oldFolder.files.set(fileName, JSON.stringify(peer)); f.oldFolder.failWrite = true;
    assert.strictEqual(await save('auto'), 'failed');
    assert.strictEqual(A.state.result.seconds, 2); assert.strictEqual(A.state.baseResult.seconds, 2);
    assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).result.seconds, 2);
    f.oldFolder.failWrite = false;
    assert.strictEqual(await save('auto'), 'saved');
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.result.seconds, 2); assert.strictEqual(saved.month.notes, 'synthetic local edit');
    clearTimeout(A.autosaveTimer); console.log('ok failed write and retry');
  }
  {
    const f = setup(), peer = clone(f.oldData);
    peer.result = { at: '2026-11-01T00:00:00.000Z', asg: {} };
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    assert.strictEqual(await save('auto'), 'saved');
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.deepStrictEqual(saved.result, peer.result, 'same-time result-only peer change must survive');
    clearTimeout(A.autosaveTimer);
    console.log('ok result only');
  }
  // ---- a file an older writer wrote (empty defaults omitted, no result key, other key order) is still the saved version after it is loaded
  globalThis.alert = m => { throw new Error('alert: ' + m); };
  const olderShape = o => { const x = clone(o); for (const k of Object.keys(x.month)) { const v = x.month[k]; if (v === null || v === false || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) delete x.month[k]; } x.month = Object.fromEntries(Object.entries(x.month).reverse()); delete x.result; return x; };
  const loadFromFolder = (f, text) => { // as the folder open / reconnect path does: applyLoaded -> markSaved with the file's saved_at
    Object.assign(A.state, { rules: clone(f.oldData.rules), month: clone(f.oldData.month), result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] }); delete A.state.baseResult;
    A.applyLoaded(JSON.parse(text), 'synthetic load'); clearTimeout(A.autosaveTimer); assert.strictEqual(A.isDirty(), false, 'loaded state is clean'); };
  const counting = () => { const c = { toasts: [], undoCleared: 0, chooses: 0 }; A.toast = m => { c.toasts.push(String(m)); }; A.clearUndo = () => { c.undoCleared++; }; A.choose = async () => { c.chooses++; return null; }; return c; };
  const uncount = () => { A.toast = () => {}; A.clearUndo = () => {}; };
  {
    const f = setup(), text = JSON.stringify(olderShape(f.oldData)); f.oldFolder.files.set(fileName, text); loadFromFolder(f, text);
    const c = counting(); A.state.month.notes = 'synthetic edit after load'; A.save(); clearTimeout(A.autosaveTimer);
    assert.strictEqual(await save('auto'), 'saved'); const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.month.notes, 'synthetic edit after load'); assert.strictEqual(c.undoCleared, 0, 'no Undo clearing: the older-shape file is the saved version'); assert.strictEqual(c.chooses, 0); assert.deepStrictEqual(c.toasts, [], 'no merge announcement');
    assert.strictEqual(A.isDirty(), false); clearTimeout(A.autosaveTimer); uncount(); console.log('ok older-shape file is the saved version');
  }
  {
    const f = setup(), text = JSON.stringify(olderShape(f.oldData)); f.oldFolder.files.set(fileName, text); loadFromFolder(f, text);
    const peer = olderShape(f.oldData); peer.month.day_notes = { 7: 'synthetic peer note after load' }; f.oldFolder.files.set(fileName, JSON.stringify(peer)); // same saved_at, a real change, older shape
    const c = counting(); A.state.month.notes = 'synthetic edit after load'; A.save(); clearTimeout(A.autosaveTimer);
    assert.strictEqual(await save('auto'), 'saved'); const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.month.notes, 'synthetic edit after load'); assert.strictEqual(saved.month.day_notes['7'], 'synthetic peer note after load', 'a peer change in an older-shape file is still merged'); assert.strictEqual(c.chooses, 0);
    clearTimeout(A.autosaveTimer); uncount(); console.log('ok older-shape file with a same-time peer change merges');
  }
  {
    const f = setup(), text = JSON.stringify(olderShape(f.oldData)); f.oldFolder.files.set(fileName, text); loadFromFolder(f, text);
    const c = counting(), before = JSON.stringify(A.state.month); await A.reconcileWithFolder();
    assert.strictEqual(JSON.stringify(A.state.month), before, 'clean reconnect keeps the loaded state'); assert.strictEqual(c.undoCleared, 0); assert.deepStrictEqual(c.toasts, [], 'no reload announcement'); assert.strictEqual(A.isDirty(), false);
    clearTimeout(A.autosaveTimer); uncount(); console.log('ok older-shape file clean reconnect');
  }
  finished = true;
})().catch(e => { clearTimeout(A.autosaveTimer); console.error(e); process.exitCode = 1; });
