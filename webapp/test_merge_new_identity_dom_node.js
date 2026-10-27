// Static-authored candidate: neither this regression nor product code was executed here.
// Independently introduced names must not alias people during peer merge.
// Real production DOM, month readback, merge, save, import validation and Undo;
// fake OS folder handles, confirmation choice and timers. No browser/layout/solver claim.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_merge_new_identity_dom_node.js
// TOBAN_FOLDER_SOURCE=/path/to/original/app-folder.js supports a source-only reversion.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Merge new-identity regression requires installed jsdom 26.1.0. No dependency is downloaded. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha', 'Synthetic Beta'];
const gamma = 'Synthetic Gamma';
const rawRules = { profile: { id: 'synthetic-merge-identity', label: 'Synthetic merge identity', roles: [{ id: 'S', label: 'Staff', refs: [] }],
  shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 20 })), rule_states: { oncall: 'off', period_charge: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic base note', next_first_day_in_calendar: true,
  duty_days: Object.fromEntries(names.map(name => [name, {}])), unavailable_night: { [names[1]]: [5] }, fixed: { night: { 7: names[0] } }, local_sentinel: { keep: 1 } };
const key = 'toban_state_v2:/synthetic/merge-identity.html', dataName = '202611_data.json';
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
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/merge-identity.html', runScripts: 'outside-only' }), w = dom.window;
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
  w.localStorage.setItem(key, JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: {} }));
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
async function addLocal(a, input, recorded = true) {
  const { A, w, q } = a;
  if (recorded) {
    w.prompt = () => gamma;
    const add = q('#doctorTable [data-act="add"]'); assert(add, 'production Add button'); add.click(); await tick();
    assert(A.state.rules.doctors.some(d => d.name === gamma));
    assert(w.T.newPersons(A.state.renames, names, A.state.rules.doctors.map(d => d.name)).includes(gamma), 'production addition records new identity');
  } else {
    // Imported/local legacy settings may not contain the UI addition record.
    A.state.rules.doctors.push({ name: gamma, team: 'S', quota: 5 });
    A.state.rules.name_order = A.state.rules.doctors.map(d => d.name);
  }
  if (input) A.state.month.unavailable_night[gamma] = [8];
  A.renderAll(); A.readAll(); A.persist();
}
function renamePeer(a, { resultOnly = false, independentAdd = false } = {}) {
  const peer = incoming(a);
  if (independentAdd) {
    peer.rules.doctors.push({ name: gamma, team: 'S', quota: 5 });
    peer.rules.name_order = peer.rules.doctors.map(d => d.name);
    peer.month.unavailable_night[gamma] = [5];
  } else a.w.T.renameEverywhere(peer.rules, peer.month, names[1], gamma);
  if (resultOnly) {
    delete peer.month.unavailable_night[gamma];
    peer.result = { asg: { '5:night': { work: gamma, oc: [] } }, base_asg: { '5:night': { work: gamma, oc: [] } }, avoid_ref: { [gamma]: 2 }, at: peerAt };
  }
  return peer;
}
function wholeChoice(a, route, answer) {
  a.A.choose = async (message, options) => {
    const values = options.map(o => o.value); a.choices.push({ message, values });
    assert(values.includes(route === 'reconcile' ? 'file' : 'load'), 'must offer whole-version fallback, not settings-only merge');
    assert(!values.includes('mine') && !values.includes('theirs'), 'do not promise input auto-merge for ambiguous identities');
    assert(message.includes('same person'), 'explain identity ambiguity in English');
    return answer;
  };
}
async function canceled(a, route, input, options = {}) {
  await addLocal(a, input, options.recorded !== false);
  const peer = renamePeer(a, options); putPeer(a, peer); const before = checkpoint(a);
  wholeChoice(a, route, null);
  const status = await invoke(a, route);
  if (route !== 'reconcile') assert.equal(status, 'skipped');
  assert.equal(a.choices.length, 1); assertPreserved(a, before);
  assert.deepEqual(clone(a.A.state.month.unavailable_night[names[1]]), [5], 'original local person keeps their own restriction');
  assert.deepEqual(clone(a.A.state.month.unavailable_night[gamma] || []), input ? [8] : [], 'new local person never inherits peer restriction');
}
async function adoptWhole(a, route, input) {
  await addLocal(a, input); const peer = renamePeer(a), text = putPeer(a, peer);
  wholeChoice(a, route, route === 'reconcile' ? 'file' : 'load');
  const status = await invoke(a, route);
  if (route !== 'reconcile') assert.equal(status, 'skipped', 'load is not a save');
  assert.equal(a.choices.length, 1);
  assert(!a.A.state.rules.doctors.some(d => d.name === names[1]), 'whole peer roster replaces local roster');
  assert.deepEqual(clone(a.A.state.month.unavailable_night[gamma]), [5], 'only peer restriction, never the local new person day 8');
  assert.equal(a.A.state.month.notes, a.original.month.notes, 'discard local note as explicitly chosen');
  assert.equal(a.folder.files.get(dataName), text); assert.deepEqual(a.folder.writes, []);
  assert.equal(a.q('#btnUndo').disabled, true);
}
async function overwriteWhole(a, input) {
  await addLocal(a, input); putPeer(a, renamePeer(a)); wholeChoice(a, 'auto', 'overwrite');
  assert.equal(await invoke(a, 'auto'), 'saved'); assert.equal(a.choices.length, 1);
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert(saved.rules.doctors.some(d => d.name === names[1])); assert(saved.rules.doctors.some(d => d.name === gamma));
  assert.deepEqual(saved.month.unavailable_night[names[1]], [5]);
  assert.deepEqual(saved.month.unavailable_night[gamma] || [], input ? [8] : []);
  assert.equal(saved.month.notes, 'Synthetic local edit'); assert.deepEqual(saved.month.holidays || [], [], 'peer-only holidays are not merged');
}
const cases = [], test = (label, fn) => cases.push({ label, fn });
for (const route of ['auto', 'manual', 'reconcile']) for (const input of [false, true])
  test(route + ': cancel ambiguous new person; local input=' + input, a => canceled(a, route, input));
