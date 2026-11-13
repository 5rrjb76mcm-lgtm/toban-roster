// Uncommitted settings must block replacement and unsaved inputs must block unload.
// Uses production DOM handlers and an in-memory filesystem; fictional sample data only.
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
if (!JSDOM) throw new Error('Rules JSON draft regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE; missing dependency is a failure, never a skip.');
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
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/rules-json-draft.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/ja.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // OS attachment only; production input, merge, save and render functions remain intact.
  const toasts = [], showToast = A.toast; A.toast = msg => { toasts.push(String(msg)); return showToast(msg); }; // record only; the production toast still runs
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  let scheduled = null; const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { scheduled = fn; return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s), key = 'toban_state_v2:/synthetic/rules-json-draft.html';
  const event = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const change = (selector, value) => { const el = q(selector); assert(el, selector); el.value = value; event(el, 'change'); return el; };
  const input = (selector, value) => { const el = q(selector); assert(el, selector); el.focus(); el.value = value; event(el, 'input'); return el; };
  const auto = () => { assert(scheduled, 'bound change scheduled autosave'); const fn = scheduled; scheduled = null; return fn(); };
  const dir = await root.getDirectoryHandle('202611', { create: true });
  // Establish the production common base via JSON autosave, not mocked state/meta.
  change('[data-path="notes"]', 'Synthetic base note'); assert.equal(await auto(), 'saved');
  const base = JSON.parse(dir.files.get('202611_data.json'));
  const peer = (conflict = false) => {
    const peer = clone(base); peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.day_notes[7] = 'Synthetic peer day note';
    if (conflict) peer.month.notes = 'Synthetic competing peer note';
    dir.files.set('202611_data.json', JSON.stringify(peer)); root.writes.length = 0;
    return dir.files.get('202611_data.json');
  };
  const setup = (conflict = false) => { const bytes = peer(conflict); change('[data-path="notes"]', 'Synthetic committed local note'); return bytes; };
  const pause = () => { const entered = gate(), release = gate(); root.readHook = async name => { if (name === '202611_data.json') { root.readHook = null; entered.resolve(); await release.promise; } }; return { entered: entered.promise, release: release.resolve }; };
  const checkpoint = () => ({ state: JSON.stringify(A.state), refs: { ...A.state }, stored: w.localStorage.getItem(key), undo: q('#undoNote').textContent, undoDisabled: q('#btnUndo').disabled, generation: A.saveGen, disk: dir.files.get('202611_data.json') });
  const retained = (before, el, value, focused = true) => {
    assert.equal(JSON.stringify(A.state), before.state, 'no state/base/meta change');
    for (const k of Object.keys(before.refs)) assert.equal(A.state[k], before.refs[k], 'preserve ' + k + ' reference');
    assert.equal(w.localStorage.getItem(key), before.stored, 'browser storage contents unchanged'); assert.equal(q('#undoNote').textContent, before.undo); assert.equal(q('#btnUndo').disabled, before.undoDisabled);
    assert.equal(A.saveGen, before.generation); assert.equal(dir.files.get('202611_data.json'), before.disk); assert.deepEqual(root.writes, []);
    assert(el.isConnected, 'same input node remains connected'); assert.equal(el.value, value); if (focused) assert.equal(w.document.activeElement, el, 'draft remains focused');
    assert.equal(el.dataset.pluginDraft, '1', 'unapplied marker is retained');
  };
  const saved = () => JSON.parse(dir.files.get('202611_data.json'));
  const common = (meeting = 'Synthetic retained meeting') => { assert.equal(saved().month.day_notes[7], 'Synthetic peer day note'); assert.equal(saved().month.day_notes[8], meeting); assert.equal(saved().month.local_synthetic.sentinel, 'Synthetic retained extension'); assert.equal(A.isDirty(), false); };
  const modal = () => !q('#modal').hidden;
  const answer = cancel => { const buttons = [...w.document.querySelectorAll('#modalBtns button')]; const b = buttons.find(x => cancel ? /やめる|何もしない/.test(x.textContent) : /衝突は自分/.test(x.textContent)); assert(b, 'real merge decision button'); b.click(); };
  const removePeer = () => { dir.files.delete('202611_data.json'); root.writes.length = 0; };
  return { dom, w, A, root, q, event, change, input, auto, peer, setup, pause, checkpoint, retained, saved, common, modal, answer, removePeer, errors, alerts, toasts };
}

const cases = [], add = (name, fn) => cases.push({ name, fn });
const fields = [
  ['name', '#doctorTable [data-f="name"]', 'Synthetic Pending Name'],
  ['years', '#doctorTable [data-f="years"]', '12'],
  ['profile label', '#setProfLabel', 'Synthetic Pending Profile'],
  ['weight', '#weightsTable [data-w]', '37'],
];
const enter = a => a.q('.tab[data-tab="settings"]').click();
for (const [label, selector, value] of fields) {
  add(label + ': clean saveBeforeSwitch must refuse uncommitted settings', async a => {
    enter(a); a.root.writes.length = 0;
    const el = a.input(selector, value), before = a.checkpoint();
    assert.equal(a.A.isDirty(), false); assert.equal(a.A.hasPendingSettingsDrafts(), true);
    assert.equal(await a.A.saveBeforeSwitch(), false, 'a clean model is not a clean settings editor');
    assert.equal(JSON.stringify(a.A.state), before.state); assert.equal(el.isConnected, true);
    assert.equal(el.value, value); assert.equal(a.w.document.activeElement, el);
    assert.deepEqual(a.root.writes, []); assert.equal(a.modal(), false);
  });
  add(label + ': input during JSON read cancels replacement', async a => {
    enter(a); a.root.writes.length = 0;
    const paused = gate(), started = gate();
    const payload = clone(a.saved()); payload.month.notes = 'Synthetic replacement month';
    const loading = a.A.loadJsonFile({name:'synthetic-month.json', text:async()=>{ started.resolve(); await paused.promise; return JSON.stringify(payload); }});
    await started.promise;
    const el = a.input(selector, value), before = a.checkpoint(); paused.resolve(); await loading;
    assert.equal(a.A.state.month.notes, 'Synthetic base note', 'replacement must not overwrite while a newer settings draft is pending');
    assert.equal(JSON.stringify(a.A.state), before.state); assert.equal(el.isConnected, true); assert.equal(el.value, value);
    assert.deepEqual(a.root.writes, []);
  });
  add(label + ': pending input requests unload warning without committing', async a => {
    enter(a); const el = a.input(selector, value), before = a.checkpoint();
    assert.equal(a.A.isDirty(), false);
    const ev = new a.w.Event('beforeunload', { cancelable:true }); a.w.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, 'uncommitted input is unsaved too');
    assert.equal(JSON.stringify(a.A.state), before.state); assert.equal(el.value, value);
  });
}
add('month note draft requests unload warning without committing', async a => {
  const el = a.input('[data-path="notes"]', 'Synthetic unsaved note'), before = a.checkpoint();
  assert.equal(a.A.isDirty(), false); assert.equal(a.A.hasPendingInputDrafts(), true);
  const ev = new a.w.Event('beforeunload', {cancelable:true}); a.w.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true); assert.equal(JSON.stringify(a.A.state), before.state); assert.equal(el.value, 'Synthetic unsaved note');
});
add('reverted DOM projection neither blocks switching nor unload', async a => {
  enter(a); const selector = fields[0][1], shown = a.q(selector).value;
  a.input(selector, fields[0][2]); a.input(selector, shown);
  assert.equal(a.A.hasPendingSettingsDrafts(), false); assert.equal(await a.A.saveBeforeSwitch(), true);
  const ev = new a.w.Event('beforeunload', {cancelable:true}); a.w.dispatchEvent(ev); assert.equal(ev.defaultPrevented, false);
});
// post59 reinforcement. The cases above start from a clean model, so they stop at the first guard of saveBeforeSwitch.
// When the model is dirty, saveBeforeSwitch writes first and re-checks in its retry loop. A settings draft typed while
// that write is closing is newer than the save and outside the model signature; the second guard must still stop the switch.
const SWITCH_STOP = '読み込みまたは切り替えを中止しました（未確定の入力があります）。入力を確定してから、もう一度操作してください';
const SAVE_STOP = '保存を中止しました（未確定の入力があります）。入力を確定してから、もう一度保存してください';
const stops = a => a.toasts.filter(x => x === SWITCH_STOP || x === SAVE_STOP);
function pauseAfterDataWrite(a) { // pause once, right after the month data file has been written and closed
  const dir = a.root.dirs.get('202611'), original = dir.getFileHandle.bind(dir), entered = gate(), release = gate(); let armed = true;
  dir.getFileHandle = async (name, options) => { const handle = await original(name, options), create = handle.createWritable.bind(handle);
    handle.createWritable = async () => { const writable = await create(), close = writable.close.bind(writable);
      writable.close = async () => { await close(); if (armed && name === '202611_data.json') { armed = false; entered.resolve(); await release.promise; } }; return writable; };
    return handle; };
  return { entered: entered.promise, release: release.resolve };
}
add('retry guard control: a dirty model without a draft is saved and the switch proceeds', async a => {
  a.change('[data-path="notes"]', 'Synthetic committed local note'); enter(a); a.root.writes.length = 0; a.toasts.length = 0;
  const paused = pauseAfterDataWrite(a), switching = a.A.saveBeforeSwitch();
  await paused.entered; assert.equal(a.A.hasPendingSettingsDrafts(), false); paused.release();
  assert.equal(await switching, true, 'nothing is pending after the save');
  assert.equal(a.saved().month.notes, 'Synthetic committed local note'); assert.equal(a.A.isDirty(), false);
  assert.deepEqual(stops(a), []); assert.equal(a.modal(), false);
});
for (const [label, selector, value] of fields) add(label + ': draft typed while the pre-switch save is closing stops the switch (retry guard)', async a => {
  a.change('[data-path="notes"]', 'Synthetic committed local note'); enter(a); a.root.writes.length = 0; a.toasts.length = 0;
  const paused = pauseAfterDataWrite(a), switching = a.A.saveBeforeSwitch();
  await paused.entered; assert.equal(a.A.isDirty(), true, 'the save is still in flight');
  const el = a.input(selector, value); assert.equal(a.A.hasPendingSettingsDrafts(), true); paused.release();
  assert.equal(await switching, false, 'a draft newer than the completed save must stop the switch');
  assert.equal(a.saved().month.notes, 'Synthetic committed local note', 'the committed model was saved');
  assert.equal(a.A.isDirty(), false, 'the saved model is clean, so only the retry guard can stop here');
  assert.equal(el.isConnected, true); assert.equal(el.value, value); assert.equal(a.w.document.activeElement, el);
  assert.equal(a.modal(), false, 'no save-failure dialog: the save succeeded');
  assert.equal(stops(a).at(-1), SWITCH_STOP, 'the last stop notice names the switch: ' + JSON.stringify(a.toasts));
});
add('cancel wording: a refused switch says that loading or switching stopped, not saving', async a => {
  enter(a); a.root.writes.length = 0; const [, selector, value] = fields[0];
  a.input(selector, value); a.toasts.length = 0;
  assert.equal(await a.A.saveBeforeSwitch(), false); assert.deepEqual(stops(a), [SWITCH_STOP], JSON.stringify(a.toasts));
});
add('cancel wording: draft typed during a JSON read reports the stopped load, not a stopped save', async a => {
  enter(a); a.root.writes.length = 0; a.toasts.length = 0; const [, selector, value] = fields[0];
  const paused = gate(), started = gate(), payload = clone(a.saved()); payload.month.notes = 'Synthetic replacement month';
  const loading = a.A.loadJsonFile({ name: 'synthetic-month.json', text: async () => { started.resolve(); await paused.promise; return JSON.stringify(payload); } });
  await started.promise; a.input(selector, value); paused.resolve(); await loading;
  assert.equal(a.A.state.month.notes, 'Synthetic base note'); assert.deepEqual(stops(a), [SWITCH_STOP], JSON.stringify(a.toasts));
});
add('cancel wording: a refused save keeps the save wording, and both notices are translated differently', async a => {
  a.change('[data-path="notes"]', 'Synthetic committed local note'); enter(a); a.root.writes.length = 0;
  const [, selector, value] = fields[0]; a.input(selector, value); a.toasts.length = 0;
  const result = await a.A.saveToFolder(); assert.notEqual(result, 'saved'); assert.deepEqual(a.root.writes, []);
  assert(stops(a).length > 0, 'a stop notice is shown: ' + JSON.stringify(a.toasts)); assert(stops(a).every(x => x === SAVE_STOP), JSON.stringify(a.toasts));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/en.json'), 'utf8')).ui;
  assert.equal(typeof en[SWITCH_STOP], 'string'); assert.equal(typeof en[SAVE_STOP], 'string'); assert.notEqual(en[SWITCH_STOP], en[SAVE_STOP]);
  assert.match(en[SWITCH_STOP], /Loading or switching was canceled/); assert.doesNotMatch(en[SWITCH_STOP], /Saving stopped/);
});
let passed=0, failed=0, completed=false;
const expected=22;
process.on('exit',()=>{if(!completed || passed+failed!==expected)process.exitCode=1;});
(async()=>{assert.equal(cases.length,expected);for(const c of cases){let a;try{a=await makeApp();await c.fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name+'\n'+e.stack);}finally{a?.dom.window.close();}}completed=true;console.log(`ACCOUNTING ${passed} passed, ${failed} failed, ${expected} expected`);process.exitCode=failed?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
