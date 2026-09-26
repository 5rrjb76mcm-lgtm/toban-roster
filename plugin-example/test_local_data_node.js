// 施設のプラグインの「独自のデータの約束」（README 6）を確かめるひな形の試験。施設の plugins/ に複製して使う:
//   node plugins/test_local_data_node.js [本体の webapp のパス]
// 本体は、引数 → 環境変数 TOBAN_WEBAPP → ../webapp（このリポジトリの plugin-example）→ ../../toban-roster/webapp（施設のフォルダ）の順に探す。
// このフォルダ（rules/ calendars/ docx/ lang/ profiles/）の全プラグインを実行時の読み込み口で読み、次を確かめる。名前はすべて架空（同梱の見本）
//  1) 登録: 全部読める。規則の id は local. で始まり、order と group がある
//  2) normalize / normalizeMonth は冪等（2 回目で何も変わらない）
//  3) 改名: 名簿の氏名を変えると、設定・月データのどこにも旧氏名が残らない（columns の rename と規則の rename）
//  4) 共有: 名簿を含めない書き出しに氏名が残らない（本体の置き換えと規則の share）
//  5) 統合: 月の独自データ（local_…）は統合の往復で保たれ、空値（null / [] / {}）も残る
//  6) 署名: 独自の配列の並べ替えは変更として検知される（保存・計算中の変更）
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const HERE = __dirname;
const W = [process.argv[2], process.env.TOBAN_WEBAPP, path.join(HERE, "..", "webapp"), path.join(HERE, "..", "..", "toban-roster", "webapp")].filter(Boolean).map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "src", "model.js")));
if (!W) { console.log("FAIL 本体の webapp が見つかりません（引数か TOBAN_WEBAPP で渡す）"); process.exit(1); }
// 画面のファイル（app-core / app-settings）も読むので、DOM と保存領域の代わりを置く
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" }; globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };
globalThis.T = {};
const run = (dir, tag) => { for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js")).sort()) vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8"), { filename: `${tag}/${f}` }); };
vm.runInThisContext(fs.readFileSync(path.join(W, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" }); // docx の様式のプラグインを読むため
for (const f of ["i18n.js", "rules-core.js", "model.js"]) vm.runInThisContext(fs.readFileSync(path.join(W, "src", f), "utf8"), { filename: f });
run(path.join(W, "src/calendars"), "calendars");
for (const f of ["messages.js", "solver.js", "check.js", "report.js", "docxgen.js", "plugins.js", "merge.js", "app-core.js", "app-settings.js"]) vm.runInThisContext(fs.readFileSync(path.join(W, "src", f), "utf8"), { filename: f });
run(path.join(W, "src/rules"), "rules");
for (const q of fs.readdirSync(path.join(W, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(W, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(W, "data/rules.json"), "utf8"));
const A = T.app; A.toast = () => { }; A.renderHeader = () => { }; A.save = () => { }; A.renderAll = () => { };
let passed = 0, failed = 0; const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", (e && e.message || e).toString().split("\n")[0]); } };
// このフォルダのプラグインを実行時の読み込み口で読む
const loaded = [];
for (const kind of T.plugins.KINDS) { const dir = path.join(HERE, kind); if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => (kind === "lang" || kind === "profiles" ? /\.json$/ : /\.js$/).test(x)).sort()) loaded.push(T.plugins.load(kind, `${kind}/${f}`, fs.readFileSync(path.join(dir, f), "utf8"))); }
const mine = T.RULE_DEFS.filter(d => d.source && loaded.some(x => x.name === d.source)); // このフォルダの規則
test(`登録: ${loaded.length} 件のプラグインが読める（規則 ${mine.length}）`, () => { for (const x of loaded) assert(x.ok, `${x.name}: ${x.error}`); assert(loaded.length > 0, "プラグインが 1 つも無い");
  for (const d of mine) assert(typeof d.order === "number" && d.group, `${d.id}: order と group`);
  const odd = mine.filter(d => !/^local\./.test(d.id)).map(d => d.id); if (odd.length) console.log(`     注意: id が local. で始まらない規則: ${odd.join(", ")}（本体から移した規則など、意図したものなら可。新しく作る規則は local.<施設>.<名前>）`); });
// 見本の設定と月: このフォルダのプロファイルがあればそれ、無ければ本体の見本。規則は全部「使う」にして独自データの経路を通す
const profiles = loaded.filter(x => x.kind === "profiles" && x.ok);
const baseRules = () => { const R = JSON.parse(JSON.stringify(profiles.length ? T.PROFILES.find(p => (p.profile || {}).id === profiles[0].ids[0]) : T.DEFAULT_RULES)); if (!R.doctors || !R.doctors.length) R.doctors = JSON.parse(JSON.stringify(T.DEFAULT_RULES.doctors)); return R; };
const setup = () => { const R = baseRules(); T.fillDefaultRules(R); for (const d of mine) if (d.states && d.states[0] !== "off") R.rule_states[d.id] = d.states[0]; T.fillDefaultRules(R);
  const m = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(W, "data/202611.json"), "utf8")), R); return { R, m }; };
