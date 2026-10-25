// Synthetic adapter lifecycle regression. No browser, HiGHS or real roster data required.
// Exercise the real public runSolve entry point, not extracted/private function copies.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const source = fs.readFileSync(path.join(__dirname, "src/app-solve.js"), "utf8");
const result = () => ({ asg: null, status: "TimeLimit", seconds: 0, vars: 0, cons: 0 });
let finished = false;
const cases = [];
const add = (id, run) => { cases.push({ id, run }); console.log("C04_LEDGER " + JSON.stringify({ event: "registered", id })); };
const hookFailures = [];
// runSolve intentionally catches solver errors; assertion failures inside a test hook must escape that boundary.
const checkedHook = fn => async (...args) => { try { return await fn(...args); } catch (e) { if (e && e.code === "ERR_ASSERTION") hookFailures.push(e); throw e; } };
// A missing Worker reply must fail, not silently exit 0 with an unresolved Promise.
const watchdog = setTimeout(() => { console.error("FAIL worker URL cleanup: lifecycle promise did not settle"); process.exitCode = 1; }, 20000);
process.on("exit", () => { if (!finished) { console.error("FAIL worker URL cleanup: suite did not finish"); process.exitCode = 1; } });
function context(options = {}) {
  const created = [], revoked = [], workers = [], elements = new Map(), intervals = new Set();
  let fallbackCalls = 0, fallbackSolves = 0, timer = 0;
  const el = s => {
    if (!elements.has(s)) elements.set(s, { textContent: "", checked: false, value: "1", hidden: true, disabled: false });
    return elements.get(s);
  };
  class FakeWorker {
    constructor(url) {
      assert.ok(created.includes(url)); assert.ok(!revoked.includes(url), "source must survive Worker construction");
      if (options.constructorError) throw new Error("constructor failed");
      this.url = url; this.sent = []; this.terminations = 0; workers.push(this);
    }
    postMessage(m) {
      this.sent.push(m);
      if (m.type === "init") {
        assert.ok(!revoked.includes(this.url), "source must survive until init acknowledgement");
        if (options.initPostError) throw new Error("init post failed");
        Promise.resolve().then(() => {
          assert.ok(!revoked.includes(this.url), "do not revoke before worker initialization finishes");
          if (options.initCrash) this.onerror({ message: "init crashed" });
          else this.onmessage({ data: options.initError ? { id: m.id, err: "init failed" } : { id: m.id, ok: true } });
        });
      } else if (!options.holdSolve) {
        if (options.solvePostError) throw new Error("solve post failed");
        Promise.resolve().then(() => this.onmessage({ data: options.solveError ? { id: m.id, err: "solve failed" } : { id: m.id, sol: result() } }));
      }
    }
    terminate() { this.terminations++; if (options.terminateError) throw new Error("terminate failed"); }
  }
  const A = { state: { rules: {}, month: {}, result: null }, readAll() {}, inputSig: () => "same",
    toast() {}, loadPendingPlugins: async () => {}, highs: null };
  const T = { app: A, esc: s => s, t: s => s, Problem: class {}, lintPlugins: () => [], lint: () => [],
    plugins: { generation: () => 0 }, WASM_B64: "", b64ToBytes: () => new Uint8Array(),
    solveWithAvoidRef: (P, h) => h.solve("synthetic LP", {}), diagnose: async () => [] };
  // For a decode failure, fail only the worker-side first conversion; fallback remains available.
  if (options.decodeError) { let decoded = 0; T.b64ToBytes = () => { if (++decoded === 1) throw new Error("decode failed"); return new Uint8Array(); }; }
  const fallback = { solve: () => { fallbackSolves++; return result(); } };
  const c = { T, console, Worker: FakeWorker, Blob: class {},
    URL: { createObjectURL: () => { const url = `blob:synthetic/${created.length + 1}`; created.push(url); return url; },
      revokeObjectURL: url => { assert.ok(created.includes(url)); assert.ok(!revoked.includes(url), "revoke exactly once"); revoked.push(url); } },
    document: { querySelector: el, getElementById: id => id === "highsSrc" ? { textContent: "synthetic source" } : null },
    setTimeout: f => { f(); return 0; }, setInterval: () => { intervals.add(++timer); return timer; }, clearInterval: id => intervals.delete(id),
    Module: async () => {
      fallbackCalls++;
      assert.deepStrictEqual(revoked, created, "release URL before fallback begins");
      assert.ok(workers.every(w => w.terminations === 1), "stop failed worker before fallback begins");
      if (options.fallbackError) throw new Error("fallback failed");
      return fallback;
    } };
  vm.createContext(c); vm.runInContext(source, c, { filename: "app-solve.js" });
  const idle = () => { assert.strictEqual(A.solving, false); assert.strictEqual(A.runSolve.busy, false); assert.strictEqual(el("#btnSolve").disabled, false); assert.strictEqual(intervals.size, 0); };
  return { A, T, el, options, workers, created, revoked, fallback, idle,
    fallbackCalls: () => fallbackCalls, fallbackSolves: () => fallbackSolves };
}
add("init_reuse_cancel_restart", async () => { // 1. Init acknowledgement releases URL, successful requests reuse worker; visible solve cancellation and retry.
    const x = context(); await x.A.runSolve(); x.idle();
    const adapter = x.A.highs, worker = x.workers[0];
    assert.deepStrictEqual(x.revoked, x.created); assert.strictEqual(worker.terminations, 0);
    await x.A.runSolve(); assert.strictEqual(x.A.highs, adapter); assert.strictEqual(x.workers.length, 1);
    assert.strictEqual(worker.sent.filter(m => m.type === "solve").length, 2);
    x.options.holdSolve = true;
    x.T.solveWithAvoidRef = checkedHook(async (P, h) => {
      assert.strictEqual(x.el("#btnCancel").hidden, false, "cancel only once the UI exposes it");
      const first = h.solve("first pending", {}), second = h.solve("second pending", {});
      const rejected = Promise.all([assert.rejects(first, /中止/), assert.rejects(second, /中止/)]);
      h.terminate(); h.terminate(); x.A.highs = null; // same ownership transition as app-main's Cancel handler
      await rejected; await assert.rejects(h.solve("after cancel", {}), /中止/);
      throw new Error("中止しました");
    });
    await x.A.runSolve(); x.idle(); assert.strictEqual(worker.terminations, 1); assert.strictEqual(x.revoked.length, 1);
    x.options.holdSolve = false; x.T.solveWithAvoidRef = (P, h) => h.solve("retry", {});
    await x.A.runSolve(); x.idle(); assert.strictEqual(x.workers.length, 2); assert.strictEqual(x.fallbackCalls(), 0);
    assert.notStrictEqual(x.A.highs, adapter); assert.deepStrictEqual(x.revoked, x.created);
    x.A.highs.terminate(); x.A.highs.terminate(); assert.strictEqual(x.workers[1].terminations, 1);
});
// 2–6. Constructor/init failures clean up before fallback; synchronous fallback stays cached.
for (const key of ["constructorError", "initError", "initCrash", "initPostError", "decodeError"]) add(key, async () => {
    const x = context({ [key]: true }); await x.A.runSolve(); x.idle();
    assert.strictEqual(x.A.highs, x.fallback, key); assert.strictEqual(x.fallbackCalls(), 1, key);
    assert.strictEqual(x.workers.length, key === "constructorError" ? 0 : 1, key);
    assert.deepStrictEqual(x.revoked, x.created, key); assert.strictEqual(x.created.length, 1, key);
    await x.A.runSolve(); x.idle(); assert.strictEqual(x.fallbackCalls(), 1, key); assert.strictEqual(x.fallbackSolves(), 2, key);
});
add("runtime_crash", async () => { // 7. Runtime crash rejects all pending calls, preserves original error and releases immediately; retry is fresh.
    const x = context({ holdSolve: true });
    x.T.solveWithAvoidRef = checkedHook(async (P, h) => {
      const worker = x.workers[0], first = h.solve("pending A", {}), second = h.solve("pending B", {});
      const rejected = Promise.all([assert.rejects(first, /runtime crash/), assert.rejects(second, /runtime crash/)]);
      worker.onerror({ message: "runtime crash" }); await rejected;
      assert.strictEqual(worker.terminations, 1); assert.strictEqual(h.usable, false);
      worker.onerror({ message: "late different error" });
      await assert.rejects(h.solve("after crash", {}), /runtime crash/);
      assert.strictEqual(worker.sent.length, 3, "do not post to crashed worker");
      throw new Error("runtime crash");
    });
    await x.A.runSolve(); x.idle(); assert.strictEqual(x.A.highs, null); assert.strictEqual(x.workers[0].terminations, 1);
    x.options.holdSolve = false; x.T.solveWithAvoidRef = (P, h) => h.solve("retry", {});
    await x.A.runSolve(); x.idle(); assert.strictEqual(x.workers.length, 2); assert.strictEqual(x.A.highs.usable, true);
    x.workers[0].onerror({ message: "old worker error" }); assert.strictEqual(x.A.highs.usable, true);
    assert.deepStrictEqual(x.revoked, x.created); x.A.highs.terminate();
});
// 8–9. Normal request rejection and postMessage failure also retire the discarded worker.
for (const key of ["solveError", "solvePostError"]) add(key, async () => {
    const x = context({ [key]: true }); await x.A.runSolve(); x.idle();
    assert.strictEqual(x.A.highs, null); assert.strictEqual(x.workers[0].terminations, 1); assert.deepStrictEqual(x.revoked, x.created);
});
add("diagnostic_error", async () => { // 10. Diagnostic failure retires its worker even without an onerror event.
    const x = context({ solveError: true });
    x.T.solveWithAvoidRef = async () => ({ ...result(), status: "Infeasible" });
    x.T.diagnose = (P, h) => h.solve("diagnostic request", {});
    await x.A.runSolve(); x.idle(); assert.strictEqual(x.A.highs, null);
    assert.strictEqual(x.workers[0].terminations, 1); assert.deepStrictEqual(x.revoked, x.created);
});
add("fallback_error", async () => { // 11. Fallback failure cannot retain a worker that failed initialization.
    const x = context({ initError: true, fallbackError: true });
    await assert.rejects(x.A.runSolve(), /fallback failed/); x.idle();
    assert.strictEqual(x.workers[0].terminations, 1); assert.deepStrictEqual(x.revoked, x.created);
});
add("terminate_error", async () => { // 12. A throwing terminate still releases the URL on failed init; no second termination attempt.
    const x = context({ initError: true, terminateError: true }); await x.A.runSolve(); x.idle();
    assert.strictEqual(x.A.highs, x.fallback); assert.strictEqual(x.workers[0].terminations, 1); assert.deepStrictEqual(x.revoked, x.created);
});

