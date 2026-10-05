// 指定した人の休日の実勤務を月の上限日数までにする（dayoff_work_cap）。
//   node test_dayoff_work_node.js <highs パッケージのパス>
// 数え方は試験の側で独立に書く: 休日（土日祝）の日ごとに、どれかの枠で実勤務に入れば 1 日（OC は数えない。平日は数えない）。人ごとに数え、名簿の欄の上限を超えた日数 × 重みが減点。
// 回数の下支え: 本人の回数が基準回数（参照解の回数。無ければ当月目標）に足りない分 × 重み。
// 同梱の見本（架空の名簿）だけを使う
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), os = require("os"), { execFileSync } = require("child_process");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const highsPath = process.argv[2]; if (!highsPath) { console.log("（highs のパス指定が無いので、休日の実勤務の上限の試験は省略）"); process.exit(0); }
const clone = x => JSON.parse(JSON.stringify(x)), sample = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8"));
const rulesOf = (caps, extra) => { const R = clone(T.DEFAULT_RULES); if (caps) R.dayoff_work_max = caps; if (extra) extra(R); T.fillDefaultRules(R); return R; };
const prob = (caps, opt = {}) => { const R = rulesOf(caps, opt.rules), m = T.normalizeMonth(clone(sample), R); if (opt.month) opt.month(m); return new T.Problem(R, m); };
// 独立の数え方（割当の JSON から直接）。2026 年 11 月: 土日と祝日 3・23 日が休日
const dow = d => (new Date(2026, 10, d).getDay() + 6) % 7, isOff = d => dow(d) >= 5 || d === 3 || d === 23;
const offDays = (asg, who) => [...new Set(Object.entries(asg).filter(([k, v]) => [].concat(v.work || []).includes(who)).map(([k]) => +k.split(":")[0]).filter(d => d >= 1 && d <= 30 && isOff(d)))].sort((a, b) => a - b);
const worksOf = (asg, who) => Object.entries(asg).filter(([k, v]) => +k.split(":")[0] >= 1 && [].concat(v.work || []).includes(who)).length;
const near = (a, b) => Math.abs(a - b) < 1e-6;
let n = 0; const t = async (label, fn) => { await fn(); n++; console.log("ok   " + label); };
(async () => { const highs = await require(highsPath)();
  const def = T.RULE_BY_ID.dayoff_work_cap; assert.ok(def, "規則が登録されている");
  const P0 = prob(), base = await T.solveWithAvoidRef(P0, highs, { timeLimit: 60 }); assert.strictEqual(base.status, "Optimal");
  // 見本の解で、休日の実勤務が 2 日以上の人（予備でなく、期間責任者でもない人から選ぶ）
  const multi = P0.dutyNames.filter(x => !P0.isExempt(x) && !P0.isRole(x, "charge") && offDays(base.asg, x).length >= 2); assert.ok(multi.length >= 2, "見本の解には休日の実勤務が 2 日以上の人がいる: " + multi.join(","));
  const X = multi[0], Y = multi[1];

  await t("既定は「減点」（減点・なしを選べる）。重みの既定は 100、回数の下支えは 1000。名簿の欄の既定は空（誰にも何もしない）", async () => {
    assert.strictEqual(def.def, "soft"); assert.strictEqual(def.states.join(), "soft,off"); assert.strictEqual(def.python, false);
    assert.strictEqual(T.DEFAULT_RULES.weights.dayoff_work_excess, 100); assert.strictEqual(T.DEFAULT_RULES.weights.dayoff_work_no_reduction, 1000); assert.deepStrictEqual(T.DEFAULT_RULES.dayoff_work_max, {});
    assert.strictEqual(P0.state("dayoff_work_cap"), "soft"); assert.strictEqual(P0.weights.dayoff_work_excess, 100); });

  await t("誰も指定していなければ、規則を「なし」にしたときと同じ問題（変数・制約の数と最適値が同じ）。参照解の計算もしない", async () => {
    const Poff = prob(null, { rules: R => { R.rule_states = Object.assign({}, R.rule_states, { dayoff_work_cap: "off" }); } }), off = await T.solve(Poff, highs, { timeLimit: 60 });
    assert.strictEqual(base.avoidRef, undefined, "参照解なし"); assert.deepStrictEqual(T.rules.refDeclarers(P0), []);
    const on = await T.solve(P0, highs, { timeLimit: 60 }); assert.strictEqual(on.vars, off.vars); assert.strictEqual(on.cons, off.cons); assert.ok(near(on.objective, off.objective), `${on.objective} = ${off.objective}`);
    assert.ok(!("dayoff_work_excess" in (T.penalty(P0, base.asg).items || {})) || !T.penalty(P0, base.asg).items.dayoff_work_excess); });

  await t("減点: 上限を超えた日数 × 重み。同じ割当を全枠固定して解いた目的関数は、指定なしのときより ちょうどその分だけ大きい（解く側・減点・独立の数え方が一致）。OC と平日の勤務は数えない", async () => {
    const off0 = await T.solve(P0, highs, { timeLimit: 30, pin: base.asg });
    for (const caps of [{ [X]: 1 }, { [X]: 0, [Y]: 1 }, { [X]: 5 }]) { const P = prob(caps), w = P.weights.dayoff_work_excess;
      const ex = Object.entries(caps).reduce((a, [who, max]) => a + Math.max(0, offDays(base.asg, who).length - max), 0);
      const short = Object.keys(caps).reduce((a, who) => a + Math.max(0, P.targets[who] - worksOf(base.asg, who)), 0); // 参照解を渡さないので、基準回数は当月目標
      const pen = T.penalty(P, base.asg); assert.strictEqual(pen.items.dayoff_work_excess || 0, ex * w, `${JSON.stringify(caps)}: ${pen.items.dayoff_work_excess} = ${ex} × ${w}`); assert.strictEqual(pen.items.dayoff_work_no_reduction || 0, short * 1000);
      const on = await T.solve(P, highs, { timeLimit: 30, pin: base.asg }); assert.strictEqual(on.status, "Optimal"); assert.ok(near(on.objective - off0.objective, ex * w + short * 1000), `${on.objective} − ${off0.objective} = ${ex * w + short * 1000}`); assert.ok(near(on.objective, pen.total));
      assert.strictEqual(T.check(P, base.asg).V.length, 0, "減点の規則なので違反にはしない"); }
    // OC だけの休日は数えない: 休日に OC だけで入っている日がある人を選び、実勤務の日数だけで数えることを確かめる（解く側とも一致）
    const ocOnlyDays = who => [...new Set(Object.entries(base.asg).filter(([k, v]) => isOff(+k.split(":")[0]) && (v.oc || []).includes(who)).map(([k]) => +k.split(":")[0]))].filter(d => !offDays(base.asg, who).includes(d));
    const O = P0.dutyNames.filter(x => !P0.isExempt(x) && ocOnlyDays(x).length).sort((p, q) => ocOnlyDays(q).length - ocOnlyDays(p).length)[0]; assert.ok(O, "見本の解には、休日に OC だけで入っている人がいる");
    const Po = prob({ [O]: 0 }), po = T.penalty(Po, base.asg), short = Math.max(0, Po.targets[O] - worksOf(base.asg, O));
    assert.strictEqual(po.items.dayoff_work_excess || 0, offDays(base.asg, O).length * 100, `${O}: 休日の OC だけの日 ${ocOnlyDays(O).length} 日は数えない`);
    const pinO = await T.solve(Po, highs, { timeLimit: 30, pin: base.asg }); assert.ok(near(pinO.objective - off0.objective, offDays(base.asg, O).length * 100 + short * 1000), `${pinO.objective} − ${off0.objective}`); });

  await t("2 段階で解く: 指定した人は参照解（指定を無視した計算）の回数を保ったまま、休日の実勤務が上限以内になる。目的関数＝減点の合計、違反なし", async () => {
    const P = prob({ [X]: 1, [Y]: 1 }); assert.deepStrictEqual(T.rules.refDeclarers(P).sort(), [X, Y].sort());
    const r = await T.solveWithAvoidRef(P, highs, { timeLimit: 90 }); assert.strictEqual(r.status, "Optimal"); assert.deepStrictEqual(Object.keys(r.avoidRef).sort(), [X, Y].sort(), "参照解の回数は指定した人の分");
    for (const who of [X, Y]) { assert.strictEqual(r.avoidRef[who], worksOf(base.asg, who), "参照解はこの規則を無視した解（指定なしの解と同じ回数）"); assert.ok(offDays(r.asg, who).length <= 1, `${who}: 休日の実勤務 ${offDays(r.asg, who).join("/")}`); assert.ok(worksOf(r.asg, who) >= r.avoidRef[who], `${who}: 回数 ${worksOf(r.asg, who)} ≥ 参照解 ${r.avoidRef[who]}`); }
    const pen = T.penalty(P, r.asg, { avoidRef: r.avoidRef }); assert.ok(near(r.objective, pen.total), `${r.objective} = ${pen.total}`); assert.ok(!pen.items.dayoff_work_excess && !pen.items.dayoff_work_no_reduction); assert.strictEqual(T.check(P, r.asg).V.length, 0);
    // 上限 0: 休日の実勤務なしで回数を保つ
    const Pz = prob({ [X]: 0 }), rz = await T.solveWithAvoidRef(Pz, highs, { timeLimit: 90 }); assert.strictEqual(rz.status, "Optimal"); assert.deepStrictEqual(offDays(rz.asg, X), []); assert.strictEqual(worksOf(rz.asg, X), rz.avoidRef[X]); });

  await t("ほかに手が無いときは超えてよい: 休日の実勤務を 2 日固定した人（上限 1）も解ける。超えた 1 日は減点、入力チェックは知らせるだけ", async () => {
    const days = offDays(base.asg, X).slice(0, 2), fx = m => { for (const d of days) { const kind = Object.keys(base.asg).find(k => +k.split(":")[0] === d && [].concat(base.asg[k].work || []).includes(X)).split(":")[1]; m.fixed[kind] = Object.assign({}, m.fixed[kind], { [d]: X }); } };
    const P = prob({ [X]: 1 }, { month: fx }), lint = T.lint(P).filter(x => x.code === "LINT_DAYOFF_WORK_FIXED_OVER"); assert.strictEqual(lint.length, 1); assert.ok(lint[0].msg.includes(X) && /2 日/.test(lint[0].msg) && lint[0].hint, lint[0].msg);
    const r = await T.solveWithAvoidRef(P, highs, { timeLimit: 90 }); assert.strictEqual(r.status, "Optimal"); assert.deepStrictEqual(offDays(r.asg, X), days, "固定した 2 日だけ（それ以上は増やさない）");
    const pen = T.penalty(P, r.asg, { avoidRef: r.avoidRef }); assert.strictEqual(pen.items.dayoff_work_excess, 100); assert.ok(near(r.objective, pen.total)); assert.strictEqual(T.check(P, r.asg).V.length, 0);
    assert.strictEqual(T.lint(prob({ [X]: 2 }, { month: fx })).filter(x => x.code === "LINT_DAYOFF_WORK_FIXED_OVER").length, 0, "上限以内の固定は知らせない"); });

  await t("申告で回数は減らない: 平日に 3 枠しか入れない人（上限 0）は、参照解の回数を保つために休日へ入る（超過は最小）。下支えの重みを 0 にすると回数が減る（下支えが効いている）", async () => {
    const R0 = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/oncall-min.json"), "utf8")), Z = R0.doctors[R0.doctors.length - 1].name, open = [5, 12, 19]; // 平日の夜勤に入れるのはこの 3 日だけ
    const mk = w => { const R = clone(R0); R.dayoff_work_max = { [Z]: 0 }; T.fillDefaultRules(R); if (w != null) R.weights.dayoff_work_no_reduction = w;
      const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, R); m.unavailable_night = Object.assign({}, m.unavailable_night, { [Z]: [...Array(30)].map((_, i) => i + 1).filter(d => !isOff(d) && !open.includes(d)) }); return new T.Problem(R, m); };
    const P = mk(), r = await T.solveWithAvoidRef(P, highs, { timeLimit: 90, mipGap: 0 }); assert.strictEqual(r.status, "Optimal"); const ref = r.avoidRef[Z]; assert.ok(ref > open.length, "参照解の回数は平日に入れる枠より多い: " + ref);
    assert.strictEqual(worksOf(r.asg, Z), ref, "回数は参照解と同じ"); assert.strictEqual(offDays(r.asg, Z).length, ref - open.length, "休日へ入るのは足りない分だけ");
    const pen = T.penalty(P, r.asg, { avoidRef: r.avoidRef }); assert.strictEqual(pen.items.dayoff_work_excess, (ref - open.length) * 100); assert.ok(!pen.items.dayoff_work_no_reduction); assert.ok(near(r.objective, pen.total)); assert.strictEqual(T.check(P, r.asg).V.length, 0);
    const Pw = mk(0), rw = await T.solveWithAvoidRef(Pw, highs, { timeLimit: 90, mipGap: 0 }); assert.strictEqual(rw.status, "Optimal"); assert.ok(worksOf(rw.asg, Z) < ref, `下支えなしでは回数が減る: ${worksOf(rw.asg, Z)} < ${ref}`); });

  await t("回数の下支えの数え方: 基準回数に足りない分 × 1000（解く側と一致）。避けたい日も申告している人は avoid_days の側だけで数える（二重に数えない）", async () => {
    const P = prob({ [X]: 5 }), cnt = worksOf(base.asg, X), opts = { avoidRef: { [X]: cnt + 2 } };
    const pen = T.penalty(P, base.asg, opts); assert.strictEqual(pen.items.dayoff_work_no_reduction, 2000); assert.ok(!pen.items.avoid_no_reduction);
    const pin = await T.solve(P, highs, Object.assign({ timeLimit: 30, pin: base.asg }, opts)); assert.strictEqual(pin.status, "Optimal"); assert.ok(near(pin.objective, pen.total), `${pin.objective} = ${pen.total}`);
    const free = [...Array(30)].map((_, i) => i + 1).find(d => !Object.entries(base.asg).some(([k, v]) => +k.split(":")[0] === d && [].concat(v.work || [], v.oc || []).includes(X))); // X が当番に入っていない日を「避けたい日」にする
    const Pa = prob({ [X]: 5 }, { month: m => { m.avoid = (m.avoid || []).concat([{ name: X, day: free, part: "allday" }]); } }); assert.ok(Pa.avoidSlots(X).length > 0, "避けたい日が入った");
    const pa = T.penalty(Pa, base.asg, opts); assert.strictEqual(pa.items.avoid_no_reduction, 2000); assert.ok(!pa.items.dayoff_work_no_reduction, "二重に数えない");
    const pinA = await T.solve(Pa, highs, Object.assign({ timeLimit: 30, pin: base.asg }, opts)); assert.strictEqual(pinA.status, "Optimal"); assert.ok(near(pinA.objective, pa.total), `${pinA.objective} = ${pa.total}`);
    // avoid_days を「なし」にした施設では、この規則が自分で下支えする
    const Pb = prob({ [X]: 5 }, { month: m => { m.avoid = (m.avoid || []).concat([{ name: X, day: free, part: "allday" }]); }, rules: R => { R.rule_states = Object.assign({}, R.rule_states, { avoid_days: "off" }); } });
    const pb = T.penalty(Pb, base.asg, opts); assert.strictEqual(pb.items.dayoff_work_no_reduction, 2000); assert.ok(!pb.items.avoid_no_reduction); });

  await t("対象外: 予備の役割と「固定したときだけ」の人は、指定があっても数えない（参照解の対象にもしない）", async () => {
    const res = P0.dutyNames.concat(P0.names).find(x => P0.isRole(x, "reserve")); assert.ok(res, "見本に予備の役割の人がいる");
    const P = prob({ [res]: 0, [X]: 0 }, { rules: R => { R.doctors.find(d => d.name === X).duty = "fixed_only"; R.rule_states = Object.assign({}, R.rule_states, { fixed_only: "off" }); } });
    assert.ok(P.isFixedOnly(X) && P.isExempt(X)); assert.deepStrictEqual(T.rules.refDeclarers(P), []);
    const pen = T.penalty(P, base.asg); assert.ok(!pen.items.dayoff_work_excess && !pen.items.dayoff_work_no_reduction); });

  await t("欄の値: 数字の文字列は数として使う。0 以上の整数でない値は使わず、入力チェックで名指しする。空の値は指定なし", async () => {
    const [B1, B2, B3] = P0.dutyNames.filter(x => x !== X && x !== Y && !P0.isExempt(x)); // 選んだ 2 人と重ならない人
    const P = prob({ [X]: "1", [Y]: "abc", [B1]: -1, [B2]: 1.5, [B3]: "" }); assert.deepStrictEqual(P.prm.dayoff_work_cap.max, { [X]: 1 });
    const bad = T.lint(P).filter(x => x.code === "LINT_DAYOFF_WORK_BAD_VALUE").map(x => x.args.who).sort(); assert.deepStrictEqual(bad, [Y, B1, B2].sort());
    assert.strictEqual(T.penalty(P, base.asg).items.dayoff_work_excess, (offDays(base.asg, X).length - 1) * 100);
    assert.deepStrictEqual(prob({ [X]: null }).prm.dayoff_work_cap.max, {}); assert.deepStrictEqual(new T.Problem(rulesOf(null, R => { R.dayoff_work_max = ["x"]; }), T.normalizeMonth(clone(sample), rulesOf())).prm.dayoff_work_cap.max, {}, "表でない値は無視"); });

  await t("名簿の欄: 規則を使っているときだけ出る。読み戻しは整数にして保存し、空欄の人は項目を作らない。全角の数字は半角で読む。数字でない入力は消さずに残す（入力チェックが指摘）。改名に追随し、名簿にいない人の分は掃除される", async () => {
    const R = rulesOf({ [X]: 1 }), col = T.rules.columns(R).find(c => c.key === "dwm"); assert.ok(col && col.rule === "dayoff_work_cap", "欄が出る");
    const Roff = rulesOf({ [X]: 1 }, r => { r.rule_states = Object.assign({}, r.rule_states, { dayoff_work_cap: "off" }); }); assert.ok(!T.rules.columns(Roff).some(c => c.key === "dwm"), "規則が「なし」なら欄を出さない"); assert.ok(T.rules.columnsAll(Roff).some(c => c.key === "dwm"));
    const h = { esc: T.esc, tx: s => s }, html = col.render({ name: X }, R, h); assert.ok(/data-f="dwm"/.test(html) && /value="1"/.test(html), html); assert.ok(/value=""/.test(col.render({ name: Y }, R, h)));
    assert.ok(/value="&lt;b&gt;"/.test(col.render({ name: X }, { dayoff_work_max: { [X]: "<b>" } }, h)), "値は HTML として解釈させない");
    const td = v => ({ querySelector: () => ({ value: v }) }), acc = col.begin(R);
    col.read(td("2"), {}, R, acc, "A"); col.read(td(""), {}, R, acc, "B"); col.read(td(" ０ "), {}, R, acc, "C"); col.read(td("１２"), {}, R, acc, "D"); col.read(td("abc"), {}, R, acc, "E"); col.read(td("1.5"), {}, R, acc, "F");
    assert.deepStrictEqual(acc, { A: 2, C: 0, D: 12, E: "abc", F: "1.5" }); const R2 = clone(R); col.end(R2, acc); assert.deepStrictEqual(R2.dayoff_work_max, acc);
    const R3 = clone(R); col.rename(R3, X, "New Name"); assert.deepStrictEqual(R3.dayoff_work_max, { "New Name": 1 });
    const R4 = rulesOf({ [X]: 1, "Not In Roster": 0 }); assert.strictEqual(T.pruneRosterRefs(R4), 1); assert.deepStrictEqual(R4.dayoff_work_max, { [X]: 1 }); });

  await t("規則の要約と説明資料: 対象者と上限、休日の実勤務の日、超過、回数（当月目標・参照解）を出す", async () => {
    const P = prob({ [X]: 1 }), sum = T.rulesSummary ? JSON.stringify(T.rulesSummary(P)) : ""; if (T.rulesSummary) assert.ok(sum.includes(`${X} 月1日まで`), sum.slice(0, 300));
    const line = sec => (T.buildReport(P, base.asg, sec).sections.find(s => s.id === "s9").html.match(/<li>[^<]*休日の実勤務（上限[^<]*<\/li>/g) || []);
    const l1 = line({ status: "Optimal", seconds: 1 }); assert.strictEqual(l1.length, 1); assert.ok(l1[0].includes(X) && l1[0].includes("上限 月1日") && /上限を \d+ 日超過/.test(l1[0]) && /勤務\d+回（当月目標/.test(l1[0]), l1[0]);
    const l2 = line({ status: "Optimal", seconds: 1, avoidRef: { [X]: 9 } }); assert.ok(/申告を無視した参照解では9回/.test(l2[0]) && /参照解を下回る/.test(l2[0]), l2[0]);
    const Pk = prob({ [X]: 5 }), l3 = T.buildReport(Pk, base.asg, { status: "Optimal", seconds: 1 }).sections.find(s => s.id === "s9").html; assert.ok(/休日の実勤務（上限 月5日）: 2日（/.test(l3) && !/超過＝ほかに手が無い/.test(l3), "上限以内なら超過と書かない");
    assert.strictEqual(T.buildReport(P0, base.asg, { status: "Optimal", seconds: 1 }).sections.find(s => s.id === "s9").html.includes("休日の実勤務（上限"), false, "指定が無ければ行を出さない"); });

  await t("Python 版: 誰も指定していない設定はそのまま受け付け、指定があるときは未対応として止まる（黙って無視しない）", async () => {
    const PY = path.join(__dirname, "../tools/.venv/bin/python"), TOBAN = path.join(__dirname, "../tools/toban.py"); if (!fs.existsSync(PY)) { console.log("      （tools/.venv が無いので省略）"); return; }
    const run = R => { const rf = path.join(os.tmpdir(), "toban_dwc_rules.json"), mf = path.join(os.tmpdir(), "202611.json"); fs.writeFileSync(rf, JSON.stringify(R)); fs.writeFileSync(mf, JSON.stringify(sample));
      try { return execFileSync(PY, [TOBAN, "score", "--json", path.join(__dirname, "data/js_assignment.json"), "--time", "20", mf, "--rules", rf], { encoding: "utf8", cwd: path.dirname(TOBAN), stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return "EXIT " + String(e.stdout || "") + String(e.stderr || ""); } };
    const ok = run(rulesOf()); assert.ok(!/^EXIT/.test(ok), "既定（rule_states に dayoff_work_cap: soft、指定なし）は通る: " + ok.slice(0, 300));
    const ng = run(rulesOf({ "Dr M": 1 })); assert.ok(/^EXIT/.test(ng) && /未対応/.test(ng) && /dayoff_work_cap/.test(ng), ng.slice(0, 300));
    const off = run(rulesOf({ "Dr M": 1 }, R => { R.rule_states = Object.assign({}, R.rule_states, { dayoff_work_cap: "off" }); })); assert.ok(!/^EXIT/.test(off), "規則が「なし」なら通る: " + off.slice(0, 300)); });

  console.log(`休日の実勤務の上限の試験 ${n} 件 OK`);
})().catch(e => { console.log("FAIL " + (e && e.stack || e)); process.exit(1); });
