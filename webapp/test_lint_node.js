const fs=require('fs'), vm=require('vm'), path=require('path');
globalThis.T={};
for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','solver.js','check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')), month=JSON.parse(fs.readFileSync('data/202611.json','utf8'));
// 矛盾を作る: Dr F 11/6 夜間不可（固定夜勤と衝突）、Dr J 11/8 に日勤固定だが 11/8 終日不可
const m=JSON.parse(JSON.stringify(month)); m.unavailable_night['Dr F']=[6,7]; m.fixed.day={8:'Dr J'}; m.unavailable_other=[{name:'Dr J',day:8,part:'allday'}];
const P=new T.Problem(rules, m);
console.log('--- lint ---'); T.lint(P).forEach(x=>console.log('●',x.msg,'\n   →',x.hint));
console.log('--- lint on clean sample ---', T.lint(new T.Problem(rules, month)).length, 'items');
(async()=>{ const highs=await require(process.argv[2])(); const r=T.solve(P,highs,{timeLimit:30}); console.log('solve:',r.status);
  if(!r.asg){ const diag=T.diagnose(P,highs,15); for(const d of diag){ console.log('-',d.label,d.note); (d.items||[]).forEach(it=>console.log('   ●',it.label,'→',it.hint)); } } })();
