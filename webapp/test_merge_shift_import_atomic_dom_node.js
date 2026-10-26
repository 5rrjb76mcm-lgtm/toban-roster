// Static-authored candidate: neither this regression nor product code was executed here.
// Peer merge must validate unsupported shifts before state/storage/base/Undo changes.
// Real production DOM, month readback, merge, save, import validation and Undo;
// fake OS folder handles, confirmation choice and timers. No browser/layout/solver claim.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_merge_shift_import_atomic_dom_node.js
// TOBAN_FOLDER_SOURCE=/path/to/original/app-folder.js supports a source-only reversion.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Merge shift-import regression requires installed jsdom 26.1.0. No dependency is downloaded. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'];
const rawRules = { profile: { id: 'synthetic-merge-shifts', label: 'Synthetic merge shifts', roles: [{ id: 'S', label: 'Staff', refs: [] }],
  shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 20 })), rule_states: { oncall: 'off', period_charge: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic base note', next_first_day_in_calendar: true,
  duty_days: Object.fromEntries(names.map(name => [name, {}])), fixed: { night: { 7: names[0] } }, local_sentinel: { keep: 1 } };
const key = 'toban_state_v2:/synthetic/merge-shifts.html', dataName = '202611_data.json';
const baseAt = '2026-10-01T00:00:00.000Z', peerAt = '2026-10-02T00:00:00.000Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
const missing = () => Object.assign(new Error('Synthetic missing entry'), { name: 'NotFoundError' });
function memoryFolder() {
  const files = new Map(), writes = [], creates = [];
  const dir = { kind: 'directory', name: '202611',
    async getFileHandle(name, options = {}) {
      if (!files.has(name)) { if (!options.create) throw missing(); files.set(name, ''); creates.push(name); }
      return { async getFile() { return { async text() { return files.get(name); } }; },
        async createWritable() { let pending; return {
          async write(blob) { pending = typeof blob === 'string' ? blob : await blob.text(); },
          async close() { if (pending !== undefined) files.set(name, pending); writes.push(name); }
        }; }
      };
    }
  };
  const folder = { kind: 'directory', name: 'Synthetic merge folder', files, writes, creates,
    async *entries() { yield ['202611', dir]; },
    async getDirectoryHandle(name) { if (name === '202611') return dir; throw missing(); },
    async getFileHandle() { throw missing(); }
  };
  return folder;
}
async function makeApp() {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/merge-shifts.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [], choices = [], toasts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = message => alerts.push(String(message)); w.prompt = () => null; w.Blob = globalThis.Blob;
  const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => delay === 3000 || delay === 4000 ? 0 : nativeTimer(fn, delay, ...args);
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app;
  A.restoreFolder = () => {}; A.toast = text => toasts.push(String(text));
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, JSON.stringify({ rules: initial, month: rawMonth, result: { local_result: 'Synthetic retained result' }, ui: {} }));
  w.T.init();
  const q = s => w.document.querySelector(s), folder = memoryFolder();
  A.dirHandle = folder; A.dirGen++; A.monthDirs = ['202611'];
  A.readAll(); A.markSaved('フォルダ ' + folder.name, baseAt);
  const original = JSON.parse(A.payloadJson(baseAt)); folder.files.set(dataName, JSON.stringify(original));
  A.clearUndo();
  const note = q('[data-path="notes"]'); assert(note);
  note.value = 'Synthetic local edit'; note.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(); A.readAll(); A.persist();
  assert.equal(A.isDirty(), true); assert.equal(q('#btnUndo').disabled, false);
  A.choose = async (message, options) => { choices.push({ message, values: options.map(o => o.value) }); return null; };
  return { dom, w, A, q, folder, original, errors, alerts, choices, toasts };
}
const incoming = a => { const peer = clone(a.original); peer.month.holidays = [3]; peer.saved_at = peerAt; return peer; };
function putPeer(a, peer) { const text = JSON.stringify(peer); a.folder.files.set(dataName, text); return text; }
const invoke = (a, route) => route === 'manual' ? a.A.saveToFolder() : route === 'auto' ? a.A.autosaveJson() : a.A.reconcileWithFolder();
function checkpoint(a) {
  return { state: JSON.stringify(a.A.state), refs: { ...a.A.state }, storage: a.w.localStorage.getItem(key), saveGen: a.A.saveGen,
    undo: a.q('#undoNote').textContent, rulesField: a.q('#rulesJson').value, note: a.q('[data-path="notes"]'), files: JSON.stringify([...a.folder.files]) };
}
function assertPreserved(a, before) {
  assert.equal(JSON.stringify(a.A.state), before.state, 'state including result, renames, metadata and merge bases');
  for (const k of Object.keys(before.refs)) assert.equal(a.A.state[k], before.refs[k], k + ' identity');
  assert.equal(a.w.localStorage.getItem(key), before.storage, 'browser recovery data');
  assert.equal(a.A.saveGen, before.saveGen, 'synchronization generation');
  assert.equal(a.q('#undoNote').textContent, before.undo, 'prior Undo history');
  assert.equal(a.q('#btnUndo').disabled, false);
  assert.equal(a.q('#rulesJson').value, before.rulesField, 'old settings remain displayed');
  assert.equal(a.q('[data-path="notes"]'), before.note, 'no partial rerender');
  assert.equal(JSON.stringify([...a.folder.files]), before.files, 'peer JSON remains byte-for-byte unchanged');
  assert.deepEqual(a.folder.writes, [], 'no filesystem writes'); assert.deepEqual(a.folder.creates, [], 'no newly created file');
  assert.equal(a.A.isDirty(), true);
}
async function rejection(a, route, shifts, nextFlag, load = false) {
  const peer = incoming(a); peer.rules.profile.shifts = clone(shifts); peer.month.next_first_day_in_calendar = nextFlag;
  putPeer(a, peer); const raw = JSON.stringify(peer), before = checkpoint(a);
  a.A.choose = async (message, options) => {
    a.choices.push({ message, values: options.map(o => o.value) });
    const wanted = route === 'reconcile' ? 'file' : 'load';
    assert(options.some(o => o.value === wanted), 'invalid peer is not silently adopted as a merge');
    return load ? wanted : null;
  };
  const status = await invoke(a, route);
  if (route !== 'reconcile') assert.equal(status, 'skipped');
  assert.equal(a.choices.length, 1, 'existing whole-version confirmation is retained');
  assert.equal(a.alerts.length, load ? 1 : 0, 'attempting whole-version load is rejected by its own validation'); a.alerts.length = 0;
  assertPreserved(a, before); assert.equal(JSON.stringify(peer), raw, 'caller-owned incoming fixture');
  a.A.undo(); await tick(); assert.equal(a.A.state.month.notes, a.original.month.notes, 'the earlier edit still has a functioning Undo');
}
async function accepted(a, route, edit) {
  const peer = incoming(a); edit(peer.rules); const expected = clone(peer.rules.profile.shifts), text = putPeer(a, peer);
  a.A.choose = async () => { throw new Error('Unrelated valid peer edits must merge without confirmation'); };
  const status = await invoke(a, route);
  if (route !== 'reconcile') assert.equal(status, 'saved');
  assert.deepEqual(clone(a.A.state.rules.profile.shifts), expected, 'raw accepted shift definitions');
  assert.equal(a.A.state.month.notes, 'Synthetic local edit'); assert.deepEqual(clone(a.A.state.month.holidays), [3]);
  assert.equal(a.q('#btnUndo').disabled, true, 'successful merge still clears pre-merge Undo');
  assert.doesNotThrow(() => a.A.renderAll(), 'accepted settings remain renderable');
  if (route === 'reconcile') { assert.equal(a.folder.files.get(dataName), text, 'reconcile itself does not write'); assert.equal(a.A.isDirty(), true); }
  else {
    const saved = JSON.parse(a.folder.files.get(dataName)); assert.deepEqual(saved.rules.profile.shifts, expected);
    assert.equal(saved.month.notes, 'Synthetic local edit'); assert.deepEqual(saved.month.holidays, [3]); assert.equal(a.A.isDirty(), false);
  }
}
const cases = [], test = (label, fn) => cases.push({ label, fn });
for (const route of ['auto', 'manual', 'reconcile']) for (const nextFlag of [true, false])
  test(route + ': unknown shift rejects before adoption; next-day marker ' + nextFlag, a => rejection(a, route, [{ id: 'swing' }], nextFlag));
