// 当直表アプリ（画面）: 計算（HiGHS を Web Worker で実行、進捗と中止、解なし診断）・結果の表示・当直表 docx と説明資料 HTML のダウンロード
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const state = A.state;

  // ---------- 計算 ----------
  // HiGHS を Web Worker（別スレッド）で動かす。計算中に画面が固まらず、ブラウザの「応答なし」警告も出ない。
  // Worker を作れない環境では従来どおり画面内（同期）で計算する
  function makeHighsWorker() {
    const src = document.getElementById("highsSrc")?.textContent || "";
    if (!src || typeof Worker === "undefined") throw new Error("Worker を使えません");
    const boot = "\nself.onmessage = async (e) => { const m = e.data; try { if (m.type === 'init') { self._h = await Module({ wasmBinary: m.wasm, print: () => {}, printErr: () => {} }); postMessage({ id: m.id, ok: true }); return; } const sol = self._h.solve(m.text, m.opts); postMessage({ id: m.id, sol }); } catch (err) { postMessage({ id: m.id, err: String((err && err.message) || err) }); } };";
    const url = URL.createObjectURL(new Blob([src + boot], { type: "text/javascript" }));
    const w = new Worker(url);
    const pending = new Map(); let seq = 0;
    const failAll = msg => { for (const p of pending.values()) p.reject(new Error(msg)); pending.clear(); };
    w.onmessage = ev => { const d = ev.data || {}; const p = pending.get(d.id); if (!p) return; pending.delete(d.id); if (d.err) p.reject(new Error(d.err)); else p.resolve(d.sol ?? d.ok); };
    w.onerror = ev => failAll((ev && ev.message) || T.t("Worker でエラー"));
    const call = msg => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage(Object.assign({ id }, msg)); });
    return { isWorker: true, init: () => call({ type: "init", wasm: T.b64ToBytes(T.WASM_B64) }), solve: (text, opts) => call({ type: "solve", text, opts }), terminate: () => { try { w.terminate(); } catch (e) { } failAll("中止しました"); } };
  }
  async function ensureHighs() {
    if (A.highs) return A.highs;
    $("#calcLog").textContent += T.t("計算エンジンを読み込み中…") + "\n"; await new Promise(r => setTimeout(r, 30));
    try { const hw = makeHighsWorker(); await hw.init(); A.highs = hw; }
    catch (e) {
      $("#calcLog").textContent += T.t("（別スレッドを使えない環境のため画面内で計算します。計算中はブラウザが「ページが応答しません」と表示することがありますが、そのまま待ってください）") + "\n";
      A.highs = await Module({ wasmBinary: T.b64ToBytes(T.WASM_B64), print: () => { }, printErr: () => { } });
    }
    return A.highs;
  }

  // 計算・診断の間は A.solving を立てる（プラグインの読み直し・月の切替・フォルダの読み直しを受け付けない。app-folder.js / app-settings.js）
  // 計算中に接続したフォルダのプラグインは後始末で読む（読み終わるまで busy のままなので次の計算は始まらない）
  async function runSolve() { if (runSolve.busy) return A.toast(T.t("計算中です")); if (A.switching) return A.toast(T.t("切り替えの処理中です。終わってからもう一度押してください")); runSolve.busy = true; A.solving = true;
    try { await runSolveCore(); }
    finally { A.solving = false; try { await A.loadPendingPlugins(); } catch (e) { A.toast(T.t("フォルダのプラグインを読めませんでした: {err}", { err: e && e.message || e })); } runSolve.busy = false; $("#btnSolve").disabled = false; } }
  async function runSolveCore() {
    A.readAll();
    const log = s => { $("#calcLog").textContent += s + "\n"; };
    $("#calcLog").textContent = "";
    const useBase = !!($("#useBase").checked && state.result && state.result.asg);
    // 「最小変更」の重みは今回の計算にだけ使う（設定の重みには残さない）
    const rulesForRun = useBase ? Object.assign({}, state.rules, { weights: Object.assign({}, state.rules.weights, { base_change: +$("#baseWeight").value || 30 }) }) : state.rules;
    let P;
    try { P = new T.Problem(rulesForRun, state.month); } catch (e) { log(T.t("入力の読み取りに失敗: {e}", { e })); return; }
    // プラグインが欠けた・読めない状態では、規則が黙って落ちるので計算しない。この判定は規則ごとの入力チェックとは別口（プラグインの lint が例外を出しても判定できる）
    const BLOCKING = ["LINT_PLUGIN_MISSING", "LINT_PLUGIN_ERROR", "LINT_PLUGIN_STALE", "LINT_PLUGIN_HOOK"];
    let blocking; try { blocking = T.lintPlugins(P); } catch (e) { log(T.t("入力チェックでエラー: {e}", { e })); log(T.t("入力チェックが完了しないため計算しません。設定タブの管理者向けでプラグインの読み込み状況を確かめ、直らなければ作成者に知らせてください")); return; }
    if (blocking.length) { log(T.t("施設のプラグインが足りない、または読めないため計算しません:")); blocking.forEach(x => log(`● ${x.msg}\n   → ${x.hint}`)); return; }
    // 入力チェックが途中で失敗したら計算しない（集めかけの指摘が消えたまま進めない）
    let lint; try { lint = T.lint(P).filter(x => !BLOCKING.includes(x.code)); } catch (e) { log(T.t("入力チェックでエラー: {e}", { e })); log(T.t("入力チェックが完了しないため計算しません。設定タブの管理者向けでプラグインの読み込み状況を確かめ、直らなければ作成者に知らせてください")); return; }
    if (lint.length) { log(T.t("入力に矛盾の疑いが {n} 件あります（計算は続けます）:", { n: lint.length })); lint.forEach(x => log(`● ${x.msg}\n   → ${x.hint}`)); log(""); }
    const runSig = A.inputSig(), runGen = T.plugins.generation(); // 計算中に月や設定、読み込んでいるプラグインが変わったら、この結果は採用しない
    $("#btnSolve").disabled = true;
    await ensureHighs();
    const timeLimit = +$("#timeLimit").value || 180;
    log(T.t("計算中（上限 {s} 秒）…", { s: timeLimit }));
    await new Promise(r => setTimeout(r, 30));
    // 進捗表示と中止（Worker で計算している間は画面が動く）
    const t0 = Date.now(); $("#btnSolve").disabled = true; $("#btnCancel").hidden = !A.highs.isWorker;
    const prog = setInterval(() => { $("#calcStatus").textContent = T.t(A.highs.isWorker ? "計算中… {s} 秒経過（上限 {max} 秒。画面は操作できます）" : "計算中… {s} 秒経過（上限 {max} 秒）", { s: Math.round((Date.now() - t0) / 1000), max: timeLimit }); }, 500);
    const done = () => { clearInterval(prog); $("#calcStatus").textContent = ""; $("#btnSolve").disabled = false; $("#btnCancel").hidden = true; };
    const baseAsg = useBase ? JSON.parse(JSON.stringify(state.result.asg)) : null, markChanges = !!(useBase && $("#markChanges").checked);
    let res;
    try { res = await T.solveWithAvoidRef(P, A.highs, { timeLimit, base: baseAsg }); }
    catch (e) { done(); log(/中止/.test(String(e.message)) ? T.t("計算を中止しました。もう一度「計算する」を押すと最初からやり直します") : T.t("計算を続けられませんでした: {e}。もう一度「計算する」を押すと最初からやり直します", { e: e.message })); A.highs = null; return; }
    done();
    if (A.inputSig() !== runSig) { log(T.t("計算中に月または設定が変わったため、この結果は採用しません。もう一度「計算する」を押してください")); return; }
    if (T.plugins.generation() !== runGen) { log(T.t("計算中にプラグインが読み直されたため、この結果は採用しません（計算した規則と検算する規則が別になります）。もう一度「計算する」を押してください")); return; }
    if (res.avoidRef) log(T.t("参照解（避けたい日を無視）: {list}（{s} 秒）。本計算ではこの回数を基準にします", { list: Object.entries(res.avoidRef).map(([n, c]) => T.t("{n} {c}回", { n, c })).join(T.listSep()), s: (res.refSeconds || 0).toFixed(1) }));
    log(T.t("状態 {st}、{s} 秒、変数 {v}、制約 {c}", { st: res.status, s: res.seconds.toFixed(1), v: res.vars, c: res.cons }));
    if (!res.asg && res.status !== "Infeasible") { // 時間切れなどで整数解が見つからなかった（解なしと証明されたわけではない）
      log(T.t("時間内に解が見つかりませんでした（{st}）。必須条件が両立しないとは限りません。上限時間を延ばすか、規則を減らして（特に減点の規則を「なし」にして）再計算してください", { st: res.status })); return; }
    if (!res.asg) {
      log(T.t("解なし。必須条件が両立しません。衝突している条件を診断します（各20秒）…"));
      await new Promise(r => setTimeout(r, 30));
      // 診断の進み具合（いま試している条件・何件目か・経過時間）を表示する。中止もできる
      const d0 = Date.now(); let dcur = T.t("準備中"); $("#btnSolve").disabled = true; $("#btnCancel").hidden = !A.highs.isWorker;
      const dshow = () => { $("#calcStatus").textContent = T.t(A.highs && A.highs.isWorker ? "診断中… {cur}　{s} 秒経過（画面は操作できます）" : "診断中… {cur}　{s} 秒経過", { cur: dcur, s: Math.round((Date.now() - d0) / 1000) }); };
      const dprog = setInterval(dshow, 500); dshow();
      const ddone = () => { clearInterval(dprog); $("#calcStatus").textContent = ""; $("#btnSolve").disabled = false; $("#btnCancel").hidden = true; };
      let diag; try { diag = await T.diagnose(P, A.highs, 20, pr => { dcur = T.t("「{label}」を外して試行中（{step}/{total}）", { label: T.t(pr.label), step: pr.step, total: pr.total }) + (pr.sub ? T.t("　絞り込み {sub}", { sub: pr.sub }) : ""); dshow(); }); } catch (e) { ddone(); log(T.t("診断を中止しました")); A.highs = null; return; }
      ddone(); log(T.t("診断 {s} 秒", { s: Math.round((Date.now() - d0) / 1000) }));
      if (!diag.length) log(T.t("- 単一の条件を外しても解なし。複数の条件が同時に衝突しています。上の「入力に矛盾の疑い」から順に直してください。"));
      for (const d of diag) {
        if (d.undecided) { log(T.t("- 「{label}」を外しても時間内に判定できず（解なしとも解ありとも言えません）", { label: T.t(d.label) })); continue; }
        log(T.t("- 「{label}」を外すと解あり", { label: T.t(d.label) }) + d.note);
        if (d.items && d.items.length) d.items.forEach(it => log(T.t("   ● {label} を外すと解あり", { label: it.label }) + `\n      → ${T.term(it.hint, state.rules)}`));
        else if ((T.RULE_DEFS.find(r => r.relax === d.key) || {}).diagnoseHint) log("      → " + T.t(T.RULE_DEFS.find(r => r.relax === d.key).diagnoseHint)); // プラグインが持つ直し方
      }
      log(T.t("最も上に出た項目から1つずつ直して再計算してください。例外（許容差など）を広げる場合は作成責任者の承認を得てください。"));
      return;
    }
    state.month.plugins_used = T.plugins.ruleIds().filter(id => T.ruleState(state.rules, id) !== "off"); // プラグインの規則のうち使ったもの（無い環境で開いたときの入力チェック用）
    state.result = { asg: res.asg, status: res.status, seconds: res.seconds, objective: res.objective, at: new Date().toISOString(), rules_version: state.rules.rules_version, avoid_ref: res.avoidRef || null, base_asg: baseAsg, mark_changes: markChanges, plugins: T.plugins.stamp(), build: T.BUILD_ID, input_sig: A.inputSig(), gap: +((state.rules.solver || {}).mip_rel_gap ?? 0) || 0 }; // gap: 実際に使った許容差（0 なら計算時の入力での最適を証明） // input_sig: 計算時の入力（月＋設定）の署名。結果画面で「いまの入力で計算した結果か」を示す（plugins_used を書いた後の値。runSig との一致は上で確認済み） // plugins: 実行時に読んだプラグインの名前と中身の印（あとで同じ規則で計算したか確かめる用）
    A.save();
    let rep; try { rep = T.buildReport(P, res.asg, { status: res.status, seconds: res.seconds, avoidRef: res.avoidRef, baseAsg: markChanges ? baseAsg : null }); } catch (e) { log(T.t("結果の検算・表示でエラーが起きました: {e}。設定（名簿・専門業務の必要人数）を確認してください", { e: e && e.message || e })); return; }
    log(T.t("必須条件の違反 {n} 件", { n: rep.V.length }) + (rep.W && rep.W.length ? T.t("、固定指定により許容した条件 {n} 件（要確認）", { n: rep.W.length }) : "") + T.t("。「3-1 結果」タブを開いてください。"));
    renderResult();
    A.showTab("result");
    // 計算が成功したら自動保存（未接続ならフォルダの接続を求めてから保存）。保護区間（計算・採用・ブラウザ内保存）はここまで: 接続で読むプラグインは以後の計算に使う。
    // 計算中に接続したフォルダのプラグインは保存より前に読み切る（保存は result.plugins と今の印が違えば勤務表を出さず、再計算を促す）
    A.solving = false;
    try { await A.loadPendingPlugins(); } catch (e) { log(T.t("フォルダのプラグインを読めませんでした: {err}", { err: e && e.message || e })); }
    if (!A.dirHandle) A.toast(T.t("計算結果を保存します。フォルダを接続してください"));
    await A.saveToFolder();
    if (!A.dirHandle) A.toast(T.t("計算結果はまだブラウザ内にしかありません。ヘッダーの「接続して保存」で保存してください"));
  }

  // ---------- 結果 ----------
  let resSub = "resMain", calDoc = "__all__"; // 結果タブで表示中の画面／カレンダーで表示中の医師
  function renderResult(sub) { // sub: "resMain" / "resCal"（省略時はいま表示中の画面のまま）
    if (sub) resSub = sub;
    const r = state.result;
    if (!r || !r.asg) { $("#result").innerHTML = `<p>${esc(T.t("まだ計算していません。"))}</p>`; return; }
    let P; try { P = new T.Problem(state.rules, state.month); } catch (e) { $("#result").innerHTML = `<p>${esc(T.t("入力に問題があります: {e}", { e }))}</p>`; return; }
    let rep; try { rep = T.buildReport(P, r.asg, { status: r.status, seconds: r.seconds, avoidRef: r.avoid_ref, baseAsg: r.mark_changes ? r.base_asg : null }); } catch (e) { $("#result").innerHTML = `<p class="ng">${esc(T.t("結果の検算・表示でエラーが起きました: {e}。設定（名簿・専門業務の必要人数）を確認するか、再計算してください", { e: e && e.message || e }))}</p>`; return; }
    const vers = state.month.doc_versions || [];
    const mainHtml = statusStrip(r, rep, P) + `<p class="note">${esc(T.t("計算日時 {at}　この結果は入力を変えても保持されます。入力を変えた場合は再計算してください。", { at: r.at ? new Date(r.at).toLocaleString(T.dateLocale()) : "" }))}</p>` + (vers.length ? `<p class="note">${esc(T.t("書き出した版: {list}", { list: vers.map(v => T.t("v{ver}（{label}、{at}）", { ver: v.ver, label: T.t(v.label || ""), at: new Date(v.at).toLocaleString(T.dateLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })).join(T.listSep()) }))}</p>` : "") + rep.sections.map(s => `<section id="${s.id}"><h3>${esc(s.title)}</h3>${s.html}</section>`).join("");
    // 結果は2画面（ヘッダーのタブ 3-1 結果／3-2 医師別カレンダー で切り替える。どちらも #result の中）
    $("#result").innerHTML = `<div id="resMain"${resSub === "resMain" ? "" : " hidden"}>${mainHtml}</div><div id="resCal"${resSub === "resCal" ? "" : " hidden"}><section id="docCal"></section></div>`;
    try { renderDocCal(P, r.asg); } catch (e) { const b = $("#docCal"); if (b) b.innerHTML = ""; }
  }
  // 結果の状態の 1 行（採用の判断に要る別々の情報をまとめて出す）: 保存の状態／計算時の入力と同じか／計算後にプラグインが変わっていないか／いまの設定での検算（違反・固定指定による許容）／最適性（証明済みか時間切れか）
  function statusStrip(r, rep, P) {
    const items = [];
    items.push(A.isDirty() ? ["warn", T.t("未保存の変更あり")] : ["ok", T.t("保存済み")]);
    if (!r.input_sig) items.push(["", T.t("計算時の入力: 記録なし（旧形式の結果）")]);
    else items.push(r.input_sig === A.inputSig() ? ["ok", T.t("いまの入力で計算した結果")] : ["warn", T.t("計算後に入力が変わっています（再計算が必要）")]);
    { const now = JSON.stringify(T.plugins && T.plugins.stamp ? T.plugins.stamp() : []), res = Array.isArray(r.plugins) ? JSON.stringify(r.plugins) : null; if (res !== null && res !== now) items.push(["warn", T.t("計算後にプラグインが変わっています（再計算が必要）")]); }
    // 検算は、プラグインが欠けた・読めない・変換に失敗した状態では「未完了」（登録済みの規則だけの違反数を添える。緑にはしない）
    let pl = null; try { pl = T.lintPlugins(P).filter(x => ["LINT_PLUGIN_MISSING", "LINT_PLUGIN_ERROR", "LINT_PLUGIN_STALE", "LINT_PLUGIN_HOOK"].includes(x.code)); } catch (e) { pl = null; }
    if (!pl || pl.length) items.push(["ng", T.t("検算未完了: プラグインが足りない・読めない・変換に失敗（設定タブの管理者向けを確認）") + (rep.V.length ? T.t("。登録済みの規則では違反 {n} 件", { n: rep.V.length }) : "")]);
    else items.push(rep.V.length ? ["ng", T.t("いまの設定での検算: 違反 {n} 件", { n: rep.V.length })] : ["ok", T.t("いまの設定での検算: 違反なし")]);
    if (rep.W && rep.W.length) items.push(["warn", T.t("固定指定により許容 {n} 件（要確認）", { n: rep.W.length })]);
    // 最適性は「計算時の入力に対する solver の判定」。許容差を緩めた Optimal は厳密な最適とは限らない。記録の無い旧形式は判定だけ
    if (r.status !== "Optimal") items.push(["warn", T.t("計算時のソルバー判定: {st}（時間内に見つかった最良の解）", { st: r.status || "" })]);
    else if (r.gap === undefined) items.push(["", T.t("計算時のソルバー判定: Optimal（許容差の記録なし）")]);
    else if (r.gap > 0) items.push(["warn", T.t("計算時のソルバー判定: Optimal（許容差 {g}%。厳密な最適とは限らない）", { g: Math.round(r.gap * 10000) / 100 })]);
    else items.push(["ok", T.t("計算時のソルバー判定: Optimal（許容差 0。計算時の入力での最適）")]);
    return `<p class="status-strip">${items.map(([c, t]) => `<span class="${c}">${esc(t)}</span>`).join("")}</p>`;
  }
  // 医師別の当番カレンダー（結果タブの先頭。日勤・夜勤=赤系、OC=黄。外来・病棟番・外勤・不在は午前／午後を添えて淡色で表示）

  function renderDocCal(P, asg) {
    const box = $("#docCal"); if (!box) return;
    const ext = T.calendarExt ? T.calendarExt.merged(P.rules) : {}, AS = ext.symbol ? new T.Asg(P, asg) : null; // 施設のプラグインの記号（勤務表の様式と同じ）
    const symOf = (n, d) => { if (!AS) return ""; try { return T.calendarExt.symbolHtml(ext.symbol(P, AS, n, d)); } catch (e) { return ""; } };
    const docs = P.names.slice(); // 名簿の全員（医師別カレンダーと同じ並び。当番に入らない予備の役割なども日中の業務を確認できるように含める）
    if (calDoc !== "__all__" && !docs.includes(calDoc)) calDoc = "__all__"; // 最初は全員を並べた一覧
    const DK = ["outpatient", "ward", "external", "absent"];
    const dutyKind = (n, d, pt) => { const it = P.dutyItems(n, d, pt, DK)[0]; return it ? it.kind : ""; };
    const dtag = (kind, pre) => `<div class="dc-duty dc-${kind}">${pre}${esc(T.kindLabel(kind))}</div>`;
    const one = n => {
      const first = (P.dow(1) + 1) % 7; let cnt = { day: 0, night: 0, oc: 0, ake: 0, off: 0 }, cells = [];
      const nightOf = d => d < 1 ? P.prevWorked([d, "night"], n) : [].concat((asg[`${d}:night`] || {}).work || []).includes(n); // 前日の夜勤（明け）
      for (let i = 0; i < first; i++) cells.push('<td class="empty"></td>');
      for (let d = 1; d <= P.N; d++) {
        // 枠の中は上から 午前・午後・夜間 の3段（位置を固定）。日勤・日勤OC は午前〜午後の2段ぶち抜き
        const slot = k => { const a = asg[`${d}:${k}`]; if (!a) return ""; if ([].concat(a.work || []).includes(n)) { cnt[k]++; return `<div class="dc-${k}">${esc(P.shiftLabel(k))}</div>`; } if ((a.oc || []).includes(n)) { cnt.oc++; return `<div class="dc-oc">${esc(T.t(k === "day" ? "日勤OC" : "夜間OC"))}</div>`; } return ""; };
        let dayTag = slot("day"); const nightTag = slot("night"), am = dutyKind(n, d, "am"), pm = dutyKind(n, d, "pm");
        // 勤務の無い日: 前日が夜勤なら「明」、有給の印があれば「有給」。休みの日数も数える（明けを休みに数えない施設では明けは休みに入れない）
        if (!dayTag && !nightTag) { const ake = nightOf(d - 1), paid = ((P.paidDays || {})[n] || new Set()).has(d);
          if (ake) { cnt.ake++; dayTag = `<div class="dc-ake">${esc(T.t("明"))}</div>`; } else if (paid) dayTag = `<div class="dc-paid">${esc(T.t("有給"))}</div>`;
          if (!ake || P.akeIsOff) cnt.off++; }
        const sym = symOf(n, d); // 施設の記号があれば、日勤・夜勤の帯の代わりにそれを出す（数え方はそのまま）
        const upper = sym ? `<div class="dc-r dc-r2"><div class="dc-sym">${sym}</div></div>` : dayTag && !am && !pm ? `<div class="dc-r dc-r2">${dayTag}</div>` : `<div class="dc-r">${dayTag}${am ? dtag(am, "午前 ") : ""}</div><div class="dc-r">${dayTag}${pm ? dtag(pm, "午後 ") : ""}</div>`;
        const wd = (first + d - 1) % 7, cls = [wd === 0 || P.holidaysExtra.has(d) ? "sun" : wd === 6 ? "sat" : "", dayTag || nightTag ? "on" : ""].join(" ");
        const head = ext.dayHead ? [...(P.dayFlags[d] || []).filter(id => T.dayFlags.activeFor(P.rules).some(f => f.id === id)).map(id => `<span class="calflag on">${esc(T.dayFlags.labelOf(P.rules, id))}</span>`), P.dayNote(d) ? `<span class="calnote">${esc(P.dayNote(d))}</span>` : ""].join("") : "";
        cells.push(`<td class="${cls}"><div class="dnum">${d}${P.holidaysExtra.has(d) ? `<small>${esc(T.t("祝"))}</small>` : ""}</div>${head ? `<div class="calhead">${head}</div>` : ""}<div class="dc-slots">${upper}<div class="dc-r">${sym ? "" : nightTag}</div></div></td>`);
      }
      while (cells.length % 7) cells.push('<td class="empty"></td>');
      const rows = []; for (let i = 0; i < cells.length; i += 7) rows.push("<tr>" + cells.slice(i, i + 7).join("") + "</tr>");
      const offOn = P.state("days_off_min") !== "off", ocOn = P.state("oncall") !== "off";
      const sum = [`${esc(P.shiftLabel("day"))} ${cnt.day}`, `${esc(P.shiftLabel("night"))} ${cnt.night}`].concat(ocOn ? [`OC ${cnt.oc}`] : []).concat(cnt.ake ? [`${esc(T.t("明"))} ${cnt.ake}`] : []).concat(offOn ? [esc(T.t("休み {n} 日（決まった日数 {t}）", { n: cnt.off, t: P.offTarget(n) }))] : []).join("・");
      return `<div class="doccal"><h4>${esc(n)}　<small>${sum}</small></h4><table class="calendar dccal"><tr><th class="sun">${esc(T.dowLabel(6))}</th>${[0, 1, 2, 3, 4].map(i => `<th>${esc(T.dowLabel(i))}</th>`).join("")}<th class="sat">${esc(T.dowLabel(5))}</th></tr>${rows.join("")}</table></div>`;
    };
    const opts = `<option value="__all__"${calDoc === "__all__" ? " selected" : ""}>${esc(T.t("全員を並べる"))}</option>` + docs.map(n => `<option value="${esc(n)}"${n === calDoc ? " selected" : ""}>${esc(n)}</option>`).join("");
    // 凡例は施設で使うものだけ（オンコール・日中の業務・明け・有給）
    const usesDuty = P.names.some(n => { for (let d = 1; d <= P.N; d++) if (dutyKind(n, d, "am") || dutyKind(n, d, "pm")) return true; return false; });
    const leg = [`<span class="dc-day">${esc(P.shiftLabel("day"))}</span>`, `<span class="dc-night">${esc(P.shiftLabel("night"))}</span>`]
      .concat(P.state("oncall") !== "off" ? [`<span class="dc-oc">OC</span>`] : [])
      .concat(usesDuty ? DK.map(k => `<span class="dc-duty dc-${k}">${esc(T.kindLabel(k))}</span>`) : [])
      .concat(!P.akeIsOff || P.isHard("shift_sequence") ? [`<span class="dc-ake">${esc(T.t("明"))}</span>`] : [])
      .concat(Object.keys(P.paidDays || {}).length ? [`<span class="dc-paid">${esc(T.t("有給"))}</span>`] : [])
      .concat(ext.legend ? (() => { try { return ext.legend(P).map(([sy, lb]) => `<span class="calleg">${T.calendarExt.symbolHtml(sy)} ${esc(lb)}</span>`); } catch (e) { return []; } })() : []).join(""); // 施設の記号の凡例
    box.innerHTML = `<h3><span class="printonly">${esc(T.t("{y}年{m}月", { y: P.year, m: P.month }))}　</span>${esc(T.t("結果：{person}別の当番カレンダー"))} <small class="note">${esc(T.t("（表示のみ。入力は「1 月別条件」の{person}別カレンダー）"))}</small></h3><div class="docnav"><button id="dcPrev">◀ ${esc(T.t("前の{person}"))}</button><select id="dcSel">${opts}</select><button id="dcNext">${esc(T.t("次の{person}"))} ▶</button><span class="dclegend">${leg}</span></div><div class="${calDoc === "__all__" ? "doccal-all" : ""}">${(calDoc === "__all__" ? docs : [calDoc]).map(one).join("")}</div>`;
    const go = v => { calDoc = v; renderDocCal(P, asg); };
    $("#dcSel").onchange = e => go(e.target.value);
    const step = k => { const i = docs.indexOf(calDoc); go(i < 0 ? docs[k > 0 ? 0 : docs.length - 1] : docs[(i + k + docs.length) % docs.length]); }; // 一覧からは「次」で先頭、「前」で末尾の医師へ
    $("#dcPrev").onclick = () => step(-1); $("#dcNext").onclick = () => step(1);
  }
  function reportHtml(P, label, S = state) { // 完成した HTML の組み立ては report.js（試験が完成形を見られるように）。S は月・設定・結果の組（保存では写しを渡す）
    const r = S.result; return T.reportHtml(P, r.asg, { status: r.status, seconds: r.seconds, avoidRef: r.avoid_ref, baseAsg: r.mark_changes ? r.base_asg : null }, { label: label || S.month.doc_label, notes: S.month.notes });
  }
  async function downloadDocx() {
    if (!state.result || !state.result.asg) return alert("先に計算してください");
    const P = new T.Problem(state.rules, state.month);
    const vers = state.month.doc_versions || [], label = $("#docLabel").value || "確認版";
    const last = vers[vers.length - 1], cur = last && last.sig === A.versionSig(label) ? last : null; // 保存済みの版と同じ内容のときだけ版番号を付ける
    const vtxt = cur ? `${label} v${cur.ver}` : `${label}（未保存の内容）`;
    try { A.download(A.FILES.roster(A.tag(), cur ? cur.ver : 0, label), await T.makeDocx(P, state.result.asg, vtxt, { baseAsg: state.result.mark_changes ? state.result.base_asg : null })); } catch (e) { alert(T.t("勤務表を書き出せませんでした: {err}", { err: e && e.message || e })); return; }
  }
  function downloadReportHtml() {
    if (!state.result || !state.result.asg) return alert("先に計算してください");
    const P = new T.Problem(state.rules, state.month);
    A.download(A.FILES.report(A.tag()), new Blob([reportHtml(P)], { type: "text/html" }));
  }

  Object.assign(A, { runSolve, renderResult, reportHtml, downloadDocx, downloadReportHtml }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});
