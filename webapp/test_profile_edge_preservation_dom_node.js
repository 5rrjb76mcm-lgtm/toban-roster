// Profile builder edge cases retain imported metadata and honor explicit clears.
// Production profile import/export, delegated DOM events and localStorage use fictional data.
// jsdom does not exercise native browser layouts or OS dialogs.
// Set TOBAN_DOM_MODULE to an installed jsdom 26.1.0 module when needed.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 14;
let passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || passed !== EXPECTED_CASES || failed !== 0) {
    console.error(`Incomplete or failed profile edge regression: finished=${finished}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile edge preservation DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-profile-edge-preservation', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic profile edge preservation' };
const key = 'toban_state_v2:/synthetic/profile-edge-preservation.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-edge-preservation.html', runScripts: 'outside-only' }), w = dom.window;
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

const pluginId = 'local.synthetic.profile_edge_preservation';
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

const tests = [
 ['role-fallback: accepted object roles allow unrelated label edit',async a=>{const R=clone(a.A.state.rules);R.profile.roles={};R.doctors.forEach(d=>d.team='I');R.profile.label='Synthetic fallback imported';await importFile(a,R);assert.deepEqual(clone(a.w.T.normalizeRolesOf(a.A.state.rules).map(r=>r.id)),['I','A','Y','C']);a.change('#setProfLabel','Synthetic label changed');assert.equal(a.A.state.rules.profile.label,'Synthetic label changed');}],
 ['role-fallback: accepted object roles allow role addition and included export',async a=>{const R=clone(a.A.state.rules);R.profile.roles={};R.doctors.forEach(d=>d.team='I');R.profile.label='Synthetic fallback addition';await importFile(a,R);a.click('[data-act="roleAdd"]');const out=await exportFile(a,true);assert.deepEqual(out.profile.roles.map(r=>r.id),['I','A','Y','C','R5']);}],
 ['role-match: padded ID retains metadata in included export and reload',async a=>{const R=clone(a.A.state.rules);R.profile.roles[0].id=' S ';R.profile.label='Synthetic padded role';await importFile(a,R);const out=await exportFile(a,true);assert.equal(out.profile.roles[0].id,'S');assert.deepEqual(out.profile.roles[0].local_role,{cap:23});const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepEqual(clone(b.A.state.rules.profile.roles[0].local_role),{cap:23});}finally{b.w.close();}}],
 ['role-match: numeric ID retains metadata in included export',async a=>{const R=clone(a.A.state.rules);R.profile.roles[0].id=7;R.doctors.forEach(d=>d.team='7');R.profile.label='Synthetic numeric role';await importFile(a,R);const out=await exportFile(a,true);assert.equal(out.profile.roles[0].id,'7');assert.deepEqual(out.profile.roles[0].local_role,{cap:23});}],
 ['role-match: normalized ID rename keeps original metadata',async a=>{const R=clone(a.A.state.rules);R.profile.roles[0].id=' S ';R.profile.label='Synthetic padded rename';await importFile(a,R);a.change('#roleTbl tr[data-ri="0"] [data-rid]','X');assert.equal(a.A.state.rules.profile.roles[0].id,'X');assert.deepEqual(clone(a.A.state.rules.profile.roles[0].local_role),{cap:23});assert(a.A.state.rules.doctors.every(d=>d.team==='X'));}],
 ['role-match: normalized role survives add/delete without leaking metadata to replacement',async a=>{const R=clone(a.A.state.rules);R.profile.roles[0].id=' S ';R.profile.label='Synthetic padded add';await importFile(a,R);a.click('[data-act="roleAdd"]');assert.deepEqual(clone(a.A.state.rules.profile.roles.map(r=>[r.id,r.local_role??null])),[['S',{cap:23}],['R2',null]]);a.click('#roleTbl tr[data-ri="1"] [data-act="roleDel"]');assert.deepEqual(clone(a.A.state.rules.profile.roles.map(r=>[r.id,r.local_role])),[['S',{cap:23}]]);}],
 ['closure: untouched blank display preserves empty-day raw row through export',async a=>{await importEmptyClosure(a);const before=clone(a.A.state.rules.profile.calendar);assert.equal(a.q('#setCalClosure').value,'');const out=await exportFile(a,true);assert.deepEqual(out.profile.calendar,before);const twice=await exportFile(a,true);assert.deepEqual(twice.profile.calendar,before);}],
 ['closure: type then erase with input events clears on next export',async a=>{await importEmptyClosure(a);const el=a.q('#setCalClosure');input(a,el,'11/6');input(a,el,'');el.dispatchEvent(new a.w.FocusEvent('focusout',{bubbles:true}));const out=await exportFile(a,true);assert.deepEqual(out.profile.calendar.closure,[]);assert.deepEqual(out.profile.calendar.local_calendar,{cap:12});}],
 ['closure: explicit same-empty change event clears stored row',async a=>{await importEmptyClosure(a);a.change('#setCalClosure','');assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),[]);}],
 ['closure: explicit clear survives settings reselect before included export',async a=>{await importEmptyClosure(a);const el=a.q('#setCalClosure');input(a,el,'11/6');input(a,el,'');el.dispatchEvent(new a.w.FocusEvent('focusout',{bubbles:true}));a.click('.tab[data-tab="settings"]');a.click('[data-setmode="build"]');const out=await exportFile(a,true);assert.deepEqual(out.profile.calendar.closure,[]);}],
 ['closure: explicit clear is saved on focusout before reload',async a=>{await importEmptyClosure(a);const el=a.q('#setCalClosure');input(a,el,'11/6');input(a,el,'');el.dispatchEvent(new a.w.FocusEvent('focusout',{bubbles:true}));const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepEqual(clone(b.A.state.rules.profile.calendar.closure),[]);}finally{b.w.close();}}],
 ['closure: whitespace edit clears and preserves calendar siblings',async a=>{await importEmptyClosure(a);a.change('#setCalClosure',' ');assert.deepEqual(clone(a.A.state.rules.profile.calendar),{holidays:'none',closure:[],local_calendar:{cap:12}});}],
 ['closure: successful input-only readback consumes edit before subsequent plugin data',async a=>{const el=a.q('#setCalClosure');input(a,el,'11/8');a.A.readSettings();assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),[{month:11,days:[8],local_note:'Synthetic row metadata'}]);a.A.state.rules.profile.calendar.closure.push({month:12,days:[],local_note:'Synthetic plugin added after commit'});const out=await exportFile(a,true);assert.deepEqual(out.profile.calendar.closure,[{month:11,days:[8],local_note:'Synthetic row metadata'},{month:12,days:[],local_note:'Synthetic plugin added after commit'}]);}],
 ['closure: rejected role edit does not consume or apply closure edit',async a=>{await importEmptyClosure(a);const before=clone(a.A.state.rules.profile.calendar);input(a,a.q('#setCalClosure'),'11/6');input(a,a.q('#setCalClosure'),'');a.q('#roleTbl tr[data-ri="0"] [data-rid]').value='';assert.equal(a.A.readSettings(),false);assert.deepEqual(clone(a.A.state.rules.profile.calendar),before);}]
];
function input(a,el,value){el.value=value;el.dispatchEvent(new a.w.Event('input',{bubbles:true}));}
async function importEmptyClosure(a){const R=clone(a.A.state.rules);R.profile.label='Synthetic empty closure import';R.profile.calendar.closure=[{month:11,days:[],local_note:'Synthetic empty row metadata'}];await importFile(a,R);assert.deepEqual(clone(a.A.state.rules.profile.calendar.closure),R.profile.calendar.closure);}
(async()=>{assert.equal(tests.length,EXPECTED_CASES);for(const [label,fn] of tests){const a=await makeApp();try{configure(a);await fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+label);}catch(e){failed++;console.error('FAIL '+label,e);}finally{a.w.close();}}assert.equal(passed+failed,EXPECTED_CASES);finished=true;console.log(`profile edge preservation: ${passed} passed, ${failed} failed, ${tests.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
