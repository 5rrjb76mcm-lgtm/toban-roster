// Optional month scalars must not be resurrected from the merge template.
// Fictional fixtures; real merge/save code, with only DOM and folder I/O substituted.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.location = { pathname: '/synthetic/scalar-merge.html' };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.document = { querySelector() { return null; }, querySelectorAll() { return []; } };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'plugins.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(f === 'merge.js' && process.env.TOBAN_MERGE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
for (const name of ['renderHeader', 'renderAll', 'readAll', 'toast']) A[name] = () => {};
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.stack); } }
const clear = (m, k, value) => { if (value === undefined) delete m[k]; else m[k] = value; };
const labelOf = m => m.doc_label || '確認版';
(async () => {
  for (const key of ['doc_label', 'profile_id']) for (const empty of [undefined, null, '']) for (const side of ['mine', 'theirs']) {
    await test(`${key}: ${side} clears ${String(empty)} without conflict`, () => {
      const base = { year: 2026, month: 11, [key]: key === 'doc_label' ? '確定版' : 'synthetic-profile' };
      const mine = clone(base), theirs = clone(base); clear(side === 'mine' ? mine : theirs, key, empty); (side === 'mine' ? theirs : mine).notes = 'Synthetic peer edit';
      const r = T.mergeMonth(base, mine, theirs);
      assert.strictEqual(r.conflicts.length, 0); assert.ok(!r.merged[key], 'cleared value must stay absent');
      assert.strictEqual(r.merged.notes, 'Synthetic peer edit'); assert.strictEqual(r.mineChanges, 1); assert.strictEqual(r.theirChanges, 1);
      assert.strictEqual(T.flattenMonth(r.merged)['s:' + key], undefined);
    });
    for (const prefer of ['mine', 'theirs']) await test(`${key}: ${side} clears ${String(empty)}, conflict chooses ${prefer}`, () => {
      const base = { year: 2026, month: 11, [key]: 'Synthetic original' }, mine = clone(base), theirs = clone(base);
      clear(side === 'mine' ? mine : theirs, key, empty); (side === 'mine' ? theirs : mine)[key] = 'Synthetic replacement';
      const r = T.mergeMonth(base, mine, theirs, prefer);
      assert.strictEqual(r.conflicts.length, 1); assert.strictEqual(r.conflicts[0].key, 's:' + key);
      if (prefer === side) assert.ok(!r.merged[key], 'explicitly chosen deletion must win'); else assert.strictEqual(r.merged[key], 'Synthetic replacement');
    });
  }
  for (const empty of [undefined, null, '']) for (const conflict of [false, true]) await test(`folder autosave preserves cleared label ${String(empty)}, conflict=${conflict}`, async () => {
    const rules = { profile: { id: 'synthetic-label' }, doctors: [{ name: 'Synthetic A', team: 'I' }] }; T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, doc_label: conflict ? 'Synthetic original label' : '確定版', fixed: { night: { 5: 'Synthetic A' } } }, rules);
    Object.assign(A.state, { rules, month, result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
    const files = {}, dir = { name: 'Synthetic folder', async *entries() { yield ['202611', { kind: 'directory' }]; },
      async getDirectoryHandle() { return dir; }, async getFileHandle(n, opt = {}) {
        if (!opt.create && !(n in files)) throw Object.assign(new Error('Synthetic missing file'), { name: 'NotFoundError' });
        return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async x => { files[n] = typeof x === 'string' ? x : await x.text(); }, close: async () => {} }) };
      } };
    A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved('Synthetic folder', '2026-10-01T00:00:00Z');
    const peer = JSON.parse(A.payloadJson('2026-10-02T00:00:00Z')); peer.month.notes = 'Synthetic peer note'; if (conflict) peer.month.doc_label = '確定版';
    clear(A.state.month, 'doc_label', empty); let choices = 0; A.choose = async () => { choices++; return 'mine'; };
    files['202611_data.json'] = JSON.stringify(peer);
    assert.strictEqual(await A.autosaveJson(), 'saved');
    const saved = JSON.parse(files['202611_data.json']);
    assert.strictEqual(labelOf(A.state.month), '確認版', 'in-memory output defaults to review label');
    assert.strictEqual(labelOf(saved.month), '確認版', 'saved output must not regain final label');
    assert.strictEqual(saved.month.notes, 'Synthetic peer note'); assert.strictEqual(saved.month.fixed.night[5], 'Synthetic A');
    assert.strictEqual(choices, conflict ? 1 : 0); assert.strictEqual(A.isDirty(), false);
    const second = await A.autosaveJson(); assert.ok(['saved', 'skipped', 'clean'].includes(second), second);
    assert.strictEqual(labelOf(JSON.parse(files['202611_data.json']).month), '確認版', 'repeated save stays cleared');
  });
  console.log(`scalar clear merge: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})();
