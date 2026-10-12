// 保存できなかった記録の種類分け: 月データの保存（data）と、勤務表・説明資料の出力（docs）を別々に持つ。
// 月データの保存の成功・失敗（帳票を出さない自動保存を含む）で、帳票の記録を消したり置き換えたりしない。
// 本体の保存の処理（app-core.js・app-folder.js）をそのまま動かし、検算・帳票の生成とフォルダだけを架空のものに替える。画面の配置は確かめない。
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elems = new Map();
const element = key => {
  if (!elems.has(key)) elems.set(key, { value: '確認版', innerHTML: '', textContent: '', className: '', hidden: false, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } });
  return elems.get(key);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/toban.html', protocol: 'file:', href: 'file:///synthetic/toban.html' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
T.registerLang({ code: 'ja' }); T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, 'lang/en.json'), 'utf8'))); T.setLang('ja');
const A = T.app;
A.readAll = A.renderAll = () => {};
A.choose = async () => { throw new Error('unexpected conflict choice'); };
T.Problem = function(rules, month) { this.rules = rules; this.m = month; };
let violations = 0, lint = [];
T.check = () => ({ V: Array.from({ length: violations }, () => ({})) }); T.lintPlugins = () => lint;
T.plugins = { beginFolder() {}, stamp: () => [] };
T.makeDocx = async (P, asg, label) => new Blob(['synthetic roster ' + label]);
A.reportHtml = (P, label) => 'synthetic report ' + label;