// Registration and completion are independent: an exit code or success string alone is insufficient.
(async () => {
  const expected = ["init_reuse_cancel_restart", "constructorError", "initError", "initCrash", "initPostError", "decodeError", "runtime_crash", "solveError", "solvePostError", "diagnostic_error", "fallback_error", "terminate_error"];
  assert.deepStrictEqual(cases.map(c => c.id), expected, "all authored cases must be registered once");
  let passed = 0, failed = 0;
  for (const c of cases) {
    console.log("C04_LEDGER " + JSON.stringify({ event: "started", id: c.id }));
    const before = hookFailures.length;
    let timer;
    try {
      await Promise.race([c.run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("case timeout: " + c.id)), 5000); })]);
      assert.strictEqual(hookFailures.length, before, hookFailures.slice(before).map(e => e.stack).join("\n"));
      passed++;
      console.log("C04_LEDGER " + JSON.stringify({ event: "completed", id: c.id, status: "pass" }));
    } catch (e) {
      failed++;
      console.error(e.stack || e);
      console.log("C04_LEDGER " + JSON.stringify({ event: "completed", id: c.id, status: "fail", error: e.message, code: e.code || null }));
    } finally { clearTimeout(timer); }
  }
  assert.strictEqual(passed + failed, expected.length);
  console.log("C04_LEDGER " + JSON.stringify({ event: "summary", registered: cases.length, started: passed + failed, completed: passed + failed, pass: passed, fail: failed, skip: 0 }));
  finished = true;
  if (failed) process.exitCode = 1;
  else console.log("OK worker URL cleanup: 12 synthetic lifecycle cases");
})().catch(e => { finished = true; console.error(e.stack || e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
