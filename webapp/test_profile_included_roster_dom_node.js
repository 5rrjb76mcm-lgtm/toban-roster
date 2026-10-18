// Current version included-roster profiles distinguish an empty roster from an omitted roster.
// Real DOM export/import and local persistence; synthetic data only. jsdom is not a layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_included_roster_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Included roster DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-included-roster', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic profile import preservation' };
const key = 'toban_state_v2:/synthetic/profile-included-roster.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-included-roster.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // OS folder restoration only; input/import/save are production.
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); assert.equal(el.closest('[hidden]'), null, 'edit target must be visible: ' + s); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = which => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${which}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts };
}


const cases = [], test = (label, fn) => cases.push({label, fn});
async function importFile(a, rules) {
  const el = a.q('#fileLoadProfile');
  Object.defineProperty(el, 'files', {configurable:true, value:[{name:'synthetic-profile.json', text:async()=>JSON.stringify(rules)}]});
  el.dispatchEvent(new a.w.Event('change', {bubbles:true}));
  await tick(); await until(()=>a.A.switching === 0, 'profile import');
}
async function exportFile(a) {
  let exported;
  a.A.download = (name, blob) => { const reader=new a.w.FileReader(); reader.onload=()=>{exported=JSON.parse(reader.result);}; reader.onerror=()=>a.errors.push('FileReader failed'); reader.readAsText(blob); };
  a.q('#setExportRoster').checked=true; a.click('#btnExportProfile');
  await until(()=>exported || a.alerts.length, 'included export');
  assert.deepEqual(a.alerts, []); assert(exported); return exported;
}
const storage = a => Object.fromEntries(Array.from({length:a.w.localStorage.length}, (_,i)=>a.w.localStorage.key(i)).sort().map(k=>[k,a.w.localStorage.getItem(k)]));
const incoming = a => {const r=clone(a.A.state.rules); r.profile.label='Synthetic incoming'; r.toban_profile={version:1,roster:'included'};return r;};
async function seedUndo(a) {
  a.A.clearUndo(); const original=a.A.state.rules.notes;
  a.A.pushUndo('Synthetic prior edit'); a.A.state.rules.notes='Synthetic prior edit';a.A.save();await tick();
  assert.equal(a.q('#btnUndo').disabled,false);return original;
}
async function assertRejected(a,r) {
  const original=await seedUndo(a), before=JSON.stringify(a.A.state), refs={...a.A.state}, saved=storage(a), note=a.q('#undoNote').textContent;
  await importFile(a,r);
  assert.equal(a.alerts.length,1);a.alerts.length=0;
  assert.equal(JSON.stringify(a.A.state),before,'rejection leaves the complete state unchanged');
  for(const k of Object.keys(refs))assert.equal(a.A.state[k],refs[k],k+' reference preserved');
  assert.deepEqual(storage(a),saved,'rejection performs no storage writes');
  assert.equal(a.q('#undoNote').textContent,note);assert.equal(a.q('#btnUndo').disabled,false);
  a.A.undo();assert.equal(a.A.state.rules.notes,original,'prior Undo remains usable');
}
test('genuine empty included export replaces four-person roster and survives reload',async a=>{
  const source=await makeApp();try {
    source.mode('build');source.A.state.rules.doctors=[];source.A.state.rules.name_order=[];source.A.renderSettings();
    const r=await exportFile(source);assert.deepEqual(r.doctors,[]);assert.deepEqual(r.name_order,[]);assert.deepEqual(r.toban_profile,{version:1,roster:'included'});
    assert.equal(a.A.state.rules.doctors.length,4);const month=clone(a.A.state.month);await importFile(a,r);
    assert.deepEqual(clone(a.A.state.rules.doctors),[]);assert.deepEqual(clone(a.A.state.rules.name_order),[]);assert.equal(a.A.state.rules.toban_profile,undefined);assert.deepEqual(clone(a.A.state.month),month);
    const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepEqual(clone(b.A.state.rules.doctors),[]);assert.deepEqual(clone(b.A.state.rules.name_order),[]);assert.deepEqual(b.errors,[]);}finally{b.w.close();}
    assert.deepEqual(source.errors,[]);assert.deepEqual(source.alerts,[]);
  }finally{source.w.close();}
});
test('included nonempty roster replaces destination and retains person metadata',async a=>{
 const r=incoming(a);r.doctors=[{name:'Synthetic Incoming Person',team:'S',quota:5,local_person:{keep:1}}];r.name_order=['Synthetic Incoming Person'];await importFile(a,r);assert.deepEqual(clone(a.A.state.rules.doctors),r.doctors);assert.deepEqual(clone(a.A.state.rules.name_order),r.name_order);
});
for(const shape of ['missing','null','object','string']) test('included malformed '+shape+' rejects atomically',async a=>{
 const r=incoming(a);if(shape==='missing')delete r.doctors;else r.doctors={null:null,object:{},string:'not a roster'}[shape];await assertRejected(a,r);
});
for(const marker of ['legacy','placeholder'])for(const shape of ['missing','null','empty'])test(marker+' '+shape+' retains existing roster fallback',async a=>{
 const r=incoming(a),before=clone(a.A.state.rules.doctors),order=clone(a.A.state.rules.name_order);if(marker==='legacy')delete r.toban_profile;else r.toban_profile.roster='placeholder';if(shape==='missing')delete r.doctors;else r.doctors=shape==='null'?null:[];r.name_order=[];
 await importFile(a,r);assert.deepEqual(clone(a.A.state.rules.doctors),before);assert.deepEqual(clone(a.A.state.rules.name_order),order);assert.equal(a.A.state.rules.profile.label,r.profile.label);
});
const unrecognized=[null,'included',[],true,1,{roster:'included'},{version:'1',roster:'included'},{version:0,roster:'included'},{version:2,roster:'included'},{version:1,roster:'Included'},{version:1}, {version:1,roster:null}];
for(const marker of unrecognized)test('unrecognized marker retains fallback: '+JSON.stringify(marker),async a=>{
 const r=incoming(a),before=clone(a.A.state.rules.doctors);r.toban_profile=marker;r.doctors=[];await importFile(a,r);assert.deepEqual(clone(a.A.state.rules.doctors),before);assert.equal(a.A.state.rules.toban_profile,undefined);
});
test('cancelled included import preserves existing roster and state',async a=>{
 const r=incoming(a);r.doctors=[];const before=JSON.stringify(a.A.state),saved=storage(a);let asks=0;a.w.confirm=()=>{asks++;return false;};await importFile(a,r);assert.equal(asks,1);assert.equal(JSON.stringify(a.A.state),before);assert.deepEqual(storage(a),saved);
});
const EXPECTED_CASES=25;let passed=0,failed=0,finished=false;
process.on('exit',()=>{if(!finished||passed!==EXPECTED_CASES||failed){console.error(`Incomplete/failed included roster regression: finished=${finished} passed=${passed} failed=${failed} expected=${EXPECTED_CASES}`);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Included roster regression timed out');process.exit(1);},120000);
(async()=>{
 assert.equal(cases.length,EXPECTED_CASES);
 for(const {label,fn}of cases){let a;try{a=await makeApp();a.mode('build');await fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+label);}catch(e){failed++;console.error('FAIL '+label+'\n'+e.stack);}finally{a?.w.close();}}
 finished=true;clearTimeout(watchdog);console.log(`Included roster: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
