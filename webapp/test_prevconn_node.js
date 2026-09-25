const fs=require('fs'), vm=require('vm'), path=require('path');
globalThis.T={}; for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','solver.js','check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')), month=JSON.parse(fs.readFileSync('data/202611.json','utf8'));
const m=JSON.parse(JSON.stringify(month)); delete m.fixed.weekend_charge; // 固定指定なし、前月末の接続だけ
const P=new T.Problem(rules, m);
(async()=>{ const highs=await require(process.argv[2])(); const r=T.solve(P,highs,{timeLimit:60}); const c=T.check(P,r.asg);
  console.log('status', r.status, 'violations', c.V.length, c.V.slice(0,3), '11/1 charge:', c.charge[0]);
  fs.writeFileSync('data/202611_noconnfix.json', JSON.stringify(m,null,1)); fs.writeFileSync('data/js_assignment_noconnfix.json', JSON.stringify(r.asg,null,1));
  // 前月末の担当者が1日不可のとき lint が出るか
  const m2=JSON.parse(JSON.stringify(m)); m2.unavailable_night['Dr G']=[1]; console.log('lint:', T.lint(new T.Problem(rules,m2)).map(x=>x.msg));
})();
