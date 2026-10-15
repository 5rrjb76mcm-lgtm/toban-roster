// Imported rest-day numeric settings survive unrelated edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_days_off_numeric_preservation_dom_node.js [/path/to/node_modules/highs]
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rest-day numeric DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic rest-day numeric roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/settings-builder-preservation.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  const initial=clone(fixture); w.T.fillDefaultRules(initial);
  for(const def of w.T.RULE_DEFS) if(def.states.includes('off') && fixture.rule_states?.[def.id] === undefined) initial.rule_states[def.id]='off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key,saved || JSON.stringify({rules:initial,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="build"]');};
  return {dom,w,A,q,click,change,tick,enter,errors};
}



const fields = [['min',' 12 ','#setOffMin',12],['hours_per_week','+35','#setHrWeek',12],['hours_per_day',' 10 ','#setHrDay',13]];
const P = a => new a.w.T.Problem(a.A.state.rules,a.A.state.month);
const schedule = a => Object.fromEntries(P(a).slots.map(s=>[s.join(':'),{work:s[0]<=19?N[0]:N[1],oc:[]} ]));
const semantics = a => {const p=P(a),pin=schedule(a);return {minimum:p.minDaysOff,violations:a.w.T.check(p,pin).VC.filter(v=>v.code==='DAYS_OFF_SHORT').length,penalty:a.w.T.penalty(p,pin).total};};
async function imported(a,r) {
 for(const def of a.w.T.RULE_DEFS)if(def.states.includes("off") && r.rule_states[def.id]===undefined)r.rule_states[def.id]="off";
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-rest.json',text:async()=>JSON.stringify(r)}]});
 input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();
 assert.strictEqual(a.A.state.rules.profile.id,r.profile.id,'actual file import finished');a.enter();
}
let completed=false,passed=0,failed=0;
process.on('exit',()=>{if(!completed){console.error('FAIL rest-day cases did not finish');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL rest-day timeout');process.exit(1);},120000);
(async()=>{
 const highs=process.argv[2]?await require(process.argv[2])():null;
 const cases=[];const test=(name,fn)=>cases.push([name,fn]);
 for(const lang of ['en','ja'])for(const state of ['hard','soft'])for(const [field,value,selector,minimum] of fields)test(`${lang} ${state} ${field}: import, unrelated edit, repeated read, reload, Undo and clear`,async()=>{
  const r=clone(rawRules);r.profile.id='synthetic-rest-import';r.profile.shifts[0].on='none';r.days_off={[field]:value};r.rule_states.days_off_min=state;
  let a=await makeApp();try{
   a.enter();await imported(a,r);a.w.T.setLang(lang);a.A.renderSettings();
   assert.strictEqual(a.q(selector).value,String(Number(value)),'valid imported number is visibly represented');
   const expected=semantics(a);assert.strictEqual(expected.minimum,minimum);assert.strictEqual(expected.violations,state==='hard'?1:0);if(state==='soft')assert(expected.penalty>0);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');await a.tick();
   assert.strictEqual(a.A.state.rules.days_off[field],value);assert.deepStrictEqual(semantics(a),expected);
   a.A.readSettings();a.A.readSettings();assert.strictEqual(a.A.state.rules.days_off[field],value);assert.deepStrictEqual(semantics(a),expected);
   if(highs){const result=a.w.T.solve(P(a),highs,{pin:schedule(a),timeLimit:10});assert.strictEqual(result.status,state==='hard'?'Infeasible':'Optimal');if(state==='soft')assert(Math.abs(result.objective-expected.penalty)<1e-6);}
   const saved=a.w.localStorage.getItem(key),b=await makeApp(saved,r,r);try{b.enter();assert.strictEqual(b.A.state.rules.days_off[field],value);assert.deepStrictEqual(semantics(b),expected);}finally{b.dom.window.close();}
   a.A.undo();assert.strictEqual(a.A.state.rules.days_off[field],value);assert.deepStrictEqual(semantics(a),expected);
   a.change(selector,'');await a.tick();if(field==='min')assert(!Object.hasOwn(a.A.state.rules.days_off,'min'));else assert.strictEqual(a.A.state.rules.days_off[field],field==='hours_per_week'?40:8);
   assert.strictEqual(P(a).minDaysOff,9,'deliberate clear keeps existing default semantics');
   a.A.undo();assert.strictEqual(a.A.state.rules.days_off[field],value);assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 for(const [field,,selector] of fields)for(const invalid of ['not-a-number',[], '\r\n', '\u0000'])test(`${field} ${JSON.stringify(invalid)}: untouched invalid value stays saved; explicit empty input/focusout clears`,async()=>{
  const r=clone(rawRules);r.profile.id='synthetic-rest-invalid';r.rule_states.days_off_min='hard';r.days_off={[field]:invalid};const a=await makeApp();try{
   a.enter();await imported(a,r);assert.strictEqual(a.q(selector).value,'');a.change('#doctorTable tr[data-i="0"] [data-f="years"]','13');a.change(field==='min'?'#setHrDay':'#setOffMin','7');a.A.readSettings();assert.deepStrictEqual(clone(a.A.state.rules.days_off[field]),invalid);
   const input=a.q(selector);input.value='';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));await a.tick();
   if(field==='min')assert(!Object.hasOwn(a.A.state.rules.days_off,'min'));else assert.strictEqual(a.A.state.rules.days_off[field],field==='hours_per_week'?40:8);
   a.A.undo();assert.deepStrictEqual(clone(a.A.state.rules.days_off[field]),invalid);assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 test('hidden rest controls retain values across off/on and holidays basis',async()=>{
  const r=clone(rawRules);r.days_off={min:' 12 ',hours_per_week:'+35',hours_per_day:' 10 '};r.rule_states.days_off_min='hard';const a=await makeApp(null,r,r);try{
   a.enter();a.change('[data-ron="days_off_min"]',false);assert(!a.q('#setOffMin'));a.change('#doctorTable tr[data-i="0"] [data-f="years"]','14');
   for(const [f,v] of Object.entries(r.days_off))assert.strictEqual(a.A.state.rules.days_off[f],v);
   a.change('[data-ron="days_off_min"]',true);a.change('#setOffBasis','holidays');assert(!a.q('#setOffMin'));a.change('#doctorTable tr[data-i="0"] [data-f="years"]','15');
   for(const [f,v] of Object.entries(r.days_off))assert.strictEqual(a.A.state.rules.days_off[f],v);a.change('#setOffBasis','hours');assert.strictEqual(P(a).minDaysOff,12);
   assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 for(const [name,fn]of cases){try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
 assert.strictEqual(passed+failed,25);completed=true;clearTimeout(watchdog);console.log(`rest numeric preservation: ${passed} passed, ${failed} failed`);if(!highs)console.log('SKIP solver (supply installed HiGHS path)');if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
