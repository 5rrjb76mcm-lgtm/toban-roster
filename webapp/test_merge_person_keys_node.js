// Synthetic fixtures; each case runs in a separate process to isolate prototype mutation in the baseline.
// TOBAN_MERGE_SOURCE selects an unchanged merge.js for red controls.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const names = ['__proto__', 'constructor', 'toString', 'Synthetic:A'];
const fields = ['targets', 'count_min', 'count_max', 'duty_days', 'unavailable_night', 'night_on', 'day_on', 'regular_duties'];
if (!process.argv[2]) {
  let passed = 0, failed = 0;
  for (const n of names) for (const f of fields) {
    const id = `${n}/${f}`, r = spawnSync(process.execPath, [__filename, n, f], { encoding: 'utf8', env: process.env });
    if (r.status === 0) { console.log('PASS ' + id); passed++; }
    else { console.log('FAIL ' + id + ': ' + (r.stderr || r.stdout).split('\n').find(Boolean)); failed++; }
  }
  console.log(`${passed} passed, ${failed} failed, ${passed + failed} completed`);
  process.exitCode = failed ? 1 : 0;
} else {
  globalThis.T = {};
  const source = process.env.TOBAN_MERGE_SOURCE || path.join(__dirname, 'src/merge.js');
  vm.runInThisContext(fs.readFileSync(source, 'utf8'), { filename: source });
  const name = process.argv[2], field = process.argv[3], clone = x => JSON.parse(JSON.stringify(x));
  const keyed = (k, v) => Object.fromEntries([[k, v]]);
  const values = { targets: 2, count_min: 0, count_max: 4, duty_days: { 5: { am: 'ward', pm: 'clinic' } }, unavailable_night: [5, 9], night_on: [8], day_on: [10], regular_duties: [{ weekday: 1, am: 'ward' }] };
  const month = { year: 2026, month: 11, notes: 'base' };
  if (field === 'night_on' || field === 'day_on') month.wishes = { [field]: keyed(name, values[field]) };
  else month[field] = keyed(name, values[field]);
  const table = m => field === 'night_on' || field === 'day_on' ? m.wishes[field] : m[field];
  const descriptors = [Object.getOwnPropertyDescriptors(Object.prototype), Object.getOwnPropertyDescriptors(Object), Object.getOwnPropertyDescriptors(Object.prototype.toString)];
  const verify = m => { assert(Object.hasOwn(table(m), name), `${field} missing ${name}`); assert.deepEqual(table(m)[name], values[field]); assert.equal(Object.getPrototypeOf(table(m)), Object.prototype); };
  const round = T.unflattenMonth(T.flattenMonth(month), month); verify(round);
  const mine = clone(month), theirs = clone(month); mine.notes = 'mine'; theirs.day_notes = { 3: 'peer' };
  const result = T.mergeMonth(month, mine, theirs, 'mine');
  assert.equal(result.conflicts.length, 0); assert.equal(result.merged.notes, 'mine'); assert.equal(result.merged.day_notes[3], 'peer'); verify(result.merged);
  assert.deepEqual([Object.getOwnPropertyDescriptors(Object.prototype), Object.getOwnPropertyDescriptors(Object), Object.getOwnPropertyDescriptors(Object.prototype.toString)], descriptors, 'prototype objects unchanged');
}