const at0 = '2026-10-01T00:00:00.000Z';
const missing = () => Object.assign(new Error('synthetic file missing'), { name: 'NotFoundError' });
const isDoc = name => /\.(docx|html)$/.test(name), isData = name => /_data\.json$/.test(name);
// 架空のフォルダ。refuse(name) が文を返すと、そのファイルの書込みが close でその文の失敗になる
function folder(name) {
  const files = new Map(), writes = [];
  const dir = { name, files, writes, refuse: () => null,
    async *entries() { for (const t of new Set([...files.keys()].map(n => n.slice(0, 6)))) yield [t, { kind: 'directory' }]; },
    async getDirectoryHandle(n) { if (n === 'plugins') throw missing(); return dir; },
    async getFileHandle(n, options = {}) {
      if (!options.create && !files.has(n)) throw missing();
      return { getFile: async () => ({ text: async () => files.get(n) }),
        createWritable: async () => { let text; return { async write(blob) { text = typeof blob === 'string' ? blob : await blob.text(); },
          async close() { const why = dir.refuse(n); if (why) throw new Error(why); files.set(n, text); writes.push(n); } }; } };
    } };
  return dir;
}
const toasts = []; A.toast = x => toasts.push(String(x));
const tick = () => new Promise(r => setTimeout(r, 0));
// 月を開いた状態にする（保存先にはその月の保存済みデータがあり、手元はそれと同じ版から始まる）
function open(dir, monthNo = 11, { keepRecords = false } = {}) {
  const rules = { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [] };
  const month = { year: 2026, month: monthNo, notes: 'synthetic base' }, result = { asg: {} };
  const tag = '2026' + String(monthNo).padStart(2, '0');
  if (!dir.files.has(A.FILES.data(tag))) dir.files.set(A.FILES.data(tag), JSON.stringify({ rules, month, result, saved_at: at0 }));
  Object.assign(A.state, { rules, month, result, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = dir; A.monthDirs = [tag]; A.dirGen++;
  A.markSaved(undefined, JSON.parse(dir.files.get(A.FILES.data(tag))).saved_at);
  violations = 0; lint = []; toasts.length = 0;
  if (!keepRecords) acknowledge();
  return tag;
}
// 画面の記録（#saveFail の中身）を行ごとの文で読む。「確認しました」は、描画のたびに付く click の処理の最新のものを呼ぶ
const records = () => [...element('#saveFail').innerHTML.matchAll(/<p>(.*?)<\/p>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const summary = () => { const m = element('#saveFail').innerHTML.match(/<div class="sum">(.*?)<\/div>/); return m ? m[1] : null; }; // 記録が複数あるときだけ先頭に出る内訳
function acknowledge() { const l = element('#saveFailOk').listeners.click || []; if (records().length) { assert(l.length, 'acknowledge button is bound'); l[l.length - 1](); } assert.deepStrictEqual(records(), []); }
const manual = async () => { const r = await A.saveToFolder(); await tick(); await tick(); return r; };
const auto = async () => { const r = await A.autosaveJson(); await tick(); await tick(); return r; };
const edit = text => { A.state.month.notes = text; };
const docFiles = dir => [...dir.files.keys()].filter(isDoc).sort();
const DOCS = /^帳票の出力が完了していません 202611・フォルダ synthetic-folder・.* — 勤務表・説明資料の書き出しが完了しませんでした: /, DATA = /^保存できていません 202611・フォルダ synthetic-folder・/;

let cases = 0; const total = 12;
process.on('exit', () => { if (cases !== total && !process.exitCode) { console.error('NOT COMPLETED: ' + cases + '/' + total); process.exitCode = 1; } });
const scenario = async (name, fn) => { await fn(); cases++; console.log('PASS ' + name); };
(async () => {
  await scenario('A 手動保存で帳票の出力だけが失敗: 月データは保存され、帳票の記録が残る', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit A');
    assert.strictEqual(await manual(), 'saved'); assert.ok(toasts.some(x => /勤務表と説明資料は書き出せませんでした: synthetic doc refused。月データは保存しました/.test(x)), 'the toast still explains it');
    const r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /synthetic doc refused$/); assert.doesNotMatch(r[0], /月データは保存/, 'the kept line says nothing about the month data, which may change later');
    assert.strictEqual(A.isDirty(), false); assert.strictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.notes, 'synthetic edit A'); assert.deepStrictEqual(docFiles(dir), []); assert.ok(!(A.state.month.doc_versions || []).length, 'no version is recorded for documents that were not written');
  });
  await scenario('B その後、月データだけの自動保存が成功しても、帳票の記録は消えない', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); const kept = records(); assert.strictEqual(kept.length, 1);
    dir.refuse = () => null; edit('synthetic edit after the document failure'); assert.strictEqual(await auto(), 'saved'); assert.strictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.notes, 'synthetic edit after the document failure');
    assert.deepStrictEqual(records(), kept, 'a JSON-only autosave is not a completed document output'); edit('synthetic edit 3'); assert.strictEqual(await auto(), 'saved'); assert.deepStrictEqual(records(), kept);
  });
  await scenario('C 月データの失敗の記録がある状態で、帳票だけ失敗する手動保存: 月データの記録だけが消え、帳票の記録が残る', async () => {
    const dir = folder('synthetic-folder'); open(dir); dir.refuse = n => isData(n) ? 'synthetic data refused' : null; edit('synthetic edit'); assert.strictEqual(await auto(), 'failed');
    let r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DATA); assert.match(r[0], /自動保存に失敗しました: synthetic data refused/);
    dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; assert.strictEqual(await manual(), 'saved'); r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS);
  });
  await scenario('片方だけ書けた（勤務表は書け、説明資料が失敗）: 完了とせず記録が残る。次の出力が両方そろうと消える', async () => {
    const dir = folder('synthetic-folder'); open(dir); dir.refuse = n => /\.html$/.test(n) ? 'synthetic report refused' : null; edit('synthetic edit');
    assert.strictEqual(await manual(), 'saved'); let r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /synthetic report refused$/);
    assert.deepStrictEqual(docFiles(dir).map(n => n.replace(/^.*\./, '')), ['docx'], 'only the roster document exists'); assert.ok(!(A.state.month.doc_versions || []).length);
    dir.refuse = () => null; edit('synthetic edit 2'); assert.strictEqual(await auto(), 'saved'); assert.strictEqual(records().length, 1, 'the autosave does not clear it, although one document exists');
    assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); const v = A.state.month.doc_versions; assert.strictEqual(v.length, 1);
    assert.ok(dir.files.has(v[0].docx) && dir.files.has(v[0].html), 'both documents of the recorded version exist'); assert.strictEqual(v[0].ver, 2, 'the half-written number is not reused');
  });
  await scenario('月データの再失敗: 帳票の記録を置き換えない。月データの記録だけが最新の理由になり、月データの成功でそれだけが消える', async () => {
    const dir = folder('synthetic-folder'); open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); const docsLine = records()[0];
    dir.refuse = n => isData(n) ? 'synthetic data refused 1' : null; edit('synthetic edit 2'); assert.strictEqual(await auto(), 'failed');
    let r = records(); assert.strictEqual(r.length, 2); assert.match(r[0], DATA); assert.match(r[0], /synthetic data refused 1/); assert.strictEqual(r[1], docsLine, 'the document line is untouched');
    assert.strictEqual(summary(), '未解決 2 件（月データの保存 1 件、帳票の出力 1 件）。下に続きます', 'both kinds are named before the lines, so neither is hidden by the fixed height');
    dir.refuse = n => isData(n) ? 'synthetic data refused 2' : null; assert.strictEqual(await auto(), 'failed'); r = records(); assert.strictEqual(r.length, 2); assert.match(r[0], /synthetic data refused 2/); assert.doesNotMatch(r[0], /refused 1/); assert.strictEqual(r[1], docsLine);
    assert.strictEqual(await manual(), 'failed', 'a manual save whose month data cannot be written fails as a whole'); r = records(); assert.strictEqual(r.length, 2); assert.match(r.find(x => DATA.test(x)), /フォルダに保存できませんでした: synthetic data refused 2/); assert.ok(r.includes(docsLine), 'documents written in a save that failed as a whole do not clear the record');
    dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; assert.strictEqual(await auto(), 'saved'); r = records(); assert.strictEqual(r.length, 1); assert.strictEqual(r[0], docsLine, 'the month data success clears only the month data line'); assert.strictEqual(summary(), null, 'a single record needs no breakdown');
  });
  await scenario('帳票の再出力が成功: 帳票の記録が消える（月データの記録が別にあればそれは残る）', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); assert.strictEqual(records().length, 1);
    dir.refuse = () => null; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); const v = A.state.month.doc_versions; assert.strictEqual(v.length, 1); assert.ok(dir.files.has(v[0].docx) && dir.files.has(v[0].html));
    assert.strictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions.length, 1, 'the folder records the written version');
  });
  await scenario('出力前の確認で帳票を出さない（検算の違反・プラグインの欠落・未計算）: 新しい記録を作らず、前の帳票の記録も消さない', async () => {
    const dir = folder('synthetic-folder'); open(dir);
    violations = 2; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); assert.ok(toasts.some(x => /検算に違反が.*書き出しません/.test(x))); assert.deepStrictEqual(records(), [], 'a stop before output is not a failure');
    violations = 0; lint = [{ code: 'LINT_PLUGIN_MISSING' }]; edit('synthetic edit 2'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []);
    lint = []; A.state.result = null; edit('synthetic edit 3'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.deepStrictEqual(docFiles(dir), []);
    A.state.result = { asg: {} }; dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit 4'); assert.strictEqual(await manual(), 'saved'); const kept = records(); assert.strictEqual(kept.length, 1); assert.match(kept[0], DOCS);
    dir.refuse = () => null; violations = 1; edit('synthetic edit 5'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), kept, 'a save that outputs nothing does not complete the earlier output');
    violations = 0; A.state.result = null; edit('synthetic edit 6'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), kept);
  });
  await scenario('既にある帳票で消すのは、今回の出力対象と同じ版だと保存先の記録で確かめられるときだけ', async () => {
    const dir = folder('synthetic-folder'); open(dir); edit('synthetic content one'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.strictEqual(A.state.month.doc_versions.length, 1);
    dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic content two'); assert.strictEqual(await manual(), 'saved'); assert.strictEqual(records().length, 1, 'version 2 could not be written');
    edit('synthetic content one'); const before = dir.writes.length; assert.strictEqual(await manual(), 'saved'); // 出力対象が v1 と同じ内容に戻った。帳票の書込みは失敗するままだが、書く必要が無い
    assert.ok(!dir.writes.slice(before).some(isDoc), 'nothing is rewritten'); assert.deepStrictEqual(records(), [], 'verified version 1 with both documents present completes the output');
  });
  await scenario('同じ名前の帳票があるだけ（保存先の記録で同じ版と確かめられない）では消さない', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); assert.strictEqual(records().length, 1);
    const orphan = [A.FILES.roster(tag, 1, '確認版'), A.FILES.report(tag, 1, '確認版')]; for (const n of orphan) dir.files.set(n, 'synthetic unrelated document'); // 版の記録が無いまま、v1 の名前の帳票が両方ある
    assert.strictEqual(await manual(), 'saved'); const r = records(); assert.strictEqual(r.length, 1, 'existence alone does not complete the output'); assert.match(r[0], DOCS);
    for (const n of orphan) assert.strictEqual(dir.files.get(n), 'synthetic unrelated document', 'the unrelated documents are not overwritten');
    dir.refuse = () => null; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.strictEqual(A.state.month.doc_versions[0].ver, 2); for (const n of orphan) assert.strictEqual(dir.files.get(n), 'synthetic unrelated document');
  });
  await scenario('別の月・別の保存先の帳票の出力成功では消えない', async () => {
    const dir = folder('synthetic-folder'); open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); const kept = records(); assert.strictEqual(kept.length, 1);
    dir.refuse = () => null; open(dir, 12, { keepRecords: true }); edit('synthetic december'); assert.strictEqual(await manual(), 'saved'); assert.ok(docFiles(dir).some(n => n.startsWith('202612')), 'December documents were written'); assert.deepStrictEqual(records(), kept);
    const other = folder('synthetic-folder'); open(other, 11, { keepRecords: true }); edit('synthetic other folder'); assert.strictEqual(await manual(), 'saved'); assert.ok(docFiles(other).length === 2); assert.deepStrictEqual(records(), kept, 'another folder with the same name does not clear it');
    open(dir, 11, { keepRecords: true }); edit('synthetic back'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []);
  });
  await scenario('帳票の生成そのものが失敗したときも帳票の記録になる（書込みの前に止まる）', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir), make = T.makeDocx; T.makeDocx = async () => { throw new Error('synthetic layout plugin missing'); };
    try { edit('synthetic edit'); assert.strictEqual(await manual(), 'saved'); const r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /synthetic layout plugin missing$/); assert.strictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.notes, 'synthetic edit'); }
    finally { T.makeDocx = make; }
    assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []);
  });
  await scenario('「確認しました」は両方の記録を消すだけ。表示言語を替えると記録の文面も替わる', async () => {
    const dir = folder('synthetic-folder'); open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit'); assert.strictEqual(await manual(), 'saved');
    dir.refuse = n => isData(n) ? 'synthetic data refused' : null; edit('synthetic edit 2'); assert.strictEqual(await auto(), 'failed'); assert.strictEqual(records().length, 2);
    T.setLang('en'); A.renderHeader(); assert.strictEqual(summary(), '2 unresolved (month data: 1, document output: 1). Details follow below'); let r = records(); assert.match(r.find(x => /Document output/.test(x)), /^Document output is not complete 202611.*Writing the roster document and report did not complete: synthetic doc refused$/); assert.match(r.find(x => /^Not saved/.test(x)), /Autosave failed: synthetic data refused/);
    T.setLang('ja'); A.renderHeader(); assert.strictEqual(records().length, 2); acknowledge(); assert.strictEqual(A.isDirty(), true, 'acknowledging does not mark the unsaved edit saved');
    dir.refuse = () => null; assert.strictEqual(await auto(), 'saved'); assert.deepStrictEqual(records(), []);
  });
  console.log(cases + '/' + total + ' document output record cases passed');
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
