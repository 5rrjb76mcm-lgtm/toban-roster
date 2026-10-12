// Previous-month fixed OC is one logical value per day/shift/role, including explicit none.
// Fictional data only. Real import transition, folder reader, fixed-grid and settings click handlers;
// synthetic DOM/FS/persistence, real HiGHS and checker. This is not a browser visual test.
// Point TOBAN_WEBAPP_ROOT at an unchanged checkout to verify the semantic regression fails there.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, elements = new Map(), listeners = new Map();
globalThis.location = { pathname: '/synthetic/import-oc-conflict.html' };
globalThis.localStorage = { setItem() {} };
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [],
  addEventListener(k, f) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(f); },
  removeEventListener(k, f) { listeners.get(k)?.delete(f); } };
const emit = k => { for (const f of [...(listeners.get(k) || [])]) f({ type: k }); };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js', 'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
const alpha = 'Synthetic Alpha', beta = 'Synthetic Beta', delta = 'Synthetic Delta', gamma = 'Synthetic Gamma', epsilon = 'Synthetic Epsilon';
const R = { profile: { id: 'synthetic-import-oc-conflict', calendar: { holidays: 'none', closure: [] }, roles: [
  { id: 'X', label: 'Synthetic Charge', refs: ['charge'], standby: true },
  { id: 'Y', label: 'Synthetic Junior', refs: ['junior'], standby: true },
  { id: 'Z', label: 'Synthetic Custom Role', refs: [], standby: true }] },
  doctors: [{ name: alpha, team: 'X' }, { name: beta, team: 'Y' }, { name: delta, team: 'Y' }, { name: gamma, team: 'Z' }, { name: epsilon, team: 'Z' }],
  oncall_requirement: { X: { Y: 1, Z: 1 }, Y: {}, Z: {} }, rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, 'off'])) };
R.rule_states.oncall = 'hard'; T.fillDefaultRules(R); R.weights.missing_young_oc = 1;
let source, sourceTag, controls = [], prompts, alerts, toasts, saves, undos, reads, renders, approve, duringConfirm;
const fixedPane = { children: [{}], handlers: {}, addEventListener(k, f) { this.handlers[k] = f; },
  querySelectorAll(s) { return s.startsWith('select[data-fx]') ? controls : []; }, querySelector() { return null; } };
const dir = { async getDirectoryHandle() { return dir; }, async getFileHandle(name) {
  assert.equal(name, sourceTag + '_data.json'); return { getFile: async () => ({ text: async () => JSON.stringify(source) }) }; } };