for (const route of ['auto', 'reconcile']) for (const input of [false, true])
  test(route + ': explicit whole-peer adoption; local input=' + input, a => adoptWhole(a, route, input));
for (const input of [false, true]) test('auto: explicit whole-local overwrite; local input=' + input, a => overwriteWhole(a, input));
test('independent same-name additions are not proof of shared identity', a => canceled(a, 'auto', true, { independentAdd: true }));
test('unrecorded fresh local name is still an unproven identity', a => canceled(a, 'auto', false, { recorded: false }));
test('peer result-only use cannot alias a local new person', a => canceled(a, 'auto', false, { resultOnly: true }));
test('control: local addition and peer unrelated month edit still merge', async a => {
  await addLocal(a, true); putPeer(a, incoming(a));
  a.A.choose = async () => { throw new Error('Unrelated peer edit needs no choice'); };
  assert.equal(await invoke(a, 'auto'), 'saved');
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.month.unavailable_night[gamma], [8]); assert.deepEqual(saved.month.unavailable_night[names[1]], [5]);
  assert.deepEqual(saved.month.holidays, [3]); assert.equal(saved.month.notes, 'Synthetic local edit');
});
test('control: a local rename with proven base origin is not a new identity', async a => {
  assert.equal(a.A.renameDoctor(names[1], gamma), true);
  // renameDoctor follows existing callers: the settings reader owns the roster cell.
  a.A.state.rules.doctors.find(d => d.name === names[1]).name = gamma;
  a.A.state.rules.name_order = a.A.state.rules.doctors.map(d => d.name);
  a.A.renderAll(); a.A.readAll(); a.A.persist();
  const peer = renamePeer(a); putPeer(a, peer);
  a.A.choose = async (message, options) => { assert(options.some(o => o.value === 'mine')); return 'mine'; };
  assert.equal(await invoke(a, 'auto'), 'saved');
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.month.unavailable_night[gamma], [5]); assert.deepEqual(saved.month.holidays, [3]);
});
test('control: distinct additions may keep the local settings and local new-person input', async a => {
  await addLocal(a, true);
  const peer = incoming(a); peer.rules.doctors.push({ name: 'Synthetic Delta', team: 'S', quota: 5 }); putPeer(a, peer);
  a.A.choose = async (message, options) => { assert(options.some(o => o.value === 'mine')); return 'mine'; };
  assert.equal(await invoke(a, 'auto'), 'saved');
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.month.unavailable_night[gamma], [8]); assert.deepEqual(saved.month.holidays, [3]);
  assert(!saved.rules.doctors.some(d => d.name === 'Synthetic Delta'));
});
const EXPECTED_CASES = 18; let started = 0, ended = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Merge new-identity regression timed out'); process.exit(1); }, 90000);
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
  finished = true; clearTimeout(watchdog); console.log(`Merge new-identity: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); clearTimeout(watchdog); process.exitCode = 1; });
