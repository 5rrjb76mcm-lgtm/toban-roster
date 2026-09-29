// Python 版（CP-SAT）との突き合わせ。使い方: node test_node.js <Pythonの割当JSON> <highsのパス> [秒] [月別条件JSON]
// 合格の条件（1 つでも外れたら終了コード 1）:
//   1) Python の割当を JS で検算して、必須条件の違反が 0 件
//   2) JS（HiGHS）で解けて、その割当を JS で検算して違反 0 件
//   3) JS の割当を Python で検算して（toban.py check）違反 0 件
//   4) 2 つの割当それぞれを、両方の実装で採点して（全枠を固定して解く）減点の合計が一致する
// 当番表そのものの一致は求めない（最良の解は複数ありうる）。避けたい日の基準回数は両方とも当月目標で採点する
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則の部品
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦の部品
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
const rulesPath = path.join(__dirname, 'data/rules.json');
const monthPath = process.argv[5] || path.join(__dirname, 'data/202611.json');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const month = JSON.parse(fs.readFileSync(monthPath, 'utf8'));
const P = new T.Problem(rules, month);
const PY = path.join(__dirname, '../tools/.venv/bin/python'), TOBAN = path.join(__dirname, '../tools/toban.py');
const sec = +(process.argv[4] || 60);
let fail = 0;
const ok = (cond, label) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) fail = 1; };
const py = args => execFileSync(PY, [TOBAN, ...args, monthPath, '--rules', rulesPath], { encoding: 'utf8', cwd: path.dirname(TOBAN) });
const pyScore = file => { const m = py(['score', '--json', file, '--time', String(sec)]).match(/減点の合計 ([-\d.eE+]+)/); return m ? +m[1] : NaN; };

(async () => {
  const highs = await require(process.argv[3])();
  const jsScore = asg => { const r = T.solve(P, highs, { timeLimit: sec, pin: asg }); return r.status === 'Optimal' ? r.objective : NaN; };
  console.log('slots', P.slots.length, 'periods', P.periods.map(p => p.name).join(', '));
  // 1) Python の割当を JS で検算
  const pyFile = process.argv[2], pyAsg = JSON.parse(fs.readFileSync(pyFile, 'utf8'));
  const r1 = T.check(P, pyAsg); r1.V.forEach(v => console.log('   ', v));
  ok(r1.V.length === 0, `Python の割当を JS で検算: 違反 ${r1.V.length} 件`);
  fs.writeFileSync(path.join(__dirname, 'data/js_metrics_of_py.json'), JSON.stringify(T.metrics(P, r1.A), null, 1));
  // 2) JS で解く
  const res = T.solve(P, highs, { timeLimit: sec });
  console.log('JS solve:', res.status, 'obj', res.objective, 'sec', res.seconds, 'vars', res.vars, 'cons', res.cons);
  if (!res.asg) { ok(false, 'JS で解けない'); T.diagnose(P, highs, 20).forEach(d => console.log('  diag:', d.label, d.note)); process.exit(1); }
  const jsFile = path.join(__dirname, 'data/js_assignment.json');
  fs.writeFileSync(jsFile, JSON.stringify(res.asg, null, 1));
  const r2 = T.check(P, res.asg); r2.V.forEach(v => console.log('   ', v));
  ok(r2.V.length === 0, `JS の割当を JS で検算: 違反 ${r2.V.length} 件`);
  // 3) JS の割当を Python で検算
  const out = py(['check', '--json', jsFile, '--out', path.join(os.tmpdir(), 'toban_js_py_check.md')]);
  const m = out.match(/必須条件の違反 (\d+) 件/); if (!m || +m[1]) console.log(out.trim());
  ok(m && +m[1] === 0, `JS の割当を Python で検算: 違反 ${m ? m[1] : '?'} 件`);
  // 4) 採点の一致（同じ割当なら、どちらの実装で数えても減点の合計は同じはず）
  for (const [label, file, asg] of [['Python の割当', pyFile, pyAsg], ['JS の割当', jsFile, res.asg]]) {
    const a = jsScore(asg), b = pyScore(file);
    ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6, `${label}の減点の合計: JS ${a} / Python ${b}`);
  }
  // 5) 「OC なし」の固定に反する割当: Python の最終の報告でも違反のまま（固定が絡んでも許容に移さない）。全枠を固定して解くと解なし。JS の検算とも一致
  { const jr = P.refId('junior'), key = Object.keys(res.asg).find(k => k.endsWith(':night') && (res.asg[k].oc || []).some(n => P.team[n] === jr)), d = +key.split(':')[0], who = res.asg[key].oc.find(n => P.team[n] === jr);
    const m2 = JSON.parse(JSON.stringify(month)); m2.fixed = m2.fixed || {}; (m2.fixed.night_oc_none = m2.fixed.night_oc_none || {})[d] = [jr]; (m2.fixed.night_oc = m2.fixed.night_oc || {})[d] = [who];
    const mFile = path.join(os.tmpdir(), '202611.json'); fs.writeFileSync(mFile, JSON.stringify(m2)); const py2 = args => { try { return execFileSync(PY, [TOBAN, ...args, mFile, '--rules', rulesPath], { encoding: 'utf8', cwd: path.dirname(TOBAN) }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
    const out2 = py2(['check', '--json', jsFile, '--out', path.join(os.tmpdir(), 'toban_js_py_check2.md')]), mm = out2.match(/必須条件の違反 (\d+) 件/);
    ok(mm && +mm[1] === 1 && /OCなしの固定なのに/.test(out2), `「OC なし」の固定に反する割当を Python で検算: 違反 ${mm ? mm[1] : '?'} 件（許容に移さない）`);
    const vj = T.check(new T.Problem(rules, m2), res.asg); ok(vj.VC.filter(v => v.code === 'FIXED_OC_NONE').length === 1 && vj.V.length === 1, `同じ割当を JS で検算: 違反 ${vj.V.length} 件`);
    ok(/INFEASIBLE/.test(py2(['score', '--json', jsFile, '--time', String(sec)])), 'Python で全枠を固定して解くと解なし'); }
  console.log(fail ? '突き合わせ: 不一致あり' : '突き合わせ: すべて一致');
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(1); });
