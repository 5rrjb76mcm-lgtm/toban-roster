// Profile builder readback must preserve plug-in-owned nested configuration.
// Real profile-file import, markup, delegated events, Problem, export, save/reload,
// and the registered plug-in read contract. Fictional data only; jsdom is not a browser/layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_nested_config_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 17;
let passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || passed !== EXPECTED_CASES || failed !== 0) {
    console.error(`Incomplete or failed profile regression: finished=${finished}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Nested profile configuration DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-staffing-shorthand', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic staffing preservation' };
const key = 'toban_state_v2:/synthetic/profile-extension.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-extension.html', runScripts: 'outside-only' }), w = dom.window;
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

const pluginId = 'local.synthetic.profile_extension';
function owned(R) { return clone({ calendar: R.profile.calendar, roles: R.profile.roles.map(r => [r.id, r.local_role]), shifts: R.profile.shifts.map(s => [s.id, s.local_shift]) }); }
function configure(a) {
 const {A,w}=a, R=A.state.rules;
 w.T.rules.register({ id:pluginId, label:'Synthetic extension', states:['hard','off'], def:'hard',
   read(P,rules) { return { cap: rules.profile.calendar?.local_calendar?.cap ?? 0,
     role: rules.profile.roles?.find(r=>r.id==='S')?.local_role?.cap ?? 0,
     shift: rules.profile.shifts?.find(s=>s.id==='day')?.local_shift?.cap ?? 0 }; } });
 R.rule_states[pluginId]='hard';
 R.profile.calendar={holidays:'none',closure:[{month:11,days:[6],local_note:'Synthetic row metadata'}],local_calendar:{cap:12}};
 R.profile.roles[0].local_role={cap:23};
 R.profile.shifts[0].local_shift={cap:34};
 a.mode('build'); A.renderSettings();
}
const semantics=a=>clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).prm[pluginId]);
async function exportFile(a, roster) {
 const downloads=[]; let pending=0;
 a.A.download=(name,blob)=>{pending++; const reader=new a.w.FileReader(); reader.onload=()=>{downloads.push({name,rules:JSON.parse(reader.result)});pending--;}; reader.onerror=()=>{pending--;a.errors.push('FileReader failed');};reader.readAsText(blob);};
 a.q('#setExportRoster').checked=roster; a.click('#btnExportProfile');
 await until(()=>downloads.length===1 && pending===0 || a.alerts.length,'export completion');
 assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);assert.equal(downloads.length,1);return downloads[0].rules;
}
async function importFile(a,R) {
 const el=a.q('#fileLoadProfile'), expected=R.profile.label;
 Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic-profile.json',text:async()=>JSON.stringify(R)}]});
 el.dispatchEvent(new a.w.Event('change',{bubbles:true}));
 await until(()=>a.alerts.length || a.A.switching===0 && a.A.state.rules.profile.label===expected,'import completion');
 assert.deepEqual(a.alerts,[]);assert.equal(a.A.state.rules.profile.label,expected);
}
const cases=[],test=(name,fn)=>cases.push({name,fn});
test('included export preserves plug-in semantics and live nested values',async a=>{const before=owned(a.A.state.rules), sem=semantics(a), R=await exportFile(a,true);assert.deepEqual(owned(R),before);assert.deepEqual(owned(a.A.state.rules),before);assert.deepEqual(semantics(a),sem);assert.deepEqual(sem,{cap:12,role:23,shift:34});});
test('included file roundtrip preserves nested plug-in configuration',async a=>{const before=owned(a.A.state.rules), R=await exportFile(a,true);R.profile.label='Synthetic roundtrip';await importFile(a,R);assert.deepEqual(owned(a.A.state.rules),before);assert.deepEqual(semantics(a),{cap:12,role:23,shift:34});});
test('save and reload retains nested configuration',async a=>{const before=owned(a.A.state.rules);await exportFile(a,true);const saved=a.w.localStorage.getItem(key),b=await makeApp(saved);try{assert.deepEqual(owned(b.A.state.rules),before);}finally{b.w.close();}});
test('unrelated label edit retains nested configuration',async a=>{const before=owned(a.A.state.rules);a.change('#setProfLabel','Synthetic renamed');assert.deepEqual(owned(a.A.state.rules),before);});
test('role rename keeps metadata with the original role',async a=>{a.change('#roleTbl tr[data-ri="0"] [data-rid]','X');assert.equal(a.A.state.rules.profile.roles[0].id,'X');assert.deepEqual(clone(a.A.state.rules.profile.roles[0].local_role),{cap:23});assert(a.A.state.rules.doctors.every(d=>d.team==='X'));});
test('role identifier swap carries metadata with its original role',async a=>{const R=a.A.state.rules;R.profile.roles.push({id:'X',label:'Other',refs:[],local_role:{cap:99}});a.A.renderSettings();a.q('#roleTbl tr[data-ri="0"] [data-rid]').value='X';a.q('#roleTbl tr[data-ri="1"] [data-rid]').value='S';a.A.readSettings();assert.deepEqual(clone(R.profile.roles.map(r=>[r.id,r.local_role.cap])),[['X',23],['S',99]]);});
test('adding a role preserves surviving metadata without copying it to the new role',async a=>{a.click('[data-act="roleAdd"]');assert.deepEqual(clone(a.A.state.rules.profile.roles.map(r=>[r.id,r.local_role??null])),[['S',{cap:23}],['R2',null]]);});
test('deleting and replacing a role keeps survivors without transferring deleted metadata',async a=>{a.A.state.rules.profile.roles.push({id:'R2',label:'Other',refs:[],local_role:{cap:99}});a.A.renderSettings();a.click('#roleTbl tr[data-ri="1"] [data-act="roleDel"]');assert.deepEqual(clone(a.A.state.rules.profile.roles.map(r=>[r.id,r.local_role])),[['S',{cap:23}]]);a.click('[data-act="roleAdd"]');assert.deepEqual(clone(a.A.state.rules.profile.roles.map(r=>[r.id,r.local_role??null])),[['S',{cap:23}],['R2',null]]);});
test('cancelled used-role deletion retains metadata and roster identities',async a=>{a.A.state.rules.profile.roles.push({id:'X',label:'Other',refs:[],local_role:{cap:99}});a.A.renderSettings();const before=owned(a.A.state.rules);let asked=0;a.w.confirm=()=>{asked++;return false;};a.click('#roleTbl tr[data-ri="0"] [data-act="roleDel"]');assert.equal(asked,1);assert.deepEqual(owned(a.A.state.rules),before);assert(a.A.state.rules.doctors.every(d=>d.team==='S'));});
test('shift edit retains the matching shift metadata',async a=>{a.change('#shiftTbl tr[data-shift="day"] [data-son]','weekdays');assert.equal(a.A.state.rules.profile.shifts.find(s=>s.id==='day').on,'weekdays');assert.deepEqual(clone(a.A.state.rules.profile.shifts.find(s=>s.id==='day').local_shift),{cap:34});assert.equal(a.A.state.rules.profile.shifts.find(s=>s.id==='night').local_shift,undefined);});
test('holiday source edit preserves closure records and calendar extension',async a=>{const before=clone(a.A.state.rules.profile.calendar);a.change('#setCalHol','jp');assert.deepEqual(clone(a.A.state.rules.profile.calendar),{...before,holidays:'jp'});});
test('explicit closure replacement does not restore removed rows',async a=>{a.change('#setCalClosure','12/7');assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),[{month:12,days:[7]}]);assert.deepEqual(clone(a.A.state.rules.profile.calendar.local_calendar),{cap:12});});
test('same-month closure edit keeps matching row metadata',async a=>{a.change('#setCalClosure','11/8');assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),[{month:11,days:[8],local_note:'Synthetic row metadata'}]);});
test('explicit closure clearing remains empty',async a=>{a.change('#setCalClosure','');assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),[]);assert.deepEqual(clone(a.A.state.rules.profile.calendar.local_calendar),{cap:12});});
test('shared export anonymizes preserved opaque names',async a=>{const R=a.A.state.rules,name=R.doctors[0].name;R.profile.calendar.local_calendar.by_name={[name]:{private_note:'Synthetic secret'}};R.profile.roles[0].local_role.member=name;a.A.renderSettings();const before=owned(R),out=await exportFile(a,false);assert.deepEqual(out.profile.calendar.local_calendar.by_name,{});assert(!JSON.stringify(out).includes(name));assert.deepEqual(owned(a.A.state.rules),before);});
test('shared export refuses ambiguous preserved opaque names',async a=>{const R=a.A.state.rules;R.doctors[0].name='night';R.profile.shifts[0].local_shift.night={cap:7};a.A.renderSettings();const before=owned(R);let downloads=0;a.A.download=()=>downloads++;a.q('#setExportRoster').checked=false;a.click('#btnExportProfile');await until(()=>a.alerts.length,'shared refusal');assert.equal(downloads,0);assert.deepEqual(owned(a.A.state.rules),before);a.alerts.length=0;});
test('cancelled shared warning keeps opaque data and does not download',async a=>{const R=a.A.state.rules;R.profile.calendar.local_calendar.note='Synthetic One note';a.A.renderSettings();const before=owned(R);let asked=0,downloads=0;a.w.confirm=()=>{asked++;return false;};a.A.download=()=>downloads++;a.q('#setExportRoster').checked=false;a.click('#btnExportProfile');await until(()=>asked===1,'warning cancellation');assert.equal(downloads,0);assert.deepEqual(owned(a.A.state.rules),before);});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const c of cases){const a=await makeApp();try{configure(a);await c.fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{a.w.close();}}console.log(`profile nested configuration: ${passed} passed, ${failed} failed, ${cases.length} total`);assert.equal(passed+failed,EXPECTED_CASES);finished=true;if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
