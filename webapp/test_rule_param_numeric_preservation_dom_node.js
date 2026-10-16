// Declared rule numeric parameters survive unrelated edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_rule_param_numeric_preservation_dom_node.js /path/to/node_modules/highs
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rule-parameter numeric DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic rule-parameter numeric roundtrip'};
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



async function imported(a,r) {
 for(const def of a.w.T.RULE_DEFS)if(def.states.includes("off") && r.rule_states[def.id]===undefined)r.rule_states[def.id]="off";
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-rule-params.json',text:async()=>JSON.stringify(r)}]});
 input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();
 assert.strictEqual(a.A.state.rules.profile.id,r.profile.id,'actual file import finished');a.enter();
}

const fields = [
 ['same_weekday_cap','max_same_weekday_shifts',' 2 '],
 ['quota_range','quota_tolerance','+3'],
 ['dayoff_weekday_cap','dayoff_weekday_max',' 3 '],
 ['weekend_balance','weekend_balance_max_diff','+2']
];
let completed=false,passed=0,failed=0;
process.on('exit',()=>{if(!completed){console.error('FAIL rule-param cases did not finish');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL rule-param timeout');process.exit(1);},300000);
(async()=>{
 const highs=process.argv[2]?await require(process.argv[2])():null;
 const cases=[];const test=(name,fn)=>cases.push([name,fn]);
 for(const lang of ['en','ja'])for(const state of ['hard','soft'])for(const [id,field,value] of fields.filter(([id])=>state!=='soft'||id!=='quota_range'))test(`${lang} ${state} ${field}: actual import, unrelated edit, repeated read, reload, clear`,async()=>{
  const r=clone(rawRules);r.profile.id='synthetic-param-import';r[field]=value;r.rule_states[id]=state;
  const a=await makeApp();try{
   a.enter();await imported(a,r);a.w.T.setLang(lang);a.A.renderSettings();
   const selector=`[data-prm="${field}"]`;assert(a.q(selector),'rendered parameter');
   const semantic=()=>clone(a.w.T.RULE_BY_ID[id].read(new a.w.T.Problem(a.A.state.rules,a.A.state.month),a.A.state.rules));
   const expected=semantic();
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');await a.tick();
   assert.strictEqual(a.A.state.rules[field],value);assert.deepStrictEqual(semantic(),expected);
   assert.strictEqual(a.q(selector).value,String(Number(value)),'accepted JSON numeric spelling is visible');
   a.A.readSettings();a.A.readSettings();assert.strictEqual(a.A.state.rules[field],value);
   const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{b.enter();assert.strictEqual(b.A.state.rules[field],value);}finally{b.dom.window.close();}
   a.change(`[data-ron="${id}"]`,false);assert(!a.q(selector));a.change('#doctorTable tr[data-i="0"] [data-f="years"]','13');assert.strictEqual(a.A.state.rules[field],value);
   a.change(`[data-ron="${id}"]`,true);a.change(selector,'');assert.strictEqual(a.A.state.rules[field],null,'explicit blank keeps prior null/default contract');
   a.change(selector,'5');assert.strictEqual(a.A.state.rules[field],5);a.A.readSettings();assert.strictEqual(a.A.state.rules[field],5);
   assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 for(const state of ['hard','soft'])test(`${state} same-weekday cap retains checker, penalty and pinned solver result`,async()=>{
  const r=clone(rawRules);r.max_same_weekday_shifts=' 2 ';r.rule_states.same_weekday_cap=state;r.weights.same_weekday_excess=7;
  const a=await makeApp(null,r,r);try{a.enter();
   const p=()=>new a.w.T.Problem(a.A.state.rules,a.A.state.month),pin=Object.fromEntries(p().slots.map(s=>[s.join(':'),{work:s[0]<=15?N[0]:N[1],oc:[]}]));
   const sem=()=>({violations:a.w.T.check(p(),pin).VC.filter(v=>v.code==='SAME_WEEKDAY_OVER').length,penalty:a.w.T.penalty(p(),pin).total});
   const expected=sem();if(state==='hard')assert(expected.violations>0);else assert(expected.penalty>0);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(sem(),expected);
   if(highs){const result=a.w.T.solve(p(),highs,{pin,timeLimit:10});assert.strictEqual(result.status,state==='hard'?'Infeasible':'Optimal');if(state==='soft')assert(Math.abs(result.objective-expected.penalty)<1e-6);}
   assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });

 for(const value of [undefined,null,false,0,0.5,'not-a-number','',[], '\r\n', '\u0000'])test(`all declared params preserve ${JSON.stringify(value)} until explicit input`,async()=>{
  const r=clone(rawRules);r.profile.id='synthetic-param-edge';for(const [id,key]of fields){r.rule_states[id]=id==='quota_range'?'hard':'soft';if(value!==undefined)r[key]=value;}
  const a=await makeApp();try{a.enter();await imported(a,r);
   const snapshot=()=>Object.fromEntries(fields.map(([,k])=>[k,{present:Object.hasOwn(a.A.state.rules,k),value:a.A.state.rules[k]}]));const before=snapshot();
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','14');a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(snapshot(),before);
   a.A.undo();assert.deepStrictEqual(snapshot(),before);
   for(const [id,key]of fields){let x=a.q(`[data-prm="${key}"]`);assert(x);x.value='';x.dispatchEvent(new a.w.Event('input',{bubbles:true}));x.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert.strictEqual(a.A.state.rules[key],null,'explicit same-visible blank applies null');assert.strictEqual(a.q(`[data-prm="${key}"]`),x,'focusout keeps DOM');assert.strictEqual(x.dataset.numericEdited,undefined);a.A.readSettings();assert.strictEqual(a.A.state.rules[key],null);
    x.value='4';x.dispatchEvent(new a.w.Event('input',{bubbles:true}));x.dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.strictEqual(a.A.state.rules[key],4);a.A.readSettings();assert.strictEqual(a.A.state.rules[key],4);
   }
   assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 for(const [name,fn]of cases){try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
 assert.strictEqual(passed+failed,26);completed=true;clearTimeout(watchdog);console.log(`rule params numeric preservation: ${passed} passed, ${failed} failed`);if(!highs)console.log('SKIP solver (supply installed HiGHS path)');if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