A.refreshMonths = async () => {};
// A redundant readAll before confirmation was itself mutating and saving. Prove it is not called.
A.readAll = () => { reads++; A.state.month.notes = 'Unexpected readback'; A.save(); };
A.save = () => saves++; A.pushUndo = () => undos++;
for (const key of ['renderSettingsMonth', 'renderDoctor', 'renderFixed']) A[key] = () => renders++;
A.toast = msg => toasts.push(String(msg)); globalThis.alert = msg => alerts.push(String(msg));
globalThis.confirm = msg => { prompts.push(String(msg)); if (duringConfirm) duringConfirm(); return approve; };
A.choose = async () => { throw new Error('Unexpected facility choice'); };
function resetCounts() { prompts = []; alerts = []; toasts = []; saves = undos = reads = renders = 0; duringConfirm = null; }
function setup({ year = 2026, month = 10 } = {}) {
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1, nd = A.daysIn(year, month) + 1;
  elements.clear(); elements.set('#fixedPane', fixedPane); controls = []; A.bindFixed();
  const M = T.normalizeMonth({ year: ny, month: nm, next_first_day_in_calendar: true, notes: 'Keep notes',
    fixed: { night: { 7: alpha }, day_oc_none: { 8: ['Z'] } }, fixed_tags: { ['7:night|' + alpha]: 'Keep tag' },
    history: { work_balance: { [alpha]: 9 } }, prev_month: { last_days: [{ date: nd - 1, night: gamma }] } }, R);
  Object.assign(A.state, { rules: clone(R), month: M, result: { marker: 'keep result' }, meta: { marker: 'keep metadata' },
    base: { marker: 'keep base' }, baseRules: clone(R), renames: [], ui: { doctor: 0 } });
  source = { rules: clone(R), month: T.normalizeMonth({ year, month, next_first_day_in_calendar: true,
    history: { work_balance: { [alpha]: 2 } }, fixed: { day: { [nd]: alpha }, night: { [nd]: alpha } } }, R), result: null };
  sourceTag = `${year}${String(month).padStart(2, '0')}`; A.dirHandle = dir; A.dirGen++; A.monthDirs = [sourceTag]; A.solving = false; A.switching = 0;
  resetCounts(); approve = false; return nd;
}
function setSourceChoice(kind, was, value, nd = A.daysIn(+source.month.year, +source.month.month) + 1) {
  const current = A.state.month; A.state.month = source.month;
  controls = [{ dataset: { fx: kind + 'Y', d: String(nd), shown: was }, value, hasAttribute: () => false }];
  fixedPane.handlers.change(); source.month = A.state.month; A.state.month = current; controls = [];
}
function choice(m, kind, day = 1, role = 'Y') {
  const names = [].concat(m.fixed[kind + '_oc']?.[day] || []).filter(n => A.state.rules.doctors.find(d => d.name === n)?.team === role);
  const none = [].concat(m.fixed[kind + '_oc_none']?.[day] || []).includes(role); return { names, none };
}
const snapshot = () => JSON.stringify(A.state);
function unrelated() {
  assert.equal(A.state.month.fixed.night[7], alpha); assert.equal(A.state.month.fixed_tags['7:night|' + alpha], 'Keep tag');
  assert.deepEqual(A.state.month.fixed.day_oc_none[8], ['Z']); assert.equal(A.state.month.notes, 'Keep notes');
}
function noCommit(before, refs) {
  assert.equal(snapshot(), before, 'cancel/error must preserve all state');
  for (const [k, v] of Object.entries(refs)) assert.equal(A.state[k], v, k + ' reference retained');
  assert.equal(saves, 0); assert.equal(undos, 0); assert.equal(reads, 0); assert.equal(renders, 0); assert.equal(A.switching, 0);
}
let passed = 0, failed = 0, solveCount = 0;
async function test(label, fn) { try { await fn(); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.stack); } }
(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  async function feasible(m) {
    const P = new T.Problem(A.state.rules, m), result = await T.solve(P, highs, { timeLimit: 10 }); solveCount++;
    assert.equal(result.status, 'Optimal'); assert(result.asg); assert.deepEqual(T.lint(P), []); assert.deepEqual(T.check(P, result.asg).V, []);
  }
  for (const kind of ['day', 'night']) for (const [first, second] of [['__noneY__', beta], [beta, '__noneY__'], [beta, delta]]) {
    await test(`${kind}: repeated ${first} to ${second} asks and applies one atomic choice`, async () => {
      const nd = setup(); setSourceChoice(kind, '', first); await feasible(source.month); resetCounts(); await A.importPrevious();
      assert.equal(prompts.length, 0); await feasible(A.state.month);
      // Keep unrelated same-day role, opposite shift, another day, and their tags.
      const tbl = kind + '_oc', other = kind === 'day' ? 'night' : 'day';
      A.state.month.fixed[tbl][1] = [...(A.state.month.fixed[tbl][1] || []), gamma];
      A.state.month.fixed_tags[`1:${tbl}|${gamma}`] = 'Keep other role tag';
      A.state.month.fixed[other + '_oc'][1] = [epsilon];
      A.state.month.fixed_tags[`1:${other}_oc|${epsilon}`] = 'Keep other shift tag';
      if (first !== '__noneY__') A.state.month.fixed_tags[`1:${tbl}|${first}`] = 'Remove replaced tag';
      setSourceChoice(kind, first, second);
      if (second !== '__noneY__') source.month.fixed_tags[`${nd}:${tbl}|${second}`] = 'Incoming tag';
      await feasible(source.month);
      const currentMonth = A.state.month;
      A.state.month = T.normalizeMonth({ year: currentMonth.year, month: currentMonth.month, next_first_day_in_calendar: true }, A.state.rules);
      await A.importPrevious(); await feasible(A.state.month); A.state.month = currentMonth;
      const sourceBefore = JSON.stringify(source), refs = { rules: A.state.rules, result: A.state.result, meta: A.state.meta, base: A.state.base, baseRules: A.state.baseRules, renames: A.state.renames };
      resetCounts(); approve = true; await A.importPrevious();
      assert.equal(prompts.length, 1, 'incompatible current role requires explicit confirmation');
      assert(prompts[0].includes('2026/11/1') && prompts[0].includes('Synthetic Junior') && prompts[0].includes('(Y)'));
      assert(prompts[0].includes(kind === 'day' ? '日勤OC' : '夜間OC')); assert(prompts[0].includes(beta));
      if (second === delta) assert(prompts[0].includes(delta)); else assert(prompts[0].includes('なし'));
      assert.deepEqual(choice(A.state.month, kind), second === '__noneY__' ? { names: [], none: true } : { names: [second], none: false });
      assert(A.state.month.fixed[tbl][1].includes(gamma)); assert.equal(A.state.month.fixed_tags[`1:${tbl}|${gamma}`], 'Keep other role tag');
      assert.deepEqual(A.state.month.fixed[other + '_oc'][1], [epsilon]); assert.equal(A.state.month.fixed_tags[`1:${other}_oc|${epsilon}`], 'Keep other shift tag');
      if (first !== '__noneY__') assert.equal(A.state.month.fixed_tags[`1:${tbl}|${first}`], undefined);
      if (second !== '__noneY__') assert.equal(A.state.month.fixed_tags[`1:${tbl}|${second}`], 'Incoming tag');
      assert.equal(JSON.stringify(source), sourceBefore); for (const [k, v] of Object.entries(refs)) assert.equal(A.state[k], v);
      assert.equal(saves, 1); assert.equal(undos, 1); assert.equal(reads, 0); assert.equal(renders, 3); assert.deepEqual(alerts, []); unrelated();
      await feasible(A.state.month);
    });
    await test(`${kind}: cancel ${first} to ${second} preserves all state, undo, save and tags`, async () => {
      setup(); setSourceChoice(kind, '', first); await A.importPrevious(); setSourceChoice(kind, first, second); resetCounts();
      const before = snapshot(), refs = { ...A.state }; await A.importPrevious();
      assert.equal(prompts.length, 1); assert.deepEqual(alerts, []); noCommit(before, refs); unrelated();
    });
  }
  for (const kind of ['day', 'night']) await test(`${kind}: identical imported choices do not prompt; unrelated role and none survive`, async () => {
    setup(); setSourceChoice(kind, '', beta); await A.importPrevious();
    A.state.month.fixed[kind + '_oc'][1].push(gamma); A.state.month.fixed[kind + '_oc_none'][1] = ['X'];
    resetCounts(); await A.importPrevious(); assert.equal(prompts.length, 0); assert.equal(saves, 1);
    assert.deepEqual(choice(A.state.month, kind), { names: [beta], none: false });
    assert(A.state.month.fixed[kind + '_oc'][1].includes(gamma)); assert.deepEqual(A.state.month.fixed[kind + '_oc_none'][1], ['X']);
  });
  for (const kind of ['day', 'night']) await test(`${kind}: internally contradictory incoming names and none are rejected before any change`, async () => {
    const nd = setup(); source.month.fixed[kind + '_oc'][nd] = [beta]; source.month.fixed[kind + '_oc_none'][nd] = ['Y'];
    approve = true; const before = snapshot(), refs = { ...A.state }; await A.importPrevious();
    assert.equal(prompts.length, 0); assert.equal(alerts.length, 1); assert(alerts[0].includes('Y') && alerts[0].includes('なし')); noCommit(before, refs);
  });
  await test('source contradiction is rejected using original role meaning even after current roster moved the name', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [beta]; source.month.fixed.night_oc_none[nd] = ['Y'];
    A.state.rules.doctors.find(d => d.name === beta).team = 'Z'; approve = true;
    const before = snapshot(), refs = { ...A.state }; await A.importPrevious(); assert.equal(alerts.length, 1); noCommit(before, refs);
  });
  await test('source choice becoming contradictory under current role meaning is rejected', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [gamma]; source.month.fixed.night_oc_none[nd] = ['Y'];
    A.state.rules.doctors.find(d => d.name === gamma).team = 'Y'; approve = true;
    const before = snapshot(), refs = { ...A.state }; await A.importPrevious(); assert.equal(alerts.length, 1); noCommit(before, refs);
  });
  await test('custom role without junior/charge UI is reconciled and confirmed', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [epsilon]; A.state.month.fixed.night_oc[1] = [gamma, beta];
    approve = true; await A.importPrevious(); assert.equal(prompts.length, 1); assert(prompts[0].includes('Synthetic Custom Role'));
    assert.deepEqual(choice(A.state.month, 'night', 1, 'Z'), { names: [epsilon], none: false }); assert(A.state.month.fixed.night_oc[1].includes(beta));
  });
  for (const boundary of [{ year: 2026, month: 12 }, { year: 2028, month: 2 }]) await test(`boundary ${boundary.year}/${boundary.month} uses the correct previous last+1 and current date`, async () => {
    const nd = setup(boundary); setSourceChoice('night', '', beta, nd); A.state.month.fixed.night_oc_none[1] = ['Y'];
    approve = true; await A.importPrevious(); assert.equal(prompts.length, 1);
    assert(prompts[0].includes(`${A.state.month.year}/${A.state.month.month}/1`)); assert.deepEqual(choice(A.state.month, 'night'), { names: [beta], none: false });
  });
  await test('a previous-month-only source entry does not clear or conflict with current fixed OC', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd - 1] = [beta]; A.state.month.fixed.night_oc_none[1] = ['Y'];
    await A.importPrevious(); assert.equal(prompts.length, 0); assert.deepEqual(choice(A.state.month, 'night'), { names: [], none: true });
  });
  await test('multi-name role is a set-valued choice, including same set in a different order', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [delta, beta]; A.state.month.fixed.night_oc[1] = [beta, delta, gamma];
    await A.importPrevious(); assert.equal(prompts.length, 0); assert.equal(saves, 1); assert.deepEqual(new Set(A.state.month.fixed.night_oc[1]), new Set([beta, delta, gamma]));
  });
  await test('unknown current names and their tags are retained rather than assigned an inferred role', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [beta]; A.state.month.fixed.night_oc[1] = ['Synthetic Departed'];
    A.state.month.fixed_tags['1:night_oc|Synthetic Departed'] = 'Keep departed tag';
    await A.importPrevious(); assert.equal(prompts.length, 0); assert(A.state.month.fixed.night_oc[1].includes('Synthetic Departed'));
    assert.equal(A.state.month.fixed_tags['1:night_oc|Synthetic Departed'], 'Keep departed tag');
  });
  for (const change of ['rules', 'month', 'folder', 'save']) await test(`accepted OC confirmation becomes stale after ${change} changes`, async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [beta]; A.state.month.fixed.night_oc_none[1] = ['Y']; approve = true;
    duringConfirm = () => { if (change === 'rules') A.state.rules.doctors[0].quota = 99;
      else if (change === 'month') A.state.month.notes = 'New edit'; else if (change === 'folder') A.dirGen++; else A.saveGen++; };
    await A.importPrevious(); assert.equal(prompts.length, 1); assert.equal(saves, 0); assert.equal(undos, 0); assert.equal(reads, 0);
    assert.deepEqual(choice(A.state.month, 'night'), { names: [], none: true });
  });
  for (const event of ['input', 'change']) await test(`live ${event} during folder read aborts without losing an unblurred DOM value`, async () => {
    setup(); const input = { value: 'Keep notes' }; elements.set('#syntheticUnblurredInput', input);
    const before = snapshot(), refs = { ...A.state }, oldRefresh = A.refreshMonths;
    let entered, release; const reachedRead = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
    A.refreshMonths = async () => { entered(); await blocked; };
    try { const pending = A.importPrevious(); await reachedRead; input.value = 'New unblurred edit'; emit(event); release(); await pending; }
    finally { A.refreshMonths = oldRefresh; }
    noCommit(before, refs); assert.equal(input.value, 'New unblurred edit'); assert.equal(prompts.length, 0); assert.equal(alerts.length, 0);
    assert(toasts.some(s => s.includes('入力が変更'))); assert.equal(listeners.get(event)?.size || 0, 0, 'temporary listeners removed');
  });
  await test('temporary edit guard is removed after success and does not poison the next import', async () => {
    setup(); await A.importPrevious(); assert.equal(saves, 1); emit('input'); resetCounts(); await A.importPrevious();
    assert.equal(saves, 1); assert.equal(listeners.get('input')?.size || 0, 0); assert.equal(listeners.get('change')?.size || 0, 0);
  });
  await test('actual import button cancellation creates no pre-import undo, readback or save', async () => {
    const nd = setup(); source.month.fixed.night_oc[nd] = [beta]; A.state.month.fixed.night_oc_none[1] = ['Y'];
    const pane = { handlers: {}, children: [{}], dataset: { names: A.names().join('|') },
      addEventListener(k, fn) { this.handlers[k] = fn; }, querySelectorAll() { return []; }, querySelector() { return null; } };
    elements.set('#monthSettings', pane); A.bindSettingsMonth(); const before = snapshot(), refs = { ...A.state };
    const imp = A.importPrevious; let pending; A.importPrevious = () => (pending = imp());
    try { pane.handlers.click({ target: { closest: () => ({ id: 'btnImportPrev', dataset: {} }) } }); await pending; }
    finally { A.importPrevious = imp; }
    assert.equal(prompts.length, 1); noCommit(before, refs);
  });
  console.log(`Previous import OC conflicts: ${passed} passed, ${failed} failed; ${solveCount} HiGHS/checker controls`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
