// Preserve accepted display order through unrelated synchronous settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_name_order_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Name-order DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/name-order-preservation.html';
const rawRules = {profile:{id:'synthetic-name-order-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'none'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:10})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic display-order roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/name-order-preservation.html',runScripts:'outside-only'}), w=dom.window;
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

const EXPECTED_CASES=20;let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES || failed){console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${completed}`);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL name-order cases timed out');process.exit(1);},120000);
const roster=(a,i,f)=>`#doctorTable tr[data-i="${i}"] [data-f="${f}"]`;
const reverse=()=>N.slice().reverse();
const value=a=>clone(a.A.state.rules.name_order);
async function imported(a,r) {
 a.q('#rulesJson').value=JSON.stringify(r);a.click('#btnApplyRules');
 for(let i=0;i<20;i++){await a.tick();if(!a.A.switching)break;}
 assert.strictEqual(a.A.switching,0,'JSON import completed');assert.deepStrictEqual(value(a),r.name_order,'supported import retains exact display order');
}
async function fixture(kind='custom') {
 const a=await makeApp();a.enter();a.A.readSettings();
 const r=clone(a.A.state.rules);r.name_order=kind==='empty'?[]:kind==='default'?N.slice():reverse();
 r.docx={template:'month_table',font:'Synthetic Font',paper:{size:'Letter',orient:'landscape',margin:480,local_meta:{keep:true}},local_docx:{keep:true}};
 r.profile.local_profile={keep:true};r.profile.roles[0].local_role={keep:true};r.profile.shifts[0].local_shift={keep:true};
 r.rules_version='synthetic-v1';r.notes='Keep fictional setting note';
 if(kind==='never'){r.doctors[1].duty='never';r.doctors[0].quota=15;r.doctors[1].quota=0;r.doctors[2].quota=15;}
 await imported(a,r);return a;
}
function output(a) {
 const P=new a.w.T.Problem(a.A.state.rules,a.A.state.month);
 const asg=Object.fromEntries(P.slots.map((s,i)=>[s.join(':'),{work:P.dutyNames[i%P.dutyNames.length],oc:[]}]));
 assert.deepStrictEqual(clone(a.w.T.check(P,asg).V),[],'fictional complete assignment passes checker');
 const xml=a.w.T.docxXml(P,asg,'Synthetic draft',{today:'2026-10-01'});
 const parsed=new a.w.DOMParser().parseFromString(xml,'application/xml');assert.strictEqual(parsed.getElementsByTagName('parsererror').length,0);
 const tables=parsed.getElementsByTagName('w:tbl'),summary=tables[tables.length-1];
 const rows=[...summary.getElementsByTagName('w:tr')].slice(1).map(tr=>tr.getElementsByTagName('w:t')[0].textContent);
 const report=a.w.T.buildReport(P,asg).sections.find(x=>x.id==='s3').html;
 const reportDoc=new a.w.DOMParser().parseFromString(report,'text/html');
 const reportRows=[...reportDoc.querySelectorAll('table:first-child tbody tr')].map(tr=>tr.querySelector('td').textContent);
 assert.deepStrictEqual(reportRows,rows);return{xml,rows,lint:clone(a.w.T.lint(P)).map(x=>x.code)};
}
const metadata=a=>clone({docx:a.A.state.rules.docx,profile:a.A.state.rules.profile,rules_version:a.A.state.rules.rules_version,notes:a.A.state.rules.notes,month:a.A.state.month});
async function test(name,fn,kind='custom') {const a=await fixture(kind);try{await fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}finally{a.dom.window.close();}}
(async()=>{
 for(const kind of ['custom','never','empty','default'])await test(kind+': years edit, repeated reads, unrelated fields and reload preserve order/output',async a=>{
  const expected=value(a),before=output(a),fields=metadata(a),rules=clone(a.A.state.rules);assert.deepStrictEqual(before.lint,[]);
  a.change(roster(a,0,'years'),'12');assert.deepStrictEqual(value(a),expected);a.A.readSettings();a.A.readSettings();
  assert.deepStrictEqual(value(a),expected);assert.deepStrictEqual(metadata(a),fields);assert.deepStrictEqual(output(a),before);
  const wanted=clone(rules);wanted.doctors[0].years=12;assert.deepStrictEqual(clone(a.A.state.rules),wanted,'only requested rules field changes');
  const saved=a.w.localStorage.getItem(key);assert.deepStrictEqual(JSON.parse(saved).rules.name_order,expected);
  const b=await makeApp(saved,rules,rules);try{b.enter();b.A.readSettings();assert.deepStrictEqual(value(b),expected);assert.deepStrictEqual(output(b),before);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
 },kind);
 await test('synchronous input/focusout preserves order without replacing focused numeric DOM',a=>{
  const el=a.q(roster(a,0,'years'));el.value='9';el.dispatchEvent(new a.w.Event('input',{bubbles:true}));el.dispatchEvent(new a.w.Event('focusout',{bubbles:true}));
  assert.strictEqual(a.q(roster(a,0,'years')),el);assert.deepStrictEqual(value(a),reverse());assert.strictEqual(a.A.state.rules.doctors[0].years,9);a.A.readSettings();assert.deepStrictEqual(value(a),reverse());
 });
 await test('unrelated settings weight preserves order',a=>{const el=a.q('#weightsTable [data-w]');assert(el);a.change(el,'123');assert.deepStrictEqual(value(a),reverse());assert.strictEqual(a.A.state.rules.weights[el.dataset.w],123);});
 await test('output paper edit preserves order and all unowned output metadata',a=>{const before=clone(a.A.state.rules.docx);a.change('#setDocxSize','A3');assert.deepStrictEqual(value(a),reverse());before.paper.size='A3';assert.deepStrictEqual(clone(a.A.state.rules.docx),before);});
 await test('profile label edit preserves order',a=>{a.change('#setProfLabel','New synthetic facility');assert.deepStrictEqual(value(a),reverse());assert.strictEqual(a.A.state.rules.profile.label,'New synthetic facility');});
 await test('normal to fixed-only keeps the same display membership and custom order',a=>{a.change(roster(a,0,'duty'),'fixed_only');assert.deepStrictEqual(value(a),reverse());a.change(roster(a,0,'duty'),'');assert.deepStrictEqual(value(a),reverse());});
 await test('normal to never rebuilds candidate order and restore re-adds the person',a=>{a.change(roster(a,0,'duty'),'never');assert.deepStrictEqual(value(a),N.slice(1));a.change(roster(a,0,'duty'),'');assert.deepStrictEqual(value(a),N);});
 await test('normal to reserve-only rebuilds candidate order and restore re-adds person',a=>{a.change(roster(a,0,'duty'),'no_unless_needed');assert.deepStrictEqual(value(a),N.slice(1));a.change(roster(a,0,'duty'),'fixed_only');assert.deepStrictEqual(value(a),N);});
 await test('rename rebuilds display order with the new name',a=>{a.change(roster(a,0,'name'),'Synthetic Renamed');assert.deepStrictEqual(value(a),['Synthetic Renamed',N[1],N[2]]);assert(!value(a).includes(N[0]));});
 await test('rename of explicitly included noncandidate retains prior rebuild behavior',a=>{a.change(roster(a,1,'name'),'Synthetic Renamed');assert.deepStrictEqual(value(a),[N[0],N[2]]);assert(!value(a).includes(N[1]));},'never');
 await test('explicit roster down rebuilds display order',a=>{a.click('#doctorTable tr[data-i="0"] [data-act="down"]');assert.deepStrictEqual(value(a),[N[1],N[0],N[2]]);assert.deepStrictEqual(clone(a.A.state.rules.doctors.map(x=>x.name)),value(a));});
 await test('explicit roster up rebuilds display order',a=>{a.click('#doctorTable tr[data-i="2"] [data-act="up"]');assert.deepStrictEqual(value(a),[N[0],N[2],N[1]]);});
 await test('explicit add rebuilds display order and includes the new member',a=>{a.w.prompt=()=> 'Synthetic Added';a.click('[data-act="add"]');assert.deepStrictEqual(value(a),[...N,'Synthetic Added']);});
 await test('explicit delete rebuilds display order and removes the member',a=>{a.click('#doctorTable tr[data-i="1"] [data-act="del"]');assert.deepStrictEqual(value(a),[N[0],N[2]]);});
 await test('delete to empty roster and subsequent readback remain valid',a=>{for(let i=0;i<3;i++)a.click('#doctorTable tr[data-i="0"] [data-act="del"]');assert.deepStrictEqual(value(a),[]);assert.deepStrictEqual(clone(a.A.state.rules.doctors),[]);a.A.readSettings();assert.deepStrictEqual(value(a),[]);});
 await test('undo unrelated years edit restores years and retains imported order',async a=>{const before=clone(a.A.state.rules);a.change(roster(a,0,'years'),'12');await a.tick();a.A.undo();assert.deepStrictEqual(clone(a.A.state.rules),before);a.A.readSettings();assert.deepStrictEqual(value(a),reverse());});
 await test('undo explicit roster move restores custom order',async a=>{a.click('#doctorTable tr[data-i="0"] [data-act="down"]');assert.deepStrictEqual(value(a),[N[1],N[0],N[2]]);await a.tick();a.A.undo();assert.deepStrictEqual(value(a),reverse());a.A.readSettings();assert.deepStrictEqual(value(a),reverse());});
 completed=true;clearTimeout(watchdog);console.log(`name-order preservation: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);
})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});
