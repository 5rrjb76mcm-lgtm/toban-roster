// Unapplied rules JSON drafts survive navigation and block replacement of a clean model.
// Covers navigation, replacement guards, unload, explicit apply and explicit discard.
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
  const base = JSON.parse(dir.files.get('202611_data.json')); root.writes.length = 0;
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
  return { dom, w, A, root, q, event, change, input, auto, peer, setup, pause, checkpoint, retained, saved, common, modal, answer, removePeer, errors, alerts };
}
const cases = [], add = (name, fn) => cases.push({ name, fn });
const enter = a => { a.q('.tab[data-tab="settings"]').click(); a.q('#rulesJson').closest('details').open = true; };
const validDraft = a => { const R = clone(a.A.state.rules); R.local_synthetic_json_draft = { text: 'Synthetic explicit JSON edit' }; return JSON.stringify(R, null, 2); };
const draft = (a, value) => { const el = a.input('#rulesJson', value); el.setSelectionRange(5, 17); return el; };
const assertDraft = (a, before, el, value, focused = true) => {
  a.retained(before, el, value, focused); assert.equal(el.selectionStart, 5); assert.equal(el.selectionEnd, 17);
  assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined, 'JSON is never auto-applied');
};
const apply = async a => {
  a.q('#btnApplyRules').click();
  await until(() => !!a.A.state.rules.local_synthetic_json_draft && !a.A.switching, 'bound explicit JSON apply');
  assert.notEqual(a.q('#rulesJson').dataset.pluginDraft, '1');
};

const hasDraft = a => a.q("#rulesJson").dataset.pluginDraft === "1" && a.q("#rulesJson").value !== JSON.stringify(a.A.state.rules, null, 1);
// Navigation must preserve a draft without applying it or declaring it saved.
for (const kind of ['valid', 'invalid', 'format only']) {
  const valueFor = a => kind === 'valid' ? validDraft(a) : kind === 'invalid' ? '{ "synthetic incomplete": ' : JSON.stringify(a.A.state.rules, null, 2);
  for (const mode of ['same tab', 'tab round trip', 'render all']) add(kind + ': ' + mode, async a => {
    enter(a); const value = valueFor(a), el = draft(a, value), before = a.checkpoint();
    if (mode === 'same tab') a.q('.tab[data-tab="settings"]').click();
    else if (mode === 'tab round trip') { a.q('.tab[data-tab="input"]').click(); a.q('.tab[data-tab="settings"]').click(); }
    else a.A.renderAll();
    assertDraft(a, before, el, value, false); assert.equal(hasDraft(a), true);
    assert.equal(a.A.isDirty(), false, 'the model stays clean; draft is separate');
  });
  for (const mode of ['switch guard', 'JSON import', 'previous month import']) add(kind + ': ' + mode, async a => {
    enter(a); const value = valueFor(a), el = draft(a, value), before = a.checkpoint();
    let read = false; const file = { async text() { read = true; return JSON.stringify({ rules, month: initial }); } };
    if (mode === 'switch guard') assert.equal(await a.A.saveBeforeSwitch(), false);
    else if (mode === 'JSON import') await a.A.loadJsonFile(file);
    else await a.A.createFromPrevFile(file);
    assertDraft(a, before, el, value); assert.equal(read, false, 'blocked before external read');
    assert.equal(a.modal(), false, 'no unrelated save/merge choice');
  });
}
add('clean model with draft warns before unload', async a => {
  enter(a); draft(a, validDraft(a)); assert.equal(a.A.isDirty(), false);
  const event = new a.w.Event('beforeunload', { cancelable: true }); a.w.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});
add('clean model without draft does not warn before unload', async a => {
  const event = new a.w.Event('beforeunload', { cancelable: true }); a.w.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});
add('explicit Apply consumes draft and resumes ordinary rendering', async a => {
  enter(a); draft(a, validDraft(a)); await apply(a);
  assert.equal(hasDraft(a), false); a.A.renderAll();
  assert.equal(a.q('#rulesJson').value, JSON.stringify(a.A.state.rules, null, 1));
  assert.equal(await a.auto(), 'saved'); assert.equal(await a.A.saveBeforeSwitch(), true);
});
add('restoring original text permits switch without a sticky marker', async a => {
  enter(a); const original = a.q('#rulesJson').value; draft(a, validDraft(a)); a.input('#rulesJson', original);
  assert.equal(hasDraft(a), false); assert.equal(await a.A.saveBeforeSwitch(), true);
});

