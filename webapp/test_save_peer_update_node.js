// A second window can update the monthly JSON while this window awaits document generation.
// Keep that update and let the next ordinary save reconcile it. Synthetic, in-memory files only.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elements = new Map(), element = s => {
  if (!elements.has(s)) elements.set(s, { value: '確認版', innerHTML: '', textContent: '', className: '', addEventListener() {} });
  return elements.get(s);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/peer-update.html', protocol: 'file:', href: 'file:///synthetic/peer-update.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
A.readAll = A.renderHeader = A.renderAll = A.showTab = A.clearUndo = () => {};
A.choose = async () => { throw new Error('Unrelated edits must merge without a choice'); };
T.check = () => ({ V: [] }); T.lintPlugins = () => []; T.plugins = { beginFolder() {}, stamp: () => [] };
A.reportHtml = (P, label, S) => 'synthetic report: ' + S.month.notes;
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const missing = () => Object.assign(new Error('synthetic missing file'), { name: 'NotFoundError' });
const dataName = '202611_data.json', at = '2026-10-01T00:00:00.000Z';
function setup() {
  clearTimeout(A.autosaveTimer);
  const rules = { profile: { id: 'synthetic-peer-update' }, doctors: [{ name: 'Synthetic A', team: 'I' }] };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, notes: 'synthetic original' }, rules), result = { asg: {}, plugins: [] };
  const original = { rules: clone(rules), month: clone(month), result: clone(result), saved_at: at };
  const files = new Map([[dataName, JSON.stringify(original)]]), writes = [], toasts = [];
  const folder = {
    name: 'synthetic-folder', unreadable: false, directoryHook: null,
    async *entries() { yield ['202611', { kind: 'directory' }]; },
    async getDirectoryHandle(name, options = {}) {
      if (name === 'plugins') throw missing();
      if (options.create && this.directoryHook) await this.directoryHook();
      return folder;
    },
    async getFileHandle(name, options = {}) {
      if (!options.create && name === dataName && folder.unreadable) throw Object.assign(new Error('synthetic read failure'), { name: 'NotReadableError' });
      if (!options.create && !files.has(name)) throw missing();
      return { getFile: async () => ({ text: async () => files.get(name) }), createWritable: async () => ({
        async write(blob) { files.set(name, typeof blob === 'string' ? blob : await blob.text()); writes.push(name); }, async close() {}
      }) };
    }
  };
  Object.assign(A.state, { rules, month, result, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = folder; A.dirGen++; A.monthDirs = ['202611']; A.markSaved(undefined, at);
  A.state.month.notes = 'synthetic local change'; A.toast = s => toasts.push(String(s));
  T.makeDocx = async () => new Blob(['synthetic roster']);
  return { original, files, writes, toasts, folder };
}
async function delayedSave(f, mode, during, generation = 1) {
  const entered = gate(), release = gate();
  let calls = 0;
  if (mode === 'manual') T.makeDocx = async () => { if (++calls === generation) { entered.resolve(); await release.promise; } return new Blob(['synthetic roster']); };
  else f.folder.directoryHook = async () => { f.folder.directoryHook = null; entered.resolve(); await release.promise; };
  const saving = mode === 'manual' ? A.saveToFolder() : A.autosaveJson();
  await entered.promise; during(); release.resolve();
  return saving;
}
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message.split('\n')[0]); } }
(async () => {
  for (const mode of ['manual', 'auto']) {
    await test(mode + ': preserve a peer edit made after conflict checking', async () => {
      const f = setup(), before = JSON.stringify(A.state), peer = clone(f.original);
      peer.month.holidays = [3]; peer.saved_at = '2026-10-02T00:00:00.000Z';
      const text = JSON.stringify(peer), status = await delayedSave(f, mode, () => f.files.set(dataName, text));
      assert.notStrictEqual(status, 'saved', 'a stale snapshot must not be reported as saved');
      assert.strictEqual(f.files.get(dataName), text, 'preserve the peer JSON byte for byte');
      assert.strictEqual(JSON.stringify(A.state), before, 'keep input, results and synchronization state');
      assert.strictEqual(f.writes.length, 0, 'stop before backups or documents are written');
      assert(A.isDirty()); assert(f.toasts.length);
      // The normal retry sees the peer revision and uses the existing three-way merge.
      T.makeDocx = async () => new Blob(['synthetic roster']);
      const retry = mode === 'manual' ? await A.saveToFolder() : await A.autosaveJson();
      assert.strictEqual(retry, 'saved');
      const saved = JSON.parse(f.files.get(dataName));
      assert.strictEqual(saved.month.notes, 'synthetic local change'); assert.deepStrictEqual(saved.month.holidays, [3]);
      assert.strictEqual(A.isDirty(), false);
    });
  }
  await test('manual: a newly created peer file is not overwritten', async () => {
    const f = setup(); f.files.delete(dataName);
    const peer = clone(f.original); peer.month.holidays = [3];
    const text = JSON.stringify(peer), before = JSON.stringify(A.state);
    const status = await delayedSave(f, 'manual', () => f.files.set(dataName, text));
    assert.notStrictEqual(status, 'saved'); assert.strictEqual(f.files.get(dataName), text);
    assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(f.writes.length, 0);
  });
  await test('manual: a file that becomes unreadable is not overwritten', async () => {
    const f = setup(), before = JSON.stringify(A.state), text = f.files.get(dataName);
    const status = await delayedSave(f, 'manual', () => { f.folder.unreadable = true; });
    assert.notStrictEqual(status, 'saved'); assert.strictEqual(f.files.get(dataName), text);
    assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(f.writes.length, 0);
  });
  await test('manual: local edits during generation remain dirty after saving the snapshot', async () => {
    const f = setup();
    const status = await delayedSave(f, 'manual', () => { A.state.month.notes = 'synthetic later local edit'; });
    assert.strictEqual(status, 'saved'); assert.strictEqual(JSON.parse(f.files.get(dataName)).month.notes, 'synthetic local change');
    assert.strictEqual(A.state.month.notes, 'synthetic later local edit'); assert.strictEqual(A.isDirty(), true);
  });
  for (const phase of ['renumber', 'reuse-renumber', 'missing-document']) await test('manual: peer update during ' + phase + ' preserves its JSON and documents', async () => {
    const f = setup(); let generation = 1, ver = 1;
    if (phase === 'renumber') { f.files.set(A.FILES.roster('202611', 1, '確認版'), 'synthetic orphan'); generation = 2; ver = 2; }
    else {
      assert.strictEqual(await A.saveToFolder(), 'saved');
      A.state.result.seconds = 2; // the JSON needs saving; the existing document signature is unchanged
      if (phase === 'missing-document') f.files.delete(A.FILES.report('202611', 1, '確認版'));
      else {
        const old = JSON.parse(f.files.get(dataName)); old.month.doc_versions[0].sig = 'synthetic-other-document';
        f.files.set(dataName, JSON.stringify(old)); // forces the reuse path to allocate another version
        ver = 2;
      }
    }
    const before = JSON.stringify(A.state), peer = JSON.parse(f.files.get(dataName));
    peer.month.holidays = [3]; peer.saved_at = '2026-10-02T00:00:00.000Z';
    const roster = A.FILES.roster('202611', ver, '確認版'), report = A.FILES.report('202611', ver, '確認版');
    peer.month.doc_versions = [{ ver, sig: 'synthetic-peer-document', docx: roster, html: report }];
    const text = JSON.stringify(peer), status = await delayedSave(f, 'manual', () => {
      f.files.set(dataName, text); f.files.set(roster, 'synthetic peer roster'); f.files.set(report, 'synthetic peer report');
    }, generation);
    assert.notStrictEqual(status, 'saved'); assert.strictEqual(f.files.get(dataName), text);
    assert.strictEqual(f.files.get(roster), 'synthetic peer roster'); assert.strictEqual(f.files.get(report), 'synthetic peer report');
    assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(A.isDirty(), true);
  });
  await test('manual: an unreadable JSON after opening the destination does not become a missing file', async () => {
    const f = setup(), text = f.files.get(dataName), before = JSON.stringify(A.state);
    f.folder.directoryHook = async () => { f.folder.directoryHook = null; f.folder.unreadable = true; };
    assert.notStrictEqual(await A.saveToFolder(), 'saved'); assert.strictEqual(f.files.get(dataName), text);
    assert.strictEqual(f.writes.length, 0); assert.strictEqual(JSON.stringify(A.state), before);
  });
  clearTimeout(A.autosaveTimer);
  console.log(`peer update saves: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(A.autosaveTimer); console.error(e.stack || e); process.exitCode = 1; });
