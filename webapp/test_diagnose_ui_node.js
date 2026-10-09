// Diagnosis UI contract: verified combinations, unknown evidence, soft budgets, and cancellation.
// All fixtures are synthetic; the normal solve and diagnostic results are stubbed separately.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
const langs = fs.readdirSync(path.join(__dirname, "lang")).map(f => JSON.parse(read("lang/" + f)));
function context(lang = "en", useWorker = false) {
  let now = 1000, timer = 0;
  const intervals = new Map(), elements = new Map(), statusUpdates = [], workers = [];
  const el = id => {
    if (!elements.has(id)) {
      let content = "";
      elements.set(id, { checked: false, value: "1", innerHTML: "", disabled: false, hidden: false,
        addEventListener() {}, get textContent() { return content; },
        set textContent(s) { content = s; if (id === "#calcStatus") statusUpdates.push(s); } });
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
    URL: { createObjectURL: () => "blob:synthetic-worker" },
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {},
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
    save() { saves++; }, saveToFolder: async () => { saves++; }, showTab() {}, renderAll() {},
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
  return { T, A, el, previous, workers, statusUpdates, unchanged, idle, toasts,
    tick: ms => { now += ms; for (const fn of intervals.values()) fn(); },
    log: () => el("#calcLog").textContent, solves: () => solves };
}
const group = extra => Object.assign({ key: "fixed", label: "synthetic fixed group", note: "", items: [] }, extra);
async function display(lines, lang = "en") {
  const x = context(lang); x.T.diagnose = async () => lines;
  await x.A.runSolve(); x.unchanged(); x.idle(); return x;
}
(async () => {
  // A greedy retained set is a combined removal, never a claim about each item alone.
  for (const lang of ["en", "ja"]) {
    const x = await display([group({ combined: true, incomplete: false, items: [
      { key: "a", label: "Synthetic A", hint: "Review A" }, { key: "b", label: "Synthetic B", hint: "Review B" }
    ] })], lang);
    assert.ok(/2 items removed together|2 項目をまとめて外した/.test(x.log()), x.log());
    assert.ok(/Removing just one of these items may not give a solution|個々の項目を1つだけ外しても解が得られるとは限りません/.test(x.log()));
    assert.ok(!/● Solvable without|●.*を外すと解あり/.test(x.log()), "must not report independent removals");
    assert.ok(!/undefined/.test(x.log()));
  }
  {
    const x = await display([group({ combined: true, incomplete: false, items: [{ key: "only", label: "Synthetic only item" }] })]);
    assert.ok(/1 items removed together/.test(x.log()));
    assert.ok(!/Removing just one/.test(x.log()), "a verified singleton set does not need the multi-item caution");
  }
  {
    const x = await display([group({ combined: true, incomplete: true, items: [
      { key: "a", label: "Synthetic known", hint: "Review known" },
      { key: "b", label: "Synthetic undecided", hint: "Review undecided", undecided: true, status: "TimeLimit", reason: "no-witness" },
      { key: "c", label: "Synthetic budget", undecided: true, status: "Budget", reason: "budget" },
      { key: "d", label: "Synthetic failure", undecided: true, status: "Error", reason: "error", error: "detail solver failed" }
    ] })]);
    assert.ok(/4 items removed together/.test(x.log()));
    assert.ok(/Synthetic undecided \(necessity unconfirmed:.*TimeLimit/.test(x.log()));
    assert.ok(/Synthetic budget \(necessity unconfirmed:.*time budget was used up/.test(x.log()));
    assert.ok(/detail solver failed/.test(x.log()));
    assert.ok(/Narrowing is incomplete/.test(x.log()) && /smaller removal set may exist/.test(x.log()));
    assert.ok(!/Synthetic known \(necessity unconfirmed/.test(x.log()));
  }
  {
    const x = await display([
      group({ label: "Timeout group", undecided: true, status: "TimeLimit", reason: "no-witness" }),
      group({ label: "Invalid group", undecided: true, status: "Optimal", reason: "invalid-witness" }),
      group({ label: "Error group", undecided: true, status: "Error", reason: "error", error: "synthetic engine error" }),
      group({ label: "Budget group", undecided: true, status: "Budget", reason: "budget" }),
      group({ label: "Proven group" })
    ]);
    assert.ok(/Could not decide "Timeout group":.*feasibility is unknown.*TimeLimit/.test(x.log()));
    assert.ok(/Could not decide "Invalid group":.*failed validation/.test(x.log()));
    assert.ok(/Could not decide "Error group":.*synthetic engine error/.test(x.log()));
    assert.ok(/Could not decide "Budget group":.*time budget was used up/.test(x.log()));
    assert.ok(/Solvable without "Proven group"/.test(x.log()));
    assert.ok(!/several rules conflict at once|複数の条件が同時に衝突/.test(x.log()));
    assert.ok(!/Diagnosis stopped/.test(x.log()));
  }
  // Proving whole-group removal does not imply the item-wise candidate set works.
  for (const narrowing of [
    { outcome: "infeasible", status: "Infeasible" },
    { outcome: "unknown", status: "TimeLimit", reason: "no-witness" },
    { outcome: "unknown", status: "Budget", reason: "budget" },
    { outcome: "unknown", status: "Optimal", reason: "invalid-witness" },
    { outcome: "error", status: "Error", reason: "error", error: "narrowing failed" }
  ]) {
    const x = await display([group({ narrowing })]);
    assert.ok(/Solvable without "synthetic fixed group"/.test(x.log()));
    assert.ok(!/items removed together/.test(x.log()));
    assert.ok(narrowing.outcome === "infeasible" ? /Removing all individual candidates still gives no solution/.test(x.log()) : /Narrowing to individual items is incomplete/.test(x.log()));
    if (narrowing.error) assert.ok(x.log().includes(narrowing.error));
  }
  {
    const x = await display([group({ combined: true, incomplete: false, items: [] })]);
    assert.ok(/without removing any individual items/.test(x.log()));
    assert.ok(!/0 items removed together|necessary|minimal/i.test(x.log()));
  }
  {
    const x = await display([]);
    assert.ok(/No checked rule group was confirmed solvable/.test(x.log()));
    assert.ok(!/several rules conflict at once|複数の条件が同時に衝突/.test(x.log()));
  }
  // Budgets are limits, not an ETA, and progress continues to age between trials.
  {
    const x = context();
    x.T.diagnose = async (P, highs, perTrial, onProgress, opts) => {
      assert.strictEqual(perTrial, 20); assert.strictEqual(opts.totalTimeLimit, 120);
      assert.strictEqual(x.A.solving, true); assert.strictEqual(x.el("#btnCancel").hidden, false);
      x.tick(100000);
      onProgress({ label: "Synthetic group", step: 2, total: 8, sub: "3/7", elapsedSeconds: 100,
        remainingSeconds: 20, timeLimit: 12.5, totalTimeLimit: 120 });
      assert.ok(/100 s elapsed/.test(x.el("#calcStatus").textContent));
      assert.ok(/trial limit 12.5 s; 20\/120 s/.test(x.el("#calcStatus").textContent));
      assert.ok(/group 2\/8.*narrowing 3\/7/.test(x.el("#calcStatus").textContent));
      x.tick(25000);
      assert.ok(/125 s elapsed/.test(x.el("#calcStatus").textContent));
      assert.ok(/0\/120 s.*remaining/.test(x.el("#calcStatus").textContent));
      assert.ok(!/ETA|finish in|-[0-9].*remaining/.test(x.el("#calcStatus").textContent));
      return [group({ undecided: true, status: "Budget", reason: "budget" })];
    };
    await x.A.runSolve(); x.unchanged(); x.idle();
    assert.ok(/soft limit/.test(x.log()) && /may take it over budget/.test(x.log()));
  }
  for (const error of [new Error("synthetic diagnosis failure"), "synthetic thrown value", new Error("中止しました"), Object.assign(new Error("Cancelled by user"), { cancelled: true })]) {
    const x = context(); x.T.diagnose = async () => { throw error; };
    await x.A.runSolve(); x.unchanged(); x.idle();
    if (error.cancelled || /中止/.test(String(error))) assert.ok(/Diagnosis stopped/.test(x.log()) && !/could not continue/.test(x.log()));
    else assert.ok(x.log().includes(String(error.message || error)) && /Diagnosis could not continue/.test(x.log()) && !/Diagnosis stopped/.test(x.log()));
    assert.strictEqual(x.A.highs, null);
  }
  // Cancel with and without a pending worker solve. The same adapter must reject later calls too.
  for (const pending of [false, true]) {
    const x = context("en", true);
    x.T.diagnose = async (P, highs) => {
      assert.strictEqual(x.el("#btnCancel").hidden, false);
      const active = pending ? highs.solve("synthetic LP", {}) : null;
      // app-main's Cancel action terminates the adapter and releases A.highs.
      highs.terminate(); x.A.highs = null;
      if (active) await assert.rejects(active, /中止/);
      await assert.rejects(highs.solve("must not be posted", {}), /中止/);
      throw new Error("中止しました");
    };
    await x.A.runSolve(); x.unchanged(); x.idle();
    assert.strictEqual(x.workers.length, 1); assert.strictEqual(x.workers[0].terminated, true);
    assert.strictEqual(x.workers[0].sent.filter(m => m.type === "solve").length, pending ? 1 : 0);
    assert.ok(/Diagnosis stopped/.test(x.log()));
    // A second click starts a fresh adapter; cancellation must not poison the next run.
    x.T.diagnose = async () => [];
    await x.A.runSolve(); x.unchanged(); x.idle(); assert.strictEqual(x.workers.length, 2);
  }
  // A crashed worker rejects every later trial immediately, with the original error rather than cancellation.
  {
    const x = context("en", true);
    x.T.diagnose = async (P, highs) => {
      const active = highs.solve("synthetic LP before crash", {});
      x.workers[0].onerror({ message: "synthetic worker crash" });
      await assert.rejects(active, /synthetic worker crash/);
      const lines = [];
      for (const label of ["Failed group A", "Failed group B"]) {
        try { await highs.solve("must not be posted after crash", {}); assert.fail("a failed worker must reject"); }
        catch (e) {
          assert.strictEqual(e.message, "synthetic worker crash");
          assert.ok(!e.cancelled && !/中止/.test(e.message));
          lines.push(group({ label, undecided: true, status: "Error", reason: "error", error: e.message }));
        }
      }
      return lines;
    };
    await x.A.runSolve(); x.unchanged(); x.idle();
    assert.strictEqual(x.workers[0].sent.filter(m => m.type === "solve").length, 1, "never post new work to a crashed worker");
    assert.ok(/Could not decide "Failed group A":.*synthetic worker crash/.test(x.log()));
    assert.ok(/Could not decide "Failed group B":.*synthetic worker crash/.test(x.log()));
    assert.ok(!/Diagnosis stopped/.test(x.log()));
    assert.strictEqual(x.A.highs.usable, false);
    assert.strictEqual(Object.getOwnPropertyDescriptor(x.A.highs, "usable").set, undefined, "adapter usability is read-only");
    const oldWorker = x.workers[0];
    // The first retry replaces the failed adapter. A late event from the old worker cannot poison it.
    x.T.diagnose = async (P, highs) => {
      assert.strictEqual(x.workers.length, 2); assert.strictEqual(highs.usable, true);
      oldWorker.onerror({ message: "late error from old worker" });
      assert.strictEqual(x.A.highs, highs); assert.strictEqual(highs.usable, true);
      return [group({ label: "Fresh retry group" })];
    };
    await x.A.runSolve(); x.unchanged(); x.idle();
    assert.strictEqual(oldWorker.terminated, true, "discarding the old adapter releases its worker");
    assert.ok(/Solvable without "Fresh retry group"/.test(x.log()));
    assert.ok(!/late error|synthetic worker crash|could not continue/.test(x.log()));
  }
  // Repeated Solve clicks while diagnosing do not start another solver or lose busy state.
  {
    const x = context(); let release, ready;
    const started = new Promise(resolve => { ready = resolve; });
    x.T.diagnose = async () => { ready(); return await new Promise(resolve => { release = resolve; }); };
    const running = x.A.runSolve(); await started;
    await x.A.runSolve(); assert.strictEqual(x.solves(), 1); assert.strictEqual(x.A.solving, true);
    assert.ok(x.toasts.some(s => /Solving|already|progress/i.test(s)));
    release([]); await running; x.unchanged(); x.idle();
  }
  // Results for a stale input snapshot or reloaded plug-in must never become current advice.
  for (const change of ["input", "plugins"]) {
    const x = context();
    x.T.diagnose = async () => {
      if (change === "input") x.A.state.month.notes = "Synthetic edit during diagnosis";
      else x.T.plugins.beginFolder();
      return [group({ label: "SYNTHETIC_STALE_DIAGNOSIS" })];
    };
    await x.A.runSolve(); x.idle();
    assert.strictEqual(x.A.state.result, x.previous);
    assert.ok(!/SYNTHETIC_STALE_DIAGNOSIS/.test(x.log()), "stale diagnostic advice must not be rendered");
    assert.ok(/changed|reloaded/.test(x.log()), "explain why the old diagnosis cannot be used");
  }
  // Every literal Japanese UI string in this file has an English translation.
  const en = langs.find(l => l.code === "en").ui;
  for (const match of read("src/app-solve.js").matchAll(/T\.t\("((?:[^"\\]|\\.)*)"/g)) {
    const key = JSON.parse('"' + match[1] + '"');
    if (/[\u3000-\u9fff]/.test(key)) assert.ok(Object.prototype.hasOwnProperty.call(en, key), "Missing English translation: " + key);
  }
  console.log("OK diagnosis UI: joint removals, unknown evidence, soft progress, result preservation, cancellation and retry");
})().catch(e => { console.error(e); process.exit(1); });
