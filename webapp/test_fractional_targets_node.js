// Fractional monthly targets and absolute quotas: solver/checker, validation, UI, lint and Python.
// Synthetic data only. node test_fractional_targets_node.js /path/to/highs [/path/to/python]
// TOBAN_FRACTIONAL_ROOT can point at a read-only baseline checkout for reproduction.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), cp = require("child_process");
const root = process.env.TOBAN_FRACTIONAL_ROOT || path.join(__dirname, ".."), web = path.join(root, "webapp");
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(web, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "plugins.js", "merge.js"]) run(f);
for (const f of fs.readdirSync(path.join(web, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(web, "data/rules.json"), "utf8"));
const names = ["Synthetic Alpha", "Synthetic Beta"], clone = x => JSON.parse(JSON.stringify(x));
const close = (got, want, label = "") => assert(Math.abs(got - want) < 1e-7, `${label}: expected ${want}, got ${got}`);
function fixture(qa = 15, qb = 15) {
  const R = { profile: { id: "synthetic-fractions", roles: [{ id: "S", label: "Staff", refs: [] }],
    shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] },
    doctors: names.map((name, i) => ({ name, team: "S", quota: i ? qb : qa, years: 1 })), quota_tolerance: 1 };
  T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  for (const k in R.weights) R.weights[k] = 0;
  R.rule_states.quota_target = "soft"; R.weights.target_deviation = 1;
  return { R, M: T.normalizeMonth({ year: 2026, month: 11 }, R) };
}
const pinFor = (P, count = 15) => Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: names[i < count ? 0 : 1], oc: [] }]));
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.stack); } }
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  function score(R, M, count = 15, expected, opts = {}) {
    const beforeR = clone(R), beforeM = clone(M), P = new T.Problem(R, M), pin = pinFor(P, count);
    const result = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0, ...opts });
    assert.strictEqual(result.status, "Optimal");
    close(result.objective, expected, "solver objective"); close(T.penalty(P, pin, opts).total, expected, "independent penalty");
    assert.deepStrictEqual(R, beforeR); assert.deepStrictEqual(M, beforeM);
    return { P, pin, result };
  }
  for (const target of [15, 15.5, 15.25, 15.3, 0.1, 0.3, 30.25, "15.3"]) for (const source of ["target", "quota"]) {
    await test(`${source} ${target}: pinned fractional score matches exact distance`, () => {
      const { R, M } = fixture(); if (source === "target") M.targets[names[0]] = target; else R.doctors[0].quota = target;
      score(R, M, 15, Math.abs(15 - +target));
    });
  }
  for (const target of [15.25, 15.3, 15.75]) await test(`unfixed optimum at target ${target} agrees with enumerated counts`, () => {
    const { R, M } = fixture(); M.targets = { [names[0]]: target, [names[1]]: 30 - target };
    const P = new T.Problem(R, M), result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
    assert.strictEqual(result.status, "Optimal");
    const best = Math.min(...Array.from({ length: 31 }, (_, k) => Math.abs(k - target) + Math.abs(30 - k - (30 - target))));
    close(result.objective, best); close(T.penalty(P, result.asg).total, best); assert.deepStrictEqual(T.check(P, result.asg).V, []);
  });
  for (const target of [15, 15.25, 15.3, 15.5]) for (const reference of [null, 14, 15.3]) await test(`avoid fallback ${target}, reference ${reference}: fractional shortfall`, () => {
    const { R, M } = fixture(); R.rule_states.quota_target = "off"; R.rule_states.avoid_days = "soft";
    R.weights.avoid_day = 0; R.weights.avoid_no_reduction = 7; M.targets[names[0]] = target;
    M.avoid = [{ name: names[0], day: 30, part: "night" }];
    const opts = reference === null ? {} : { avoidRef: { [names[0]]: reference } };
    score(R, M, 15, 7 * Math.max(0, (reference ?? target) - 15), opts);
  });
  await test("tiny fractional targets retain their weighted cost on either side of the integer cutoff", () => {
    for (const delta of [1e-6, 1e-8, 1e-10]) for (const direction of [-1, 1]) {
      const target = 15 + direction * delta, { R, M } = fixture(); M.targets[names[0]] = target;
      R.weights.target_deviation = 1000; R.rule_states.avoid_days = "soft"; R.weights.avoid_day = 0; R.weights.avoid_no_reduction = 1700;
      M.avoid = [{ name: names[0], day: 30, part: "night" }];
      for (const count of [14, 15, 16]) {
        const expected = 1000 * (Math.abs(count - target) + Math.abs((30 - count) - 15)) + 1700 * Math.max(0, target - count);
        score(R, M, count, expected);
      }
      const P = new T.Problem(R, M), result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
      assert.strictEqual(result.status, "Optimal");
      close(result.objective, 1000 * Math.abs(15 - target) + 1700 * Math.max(0, target - 15));
      close(result.objective, T.penalty(P, result.asg).total);
    }
  });
  await test("fractional hard quota uses actual interval; fixed upper overflow remains tolerated", () => {
    const { R, M } = fixture(15.3, 14.7); R.rule_states.quota_range = "hard";
    let { P, pin } = score(R, M, 15, 0.6); assert.deepStrictEqual(T.check(P, pin).V, []);
    P = new T.Problem(R, M); pin = pinFor(P, 17);
    assert.strictEqual(T.solve(P, highs, { pin, timeLimit: 5 }).status, "Infeasible");
    assert(T.check(P, pin).VC.some(x => x.code === "QUOTA_OUT_OF_RANGE"));
    R.doctors[1].quota = 13;
    M.fixed.night = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i + 1, names[0]]));
    ({ P, pin } = score(R, M, 17, 1.7)); assert.deepStrictEqual(T.check(P, pin).V, []);
    assert(T.check(P, pin).WC.some(x => x.code === "QUOTA_OVER_BY_FIXED"));
  });
  await test("hard quota lint counts feasible integers rather than fractional capacity", () => {
    const { R, M } = fixture(15.3, 14.7); R.rule_states.quota_range = "hard"; R.quota_tolerance = 0;
    const P = new T.Problem(R, M), lint = T.lint(P);
    assert.strictEqual(lint.filter(x => x.code === "LINT_QUOTA_NO_INTEGER").length, 2);
    assert(lint.some(x => x.code === "LINT_CAPACITY_HIGH" && x.args.total === 29));
    assert(lint.some(x => x.code === "LINT_CAPACITY_LOW" && x.args.total === 31));
    assert.strictEqual(T.solve(P, highs, { timeLimit: 5 }).status, "Infeasible");
    R.rule_states.quota_range = "off";
    assert(!T.lint(new T.Problem(R, M)).some(x => /^LINT_(QUOTA_NO_INTEGER|CAPACITY_)/.test(x.code)));
  });
  await test("fractional targets do not loosen explicit integer min/max", () => {
    const { R, M } = fixture(15.3, 14.7); R.rule_states.quota_range = "hard";
    M.count_min[names[0]] = 15; M.count_max[names[0]] = 15;
    const { P, pin } = score(R, M, 15, 0.6); assert.deepStrictEqual(T.check(P, pin).V, []);
    M.count_max[names[0]] = 15.3; assert.throws(() => new T.Problem(R, M), /count_max/);
  });
  await test("near-integer hard quotas cannot bypass range checks through solver tolerance", () => {
    for (const delta of [1e-6, 1e-8, 1e-10]) for (const direction of [-1, 1]) {
      const count = direction === 1 ? 14 : 16, { R, M } = fixture(15 + direction * delta, 30 - count);
      R.rule_states.quota_range = "hard";
      const P = new T.Problem(R, M), pin = pinFor(P, count);
      assert.strictEqual(T.solve(P, highs, { pin, timeLimit: 5 }).status, "Infeasible");
      assert(T.check(P, pin).VC.some(x => x.code === "QUOTA_OUT_OF_RANGE"));
    }
    const { R, M } = fixture(15 + 1e-8, 15 - 1e-8); R.rule_states.quota_range = "hard"; R.quota_tolerance = 0;
    assert.strictEqual(T.solve(new T.Problem(R, M), highs, { timeLimit: 5 }).status, "Infeasible");
  });
  await test("invalid quota/target data is rejected without rewriting user input", () => {
    for (const key of ["target", "quota"]) for (const value of [-61, -0.1, Infinity, -Infinity, NaN, "bad", "1e309", " ", true, false, [], {}]) {
      const { R, M } = fixture(); if (key === "target") M.targets[names[0]] = value; else R.doctors[0].quota = value;
      const beforeR = structuredClone(R), beforeM = structuredClone(M);
      assert.throws(() => new T.Problem(R, M), key === "target" ? /targets/ : /quota/);
      assert.deepStrictEqual(R, beforeR); assert.deepStrictEqual(M, beforeM);
    }
  });
  await test("blank/default, zero and numeric strings retain fractional semantics", () => {
    for (const value of [null, "", undefined]) { const { R, M } = fixture(15.3); M.targets[names[0]] = value;
      assert.strictEqual(new T.Problem(R, M).targets[names[0]], 15.3); }
    for (const value of [null, "", undefined]) { const { R, M } = fixture(); R.doctors[0].quota = value;
      assert.strictEqual(new T.Problem(R, M).quota(names[0]), 0); }
    for (const value of [0, "0", "15.25", "1.53e1", " 15.3 "]) { const { R, M } = fixture(); M.targets[names[0]] = value;
      assert.strictEqual(new T.Problem(R, M).targets[names[0]], +value); }
    const { R, M } = fixture(); R.profile.quota_mode = "share"; R.doctors[0].quota = "unused";
    assert.strictEqual(new T.Problem(R, M).quota(names[0]), 15, "share allocation remains integer and ignores inactive absolute data");
  });
  await test("auto target final partial step avoids overshoot and keeps fractional input", () => {
    for (const quotas of [[15.25, 15], [14.7, 15], [15.3, 15.3], [14.25, 14.25], [15, 15], [0.1, 29.9], [0.3, 29.7]]) {
      const { R, M } = fixture(...quotas), before = clone({ R, M }), at = T.autoTargets(R, M);
      close(names.reduce((sum, n, i) => sum + (at.targets[n] ?? quotas[i]), 0), 30);
      assert(!at.lines.some(x => x.includes("調整しきれません")), "no residual warning"); assert.deepStrictEqual({ R, M }, before);
      if (quotas[0] + quotas[1] === 30) assert.deepStrictEqual(at.targets, {});
    }
    const { R, M } = fixture(15.25, 15), at = T.autoTargets(R, M);
    assert.deepStrictEqual(at.targets, { [names[0]]: 15 });
    R.doctors = Array.from({ length: 100 }, (_, i) => ({ name: `Synthetic ${i}`, team: "S", quota: 0.3 }));
    assert.deepStrictEqual(T.autoTargets(R, M).targets, {}, "sum(100 × 0.3) must not move a person for FP noise");
    const zero = fixture(.1, .2); zero.R.profile.positions = { work: { count: 0 } };
    const empty = T.autoTargets(zero.R, zero.M);
    assert.deepStrictEqual(empty.targets, { [names[0]]: 0, [names[1]]: 0 });
    assert(!empty.lines.some(x => x.includes("調整しきれません")), "0.1 + 0.2 must finish without an epsilon-size warning");
  });
  await test("auto target fractional steps stay inside limits and leave share allocation unchanged", () => {
    const { R, M } = fixture(15.3, 15.3); M.count_min[names[0]] = 15;
    let at = T.autoTargets(R, M); close(at.targets[names[0]], 15); close(at.targets[names[1]], 15);
    R.profile.quota_mode = "share"; R.doctors[0].share = 1; R.doctors[1].share = 2;
    const P = new T.Problem(R, M); assert.strictEqual(P.quota(names[0]), 10); assert.strictEqual(P.quota(names[1]), 20);
    at = T.autoTargets(R, M); assert.deepStrictEqual(at.targets, {});
  });
  await test("UI renders fractional controls and reads fractions without touching integer limits", () => {
    const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, { innerHTML: "", value: "", children: [{}], dataset: {}, handlers: {}, addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }, querySelector: () => null, querySelectorAll: () => [] }); return nodes.get(s); };
    globalThis.document = { querySelector: node, querySelectorAll: () => [] };
    globalThis.location = { pathname: "/synthetic/fractions" }; globalThis.localStorage = { getItem: () => null, setItem() { } };
    run("app-core.js"); run("app-input.js"); run("app-settings.js");
    const A = T.app, { R, M } = fixture(15.25, 14.75); R.rule_states.quota_range = "hard";
    Object.assign(A.state, { rules: R, month: M }); A.save = () => { };
    A.renderSettings(); A.renderSettingsMonth();
    const quotaTag = node("#doctorTable").innerHTML.match(/<input[^>]*data-f="quota"[^>]*>/)[0];
    const monthHtml = node("#monthSettings").innerHTML;
    const targetTag = monthHtml.match(/<input[^>]*data-target="Synthetic Alpha"[^>]*>/)[0];
    for (const tag of [quotaTag, targetTag]) { assert(tag.includes('min="0"')); assert(tag.includes('step="any"')); }
    assert(monthHtml.match(/<input[^>]*step="1"[^>]*data-cmin=/));
    const inputs = [{ dataset: { target: names[0] }, value: "15.3" }, { dataset: { target: names[1] }, value: "14.7" }];
    node("#monthSettings").querySelectorAll = s => s === "[data-target]" ? inputs : [];
    A.readSettingsMonth(); assert.strictEqual(M.targets[names[0]], 15.3); assert.strictEqual(M.targets[names[1]], 14.7);
    const quotaInputs = [{ value: "15.25", dataset: { f: "quota" } }, { value: "14.75", dataset: { f: "quota" } }];
    const rows = R.doctors.map((d, i) => ({ dataset: { i }, querySelector(s) {
      const match = s.match(/^\[data-f="(\w+)"\]$/); if (!match) return null;
      return { name: { value: d.name }, team: { value: d.team }, years: { value: "1" }, quota: quotaInputs[i], duty: { value: "" } }[match[1]] || null;
    } }));
    globalThis.document = { querySelector: () => null, querySelectorAll: s => s === "#doctorTable tr[data-i]" ? rows : [] };
    A.readSettings(); assert.strictEqual(R.doctors[0].quota, 15.25); assert.strictEqual(R.doctors[1].quota, 14.75);
    globalThis.document = { querySelector: node, querySelectorAll: () => [] }; A.bindSettings(); A.bindSettingsMonth();
    globalThis.document = { querySelector: s => s === "#monthSettings" ? node(s) : null, querySelectorAll: s => s === "#doctorTable tr[data-i]" ? rows : [] };
    for (const previous of ["bad", "Infinity", "1e309", true, [], {}, " 15.3 ", "0xF"]) {
      R.doctors[0].quota = previous; M.targets[names[0]] = previous;
      for (const field of [quotaInputs[0], inputs[0]]) { field.value = ""; field.getAttribute = () => String(previous); delete field.dataset.numericEdited; }
      A.readSettings(); A.readSettingsMonth();
      assert.deepStrictEqual(R.doctors[0].quota, previous, "untouched sanitized quota is not replaced by zero");
      assert.deepStrictEqual(M.targets[names[0]], previous, "untouched sanitized target is not removed");
      if ([" 15.3 ", "0xF"].includes(previous)) assert.doesNotThrow(() => new T.Problem(R, M));
      else assert.throws(() => new T.Problem(R, M), /quota|targets/, "invalid imported data still reaches validation");
      for (const fn of node("#settings").handlers.input) fn({ target: quotaInputs[0] });
      for (const fn of node("#monthSettings").handlers.input) fn({ target: inputs[0] });
      A.readSettings(); A.readSettingsMonth();
      assert.strictEqual(R.doctors[0].quota, 0, "explicitly clearing quota means zero");
      assert(!Object.hasOwn(M.targets, names[0]), "explicitly clearing target restores the quota");
    }
  });
  if (process.argv[3]) await test("Python default-profile reference preserves fractional scores and hard bounds", () => {
    // The reference retains its existing rule limitations. Use standard roles and shifts, only public synthetic staff.
    const R = clone(T.DEFAULT_RULES); T.fillDefaultRules(R); R.doctors = names.map(name => ({ name, team: "I", quota: 20, years: 1 })); R.name_order = names.slice();
    for (const k of Object.keys(R.weights)) R.weights[k] = 0; R.weights.target_deviation = 1; R.weights.avoid_no_reduction = 7;
    for (const id of ["oncall", "period_charge", "same_day_team", "same_day_charge_other", "same_day_double", "consecutive_days", "weekend_balance", "friday_night_min", "rest_day", "cath_requirement", "arrhythmia_pre_workday_night", "arrhythmia_responsible_night", "same_weekday_cap"]) R.rule_states[id] = "off";
    R.quota_tolerance = 1; R.oncall_requirement = Object.fromEntries(["I", "A", "Y", "C"].map(t => [t, { I: 0, Y: 0 }]));
    const M = T.normalizeMonth({ year: 2026, month: 11 }, R), P0 = new T.Problem(R, M), count = Math.floor(P0.slots.length / 2);
    R.doctors[0].quota = count; R.doctors[1].quota = P0.slots.length - count;
    const cases = [];
    for (const target of [count, count + .25, count + .3, count + .5, count - .3, P0.slots.length + .3]) for (const source of ["target", "quota"]) {
      const r = clone(R), m = clone(M); if (source === "target") m.targets[names[0]] = target; else r.doctors[0].quota = target;
      // An above-calendar quota has an impossible hard lower bound; use a monthly target for that unbounded soft case.
      if (source === "quota" && target > P0.slots.length) continue;
      m.avoid = [{ name: names[0], day: 30, part: "night" }];
      const P = new T.Problem(r, m), pin = pinFor(P, count), expected = Math.abs(count - target) + 7 * Math.max(0, target - count);
      const js = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 }); assert.strictEqual(js.status, "Optimal"); close(js.objective, expected); close(T.penalty(P, pin).total, expected);
      cases.push({ rules: r, month: m, pin, expected, valid: true });
    }
    for (const delta of [1e-6, 1e-8, 1e-10]) for (const direction of [-1, 1]) {
      const r = clone(R), m = clone(M), target = count + direction * delta;
      m.targets[names[0]] = target; m.avoid = [{ name: names[0], day: 30, part: "night" }];
      cases.push({ rules: r, month: m, pin: null, expected: Math.abs(count - target) + 7 * Math.max(0, target - count), valid: true, tiny: true });
    }
    const r = clone(R), m = clone(M); r.doctors[0].quota = count + .3; r.quota_tolerance = 0;
    cases.push({ rules: r, month: m, pin: pinFor(new T.Problem(r, m), count), valid: false });
    const fixedRules = clone(R), fixedMonth = clone(M), fixedCount = count + 2;
    fixedRules.doctors[0].quota = count + .3; fixedRules.doctors[1].quota = P0.slots.length - fixedCount;
    const fixedProblem = new T.Problem(fixedRules, fixedMonth), fixedPin = pinFor(fixedProblem, fixedCount);
    for (const s of fixedProblem.slots.slice(0, fixedCount)) fixedMonth.fixed[s[1]][s[0]] = names[0];
    cases.push({ rules: fixedRules, month: fixedMonth, pin: fixedPin, expected: 1.7, valid: true, fixedOverflow: true });
    const script = `import sys,json,copy\nsys.path.insert(0,sys.argv[1])\nfrom toban import Problem,build_and_solve,check\nxs=json.load(sys.stdin);out=[]\nfor x in xs:\n p=Problem(x['rules'],x['month']);st,a,value=build_and_solve(p,pin=x['pin'],time_limit=5)\n out.append({'status':st,'score':value,'targets':p.targets,'quotas':p.quotas,'violations':check(p,a or x['pin'])[0]})\nprint(json.dumps(out))`;
    const result = cp.spawnSync(process.argv[3], ["-c", script, path.join(root, "tools")], { input: JSON.stringify(cases), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    assert.strictEqual(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    for (let i = 0; i < cases.length; i++) { const want = cases[i], got = actual[i];
      assert.strictEqual(got.status, want.valid ? "OPTIMAL" : "INFEASIBLE", `Python case ${i}`);
      if (want.valid) { close(got.score, want.expected, `Python score ${i}`);
        if (want.tiny) assert(Math.abs(got.score - want.expected) < 1e-12, `tiny Python score ${i}: ${got.score} versus ${want.expected}`);
        if (want.fixedOverflow) assert(got.violations.length === 1 && got.violations[0].includes("固定指定"));
        else assert.deepStrictEqual(got.violations, []); }
      else assert(got.violations.some(x => /範囲外/.test(x)), "Python check keeps fractional hard bound");
    }
  }); else console.log("SKIP Python parity (pass path/to/python)");
  if (process.argv[3]) await test("Python and JS agree on valid/invalid fractional input without truncation", () => {
    const R = clone(T.DEFAULT_RULES), M = JSON.parse(fs.readFileSync(path.join(web, "data/202611.json"), "utf8")), who = R.doctors[0].name;
    const values = [0, 15.25, 15.3, "15.3", "1.53e1", " 15.3 ", "0xF", null, "", -61, -.1, "Infinity", "1e309", "bad", " ", true, false, [], {}];
    const cases = [], expected = [];
    for (const source of ["target", "quota"]) for (const value of values) { const r = clone(R), m = clone(M);
      if (source === "target") m.targets = { [who]: value }; else r.doctors[0].quota = value;
      cases.push({ rules: r, month: m, source });
      try { const P = new T.Problem(r, m); expected.push({ valid: true, value: source === "target" ? P.targets[who] : P.quota(who) }); }
      catch (e) { expected.push({ valid: false }); }
    }
    const script = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom toban import Problem\nxs=json.load(sys.stdin);out=[]\nfor x in xs:\n try:\n  p=Problem(x['rules'],x['month']);out.append({'valid':True,'value':(p.targets if x['source']=='target' else p.quotas)[sys.argv[2]]})\n except (ValueError,TypeError,OverflowError): out.append({'valid':False})\nprint(json.dumps(out))`;
    const result = cp.spawnSync(process.argv[3], ["-c", script, path.join(root, "tools"), who], { input: JSON.stringify(cases), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    assert.strictEqual(result.status, 0, result.stderr); assert.deepStrictEqual(JSON.parse(result.stdout), expected);
  });
  console.log(`fractional targets: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
