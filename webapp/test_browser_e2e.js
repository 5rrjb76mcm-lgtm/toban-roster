// 実ブラウザの通し試験（Playwright + インストール済みの Chrome、ヘッドレス）。組み立てた toban.html を 127.0.0.1 の簡易サーバーで開き、画面の操作から保存されたファイルまでを確かめる。
//   node test_browser_e2e.js [toban.html のパス]     （既定は ./toban.html。Playwright は ~/.toban-test/node_modules、ブラウザは /Applications/Google Chrome.app）
// フォルダの選択ダイアログは自動化できないので、window.showDirectoryPicker を、Node 側にファイルを持つ偽の FileSystemDirectoryHandle（ページ内のクラス＋Playwright の binding）に差し替える。
// 本物の OPFS のハンドルは IndexedDB に保存したあとページを閉じると Chrome 本体が落ちる（Chrome 153 で再現）ため使わない。偽のハンドルは構造化複製できない（own の関数を持つ）ので
// IndexedDB には保存されず、開き直したときは「フォルダを開いて開始」から同じフォルダを選び直す形になる（フォルダのデータで再開する経路は実物）。名前はすべて架空（同梱の見本）。
//  1) 編集→保存→閉じる→再読込: メモの変更が自動保存でフォルダに書かれ、ページを閉じて開き直し、同じフォルダを選ぶと同じ値で再開する
//  2) 同名の別フォルダへ切替: 空のフォルダに替えると未保存になり、自動保存でそのフォルダに月データが作られる
//  3) プラグイン欠落時の計算・出力停止: プラグインの規則で計算・保存した月を、プラグインを外して開くと入力チェックが知らせ、計算せず、保存しても勤務表を出さない
//  4) 共有用書き出し: 名簿を含めない書き出しは役割名＋番号・役割・目安だけになり、フォルダに書かれる
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert");
const HTML = path.resolve(process.argv[2] || path.join(__dirname, "toban.html"));
let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("--  実ブラウザの通し試験は省略（cd ~/.toban-test && npm i playwright で入れると走る）"); process.exit(0); }
if (!fs.existsSync("/Applications/Google Chrome.app")) { console.log("--  実ブラウザの通し試験は省略（Google Chrome が無い）"); process.exit(0); }
if (!fs.existsSync(HTML)) { console.log(`FAIL ${HTML} がありません（build.py で組み立ててから）`); process.exit(1); }
const PLUGIN = `T.rules.register({ id: "local.e2e.rule", api: 1, order: 999, group: "basic", label: "通し試験の規則", states: ["hard", "off"], def: "hard", messages: { E2E_X: { en: "x", ja: "x" } }, solve() { }, check() { }, penalty() { } });`;
let fails = 0; const ok = m => console.log("ok   " + m), fail = m => { fails++; console.log("FAIL " + m); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { fail(`${name}\n      ${(e && e.stack || e).toString().split("\n").slice(0, 3).join("\n      ")}`); } }
(async () => {
  const srv = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fs.readFileSync(HTML)); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r)); const URL = `http://127.0.0.1:${srv.address().port}/toban.html`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let closing = false; browser.on("disconnected", () => { if (!closing) fail("ブラウザが途中で終了しました"); });
  const keeper = await browser.newPage(); await keeper.goto("about:blank"); // 空のページを 1 つ開いたままにする（インストール済みの Chrome は最後のページを閉じるとブラウザごと終了するため、試験ごとの context を閉じても残るように）
  const INIT = `window.confirm = () => false; window.alert = m => { (window.__alerts ||= []).push(String(m)); };
    // 偽のフォルダ（中身は Node 側。__e2efs(op, args) は Playwright の binding）
    const B64 = { enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))), dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
    class FakeFile { constructor(path) { this.kind = "file"; this.name = path.split("/").pop(); this.__path = path; this.__nc = () => { }; }
      async getFile() { const b = await __e2efs("read", { path: this.__path }); if (b === null) throw new DOMException("not found", "NotFoundError"); return new File([B64.dec(b)], this.name); }
      async createWritable() { const chunks = [], path = this.__path; return { async write(x) { chunks.push(x instanceof Blob ? new Uint8Array(await x.arrayBuffer()) : typeof x === "string" ? new TextEncoder().encode(x) : new Uint8Array(x)); }, async close() { const n = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } await __e2efs("write", { path, b64: B64.enc(out.buffer) }); } }; }
      async queryPermission() { return "granted"; } async requestPermission() { return "granted"; } }
    class FakeDir { constructor(path) { this.kind = "directory"; this.name = path.split("/").pop(); this.__path = path; this.__nc = () => { }; }
      async *entries() { for (const e of await __e2efs("list", { path: this.__path })) yield [e.name, e.kind === "directory" ? new FakeDir(this.__path + "/" + e.name) : new FakeFile(this.__path + "/" + e.name)]; }
      async getDirectoryHandle(name, opt) { const p = this.__path + "/" + name, k = await __e2efs("kind", { path: p }); if (k === "directory") return new FakeDir(p); if (k) throw new DOMException("not a directory", "TypeMismatchError"); if (opt && opt.create) { await __e2efs("mkdir", { path: p }); return new FakeDir(p); } throw new DOMException("not found", "NotFoundError"); }
      async getFileHandle(name, opt) { const p = this.__path + "/" + name, k = await __e2efs("kind", { path: p }); if (k === "file") return new FakeFile(p); if (k) throw new DOMException("not a file", "TypeMismatchError"); if (opt && opt.create) { await __e2efs("write", { path: p, b64: "" }); return new FakeFile(p); } throw new DOMException("not found", "NotFoundError"); }
      async removeEntry(name) { await __e2efs("remove", { path: this.__path + "/" + name }); }
      async queryPermission() { return "granted"; } async requestPermission() { return "granted"; } async isSameEntry(o) { return o && o.__path === this.__path; } }
    window.showDirectoryPicker = async () => { const p = localStorage.getItem("__e2e_folder") || "A"; await __e2efs("mkdir", { path: p }); return new FakeDir(p); };`;
  // Node 側のファイル置き場（試験ごとに 1 つ）。path は "A/202611/202611_data.json" の形
  const makeFs = () => { const files = new Map(), dirs = new Set();
    const parent = p => p.split("/").slice(0, -1).join("/");
    const fs = { files, dirs, kind: p => files.has(p) ? "file" : dirs.has(p) ? "directory" : null,
      mkdir: p => { const segs = p.split("/"); for (let i = 1; i <= segs.length; i++) dirs.add(segs.slice(0, i).join("/")); },
      write: (p, buf) => { fs.mkdir(parent(p)); files.set(p, buf); }, read: p => files.has(p) ? files.get(p) : null,
      remove: p => { files.delete(p); dirs.delete(p); for (const k of [...files.keys()]) if (k.startsWith(p + "/")) files.delete(k); for (const k of [...dirs]) if (k.startsWith(p + "/")) dirs.delete(k); },
      list: p => { const out = new Map(); for (const k of files.keys()) if (parent(k) === p) out.set(k.split("/").pop(), "file"); for (const k of dirs) if (parent(k) === p && k !== p) out.set(k.split("/").pop(), "directory"); return [...out].map(([name, kind]) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name)); },
      text: p => { const b = fs.read(p); return b === null ? null : b.toString("utf8"); }, names: p => fs.list(p).map(e => e.name) };
    return fs; };
  const bind = async (ctx, fs) => { await ctx.exposeBinding("__e2efs", (_, op, a) => { switch (op) { case "read": { const b = fs.read(a.path); return b === null ? null : b.toString("base64"); } case "write": fs.write(a.path, Buffer.from(a.b64 || "", "base64")); return true; case "kind": return fs.kind(a.path); case "mkdir": fs.mkdir(a.path); return true; case "remove": fs.remove(a.path); return true; case "list": return fs.list(a.path); default: throw new Error("unknown op " + op); } }); };
  const newCtx = async () => { const ctx = await browser.newContext(); const fs = makeFs(); await bind(ctx, fs); return { ctx, fs }; };
  const newPage = async ctx => { const page = await ctx.newPage(); await page.addInitScript(INIT); page.on("pageerror", e => fail(`ページのエラー: ${e.message}`)); page.on("crash", () => fail("ページがクラッシュしました")); if (process.env.E2E_DEBUG) page.on("console", m => console.log("     console:", m.type(), m.text().slice(0, 160))); await page.goto(URL); await page.waitForSelector("#startGate:not([hidden])"); return page; };
  // 「閉じて開き直す」は、新しいページを先に開いてから前のページを閉じる（インストール済みの Chrome は最後のページを閉じるとブラウザごと終了する）
  const reopen = async (ctx, page) => { const p2 = await newPage(ctx); await page.close(); return p2; };
  const start = async (page, label = "フォルダを開いて開始") => { await page.getByRole("button", { name: label }).click(); await page.waitForSelector("#startGate", { state: "hidden", timeout: 15000 }); };
  const waitSaved = page => page.waitForSelector("#saveState.saved", { timeout: 20000 });
  const setNotes = async (page, text) => { await page.click('.tab[data-tab="input"]'); const ta = page.locator('textarea[data-path="notes"]'); await ta.fill(text); await ta.dispatchEvent("change"); };
  const solve = async page => { await page.click('.tab[data-tab="calc"]'); await page.click("#btnSolve"); await page.waitForFunction(() => /必須条件の違反|計算しません|解なし|見つかりません/.test(document.querySelector("#calcLog").textContent), null, { timeout: 120000 }); return page.locator("#calcLog").textContent(); };

  await test("編集→保存→閉じる→再読込: メモが自動保存でフォルダに書かれ、開き直して同じフォルダを選ぶと同じ値で再開", async () => {
    const { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    await start(page); await waitSaved(page);
    assert.ok(fs.names("A").includes("202611"), "接続直後の自動保存で月フォルダができる");
    await setNotes(page, "通し試験のメモ"); await page.waitForSelector("#saveState.dirty"); await waitSaved(page);
    const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.strictEqual(saved.month.notes, "通し試験のメモ", "保存された JSON にメモが入る");
    page = await reopen(ctx, page);
    await start(page); await page.click('.tab[data-tab="input"]'); // 開き直すと同じフォルダを選び直す（フォルダのデータと突き合わせて再開）
    assert.strictEqual(await page.locator('textarea[data-path="notes"]').inputValue(), "通し試験のメモ", "再読込後も同じメモ"); await page.waitForSelector("#saveState.saved");
    assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "通し試験のメモ");
    await ctx.close();
  });
  await test("同名の別フォルダへ切替: 空のフォルダでは未保存になり、自動保存で月データが作られる", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx);
    await page.evaluate(() => localStorage.setItem("__e2e_folder", "X/勤務表")); // 親の違う同じ名前「勤務表」を 2 つ
    await start(page); await waitSaved(page);
    assert.ok(fs.names("X/勤務表").includes("202611"));
    await page.evaluate(() => localStorage.setItem("__e2e_folder", "Y/勤務表"));
    await page.click("#btnOpenFolder"); await page.waitForFunction(() => /未保存/.test(document.querySelector("#saveState").textContent), null, { timeout: 10000 });
    await waitSaved(page); assert.ok(fs.names("Y/勤務表/202611").includes("202611_data.json"), "切替後の自動保存で新しいフォルダに月データ");
    assert.strictEqual(await page.locator("#folderBar b").textContent(), "勤務表");
    await ctx.close();
  });
  await test("プラグイン欠落時: 入力チェックが知らせ、計算せず、保存しても勤務表を出さない", async () => {
    const { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    fs.write("A/plugins/rules/local.e2e.rule.js", Buffer.from(PLUGIN, "utf8"));
    await start(page); await waitSaved(page);
    assert.ok(await page.evaluate(() => !!T.RULE_BY_ID["local.e2e.rule"]), "フォルダのプラグインが読み込まれる");
    const log1 = await solve(page); assert.ok(/必須条件の違反 0 件/.test(log1), "プラグインありで計算できる: " + log1.slice(-120)); await waitSaved(page);
    const files1 = fs.names("A/202611"); assert.ok(files1.some(n => /_roster_v1_/.test(n)), "計算後の保存で勤務表 v1: " + files1.join(","));
    const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.ok(saved.month.plugins_used.includes("local.e2e.rule") && saved.result.plugins.length === 1, "使ったプラグインが記録される");
    fs.remove("A/plugins/rules/local.e2e.rule.js"); page = await reopen(ctx, page);
    await start(page); await page.waitForSelector("#saveState");
    assert.ok(await page.evaluate(() => !T.RULE_BY_ID["local.e2e.rule"]), "外したプラグインは登録されない");
    const log2 = await solve(page); assert.ok(/計算しません/.test(log2) && /local\.e2e\.rule/.test(log2), "欠落を知らせて計算しない: " + log2.slice(-200));
    await setNotes(page, "欠落したまま編集"); await waitSaved(page);
    const files2 = fs.names("A/202611"); assert.ok(!files2.some(n => /_roster_v2_/.test(n)), "保存しても勤務表の新しい版は出ない: " + files2.join(","));
    assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "欠落したまま編集", "月データは保存される");
    await ctx.close();
  });
  await test("共有用書き出し: 名簿を含めない書き出しは役割名＋番号・役割・目安だけ", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx);
    await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="build"]'); await page.click("#btnExportProfile");
    await page.waitForFunction(() => /profile_/.test(document.querySelector("#toast").textContent), null, { timeout: 10000 });
    const names = fs.names("A").filter(n => /^profile_.*\.json$/.test(n)); assert.strictEqual(names.length, 1, "フォルダに書かれる: " + names.join(","));
    const prof = JSON.parse(fs.text("A/" + names[0])), origNames = await page.evaluate(() => T.app.state.rules.doctors.map(d => d.name));
    assert.strictEqual(prof.toban_profile.roster, "placeholder"); const txt = JSON.stringify(prof);
    for (const n of origNames) assert.ok(!txt.includes(n), `${n} は残らない`);
    for (const d of prof.doctors) { assert.ok(/^(主担当|副担当|若手|部長)\d+$/.test(d.name), d.name); assert.ok(Object.keys(d).every(k => ["name", "team", "quota", "share"].includes(k)), Object.keys(d).join(",")); }
    assert.ok(!("years" in prof.doctors[0]));
    await ctx.close();
  });
  closing = true; await browser.close(); srv.close();
  if (fails) { console.log(`実ブラウザの通し試験: ${fails} 件失敗`); process.exit(1); } console.log("実ブラウザの通し試験 4 本 OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });
