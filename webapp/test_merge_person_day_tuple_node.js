// C03: source-only candidate, NOT executed during cloud preparation.
// Synthetic data only. TOBAN_MERGE_SOURCE can select baseline merge.js for negative controls.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.location = { pathname: '/synthetic/person-day-tuple.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(f === 'merge.js' && process.env.TOBAN_MERGE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), owner = 'Synthetic A', other = 'kind:Synthetic A', id = 'local.pref:kind';
for (const k of ['renderHeader', 'renderAll', 'readAll', 'toast', 'showTab', 'clearUndo']) A[k] = () => {};
const fixture = (collision = false) => ({ year: 2026, month: 11, person_days: {
  [id]: { [owner]: { 5: 'a' } }, ...(collision ? { 'local.pref': { [other]: { 5: 'b' } } } : {})
} });
function folderFixture(names = [owner], collision = false) {
  clearTimeout(A.autosaveTimer);
  const rules = { profile: { id: 'synthetic-tuple' }, doctors: names.map(name => ({ name, team: 'I' })) };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth(fixture(collision), rules), files = {}, writes = [], choices = [];
  const dir = { name: 'Synthetic tuple folder', async getDirectoryHandle() { return dir; }, async getFileHandle(n, opt = {}) {
    if (!opt.create && !(n in files)) throw Object.assign(new Error('Synthetic missing file'), { name: 'NotFoundError' });
    return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({
      write: async b => { files[n] = typeof b === 'string' ? b : await b.text(); writes.push(n); }, close: async () => {}
    }) };
  } };
  Object.assign(A.state, { rules, month, result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved(undefined, '2026-10-01T00:00:00Z');
  const peer = JSON.parse(A.payloadJson('2026-10-02T00:00:00Z')); peer.month.day_notes[7] = 'Synthetic peer note';
  const publish = () => { files['202611_data.json'] = JSON.stringify(peer); };
  publish(); A.state.month.notes = 'Synthetic local note';
  A.choose = async (message, options) => { choices.push({ message, options }); return null; };
  return { files, writes, choices, peer, publish, saved: () => JSON.parse(files['202611_data.json']) };
}
const EXPECTED_CASES = 11; let passed = 0, failed = 0, completed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Person-day tuple regression timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete tuple regression: ${passed}/${EXPECTED_CASES} passed, ${completed} completed, ${failed} failed`); process.exitCode = 1; } });
const CASE_LABELS = [
  'exact round trips for delimiters, percent text, Unicode and internal markers',
  'collision pair stays two cells, never merely flatten-equal',
  'independent edits keep both owners and change counts',
  'deletion/change conflicts are independent and labels decode exact ownership',
  'existing empty/false semantics and unrelated merge keys remain unchanged',
  'ordinary roster no longer falsely rejects a valid colon field',
  'existing lookalike roster name must not receive the value',
  'both colliding cells survive the actual autosave path',
  'ordinary roster still safely rejects an actually newly misattributed owner',
  'removed-person marker protects peer changes: false',
  'removed-person marker protects peer changes: true'
];
const ledger = (event, label, outcome) => console.log('C03_LEDGER ' + JSON.stringify({ event, label, ...(outcome ? { outcome } : {}) }));
const startedCases = new Set();
assert.strictEqual(CASE_LABELS.length, EXPECTED_CASES);
for (const label of CASE_LABELS) ledger('register', label);
async function test(label, fn) {
  assert(CASE_LABELS.includes(label) && !startedCases.has(label), 'unique registered case');
  startedCases.add(label); ledger('start', label);
  let outcome = 'fail';
  try { await fn(); passed++; outcome = 'pass'; console.log('PASS ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
  finally { completed++; ledger('complete', label, outcome); }
}
(async () => {
  await test('exact round trips for delimiters, percent text, Unicode and internal markers', () => {
    for (const field of ['local.pref', id, ':', 'local.%3A:%25', 'local.🧪:欄', 'local.\ud800:field'])
      for (const name of [owner, other, ':Synthetic|A:', 'Synthetic%3A%25', 'Synthetic\\u0000', T.GONE + owner]) {
        const b = { year: 2026, month: 11, person_days: { [field]: { [name]: { 5: 'a', 6: 0, 7: true } } } };
        assert.deepStrictEqual(T.unflattenMonth(T.flattenMonth(b), b).person_days, b.person_days);
        assert.deepStrictEqual(T.unflattenMonth(T.flattenMonth(b)).person_days, b.person_days);
        if (name.includes('\u0000')) assert(Object.keys(T.flattenMonth(b)).some(k => k.includes('\u0000')), 'folder marker remains raw');
      }
  });
  await test('collision pair stays two cells, never merely flatten-equal', () => {
    const b = fixture(true), flat = T.flattenMonth(b);
    assert.strictEqual(Object.keys(flat).filter(k => /^pday/.test(k)).length, 2);
    assert.deepStrictEqual(T.unflattenMonth(flat, b).person_days, b.person_days);
  });
  await test('independent edits keep both owners and change counts', () => {
    const b = fixture(true), mine = clone(b), theirs = clone(b);
    mine.person_days[id][owner][5] = 'mine'; theirs.person_days['local.pref'][other][5] = 'theirs';
    const r = T.mergeMonth(b, mine, theirs);
    assert.strictEqual(r.conflicts.length, 0); assert.strictEqual(r.mineChanges, 1); assert.strictEqual(r.theirChanges, 1);
    assert.deepStrictEqual(r.merged.person_days, { [id]: { [owner]: { 5: 'mine' } }, 'local.pref': { [other]: { 5: 'theirs' } } });
    assert.deepStrictEqual(b, fixture(true), 'do not mutate the baseline');
  });
  await test('deletion/change conflicts are independent and labels decode exact ownership', () => {
    const b = fixture(true), mine = clone(b), theirs = clone(b);
    delete mine.person_days[id][owner][5]; mine.person_days['local.pref'][other][5] = 'mine';
    theirs.person_days[id][owner][5] = 'theirs'; delete theirs.person_days['local.pref'][other][5];
    for (const prefer of ['mine', 'theirs']) {
      const r = T.mergeMonth(b, mine, theirs, prefer);
      assert.strictEqual(r.conflicts.length, 2); assert.strictEqual(new Set(r.conflicts.map(c => c.key)).size, 2);
      assert.deepStrictEqual(r.conflicts.map(c => c.label).sort(), [`${owner} 5日 ${id}`, `${other} 5日 local.pref`].sort());
      const chosen = prefer === 'mine' ? { 'local.pref': { [other]: { 5: 'mine' } } } : { [id]: { [owner]: { 5: 'theirs' } } };
      assert.deepStrictEqual(r.merged.person_days, chosen);
      const own = r.conflicts.find(c => c.label === `${owner} 5日 ${id}`);
      assert.strictEqual(own.mine, '（なし）'); assert.strictEqual(own.theirs, 'theirs');
    }
  });
  await test('existing empty/false semantics and unrelated merge keys remain unchanged', () => {
    const b = fixture(); Object.assign(b.person_days[id][owner], { 6: false, 7: '', 8: null });
    b.day_notes = { 5: 'Synthetic note' }; b.unavailable_night = { [other]: [5] };
    const flat = T.flattenMonth(b), back = T.unflattenMonth(flat, b);
    assert.deepStrictEqual(back.person_days, fixture().person_days);
    assert.strictEqual(flat['dnote:5'], JSON.stringify('Synthetic note')); assert.strictEqual(flat[`cal:${other}:5`], JSON.stringify('night'));
    assert.deepStrictEqual(back.unavailable_night, b.unavailable_night);
  });
  for (const [label, names, collision] of [
    ['ordinary roster no longer falsely rejects a valid colon field', [owner], false],
    ['existing lookalike roster name must not receive the value', [owner, other], false],
    ['both colliding cells survive the actual autosave path', [owner, other], true]
  ]) await test(label, async () => {
    const f = folderFixture(names, collision), expected = clone(A.state.month.person_days);
    assert.strictEqual(await A.autosaveJson(), 'saved'); assert.strictEqual(f.choices.length, 0);
    assert.deepStrictEqual(A.state.month.person_days, expected); assert.deepStrictEqual(f.saved().month.person_days, expected);
    assert.strictEqual(f.saved().month.notes, 'Synthetic local note'); assert.strictEqual(f.saved().month.day_notes[7], 'Synthetic peer note');
    assert.strictEqual(A.isDirty(), false); assert(f.writes.includes('202611_data.json'));
  });
  await test('ordinary roster still safely rejects an actually newly misattributed owner', async () => {
    const f = folderFixture(), before = JSON.stringify(A.state), disk = f.files['202611_data.json'], merge = T.mergeMonth;
    // Emulate the old ambiguous-key outcome at the guard boundary. It must not be written.
    T.mergeMonth = (...args) => { const r = merge(...args); r.merged.person_days = { 'local.pref': { [other]: { 5: 'a' } } }; return r; };
    try { assert.strictEqual(await A.autosaveJson(), 'skipped'); } finally { T.mergeMonth = merge; }
    assert.strictEqual(f.choices.length, 1); assert(f.choices[0].options.some(o => o.value === 'overwrite'));
    assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(f.files['202611_data.json'], disk); assert.strictEqual(f.writes.length, 0);
  });
  for (const peerChanged of [false, true]) await test('removed-person marker protects peer changes: ' + peerChanged, async () => {
    const f = folderFixture([owner, 'Synthetic B']);
    A.state.rules.doctors = A.state.rules.doctors.filter(d => d.name !== owner);
    T.purgeMonthNames(A.state.month, [owner]); A.state.renames = [[owner, T.GONE + owner]];
    if (peerChanged) f.peer.month.person_days[id][owner][5] = 'peer changed removed person';
    f.publish(); const before = JSON.stringify(A.state), disk = f.files['202611_data.json'];
    assert.strictEqual(await A.autosaveJson(), peerChanged ? 'skipped' : 'saved');
    if (peerChanged) {
      assert.strictEqual(f.choices.length, 1); assert.strictEqual(f.writes.length, 0);
      assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(f.files['202611_data.json'], disk);
    } else {
      assert.strictEqual(f.choices.length, 0); assert.strictEqual(Object.keys(T.monthNameRefs(f.saved().month)).includes(owner), false);
      assert.strictEqual(JSON.stringify(f.saved().month).includes('\\u0000'), false);
    }
  });
  assert.strictEqual(completed, EXPECTED_CASES); finished = true; clearTimeout(watchdog);
  console.log(`person-day tuple: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
