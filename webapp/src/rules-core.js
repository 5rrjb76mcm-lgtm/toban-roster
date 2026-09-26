// 勤務表アプリ: 規則のプラグイン（ルールモジュール）の登録と、プラグインが使う共通の道具。設計は docs/rule-modules.md
//
// 1 つの規則を 1 つのプラグインにまとめる。プラグインは T.rules.register({...}) で登録し、
//   solve(ctx, prm)   … 解く側（整数計画の制約と目的関数の項）
//   check(ctx, prm)   … 検算（必須のときの違反）
//   penalty(ctx, prm) … 減点の数え直し（減点のときの点。必須でも固定指定が絡む分）
// を別々に書く（1 つの式から両方を作らない。式の誤りが両方に同じ形で入ると突き合わせで見つからないため）。
//
// 移行中は、まだプラグインにしていない規則が solver.js / check.js の中にそのまま残っている。プラグインにした規則は、
// 元の位置に置いた口（T.rules.runSolve(ctx, upto) など）から順に呼ばれる。順（order）は移す前の並びに合わせ、
// 解く側に渡す式が移す前後で変わらないことを確かめながら 1 つずつ移す。
(function (T) {
  const API = 1; // プラグインと本体の約束の版。ctx の形や登録の引数を非互換に変えたら上げる
  const defs = [], byId = {};
  const HOOKS = ["solve", "check", "penalty", "lint", "report"];

  // 登録。同じ id が既にあればその場所に上書き（model.js の一覧にプラグインの実装を重ねる）、無ければ order の位置に挿す
  function register(def) {
    if (!def || !def.id) throw new Error("規則のプラグインに id がありません");
    const impl = HOOKS.some(k => typeof def[k] === "function");
    if (impl) { // 実装を持つプラグインは、揃っているかを確かめる（登録の検査）
      if (def.api !== API) throw new Error(`規則のプラグイン ${def.id}: api が ${def.api}（本体は ${API}）`);
      if (def.solve && !(def.check || def.penalty)) throw new Error(`規則のプラグイン ${def.id}: solve があるのに check も penalty もありません`);
      if (def.solve && (def.states || []).includes("hard") && !def.check) throw new Error(`規則のプラグイン ${def.id}: 必須にできるのに check（違反の検算）がありません`);
      if (def.solve && (def.states || []).includes("soft") && !def.penalty) throw new Error(`規則のプラグイン ${def.id}: 減点にできるのに penalty（減点の数え直し）がありません`);
      if (def.weight && def.solve && !def.penalty) throw new Error(`規則のプラグイン ${def.id}: 重み ${def.weight} があるのに penalty がありません`);
      for (const [code, m] of Object.entries(def.messages || {})) if (!m || !m.en) throw new Error(`規則のプラグイン ${def.id}: 文面 ${code} に en がありません`);
      for (const n of def.needs || []) if (!byId[n]) throw new Error(`規則のプラグイン ${def.id}: needs の ${n} が登録されていません`);
      { const seen = new Set([def.id]); const walk = id => { for (const n of (byId[id] || {}).needs || []) { if (n === def.id) throw new Error(`規則のプラグイン ${def.id}: needs が循環しています（${[...seen, n].join(" → ")}）`); if (!seen.has(n)) { seen.add(n); walk(n); } } }; for (const n of def.needs || []) walk(n); }
    }
    const cur = byId[def.id];
    if (cur) { // 同じ id の登録し直し。控え（model.js の一覧 {id, group}）の上に実装を重ねるときは足す。実装の上に実装を重ねるとき（プラグインの読み直し）は入れ替える（無くなった関数やフックを残さない。参照は保つ）
      if (impl && HOOKS.some(k => typeof cur[k] === "function")) for (const k of Object.keys(cur)) if (!(k in def)) delete cur[k];
      Object.assign(cur, def); }
    else { const i = defs.findIndex(d => (d.order ?? 0) > (def.order ?? 0)); if (def.order == null || i < 0) defs.push(def); else defs.splice(i, 0, def); byId[def.id] = def; }
    const d = byId[def.id];
    if (T.pluginSource) d.source = T.pluginSource; // プラグインの出どころ（読み込み中のファイル名）。同じ id を別のファイルが登録し直したら後の方
    if (d.messages && T.MSG) Object.assign(T.MSG, d.messages);
    if (T.plugins && T.plugins.recording) T.plugins.recording.push({ kind: "rules", id: def.id }); // プラグインの読み込み中は、登録された id を記録する
    return d;
  }
  function unregister(id) { const i = defs.findIndex(d => d.id === id); if (i >= 0) defs.splice(i, 1); delete byId[id]; } // プラグインの読み込み失敗・フォルダ切替で外す（保存データが参照していれば入力チェック LINT_PLUGIN_MISSING）
  const orderOf = d => d.order ?? defs.indexOf(d) * 100;
  const isOn = (P, d) => P.state(d.id) !== "off" && (d.needs || []).every(n => P.state(n) !== "off");

  // 口: kind（solve / check / penalty / lint）の実装を持つプラグインを、順が upto 以下のものまで順に呼ぶ（呼んだものは ctx.done に覚え、二度呼ばない）。
  // upto に id の配列を渡すと、そのプラグインだけをその並びで呼ぶ（検算の違反の並びを移す前と同じに保つため）。
  // 説明資料（report）だけは解く順ではなく一覧の順（設定タブに並ぶ順＝defs の順）で呼ぶ
  function run(kind, ctx, upto = Infinity) {
    ctx.done ||= new Set();
    const list = Array.isArray(upto) ? upto.map(id => byId[id]).filter(Boolean) : kind === "report" ? defs.slice() : defs.slice().sort((a, b) => orderOf(a) - orderOf(b));
    for (const d of list) {
      if ((!Array.isArray(upto) && orderOf(d) > upto) || typeof d[kind] !== "function" || ctx.done.has(kind + ":" + d.id)) continue;
      ctx.done.add(kind + ":" + d.id);
      if (!isOn(ctx.P, d) && !(kind === "report" && d.reportAlways)) continue; // 説明資料は reportAlways のプラグインだけ「なし」でも出す（情報として出す行）
      if (kind === "solve" && d.relax && ctx.relaxed(d.relax)) continue; // 診断で外している規則
      if (kind === "check" && ctx.P.state(d.id) !== "hard" && !d.checkAlways) continue; // 検算は必須のときだけ（減点の分は penalty）
      d[kind](ctx, ctx.P.prm[d.id]);
    }
  }

  // ---- 解く側の道具（SolveCtx）。buildLP の局所変数を名前付きで渡す。docs/rule-modules.md §5.1 ----
  function solveCtx(b) {
    const { P, lp, LP, names, slots, key, has, work, oc, Wv, Ov, Ev, total, workday, yOf, busyOf, fxW, firstPrev, relax, ni, opts } = b;
    const ctx = {
      P, lp, LP, E: LP.E, W: P.weights, names, slots, key, has, firstPrev, ni, opts: opts || {},
      work: (s, n) => work[key(s) + "|" + n] ?? 0, oc: (s, n) => oc[key(s) + "|" + n] ?? 0,
      Wv, Ov, Ev, total: n => total[n], workday: (d, n) => workday(d, n), y: (d, n) => yOf(d, n), busy: (d, n) => busyOf(d, n),
      roleSum: (s, ref) => LP.sum((P.byRole[P.refId(ref)] || []).map(n => work[key(s) + "|" + n])),
      fixedInvolved: (days, n) => [].concat(days).some(d => fxW(d, n)),
      relaxed: k => relax.has(k),
      facts: {}, provide(name, v) { ctx.facts[name] = v; }, use(name) { if (!(name in ctx.facts)) throw new Error(`事実 ${name} がまだ用意されていません`); return ctx.facts[name]; },
      // 3 状態の仕掛け: expr sense rhs を規則 id の状態に従って入れる
      //   必須: 制約。ただし fixed が真（固定指定が絡む）なら、減点付きで許す（重み fixed_conflict）
      //   減点: 超過分の補助変数 v（aux 名は opts.aux、上限 opts.ub）を作り、P.softW(id) を掛けて目的関数へ
      //   なし: 何もしない（呼ばれない）
      //   減点の式の形は v ≥ expr − rhs（sense "<="）／ v ≥ rhs − expr（sense ">="）
      limit(id, expr, sense, rhs, opts = {}) {
        const st = P.state(id); if (st === "off") return;
        const over = sense === "<=" ? LP.sub(expr, rhs) : LP.sub(rhs, expr);
        if (st === "hard" && !opts.fixed) { lp.add(expr, sense, rhs); return; }
        const v = lp.auxInt(opts.aux || (st === "hard" ? "fxc" : "ex"), 0, opts.ub ?? 10);
        if (st === "hard") { lp.add(over, "<=", v); lp.objAdd(P.weights.fixed_conflict, v); } // 固定指定が絡む必須（le1 と同じ形）
        else { lp.add(v, ">=", over); lp.objAdd(P.softW(id), v); }
      },
    };
    return ctx;
  }

  // ---- 検算の道具（CheckCtx）。LP には触れない。docs/rule-modules.md §5.2 ----
  // mode: "check"（viol を積む）/ "penalty"（add を積む）/ "lint"（push を積む）/ "report"（説明資料の第 9 節の行を line で積む）
  function checkCtx(P, A, mode, sink, opts = {}) {
    const key = s => `${s[0]}:${s[1]}`, names = P.dutyNames, N = P.N, has = s => P.allSlotSet.has(key(s));
    const worked = (n, s) => A.worked(n, s), onCall = (n, s) => A.oc(s).includes(n);
    const workday = (n, d) => ["day", "night"].filter(k => has([d, k])).reduce((a, k) => a + (worked(n, [d, k]) ? 1 : 0), 0);
    const y = (n, d) => d > N ? (P.nextFixedWorks(n) ? 1 : 0) : (workday(n, d) > 0 ? 1 : 0);
    const busy = (n, d) => y(n, d) || (!P.akeIsOff && (d - 1 < 1 ? P.prevWorked([d - 1, "night"], n) : worked(n, [d - 1, "night"]))) ? 1 : 0;
    const pos = x => Math.max(0, x);
    const firstPrev = P.prevSlots.length ? Math.min(...P.prevSlots.map(s => s[0])) : 1;
    const anyWork = (n, d) => ["day", "night"].some(k => worked(n, [d, k]));
    const runs = n => { // 連続して勤務した日の並び（前月末から翌月 1 日まで）
      const out = []; let cur = null;
      for (let d = firstPrev; d <= N + 1; d++) { const w = d > N ? P.nextFixedWorks(n) : anyWork(n, d); if (w) { if (cur) cur.push(d); else cur = [d]; } else if (cur) { out.push(cur); cur = null; } }
      if (cur) out.push(cur); return out;
    };
    const ake = (n, d) => !P.akeIsOff && (d - 1 < 1 ? P.prevWorked([d - 1, "night"], n) : worked(n, [d - 1, "night"])); // 明け（休みに数えない施設だけ）
    const offDays = n => { const o = []; for (let d = 1; d <= N; d++) if (!anyWork(n, d) && !ake(n, d)) o.push(d); return o; };
    // 2 連休の回数（P.pairRuns なら続いた休みで 1 回、でなければ続く 2 日の組の数）
    const pairs = (n, off = offDays(n)) => { const st = new Set(off); let c = 0; for (let d = 1; d + 1 <= N; d++) if (st.has(d) && st.has(d + 1) && (!P.pairRuns || (d >= 2 ? !st.has(d - 1) : !P.prevOffDay0(n)))) c++; return c; };
    // 入力チェック（lint）向け: 不可の日、日中の業務を含めてその枠に入れるか、固定指定した勤務の日（人ごと）
    const unN = (n, d) => (P.unavailNight[n] || new Set()).has(d);                               // 夜間不可
    const unO = (n, d) => ((P.unavailOther[n] || []).find(([dd]) => dd === d) || [])[1];         // 日中の不可（"allday" / 半日）
    const dutyOn = P.isHard("duty_conflicts"); // 規則 duty_conflicts が「なし」の施設は日中の業務で当番を制限しない
    const canWork = (n, s) => { const [d, k] = s;
      if (k === "night") { if (unN(n, d) || unO(n, d) === "allday") return false; if (!dutyOn) return true;
        if (d + 1 <= N && (P.busy(n, d + 1, "am", ["external"]) || P.busy(n, d + 1, "pm"))) return false;
        if (P.busy(n, d, "pm", ["external"]) && P.pmExtNightBanned(d, n)) return false; return true; }
      return !unO(n, d); };
    let fw = null;
    const fixedWork = () => { if (!fw) { fw = {};
      for (const [ds, ns] of Object.entries(P.fixedNight)) for (const n of ns) if (names.includes(n)) (fw[n] ||= []).push(+ds);
      for (const [ds, ns] of Object.entries(P.fixedDay)) for (const n of ns) if (P.slotExists(+ds, "day") && names.includes(n)) (fw[n] ||= []).push(+ds); } return fw; };
    const ctx = {
      P, A, mode, opts, names, N, has, lab: d => P.label(d), slab: s => `${P.label(s[0])}${P.shiftLabel(s[1])}`,
      unN, unO, canWork, fixedWork, join: xs => xs.join("・"),
      worked, onCall, engaged: (n, s) => A.eng(n, s), workday, y, busy, pos, anyWork, runs, ake, offDays, pairs,
      fixedInvolved: (days, n) => [].concat(days).some(d => ["day", "night"].some(k => P.isFixedWork([d, k], n))),
      roleCount: (s, ref) => A.workers(s).filter(w => P.isRole(w, ref)).length,
      firstPrev,
      viol: mode === "check" ? sink : () => { }, add: mode === "penalty" ? sink : () => { }, push: mode === "lint" ? sink : () => { }, line: mode === "report" ? sink : () => { },
      t: (s, v) => T.t(s, v), term: s => T.term(s, P.rules), sep: () => T.listSep(),
      facts: {}, provide(name, v) { ctx.facts[name] = v; }, use(name) { if (!(name in ctx.facts)) throw new Error(`事実 ${name} がまだ用意されていません`); return ctx.facts[name]; },
      // 3 状態の仕掛け（解く側の limit と同じ引数の並び）。value sense rhs が破れている分 over を、
      //   check: 必須なら違反（opts.code, args, days, names）。固定指定による許容は opts.fixed（解く側と同じ判定）。fixed を渡さない規則は本体が days・names で分類する
      //   penalty: 減点なら P.softW(id) × over、必須で fixed が絡めば fixed_conflict × over
      limit(id, value, sense, rhs, opts = {}) {
        const st = P.state(id); if (st === "off") return 0;
        const over = pos(sense === "<=" ? value - rhs : rhs - value);
        if (mode === "check") { if (st === "hard" && over > 0) ctx.viol(opts.code, opts.args || {}, opts.days ?? null, opts.names || [], "fixed" in opts ? !!opts.fixed : undefined); } // fixed を渡した規則は、その判定が許容の可否になる
        else if (mode === "penalty") { if (st === "soft") ctx.add(byId[id].weight, P.softW(id), over); else if (opts.fixed) ctx.add("fixed_conflict", P.weights.fixed_conflict, over); }
        return over;
      },
    };
    return ctx;
  }

  // 名簿の欄（プラグインの def.columns）。columns(R) は出す欄（規則を使っていて、c.when があればそれも真）、columnsAll(R) は全部（隠れた欄の値を残すため）
  const columnsAll = () => defs.flatMap(d => (d.columns || []).map(c => Object.assign({ rule: d.id }, c))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const on = (R, id) => (T.ruleState ? T.ruleState(R, id) : "hard") !== "off";
  const columns = R => columnsAll().filter(c => (on(R, c.rule) || defs.some(d => (d.uses || []).includes(c.key) && on(R, d.id))) && (!c.when || c.when(R))); // 欄の持ち主が「なし」でも、uses で使うと宣言した規則が有効なら出す
  T.rules = { API, defs, byId, register, unregister, run, solveCtx, checkCtx, columns, columnsAll,
    runSolve: (ctx, upto) => run("solve", ctx, upto), runCheck: (ctx, upto) => run("check", ctx, upto),
    runPenalty: (ctx, upto) => run("penalty", ctx, upto), runLint: (ctx, upto) => run("lint", ctx, upto), runReport: (ctx, upto) => run("report", ctx, upto) };
})(globalThis.T = globalThis.T || {});
