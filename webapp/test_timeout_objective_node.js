// Raw MILP incumbent objective is not necessarily the minimized score of its assignment.
// Synthetic fixtures only; node test_timeout_objective_node.js /path/to/highs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), {filename:f});
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(__dirname, 'src', dir)).filter(f => f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', dir, f), 'utf8'));
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'));
T.DEFAULT_RULES = read('rules.json');
const close = (a,b) => assert(Math.abs(a-b) < 1e-6, `${a} != ${b}`);
let passed=0;
async function test(label, fn) { await fn(); console.log('ok '+label); passed++; }
(async()=>{
 const highs=await require(process.argv[2])();
 const rules=read('fixtures/ward-2shift.json'); rules.rule_states.wish_day='soft'; T.fillDefaultRules(rules);
 const [a,b]=rules.doctors.map(d=>d.name);
 const month=T.normalizeMonth({year:2026,month:11,holidays:[3,23],wishes:{day_on:{[a]:[4,5],[b]:[4]}}},rules);
 const P=new T.Problem(rules,month), built=T.buildLP(P), capture=read('timeout_incumbent_test.json');
 const raw={Status:capture.status,ObjectiveValue:capture.objective,Columns:Object.fromEntries([...built.lp.vars].map(([v])=>[v,{Primal:capture.nonzero[v]||0}]))};
 const val=v=>raw.Columns[v]?.Primal||0;
 let res;
 await test('captured incumbent satisfies every LP constraint and variable domain',()=>{
  for(const [v,d] of built.lp.vars){const x=val(v); close(x,Math.round(x)); assert(x >= (d.type==='B'?0:d.lb)-1e-6 && x <= (d.type==='B'?1:d.ub)+1e-6,v);}
  for(const c of built.lp.cons){const lhs=c.terms.reduce((s,[v,w])=>s+w*val(v),0);assert(c.sense==='='?Math.abs(lhs-c.rhs)<1e-6:c.sense==='<='?lhs<=c.rhs+1e-6:lhs>=c.rhs-1e-6,JSON.stringify(c));}
  close([...built.lp.obj].reduce((s,[v,w])=>s+w*val(v),0),raw.ObjectiveValue);
 });
 await test('sync timeout retains raw objective, status and configured tolerance',()=>{
  res=T.solve(P,{solve:()=>raw}); assert(res.asg); assert.strictEqual(res.status,'Time limit reached'); close(res.objective,3945); close(T.penalty(P,res.asg).total,1280); assert.strictEqual(res.gap,0.05); assert.deepStrictEqual(T.check(P,res.asg).V,[]);
 });
 await test('worker/Promise postprocessing has identical semantics',async()=>{
  const r=await T.solve(P,{solve:async()=>raw}); assert.deepStrictEqual(r.asg,res.asg); assert.strictEqual(r.objective,res.objective);assert.strictEqual(r.status,res.status);assert.strictEqual(r.gap,res.gap);
 });
 await test('same assignment optimizes to its independently recounted penalty',()=>{
  const r=T.solve(P,highs,{pin:res.asg,timeLimit:20,mipGap:0}); assert.strictEqual(r.status,'Optimal'); assert.deepStrictEqual(r.asg,res.asg);close(r.objective,1280);close(r.objective,T.penalty(P,r.asg).total);
 });
 await test('fractional work incumbent is rejected, no objective normalization',()=>{
  const bad=JSON.parse(JSON.stringify(raw));bad.Columns[Object.values(built.work)[0]].Primal=0.5;const r=T.solve(P,{solve:()=>bad});assert.strictEqual(r.asg,null);assert.strictEqual(r.objective,res.objective);
 });
 await test('missing incumbent remains absent',()=>{const r=T.solve(P,{solve:()=>({Status:'Time limit reached'})});assert.strictEqual(r.asg,null);assert.strictEqual(r.objective,undefined);});
 const N=['Synthetic Alpha','Synthetic Beta'];
 function small(target=15.5, avoid=true){
  const R={profile:{id:'timeout-context',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'none'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15,years:1}))};
  T.fillDefaultRules(R);for(const d of T.RULE_DEFS)if(d.states.includes('off'))R.rule_states[d.id]='off';
  R.rule_states.quota_target='soft';R.weights.target_deviation=0.001; R.rule_states.dayoff_work_cap='soft';R.dayoff_work_max={[N[0]]:0};
  if(avoid)R.rule_states.avoid_days='soft';
  const M=T.normalizeMonth({year:2026,month:11,targets:{[N[0]]:target,[N[1]]:30-target},avoid:avoid?[{name:N[0],day:1,part:'night'}]:[]},R);
  const p=new T.Problem(R,M),pin=Object.fromEntries(p.slots.map((slot,i)=>[T.Problem.key(slot),{work:N[i<15?0:1],oc:[]}]));return {p,pin};
 }
 for(const target of [15.5,15.0000001])for(const avoid of [false,true])for(const context of ['normal','reference','floor','base'])await test(`matching score context: target ${target}, avoid ${avoid}, ${context}`,()=>{
  const {p,pin}=small(target,avoid),opts={pin,timeLimit:10,mipGap:0};
  if(context==='reference')opts.ignoreAvoid=true;if(context==='floor')opts.avoidRef={[N[0]]:16.25};if(context==='base'){opts.base=pin;opts.ignoreAvoid=true;}
  const r=T.solve(p,highs,opts);assert.strictEqual(r.status,'Optimal');close(r.objective,T.penalty(p,r.asg,opts).total);
  if(context==='reference')assert(!T.penalty(p,r.asg,opts).items.dayoff_work_excess);
  if(context==='base')assert(r.objective<0,'base-change convention may be negative');
 });
 await test('two-stage reference uses assignment counts even when raw objectives retain slack',async()=>{
  const {p,pin}=small(),calls=[];const adapter={solve(text,opts){const raw=highs.solve(text,opts);calls.push(raw);return Promise.resolve({...raw,Status:'Time limit reached',ObjectiveValue:raw.ObjectiveValue+100});}};
  const r=await T.solveWithAvoidRef(p,adapter,{pin,timeLimit:10,mipGap:0});assert.strictEqual(calls.length,2);assert.strictEqual(r.avoidRef[N[0]],15);assert.strictEqual(r.status,'Time limit reached');close(r.objective-T.penalty(p,r.asg,{avoidRef:r.avoidRef}).total,100);
 });
 await test('relaxed and jitter objectives remain raw, not overwritten with full-rule scores',()=>{
  for(const opts of [{relax:['quota']},{jitter:{seed:1,scale:20}}]){const r=T.solve(P,{solve:()=>raw},opts);assert.strictEqual(r.objective,res.objective);}
 });
 console.log(`ALL OK (${passed})`);
})().catch(e=>{console.error(e);process.exitCode=1;});
