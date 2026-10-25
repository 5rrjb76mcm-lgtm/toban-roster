// Rule-level diagnosis UI: dated independent alternatives, coverage, and safe input navigation.
// All fixtures are synthetic; the normal solve and diagnostic results are stubbed separately.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
const langs = fs.readdirSync(path.join(__dirname, "lang")).map(f => JSON.parse(read("lang/" + f)));
function context(lang = "en", useWorker = false) {
  let now = 1000, timer = 0;
  const intervals = new Map(), elements = new Map(), statusUpdates = [], workers = [], buttons = [], targets = new Map(), rows = [];
  const navigation = { shown: [], tabs: 0, focused: [], scrolled: [] };
  const node = id => {
    let content = ""; const children = [], attrs = {};
    return { children, checked: false, value: "1", innerHTML: "", disabled: false, hidden: false,
      style: { removeProperty(key) { delete this[key]; } },
      addEventListener() {}, appendChild(n) { children.push(n); return n; },
      setAttribute(key, value) { attrs[key] = value; }, removeAttribute(key) { delete attrs[key]; },
      hasAttribute(key) { return Object.prototype.hasOwnProperty.call(attrs, key); },
      get textContent() { return content + children.map(n => n.textContent).join(""); },
      set textContent(s) { content = s; children.length = 0; if (id === "#calcStatus") statusUpdates.push(s); },
      focus() { navigation.focused.push(id); }, scrollIntoView() { navigation.scrolled.push(id); },
      click() { if (this.onclick) return this.onclick(); }, closest() { return null; }
    };
  };
  const el = id => {
    if (!elements.has(id)) {
      elements.set(id, node(id));
    }
    return elements.get(id);
  };
  class FakeWorker {
    constructor() { this.sent = []; this.terminated = false; workers.push(this); }
    postMessage(m) {
      this.sent.push(m);
      if (m.type === "init") Promise.resolve().then(() => this.onmessage({ data: { id: m.id, ok: true } }));
    }
    terminate() { this.terminated = true; }
  }
  const c = { console, setTimeout: f => setTimeout(f, 0), clearTimeout,
    setInterval: f => { intervals.set(++timer, f); return timer; }, clearInterval: id => intervals.delete(id),
    Date: class extends Date { static now() { return now; } },
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:synthetic-worker", revokeObjectURL() {} },
    document: { querySelector: s => s.startsWith("#fixedPane ") ? targets.get(s) || null : el(s),
      querySelectorAll: s => s === "[data-diagnostic-highlight]" ? rows.filter(r => r.hasAttribute("data-diagnostic-highlight")) : [],
      createTextNode: s => ({ textContent: s }), createElement: tag => { const n = node(tag); if (tag === "button") buttons.push(n); return n; }, addEventListener() {},
      getElementById: id => useWorker && id === "highsSrc" ? { textContent: "synthetic worker" } : null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { pathname: "/test/toban.html", protocol: "file:", href: "file:///test/toban.html" }, T: {} };
  if (useWorker) c.Worker = FakeWorker;
  c.window = c; vm.createContext(c);
  const run = f => vm.runInContext(read("src/" + f), c, { filename: f });
  for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "plugins.js", "app-core.js"]) run(f);
  for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
  for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(f => f.endsWith(".js")).sort()) run("calendars/" + f);
  const T = c.T; for (const l of langs) T.registerLang(l); T.setLang(lang);
  const rules = JSON.parse(read("data/rules.json")); T.DEFAULT_RULES = JSON.parse(read("data/rules.json")); T.fillDefaultRules(rules);
  const month = T.normalizeMonth(JSON.parse(read("data/202611.json")), rules);
  const A = T.app, previous = { asg: { "1:night": { work: "Synthetic previous result", oc: [] } }, status: "Optimal" };
  Object.assign(A.state, { rules, month, result: previous });
  const saved = JSON.stringify(A.state); let saves = 0, solves = 0;
  const toasts = [];
  Object.assign(A, { readAll() {}, loadPendingPlugins: async () => {}, toast: s => toasts.push(s),
    save() { saves++; }, saveToFolder: async () => { saves++; }, showTab: id => navigation.shown.push(id), renderAll() {},
    highs: useWorker ? null : { isWorker: true } });
  T.b64ToBytes = () => new Uint8Array(); T.WASM_B64 = "";
  run("app-solve.js");
  T.solveWithAvoidRef = async () => { solves++; return { asg: null, status: "Infeasible", seconds: 0, vars: 1, cons: 1 }; };
  const unchanged = () => {
    assert.strictEqual(A.state.result, previous, "diagnosis must not replace the saved result");
    assert.strictEqual(JSON.stringify(A.state), saved, "diagnosis must not mutate inputs or result");
    assert.strictEqual(saves, 0, "diagnostic assignments must not be saved");
  };
  const idle = () => {
    assert.strictEqual(A.solving, false); assert.strictEqual(el("#btnSolve").disabled, false);
    assert.strictEqual(el("#btnCancel").hidden, true); assert.strictEqual(el("#calcStatus").textContent, "");
    assert.strictEqual(intervals.size, 0, "all progress timers cleared");
  };
  el('.subnav .sub[data-sub="fixedPane"]').onclick = () => { navigation.tabs++; };
  const targetFor = (day, kind = "night") => {
    const row = node("row:" + day), target = node("field:" + day + ":" + kind); target.closest = () => row; rows.push(row);
    targets.set(`#fixedPane [data-fx="${kind}"][data-d="${day}"]`, target);
    targets.set(`#fixedPane [data-fx][data-d="${day}"]`, target);
    return { row, target };
  };
  return { T, A, el, previous, workers, statusUpdates, unchanged, idle, toasts, buttons, navigation, targetFor,
    tick: ms => { now += ms; for (const fn of intervals.values()) fn(); },
    log: () => el("#calcLog").textContent, solves: () => solves };
}
const group = extra => Object.assign({ key: "fixed", label: "synthetic fixed group", note: "", items: [] }, extra);
async function display(lines, lang = "en") {
  const x = context(lang); x.T.diagnose = async () => lines;
  await x.A.runSolve(); x.unchanged(); x.idle(); return x;
}
(async () => {
  const coverageText = "自動解除の対象は、この規則の ctx.limit に渡された必須の行だけです。直接追加された構造上の制約は残ります。";
  const fixed = (day, kind = "night") => ({ key: `fixed:${kind}:${day}`, label: `SYNTHETIC_${day}_${kind}`, days: [day], slot: [day, kind], names: ["Synthetic Person"] });
  // Day 21 and 22 are separate sufficient alternatives, not members of a joint removal set.
  for (const lang of ["en", "ja"]) {
    const alternatives = [fixed(22), fixed(21), fixed(21, "day")];
    const lines = [group({ alternatives, individualsComplete: true, individualsCount: 3, individualsTested: 3 })];
    const before = JSON.stringify(lines), x = await display(lines, lang), log = x.log();
    assert.match(log, /Individually sufficient alternatives \(3 verified\)|単独で十分な解除候補（確認済み 3 件）/);
    assert.match(log, /each row below is a separate option|次の各行は別々の選択肢/);
    assert.ok(log.indexOf("SYNTHETIC_21_day") < log.indexOf("SYNTHETIC_21_night") && log.indexOf("SYNTHETIC_21_night") < log.indexOf("SYNTHETIC_22_night"), log);
    assert.match(log, /11\/21\(.+?\) \/ .+? \/ Synthetic Person/);
    assert.match(log, /Single-item checks are complete for all 3|全 3 候補/);
    assert.doesNotMatch(log, /items removed together|項目をまとめて外した/);
    assert.strictEqual(JSON.stringify(lines), before, "UI must not reorder or annotate diagnostic evidence");
    assert.strictEqual(x.buttons.length, 3);
  }
  // Fixed-rule exemptions are nonmonotone: individual removals can work even when removing all fixed entries fails.
  for (const groupOutcome of ["infeasible", "undecided", "unknown", "error"]) {
    const x = await display([group({ groupOutcome, groupEvidence: { status: groupOutcome === "infeasible" ? "Infeasible" : "TimeLimit", reason: "no-witness" },
      alternatives: [fixed(27), fixed(25), fixed(26)], individualsComplete: true, individualsCount: 3, individualsTested: 3 })]);
    const log = x.log(); assert.doesNotMatch(log, /Solvable without "synthetic fixed group"/);
    assert.match(log, /Individually sufficient alternatives \(3 verified\)/);
    assert.match(log, /SYNTHETIC_25_night/); assert.match(log, /SYNTHETIC_26_night/); assert.match(log, /SYNTHETIC_27_night/);
    if (groupOutcome === "infeasible") assert.match(log, /removing the whole group gives no solution/);
    else assert.match(log, /whole-group relaxation is undecided:.*TimeLimit/);
  }
  {
    const x = await display([group({ undecided: true, groupOutcome: "undecided", groupEvidence: { reason: "budget", status: "Budget" }, alternatives: [fixed(25)], individualsComplete: false, individualsTested: 1, individualsCount: 2 })]);
    assert.match(x.log(), /whole-group relaxation is undecided:.*time budget was used up/);
    assert.match(x.log(), /Individually sufficient alternatives \(1 verified\)/);
    assert.doesNotMatch(x.log(), /Solvable without "synthetic fixed group"/);
  }
  // Completed trial count does not imply completed decisions when a witness is unverified.
  {
    const x = await display([group({ ruleId: "synthetic.limit", coverage: coverageText,
      alternatives: [fixed(22)], individualsComplete: false, individualsCount: 5, individualsTested: 4,
      individualUnknown: [Object.assign(fixed(26), { reason: "budget", status: "Budget" }),
        Object.assign(fixed(23), { reason: "invalid-witness", status: "Optimal" }),
        Object.assign(fixed(24), { reason: "error", status: "Error", error: "synthetic failure" })] })]);
    const log = x.log();
    assert.match(log, /\[synthetic\.limit\]/); assert.match(log, /only the hard rows passed to this rule's ctx.limit/);
    assert.match(log, /Single-item checks are incomplete \(4\/5 candidates tried\)/);
    assert.match(log, /other sufficient alternatives may exist/);
    assert.match(log, /SYNTHETIC_23_night \(undecided:.*failed validation/);
    assert.match(log, /SYNTHETIC_24_night \(undecided:.*synthetic failure/);
    assert.match(log, /SYNTHETIC_26_night \(undecided:.*time budget was used up/);
    assert.ok(log.indexOf("SYNTHETIC_23_night") < log.indexOf("SYNTHETIC_24_night") && log.indexOf("SYNTHETIC_24_night") < log.indexOf("SYNTHETIC_26_night"));
    assert.doesNotMatch(log, /checks are complete|all alternatives|minimum-cardinality/);
  }
  // The joint set has its own evidence, never inherited single-item sufficiency.
  {
    const x = await display([group({ key: "rule:synthetic", ruleId: "synthetic", alternatives: [], individualsComplete: true, individualsCount: 3, individualsTested: 3,
      combined: true, inclusionMinimal: true, incomplete: false, items: [fixed(22), fixed(21)] })]);
    const log = x.log(); assert.match(log, /No single-item removal has yet been confirmed/);
    assert.match(log, /2 items removed together/); assert.match(log, /Removing just one of these items may not give a solution/);
    assert.match(log, /inclusion-minimal/); assert.match(log, /does not establish a minimum-cardinality removal set/);
    assert.doesNotMatch(log, /Individually sufficient alternatives/);
  }
  {
    const x = await display([group({ combined: true, inclusionMinimal: false, incomplete: false, items: [fixed(21), fixed(22)] })]);
    assert.doesNotMatch(x.log(), /inclusion-minimal|minimum-cardinality/);
  }
  // Coverage includes enabled direct-only/no-row rules even if no relaxation was successful.
  {
    const lines = []; lines.coverage = [{ ruleId: "direct.synthetic", label: "Synthetic direct rule", rows: 0, status: "direct-only-or-no-rows" }];
    const x = await display(lines); assert.match(x.log(), /Outside automatic relaxation.*Synthetic direct rule \[direct.synthetic\]/);
    assert.match(x.log(), /Direct constraints and rules with no registered rows are not automatically relaxed/);
    assert.match(x.log(), /does not establish a cause or authorize changing the conditions/);
  }
  {
    const x = await display([group({ ruleId: "undecided.synthetic", undecided: true, reason: "budget", coverage: coverageText })]);
    assert.match(x.log(), /Could not decide "synthetic fixed group \[undecided.synthetic\]"/);
    assert.match(x.log(), /Directly added structural constraints remain/);
  }
  // Static evidence is distinct from solver-verified alternatives, with honest coverage bounds.
  {
    const lines = [];
    lines.slotExplanations = [
      { ruleId: "composition", slot: [22, "night"], required: 2, eligibleCount: 3, possibleCount: 1, candidates: [{ name: "Synthetic A", exclusions: [{ id: "synthetic.rule", code: "STATIC_TEST", args: { day: "11/22", who: "Synthetic A" } }] }, { name: "Synthetic B", exclusions: [] }] },
      { ruleId: "composition", slot: [21, "night"], required: 1, eligibleCount: 1, possibleCount: 0, candidates: [{ name: "Synthetic C", exclusions: [{ id: "synthetic.rule", code: "STATIC_TEST", args: { day: "11/21", who: "Synthetic C" } }] }] }
    ];
    lines.explanationsComplete = false;
    const x = context(); x.T.MSG.STATIC_TEST = { en: "{who} excluded by synthetic fixed work on {day}", ja: "{who}: {day} の架空固定入力" };
    x.T.diagnose = async () => lines; await x.A.runSolve(); x.unchanged(); x.idle();
    const log = x.log(); assert.match(log, /Static candidate exclusions \(partial evidence\)/);
    assert.match(log, /not a complete causal diagnosis/); assert.match(log, /Remaining candidates may still be blocked/);
    assert.match(log, /requires 2; 1 of 3 eligible candidates remain.*\[composition\]/);
    assert.match(log, /Synthetic A \[synthetic.rule\]: Synthetic A excluded by synthetic fixed work on 11\/22/);
    assert.ok(log.indexOf("requires 1") < log.indexOf("requires 2"));
    assert.match(log, /static candidate scan is incomplete/);
    assert.doesNotMatch(log, /Individually sufficient alternatives|items removed together/);
  }
  // Progress identifies phase, exact rule/candidate key and label, while preserving the soft budget.
  {
    const x = context();
    x.T.diagnose = async (P, highs, trial, progress) => {
      for (const [phase, label] of [["group", "Whole-rule relaxation"], ["individual", "Testing a single removal"], ["joint-baseline", "Verifying the joint baseline"], ["joint-reduction", "Reducing the joint set"]]) {
        progress({ label: "Synthetic exact rule", step: 3, total: 9, phase, currentKey: "rule:synthetic:slot:21:night", currentLabel: "Synthetic exact candidate", sub: "2/5", elapsedSeconds: 10, remainingSeconds: 110, timeLimit: 20, totalTimeLimit: 120 });
        const status = x.el("#calcStatus").textContent;
        assert.ok(status.includes(label) && status.includes("Synthetic exact candidate") && status.includes("[rule:synthetic:slot:21:night]"), status);
        assert.match(status, /group 3\/9.*2\/5/); assert.match(status, /110\/120 s/);
      }
      return [];
    };
    await x.A.runSolve(); x.unchanged(); x.idle();
  }
  // Jump buttons only navigate, focus and highlight. They do not change fixed inputs or the previous result.
  {
    const x = await display([group({ alternatives: [fixed(21), fixed(22)], individualsComplete: true, individualsCount: 2, individualsTested: 2 })]);
    const one = x.targetFor(21), two = x.targetFor(22);
    x.buttons[0].click(); assert.deepStrictEqual(x.navigation.shown, ["input"]); assert.strictEqual(x.navigation.tabs, 1);
    assert.strictEqual(one.row.hasAttribute("data-diagnostic-highlight"), true); assert.deepStrictEqual(x.navigation.focused, ["field:21:night"]);
    x.buttons[1].click(); assert.strictEqual(one.row.hasAttribute("data-diagnostic-highlight"), false); assert.strictEqual(two.row.hasAttribute("data-diagnostic-highlight"), true);
    assert.deepStrictEqual(x.navigation.scrolled, ["row:21", "row:22"]); x.unchanged();
  }
  // Earlier advice remains visible but cannot navigate against edited input or reloaded plug-ins.
  for (const change of ["input", "plugins", "busy", "switching", "uncommitted-input"]) {
    const x = await display([group({ alternatives: [fixed(21)], individualsComplete: true, individualsCount: 1, individualsTested: 1 })]);
    x.targetFor(21);
    if (change === "input") x.A.state.month.notes = "synthetic later input";
    if (change === "plugins") x.T.plugins.beginFolder();
    if (change === "busy") x.A.solving = true;
    if (change === "switching") x.A.switching = 1;
    if (change === "uncommitted-input") x.A.readAll = () => { x.A.state.month.notes = "synthetic uncommitted input"; };
    x.buttons[0].click(); assert.strictEqual(x.navigation.tabs, 0); assert.strictEqual(x.navigation.focused.length, 0);
    assert.ok(x.toasts.length > 0); assert.strictEqual(x.A.state.result, x.previous);
  }
  // Item labels and names are plain text, never interpreted as HTML.
  {
    const it = Object.assign(fixed(21), { label: "<img src=x onerror=alert(1)>", names: ["<script>synthetic</script>"] });
    const x = await display([group({ alternatives: [it], individualsComplete: true, individualsCount: 1, individualsTested: 1 })]);
    assert.match(x.log(), /<img src=x onerror=alert\(1\)>/); assert.strictEqual(x.el("#calcLog").innerHTML, "");
  }
  console.log("OK rule diagnosis UI: independent alternatives, chronological scopes, coverage, minimality, progress, guarded navigation");
})().catch(e => { console.error(e); process.exit(1); });
