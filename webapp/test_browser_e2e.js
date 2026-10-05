// 実ブラウザの通し試験（Playwright + インストール済みの Chrome、ヘッドレス）。組み立てた toban.html を 127.0.0.1 の簡易サーバーで開き、画面の操作から保存されたファイルまでを確かめる。
//   node test_browser_e2e.js [toban.html のパス]     （既定は ./toban.html。Playwright は ~/.toban-test/node_modules、ブラウザは /Applications/Google Chrome.app）
// フォルダの選択ダイアログは自動化できないので、window.showDirectoryPicker を、Node 側にファイルを持つ偽の FileSystemDirectoryHandle（ページ内のクラス＋Playwright の binding）に差し替える。
// 本物の OPFS のハンドルは IndexedDB に保存したあとページを閉じると Chrome 本体が落ちる（Chrome 153 で再現）ため使わない。偽のハンドルは構造化複製できない（own の関数を持つ）ので
// IndexedDB には保存されず、開き直したときは「フォルダを開いて開始」から同じフォルダを選び直す形になる（フォルダのデータで再開する経路は実物）。名前はすべて架空（同梱の見本）。
//  1) 編集→保存→閉じる→再読込: メモの変更が自動保存でフォルダに書かれ、ページを閉じて開き直し、同じフォルダを選ぶと同じ値で再開する
//  2) 同名の別フォルダへ切替: 空のフォルダに替えると未保存になり、自動保存でそのフォルダに月データが作られる
//  3) プラグイン欠落時の計算・出力停止: プラグインの規則で計算・保存した月を、プラグインを外して開くと入力チェックが知らせ、計算せず、保存しても勤務表を出さない
//  4) 共有用書き出し: 名簿を含めない書き出しは役割名＋番号・役割・目安だけになり、フォルダに書かれる
//  5) 外部 JSON の読込: 読んだ直後は未保存、自動保存でフォルダに書かれ、開き直しても読んだ内容で再開する
//  6) JSON のダウンロード: 押してもフォルダへの未保存は残り、自動保存で書かれる
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert");
const HTML = path.resolve(process.argv[2] || path.join(__dirname, "toban.html"));
let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("--  実ブラウザの通し試験は省略（cd ~/.toban-test && npm i playwright で入れると走る）"); process.exit(0); }
if (!fs.existsSync("/Applications/Google Chrome.app")) { console.log("--  実ブラウザの通し試験は省略（Google Chrome が無い）"); process.exit(0); }
if (!fs.existsSync(HTML)) { console.log(`FAIL ${HTML} がありません（build.py で組み立ててから）`); process.exit(1); }
const PLUGIN = `T.rules.register({ id: "local.e2e.rule", api: 1, order: 999, group: "basic", label: "通し試験の規則", states: ["hard", "off"], def: "hard", messages: { E2E_X: { en: "x", ja: "x" } }, solve() { }, check() { }, penalty() { } });`;
let fails = 0, passed = 0; const ok = m => { passed++; console.log("ok   " + m); }, fail = m => { fails++; console.log("FAIL " + m); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { fail(`${name}\n      ${(e && e.stack || e).toString().split("\n").slice(0, 3).join("\n      ")}`); } }
(async () => {
  const srv = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fs.readFileSync(HTML)); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r)); const URL = `http://127.0.0.1:${srv.address().port}/toban.html`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let closing = false; browser.on("disconnected", () => { if (!closing) fail("ブラウザが途中で終了しました"); });
  const keeper = await browser.newPage(); await keeper.goto("about:blank"); // 空のページを 1 つ開いたままにする（インストール済みの Chrome は最後のページを閉じるとブラウザごと終了するため、試験ごとの context を閉じても残るように）
  const INIT = `window.confirm = () => false; window.alert = m => { (window.__alerts ||= []).push(String(m)); };
    window.__toasts = []; document.addEventListener("DOMContentLoaded", () => { const t = document.querySelector("#toast"); if (!t) return; new MutationObserver(() => { const s = t.textContent; if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); }).observe(t, { childList: true, characterData: true, subtree: true }); }); // 知らせ（トースト）の履歴。消える前の文も検査できる
    // 偽のフォルダ（中身は Node 側。__e2efs(op, args) は Playwright の binding）
    const B64 = { enc: buf => { const u = new Uint8Array(buf); let b = ""; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(b); }, dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) }; // 大きなファイル（docx）でも引数の上限に当たらないよう塊で変換
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
    window.showDirectoryPicker = async () => { const p = localStorage.getItem("__e2e_folder") || "A"; await __e2efs("mkdir", { path: p }); return new FakeDir(p); };
    // 偽のフォルダを IndexedDB に覚えられるようにする（実物のハンドルは複製できる。偽物は関数を持つので、場所だけを入れて読むときに作り直す）。同じ context で開き直すと、権限が残っているときの自動の再接続を通る
    { const put0 = IDBObjectStore.prototype.put, get0 = IDBObjectStore.prototype.get, res = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "result");
      IDBObjectStore.prototype.put = function (v, k) { return put0.call(this, v instanceof FakeDir ? { __fakeDir: v.__path } : v, k); };
      IDBObjectStore.prototype.get = function (k) { const r = get0.call(this, k); Object.defineProperty(r, "result", { configurable: true, get() { const v = res.get.call(r); return v && v.__fakeDir ? new FakeDir(v.__fakeDir) : v; } }); return r; }; }`;
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
  // fs.gates[path] に Promise を置くと、その場所の最初の読取りだけを保留する（読取り中の操作の試験用）。保留した読取りは、読んだ時点の内容を返す
  const bind = async (ctx, fs) => { await ctx.exposeBinding("__e2efs", (_, op, a) => { switch (op) { case "read": { const b = fs.read(a.path); if (fs.gates && fs.gates[a.path]) { const g = fs.gates[a.path]; delete fs.gates[a.path]; fs.waiting = (fs.waiting || 0) + 1; return g.then(() => b === null ? null : b.toString("base64")); } return b === null ? null : b.toString("base64"); } case "write": fs.write(a.path, Buffer.from(a.b64 || "", "base64")); return true; case "kind": return fs.kind(a.path); case "mkdir": fs.mkdir(a.path); return true; case "remove": fs.remove(a.path); return true; case "list": return fs.list(a.path); default: throw new Error("unknown op " + op); } }); };
  const newCtx = async () => { const ctx = await browser.newContext(); const fs = makeFs(); await bind(ctx, fs); return { ctx, fs }; };
  const newPage = async (ctx, opts) => { const page = await ctx.newPage(); await page.addInitScript(INIT); page.on("pageerror", e => fail(`ページのエラー: ${e.message}`)); page.on("crash", () => fail("ページがクラッシュしました")); if (process.env.E2E_DEBUG) page.on("console", m => console.log("     console:", m.type(), m.text().slice(0, 160))); await page.goto(URL); if (!(opts && opts.noGate)) await page.waitForSelector("#startGate:not([hidden])"); return page; };
  // 「閉じて開き直す」は、新しいページを先に開いてから前のページを閉じる（インストール済みの Chrome は最後のページを閉じるとブラウザごと終了する）
  // 「閉じて開き直す」は、同じ Node 側のフォルダを結び付けた新しい context（localStorage・IndexedDB は空）で開く。ブラウザ内の保存が無いので、フォルダのデータから再開する経路そのものを通る
  const reopen = async (ctx, fs) => { const c2 = await browser.newContext(); await bind(c2, fs); const p2 = await newPage(c2); await ctx.close(); return { ctx: c2, page: p2 }; };
  // 開始: ボタンを押し、開始画面が消えるまで待つ。フォルダにデータがあってブラウザ内に無いときは「フォルダのデータを読み込む（推奨）」の確認画面が出るので、それを押す（実物の再開の経路）
  const start = async (page, label = "フォルダを開いて開始") => { await page.getByRole("button", { name: label }).click();
    for (let i = 0; i < 100; i++) { if (await page.locator("#startGate").isHidden()) return; const b = page.locator("#modalBtns button", { hasText: "フォルダのデータを読み込む" }); if (await b.count() && await b.first().isVisible()) await b.first().click(); await page.waitForTimeout(150); }
    throw new Error("開始画面が消えない"); };
  const waitSaved = page => page.waitForSelector("#saveState.saved", { timeout: 20000 }).catch(async e => { const info = await page.evaluate(() => ({ state: document.querySelector("#saveState").textContent, toasts: (window.__toasts || []).slice(-3), modal: (document.querySelector("#modalMsg") || {}).textContent || "" })).catch(() => ({})); throw new Error("保存済みにならない: " + JSON.stringify(info) + " / " + e.message.split("\n")[0]); });
  const setNotes = async (page, text) => { await page.click('.tab[data-tab="input"]'); const ta = page.locator('textarea[data-path="notes"]'); await ta.fill(text); await ta.dispatchEvent("change"); };
  const solve = async page => { await page.click('.tab[data-tab="calc"]'); await page.click("#btnSolve"); await page.waitForFunction(() => /必須条件の違反|計算しません|解なし|見つかりません/.test(document.querySelector("#calcLog").textContent), null, { timeout: 120000 }); return page.locator("#calcLog").textContent(); };

  await test("編集→保存→閉じる→再読込: メモが自動保存でフォルダに書かれ、開き直して同じフォルダを選ぶと同じ値で再開", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    await start(page); await waitSaved(page);
    assert.ok(fs.names("A").includes("202611"), "接続直後の自動保存で月フォルダができる");
    await setNotes(page, "通し試験のメモ"); await page.waitForSelector("#saveState.dirty"); await waitSaved(page);
    const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.strictEqual(saved.month.notes, "通し試験のメモ", "保存された JSON にメモが入る");
    ({ ctx, page } = await reopen(ctx, fs));
    await start(page); await page.click('.tab[data-tab="input"]'); // 開き直して同じフォルダを選ぶと、フォルダのデータから再開する（ブラウザ内の保存は無い）
    assert.strictEqual(await page.locator('textarea[data-path="notes"]').inputValue(), "通し試験のメモ", "フォルダのデータから再開"); await page.waitForSelector("#saveState.saved");
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
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    fs.write("A/plugins/rules/local.e2e.rule.js", Buffer.from(PLUGIN, "utf8"));
    await start(page); await waitSaved(page);
    assert.ok(await page.evaluate(() => !!T.RULE_BY_ID["local.e2e.rule"]), "フォルダのプラグインが読み込まれる");
    const log1 = await solve(page); assert.ok(/必須条件の違反 0 件/.test(log1), "プラグインありで計算できる: " + log1.slice(-120)); await waitSaved(page);
    await page.waitForFunction(() => window.__toasts.some(t => /勤務表 v1 を追加/.test(t)), null, { timeout: 10000 }); // 保存の知らせに版の追加が出る
    const docx = fs.read("A/202611/202611_roster_v1_draft.docx"), html = fs.text("A/202611/202611_report_v1_draft.html");
    assert.ok(docx && docx.length > 1000 && docx.slice(0, 2).toString("latin1") === "PK", "勤務表 docx は空でなく zip（" + (docx ? docx.length : 0) + " bytes）"); assert.ok(html && /<html/i.test(html) && /通し試験の規則|local\.e2e\.rule/.test(html), "説明資料に規則が出る");
    const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.ok(saved.month.plugins_used.includes("local.e2e.rule") && saved.result.plugins.length === 1, "使ったプラグインが記録される"); assert.strictEqual(saved.month.doc_versions.length, 1, "版の記録が月データに入る");
    fs.remove("A/plugins/rules/local.e2e.rule.js"); ({ ctx, page } = await reopen(ctx, fs));
    await start(page); await page.waitForSelector("#saveState");
    assert.ok(await page.evaluate(() => !T.RULE_BY_ID["local.e2e.rule"]), "外したプラグインは登録されない");
    const log2 = await solve(page); assert.ok(/計算しません/.test(log2) && /local\.e2e\.rule/.test(log2), "欠落を知らせて計算しない: " + log2.slice(-200));
    await page.click('.tab[data-tab="result"]'); assert.ok(/検算未完了/.test(await page.locator(".status-strip").textContent()), "結果画面も検算未完了と示す");
    await setNotes(page, "欠落したまま編集");
    await page.click("#btnHeaderSave"); // 「今すぐ保存」（帳票の生成を通る経路）
    // メモ欄から直接ボタンを押す（欄の blur の change で保存状態が描き直されてもクリックが消えないこと）
    try { await page.waitForFunction(() => window.__toasts.some(t => /プラグインが足りない/.test(t)), null, { timeout: 15000 }); }
    catch (e) { const dbg = await page.evaluate(async () => { const A = T.app; let r = "?"; try { r = await Promise.race([A.saveToFolder(), new Promise(res => setTimeout(() => res("timeout"), 3000))]); } catch (e2) { r = "err " + e2.message; } return { toasts: window.__toasts.slice(-6), dir: A.dirHandle && A.dirHandle.name, dirty: A.isDirty(), solving: A.solving, switching: A.switching, busy: !!A.runSolve.busy, save: document.querySelector("#saveState").textContent, btn: !!document.querySelector("#btnHeaderSave"), saveResult: r, toastsAfter: window.__toasts.slice(-3) }; });
      throw new Error("帳票を止めた知らせが無い: " + JSON.stringify(dbg)); } await waitSaved(page);
    const files2 = fs.names("A/202611"); assert.ok(!files2.some(n => /_v2_/.test(n)), "保存しても勤務表・説明資料の新しい版は出ない: " + files2.join(","));
    const saved2 = JSON.parse(fs.text("A/202611/202611_data.json")); assert.strictEqual(saved2.month.notes, "欠落したまま編集", "月データは保存される"); assert.strictEqual(saved2.month.doc_versions.length, 1, "版は増えない");
    // 直接ダウンロード（ヘッダーの「勤務表 docx」「説明資料 HTML」）も止まる
    await page.evaluate(() => { window.__downloads = []; T.app.download = name => { window.__downloads.push(name); }; });
    await page.click("#btnDocx"); await page.click("#btnReportHtml"); await page.waitForTimeout(1500);
    const dl = await page.evaluate(() => ({ downloads: window.__downloads, alerts: (window.__alerts || []).slice(-2) })); assert.deepStrictEqual(dl.downloads, [], "ダウンロードしない"); assert.ok(dl.alerts.length === 2 && dl.alerts.every(a => /プラグインが足りない/.test(a)), "理由を知らせる: " + JSON.stringify(dl.alerts));
    // 表題を変えても「書き直しました」とは言わず、版も増えない
    const n3 = await page.evaluate(() => window.__toasts.length); await page.selectOption("#docLabel", { index: 1 }).catch(async () => { await page.fill("#docLabel", "確定版"); await page.dispatchEvent("#docLabel", "change"); }); await waitSaved(page); await page.waitForTimeout(500);
    const t3 = await page.evaluate(n => window.__toasts.slice(n), n3); assert.ok(!t3.some(t => /書き直しました/.test(t)), "成功と言い切らない: " + JSON.stringify(t3)); assert.ok(!fs.names("A/202611").some(n => /_v2_/.test(n)), "版は増えない");
    await ctx.close();
  });
  await test("共有用書き出し: 名簿を含めない書き出しは役割名＋番号・役割・目安だけ", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx);
    await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="build"]'); await page.click("#btnExportProfile");
    await page.waitForFunction(() => window.__toasts.some(t => /profile_/.test(t)), null, { timeout: 10000 });
    const names = fs.names("A").filter(n => /^profile_.*\.json$/.test(n)); assert.strictEqual(names.length, 1, "フォルダに書かれる: " + names.join(","));
    const prof = JSON.parse(fs.text("A/" + names[0])), origNames = await page.evaluate(() => T.app.state.rules.doctors.map(d => d.name));
    assert.strictEqual(prof.toban_profile.roster, "placeholder"); const txt = JSON.stringify(prof);
    for (const n of origNames) assert.ok(!txt.includes(n), `${n} は残らない`);
    for (const d of prof.doctors) { assert.ok(/^(主担当|副担当|若手|部長)\d+$/.test(d.name), d.name); assert.ok(Object.keys(d).every(k => ["name", "team", "quota", "share"].includes(k)), Object.keys(d).join(",")); }
    assert.ok(!("years" in prof.doctors[0]));
    await ctx.close();
  });
  await test("外部 JSON の読込: 読んだ直後は未保存で、自動保存でフォルダに書かれ、開き直しても読んだ内容で再開（旧内容に戻らない）", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    await start(page); await waitSaved(page); await setNotes(page, "old-on-folder"); await waitSaved(page);
    const cur = JSON.parse(fs.text("A/202611/202611_data.json")); cur.month.notes = "imported-new"; cur.saved_at = "2026-01-01T00:00:00.000Z";
    await page.click('.tab[data-tab="input"]'); await page.setInputFiles("#fileLoadJson", { name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(cur), "utf8") });
    await page.waitForFunction(() => /imported-new/.test((document.querySelector('textarea[data-path="notes"]') || {}).value || ""), null, { timeout: 10000 });
    assert.ok(/未保存/.test(await page.locator("#saveState").textContent()), "読んだ直後は未保存");
    // 自動保存は、フォルダ側の別の版との競合確認を出す（自動統合の元が無い）。読んだ内容で上書きする、を選ぶ
    let answered = false; for (let i = 0; i < 100 && !answered; i++) { const b = page.locator("#modalBtns button", { hasText: "このブラウザの状態で上書きする" }); if (await b.count() && await b.first().isVisible()) { await b.first().click(); answered = true; break; } await page.waitForTimeout(150); }
    assert.ok(answered, "競合の確認が出る（外部の JSON はフォルダに対する変更として扱う）");
    await waitSaved(page); assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "imported-new", "確認のあと自動保存でフォルダに書かれる");
    ({ ctx, page } = await reopen(ctx, fs)); await start(page); await page.click('.tab[data-tab="input"]');
    assert.strictEqual(await page.locator('textarea[data-path="notes"]').inputValue(), "imported-new", "開き直しても読んだ内容");
    await ctx.close();
  });
  await test("JSON のダウンロード: 自動保存の前に押してもフォルダへの未保存は残り、自動保存でフォルダに書かれ、開き直しても新しい内容", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx);
    await start(page); await waitSaved(page); await setNotes(page, "old-on-folder"); await waitSaved(page);
    await page.evaluate(() => { window.__downloads = []; T.app.download = name => { window.__downloads.push(name); }; });
    await setNotes(page, "new-after-download"); await page.click('.tab[data-tab="settings"]');
    await page.evaluate(() => { const b = document.querySelector("#btnSaveJson"); for (let d = b.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true; const pane = b.closest("[data-modepane]"); if (pane) document.querySelector(`[data-setmode="${pane.dataset.modepane}"]`).click(); }); // 管理者向けの折りたたみ・モードを開く
    await page.click("#btnSaveJson");
    assert.deepStrictEqual(await page.evaluate(() => window.__downloads), ["202611_data.json"], "ダウンロードは行われる"); assert.ok(/未保存/.test(await page.locator("#saveState").textContent()), "フォルダへは未保存のまま");
    await waitSaved(page); assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "new-after-download", "自動保存でフォルダに書かれる");
    ({ ctx, page } = await reopen(ctx, fs)); await start(page); await page.click('.tab[data-tab="input"]'); assert.strictEqual(await page.locator('textarea[data-path="notes"]').inputValue(), "new-after-download", "開き直しても新しい内容（旧内容に戻らない）");
    await ctx.close();
  });
  await test("医師別カレンダー: 規則を「なし」にしていて選択肢に無い値（有給）は「（現在は使わない値）」として残り、他の欄の変更で消えない。空欄を選んだときだけ消える", async () => {
    const { ctx } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    const who = await page.evaluate(() => { const A = T.app, n = A.names()[0]; A.state.rules.rule_states.days_off_min = "off"; A.state.month.unavailable_other = [{ name: n, day: 5, part: "allday", paid: true }]; A.state.ui.doctor = 0; A.renderDoctor(); return n; });
    const sel = page.locator('#doctorPane [data-cal="unavail"][data-d="5"]'); assert.strictEqual(await sel.inputValue(), "paid", "選択肢に無い値でも表示される"); assert.ok(/現在は使わない値/.test(await sel.locator("option:checked").textContent()), "使わない値と分かる");
    await page.check('#doctorPane [data-cal="wish"][data-d="6"]'); // 別の欄を変えると読み戻しが走る
    assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.unavailable_other), [{ name: who, day: 5, part: "allday", paid: true }], "有給が残る"); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.wishes.night_on[T.app.names()[0]]), [6]);
    await page.selectOption('#doctorPane [data-cal="unavail"][data-d="5"]', ""); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.unavailable_other), [], "空欄を選んだときだけ消える");
    await ctx.close();
  });
  await test("医師別カレンダー: 日勤と期間責任者の両方を固定した日は、他の欄を変えても期間責任者の固定が消えない。欄で期間責任者を外したときだけ消える", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    const who = await page.evaluate(() => { const A = T.app, R = A.state.rules, charge = (T.normalizeRolesOf(R).find(r => (r.refs || []).includes("charge")) || {}).id; const n = A.names().find(x => (R.doctors.find(d => d.name === x) || {}).team === charge); A.state.ui.doctor = A.names().indexOf(n);
      const fx = A.state.month.fixed; fx.day ||= {}; fx.weekend_charge ||= {}; fx.day[7] = n; fx.weekend_charge[7] = n; fx.weekend_charge[8] = n; A.renderDoctor(); return n; }); // 2026-11-07（土）: 日勤と期間責任者の両方、8 日（日）: 期間責任者だけ
    assert.ok(who, "期間責任者の役割の人がいる"); const sel7 = page.locator('#doctorPane [data-cal="fixed"][data-shown][data-d="7"]'), sel8 = page.locator('#doctorPane [data-cal="fixed"][data-shown][data-d="8"]');
    assert.strictEqual(await sel7.inputValue(), "day", "両方固定の日は日勤を出す"); assert.strictEqual(await sel8.inputValue(), "charge");
    await page.check('#doctorPane [data-cal="wish"][data-d="10"]'); // 別の欄を変えると読み戻しが走る
    let fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.day[7], who, "日勤の固定が残る"); assert.strictEqual(fx.weekend_charge[7], who, "期間責任者の固定も残る"); assert.strictEqual(fx.weekend_charge[8], who);
    await page.selectOption('#doctorPane [data-cal="fixed"][data-shown][data-d="8"]', ""); fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.weekend_charge[8], undefined, "欄で外した日だけ消える"); assert.strictEqual(fx.weekend_charge[7], who); assert.strictEqual(fx.day[7], who);
    await page.selectOption('#doctorPane [data-cal="fixed"][data-shown][data-d="7"]', "charge"); fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.day[7], undefined, "日勤から期間責任者へ変えれば日勤の固定は消える"); assert.strictEqual(fx.weekend_charge[7], who);
    await page.selectOption('#doctorPane [data-cal="fixed"][data-shown][data-d="7"]', ""); fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.weekend_charge[7], undefined, "日勤→期間責任者→未指定: 同じ画面で付けた固定も外せる"); assert.strictEqual(fx.day[7], undefined);
    await page.selectOption('#doctorPane [data-cal="fixed"][data-shown][data-d="14"]', "charge"); fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.weekend_charge[14], who, "未指定→期間責任者"); // 11 月 14 日（土）
    await page.selectOption('#doctorPane [data-cal="fixed"][data-shown][data-d="14"]', ""); fx = await page.evaluate(() => T.app.state.month.fixed); assert.strictEqual(fx.weekend_charge[14], undefined, "未指定→期間責任者→未指定: 再描画を挟まなくても消える");
    await waitSaved(page); const savedFx = JSON.parse(fs.text("A/202611/202611_data.json")).month.fixed; assert.strictEqual((savedFx.weekend_charge || {})[14], undefined, "保存した JSON にも残らない"); assert.strictEqual((savedFx.weekend_charge || {})[7], undefined);
    await ctx.close();
  });
  await test("名簿から外した人: 隠れた規則（「なし」）の個人別の条件も設定から外れ、共有用の書き出しに氏名も条件も残らない", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]');
    const who = await page.evaluate(() => { const A = T.app, R = A.state.rules, n = R.doctors[R.doctors.length - 1].name; R.friday_night_min = { [n]: 2 }; R.rule_states.friday_night_min = "off"; R.weekend_dayshift_wish = [n]; A.renderSettings(); window.confirm = () => true; return n; });
    const n0 = await page.evaluate(() => T.app.state.rules.doctors.length); await page.click(`#doctorTable tr[data-i="${n0 - 1}"] [data-act="del"]`);
    const after = await page.evaluate(() => ({ n: T.app.state.rules.doctors.length, fri: T.app.state.rules.friday_night_min, wk: T.app.state.rules.weekend_dayshift_wish, order: T.app.state.rules.name_order }));
    assert.strictEqual(after.n, n0 - 1, "名簿から外れる"); assert.deepStrictEqual(after.fri, {}, "隠れた欄の条件も外れる"); assert.deepStrictEqual(after.wk, []); assert.ok(!after.order.includes(who));
    await page.click('[data-setmode="build"]'); await page.click("#btnExportProfile"); await page.waitForFunction(() => window.__toasts.some(t => /profile_/.test(t)), null, { timeout: 10000 });
    const names = fs.names("A").filter(n => /^profile_.*\.json$/.test(n)); assert.strictEqual(names.length, 1); const txt = fs.text("A/" + names[0]); assert.ok(!txt.includes(who), "共有用の書き出しに外した人の氏名が残らない"); assert.deepStrictEqual(JSON.parse(txt).friday_night_min || {}, {});
    await waitSaved(page); assert.ok(!JSON.stringify(JSON.parse(fs.text("A/202611/202611_data.json")).rules).includes(who), "保存した設定にも残らない");
    await ctx.close();
  });
  await test("改名と固定配置: 固定配置の画面を開いた後に設定タブで改名しても、入力タブへ戻ったときに固定が旧名へ戻らない（保存した JSON も新しい氏名）", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]');
    const info = await page.evaluate(() => { const A = T.app, R = A.state.rules, n = A.dutyNames()[0]; (A.state.month.fixed.night ||= {})[7] = n; A.save(); A.renderAll(); return { who: n, i: R.doctors.findIndex(d => d.name === n) }; });
    await page.click('.subnav .sub[data-sub="fixedPane"]'); assert.ok(await page.locator("#fixedPane").isVisible(), "固定配置の画面を開く");
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]');
    const inp = page.locator(`#doctorTable tr[data-i="${info.i}"] input[data-f="name"]`); await inp.fill("Review Z"); await inp.dispatchEvent("change");
    assert.strictEqual(await page.evaluate(() => T.app.state.month.fixed.night[7]), "Review Z", "改名の直後は新しい氏名");
    await page.click('.tab[data-tab="input"]'); assert.strictEqual(await page.evaluate(() => T.app.state.month.fixed.night[7]), "Review Z", "入力タブへ戻っても旧名へ戻らない");
    await page.click('.subnav .sub[data-sub="monthSettings"]'); assert.strictEqual(await page.evaluate(() => T.app.state.month.fixed.night[7]), "Review Z");
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.strictEqual(saved.month.fixed.night[7], "Review Z", "保存した JSON も新しい氏名"); assert.ok(!JSON.stringify(saved.month.fixed).includes(info.who), "旧名は固定に残らない");
    await ctx.close();
  });
  await test("月の読取り中の保存フォルダの変更: 読取りの間は断られ、A の 12 月は A のデータとして開く。B には何も書かれない", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    const novJ = JSON.parse(fs.text("A/202611/202611_data.json")); const dec = JSON.parse(JSON.stringify(novJ)); dec.month.year = 2026; dec.month.month = 12; dec.month.notes = "december-from-A"; dec.result = null; dec.saved_at = "2026-10-05T00:00:00.000Z"; delete dec.month.doc_versions;
    fs.write("A/202612/202612_data.json", Buffer.from(JSON.stringify(dec))); ({ ctx, page } = await reopen(ctx, fs)); await start(page); await waitSaved(page); // 開き直すと月の一覧に 12 月が出る
    let release; fs.gates = { "A/202612/202612_data.json": new Promise(r => { release = r; }) }; fs.waiting = 0;
    await page.selectOption("#monthSel", "202612"); for (let i = 0; i < 100 && !fs.waiting; i++) await page.waitForTimeout(50); assert.ok(fs.waiting > 0, "A の 12 月の読取りが待っている");
    await page.evaluate(() => localStorage.setItem("__e2e_folder", "B")); const n0 = await page.evaluate(() => window.__toasts.length);
    await page.evaluate(() => { const b = document.querySelector("#btnOpenFolder"); for (let d = b.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true; }); await page.click("#btnOpenFolder");
    await page.waitForFunction(n => window.__toasts.slice(n).some(t => /別の切り替え/.test(t)), n0, { timeout: 10000 }); assert.strictEqual(await page.locator("#folderBar b").textContent(), "A", "接続先は A のまま");
    fs.gates = {}; release(); await page.waitForFunction(() => +T.app.state.month.month === 12, null, { timeout: 10000 }); await waitSaved(page);
    const st = await page.evaluate(() => ({ folder: T.app.dirHandle && T.app.dirHandle.name, notes: T.app.state.month.notes, where: T.app.state.meta && T.app.state.meta.savedWhere, dirty: T.app.isDirty() }));
    assert.strictEqual(st.folder, "A"); assert.strictEqual(st.notes, "december-from-A"); assert.strictEqual(st.dirty, false); assert.ok(/A/.test(st.where || ""), "A の保存済み: " + st.where);
    assert.ok(!fs.names("B").length, "B には何も書かれない: " + fs.names("B").join(",")); assert.strictEqual(JSON.parse(fs.text("A/202612/202612_data.json")).month.notes, "december-from-A");
    // 読み終えた後なら保存フォルダを変更できる（空の B では未保存になり、自動保存で B に 12 月ができる）
    await page.click("#btnOpenFolder"); await page.waitForFunction(() => T.app.dirHandle && T.app.dirHandle.name === "B", null, { timeout: 10000 });
    for (let i = 0; i < 200 && !fs.names("B/202612").includes("202612_data.json"); i++) await page.waitForTimeout(100); // 空の B では未保存になり、自動保存（変更の 3 秒後）で書かれる
    assert.ok(fs.names("B/202612").includes("202612_data.json"), "B に 12 月が保存される: " + await page.locator("#saveState").textContent()); await waitSaved(page); assert.strictEqual(JSON.parse(fs.text("B/202612/202612_data.json")).month.notes, "december-from-A");
    await ctx.close();
  });
  const reveal = (page, sel) => page.evaluate(q => { const b = document.querySelector(q); for (let d = b.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true; }, sel); // 折りたたみの中のボタンを押せるようにする
  await test("起動時の自動の再接続: 前回のフォルダの照合を待つ間は保存フォルダを変更できず、別のフォルダに保存済みと表示しない", async () => {
    const { ctx, fs } = await newCtx(); const page1 = await newPage(ctx); await start(page1); await waitSaved(page1); await setNotes(page1, "from A"); await page1.waitForSelector("#saveState.dirty"); await waitSaved(page1);
    const b = JSON.parse(fs.text("A/202611/202611_data.json")); b.month.notes = "from B"; b.saved_at = "2026-10-09T00:00:00.000Z"; fs.write("B/202611/202611_data.json", Buffer.from(JSON.stringify(b)));
    let release; fs.gates = { "A/202611/202611_data.json": new Promise(r => { release = r; }) }; fs.waiting = 0;
    const page = await newPage(ctx, { noGate: true }); await page1.close(); // 同じ context で開き直す（前回のフォルダのハンドルと権限が残っている）
    for (let i = 0; i < 200 && !fs.waiting; i++) await page.waitForTimeout(50); assert.ok(fs.waiting > 0, "自動の再接続で A の 11 月の読取りが待っている"); assert.ok(await page.locator("#startGate").isHidden(), "開始画面は出ない");
    await page.evaluate(() => localStorage.setItem("__e2e_folder", "B")); const n0 = await page.evaluate(() => window.__toasts.length); await reveal(page, "#btnOpenFolder"); await page.click("#btnOpenFolder");
    await page.waitForFunction(n => window.__toasts.slice(n).some(t => /別の切り替え/.test(t)), n0, { timeout: 10000 }); fs.gates = {}; release();
    await page.waitForFunction(() => T.app.switching === 0, null, { timeout: 10000 }); await waitSaved(page);
    const st = await page.evaluate(() => ({ folder: T.app.dirHandle && T.app.dirHandle.name, notes: T.app.state.month.notes, where: T.app.state.meta && T.app.state.meta.savedWhere, dirty: T.app.isDirty() }));
    assert.strictEqual(st.folder, "A"); assert.strictEqual(st.notes, "from A"); assert.strictEqual(st.dirty, false); assert.ok(/A/.test(st.where || ""), st.where); assert.strictEqual(JSON.parse(fs.text("B/202611/202611_data.json")).month.notes, "from B", "B は変わらない");
    // 照合が終わった後なら変更でき、B のデータを B のものとして読む
    await page.click("#btnOpenFolder"); await page.waitForFunction(() => T.app.dirHandle && T.app.dirHandle.name === "B" && T.app.state.month.notes === "from B", null, { timeout: 10000 }); await waitSaved(page);
    assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "from A", "A は変わらない");
    await ctx.close();
  });
  await test("医師別カレンダー: 同じ日の日勤帯の不可と夜勤の「避」は、別の欄の編集で片方が消えない。欄を空にすると出していた不可だけが消え、残った「避」が欄に出る", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    const who = await page.evaluate(() => { const A = T.app, n = A.names()[0], m = A.state.month; m.unavailable_other = [{ name: n, day: 7, part: "day" }]; m.avoid = [{ name: n, day: 7, part: "night" }]; m.unavailable_night[n] = [12]; A.state.ui.doctor = 0; A.renderDoctor(); return n; }); // 11/7（土）
    const sel = page.locator('#doctorPane [data-cal="unavail"][data-d="7"]'); assert.strictEqual(await sel.inputValue(), "day", "不可を出す");
    await page.check('#doctorPane [data-cal="wish"][data-d="9"]');
    const both = m => ({ other: (m.unavailable_other || []).filter(u => +u.day === 7).map(u => u.part), avoid: (m.avoid || []).filter(u => +u.day === 7).map(u => u.part), night: (m.unavailable_night || {})[who] || [] });
    assert.deepStrictEqual(both(await page.evaluate(() => T.app.state.month)), { other: ["day"], avoid: ["night"], night: [12] }, "別の日の希望を変えても両方残る");
    await waitSaved(page); assert.deepStrictEqual(both(JSON.parse(fs.text("A/202611/202611_data.json")).month), { other: ["day"], avoid: ["night"], night: [12] }, "保存した JSON にも両方");
    ({ ctx, page } = await reopen(ctx, fs)); await start(page); assert.deepStrictEqual(both(await page.evaluate(() => T.app.state.month)), { other: ["day"], avoid: ["night"], night: [12] }, "開き直しても両方");
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]'); await page.evaluate(() => { T.app.state.ui.doctor = 0; T.app.renderDoctor(); });
    await page.selectOption('#doctorPane [data-cal="unavail"][data-d="7"]', ""); assert.deepStrictEqual(both(await page.evaluate(() => T.app.state.month)), { other: [], avoid: ["night"], night: [12] }, "欄を空にすると、出していた不可だけが消える");
    await page.waitForFunction(() => { const e = document.querySelector('#doctorPane [data-cal="unavail"][data-d="7"]'); return e && e.value === "avoid_night"; }, null, { timeout: 5000 }); // 残った条件が欄に出る
    await page.selectOption('#doctorPane [data-cal="unavail"][data-d="7"]', "night"); assert.deepStrictEqual(both(await page.evaluate(() => T.app.state.month)), { other: [], avoid: [], night: [7, 12] }, "出していた「避」を不可：夜勤に置き換える");
    await ctx.close();
  });
  await test("医師別カレンダー: 施設のプラグインが足した日ごとの欄で、いまの選択肢に無い値は「（現在は使わない値）」として残り、別の欄の編集で消えない。空欄を選んだときだけ消える", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    const who = await page.evaluate(() => { const A = T.app, n = A.names()[0]; T.calendarExt.register({ id: "local.e2e.cal", fields: [{ id: "review_kind", label: "区分", options: [["active", "有効"]] }] }); A.state.month.person_days = { review_kind: { [n]: { 7: "retired", 8: "active" } } }; A.state.ui.doctor = 0; A.renderDoctor(); return n; });
    const sel = page.locator('#doctorPane [data-cal="pfield"][data-id="review_kind"][data-d="7"]'); assert.strictEqual(await sel.inputValue(), "retired"); assert.ok(/現在は使わない値/.test(await sel.locator("option:checked").textContent()));
    await page.check('#doctorPane [data-cal="wish"][data-d="9"]'); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.person_days.review_kind), { [who]: { 7: "retired", 8: "active" } }, "別の欄を変えても残る");
    await waitSaved(page); assert.deepStrictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.person_days.review_kind, { [who]: { 7: "retired", 8: "active" } }, "保存した JSON にも残る");
    await page.selectOption('#doctorPane [data-cal="pfield"][data-id="review_kind"][data-d="7"]', ""); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.person_days.review_kind), { [who]: { 8: "active" } }, "空欄を選んだときだけ消える");
    await ctx.close();
  });
  await test("実行時に足した表示言語: 訳のプラグインのあるフォルダに接続すると言語の選択肢に出て選べる。その言語のないフォルダへ替えると選択肢から消え、表示は既定の言語に戻る", async () => {
    const { ctx, fs } = await newCtx(); fs.write("A/plugins/lang/fr.json", Buffer.from(JSON.stringify({ code: "fr", name: "Français", dow: ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"], date_locale: "fr-FR", list_sep: ", ", name_sep: ", ", ui: { "計算する": "Calculer" }, msg: {} })));
    const page = await newPage(ctx); await start(page); await waitSaved(page);
    const codes = () => page.evaluate(() => [...document.querySelectorAll("#langSel option")].map(o => o.value).sort());
    assert.deepStrictEqual(await page.evaluate(() => T.LANGS().map(x => x[0]).sort()), ["en", "fr", "ja"]); assert.deepStrictEqual(await codes(), ["en", "fr", "ja"], "ヘッダーの選択肢に出る");
    await page.selectOption("#langSel", "fr"); await page.waitForFunction(() => T.lang() === "fr" && document.querySelector("#btnSolve").textContent === "Calculer", null, { timeout: 10000 });
    await waitSaved(page); await page.evaluate(() => localStorage.setItem("__e2e_folder", "B")); await reveal(page, "#btnOpenFolder"); await page.click("#btnOpenFolder");
    await page.waitForFunction(() => T.app.dirHandle && T.app.dirHandle.name === "B" && T.lang() !== "fr", null, { timeout: 10000 });
    assert.deepStrictEqual(await codes(), ["en", "ja"], "その言語のないフォルダでは選択肢から消える"); assert.notStrictEqual(await page.locator("#btnSolve").textContent(), "Calculer"); assert.ok(["en", "ja"].includes(await page.locator("#langSel").inputValue()));
    await ctx.close();
  });
  await test("起動時の再接続の照合中の自動保存: 照合の読取りを待つ間にメモを変えて自動保存が済んだら、古い読取結果で画面を戻さない（画面・フォルダとも新しいメモ）", async () => {
    const { ctx, fs } = await newCtx(); const page1 = await newPage(ctx); await start(page1); await waitSaved(page1); await setNotes(page1, "old memo"); await page1.waitForSelector("#saveState.dirty"); await waitSaved(page1);
    let release; fs.gates = { "A/202611/202611_data.json": new Promise(r => { release = r; }) }; fs.waiting = 0;
    const page = await newPage(ctx, { noGate: true }); await page1.close(); for (let i = 0; i < 200 && !fs.waiting; i++) await page.waitForTimeout(50); assert.ok(fs.waiting > 0, "照合の読取りが待っている");
    await page.click('.tab[data-tab="input"]'); const ta = page.locator('textarea[data-path="notes"]'); await ta.fill("new memo saved during reconciliation"); await ta.press("Tab");
    for (let i = 0; i < 200 && JSON.parse(fs.text("A/202611/202611_data.json")).month.notes !== "new memo saved during reconciliation"; i++) await page.waitForTimeout(100); // 自動保存（変更の 3 秒後）
    assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "new memo saved during reconciliation", "待つ間の自動保存は済む");
    release(); await page.waitForFunction(() => T.app.switching === 0, null, { timeout: 10000 }); await page.waitForTimeout(300); await waitSaved(page);
    assert.strictEqual(await page.evaluate(() => T.app.state.month.notes), "new memo saved during reconciliation", "状態は新しいメモ"); assert.strictEqual(await page.locator('textarea[data-path="notes"]').inputValue(), "new memo saved during reconciliation", "画面も新しいメモ");
    assert.strictEqual(await page.evaluate(() => T.app.isDirty()), false); assert.strictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.notes, "new memo saved during reconciliation", "フォルダも新しいメモ");
    await ctx.close();
  });
  await test("施設の設定の言語が実行時の言語: ブラウザで言語を選んでいなければ、訳のプラグインを読んだ後・フォルダのデータを読んだ後に、その言語で表示する", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    const j = JSON.parse(fs.text("A/202611/202611_data.json")); j.rules.lang = "fr"; j.saved_at = "2026-10-09T00:00:00.000Z"; fs.write("A/202611/202611_data.json", Buffer.from(JSON.stringify(j)));
    fs.write("A/plugins/lang/fr.json", Buffer.from(JSON.stringify({ code: "fr", name: "Français", dow: ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"], date_locale: "fr-FR", list_sep: ", ", name_sep: ", ", ui: { "計算する": "Calculer" }, msg: {} })));
    ({ ctx, page } = await reopen(ctx, fs)); assert.strictEqual(await page.evaluate(() => { try { return localStorage.getItem("toban.lang"); } catch (e) { return "?"; } }), null, "ブラウザでは言語を選んでいない");
    await start(page); await page.waitForFunction(() => (T.app.state.rules || {}).lang === "fr" && T.lang() === "fr" && document.querySelector("#btnSolve").textContent === "Calculer", null, { timeout: 10000 });
    assert.strictEqual(await page.locator("#langSel").inputValue(), "fr", "ヘッダーの選択も施設の言語");
    await ctx.close();
  });
  await test("日の種別ごとの人数: 平日 2 名・休日 3 名の設定は、設定タブでほかの項目（職員の年数）を変えても 1 名に書き換わらない。保存・開き直しの後も同じ。数で持つ勤務帯の人数は欄で変えられる", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    const want = { day: { weekday: 2, off_days: 3 }, night: 1 };
    assert.ok(await page.evaluate(w => { const A = T.app, p = (T.PROFILES || []).find(x => (x.profile || {}).id === "two-shift"); if (!p) return false; const R = JSON.parse(JSON.stringify(p)); R.profile.positions = { work: { count: w } }; delete R.profile.id; T.fillDefaultRules(R); A.state.rules = R; A.state.month = A.blankMonth(2026, 11); delete A.state.month.profile_id; A.state.result = null; A.ensureMonth(A.state.month); A.save(); A.renderAll(); return true; }, want), "同梱の 2 交代のプロファイル");
    const counts = () => page.evaluate(() => { const A = T.app, P = new T.Problem(A.state.rules, A.state.month); return { wd: P.countOf([2, "day"]), off: P.countOf([7, "day"]), night: P.countOf([2, "night"]), raw: A.state.rules.profile.positions.work.count }; });
    assert.deepStrictEqual(await counts(), { wd: 2, off: 3, night: 1, raw: want });
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]'); const yrs = page.locator('#doctorTable tr[data-i="0"] input[data-f="years"]'); await yrs.fill("7"); await yrs.dispatchEvent("change");
    assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors[0].years), 7, "年数は変わる"); assert.deepStrictEqual(await counts(), { wd: 2, off: 3, night: 1, raw: want }, "人数は変わらない");
    await page.waitForSelector("#saveState.dirty"); await waitSaved(page); assert.deepStrictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).rules.profile.positions.work.count, want, "保存した JSON も同じ");
    ({ ctx, page } = await reopen(ctx, fs)); await start(page); assert.deepStrictEqual(await counts(), { wd: 2, off: 3, night: 1, raw: want }, "開き直しても同じ");
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="build"]'); assert.ok(/2.*3/.test(await page.locator('#shiftTbl [data-countkeep="count:day"]').textContent()), "値は見せる");
    const nightIn = page.locator('#shiftTbl input[data-count="night"]'); await nightIn.fill("2"); await nightIn.dispatchEvent("change"); assert.deepStrictEqual((await counts()).raw, { day: { weekday: 2, off_days: 3 }, night: 2 }, "数で持つ勤務帯は欄で変えられ、日の種別ごとの人数は残る");
    await ctx.close();
  });
  await test("役割の識別子の変更: 名簿・オンコールの必要人数の表（行と列）・固定「OC なし」が新しい識別子に揃い、人数は変わらない。保存・開き直しの後も同じ。表示名だけの変更では識別子は変わらない", async () => {
    let { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    const before = await page.evaluate(() => { const A = T.app, R = A.state.rules; R.oncall_requirement.I = { I: 0, Y: 2 }; (A.state.month.fixed.night_oc_none ||= {})[4] = ["I"]; A.save(); A.renderAll(); return { oc: JSON.parse(JSON.stringify(R.oncall_requirement)), n: R.doctors.filter(d => d.team === "I").length }; });
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="build"]');
    const idx = await page.evaluate(() => [...document.querySelectorAll("#profileBuilder input[data-rid]")].findIndex(x => x.value === "I")); assert.ok(idx >= 0); const lab = page.locator("#profileBuilder input[data-rlabel]").nth(idx);
    const lab0 = await lab.inputValue(); await lab.fill(lab0 + "（改）"); await lab.dispatchEvent("change"); assert.deepStrictEqual(await page.evaluate(() => T.app.state.rules.oncall_requirement), before.oc, "表示名だけの変更では表は変わらない"); assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors.filter(d => d.team === "I").length), before.n);
    const rid = page.locator("#profileBuilder input[data-rid]").nth(await page.evaluate(() => [...document.querySelectorAll("#profileBuilder input[data-rid]")].findIndex(x => x.value === "I"))); await rid.fill("Primary"); await rid.dispatchEvent("change");
    const ren = o => Object.fromEntries(Object.entries(o).map(([r, v]) => [r === "I" ? "Primary" : r, Object.fromEntries(Object.entries(v).map(([c, x]) => [c === "I" ? "Primary" : c, x]))])), want = ren(before.oc);
    const got = () => page.evaluate(() => { const A = T.app, R = A.state.rules; return { oc: R.oncall_requirement, n: R.doctors.filter(d => d.team === "Primary").length, old: R.doctors.filter(d => d.team === "I").length, none: A.state.month.fixed.night_oc_none[4], ids: T.normalizeRolesOf(R).map(r => r.id) }; });
    let g = await got(); assert.deepStrictEqual(g.oc, want, "必要人数の表は行・列とも新しい識別子、人数は同じ: " + JSON.stringify(g.oc) + " / " + JSON.stringify(want)); assert.strictEqual(g.n, before.n); assert.strictEqual(g.old, 0); assert.deepStrictEqual(g.none, ["Primary"]); assert.ok(g.ids.includes("Primary") && !g.ids.includes("I"));
    await page.waitForSelector("#saveState.dirty"); await waitSaved(page); const j = JSON.parse(fs.text("A/202611/202611_data.json")); assert.deepStrictEqual(j.rules.oncall_requirement, want, "保存した JSON も同じ"); assert.deepStrictEqual(j.month.fixed.night_oc_none["4"], ["Primary"]);
    ({ ctx, page } = await reopen(ctx, fs)); await start(page); g = await got(); assert.deepStrictEqual(g.oc, want, "開き直しても同じ"); assert.strictEqual(g.n, before.n);
    await ctx.close();
  });
  await test("改名の後の統合で「相手の設定を使う」: 名簿も月データも相手の氏名（改名の前）に揃い、本人の不可が外れない。保存した JSON まで確認", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const info = await page.evaluate(() => { const A = T.app, n = A.dutyNames()[0]; A.state.month.unavailable_night[n] = [5]; A.save(); return { who: n, i: A.state.rules.doctors.findIndex(d => d.name === n) }; }); await page.waitForSelector("#saveState.dirty"); await waitSaved(page);
    const th = JSON.parse(fs.text("A/202611/202611_data.json")); assert.deepStrictEqual(th.month.unavailable_night[info.who], [5]); th.rules.weights.target_deviation = 77; th.saved_at = "2099-01-01T00:00:00.000Z"; fs.write("A/202611/202611_data.json", Buffer.from(JSON.stringify(th))); // 相手は重みだけ変えて保存
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]'); const inp = page.locator(`#doctorTable tr[data-i="${info.i}"] input[data-f="name"]`); await inp.fill("Review Dr Z"); await inp.dispatchEvent("change");
    assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.unavailable_night["Review Dr Z"]), [5], "手元は新しい氏名");
    const btn = page.locator("#modalBtns button", { hasText: "相手の設定を使う" }); await btn.waitFor({ state: "visible", timeout: 20000 }); await btn.click(); await waitSaved(page);
    const j = JSON.parse(fs.text("A/202611/202611_data.json")); assert.ok(j.rules.doctors.some(d => d.name === info.who) && !j.rules.doctors.some(d => d.name === "Review Dr Z"), "名簿は相手の氏名"); assert.strictEqual(j.rules.weights.target_deviation, 77, "相手の設定");
    assert.deepStrictEqual(j.month.unavailable_night[info.who], [5], "不可は名簿の本人に付く"); assert.ok(!JSON.stringify(j.month).includes("Review Dr Z"), "新しい氏名は月データに残らない");
    assert.deepStrictEqual(await page.evaluate(n => T.app.state.month.unavailable_night[n], info.who), [5], "画面の状態も同じ");
    await ctx.close();
  });
  await test("改名の後の統合と計算結果: 相手が旧名のまま計算し直した新しい結果を採っても、結果の氏名は手元の名簿（新しい氏名）に揃い、検算の違反 0 で勤務表を出せる", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const asg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "data/js_assignment.json"), "utf8")), who = [].concat(asg["2:night"].work)[0];
    assert.strictEqual(await page.evaluate(a => { const A = T.app; A.state.result = { asg: a, status: "Optimal", seconds: 1, objective: 140, at: "2026-10-01T00:00:00.000Z", plugins: T.plugins.stamp(), build: T.BUILD_ID, input_sig: A.inputSig(), avoid_ref: null, base_asg: null }; A.save(); A.renderAll(); return T.check(new T.Problem(A.state.rules, A.state.month), a).V.length; }, asg), 0, "同梱の割当は違反 0");
    await page.waitForSelector("#saveState.dirty"); await page.click("#btnHeaderSave"); await waitSaved(page); assert.ok(fs.names("A/202611").some(n => /_roster_v1_/.test(n)), "勤務表 v1 が出る");
    const th = JSON.parse(fs.text("A/202611/202611_data.json")); th.result.at = "2099-01-01T00:00:00.000Z"; th.saved_at = "2099-01-01T00:00:01.000Z"; fs.write("A/202611/202611_data.json", Buffer.from(JSON.stringify(th))); // 相手は旧名のまま計算し直して保存（割当は同じ、計算の日時だけ新しい）
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]'); const i = await page.evaluate(n => T.app.state.rules.doctors.findIndex(d => d.name === n), who); const inp = page.locator(`#doctorTable tr[data-i="${i}"] input[data-f="name"]`); await inp.fill("Review Dr Z"); await inp.dispatchEvent("change");
    await page.waitForFunction(() => /2099/.test((T.app.state.result || {}).at || ""), null, { timeout: 20000 }); await waitSaved(page); // 自動保存の統合で相手の結果（新しい）を採る
    const st = await page.evaluate(() => { const A = T.app, txt = JSON.stringify(A.state.result), S = A.snapshot(new Date().toISOString()); return { z: txt.includes("Review Dr Z"), v: T.check(new T.Problem(A.state.rules, A.state.month), A.state.result.asg).V.length, stop: (A.outputCheck(S) || {}).stop || null }; });
    assert.ok(st.z, "結果の氏名は新しい氏名"); assert.ok(!JSON.stringify(await page.evaluate(() => T.app.state.result)).includes(JSON.stringify(who)), "旧名は結果に残らない"); assert.strictEqual(st.v, 0, "検算の違反 0"); assert.strictEqual(st.stop, null, "勤務表を出せる");
    const j = JSON.parse(fs.text("A/202611/202611_data.json")); assert.ok(JSON.stringify(j.result).includes("Review Dr Z") && !JSON.stringify(j.result).includes(JSON.stringify(who)), "保存した JSON の結果も新しい氏名"); assert.ok(j.rules.doctors.some(d => d.name === "Review Dr Z"));
    await ctx.close();
  });
  await test("固定配置の画面: 同じ役割の 2 人目の固定 OC は、別の日の編集で消えない（欄の横に名前を見せて保持）。欄を変えたときは、出していた人だけを置き換える", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const I = await page.evaluate(() => { const A = T.app, R = A.state.rules, ch = (T.normalizeRolesOf(R).find(r => (r.refs || []).includes("charge")) || {}).id, I = R.doctors.filter(d => d.team === ch).map(d => d.name); (A.state.month.fixed.night_oc ||= {})[7] = [I[0], I[1]]; A.save(); A.renderAll(); return I; });
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="fixedPane"]');
    assert.strictEqual(await page.locator('#fixedPane select[data-fx="nightI"][data-d="7"]').inputValue(), I[0], "欄には 1 人目"); assert.ok((await page.locator("#fixedPane").textContent()).includes("＋" + I[1]), "2 人目は欄の横に見せる");
    const w8 = await page.evaluate(() => T.app.dutyNames().find(n => !(T.app.state.month.fixed.night_oc[7] || []).includes(n))); await page.selectOption('#fixedPane select[data-fx="night"][data-d="8"]', w8);
    assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.fixed.night_oc[7]), [I[0], I[1]], "別の日の勤務者を変えても 2 人とも残る"); assert.strictEqual(await page.evaluate(() => [].concat(T.app.state.month.fixed.night[8])[0]), w8);
    await waitSaved(page); assert.deepStrictEqual(JSON.parse(fs.text("A/202611/202611_data.json")).month.fixed.night_oc["7"], [I[0], I[1]], "保存した JSON も 2 人");
    await page.selectOption('#fixedPane select[data-fx="nightI"][data-d="7"]', I[2]); assert.deepStrictEqual((await page.evaluate(() => T.app.state.month.fixed.night_oc[7])).slice().sort(), [I[1], I[2]].sort(), "欄を変えたら、出していた 1 人目だけを置き換える");
    await page.selectOption('#fixedPane select[data-fx="nightI"][data-d="7"]', ""); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.fixed.night_oc[7]), [I[1]], "欄を空にしたら、出していた人だけ外れる");
    const label = () => page.locator('#fixedPane [data-extras="night_oc:7"]').textContent(); assert.ok((await label()).includes(I[1]), "残った 2 人目は欄の横に出る");
    await page.selectOption('#fixedPane select[data-fx="nightI"][data-d="7"]', I[1]); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.fixed.night_oc[7]), [I[1]], "横に出ていた人を欄で選んでも 1 人のまま"); assert.strictEqual((await label()).trim(), "", "欄に出した人は横から消える");
    await page.selectOption('#fixedPane select[data-fx="nightI"][data-d="7"]', ""); assert.strictEqual(await page.evaluate(() => (T.app.state.month.fixed.night_oc || {})[7]), undefined, "空にすると OC は無くなる"); assert.strictEqual((await label()).trim(), "", "「＋名前」も残らない");
    await waitSaved(page); assert.strictEqual((JSON.parse(fs.text("A/202611/202611_data.json")).month.fixed.night_oc || {})["7"], undefined, "保存した JSON も空");
    await ctx.close();
  });
  await test("月別条件の人ごとの表: 一時的に配置禁止にした人の当月の目標（0 回）と累計は、別の欄の編集で消えない。当番に戻すと目標 0 回が効く", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const who = await page.evaluate(() => { const A = T.app, n = A.dutyNames()[2], m = A.state.month; m.targets[n] = 0; (m.history ||= {}).work_balance = Object.assign({}, m.history.work_balance, { [n]: 7 }); A.state.rules.doctors.find(d => d.name === n).duty = "never"; A.save(); A.renderAll(); return n; });
    await setNotes(page, "別の欄の編集"); const got = () => page.evaluate(n => ({ t: T.app.state.month.targets[n], b: (T.app.state.month.history.work_balance || {})[n] }), who);
    assert.deepStrictEqual(await got(), { t: 0, b: 7 }, "欄が出ていない人の値は残る"); await waitSaved(page); const j = JSON.parse(fs.text("A/202611/202611_data.json")); assert.strictEqual(j.month.targets[who], 0); assert.strictEqual(j.month.history.work_balance[who], 7); assert.strictEqual(j.month.notes, "別の欄の編集");
    assert.strictEqual(await page.evaluate(n => { const A = T.app; delete A.state.rules.doctors.find(d => d.name === n).duty; A.save(); A.renderAll(); return new T.Problem(A.state.rules, A.state.month).targets[n]; }, who), 0, "当番に戻すと目標 0 回が効く");
    await ctx.close();
  });
  await test("名簿の氏名を空にする: 名簿から外れず、元の氏名に戻って知らせる（不可日・隠れた個人の条件・改名の記録は不変）。空白だけでも同じ", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]');
    const who = await page.evaluate(() => { const A = T.app, R = A.state.rules, n = R.doctors[R.doctors.length - 1].name; R.friday_night_min = { [n]: 2 }; R.rule_states.friday_night_min = "off"; (A.state.month.unavailable_night[n] ||= []).push(9); A.renderSettings(); return n; });
    const n0 = await page.evaluate(() => T.app.state.rules.doctors.length), snap = () => page.evaluate(() => JSON.stringify([T.app.state.rules.doctors.map(d => d.name), T.app.state.rules.friday_night_min, T.app.state.month.unavailable_night, T.app.state.renames])); const before = await snap();
    for (const v of ["", "   "]) { const inp = page.locator(`#doctorTable tr[data-i="${n0 - 1}"] [data-f="name"]`); await inp.fill(v); await inp.dispatchEvent("change");
      assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors.length), n0, "名簿から消えない: " + JSON.stringify(v)); assert.strictEqual(await snap(), before, "名簿・条件・不可日・記録は不変: " + (await snap()) + " / " + before); assert.ok((await page.evaluate(() => window.__toasts.slice(-2).join("|"))).includes("空にできません"), "知らせる");
      assert.strictEqual(await page.locator(`#doctorTable tr[data-i="${n0 - 1}"] [data-f="name"]`).inputValue(), who, "欄も元の氏名に戻る"); }
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")); assert.ok(saved.rules.doctors.some(d => d.name === who), "保存した名簿にも残る"); assert.ok((saved.month.unavailable_night[who] || []).includes(9), "不可日も保存される");
    await ctx.close();
  });
  await test("職員別カレンダー: 日勤を行う日の設定を「休日だけ」に変えても、画面に出ない平日の日勤の固定と日勤希望は別の日の編集で消えない。設定を戻せば見える。欄を出している日を空にしたときだけ消える", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    const who = await page.evaluate(() => { const A = T.app, R = A.state.rules, n = A.dutyNames()[0]; A.state.ui.doctor = A.names().indexOf(n); R.rule_states.wish_day = "soft"; (R.profile ||= {}).shifts = [{ id: "day", label: "日勤", on: "all" }, { id: "night", label: "夜勤", on: "all" }]; T.fillDefaultRules(R);
      const m = A.state.month; (m.fixed.day ||= {})[2] = n; ((m.wishes ||= {}).day_on ||= {})[n] = [2]; (m.wishes.night_on ||= {})[n] = [3]; A.renderDoctor(); return n; }); // 2026-11-02（月）: 日勤の固定と日勤希望
    assert.strictEqual(await page.locator('#doctorPane [data-cal="fixed"][data-k="day"][data-d="2"]').inputValue(), "day", "毎日日勤のときは平日にも日勤の欄"); assert.ok(await page.locator('#doctorPane [data-cal="wishday"][data-d="2"]').isChecked());
    await page.evaluate(() => { const A = T.app; A.state.rules.profile.shifts[0].on = "off_days"; T.fillDefaultRules(A.state.rules); A.renderDoctor(); }); assert.strictEqual(await page.locator('#doctorPane [data-cal="fixed"][data-k="day"][data-d="2"]').count(), 0, "休日だけなら平日の日勤の欄は出ない"); assert.strictEqual(await page.locator('#doctorPane [data-cal="wishday"][data-d="2"]').count(), 0);
    await page.check('#doctorPane [data-cal="wish"][data-d="10"]'); // 別の日の夜勤希望を変える（読み戻しが走る）
    let st = await page.evaluate(() => ({ fd: T.app.state.month.fixed.day, wd: T.app.state.month.wishes.day_on, wn: T.app.state.month.wishes.night_on })); assert.strictEqual(st.fd[2], who, "出ていない日の日勤の固定が残る"); assert.deepStrictEqual(st.wd[who], [2], "出ていない日の日勤希望が残る"); assert.deepStrictEqual(st.wn[who], [3, 10]);
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")).month; assert.strictEqual(saved.fixed.day["2"], who, "保存した JSON にも残る"); assert.deepStrictEqual(saved.wishes.day_on[who], [2]);
    await page.evaluate(() => { const A = T.app; A.state.rules.profile.shifts[0].on = "all"; T.fillDefaultRules(A.state.rules); A.renderDoctor(); }); assert.strictEqual(await page.locator('#doctorPane [data-cal="fixed"][data-k="day"][data-d="2"]').inputValue(), "day", "設定を戻せば見える"); assert.ok(await page.locator('#doctorPane [data-cal="wishday"][data-d="2"]').isChecked());
    await page.selectOption('#doctorPane [data-cal="fixed"][data-k="day"][data-d="2"]', ""); await page.uncheck('#doctorPane [data-cal="wishday"][data-d="2"]'); st = await page.evaluate(() => ({ fd: T.app.state.month.fixed.day, wd: T.app.state.month.wishes.day_on })); assert.strictEqual(st.fd[2], undefined, "欄を出している日を空にすれば消える"); assert.strictEqual((st.wd || {})[who], undefined);
    await ctx.close();
  });
  await test("前月末の接続: 前月が複数名の配置（勤務者が配列）で当月が 1 名の配置でも、月別の設定で別の欄を変えたときに前月末の勤務者が消えない（保存した JSON まで）", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const [a, b] = await page.evaluate(() => { const A = T.app, ns = A.dutyNames(); A.state.month.prev_month = { last_days: [{ date: 30, night: [ns[0], ns[1]], night_oc: [] }, { date: 31, night: [ns[2], ns[3]], night_oc: [] }], last_weekend_charge: null, prev_weekend_charge: null }; A.save(); A.renderAll(); return [ns[0], ns[1]]; });
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="monthSettings"]');
    const cell = page.locator('#monthSettings tr[data-ld] input[data-f="night"][data-multi]').first(); assert.ok(await cell.count(), "複数名の欄で出す"); assert.ok((await cell.inputValue()).includes(a) && (await cell.inputValue()).includes(b), "両名が見える");
    const ta = page.locator('#monthSettings textarea[data-path="notes"], textarea[data-path="notes"]').first(); await ta.fill("prev-multi"); await ta.dispatchEvent("change"); // 別の欄を変える（読み戻しが走る）
    const ld = await page.evaluate(() => T.app.state.month.prev_month.last_days); assert.deepStrictEqual([].concat(ld.find(e => +e.date === 30).night), [a, b], "前月末の 2 名が残る"); assert.strictEqual(ld.length, 2);
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")).month.prev_month.last_days; assert.deepStrictEqual([].concat(saved.find(e => +e.date === 30).night), [a, b], "保存した JSON にも残る");
    await ctx.close();
  });
  await test("固定の印: 「固定をすべて消去」で印も消え、1 名の欄で固定を外した人の印も消える（保存した JSON まで）。後の割当で同じ人が同じ枠に入っても古い印は出ない", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const who = await page.evaluate(() => { const A = T.app, R = A.state.rules, n = A.dutyNames()[0]; (R.profile ||= {}).fixed_tags = ["研修"]; T.fillDefaultRules(R); const m = A.state.month; m.fixed.night[7] = n; m.fixed.night[9] = n; m.fixed_tags = { [`7:night|${n}`]: "研修", [`9:night|${n}`]: "会議" }; A.save(); A.renderAll(); return n; });
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="fixedPane"]');
    await page.selectOption('#fixedPane select[data-fx="night"][data-d="9"]', ""); let tags = await page.evaluate(() => T.app.state.month.fixed_tags); assert.strictEqual(tags[`9:night|${who}`], undefined, "1 名の欄で外した人の印は消える"); assert.strictEqual(tags[`7:night|${who}`], "研修", "ほかの印は残る");
    await page.evaluate(() => { window.confirm = () => true; }); await page.click('#fixedPane [data-act="fxClear"]'); tags = await page.evaluate(() => T.app.state.month.fixed_tags); assert.deepStrictEqual(tags, {}, "全消去で印も消える"); assert.deepStrictEqual(await page.evaluate(() => T.app.state.month.fixed.night), {});
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")).month; assert.deepStrictEqual(saved.fixed_tags || {}, {}, "保存した JSON にも印は残らない");
    assert.strictEqual(await page.evaluate(n => { const A = T.app; A.state.month.fixed_tags = { [`7:night|${n}`]: "古い印" }; const P = new T.Problem(A.state.rules, A.state.month); return P.nameWithTag([7, "night"], n); }, who), who, "固定に結び付かない印は表示に使わない");
    await ctx.close();
  });
  await test("ヘッダー経由の引き継ぎ: 保存フォルダの 12 月の名簿が [{}] のとき、翌年 1 月を「12 月のデータから引き継いで作成」しても採用せず知らせる（設定・月・保存した JSON は不変）", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const dec = JSON.parse(fs.text("A/202611/202611_data.json")); dec.month.year = 2026; dec.month.month = 12; dec.rules.doctors = [{}]; dec.saved_at = "2026-10-05T00:00:00Z"; fs.write("A/202612/202612_data.json", Buffer.from(JSON.stringify(dec)));
    const snap = () => page.evaluate(() => JSON.stringify([T.app.canon(T.app.state.rules), T.app.canon(T.app.state.month), T.app.state.meta])), before = await snap(), nov = fs.text("A/202611/202611_data.json"); // 画面の読み戻しが補う空値（allow_chief_duty: false・notes: null）は差にしない
    await page.evaluate(() => { const q = ["2027", "1"]; window.prompt = () => q.shift(); }); await page.selectOption("#monthSel", "__other__");
    const b = page.locator("#modalBtns button", { hasText: "引き継いで作成" }); await b.first().waitFor({ timeout: 10000 }); await b.first().click(); await page.waitForFunction(() => (window.__alerts || []).length > 0, null, { timeout: 10000 });
    assert.ok((await page.evaluate(() => window.__alerts.join("|"))).includes("作れません"), "知らせる"); assert.strictEqual(await snap(), before, "設定・月・同期の基準は不変"); assert.strictEqual(await page.evaluate(() => T.app.tag()), "202611");
    await page.waitForTimeout(1500); assert.strictEqual(fs.text("A/202611/202611_data.json"), nov, "11 月のファイルは不変"); assert.strictEqual(fs.text("A/202701/202701_data.json"), null, "1 月は作られない");
    await ctx.close();
  });
  await test("ヘッダーの「元に戻す」: 職員別カレンダーの不可日・希望の入力を新しい順に戻せる（職員を切り替えただけでは記録が増えない）。設定の変更も同じボタンで、月別条件のタブから戻せる。保存した JSON まで", async () => {
    const { ctx, fs } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="doctorPane"]');
    assert.ok(await page.locator("header #btnUndo").isVisible(), "ヘッダーにある"); assert.ok(await page.locator("#btnUndo").isDisabled(), "最初は押せない");
    const who = await page.evaluate(() => T.app.names()[T.app.state.ui.doctor]), un0 = await page.evaluate(n => JSON.stringify(T.app.state.month.unavailable_night[n] || []), who), wish0 = await page.evaluate(n => JSON.stringify((T.app.state.month.wishes.night_on || {})[n] || []), who);
    const d1 = await page.evaluate(n => { const m = T.app.state.month; for (let d = 9; d <= 20; d++) if ((T.app.dowOf(m.year, m.month, d) < 5) && !(m.holidays || []).includes(d) && !(m.unavailable_night[n] || []).includes(d) && !(m.unavailable_other || []).some(u => u.name === n && +u.day === d) && !(m.avoid || []).some(u => u.name === n && +(u.day ?? u.date) === d)) return d; }, who);
    await page.selectOption(`#doctorPane [data-cal="unavail"][data-d="${d1}"]`, "night"); assert.ok((await page.evaluate(n => T.app.state.month.unavailable_night[n], who)).includes(d1)); assert.ok(await page.locator("#btnUndo").isEnabled());
    assert.ok(/カレンダーの変更/.test(await page.locator("#undoNote").textContent()), "何を戻すかを出す");
    await page.check(`#doctorPane [data-cal="wish"][data-d="${d1 + 1}"]`); assert.ok(/あと 2 回/.test(await page.locator("#undoNote").textContent()));
    await page.click("#docNext"); await page.click("#docPrev"); assert.ok(/あと 2 回/.test(await page.locator("#undoNote").textContent()), "職員の切替は記録しない: " + await page.locator("#undoNote").textContent());
    await page.click("#btnUndo"); assert.strictEqual(await page.evaluate(n => JSON.stringify((T.app.state.month.wishes.night_on || {})[n] || []), who), wish0, "後に入れた希望が先に戻る"); assert.ok((await page.evaluate(n => T.app.state.month.unavailable_night[n], who)).includes(d1), "不可日はまだ残る");
    assert.strictEqual(await page.locator(`#doctorPane [data-cal="wish"][data-d="${d1 + 1}"]`).isChecked(), false, "画面も戻る");
    await page.click("#btnUndo"); assert.strictEqual(await page.evaluate(n => JSON.stringify(T.app.state.month.unavailable_night[n] || []), who), un0, "不可日が戻る"); assert.strictEqual(await page.locator(`#doctorPane [data-cal="unavail"][data-d="${d1}"]`).inputValue(), "", "欄も空に戻る"); assert.ok(await page.locator("#btnUndo").isDisabled());
    await waitSaved(page); const saved = JSON.parse(fs.text("A/202611/202611_data.json")).month; assert.strictEqual(JSON.stringify(saved.unavailable_night[who] || []), un0, "保存した JSON も元のまま"); assert.strictEqual(JSON.stringify((saved.wishes.night_on || {})[who] || []), wish0);
    await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]'); const w = page.locator("#weightsTable [data-w]").first(), key = await w.getAttribute("data-w"), w0 = await page.evaluate(k => T.app.state.rules.weights[k], key);
    await w.fill(String(w0 + 7)); await w.dispatchEvent("change"); assert.strictEqual(await page.evaluate(k => T.app.state.rules.weights[k], key), w0 + 7); await page.click('.tab[data-tab="input"]'); assert.ok(await page.locator("#btnUndo").isEnabled(), "設定の変更も月別条件のタブから戻せる");
    await page.click("#btnUndo"); assert.strictEqual(await page.evaluate(k => T.app.state.rules.weights[k], key), w0);
    await ctx.close();
  });
  await test("当月の下限・上限: 月の設定の表で人ごとに入れられ、計算の入力になる（入れた範囲が必須）。保存・開き直しで残り、「下限・上限を消す」で消える。ヘッダーの「元に戻す」でも戻る", async () => {
    const { ctx, fs } = await newCtx(); let page = await newPage(ctx); await start(page); await waitSaved(page);
    await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="monthSettings"]');
    const [a, b] = await page.evaluate(() => T.app.workNames().filter(n => { const P = new T.Problem(T.app.state.rules, T.app.state.month); return !P.isExempt(n); }).slice(0, 2));
    const sig0 = await page.evaluate(() => T.app.inputSig());
    const cmax = page.locator(`#monthSettings [data-cmax="${a}"]`), cmin = page.locator(`#monthSettings [data-cmin="${b}"]`); assert.ok(await cmax.count() && await cmin.count(), "下限・上限の行がある");
    await cmax.fill("2"); await cmax.dispatchEvent("change"); await page.locator(`#monthSettings [data-cmin="${b}"]`).fill("3"); await page.locator(`#monthSettings [data-cmin="${b}"]`).dispatchEvent("change");
    let st = await page.evaluate(() => ({ min: T.app.state.month.count_min, max: T.app.state.month.count_max, sig: T.app.inputSig() })); assert.deepStrictEqual(st.max, { [a]: 2 }); assert.deepStrictEqual(st.min, { [b]: 3 }); assert.notStrictEqual(st.sig, sig0, "計算の入力が変わる");
    assert.deepStrictEqual(await page.evaluate(([x, y]) => { const P = new T.Problem(T.app.state.rules, T.app.state.month); return [P.countHi(x), P.countLo(y)]; }, [a, b]), [2, 3], "入れた値が必須の範囲になる");
    await waitSaved(page); let saved = JSON.parse(fs.text("A/202611/202611_data.json")).month; assert.deepStrictEqual([saved.count_max, saved.count_min], [{ [a]: 2 }, { [b]: 3 }], "保存した JSON に入る");
    const re = await reopen(ctx, fs), ctx2 = re.ctx; page = re.page; await start(page); await page.click('.tab[data-tab="input"]'); await page.click('.subnav .sub[data-sub="monthSettings"]');
    assert.strictEqual(await page.locator(`#monthSettings [data-cmax="${a}"]`).inputValue(), "2", "開き直しても欄に出る"); assert.strictEqual(await page.locator(`#monthSettings [data-cmin="${b}"]`).inputValue(), "3");
    await page.click("#btnClearLimits"); st = await page.evaluate(() => ({ min: T.app.state.month.count_min, max: T.app.state.month.count_max })); assert.deepStrictEqual([st.min, st.max], [{}, {}], "「下限・上限を消す」で消える");
    await page.click("#btnUndo"); st = await page.evaluate(() => ({ min: T.app.state.month.count_min, max: T.app.state.month.count_max })); assert.deepStrictEqual([st.max, st.min], [{ [a]: 2 }, { [b]: 3 }], "ヘッダーの「元に戻す」で戻る");
    await waitSaved(page); saved = JSON.parse(fs.text("A/202611/202611_data.json")).month; assert.deepStrictEqual([saved.count_max, saved.count_min], [{ [a]: 2 }, { [b]: 3 }]);
    await ctx2.close();
  });
  await test("結果の職員別カレンダーの休みの日数: 検算と同じ数え方（OC だけの日は休み。明けの扱いは設定に従う）", async () => {
    const { ctx } = await newCtx(); const page = await newPage(ctx); await start(page); await waitSaved(page);
    const asg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "data/js_assignment.json"), "utf8"));
    const want = await page.evaluate(a => { const A = T.app; A.state.rules.rule_states.days_off_min = "soft"; T.fillDefaultRules(A.state.rules); A.state.result = { asg: a, status: "Optimal", seconds: 1, objective: 0, at: "2026-10-01T00:00:00.000Z", plugins: T.plugins.stamp(), build: T.BUILD_ID, input_sig: A.inputSig() }; A.save(); A.renderAll();
      const P = new T.Problem(A.state.rules, A.state.month), cc = T.rules.checkCtx(P, new T.Asg(P, a), "check", () => { }); return Object.fromEntries(P.dutyNames.map(n => [n, { off: cc.offDays(n).length, oc: Object.values(a).filter(v => (v.oc || []).includes(n)).length, work: Object.values(a).filter(v => [].concat(v.work || []).includes(n)).length }])); }, asg);
    await page.click('.tab[data-tab="resultCal"]'); await page.waitForSelector(".doccal");
    const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".doccal h4")].map(h => { const t = h.textContent, m = t.match(/休み (\d+) 日/); return [t.split("　")[0].trim(), m ? +m[1] : null]; })));
    const names = Object.keys(want).filter(n => shown[n] !== undefined && shown[n] !== null); assert.ok(names.length >= 5, "休みの日数が出ている: " + JSON.stringify(shown).slice(0, 200));
    for (const n of names) assert.strictEqual(shown[n], want[n].off, `${n}: 検算と同じ休みの日数（OC ${want[n].oc} 回・勤務 ${want[n].work} 回）`); assert.ok(names.some(n => want[n].oc > 0), "OC に入っている人がいる");
    await ctx.close();
  });
  for (const field of ["notes", "holidays", "quota"]) await test(`計算完了時に編集中の ${field} を確定し、古い計算結果を採用せず入力・以前の結果・同期基準を保つ`, async () => {
    const { ctx } = await newCtx(); const page = await newPage(ctx); await start(page, "フォルダなしで続ける");
    try {
      await page.evaluate(() => {
        const A = T.app, ns = ["Synthetic Alpha", "Synthetic Beta"], R = { profile: { id: "synthetic-pending-input", roles: [{ id: "S", label: "Staff" }], calendar: { holidays: "none", closure: [] }, shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] }, doctors: ns.map(name => ({ name, team: "S", quota: 15 })), name_order: ns, weights: {}, rule_states: {} };
        T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off"; R.rule_states.quota_target = "soft";
        Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11, holidays: [], notes: "original" }, R), result: { asg: {}, status: "Optimal", at: "synthetic-old" }, meta: { savedAt: "synthetic-old" } });
        A.clearUndo(); A.renderAll(); A.highs = {}; window.__oldSolveState = JSON.stringify([A.state.result, A.state.meta]); window.__solveFolderSaves = 0; A.saveToFolder = async () => { window.__solveFolderSaves++; };
        T.solveWithAvoidRef = async P => { window.__solveEntered = true; return new Promise(resolve => { window.__finishSolve = () => resolve({ status: "Optimal", seconds: 0.1, objective: 0, vars: 1, cons: 1, asg: Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: ns[i % 2], oc: [] }])) }); }); };
      });
      await page.click('.tab[data-tab="calc"]'); await page.click("#btnSolve"); await page.waitForFunction(() => window.__solveEntered);
      const pane = field === "quota" ? "settings" : "input";
      await page.click(`.tab[data-tab="${pane}"]`);
      if (field === "quota") await page.click('[data-setmode="daily"]');
      const selector = field === "quota" ? '#doctorTable tr[data-i="0"] [data-f="quota"]' : `[data-path="${field}"]`;
      const value = field === "quota" ? "14" : field === "holidays" ? "3, 4" : "typed during solve";
      const input = page.locator(selector); await input.fill(value); // blur/change は起こさず、編集中に計算を終える
      assert.ok(await input.evaluate(el => document.activeElement === el), "入力欄にフォーカスが残っている");
      await page.evaluate(() => window.__finishSolve()); await page.waitForFunction(() => !T.app.solving);
      const st = await page.evaluate(f => ({ value: f === "quota" ? T.app.state.rules.doctors[0].quota : T.app.state.month[f], kept: JSON.stringify([T.app.state.result, T.app.state.meta]) === window.__oldSolveState, saves: window.__solveFolderSaves, log: document.querySelector("#calcLog").textContent }), field);
      assert.deepStrictEqual(st.value, field === "quota" ? 14 : field === "holidays" ? [3, 4] : value);
      assert.strictEqual(st.kept, true); assert.strictEqual(st.saves, 0); assert.ok(/この結果は採用しません/.test(st.log)); assert.ok(await page.locator(`#${pane}`).isVisible(), "入力画面から自動遷移しない");
      await page.click('.tab[data-tab="calc"]'); await page.click(`.tab[data-tab="${pane}"]`); assert.strictEqual(await page.locator(selector).inputValue(), field === "holidays" ? "3, 4" : value, "描き直しても編集中の値が残る");
      await page.click("#btnUndo");
      const undone = await page.evaluate(f => f === "quota" ? T.app.state.rules.doctors[0].quota : T.app.state.month[f], field);
      assert.deepStrictEqual(undone, field === "quota" ? 15 : field === "holidays" ? [] : "original", "採用直前に確定した入力も通常の Undo で戻せる");
    } finally { await ctx.close(); }
  });
  await test("最後の職員を削除しても起動・Undo・再追加できる（空名簿の保存と再読込）", async () => {
    const { ctx } = await newCtx(); const page = await newPage(ctx); await start(page, "フォルダなしで続ける");
    try {
      await page.evaluate(() => { const A = T.app; while (A.state.rules.doctors.length > 1) A.removeDoctor(A.state.rules.doctors.length - 1); A.refreshNameOrder(A.state.rules); A.clearUndo(); A.renderAll(); window.confirm = () => true; });
      const name = await page.evaluate(() => T.app.state.rules.doctors[0].name);
      await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]');
      await page.click('#doctorTable tr[data-i="0"] [data-act="del"]');
      assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors.length), 0);
      assert.ok((await page.locator('#doctorPane').textContent()).includes("名簿が空"));
      await page.click('#btnUndo');
      assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors[0].name), name);
      await page.click('#doctorTable tr[data-i="0"] [data-act="del"]');
      await page.reload(); await page.waitForSelector('#startGate:not([hidden])'); await start(page, "フォルダなしで続ける");
      assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors.length), 0);
      assert.ok((await page.locator('#doctorPane').textContent()).includes("名簿が空"));
      await page.click('.tab[data-tab="settings"]'); await page.click('[data-setmode="daily"]'); await page.click('#settings [data-act="add"]');
      assert.strictEqual(await page.evaluate(() => T.app.state.rules.doctors.length), 1);
      assert.ok(await page.locator('#doctorPane [data-cal="duty"]').count() > 0);
      assert.strictEqual(await page.evaluate(() => document.querySelector('#doctorPane').dataset.doctor), await page.evaluate(() => T.app.state.rules.doctors[0].name));
    } finally { await ctx.close(); }
  });
  closing = true; await browser.close(); srv.close();
  if (fails) { console.log(`実ブラウザの通し試験: ${fails} 件失敗`); process.exit(1); } console.log(`実ブラウザの通し試験 ${passed} 本 OK`);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });
