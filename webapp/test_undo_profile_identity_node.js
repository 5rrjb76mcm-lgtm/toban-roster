// プロファイル・設定JSONの取り消しは、名簿の並びから改名を推測しない。架空データ・メモリ内のフォルダだけを使う。
// node test_undo_profile_identity_node.js [別の webapp ディレクトリ] で同じ試験を旧版にも適用できる。
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = process.argv[2] || __dirname, elements = new Map();
const element = s => {
  if (!elements.has(s)) elements.set(s, { value: "", innerHTML: "", textContent: "", hidden: false, className: "", listeners: {},
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); } });
  return elements.get(s);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis; globalThis.location = { pathname: "/synthetic/undo-profile.html", protocol: "file:" };
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.confirm = () => true;
globalThis.alert = text => { throw new Error(String(text)); }; globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), tick = () => Promise.resolve();
for (const k of ["save", "readAll", "renderAll", "renderHeader", "renderSettingsMonth", "renderDoctor", "showTab"]) A[k] = () => {};
let toasts = []; A.toast = text => toasts.push(String(text));
A.bindSettings();
const N = ["Synthetic A", "Synthetic B", "Synthetic C", "Synthetic D"], baseAt = "2026-10-01T00:00:00Z";
const missing = () => Object.assign(new Error("synthetic missing file"), { name: "NotFoundError" });
function setup(names = N.slice(0, 2)) {
  const rules = { profile: { id: "synthetic-original", roles: [{ id: "S", label: "Staff", refs: [] }] },
    doctors: names.map(name => ({ name, team: "S" })), name_order: names.slice() };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true }, rules), files = {};
  const dir = { name: "synthetic", async *entries() { yield ["202611", { kind: "directory" }]; },
    async getDirectoryHandle(n) { if (n === "plugins") throw missing(); return dir; },
    async getFileHandle(n, opts = {}) {
      if (!opts.create && !(n in files)) throw missing();
      return { getFile: async () => ({ text: async () => files[n] }),
        createWritable: async () => ({ write: async blob => { files[n] = await blob.text(); }, close: async () => {} }) };
    } };
  Object.assign(A.state, { rules, month, result: null, renames: [], meta: null, base: null, baseRules: null, ui: { doctor: 0 } });
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ["202611"]; A.clearUndo(); toasts = [];
  A.markSaved(undefined, baseAt); files["202611_data.json"] = A.payloadJson(baseAt);
  A.choose = async () => { throw new Error("No conflict prompt should be needed"); };
  return { files, base: JSON.parse(files["202611_data.json"]) };
}
async function importJson(names) {
  const rules = clone(A.state.rules); rules.doctors = names.map(name => ({ name, team: "S" })); rules.name_order = names.slice();
  element("#rulesJson").value = JSON.stringify(rules);
  await element("#btnApplyRules").listeners.click[0](); await tick();
  assert.deepStrictEqual(A.names(), names, "設定JSONの通常の入口から名簿を置き換える");
}
async function checkMerge(f, who, remoteRules = false) {
  const remote = JSON.parse(f.files["202611_data.json"]); remote.month.unavailable_night[who] = [9];
  if (remoteRules) remote.rules.weights.wish_night = (remote.rules.weights.wish_night || 0) + 1;
  remote.saved_at = "2026-10-03T00:00:00Z"; f.files["202611_data.json"] = JSON.stringify(remote);
  A.state.month.notes = "Synthetic local edit";
  // 保存済みの設定JSONを戻した場合は両方が名簿/設定を変更しているので、自分の名簿を選ぶ。それ以外に月入力の衝突はない。
  A.choose = async text => { assert.ok(/設定（名簿・規則・重み）/.test(text), text); return "mine"; };
  assert.strictEqual(await A.autosaveJson(), "saved");
  const saved = JSON.parse(f.files["202611_data.json"]);
  assert.deepStrictEqual(saved.month.unavailable_night[who], [9], "相手の不可日は同じ本人に残る");
  for (const n of A.names().filter(n => n !== who)) assert.deepStrictEqual(saved.month.unavailable_night[n] || [], [], "ほかの人に不可日を移さない: " + n);
  assert.deepStrictEqual(A.state.renames, [], "成功した保存で改名の記録を確定する");
}
(async () => {
  // 重なる氏名の位置が変わる置換（同人数・増員・減員）と、単なる並べ替え。
  const cases = [
    { before: N.slice(0, 2), after: [N[1], N[2]] },
    { before: N.slice(0, 2), after: [N[1], N[2], N[3]] },
    { before: N.slice(0, 3), after: [N[1], N[3]] },
    { before: N.slice(0, 2), after: [N[1], N[0]] },
  ];
  for (const c of cases) for (const savedBeforeUndo of [false, true]) {
    const f = setup(c.before); await importJson(c.after);
    if (savedBeforeUndo) assert.strictEqual(await A.autosaveJson(), "saved", "取り消す前にも通常の保存を通す");
    A.undo(); assert.deepStrictEqual(A.names(), c.before, "取り消しで元の名簿へ");
    await checkMerge(f, N[1]);
  }
  // プロファイル選択の入口も同じ。施設を元へ戻してから、元の施設の他PCの変更と統合できる。
  { const f = setup(), other = clone(A.state.rules); other.profile.id = "synthetic-alternate";
    other.doctors = [N[1], N[2]].map(name => ({ name, team: "S" })); other.name_order = [N[1], N[2]]; T.PROFILES = [other];
    await A.loadProfileById("synthetic-alternate"); A.undo(); await checkMerge(f, N[1]); }
  // 未保存の設定置換と取り消しだけで、元からいる人を「同期後に追加した別人」と誤認しない。
  { const f = setup(); await importJson([N[1], N[2]]); A.undo();
    assert.deepStrictEqual(T.effectiveRenames(A.state.renames, f.base.rules.doctors.map(d => d.name), A.names()), []);
    assert.deepStrictEqual(T.newPersons(A.state.renames, f.base.rules.doctors.map(d => d.name), A.names()), []);
    await checkMerge(f, N[0], true); }
  // 本当の改名・削除・追加は、保存を挟んでも取り消した本人の対応を維持する。
  for (const savedBeforeUndo of [false, true]) for (const kind of ["rename", "remove", "add"]) {
    const f = setup(); A.state.month.unavailable_night[N[0]] = [5]; A.markSaved(undefined, baseAt); f.files["202611_data.json"] = A.payloadJson(baseAt);
    A.pushUndo("名簿の変更");
    if (kind === "rename") { assert.ok(A.renameDoctor(N[0], N[2])); A.state.rules.doctors[0].name = N[2]; }
    if (kind === "remove") A.removeDoctor(0);
    if (kind === "add") A.state.rules.doctors.push({ name: N[2], team: "S" });
    A.refreshNameOrder(A.state.rules); await tick();
    if (savedBeforeUndo) assert.strictEqual(await A.autosaveJson(), "saved");
    A.undo(); assert.deepStrictEqual(A.names(), N.slice(0, 2)); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5]);
    const effective = T.effectiveRenames(A.state.renames, A.state.baseRules.doctors.map(d => d.name), A.names());
    assert.deepStrictEqual(effective, savedBeforeUndo && kind === "rename" ? [[N[2], N[0]]] : savedBeforeUndo && kind === "add" ? [[N[2], T.GONE + N[2]]] : []);
    A.state.month.notes = "Synthetic edit after undo";
    assert.strictEqual(await A.autosaveJson(), "saved");
  }
  // 役割IDも月の固定OCなしが参照する。後から表題を変更した月へ、設定だけを戻すと参照が壊れる。
  for (const laterMonthEdit of [false, true]) {
    setup(); A.state.month.fixed.night_oc_none[7] = ["S"];
    A.pushUndo("施設の構成の変更"); A.state.rules.profile.roles[0].id = "R";
    A.state.rules.doctors.forEach(d => d.team = "R"); A.state.month.fixed.night_oc_none[7] = ["R"]; await tick();
    if (laterMonthEdit) A.state.month.doc_label = "確定版"; // ヘッダーの表題変更はUndoの記録を作らない。
    A.undo(); const id = laterMonthEdit ? "R" : "S";
    assert.deepStrictEqual(A.state.rules.profile.roles.map(r => r.id), [id]);
    assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), [id, id]);
    assert.deepStrictEqual(A.state.month.fixed.night_oc_none[7], [id], "設定だけを戻して月の役割IDを孤立させない");
    assert.strictEqual(toasts.some(t => /取り消せません/.test(t)), laterMonthEdit);
    if (laterMonthEdit) assert.strictEqual(A.state.month.doc_label, "確定版");
  }
  // 表示名だけの変更なら参照先のIDは同じ。後から変えた月を残し、設定だけ戻してよい。
  setup(); A.pushUndo("施設の構成の変更"); A.state.rules.profile.roles[0].label = "Synthetic renamed label"; await tick();
  A.state.month.doc_label = "確定版"; A.undo(); assert.strictEqual(A.state.rules.profile.roles[0].label, "Staff");
  assert.strictEqual(A.state.month.doc_label, "確定版"); assert.ok(!toasts.some(t => /取り消せません/.test(t)));
  // JSONで役割の表示順だけを変えた場合は、IDと本人の対応は不変。後から編集した月を保って順序だけ戻せる。
  setup(); A.state.rules.profile.roles.push({ id: "R", label: "Second", refs: [] });
  { const rules = clone(A.state.rules); rules.profile.roles.reverse(); element("#rulesJson").value = JSON.stringify(rules);
    await element("#btnApplyRules").listeners.click[0](); await tick();
    A.state.month.fixed.night_oc_none[7] = ["R"]; A.state.month.notes = "Synthetic later input"; A.undo();
    assert.deepStrictEqual(A.state.rules.profile.roles.map(r => r.id), ["S", "R"]);
    assert.deepStrictEqual(A.state.month.fixed.night_oc_none[7], ["R"]); assert.strictEqual(A.state.month.notes, "Synthetic later input");
    assert.ok(!toasts.some(t => /取り消せません/.test(t)), "役割の並べ替えを改名と扱わない"); }
  console.log("プロファイル/設定JSONのUndo: 重なる氏名・並べ替え・人数変更・保存前後の本人対応と自動統合、役割IDの部分巻戻し防止 OK");
})().catch(e => { console.error(e); process.exit(1); });
