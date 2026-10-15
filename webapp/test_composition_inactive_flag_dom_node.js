// Inactive day flags remain selected in composition conditions across ordinary settings readback.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_composition_inactive_flag_dom_node.js [/path/to/node_modules/highs]
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Composition inactive-flag DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/composition-inactive-flag.html';
const rawRules = {profile:{id:'synthetic-composition-inactive-flag',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic composition flag roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/composition-inactive-flag.html',runScripts:'outside-only'}), w=dom.window;
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


const pluginFile = 'rules/synthetic-training.js', flagId = 'synthetic.training';
const pluginBody = `T.dayFlags.register({id:'${flagId}',label:{en:'Training',ja:'研修'}});`;
rawMonth.day_flags = { 7: [flagId] };
const fixture = state => {
  const r = clone(rawRules); r.profile.shifts[0].on = 'none';
  r.composition = [{ shift:'night', days:'flag:'+flagId, min:1, qual:'trainer' }];
  r.doctors[0].quals = ['trainer']; r.rule_states.composition = state; r.weights.composition_miss = 100;
  return r;
};
const register = (a, body = pluginBody) => {
  const loaded = a.w.T.plugins.load('rules', pluginFile, body); assert(loaded.ok, loaded.error);
  a.A.renderAll(); a.enter();
};
const problem = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
const schedule = a => Object.fromEntries(problem(a).slots.map(s => [s.join(':'), {work:s[0] === 7 ? N[0] : N[1], oc:[]}]));
const semantics = a => {
  const p = problem(a), pin = schedule(a);
  return { scope:clone(p.slots.filter(s => p.compOn(p.comp[0], s))),
    violations:a.w.T.check(p, pin).VC.filter(v => v.code === 'COMPOSITION_SHORT').length,
    penalty:a.w.T.penalty(p, pin).total };
};
const selected = a => a.q('[data-cdays]').value;
const toggle = (a, enabled) => a.change(`[data-pon="${pluginFile}"]`, enabled);
const withoutPluginState = r => { const out = clone(r); delete out.plugins_off; return out; };
const editColleague = a => a.change('#doctorTable tr[data-i="1"] [data-f="years"]', '12');
const assertInactiveOption = (a, id = flagId) => {
  assert.equal(selected(a), 'flag:'+id, 'inactive saved flag must remain selected instead of falling back to all days');
  const option = a.q('[data-cdays]').selectedOptions[0];
  assert(option.textContent.includes(a.w.T.t('（現在は使わない値）')), 'inactive option explains its status');
};
async function reload(a, r, fn, body = pluginBody) {
  const saved = a.w.localStorage.getItem(key); assert(saved, 'actual settings readback persisted');
  const b = await makeApp(saved, r, r);
  try { register(b, body); await fn(b); assert.deepStrictEqual(b.errors, []); }
  finally { b.dom.window.close(); }
}

let completed = false, passed = 0, failed = 0, highs = null;
process.on('exit', () => { if (!completed) { console.error('FAIL composition inactive-flag regression exited before all cases completed'); process.exitCode = 1; } });
const watchdog = setTimeout(() => { console.error('FAIL composition inactive-flag regression timed out'); process.exit(1); }, 120000);
const tests = [];
const test = (label, state, fn, configure) => tests.push({ label, state, fn, configure });
for (const lang of ['en','ja']) for (const state of ['hard','soft']) test(`${lang} ${state}: plugin off/on preserves one-date condition, solver result and reload`, state, async (a, r) => {
  a.w.T.setLang(lang); a.A.renderSettings(); a.A.readSettings(); a.A.renderSettings();
  const before = clone(a.A.state.rules), month = clone(a.A.state.month), effective = semantics(a);
  assert.deepStrictEqual(effective, {scope:[[7,'night']], violations:0, penalty:0});
  assert.equal(selected(a), 'flag:'+flagId);
  toggle(a, false); assertInactiveOption(a);
  assert(a.q('[data-cdays]').selectedOptions[0].textContent.includes(lang === 'ja' ? '研修' : 'Training'));
  assert.deepStrictEqual(withoutPluginState(a.A.state.rules), before);
  a.A.readSettings(); a.A.readSettings(); assert.deepStrictEqual(withoutPluginState(a.A.state.rules), before);
  toggle(a, true); assert.equal(selected(a), 'flag:'+flagId);
  assert.deepStrictEqual(clone(a.A.state.rules), before); assert.deepStrictEqual(clone(a.A.state.month), month);
  assert.deepStrictEqual(semantics(a), effective);
  if (highs) { const solved = a.w.T.solve(problem(a), highs, {pin:schedule(a), timeLimit:10});
    assert.equal(solved.status, 'Optimal'); assert.equal(solved.objective, 0); }
  await reload(a, r, b => { assert.deepStrictEqual(clone(b.A.state.rules), before); assert.deepStrictEqual(clone(b.A.state.month), month); assert.deepStrictEqual(semantics(b), effective); });
});
for (const state of ['hard','soft']) test(`${state}: unrelated roster edit while plugin is off retains every condition`, state, async (a, r) => {
  a.A.readSettings(); a.A.renderSettings(); const before = clone(a.A.state.rules), month = clone(a.A.state.month);
  toggle(a, false); editColleague(a); assertInactiveOption(a); toggle(a, true);
  before.doctors[1].years = 12; assert.deepStrictEqual(clone(a.A.state.rules), before); assert.deepStrictEqual(clone(a.A.state.month), month);
  assert.deepStrictEqual(semantics(a), {scope:[[7,'night']], violations:0, penalty:0});
  await reload(a, r, b => assert.deepStrictEqual(clone(b.A.state.rules), before));
});
test('initially disabled plugin retains condition across readback and reload', 'hard', async (a, r) => {
  assertInactiveOption(a); const condition = clone(a.A.state.rules.composition), month = clone(a.A.state.month);
  editColleague(a); a.A.readSettings(); assert.deepStrictEqual(clone(a.A.state.rules.composition), condition);
  await reload(a, r, b => { assertInactiveOption(b); assert.deepStrictEqual(clone(b.A.state.rules.composition), condition); assert.deepStrictEqual(clone(b.A.state.month), month); });
  toggle(a, true); assert.equal(selected(a), 'flag:'+flagId); assert.deepStrictEqual(semantics(a).scope, [[7,'night']]);
}, r => { r.plugins_off = [pluginFile]; });
test('a registered when condition hides a flag without replacing its saved reference', 'hard', async a => {
  register(a, `T.dayFlags.register({id:'${flagId}',label:'Training',when:R=>T.ruleState(R,'wish_day')!=='off'});`);
  assert.equal(selected(a), 'flag:'+flagId);
  a.change('[data-ron="wish_day"]', false); assertInactiveOption(a); editColleague(a);
  a.change('[data-ron="wish_day"]', true); assert.equal(selected(a), 'flag:'+flagId);
  assert.deepStrictEqual(semantics(a).scope, [[7,'night']]);
}, r => { r.rule_states.wish_day = 'soft'; });
test('multiple rows preserve only their own inactive reference and escape labels/IDs', 'hard', async a => {
  const special = 'synthetic.<"&flag', label = '<img src=x onerror="bad()"> & Training';
  register(a, pluginBody + `T.dayFlags.register(${JSON.stringify({id:special,label})});`);
  a.A.state.rules.composition.push({shift:'night',days:'flag:'+special,min:1}, {shift:'night',days:'weekdays',max:1});
  a.A.renderSettings(); toggle(a, false);
  const selects = [...a.w.document.querySelectorAll('[data-cdays]')];
  assert.deepStrictEqual(selects.map(el => el.value), ['flag:'+flagId,'flag:'+special,'weekdays']);
  assert.equal(selects[1].querySelector('img'), null, 'label must be text, not injected HTML');
  assert(selects[1].selectedOptions[0].textContent.includes(label));
  assert(![...selects[0].options].some(o => o.value === 'flag:'+special), 'another row\'s inactive flag must not be offered');
  assert(![...selects[2].options].some(o => o.value === 'flag:'+flagId), 'ordinary row options remain unchanged');
  const before = clone(a.A.state.rules.composition); editColleague(a); toggle(a, true); assert.deepStrictEqual(clone(a.A.state.rules.composition), before);
});
for (const choice of ['all','weekdays','off_days','flag:other-training']) test(`intentional selection of ${choice} replaces the inactive reference`, 'hard', async a => {
  register(a, pluginBody); a.w.T.dayFlags.register({id:'other-training',label:'Other training'}); a.A.renderSettings();
  toggle(a, false); assertInactiveOption(a); a.change('[data-cdays]', choice); toggle(a, true);
  assert.equal(selected(a), choice); assert.equal(a.A.state.rules.composition[0].days, choice === 'all' ? undefined : choice);
  a.A.readSettings(); assert.equal(a.A.state.rules.composition[0].days, choice === 'all' ? undefined : choice);
});
test('active flag and ordinary scopes keep existing readback behavior', 'hard', a => {
  a.A.state.rules.composition.push({shift:'night',days:'weekdays',max:1}, {shift:'night',days:'off_days',min:0}, {shift:'night',min:0});
  a.A.renderSettings(); const before = clone(a.A.state.rules.composition); editColleague(a); a.A.readSettings();
  assert.deepStrictEqual(clone(a.A.state.rules.composition), before);
});
test('explicit condition deletion still removes an inactive condition', 'hard', a => {
  toggle(a, false); assertInactiveOption(a); a.click('[data-act="compDel"]');
  assert.deepStrictEqual(clone(a.A.state.rules.composition), []); toggle(a, true); assert.deepStrictEqual(clone(a.A.state.rules.composition), []);
});
(async () => {
  if (process.argv[2]) highs = await require(process.argv[2])();
  else console.log('SKIP solver assertions: pass the installed HiGHS module path');
  for (const {label,state,fn,configure} of tests) {
    let a;
    try { const r = fixture(state); if (configure) configure(r); a = await makeApp(undefined, r, r); register(a);
      await fn(a, r); assert.deepStrictEqual(a.errors, []); passed++; console.log('ok '+label); }
    catch (e) { failed++; console.error('FAIL '+label+'\n'+e.stack); }
    finally { if (a) a.dom.window.close(); }
  }
  assert.equal(passed + failed, 15, 'all planned cases completed'); completed = true; clearTimeout(watchdog);
  console.log(`composition inactive-flag preservation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });
