// Preserve an imported pair-cap shift selector through unrelated local settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_pair_shift_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Settings builder DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
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



async function imported(a,r){
 for(const d of a.w.T.RULE_DEFS)if(d.states.includes('off') && r.rule_states[d.id]===undefined)r.rule_states[d.id]='off';
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-plugins.json',text:async()=>JSON.stringify(r)}]});input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();assert.equal(a.A.state.rules.profile.id,r.profile.id);a.enter();
}

const fixture=(shift='future_shift', state='soft')=>{const r=clone(rawRules);r.profile.id='synthetic-pair-shift';r.profile.positions={work:{count:{day:1,night:2}}};r.rule_states.pair_cap=state;r.pair_cap={shift,max:2,extension:{note:'keep',values:[1,2]}};return r;};
const projection=a=>clone(a.A.state.rules.pair_cap);
const semantics=a=>{const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month),asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:s[1]==='night'?N:[N[0]],oc:[]}]));return clone({effective:a.w.T.RULE_BY_ID.pair_cap.read(p),check:a.w.T.check(p,asg).VC,penalty:a.w.T.penalty(p,asg)});};
let completed=false,passed=0,failed=0;
process.on('exit',()=>{if(!completed){console.error('Incomplete pair shift regression');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Pair shift regression timeout');process.exit(1);},120000);
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
async function run(fn,shift='future_shift',state='soft'){const a=await makeApp();try{a.enter();await imported(a,fixture(shift,state));await fn(a);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}}
(async()=>{
 for(const lang of ['en','ja'])for(const shift of ['future_shift','night','day'])for(const state of ['soft','off'])await test(lang+' '+shift+' '+state+' import/edit/persist/reload',()=>run(async a=>{
  a.w.T.setLang(lang);a.A.renderSettings();const before=projection(a),effective=semantics(a);
  assert.strictEqual(effective.effective.shift,shift==='day'?'day':'night');
  assert.strictEqual(effective.penalty.total,state==='off'||shift==='day'?0:420);
  a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.strictEqual(a.A.state.rules.doctors[0].years,12);
  assert.deepStrictEqual(projection(a),before,'unrelated roster edit must preserve pair shift');
  for(let i=0;i<3;i++){a.A.readSettings();a.A.renderSettings();assert.deepStrictEqual(projection(a),before);assert.deepStrictEqual(semantics(a),effective);}
  assert.deepStrictEqual(JSON.parse(a.A.payloadJson()).rules.pair_cap,before);
  const b=await makeApp(a.w.localStorage.getItem(key));try{b.enter();b.A.readSettings();assert.deepStrictEqual(projection(b),before);assert.deepStrictEqual(semantics(b),effective);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
 },shift,state));
 await test('unknown option is current, unique, escaped and stable on no-op readback',()=>run(async a=>{
  // The accepted source token is displayed as text, never interpreted as markup.
  const r=fixture('future_<b>&"shift');await imported(a,r);const before=projection(a);a.A.clearUndo();
  for(let i=0;i<3;i++){assert.strictEqual(a.q('#setPairShift').value,r.pair_cap.shift);assert.strictEqual(a.q('#setPairShift').options.length,3);assert.strictEqual(a.q('#setPairShift b'),null);a.A.readSettings();a.A.renderSettings();}
  a.change('#setPairShift',r.pair_cap.shift);await a.tick();assert.deepStrictEqual(projection(a),before);a.A.undo();assert.deepStrictEqual(projection(a),before);assert(a.q('#btnUndo').disabled);
 }));
 await test('explicit day/night and parameter edits preserve metadata; local Undo restores unknown',()=>run(async a=>{
  const before=projection(a),effective=semantics(a);a.A.clearUndo();
  a.change('#setPairShift','day');await a.tick();assert.strictEqual(projection(a).shift,'day');assert.strictEqual(semantics(a).penalty.total,0);assert.deepStrictEqual(projection(a).extension,before.extension);
  a.change('#setPairShift','night');await a.tick();assert.strictEqual(projection(a).shift,'night');assert.strictEqual(semantics(a).penalty.total,420);
  a.change('#setPairMax','3');await a.tick();assert.strictEqual(projection(a).max,3);assert.strictEqual(semantics(a).penalty.total,405);
  a.A.undo();assert.strictEqual(projection(a).max,2);a.A.undo();assert.strictEqual(projection(a).shift,'day');a.A.undo();assert.deepStrictEqual(projection(a),before);assert.deepStrictEqual(semantics(a),effective);assert(a.q('#btnUndo').disabled);
  a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');await a.tick();a.A.undo();assert.deepStrictEqual(projection(a),before);assert.deepStrictEqual(semantics(a),effective);assert(a.q('#btnUndo').disabled);
  a.A.readSettings();assert.deepStrictEqual(projection(a),before);
 }));
 await test('non-string imported selection retains existing option/readback behavior',()=>run(async a=>{
  assert.strictEqual(a.q('#setPairShift').options.length,2);assert.strictEqual(a.q('#setPairShift').value,'day');
  assert.deepStrictEqual(projection(a).shift,['day']);assert.strictEqual(semantics(a).effective.shift,'night');
  a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');await a.tick();
  assert.strictEqual(projection(a).shift,'day');assert.strictEqual(semantics(a).effective.shift,'day');assert.strictEqual(a.q('#setPairShift').options.length,2);
 },['day']));
 assert.strictEqual(passed+failed,15);completed=true;clearTimeout(watchdog);console.log(`pair shift preservation: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
