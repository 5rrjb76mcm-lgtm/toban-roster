// Clarify the confirmed clear scope without changing its existing destructive behavior.
// The current month JSON includes the displayed next-month day1; a separate month file is untouched.
// Synthetic data only; real rendering, delegated clicks, localStorage, Problem and validator.
// jsdom and in-memory File System Access handles only; no browser, sockets or real data writes.
// TOBAN_WEBAPP_ROOT selects an unmodified webapp tree for baseline reproduction.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, names = ['Synthetic Alpha', 'Synthetic Beta'], copy = x => JSON.parse(JSON.stringify(x));
const stateKey = 'toban_state_v2:/synthetic/calendar-clear-scope.html';
const files = ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'merge.js', 'app-core.js', 'app-folder.js', 'app-input.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f)];
function app(year = 2026, month = 11, data = {}) {
  const dom = new JSDOM('<div id="monthSettings" hidden></div><div id="doctorPane"></div><div id="fixedPane" hidden></div>', { url: 'https://example.invalid/synthetic/calendar-clear-scope.html', runScripts: 'outside-only' }), w = dom.window, errors = [], prompts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  for (const f of files) w.eval(fs.readFileSync(path.join(root, 'src', f), 'utf8') + '\n//# sourceURL=' + f);
  const T = w.T, A = T.app, R = { profile: { id: 'synthetic-clear-scope', calendar: { holidays: 'none', closure: [] }, roles: [{ id: 'S', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map(name => ({ name, team: 'S', quota: 0 })), rule_states: {}, weights: {} };
  for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8'))); T.setLang('en'); w.Blob = globalThis.Blob;
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off'; R.rule_states.duty_conflicts = 'hard'; R.rule_states.duty_after_night = 'soft'; R.weights.night_then_am_duty = 7;
  const M = T.normalizeMonth({ year, month, next_first_day_in_calendar: true, ...copy(data) }, R), N = new Date(year, month, 0).getDate();
  Object.assign(A.state, { rules: R, month: M, result: null }); A.renderHeader = () => {}; A.toast = () => {}; w.confirm = msg => { prompts.push(msg); return true; };
  A.bindDoctor(); A.renderDoctor(); const q = s => w.document.querySelector(s);
  const change = (selector, value) => { const el = q(selector); assert(el, selector); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); assert.deepEqual(errors, []); };
  const select = name => change('#docSel', name), duty = (d, part, value) => change(`[data-cal="duty"][data-d="${d}"][data-part="${part}"]`, value);
  const clear = () => { q('[data-act="calClear"]').click(); assert.deepEqual(errors, []); }, saved = () => JSON.parse(w.localStorage.getItem(stateKey));
  return { dom, w, T, A, R, M, N, q, change, select, duty, clear, saved, prompts, close: () => { assert.deepEqual(errors, []); w.close(); } };
}
let passed = 0, failed = 0;
const expected = 13; let finished = false;
const watchdog = setTimeout(() => { console.error('Calendar clear confirmation test timed out'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || passed + failed !== expected) { console.error(`Premature test exit: ${passed + failed}/${expected} cases`); process.exitCode = 1; } });
async function test(label, fn) { try { await fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + (e.stack || e)); } }
(async () => {
const confirmations = {
  ja: names[0] + ' の当月の業務と、画面に表示されている翌月1日の業務をすべて消します。別に保存した翌月のデータは変更しません。',
  en: "Clear all of " + names[0] + "'s duties for this month and the displayed 1st of next month. Separately saved next-month data will not be changed."
};
for (const lang of ['ja', 'en']) await test('confirmation explains current data, displayed next day and separate saved month in ' + lang, () => {
  const f = app(); try { f.T.setLang(lang); f.A.renderDoctor(); f.select(names[0]); f.duty(2, 'am', 'ward'); f.duty(f.N + 1, 'am', 'external');
    f.w.confirm = text => { f.prompts.push(text); return false; }; f.clear(); assert.deepEqual(f.prompts, [confirmations[lang]]);
  } finally { f.close(); }
});
for (const [year, month, days] of [[2026, 2, 28], [2028, 2, 29], [2026, 11, 30], [2026, 10, 31]]) await test(`ordinary clear includes the displayed next day after a ${days}-day month`, () => {
  const f = app(year, month);
  try { assert.equal(f.N, days); f.select(names[0]); f.duty(2, 'am', 'ward'); f.duty(f.N + 1, 'am', 'external');
    assert.deepEqual(copy(f.T.lint(new f.T.Problem(f.R, f.M))), []); assert.equal(f.saved().month.duty_days[names[0]][f.N + 1].am, 'external'); f.clear();
    assert.equal(f.prompts.length, 1); assert.deepEqual(copy(f.M.duty_days[names[0]]), {});
    for (let i = 0; i < 3; i++) { f.A.readAll(); f.A.renderDoctor(); assert.equal(f.q(`[data-cal="duty"][data-d="${f.N + 1}"][data-part="am"]`).value, ''); }
    const s = f.saved(), P = new f.T.Problem(s.rules, f.T.normalizeMonth(s.month, s.rules)); assert.deepEqual(copy(P.nextMonthItems(names[0], 'am')), []);
  } finally { f.close(); }
});
await test('accepted clear removes the current JSON boundary constraint after save and reload', () => {
  const f = app(); try { f.select(names[0]); f.duty(2, 'am', 'ward'); f.duty(f.N + 1, 'am', 'external'); const before = new f.T.Problem(f.R, f.M);
    const pin = Object.fromEntries(before.slots.map(s => [f.T.Problem.key(s), { work: s[0] === f.N ? names[0] : names[1], oc: [] }]));
    assert.deepEqual(copy(f.T.check(before, pin).VC.map(v => v.code)), ['NIGHT_THEN_DUTY']); assert.equal(f.T.penalty(before, pin).total, 7); f.clear();
    const s = JSON.parse(f.A.payloadJson()), after = new f.T.Problem(s.rules, f.T.normalizeMonth(s.month, s.rules));
    assert.deepEqual(copy(f.T.check(after, pin).VC), []); assert.equal(f.T.penalty(after, pin).total, 0);
  } finally { f.close(); }
});
await test('cancel keeps both current and next-month duties', () => {
  const f = app(); try { f.select(names[0]); f.duty(2, 'am', 'ward'); f.duty(f.N + 1, 'pm', 'external'); const before = copy(f.M.duty_days); f.w.confirm = () => false; f.clear(); assert.deepEqual(copy(f.M.duty_days), before); } finally { f.close(); }
});
await test('clear is confined to the selected person and leaves fixed, unavailable, wishes and patterns', () => {
  const data = { duty_days: { [names[0]]: { 2: { am: 'ward' }, 31: { am: 'external', pm: 'outpatient' } }, [names[1]]: { 2: { pm: 'absent' }, 31: { am: 'ward' } } },
    fixed: { night: { 9: names[0] } }, unavailable_night: { [names[0]]: [11] }, wishes: { night_on: { [names[0]]: [10] } }, regular_duties: { [names[0]]: [{ kind: 'ward', dow: 'Mon', part: 'am', carry: true }] } }, f = app(2026, 11, data);
  try { f.select(names[0]); f.clear(); assert.deepEqual(copy(f.M.duty_days[names[0]]), {}); assert.deepEqual(copy(f.M.duty_days[names[1]]), data.duty_days[names[1]]);
    assert.equal(f.M.fixed.night[9], names[0]); assert.deepEqual(copy(f.M.unavailable_night[names[0]]), [11]); assert.deepEqual(copy(f.M.wishes.night_on[names[0]]), [10]); assert.deepEqual(copy(f.M.regular_duties[names[0]]), data.regular_duties[names[0]]);
  } finally { f.close(); }
});
await test('confirmed clear includes the pending displayed next-month control value', () => {
  const f = app(); try { f.select(names[0]); f.duty(2, 'am', 'ward'); f.q(`[data-cal="duty"][data-d="${f.N + 1}"][data-part="am"]`).value = 'external'; f.clear(); assert.deepEqual(copy(f.M.duty_days[names[0]]), {}); } finally { f.close(); }
});
await test('an empty boundary stays empty and repeated clearing stays harmless', () => {
  const f = app(); try { f.select(names[0]); f.duty(2, 'am', 'ward'); f.clear(); f.clear(); assert.deepEqual(copy(f.M.duty_days[names[0]]), {}); assert.deepEqual(copy(new f.T.Problem(f.R, f.M).nextMonthItems(names[0], 'am')), []); } finally { f.close(); }
});
await test('the next-month duty can still be explicitly cleared in its own control', () => {
  const f = app(); try { f.select(names[0]); f.duty(f.N + 1, 'am', 'external'); f.duty(f.N + 1, 'am', ''); f.clear(); assert.deepEqual(copy(f.M.duty_days[names[0]]), {}); assert.deepEqual(copy(new f.T.Problem(f.R, f.M).nextMonthItems(names[0], 'am')), []); } finally { f.close(); }
});
await test('ordinary autosave changes only the current JSON and leaves the separately saved next month byte-for-byte', async () => {
  const f = app(); try {
    const dirs = new Map(), writes = [], missing = () => Object.assign(new Error('Synthetic missing'), { name: 'NotFoundError' });
    const folder = { name: 'Synthetic folder', async *entries() { yield* dirs; }, async getFileHandle() { throw missing(); },
      async getDirectoryHandle(name, options = {}) {
        if (!dirs.has(name)) { if (!options.create) throw missing();
          const dir = { name, kind: 'directory', files: new Map(), async getFileHandle(file, opt = {}) {
            if (!dir.files.has(file) && !opt.create) throw missing();
            return { async getFile() { return { text: async () => dir.files.get(file) }; }, async createWritable() { let staged;
              return { async write(blob) { staged = typeof blob === 'string' ? blob : await blob.text(); }, async close() { dir.files.set(file, staged); writes.push(name + '/' + file); } }; } };
          } }; dirs.set(name, dir);
        } return dirs.get(name);
      }
    };
    const next = await folder.getDirectoryHandle('202612', { create: true }), nextText = JSON.stringify({ rules: f.R, month: { year: 2026, month: 12, duty_days: { [names[0]]: { 1: { am: 'external' }, 2: { pm: 'ward' } } }, notes: 'Synthetic separate next-month record' }, result: null });
    next.files.set('202612_data.json', nextText); f.A.dirHandle = folder; f.A.dirGen++; f.A.monthDirs = ['202612']; f.A.renderDoctor(); f.select(names[0]);
    f.duty(2, 'am', 'ward'); f.duty(f.N + 1, 'am', 'external'); f.clear(); f.w.clearTimeout(f.A.autosaveTimer);
    assert.equal(await f.A.autosaveJson(), 'saved');
    assert.deepEqual(writes, ['202611/202611_data.json']); assert.equal(next.files.get('202612_data.json'), nextText);
    const saved = JSON.parse(dirs.get('202611').files.get('202611_data.json')); assert.deepEqual(saved.month.duty_days[names[0]], {}); assert.equal(saved.month.month, 11);
  } finally { f.close(); }
});
finished = true; clearTimeout(watchdog);
console.log(`calendar clear confirmation DOM: ${passed} passed, ${failed} failed, ${expected} expected`);
if (failed || passed + failed !== expected) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e.stack || e); process.exitCode = 1; });
