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
  // 6) 翌月 1 日の固定（勤務だけ・OC だけ。日勤・夜勤）: Python が例外で止まらず、JS と同じ判定（解の有無と減点の合計）になる。OC を含む連続だけを減点する
  { const N = P.N, a = res.asg, wN = [].concat(a[`${N}:night`].work)[0], ocN = (a[`${N}:night`].oc || [])[0], busy = new Set([wN, ...(a[`${N}:night`].oc || []), ...[].concat((a[`${N}:day`] || {}).work || []), ...((a[`${N}:day`] || {}).oc || [])]);
    const free = P.dutyNames.find(n => !busy.has(n) && !P.isRole(n, 'reserve')), freeOc = P.dutyNames.find(n => !busy.has(n) && P.isStandby(n));
    const cases = [['夜勤だけ固定（月末に入っていない人）', { night: { [N + 1]: free } }, {}], ['夜間 OC だけ固定（月末に入っていない人）', { night_oc: { [N + 1]: [freeOc] } }, {}], ['夜間 OC だけ固定（月末の夜勤の人: 勤務→OC）', { night_oc: { [N + 1]: [wN] } }, {}],
      ...(ocN ? [['夜勤だけ固定（月末の夜間 OC の人: OC→勤務）', { night: { [N + 1]: ocN } }, {}]] : []), ['日勤だけ固定（翌月 1 日が休日）', { day: { [N + 1]: free } }, { next_month_first_day_is_holiday: true }], ['日勤 OC だけ固定（翌月 1 日が休日）', { day_oc: { [N + 1]: [freeOc] } }, { next_month_first_day_is_holiday: true }]];
    for (const [label, fx, extra] of cases) { const m2 = Object.assign(JSON.parse(JSON.stringify(month)), extra); m2.fixed = m2.fixed || {}; for (const [k, v] of Object.entries(fx)) m2.fixed[k] = Object.assign({}, m2.fixed[k], v);
      const mFile = path.join(os.tmpdir(), '202611.json'); fs.writeFileSync(mFile, JSON.stringify(m2)); let out; try { out = execFileSync(PY, [TOBAN, 'score', '--json', jsFile, '--time', String(sec), mFile, '--rules', rulesPath], { encoding: 'utf8', cwd: path.dirname(TOBAN), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
      const mm = out.match(/採点: 状態 (\w+)、減点の合計 ([-\d.eE+]+|None)/); let js; try { js = T.solve(new T.Problem(rules, m2), highs, { timeLimit: sec, pin: a }); } catch (e) { js = { status: 'Error: ' + e.message }; }
      const pyOk = mm && mm[1] === 'OPTIMAL', jsOk = js.status === 'Optimal';
      ok(!/Traceback/.test(out) && mm && pyOk === jsOk && (!pyOk || Math.abs(+mm[2] - js.objective) < 1e-6), `翌月 1 日の${label}: JS ${js.status}${jsOk ? ' ' + js.objective : ''} / Python ${mm ? mm[1] + (pyOk ? ' ' + mm[2] : '') : '例外: ' + out.trim().split('\n').pop()}`); } }
  // 7) 休日の期間責任者が日の途中で交代する割当（夜間の期間責任者の OC を別の人に替えたもの）: Python の採点と JS の点が一致する（交代は違反ではなく 1 日あたりの減点 charge_handover）
  { const a = res.asg, I = P.I; let done = false;
    for (const p of P.periods) { if (done) break; for (const d of p.days) { if (done) break; const nk = `${d}:night`, dk = `${d}:day`; if (!a[nk] || !a[dk]) continue;
        const cur = (a[nk].oc || []).find(x => I.includes(x)); if (!cur) continue; // 夜間の期間責任者が OC で入っている日だけ
        for (const z of I) { if (z === cur) continue; const a2 = JSON.parse(JSON.stringify(a)); a2[nk].oc = a2[nk].oc.map(x => x === cur ? z : x);
          let js; try { js = T.solve(P, highs, { timeLimit: sec, pin: a2 }); } catch (e) { continue; } if (js.status !== 'Optimal') continue; // ほかの必須条件に当たる入れ替えは飛ばす
          const f2 = path.join(os.tmpdir(), 'toban_js_handover.json'); fs.writeFileSync(f2, JSON.stringify(a2)); let out; try { out = execFileSync(PY, [TOBAN, 'score', '--json', f2, '--time', String(sec), monthPath, '--rules', rulesPath], { encoding: 'utf8', cwd: path.dirname(TOBAN), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
          const mm = out.match(/採点: 状態 (\w+)、減点の合計 ([-\d.eE+]+|None)/), pen = T.penalty(P, a2), chk = T.check(P, a2);
          ok(!/Traceback/.test(out) && mm && mm[1] === 'OPTIMAL' && Math.abs(+mm[2] - js.objective) < 1e-6 && Math.abs(pen.total - js.objective) < 1e-6 && chk.V.length === 0 && pen.items.charge_handover === (P.weights.charge_handover ?? 200),
            `期間責任者が日の途中で交代（${d} 日の夜間を別の人に）: JS ${js.status} ${js.objective} / Python ${mm ? mm[1] + ' ' + mm[2] : '例外: ' + out.trim().split('\n').pop()} / 減点 ${pen.total}（交代 ${pen.items.charge_handover}）/ 検算の違反 ${chk.V.length}`);
          done = true; break; } } }
    ok(done, '期間責任者の交代の割当を 1 つ作って突き合わせた'); }
  // 8) 当月の勤務回数の下限・上限（人ごと。月の count_min / count_max）: 範囲の外になる割当は JS・Python とも採点できず（解なし）、その範囲で解き直した割当は Python の採点と JS の点が一致する
  { const a = res.asg, A0 = T.check(P, a).A, people = P.dutyNames.filter(n => !P.isExempt(n)), tot = n => P.slots.filter(s => A0.worked(n, s)).length;
    const who = people.find(n => tot(n) >= 1 && tot(n) - 1 >= P.quota(n) - P.tol), who2 = people.find(n => n !== who && tot(n) + 1 <= P.quota(n) + P.tol);
    if (who && who2) { const m2 = Object.assign(JSON.parse(JSON.stringify(month)), { count_max: { [who]: tot(who) - 1 }, count_min: { [who2]: tot(who2) + 1 } }), P2 = new T.Problem(rules, m2);
      const mFile = path.join(os.tmpdir(), '202611.json'); fs.writeFileSync(mFile, JSON.stringify(m2));
      const score = file => { let out; try { out = execFileSync(PY, [TOBAN, 'score', '--json', file, '--time', String(sec), mFile, '--rules', rulesPath], { encoding: 'utf8', cwd: path.dirname(TOBAN), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); } return { out, mm: out.match(/採点: 状態 (\w+)、減点の合計 ([-\d.eE+]+|None)/) }; };
      const jsOld = T.solve(P2, highs, { timeLimit: sec, pin: a }), pyOld = score(jsFile);
      ok(!/Traceback/.test(pyOld.out) && pyOld.mm && jsOld.status !== 'Optimal' && pyOld.mm[1] !== 'OPTIMAL', `下限・上限の外になる割当: JS ${jsOld.status} / Python ${pyOld.mm ? pyOld.mm[1] : '例外: ' + pyOld.out.trim().split('\n').pop()}（どちらも採点不可）`);
      const r2 = T.solve(P2, highs, { timeLimit: sec }), f2 = path.join(os.tmpdir(), 'toban_js_limits.json'); fs.writeFileSync(f2, JSON.stringify(r2.asg || {}));
      const py2 = score(f2), A2 = r2.asg ? T.check(P2, r2.asg) : null, t2 = n => P2.slots.filter(s => A2.A.worked(n, s)).length;
      ok(r2.status === 'Optimal' && A2.V.length === 0 && t2(who) <= m2.count_max[who] && t2(who2) >= m2.count_min[who2] && !/Traceback/.test(py2.out) && py2.mm && py2.mm[1] === 'OPTIMAL' && Math.abs(+py2.mm[2] - r2.objective) < 1e-6,
        `下限・上限の範囲で解き直した割当: JS ${r2.status} ${r2.objective} / Python ${py2.mm ? py2.mm[1] + ' ' + py2.mm[2] : '例外: ' + py2.out.trim().split('\n').pop()}（上限を入れた人 ${A2 ? t2(who) : '?'}≦${m2.count_max[who]}、下限を入れた人 ${A2 ? t2(who2) : '?'}≧${m2.count_min[who2]}）`);
    } else ok(false, '下限・上限の突き合わせに使う人が見つからない'); }
  console.log(fail ? '突き合わせ: 不一致あり' : '突き合わせ: すべて一致');
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(1); });
