// Serial, reproducible feasibility-versus-optimization probe. Fictional ward fixture only.
// node benchmark_diagnose_node.js /path/to/highs [results.json]
// Both modes retain EVERY LP row/domain. The three-second cap is not proof of
// ordinary optimum. Timings are observations, never a correctness assertion.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.T = {};
for (const f of ['i18n.js','rules-core.js','model.js','messages.js','solver.js','check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'),{filename:f});
for (const dir of ['rules','calendars']) for (const f of fs.readdirSync(path.join(__dirname,'src',dir)).filter(f=>f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',dir,f),'utf8'));
T.DEFAULT_RULES=JSON.parse(fs.readFileSync(path.join(__dirname,'data/rules.json'),'utf8'));
const rows=[];
(async()=>{
  const h=await require(process.argv[2])();
  for(const n of [8,16,30])for(const rep of [1,2])for(const mode of ['ordinary-optimization','diagnostic-feasibility']){
    const r=JSON.parse(fs.readFileSync(path.join(__dirname,'data/fixtures/ward-2shift.json'),'utf8'));
    r.doctors=Array.from({length:n},(_,i)=>({...r.doctors[i%r.doctors.length],name:'Synthetic '+String(i+1).padStart(2,'0')}));delete r.name_order;T.fillDefaultRules(r);
    const P=new T.Problem(r,T.normalizeMonth({year:2026,month:11,holidays:[3,23]},r)), built=T.buildLP(P);
    let raw,actualText,solverMs;const adapter={solve(text,opts){actualText=text;const t=performance.now();raw=h.solve(text,opts);solverMs=performance.now()-t;return raw;}};
    const start=performance.now();const res=mode==='ordinary-optimization'?T.solve(P,adapter,{timeLimit:3,mipGap:0}):T.solveFeasibility(P,adapter,{timeLimit:3});
    const wallMs=performance.now()-start;
    assert.strictEqual(actualText.split('Subject To')[1],built.lp.toLP().split('Subject To')[1]);
    let verified=false,violations=null,warnings=null,score=null;
    if(res.asg){
      const values={};for(const [name,d]of built.lp.vars){const rawX=raw.Columns?.[name]?.Primal;assert(Number.isFinite(rawX));const x=Math.round(rawX);assert(Math.abs(x-rawX)<=1e-6);assert(x>=(d.type==='B'?0:d.lb)-1e-6&&x<=(d.type==='B'?1:d.ub)+1e-6);values[name]=x;}
      for(const c of built.lp.cons){const lhs=c.terms.reduce((s,[v,w])=>s+w*values[v],0);assert(!c.trivialFalse);assert(c.sense==='='?Math.abs(lhs-c.rhs)<=1e-6:c.sense==='<='?lhs<=c.rhs+1e-6:lhs>=c.rhs-1e-6);}
      verified=true;const check=T.check(P,res.asg);violations=check.V.length;warnings=check.W.length;score=T.penalty(P,res.asg).total;assert.strictEqual(violations,0);assert.strictEqual(warnings,0);
    }
    if(mode==='diagnostic-feasibility')assert.strictEqual(res.outcome,'feasible');
    const row={n,rep,mode,timeLimit:3,mipGap:0,wallMs,solverMs,reportedSeconds:res.seconds,status:res.status,outcome:res.outcome||null,hasAssignment:!!res.asg,allRowsAndDomainsVerified:verified,vars:res.vars,cons:res.cons,rawObjective:res.objective??null,assignmentScore:score,violationCount:violations,warningCount:warnings};
    rows.push(row);console.log(JSON.stringify(row));
  }
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({node:process.version,highs:'1.15.2',baseCommit:'407f19ab26890b71f171e0e2f3bcda841349826a',rows},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
