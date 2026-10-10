// Undo after reusing a deleted name must restore the most recently removed person.
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
async function remove(name) { A.pushUndo("名簿から削除"); A.removeDoctor(A.names().indexOf(name)); A.refreshNameOrder(A.state.rules); await Promise.resolve(); }
async function change(from, to) { A.pushUndo("名簿の変更"); rename(from, to); await Promise.resolve(); }
async function reuse(earlierRename = false) {
  if (earlierRename) await change(N[1], Z);
  await remove(N[0]); await change(earlierRename ? Z : N[1], N[0]); await remove(N[0]); A.undo();
}
function verifyRestored() {
  assert.deepStrictEqual(A.names(), [N[0], N[2]]);
  assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [6]);
  assert.strictEqual(T.renameOrigin(A.state.renames, N, N[0]), N[1], "the restored person is original B, not deleted A");
  const effective = new Map(T.effectiveRenames(A.state.renames, N, A.names())); assert.strictEqual(effective.size, 2); assert.ok(effective.get(N[0]).startsWith(T.GONE)); assert.strictEqual(effective.get(N[1]), N[0]);
  assert.deepStrictEqual(T.newPersons(A.state.renames, N, A.names()), []);
}
(async () => {
  for (const earlierRename of [false, true]) {
    await test("restore most recent deletion regardless of chain creation order: " + earlierRename, async () => { setup(); await reuse(earlierRename); verifyRestored(); });
    await test("repeated remove/undo retains the restored person's origin: " + earlierRename, async () => {
      setup(); await reuse(earlierRename);
      for (let i = 0; i < 3; i++) { await remove(N[0]); A.undo(); verifyRestored(); }
    });
    await test("remote edit to deleted original A blocks automatic merge: " + earlierRename, async () => {
      setup(); const theirs = JSON.parse(A.payloadJson("2026-10-02T00:00:00Z")); theirs.month.unavailable_night[N[0]].push(9); const files = folder(theirs), originalFile = files.get("202611_data.json");
      await reuse(earlierRename); const before = clone(A.state.month); let decisions = 0;
      A.choose = async (message, options) => { decisions++; assert.ok(options.some(o => o.value === "load")); assert.ok(options.some(o => o.value === "overwrite")); return null; };
      try { assert.strictEqual(await A.autosaveJson(), "skipped"); assert.strictEqual(decisions, 1); assert.strictEqual(files.get("202611_data.json"), originalFile); assert.deepStrictEqual(A.state.month, before); }
      finally { A.choose = async () => { throw new Error("Unexpected merge conflict"); }; }
    });
    await test("remote original-B edit follows restored B into reused A name: " + earlierRename, async () => {
      setup(); const theirs = JSON.parse(A.payloadJson("2026-10-02T00:00:00Z")); theirs.month.unavailable_night[N[1]].push(12); const files = folder(theirs);
      await reuse(earlierRename); assert.strictEqual(await A.autosaveJson(), "saved");
      const saved = JSON.parse(files.get("202611_data.json")); assert.deepStrictEqual(saved.month.unavailable_night[N[0]], [6, 12]); assert.deepStrictEqual(saved.month.unavailable_night[N[2]], [7]); assert.ok(!Object.hasOwn(saved.month.unavailable_night, N[1])); assert.deepStrictEqual(A.state.renames, []);
    });
  }
  await test("undo entire deletion/name-reuse sequence restores original identities", async () => {
    setup(); await reuse(); verifyRestored(); A.undo(); A.undo();
    assert.deepStrictEqual(A.names(), N); assert.deepStrictEqual(A.state.month.unavailable_night, { [N[0]]: [5], [N[1]]: [6], [N[2]]: [7] });
    for (const n of N) assert.strictEqual(T.renameOrigin(A.state.renames, N, n), n);
    assert.deepStrictEqual(T.effectiveRenames(A.state.renames, N, A.names()), []);
  });
  await test("three successive people reusing a name restore in undo order", async () => {
    setup(); await remove(N[0]); await change(N[1], N[0]); await remove(N[0]); await change(N[2], N[0]); await remove(N[0]);
    A.undo(); assert.strictEqual(T.renameOrigin(A.state.renames, N, N[0]), N[2]); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [7]);
    A.undo(); A.undo(); assert.strictEqual(T.renameOrigin(A.state.renames, N, N[0]), N[1]); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [6]);
    A.undo(); A.undo(); assert.deepStrictEqual(A.names(), N); for (const n of N) assert.strictEqual(T.renameOrigin(A.state.renames, N, n), n);
  });
  await test("saved deletion followed by undo stays a newly restored person relative to new base", async () => {
    setup(); const files = folder(JSON.parse(A.payloadJson("2026-10-01T00:00:00Z")));
    await remove(N[0]); await change(N[1], N[0]); await remove(N[0]);
    assert.strictEqual(await A.autosaveJson(), "saved"); A.undo();
    assert.deepStrictEqual(A.names(), [N[0], N[2]]); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [6]);
    assert.strictEqual(T.renameOrigin(A.state.renames, A.state.baseRules.doctors.map(d => d.name), N[0]), null);
    assert.deepStrictEqual(T.newPersons(A.state.renames, A.state.baseRules.doctors.map(d => d.name), A.names()), [N[0]]);
    assert.strictEqual(await A.autosaveJson(), "saved"); assert.deepStrictEqual(JSON.parse(files.get("202611_data.json")).month.unavailable_night[N[0]], [6]);
  });

  await test("serialized unique markers remain distinct after Undo history reset", async () => {
    setup(); await reuse(); const marks = A.state.renames.flat().filter(n => n.startsWith(T.GONE));
    A.state.renames = JSON.parse(JSON.stringify(A.state.renames)); A.clearUndo(); verifyRestored();
    await remove(N[0]); const newMark = A.state.renames[A.state.renames.length - 1][1]; assert.ok(!marks.includes(newMark)); A.undo(); verifyRestored();
  });
  await test("ambiguous legacy markers block merge without changing either version", async () => {
    setup(); const theirs = JSON.parse(A.payloadJson("2026-10-02T00:00:00Z")); theirs.month.unavailable_night[N[0]].push(9); const files = folder(theirs);
    await reuse(); A.state.renames = A.state.renames.map(pair => pair.map(n => n.startsWith(T.GONE) ? T.GONE + N[0] : n));
    A.state.renames = JSON.parse(JSON.stringify(A.state.renames)); A.clearUndo(); const originalFile = files.get("202611_data.json"), before = clone(A.state.month); let decisions = 0;
    A.choose = async (message, options) => { decisions++; assert.ok(message.includes("以前の版")); assert.ok(options.some(o => o.value === "load")); assert.ok(options.some(o => o.value === "overwrite")); return null; };
    try { assert.strictEqual(await A.autosaveJson(), "skipped"); assert.strictEqual(decisions, 1); assert.strictEqual(files.get("202611_data.json"), originalFile); assert.deepStrictEqual(A.state.month, before); }
    finally { A.choose = async () => { throw new Error("Unexpected merge conflict"); }; }
  });
  await test("nonambiguous legacy removal still merges another person's remote input", async () => {
    setup(); const theirs = JSON.parse(A.payloadJson("2026-10-02T00:00:00Z")); theirs.month.unavailable_night[N[1]].push(12); const files = folder(theirs);
    await remove(N[0]); assert.deepStrictEqual(A.state.renames, [[N[0], T.GONE + N[0]]]);
    A.state.renames = JSON.parse(JSON.stringify(A.state.renames)); A.clearUndo(); assert.strictEqual(await A.autosaveJson(), "saved");
    assert.deepStrictEqual(JSON.parse(files.get("202611_data.json")).month.unavailable_night[N[1]], [6, 12]);
  });
  console.log(`undo reused deleted name: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
