// 開始画面が出ている間の知らせ: 通知欄は不透明な開始画面の下になって見えないので、開始画面の中の欄（#startNote）に出す。
// 開始画面を閉じるときに残っている知らせは通常の通知欄へ移し、閉じた後の知らせは通常の通知欄に出す。
// 本体の index.html（スタイルシート込み）と全ての app-*.js を T.init まで動かし、開始画面のボタンを実際に押す。フォルダは架空のもの。
// 前回のフォルダを覚えている開始画面（「開始（フォルダに再接続）」）は、架空の IndexedDB にフォルダの参照を入れて出す。
// 欄の配置はスタイルの宣言で見る（高さが固定・中でスクロール・ボタンや言語選択に重ねない・開始画面ごとスクロールできる）。箱の実際の位置・大きさは jsdom では分からない。
// Run: TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_start_note_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Start-screen note DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed path. This test was NOT run.');
const source = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(__dirname,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(__dirname,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const rules = {profile:{id:'synthetic-start',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:[{name:'Synthetic Alpha',team:'S',quota:20}],rule_states:{},weights:{}};
const month = {year:2026,month:11,next_first_day_in_calendar:true,notes:'Synthetic initial draft'};
const missing = () => Object.assign(new Error('Synthetic missing'), {name:'NotFoundError'});
// 読める架空のフォルダと、一覧を読めない架空のフォルダ
function readable(name) { const dirs = new Map(), files = new Map(); const file = (m, n, o) => { if (!o.create && !m.has(n)) throw missing(); return { getFile: async () => ({ text: async () => m.get(n) }), createWritable: async () => { let t; return { async write(b) { t = typeof b === 'string' ? b : await b.text(); }, async close() { m.set(n, t); } }; } }; };
  return { name, kind: 'directory', dirs, files, async *entries() { yield* dirs; },
    async getDirectoryHandle(n, o = {}) { if (!dirs.has(n)) { if (!o.create) throw missing(); const f = new Map(); dirs.set(n, { name: n, kind: 'directory', files: f, getFileHandle: async (x, oo = {}) => file(f, x, oo) }); } return dirs.get(n); },
    async getFileHandle(n, o = {}) { return file(files, n, o); } }; }
const unreadable = why => ({ name: 'Synthetic unreadable', kind: 'directory', async *entries() { throw Object.assign(new Error(why), { name: 'NotFoundError' }); }, async getDirectoryHandle() { throw missing(); }, async getFileHandle() { throw missing(); } });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
// 前回のフォルダの参照（権限は、聞かれるまで無い）。answer は許可を求められたときの答え。onList は一覧の読取り中に呼ぶ
function remembered(name, answer, onList) { const f = readable(name); return Object.assign(f, { async queryPermission() { return 'prompt'; }, async requestPermission() { if (answer === 'throw') throw new Error('Synthetic permission failure'); return answer; }, async isSameEntry(o) { return o === f; }, async *entries() { if (onList) onList(); yield* f.dirs; } }); }
// 架空の IndexedDB（フォルダの参照を覚える kv だけ）
function fakeIndexedDB(store) { const req = fn => { const r = {}; setTimeout(() => { try { r.result = fn(); if (r.onsuccess) r.onsuccess(); } catch (e) { r.error = e; if (r.onerror) r.onerror(); } }, 0); return r; };
  const db = { createObjectStore() {}, transaction() { return { objectStore() { return { get: k => req(() => store.get(k)), put: (v, k) => req(() => { store.set(k, v); }) }; } }; } }; return { open() { return req(() => db); } }; }
// 要素に当たる全ての規則（印刷用を除く。詳細度・書かれた順・画面幅の条件は区別しない）が宣言している値を、性質ごとに全部集める。
// 値を確かめる性質は「宣言が 1 通りで、その値」であること（only）、あってはならない性質は「どの規則も宣言していない」こと（none）で見る。
// どの規則が勝つかを計算しないので、前に置いた詳細度の高い打ち消し・!important・画面幅ごとの打ち消しも、宣言が 2 通りになって拾える
function declared(w, el) { const out = {}; const visit = rules => { for (const r of rules) { if (!r.selectorText) { if (r.cssRules && !/print/.test(r.conditionText || '')) visit(r.cssRules); continue; }
  let hit = false; try { hit = el.matches(r.selectorText); } catch (e) { } if (hit) for (let i = 0; i < r.style.length; i++) { const k = r.style[i], v = r.style.getPropertyValue(k); (out[k] ||= []).includes(v) || out[k].push(v); } } }; for (const sheet of w.document.styleSheets) visit(sheet.cssRules); return out; }
const only = (d, prop, value, why) => assert.deepStrictEqual(d[prop] || [], [value], why + ': ' + prop + ' is declared once, as ' + value);
const none = (d, props, why) => { for (const prop of props) assert.deepStrictEqual(d[prop] || [], [], why + ': ' + prop + ' is not declared by any rule'); };
// 開始画面が出るところまで本体を動かす。before(A, w) は、開始画面を出す処理（restoreFolder）の前に行うこと。stored は覚えているフォルダの参照
async function makeApp(before, stored) {
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/start.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = []; w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = () => true; w.alert = msg => { throw new Error(msg); }; w.prompt = () => null;
  let pick = null; w.showDirectoryPicker = async () => { if (!pick) throw new w.DOMException('Synthetic user cancelled', 'AbortError'); return pick; }; // これがあると「フォルダを開いて開始」の開始画面になる
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(month), PROFILES: [], LANGS_DATA: ['ja.json', 'en.json'].map(f => JSON.parse(fs.readFileSync(path.join(__dirname, 'lang', f), 'utf8'))) };
  const kv = new Map(); if (stored) w.indexedDB = fakeIndexedDB(kv);
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app, restore = A.restoreFolder; let started = false; if (stored) kv.set(A.DIR_KEY, stored); A.restoreFolder = (...a) => { started = true; return before ? undefined : restore(...a); }; // before を使う場面では、開始画面を出す処理を後で呼ぶ
  // 通知の消去（4 秒）・自動保存（3 秒）など、1 秒以上のタイマーは待たない。張られた数だけ数える（開始画面の欄に出す知らせには、どんな長さのタイマーも張らない）
  const timers = []; const native = w.setTimeout.bind(w); w.setTimeout = (fn, delay, ...a) => { if (delay >= 1000) { timers.push(delay); return 99; } return native(fn, delay, ...a); };
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init(); assert.ok(started, 'init asks for the start screen');
  const q = s => w.document.querySelector(s);
  if (before) { await before(A, w, q); restore(); }
  for (let i = 0; i < 400 && q('#startGate').hidden; i++) await tick(5);
  assert.strictEqual(q('#startGate').hidden, false, 'the start screen is shown');
  const press = async i => { const b = w.document.querySelectorAll('#startBtns button')[i]; assert(b, 'start-screen button ' + i); b.click(); for (let k = 0; k < 400 && b.disabled; k++) await tick(5); assert.strictEqual(b.disabled, false, 'the action finished'); await tick(); };
  const view = () => ({ gate: !q('#startGate').hidden, note: q('#startNote').textContent, toast: q('#toast').hidden ? null : q('#toast').textContent });
  return { dom, w, A, q, errors, timers, press, view, setPick: p => { pick = p; } };
}
let cases = 0, finished = false; const EXPECTED_CASES = 9;
process.on('exit', () => { if ((!finished || cases !== EXPECTED_CASES) && !process.exitCode) { console.error('NOT COMPLETED: ' + cases + '/' + EXPECTED_CASES + ' cases passed, finished=' + finished); process.exitCode = 1; } });
async function scenario(name, fn, before, stored) { const app = await makeApp(before, stored); try { await fn(app); assert.deepStrictEqual(app.errors, [], 'no page error'); cases++; console.log('PASS ' + name); } finally { app.dom.window.close(); } }
(async () => {
  await scenario('開始画面が出ている間の知らせは開始画面の中の欄に出て、通知欄は使わず、時間では消えない', async ({ A, q, view, timers }) => {
    assert.strictEqual(q('#startNote').parentElement, q('#startBox'), 'the note is inside the start screen'); assert.strictEqual(q('#startNote').getAttribute('role'), 'status');
    assert.deepStrictEqual(view(), { gate: true, note: '', toast: null }); timers.length = 0;
    A.toast('架空の知らせ 1'); assert.deepStrictEqual(view(), { gate: true, note: '架空の知らせ 1', toast: null }); assert.deepStrictEqual(timers, [], 'no hide timer for a start-screen note');
    A.toast('架空の知らせ 2'); assert.deepStrictEqual(view(), { gate: true, note: '架空の知らせ 2', toast: null }, 'the newer note replaces the older one');
  });
  await scenario('開けなかった理由が開始画面の中に出て、開始画面は閉じない。もう一度押すと前の理由を消してから結果を出す', async ({ view, press, setPick }) => {
    setPick(unreadable('Synthetic folder cannot be listed')); await press(0);
    let v = view(); assert.strictEqual(v.gate, true, 'the start screen stays'); assert.match(v.note, /フォルダを読めませんでした: Synthetic folder cannot be listed/); assert.strictEqual(v.toast, null, 'nothing under the start screen');
    setPick(unreadable('Synthetic second reason')); await press(0); v = view(); assert.match(v.note, /Synthetic second reason/); assert.doesNotMatch(v.note, /cannot be listed/);
    setPick(null); await press(0); v = view(); assert.strictEqual(v.gate, true); assert.strictEqual(v.note, '', 'a cancelled choice leaves no stale reason from the earlier attempt');
  });
  await scenario('開けたら開始画面が閉じ、開始画面の欄の知らせは通常の通知欄へ移る。前の失敗の理由は出し直さない', async ({ A, view, press, setPick }) => {
    setPick(unreadable('Synthetic folder cannot be listed')); await press(0); assert.match(view().note, /フォルダを読めませんでした/);
    setPick(readable('Synthetic folder')); await press(0);
    let v = view(); assert.strictEqual(v.gate, false, 'the start screen is closed'); assert.strictEqual(v.note, '', 'the note is emptied'); assert.strictEqual(v.toast, 'フォルダ「Synthetic folder」を開きました', 'the last message is shown in the normal row');
    A.toast('架空の、開いた後の知らせ'); v = view(); assert.strictEqual(v.toast, '架空の、開いた後の知らせ', 'later notifications use the normal row'); assert.strictEqual(v.note, '');
  });
  await scenario('フォルダなしで続けるときも開始画面が閉じ、残っていた知らせは通常の通知欄へ移る', async ({ A, view, press }) => {
    A.toast('架空の、開始画面の間の知らせ'); assert.strictEqual(view().note, '架空の、開始画面の間の知らせ');
    await press(1); // 「フォルダなしで続ける」: 押した時点で前の知らせは消える（前の操作についての知らせ）
    const v = view(); assert.strictEqual(v.gate, false); assert.strictEqual(v.note, ''); assert.strictEqual(v.toast, null, 'a note from before the action is not carried over');
    A.toast('架空の、閉じた後の知らせ'); assert.strictEqual(view().toast, '架空の、閉じた後の知らせ');
  });
  await scenario('開始画面を出す直前に出ていた通知（前回のフォルダに接続できなかった理由など）は、開始画面の欄へ移る', async ({ view }) => {
    assert.deepStrictEqual(view(), { gate: true, note: '前回のフォルダに接続できませんでした: Synthetic stale handle', toast: null });
  }, async (A, w, q) => { A.toast('前回のフォルダに接続できませんでした: Synthetic stale handle'); assert.strictEqual(q('#toast').hidden, false, 'shown in the row while the start screen is not up yet'); });
  await scenario('欄の場所は開始画面の中に常に確保され、高さは文の有無・長さで変わらない（ボタン・言語選択に重ねず、長い文は欄の中で、低い画面は開始画面ごとスクロール）', async ({ A, q, w }) => {
    const note = q('#startNote'), gate = q('#startGate'), box = q('#startBox');
    assert.ok(w.document.styleSheets.length && w.document.styleSheets[0].cssRules.length > 50, 'the stylesheet is loaded');
    assert.strictEqual(q('#startBtns').nextElementSibling, note, 'the note follows the buttons in the normal flow of the box'); assert.ok(box.contains(q('#startLang')) && !note.contains(q('#startLang')));
    const check = when => { const n = declared(w, note);
      only(n, 'height', 'calc(4.5em + 10px)', when + ': fixed height'); only(n, 'box-sizing', 'border-box', when); none(n, ['max-height', 'min-height', 'block-size'], when + ': fixed height');
      only(n, 'overflow-y', 'auto', when + ': long text scrolls inside the note'); none(n, ['overflow', 'overflow-x'], when + ': not clipped'); only(n, 'white-space', 'pre-wrap', when); only(n, 'overflow-wrap', 'anywhere', when);
      none(n, ['position', 'top', 'bottom', 'left', 'right', 'inset', 'float', 'transform', 'z-index'], when + ': in the flow, never on top of the buttons or the language select'); none(n, ['display', 'visibility', 'opacity', 'clip', 'clip-path'], when + ': never removed');
      const cs = w.getComputedStyle(note); assert.notStrictEqual(cs.display, 'none', when + ': the space is reserved'); assert.notStrictEqual(cs.visibility, 'hidden'); };
    assert.strictEqual(note.textContent, ''); check('empty'); A.toast('架空の長い知らせ '.repeat(40)); assert.notStrictEqual(note.textContent, ''); check('with a long text');
    const g = declared(w, gate); only(g, 'overflow', 'auto', 'the start screen itself scrolls when the window is too low'); none(g, ['overflow-x', 'overflow-y'], 'the start screen scrolls'); only(g, 'position', 'fixed', 'the start screen covers the page'); only(g, 'display', 'flex', 'the start screen centres its box');
    only(declared(w, box), 'margin', 'auto', 'the box is centred without being cut off at the top when it is taller than the window'); assert.notStrictEqual(w.getComputedStyle(gate).display, 'none');
  });
  // ---- 前回のフォルダを覚えている開始画面（「開始（フォルダに再接続）」）
  for (const answer of ['denied', 'throw']) await scenario('再接続できなかった（' + (answer === 'denied' ? '許可されなかった' : '許可の確認が失敗した') + '）: 理由が開始画面の欄に出て、開始画面は閉じない', async ({ A, q, view, press, w }) => {
    assert.match(w.document.querySelectorAll('#startBtns button')[0].textContent, /開始（フォルダ「Synthetic remembered」に再接続）/, 'this is the start screen of a remembered folder'); assert.deepStrictEqual(view(), { gate: true, note: '', toast: null });
    await press(0); const v = view(); assert.strictEqual(v.gate, true, 'the start screen stays'); assert.strictEqual(v.note, '再接続できませんでした。「別のフォルダを開く」で保存フォルダを選び直してください'); assert.strictEqual(v.toast, null, 'nothing under the start screen'); assert.ok(!A.dirHandle);
  }, null, remembered('Synthetic remembered', answer));
  { let app = null, listed = 0;
    await scenario('再接続できた: 開始画面が閉じ、読取り中に出ていた知らせを通常の通知欄へ移してから「再接続しました」を出す（古い知らせが後から置き換えない）', async a => {
      app = a; const { A, view, press } = a; assert.deepStrictEqual(view(), { gate: true, note: '', toast: null });
      await press(0); await tick(20); await tick(20); // 後から出し直す実装（次の処理・次のタイマー）だと、ここまでに古い知らせが新しい通知を置き換える
      const v = view(); assert.strictEqual(v.gate, false, 'the start screen is closed'); assert.strictEqual(v.note, '', 'the note is emptied'); assert.strictEqual(v.toast, 'フォルダ「Synthetic remembered」に再接続しました', 'the newer notification is the one that stays');
      assert.strictEqual(A.dirHandle && A.dirHandle.name, 'Synthetic remembered'); assert.ok(listed >= 1, 'a note was raised while the folder was read');
    }, null, remembered('Synthetic remembered', 'granted', () => { if (app) { listed++; assert.strictEqual(app.view().gate, true, 'the folder is read while the start screen is shown'); app.A.toast('架空の、読取り中の知らせ'); assert.strictEqual(app.view().note, '架空の、読取り中の知らせ'); } })); }
  console.log(cases + '/' + EXPECTED_CASES + ' start-screen note cases passed'); finished = true;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
