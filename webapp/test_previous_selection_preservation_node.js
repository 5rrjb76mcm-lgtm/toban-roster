// Historical previous-month names must survive current-roster/role changes.
// Fictional fixtures; actual markup decoded with Python HTMLParser, minimal DOM
// substitutes for readback/events. This is NOT a real-browser test.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), { execFileSync } = require('child_process');
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: '/synthetic/previous-selection.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'plugins.js', 'app-core.js', 'app-input.js', 'app-settings.js'])
  vm.runInThisContext(fs.readFileSync(f === 'app-input.js' && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), names = ['Synthetic Prior', 'Synthetic Current', 'Synthetic OC'];
A.save = () => {}; A.toast = () => {}; A.renderAll = () => A.renderSettingsMonth();
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); } }
const parse = html => JSON.parse(execFileSync('python3', ['-c', `import json,sys
from html.parser import HTMLParser
class Controls(HTMLParser):
 def __init__(self): super().__init__(); self.controls=[]; self.rows=[]; self.row=None; self.select=None; self.textarea=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  assert 'data-injected' not in a
  if tag=='tr' and 'data-ld' in a: self.row={'attrs':a,'indexes':[]}; self.rows.append(self.row)
  if tag in ('input','select','textarea'):
   c={'attrs':a,'value':a.get('value',''),'checked':'checked' in a,'tag':tag}; self.controls.append(c)
   if self.row is not None: self.row['indexes'].append(len(self.controls)-1)
   if tag=='select': self.select=c; c['options']=[]
   if tag=='textarea': self.textarea=c
  if tag=='option' and self.select is not None: self.select['options'].append(a)
 def handle_endtag(self,tag):
  if tag=='tr': self.row=None
  if tag=='select': self.select=None
  if tag=='textarea': self.textarea=None
 def handle_data(self,s):
  if self.textarea is not None: self.textarea['value']+=s
p=Controls(); p.feed(sys.stdin.read()); print(json.dumps({'controls':p.controls,'rows':p.rows}))`], { input: html, encoding: 'utf8' }));
const dataset = a => Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
const matches = (el, sel) => sel.split(',').some(s => { const m = s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); return m && Object.hasOwn(el.attrs, m[1]) && (m[2] === undefined || el.attrs[m[1]] === m[2]); });
function setup({ oc = true, multi = false, prior = names[0] } = {}) {
  const R = { profile: { id: 'synthetic-history', roles: [{ id: 'C', label: 'Charge', refs: ['charge'] }, { id: 'S', label: 'Staff', refs: [] }], positions: { work: { count: 1 } } }, doctors: [prior, ...names.slice(1)].map(name => ({ name, team: 'C', quota: 10 })), rule_states: {} };
  T.fillDefaultRules(R); R.rule_states.period_charge = 'hard'; R.rule_states.oncall = oc ? 'hard' : 'off';
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, prev_month: { last_days: [{ date: 31, day: multi ? [prior, names[1]] : prior, day_oc: [names[2]], night: multi ? [prior, names[2]] : prior, night_oc: [names[1]] }], last_weekend_charge: prior, prev_weekend_charge: prior }, history: { weekend_charge: { [prior]: 7 } }, fixed: { night: { 5: prior } } }, R);
  Object.assign(A.state, { rules: R, month: M, result: null, renames: [], ui: { doctor: 0 } }); elements.clear(); A.clearUndo();
  const root = { dataset: {}, children: [{}], handlers: {}, addEventListener(k, f) { this.handlers[k] = f; },
    querySelectorAll(s) { return s === 'tr[data-ld]' ? this.rows : this.controls.filter(c => matches(c, s)); }, querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    set innerHTML(html) { this.html = html; const raw = parse(html); this.controls = raw.controls.map(c => {
      const value = c.options ? (c.options.find(o => Object.hasOwn(o, 'selected')) || c.options[0] || {}).value || '' : c.value;
      return { ...c, value, dataset: dataset(c.attrs), type: c.attrs.type || (c.options ? 'select-one' : 'text'), getAttribute: k => c.attrs[k] ?? null, hasAttribute: k => Object.hasOwn(c.attrs, k) };
    }); this.rows = raw.rows.map(r => ({ dataset: dataset(r.attrs), querySelector: s => r.indexes.map(i => this.controls[i]).find(c => matches(c, s)) || null })); }, get innerHTML() { return this.html; } };
  elements.set('#monthSettings', root); A.bindSettingsMonth(); A.renderSettingsMonth();
  const control = s => { const c = root.querySelector(s); assert.ok(c, 'missing control ' + s); return c; };
  const edit = (c, v) => { c.value = v; root.handlers.change({ target: c }); };
  const note = () => edit(control('[data-path="notes"]'), 'Unrelated synthetic note');
  return { M, R, root, control, edit, note };
}
(async () => {
  for (const oc of [true, false]) await test(`deleting staff preserves historical day/night, OC and charge (OC visible ${oc})`, async () => {
    const { M, root, note } = setup({ oc }), before = clone(M.prev_month);
    A.removeDoctor(0); assert.deepStrictEqual(M.prev_month, before, 'deletion intentionally keeps past records'); assert.ok(!M.fixed.night[5], 'current fixed inputs still purged');
    A.renderSettingsMonth();
    for (let i = 0; i < 3; i++) { note(); A.readAll(); assert.deepStrictEqual(M.prev_month, before); A.renderSettingsMonth(); }
    assert.deepStrictEqual(JSON.parse(A.payloadJson()).month.prev_month, before, 'JSON keeps historical data');
    const current = root.controls.find(c => c.attrs.id === 'pmExtName'); assert.ok(!current.options.some(o => o.value === names[0]), 'fallback must not expand current assignment selectors');
  });
  await test('changing role preserves both previous weekend charge holders', () => {
    const { M, R, control, note } = setup(), before = clone(M.prev_month); R.doctors[0].team = 'S'; A.renderSettingsMonth();
    assert.strictEqual(control('[data-path="prev_month.last_weekend_charge"]').value, names[0]);
    note(); A.readAll(); assert.deepStrictEqual(M.prev_month, before);
  });
  await test('explicit blanks clear missing historical selections and hidden OC without resurrection', () => {
    const { M, root, control, edit, note } = setup({ oc: false }); A.removeDoctor(0); A.renderSettingsMonth();
    edit(root.rows[0].querySelector('[data-f="day"]'), ''); edit(root.rows[0].querySelector('[data-f="night"]'), '');
    edit(control('[data-path="prev_month.last_weekend_charge"]'), ''); edit(control('[data-path="prev_month.prev_weekend_charge"]'), '');
    for (let i = 0; i < 3; i++) { A.renderSettingsMonth(); note(); assert.deepStrictEqual(M.prev_month, { last_days: [{ date: 31 }], last_weekend_charge: null, prev_weekend_charge: null }); }
  });
  await test('current-roster replacements work and do not resurrect old names', () => {
    const { M, root, control, edit, note } = setup(); A.removeDoctor(0); A.renderSettingsMonth();
    edit(root.rows[0].querySelector('[data-f="night"]'), names[1]); edit(control('[data-path="prev_month.last_weekend_charge"]'), names[1]);
    A.renderSettingsMonth(); note(); assert.strictEqual(M.prev_month.last_days[0].night, names[1]); assert.strictEqual(M.prev_month.last_weekend_charge, names[1]);
  });
  await test('active names are not duplicated in historical dropdowns', () => {
    const { root, control } = setup(); for (const c of [root.rows[0].querySelector('[data-f="night"]'), control('[data-path="prev_month.last_weekend_charge"]')]) assert.strictEqual(c.options.filter(o => o.value === names[0]).length, 1);
  });
  await test('literal HTML and delimiter-containing historical names remain escaped and selected', () => {
    const prior = 'Synthetic: A|B"><img data-injected="yes">&', { M, root, note } = setup({ prior }), before = clone(M.prev_month);
    A.removeDoctor(0); A.renderSettingsMonth(); assert.ok(!root.html.includes(prior)); note(); assert.deepStrictEqual(M.prev_month, before);
  });
  await test('existing multi-worker historical rows remain unchanged', () => {
    const { M, note } = setup({ multi: true }), before = clone(M.prev_month); A.removeDoctor(0); A.renderSettingsMonth(); note(); assert.deepStrictEqual(M.prev_month, before);
  });
  await test('Undo of unrelated monthly edit preserves historical selections after deletion', async () => {
    const { M, note } = setup(), before = clone(M.prev_month); A.removeDoctor(0); A.renderSettingsMonth(); A.clearUndo(); note(); await Promise.resolve(); A.undo(); assert.deepStrictEqual(A.state.month.prev_month, before);
  });
  console.log(`previous selection preservation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
