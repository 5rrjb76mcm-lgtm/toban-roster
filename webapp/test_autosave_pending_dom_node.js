// C01: pending DOM drafts survive asynchronous automatic peer merge.
// Static-authored; not executed during cloud preparation.
// Full production index.html + T.init + bound inputs/buttons/modal, fictional data only.
// jsdom and in-memory File System Access handles: no browser/permissions/layout claim.
// Run with TOBAN_DOM_MODULE=/installed/node_modules/jsdom (26.1.0).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const ROOT = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + JSON.stringify(ROOT));
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Pending DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE; missing dependency is a failure, never a skip.');
const source = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(ROOT, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(ROOT, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rules.json'), 'utf8'));
const initial = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/202611.json'), 'utf8'));
initial.notes = 'Synthetic base note'; initial.day_notes = { 8: 'Synthetic retained meeting' };
initial.local_synthetic = { sentinel: 'Synthetic retained extension' };
initial.fixed ||= {}; initial.fixed.night ||= {}; initial.fixed.night[7] = ['Dr E', 'Dr F'];
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
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/pending-dom.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/ja.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // OS attachment only; production input, merge, save and render functions remain intact.
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  let scheduled = null; const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { scheduled = fn; return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s), key = 'toban_state_v2:/synthetic/pending-dom.html';
  const event = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const change = (selector, value) => { const el = q(selector); assert(el, selector); el.value = value; event(el, 'change'); return el; };
  const input = (selector, value) => { const el = q(selector); assert(el, selector); el.focus(); el.value = value; event(el, 'input'); return el; };
  const auto = () => { assert(scheduled, 'bound change scheduled autosave'); const fn = scheduled; scheduled = null; return fn(); };
  const dir = await root.getDirectoryHandle('202611', { create: true });
  // Establish the production common base via JSON autosave, not mocked state/meta.
  change('[data-path="notes"]', 'Synthetic base note'); assert.equal(await auto(), 'saved');
  const base = JSON.parse(dir.files.get('202611_data.json'));
  const setup = (conflict = false) => {
    const peer = clone(base); peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.day_notes[7] = 'Synthetic peer day note';
    if (conflict) peer.month.notes = 'Synthetic competing peer note';
    dir.files.set('202611_data.json', JSON.stringify(peer)); root.writes.length = 0;
    change('[data-path="notes"]', 'Synthetic committed local note');
    return dir.files.get('202611_data.json');
  };
  const pause = () => { const entered = gate(), release = gate(); root.readHook = async name => { if (name === '202611_data.json') { root.readHook = null; entered.resolve(); await release.promise; } }; return { entered: entered.promise, release: release.resolve }; };
  const checkpoint = () => ({ state: JSON.stringify(A.state), refs: { ...A.state }, stored: w.localStorage.getItem(key), undo: q('#undoNote').textContent, undoDisabled: q('#btnUndo').disabled, generation: A.saveGen, disk: dir.files.get('202611_data.json') });
  const retained = (before, el, value) => {
    assert.equal(JSON.stringify(A.state), before.state, 'no state/base/meta change');
    for (const k of Object.keys(before.refs)) assert.equal(A.state[k], before.refs[k], 'preserve ' + k + ' reference');
    assert.equal(w.localStorage.getItem(key), before.stored, 'no browser storage write'); assert.equal(q('#undoNote').textContent, before.undo); assert.equal(q('#btnUndo').disabled, before.undoDisabled);
    assert.equal(A.saveGen, before.generation); assert.equal(dir.files.get('202611_data.json'), before.disk); assert.deepEqual(root.writes, []);
    assert(el.isConnected, 'same input node remains connected'); assert.equal(el.value, value); assert.equal(w.document.activeElement, el, 'draft remains focused');
  };
  const saved = () => JSON.parse(dir.files.get('202611_data.json'));
  const common = (meeting = 'Synthetic retained meeting') => { assert.equal(saved().month.day_notes[7], 'Synthetic peer day note'); assert.equal(saved().month.day_notes[8], meeting); assert.equal(saved().month.local_synthetic.sentinel, 'Synthetic retained extension'); assert.equal(A.isDirty(), false); };
  const modal = () => !q('#modal').hidden;
  const answer = cancel => { const buttons = [...w.document.querySelectorAll('#modalBtns button')]; const b = buttons.find(x => cancel ? /やめる|何もしない/.test(x.textContent) : /衝突は自分/.test(x.textContent)); assert(b, 'real merge decision button'); b.click(); };
  return { dom, w, A, root, q, event, change, input, auto, setup, pause, checkpoint, retained, saved, common, modal, answer, errors, alerts };
}
const cases = [], add = (name, fn) => cases.push({ name, fn });
const notes = '#monthSettings [data-path="notes"]', daynote = '#monthSettings [data-dnote="8"]', number = '#monthSettings [data-path="exceptions.weekend_balance_max_diff"]';
for (const timing of ['before autosave', 'during initial read']) for (const field of ['notes', 'day note', 'number']) {
  add(timing + ': ' + field + ' draft aborts then committed retry merges', async a => {
    a.setup(); const selector = field === 'notes' ? notes : field === 'day note' ? daynote : number, value = field === 'number' ? '9' : 'Synthetic pending ' + field;
    let saving, gate;
    if (timing === 'during initial read') { gate = a.pause(); saving = a.auto(); await gate.entered; }
    const el = a.input(selector, value), before = a.checkpoint();
    if (gate) gate.release(); else saving = a.auto();
    assert.equal(await saving, 'skipped'); a.retained(before, el, value); assert.equal(a.modal(), false);
    a.event(el, 'change'); assert.equal(await a.auto(), 'saved'); a.common(field === 'day note' ? value : undefined);
    const m = a.saved().month;
    assert.equal(field === 'notes' ? m.notes : field === 'day note' ? m.day_notes[8] : m.exceptions.weekend_balance_max_diff, field === 'number' ? 9 : value);
  });
}
add('no draft: ordinary nonconflicting autosave still merges', async a => { a.setup(); assert.equal(await a.auto(), 'saved'); a.common(); assert.equal(a.saved().month.notes, 'Synthetic committed local note'); assert.equal(a.modal(), false); });
add('edited flag is not sticky after typing back to committed DOM text', async a => { a.setup(); const text = a.q(notes).value; a.input(notes, 'Synthetic transient'); a.input(notes, text); assert.equal(await a.auto(), 'saved'); a.common(); assert.equal(a.saved().month.notes, text); });
for (const cancel of [false, true]) add('draft during merge choice: ' + (cancel ? 'cancel' : 'accept') + ' preserves all state and text', async a => {
  a.setup(true); const saving = a.auto(); await until(a.modal, 'actual merge choice');
  const el = a.input(daynote, 'Synthetic modal-time draft'), before = a.checkpoint(); a.answer(cancel);
  assert.equal(await saving, 'skipped'); a.retained(before, el, 'Synthetic modal-time draft');
});
add('same text after real change does not block later merge', async a => { a.setup(); a.input(notes, 'Synthetic committed twice'); a.event(a.q(notes), 'change'); assert.equal(await a.auto(), 'saved'); a.common(); assert.equal(a.saved().month.notes, 'Synthetic committed twice'); });

for (const pane of ['doctorPane', 'fixedPane']) for (const timing of ['before autosave', 'during initial read']) add(pane + ': ' + timing + ' draft is retained then committed', async a => {
  a.setup(); a.q('[data-sub="' + pane + '"]').click();
  let selector, value, person;
  if (pane === 'doctorPane') {
    person = a.A.names().find(n => a.A.state.month.regular_duties[n]?.length);
    assert(person, 'sample has a weekday pattern'); a.change('#docSel', person);
    const details = a.q('#patTbl').closest('details'); details.open = true;
    selector = '#patTbl input[data-f="nth"]'; value = '1,3';
  } else { selector = '#fixedPane input[data-fx="night"][data-d="7"][data-multi]'; value = 'Dr E'; }
  let saving, gate;
  if (timing === 'during initial read') { gate = a.pause(); saving = a.auto(); await gate.entered; }
  const el = a.input(selector, value), before = a.checkpoint();
  if (gate) gate.release(); else saving = a.auto();
  assert.equal(await saving, 'skipped'); a.retained(before, el, value);
  a.event(el, 'change'); assert.equal(await a.auto(), 'saved'); a.common();
  if (person) assert.deepEqual(a.saved().month.regular_duties[person][0].nth, [1, 3]);
  else assert.equal(a.saved().month.fixed.night[7], 'Dr E');
});

// Scope boundary: this patch protects the three input subpanes, not settings/rulesJson.
const EXPECTED_CASES = 15; assert.equal(cases.length, EXPECTED_CASES);
let passed = 0, completed = 0, finished = false;
for (const c of cases) console.log('REGISTER ' + c.name);
const watchdog = setTimeout(() => { console.error('Pending DOM regression timed out'); process.exit(1); }, 120000);
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES) { console.error(`INCOMPLETE_OR_FAILED ${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = 1; } });
(async () => {
  for (const c of cases) { let a, outcome = 'fail'; console.log('START ' + c.name);
    try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; outcome = 'pass'; console.log('PASS ' + c.name); }
    catch (e) { console.error('FAIL ' + c.name + '\n' + e.stack); }
    finally { if (a) a.dom.window.close(); completed++; console.log('COMPLETE ' + JSON.stringify({ name: c.name, outcome })); }
  }
  finished = true; clearTimeout(watchdog); console.log(`${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = passed === EXPECTED_CASES ? 0 : 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
