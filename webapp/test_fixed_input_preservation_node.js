// Existing fixed workers must survive unrelated edits after staffing settings change.
// Synthetic data only; exercise the real input screens in Chrome and pass saved JSON to solve/check.
// node test_fixed_input_preservation_node.js <highs package path>
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const src = ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"],
  ruleFiles = fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort();
const source = f => fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8");
globalThis.T = {};
for (const f of src) vm.runInThisContext(source(f), { filename: f });
for (const f of ruleFiles) vm.runInThisContext(source("rules/" + f), { filename: f });
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log("ok " + name); } catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); } }
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("-- Fixed-input browser tests skipped: Playwright unavailable"); return; }
  if (!fs.existsSync("/Applications/Google Chrome.app")) { console.log("-- Fixed-input browser tests skipped: Chrome unavailable"); return; }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext(), errors = [], external = [];
    await context.route(/^https?:/, r => { external.push(r.request().url()); return r.abort(); });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.setContent('<div id="doctorPane"></div><div id="fixedPane"></div>');
    for (const f of [...src, "app-core.js", "app-input.js"]) await page.addScriptTag({ content: source(f) });
    for (const f of ruleFiles) await page.addScriptTag({ content: source("rules/" + f) });
    const result = await page.evaluate(() => {
      const A = T.app, names = ["Synthetic A", "Synthetic B", "Synthetic C"], results = [], snapshots = [];
      A.save = () => {}; const notices = []; A.toast = s => notices.push(s); A.bindDoctor(); A.bindFixed();
      const q = s => document.querySelector(s), fx = (d, k) => `[data-fx="${k}"][data-d="${d}"]`, cal = (d, k) => `[data-cal="fixed"][data-k="${k}"][data-d="${d}"]`;
      const clone = o => JSON.parse(JSON.stringify(o)), check = (ok, message) => { if (!ok) throw new Error(message); };
      const change = (s, value) => { const el = q(s); check(!!el, "missing input " + s); if (el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); };
      const hasOver = () => T.lint(new T.Problem(A.state.rules, A.state.month)).some(x => x.code === "LINT_FIXED_OVER_COUNT");
      const sameFixed = (m, before) => { const flat = x => Object.fromEntries(Object.entries(x).map(([k, tbl]) => [k, Object.fromEntries(Object.entries(tbl).map(([d, ns]) => [d, [].concat(ns).sort()]))])); return JSON.stringify(flat(m.fixed)) === JSON.stringify(flat(before.fixed)) && JSON.stringify(m.fixed_tags) === JSON.stringify(before.fixed_tags); };
      const render = () => { A.renderDoctor(); A.renderFixed(); };
      const setup = (kind, opts = {}) => {
        notices.length = 0;
        const R = { profile: { id: "synthetic-fixed-preservation", roles: [{ id: "S", label: "Staff" }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: { work: { count: 2 } }, fixed_tags: ["Synthetic tag"] }, doctors: names.map(name => ({ name, team: "S", quota: 20 })), weights: {}, rule_states: {} };
        T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
        const m = T.normalizeMonth({ year: 2026, month: 11, fixed: { [kind]: { 5: names.slice(0, 2) } }, fixed_tags: { [`5:${kind}|${names[0]}`]: "Synthetic tag", [`5:${kind}|${names[1]}`]: "Synthetic tag" } }, R);
        if (opts.invalid) { R.rule_states.quota_target = "soft"; R.weights.target_deviation = -1; }
        else R.profile.positions.work.count = opts.byDay ? { weekday: 1, off_days: 2 } : 1;
        Object.assign(A.state, { rules: R, month: m, ui: { doctor: 0 }, result: null }); render(); return m;
      };
      const test = (name, fn) => { try { fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, error: e.message }); } };
      for (const kind of ["day", "night"]) test(`calendar preserves existing ${kind} workers and tags after capacity reduction`, () => {
        const m = setup(kind), before = clone(m); check(hasOver(), "initial over-capacity diagnostic");
        change('[data-cal="wish"][data-d="6"]', true);
        check(sameFixed(m, before), "unrelated wish must retain all fixed workers and tags"); check(hasOver(), "retain the diagnostic until explicit correction"); check(notices.length === 0, "no failed-new-fixed toast on unrelated input");
        change('[data-cal="unavail"][data-d="8"]', "allday"); check(sameFixed(m, before), "repeated read must preserve fixed entries");
        snapshots.push({ R: clone(A.state.rules), M: clone(m), over: true });
        change(cal(5, kind), ""); check(m.fixed[kind][5] === names[1] && !m.fixed_tags[`5:${kind}|${names[0]}`] && m.fixed_tags[`5:${kind}|${names[1]}`], "explicit removal only removes this person and tag"); check(!hasOver(), "corrected capacity");
        snapshots.push({ R: clone(A.state.rules), M: clone(m), over: false, kind });
      });
      for (const kind of ["day", "night"]) test(`fixed table retains ${kind} arrays and tags when changed to one worker`, () => {
        const m = setup(kind), before = clone(m); change(fx(6, kind), names[2]);
        check([].concat(m.fixed[kind][5]).join() === before.fixed[kind][5].join(), "single-worker table must not truncate existing array"); check(JSON.stringify(m.fixed_tags) === JSON.stringify(before.fixed_tags), "retain both tags"); check(hasOver(), "diagnostic survives table edit");
        change(fx(5, kind), names[1] + "(Synthetic tag)"); check(m.fixed[kind][5] === names[1] && !m.fixed_tags[`5:${kind}|${names[0]}`] && m.fixed_tags[`5:${kind}|${names[1]}`], "explicit table correction keeps the remaining tag"); check(!hasOver(), "diagnostic clears only after correction");
      });
      test("calendar keeps valid multi-worker fixed input while another setting is invalid", () => {
        const m = setup("night", { invalid: true }), before = clone(m); change('[data-cal="wish"][data-d="6"]', true);
        check(sameFixed(m, before), "Problem-construction failure must not lower existing capacity to one"); check(notices.length === 0, "no misleading fixed-conflict toast");
      });
      test("calendar preserves weekday-specific over-capacity fixed input", () => {
        const m = setup("day", { byDay: true }), before = clone(m); change('[data-cal="unavail"][data-d="8"]', "allday");
        check(sameFixed(m, before), "weekday capacity reduction must retain existing fixed workers"); check(hasOver(), "weekday diagnostic survives");
      });
      test("new fixed workers still cannot exceed capacity and accepted entries still work", () => {
        const m = setup("night"); m.fixed.night = { 5: names[1] }; m.fixed_tags = {}; render();
        change(cal(5, "night"), "night"); check(m.fixed.night[5] === names[1], "new over-capacity fixed worker rejected"); check(notices.length === 1, "explain failed new fixed input");
        render(); change(cal(6, "night"), "night"); check(m.fixed.night[6] === names[0], "new valid fixed worker accepted");
      });
      for (const multi of [false, true]) test(`unchanged fixed text preserves literal names and tags (multi setting ${multi})`, () => {
        const m = setup("night"), special = "Synthetic A (senior)", tag = "Synthetic tag, secondary";
        A.state.rules.doctors[0].name = special; A.state.rules.name_order = [special, ...names.slice(1)];
        if (multi) A.state.rules.profile.positions.work.count = 2;
        m.fixed.night[5] = [special, names[1]]; m.fixed_tags = { [`5:night|${special}`]: tag, [`5:night|${names[1]}`]: "Synthetic tag" }; render();
        const workers = JSON.stringify(m.fixed.night[5]), tags = JSON.stringify(m.fixed_tags);
        for (const who of [names[2], ""]) { change(fx(6, "night"), who); check(JSON.stringify(m.fixed.night[5]) === workers && JSON.stringify(m.fixed_tags) === tags, "unrelated edit must not parse punctuation in unchanged input"); }
        // Explicit edits keep using the existing text grammar; subsequent reads must not parse them again.
        change(fx(5, "night"), names[1] + "(Synthetic tag)");
        check(m.fixed.night[5] === names[1] && !m.fixed_tags[`5:night|${special}`] && m.fixed_tags[`5:night|${names[1]}`] === "Synthetic tag", "explicit correction still replaces names and tags");
        change(fx(6, "night"), names[2]); check(m.fixed.night[5] === names[1], "retain the corrected value on the next read");
        change(fx(5, "night"), ""); change(fx(6, "night"), ""); check(!m.fixed.night[5] && !Object.keys(m.fixed_tags).length, "explicit clearing remains cleared on repeated reads");
      });
      for (const kind of ["day", "night"]) for (const d of [1, 31]) test(`overlapping ${kind} fixed conditions survive real DOM readback on day ${d}`, () => {
        const m = setup(kind), n = names[0];
        A.state.rules.profile.roles[0].standby = true; A.state.rules.profile.roles[0].refs = ["charge"];
        m.next_first_day_in_calendar = true; m.fixed.day = {}; m.fixed.night = {}; m.fixed_tags = {};
        m.fixed[kind][d] = n; m.fixed[kind + "_oc"][d] = [n, names[1]]; render(); const before = clone(m);
        change('[data-cal="wish"][data-d="6"]', true); check(sameFixed(m, before), "unchanged hidden OC must survive");
        change(cal(d, kind), ""); A.renderDoctor();
        check(!m.fixed[kind][d] && m.fixed[kind + "_oc"][d].includes(n), "only the displayed work condition is cleared");
        check(q(cal(d, kind)).value === kind + "oc", "remaining OC is displayed");
        change(cal(d, kind), ""); A.renderDoctor(); check(m.fixed[kind + "_oc"][d].join() === names[1], "explicit OC removal preserves other person");
      });
      for (const kind of ["day", "night"]) test(`inactive ${kind} OC remains selected after role eligibility changes`, () => {
        const m = setup(kind), n = names[0]; m.fixed.day = {}; m.fixed.night = {}; m.fixed_tags = {};
        m.fixed[kind + "_oc"][1] = [n]; render();
        check(q(cal(1, kind)).value === kind + "oc", "inactive stored OC must remain selected");
        change('[data-cal="wish"][data-d="6"]', true); check(m.fixed[kind + "_oc"][1].includes(n), "unrelated edit preserves inactive OC");
        change(cal(1, kind), ""); check(!m.fixed[kind + "_oc"][1], "explicit inactive OC clearing works");
      });
      for (const screen of ["calendar", "grid"]) test(`inactive charge survives ${screen} edits`, () => {
        const m = setup("night"), n = names[0]; m.fixed.day = {}; m.fixed.night = {}; m.fixed_tags = {}; m.fixed.weekend_charge[1] = n; render();
        const sel = screen === "calendar" ? cal(1, "day") : fx(1, "charge");
        check(q(sel).value === (screen === "calendar" ? "charge" : n), "inactive charge must remain selected");
        change(screen === "calendar" ? '[data-cal="wish"][data-d="6"]' : fx(6, "night"), screen === "calendar" ? true : names[1]);
        check(m.fixed.weekend_charge[1] === n, "unrelated edit preserves inactive charge");
        change(sel, ""); check(!m.fixed.weekend_charge[1], "explicit charge clearing works");
      });
      test("rejected fixed replacements retain the previous condition and tag", () => {
        const m = setup("day"), n = names[0]; A.state.rules.profile.roles[0].standby = true; A.state.rules.profile.roles[0].refs = ["charge"];
        m.fixed.day = { 1: names[1] }; m.fixed.day_oc = { 1: [n] }; m.fixed.night = {}; m.fixed_tags = {}; render();
        change(cal(1, "day"), "day"); A.renderDoctor(); check(m.fixed.day_oc[1].includes(n) && m.fixed.day[1] === names[1], "rejected OC-to-work preserves original OC");
        m.fixed.day = { 1: n }; m.fixed.day_oc = {}; m.fixed.weekend_charge = { 1: names[1] }; m.fixed_tags = { [`1:day|${n}`]: "Synthetic tag" }; render();
        change(cal(1, "day"), "charge"); A.renderDoctor(); check(m.fixed.day[1] === n && m.fixed.weekend_charge[1] === names[1] && m.fixed_tags[`1:day|${n}`], "rejected work-to-charge preserves work and tag");
      });
      return { results, snapshots };
    });
    for (const r of result.results) test(r.name, () => assert.ok(r.pass, r.error));
    test("saved monthly JSON preserves diagnostics and corrected fixed assignments reach solve/check", () => {
      assert.strictEqual(result.snapshots.length, 4, "both shift kinds must reach snapshots");
      for (const { R, M, over, kind } of result.snapshots) {
        const P = new T.Problem(R, M); assert.strictEqual(T.lint(P).some(x => x.code === "LINT_FIXED_OVER_COUNT"), over);
        if (over) continue;
        const r = T.solve(P, highs, { timeLimit: 5, mipGap: 0 }); assert.strictEqual(r.status, "Optimal");
        assert.strictEqual(r.asg[`5:${kind}`].work, "Synthetic B"); assert.strictEqual(T.check(P, r.asg).V.length, 0);
        assert.strictEqual(T.penalty(P, r.asg).total, r.objective);
      }
    });
    // Use the real Undo implementation after the preservation checks. Each edit gets its normal microtask boundary.
    await page.addScriptTag({ content: source("app-settings.js") });
    const undoResults = await page.evaluate(async () => {
      const A = T.app, ns = ["Synthetic A (senior)", "Synthetic B", "Synthetic C"], results = [];
      document.body.insertAdjacentHTML("beforeend", '<button id="btnUndo"></button><span id="undoNote"></span>');
      const q = s => document.querySelector(s), clone = x => JSON.parse(JSON.stringify(x)), check = (ok, msg) => { if (!ok) throw new Error(msg); };
      A.renderAll = () => { A.renderDoctor(); A.renderFixed(); };
      const setup = () => {
        const R = { profile: { id: "synthetic-fixed-undo", roles: [{ id: "S", label: "Staff" }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: { work: { count: 1 } } }, doctors: ns.map(name => ({ name, team: "S", quota: 20 })), weights: {}, rule_states: {} };
        T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
        const M = T.normalizeMonth({ year: 2026, month: 11, fixed: { night: { 5: ns.slice(0, 2) } }, fixed_tags: { [`5:night|${ns[0]}`]: "Synthetic tag, secondary" }, doc_versions: [{ ver: 1 }] }, R);
        Object.assign(A.state, { rules: R, month: M, ui: { doctor: 0 }, result: { at: "synthetic-old" } }); A.clearUndo(); A.renderAll(); return clone(M);
      };
      const change = async (selector, val) => { const el = q(selector); if (el.type === "checkbox") el.checked = val; else el.value = val; el.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); };
      // Fixed-worker arrays are sets; a calendar read can legitimately move the edited person to the end.
      const stableFixed = x => Array.isArray(x) ? x.map(stableFixed).sort() : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stableFixed(x[k])])) : x;
      const same = (a, b) => JSON.stringify(stableFixed(a)) === JSON.stringify(stableFixed(b));
      const test = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, error: e.message }); } };
      await test("calendar Undo retains over-capacity fixed workers, tags, and document versions", async () => {
        const before = setup(); await change('[data-cal="wish"][data-d="6"]', true);
        check(same(A.state.month.fixed, before.fixed) && same(A.state.month.fixed_tags, before.fixed_tags), "edit preserves existing fixed data");
        check(!q("#btnUndo").disabled, "monthly change is recorded"); A.state.month.doc_versions.push({ ver: 2 }); A.undo();
        check(same(A.state.month.fixed, before.fixed) && same(A.state.month.fixed_tags, before.fixed_tags), "Undo preserves all fixed data");
        check(!A.state.month.wishes.night_on[ns[0]], "Undo removes the new wish"); check(A.state.month.doc_versions.length === 2, "Undo keeps document versions");
        A.readAll(); check(same(A.state.month.fixed, before.fixed) && same(A.state.month.fixed_tags, before.fixed_tags), "read after Undo is stable"); check(q("#btnUndo").disabled, "no extra Undo entry");
      });
      await test("fixed-table Undo restores literal names and tags without reparsing unchanged text", async () => {
        const before = setup(); await change('[data-fx="night"][data-d="6"]', ns[2]);
        check(same(A.state.month.fixed.night[5], before.fixed.night[5]) && same(A.state.month.fixed_tags, before.fixed_tags), "edit preserves punctuation");
        A.undo(); A.readAll(); check(same(A.state.month.fixed, before.fixed) && same(A.state.month.fixed_tags, before.fixed_tags), "Undo and reread retain original values");
        check(q("#btnUndo").disabled, "history consumed once");
      });
      await test("Undo reverses monthly fixed correction before staffing-setting change", async () => {
        const before = setup(); A.state.rules.profile.positions.work.count = 2; A.clearUndo();
        A.pushUndo("施設の構成の変更"); A.state.rules.profile.positions.work.count = 1; await Promise.resolve(); A.renderAll();
        await change('[data-fx="night"][data-d="5"]', ns[1]); check(A.state.month.fixed.night[5] === ns[1], "explicit correction accepted");
        A.undo(); check(A.state.rules.profile.positions.work.count === 1 && same(A.state.month.fixed.night[5], before.fixed.night[5]), "first Undo restores fixed entries only");
        A.readAll(); A.undo(); check(A.state.rules.profile.positions.work.count === 2 && same(A.state.month.fixed, before.fixed) && same(A.state.month.fixed_tags, before.fixed_tags), "second Undo restores staffing setting");
        check(q("#btnUndo").disabled, "both entries consumed");
      });
      return results;
    });
    for (const r of undoResults) test(r.name, () => assert.ok(r.pass, r.error));
    test("no browser errors or external requests", () => { assert.deepStrictEqual(errors, []); assert.deepStrictEqual(external, []); });
  } finally { await browser.close(); }
  console.log(`fixed input preservation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
