// A pending month creation must not adopt an outdated snapshot of the current month.
// Full production index.html + T.init + bound inputs/buttons/modal, fictional data only.
// jsdom and in-memory File System Access handles: no browser/permissions/layout claim.
// Run with TOBAN_DOM_MODULE=/installed/node_modules/jsdom (26.1.0).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Month source DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const source = f => fs.readFileSync(f === 'app-month.js' && process.env.TOBAN_MONTH_SOURCE || path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(__dirname, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const alpha = 'Synthetic Alpha', beta = 'Synthetic Beta', gamma = 'Synthetic Gamma';
const rules = { profile: { id: 'synthetic-month-source', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
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
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/month-source.html', runScripts: 'outside-only' }), w = dom.window;
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
  return { dom, w, A, root, q, change, manual, errors, alerts };
}

const EXPECTED_CASES = 13; let passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Month-source tests timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || passed + failed !== EXPECTED_CASES || failed) { console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, failed=${failed}, finished=${finished}`); process.exitCode = 1; } });
async function scenario(label, fn) { const app = await makeApp(); try { await fn(app); assert.deepEqual(app.errors, []); assert.deepEqual(app.alerts, []); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); } finally { app.dom.window.close(); } }
function editBalance(app, value, event = 'change') { const field = app.q('[data-bal="Synthetic Alpha"]'); assert(field); field.value = String(value); field.dispatchEvent(new app.w.Event(event, { bubbles: true })); }
async function prepare(app) { editBalance(app, 3); await app.manual(); }
async function start(app, { pause = true, target = '202612', source = '202611' } = {}) {
  const entered = gate(), release = gate();
  if (pause) app.root.readHook = async name => { if (name === source + '_data.json') { app.root.readHook = null; entered.resolve(); await release.promise; } };
  const sel = app.q('#monthSel');
  if (![...sel.options].some(o => o.value === target)) { const answers = [target.slice(0, 4), target.slice(4)]; app.w.prompt = () => answers.shift(); sel.value = '__other__'; } else sel.value = target;
  sel.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  if (pause) await entered.promise; else await until(() => !app.q('#modal').hidden, 'creation choice');
  return async (wait = true) => { release.resolve(); if (wait) await until(() => !app.q('#modal').hidden, 'creation choice'); };
}
async function answer(app, value = 'prev') {
  const matcher = { prev: /データから引き継いで作成/, empty: /空の月として作成/, cancel: /やめる/ }[value];
  const button = [...app.w.document.querySelectorAll('#modalBtns button')].find(b => matcher.test(b.textContent)); assert(button, 'creation choice ' + value); button.click();
  await until(() => app.A.switching === 0, 'creation completion');
}
function retained(app, monthRef, balance = 8) {
  const { A, root, q } = app;
  assert.equal(A.state.month, monthRef, 'current month identity retained'); assert.equal(A.tag(), '202611');
  assert.equal(A.state.month.history.work_balance[alpha], balance); assert.equal(q('[data-bal="Synthetic Alpha"]').value, String(balance));
  assert.equal(root.dirs.has('202612'), false, 'no new month file/directory');
  assert.equal(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.history.work_balance[alpha], balance, 'latest current month saved');
  const stored = JSON.parse(app.w.localStorage.getItem('toban_state_v2:/synthetic/month-source.html'));
  assert.equal(stored.month.month, 11); assert.equal(stored.month.history.work_balance[alpha], balance);
  assert.deepEqual(clone(A.state.month.fixed.night[7]), [alpha, beta]); assert.equal(A.state.month.local_fictional.sentinel, 'Keep extension');
}
(async () => {
  for (const phase of ['read', 'choice', 'unblurred']) await scenario('newer input during ' + phase + ' aborts stale creation and retry succeeds', async app => {
    await prepare(app); const ref = app.A.state.month, resume = await start(app);
    if (phase === 'choice') await resume();
    editBalance(app, 8, phase === 'unblurred' ? 'input' : 'change');
    if (phase !== 'choice') await resume();
    const undo = app.q('#undoNote').textContent; await answer(app); retained(app, ref); assert.equal(app.q('#undoNote').textContent, undo, 'Undo not cleared');
    const again = await start(app); await again(); await answer(app); assert.equal(app.A.tag(), '202612'); assert.equal(app.A.state.month.history.work_balance[alpha], 8);
  });
  await scenario('newer settings during source read are retained', async app => {
    await prepare(app); const ref = app.A.state.month, resume = await start(app);
    const field = app.q('[data-f="quota"]'); assert(field); field.value = '17'; field.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    assert.equal(app.A.state.rules.doctors[0].quota, 17); await resume(); await answer(app); retained(app, ref, 3); assert.equal(app.A.state.rules.doctors[0].quota, 17);
  });
  for (const key of ['month', 'rules']) await scenario('same-signature ' + key + ' replacement aborts stale adoption', async app => {
    await prepare(app); const resume = await start(app); app.A.state[key] = clone(app.A.state[key]); const ref = app.A.state.month;
    await resume(); await answer(app); retained(app, ref, 3);
  });
  await scenario('input while listing precedes source read and still invalidates source', async app => {
    await prepare(app); const ref = app.A.state.month, entered = gate(), release = gate(), entries = app.root.entries;
    app.root.entries = async function* () { app.root.entries = entries; entered.resolve(); await release.promise; yield* entries.call(app.root); };
    const sel = app.q('#monthSel'); sel.value = '202612'; sel.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await entered.promise; editBalance(app, 8); release.resolve(); await until(() => !app.q('#modal').hidden, 'creation choice'); await answer(app); retained(app, ref);
  });
  for (const moved of ['folder', 'month']) await scenario('existing ' + moved + ' guard remains effective', async app => {
    await prepare(app); const resume = await start(app);
    if (moved === 'folder') app.A.dirGen++; else { app.A.state.month = clone(app.A.state.month); app.A.state.month.month = 1; app.A.renderAll(); }
    // The pending read stops before opening a choice; release it without waiting for a modal.
    await resume(false); await until(() => app.A.switching === 0, 'stale read stopped');
    assert.equal(app.q('#modal').hidden, true); assert.equal(app.A.state.month.month, moved === 'folder' ? 11 : 1); assert.equal(app.root.dirs.has('202612'), false);
  });
  await scenario('unchanged current source creates the next month', async app => {
    await prepare(app); const resume = await start(app); await resume(); await answer(app); assert.equal(app.A.tag(), '202612'); assert.equal(app.A.state.month.history.work_balance[alpha], 3);
  });
  await scenario('cancel after newer input retains the current month', async app => {
    await prepare(app); const ref = app.A.state.month, resume = await start(app); editBalance(app, 8); await resume(); await answer(app, 'cancel');
    assert.equal(app.A.state.month, ref); assert.equal(app.A.state.month.history.work_balance[alpha], 8); assert.equal(app.q('[data-bal="Synthetic Alpha"]').value, '8');
  });
  await scenario('explicit empty creation remains available after source edit', async app => {
    await prepare(app); const resume = await start(app); editBalance(app, 8); await resume(); await answer(app, 'empty'); assert.equal(app.A.tag(), '202612'); assert.equal(app.A.state.month.history.work_balance[alpha], undefined);
  });
  await scenario('different month source is not confused with current input', async app => {
    app.A.state.month.month = 12; app.A.renderAll(); await prepare(app);
    const dir = await app.root.getDirectoryHandle('202610', { create: true });
    dir.files.set('202610_data.json', JSON.stringify({ rules: clone(app.A.state.rules), month: { year: 2026, month: 10, history: { work_balance: { [alpha]: 9 } } }, result: null }));
    await app.A.refreshMonths(); app.A.renderHeader();
    const resume = await start(app, { target: '202611', source: '202610' }); editBalance(app, 8); await resume(); await answer(app); assert.equal(app.A.tag(), '202611'); assert.equal(app.A.state.month.history.work_balance[alpha], 9);
  });
  finished = true; clearTimeout(watchdog); console.log(`Month source freshness: ${passed} passed, ${failed} failed`);
})().catch(e => { console.error(e); process.exitCode = 1; clearTimeout(watchdog); });
