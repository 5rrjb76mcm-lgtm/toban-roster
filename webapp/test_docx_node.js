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

// 月の表の「休みの日数」は本体の数え方に従う: 明けを休みに数えない設定（ake_is_off:false）では、夜勤の翌日の勤務なしの日を休みに数えない
{ const offCol = xml => { const i = xml.indexOf('勤務回数と休みの日数'); const tail = xml.slice(i); const rows = []; const re = /<w:tr[\s\S]*?<\/w:tr>/g; let mm; while ((mm = re.exec(tail))) { const cells = [...mm[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(x => x[1]); if (cells.length === 3 && /^\d+$/.test(cells[2])) rows.push([cells[0], +cells[1], +cells[2]]); } return rows; };
  const mk = ake => { const r = JSON.parse(JSON.stringify(rules)); r.days_off = Object.assign({}, r.days_off, { ake_is_off: ake }); return new T.Problem(r, month); };
  const rowsT = offCol(T.docxXml(mk(true), asg, '確認版', { today: '2026-01-01T00:00:00Z', template: 'month_table' })), rowsF = offCol(T.docxXml(mk(false), asg, '確認版', { today: '2026-01-01T00:00:00Z', template: 'month_table' }));
  assert(rowsT.length === P.nameOrder.length && rowsF.length === rowsT.length, '人数分の行: ' + rowsT.length);
  const Pt = mk(true), Pf = mk(false), At = new T.Asg(Pt, asg), Af = new T.Asg(Pf, asg);
  const noWork = (Pp, Aa, n) => { let c = 0; for (let d = 1; d <= Pp.N; d++) if (!Pp.slots.some(s => s[0] === d && Aa.worked(n, s))) c++; return c; }; // 勤務の無い日の数（勤務表の従来の数え方）
  const expT = Object.fromEntries(P.nameOrder.map(n => [n, T.rules.checkCtx(Pt, At, 'check', () => { }).offDays(n).length])), expF = Object.fromEntries(P.nameOrder.map(n => [n, T.rules.checkCtx(Pf, Af, 'check', () => { }).offDays(n).length]));
  for (const [n, w, off] of rowsT) assert.strictEqual(off, expT[n], `${n}: 明けを休みに数える設定の休みの日数`); for (const [n, w, off] of rowsF) assert.strictEqual(off, expF[n], `${n}: 明けを休みに数えない設定の休みの日数`);
  const sumT = rowsT.reduce((a, r) => a + r[2], 0), sumF = rowsF.reduce((a, r) => a + r[2], 0), sumNo = P.nameOrder.reduce((a, n) => a + noWork(Pt, At, n), 0);
  assert(sumF < sumT, `明けを除く方が少ない: ${sumF} < ${sumT}`); assert.strictEqual(sumT, sumNo, '明けを休みに数える設定では勤務の無い日の数と一致');
  console.log('docx: 休みの日数は本体の数え方（明けを数える ' + sumT + ' / 数えない ' + sumF + '）OK'); }
// 変更の赤字: 複数名の枠でも、勤務者の集合で比べる（複製した配列・並び順だけの違いは赤字にしない。1 人だけ交代した枠だけ赤字）。説明資料の変更の印とも一致
{ vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/report.js'), 'utf8'), { filename: 'report.js' });
  const two = JSON.parse(fs.readFileSync('data/profiles/two-shift.json', 'utf8')); two.doctors = two.doctors.slice(0, 5); two.name_order = two.doctors.map(d => d.name); two.profile.positions = { work: { count: { day: 2 } } }; T.fillDefaultRules(two);
  for (const def of T.RULE_DEFS) if ((def.states || []).includes('off')) two.rule_states[def.id] = 'off';
  const m2 = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, two), P2 = new T.Problem(two, m2), D = two.doctors.map(d => d.name);
  const a = {}; for (let d = 1; d <= 30; d++) { a[`${d}:day`] = { work: [D[(d - 1) % 5], D[d % 5]], oc: [] }; a[`${d}:night`] = { work: D[(d + 2) % 5], oc: [] }; }
  const reds = (asg2, base2) => (T.docxXml(P2, asg2, '確認版', { today: '2026-01-01T00:00:00Z', template: 'month_table', baseAsg: base2 }).match(/w:val="C00000"/g) || []).length;
  const chg = (asg2, base2) => (JSON.stringify(T.buildReport(P2, asg2, { baseAsg: base2 })).match(/class=\\"chg\\">[^<]/g) || []).length - 0;
  const same = JSON.parse(JSON.stringify(a)); assert.strictEqual(reds(a, same), 0, '同じ割当の複製では赤字 0'); 
  const order = JSON.parse(JSON.stringify(a)); for (let d = 1; d <= 30; d++) order[`${d}:day`].work.reverse(); assert.strictEqual(reds(a, order), 0, '並び順だけの違いは赤字にしない');
  const one = JSON.parse(JSON.stringify(a)); one['9:night'].work = [one['9:night'].work]; assert.strictEqual(reds(a, one), 0, '1 名の文字列と配列の表し方の違いは赤字にしない');
  const swap = JSON.parse(JSON.stringify(a)); swap['5:day'].work = [swap['5:day'].work[0], D.find(n => !swap['5:day'].work.includes(n) && n !== a['5:night'].work)]; const r1 = reds(a, swap); assert(r1 >= 1 && r1 <= 2, '1 人だけ交代した枠だけ赤字: ' + r1);
  const base0 = chg(a, same); assert.strictEqual(chg(a, order), base0, '説明資料も並び順だけでは変更にしない'); assert(chg(a, swap) > base0, '説明資料も交代した枠は変更');
  console.log('docx: 複数名の枠の変更の赤字（複製 0・並び順 0・交代 ' + r1 + '）OK'); }
(async()=>{ const blob=await T.makeDocx(P, asg, '確認版'); const buf=Buffer.from(await blob.arrayBuffer()); fs.writeFileSync(process.argv[2], buf); console.log('written', buf.length, 'bytes'); })();
