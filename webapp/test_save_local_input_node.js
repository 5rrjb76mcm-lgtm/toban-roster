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
    name, files, writes, readHook: null,
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
          async write(blob) { files.set(n, typeof blob === 'string' ? blob : await blob.text()); writes.push(n); },
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



(async () => {
  for (const mode of ['auto', 'manual']) for (const phase of ['month', 'rules']) for (const change of ['import', 'input']) {
    const f = setup(), peer = clone(f.oldData);
    peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.notes = 'synthetic peer edit';
    if (phase === 'rules') { A.state.rules.weights.synthetic = 1; peer.rules.weights.synthetic = 2; }
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    const previous = { rules: clone(f.oldData.rules), month: { year: 2026, month: 10, history: { work_balance: { 'Synthetic A': 8 } }, fixed: { night: { 32: 'Synthetic A' } } }, result: null };
    f.oldFolder.files.set('202610_data.json', JSON.stringify(previous));
    const entered = gate(), release = gate(), choice = gate(), answer = gate();
    f.oldFolder.readHook = async n => { if (n === '202610_data.json') { entered.resolve(); await release.promise; } };
    A.refreshMonths = async () => {};
    A.renderSettingsMonth = A.renderDoctor = A.renderFixed = () => {};
    A.choose = async (msg, options) => { assert.ok(options.some(o => o.value === 'mine')); choice.resolve(); return answer.promise; };
    globalThis.alert = msg => { throw new Error(msg); };
    let importing;
    if (change === 'import') { importing = A.importPrevious(); await entered.promise; }
    const saving = save(mode); await choice.promise;
    if (importing) {
      release.resolve(); await importing;
      assert.strictEqual(A.state.month.history.work_balance['Synthetic A'], 8);
      assert.strictEqual(A.state.month.fixed.night[1], 'Synthetic A');
    } else A.state.month.notes = 'synthetic newer local input';
    clearTimeout(A.autosaveTimer);
    const before = JSON.stringify(A.state), diskBefore = f.oldFolder.files.get(fileName), label = `${mode}/${phase}/${change}`;
    answer.resolve('mine');
    assert.strictEqual(await saving, 'skipped', label + ': stale choice must not save');
    assert.strictEqual(JSON.stringify(A.state), before, label + ': preserve current inputs and sync base');
    assert.strictEqual(f.oldFolder.files.get(fileName), diskBefore, label + ': preserve peer file');
    assert.strictEqual(f.oldFolder.writes.length, 0, label + ': write nothing');
    assert.strictEqual(A.isDirty(), true);
    // Retrying against current inputs still merges and saves normally.
    A.choose = async () => 'mine';
    assert.strictEqual(await save(mode), 'saved', label + ': retry succeeds');
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    if (change === 'import') {
      assert.strictEqual(saved.month.history.work_balance['Synthetic A'], 8);
      assert.strictEqual(saved.month.fixed.night[1], 'Synthetic A');
    } else assert.strictEqual(saved.month.notes, 'synthetic newer local input');
    assert.strictEqual(A.isDirty(), false); clearTimeout(A.autosaveTimer);
    console.log('ok ' + label);
  }
})().catch(e => { clearTimeout(A.autosaveTimer); console.error(e); process.exitCode = 1; });
