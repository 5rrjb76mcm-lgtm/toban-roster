// Diagnostic coverage labels: production index, app initialization and runSolve rendering.
// Solver/diagnostic outcomes are synthetic; jsdom supplies the DOM only. No browser,
// layout, real solver, OS permission or network verification is claimed.
const fs = require("fs"), path = require("path"), assert = require("assert");
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, "jsdom", path.join(process.env.HOME || "", ".toban-test/node_modules/jsdom")].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
}
if (!JSDOM) throw new Error("Diagnostic role-label DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8"), clone = x => JSON.parse(JSON.stringify(x));
const modules = dir => fs.readdirSync(path.join(__dirname, "src", dir)).filter(f => f.endsWith(".js")).sort().map(f => dir + "/" + f);
const scripts = ["i18n.js", "rules-core.js", "model.js", ...modules("calendars"), "messages.js", "solver.js", "check.js", "report.js", "docxgen.js", "plugins.js", "merge.js", ...modules("rules"),
  "app-core.js", "app-folder.js", "app-month.js", "app-input.js", "app-settings.js", "app-solve.js", "app-main.js"];
const custom = { ja: "架空の統括担当", en: "Synthetic lead" };
const markup = { ja: '<img src=x onerror="synthetic()"> & 架空担当', en: '<img src=x onerror="synthetic()"> & Synthetic lead' };
const EXPECTED_CASES = 6;
let count = 0, finished = false;
process.on("exit", () => {
  if ((!finished || count !== EXPECTED_CASES) && !process.exitCode) {
    console.error("NOT COMPLETED: " + count + "/" + EXPECTED_CASES + " cases passed, finished=" + finished);
    process.exitCode = 1;
  }
});
// Keep this timer referenced: an unresolved Promise alone does not keep Node alive.
const watchdog = setTimeout(() => {
  console.error("TIMEOUT: " + count + "/" + EXPECTED_CASES + " diagnostic role-label cases passed");
  process.exit(1);
}, 60000);
async function check(lang, roleLabel) {
  const dom = new JSDOM(read("src/index.html"), { url: "https://example.invalid/synthetic/diagnostic-label.html", runScripts: "outside-only" });
  const w = dom.window;
  try {
    await new Promise(resolve => w.document.readyState === "complete" ? resolve() : w.addEventListener("load", resolve, { once: true }));
    const errors = [];
    w.addEventListener("error", e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
    w.alert = msg => { throw new Error("Unexpected alert: " + msg); };
    const rules = JSON.parse(read("data/rules.json")), month = JSON.parse(read("data/202611.json")); // Repository's fictional sample only.
    w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(month), PROFILES: [], LANGS_DATA: ["ja", "en"].map(code => JSON.parse(read("lang/" + code + ".json"))) };
    for (const f of scripts) w.eval(read("src/" + f) + "\n//# sourceURL=" + f);
    const { T } = w, A = T.app;
    if (roleLabel) {
      rules.profile = { id: "synthetic-label", roles: clone(T.DEFAULT_ROLES) };
      rules.profile.roles.find(r => r.refs.includes("charge")).label = roleLabel;
      month.profile_id = rules.profile.id;
    }
    w.localStorage.setItem("toban.lang", lang);
    w.localStorage.setItem("toban_state_v2:/synthetic/diagnostic-label.html", JSON.stringify({ rules, month, result: null, ui: {} }));
    A.restoreFolder = () => {}; // No OS folder access in this DOM-adapter test.
    T.init();
    w.document.querySelector('.tab[data-tab="calc"]').click();
    const previous = { asg: { "1:night": { work: "Synthetic previous person", oc: [] } }, status: "Optimal" };
    A.state.result = previous;
    const before = JSON.stringify(A.state); let saves = 0;
    A.save = A.saveToFolder = () => { saves++; };
    A.highs = { isWorker: true };
    T.solveWithAvoidRef = async () => ({ asg: null, status: "Infeasible", seconds: 0, vars: 1, cons: 1 });
    const def = T.rules.defs.find(r => r.id === "period_charge");
    assert.ok(def.label.includes("{charge}"), "exercise the real registered rule's template");
    const lines = [];
    lines.coverage = [
      { ruleId: def.id, label: def.label, rows: 0, status: "direct-only-or-no-rows" },
      { ruleId: "synthetic.plain", label: "Synthetic plain rule", rows: 0, status: "direct-only-or-no-rows" },
      { ruleId: "synthetic.fallback", rows: 0, status: "direct-only-or-no-rows" },
      { ruleId: "synthetic.covered", label: "SYNTHETIC_COVERED", rows: 1, status: "limit-rows" }
    ];
    const coverageBefore = JSON.stringify(lines.coverage);
    T.diagnose = async () => lines;
    // Call the same public handler bound to the real Solve button, and await completion.
    await A.runSolve();
    const log = w.document.querySelector("#calcLog"), text = log.textContent;
    const coverageLine = text.split("\n").find(line => /自動解除の対象外|Outside automatic relaxation/.test(line));
    assert.ok(coverageLine, "production runSolve must render coverage");
    const role = roleLabel ? roleLabel[lang] : "主担当";
    assert.ok(coverageLine.includes(role), "configured role missing from coverage: " + coverageLine);
    assert.doesNotMatch(coverageLine, /\{(?:charge|other|junior|reserve)\}/, "role template must be expanded");
    assert.doesNotMatch(coverageLine, /担当担当/, "do not duplicate the Japanese duty suffix");
    assert.ok(coverageLine.includes(T.ruleLabel(A.state.rules, def) + " [period_charge]"), "use the same localized rule name as Settings");
    assert.ok(coverageLine.includes("Synthetic plain rule [synthetic.plain]"));
    assert.ok(coverageLine.includes("synthetic.fallback [synthetic.fallback]"));
    assert.ok(!coverageLine.includes("SYNTHETIC_COVERED"), "covered rules stay outside this list");
    assert.strictEqual(log.children.length, 0, "labels must be appended as plain text, never HTML");
    if (roleLabel === markup) {
      assert.ok(log.innerHTML.includes("&lt;img"), "markup-like role labels must be escaped in the DOM");
      assert.ok(log.innerHTML.includes("&amp;"));
    }
    assert.strictEqual(JSON.stringify(lines.coverage), coverageBefore, "rendering must not rewrite diagnosis evidence");
    assert.strictEqual(A.state.result, previous);
    assert.strictEqual(JSON.stringify(A.state), before, "diagnosis must preserve inputs and the previous result");
    assert.strictEqual(saves, 0, "displaying diagnosis must not save data");
    assert.strictEqual(A.solving, false);
    assert.strictEqual(w.document.querySelector("#btnSolve").disabled, false);
    assert.strictEqual(w.document.querySelector("#calcStatus").textContent, "");
    assert.deepStrictEqual(errors, []);
  } finally { w.close(); }
}
(async () => {
  let failed = 0;
  for (const lang of ["ja", "en"]) for (const [name, label] of [["default", null], ["custom localized", custom], ["plain-text escaping", markup]]) {
    try { await check(lang, label); count++; console.log("ok " + lang + " " + name + " diagnostic coverage role label"); }
    catch (e) { failed++; console.error("FAIL " + lang + " " + name + ": " + e.stack); }
  }
  assert.strictEqual(failed, 0, failed + " diagnostic role-label scenarios failed");
  assert.strictEqual(count, EXPECTED_CASES);
  console.log("OK diagnostic role-label DOM regression: " + count + "/" + EXPECTED_CASES + " scenarios");
  finished = true;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
