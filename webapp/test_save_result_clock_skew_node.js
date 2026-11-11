// A one-sided calculation update must survive even when the calculating PC clock is behind.
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
  vm.runInThisContext(fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
A.readAll = A.renderHeader = A.renderAll = A.showTab = A.clearUndo = A.toast = () => {};
T.plugins = { beginFolder() {}, stamp: () => [] };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const missing = () => Object.assign(new Error('synthetic file missing'), { name: 'NotFoundError' });
const fileName = '202611_data.json', baseAt = '2026-10-01T12:00:05.000Z';
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
  const rules = { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [{ name: 'Synthetic A', team: 'I' }, { name: 'Synthetic B', team: 'I' }] };
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




const cases = [];
for (const route of ['auto', 'manual', 'reconnect']) for (const changed of ['peer', 'mine']) {
  cases.push([`${route}: only ${changed} recalculated on a slower clock`, async () => {
    const f = setup();
    const baseline = { at: '2026-10-01T12:00:00.000Z', status: 'Optimal', asg: { '1:night': { work: 'Synthetic A', oc: [] } }, seconds: 1 };
    const recalculated = { ...clone(baseline), at: '2026-10-01T11:55:00.000Z', asg: { '1:night': { work: 'Synthetic B', oc: [] } }, seconds: 2 };
    A.state.result = clone(baseline); A.state.baseResult = clone(baseline);
    const peer = clone(f.oldData); peer.result = clone(baseline);
    // Both file timestamps differ from the common base; peers need not have synchronized clocks.
    peer.saved_at = '2026-10-01T11:55:05.000Z';
    if (changed === 'peer') peer.result = clone(recalculated); else A.state.result = clone(recalculated);
    peer.month.day_notes = { 7: 'synthetic peer note' };
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    let choices = 0; A.choose = async () => { choices++; return null; };
    if (route === 'reconnect') await A.reconcileWithFolder();
    else assert.strictEqual(await save(route), 'saved');
    assert.deepStrictEqual(A.state.result, recalculated, 'the changed calculation must win over the unchanged baseline');
    assert.strictEqual(A.state.month.notes, 'synthetic local edit');
    assert.strictEqual(A.state.month.day_notes[7], 'synthetic peer note');
    assert.strictEqual(choices, 0, 'one-sided calculation edits do not need a whole-version choice');
    if (route !== 'reconnect') assert.deepStrictEqual(JSON.parse(f.oldFolder.files.get(fileName)).result, recalculated, 'saved JSON must retain the new assignment');
    clearTimeout(A.autosaveTimer);
  }]);
}
for (const kind of ['both', 'legacy']) cases.push([`${kind}: retain existing newer-result policy for distinct save times`, async () => {
  const f = setup();
  const baseline = { at: '2026-10-01T10:00:00.000Z', asg: {}, seconds: 1 };
  A.state.baseResult = clone(baseline); A.state.result = { ...baseline, at: '2026-10-01T12:00:00.000Z', seconds: 2 };
  const peer = clone(f.oldData); peer.saved_at = '2026-10-01T13:00:00.000Z'; peer.result = { ...baseline, at: '2026-10-01T13:00:00.000Z', seconds: 3 };
  if (kind === 'legacy') delete A.state.baseResult;
  f.oldFolder.files.set(fileName, JSON.stringify(peer));
  assert.strictEqual(await save('auto'), 'saved'); assert.deepStrictEqual(A.state.result, peer.result);
  clearTimeout(A.autosaveTimer);
}]);

// Calculation completion may update only state.result while a merge choice is open.
// A winner selected before the await must not overwrite that newer local result.
for (const route of ['auto', 'manual', 'reconnect']) for (const sameSaveTime of [false, true]) for (const inPlace of [false, true]) {
  cases.push([`${route}: result ${inPlace ? 'mutated' : 'replaced'} during choice; equal save times=${sameSaveTime}`, async () => {
    const f = setup();
    const baseline = { at: '2026-10-01T12:00:00.000Z', status: 'Optimal', asg: { '1:night': { work: 'Synthetic A', oc: [] } }, seconds: 1 };
    const peerResult = { ...clone(baseline), at: '2026-10-01T11:55:00.000Z', asg: { '1:night': { work: 'Synthetic B', oc: [] } }, seconds: 2 };
    const newest = { ...clone(baseline), at: '2026-10-01T13:00:00.000Z', asg: { '2:night': { work: 'Synthetic B', oc: [] } }, seconds: 3 };
    A.state.result = clone(baseline); A.state.baseResult = clone(baseline);
    const peer = clone(f.oldData); peer.result = clone(peerResult);
    peer.saved_at = sameSaveTime ? baseAt : '2026-10-01T11:55:05.000Z';
    peer.month.notes = 'synthetic conflicting peer note';
    const peerText = JSON.stringify(peer); f.oldFolder.files.set(fileName, peerText);
    const oldMonth = JSON.stringify(A.state.month), oldBase = JSON.stringify(A.state.base), oldMeta = JSON.stringify(A.state.meta), oldSaveGen = A.saveGen;
    let choices = 0, cleared = 0; A.clearUndo = () => { cleared++; };
    A.choose = async (_msg, options) => {
      choices++; assert(options.some(o => o.value === 'theirs'), 'must pause at a per-item merge choice');
      await Promise.resolve();
      if (inPlace) Object.assign(A.state.result, clone(newest)); else A.state.result = clone(newest);
      return 'theirs';
    };
    if (route === 'reconnect') await A.reconcileWithFolder();
    else assert.strictEqual(await save(route), 'skipped', 'result changed while waiting: do not save the stale selection');
    clearTimeout(A.autosaveTimer);
    assert.strictEqual(choices, 1); assert.strictEqual(cleared, 0, 'must retain Undo');
    assert.deepStrictEqual(A.state.result, newest, 'do not overwrite the calculation that just completed');
    assert.strictEqual(f.oldFolder.files.get(fileName), peerText, 'do not write either stale side');
    assert.strictEqual(f.oldFolder.writes.length, 0);
    assert.strictEqual(JSON.stringify(A.state.month), oldMonth, 'must not partially merge the month');
    assert.strictEqual(JSON.stringify(A.state.base), oldBase, 'must retain the common month baseline');
    assert.deepStrictEqual(A.state.baseResult, baseline, 'must retain the common result baseline');
    assert.strictEqual(JSON.stringify(A.state.meta), oldMeta); assert.strictEqual(A.saveGen, oldSaveGen);
    // Retrying is allowed. Distinct save times retain newest-result behavior; an
    // equal-time ambiguous result uses the existing explicit whole-local choice.
    A.choose = async (_msg, options) => options.some(o => o.value === 'overwrite') ? 'overwrite' : 'theirs';
    assert.strictEqual(await save('auto'), 'saved');
    assert.deepStrictEqual(JSON.parse(f.oldFolder.files.get(fileName)).result, newest);
    assert.deepStrictEqual(A.state.result, newest); assert.strictEqual(A.isDirty(), false);
    clearTimeout(A.autosaveTimer); A.clearUndo = () => {};
  }]);
}

let finished = false;
process.on('exit', () => { if (!finished) { console.error('clock-skew tests did not complete'); process.exitCode = 1; } });
(async () => {
  let passed = 0, failed = 0;
  for (const [name, run] of cases) { try { await run(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } finally { clearTimeout(A.autosaveTimer); } }
  assert.strictEqual(cases.length, 20); finished = true;
  console.log(`${passed}/${cases.length} passed; ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
