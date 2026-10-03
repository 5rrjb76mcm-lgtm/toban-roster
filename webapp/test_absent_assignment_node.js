// 勤務帯を減らした後に残る旧割当は構造違反。検算・保存前確認・直接出力で止める。
// 架空の名簿だけを使い、前月末と翌月1日の正式な入力形式は保持する。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "docxgen.js", "report.js", "plugins.js"]) run(f);
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
for (const f of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", f), "utf8")));
T.setLang("ja");
const clone = x => JSON.parse(JSON.stringify(x)), names = ["Synthetic A", "Synthetic B", "Synthetic C"];
const state = {}, downloads = [], alerts = [];
globalThis.alert = s => alerts.push(s);
T.app = { state, snapshot: () => clone(state), FILES: { roster: () => "roster.docx", report: () => "report.html" }, download: (name, blob) => downloads.push({ name, blob }) };
run("app-folder.js"); run("app-solve.js");
function fixture() {
  const R = {
    profile: { id: "synthetic-absent-slot", roles: [{ id: "S", label: "Staff" }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }] },
    doctors: names.map(name => ({ name, team: "S", quota: 20 })), name_order: names.slice(), rule_states: {}, weights: {},
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if ((def.states || []).includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R), P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: names[i % names.length], oc: [] }]));
  assert.strictEqual(T.check(P, asg).V.length, 0, "元の毎日2帯の割当は合法");
  return { R, M, asg };
}
function snapshot(R, M, asg) { return { rules: R, month: M, result: { asg, status: "Optimal", plugins: [], input_sig: "previous-input" }, tag: "202611" }; }
function structural(P, asg) { return T.check(P, asg).VC.filter(v => v.code === "SLOT_NOT_EXISTS"); }
async function download(S) {
  Object.assign(state, S); downloads.length = 0; alerts.length = 0;
  await T.app.downloadDocx(); T.app.downloadReportHtml();
}
(async () => {
  for (const [kind, on] of [["night", "weekdays"], ["night", "off_days"], ["day", "none"], ["day", "weekdays"]]) {
    const { R, M, asg } = fixture();
    R.profile.shifts.find(sh => sh.id === kind).on = on;
    const P = new T.Problem(R, M), removed = Object.keys(asg).filter(k => !P.slotSet.has(k)), before = JSON.stringify(asg);
    assert(removed.length, "設定変更で枠が減る");
    assert.strictEqual(structural(P, asg).length, removed.length, `${kind}=${on}: 存在しない枠の旧割当をすべて違反にする`);
    assert(T.app.outputCheck(snapshot(R, M, asg)).stop, "保存前確認で旧割当の出力を止める");
    await download(snapshot(R, M, asg));
    assert.strictEqual(downloads.length, 0, "直接出力も勤務表と説明資料を出さない");
    assert.strictEqual(alerts.length, 2, "両方の直接出力で理由を知らせる");
    assert.strictEqual(JSON.stringify(asg), before, "旧割当は消さず再計算まで残す");
    // 現在の枠だけで作った正常な結果は従来どおり出力できる。
    const current = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), clone(asg[T.Problem.key(s)])]));
    assert.strictEqual(T.check(P, current).V.length, 0);
    assert.strictEqual(T.app.outputCheck(snapshot(R, M, current)).stop, null);
    await download(snapshot(R, M, current));
    assert.strictEqual(downloads.length, 2); assert.strictEqual(alerts.length, 0);
    assert(downloads[0].blob.size > 0); assert((await downloads[1].blob.text()).includes("<!DOCTYPE html>"));
    console.log(`ok ${kind}=${on}: 旧割当 ${removed.length} 枠を拒否、現在の枠は出力可`);
  }
  { // 勤務者が配列、OC だけ、空の古い枠、同じ枠を固定したケース。
    const { R, M, asg } = fixture(); R.profile.shifts[0].on = "none";
    const current = Object.fromEntries(Object.entries(asg).filter(([k]) => k.endsWith(":night")));
    for (const v of [{ work: names[0], oc: [] }, { work: [names[0], names[1]], oc: [] }, { work: "", oc: [names[0]] }]) {
      const old = Object.assign(clone(current), { "1:day": v }); M.fixed.day[1] = names[0];
      const P = new T.Problem(R, M), chk = T.check(P, old);
      assert.strictEqual(structural(P, old).length, 1, "勤務者・複数勤務者・OCのみのどれも非空");
      assert(!chk.WC.some(v => v.code === "SLOT_NOT_EXISTS"), "固定指定でも構造違反は許容しない");
      delete M.fixed.day[1];
    }
    const P = new T.Problem(R, M);
    for (const v of [{}, { work: "", oc: [] }, { work: [], oc: [] }, { work: null, oc: [] }]) {
      assert.strictEqual(T.check(P, Object.assign(clone(current), { "1:day": v })).V.length, 0, "空の古い枠は割当でない");
    }
    for (const key of ["31:night", "1:unknown"]) assert.strictEqual(structural(P, Object.assign(clone(current), { [key]: { work: names[0], oc: [] } })).length, 1, "月外の日付・未知の帯も出力しない");
    for (const lang of ["ja", "en"]) { T.setLang(lang); const text = T.check(P, Object.assign(clone(current), { "1:day": { work: names[0], oc: [] } })).V.join(" "); assert(text.includes("1:day") && !text.includes("SLOT_NOT_EXISTS"), "違反はキーだけでなく翻訳した理由を示す"); }
    T.setLang("ja");
    console.log("ok 勤務者配列・OCのみ・空枠・固定による許容なし・不正キー・違反文面");
  }
  { // 前月末は prev_month、翌月1日は fixed[N+1] に入り、当月の割当と混ぜない。
    const { R, M, asg } = fixture();
    M.prev_month.last_days = [{ date: 30, night: [names[0], names[1]], night_oc: [names[2]] }, { date: 31, day: names[1], night: names[2], day_oc: [], night_oc: [] }];
    M.fixed.day[31] = [names[0], names[1]]; M.fixed.night[31] = names[2]; M.fixed.day_oc[31] = [names[2]];
    const P = new T.Problem(R, M), chk = T.check(P, asg);
    assert(P.prevWorked([-1, "night"], names[0]) && P.prevWorked([-1, "night"], names[1]));
    assert.deepStrictEqual(P.nextFixed.day, [names[0], names[1]]);
    assert(chk.A.oc([-1, "night"]).includes(names[2]));
    assert.strictEqual(chk.V.length, 0, "前月末と翌月1日の接続は構造違反にしない");
    assert.strictEqual(T.app.outputCheck(snapshot(R, M, asg)).stop, null);
    console.log("ok 正式な前月末・翌月1日の入力形式を保持");
  }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
