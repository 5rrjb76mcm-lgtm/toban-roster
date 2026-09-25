const fs=require('fs'), vm=require('vm'), path=require('path'), assert=require('assert'), {execFileSync}=require('child_process');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'libs/jszip.min.js'),'utf8'), {filename:'jszip.min.js'});
globalThis.T={};
for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','check.js','docxgen.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')), month=JSON.parse(fs.readFileSync('data/202611.json','utf8'));
const asg=JSON.parse(fs.readFileSync('data/js_assignment.json','utf8'));
const P=new T.Problem(rules, month);
const wellFormed = (xml, name) => { const f='/tmp/toban_'+name+'.xml'; fs.writeFileSync(f, xml); execFileSync('xmllint',['--noout',f]); };

// 様式の一覧（同梱の 2 つ）と、規則 docx.template での切り替え
const ids = T.docx.list().map(t=>t.id);
assert(ids.includes('week_block') && ids.includes('month_table'), '同梱の様式: '+ids.join(', '));
const base = T.docxXml(P, asg, '確認版', {today:'2026-01-01T00:00:00Z'});
wellFormed(base, 'week_block');
assert.strictEqual(T.docxXml(P, asg, '確認版', {today:'2026-01-01T00:00:00Z', template:'week_block'}), base, '既定は week_block');
const mt = T.docxXml(P, asg, '確認版', {today:'2026-01-01T00:00:00Z', template:'month_table'});
wellFormed(mt, 'month_table');
assert.notStrictEqual(mt, base, '様式を変えると中身が変わる');
assert(/w:pgSz w:w="11906"/.test(mt), 'month_table の既定は A4 縦');
assert(/w:pgSz w:w="16838"/.test(base), 'week_block の既定は A3 縦');
// 用紙の指定（規則 docx.paper）
{ const r2=JSON.parse(JSON.stringify(rules)); r2.docx={paper:{size:'A4',orient:'landscape'}};
  const xml=T.docxXml(new T.Problem(r2, month), asg, '確認版', {today:'2026-01-01T00:00:00Z'});
  assert(/w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/.test(xml), '用紙の指定が効く'); }
// 施設が足した様式が一覧と出力に出る
T.docx.register('test_plain', (Pp, A, c) => c.para('ようし', 24) + c.sect({size:'A4', orient:'portrait'}), {label:'試験用'});
assert(T.docx.list().some(t=>t.id==='test_plain'), '登録した様式が一覧に出る');
{ const xml=T.docxXml(P, asg, '確認版', {template:'test_plain'}); wellFormed(xml,'plain'); assert(/ようし/.test(xml)); }
// 知らない様式は既定に落ちる（設定を壊さない）
assert.throws(() => T.docxXml(P, asg, '確認版', {today:'2026-01-01T00:00:00Z', template:'no_such'}), /no_such/, '無い様式は黙って既定に落とさず止まる（施設のプラグインの欠落に気付けるように）');
console.log('docx: 様式の切り替えと用紙の指定 OK（'+ids.join(', ')+'）');

(async()=>{ const blob=await T.makeDocx(P, asg, '確認版'); const buf=Buffer.from(await blob.arrayBuffer()); fs.writeFileSync(process.argv[2], buf); console.log('written', buf.length, 'bytes'); })();
