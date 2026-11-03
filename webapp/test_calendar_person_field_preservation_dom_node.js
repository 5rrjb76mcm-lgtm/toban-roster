// Imported plugin calendar values retain their raw scalar types until explicit edits.
// Exercise actual delegated UI events, repeated readback, persistence and Undo.
// Actual markup, init, delegated events and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_calendar_person_field_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Authored for jsdom 26.1.0; NOT executed. Dependency lookup never downloads packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Person field DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log("SOURCE_ROOT " + root);
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/calendar-person-fields.html';
const rawRules = () => ({profile:{id:'synthetic-calendar-person-fields',roles:[{id:'S',label:'Staff',refs:['charge']}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off',avoid_days:'soft'},weights:{}});
const rawMonth = () => ({year:2026,month:11,notes:'Synthetic person field roundtrip'});
async function makeApp(month, rules = rawRules(), saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/calendar-person-fields.html',runScripts:'outside-only'}), w=dom.window;
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
const FIELD='local.synthetic.pref', HIDDEN='local.synthetic.hidden';
const defaults = () => ({[FIELD]:{[N[0]]:{5:'a',6:0,7:true,8:'retired'},[N[1]]:{6:0}},[HIDDEN]:{[N[0]]:{6:true}}});
const fixture = (data=defaults()) => Object.assign(rawMonth(),{person_days:clone(data),next_first_day_in_calendar:true});
const register = a => a.w.T.calendarExt.register({id:'local.synthetic.fields',fields:[{id:FIELD,label:'Synthetic preference',options:[['a','A'],['b','B'],[0,'Zero'],[true,'True']]}]});
const select = d => `#doctorPane [data-cal="pfield"][data-id="${FIELD}"][data-d="${d}"]`;
const data = a => clone(a.A.state.month.person_days);
const raw = (a,d) => new a.w.T.Problem(a.A.state.rules,a.A.state.month).personDay(FIELD,N[0],d);
const cases=[], test=(name,fn)=>cases.push({name,fn});
const EXPECTED_CASES=10; let passed=0, failed=0, completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES){console.error('FAIL incomplete person field cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL person field timeout');process.exit(1);},120000);watchdog.unref();
async function withApp(m, fn) {const a=await makeApp(m);try{register(a);a.calendar();await fn(a);assert.deepStrictEqual(a.errors,[]);}finally{await a.tick();a.dom.window.close();}}
test('numeric and boolean imported values display and retain model type',()=>withApp(fixture(),async a=>{
  assert.strictEqual(a.q(select(6)).value,'0');assert.strictEqual(a.q(select(7)).value,'true');
  assert.strictEqual(raw(a,6),0);assert.strictEqual(raw(a,7),true);
  assert.strictEqual(a.q(select(6)).selectedOptions[0].textContent,'Zero');
  assert.strictEqual(a.q(select(7)).selectedOptions[0].textContent,'True');
}));
test('unrelated wish preserves every raw field value',()=>withApp(fixture(),async a=>{
  const before=data(a);a.wish(9,true);assert.deepStrictEqual(data(a),before);assert.strictEqual(raw(a,6),0);assert.strictEqual(raw(a,7),true);
}));
test('repeated readback and redraw preserve raw values',()=>withApp(fixture(),async a=>{
  const before=data(a);for(let i=0;i<3;i++){a.A.readAll();a.A.renderDoctor();}a.A.readAll();assert.deepStrictEqual(data(a),before);
}));
test('payload local save and reload preserve raw values',()=>withApp(fixture(),async a=>{
  const before=data(a);a.wish(9,true);assert.deepStrictEqual(JSON.parse(a.A.payloadJson()).month.person_days,before);
  const saved=a.w.localStorage.getItem(key);assert.deepStrictEqual(JSON.parse(saved).month.person_days,before);
  const b=await makeApp(fixture(),rawRules(),saved);try{register(b);b.calendar();b.wish(10,true);assert.deepStrictEqual(data(b),before);assert.strictEqual(raw(b,6),0);assert.deepStrictEqual(b.errors,[]);}finally{await b.tick();b.dom.window.close();}
}));
test('explicit replacement owns only one cell and remains stable',()=>withApp(fixture(),async a=>{
  const expected=defaults();expected[FIELD][N[0]][6]='b';a.change(select(6),'b');assert.deepStrictEqual(data(a),expected);
  a.A.readAll();a.A.renderDoctor();a.wish(9,true);assert.deepStrictEqual(data(a),expected);assert.strictEqual(a.q(select(6)).value,'b');
}));
test('explicit clear removes only one cell',()=>withApp(fixture(),async a=>{
  const expected=defaults();delete expected[FIELD][N[0]][6];a.change(select(6),'');assert.deepStrictEqual(data(a),expected);
  a.A.readAll();a.A.renderDoctor();assert.strictEqual(a.q(select(6)).value,'');assert.deepStrictEqual(data(a),expected);
}));
test('Undo restores original numeric type after clear',()=>withApp(fixture(),async a=>{
  a.A.clearUndo();a.change(select(6),'');assert.strictEqual(raw(a,6),'');a.A.undo();a.calendar();assert.deepStrictEqual(data(a),defaults());assert.strictEqual(raw(a,6),0);assert.strictEqual(a.q(select(6)).value,'0');
}));
test('other people hidden fields and offscreen N+1 survive explicit edit',()=>{
  const initial=defaults();initial[FIELD][N[0]][31]='next retained';return withApp(fixture(initial),async a=>{
    assert.strictEqual(a.q(select(31)),null);const expected=clone(initial);expected[FIELD][N[0]][5]='b';a.change(select(5),'b');assert.deepStrictEqual(data(a),expected);
    a.change('#docSel',N[1]);a.wish(9,true);assert.deepStrictEqual(data(a),expected);
  });
});
test('retired string retained until explicitly cleared; empty map removed',()=>{
  const initial={[FIELD]:{[N[0]]:{8:'retired'},[N[1]]:{5:'a'}}};return withApp(fixture(initial),async a=>{
    assert.strictEqual(a.q(select(8)).value,'retired');assert(a.q(select(8)).selectedOptions[0].textContent.includes(a.w.T.t('（現在は使わない値）')));
    a.wish(9,true);assert.deepStrictEqual(data(a),initial);a.change(select(8),'');assert.deepStrictEqual(data(a),{[FIELD]:{[N[1]]:{5:'a'}}});
  });
});
test('new numeric and boolean options keep existing string edit semantics',()=>withApp(fixture({}),async a=>{
  a.change(select(6),'0');a.change(select(7),'true');assert.deepStrictEqual(data(a),{[FIELD]:{[N[0]]:{6:'0',7:'true'}}});
  a.A.readAll();a.A.renderDoctor();assert.strictEqual(raw(a,6),'0');assert.strictEqual(raw(a,7),'true');
  a.change(select(6),'');a.change(select(7),'');assert.deepStrictEqual(data(a),{[FIELD]:{}});
}));
console.log('REGISTER '+JSON.stringify(cases.map(c=>c.name)));
(async()=>{assert.strictEqual(cases.length,EXPECTED_CASES);for(const c of cases){console.log('CASE_START '+c.name);try{await c.fn();passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{console.log('CASE_END '+c.name);}}completed=true;clearTimeout(watchdog);console.log(`person fields: ${passed} passed, ${failed} failed, ${cases.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
