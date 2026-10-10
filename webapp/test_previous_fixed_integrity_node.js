// Explicit next-month fixed input and its tags survive previous-month carryover.
// Synthetic data only; actual edit/import/file/month-switch handlers, substituted DOM/FS.
// TOBAN_WEBAPP_ROOT can point at the unchanged public baseline for red reproduction.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, elements = new Map();
globalThis.location = { pathname: '/synthetic/previous-fixed.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'), { filename: f });
const A = T.app, names = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic: Gamma|third'], clone = x => JSON.parse(JSON.stringify(x));
let source, toasts, alerts, saved, count = 0, failed = 0;
A.readAll = () => {}; A.isDirty = () => false;
A.save = () => { saved++; };
for (const k of ['renderAll', 'renderHeader', 'renderSettingsMonth', 'renderDoctor', 'renderFixed', 'showTab', 'clearUndo']) A[k] = () => {};
A.toast = s => toasts.push(s); globalThis.alert = s => alerts.push(s); globalThis.confirm = () => true;
A.refreshMonths = async () => {}; A.findMonthData = async () => ({ data: clone(source), where: 'synthetic memory file', tried: [] });
A.choose = async () => 'prev'; A.fsOK = () => false;
function setup({ explicit = names[1], result = true, m = 10 } = {}) {
  elements.clear(); saved = 0; toasts = []; alerts = []; A.dirHandle = null; A.storedHandle = null; A.switching = 0; A.solving = false;
  const R = { profile: { id: 'synthetic-fixed-carry', roles: [{ id: 'I', label: 'Charge', refs: ['charge'], standby: true }],
    shifts: [{ id: 'day', on: 'off_days' }, { id: 'night', on: 'all' }], calendar: { holidays: 'none', closure: [] } },
    doctors: names.map(name => ({ name, team: 'I', quota: 0 })), rule_states: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off'; R.rule_states.period_charge = 'hard';
  const M = T.normalizeMonth({ year: 2026, month: m, next_first_day_in_calendar: true }, R), P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[0], oc: [] }]));
  Object.assign(A.state, { rules: R, month: M, result: result ? { asg, status: 'Optimal' } : null, ui: { doctor: 0 }, meta: null, base: null, baseRules: null, renames: [] });
  if (result) assert.deepEqual(T.check(P, asg).VC, [], 'stored assignment is valid before the future fixed edit');
  // Real fixed-grid change handler: edit the future charge after a result exists.
  if (explicit !== null) {
    const el = { value: explicit, dataset: { fx: 'charge', d: String(P.N + 1) }, hasAttribute: () => false };
    const pane = { children: [{}], handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; }, querySelectorAll(s) { return s === 'select[data-fx],input[data-fx]' || s === 'select[data-fx]' ? [el] : []; } };
    elements.set('#fixedPane', pane); A.bindFixed(); pane.handlers.change();
    assert.equal(M.fixed.weekend_charge[P.N + 1], explicit); assert.equal(A.state.result?.asg, result ? asg : undefined, 'ordinary fixed edit keeps earlier result');
  }
  source = JSON.parse(A.payloadJson('synthetic saved payload')); saved = 0;
  return { R, M, P };
}
async function carry(route, target = {}) {
  if (route === 'file') await A.createFromPrevFile({ text: async () => JSON.stringify(source) });
  else if (route === 'header') await A.onMonthChange(2026, source.month.month + 1);
  else {
    A.state.month = T.normalizeMonth({ year: 2026, month: source.month.month + 1, next_first_day_in_calendar: true, ...clone(target) }, A.state.rules);
    A.dirHandle = { name: 'synthetic' }; await A.importPrevious();
  }
  assert.deepEqual(alerts, []); return A.state.month;
}
async function test(label, fn) { try { await fn(); count++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); } }
(async () => {
  for (const route of ['file', 'header', 'import']) {
    for (const explicit of [names[1], names[0], 'Synthetic Departed']) await test(`${route}: explicit ${explicit} wins over inferred charge`, async () => {
      const { R } = setup({ explicit }), before = JSON.stringify(source), m = await carry(route);
      assert.equal(m.fixed.weekend_charge[1], explicit, 'do not overwrite an explicit future fixed charge');
      assert.equal(m.prev_month.last_weekend_charge, names[0], 'retain actual previous-result history');
      assert.equal(JSON.stringify(source), before, 'source payload is unchanged');
      if (explicit !== names[0]) {
        const notes = route === 'import' ? toasts.join('\n') : m.notes;
        assert.ok(notes.includes(explicit) && notes.includes(names[0]) && /固定指定を保持/.test(notes), 'explain retained fixed versus previous result');
      }
      if (explicit === names[1]) { const Q = new T.Problem(R, m), pin = Object.fromEntries(Q.slots.map(s => [T.Problem.key(s), { work: names[1], oc: [] }])); assert.ok(T.check(Q, pin).VC.some(x => x.code === 'PERIOD_CHARGE_PREV_LINK'), 'preserve contradictory history for correction'); }
    });
    await test(`${route}: no explicit input retains inferred carry fallback`, async () => { setup({ explicit: null }); const m = await carry(route); assert.equal(m.fixed.weekend_charge[1], names[0]); });
    await test(`${route}: uncalculated source keeps explicit input`, async () => { setup({ result: false }); const m = await carry(route); assert.equal(m.fixed.weekend_charge[1], names[1]); });
  }
  await test('import: absent source explicit fixed still refreshes previous inferred target', async () => {
    setup({ explicit: null }); const m = await carry('import', { fixed: { weekend_charge: { 1: names[1] } } }); assert.equal(m.fixed.weekend_charge[1], names[0]);
  });
  for (const kind of ['day', 'night', 'day_oc', 'night_oc']) await test(`import: ${kind} replacement removes newly orphaned tags and adopts source tags`, async () => {
    const { P } = setup({ result: false }), nd = P.N + 1, a = names[0], b = names[1], c = names[2];
    source.month.fixed[kind][nd] = [a, c]; source.month.fixed_tags = { [`${nd}:${kind}|${c}`]: 'Source tag' };
    const m = await carry('import', { fixed: { [kind]: { 1: [a, b], 2: a } }, fixed_tags: { [`1:${kind}|${a}`]: 'Stale tag', [`1:${kind}|${b}`]: 'Removed tag', [`2:${kind}|${a}`]: 'Keep other day' } });
    assert.deepEqual(m.fixed[kind][1], [a, c]);
    assert.deepEqual(m.fixed_tags, { [`1:${kind}|${a}`]: 'Stale tag', [`1:${kind}|${c}`]: 'Source tag', [`2:${kind}|${a}`]: 'Keep other day' });
  });
  await test('import: orphan source tag cannot attach to untouched current fixed input', async () => {
    const { P } = setup({ result: false }), a = names[0]; source.month.fixed_tags = { [`${P.N + 1}:night|${a}`]: 'Orphan source tag' };
    const m = await carry('import', { fixed: { night: { 1: a } }, fixed_tags: { [`1:night|${a}`]: 'Keep current tag' } });
    assert.equal(m.fixed_tags[`1:night|${a}`], 'Keep current tag');
  });
  await test('nonconsecutive creation does not carry explicit or inferred fixed input', async () => {
    setup(); const m = A.fromPrevious(source, 2027, 1); assert.deepEqual(m.fixed.weekend_charge, {});
  });
  await test('midweek month end preserves explicit input without inferred conflict', async () => {
    setup({ m: 11 }); const m = await carry('file'); assert.equal(m.fixed.weekend_charge[1], names[1]); assert.ok(!m.notes.includes('固定指定を保持'));
  });
  console.log(`Previous fixed integrity: ${count} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
