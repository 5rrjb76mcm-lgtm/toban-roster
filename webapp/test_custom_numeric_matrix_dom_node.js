// Custom rule numeric matrix and row values survive unrelated edits.
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
const storageKey = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
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
  w.localStorage.setItem(storageKey,saved || JSON.stringify({rules:initial,month:rawMonth,result:null,ui:{doctor:1}}));
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

const specs=[
 ['shift_count_range','shift_counts',{night:{min:' 3 ',max:'+5',plugin:{keep:1}}},'[data-scr="night:min"]',r=>r.shift_counts.night.min,r=>!('min' in r.shift_counts.night)],
 ['shift_run_max','shift_run_max',{day:' 3 ',hidden:'+7'},'[data-srm="day"]',r=>r.shift_run_max.day,r=>!('day' in r.shift_run_max)],
 ['friday_night_min','friday_night_min',{[N[0]]:'+2'},'#doctorTable tr[data-i="0"] [data-f="fri"]',r=>r.friday_night_min[N[0]],r=>!(N[0] in r.friday_night_min)],
 ['composition','composition',[{shift:'night',years_min:' 2 ',years_max:'+5',min:' 1 ',max:'+2',plugin:{keep:1}}],'[data-cmin]',r=>r.composition[0].min,r=>!('min' in r.composition[0])],
 ['oncall','oncall_requirement',{S:{S:'+1'}},'[data-oc="S"]',r=>r.oncall_requirement.S.S,r=>r.oncall_requirement.S.S===0]
];
const expectedCases = 51;
let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed + failed !== expectedCases){console.error('FAIL custom matrix incomplete case count');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL custom matrix timeout');process.exit(1);},300000);watchdog.unref();
(async()=>{
 for(const [id,key,value,sel,get,cleared] of specs)for(const flow of ['unrelated','clear-change','clear-focusout','edit-focusout','hidden','undo']){
 const r=clone(rawRules);r.profile.id='synthetic-custom-matrix';r.profile.roles[0].standby=true;r.rule_states[id]='hard';r[key]=clone(value);
 const a=await makeApp();try{a.enter();await imported(a,r);const before=clone(a.A.state.rules[key]);const x=a.q(sel);assert(x,'control rendered');
 if(flow==='unrelated'){a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');a.A.readSettings();assert.deepStrictEqual(clone(a.A.state.rules[key]),before);assert.strictEqual(a.q(sel).value,String(Number(get(r))));}
 if(flow==='clear-change'){a.change(sel,'');assert(cleared(a.A.state.rules),'clear committed');}
 if(flow==='clear-focusout'||flow==='edit-focusout'){x.value=flow==='clear-focusout'?'':'4';x.dispatchEvent(new a.w.Event('input',{bubbles:true}));x.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert(flow==='clear-focusout'?cleared(a.A.state.rules):get(a.A.state.rules)===4,'focusout committed');assert.strictEqual(a.q(sel),x,'DOM retained');assert.strictEqual(x.dataset.numericEdited,undefined);a.A.readSettings();assert(flow==='clear-focusout'?cleared(a.A.state.rules):get(a.A.state.rules)===4);}
 if(flow==='hidden'){a.change(`[data-ron="${id}"]`,false);a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(clone(a.A.state.rules[key]),before);}
 if(flow==='undo'){a.change(sel,'4');assert.strictEqual(get(a.A.state.rules),4);a.A.undo();assert.deepStrictEqual(clone(a.A.state.rules[key]),before);}
 assert.deepStrictEqual(a.errors,[]);passed++;console.log('ok '+id+' '+flow);
 }catch(e){failed++;console.log('FAIL '+id+' '+flow+' '+e.stack);}finally{a.dom.window.close();}}

 const extra=async(name,fn)=>{try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.log('FAIL '+name+' '+e.stack);}};
 const highs=process.argv[2]?await require(process.argv[2])():null;
 for(const [id,key,value] of specs)for(const state of ['hard','soft'].filter(st=>id!=='oncall'||st==='hard'))await extra(id+' '+state+' checker penalty solver preservation',async()=>{
 const r=clone(rawRules);r.profile.id='synthetic-custom-semantics';r.profile.roles[0].standby=true;r.rule_states[id]=state;r[key]=clone(value);
 const a=await makeApp();try{a.enter();await imported(a,r);
 const problem=()=>new a.w.T.Problem(a.A.state.rules,a.A.state.month),pin=Object.fromEntries(problem().slots.map(s=>[s.join(':'),{work:N[1],oc:[]}]));
 const semantic=()=>({check:clone((({VC,WC})=>({VC,WC}))(a.w.T.check(problem(),pin))),penalty:clone(a.w.T.penalty(problem(),pin))});const before=semantic();
 const solved=highs?a.w.T.solve(problem(),highs,{pin,timeLimit:10}):null;
 a.change('#doctorTable tr[data-i="0"] [data-f="years"]','0');assert.deepStrictEqual(semantic(),before);
 if(highs){const after=a.w.T.solve(problem(),highs,{pin,timeLimit:10});assert.strictEqual(after.status,solved.status);assert.strictEqual(after.objective,solved.objective);assert.strictEqual(after.status,state==='hard'?'Infeasible':'Optimal');if(state==='soft')assert(Math.abs(after.objective-before.penalty.total)<1e-6);}
 const b=await makeApp(a.w.localStorage.getItem(storageKey),r,r);try{b.enter();assert.deepStrictEqual(clone(b.A.state.rules[key]),clone(a.A.state.rules[key]));}finally{b.dom.window.close();}
 assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}});
 await extra('composition add delete sibling preservation and undo',async()=>{
 const r=clone(rawRules);r.rule_states.composition='hard';r.composition=clone(specs[3][2]);const a=await makeApp();try{a.enter();await imported(a,r);const old=clone(a.A.state.rules.composition[0]);a.click('[data-act="compAdd"]');assert.deepStrictEqual(clone(a.A.state.rules.composition[0]),old);assert.strictEqual(a.A.state.rules.composition.length,2);a.click('tr[data-ci="1"] [data-act="compDel"]');assert.deepStrictEqual(clone(a.A.state.rules.composition),[old]);a.A.undo();assert.strictEqual(a.A.state.rules.composition.length,2);assert.deepStrictEqual(clone(a.A.state.rules.composition[0]),old);}finally{a.dom.window.close();}});
 await extra('friday rename reorder and undo retain value identity',async()=>{
 const r=clone(rawRules);r.rule_states.friday_night_min='hard';r.friday_night_min=clone(specs[2][2]);const a=await makeApp();try{a.enter();await imported(a,r);a.change('#doctorTable tr[data-i="0"] [data-f="name"]','Synthetic Renamed');assert.strictEqual(a.A.state.rules.friday_night_min['Synthetic Renamed'],'+2');assert(!(N[0] in a.A.state.rules.friday_night_min));a.A.undo();assert.strictEqual(a.A.state.rules.friday_night_min[N[0]],'+2');a.click('#doctorTable tr[data-i="0"] [data-act="down"]');assert.strictEqual(a.A.state.rules.friday_night_min[N[0]],'+2');}finally{a.dom.window.close();}});

 await extra('shift bound edits update dependent roster columns without replacing rule inputs',async()=>{
 const r=clone(rawRules);r.rule_states.shift_count_range='hard';r.shift_counts={};const a=await makeApp(null,r,r);try{a.enter();
 const input=a.q('[data-scr="night:max"]');assert(!a.q('#doctorTable [data-f="shift_max_night"]'));
 for(const [value,visible]of [['5',true],['',false]]){input.value=value;input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert.strictEqual(!!a.q('#doctorTable [data-f="shift_max_night"]'),visible);assert.strictEqual(a.q('[data-scr="night:max"]'),input);input.dispatchEvent(new a.w.Event('change',{bubbles:true}));}
 a.A.undo();assert.strictEqual(a.A.state.rules.shift_counts.night.max,5);assert(a.q('#doctorTable [data-f="shift_max_night"]'));a.A.undo();assert.deepStrictEqual(clone(a.A.state.rules.shift_counts),{});assert(!a.q('#doctorTable [data-f="shift_max_night"]'));assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}});

 for(const value of [null,false,0,0.5,'not-a-number','',[], '\r\n','\u0000'])await extra('all matrix numeric leaves preserve '+JSON.stringify(value)+' and explicit same-visible clear',async()=>{
 const r=clone(rawRules);r.profile.roles[0].standby=true;for(const [id]of specs)r.rule_states[id]='hard';r.shift_counts={night:{min:value,max:value}};r.shift_run_max={day:value};r.friday_night_min={[N[0]]:value};r.composition=[{shift:'night',years_min:value,years_max:value,min:value,max:value}];r.oncall_requirement={S:{S:value}};
 const a=await makeApp();try{a.enter();await imported(a,r);const snapshot=()=>clone(Object.fromEntries(specs.map(([,k])=>[k,a.A.state.rules[k]])));const before=snapshot();a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');a.A.readSettings();assert.deepStrictEqual(snapshot(),before);
 for(const [,key,,sel,get,cleared]of specs){const x=a.q(sel);x.value='';x.dispatchEvent(new a.w.Event('input',{bubbles:true}));x.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert(cleared(a.A.state.rules),key+' explicit clear');assert.strictEqual(a.q(sel),x);assert.strictEqual(x.dataset.numericEdited,undefined);const after=clone(a.A.state.rules[key]);x.dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.deepStrictEqual(clone(a.A.state.rules[key]),after);a.A.readSettings();assert.deepStrictEqual(clone(a.A.state.rules[key]),after);}
 assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}});
 clearTimeout(watchdog);completed=true;console.log(`custom matrix: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
