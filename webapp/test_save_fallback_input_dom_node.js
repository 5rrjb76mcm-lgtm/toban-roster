// A completed import or live edit invalidates an older whole-state conflict choice.
// Full production index.html + T.init + bound inputs/buttons/modal, fictional data only.
// jsdom and in-memory File System Access handles: no browser/permissions/layout claim.
// Run with TOBAN_DOM_MODULE=/installed/node_modules/jsdom (26.1.0).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Save fallback DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_SAVE_FOLDER_SOURCE || path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(__dirname, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const alpha = 'Synthetic Alpha', beta = 'Synthetic Beta', gamma = 'Synthetic Gamma';
const rules = { profile: { id: 'synthetic-fallback', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: [alpha, beta, gamma].map(name => ({ name, team: 'S', quota: 20 })), rule_states: {}, weights: {} };
const initial = { year: 2026, month: 11, next_first_day_in_calendar: true, notes: 'Synthetic original draft', fixed: { night: { 7: [alpha, beta] } },
  day_notes: { 8: 'Keep fictional meeting' }, fixed_tags: { ['7:night|' + alpha]: 'Keep tag' }, local_fictional: { sentinel: 'Keep extension' } };
const missing = () => Object.assign(new Error('Synthetic missing'), { name: 'NotFoundError' });
function memoryFolder() {
  const dirs = new Map(), writes = [], root = { name: 'Synthetic folder', kind: 'directory', dirs, writes, readHook: null,
    async *entries() { yield* dirs; },
    async getDirectoryHandle(name, options = {}) {
      if (!dirs.has(name)) {
        if (!options.create) throw missing();
        const dir = { name, kind: 'directory', files: new Map(), async getFileHandle(n, o = {}) { return file(dir, n, o); } }; dirs.set(name, dir);
      }
      return dirs.get(name);
    },
    async getFileHandle() { throw missing(); }
  };
  async function file(dir, name, options) {
    if (!dir.files.has(name)) { if (!options.create) throw missing(); dir.files.set(name, ''); } // create establishes an empty entry immediately.
    return { async getFile() { return { async text() { const text = dir.files.get(name); if (root.readHook) await root.readHook(name); return text; } }; },
      async createWritable() { let staged; return { async write(blob) { staged = typeof blob === 'string' ? blob : await blob.text(); }, async close() { if (staged !== undefined) dir.files.set(name, staged); writes.push(dir.name + '/' + name); } }; } };
  }
  return root;
}
const tick = () => new Promise(r => setImmediate(r));
async function until(fn, label) { const deadline = Date.now() + 7000; while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp() {
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/save-fallback.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [], confirms = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = msg => { confirms.push(String(msg)); return true; }; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(__dirname, 'lang/ja.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // Initial OS attachment only; all input/import/save/merge/render code is production.
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  let scheduled = null; const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { scheduled = fn; return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s);
  const change = value => { const input = q('#monthSettings [data-path="notes"]'); assert(input); input.value = value; input.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const manual = () => { assert(q('#btnHeaderSave')); q('#btnHeaderSave').click(); return A.awaitSaves(); };
  const auto = () => { assert(scheduled, 'bound edit scheduled autosave'); const fn = scheduled; scheduled = null; return fn(); };
  const jsonImport = async data => {
    const input = q('#fileLoadJson'); Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'synthetic-month.json', text: async () => JSON.stringify(data) }] });
    input.dispatchEvent(new w.Event('change', { bubbles: true })); await until(() => A.switching === 0 && A.state.month.notes === data.month.notes, 'external JSON import');
  };
  const prev = { rules: clone(A.state.rules), month: { year: 2026, month: 10, next_first_day_in_calendar: true, history: { work_balance: { [alpha]: 8 } }, fixed: { night: { 32: gamma } } }, result: null };
  const prevDir = await root.getDirectoryHandle('202610', { create: true }); prevDir.files.set('202610_data.json', JSON.stringify(prev));
  const pausePrevious = () => { const entered = gate(), release = gate(); root.readHook = async name => { if (name === '202610_data.json') { root.readHook = null; entered.resolve(); await release.promise; } }; return { entered: entered.promise, release: release.resolve }; };
  const modal = () => !q('#modal').hidden && q('#modalBtns button');
  const answer = value => {
    const labels = { load: /相手の.*読み込む/, overwrite: /このブラウザの状態で上書き/, cancel: /何もしない|ブラウザ内の状態を保持/, file: /フォルダのデータを読み込む|相手の月を現在の役割として読み込む/, theirs: /衝突は相手の値/ };
    assert(modal()); const button = [...w.document.querySelectorAll('#modalBtns button')].find(b => labels[value].test(b.textContent)); assert(button, 'choice ' + value); button.click();
  };
  const stateSnapshot = () => ({ state: JSON.stringify(A.state), refs: { ...A.state }, stored: w.localStorage.getItem('toban_state_v2:/synthetic/save-fallback.html'), undo: q('#undoNote').textContent, undoDisabled: q('#btnUndo').disabled, saveGen: A.saveGen });
  const retained = before => { assert.equal(JSON.stringify(A.state), before.state, 'whole live state remains unchanged after stale choice'); for (const k of Object.keys(before.refs)) assert.equal(A.state[k], before.refs[k], k + ' reference'); assert.equal(w.localStorage.getItem('toban_state_v2:/synthetic/save-fallback.html'), before.stored, 'browser storage'); assert.equal(q('#undoNote').textContent, before.undo, 'Undo record retained'); assert.equal(q('#btnUndo').disabled, before.undoDisabled); assert.equal(A.saveGen, before.saveGen); assert.deepEqual(root.writes, [], 'no file writes'); };
  const unrelated = () => { assert.deepEqual(clone(A.state.month.fixed.night[7]), [alpha, beta]); assert.equal(A.state.month.day_notes[8], 'Keep fictional meeting'); assert.equal(A.state.month.fixed_tags['7:night|' + alpha], 'Keep tag'); assert.equal(A.state.month.local_fictional.sentinel, 'Keep extension'); };
  return { dom, w, A, root, q, change, manual, auto, jsonImport, pausePrevious, modal, answer, stateSnapshot, retained, unrelated, errors, alerts, confirms };
}
async function setupPeer(app, kind) {
  const { A, root, manual, jsonImport, change } = app;
  await manual(); assert.equal(A.isDirty(), false);
  if (kind === 'no-base') { const external = { rules: clone(A.state.rules), month: clone(A.state.month), result: null }; external.month.notes = 'Synthetic external JSON draft'; await jsonImport(external); assert.equal(A.state.base, null); assert.equal(A.state.baseRules, null); assert.equal(A.state.meta, null); }
  const dir = root.dirs.get('202611'), peer = JSON.parse(dir.files.get('202611_data.json')); peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.notes = 'Synthetic peer note';
  if (kind === 'other-facility') { peer.rules.profile.id = 'synthetic-other'; peer.month.profile_id = 'synthetic-other'; }
  if (kind === 'role-consent') { delete peer.rules; peer.month.fixed.night_oc_none = { 3: ['S'] }; }
  dir.files.set('202611_data.json', JSON.stringify(peer)); root.writes.length = 0;
  change('Synthetic live draft before conflict'); await tick();
  return { dir, peer, text: dir.files.get('202611_data.json') };
}
let passed = 0, failed = 0, finished = false; const EXPECTED_CASES = 24;
const watchdog = setTimeout(() => { console.error('Timed out before all save-fallback cases finished'); process.exitCode = 1; process.exit(1); }, 120000);
process.on('exit', () => { if (!finished || passed + failed !== EXPECTED_CASES) { console.error('NOT COMPLETED: ' + (passed + failed) + '/' + EXPECTED_CASES + ', finished=' + finished); process.exitCode = 1; } if (failed) process.exitCode = 1; });
async function scenario(label, fn) { const app = await makeApp(); try { await fn(app); assert.deepEqual(app.alerts, []); assert.deepEqual(app.errors, []); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message.split('\n')[0]); } finally { app.dom.window.close(); } }
(async () => {
  await scenario('ordinary real-button import establishes meaningful values and preserves unrelated inputs', async app => {
    app.change('Synthetic local note'); app.q('#btnImportPrev').click(); await until(() => app.A.switching === 0 && app.A.state.month.history.work_balance[alpha] === 8, 'ordinary import');
    assert.equal(app.A.state.month.fixed.night[1], gamma); assert.equal(app.A.state.month.notes, 'Synthetic local note'); app.unrelated(); assert.equal(app.q('#btnUndo').disabled, false);
  });
  for (const kind of ['common-base', 'no-base', 'other-facility', 'role-consent']) for (const mode of ['auto', 'header']) for (const decision of (kind === 'common-base' || kind === 'role-consent' ? ['load'] : ['load', 'overwrite'])) {
    await scenario(kind + '/' + mode + '/' + decision + ': completed import invalidates old choice', async app => {
      const { A, q, root } = app, f = await setupPeer(app, kind), pause = app.pausePrevious();
      q('#btnImportPrev').click(); await pause.entered; const saving = mode === 'auto' ? app.auto() : app.manual(); await until(app.modal, 'conflict choice');
      if (kind === 'no-base') assert.match(q('#modalMsg').textContent, /自動統合の元になる版がありません/);
      pause.release(); await until(() => A.switching === 0 && A.state.month.history.work_balance[alpha] === 8, 'import finishes while choice stays open');
      assert.equal(A.state.month.fixed.night[1], gamma); app.unrelated(); assert.equal(q('#btnUndo').disabled, false); assert.equal(root.writes.length, 0);
      const before = app.stateSnapshot(); app.answer(kind === 'common-base' ? 'theirs' : decision); const status = await saving;
      if (mode === 'auto') assert.equal(status, 'skipped'); app.retained(before); assert.equal(f.dir.files.get('202611_data.json'), f.text);
      // A fresh normal retry gets a new choice. Cancellation still leaves the completed import intact.
      const retry = mode === 'auto' ? app.auto() : app.manual(); await until(app.modal, 'fresh retry choice');
      const retryButtons = [...app.w.document.querySelectorAll('#modalBtns button')]; const cancel = retryButtons.find(b => /何もしない|やめる（統合しない）/.test(b.textContent)); assert(cancel); cancel.click(); await retry;
      assert.equal(A.state.month.history.work_balance[alpha], 8); assert.equal(A.state.month.fixed.night[1], gamma); assert.equal(f.dir.files.get('202611_data.json'), f.text); assert.deepEqual(root.writes, []);
    });
  }
  for (const kind of ['no-base', 'other-facility']) for (const decision of ['load', 'overwrite', 'cancel']) {
    await scenario(kind + ': unchanged ' + decision + ' decision retains ordinary behavior', async app => {
      const f = await setupPeer(app, kind), before = app.stateSnapshot(), saving = app.auto(); await until(app.modal, 'unchanged choice'); app.answer(decision); const status = await saving;
      if (decision === 'load') { assert.equal(status, 'skipped'); assert.equal(app.A.state.month.notes, f.peer.month.notes); assert.equal(app.q('#btnUndo').disabled, true); assert.equal(f.dir.files.get('202611_data.json'), f.text); assert.deepEqual(app.root.writes, []); }
      else if (decision === 'overwrite') { assert.equal(status, 'saved'); const data = JSON.parse(f.dir.files.get('202611_data.json')); assert.equal(data.month.notes, 'Synthetic live draft before conflict'); app.unrelated(); assert.equal(app.A.isDirty(), false); assert.deepEqual(app.root.writes, ['202611/202611_data.json']); }
      else { assert.equal(status, 'skipped'); app.retained(before); assert.equal(f.dir.files.get('202611_data.json'), f.text); }
    });
  }
  await scenario('unchanged role-consent load keeps its single informed choice', async app => {
    const f = await setupPeer(app, 'role-consent'), count = app.confirms.length, saving = app.auto(); await until(app.modal, 'role consent'); assert.match(app.q('#modalMsg').textContent, /固定「OCなし」/); app.answer('load'); await saving;
    assert.equal(app.confirms.length, count, 'no second native confirmation'); assert.deepEqual(clone(app.A.state.month.fixed.night_oc_none[3]), ['S']); assert.equal(f.dir.files.get('202611_data.json'), f.text); assert.deepEqual(app.root.writes, []);
  });
  // Reconcile has the same whole-state fallback. Its folder transition blocks a second import,
  // so exercise accepted live-input events during the dialog through the real textarea instead.
  for (const changed of [true, false]) for (const kind of ['no-base', 'other-facility']) {
    await scenario('reconcile/' + kind + ': ' + (changed ? 'later live input invalidates' : 'unchanged input accepts') + ' load', async app => {
      const f = await setupPeer(app, kind), { A, w, q } = app; w.showDirectoryPicker = async () => app.root;
      q('#btnOpenFolder').click(); await until(app.modal, 'bound folder-open reconcile choice'); assert.equal(A.switching, 1);
      if (changed) app.change('Synthetic newer live edit while reconcile dialog open'); await tick(); const before = app.stateSnapshot();
      app.answer('file'); await until(() => A.switching === 0, 'folder transition completes');
      if (changed) { app.retained(before); assert.equal(q('#monthSettings [data-path="notes"]').value, 'Synthetic newer live edit while reconcile dialog open'); }
      else { assert.equal(A.state.month.notes, f.peer.month.notes); assert.equal(q('#btnUndo').disabled, true); assert.deepEqual(app.root.writes, []); }
      assert.equal(f.dir.files.get('202611_data.json'), f.text);
    });
  }
  finished = true; clearTimeout(watchdog); console.log(passed + '/' + EXPECTED_CASES + ' save fallback DOM cases passed; failed=' + failed);
})().catch(e => { clearTimeout(watchdog); console.error(e.stack); process.exitCode = 1; });
