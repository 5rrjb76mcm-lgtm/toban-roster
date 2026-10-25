// Preserve accepted imported paid entries; normal UI writes part:'allday'.
// This does not define new night-only leave semantics or change the solver.
// Static-review addition: NOT executed for the post-46 audit.
// TOBAN_MERGE_SOURCE supports reverting merge.js alone while retaining this test.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.location = { pathname: '/synthetic/merge-paid-entry.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'plugins.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(f === 'merge.js' && process.env.TOBAN_MERGE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), name = 'Synthetic A';
for (const k of ['renderHeader', 'renderAll', 'readAll', 'toast', 'showTab', 'save']) A[k] = () => {};
globalThis.alert = text => { throw new Error(text); };
const rules = { profile: { id: 'synthetic-paid-entry', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] }, doctors: [{ name, team: 'S' }], days_off: { min: 3 }, rule_states: { oncall: 'off', period_charge: 'off' } };
T.fillDefaultRules(rules);
const month = part => T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, unavailable_other: [{ name, day: 5, part, paid: true }] }, rules);
const semantic = m => { const p = new T.Problem(rules, m), asg = Object.fromEntries(p.slots.map(s => [s.join(':'), { work: name, oc: [] }]));
  return { paid: [...(p.paidDays[name] || [])], target: p.offTarget(name), other: p.unavailOther[name], night: [...(p.unavailNight[name] || [])], unavailable: T.check(p, asg).VC.filter(v => /^UNAVAIL_/.test(v.code)) }; };
const preserved = (m, part) => {
  assert.deepStrictEqual(m.unavailable_other, [{ name, day: 5, part, paid: true }]);
  assert.deepStrictEqual(semantic(m), semantic(month(part)), 'paid target and accepted restriction stay unchanged');
};
const EXPECTED_CASES = 10; let passed = 0, failed = 0, completed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Paid entry merge regression timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete paid entry merge regression: completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
async function test(label, fn) { try { await fn(); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); } finally { completed++; } }
(async () => {
  for (const part of ['allday', 'day', 'night']) {
    await test(part + ': import and flatten round trip', () => {
      const base = month(part); assert.deepStrictEqual(semantic(base).paid, [5]); assert.strictEqual(semantic(base).target, 4);
      Object.assign(A.state, { rules: clone(rules), month: month('allday'), result: null, ui: {}, renames: [] }); A.dirHandle = null;
      A.applyLoaded({ rules: clone(rules), month: clone(base), result: null }, 'Synthetic import', { fromFolder: false });
      preserved(A.state.month, part); preserved(T.unflattenMonth(T.flattenMonth(base), base), part);
    });
    await test(part + ': unrelated three-way changes', () => {
      const base = month(part), mine = clone(base), theirs = clone(base); mine.notes = 'Synthetic local note'; theirs.holidays = [3];
      const r = T.mergeMonth(base, mine, theirs); assert.strictEqual(r.conflicts.length, 0); preserved(r.merged, part);
      assert.strictEqual(r.merged.notes, mine.notes); assert.deepStrictEqual(r.merged.holidays, [3]);
    });
    await test(part + ': folder merge persists paid flag', async () => {
      Object.assign(A.state, { rules: clone(rules), month: month(part), result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
      const files = {}, dir = { name: 'Synthetic folder', async getDirectoryHandle() { return dir; }, async getFileHandle(n, opt = {}) {
        if (!opt.create && !(n in files)) throw Object.assign(new Error('Synthetic missing file'), { name: 'NotFoundError' });
        return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async b => { files[n] = await b.text(); }, close: async () => {} }) };
      } };
      A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved('フォルダ Synthetic folder', '2026-10-01T00:00:00Z');
      const peer = JSON.parse(A.payloadJson('2026-10-02T00:00:00Z')); peer.month.holidays = [3]; files['202611_data.json'] = JSON.stringify(peer);
      A.state.month.notes = 'Synthetic local note'; A.choose = async () => { throw new Error('Unrelated edits must not prompt'); };
      assert.strictEqual(await A.autosaveJson(), 'saved'); preserved(A.state.month, part); preserved(JSON.parse(files['202611_data.json']).month, part);
      assert.strictEqual(A.isDirty(), false);
    });
  }
  await test('paid flag conflict and ordinary nighttime control', () => {
    const base = month('night'), mine = clone(base), theirs = clone(base); mine.unavailable_other = []; theirs.unavailable_other[0].part = 'day';
    for (const prefer of ['mine', 'theirs']) { const r = T.mergeMonth(base, mine, theirs, prefer); assert.strictEqual(r.conflicts.length, 1);
      assert.deepStrictEqual(r.merged.unavailable_other, prefer === 'mine' ? [] : [{ name, day: 5, part: 'day', paid: true }]); }
    const normal = month('allday'); normal.unavailable_other = []; normal.unavailable_night[name] = [5];
    const out = T.unflattenMonth(T.flattenMonth(normal), normal); assert.deepStrictEqual(out.unavailable_night[name], [5]); assert.deepStrictEqual(out.unavailable_other, []);
  });
  assert.strictEqual(completed, EXPECTED_CASES); finished = true; clearTimeout(watchdog); console.log(`paid entry merge: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
