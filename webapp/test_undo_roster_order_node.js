// Undoing roster order must not record renames or transfer another person's input during a merge.
// Synthetic roster, browser storage and folder only.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const elements = new Map();
globalThis.document = { querySelector(s) { if (!elements.has(s)) elements.set(s, { value: "", textContent: "", addEventListener() {} }); return elements.get(s); }, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.location = { pathname: "/synthetic/undo-order.html", protocol: "file:" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = o => JSON.parse(JSON.stringify(o));
const N = ["Synthetic A", "Synthetic B", "Synthetic C"], Z = "Synthetic Z";
for (const k of ["save", "renderAll", "renderHeader", "readAll"]) A[k] = () => {};
A.choose = async () => { throw new Error("Unexpected merge conflict"); };
let toasts;
A.toast = s => toasts.push(String(s));
function setup() {
  const rules = { profile: { id: "synthetic-order", roles: [{ id: "S", label: "Staff", refs: [] }] }, doctors: N.map(name => ({ name, team: "S" })), name_order: N.slice() };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [N[0]]: [5], [N[1]]: [6], [N[2]]: [7] } }, rules);
  Object.assign(A.state, { rules, month, result: null, meta: null, base: null, baseRules: null, renames: [], ui: { doctor: 0 } });
  A.dirHandle = null; A.clearUndo(); toasts = [];
  A.markSaved("synthetic", "2026-10-01T00:00:00Z");
}
function rename(from, to) {
  assert.strictEqual(A.renameDoctor(from, to), true);
  A.state.rules.doctors.find(d => d.name === from).name = to;
  A.refreshNameOrder(A.state.rules);
}
async function reorder(order) {
  A.pushUndo("名簿の並べ替え");
  const rows = A.state.rules.doctors.slice();
  A.state.rules.doctors = order.map(i => rows[i]);
  A.refreshNameOrder(A.state.rules);
  await Promise.resolve(); // The real undo entry captures the month after the edit in a microtask.
}
function folder(data) {
  const files = new Map([["202611_data.json", JSON.stringify(data)]]);
  const dir = { name: "synthetic-folder", async *entries() { yield ["202611", { kind: "directory" }]; },
    async getDirectoryHandle() { return dir; },
    async getFileHandle(name, options = {}) {
      if (!files.has(name) && !options.create) throw Object.assign(new Error("synthetic missing file"), { name: "NotFoundError" });
      return { getFile: async () => ({ text: async () => files.get(name) }),
        createWritable: async () => ({ write: async blob => files.set(name, await blob.text()), close: async () => {} }) };
    }
  };
  A.dirHandle = dir; A.monthDirs = ["202611"]; A.dirGen++;
  return files;
}
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); console.log("ok " + label); passed++; } catch (e) { console.error("FAIL " + label + ": " + e.message); failed++; } }
(async () => {
  await test("undo order retains an existing rename and each person's identity", async () => {
    for (const order of [[1, 0, 2], [2, 0, 1], [2, 1, 0]]) {
      setup(); rename(N[0], Z); const before = clone(A.state);
      await reorder(order); A.undo();
      assert.deepStrictEqual(A.state.rules.doctors, before.rules.doctors);
      assert.deepStrictEqual(A.state.month, before.month);
      assert.deepStrictEqual(A.state.renames, [[N[0], Z]], "row order is not a name change");
      assert.deepStrictEqual(T.effectiveRenames(A.state.renames, N, A.names()), [[N[0], Z]]);
      for (const [name, origin] of [[Z, N[0]], [N[1], N[1]], [N[2], N[2]]]) assert.strictEqual(T.renameOrigin(A.state.renames, N, name), origin);
    }
  });
  await test("autosave merge after undo attaches remote unavailable days to the same person", async () => {
    setup(); const theirs = JSON.parse(A.payloadJson("2026-10-02T00:00:00Z"));
    theirs.month.unavailable_night[N[0]].push(9); theirs.month.unavailable_night[N[1]].push(12);
    const files = folder(theirs);
    rename(N[0], Z); await reorder([1, 0, 2]); A.undo();
    assert.strictEqual(await A.autosaveJson(), "saved");
    const saved = JSON.parse(files.get("202611_data.json"));
    assert.deepStrictEqual(saved.month.unavailable_night[Z], [5, 9], "old A's remote input belongs to renamed Z");
    assert.deepStrictEqual(saved.month.unavailable_night[N[1]], [6, 12], "B's remote input must stay with B");
    assert.deepStrictEqual(saved.month.unavailable_night[N[2]], [7]);
    assert(!Object.hasOwn(saved.month.unavailable_night, N[0]));
    assert.deepStrictEqual(A.state.renames, []); assert.strictEqual(A.isDirty(), false);
  });
  await test("undo order after later monthly edits preserves those edits", async () => {
    setup(); rename(N[0], Z); await reorder([1, 0, 2]);
    A.state.month.unavailable_night[Z].push(10);
    const month = A.state.month, before = clone(month);
    A.undo();
    assert.deepStrictEqual(A.names(), [Z, N[1], N[2]], "restore only the roster order");
    assert.strictEqual(A.state.month, month); assert.deepStrictEqual(A.state.month, before);
    assert.deepStrictEqual(A.state.renames, [[N[0], Z]]);
    assert(!toasts.some(s => /取り消せません/.test(s)));
  });
  await test("order-only undo adds no rename and actual rename undo still restores the person", async () => {
    setup(); await reorder([1, 2, 0]); A.undo();
    assert.deepStrictEqual(A.names(), N); assert.deepStrictEqual(A.state.renames, []);
    A.pushUndo("名簿の変更"); rename(N[0], Z); await Promise.resolve(); A.undo();
    assert.deepStrictEqual(A.names(), N); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5]);
    assert.deepStrictEqual(A.state.renames, [[N[0], Z], [Z, N[0]]], "actual rename undo records the inverse rename");
    assert.deepStrictEqual(T.effectiveRenames(A.state.renames, N, A.names()), []);
    // A real name change still cannot be undone over subsequent monthly edits.
    A.pushUndo("名簿の変更"); rename(N[0], Z); await Promise.resolve(); A.state.month.notes = "later synthetic edit";
    A.undo(); assert.deepStrictEqual(A.names(), [Z, N[1], N[2]]); assert.strictEqual(A.state.month.notes, "later synthetic edit");
    assert(toasts.some(s => /取り消せません/.test(s)));
  });
  console.log(`undo roster order: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
