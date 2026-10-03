// 帳票の存在確認で読取に失敗したら保存を止める。データ・フォルダ・帳票はすべて架空。
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elems = new Map();
const element = key => {
  if (!elems.has(key)) elems.set(key, { value: '確認版', innerHTML: '', textContent: '', className: '', hidden: false, addEventListener() {} });
  return elems.get(key);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/toban.html', protocol: 'file:', href: 'file:///synthetic/toban.html' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = { esc: String };
for (const f of ['i18n.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
const A = T.app;
A.readAll = A.renderHeader = A.renderAll = () => {};
A.choose = async () => { throw new Error('unexpected conflict choice'); };
T.Problem = function(rules, month) { this.rules = rules; this.m = month; };
T.check = () => ({ V: [] }); T.lintPlugins = () => [];
T.plugins = { beginFolder() {}, stamp: () => [] };
T.makeDocx = async (P, asg, label) => new Blob(['synthetic roster ' + label]);
A.reportHtml = (P, label) => 'synthetic report ' + label;

const tag = '202611', dataName = A.FILES.data(tag), at = '2026-10-01T00:00:00.000Z';
const missing = () => Object.assign(new Error('synthetic file missing'), { name: 'NotFoundError' });
function setup(target = null, errorName = null) {
  const rules = { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [] };
  const month = { year: 2026, month: 11, notes: 'synthetic base' }, result = { asg: {} };
  const originalData = JSON.stringify({ rules, month, result, saved_at: at });
  const originalDoc = 'synthetic existing document';
  const files = new Map([[dataName, originalData]]), writes = [], toasts = [];
  if (target) files.set(target, originalDoc);
  let injected = false;
  const dir = {
    name: 'synthetic-folder',
    async *entries() { yield [tag, { kind: 'directory' }]; },
    async getDirectoryHandle(name) { if (name === 'plugins') throw missing(); return dir; },
    async getFileHandle(name, options = {}) {
      if (!options.create && name === target && errorName && !injected) {
        injected = true;
        throw Object.assign(new Error('synthetic transient read failure'), { name: errorName });
      }
      if (!options.create && !files.has(name)) throw missing();
      return {
        getFile: async () => ({ text: async () => files.get(name) }),
        createWritable: async () => ({
          async write(blob) { files.set(name, typeof blob === 'string' ? blob : await blob.text()); writes.push(name); },
          async close() {}
        })
      };
    }
  };
  Object.assign(A.state, { rules, month, result, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = dir; A.monthDirs = [tag]; A.dirGen++;
  A.markSaved(undefined, at); A.state.month.notes = 'synthetic local edit';
  A.toast = x => toasts.push(String(x));
  return { files, writes, toasts, originalData, originalDoc, injected: () => injected };
}

(async () => {
  for (const kind of ['roster', 'report']) for (const errorName of ['NotAllowedError', 'NotReadableError']) {
    const target = A.FILES[kind](tag, 1, '確認版'), f = setup(target, errorName);
    const before = JSON.stringify(A.state);
    assert.strictEqual(await A.saveToFolder(), 'failed', `${kind}/${errorName}: 存在確認に失敗したら保存を止める`);
    assert.ok(f.injected());
    assert.strictEqual(f.files.get(target), f.originalDoc, '既存帳票を上書きしない');
    assert.strictEqual(f.files.get(dataName), f.originalData, '月JSONを変更しない');
    assert.strictEqual(JSON.stringify(A.state), before, '当月・版の記録・保存基準を変更しない');
    assert.ok(!f.writes.some(name => /_(roster|report)/.test(name)), '存在が不明のまま帳票を書かない');
    assert.ok(A.isDirty(), '未保存の変更を保持する');
    assert.ok(f.toasts.some(x => /保存できませんでした/.test(x)), '失敗を通知する');
    assert.strictEqual(await A.saveToFolder(), 'saved', '読取が回復した次の保存は成功する');
    assert.strictEqual(f.files.get(target), f.originalDoc, '再試行でも既存版を保持する');
    assert.strictEqual(A.state.month.doc_versions[0].ver, 2, '既存版を避けて新しい番号を使う');
    assert.ok(f.files.has(A.FILES.roster(tag, 2, '確認版')) && f.files.has(A.FILES.report(tag, 2, '確認版')));
    assert.strictEqual(JSON.parse(f.files.get(dataName)).month.notes, 'synthetic local edit');
    assert.strictEqual(A.isDirty(), false);
  }
  // 通常の不存在、同じ版の再利用、変更時の版の追加は変わらない。
  const f = setup();
  assert.strictEqual(await A.saveToFolder(), 'saved');
  assert.strictEqual(A.state.month.doc_versions[0].ver, 1);
  const writes = f.writes.length;
  assert.strictEqual(await A.saveToFolder(), 'saved');
  assert.ok(!f.writes.slice(writes).some(name => /_(roster|report)/.test(name)), '同じ版の帳票は再利用する');
  A.state.month.notes = 'synthetic next edit';
  assert.strictEqual(await A.saveToFolder(), 'saved');
  assert.deepStrictEqual(A.state.month.doc_versions.map(v => v.ver), [1, 2]);
  console.log('帳票の存在確認: 読取失敗時の保全、再試行、正常な不存在・版再利用・版追加 OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
