// C01: new role identities must not adopt surviving orphan references.
// Real settings DOM handlers, local persistence and checker; synthetic data only. jsdom is not a layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_post47_role_identity_reservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Role identity reservation DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha', 'Synthetic Beta'];
const rawRules = { profile: { id: 'synthetic-role-identity', label: 'Synthetic roles',
  roles: [{ id: 'S', label: 'Staff', refs: [] }, { id: 'R2', label: 'Old support', refs: ['junior'], standby: true }],
  shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map((name, i) => ({ name, team: i ? 'R2' : 'S', quota: 15 })),
  oncall_requirement: { S: { S: 0, R2: 1 }, R2: { S: 0, R2: 0 } }, rule_states: { oncall: 'hard' }, weights: {} };
const rawMonth = { year: 2026, month: 11, next_first_day_in_calendar: true, notes: 'Preserve monthly conditions',
  fixed: { night: { 5: names[0] }, night_oc_none: { 5: ['R2'] }, day_oc_none: { 7: ['S'] } } };
const key = 'toban_state_v2:/synthetic/role-identity-reservation.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/role-identity-reservation.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [], toasts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = text => toasts.push(String(text)); // OS folder restoration and notices only; settings/save are production.
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  initial.rule_states.oncall = 'hard';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); assert.equal(el.closest('[hidden]'), null, 'edit target must be visible: ' + s); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = which => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${which}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts, toasts };
}

