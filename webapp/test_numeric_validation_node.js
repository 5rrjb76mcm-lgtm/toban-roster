// Invalid numeric settings must not produce a roster with a misleading objective or calendar.
// Synthetic data only. Usage: node test_numeric_validation_node.js /path/to/highs
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "plugins.js"]) run(f);
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
for (const f of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", f), "utf8")));
T.setLang("ja");
const clone = x => JSON.parse(JSON.stringify(x)), names = ["Synthetic A", "Synthetic B"];
function fixture() {
  const R = { profile: { id: "synthetic-numeric", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] },
    doctors: names.map(name => ({ name, team: "S", quota: 15 })), weights: { fixed_conflict: 1000 }, rule_states: {} };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11 }, R);
  return { R, M };
}
const els = new Map();
const el = s => { if (!els.has(s)) els.set(s, { value: "", textContent: "", checked: false, disabled: false, handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; } }); return els.get(s); };
globalThis.document = { querySelector: el };
globalThis.location = { pathname: "/test/numeric-validation.html" };
globalThis.localStorage = { getItem() { return null; }, setItem() { } };
run("app-core.js"); run("app-folder.js"); run("app-solve.js");
const A = T.app;
A.readAll = () => { }; A.loadPendingPlugins = async () => { };
let calls = 0, saves = 0;
A.highs = { solve() { calls++; throw new Error("Invalid input reached the solver"); } };
A.save = () => saves++;
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); console.log("ok " + label); passed++; } catch (e) { console.error("FAIL " + label + ": " + e.message); failed++; } }
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  await test("negative/nonfinite active weights are rejected without changing input", () => {
    for (const v of [-1, "-1", Infinity, -Infinity, NaN, "bad", [], true]) {
      const { R, M } = fixture(); R.rule_states.quota_target = "soft"; R.weights.target_deviation = v;
      assert.throws(() => new T.Problem(R, M), /weights\.target_deviation/);
      assert.strictEqual(R.weights.target_deviation, v, "keep the invalid value for correction");
    }
    const { R, M } = fixture(); R.weights.fixed_conflict = -1;
    assert.throws(() => new T.Problem(R, M), /weights\.fixed_conflict/);
  });
  await test("zero, fractional and legacy numeric-string weights keep matching penalties", () => {
    for (const w of [0, 0.5, "0.5"]) {
      const { R, M } = fixture(); R.rule_states.quota_target = "soft"; R.weights.target_deviation = w;
      const P = new T.Problem(R, M), pin = Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: names[i < 20 ? 0 : 1], oc: [] }]));
      const result = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 });
      assert.strictEqual(result.status, "Optimal");
      assert.strictEqual(result.objective, 10 * +w);
      assert.strictEqual(T.penalty(P, result.asg).total, result.objective);
      assert.strictEqual(T.check(P, result.asg).V.length, 0);
    }
    const { R, M } = fixture(); R.weights.target_deviation = -1;
    assert.doesNotThrow(() => new T.Problem(R, M), "disabled rule preserves its inactive value");
    assert.strictEqual(R.weights.target_deviation, -1);
  });
  await test("shift count bounds and individual caps require nonnegative integers", () => {
    for (const field of ["min", "max", "own"]) for (const v of [14.5, -1, NaN, Infinity, "bad", [], true]) {
      const { R, M } = fixture(); R.rule_states.shift_count_range = "soft"; R.shift_counts = { night: { max: 15 } };
      if (field === "own") R.doctors[0].shift_max_night = v; else R.shift_counts.night[field] = v;
      assert.throws(() => new T.Problem(R, M), field === "own" ? /shift_max_night/ : new RegExp("shift_counts.night." + field));
    }
    for (const state of ["hard", "soft"]) {
      const { R, M } = fixture(); R.rule_states.shift_count_range = state; R.shift_counts = { night: { min: "0", max: "15" }, day: { min: "", max: null } };
      R.doctors[0].shift_max_night = "15"; R.weights.shift_count_range = 0.5;
      const P = new T.Problem(R, M), result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
      assert.strictEqual(result.status, "Optimal"); assert.strictEqual(result.objective, T.penalty(P, result.asg).total);
      assert.strictEqual(T.check(P, result.asg).V.length, 0);
    }
    const { R, M } = fixture(); R.shift_counts = { night: { max: 14.5 } }; R.doctors[0].shift_max_night = 14.5;
    assert.doesNotThrow(() => new T.Problem(R, M), "disabled count rule can retain its old value");
    assert.strictEqual(R.shift_counts.night.max, 14.5);
  });
  await test("invalid calendar values are rejected before normalization writes or date rollover", () => {
    for (const [key, values] of [["month", [null, 0, 13, 1.5, "", " ", true, [], {}]], ["year", [null, 0, 26, 2026.5, Infinity, 999999, true, []]]]) for (const value of values) {
      const { R, M } = fixture(); M[key] = value; M.cath_off_days = [3];
      const before = JSON.stringify(M);
      assert.throws(() => T.normalizeMonth(M, R), /year.*month/);
      assert.strictEqual(JSON.stringify(M), before, "invalid month must not be partially migrated");
      assert.throws(() => new T.Problem(R, M), /year.*month/);
      assert.strictEqual(!!A.isMonthObj(M), false, "file and browser-state admission use the same calendar check");
    }
    for (const [year, month, N] of [[2026, 11, 30], [2026, 12, 31], [2028, 2, 29], ["2026", "11", 30]]) {
      const { R } = fixture(), M = T.normalizeMonth({ year, month }, R), P = new T.Problem(R, M);
      assert.strictEqual(P.N, N); assert.strictEqual(P.date(1).getFullYear(), +year); assert.strictEqual(P.date(1).getMonth() + 1, +month);
      assert(A.isMonthObj(M));
    }
  });
  await test("app solve/output guards report invalid settings and preserve previous results", async () => {
    for (const change of [R => { R.rule_states.quota_target = "soft"; R.weights.target_deviation = -1; }, R => { R.rule_states.shift_count_range = "soft"; R.shift_counts = { night: { max: 14.5 } }; }, (R, M) => { M.month = 13; }]) {
      const { R, M } = fixture(); change(R, M);
      const result = { status: "Optimal", asg: { "1:night": { work: names[0], oc: [] } }, plugins: [] };
      Object.assign(A.state, { rules: R, month: M, result });
      const before = JSON.stringify(A.state), start = calls;
      await A.runSolve();
      assert.strictEqual(calls, start); assert.strictEqual(saves, 0); assert.strictEqual(A.state.result, result);
      assert.strictEqual(JSON.stringify(A.state), before); assert(/入力の読み取りに失敗/.test(el("#calcLog").textContent));
      assert(A.outputCheck({ rules: R, month: M, result }).stop, "old output must also be blocked");
      assert.strictEqual(A.solving, false); assert.strictEqual(el("#btnSolve").disabled, false);
    }
  });
  await test("settings table can retain, report and correct an invalid numeric value", () => {
    run("app-settings.js");
    const { R, M } = fixture(); R.rule_states.quota_target = "soft";
    Object.assign(A.state, { rules: R, month: M, result: { status: "Optimal", asg: {} } });
    const monthBefore = JSON.stringify(M), result = A.state.result;
    const rows = R.doctors.map((d, i) => ({ dataset: { i }, querySelector(sel) {
      const match = sel.match(/^\[data-f="(\w+)"\]$/); if (!match) return null;
      return { name: { value: d.name }, team: { value: d.team }, years: { value: "0" }, quota: { value: "15" }, duty: { value: "" } }[match[1]] || null;
    } }));
    const weight = { dataset: { w: "target_deviation" }, value: "-1" };
    const before = globalThis.document;
    globalThis.document = { querySelector: () => null, querySelectorAll: s => s === "#doctorTable tr[data-i]" ? rows : s === "#weightsTable [data-w]" ? [weight] : [] };
    try {
      assert.doesNotThrow(() => A.readSettings()); assert.strictEqual(R.weights.target_deviation, -1);
      assert.strictEqual(JSON.stringify(M), monthBefore); assert.strictEqual(A.state.result, result);
      assert.throws(() => new T.Problem(R, M), /weights\.target_deviation/);
      weight.value = "0.5"; assert.doesNotThrow(() => A.readSettings()); assert.strictEqual(R.weights.target_deviation, 0.5);
      assert.doesNotThrow(() => new T.Problem(R, M)); assert.strictEqual(A.state.result, result);
    } finally { globalThis.document = before; }
  });
  await test("new-month button and month switch reject bad dates without clearing current state", async () => {
    run("app-month.js");
    globalThis.document = { querySelector: el, querySelectorAll: () => [], addEventListener() { } };
    globalThis.window = { addEventListener() { } };
    Object.defineProperty(globalThis, "navigator", { value: { language: "ja" }, configurable: true });
    T.applyI18n = () => { };
    const { R } = fixture(); T.DEFAULT_RULES = clone(R); A.load = () => null;
    for (const k of ["renderSettingsMonth", "renderDoctor", "renderFixed", "renderResult", "renderSettings", "renderFolderBar", "renderHeader", "bindSettingsMonth", "bindDoctor", "bindFixed", "bindSettings", "restoreFolder", "clearUndo"]) A[k] = () => { };
    A.saveBeforeSwitch = async () => true;
    const alerts = [], toasts = [];
    A.toast = s => toasts.push(s); globalThis.alert = s => alerts.push(s); globalThis.confirm = () => true;
    run("app-main.js"); T.init();
    assert(new T.Problem(A.state.rules, A.state.month).N >= 28, "startup without a saved/sample month uses the current valid month");
    const click = el("#btnNewMonth").handlers.click;
    for (const answers of [["2026", "13"], ["2026", "1.5"], ["2026.5", "11"], ["", "11"], [null], ["2026", null]]) {
      Object.assign(A.state, { month: T.normalizeMonth({ year: 2026, month: 11, notes: "keep" }, R), result: { asg: {} }, meta: { savedSig: "keep" }, base: { keep: true } });
      const before = JSON.stringify(A.state), refs = { ...A.state }, pending = answers.slice(), n = alerts.length;
      globalThis.prompt = () => pending.shift();
      await click();
      assert.strictEqual(JSON.stringify(A.state), before); for (const k of Object.keys(refs)) assert.strictEqual(A.state[k], refs[k]);
      assert.strictEqual(alerts.length - n, answers.includes(null) ? 0 : 1);
      assert.strictEqual(A.switching, 0);
    }
    const before = JSON.stringify(A.state); await A.onMonthChange(2026, 13);
    assert.strictEqual(JSON.stringify(A.state), before); assert(toasts.some(s => /year.*month/.test(s)));
    assert.throws(() => A.blankMonth(2026, 13), /year.*month/);
    const pending = ["2028", "2"]; globalThis.prompt = () => pending.shift(); await click();
    assert.strictEqual(A.state.month.year, 2028); assert.strictEqual(A.state.month.month, 2);
    assert.strictEqual(A.state.meta, null); assert.strictEqual(A.state.base, null); assert.strictEqual(A.state.result, null);
    assert.strictEqual(new T.Problem(A.state.rules, A.state.month).N, 29);
  });
  await test("carryover failure with invalid settings keeps the current month and synchronization state", async () => {
    A.fsOK = () => false; A.dirHandle = null; A.choose = async () => "prev";
    const toasts = []; A.toast = s => toasts.push(s);
    for (const change of [R => { R.rule_states.quota_target = "soft"; R.weights.target_deviation = -1; }, R => { R.rule_states.shift_count_range = "soft"; R.shift_counts = { night: { max: 14.5 } }; }]) {
      const { R, M } = fixture(); change(R);
      Object.assign(A.state, { rules: R, month: M, result: { asg: {} }, meta: { savedSig: "keep" }, base: { keep: true } });
      const before = JSON.stringify(A.state), refs = { ...A.state }, n = toasts.length;
      await A.onMonthChange(2026, 12);
      assert.strictEqual(JSON.stringify(A.state), before); for (const k of Object.keys(refs)) assert.strictEqual(A.state[k], refs[k]);
      assert(toasts.length > n && /作れません/.test(toasts.at(-1)), "show why the carryover was stopped");
    }
    const { R, M } = fixture(); Object.assign(A.state, { rules: R, month: M, result: null });
    await A.onMonthChange(2026, 12);
    assert.strictEqual(A.state.month.month, 12); assert.strictEqual(A.state.rules, R, "successful carryover retains the current rules");
  });
  console.log(`numeric validation: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