test("normalize / normalizeMonth は冪等（2 回目で何も変わらない）", () => { const { R, m } = setup(); const r1 = JSON.stringify(R), m1 = JSON.stringify(m); T.fillDefaultRules(R); T.normalizeMonth(m, R); assert.strictEqual(JSON.stringify(R), r1, "設定"); assert.strictEqual(JSON.stringify(m), m1, "月データ"); });
test("改名: 名簿の氏名を変えると、設定・月データのどこにも旧氏名が残らない", () => { const { R, m } = setup(); const old = R.doctors[0].name, neu = "改名後の職員";
  Object.assign(A.state, { rules: R, month: m, result: null, base: null }); A.renameDoctor(old, neu); R.doctors[0].name = neu; A.refreshNameOrder(R); for (const c of T.rules.columnsAll(R)) if (c.rename) c.rename(R, old, neu);
  const hit = s => JSON.stringify(s).includes(JSON.stringify(old).slice(1, -1)); assert(!hit(R), `設定に旧氏名 ${old} が残る`); assert(!hit(m), `月データに旧氏名 ${old} が残る`); assert(JSON.stringify(R).includes(neu)); });
test("共有: 名簿を含めない書き出しに氏名が残らない", () => { const { R, m } = setup(); Object.assign(A.state, { rules: R, month: m, result: null });
  const ex = A.profileForExport(false), txt = JSON.stringify(ex.rules); for (const d of R.doctors) assert(!txt.includes(d.name), `${d.name} が残る（規則の share で除く）`); assert.deepStrictEqual(ex.leftover, [], "残存の警告なし"); });
test("統合: 月の独自データ（local_…）は往復で保たれ、空値も残る", () => { const { R, m } = setup(); const b = JSON.parse(JSON.stringify(m)); b.local_probe = { max: 3, list: [2, 1], flag: false, none: null, empty: [], obj: {} };
  const rt = T.unflattenMonth(T.flattenMonth(b), b); assert.deepStrictEqual(rt.local_probe, b.local_probe, "空値と並びを含めて同じ");
  for (const k of Object.keys(b).filter(k => /^local[_.]/.test(k))) assert.deepStrictEqual(rt[k], b[k], `${k} が往復で変わる`);
  const mine2 = JSON.parse(JSON.stringify(b)); mine2.local_probe.max = 7; const theirs = JSON.parse(JSON.stringify(b)); theirs.notes = "相手"; const r = T.mergeMonth(b, mine2, theirs); assert.strictEqual(r.merged.local_probe.max, 7); assert.strictEqual(r.conflicts.length, 0); });
test("署名: 独自の配列の並べ替えは変更として検知される", () => { const { R, m } = setup(); m.local_probe = { order: ["a", "b"] }; R.local_probe = { prio: ["x", "y"] }; Object.assign(A.state, { rules: R, month: m, result: null }); A.markSaved();
  m.local_probe.order.reverse(); assert(A.isDirty(), "月の独自配列"); m.local_probe.order.reverse(); assert(!A.isDirty()); const rs = A.rulesSig(R); R.local_probe.prio.reverse(); assert.notStrictEqual(A.rulesSig(R), rs, "設定の独自配列"); assert(A.isDirty()); });
console.log(failed ? `${passed} 件通過、${failed} 件失敗` : `独自のデータの約束: ${passed} 件すべて通過`); if (failed) process.exit(1);
