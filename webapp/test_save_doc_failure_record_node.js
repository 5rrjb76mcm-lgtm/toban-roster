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
// 架空のフォルダ。実際の File System Access と同じく、作成を指定して開いた時点で空のファイルができる（その後の書込みが失敗すると、空のファイルが残る）。
//   refuse(name) が文を返すと、そのファイルの書込みが close でその文の失敗になる
//   mangle(name, text) は書き込まれる中身を差し替える（書いたはずの内容がフォルダに無い、を作る）
//   unreadable(name) が文を返すと、そのファイルは「あるのに読めない」（getFile が失敗する）
function folder(name) {
  const files = new Map(), writes = [];
  const dir = { name, files, writes, refuse: () => null, mangle: (n, text) => text, unreadable: () => null,
    async *entries() { for (const t of new Set([...files.keys()].map(n => n.slice(0, 6)))) yield [t, { kind: 'directory' }]; },
    async getDirectoryHandle(n) { if (n === 'plugins') throw missing(); return dir; },
    async getFileHandle(n, options = {}) {
      if (!options.create && !files.has(n)) throw missing();
      if (options.create && !files.has(n)) files.set(n, '');
      return { getFile: async () => { const why = dir.unreadable(n); if (why) throw Object.assign(new Error(why), { name: 'NotReadableError' }); return { text: async () => files.get(n) }; },
        createWritable: async () => { let text; return { async write(blob) { text = typeof blob === 'string' ? blob : await blob.text(); },
          async close() { const why = dir.refuse(n); if (why) throw new Error(why); files.set(n, dir.mangle(n, text)); writes.push(n); } }; } };
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
const docFiles = dir => [...dir.files.keys()].filter(n => isDoc(n) && dir.files.get(n) !== '').sort(); // 中身のある帳票（空のまま残ったものは除く）
const emptyDocs = dir => [...dir.files.keys()].filter(n => isDoc(n) && dir.files.get(n) === '').sort();
const docWritesSince = (dir, n) => dir.writes.slice(n).filter(isDoc);
const versions = () => (A.state.month.doc_versions || []).map(v => v.ver);
const V1 = tag => [A.FILES.roster(tag, 1, '確認版'), A.FILES.report(tag, 1, '確認版')];
const lastToast = () => toasts[toasts.length - 1] || '';
// ページを開き直した状態にする: 画面の記録は無く、状態は保存先の月データから読んだもの
function reload(dir, tag) { acknowledge(); const o = JSON.parse(dir.files.get(A.FILES.data(tag))); Object.assign(A.state, { rules: o.rules, month: o.month, result: o.result, ui: {}, meta: null, base: null, baseRules: null, renames: [] }); A.dirHandle = dir; A.dirGen++; A.markSaved(undefined, o.saved_at); toasts.length = 0; }
// いまの状態のまま、別の保存先につなぐ（保存先にはこの月の月データがあり、同期の基準は合っている。版の記録は手元のものを持ち込む）
function connect(dir, tag) { dir.files.set(A.FILES.data(tag), JSON.stringify({ rules: A.state.rules, month: Object.assign({}, A.state.month, { doc_versions: undefined }), result: A.state.result, saved_at: A.state.meta.savedAt })); A.dirHandle = dir; A.dirGen++; A.monthDirs = [tag]; A.markSaved(undefined, A.state.meta.savedAt); toasts.length = 0; }
// 版 1 を出力し終えた状態（勤務表と説明資料があり、版の記録に完了情報が入っている）
async function withV1(name = 'synthetic-folder') { const dir = folder(name), tag = open(dir); edit('synthetic content one'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(versions(), [1]); assert.deepStrictEqual(docFiles(dir), V1(tag).slice().sort()); assert.deepStrictEqual(records(), []);
  const rec = A.state.month.doc_versions[0]; assert.ok(Array.isArray(rec.fp) && rec.fp.length === 2 && rec.fp.every(x => typeof x === 'string' && x), 'completion info is recorded with the version'); assert.deepStrictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions[0].fp, rec.fp, 'and saved in the month data'); toasts.length = 0; return { dir, tag }; }
const prepKind = prep => prep.reuse ? 'reuse' : prep.docs.length ? 'new' : 'none'; // 試験の場面が、狙った経路（同じ版の再利用）に届いていることを確かめる
const DOCS = /^帳票の出力が完了していません 202611・フォルダ synthetic-folder・.* — 勤務表・説明資料の書き出しが完了しませんでした: /, DATA = /^保存できていません 202611・フォルダ synthetic-folder・/;

let cases = 0; const total = 25;
process.on('exit', () => { if (cases !== total && !process.exitCode) { console.error('NOT COMPLETED: ' + cases + '/' + total); process.exitCode = 1; } });
const scenario = async (name, fn) => { await fn(); cases++; console.log('PASS ' + name); };
(async () => {
  await scenario('A 手動保存で帳票の出力だけが失敗: 月データは保存され、帳票の記録が残る', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic edit A');
    assert.strictEqual(await manual(), 'saved'); assert.ok(toasts.some(x => /勤務表と説明資料は書き出せませんでした: synthetic doc refused。月データは保存しました/.test(x)), 'the toast still explains it');
    const r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /synthetic doc refused$/); assert.doesNotMatch(r[0], /月データは保存/, 'the kept line says nothing about the month data, which may change later');
    assert.strictEqual(A.isDirty(), false); assert.strictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.notes, 'synthetic edit A'); assert.deepStrictEqual(docFiles(dir), []); assert.deepStrictEqual(versions(), [], 'no version is recorded for documents that were not written');
    assert.ok(!JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions, 'nor in the month data');
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
  await scenario('同じ名前の帳票があるだけでは消さない（同じ版を再利用する経路: 中身が版の記録と違えば完成と扱わない）', async () => {
    const { dir, tag } = await withV1(), [docx1, html1] = V1(tag);
    dir.refuse = n => isDoc(n) ? 'synthetic doc refused' : null; edit('synthetic content two'); assert.strictEqual(await manual(), 'saved'); assert.strictEqual(records().length, 1, 'version 2 could not be written');
    // 版 1 の名前のファイルを、長さは同じで中身の違うものに置き換える（保存先の月データには版 1 の記録が残っている）
    const foreign = n => dir.files.get(n).replace('synthetic', 'SYNTHETIC'); const f1 = foreign(docx1), f2 = foreign(html1); assert.strictEqual(f1.length, dir.files.get(docx1).length); dir.files.set(docx1, f1); dir.files.set(html1, f2);
    edit('synthetic content one'); assert.strictEqual(prepKind(await A.prepareSave()), 'reuse', 'the save is on the same-version path');
    assert.strictEqual(await manual(), 'saved'); let r = records(); assert.strictEqual(r.length, 1, 'same-named documents with other content do not complete the output'); assert.match(r[0], DOCS); assert.doesNotMatch(lastToast(), /v1 のまま/);
    assert.strictEqual(dir.files.get(docx1), f1); assert.strictEqual(dir.files.get(html1), f2);
    dir.refuse = () => null; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.strictEqual(dir.files.get(docx1), f1, 'the other documents are never overwritten'); assert.strictEqual(dir.files.get(html1), f2);
    const last = A.state.month.doc_versions.slice(-1)[0]; assert.ok(last.ver > 1 && dir.files.get(last.docx) && dir.files.get(last.html), 'the content was output under a free number: v' + last.ver);
  });
  // ---- 帳票の完了判定: 版の記録の完了情報（中身の印）と、いまフォルダにあるファイルを照らす
  const brokenRewrite = async () => { // 報告された再現: 版 1 の説明資料が欠けている → 書き足しで説明資料だけ失敗し、空のファイルが残る
    const { dir, tag } = await withV1(), [docx1, html1] = V1(tag), docxBefore = dir.files.get(docx1); dir.files.delete(html1);
    dir.refuse = n => /\.html$/.test(n) ? 'synthetic report refused' : null; const w0 = dir.writes.length; A.state.result.seconds = 2; // 計算し直して同じ結果になった（出力の内容は同じ）
    assert.strictEqual(await manual(), 'saved'); const r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /synthetic report refused$/);
    assert.strictEqual(dir.files.get(html1), '', 'an empty report is left behind'); assert.deepStrictEqual(docWritesSince(dir, w0), [], 'the roster that was already there is not rewritten'); assert.strictEqual(dir.files.get(docx1), docxBefore);
    dir.refuse = () => null; return { dir, tag, docx1, html1, docxBefore }; };
  const outputAgain = async ({ dir, tag, docx1, html1, docxBefore }) => { // その後の、出力の内容が同じ手動保存
    const w0 = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.doesNotMatch(lastToast(), /v1 のまま/, 'the broken pair is not taken for the finished version 1: ' + lastToast());
    assert.deepStrictEqual(versions(), [1, 2], 'output again under a free number'); const v2 = A.state.month.doc_versions[1]; assert.deepStrictEqual(docWritesSince(dir, w0).sort(), [v2.docx, v2.html].sort()); assert.ok(dir.files.get(v2.docx) && dir.files.get(v2.html));
    assert.strictEqual(dir.files.get(html1), '', 'the empty report is left as it is (not overwritten)'); assert.strictEqual(dir.files.get(docx1), docxBefore); assert.deepStrictEqual(records(), []);
    const w1 = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w1), [], 'the next unchanged save writes nothing'); assert.match(lastToast(), /v2 のまま/); assert.deepStrictEqual(versions(), [1, 2]); };
  await scenario('書き足しの失敗で空の説明資料が残った後の再保存: 完成済みの版 1 と誤認せず、空いている番号で出し直す', async () => { await outputAgain(await brokenRewrite()); });
  await scenario('同じ再現で、先に「確認しました」で記録を消していても、誤認しない', async () => { const x = await brokenRewrite(); acknowledge(); await outputAgain(x); });
  await scenario('同じ再現で、ページを開き直した後（保存した月データから再開）でも、誤認しない', async () => { const x = await brokenRewrite(); reload(x.dir, x.tag); assert.deepStrictEqual(versions(), [1]); await outputAgain(x); });
  await scenario('同じ再現で、間に月データだけの自動保存が成功していても、誤認しない', async () => { const x = await brokenRewrite(); edit('synthetic content one'); A.state.result.seconds = 3; assert.strictEqual(await auto(), 'saved'); assert.strictEqual(records().length, 1); await outputAgain(x); });
  for (const first of ['manual', 'autosave']) await scenario('別の保存先に同じ名前・同じ大きさで中身の違う帳票がある（先に' + (first === 'manual' ? '手動保存' : '月データだけの自動保存') + '）: 完成済みと誤認せず、上書きもしない', async () => {
    const { dir, tag } = await withV1(), [docx1, html1] = V1(tag), other = folder('synthetic-folder');
    const f1 = dir.files.get(docx1).replace('synthetic', 'SYNTHETIC'), f2 = dir.files.get(html1).replace('synthetic', 'SYNTHETIC'); other.files.set(docx1, f1); other.files.set(html1, f2); assert.strictEqual(f1.length, dir.files.get(docx1).length);
    connect(other, tag); assert.deepStrictEqual(versions(), [1], 'the version record travels with the state');
    if (first === 'autosave') { A.state.result.seconds = 2; assert.strictEqual(await auto(), 'saved'); assert.deepStrictEqual(JSON.parse(other.files.get(A.FILES.data(tag))).month.doc_versions.map(v => v.ver), [1], 'the autosave wrote the carried record into the other folder'); }
    assert.strictEqual(prepKind(await A.prepareSave()), 'reuse'); assert.strictEqual(await manual(), 'saved'); assert.doesNotMatch(lastToast(), /v1 のまま/); assert.match(lastToast(), /v1 は別の内容の可能性/);
    assert.deepStrictEqual(versions(), [1, 2]); const v2 = A.state.month.doc_versions[1]; assert.ok(other.files.get(v2.docx) && other.files.get(v2.html)); assert.strictEqual(other.files.get(docx1), f1, 'the other documents are untouched'); assert.strictEqual(other.files.get(html1), f2); assert.deepStrictEqual(records(), []);
  });
  await scenario('書き出した帳票が外部で書き換えられた: 次の同じ内容の保存で 1 度だけ新しい番号に出し直し、書き換えられた帳票には触れない', async () => {
    const { dir, tag } = await withV1(), [docx1] = V1(tag), edited = dir.files.get(docx1) + ' (edited in a word processor)'; dir.files.set(docx1, edited);
    let w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(versions(), [1, 2]); assert.strictEqual(dir.files.get(docx1), edited); assert.strictEqual(docWritesSince(dir, w).length, 2);
    w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), [], 'only once'); assert.deepStrictEqual(versions(), [1, 2]); assert.match(lastToast(), /v2 のまま/);
  });
  await scenario('片方が無く、ある方はこの版のもの: 無い方だけを同じ版で書き、ある方には触れない。両方無ければ両方を書く', async () => {
    const { dir, tag } = await withV1(), [docx1, html1] = V1(tag), htmlBefore = dir.files.get(html1); dir.files.delete(docx1);
    let w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), [docx1], 'only the missing roster is written'); assert.strictEqual(dir.files.get(html1), htmlBefore); assert.deepStrictEqual(versions(), [1], 'no new version'); assert.match(lastToast(), /書き直しました/);
    assert.deepStrictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions[0].fp, A.state.month.doc_versions[0].fp, 'state and month data agree on the completion info'); assert.strictEqual(A.isDirty(), false);
    w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), []); assert.match(lastToast(), /v1 のまま/);
    dir.files.delete(docx1); dir.files.delete(html1); w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w).sort(), [docx1, html1].sort()); assert.deepStrictEqual(versions(), [1]); assert.strictEqual(A.isDirty(), false);
    w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), []);
  });
  await scenario('書いた直後に読み直して確かめる: フォルダにある中身が書いた内容と違えば完了とせず、版の記録にも入れない', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.mangle = (n, text) => /\.html$/.test(n) ? text.slice(0, 5) : text; edit('synthetic edit');
    assert.strictEqual(await manual(), 'saved'); const r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DOCS); assert.match(r[0], /_report_v1_draft\.html を書き込みましたが、内容を確かめられませんでした$/); assert.deepStrictEqual(versions(), []);
    assert.ok(!JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions, 'no version record without a confirmed pair');
    dir.mangle = (n, text) => text; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.deepStrictEqual(versions(), [2], 'the unconfirmed number is not reused');
  });
  await scenario('照合できないとき（帳票があるのに読めない）は、無いものとも完成とも扱わず、保存を止める', async () => {
    const { dir, tag } = await withV1(), [docx1] = V1(tag), data = dir.files.get(A.FILES.data(tag)); dir.unreadable = n => n === docx1 ? 'synthetic unreadable document' : null; A.state.result.seconds = 2;
    const w = dir.writes.length; assert.strictEqual(await manual(), 'failed'); assert.strictEqual(dir.files.get(A.FILES.data(tag)), data, 'the month data is not written'); assert.deepStrictEqual(docWritesSince(dir, w), [], 'no document is written');
    let r = records(); assert.strictEqual(r.length, 1); assert.match(r[0], DATA); assert.match(r[0], /フォルダに保存できませんでした: synthetic unreadable document/); assert.strictEqual(A.isDirty(), true); assert.deepStrictEqual(versions(), [1]);
    dir.unreadable = () => null; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), []); assert.match(lastToast(), /v1 のまま/); assert.deepStrictEqual(docWritesSince(dir, w), []);
  });
  await scenario('旧い版の記録（完了情報が無い）: ファイルがあっても完成とは扱わず新しい番号で出す。両方無ければ同じ版で書いて完了情報を入れる', async () => {
    const legacy = (dir, tag) => { delete A.state.month.doc_versions[0].fp; const o = JSON.parse(dir.files.get(A.FILES.data(tag))); delete o.month.doc_versions[0].fp; dir.files.set(A.FILES.data(tag), JSON.stringify(o)); A.markSaved(undefined, o.saved_at); };
    { const { dir, tag } = await withV1(), [docx1, html1] = V1(tag), a = dir.files.get(docx1), b = dir.files.get(html1); legacy(dir, tag);
      assert.strictEqual(prepKind(await A.prepareSave()), 'reuse'); assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(versions(), [1, 2], 'a record without completion info is never proof'); assert.strictEqual(dir.files.get(docx1), a); assert.strictEqual(dir.files.get(html1), b);
      assert.ok(Array.isArray(A.state.month.doc_versions[1].fp)); const w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), [], 'the new version is confirmed from then on'); }
    { const { dir, tag } = await withV1(), [docx1, html1] = V1(tag); legacy(dir, tag); dir.files.delete(docx1); dir.files.delete(html1);
      assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(versions(), [1]); assert.ok(dir.files.get(docx1) && dir.files.get(html1)); assert.ok(Array.isArray(A.state.month.doc_versions[0].fp), 'the rewritten pair gets completion info'); assert.strictEqual(A.isDirty(), false); }
  });
  await scenario('2 つのウィンドウ: ほかのウィンドウが同じ版の帳票を書き足した後、古い完了情報を持つ側が保存しても、版を増やさず保存先の記録に合わせる', async () => {
    const { dir, tag } = await withV1(), [docx1] = V1(tag), stale = JSON.parse(JSON.stringify(A.state.month.doc_versions)), make = T.makeDocx;
    // ウィンドウ 1: 勤務表が消えていたので書き足した（別の日に作ったので中身が少し違う）
    dir.files.delete(docx1); T.makeDocx = async (P, asg, label) => new Blob(['synthetic roster ' + label + ' (written on another day)']);
    try { assert.strictEqual(await manual(), 'saved'); } finally { T.makeDocx = make; }
    const fresh = JSON.parse(dir.files.get(A.FILES.data(tag))); assert.notDeepStrictEqual(fresh.month.doc_versions[0].fp, stale[0].fp, 'the folder now records the rewritten roster');
    // ウィンドウ 2: 古い完了情報のまま（統合では同じ版は手元の記録が残る）。保存先とは同期している
    A.state.month.doc_versions = stale; A.markSaved(undefined, fresh.saved_at); A.state.result.seconds = 9; toasts.length = 0;
    const w = dir.writes.length; assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(docWritesSince(dir, w), [], 'no duplicate version is written'); assert.deepStrictEqual(versions(), [1]); assert.match(lastToast(), /v1 のまま/);
    assert.deepStrictEqual(A.state.month.doc_versions[0].fp, fresh.month.doc_versions[0].fp, 'this window adopts the completion info that describes the files'); assert.strictEqual(A.isDirty(), false);
    assert.deepStrictEqual(JSON.parse(dir.files.get(A.FILES.data(tag))).month.doc_versions[0].fp, fresh.month.doc_versions[0].fp, 'and does not write its stale info back');
  });
  await scenario('同じ手動保存で帳票の書込みも月データの書込みも失敗: 両方の記録が残り、その後の月データだけの自動保存の成功では月データの記録だけが消える', async () => {
    const dir = folder('synthetic-folder'), tag = open(dir); dir.refuse = n => /\.html$/.test(n) ? 'synthetic report refused' : isData(n) ? 'synthetic data refused' : null; edit('synthetic both fail');
    assert.strictEqual(await manual(), 'failed'); let r = records(); assert.strictEqual(r.length, 2, 'the document failure is recorded although the save failed as a whole'); assert.match(r.find(x => DOCS.test(x)), /synthetic report refused$/); assert.match(r.find(x => DATA.test(x)), /フォルダに保存できませんでした: synthetic data refused/);
    assert.strictEqual(summary(), '未解決 2 件（月データの保存 1 件、帳票の出力 1 件）。下に続きます'); assert.strictEqual(A.isDirty(), true); assert.deepStrictEqual(versions(), []);
    dir.refuse = () => null; edit('synthetic both fail, then autosave'); assert.strictEqual(await auto(), 'saved'); r = records(); assert.strictEqual(r.length, 1, 'the month data success clears only the month data record'); assert.match(r[0], DOCS); assert.strictEqual(A.isDirty(), false);
    assert.strictEqual(await manual(), 'saved'); assert.deepStrictEqual(records(), [], 'a completed output clears it'); const v = A.state.month.doc_versions.slice(-1)[0]; assert.ok(dir.files.get(v.docx) && dir.files.get(v.html));
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
