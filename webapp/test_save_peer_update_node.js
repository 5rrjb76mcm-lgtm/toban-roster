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
    name: 'synthetic-folder', unreadable: false, directoryHook: null, refuseData: false,
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
        async write(blob) { if (folder.refuseData && name === dataName) throw new Error('synthetic data refused'); files.set(name, typeof blob === 'string' ? blob : await blob.text()); writes.push(name); }, async close() {}
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
let passed = 0, failed = 0, finished = false;
// The run must reach its end: several cases wait for a gate inside the save (the document generator); if a change to the save code
// makes that gate unreachable, Node would simply drain the event loop and exit 0 without running the remaining cases.
const EXPECTED_CASES = 14;
process.on('exit', () => { if (!finished || passed + failed !== EXPECTED_CASES) { console.error(`NOT COMPLETED: ${passed + failed}/${EXPECTED_CASES} cases ran, finished=${finished}`); process.exitCode = 1; } else if (failed) process.exitCode = 1; });
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
  for (const phase of ['renumber', 'reuse-renumber', 'missing-document', 'missing-roster']) await test('manual: peer update during ' + phase + ' preserves its JSON and documents', async () => {
    const f = setup(); let generation = 1, ver = 1;
    if (phase === 'renumber') { f.files.set(A.FILES.roster('202611', 1, '確認版'), 'synthetic orphan'); generation = 2; ver = 2; }
    else {
      assert.strictEqual(await A.saveToFolder(), 'saved');
      // These phases are about re-using version 1: make sure it was recorded with its completion info, so the gated save below is on that path.
      assert.strictEqual(A.state.month.doc_versions.length, 1); assert.ok(Array.isArray(A.state.month.doc_versions[0].fp), 'version 1 carries completion info');
      A.state.result.seconds = 2; // the JSON needs saving; the existing document signature is unchanged
      assert.ok((await A.prepareSave()).reuse, 'the next save re-uses version 1');
      if (phase === 'missing-document') f.files.delete(A.FILES.report('202611', 1, '確認版')); // only the missing report is written again, but both documents are generated first (the gate below)
      else if (phase === 'missing-roster') f.files.delete(A.FILES.roster('202611', 1, '確認版'));
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
  // ---- Two windows and the completion info of a version (fp: prints of the two documents that are in the folder).
  // The folder's month data and the files are shared; each window has its own copy of the version record. These cases run the real three-way merge.
  const roster1 = A.FILES.roster('202611', 1, '確認版'), report1 = A.FILES.report('202611', 1, '確認版'), isDoc = n => /\.(docx|html)$/.test(n);
  const takeWindow = () => clone(A.state), putWindow = w => { for (const k of Object.keys(A.state)) delete A.state[k]; Object.assign(A.state, clone(w)); };
  // A save is stamped with the clock (milliseconds), and an equal stamp means "the revision this window synced last". Where a case needs a later
  // revision from a real save, it waits first, so that the two stamps cannot fall into the same millisecond.
  const laterStamp = () => new Promise(r => setTimeout(r, 5));
  const folderFp = f => JSON.parse(f.files.get(dataName)).month.doc_versions.map(v => v.fp), stateVers = () => (A.state.month.doc_versions || []).map(v => v.ver);
  await test('two windows: a JSON-only autosave from the window with the old completion info does not write it back; its next manual save adds no version', async () => {
    const f = setup(); assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(stateVers(), [1]);
    const window2 = takeWindow(), old = clone(A.state.month.doc_versions[0].fp); // both windows are in sync with version 1 here
    // Window 1: the roster is gone from the folder; it is written again under version 1 on another day (other bytes).
    f.files.delete(roster1); T.makeDocx = async () => new Blob(['synthetic roster, written on another day']); A.state.result.seconds = 2; await laterStamp();
    assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(stateVers(), [1]); const fresh = folderFp(f)[0]; assert.notDeepStrictEqual(fresh, old, 'the folder records the rewritten roster');
    assert.notStrictEqual(JSON.parse(f.files.get(dataName)).saved_at, window2.meta.savedAt, 'the folder now holds a later revision than the one window 2 synced');
    const window1 = takeWindow();
    // Window 2: recalculated with the same assignment (the documents are unchanged), then its autosave runs and merges window 1's save.
    putWindow(window2); T.makeDocx = async () => new Blob(['synthetic roster']); A.state.result.seconds = 9; f.toasts.length = 0;
    assert.strictEqual(await A.autosaveJson(), 'saved'); assert.ok(f.toasts.some(t => /自動で統合しました/.test(t)), 'the autosave went through the three-way merge');
    assert.deepStrictEqual(folderFp(f), [fresh], 'the autosave keeps the completion info that describes the files'); assert.deepStrictEqual(A.state.month.doc_versions[0].fp, fresh, 'and this window now has it too');
    const w = f.writes.length, a = f.files.get(roster1), b = f.files.get(report1); f.toasts.length = 0; A.state.result.seconds = 10;
    assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(f.writes.slice(w).filter(isDoc), [], 'no document is written'); assert.deepStrictEqual(stateVers(), [1], 'no duplicate version');
    assert.match(f.toasts[f.toasts.length - 1], /v1 のまま/); assert.strictEqual(f.files.get(roster1), a); assert.strictEqual(f.files.get(report1), b); assert.deepStrictEqual(folderFp(f), [fresh]); assert.strictEqual(A.isDirty(), false);
    // Window 1 afterwards: still consistent.
    putWindow(window1); A.state.result.seconds = 3; const w1 = f.writes.length; assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(f.writes.slice(w1).filter(isDoc), []); assert.deepStrictEqual(stateVers(), [1]); assert.deepStrictEqual(folderFp(f), [fresh]);
  });
  await test('two windows: completion info from a document this window wrote before its month data failed is kept through a merge with a peer save', async () => {
    const f = setup(); assert.strictEqual(await A.saveToFolder(), 'saved'); const old = clone(A.state.month.doc_versions[0].fp);
    // This window writes the missing roster again under version 1, but the month data of that save cannot be written.
    f.files.delete(roster1); T.makeDocx = async () => new Blob(['synthetic roster, written on another day']); A.state.result.seconds = 2; f.folder.refuseData = true;
    assert.strictEqual(await A.saveToFolder(), 'failed'); f.folder.refuseData = false; assert.ok(f.files.has(roster1), 'the roster is in the folder');
    const mine = clone(A.state.month.doc_versions[0].fp); assert.notDeepStrictEqual(mine, old, 'the state describes the roster that is now in the folder'); assert.deepStrictEqual(folderFp(f), [old]);
    // A peer (still with the earlier completion info) saves another edit.
    const peer = JSON.parse(f.files.get(dataName)); peer.month.holidays = [3]; peer.saved_at = '2026-10-03T00:00:00.000Z'; f.files.set(dataName, JSON.stringify(peer));
    T.makeDocx = async () => new Blob(['synthetic roster']); f.toasts.length = 0; assert.strictEqual(await A.autosaveJson(), 'saved'); assert.ok(f.toasts.some(t => /自動で統合しました/.test(t)));
    assert.deepStrictEqual(A.state.month.holidays, [3], 'the peer edit is merged'); assert.deepStrictEqual(A.state.month.doc_versions[0].fp, mine, 'own newer completion info is kept'); assert.deepStrictEqual(folderFp(f), [mine]);
  });
  // Known limit of the merge: it does not read the documents, so it cannot tell which completion info describes them. When older info is saved over the folder
  // (an older generation of the month data written back), this window takes it like any other change of the peer. What must still hold: no document is overwritten,
  // none is taken for the finished version, and the cost is one extra version, once.
  await test('two windows: older completion info saved over the folder costs one extra version on the next unchanged save, and overwrites nothing', async () => {
    const f = setup(); assert.strictEqual(await A.saveToFolder(), 'saved'); const old = clone(A.state.month.doc_versions[0].fp);
    f.files.delete(roster1); T.makeDocx = async () => new Blob(['synthetic roster, written on another day']); A.state.result.seconds = 2;
    assert.strictEqual(await A.saveToFolder(), 'saved'); const fresh = clone(A.state.month.doc_versions[0].fp); assert.notDeepStrictEqual(fresh, old); assert.deepStrictEqual(folderFp(f), [fresh]); // this window, its base and the folder all describe the files
    // A peer writes month data that still carries the earlier completion info over the folder (the output content is the same, so this window stays on the same-version path).
    const peer = JSON.parse(f.files.get(dataName)); peer.month.doc_versions[0].fp = clone(old); peer.saved_at = '2026-10-04T00:00:00.000Z'; f.files.set(dataName, JSON.stringify(peer));
    T.makeDocx = async () => new Blob(['synthetic roster']); A.state.result.seconds = 3; f.toasts.length = 0; assert.strictEqual(await A.autosaveJson(), 'saved'); assert.ok(f.toasts.some(t => /自動で統合しました/.test(t)));
    assert.deepStrictEqual(A.state.month.doc_versions[0].fp, old, 'the merge took the peer change, which is the older info here');
    const a = f.files.get(roster1), b = f.files.get(report1), w = f.writes.length; f.toasts.length = 0; A.state.result.seconds = 4; assert.ok((await A.prepareSave()).reuse, 'the save is on the same-version path'); assert.strictEqual(await A.saveToFolder(), 'saved');
    assert.strictEqual(f.files.get(roster1), a, 'the roster of version 1 is not overwritten'); assert.strictEqual(f.files.get(report1), b); assert.deepStrictEqual(stateVers(), [1, 2], 'output again under a free number');
    assert.match(f.toasts[f.toasts.length - 1], /勤務表 v2 を追加。このフォルダの v1 は別の内容の可能性があるので上書きしていません/); assert.doesNotMatch(f.toasts[f.toasts.length - 1], /v1 のまま/);
    assert.deepStrictEqual(f.writes.slice(w).filter(isDoc).sort(), [A.FILES.roster('202611', 2, '確認版'), A.FILES.report('202611', 2, '確認版')].sort());
    const w2 = f.writes.length; A.state.result.seconds = 5; f.toasts.length = 0; assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(f.writes.slice(w2).filter(isDoc), [], 'only once'); assert.match(f.toasts[f.toasts.length - 1], /v2 のまま/);
  });
  // ---- The reported sequence for the new-version path: the previous generation of the month data is loaded again and saved over the folder's data.
  await test('manual: restoring the previous month data and saving over the folder does not overwrite a roster edited outside the app', async () => {
    const f = setup(); A.state.month.notes = 'synthetic content B'; assert.strictEqual(await A.autosaveJson(), 'saved'); await laterStamp(); // the JSON-only autosave becomes the previous generation
    assert.strictEqual(await A.saveToFolder(), 'saved'); assert.deepStrictEqual(stateVers(), [1]); const prevJson = f.files.get(A.FILES.dataPrev('202611')); assert.ok(!JSON.parse(prevJson).month.doc_versions, 'the previous generation has no version record');
    const edited = f.files.get(roster1) + ' + remarks typed in a word processor', report = f.files.get(report1); f.files.set(roster1, edited); // the roster is edited outside the app
    A.state.month.notes = 'synthetic content C (a mistake)'; await laterStamp(); assert.strictEqual(await A.autosaveJson(), 'saved');
    assert.notStrictEqual(JSON.parse(f.files.get(dataName)).saved_at, JSON.parse(prevJson).saved_at, 'the folder holds a later revision than the previous generation');
    const choose = A.choose, alertWas = globalThis.alert, confirmWas = globalThis.confirm; globalThis.alert = m => { throw new Error('alert: ' + m); }; globalThis.confirm = () => true;
    try {
      await A.loadJsonFile({ text: async () => prevJson }); clearTimeout(A.autosaveTimer);
      assert.strictEqual(A.state.month.notes, 'synthetic content B'); assert.deepStrictEqual(stateVers(), [], 'the restored state has no version record, the folder still has version 1 with this content');
      let asked = 0; A.choose = async () => { asked++; return 'overwrite'; }; f.toasts.length = 0; const w = f.writes.length;
      assert.strictEqual(await A.saveToFolder(), 'saved'); assert.strictEqual(asked, 1, 'the user chose to save this browser state over the folder data');
      assert.strictEqual(f.files.get(roster1), edited, 'the edited roster is not overwritten'); assert.strictEqual(f.files.get(report1), report);
      assert.deepStrictEqual(stateVers(), [2]); assert.deepStrictEqual(f.writes.slice(w).filter(isDoc).sort(), [A.FILES.roster('202611', 2, '確認版'), A.FILES.report('202611', 2, '確認版')].sort());
      assert.match(f.toasts[f.toasts.length - 1], /勤務表 v2 を追加。このフォルダの v1 は別の内容の可能性があるので上書きしていません/);
    } finally { A.choose = choose; globalThis.alert = alertWas; globalThis.confirm = confirmWas; }
  });
  clearTimeout(A.autosaveTimer);
  console.log(`peer update saves: ${passed} passed, ${failed} failed`); finished = true;
})().catch(e => { clearTimeout(A.autosaveTimer); console.error(e.stack || e); process.exitCode = 1; });
