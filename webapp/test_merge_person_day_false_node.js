// Imported per-person calendar values preserve type and presence through merging.
// Exercises both the pure three-way merge and the real save code with a memory folder.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const clone = x => JSON.parse(JSON.stringify(x));
const FIELD = 'local.synthetic:status', DOCTOR = 'Synthetic: Staff';
const tag = '202611', fileName = tag + '_data.json', savedAt = '2026-11-01T00:00:00Z';
globalThis.location = { pathname: '/synthetic/merge-person-day-value.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const file of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', file), 'utf8'), { filename: 'rules/' + file });
const A = T.app;
for (const k of ['renderHeader', 'renderAll', 'readAll', 'toast', 'showTab', 'save', 'clearUndo']) A[k] = () => {};
const vals = m => m.person_days?.[FIELD]?.[DOCTOR] || {};
const month = values => ({
  year: 2026, month: 11, next_first_day_in_calendar: true,
  person_days: { [FIELD]: { [DOCTOR]: values } }
});
const cases = [];
function test(name, fn) { cases.push([name, fn]); }
test('both unrelated edits preserve false and distinguish string false, true and numeric zero', () => {
  const base = month({ 5: false, 6: 'false', 7: true, 8: 0 });
  const mine = clone(base), theirs = clone(base);
  mine.notes = 'local note'; theirs.day_notes = { 9: 'peer note' };
  const { merged, conflicts } = T.mergeMonth(base, mine, theirs);
  assert.deepEqual(vals(merged), vals(base));
  assert.equal(merged.notes, 'local note'); assert.equal(merged.day_notes[9], 'peer note');
  assert.equal(conflicts.length, 0);
});
for (const side of ['mine', 'theirs']) {
  test(side + ' can write false into an empty cell', () => {
    const base = month({ 6: true }), mine = clone(base), theirs = clone(base);
    vals(side === 'mine' ? mine : theirs)[5] = false;
    const other = side === 'mine' ? theirs : mine; vals(other)[6] = 'edited';
    const { merged, conflicts, mineChanges, theirChanges } = T.mergeMonth(base, mine, theirs);
    assert.deepEqual(vals(merged), { 5: false, 6: 'edited' });
    assert.equal(conflicts.length, 0); assert.equal(mineChanges, 1); assert.equal(theirChanges, 1);
  });
  test(side + ' can explicitly clear a cell previously set to false', () => {
    const base = month({ 5: false, 6: true }), mine = clone(base), theirs = clone(base);
    delete vals(side === 'mine' ? mine : theirs)[5];
    const other = side === 'mine' ? theirs : mine; vals(other)[6] = 'edited';
    const { merged, conflicts, mineChanges, theirChanges } = T.mergeMonth(base, mine, theirs);
    assert.deepEqual(vals(merged), { 6: 'edited' });
    assert.equal(conflicts.length, 0); assert.equal(mineChanges, 1); assert.equal(theirChanges, 1);
  });
}
test('false versus deletion is a conflict; keep only the selected side', () => {
  const base = month({ 5: true }), mine = month({ 5: false }), theirs = month({});
  for (const prefer of ['mine', 'theirs']) {
    const { merged, conflicts } = T.mergeMonth(base, mine, theirs, prefer);
    assert.deepEqual(vals(merged), prefer === 'mine' ? { 5: false } : {});
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].mine, false); assert.equal(conflicts[0].theirs, '（なし）');
  }
});
test('actual folder autosave merges unrelated changes without losing false on disk or in the model', async () => {
  const rules = { profile: { id: 'synthetic', label: 'Synthetic' }, doctors: [{ name: DOCTOR, team: 'I' }] };
  T.fillDefaultRules(rules);
  const base = T.normalizeMonth(month({ 5: false, 6: 'false', 7: true, 8: 0 }), rules);
  let disk = '', writes = 0, choices = 0;
  const dir = {
    name: 'Synthetic folder',
    async getDirectoryHandle() { return dir; },
    async getFileHandle(name) {
      assert.equal(name, fileName);
      let pending;
      return { getFile: async () => ({ text: async () => disk }), createWritable: async () => ({
        write: async blob => { pending = await blob.text(); },
        close: async () => { disk = pending; writes++; }
      }) };
    }
  };
  Object.assign(A.state, { rules: clone(rules), month: clone(base), result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = dir; A.dirGen++; A.monthDirs = [tag]; A.markSaved(undefined, savedAt);
  const peer = JSON.parse(A.payloadJson('2026-11-02T00:00:00Z'));
  peer.month.day_notes[9] = 'peer note'; disk = JSON.stringify(peer);
  A.state.month.notes = 'local note'; A.choose = async () => { choices++; return null; };
  assert.equal(await A.autosaveJson(), 'saved'); assert.equal(choices, 0); assert.equal(writes, 1);
  for (const m of [A.state.month, JSON.parse(disk).month]) {
    assert.deepEqual(vals(m), vals(base));
    assert.equal(m.notes, 'local note'); assert.equal(m.day_notes[9], 'peer note');
    const p = new T.Problem(rules, m);
    assert.strictEqual(p.personDay(FIELD, DOCTOR, 5), false);
    assert.strictEqual(p.personDay(FIELD, DOCTOR, 6), 'false');
  }
  assert.equal(A.isDirty(), false);
});
let complete = false;
process.on('exit', () => { if (!complete) process.exitCode = 1; });
(async () => {
  let failures = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  assert.equal(cases.length, 7); complete = true;
  console.log(`${cases.length - failures}/${cases.length} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
