// Preserve accepted previous-month dates through unrelated month settings edits.
// Synthetic data only. jsdom supplies DOM semantics; no browser, network or file APIs run.
// TOBAN_WEBAPP_ROOT selects an unmodified webapp tree for baseline reproduction.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, names = ['Synthetic Alpha', 'Synthetic Beta'];
console.log('SOURCE_ROOT ' + JSON.stringify(path.resolve(root)));
const copy = x => JSON.parse(JSON.stringify(x)), stateKey = 'toban_state_v2:/synthetic/month-history-readback.html';
const files = ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'app-core.js', 'app-folder.js', 'app-input.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f)];
function app(month = {}, configure = () => {}) {
  const dom = new JSDOM('<div id="monthSettings"></div><div id="doctorPane" hidden></div><div id="fixedPane" hidden></div>', { url: 'https://example.invalid/synthetic/month-history-readback.html', runScripts: 'outside-only' }), w = dom.window, errors = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  for (const f of files) w.eval(fs.readFileSync(path.join(root, 'src', f), 'utf8') + '\n//# sourceURL=' + f);
  const T = w.T, A = T.app, R = { profile: { id: 'synthetic-history-readback', calendar: { holidays: 'none', closure: [] }, roles: [{ id: 'S', refs: ['charge'] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map((name, i) => ({ name, team: 'S', quota: i ? 30 : 0 })), quota_tolerance: 1, rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off'; R.rule_states.period_charge = 'hard'; configure(R);
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, duty_days: {}, ...copy(month) }, R);
  Object.assign(A.state, { rules: R, month: M, result: null }); A.renderHeader = () => {}; A.toast = () => {};
  A.bindSettingsMonth(); A.renderSettingsMonth();
  const q = s => w.document.querySelector(s), input = attr => q(`[data-${attr}="${names[0]}"]`);
  const change = (el, v, kind = 'change') => { el.value = v; el.dispatchEvent(new w.Event(kind, { bubbles: true })); assert.deepEqual(errors, []); };
  const saved = () => JSON.parse(w.localStorage.getItem(stateKey));
  return { dom, w, T, A, R, M, q, input, change, saved, errors, close: () => { assert.deepEqual(errors, []); w.close(); } };
}
let passed=0, failed=0, completed=false;
const expected=17;
process.on('exit',()=>{if(!completed||passed+failed!==expected)process.exitCode=1;});
function test(label,fn){let f;try{f=fn();passed++;console.log('PASS '+label);}catch(e){failed++;console.error('FAIL '+label+'\n'+e.stack);}finally{f?.close();}}
for(const oc of [true,false])for(const value of [31,'31',' 31 ','+31','0x1f','3.1e1']) {
 test(`date ${JSON.stringify(value)} / OC visible ${oc}`,()=>{
  const previous={last_weekend_charge:null,prev_weekend_charge:null,last_days:[{date:value, night:names[0], night_oc:[names[1]], local_synthetic:'keep me'}]};
  const f=app({prev_month:previous},R=>R.rule_states.oncall=oc?'hard':'off');
  try{
   const before=JSON.stringify(f.M.prev_month), P=new f.T.Problem(f.R,f.M);
   assert(P.prevFixed['0:night'],'model accepts this numeric date');
   f.change(f.q('[data-path="notes"]'),'Synthetic unrelated memo');
   assert.equal(JSON.stringify(f.M.prev_month),before,'unrelated edit preserves original previous record');
   assert(new f.T.Problem(f.R,f.M).prevFixed['0:night'],'boundary assignment survives');
   assert.equal(f.q('tr[data-ld="0"] [data-f="date"]').value,'31','accepted numeric spellings have a visible projection');
   for(let i=0;i<2;i++){f.A.readAll();f.A.renderSettingsMonth();assert.equal(JSON.stringify(f.M.prev_month),before);}
   assert.equal(JSON.stringify(JSON.parse(f.A.payloadJson()).month.prev_month),before);
   const reloaded=app(JSON.parse(f.A.payloadJson()).month);try{reloaded.A.readAll();assert.equal(JSON.stringify(reloaded.M.prev_month),before);}finally{reloaded.close();}
  }finally{f.close();}
 });
}
for(const event of ['input','change'])test('explicit '+event+' date edit, clear and repeated readback',()=>{
 const f=app({prev_month:{last_days:[{date:' 31 ',night:names[0],night_oc:[names[1]],local_synthetic:'retain'}]}});
 try{
  const el=f.q('tr[data-ld="0"] [data-f="date"]'); f.change(el,'30',event); f.A.readAll();
  assert.equal(f.M.prev_month.last_days[0].date,30);assert.equal(f.M.prev_month.last_days[0].local_synthetic,'retain');
  f.change(el,'',event);f.A.readAll();assert.deepEqual(copy(f.M.prev_month.last_days),[]);
  f.A.renderSettingsMonth();f.A.readAll();assert.deepEqual(copy(f.M.prev_month.last_days),[],'cleared row does not resurrect');
 }finally{f.close();}
});
test('empty rendered rows do not acquire dates',()=>{const f=app();try{f.change(f.q('[data-path="notes"]'),'Synthetic memo');assert.deepEqual(copy(f.M.prev_month.last_days),[]);}finally{f.close();}});
test('undisplayable imported date is preserved until explicit clear',()=>{
 const entry={date:'synthetic-invalid-date',night:names[0]},f=app({prev_month:{last_days:[entry]}});
 try{f.change(f.q('[data-path="notes"]'),'Synthetic memo');assert.deepEqual(copy(f.M.prev_month.last_days),[entry]);f.change(f.q('tr[data-ld="0"] [data-f="date"]'),'');assert.deepEqual(copy(f.M.prev_month.last_days),[]);}finally{f.close();}
});
test('same-date source rows retain their own extension and historical names',()=>{
 const entries=[{date:' 31 ',night:names[0],local_synthetic:'one'},{date:31,night:names[1],local_synthetic:'two'}],f=app({prev_month:{last_days:entries}});
 try{f.change(f.q('[data-path="notes"]'),'Synthetic memo');assert.deepEqual(copy(f.M.prev_month.last_days),entries);}finally{f.close();}
});
completed=true;console.log(`ACCOUNTING ${passed} passed, ${failed} failed, ${expected} expected`);if(failed||passed+failed!==expected)process.exitCode=1;