for (const accept of [false, true]) add('explicit discard: ' + (accept ? 'accept' : 'cancel'), async a => {
  enter(a); const value = '{ "synthetic invalid draft": ', el = draft(a, value), before = a.checkpoint();
  let asked = 0; a.w.confirm = () => { asked++; return accept; }; const button = a.q('#btnDiscardRulesJson'); assert(button, 'explicit discard is available'); button.click();
  assert.equal(asked, 1); assert.equal(JSON.stringify(a.A.state), before.state); assert.deepEqual(a.root.writes, []);
  if (!accept) assertDraft(a, before, el, value);
  else { assert.equal(el.value, JSON.stringify(a.A.state.rules, null, 1)); assert.equal(hasDraft(a), false); assert.equal(await a.A.saveBeforeSwitch(), true); }
});

// JSON drafts must survive ordinary settings commits, not just navigation/redraw.
for (const [kind, valueFor] of [['invalid', () => '{ "synthetic incomplete": '], ['valid', validDraft]]) {
  for (const [name, selector, value] of [['rule number', '#setRunMax', '7'], ['weight', '#weightsTable [data-w]', '37']]) {
    add(kind + ': commit ' + name, async a => {
      enter(a); if (name === 'rule number') { a.A.state.rules.rule_states.run_length_max = 'hard'; a.A.renderSettings(); }
      const valueJson = valueFor(a), json = draft(a, valueJson);
      const beforeRules = JSON.stringify(a.A.state.rules);
      const setting = a.input(selector, value); a.event(setting, 'focusout');
      assert.notEqual(JSON.stringify(a.A.state.rules), beforeRules, 'settings commit changed the model');
      assert.equal(json.value, valueJson, 'settings commit must not replace the JSON draft');
      assert.equal(a.A.hasPendingRulesJsonDraft(), true);
      assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined, 'JSON is not auto-applied');
    });
  }
}
add('edit and revert JSON before settings commit is not a draft', async a => {
  enter(a); const json = a.q('#rulesJson'), original = json.value;
  a.input('#rulesJson', original + ' '); a.input('#rulesJson', original);
  const mode = a.q('#setQuotaMode'), before = JSON.stringify(a.A.state.rules);
  a.change('#setQuotaMode', mode.value === 'share' ? 'absolute' : 'share');
  assert.notEqual(JSON.stringify(a.A.state.rules), before, 'settings change updated model');
  assert.equal(json.value, JSON.stringify(a.A.state.rules, null, 1));
  assert.equal(a.A.hasPendingRulesJsonDraft(), false);
});

add('repeated JSON edits follow model and preserve later draft', async a => {
  enter(a); const json = a.q('#rulesJson'), original = json.value;
  a.input('#rulesJson', original + ' '); a.input('#rulesJson', original);
  assert.equal(json.dataset.pluginDraft, '1'); assert.equal(a.A.hasPendingRulesJsonDraft(), false);
  const mode = a.q('#setQuotaMode'); a.change('#setQuotaMode', mode.value === 'share' ? 'absolute' : 'share');
  assert.equal(json.value, JSON.stringify(a.A.state.rules, null, 1));
  const value = validDraft(a); a.input('#rulesJson', value); assert.equal(a.A.hasPendingRulesJsonDraft(), true);
  a.A.renderAll(); assert.equal(json.value, value); assert.equal(a.A.hasPendingRulesJsonDraft(), true);
});
add('typed-back JSON tracks model after redraw', async a => {
  enter(a); const json = a.q('#rulesJson'), original = json.value;
  a.input('#rulesJson', original + ' '); a.input('#rulesJson', original);
  a.A.state.rules.synthetic_redraw = 'changed'; a.A.renderAll();
  assert.equal(json.value, JSON.stringify(a.A.state.rules, null, 1)); assert.equal(a.A.hasPendingRulesJsonDraft(), false);
});
const EXPECTED_CASES = 31; assert.equal(cases.length, EXPECTED_CASES);
let passed = 0, completed = 0, finished = false;
for (const c of cases) console.log('REGISTER ' + c.name);
const watchdog = setTimeout(() => { console.error('Rules JSON draft regression timed out'); process.exit(1); }, 120000);
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES) { console.error(`INCOMPLETE_OR_FAILED ${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = 1; } });
(async () => {
  for (const c of cases) { let a, outcome = 'fail'; console.log('START ' + c.name);
    try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; outcome = 'pass'; console.log('PASS ' + c.name); }
    catch (e) { console.error('FAIL ' + c.name + '\n' + e.stack); }
    finally { if (a) a.dom.window.close(); completed++; console.log('COMPLETE ' + JSON.stringify({ name: c.name, outcome })); }
  }
  finished = true; clearTimeout(watchdog); console.log(`${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = passed === EXPECTED_CASES ? 0 : 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
