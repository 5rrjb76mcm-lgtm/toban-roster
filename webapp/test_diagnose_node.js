// Diagnosis is a feasibility question, not an objective optimization. Fictional data only.
// node test_diagnose_node.js /path/to/highs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), {filename:f});
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(__dirname, 'src', dir)).filter(f => f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', dir, f), 'utf8'));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/rules.json'), 'utf8'));
const copy = x => JSON.parse(JSON.stringify(x));
function fixture(n = 3, count = 1, unavailable = 0, patch = () => {}) {
  const names = Array.from({length:n}, (_,i) => 'Synthetic ' + (i+1));
  const r = {profile:{id:'fictional-diagnosis', roles:[{id:'S',refs:[],standby:false}], shifts:[{id:'day',on:'none'},{id:'night',on:'all'}], positions:{work:{count}}, quota_mode:'absolute'}, doctors:names.map(name => ({name,team:'S',quota:10}))};
  T.fillDefaultRules(r); for (const d of T.RULE_DEFS) if (d.states.includes('off')) r.rule_states[d.id] = 'off';
  patch(r);
  const m = T.normalizeMonth({year:2026,month:11,unavailable_night:Object.fromEntries(names.slice(0,unavailable).map(n => [n,[1]]))}, r);
  return new T.Problem(r,m);
}
let passed = 0;
async function test(label, fn) { await fn(); console.log('ok ' + label); passed++; }
(async () => {
  const highs = await require(process.argv[2])();
  const P = fixture(3,1,2), raw = highs.solve(T.buildLP(P).lp.toLP(), {time_limit:3,output_flag:false});
  assert.strictEqual(raw.Status, 'Optimal');
  await test('zero objective changes no constraints, domains, plugin hooks or normal optimization', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname,'data/fixtures/ward-2shift.json'),'utf8'));
    T.fillDefaultRules(rules); const p = new T.Problem(rules,T.normalizeMonth({year:2026,month:11,holidays:[3,23]},rules));
    const opts = {relax:['quota'],timeLimit:3,base:{'1:night':{work:p.dutyNames[0],oc:[]}},jitter:{seed:5,scale:2}};
    const original = T.buildLP(p,opts).lp.toLP(); let zeroText, normalText, zeroOpts, normalOpts;
    const adapter = (setter) => ({solve(text,o) { setter(text,o); return {Status:'Infeasible'}; }});
    T.solveFeasibility(p,adapter((text,o) => {zeroText=text;zeroOpts=o;}),opts);
    T.solve(p,adapter((text,o) => {normalText=text;normalOpts=o;}),opts);
    assert.strictEqual(normalText,original); assert.strictEqual(zeroText.split('Subject To')[1],original.split('Subject To')[1]);
    assert.match(zeroText,/^Minimize\n obj: 0 /); assert.notStrictEqual(zeroText,original);
    assert.strictEqual(zeroOpts.mip_rel_gap,0); assert.strictEqual(normalOpts.mip_rel_gap,rules.solver.mip_rel_gap);
    assert(!('mip_max_improving_sols' in zeroOpts)); assert.strictEqual(zeroOpts.time_limit,3);
  });
  for (const status of ['Optimal','Time limit reached','Unknown','Solution limit reached']) for (const async of [false,true]) await test(`${status}: complete valid witness accepted (${async?'Promise':'sync'})`, async () => {
    const sol = {...raw,Status:status}; const r = await T.solveFeasibility(P,{solve:() => async ? Promise.resolve(sol) : sol});
    assert.strictEqual(r.outcome,'feasible'); assert.strictEqual(r.status,status); assert(r.asg); assert.strictEqual(T.check(P,r.asg).V.length,0); assert(!('objective' in r));
  });
  for (const status of ['Optimal','Time limit reached','Unknown','Solve error','Primal infeasible or unbounded']) await test(`${status}: no witness remains undecided`, async () => {
    const r = await T.solveFeasibility(P,{solve:() => ({Status:status})}); assert.strictEqual(r.outcome,'undecided'); assert.strictEqual(r.status,status); assert.strictEqual(r.asg,null);
  });
  await test('only exact Infeasible is accepted as proof', async () => { const r = await T.solveFeasibility(P,{solve:() => ({Status:'Infeasible',Columns:raw.Columns})}); assert.strictEqual(r.outcome,'infeasible'); assert.strictEqual(r.asg,null); });
  const first = Object.keys(raw.Columns)[0];
  for (const [label,edit] of [
    ['fractional',s => {s.Columns[first].Primal=0.5;}],
    ['out-of-domain',s => {s.Columns[first].Primal=2;}],
    ['missing-column',s => {delete s.Columns[first];}],
    ['nonfinite',s => {s.Columns[first].Primal=NaN;}],
    ['infinite',s => {s.Columns[first].Primal=Infinity;}],
    ['string',s => {s.Columns[first].Primal='0';}],
    ['row-violation',s => {for(const v of Object.keys(s.Columns))s.Columns[v].Primal=0;}]
  ]) await test(`${label} witness rejected even with Optimal status`, async () => {
    const bad = copy(raw); edit(bad); const r = await T.solveFeasibility(P,{solve:() => bad}); assert.strictEqual(r.outcome,'undecided'); assert.strictEqual(r.reason,'invalid-witness'); assert.strictEqual(r.asg,null);
  });
  await test('near integer witness is rounded and rows revalidated', async () => {
    const good=copy(raw);for(const col of Object.values(good.Columns))col.Primal += 1e-8;
    const r=await T.solveFeasibility(P,{solve:()=>good});assert.strictEqual(r.outcome,'feasible');assert.strictEqual(T.check(P,r.asg).V.length,0);
  });
  for (const async of [false,true]) await test(`errors distinct from cancel (${async?'Promise':'sync'})`, async () => {
    const r = await T.solveFeasibility(P,{solve:() => {if(async)return Promise.reject(new Error('fixture failure'));throw new Error('fixture failure');}});
    assert.strictEqual(r.outcome,'undecided'); assert.strictEqual(r.reason,'error'); assert.strictEqual(r.error,'fixture failure');
    await assert.rejects(async () => await T.solveFeasibility(P,{solve:() => {if(async)return Promise.reject(new Error('中止しました'));throw new Error('中止しました');}}), /中止/);
  });
  T.RELAXATIONS = [['unavailable','Unavailable']];
  const joint = fixture(2,2,2);
  await test('both unavailable staff must be relaxed together; full-rule check cannot validate relaxed witness', async () => {
    assert.strictEqual(T.solve(joint,highs,{timeLimit:3}).status,'Infeasible');
    const relaxed = T.solveFeasibility(joint,highs,{relax:['unavailable'],timeLimit:3}); assert.strictEqual(relaxed.outcome,'feasible'); assert(T.check(joint,relaxed.asg).V.length > 0);
    const d = await T.diagnose(joint,highs,3); assert.strictEqual(d.length,1); assert.strictEqual(d[0].combined,true); assert.strictEqual(d[0].items.length,2); assert.strictEqual(d[0].incomplete,false);
    for(const item of d[0].items) {assert.strictEqual(item.undecided,false);assert.strictEqual(item.status,'Infeasible');assert.strictEqual(T.solveFeasibility(joint,highs,{relax:[item.key],timeLimit:3}).outcome,'infeasible');}
    assert.strictEqual(T.solveFeasibility(joint,highs,{relax:d[0].items.map(c=>c.key),timeLimit:3}).outcome,'feasible');
  });
  for (const status of ['Time limit reached','Unknown','Solve error','Primal infeasible or unbounded']) await test(`narrowing ${status} is not a confirmed conflict`, async () => {
    let calls=0; const d=await T.diagnose(P,{solve:(s,o)=>++calls<=2?highs.solve(s,o):{Status:status}},3);
    assert.strictEqual(calls,4); assert.strictEqual(d[0].combined,true); assert.strictEqual(d[0].incomplete,true); assert.strictEqual(d[0].items.length,2);
    assert(d[0].items.every(c=>c.undecided && c.status===status));
  });
  await test('thrown narrowing errors remain unresolved with their error message', async () => {
    let calls=0;const d=await T.diagnose(P,{solve:(s,o)=>{if(++calls<=2)return highs.solve(s,o);throw new Error('fixture detail error');}},3);
    assert(d[0].items.every(c=>c.undecided && c.reason==='error' && c.error==='fixture detail error'));
  });
  await test('unknown candidate baseline does not inherit unrelated group witness', async () => {
    let calls=0;const d=await T.diagnose(P,{solve:(s,o)=>++calls===1?highs.solve(s,o):{Status:'Unknown'}},3);
    assert.strictEqual(calls,2); assert.strictEqual(d[0].combined,undefined);assert.strictEqual(d[0].items.length,0);assert.strictEqual(d[0].narrowing.outcome,'undecided');
  });
  await test('feasible restoring trials can remove every candidate', async () => {
    const d=await T.diagnose(P,{solve:async(s,o)=>highs.solve(s,o)},3);assert.strictEqual(d[0].combined,true);assert.deepStrictEqual(d[0].items,[]);assert.strictEqual(d[0].incomplete,false);
  });
  await test('plugin group relaxation need not implement person-specific relaxation', async () => {
    T.rules.register({id:'local.diagnose.group',api:1,states:['hard','off'],def:'off',relax:'duties',solve(ctx){ctx.lp.add(0,'=',1);},check(){}});
    const p=fixture(2,1,0,r=>r.rule_states['local.diagnose.group']='hard'); T.RELAXATIONS=[['duties','Duties']];
    const d=await T.diagnose(p,highs,3);assert.strictEqual(d[0].combined,undefined);assert.strictEqual(d[0].items.length,0);assert.strictEqual(d[0].narrowing.outcome,'infeasible');
    T.rules.unregister('local.diagnose.group');T.RELAXATIONS=[['unavailable','Unavailable']];
  });
  await test('plugin auxiliary bounds and rows survive zero-objective mode', async () => {
    T.rules.register({id:'local.diagnose.aux',api:1,states:['hard','off'],def:'off',solve(ctx){const v=ctx.lp.auxInt('diag_aux',-2,3);ctx.lp.add(v,'=',2);ctx.lp.objAdd(17,v);},check(){}});
    const p=fixture(3,1,0,r=>r.rule_states['local.diagnose.aux']='hard');let capture;
    const r=T.solveFeasibility(p,{solve:(s,o)=>(capture=highs.solve(s,o))},{timeLimit:3});assert.strictEqual(r.outcome,'feasible');
    const name=Object.keys(capture.Columns).find(v=>v.startsWith('diag_aux'));assert(name);const bad=copy(capture);bad.Columns[name].Primal=0;
    assert.strictEqual(T.solveFeasibility(p,{solve:()=>bad}).reason,'invalid-witness');bad.Columns[name].Primal=4;assert.match(T.solveFeasibility(p,{solve:()=>bad}).detail,/domain/);
    T.rules.unregister('local.diagnose.aux');
  });
  await test('zero total budget yields explicit untested groups and makes no solver calls', async () => {
    let calls=0;const progress=[];const d=await T.diagnose(P,{solve:()=>{calls++;}},3,p=>progress.push(p),{totalTimeLimit:0});
    assert.strictEqual(calls,0);assert.strictEqual(d[0].undecided,true);assert.strictEqual(d[0].reason,'budget');assert.strictEqual(progress[0].remainingSeconds,0);
  });
  await test('per-trial budget clamps to remaining and stops after exhaustion', async () => {
    const now=Date.now;let clock=1000;Date.now=()=>clock;
    try {const limits=[],progress=[];const d=await T.diagnose(P,{solve:(s,o)=>{limits.push(o.time_limit);const raw=highs.solve(s,o);clock+=1500;return raw;}},3,p=>progress.push(p),{totalTimeLimit:2});
      assert.deepStrictEqual(limits,[2,0.5]);assert.strictEqual(d[0].combined,true);assert(d[0].items.every(c=>c.undecided && c.reason==='budget'));assert.strictEqual(d[0].incomplete,true);
      assert(progress.every(p=>p.remainingSeconds>=0 && p.timeLimit<=p.remainingSeconds));
    } finally {Date.now=now;}
  });
  await test('later untested groups remain explicit after an infeasible proof consumes budget', async () => {
    const now=Date.now;let clock=0;Date.now=()=>clock;T.RELAXATIONS=[['unavailable','Unavailable'],['fixed','Fixed']];
    try {let calls=0;const d=await T.diagnose(P,{solve:()=>{calls++;clock+=2000;return {Status:'Infeasible'};}},3,null,{totalTimeLimit:1});
      assert.strictEqual(calls,1);assert.strictEqual(d.length,1);assert.strictEqual(d[0].key,'fixed');assert.strictEqual(d[0].reason,'budget');assert.strictEqual(d[0].undecided,true);
    } finally {Date.now=now;T.RELAXATIONS=[['unavailable','Unavailable']];}
  });
  await test('model building uses budget; expiration never falls back to 60 seconds', async () => {
    const now=Date.now;let clock=0;Date.now=()=>clock;
    T.rules.register({id:'local.diagnose.clock',api:1,states:['hard','off'],def:'off',solve(){clock+=2000;},check(){}});
    try {const p=fixture(3,1,0,r=>r.rule_states['local.diagnose.clock']='hard');let calls=0;const d=await T.diagnose(p,{solve:()=>{calls++;}},3,null,{totalTimeLimit:1});assert.strictEqual(calls,0);assert.strictEqual(d[0].reason,'budget');}
    finally {Date.now=now;T.rules.unregister('local.diagnose.clock');}
  });
  await test('invalid budgets reject explicitly; progress callback errors do not alter diagnosis', async () => {
    await assert.rejects(()=>T.diagnose(P,highs,0),/budget/);await assert.rejects(()=>T.diagnose(P,highs,3,null,{totalTimeLimit:Infinity}),/budget/);
    const d=await T.diagnose(P,highs,3,()=>{throw new Error('UI callback');});assert.strictEqual(d[0].combined,true);
  });
  console.log(`ALL OK (${passed})`);
})().catch(e=>{console.error(e);process.exitCode=1;});
