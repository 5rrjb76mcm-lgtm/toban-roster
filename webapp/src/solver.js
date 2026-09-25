// 当直表アプリ: 制約を整数計画（LP形式）に組み立てて HiGHS で解く。toban.py の build_and_solve に対応
(function (T) {
  const { Problem } = T;
  const key = Problem.key;

  // ---- 線形式とLPビルダー ----
  class LP {
    constructor() { this.vars = new Map(); this.cons = []; this.obj = new Map(); this.objC = 0; this.n = 0; } // objC: 目的関数の定数項（LP 形式には書けないので、解いた後に足す）
    bin(name) { if (!this.vars.has(name)) this.vars.set(name, { type: "B" }); return name; }
    int(name, lb, ub) { this.vars.set(name, { type: "I", lb, ub }); return name; }
    aux(prefix) { return this.bin(`${prefix}_${this.n++}`); }
    auxInt(prefix, lb, ub) { return this.int(`${prefix}_${this.n++}`, lb, ub); }
    // 式: {t: {var: coef}, c: const}
    static E(...items) { const e = { t: {}, c: 0 }; for (const it of items) LP.addTo(e, it, 1); return e; }
    static addTo(e, x, k = 1) {
      if (x == null) return e;
      if (typeof x === "number") e.c += k * x;
      else if (typeof x === "string") e.t[x] = (e.t[x] || 0) + k;
      else { for (const [v, c] of Object.entries(x.t)) e.t[v] = (e.t[v] || 0) + k * c; e.c += k * x.c; }
      return e;
    }
    static sum(items) { const e = LP.E(); for (const it of items) LP.addTo(e, it, 1); return e; }
    static sub(a, b) { const e = LP.E(); LP.addTo(e, a, 1); LP.addTo(e, b, -1); return e; }
    // lhs (式) sense rhs (式)
    add(lhs, sense, rhs) {
      const e = LP.sub(LP.E(lhs), LP.E(rhs));
      const terms = Object.entries(e.t).filter(([, c]) => Math.abs(c) > 1e-12);
      const c = -e.c;
      if (!terms.length) {
        const ok = sense === "<=" ? 0 <= c + 1e-9 : sense === ">=" ? 0 >= c - 1e-9 : Math.abs(c) < 1e-9;
        if (!ok) this.cons.push({ terms: [], sense, rhs: c, trivialFalse: true });
        return;
      }
      this.cons.push({ terms, sense, rhs: c });
    }
    objAdd(coef, x) { if (coef === undefined || coef === null || Number.isNaN(+coef)) throw new Error(`調整目標の重みが未設定です（${typeof x === "string" ? x : "式"}）。設定タブで重みを確認してください`); if (!coef) return; if (typeof x === "string") this.obj.set(x, (this.obj.get(x) || 0) + coef); else if (typeof x === "number") this.objC += coef * x; else if (typeof x === "object") { for (const [v, c] of Object.entries(x.t)) this.obj.set(v, (this.obj.get(v) || 0) + coef * c); this.objC += coef * (x.c || 0); } }
    toLP() {
      const fmt = terms => terms.map(([v, c]) => `${c < 0 ? "-" : "+"} ${Math.abs(c)} ${v}`).join(" ");
      const lines = ["Minimize", " obj: " + (this.obj.size ? fmt([...this.obj].filter(([, c]) => c)) : "0 " + [...this.vars.keys()][0]), "Subject To"];
      this.cons.forEach((c, i) => {
        if (c.trivialFalse) { lines.push(` c${i}: ${[...this.vars.keys()][0]} >= 2`); return; }
        lines.push(` c${i}: ${fmt(c.terms)} ${c.sense === "=" ? "=" : c.sense} ${c.rhs}`);
      });
      lines.push("Bounds");
      const bins = [], ints = [];
      for (const [v, d] of this.vars) { if (d.type === "B") bins.push(v); else { ints.push(v); lines.push(` ${d.lb} <= ${v} <= ${d.ub}`); } }
      if (bins.length) { lines.push("Binary"); lines.push(" " + bins.join("\n ")); }
      if (ints.length) { lines.push("General"); lines.push(" " + ints.join("\n ")); }
      lines.push("End");
      return lines.join("\n") + "\n";
    }
  }

  T.RELAXATIONS = [
    ["weekend_balance", "完全な土日の均等配分（最多−最少の許容差）"],
    ["quota", "勤務目安±1回"],
    ["friday_night", "金曜夜勤の最低回数（friday_night_min）"],
    ["rest", "外勤のある人の週休日1日以上"],
    ["days_off", "月の休みの日数と 2 連休の最低回数"],
    ["composition", "勤務帯ごとの構成（経験年数・資格ごとの人数）"],
    ["duties", "定期業務との関係（翌朝外勤・翌日午後業務・午後外勤日の日勤OC・未確認の午後外勤後の夜勤／夜間OC）"],
    ["fixed", "固定指定"],
    ["unavailable", "不可日"],
    ["consecutive", "連続担当の禁止"],
    ["prev_connection", "前月末からの接続（月またぎの土日の期間責任者を前月の担当者にする）"],
  ];

  function buildLP(P, opts = {}) {
    const relax = new Set(opts.relax || []);
    const base = opts.base || null;
    const W = P.weights, lp = new LP, E = LP.E;
    const names = P.dutyNames, slots = P.slots;
    const ni = {}; names.forEach((n, i) => ni[n] = i);
    const si = {}; slots.forEach((s, i) => si[key(s)] = i);
    const work = {}, oc = {};
    for (const s of slots) for (const n of names) { work[key(s) + "|" + n] = lp.bin(`w${si[key(s)]}_${ni[n]}`); oc[key(s) + "|" + n] = lp.bin(`o${si[key(s)]}_${ni[n]}`); }
    const Wv = (s, n) => s[0] < 1 ? (P.prevWorked(s, n) ? 1 : 0) : (work[key(s) + "|" + n] ?? 0);
    const Ov = (s, n) => s[0] < 1 ? (((P.prevFixed[key(s)] || {}).oc || []).includes(n) ? 1 : 0) : (oc[key(s) + "|" + n] ?? 0);
    const Ev = (s, n) => E(Wv(s, n), Ov(s, n));
    // 採点（opts.pin: 割当）: 全枠の勤務・OCをその割当に固定して解くと、目的関数値がその割当の減点の合計になる（Python 版との突き合わせ用）。
    // pin に無い枠は固定しない（一部の枠だけを空けて解く。総当たりとの突き合わせ用）
    if (opts.pin) for (const s of slots) {
      if (!opts.pin[key(s)]) continue;
      const a = opts.pin[key(s)], ws = [].concat(a.work || []), os = a.oc || [];
      for (const n of names) { lp.add(work[key(s) + "|" + n], "=", ws.includes(n) ? 1 : 0); lp.add(oc[key(s) + "|" + n], "=", os.includes(n) ? 1 : 0); }
    }
    const has = s => P.allSlotSet.has(key(s));
    // 試験用（opts.jitter: {seed, scale}）: 勤務・OC の変数に乱数の重みを足し、必須条件は満たすが最適でない割当を作る（減点の突き合わせで、ふだん 0 点の項にも点を付けるため）
    if (opts.jitter) { let x = opts.jitter.seed >>> 0 || 1; const rnd = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296;
      for (const v of [...Object.values(work), ...Object.values(oc)]) lp.objAdd(Math.round((rnd() - 0.5) * 2 * opts.jitter.scale), v); }

    // プラグイン（rules/*.js）が使う共通の道具。docs/rule-modules.md §5.1。ここにあるのは定義だけで、変数はまだ作らない（呼ばれたときに作る）ので LP の並びは変わらない
    const total = {}; for (const n of names) total[n] = LP.sum(slots.map(s => work[key(s) + "|" + n]));
    const workday = (d, n) => LP.sum(["day", "night"].filter(k => has([d, k])).map(k => Wv([d, k], n)));
    const firstPrev = P.prevSlots.length ? Math.min(...P.prevSlots.map(s => s[0])) : 1;
    const fxW = (d, n) => ["day", "night"].some(k => P.isFixedWork([d, k], n));
    // 日ごとの勤務の指標 y[d][n]: その日にどれかの枠で勤務するか（0/1）。前月末と翌月1日の固定は定数。
    // 連勤・休みの日数・2連休が共有する（要るときだけ作るので、使わない施設では変数が増えない）
    const y = {};
    const yOf = (d, n) => {
      if (d < 1) return P.prevSlots.some(s => s[0] === d) && ["day", "night"].some(k => Wv([d, k], n) === 1) ? 1 : 0;
      if (d > P.N) return P.nextFixedWorks(n) ? 1 : 0;
      const k2 = `${d}|${n}`;
      if (y[k2] === undefined) {
        const ws = ["day", "night"].filter(k => has([d, k])).map(k => work[`${d}:${k}|${n}`]);
        if (!ws.length) { y[k2] = 0; return 0; }
        const v = lp.aux("yd"); for (const w of ws) lp.add(v, ">=", w); lp.add(v, "<=", LP.sum(ws)); y[k2] = v;
      }
      return y[k2];
    };
    // 休みでない日の指標: 勤務した日。明けを休みに数えない施設では、前日に夜勤をした日（明け）も含める
    const busy = {};
    const busyOf = (d, n) => {
      const yv = yOf(d, n); if (P.akeIsOff) return yv;
      const nv = d - 1 < 1 ? (P.prevWorked([d - 1, "night"], n) ? 1 : 0) : (has([d - 1, "night"]) ? work[`${d - 1}:night|${n}`] : 0);
      if (nv === 0) return yv; if (yv === 0) return nv; if (nv === 1) return 1;
      const k2 = `${d}|${n}`; if (busy[k2] === undefined) { const b = lp.aux("busy"); lp.add(b, ">=", yv); lp.add(b, ">=", nv); lp.add(b, "<=", LP.sum([yv, nv])); busy[k2] = b; }
      return busy[k2];
    };
    const ctx = T.rules.solveCtx({ P, lp, LP, names, slots, key, has, work, oc, Wv, Ov, Ev, total, workday, yOf, busyOf, fxW, firstPrev, relax, ni, opts });

    const isI = {}, isA = {}, isY = {};
    for (const s of slots) {
      const k = key(s);
      { const hi = P.countOf(s), lo = P.countMinOf(s), sum = LP.sum(names.map(n => work[k + "|" + n])); // 勤務者の人数（profile.positions.work.count。min があれば幅）
        if (lo === hi) lp.add(sum, "=", hi); else { lp.add(sum, ">=", lo); lp.add(sum, "<=", hi); } } // 理想値からのずれはプラグイン count_target
      isI[k] = LP.sum(P.I.map(n => work[k + "|" + n])); isA[k] = LP.sum(P.A.map(n => work[k + "|" + n])); isY[k] = LP.sum(P.Y.map(n => work[k + "|" + n]));
      // OC 構成は規則の oncall_requirement（P.ocReq。行も列も役割の識別子）から組む。検算（check.js）と同じ表を使う
      const isRoleE = {}; for (const id of P.roleIds) isRoleE[id] = LP.sum((P.byRole[id] || []).map(n => work[k + "|" + n]));
      const req = P.ocReqAt(s); // オンコールを付けない勤務帯の枠では全員 0
      const needOf = roleId => { const e = LP.E(); for (const t of P.roleIds) LP.addTo(e, isRoleE[t], +((req[t] || {})[roleId] || 0)); return e; };
      const jr = P.refId("junior"); // 若手の役割（置けないときに減点で省略できる。missing_young_oc）
      for (const sid of P.standbyRoleIds) {
        const sum = LP.sum((P.byRole[sid] || []).map(n => oc[k + "|" + n]));
        if (sid !== jr) { lp.add(sum, "=", needOf(sid)); continue; }
        // 固定「若手OCなし」の枠は置かず、勤務者の役割に関わらず missY で吸収する（減点 missing_young_oc）
        const noneY = P.ocNone(s, sid);
        const missY = lp.aux("missY"); lp.add(sum, "=", LP.sub(needOf(sid), missY));
        if (noneY) lp.add(sum, "=", 0); else lp.add(missY, "<=", isRoleE[P.refId("other")] || LP.E(0)); // 省略できるのは「もう一方の専門」の勤務のときだけ
        lp.objAdd(W.missing_young_oc, missY);
      }
      for (const n of names) { if (!P.isStandby(n)) lp.add(oc[k + "|" + n], "=", 0); lp.add(E(work[k + "|" + n], oc[k + "|" + n]), "<=", 1); }
    }
    T.rules.runSolve(ctx, 150); // プラグイン: 1 枠の人数の理想値（150）。移す前は枠の制約の中にあった（補助変数の並びだけが変わる）
    // 不可日
    for (const n of names) {
      if (relax.has("unavailable") || relax.has("unavail:" + n)) continue;
      // 固定指定した枠・医師には不可を適用しない（固定指定が優先。検算で「固定指定により許容」として表示）
      for (const d of P.unavailNight[n] || []) if (d >= 1 && d <= P.N && !P.isFixedEng([d, "night"], n)) { lp.add(work[`${d}:night|${n}`], "=", 0); lp.add(oc[`${d}:night|${n}`], "=", 0); }
      for (const [d, part] of P.unavailOther[n] || []) {
        if (d < 1 || d > P.N) continue;
        if (has([d, "day"]) && !P.isFixedEng([d, "day"], n)) { lp.add(work[`${d}:day|${n}`], "=", 0); lp.add(oc[`${d}:day|${n}`], "=", 0); }
        if (part === "allday" && !P.isFixedEng([d, "night"], n)) { lp.add(work[`${d}:night|${n}`], "=", 0); lp.add(oc[`${d}:night|${n}`], "=", 0); } // 前夜からの担当は除外しない（未明から不可なら前日も不可にする運用）
      }
    }
    // 勤務回数（total は上で定義）
    for (const n of names) {
      if (P.isRole(n, "reserve")) { lp.add(total[n], "<=", 1); lp.objAdd(W.chief_duty, total[n]); } // 予備の役割の登用は月1回まで・大幅減点（重み chief_duty）
    }
    T.rules.runSolve(ctx, 210); // プラグイン: 勤務回数の範囲（200）・当月目標（210）。移す前は上の loop の中で人ごとに並んでいた
    T.rules.runSolve(ctx, 400); // プラグイン: 同じ日に 2 枠（300）・連日（310）・OC を含む隣接枠の連続（400）があった位置
    T.rules.runSolve(ctx, 430); // プラグイン: 避けたい日（410）・期間責任者（420）・週末の均等（430）があった位置
    // 固定指定
    if (!relax.has("fixed")) {
      for (const [d, ns] of Object.entries(P.fixedNight)) for (const n of ns) if (!relax.has(`fixed:night:${d}`) && work[`${d}:night|${n}`]) lp.add(work[`${d}:night|${n}`], "=", 1);
      for (const [d, ns] of Object.entries(P.fixedDay)) for (const n of ns) if (!relax.has(`fixed:day:${d}`) && work[`${d}:day|${n}`]) lp.add(work[`${d}:day|${n}`], "=", 1);
      for (const [d, ns] of Object.entries(P.fixedDayOc)) if (!relax.has(`fixed:dayoc:${d}`)) for (const n of ns) if (oc[`${d}:day|${n}`]) lp.add(oc[`${d}:day|${n}`], "=", 1);
      for (const [d, ns] of Object.entries(P.fixedNightOc)) if (!relax.has(`fixed:nightoc:${d}`)) for (const n of ns) if (oc[`${d}:night|${n}`]) lp.add(oc[`${d}:night|${n}`], "=", 1);
      // 翌月1日の固定指定（カレンダーの翌月1日欄）との連日・隣接枠・期間責任者の接続はプラグイン（consecutive_days / oc_consecutive / period_charge）
    }
    T.rules.runSolve(ctx, 560); // プラグイン: 同じ曜日の上限（540）・金曜夜勤の最低回数（560）があった位置
    T.rules.runSolve(ctx, 610); // プラグイン: 定期業務との両立（600）・日中の専門業務（610）があった位置
    T.rules.runSolve(ctx, 820); // プラグイン: 連勤の上限・下限（700・710）・勤務帯のつながり（720）・休みの日数（730）・2 連休（740）・回数の偏り（800）・構成（810）・週休日（820）があった位置
    T.rules.runSolve(ctx, 840); // プラグイン: 日勤と夜勤の組合せ（830）・同日集約（840）があった位置
    T.rules.runSolve(ctx, 930); // プラグイン: 当番に入る人数（900）・当直希望（910）・休日日勤の希望（920）・翌日が平日の夜勤（930）があった位置
    T.rules.runSolve(ctx, 950); // プラグイン: 夜勤・夜間 OC の翌日の業務（950）があった位置
    T.rules.runSolve(ctx, 980); // プラグイン: 隣接しない連日（960）・勤務の間隔（970）・オンコール・休日勤務の偏り（980）があった位置
    // 既存案からの変更
    if (base) for (const s of slots) { const b = base[key(s)]; if (!b) continue; for (const n of names) { const w = W.base_change || 1; if ([].concat(b.work || []).includes(n)) lp.objAdd(-w, work[key(s) + "|" + n]); else lp.objAdd(w, work[key(s) + "|" + n]); if ((b.oc || []).includes(n)) lp.objAdd(-w, oc[key(s) + "|" + n]); else lp.objAdd(w, oc[key(s) + "|" + n]); } }
    T.rules.runSolve(ctx); // 残りのプラグイン（順が後ろのもの）
    return { lp, work, oc, names, slots };
  }

  // HiGHS で解く。highs は Module() で得たインスタンス（同期）か、Web Worker 経由の { solve: (text, opts) => Promise } （非同期）。
  // 非同期のときは Promise を返す
  function solve(P, highs, opts = {}) {
    const built = buildLP(P, opts);
    const text = built.lp.toLP();
    const t0 = Date.now();
    const post = sol => {
    const sec = (Date.now() - t0) / 1000;
    const st = sol.Status;
    const cols = sol.Columns || {};
    const val = v => (cols[v] && cols[v].Primal != null) ? cols[v].Primal : 0;
    let asg = null;
    if (st === "Optimal" || (st !== "Infeasible" && Object.keys(cols).length)) {
      asg = {};
      let ok = true;
      const isInt = x => Math.abs(x - Math.round(x)) < 1e-6; // 時間切れで整数解が無いときは LP の緩和値が返ることがあるので採用しない
      for (const s of built.slots) {
        const k = key(s);
        const vals = built.names.map(n => val(built.work[k + "|" + n])).concat(built.names.map(n => val(built.oc[k + "|" + n])));
        if (!vals.every(isInt)) { ok = false; break; }
        const ws = built.names.filter(n => val(built.work[k + "|" + n]) > 0.5);
        const need = P.countOf(s);
        if (ws.length > need || ws.length < P.countMinOf(s)) { ok = false; break; }
        // 1 名の枠は文字列のまま（保存形を変えない）、複数名の枠だけ配列にする
        asg[k] = { work: need === 1 ? ws[0] : ws, oc: built.names.filter(n => val(built.oc[k + "|" + n]) > 0.5) };
      }
      if (!ok) asg = null;
    }
    return { status: st, asg, objective: sol.ObjectiveValue == null ? sol.ObjectiveValue : sol.ObjectiveValue + built.lp.objC, seconds: sec, vars: built.lp.vars.size, cons: built.lp.cons.length };
    };
    // mip_rel_gap: 目的関数値の許容誤差。規模の大きい施設（1枠複数名など）は、同じ点数の解が多くて
    // 最適性の証明に時間がかかる。既定 0（証明する）。規則 solver.mip_rel_gap か opts で緩められる
    const gap = +(opts.mipGap ?? (P.rules.solver || {}).mip_rel_gap ?? 0) || 0;
    const sol = highs.solve(text, Object.assign({ time_limit: opts.timeLimit || 60, output_flag: false }, gap > 0 ? { mip_rel_gap: gap } : {}));
    return (sol && typeof sol.then === "function") ? sol.then(post) : post(sol);
  }

  // 避けたい日の参照解方式: まず避けたい日を無視して計算し（参照解）、申告者の回数を基準回数として本計算に渡す
  async function solveWithAvoidRef(P, highs, opts = {}) { // 常に Promise を返す（同期の highs でも可）
    const declarers = P.dutyNames.filter(n => P.avoidSlots(n).length && P.team[n] !== "C");
    if (!declarers.length) return await solve(P, highs, opts);
    const ref = await solve(P, highs, Object.assign({}, opts, { ignoreAvoid: true }));
    if (!ref.asg) return Object.assign(ref, { avoidRef: null, refSeconds: ref.seconds });
    const avoidRef = {}; for (const n of declarers) avoidRef[n] = Object.values(ref.asg).filter(v => v && [].concat(v.work || []).includes(n)).length; // 勤務者が配列（複数名）でも数える
    const res = await solve(P, highs, Object.assign({}, opts, { avoidRef }));
    return Object.assign(res, { avoidRef, refSeconds: ref.seconds });
  }
  T.solveWithAvoidRef = solveWithAvoidRef;
  async function diagnose(P, highs, timeLimit = 30, onProgress) { // 常に Promise を返す。onProgress({label, step, total, sub}) は試行のたびに呼ぶ（画面の進捗表示用）
    const lines = []; let step = 0; const total = T.RELAXATIONS.length; const tell = (label, sub) => { try { onProgress && onProgress({ label, step, total, sub }); } catch (e) { } };
    const feasible = async keys => !!(await solve(P, highs, { relax: keys, timeLimit })).asg;
    for (const [k, label] of T.RELAXATIONS) {
      step++; tell(label, "");
      const r = await solve(P, highs, { relax: [k], timeLimit });
      if (!r.asg) { if (r.status !== "Infeasible") lines.push({ key: k, label, undecided: true, note: "", items: [] }); continue; } // 時間切れは「判定できず」として残す（解なしと区別）
      let note = "", items = [];
      if (k === "weekend_balance") { const { charge } = T.check(P, r.asg); const fw = T.fullWeekendUnits(P, charge); const vals = Object.values(fw); note = T.t("（この条件を外した解の完全な土日の担当（組）: {fw}、差 {diff}）", { fw: T.fmtHalf(fw), diff: (Math.max(...vals) - Math.min(...vals)) / 2 }); }
      // 1件・1人単位に絞り込む: グループ全部を外した状態（解あり）から1件ずつ戻し、戻すと解なしになるものを衝突として挙げる
      let cands = [];
      if (k === "fixed") {
        for (const [d, ns] of Object.entries(P.fixedNight)) cands.push({ key: `fixed:night:${d}`, label: T.t("固定指定「{day} {slot} {who}」", { day: P.label(+d), slot: P.shiftLabel("night"), who: ns.join(T.nameSep ? T.nameSep() : "・") }), hint: T.t("月の設定 → 固定指定 で削除するか、その{person}のカレンダーで同日の不可・翌日の業務を見直す") });
        for (const [d, ns] of Object.entries(P.fixedDay)) cands.push({ key: `fixed:day:${d}`, label: T.t("固定指定「{day} {slot} {who}」", { day: P.label(+d), slot: P.shiftLabel("day"), who: ns.join(T.nameSep ? T.nameSep() : "・") }), hint: T.t("月の設定 → 固定指定 で削除するか、その{person}のカレンダーを見直す") });
        for (const [d, ns] of Object.entries(P.fixedDayOc)) cands.push({ key: `fixed:dayoc:${d}`, label: T.t("固定指定「{day} {slot} {who}」", { day: P.label(+d), slot: T.t("日勤OC"), who: ns.join(T.nameSep()) }), hint: T.t("月の設定 → 固定指定 で削除するか、その{person}のカレンダーを見直す") });
        for (const [d, ns] of Object.entries(P.fixedNightOc)) cands.push({ key: `fixed:nightoc:${d}`, label: T.t("固定指定「{day} {slot} {who}」", { day: P.label(+d), slot: T.t("夜間OC"), who: ns.join(T.nameSep()) }), hint: T.t("月の設定 → 固定指定 で削除するか、その{person}のカレンダーを見直す") });
        for (const [d, n] of Object.entries(P.fixedCharge)) cands.push({ key: `fixed:charge:${d}`, label: P.term(T.t("固定指定「{day} {charge}担当 {who}」", { day: P.label(+d), who: n })), hint: T.t("月の設定 → 固定指定 で削除するか、その人の同じ土日の不可を見直す") });
        if (P.nextFixedAny()) cands.push({ key: "fixed:next", label: T.t("翌月1日 {day} の固定指定（月末との連続禁止・月またぎの期間責任者の接続）", { day: P.label(P.N + 1) }), hint: T.t("{person}別カレンダー → 翌月1日欄の固定を見直す") });
      } else if (k === "unavailable") {
        for (const n of P.dutyNames) if ((P.unavailNight[n] || new Set()).size || (P.unavailOther[n] || []).length) cands.push({ key: "unavail:" + n, label: T.t("{who} の不可日（{days}）", { who: n, days: [...(P.unavailNight[n] || [])].sort((a, b) => a - b).map(d => T.t("{d}日", { d })).concat((P.unavailOther[n] || []).map(([d, pp]) => T.t("{d}日", { d }) + T.t(pp === "allday" ? "終日" : "日勤帯"))).join(T.listSep()) }), hint: T.t("{person}別カレンダー → {who} で不可を見直す（本人に確認）", { who: n }) });
      } else if (k === "duties") {
        for (const n of P.names) cands.push({ key: "duties:" + n, label: T.t("{who} の定期業務（外勤・午後業務の翌日制約）", { who: n }), hint: T.t("{person}別カレンダー → {who} の業務を見直す", { who: n }) });
      }
      if (cands.length) {
        const kept = new Set(cands.map(c => c.key)); // 外している集合
        let ci = 0;
        for (const c of cands) {
          tell(label, `${++ci}/${cands.length}`);
          kept.delete(c.key);
          if (!(await feasible([...kept]))) { items.push(c); kept.add(c.key); }
        }
      }
      lines.push({ key: k, label, note, items });
    }
    return lines;
  }

  T.LP = LP; T.buildLP = buildLP; T.solve = solve; T.diagnose = diagnose;
})(globalThis.T = globalThis.T || {});
