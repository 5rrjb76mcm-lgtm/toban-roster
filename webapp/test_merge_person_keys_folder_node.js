// Synthetic in-memory folder: exercise automatic merge on the autosave path.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
globalThis.location = { pathname: '/synthetic/merge-person-keys.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'app-core.js', 'app-folder.js'])
  vm.runInThisContext(fs.readFileSync(f === 'merge.js' && process.env.TOBAN_MERGE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
for (const k of ['renderHeader', 'renderAll', 'readAll', 'toast', 'showTab', 'save', 'clearUndo']) A[k] = () => {};
(async () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/rules.json'), 'utf8')); T.fillDefaultRules(rules);
  const base = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, 'data/202611.json'), 'utf8')), rules);
  // Historical name, no roster change: only a browser's unrelated local note and peer's day note change.
  base.unavailable_night = Object.fromEntries([['__proto__', [5]]]);
  let disk = '', pending = '', writes = 0, choices = 0;
  const dir = { name: 'Synthetic folder', async getDirectoryHandle() { return dir; }, async getFileHandle(name) {
    assert.equal(name, '202611_data.json');
    return { getFile: async () => ({ text: async () => disk }), createWritable: async () => ({ write: async blob => { pending = await blob.text(); }, close: async () => { disk = pending; writes++; } }) };
  } };
  Object.assign(A.state, { rules: clone(rules), month: base, result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved(undefined, '2026-10-01T00:00:00Z');
  const peer = JSON.parse(A.payloadJson('2026-10-02T00:00:00Z')); peer.month.day_notes[7] = 'peer'; disk = JSON.stringify(peer);
  A.state.month.notes = 'local'; A.choose = async () => { choices++; return null; };
  assert.equal(await A.autosaveJson(), 'saved'); assert.equal(choices, 0); assert.equal(writes, 1);
  const saved = JSON.parse(disk).month;
  for (const m of [A.state.month, saved]) { assert(Object.hasOwn(m.unavailable_night, '__proto__')); assert.deepEqual(m.unavailable_night.__proto__, [5]); assert.equal(m.notes, 'local'); assert.equal(m.day_notes[7], 'peer'); }
  console.log('PASS synthetic folder auto-merge and saved JSON');
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
