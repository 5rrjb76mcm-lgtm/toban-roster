// 規則をプラグインに移すときの確認: 移す前（git の版）と後（いまの src）で、解く側に渡す LP の文字列が同じか。
//   node lp_same_node.js [git の版。既定 HEAD]
// 見本の施設と、規則の状態を変えた設定で比べる。1 つでも違えば終了コード 1。docs/rule-modules.md §7
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const W = __dirname, rev = process.argv[2] || "HEAD";
const old = fs.mkdtempSync(path.join(os.tmpdir(), "toban_old_")); fs.mkdirSync(path.join(old, "rules")); fs.mkdirSync(path.join(old, "calendars"));
const files = ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"];
const listed = execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "webapp/src"], { cwd: path.join(W, ".."), encoding: "utf8" }).split("\n");
for (const f of files.concat(listed.filter(x => x.startsWith("webapp/src/rules/") || x.startsWith("webapp/src/calendars/")).map(x => x.slice("webapp/src/".length))))
  if (listed.includes("webapp/src/" + f)) fs.writeFileSync(path.join(old, f), execFileSync("git", ["show", `${rev}:webapp/src/${f}`], { cwd: path.join(W, ".."), encoding: "utf8" }));
function load(dir) {
  globalThis.T = {}; const has = f => fs.existsSync(path.join(dir, f));
  for (const f of files) if (has(f)) vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8"), { filename: f });
  if (has("rules")) for (const f of fs.readdirSync(path.join(dir, "rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(dir, "rules", f), "utf8"), { filename: "rules/" + f });
  if (has("calendars")) for (const f of fs.readdirSync(path.join(dir, "calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(dir, "calendars", f), "utf8"), { filename: "calendars/" + f });
  for (const q of fs.readdirSync(path.join(W, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(W, "lang", q), "utf8")));
  T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(W, "data/rules.json"), "utf8")); return T;
}
const rd = f => JSON.parse(fs.readFileSync(path.join(W, f), "utf8")), clone = o => JSON.parse(JSON.stringify(o));
// 重みの鍵の改名（2026-09-23）: 移す前の版は旧い鍵を読むので、比べるときは両方の鍵を持たせる（新しい版は読み込み時に旧い鍵を消す）
const RENAMED = { same_day_charge_other_soft: "same_day_IA_soft", same_day_other_junior: "same_day_AY", same_day_other_both: "same_day_AA" };
const compat = r => { const rr = clone(r); rr.weights = Object.assign({}, rr.weights); for (const [n, o] of Object.entries(RENAMED)) if (rr.weights[n] !== undefined && rr.weights[o] === undefined) rr.weights[o] = rr.weights[n]; return rr; };
const saved = rd("data/202611_data_test.json"), month0 = { year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false };
const cases = [["循環器（保存データ）", saved.rules, saved.month], ["循環器（曜日パターン）", rd("data/rules.json"), rd("data/202611.json")]];
// 減点にできる規則をすべて減点、必須にできる規則をすべて必須、の 2 通りも
const oldIds = new Set(fs.readdirSync(path.join(old, "rules")).map(f => f.replace(/\.js$/, ""))); // 移す前の版にある規則（新しく足した規則は既定の「なし」のまま比べる）
const flip = (r, want) => { const rr = clone(r); rr.rule_states = Object.assign({}, rr.rule_states); for (const d of load(path.join(W, "src")).RULE_DEFS) if (d.states.includes(want) && (oldIds.has(d.id) || !fs.existsSync(path.join(W, "src/rules", d.id + ".js")))) { rr.rule_states[d.id] = want; for (const a of d.aliases || []) rr.rule_states[a] = want; } return rr; }; // 旧 id にも（移す前の版のため）
cases.push(["循環器・減点にできる規則をすべて減点", flip(saved.rules, "soft"), saved.month], ["循環器・必須にできる規則をすべて必須", flip(saved.rules, "hard"), saved.month]);
for (const p of ["two-shift", "nurse-2shift", "fixtures/ward-2shift", "oncall-min"]) cases.push([p, rd(p.startsWith("fixtures/") ? `data/${p}.json` : `data/profiles/${p}.json`), month0]);
// LP の文字列が違うときの代わりの確認: 移す前の版で解いた割当と崩した割当（2 通り）を、両方の版で全枠固定して解いた点数と減点の数え直しが一致するか
// （制約や補助変数の並びが変わっただけなら一致する。式そのものが変わっていれば違う）
async function scoreSame(r, m) {
  const highs = await require(process.env.HIGHS || path.join(process.env.HOME, ".toban-test/node_modules/highs"))();
  const mk = dir => { const T = load(dir); const rr = compat(r); T.fillDefaultRules(rr); return [T, new T.Problem(rr, T.normalizeMonth(clone(m), rr))]; };
  const [T0, P0] = mk(old), asgs = [];
  for (const j of [null, { seed: 1, scale: 60 }, { seed: 7, scale: 400 }]) { const res = T0.solve(P0, highs, Object.assign({ timeLimit: 20, mipGap: 0.1 }, j ? { jitter: j } : {})); if (res.asg) asgs.push(res.asg); }
  if (!asgs.length) return "解けないので比べられない";
  for (const asg of asgs) { const v = [];
    for (const dir of [old, path.join(W, "src")]) { const [T, P] = mk(dir); v.push([T.solve(P, highs, { timeLimit: 30, pin: asg }).objective, T.penalty(P, asg).total]); }
    if (v[0][0] !== v[1][0] || v[0][1] !== v[1][1]) return `点数が違う ${JSON.stringify(v)}`; }
  return null;
}
// 並びと補助変数の名前をそろえた形: 制約ごとに 1 行にして「aux_番号」を AUX に置き換え、整列する（制約の並び替えと補助変数の付け直しだけなら一致する）
// 目的関数（1 行）は項ごとに分けて整列する（プラグインにすると項の入る順が変わる）
const normalized = txt => txt.split("\n").map(l => l.replace(/^ c\d+: /, "").replace(/\b[A-Za-z]+_\d+\b/g, "AUX"))
  .map(l => l.startsWith(" obj: ") ? " obj: " + l.slice(6).split(/ (?=[+-] )/).sort().join(" ") : l).filter(l => !/^ *AUX$/.test(l)).sort().join("\n");
(async () => {
  let bad = 0, diff = 0, reorder = 0;
  for (const [lab, r, m] of cases) {
    const out = [];
    for (const dir of [old, path.join(W, "src")]) { const T = load(dir); const rr = compat(r); T.fillDefaultRules(rr); const P = new T.Problem(rr, T.normalizeMonth(clone(m), rr)); out.push(T.buildLP(P).lp.toLP()); }
    if (out[0] === out[1]) { console.log(`same ${lab}`); continue; }
    if (normalized(out[0]) === normalized(out[1])) { reorder++; console.log(`same ${lab}（制約の並びと補助変数の名前だけが違う）`); continue; }
    diff++; const why = await scoreSame(r, m);
    if (why) { bad++; console.log(`DIFF ${lab}: 制約が違い、${why}`); } else console.log(`DIFF ${lab}: 制約の集合が違う（${out[0].length} 字 → ${out[1].length} 字）が、割当 3 通りの点数と減点は同じ`);
  }
  console.log(bad ? `${bad} 件で式が変わった（${rev} と比べて）` : diff ? `制約の集合が ${diff} 設定で違うが、点数は ${cases.length} 設定すべて ${rev} と同じ` : reorder ? `制約の集合は ${rev} と同じ（${cases.length} 設定。${reorder} 設定は並びだけが違う）` : `LP は ${rev} と同じ（${cases.length} 設定）`);
  process.exit(bad ? 1 : 0);
})();
