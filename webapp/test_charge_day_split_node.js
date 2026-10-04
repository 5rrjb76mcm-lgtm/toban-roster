// 同じ休日の日勤帯と夜間で、固定した期間責任者（{charge} の役割の人）が別の人になる入力。
//   node test_charge_day_split_node.js [highs パッケージのパス]
// 解く側は「その日の全枠に同じ 1 名が関与」を固定でも緩めないので解なしになり、診断は「固定指定」としか言えない。入力チェックが日と人を名指しすることを確かめる。
// 同梱の見本（架空の名簿）だけを使う
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = x => JSON.parse(JSON.stringify(x)), CODE = "LINT_FIXED_CHARGE_NOT_ONE_IN_DAY";
const R = clone(T.DEFAULT_RULES); T.fillDefaultRules(R);
const I = R.doctors.filter(d => d.team === T.normalizeRolesOf(R).find(r => r.refs.includes("charge")).id).map(d => d.name), Y = R.doctors.filter(d => d.team === T.normalizeRolesOf(R).find(r => r.refs.includes("junior")).id).map(d => d.name);
const month = fx => { const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R); Object.assign(m.fixed, fx); return m; }; // 2026-11-07 は土曜（日勤と夜勤の枠がある休日）
const lintOf = m => T.lint(new T.Problem(R, m)), has = m => lintOf(m).filter(x => x.code === CODE);
let n = 0; const ok = (label, fn) => { fn(); n++; console.log("ok   " + label); };
ok("日勤 OC と夜間 OC の期間責任者が別の人: 入力チェックが日と両名を名指しする", () => { const hit = has(month({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } })); assert.strictEqual(hit.length, 1);
  const P = new T.Problem(R, month({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } })), txt = P.msg(CODE, hit[0].args); assert.ok(txt.includes(I[0]) && txt.includes(I[1]) && /11\/7/.test(txt), txt); assert.ok(P.msg(CODE + "_HINT", hit[0].args).length > 10); });
ok("日勤の勤務者と夜間 OC が別の期間責任者: 指摘する", () => assert.strictEqual(has(month({ day: { 7: I[0] }, night_oc: { 7: [I[1]] } })).length, 1));
ok("期間責任者の固定と、枠に固定した別の期間責任者: 指摘する", () => assert.strictEqual(has(month({ weekend_charge: { 7: I[0] }, night_oc: { 7: [I[1]] } })).length, 1));
ok("同じ人にそろっていれば指摘しない（日勤 OC・夜間 OC・期間責任者の固定とも同じ人）", () => assert.strictEqual(has(month({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[0]] }, weekend_charge: { 7: I[0] } })).length, 0));
ok("期間責任者でない役割の人の固定は数えない（日勤 OC が若手、夜間 OC が期間責任者）", () => assert.strictEqual(has(month({ day_oc: { 7: [Y[0]] }, night_oc: { 7: [I[1]] } })).length, 0));
ok("別の日どうしは別の人でよい（土曜と日曜で別の人は、分割の減点の話）", () => assert.strictEqual(has(month({ day_oc: { 7: [I[0]] }, night_oc: { 8: [I[1]] } })).length, 0));
ok("規則が「なし」なら指摘しない", () => { const R2 = clone(R); R2.rule_states.period_charge = "off"; T.fillDefaultRules(R2); const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R2); Object.assign(m.fixed, { day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } }); assert.ok(!T.lint(new T.Problem(R2, m)).some(x => x.code === CODE)); });
const highsPath = process.argv[2];
if (!highsPath) { console.log(`${n} tests passed（解く試験は highs のパス指定時のみ）`); process.exit(0); }
(async () => { const highs = await require(highsPath)();
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), base = () => T.normalizeMonth(clone(sample), R);
  { const m = base(); m.fixed.day_oc = Object.assign({}, m.fixed.day_oc, { 7: [I[0]] }); m.fixed.night_oc = Object.assign({}, m.fixed.night_oc, { 7: [I[1]] }); const P = new T.Problem(R, m);
    assert.strictEqual(T.lint(P).filter(x => x.code === CODE).length, 1); const res = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(res.status, "Infeasible", "指摘した入力は実際に解なし: " + res.status); n++; console.log("ok   指摘した入力（見本の月）は実際に解なし"); }
  { const m = base(); m.fixed.day_oc = Object.assign({}, m.fixed.day_oc, { 7: [I[0]] }); m.fixed.night_oc = Object.assign({}, m.fixed.night_oc, { 7: [I[0]] }); const P = new T.Problem(R, m);
    assert.strictEqual(T.lint(P).filter(x => x.code === CODE).length, 0); const res = await T.solve(P, highs, { timeLimit: 60 }); assert.ok(res.asg, "そろえれば解ける: " + res.status); assert.strictEqual(T.check(P, res.asg).V.length, 0); n++; console.log("ok   同じ人にそろえれば解ける（検算の違反なし）"); }
  console.log(`${n} tests passed`);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });
