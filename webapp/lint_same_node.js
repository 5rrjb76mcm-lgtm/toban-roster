// 入力チェックをプラグインに移すときの確認: 移す前（git の版）と後（いまの src）で、入力チェックの指摘（code と差し込む値）の集合が同じか。
//   node lint_same_node.js [git の版。既定 HEAD]
// 並びは比べない（プラグインにすると呼ぶ順が変わる）。見本の施設と、わざと矛盾を入れた月で比べる。1 つでも違えば終了コード 1。docs/rule-modules.md §7
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const W = __dirname, rev = process.argv[2] || "HEAD";
const old = fs.mkdtempSync(path.join(os.tmpdir(), "toban_old_")); fs.mkdirSync(path.join(old, "rules")); fs.mkdirSync(path.join(old, "calendars"));
const files = ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"];
const listed = execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "webapp/src"], { cwd: path.join(W, ".."), encoding: "utf8" }).split("\n");
for (const f of files.concat(listed.filter(x => x.startsWith("webapp/src/rules/") || x.startsWith("webapp/src/calendars/")).map(x => x.slice("webapp/src/".length))))
  if (listed.includes("webapp/src/" + f)) fs.writeFileSync(path.join(old, f), execFileSync("git", ["show", `${rev}:webapp/src/${f}`], { cwd: path.join(W, ".."), encoding: "utf8" }));
function load(dir) {
  globalThis.T = {}; const has = f => fs.existsSync(path.join(dir, f));
  for (const f of files) if (has(f)) vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8"), { filename: f });
  if (has("rules")) for (const f of fs.readdirSync(path.join(dir, "rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(dir, "rules", f), "utf8"), { filename: "rules/" + f });
  if (has("calendars")) for (const f of fs.readdirSync(path.join(dir, "calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(dir, "calendars", f), "utf8"), { filename: "calendars/" + f });
  for (const q of fs.readdirSync(path.join(W, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(W, "lang", q), "utf8")));
  T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(W, "data/rules.json"), "utf8")); return T;
}
const rd = f => JSON.parse(fs.readFileSync(path.join(W, f), "utf8")), clone = o => JSON.parse(JSON.stringify(o));
// 重みの鍵の改名（2026-09-23）: 移す前の版は旧い鍵を読むので、比べるときは両方の鍵を持たせる（新しい版は読み込み時に旧い鍵を消す）
const RENAMED = { same_day_charge_other_soft: "same_day_IA_soft", same_day_other_junior: "same_day_AY", same_day_other_both: "same_day_AA" };
const compat = r => { const rr = clone(r); rr.weights = Object.assign({}, rr.weights); for (const [n, o] of Object.entries(RENAMED)) if (rr.weights[n] !== undefined && rr.weights[o] === undefined) rr.weights[o] = rr.weights[n]; return rr; };
const saved = rd("data/202611_data_test.json"), month0 = { year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false };
const cases = [["循環器（保存データ）", saved.rules, saved.month], ["循環器（曜日パターン）", rd("data/rules.json"), rd("data/202611.json")]];
const oldIds = new Set(fs.readdirSync(path.join(old, "rules")).map(f => f.replace(/\.js$/, ""))); // 移す前の版にある規則（新しく足した規則は既定の「なし」のまま比べる）
const flip = (r, want) => { const rr = clone(r); rr.rule_states = Object.assign({}, rr.rule_states); for (const d of load(path.join(W, "src")).RULE_DEFS) if (d.states.includes(want) && (oldIds.has(d.id) || !fs.existsSync(path.join(W, "src/rules", d.id + ".js")))) { rr.rule_states[d.id] = want; for (const a of d.aliases || []) rr.rule_states[a] = want; } return rr; }; // 旧 id にも（移す前の版のため）
cases.push(["循環器・減点にできる規則をすべて減点", flip(saved.rules, "soft"), saved.month], ["循環器・必須にできる規則をすべて必須", flip(saved.rules, "hard"), saved.month]);
// わざと矛盾を入れた月（固定指定と不可・連日・同日・目安超過・翌月 1 日・名簿外の名前・期間責任者）
{ const m = clone(rd("data/202611.json")); m.unavailable_night["Dr F"] = [6, 7]; m.fixed.day = { 8: "Dr J", 14: "Dr J", 15: "Dr J", 22: "Dr X" }; m.fixed.night = Object.assign({}, m.fixed.night, { 8: "Dr J", 9: "Dr N", 10: "Dr N", 11: "Dr N", 12: "Dr N", 13: "Dr N", 20: "Dr F" });
  m.unavailable_other = [{ name: "Dr J", day: 8, part: "allday" }, { name: "Dr N", day: 9, part: "pm" }]; m.fixed.day_oc = { 8: ["Dr J", "Dr E"], 15: ["Dr Q", "Dr R"] }; m.fixed.night_oc = { 9: ["Dr N"], 3: ["Dr X"] };
  m.fixed.charge = { 8: "Dr N", 10: "Dr E" }; m.next_month_first_day = { day: "Dr E", night: "Dr F", charge: "Dr G", day_oc: ["Dr E"] };
  const r = clone(rd("data/rules.json")); r.name_order = ["Dr Z"]; r.friday_night_min = Object.assign({}, r.friday_night_min, { "Dr Y": 1, "Dr F": 5 });
  cases.push(["循環器・矛盾を入れた月", r, m], ["循環器・矛盾を入れた月・すべて必須", flip(r, "hard"), m]); }
// 期間責任者・専門業務・日中の業務・役割の参照・連勤の設定の矛盾
{ const T0 = load(path.join(W, "src")); const r0 = clone(rd("data/rules.json")); T0.fillDefaultRules(r0); const P0 = new T0.Problem(r0, T0.normalizeMonth(clone(rd("data/202611.json")), r0));
  const I = P0.I, A = P0.cathA, others = P0.dutyNames.filter(n => !I.includes(n));
  const m = clone(rd("data/202611.json")); m.fixed.weekend_charge = { 1: others[0], 10: I[0], 8: I[1], 31: I[0] }; m.fixed.day = { 31: I[1] }; m.fixed.night = { 31: I[2] || I[1] };
  m.unavailable_night = { [I[1]]: [8, 22] }; m.unavailable_other = I.map(n => ({ name: n, day: 22, part: "allday" })).concat(A.map(n => ({ name: n, day: 4, part: "allday" })));
  m.prev_month.last_days = [{ date: 30, night: I[0], night_oc: [I[1]] }, { date: 31, day: I[1], day_oc: [I[0]], night: I[0], night_oc: [I[1]] }];
  // 外勤の翌日・午後外勤日の固定（規則 duty_conflicts）: 木曜午後外勤の人を水曜夜勤と水曜夜間 OC に、火曜午後外勤の人を火曜夜勤と火曜日勤 OC に
  const ext = (n, dow) => (m.regular_duties[n] || []).some(x => x.kind === "external" && x.dow === dow), thu = Object.keys(m.regular_duties).find(n => ext(n, "Thu")), tue = Object.keys(m.regular_duties).find(n => ext(n, "Tue"));
  if (thu) { m.fixed.night[11] = thu; m.fixed.night_oc = { 25: [thu] }; } if (tue) { m.fixed.night[10] = tue; m.fixed.day_oc = { 17: [tue] }; }
  cases.push(["循環器・期間責任者と業務の矛盾", rd("data/rules.json"), m], ["循環器・期間責任者と業務の矛盾・すべて必須", flip(rd("data/rules.json"), "hard"), m]);
  const r4 = clone(rd("data/rules.json")); r4.profile = Object.assign({}, r4.profile, { roles: (T0.normalizeRolesOf(r4)).map(x => ({ id: x.id, label: x.label, refs: x.refs.filter(f => f !== "charge" && f !== "junior"), standby: x.standby })) });
  cases.push(["循環器・役割の参照なし", r4, rd("data/202611.json")]);
  const r5 = clone(rd("data/rules.json")); r5.rule_states = Object.assign({}, r5.rule_states, { run_length_max: "hard", run_length_min: "hard", consecutive_days: "hard", days_off_min: "hard", days_off_pair: "hard" }); r5.run_length = { max: 2, min: 3 }; r5.days_off = { basis: "fixed", min: 40, pair_min: 30 };
  cases.push(["循環器・連勤と休みの設定の矛盾", r5, rd("data/202611.json")]); }
// 専門業務・休日の役割の組合せ・翌日が平日の夜勤・午後外勤日の OC・週休日・前月末の期間責任者
{ const T0 = load(path.join(W, "src")); const r0 = clone(rd("data/rules.json")); T0.fillDefaultRules(r0); const P0 = new T0.Problem(r0, T0.normalizeMonth(clone(rd("data/202611.json")), r0));
  const I = P0.I, A = P0.cathA, Y = P0.Y, arr = (r0.arrhythmia_responsible_night || []).filter(n => P0.dutyNames.includes(n));
  const m = clone(rd("data/202611.json"));
  m.unavailable_other = A.map(n => ({ name: n, day: 4, part: "allday" })).concat(I.map(n => ({ name: n, day: 5, part: "day" }))).concat([{ name: I[0], day: 1, part: "allday" }]);
  for (let d = 1; d <= 30; d++) if ([0, 6].includes(new Date(2026, 10, d).getDay())) m.unavailable_other.push({ name: I[3] || I[1], day: d, part: "allday" }); // 土日すべて不可（外勤のある人なら週休日が作れない）
  m.fixed.day = { 1: I[1] }; m.fixed.night = { 1: A[0], 12: arr[0] || A[1] }; m.fixed.night_oc = { 10: [Y[0]], 16: [Y[1]] }; m.fixed.day_oc = { 3: [Y[2]] };
  m.regular_duties[Y[0]] = [{ kind: "external", dow: "Tue", part: "pm" }]; m.regular_duties[Y[1]] = [{ kind: "external", dow: "Tue", part: "am" }]; m.regular_duties[Y[2]] = [{ kind: "external", dow: "Tue", part: "pm" }];
  m.prev_month.last_days = [{ date: 31, day: I[0], day_oc: [I[1]], night: I[0], night_oc: [I[1]] }]; m.prev_month.last_weekend_charge = I[0];
  const r = clone(rd("data/rules.json")); r.rule_states = Object.assign({}, r.rule_states, { same_day_charge_other: "hard", rest_day: "hard", arrhythmia_pre_workday_night: "hard" });
  cases.push(["循環器・専門業務と固定の矛盾", r, m]); }
for (const p of ["two-shift", "nurse-2shift", "fixtures/ward-2shift", "oncall-min"]) {
  const r = rd(p.startsWith("fixtures/") ? `data/${p}.json` : `data/profiles/${p}.json`); cases.push([p, r, month0]);
  // 休みの日数を多くして人数が足りない月、目安を上げた月
  const m2 = clone(month0); m2.holidays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]; cases.push([p + "・休日を多く", r, m2]);
  const r2 = clone(r); r2.doctors = (r2.doctors || []).map(d => Object.assign({}, d, { quota: 30 })); cases.push([p + "・目安 30", r2, month0]);
  if (p === "two-shift") cases.push([p + "・すべて必須", flip(r, "hard"), month0]); // 複数名の勤務帯を持つ施設では必須にできない規則がある
}
const items = (dir, r, m) => { const T = load(dir); const rr = compat(r); T.fillDefaultRules(rr); const P = new T.Problem(rr, T.normalizeMonth(clone(m), rr)); return T.lint(P).map(x => x.code + " " + JSON.stringify(x.args) + " | " + x.msg + " | " + x.hint).sort(); };
let bad = 0;
for (const [lab, r, m] of cases) {
  const a = items(old, r, m), b = items(path.join(W, "src"), r, m);
  if (JSON.stringify(a) === JSON.stringify(b)) { console.log(`same ${lab}（${a.length} 件）`); continue; }
  bad++; console.log(`DIFF ${lab}`);
  for (const x of a) if (!b.includes(x)) console.log("  移す前だけ:", x.slice(0, 160));
  for (const x of b) if (!a.includes(x)) console.log("  いまだけ:", x.slice(0, 160));
}
console.log(bad ? `${bad} 設定で入力チェックが違う（${rev} と比べて）` : `入力チェックは ${rev} と同じ（${cases.length} 設定）`);
process.exit(bad ? 1 : 0);
