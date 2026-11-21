// Synthetic JSON overflow regression. Real jsdom app bindings; no OS folder/browser or solver.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Month shift-import regression requires installed jsdom 26.1.0. No dependency is downloaded. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-nonfinite-import', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
// Saved/edited months have expanded duty_days. If it is absent, normalizeMonth's
// expandDuties -> Problem already rejects unsupported shifts before adoption.
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic monthly input', next_first_day_in_calendar: true, duty_days: Object.fromEntries(names.map(name => [name, {}])) };
const key = 'toban_state_v2:/synthetic/nonfinite-import.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function makeApp(lang = 'en') {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/nonfinite-import.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // Only OS folder restoration and messages are replaced.
  w.localStorage.setItem('toban.lang', lang);
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  return { dom, w, A, errors, alerts, q: s => w.document.querySelector(s) };
}
const incoming = a => ({ rules: clone(a.A.state.rules), month: { ...clone(rawMonth), notes: 'Synthetic incoming monthly input' }, result: null, saved_at: '2026-10-01T00:00:00.000Z' });

const routes = ['adopt', 'file', 'previous', 'rules-editor', 'profile-file', 'folder'], rulesOnly = ['rules-editor', 'profile-file'];
// The refusal is one fixed sentence. Nothing taken from the imported data may be shown with it.
const REFUSAL = { en: 'The JSON contains a number outside the supported finite range. Correct the number in the original JSON and import it again.',
  ja: 'JSON に扱える範囲を超えた数値が含まれています。元の JSON の数値を修正してから、もう一度読み込んでください。' };
