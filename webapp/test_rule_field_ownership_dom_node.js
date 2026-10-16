// Built-in rule editors own their visible fields, not plug-in-owned sibling fields.
// Accepted profile-file imports, real delegated edits, registered read(P, rules),
// Problem, local save/reload. Fictional fixtures; jsdom is not a browser/layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_rule_field_ownership_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 19;
let passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error("Rule ownership regression timed out"); process.exit(1); }, 120000);
process.on('exit', () => {
  if (!finished || passed !== EXPECTED_CASES || failed !== 0) {
    console.error(`Incomplete or failed rule ownership regression: finished=${finished}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rule field ownership DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
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
const key = 'toban_state_v2:/synthetic/rule-ownership.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/rule-ownership.html', runScripts: 'outside-only' }), w = dom.window;
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


const pluginId='local.synthetic.rule_ownership';
function register(a) { a.w.T.rules.register({id:pluginId,api:1,label:'Synthetic extension',states:['hard','off'],def:'hard',read(P,R){return clone({pair:R.pair_cap?.local_extra,sequence:R.forbid_sequence == null ? undefined : [].concat(R.forbid_sequence).map(x=>x.local_extra),composition:R.composition?.map(x=>x.local_extra)});}}); }
async function fixture(a, extra={}) {
 register(a); a.mode('build'); const R=clone(a.A.state.rules);
 Object.assign(R,{pair_cap:{shift:'night',max:2,local_extra:{label:'夜勤\r\nÉquipe\u0000\t',flags:[false,0]}},forbid_sequence:[{from:'night',to:'any',local_extra:{id:'one'}},{from:'day',to:'night',local_extra:{id:'two'}}],composition:[{shift:'night',min:1,qual:'Trainer',local_extra:{id:'first'}},{shift:'day',min:1,local_extra:{id:'second'}}]});
 Object.assign(R.rule_states,{pair_cap:'soft',shift_sequence:'hard',composition:'hard',[pluginId]:'hard'});Object.assign(R,extra); R.profile.label='Synthetic imported';
 const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic.json',text:async()=>JSON.stringify(R)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));
 await until(()=>a.alerts.length || a.A.switching===0 && a.A.state.rules.profile.label==='Synthetic imported','accepted profile import');assert.deepEqual(a.alerts,[]);assert.equal(a.A.state.rules.profile.label,'Synthetic imported');return R;
}
const semantics=a=>clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).prm[pluginId]);
async function reload(a,fn) { const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved);try{register(b);await fn(b);assert.deepEqual(b.errors,[]);}finally{b.w.close();} }
const cases=[],test=(name,fn)=>cases.push({name,fn});
for(const family of ['pair','sequence','composition'])test(family+' extension survives accepted import, unrelated edit, save/reload',async a=>{await fixture(a);const before=semantics(a)[family];assert(before);a.change('#setProfLabel','Synthetic renamed');a.A.readSettings();a.A.readSettings();assert.deepEqual(semantics(a)[family],before);await reload(a,b=>assert.deepEqual(semantics(b)[family],before));});
for(const [id,key] of [['pair_cap','pair_cap'],['shift_sequence','forbid_sequence'],['composition','composition']])test(id+' disabled form preserves imported configuration',async a=>{const states={...clone(a.A.state.rules.rule_states),pair_cap:'off',shift_sequence:'off',composition:'off',[pluginId]:'hard'};await fixture(a,{rule_states:states});const before=clone(a.A.state.rules[key]);a.change('#setProfLabel','Synthetic disabled edit');assert.deepEqual(clone(a.A.state.rules[key]),before);await reload(a,b=>assert.deepEqual(clone(b.A.state.rules[key]),before));});
test('pair genuine select edit retains extension',async a=>{await fixture(a);const before=semantics(a).pair;a.mode('daily');a.change('#setPairShift','day');assert.equal(a.A.state.rules.pair_cap.shift,'day');assert.deepEqual(semantics(a).pair,before);});
test('sequence genuine select edit retains matching row extension',async a=>{await fixture(a);const before=semantics(a).sequence;a.mode('daily');a.change('[data-si="1"] [data-sto]','any');assert.equal(a.A.state.rules.forbid_sequence[1].to,'any');assert.deepEqual(semantics(a).sequence,before);});
test('sequence deletion and addition never inherit removed row metadata',async a=>{await fixture(a);a.mode('daily');a.click('[data-si="0"] [data-act="seqDel"]');assert.deepEqual(semantics(a).sequence,[{id:'two'}]);a.click('[data-act="seqAdd"]');assert.deepEqual(semantics(a).sequence,[{id:'two'},null]);});
test('composition genuine text clear preserves sibling metadata',async a=>{await fixture(a);a.mode('daily');a.change('[data-ci="0"] [data-cqual]','');assert.equal(a.A.state.rules.composition[0].qual,undefined);assert.deepEqual(semantics(a).composition,[{id:'first'},{id:'second'}]);await reload(a,b=>assert.equal(b.A.state.rules.composition[0].qual,undefined));});
test('composition deletion and addition never inherit removed row metadata',async a=>{await fixture(a);a.mode('daily');a.click('[data-ci="0"] [data-act="compDel"]');assert.deepEqual(semantics(a).composition,[{id:'second'}]);a.click('[data-act="compAdd"]');assert.deepEqual(semantics(a).composition,[{id:'second'},null]);});
test('absent extension fields stay absent',async a=>{await fixture(a,{pair_cap:{shift:'night',max:2},forbid_sequence:[{from:'night',to:'any'}],composition:[{shift:'day',min:1}]});a.change('#setProfLabel','Synthetic no extensions');const R=a.A.state.rules;assert(!Object.hasOwn(R.pair_cap,'local_extra'));assert(!Object.hasOwn(R.forbid_sequence[0],'local_extra'));assert(!Object.hasOwn(R.composition[0],'local_extra'));});
test('single-object sequence shorthand retains its extension',async a=>{await fixture(a,{forbid_sequence:{from:'night',to:'any',local_extra:{id:'single'}}});a.change('#setProfLabel','Synthetic shorthand');assert.deepEqual(semantics(a).sequence,[{id:'single'}]);await reload(a,b=>assert.deepEqual(semantics(b).sequence,[{id:'single'}]));});
test('null and absent configuration use defaults without invented metadata',async a=>{await fixture(a,{pair_cap:null,forbid_sequence:null,composition:[]});a.change('#setProfLabel','Synthetic defaults');assert(!Object.hasOwn(a.A.state.rules.pair_cap,'local_extra'));assert(!Object.hasOwn(a.A.state.rules.forbid_sequence[0],'local_extra'));assert.deepEqual(clone(a.A.state.rules.composition),[]);});
for(const [id,family] of [['pair_cap','pair'],['shift_sequence','sequence'],['composition','composition']])test(id+' off then on retains imported extension',async a=>{await fixture(a);const before=semantics(a)[family];const toggle=value=>{const el=a.q(`[data-ron="${id}"]`);assert(el);el.checked=value;el.dispatchEvent(new a.w.Event('change',{bubbles:true}));};toggle(false);assert.equal(a.A.state.rules.rule_states[id],'off');a.change('#setProfLabel','Synthetic temporary off');toggle(true);a.change('#setProfLabel','Synthetic on');assert.deepEqual(semantics(a)[family],before);await reload(a,b=>assert.deepEqual(semantics(b)[family],before));});
test('duplicate sequence descriptors retain distinct row metadata across deletion',async a=>{await fixture(a,{forbid_sequence:[{from:'night',to:'any',local_extra:{id:'first'}},{from:'night',to:'any',local_extra:{id:'second'}}]});a.mode('daily');a.click('[data-si="0"] [data-act="seqDel"]');assert.deepEqual(semantics(a).sequence,[{id:'second'}]);});
test('duplicate composition descriptors retain distinct row metadata across deletion',async a=>{await fixture(a,{composition:[{shift:'night',min:1,local_extra:{id:'first'}},{shift:'night',min:1,local_extra:{id:'second'}}]});a.mode('daily');a.click('[data-ci="0"] [data-act="compDel"]');assert.deepEqual(semantics(a).composition,[{id:'second'}]);});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const c of cases){const a=await makeApp();try{await c.fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{a.w.close();}}console.log(`rule field ownership: ${passed} passed, ${failed} failed, ${cases.length} total`);assert.equal(passed+failed,EXPECTED_CASES);finished=true;clearTimeout(watchdog);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
