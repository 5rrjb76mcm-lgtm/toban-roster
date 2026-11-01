// Accepted imported avoid.date entries render consistently with the model.
// Preserve source aliases until explicit edits; exercise actual delegated UI events.
// Actual markup, init, delegated events and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_calendar_avoid_date_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Authored for jsdom 26.1.0; NOT executed. Dependency lookup never downloads packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Avoid date DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/calendar-avoid-date.html';
const rawRules = () => ({profile:{id:'synthetic-calendar-avoid-date',roles:[{id:'S',label:'Staff',refs:['charge']}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off',avoid_days:'soft'},weights:{}});
const rawMonth = () => ({year:2026,month:11,notes:'Synthetic avoid date roundtrip'});
async function makeApp(month, rules = rawRules(), saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/calendar-avoid-date.html',runScripts:'outside-only'}), w=dom.window;
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
// Accepted avoid.date aliases share the model's nullish day precedence. Rendering
// must not migrate source records; only explicit edits own their represented condition.
const fixture = (avoid, extra = {}) => Object.assign(rawMonth(), {duty_days:{[N[0]]:{},[N[1]]:{}},next_first_day_in_calendar:true,avoid:clone(avoid)}, extra);
const alias = (date = 7, part = 'night', name = N[0]) => ({name,date,part});
const select = d => `#doctorPane [data-cal="unavail"][data-d="${d}"]`;
const records = a => clone(a.A.state.month.avoid || []);
const effective = a => clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).avoidSlots(N[0]));
const cases=[], test=(name,fn)=>cases.push({name,fn});
const EXPECTED_CASES=10; let passed=0, failed=0, completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES){console.error('FAIL incomplete avoid.date calendar cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL avoid.date calendar timeout');process.exit(1);},120000);watchdog.unref();
async function withApp(m, fn) { const a=await makeApp(m); try { a.calendar(); await fn(a); assert.deepStrictEqual(a.errors,[]); } finally { await a.tick(); a.dom.window.close(); } }
for(const date of [7,'7']) test('date alias first display and unchanged readback: '+JSON.stringify(date),()=>withApp(fixture([alias(date)]),async a=>{
  assert.strictEqual(a.q(select(7)).value,'avoid_night'); assert.strictEqual(a.q(select(7)).dataset.shown,'avoid_night');
  assert.deepStrictEqual(effective(a),[[7,'night']]); const before=records(a);
  a.wish(10,true); a.A.readAll(); a.A.renderDoctor(); a.A.readAll();
  assert.deepStrictEqual(records(a),before); assert.deepStrictEqual(effective(a),[[7,'night']]);
}));
test('unrelated edit, payload, local save and reload preserve the alias',()=>withApp(fixture([alias()]),async a=>{
  const before=records(a); a.wish(10,true); assert.deepStrictEqual(JSON.parse(a.A.payloadJson()).month.avoid,before);
  const saved=a.w.localStorage.getItem(key); assert.deepStrictEqual(JSON.parse(saved).month.avoid,before);
  const b=await makeApp(rawMonth(),rawRules(),saved); try { b.calendar(); assert.strictEqual(b.q(select(7)).value,'avoid_night');
    b.wish(11,true); assert.deepStrictEqual(records(b),before); assert.deepStrictEqual(effective(b),[[7,'night']]); assert.deepStrictEqual(b.errors,[]);
  } finally { await b.tick(); b.dom.window.close(); }
}));
test('clearing shown unavailable reveals retained date alias, then clear removes only it',()=>withApp(fixture([alias(),alias(8),alias(7,'night',N[1])],{unavailable_other:[{name:N[0],day:7,part:'day'}]}),async a=>{
  const before=records(a); assert.strictEqual(a.q(select(7)).value,'day'); a.change(select(7),''); await a.tick();
  assert.deepStrictEqual(clone(a.A.state.month.unavailable_other),[]); assert.deepStrictEqual(records(a),before);
  assert.strictEqual(a.q(select(7)).value,'avoid_night'); a.change(select(7),''); await a.tick();
  assert.deepStrictEqual(records(a),before.slice(1)); assert.strictEqual(a.q(select(7)).value,'');
  a.A.readAll(); assert.deepStrictEqual(records(a),before.slice(1));
}));
test('explicit alias removal saves empty and Undo restores original alias',()=>withApp(fixture([alias('7')]),async a=>{
  a.A.clearUndo(); a.change(select(7),''); await a.tick(); assert.deepStrictEqual(records(a),[]);
  assert.deepStrictEqual(effective(a),[]); assert.strictEqual(JSON.parse(a.A.payloadJson()).month.avoid,undefined);
  a.A.undo(); a.calendar(); assert.deepStrictEqual(records(a),[alias('7')]); assert.strictEqual(a.q(select(7)).value,'avoid_night');
  assert.deepStrictEqual(effective(a),[[7,'night']]);
}));
test('explicit replacement canonicalizes only the selected alias condition',()=>withApp(fixture([alias(),alias(8)]),async a=>{
  a.change(select(7),'avoid_day'); await a.tick();
  assert.deepStrictEqual(records(a),[alias(8),{name:N[0],day:7,part:'day'}]);
  assert.strictEqual(a.q(select(7)).value,'avoid_day');
}));
test('day wins over a conflicting date and clearing day removes the record',()=>withApp(fixture([{name:N[0],day:'8',date:7,part:'night'}]),async a=>{
  assert.strictEqual(a.q(select(7)).value,''); assert.strictEqual(a.q(select(8)).value,'avoid_night');
  assert.deepStrictEqual(effective(a),[[8,'night']]); const before=records(a); a.wish(10,true); assert.deepStrictEqual(records(a),before);
  a.change(select(8),''); await a.tick(); assert.deepStrictEqual(records(a),[]);
}));
test('null day falls back to date, missing part defaults to allday',()=>withApp(fixture([{name:N[0],day:null,date:'7'}]),async a=>{
  assert.strictEqual(a.q(select(7)).value,'avoid_allday'); assert.deepStrictEqual(effective(a),[[7,'day'],[7,'night']]);
  a.wish(10,true); assert.deepStrictEqual(records(a),[{name:N[0],day:null,date:'7'}]);
}));
test('ordinary day-form conditions keep their existing render and clear behavior',()=>withApp(fixture([{name:N[0],day:7,part:'night'}]),async a=>{
  assert.strictEqual(a.q(select(7)).value,'avoid_night'); const before=records(a); a.wish(10,true); assert.deepStrictEqual(records(a),before);
  a.change(select(7),''); await a.tick(); assert.deepStrictEqual(records(a),[]);
}));
test('N+1 has no avoid picker and retained alias is not reinterpreted by current edits',()=>withApp(fixture([alias(31),alias(7)]),async a=>{
  assert.strictEqual(a.q(select(31)),null); assert.deepStrictEqual(effective(a),[[7,'night']]);
  const before=records(a); a.wish(10,true); a.A.readAll(); assert.deepStrictEqual(records(a),before);
  a.change(select(7),''); await a.tick(); assert.deepStrictEqual(records(a),[alias(31)]); assert.deepStrictEqual(effective(a),[]);
}));
(async()=>{assert.strictEqual(cases.length,EXPECTED_CASES);for(const c of cases){try{await c.fn();passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}}completed=true;clearTimeout(watchdog);console.log(`avoid.date calendar: ${passed} passed, ${failed} failed, ${cases.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