for (const [label, shifts] of [
  ['unknown ID', [{ id: 'swing' }]], ['missing ID', [{}]], ['null entry', [null]],
  ['duplicate ID', [{ id: 'day' }, { id: 'day' }]], ['disabled night', [{ id: 'night', on: 'none' }]],
]) test('auto: whole-version load fallback also rejects ' + label, a => rejection(a, 'auto', shifts, true, true));
for (const shape of ['omitted', 'empty', 'partial']) test('auto: accepted ' + shape + ' definitions retain raw data', a => accepted(a, 'auto', rules => {
  if (shape === 'omitted') delete rules.profile.shifts;
  else rules.profile.shifts = shape === 'empty' ? [] : [{ id: 'day', on: 'all', label: { en: 'Synthetic day', ja: 'Synthetic day' }, local_shift: { keep: 7 } }];
}));
for (const route of ['manual', 'reconcile']) test(route + ': valid peer and local edits still merge', a => accepted(a, route, rules => {
  rules.profile.shifts = [{ id: 'day', on: 'all', local_shift: { keep: 9 } }];
}));
for (const [label, edit, field] of [
  ['negative weight', rules => { rules.rule_states.quota_target = 'soft'; rules.weights.target_deviation = -1; }, rules => rules.weights.target_deviation],
  ['array quota', rules => { rules.rule_states.quota_target = 'soft'; rules.doctors[0].quota = [2]; }, rules => rules.doctors[0].quota],
]) test('auto: repairable ' + label + ' is not overvalidated', async a => {
  await accepted(a, 'auto', edit);
  const expected = clone(a.original.rules); edit(expected);
  assert.deepEqual(clone(field(a.A.state.rules)), field(expected));
  assert.deepEqual(field(JSON.parse(a.folder.files.get(dataName)).rules), field(expected));
});
test('valid conflicting settings still allow choosing local rules while merging peer input', async a => {
  const peer = incoming(a); peer.rules.profile.label = 'Synthetic peer settings'; putPeer(a, peer);
  a.A.state.rules.profile.label = 'Synthetic local settings'; a.A.persist();
  a.A.choose = async (message, options) => { a.choices.push({ message, values: options.map(o => o.value) }); assert(options.some(o => o.value === 'mine')); return 'mine'; };
  assert.equal(await invoke(a, 'auto'), 'saved'); assert.equal(a.choices.length, 1);
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert.equal(saved.rules.profile.label, 'Synthetic local settings'); assert.equal(saved.month.notes, 'Synthetic local edit'); assert.deepEqual(saved.month.holidays, [3]);
});

const EXPECTED_CASES = 19; let started = 0, ended = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Merge shift-import regression timed out'); process.exit(1); }, 90000);
process.on('exit', () => {
  console.log(`ACCOUNTING registered=${cases.length} started=${started} ended=${ended} passed=${passed} failed=${failed} finished=${finished}`);
  if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1;
});
(async () => {
  assert.equal(cases.length, EXPECTED_CASES, 'case inventory');
  for (const [i, c] of cases.entries()) console.log(`CASE ${i + 1}/${EXPECTED_CASES} ${c.label}`);
  for (const [i, c] of cases.entries()) {
    let a; started++; console.log(`START ${i + 1}/${EXPECTED_CASES} ${c.label}`);
    try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.label); }
    catch (e) { failed++; console.error('FAIL ' + c.label + '\n' + (e.stack || e)); }
    finally { if (a) a.dom.window.close(); ended++; console.log(`END ${i + 1}/${EXPECTED_CASES} ${c.label}`); }
  }
  finished = true; clearTimeout(watchdog); console.log(`Merge shift-import: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); clearTimeout(watchdog); process.exitCode = 1; });
