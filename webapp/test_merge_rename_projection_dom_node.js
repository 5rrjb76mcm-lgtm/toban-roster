// Static-authored candidate: neither this regression nor product code was executed here.
// Concurrent renames of different people must not collapse a peer roster.
// Real production DOM, month readback, merge, save, import validation and Undo;
// fake OS folder handles, confirmation choice and timers. No browser/layout/solver claim.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_merge_rename_projection_dom_node.js
// TOBAN_FOLDER_SOURCE=/path/to/original/app-folder.js supports a source-only reversion.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Merge rename-projection regression requires installed jsdom 26.1.0. No dependency is downloaded. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha', 'Synthetic Beta'];
const gamma = 'Synthetic Gamma';
const rawRules = { profile: { id: 'synthetic-merge-projection', label: 'Synthetic merge identity', roles: [{ id: 'S', label: 'Staff', refs: [] }],
  shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 20 })), rule_states: { oncall: 'off', period_charge: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic base note', next_first_day_in_calendar: true,
  duty_days: Object.fromEntries(names.map(name => [name, {}])), unavailable_night: { [names[1]]: [5] }, fixed: { night: { 7: names[0] } }, local_sentinel: { keep: 1 } };
const key = 'toban_state_v2:/synthetic/merge-projection.html', dataName = '202611_data.json';
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
async function makeApp(kind = 'array') {
  const localMonth = clone(rawMonth); localMonth.fixed = {};
  localMonth.unavailable_night = kind === 'dict' ? { [names[1]]: [5] } : {};
  localMonth.unavailable_other = kind === 'array' ? [{ name: names[1], day: 5, part: 'allday' }] : [];
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/merge-projection.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [], choices = [], toasts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = message => alerts.push(String(message)); w.prompt = () => null; w.Blob = globalThis.Blob;
  const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => delay === 3000 || delay === 4000 ? 0 : nativeTimer(fn, delay, ...args);
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(localMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app;
  A.restoreFolder = () => {}; A.toast = text => toasts.push(String(text));
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, JSON.stringify({ rules: initial, month: localMonth, result: null, ui: {} }));
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
async function renameLocal(a, oldName, newName) {
  a.A.showTab('settings');
  const index = a.A.state.rules.doctors.findIndex(d => d.name === oldName);
  const input = a.q(`#doctorTable tr[data-i="${index}"] [data-f="name"]`);
  assert(input, 'real roster name input'); input.value = newName;
  input.dispatchEvent(new a.w.Event('change', { bubbles: true })); await tick();
  assert(a.A.state.rules.doctors.some(d => d.name === newName), 'production name change commits');
  assert(!a.A.state.rules.doctors.some(d => d.name === oldName));
  a.A.showTab('input'); a.A.readAll(); a.A.persist();
}
function peerRenamed(a, kind, from = names[1], to = gamma) {
  const peer = incoming(a); a.w.T.renameEverywhere(peer.rules, peer.month, from, to);
  if (kind === 'result') peer.result = { asg: { '5:night': { work: gamma, oc: [] }, '6:night': { work: names[0], oc: [] } },
    base_asg: { '5:night': { work: gamma, oc: [] }, '6:night': { work: names[0], oc: [] } }, avoid_ref: { [gamma]: 2, [names[0]]: 3 }, at: peerAt };
  return peer;
}
function wholeChoice(a, route, answer) {
  a.A.choose = async (message, options) => {
    const values = options.map(o => o.value); a.choices.push({ message, values });
    assert(values.includes(route === 'reconcile' ? 'file' : 'load'), 'must offer whole-version fallback before a settings-only choice');
    assert(!values.includes('mine') && !values.includes('theirs'), 'unsafe projection must not promise an input merge');
    assert(message.includes('two people'), 'explain the non-injective person mapping'); return answer;
  };
}
function assertRestriction(month, kind, who) {
  if (kind === 'array') assert.deepEqual(clone(month.unavailable_other).filter(x => +x.day === 5), [{ name: who, day: 5, part: 'allday' }]);
  if (kind === 'dict') assert.deepEqual(clone(month.unavailable_night[who]), [5]);
}
async function collision(a, kind) {
  await renameLocal(a, names[0], gamma);
  assert.equal(a.w.T.renameOrigin(a.A.state.renames, names, gamma), names[0], 'not a fresh added person');
  const peer = peerRenamed(a, kind); putPeer(a, peer);
  assert(peer.rules.doctors.some(d => d.name === names[0]));
  assert(peer.rules.doctors.some(d => d.name === gamma), 'peer has two distinct people before local forward projection');
  return peer;
}
const cases = [], test = (kind, label, fn) => cases.push({ kind, label, fn });
for (const kind of ['array', 'dict', 'result']) for (const route of ['auto', 'manual', 'reconcile'])
  test(kind, `${route}: cancel distinct-origin destination collision (${kind})`, async a => {
    await collision(a, kind); const before = checkpoint(a); wholeChoice(a, route, null);
    const status = await invoke(a, route); if (route !== 'reconcile') assert.equal(status, 'skipped');
    assert.equal(a.choices.length, 1); assertPreserved(a, before); assertRestriction(a.A.state.month, kind, names[1]);
  });
for (const kind of ['array', 'dict', 'result']) for (const route of ['auto', 'reconcile'])
  test(kind, `${route}: explicitly adopt the whole peer (${kind})`, async a => {
    const peer = await collision(a, kind), bytes = a.folder.files.get(dataName);
    wholeChoice(a, route, route === 'reconcile' ? 'file' : 'load');
    const status = await invoke(a, route); if (route !== 'reconcile') assert.equal(status, 'skipped');
    assert.equal(a.choices.length, 1); assert.deepEqual(clone(a.A.state.rules.doctors.map(d => d.name)), [names[0], gamma]);
    assertRestriction(a.A.state.month, kind, gamma); assert.equal(a.A.state.month.notes, a.original.month.notes);
    if (kind === 'result') { assert.deepEqual(clone(a.A.state.result.asg), peer.result.asg); assert.deepEqual(clone(a.A.state.result.avoid_ref), peer.result.avoid_ref); }
    assert.equal(a.folder.files.get(dataName), bytes); assert.deepEqual(a.folder.writes, []); assert.equal(a.q('#btnUndo').disabled, true);
  });
for (const kind of ['array', 'dict', 'result']) test(kind, `auto: explicitly retain the whole local version (${kind})`, async a => {
  await collision(a, kind); wholeChoice(a, 'auto', 'overwrite');
  assert.equal(await invoke(a, 'auto'), 'saved'); assert.equal(a.choices.length, 1);
  const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.rules.doctors.map(d => d.name), [gamma, names[1]]); assertRestriction(saved.month, kind, names[1]);
  assert.equal(saved.month.notes, 'Synthetic local edit'); assert.deepEqual(saved.month.holidays, []);
  assert.equal(saved.result, null, 'peer result is not mixed into explicit whole-local overwrite');
});
for (const kind of ['array', 'dict']) test(kind, `control: local-only rename remains mergeable (${kind})`, async a => {
  await renameLocal(a, names[0], gamma); putPeer(a, incoming(a));
  a.A.choose = async () => { throw new Error('Local-only rename requires no choice'); };
  assert.equal(await invoke(a, 'auto'), 'saved'); const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.rules.doctors.map(d => d.name), [gamma, names[1]]); assertRestriction(saved.month, kind, names[1]);
  assert.deepEqual(saved.month.holidays, [3]);
});
test('array', 'control: shared same-origin rename is not a collision', async a => {
  await renameLocal(a, names[0], gamma); putPeer(a, peerRenamed(a, 'array', names[0]));
  a.A.choose = async (message, options) => { assert(options.some(o => o.value === 'mine')); return 'mine'; };
  assert.equal(await invoke(a, 'auto'), 'saved'); const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.rules.doctors.map(d => d.name), [gamma, names[1]]); assertRestriction(saved.month, 'array', names[1]);
  assert.deepEqual(saved.month.holidays, [3]);
});
test('array', 'control: simultaneous name swap remains injective', async a => {
  await renameLocal(a, names[0], gamma); await renameLocal(a, names[1], names[0]); await renameLocal(a, gamma, names[1]);
  putPeer(a, incoming(a)); a.A.choose = async () => { throw new Error('Peer roster was unchanged'); };
  assert.equal(await invoke(a, 'auto'), 'saved'); const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.rules.doctors.map(d => d.name), [names[1], names[0]]); assertRestriction(saved.month, 'array', names[0]);
  assert.deepEqual(saved.month.holidays, [3]);
});
test('array', 'control: removed person is isolated before reusing their name', async a => {
  a.A.showTab('settings'); a.q('#doctorTable tr[data-i="1"] [data-act="del"]').click(); await tick();
  assert(!a.A.state.rules.doctors.some(d => d.name === names[1]));
  await renameLocal(a, names[0], names[1]); putPeer(a, incoming(a));
  a.A.choose = async () => { throw new Error('Peer roster was unchanged'); };
  assert.equal(await invoke(a, 'auto'), 'saved'); const saved = JSON.parse(a.folder.files.get(dataName));
  assert.deepEqual(saved.rules.doctors.map(d => d.name), [names[1]]);
  assert.deepEqual(saved.month.unavailable_other, [], 'removed person restrictions do not move to the name-reuser');
  assert.deepEqual(saved.month.holidays, [3]);
});
const EXPECTED_CASES = 23; let started = 0, ended = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Merge rename-projection regression timed out'); process.exit(1); }, 90000);
process.on('exit', () => {
  console.log(`ACCOUNTING registered=${cases.length} started=${started} ended=${ended} passed=${passed} failed=${failed} finished=${finished}`);
  if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1;
});
(async () => {
  assert.equal(cases.length, EXPECTED_CASES, 'case inventory');
  for (const [i, c] of cases.entries()) console.log(`CASE ${i + 1}/${EXPECTED_CASES} ${c.label}`);
  for (const [i, c] of cases.entries()) {
    let a; started++; console.log(`START ${i + 1}/${EXPECTED_CASES} ${c.label}`);
    try { a = await makeApp(c.kind); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.label); }
    catch (e) { failed++; console.error('FAIL ' + c.label + '\n' + (e.stack || e)); }
    finally { if (a) a.dom.window.close(); ended++; console.log(`END ${i + 1}/${EXPECTED_CASES} ${c.label}`); }
  }
  finished = true; clearTimeout(watchdog); console.log(`Merge rename-projection: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); clearTimeout(watchdog); process.exitCode = 1; });
