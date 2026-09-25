// 曜日パターン→日別展開の等価性と、日別モードでの解の一致を確認
const fs=require('fs'), vm=require('vm'), path=require('path');
globalThis.T={};
for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','solver.js','check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')), month=JSON.parse(fs.readFileSync('data/202611.json','utf8'));
const P1=new T.Problem(rules, month);
const dd=T.expandDuties(rules, month);
const month2=Object.assign({}, month, {duty_days: dd});
const P2=new T.Problem(rules, month2);
let diff=0, cnt=0;
for (const n of P1.names) for (let d=1; d<=P1.N; d++) for (const part of ['am','pm']) { const a=P1.dutyItems(n,d,part).map(i=>i.kind).join(','), b=P2.dutyItems(n,d,part).map(i=>i.kind).join(','); if (a!==b) { diff++; if (diff<5) console.log('diff',n,d,part,a,b); } if (a) cnt++; }
console.log('duty half-days:',cnt,'differences:',diff);
console.log('sample duty_days Dr E:', JSON.stringify(dd['Dr E']));
(async()=>{
  const highs=await require(process.argv[2])();
  const r=T.solve(P2, highs, {timeLimit:60});
  console.log('solve in day mode:', r.status, 'obj', r.objective, 'sec', r.seconds);
  const chk=T.check(P2, r.asg); console.log('violations', chk.V.length);
  fs.writeFileSync('data/202611_daymode.json', JSON.stringify(month2,null,1));
  fs.writeFileSync('data/js_assignment_daymode.json', JSON.stringify(r.asg,null,1));
})();