const cases = [], test = (label, fn) => cases.push({ label, fn });
const role = (i, field) => `#roleTbl tr[data-ri="${i}"] [data-${field}]`;
async function remove(a, i = 1) { a.click(`#roleTbl tr[data-ri="${i}"] [data-act="roleDel"]`); await tick(); }
async function add(a) { a.click('[data-act="roleAdd"]'); await tick(); return a.A.state.rules.profile.roles.at(-1).id; }
function resetMonth(a, fixed) {
  a.A.state.month = a.w.T.normalizeMonth({ ...clone(rawMonth), fixed }, a.A.state.rules);
  a.A.renderAll(); a.mode('build'); a.A.clearUndo();
}
async function activate(a, id) {
  a.change(role(1, 'rlabel'), 'New support');
  a.change(role(1, 'rref'), 'junior');
  a.q(role(1, 'rstandby')).checked = true;
  a.q(role(1, 'rstandby')).dispatchEvent(new a.w.Event('change', { bubbles: true }));
  a.mode('daily');
  a.change('#doctorTable tr[data-i="1"] [data-f="team"]', id);
  a.mode('build');
  a.change(`#ocReqTbl tr[data-t="S"] [data-oc="${id}"]`, '1');
  await tick();
}
test('delete/add preserves month and does not inherit the old checker exemption', async a => {
  const before = clone(a.A.state.month);
  await remove(a); assert.equal(a.A.state.rules.doctors[1].team, '');
  const id = await add(a); assert.equal(id, 'R3');
  await activate(a, id);
  assert.deepEqual(clone(a.A.state.month), before);
  const P = new a.w.T.Problem(a.A.state.rules, a.A.state.month);
  assert.equal(P.ocNone([5, 'night'], 'R2'), true);
  assert.equal(P.ocNone([5, 'night'], id), false);
  const asg = Object.fromEntries(P.slots.map(s => [s.join(':'), { work: names[0], oc: [names[1]] }]));
  let checked = a.w.T.check(P, asg);
  assert(![...checked.VC, ...checked.WC].some(v => v.code === 'FIXED_OC_NONE'));
  asg['5:night'].oc = [];
  checked = a.w.T.check(P, asg);
  assert.equal(checked.VC.filter(v => v.code === 'SLOT_OC_MISMATCH').length, 1);
});
for (const [label, fixed] of [
  ['day orphan', { day_oc_none: { 5: ['R2'] } }],
  ['next-day orphan', { night_oc_none: { 31: ['R2'] } }],
  ['imported scalar and multiple orphans', { day_oc_none: { 5: 'R2' }, night_oc_none: { 6: ['R3', 'R4'] } }],
]) test(label + ' reserves IDs without rewriting fixed data', async a => {
  resetMonth(a, fixed); const before = clone(a.A.state.month);
  await remove(a); const id = await add(a);
  assert.equal(id, label.startsWith('imported') ? 'R5' : 'R3');
  assert.deepEqual(clone(a.A.state.month), before);
});
test('rename into an orphan is rejected before save or Undo and preserves prior Undo', async a => {
  await remove(a); await add(a);
  a.change(role(1, 'rlabel'), 'Label before rejected rename'); await tick();
  const before = clone(a.A.state), saved = a.w.localStorage.getItem(key), undo = a.q('#undoNote').textContent;
  a.change(role(1, 'rid'), 'R2'); await tick();
  assert.deepEqual(clone(a.A.state), before);
  assert.equal(a.w.localStorage.getItem(key), saved);
  assert.equal(a.q('#undoNote').textContent, undo);
  assert(a.toasts.some(text => text === 'Role change canceled: Role ID “R2” is still referenced by retained roster or monthly data. Choose a different ID.'));
  a.A.undo(); await tick();
  assert.equal(a.A.state.rules.profile.roles[1].label, 'R3');
});
test('Undo deletion restores the original role and its exception', async a => {
  const before = clone(a.A.state);
  await remove(a); a.A.undo(); await tick();
  assert.deepEqual(clone(a.A.state.rules), before.rules);
  assert.deepEqual(clone(a.A.state.month), before.month);
  const P = new a.w.T.Problem(a.A.state.rules, a.A.state.month);
  assert.equal(P.ocNone([5, 'night'], 'R2'), true);
});
test('live-role rename migrates only its own exceptions and Undo reverses it', async a => {
  const before = clone(a.A.state.month);
  a.change(role(1, 'rid'), 'Support'); await tick();
  assert.deepEqual(clone(a.A.state.month.fixed.night_oc_none[5]), ['Support']);
  assert.deepEqual(clone(a.A.state.month.fixed.day_oc_none), before.fixed.day_oc_none);
  assert.equal(a.A.state.rules.doctors[1].team, 'Support');
  a.A.undo(); await tick(); assert.deepEqual(clone(a.A.state.month), before);
});
test('live-role ID swap remains an intentional simultaneous migration', async a => {
  a.q(role(0, 'rid')).value = 'R2'; a.q(role(1, 'rid')).value = 'S';
  assert.notEqual(a.A.readSettings('Synthetic simultaneous rename'), false); await tick();
  assert.deepEqual(clone(a.A.state.rules.doctors.map(d => d.team)), ['R2', 'S']);
  assert.deepEqual(clone(a.A.state.month.fixed.night_oc_none[5]), ['S']);
  assert.deepEqual(clone(a.A.state.month.fixed.day_oc_none[7]), ['R2']);
});
test('ordinary generation can reuse an ID once no actual references survive', async a => {
  resetMonth(a, {}); await remove(a); assert.equal(await add(a), 'R2');
});
test('future deletion/readd reserves the later role only while it has references', async a => {
  await remove(a); assert.equal(await add(a), 'R3');
  a.A.state.month.fixed.day_oc_none[8] = ['R3'];
  a.A.renderAll(); a.mode('build');
  await remove(a); assert.equal(await add(a), 'R4');
  assert.deepEqual(clone(a.A.state.month.fixed.day_oc_none[8]), ['R3']);
});
test('unknown imported staff reference is not silently assigned by Add or rename', async a => {
  resetMonth(a, {}); await remove(a);
  a.A.state.rules.doctors[1].team = 'R2'; a.A.renderAll(); a.mode('build');
  assert.equal(await add(a), 'R3');
  const before = clone(a.A.state.rules);
  a.change(role(1, 'rid'), 'R2'); await tick();
  assert.deepEqual(clone(a.A.state.rules), before);
  assert.equal(a.A.state.rules.doctors[1].team, 'R2');
});
const EXPECTED_CASES = 11; let passed = 0, failed = 0, started = 0, ended = 0, finished = false;
process.on('exit', () => {
  console.log(`ACCOUNTING registered=${cases.length} started=${started} ended=${ended} passed=${passed} failed=${failed} finished=${finished}`);
  if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1;
});
const watchdog = setTimeout(() => { console.error('Role identity reservation regression timed out'); process.exit(1); }, 120000);
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const { label, fn } of cases) {
    started++; console.log('START ' + label);
    let a;
    try { a = await makeApp(); a.mode('build'); await fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + label); }
    catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
    finally { a?.w.close(); ended++; console.log('END ' + label); }
  }
  finished = true; clearTimeout(watchdog); console.log(`Role identity reservation: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });
