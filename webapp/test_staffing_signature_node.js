// Accepted empty staffing values must not be mistaken for absent selectors.
// Static-review addition: this file has NOT been executed for the post-46 audit.
// TOBAN_CORE_SOURCE may point to the original app-core.js for a source-only reversion.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elements = new Map();
globalThis.document = { querySelector(s) { if (!elements.has(s)) elements.set(s, { value: '', textContent: '', addEventListener() {} }); return elements.get(s); }, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis; globalThis.location = { pathname: '/synthetic/staffing-signature.html', protocol: 'file:' };
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'plugins.js', 'app-core.js', 'app-folder.js', 'app-settings.js'])
  vm.runInThisContext(fs.readFileSync(f === 'app-core.js' && process.env.TOBAN_CORE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
for (const k of ['save', 'renderAll', 'renderHeader', 'readAll', 'toast']) A[k] = () => {};
function setup(work) {
  const rules = { profile: { id: 'synthetic-staffing-signature', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: clone(work) } }, doctors: [{ name: 'Synthetic A', team: 'S' }, { name: 'Synthetic B', team: 'S' }], rule_states: { oncall: 'off', period_charge: 'off', same_day_team: 'off' } };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true }, rules);
  Object.assign(A.state, { rules, month, result: null, meta: null, base: null, baseRules: null, renames: [], ui: {} });
  A.dirHandle = null; A.clearUndo(); A.solving = false;
  A.state.result = { input_sig: A.inputSig() }; A.markSaved('Synthetic saved state', '2026-10-01T00:00:00Z');
}
const work = () => A.state.rules.profile.positions.work;
const sem = () => { const p = new T.Problem(A.state.rules, A.state.month); return [1, 2].map(d => [p.countOf([d, 'day']), p.countMinOf([d, 'day']), p.countIdealOf([d, 'day'])]); };
const sigs = () => [A.inputSig(), A.rulesSig(A.state.rules), A.versionSig('確認版'), A.snapshot().sig];
const cases = [];
for (const raw of [null, {}, [], '']) {
  cases.push({ name: 'root minimum ' + JSON.stringify(raw), before: { count: 2, min: raw }, clear: w => delete w.min, wantBefore: [[2, 1, null], [2, 1, null]], wantAfter: [[2, 2, null], [2, 2, null]] });
  cases.push({ name: 'count overrides shorthand ' + JSON.stringify(raw), before: { count: raw, day: 2, night: 2 }, clear: w => delete w.count, wantBefore: [[1, 1, null], [1, 1, null]], wantAfter: [[2, 2, null], [2, 2, null]] });
}
for (const raw of [{}, [], '']) {
  cases.push({ name: 'empty shift count ' + JSON.stringify(raw), before: { count: { day: raw, weekday: 2, off_days: 3 } }, clear: w => delete w.count.day, wantBefore: [[1, 1, null], [1, 1, null]], wantAfter: [[3, 3, null], [2, 2, null]] });
  cases.push({ name: 'empty shift minimum ' + JSON.stringify(raw), before: { count: 3, min: { day: raw, weekday: 0, off_days: 2 } }, clear: w => delete w.min.day, wantBefore: [[3, 1, null], [3, 1, null]], wantAfter: [[3, 2, null], [3, 0, null]] });
  cases.push({ name: 'empty shift ideal ' + JSON.stringify(raw), before: { count: 3, min: 0, ideal: { day: raw } }, clear: w => delete w.ideal.day, wantBefore: [[3, 0, 1], [3, 0, 1]], wantAfter: [[3, 0, null], [3, 0, null]] });
}
cases.push({ name: 'nested null overrides day-type fallback', before: { count: { day: { day: null, weekday: 2, off_days: 3 }, night: 1 } }, clear: w => delete w.count.day.day, wantBefore: [[1, 1, null], [1, 1, null]], wantAfter: [[3, 3, null], [2, 2, null]] });
cases.push({ name: 'day-type ideal presence', before: { count: 3, min: 0, ideal: { weekday: {} } }, clear: w => delete w.ideal.weekday, wantBefore: [[3, 0, null], [3, 0, 1]], wantAfter: [[3, 0, null], [3, 0, null]] });
cases.push({ name: 'direct shorthand shift presence', before: { day: {}, weekday: 2, off_days: 3 }, clear: w => delete w.day, wantBefore: [[1, 1, null], [1, 1, null]], wantAfter: [[3, 3, null], [2, 2, null]] });
cases.push({ name: 'nested shorthand shift presence', before: { day: { day: {}, weekday: 2, off_days: 3 }, night: 1 }, clear: w => delete w.day.day, wantBefore: [[1, 1, null], [1, 1, null]], wantAfter: [[3, 3, null], [2, 2, null]] });
cases.push({ name: 'empty string ideal is present', before: { count: 3, min: 0, ideal: '' }, clear: w => delete w.ideal, wantBefore: [[3, 0, 1], [3, 0, 1]], wantAfter: [[3, 0, null], [3, 0, null]] });
const EXPECTED_CASES = 27; let passed = 0, failed = 0, completed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Staffing signature regression timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete staffing signature regression: completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
async function test(label, fn) { try { await fn(); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); } finally { completed++; } }
function folder(at) {
  const files = { '202611_data.json': A.payloadJson(at) }, dir = { name: 'Synthetic folder', async getDirectoryHandle() { return dir; }, async getFileHandle(n, opt = {}) {
    if (!opt.create && !(n in files)) throw Object.assign(new Error('Synthetic missing file'), { name: 'NotFoundError' });
    return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async b => { files[n] = await b.text(); }, close: async () => {} }) };
  } };
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved('フォルダ Synthetic folder', at); return files;
}
(async () => {
  for (const c of cases) await test(c.name + ': signatures, freshness, and Undo', async () => {
    setup(c.before); assert.deepStrictEqual(sem(), c.wantBefore); const before = sigs();
    A.pushUndo('JSON の反映'); c.clear(work()); await Promise.resolve();
    assert.deepStrictEqual(sem(), c.wantAfter); assert.strictEqual(A.isDirty(), true);
    sigs().forEach((v, i) => assert.notStrictEqual(v, before[i], 'signature ' + i));
    assert.notStrictEqual(A.state.result.input_sig, A.inputSig(), 'the previous result is now stale');
    A.undo(); assert.deepStrictEqual(work(), c.before); assert.deepStrictEqual(sem(), c.wantBefore); assert.deepStrictEqual(sigs(), before); assert.strictEqual(A.isDirty(), false);
  });
  for (const raw of [null, {}, [], '']) await test('autosave and peer merge retain minimum clear ' + JSON.stringify(raw), async () => {
    setup({ count: 2, min: raw }); const files = folder('2026-10-01T00:00:00Z');
    const peer = JSON.parse(files['202611_data.json']); peer.month.notes = 'Synthetic peer edit'; peer.saved_at = '2026-10-02T00:00:00Z'; files['202611_data.json'] = JSON.stringify(peer);
    delete work().min; A.choose = async () => { throw new Error('Unrelated edits must not prompt'); };
    assert.strictEqual(await A.autosaveJson(), 'saved');
    const saved = JSON.parse(files['202611_data.json']); assert.strictEqual(Object.hasOwn(saved.rules.profile.positions.work, 'min'), false);
    assert.strictEqual(saved.month.notes, 'Synthetic peer edit'); assert.deepStrictEqual(sem(), [[2, 2, null], [2, 2, null]]); assert.strictEqual(A.isDirty(), false);
  });
  await test('unrelated empty values retain existing canonical behavior', () => {
    setup({ count: 2 }); const base = sigs();
    for (const raw of [null, {}, []]) { work().ideal = raw; assert.deepStrictEqual(sigs(), base, 'root empty ideal has no target'); }
    delete work().ideal; work().metadata = {}; assert.deepStrictEqual(sigs(), base, 'unknown staffing metadata is not reinterpreted');
    A.state.month.notes = ''; A.state.month.holidays = []; assert.deepStrictEqual(sigs(), base);
    assert.deepStrictEqual(A.canon({ unrelated: { min: null, count: {}, ideal: [] } }), { unrelated: {} });
  });
  assert.strictEqual(completed, EXPECTED_CASES); finished = true; clearTimeout(watchdog); console.log(`staffing signatures: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
