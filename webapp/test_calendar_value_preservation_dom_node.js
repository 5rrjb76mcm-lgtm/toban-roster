// Month-condition values the calendar and month settings cannot display survive unrelated edits:
// duty kinds outside the current options, weekday-pattern rows with unknown values or extra keys, and accepted numeric spellings of the weekend-balance exception.
// Actual markup, init, delegated events and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_calendar_value_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Calendar value DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/calendar-value-preservation.html';
const rawRules = () => ({profile:{id:'synthetic-calendar-values',roles:[{id:'S',label:'Staff',refs:['charge']}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off',weekend_balance:'hard',period_charge:'hard'},weights:{}});
const rawMonth = () => ({year:2026,month:11,notes:'Synthetic calendar value roundtrip'});
async function makeApp(month, rules = rawRules(), saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/calendar-value-preservation.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(rules), SAMPLE_MONTH:clone(month), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  const initial=clone(rules); w.T.fillDefaultRules(initial);
  for(const def of w.T.RULE_DEFS) if(def.states.includes('off') && rules.rule_states?.[def.id] === undefined) initial.rule_states[def.id]='off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key,saved || JSON.stringify({rules:initial,month:clone(month),result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), qa=s=>[...w.document.querySelectorAll(s)], click=s=>{assert(q(s),'Missing '+s);q(s).click();};
  const change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const input=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const calendar=(who=N[0])=>{click('.tab[data-tab="input"]');click('.sub[data-sub="doctorPane"]');change('#docSel',who);assert.strictEqual(q('#doctorPane').dataset.doctor,who,'calendar rendered');};
  const monthSettings=()=>{click('.tab[data-tab="input"]');click('.sub[data-sub="monthSettings"]');};
  const tick=()=>new Promise(r=>w.setTimeout(r,0)); // 読み戻しが予約した描き直しを window を閉じる前に流す
  const wish=(d,v)=>change(q(`#doctorPane [data-cal="wish"][data-d="${d}"]`),v);
  return {dom,w,A,q,qa,click,change,input,calendar,monthSettings,wish,tick,errors};
}
const month=mut=>{const m=rawMonth();mut(m);return m;};
const cases=[],test=(name,fn)=>cases.push({name,fn});
const EXPECTED_CASES=21;let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES){console.error('FAIL incomplete calendar value cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL calendar value timeout');process.exit(1);},120000);watchdog.unref();
const unused=a=>a.w.T.t('（現在は使わない値）');
// ---- duty kinds (A-1) ----
const DUTY={5:{am:'future_kind',pm:'outpatient'},6:{am:' outpatient '},7:{pm:'ward'}};
test('duty kinds outside the options survive an unrelated calendar edit',async()=>{const a=await makeApp(month(m=>{m.duty_days={[N[0]]:clone(DUTY)};}));try{a.calendar();
  const sel=a.q('#doctorPane [data-cal="duty"][data-d="5"][data-part="am"]');assert.strictEqual(sel.value,'future_kind');assert.strictEqual(sel.selectedOptions[0].textContent,'future_kind'+unused(a));
  assert.strictEqual(a.q('#doctorPane [data-cal="duty"][data-d="6"][data-part="am"]').value,' outpatient ');
  a.wish(10,true);
  const dd=clone(a.A.state.month.duty_days[N[0]]);assert.deepStrictEqual({5:dd[5],6:dd[6],7:dd[7]},DUTY);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('duty kinds survive repeated readback, save and reload',async()=>{const a=await makeApp(month(m=>{m.duty_days={[N[0]]:clone(DUTY)};}));try{a.calendar();a.wish(10,true);a.A.readAll();a.A.renderDoctor();a.A.readAll();
  const pick=S=>{const dd=clone(S.month.duty_days[N[0]]);return {5:dd[5],6:dd[6],7:dd[7]};};assert.deepStrictEqual(pick(a.A.state),DUTY);assert.deepStrictEqual(pick(JSON.parse(a.A.payloadJson())),DUTY);
  const b=await makeApp(rawMonth(),rawRules(),a.w.localStorage.getItem(key));try{b.calendar();b.wish(11,true);assert.deepStrictEqual(pick(b.A.state),DUTY);assert.deepStrictEqual(b.errors,[]);}finally{await b.tick();b.dom.window.close();}
  assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('explicitly choosing a known kind replaces the unknown one; the blank removes it',async()=>{const a=await makeApp(month(m=>{m.duty_days={[N[0]]:clone(DUTY)};}));try{a.calendar();
  a.change('#doctorPane [data-cal="duty"][data-d="5"][data-part="am"]','ward');assert.strictEqual(a.A.state.month.duty_days[N[0]][5].am,'ward');assert.strictEqual(a.A.state.month.duty_days[N[0]][5].pm,'outpatient');
  a.change('#doctorPane [data-cal="duty"][data-d="6"][data-part="am"]','');assert.strictEqual(a.A.state.month.duty_days[N[0]][6],undefined);assert.strictEqual(a.A.state.month.duty_days[N[0]][7].pm,'ward');
  a.A.renderDoctor();assert.strictEqual(a.q('#doctorPane [data-cal="duty"][data-d="5"][data-part="am"]').querySelectorAll('option').length,5,'unknown option is gone after the replacement and redraw');
  assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('known duty kinds (control) round trip unchanged',async()=>{const a=await makeApp(month(m=>{m.duty_days={[N[0]]:{5:{am:'ward',pm:'outpatient'}}};}));try{a.calendar();a.wish(10,true);assert.deepStrictEqual(clone(a.A.state.month.duty_days[N[0]][5]),{am:'ward',pm:'outpatient'});assert.strictEqual(a.q('#doctorPane [data-cal="duty"][data-d="5"][data-part="am"]').querySelectorAll('option').length,5);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('the other person\'s duty kinds are untouched by this person\'s edits',async()=>{const a=await makeApp(month(m=>{m.duty_days={[N[1]]:{5:{am:'future_kind'}}};}));try{a.calendar();a.wish(10,true);assert.deepStrictEqual(clone(a.A.state.month.duty_days[N[1]][5]),{am:'future_kind'});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
// ---- weekday patterns (A-2) ----
const PATS=[{kind:'future_kind',dow:'Mon',part:'full',carry:true,extension:{keep:1}},{kind:'ward',dow:'Funday',part:'evening',nth:['2','4']},{kind:'outpatient',dow:'Tue'}];
const pats=a=>clone(a.A.state.month.regular_duties[N[0]]);
test('pattern rows with unknown values and extra keys survive an unrelated calendar edit',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();
  const r0=a.q('#patTbl tr[data-i="0"] [data-f="kind"]'),r1=a.q('#patTbl tr[data-i="1"] [data-f="dow"]'),r1p=a.q('#patTbl tr[data-i="1"] [data-f="part"]');assert.strictEqual(r0.value,'future_kind');assert.strictEqual(r0.selectedOptions[0].textContent,'future_kind'+unused(a));assert.strictEqual(r1.value,'Funday');assert.strictEqual(r1p.value,'evening');
  a.wish(10,true);assert.deepStrictEqual(pats(a),PATS);a.A.readAll();a.A.renderDoctor();a.A.readAll();assert.deepStrictEqual(pats(a),PATS);assert.deepStrictEqual(JSON.parse(a.A.payloadJson()).month.regular_duties[N[0]],PATS);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('pattern rows survive reload',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();a.wish(10,true);
  const b=await makeApp(rawMonth(),rawRules(),a.w.localStorage.getItem(key));try{b.calendar();b.wish(11,true);assert.deepStrictEqual(pats(b),PATS);assert.deepStrictEqual(b.errors,[]);}finally{await b.tick();b.dom.window.close();}assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('editing one field of a row keeps its other keys and the other rows',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();
  a.change('#patTbl tr[data-i="0"] [data-f="nth"]','1,3');assert.deepStrictEqual(pats(a),[Object.assign(clone(PATS[0]),{nth:[1,3]}),PATS[1],PATS[2]]);
  a.change('#patTbl tr[data-i="1"] [data-f="kind"]','external');assert.deepStrictEqual(pats(a),[Object.assign(clone(PATS[0]),{nth:[1,3]}),{kind:'external',dow:'Funday',part:'evening',nth:['2','4']},PATS[2]]);
  a.change('#patTbl tr[data-i="2"] [data-f="part"]','am');assert.deepStrictEqual(pats(a)[2],{kind:'outpatient',dow:'Tue',part:'am'});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('carry toggle and nth clear on an edited row',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();
  a.change('#patTbl tr[data-i="0"] [data-f="carry"]',false);assert.deepStrictEqual(pats(a)[0],{kind:'future_kind',dow:'Mon',part:'full',extension:{keep:1}});
  a.change('#patTbl tr[data-i="1"] [data-f="nth"]','');assert.deepStrictEqual(pats(a)[1],{kind:'ward',dow:'Funday',part:'evening'});
  a.change('#patTbl tr[data-i="1"] [data-f="carry"]',true);assert.deepStrictEqual(pats(a)[1],{kind:'ward',dow:'Funday',part:'evening',carry:true});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('choosing a known value for an unknown field replaces it',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();
  a.change('#patTbl tr[data-i="0"] [data-f="kind"]','ward');assert.deepStrictEqual(pats(a)[0],{kind:'ward',dow:'Mon',part:'full',carry:true,extension:{keep:1}});
  a.change('#patTbl tr[data-i="1"] [data-f="dow"]','Wed');a.change('#patTbl tr[data-i="1"] [data-f="part"]','pm');assert.deepStrictEqual(pats(a)[1],{kind:'ward',dow:'Wed',part:'pm',nth:['2','4']});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('adding and deleting rows keeps the other rows raw',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();
  a.click('#doctorPane [data-act="patAdd"]');assert.deepStrictEqual(pats(a),[...PATS,{kind:'outpatient',dow:'Mon',part:'full'}]);
  a.click('#patTbl tr[data-i="1"] [data-act="patDel"]');assert.deepStrictEqual(pats(a),[PATS[0],PATS[2],{kind:'outpatient',dow:'Mon',part:'full'}]);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('undo once restores a pattern edit',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(PATS)};}));try{a.calendar();a.A.clearUndo();a.change('#patTbl tr[data-i="0"] [data-f="kind"]','ward');assert.strictEqual(pats(a)[0].kind,'ward');a.A.undo();assert.deepStrictEqual(pats(a),PATS);assert(a.q('#btnUndo').disabled);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('plain pattern rows (control) round trip unchanged',async()=>{const P=[{kind:'ward',dow:'Tue',part:'am',nth:[2,4],carry:true}];const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:clone(P)};}));try{a.calendar();a.wish(10,true);assert.deepStrictEqual(pats(a),P);assert.strictEqual(a.q('#patTbl tr[data-i="0"] [data-f="kind"]').querySelectorAll('option').length,6);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('pattern expansion still uses the edited rows',async()=>{const a=await makeApp(month(m=>{m.regular_duties={[N[0]]:[{kind:'ward',dow:'Mon',part:'am'}]};}));try{a.calendar();a.click('#doctorPane [data-act="patExpand"]');const dd=a.A.state.month.duty_days[N[0]];assert.strictEqual(dd[2].am,'ward');assert.strictEqual(dd[9].am,'ward');assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
// ---- weekend-balance exception (A-3) ----
const exc=a=>clone(a.A.state.month.exceptions);
const EDIT=a=>{const el=a.q('#monthSettings [data-path="notes"]');el.value='edited';el.dispatchEvent(new a.w.Event('input',{bubbles:true}));a.change(el,'edited');};
for(const v of [' 2 ','+2','2','2.0'])test('weekend-balance exception '+JSON.stringify(v)+' survives opening and an unrelated month-settings edit',async()=>{const a=await makeApp(month(m=>{m.exceptions={weekend_balance_max_diff:v};}));try{a.monthSettings();assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:v});assert.strictEqual(a.q('#monthSettings [data-path="exceptions.weekend_balance_max_diff"]').value,'2');
  EDIT(a);assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:v});assert.strictEqual(new a.w.T.Problem(a.A.state.rules,a.A.state.month).weekendMaxDiff,2);a.A.readAll();a.A.renderSettingsMonth();a.A.readAll();assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:v});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('weekend-balance exception number 2 (control) and absent exception stay',async()=>{const a=await makeApp(month(m=>{m.exceptions={weekend_balance_max_diff:2};}));try{a.monthSettings();EDIT(a);assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:2});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}
  const b=await makeApp(rawMonth());try{b.monthSettings();EDIT(b);assert.deepStrictEqual(exc(b),{});assert.deepStrictEqual(b.errors,[]);}finally{await b.tick();b.dom.window.close();}});
test('explicit edit and clear of the exception still commit',async()=>{const a=await makeApp(month(m=>{m.exceptions={weekend_balance_max_diff:' 2 '};}));try{a.monthSettings();const sel='#monthSettings [data-path="exceptions.weekend_balance_max_diff"]';
  a.input(sel,'3');assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:3});a.input(sel,'');assert.deepStrictEqual(exc(a),{});a.input(sel,'1');assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:1});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
test('a non-numeric stored exception is kept until edited',async()=>{const a=await makeApp(month(m=>{m.exceptions={weekend_balance_max_diff:'wide'};}));try{a.monthSettings();assert.strictEqual(a.q('#monthSettings [data-path="exceptions.weekend_balance_max_diff"]').value,'');EDIT(a);assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:'wide'});a.input('#monthSettings [data-path="exceptions.weekend_balance_max_diff"]','2');assert.deepStrictEqual(exc(a),{weekend_balance_max_diff:2});assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}});
(async()=>{assert.strictEqual(cases.length,EXPECTED_CASES);for(const c of cases){try{await c.fn();passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}}completed=true;clearTimeout(watchdog);console.log(`calendar value preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
