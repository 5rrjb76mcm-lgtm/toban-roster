// 保存前の読取・確認を待つ間のフォルダ/月/同期基準の切替。架空データとメモリ上のFSだけを使う。
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
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
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
  // 実際のフォルダ選択窓口。窓を開いた後に予約済みの自動保存/手動保存が始まる。
  for (const mode of ['auto', 'manual']) {
    const f = setup(), picker = gate(), pickerEntered = gate();
    window.showDirectoryPicker = async () => { pickerEntered.resolve(); return picker.promise; };
    const oldRead = pauseRead(f.oldFolder), newRead = pauseRead(f.newFolder), before = JSON.stringify(A.state);
    const switching = A.openFolderUI(); await pickerEntered.promise;
    const saving = save(mode); await oldRead.entered;
    picker.resolve(f.newFolder); await newRead.entered;
    oldRead.release();
    assert.strictEqual(await saving, 'skipped', mode + ': 旧フォルダの競合確認を新フォルダに使わない');
    assert.strictEqual(JSON.stringify(A.state), before, '古い読取で状態や保存基準を変えない');
    newRead.release(); await switching; clearTimeout(A.autosaveTimer);
    assert.strictEqual(f.newFolder.files.get(fileName), JSON.stringify(f.newData), '新フォルダの月JSONを保持する');
    assert.strictEqual(f.oldFolder.writes.length + f.newFolder.writes.length, 0);
    assert.strictEqual(A.dirHandle, f.newFolder);
  }
  // ハンドルが同じでも再接続、月変更、同期基準更新があればその読取は古い。
  for (const change of ['reconnect', 'month', 'saved']) {
    const f = setup(), pending = pauseRead(f.oldFolder), saving = A.autosaveJson(); await pending.entered;
    if (change === 'reconnect') A.dirGen++;
    else if (change === 'month') A.state.month = { year: 2026, month: 12, notes: 'synthetic new month' };
    else { A.state.month.notes = 'synthetic newer synchronization'; A.markSaved(undefined, '2026-10-03T00:00:00.000Z'); }
    const before = JSON.stringify(A.state); pending.release();
    assert.strictEqual(await saving, 'skipped', change);
    assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(f.oldFolder.writes.length, 0);
  }
  // 写し取得後に書込先フォルダの応答を待っている間も、ファイル名と内容は同じ写しに揃える。
  { const f = setup(), entered = gate(), release = gate(), original = f.oldFolder.getDirectoryHandle;
    f.oldFolder.getDirectoryHandle = async (name, options) => {
      if (options && options.create) { entered.resolve(); await release.promise; }
      return original(name, options);
    };
    const saving = A.autosaveJson(); await entered.promise;
    A.dirHandle = f.newFolder; A.dirGen++; A.state.month = { year: 2026, month: 12, notes: 'synthetic current month' };
    A.markSaved(undefined, f.newData.saved_at); const before = JSON.stringify(A.state);
    release.resolve(); assert.strictEqual(await saving, 'saved');
    assert.strictEqual(JSON.parse(f.oldFolder.files.get(fileName)).month.notes, 'synthetic local edit');
    assert.ok(!f.oldFolder.files.has('202612_data.json'), '前の月の中身を現在月のファイル名で書かない');
    assert.strictEqual(f.newFolder.writes.length, 0); assert.strictEqual(JSON.stringify(A.state), before);
  }
  // 確認の返答も接続先が変わっていれば無効。古い入力を新しい月へ読み込む/統合することも防ぐ。
  for (const mode of ['auto', 'manual']) for (const choice of ['load', 'overwrite', 'mine', 'theirs', 'rules']) {
    const f = setup(), peer = clone(f.oldData), entered = gate(), answer = gate();
    peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.notes = 'synthetic peer edit';
    if (choice === 'load' || choice === 'overwrite') A.state.base = null;
    if (choice === 'rules') { A.state.rules.weights.synthetic = 1; peer.rules.weights.synthetic = 2; }
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    A.choose = async (msg, options) => {
      assert.ok(options.some(o => o.value === (choice === 'rules' ? 'theirs' : choice)));
      entered.resolve(); return answer.promise;
    };
    const saving = save(mode); await entered.promise;
    A.dirHandle = f.newFolder; A.dirGen++; A.state.month = clone(f.newData.month);
    A.markSaved(undefined, f.newData.saved_at);
    const before = JSON.stringify(A.state);
    answer.resolve(choice === 'rules' ? 'theirs' : choice);
    assert.strictEqual(await saving, 'skipped', mode + '/' + choice);
    assert.strictEqual(JSON.stringify(A.state), before, '前の接続先の返答で現在の入力・保存基準を変更しない');
    assert.strictEqual(f.oldFolder.writes.length + f.newFolder.writes.length, 0);
    clearTimeout(A.autosaveTimer);
  }
  // 同じフォルダ・同じ月なら、自動統合と保存は通常どおり成功する。
  for (const mode of ['auto', 'manual']) {
    const f = setup(), peer = clone(f.oldData); peer.month.holidays = [3]; peer.saved_at = '2026-10-02T00:00:00.000Z';
    f.oldFolder.files.set(fileName, JSON.stringify(peer));
    A.choose = async () => { throw new Error('unrelated edits should merge without confirmation'); };
    assert.strictEqual(await save(mode), 'saved');
    const saved = JSON.parse(f.oldFolder.files.get(fileName));
    assert.strictEqual(saved.month.notes, 'synthetic local edit'); assert.deepStrictEqual(saved.month.holidays, [3]);
    assert.strictEqual(A.isDirty(), false); clearTimeout(A.autosaveTimer);
  }
  console.log('保存の読取・確認: 接続先/月/同期基準の切替を保護、同じ接続先の自動統合は維持 OK');
})().catch(e => { clearTimeout(A.autosaveTimer); console.error(e); process.exitCode = 1; });