// Each place puts exactly one "OVERFLOW" marker into the synthetic data. `rules` marks the places a settings-only JSON can carry;
// `keys` are the real key names on the path, matched as whole words (synthetic names and keys are caught by the word "synthetic").
const places = {
  pair_cap: { rules: true, keys: ['pair_cap', 'max'], put: v => { v.rules.pair_cap = { max: 'OVERFLOW' }; v.rules.rule_states.pair_cap = 'soft'; } },
  days_off: { rules: true, keys: ['days_off', 'max_extra'], put: v => { v.rules.days_off = { max_extra: 'OVERFLOW' }; v.rules.rule_states.days_off_max = 'soft'; } },
  'rules array': { rules: true, keys: ['doctors', 'quota'], put: v => { v.rules.doctors[1].quota = 'OVERFLOW'; } },
  'month value': { keys: [], put: v => { v.month.syntheticMonthKey = 'OVERFLOW'; } },
  'month array': { keys: [], put: v => { v.month.syntheticMonthList = [1, [2, 'OVERFLOW']]; } },
  'result value': { keys: [], put: v => { v.result = { syntheticResultKey: 'OVERFLOW' }; } },
  'result array': { keys: [], put: v => { v.result = { syntheticResultRows: [{ syntheticResultCell: 'OVERFLOW' }] }; } },
  'top level': { keys: [], put: v => { v.syntheticTopKey = [{ syntheticTopCell: 'OVERFLOW' }]; } },
};
let passed = 0, rejected = 0, direct = 0, controls = 0;
async function refused(route, place, token, lang = 'en') {
  const a = await makeApp(lang), tag = [lang, route, place, token].join(' / ');
  try {
    a.A.readAll(); a.A.clearUndo(); const oldNote = a.A.state.rules.notes;
    a.A.pushUndo('Synthetic prior edit'); a.A.state.rules.notes = 'Synthetic prior edit'; a.A.save(); await tick(); a.A.markSaved();
    const undoLabel = a.q('#undoNote').textContent, generation = a.A.saveGen;
    const value = incoming(a); places[place].put(value);
    const text = x => { const t = JSON.stringify(x); assert.equal(t.split('"OVERFLOW"').length, 2, tag + ' marker'); return t.replace('"OVERFLOW"', token); };
    const whole = text(value), rules = places[place].rules ? text(value.rules) : null;
    const before = JSON.stringify(a.A.state), storage = a.w.localStorage.getItem(key), ref = a.A.state.rules;
    let writes = 0, error;
    if (route === 'adopt') a.A.applyLoaded(JSON.parse(whole), 'Synthetic', {fromFolder:false});
    if (route === 'file') await a.A.loadJsonFile({name:'synthetic.json', text:async () => whole});
    if (route === 'previous') error = a.A.buildFromPrevious(JSON.parse(whole), 2026, 12).error;
    if (route === 'rules-editor') {
      const ed = a.q('#rulesJson'); ed.value = rules;
      ed.dispatchEvent(new a.w.Event('input', {bubbles:true}));
      a.q('#btnApplyRules').click();
      for (let i=0;i<10;i++) await tick();
      assert.equal(ed.value, rules, 'rejected editor draft retained');
    }
    if (route === 'profile-file') {
      const el = a.q('#fileLoadProfile');
      Object.defineProperty(el, 'files', {value:[{name:'synthetic.json',text:async()=>rules}], configurable:true});
      el.dispatchEvent(new a.w.Event('change', {bubbles:true}));
      for (let i=0;i<10;i++) await tick();
    }
    if (route === 'folder') {
      const missing = () => {const e=new Error('missing'); e.name='NotFoundError'; throw e;};
      const folder={getDirectoryHandle:missing,getFileHandle:async()=>({getFile:async()=>({text:async()=>whole}),createWritable:async()=>{writes++; throw new Error('unexpected write');}})};
      const result = await a.A.findMonthData('202611', folder, []);
      assert.ok(result.corrupt, 'invalid file must not be treated as absent'); error = result.error;
    }
    const shown = error || a.alerts.join('\n');
    assert.ok(shown.includes(REFUSAL[lang]), tag + ' diagnostic, shown: ' + JSON.stringify(shown));
    assert.ok(!/Infinity|NaN|e999|OVERFLOW/.test(shown) && !/synthetic/i.test(shown) && !places[place].keys.some(k => new RegExp('\\b' + k + '\\b').test(shown)), tag + ' diagnostic shows no key, name or value');
    assert.equal(JSON.stringify(a.A.state),before,tag+' state'); assert.equal(a.A.state.rules,ref,tag+' reference');
    assert.equal(a.w.localStorage.getItem(key),storage,tag+' storage'); assert.equal(writes,0);
    assert.equal(a.A.saveGen, generation); assert.equal(a.q('#undoNote').textContent, undoLabel);
    assert.equal(a.q('#btnUndo').disabled, false);
    a.A.undo(); assert.equal(a.A.state.rules.notes, oldNote, 'prior edit stays undoable');
    assert.deepEqual(a.errors, []); passed++; rejected++;
  } finally {a.dom.window.close();}
}
(async () => {
  for (const route of routes) for (const place of Object.keys(places)) for (const token of ['1e999', '-1e999']) {
    if (!places[place].rules && rulesOnly.includes(route)) continue; // a settings-only JSON has no month, result or top level
    await refused(route, place, token);
  }
  for (const route of ['adopt', 'rules-editor', 'folder']) await refused(route, 'rules array', '1e999', 'ja');
  const a = await makeApp();
  try {
    for (const value of [null, '', '1e999', 0, 2, 2.5, 32, 1e308, -1e308, true, [2]]) {
      const payload={rule_states:{pair_cap:'off'}, pair_cap:{max:value}};
      assert.equal(a.w.T.requireFiniteJson(payload),payload); passed++; controls++;
    }
    for (const value of [Infinity,-Infinity,NaN]) {
      assert.throws(()=>a.w.T.requireFiniteJson({rule_states:{pair_cap:'off'},privateName:{privateValue:value}}), e=>e.message.includes('outside the supported finite range')&&!e.message.includes('private'));
      passed++; direct++;
    }
    // Arrays are walked at any depth, and the message is exactly the fixed sentence (no key, no value).
    for (const value of [Infinity,-Infinity,NaN]) for (const make of [v=>v, v=>[v], v=>({syntheticList:[1,[2,v]]}), v=>({syntheticRows:[{syntheticCell:{syntheticLeaf:v}}]})]) {
      assert.throws(()=>a.w.T.requireFiniteJson(make(value)), e=>e.message===REFUSAL.en); passed++; direct++;
    }
    // Finite numbers, null and strings inside arrays are left alone.
    for (const payload of [[], [0,-0,2.5,1e308,-1e308,5e-324], {syntheticList:[null,'1e999','Infinity','NaN',true,[2,[3]]]}]) {
      assert.equal(a.w.T.requireFiniteJson(payload),payload); passed++; controls++;
    }
    // Actual adoption accepts ordinary null/finite/string extension values even when rules are off.
    for (const v of [null, '1e999', 2]) {
      const payload=incoming(a); payload.month.synthetic_extension=v;
      a.A.applyLoaded(payload,'Synthetic',{fromFolder:false});
      assert.equal(a.A.state.month.synthetic_extension,v); passed++; controls++;
    }
    // The same for arrays in the month and in the result of an adopted file.
    const list=[1,[2,1e308,'1e999',null]], payload=incoming(a); payload.month.syntheticMonthList=list; payload.result={syntheticResultRows:list};
    a.A.applyLoaded(payload,'Synthetic',{fromFolder:false});
    assert.equal(JSON.stringify(a.A.state.month.syntheticMonthList),JSON.stringify(list)); assert.equal(JSON.stringify(a.A.state.result.syntheticResultRows),JSON.stringify(list));
    assert.deepEqual(a.alerts, []); passed++; controls++;
    assert.deepEqual(a.errors, []);
  } finally {a.dom.window.close();}
  assert.deepEqual([rejected, direct, controls, passed], [79, 15, 18, 112], 'case counts');
  console.log(`JSON nonfinite import: ${passed}/${passed} OK (${rejected} rejection routes, ${direct} direct checks, ${controls} controls)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
