// 夜勤枠がない日の固定入力を防ぎ、以前の固定は警告して解除できる。架空データのみ。
// node test_fixed_slot_node.js <highs パッケージのパス>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const sources = ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"];
const source = f => fs.readFileSync(f === "check.js" && process.env.TOBAN_CHECK_SOURCE || f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8");
const ruleFiles = fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort();
globalThis.T = {};
for (const f of sources) vm.runInThisContext(source(f), { filename: f });
for (const f of ruleFiles) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: f });
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log("ok  " + name); } catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); } }
const names = ["Synthetic A", "Synthetic B"];
function setup(on = "weekdays", month = {}) {
  const R = { profile: { id: "synthetic-fixed-slot", calendar: { holidays: "none", closure: [] },
    roles: [{ id: "S", label: "Staff", refs: ["charge"], standby: true }],
    shifts: [{ id: "day", on: "none" }, { id: "night", on }] },
    doctors: names.map(name => ({ name, team: "S", quota: 0 })), weights: { fixed_conflict: 1000 }, rule_states: {} };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  const m = T.normalizeMonth(Object.assign({ year: 2026, month: 11, holidays: [3], next_first_day_in_calendar: true }, month), R);
  return new T.Problem(R, m);
}
(async () => {
  if (!process.argv[2]) throw new Error("既存の highs パッケージのパスを指定してください");
  const highs = await require(process.argv[2])();
  test("週末・祝日の不存在夜勤と夜間OCを具体的に警告", () => {
    const P = setup("weekdays", { fixed: { night: { 1: names[0], 3: names[0] }, night_oc: { 7: [names[1]] } } });
    const warnings = T.lint(P).filter(x => x.code === "LINT_FIXED_NO_SLOT");
    assert.strictEqual(warnings.length, 3);
    assert.deepStrictEqual(warnings.map(x => x.args.who), [names[0], names[0], names[1]]);
    assert.ok(warnings.every(x => x.msg.includes(x.args.day) && x.msg.includes(x.args.who)));
  });
  test("休日だけの夜勤も平日の固定を警告、空OC配列は無視", () => {
    const P = setup("off_days", { fixed: { night: { 2: names[0] }, night_oc: { 2: [] } } });
    assert.strictEqual(T.lint(P).filter(x => x.code === "LINT_FIXED_NO_SLOT").length, 1);
  });
  test("日勤の不存在固定の警告も維持", () => {
    const P = setup("all", { fixed: { day: { 2: names[0] }, day_oc: { 2: [names[1]] } } });
    assert.strictEqual(T.lint(P).filter(x => x.code === "LINT_FIXED_NO_SLOT").length, 2);
  });
  for (const [on, d] of [["weekdays", 2], ["off_days", 1], ["off_days", 3], ["all", 1]]) test(`${on} の実在する夜勤固定は計算・検算が一致`, () => {
    const P = setup(on, { fixed: { night: { [d]: names[1] } } }), result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
    assert.ok(!T.lint(P).some(x => x.code === "LINT_FIXED_NO_SLOT"));
    assert.strictEqual(result.status, "Optimal");
    assert.strictEqual(result.asg[`${d}:night`].work, names[1]);
    assert.strictEqual(T.check(P, result.asg).V.length, 0);
    assert.strictEqual(T.penalty(P, result.asg).total, result.objective);
  });
  let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("-- 固定枠UI試験は省略（Playwright が無い）"); }
  if (chromium && fs.existsSync("/Applications/Google Chrome.app")) {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await browser.newContext(), external = [], errors = [];
      await context.route(/^https?:/, r => { external.push(r.request().url()); return r.abort(); });
      const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
      await page.setContent('<div id="doctorPane"></div><div id="fixedPane"></div>');
      for (const f of [...sources, "app-core.js", "app-input.js"]) await page.addScriptTag({ content: source(f) });
      for (const f of ruleFiles) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8") });
      const results = await page.evaluate(() => {
        const A = T.app, who = "Synthetic A", other = "Synthetic B", out = [];
        A.save = A.toast = () => {};
        A.bindDoctor(); A.bindFixed();
        const q = s => document.querySelector(s), fx = (d, k = "night") => `[data-fx="${k}"][data-d="${d}"]`, cal = d => `[data-cal="fixed"][data-k="night"][data-d="${d}"]`;
        const values = s => q(s) ? [...q(s).options].map(o => o.value) : [];
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        const change = (s, value) => { q(s).value = value; q(s).dispatchEvent(new Event("change", { bubbles: true })); };
        const render = () => { A.renderDoctor(); A.renderFixed(); };
        const reset = (on = "weekdays", opts = {}) => {
          const R = { profile: { id: "synthetic-fixed-slot-ui", calendar: { holidays: "none", closure: [] },
            roles: [{ id: "I", label: "Staff", refs: ["charge"], standby: true }, { id: "Y", label: "Junior", refs: ["junior"], standby: true }],
            shifts: [{ id: "day", on: "none" }, { id: "night", on }], positions: { work: { count: opts.multi ? 2 : 1 } } },
            doctors: [{ name: who, team: "I" }, { name: other, team: "I" }], weights: { fixed_conflict: 1000 }, rule_states: {} };
          T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
          const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3], next_first_day_in_calendar: true, next_month_first_day_is_holiday: !!opts.nextHoliday }, R);
          Object.assign(A.state, { rules: R, month: m, result: null, ui: { doctor: 0 } }); render(); return m;
        };
        const test = (name, fn) => { try { fn(); out.push({ name, pass: true }); } catch (e) { out.push({ name, pass: false, error: e.message }); } };
        test("UI: 夜勤枠の有無に合わせて勤務・OCの新規固定を提示", () => {
          for (const on of ["weekdays", "off_days", "all"]) {
            reset(on); const P = new T.Problem(A.state.rules, A.state.month);
            for (const d of [1, 2, 3, 7, 31]) { const exists = d > P.N ? P.nextSlotExists("night") : P.slotExists(d, "night");
              check(values(fx(d)).includes(who) === exists, `${on}/${d}: fixed worker choices`);
              check(values(fx(d, "nightI")).includes(who) === exists, `${on}/${d}: fixed OC choices`);
              check(values(cal(d)).includes("night") === exists, `${on}/${d}: calendar work choices`);
              check(values(cal(d)).includes("nightoc") === exists, `${on}/${d}: calendar OC choices`);
            }
          }
          reset("weekdays", { nextHoliday: true }); check(!q(fx(31)) && !q(cal(31)), "next-month holiday must hide new night fixed entries");
        });
        test("UI: 固定表の旧固定・印・OCを保持し、空欄で明示解除", () => {
          const m = reset(); m.fixed.night[1] = who; m.fixed.night_oc[7] = [who]; m.fixed_tags[`1:night|${who}`] = "Synthetic tag"; render();
          check(q(fx(1)).selectedOptions[0].textContent.includes("現在は使わない値"), "annotate old fixed worker");
          check(!values(fx(1)).includes(other) && !values(fx(7, "nightI")).includes(other), "no new candidate on missing slot");
          change(fx(2), other); check(m.fixed.night[1] === who && m.fixed.night_oc[7].includes(who) && m.fixed_tags[`1:night|${who}`] === "Synthetic tag", "unrelated change preserves old entries");
          change(fx(1), ""); check(!m.fixed.night[1] && !m.fixed_tags[`1:night|${who}`], "explicit worker removal clears tag");
          change(fx(7, "nightI"), ""); check(!m.fixed.night_oc[7], "explicit OC removal");
        });
        test("UI: 職員カレンダーでも旧固定を保全して解除", () => {
          const m = reset(); m.fixed.night[1] = who; m.fixed.night_oc[7] = [who]; m.fixed_tags[`1:night|${who}`] = "Synthetic tag"; render();
          check(values(cal(1)).join() === ",night" && values(cal(7)).join() === ",nightoc", "only existing assignment can be retained");
          change('[data-cal="duty"][data-d="2"][data-part="am"]', "ward");
          check(m.fixed.night[1] === who && m.fixed.night_oc[7].includes(who) && m.fixed_tags[`1:night|${who}`], "calendar edit preserves values and tags");
          change(cal(1), ""); change(cal(7), ""); check(!m.fixed.night[1] && !m.fixed.night_oc[7] && !m.fixed_tags[`1:night|${who}`], "calendar explicit removal");
        });
        test("UI: 複数人の旧固定も保持し不存在枠の自由入力を出さない", () => {
          const m = reset("weekdays", { multi: true }); check(!q(fx(1)), "no empty free text for nonexistent slot");
          m.fixed.night[1] = [who, other]; m.fixed_tags[`1:night|${other}`] = "Synthetic tag"; render();
          check(q(fx(1)).tagName === "SELECT" && q(fx(1)).options.length === 2, "retention or removal only");
          change(fx(2), other); check(m.fixed.night[1].join() === [who, other].join() && m.fixed_tags[`1:night|${other}`], "multi-worker names and tag survive");
          change(fx(1), ""); check(!m.fixed.night[1] && !m.fixed_tags[`1:night|${other}`], "remove all explicitly");
        });
        return out;
      });
      for (const r of results) test(r.name, () => assert.ok(r.pass, r.error));
      test("UI: ページエラー・外部通信なし", () => { assert.deepStrictEqual(errors, []); assert.deepStrictEqual(external, []); });
    } finally { await browser.close(); }
  } else if (chromium) console.log("-- 固定枠UI試験は省略（Google Chrome が無い）");
  console.log(`${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
