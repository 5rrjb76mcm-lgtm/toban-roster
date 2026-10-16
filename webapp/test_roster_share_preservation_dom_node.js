// Imported roster share settings survive unrelated edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_roster_share_preservation_dom_node.js [/path/to/node_modules/highs]
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Roster share DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic roster share roundtrip'};
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

const selector = '#doctorTable tr[data-i="0"] [data-f="share"]';
const P = a => new a.w.T.Problem(a.A.state.rules,a.A.state.month);
const pin = a => Object.fromEntries(P(a).slots.map(s=>[s.join(':'),{work:N[0],oc:[]}]));
const semantics = a => { const p=P(a);return {quotas:N.map(n=>p.quota(n)),targets:clone(p.targets),penalty:a.w.T.penalty(p,pin(a)).total};};
const fixture = value => {const r=clone(rawRules);r.profile.id='synthetic-share-import';r.profile.quota_mode='share';r.rule_states.quota_target='soft';r.doctors[0].share=value;r.doctors[1].share=1;return r;};
async function imported(a,r) {
 for(const def of a.w.T.RULE_DEFS)if(def.states.includes("off") && r.rule_states[def.id]===undefined)r.rule_states[def.id]="off";
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-share.json',text:async()=>JSON.stringify(r)}]});
 input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();
 assert.strictEqual(a.A.state.rules.profile.id,r.profile.id,'actual file import finished');a.enter();
}
let completed=false,passed=0,failed=0;
process.on('exit',()=>{if(!completed){console.error('FAIL roster share cases did not finish');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL roster share timeout');process.exit(1);},240000);
(async()=>{
 const highs=process.argv[2]?await require(process.argv[2])():null;
 const cases=[];const test=(name,fn)=>cases.push([name,fn]);
 for(const lang of ['en','ja'])for(const value of ['+1',' 1 ','0.5',' 0 ',0,0.5])test(`${lang} ${JSON.stringify(value)}: import, unrelated edit, repeated read, reload and intentional edits`,async()=>{
  const r=fixture(value);const a=await makeApp();try{
   a.enter();await imported(a,r);a.w.T.setLang(lang);a.A.renderSettings();
   assert.strictEqual(a.q(selector).value,String(Number(value)),'valid stored share is visibly represented');
   const expected=semantics(a);assert.deepStrictEqual(expected.quotas,Number(value)===1?[30,30]:Number(value)===0?[0,60]:[20,40]);
   a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12');await a.tick();
   assert.strictEqual(a.A.state.rules.doctors[0].share,value);assert.deepStrictEqual(semantics(a),expected);
   a.A.readSettings();a.A.readSettings();assert.strictEqual(a.A.state.rules.doctors[0].share,value);assert.deepStrictEqual(semantics(a),expected);
   if(highs){const result=a.w.T.solve(P(a),highs,{pin:pin(a),timeLimit:10});assert.strictEqual(result.status,'Optimal');assert(Math.abs(result.objective-expected.penalty)<1e-6);}
   const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{b.enter();assert.strictEqual(b.A.state.rules.doctors[0].share,value);assert.deepStrictEqual(semantics(b),expected);}finally{b.w.close();}
   a.change(selector,'2');assert.strictEqual(a.A.state.rules.doctors[0].share,2);assert.deepStrictEqual(semantics(a).quotas,[40,20]);
   a.change(selector,'');assert.strictEqual(a.A.state.rules.doctors[0].share,0);assert.deepStrictEqual(semantics(a).quotas,[0,60]);
   a.change(selector,'-2');assert.strictEqual(a.A.state.rules.doctors[0].share,0,'existing nonnegative clamp');assert.deepStrictEqual(a.errors,[]);
  }finally{a.w.close();}
 });
 for(const value of ['not-a-number',[], '\r\n', '\u0000'])test(`${JSON.stringify(value)}: untouched invalid share survives, explicit blank focusout commits`,async()=>{
  const r=fixture(value),a=await makeApp();try{a.enter();await imported(a,r);assert.strictEqual(a.q(selector).value,'');
   a.change('#doctorTable tr[data-i="1"] [data-f="years"]','13');a.A.readSettings();assert.deepStrictEqual(clone(a.A.state.rules.doctors[0].share),value);
   const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{b.enter();assert.deepStrictEqual(clone(b.A.state.rules.doctors[0].share),value);}finally{b.w.close();}
   const input=a.q(selector);input.value='';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));await a.tick();
   assert.strictEqual(a.A.state.rules.doctors[0].share,0);assert.deepStrictEqual(a.errors,[]);
  }finally{a.w.close();}
 });
 test('absent share remains absent across roundtrip with effective default 1',async()=>{
  const r=fixture(undefined),a=await makeApp(null,r,r);try{a.enter();assert.strictEqual(a.q(selector).value,'1');a.change('[data-f="years"]','12');a.A.readSettings();assert(!Object.hasOwn(a.A.state.rules.doctors[0],'share'));assert.deepStrictEqual(semantics(a).quotas,[30,30]);assert.deepStrictEqual(a.errors,[]);}finally{a.w.close();}
 });
 test('hidden share survives absolute mode and rule off/on',async()=>{
  const r=fixture('+1'),a=await makeApp(null,r,r);try{a.enter();a.change('#setQuotaMode','absolute');assert(!a.q(selector));a.change('[data-f="years"]','12');assert.strictEqual(a.A.state.rules.doctors[0].share,'+1');a.change('#setQuotaMode','share');a.change('[data-ron="quota_target"]',false);assert(!a.q(selector));a.change('[data-f="years"]','13');assert.strictEqual(a.A.state.rules.doctors[0].share,'+1');a.change('[data-ron="quota_target"]',true);assert.deepStrictEqual(semantics(a).quotas,[30,30]);assert.deepStrictEqual(a.errors,[]);}finally{a.w.close();}
 });
 test('ordinary input and focusout commits once and keeps live DOM',async()=>{
  const r=fixture(1),a=await makeApp(null,r,r);try{a.enter();const input=a.q(selector);input.value='0.5';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert.strictEqual(a.A.state.rules.doctors[0].share,0.5);assert.strictEqual(a.q(selector),input);a.A.readSettings();assert.deepStrictEqual(semantics(a).quotas,[20,40]);assert.deepStrictEqual(a.errors,[]);}finally{a.w.close();}
 });

 const numericFields=['years','shift_max_day','shift_max_night'];
 const numericFixture=(field,value,state='hard')=>{const r=clone(rawRules);r.profile.id='synthetic-share-import';r.doctors[0][field]=value;
  if(field==='years'){r.composition=[{shift:'day',years_min:3,min:1}];r.rule_states.composition=state;}
  else {r.shift_counts={[field.endsWith('day')?'day':'night']:{max:30}};r.rule_states.shift_count_range=state;}
  return r;};
 const numericSemantics=a=>{const p=P(a);return {matches:clone(p.comp.map(c=>p.compMatch(c,N[0]))),violations:clone(a.w.T.check(p,pin(a)).VC),penalty:a.w.T.penalty(p,pin(a)).total};};
 for(const lang of ['en','ja'])for(const field of numericFields)for(const state of ['hard','soft'])test(`${lang} ${state} ${field}: import preserves actual rule impact and intentional clear`,async()=>{
  const value=field==='years'?'+5':' 1 ',r=numericFixture(field,value,state),a=await makeApp();const sel=`#doctorTable tr[data-i="0"] [data-f="${field}"]`;
  try{a.enter();await imported(a,r);a.w.T.setLang(lang);a.A.renderSettings();assert.strictEqual(a.q(sel).value,String(Number(value)));const expected=numericSemantics(a);
   if(field==='years')assert.deepStrictEqual(expected.matches,[true]);else if(state==='hard')assert(expected.violations.some(v=>v.code==='SHIFT_COUNT_OVER'));else assert(expected.penalty>0);
   a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12');a.A.readSettings();a.A.readSettings();assert.strictEqual(a.A.state.rules.doctors[0][field],value);assert.deepStrictEqual(numericSemantics(a),expected);
   const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{b.enter();assert.strictEqual(b.A.state.rules.doctors[0][field],value);assert.deepStrictEqual(numericSemantics(b),expected);}finally{b.w.close();}
   if(highs){const result=a.w.T.solve(P(a),highs,{pin:pin(a),timeLimit:10});assert.strictEqual(result.status,field!=='years'&&state==='hard'?'Infeasible':'Optimal');if(result.status==='Optimal')assert(Math.abs(result.objective-expected.penalty)<1e-6);}
   a.change(sel,'2');assert.strictEqual(a.A.state.rules.doctors[0][field],2);a.change(sel,'');
   if(field==='years'){assert.strictEqual(a.A.state.rules.doctors[0][field],0);assert.deepStrictEqual(numericSemantics(a).matches,[false]);}
   else {assert(!Object.hasOwn(a.A.state.rules.doctors[0],field));assert(!numericSemantics(a).violations.some(v=>v.code==='SHIFT_COUNT_OVER'));}
   assert.deepStrictEqual(a.errors,[]);
  }finally{a.w.close();}
 });
 for(const field of numericFields)for(const value of ['not-a-number',[], '\r\n', '\u0000'])test(`${field} ${JSON.stringify(value)}: unchanged invalid value survives and empty input/focusout clears`,async()=>{
  const r=numericFixture(field,value),a=await makeApp();try{a.enter();await imported(a,r);const sel=`#doctorTable tr[data-i="0"] [data-f="${field}"]`;assert.strictEqual(a.q(sel).value,'');
   a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12');a.A.readSettings();assert.deepStrictEqual(clone(a.A.state.rules.doctors[0][field]),value);
   const input=a.q(sel);input.value='';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));
   if(field==='years')assert.strictEqual(a.A.state.rules.doctors[0][field],0);else assert(!Object.hasOwn(a.A.state.rules.doctors[0],field));assert.deepStrictEqual(a.errors,[]);
  }finally{a.w.close();}
 });
 for(const field of numericFields)test(`${field}: absent stays absent on unrelated edits`,async()=>{
  const r=numericFixture(field,undefined),a=await makeApp(null,r,r);try{a.enter();a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12');a.A.readSettings();assert(!Object.hasOwn(a.A.state.rules.doctors[0],field));assert.deepStrictEqual(a.errors,[]);}finally{a.w.close();}
 });
 for(const field of numericFields.slice(1))test(`${field}: hidden cap survives rule off/on`,async()=>{
  const r=numericFixture(field,' 1 '),a=await makeApp(null,r,r);try{a.enter();const expected=numericSemantics(a);a.change('[data-ron="shift_count_range"]',false);assert(!a.q(`[data-f="${field}"]`));a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12');assert.strictEqual(a.A.state.rules.doctors[0][field],' 1 ');a.change('[data-ron="shift_count_range"]',true);assert.deepStrictEqual(numericSemantics(a),expected);assert.deepStrictEqual(a.errors,[]);}finally{a.w.close();}
 });
 for(const [name,fn]of cases){try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
 assert.strictEqual(passed+failed,48);completed=true;clearTimeout(watchdog);console.log(`roster share preservation: ${passed} passed, ${failed} failed`);if(!highs)console.log('SKIP solver (supply installed HiGHS path)');if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
