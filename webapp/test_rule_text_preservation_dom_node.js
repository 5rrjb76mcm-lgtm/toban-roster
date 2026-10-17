// Preserve imported qualifier and composition-label text through local settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_rule_text_preservation_dom_node.js [/path/to/node_modules/highs]
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

const P=a=>new a.w.T.Problem(a.A.state.rules,a.A.state.month);
const fixture=()=>{const r=clone(rawRules);r.profile.id='synthetic-rule-text';r.rule_states.composition='hard';r.rule_states.run_length_max='hard';r.doctors[0].quals=['Trainer\nSenior'];r.composition=[{shift:'night',qual:'Trainer\nSenior',min:1,label:'Synthetic\r\nLabel',extension:{keep:true}},{shift:'night',not_qual:'Trainer\nSenior',max:0}];r.run_length={max:3,exempt_qual:'Trainer\nSenior',extension:{keep:true}};return r;};
const fields=[['qual','[data-ci="0"] [data-cqual]',a=>a.A.state.rules.composition[0]],['not_qual','[data-ci="1"] [data-cnot]',a=>a.A.state.rules.composition[1]],['label','[data-ci="0"] [data-clabel]',a=>a.A.state.rules.composition[0]],['exempt_qual','#setRunExempt',a=>a.A.state.rules.run_length]];
const projection=a=>clone({composition:a.A.state.rules.composition,run_length:a.A.state.rules.run_length,quals:a.A.state.rules.doctors[0].quals});
const semantics=a=>{const p=P(a),asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:[N[0]],oc:[]}]));return clone({matches:p.comp.map(c=>p.compMatch(c,N[0])),run:p.runApplies(N[0]),violations:a.w.T.check(p,asg).VC.filter(v=>['COMPOSITION_SHORT','COMPOSITION_OVER','RUN_TOO_LONG'].includes(v.code)),penalty:a.w.T.penalty(p,asg).total});};
let completed=false,passed=0,failed=0;
process.on('exit',()=>{if(!completed){console.error('Incomplete rule text regression');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Rule text regression timeout');process.exit(1);},120000);
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
async function run(fn){const a=await makeApp();try{a.enter();await imported(a,fixture());await fn(a);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}}
(async()=>{
 const highs=process.argv[2]?await require(process.argv[2])():null;
 for(const lang of ['en','ja'])await test(lang+' accepted JSON import/edit/serialize/reload retains source and rule applicability',()=>run(async a=>{
  a.w.T.setLang(lang);a.A.renderSettings();const before=projection(a),effective=semantics(a);
  assert.deepStrictEqual(effective.matches,[true,false]);assert.strictEqual(effective.run,false);assert.deepStrictEqual(effective.violations,[]);
  a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.strictEqual(a.A.state.rules.doctors[0].years,12);
  for(let i=0;i<3;i++){a.A.readSettings();a.A.renderSettings();assert.deepStrictEqual(projection(a),before);assert.deepStrictEqual(semantics(a),effective);}
  const payload=JSON.parse(a.A.payloadJson());assert.deepStrictEqual(payload.rules.composition,before.composition);assert.deepStrictEqual(payload.rules.run_length,before.run_length);
  const b=await makeApp(a.w.localStorage.getItem(key));try{b.enter();b.A.readSettings();assert.deepStrictEqual(projection(b),before);assert.deepStrictEqual(semantics(b),effective);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
  if(highs){const solved=a.w.T.solve(P(a),highs,{timeLimit:3});assert.strictEqual(solved.status,'Optimal');assert.deepStrictEqual(clone(a.w.T.check(P(a),solved.asg).V),[]);}
 }));
 for(const [field,selector,get]of fields){
  for(const value of ['  Synthetic text  ','\n',''])await test(field+' untouched '+JSON.stringify(value),()=>run(async a=>{
   const r=fixture();if(field==='exempt_qual')r.run_length[field]=value;else r.composition[field==='not_qual'?1:0][field]=value;await imported(a,r);const before=projection(a);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');a.A.readSettings();assert.deepStrictEqual(projection(a),before);
  }));
  for(const kind of ['change','input-change-focusout','input-focusout-change'])await test(field+' '+kind+' explicit edit/clear/local Undo',()=>run(async a=>{
   const before=projection(a);a.A.clearUndo();
   const edit=async value=>{const input=a.q(selector);input.value=value;for(const type of kind.split('-'))input.dispatchEvent(new a.w.Event(type,{bubbles:true}));await a.tick();};
   await edit('Edited synthetic');assert.strictEqual(get(a)[field],'Edited synthetic');a.A.readSettings();assert.strictEqual(get(a)[field],'Edited synthetic');
   await edit('');assert(!Object.hasOwn(get(a),field));a.A.readSettings();a.A.renderSettings();assert(!Object.hasOwn(get(a),field));
   a.A.undo();assert.strictEqual(get(a)[field],'Edited synthetic');a.A.undo();assert.deepStrictEqual(projection(a),before);a.A.readSettings();assert.deepStrictEqual(projection(a),before);assert(a.q('#btnUndo').disabled);
  }));
  await test(field+' deliberate same-visible edit and deduplicated focusout/change',()=>run(async a=>{
   const before=projection(a);a.A.clearUndo();const input=a.q(selector),shown=input.value;
   input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));assert.deepStrictEqual(projection(a),before);assert(a.q('#btnUndo').disabled);
   input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));await a.tick();assert.strictEqual(get(a)[field],shown.trim());
   const undoNote=a.q('#undoNote').textContent;input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();assert.strictEqual(a.q('#undoNote').textContent,undoNote);
   a.A.undo();assert.deepStrictEqual(projection(a),before);assert(a.q('#btnUndo').disabled);
  }));
  await test(field+' explicit clear of newline-only source',()=>run(async a=>{
   const r=fixture();if(field==='exempt_qual')r.run_length[field]='\n';else r.composition[field==='not_qual'?1:0][field]='\n';await imported(a,r);const before=projection(a);a.A.clearUndo();
   const input=a.q(selector);assert.strictEqual(input.value,'');input.dispatchEvent(new a.w.Event('input',{bubbles:true}));input.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));await a.tick();assert(!Object.hasOwn(get(a),field));
   a.A.undo();assert.deepStrictEqual(projection(a),before);
  }));
 }
 assert.strictEqual(passed+failed,34);completed=true;clearTimeout(watchdog);console.log(`rule text preservation: ${passed} passed, ${failed} failed`);if(!highs)console.log('SKIP solver (supply installed HiGHS path)');if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
