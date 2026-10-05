// 当直表アプリ（画面）: フォルダ接続（File System Access API）・開始画面・保存と版の書き出し・別PCとの自動統合・ヘッダー（月の一覧・保存状態）
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const state = A.state;

  // 保存先の記録（state.meta.savedWhere）は保存データの値なので日本語のまま持ち、表示のときだけ訳す
  const whereLabel = w => { const v = String(w || ""); if (v.startsWith("フォルダ ")) return T.t("フォルダ") + " " + v.slice(5); return T.t(v); };
  function renderHeader() {
    const m = state.month; if (!m) return;
    $("#monthTitle").innerHTML = `${monthSelectHtml()} <span>${esc(T.t("の勤務表を作成中"))}</span> <span class="note">${esc(T.t("施設: {name}", { name: T.pickLabel((state.rules.profile || {}).label, (state.rules.profile || {}).id || "") }))}</span>`;
    const dl = $("#docLabel"); if (dl && dl.value !== (m.doc_label || "確認版")) dl.value = m.doc_label || "確認版";
    bindMonthSelect();
    const el = $("#saveState"); let cls, html;
    if (!A.isDirty()) { const at = new Date(state.meta.savedAt), loc = T.dateLocale(); cls = "saved"; html = esc(T.t("保存済み {date} {time}（{where}）", { date: at.toLocaleDateString(loc, { month: "numeric", day: "numeric" }), time: at.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }), where: whereLabel(state.meta.savedWhere) })); }
    else { cls = "dirty"; html = `${esc(T.t("未保存の変更あり"))}${A.dirHandle ? esc(T.t("（数秒後に自動保存）")) : ""} <button id="btnHeaderSave">${esc(T.t(A.dirHandle ? "今すぐ保存" : "接続して保存"))}</button>`; }
    // 内容が同じなら DOM を触らない。入力欄から「今すぐ保存」へクリックすると、欄の blur の change でここが呼ばれる。そのたびにボタンを作り直すと、押している途中のボタンが別の要素になりクリックが消える
    if (el.className !== cls || saveStateHtml !== html || (cls === "dirty" && !$("#btnHeaderSave"))) { el.className = cls; el.innerHTML = html; saveStateHtml = html; if (cls === "dirty") $("#btnHeaderSave").addEventListener("click", () => saveToFolder()); }
  }
  let saveStateHtml = null; // 前回描いた保存状態の中身
  // 別のPCが同じ月を先に保存していないか（保存前の競合検出）。true=保存してよい
  // 3者統合を自動で行う（最後に保存した版を共通の元として、自分の変更と相手の変更を両方残す）。
  // 衝突（同じ項目を両方が変えた）がなければ確認なしで統合し、衝突があるときだけどちらを採るかを聞く。
  // 戻り値: true=統合した（このブラウザの状態は相手の版より新しい扱いになる）, false=利用者がやめた, null=統合できない（共通の元がない）
  async function tryAutoMerge(f, ctx, stale) { // stale: 確認を待つ間に接続先・月が替わっていないか（呼ぶ側が渡す。替わっていたら何もしない）
    let base = state.base && state.meta && state.meta.savedTag === A.tag() ? state.base : null;
    if (!base) return null;
    // 確認を待つ間も、先に始まった前月取込や入力の更新は完了し得る。
    // 同じ年月でも古い入力の写しで統合しない（確認をやり直せるよう、状態には触れず止める）。
    const month0 = state.month, rules0 = state.rules, input0 = A.inputSig();
    const changed = () => (stale && stale()) || state.month !== month0 || state.rules !== rules0 || A.inputSig() !== input0;
    if (A.otherFacility(f) || new Set(A.facilityIds(state.rules, state.month).concat(A.facilityIds(state.baseRules, base))).size > 1) return null; // 別の施設のデータ（共通の元が別の施設のときも）とは自動で統合しない。読み込むか持ち込むかを利用者が選ぶ
    // 相手の版は形を整えてから比べる（旧形式の項目を持ち込まない）
    let theirs; try { theirs = T.normalizeMonth(JSON.parse(JSON.stringify(f.data.month)), f.data.rules || state.rules); } catch (e) { return null; }
    if (!A.isMonthObj(theirs) || A.tag(theirs) !== A.tag() || !A.isMonthObj(base) || A.tag(base) !== A.tag()) return null; // 相手・共通の元が同じ年月でなければ統合しない（別の月の中身を当てない）
    // 1) 設定（名簿・規則・重み）の採用先を先に決める（氏名をどちらの名簿に揃えるかが、これで決まる）
    // 共通の元と比べる: 相手だけ変えたなら相手の、自分だけ変えたなら自分の、両方なら聞く
    let rulesPick = "theirs";
    if (f.data.rules) { const noBase = !state.baseRules; // 旧版の保存状態には共通の元の設定が無い: 比較元不明なので、設定が違えば聞く
      const mineCh = noBase ? A.rulesSig(state.rules) !== A.rulesSig(f.data.rules) : A.rulesSig(state.rules) !== A.rulesSig(state.baseRules), theirsCh = noBase ? mineCh : A.rulesSig(f.data.rules) !== A.rulesSig(state.baseRules);
      if (!theirsCh) rulesPick = "mine";
      else if (mineCh) { const w = await A.choose(T.t("設定（名簿・規則・重み）が、このブラウザと別のPCの両方で変わっています。どちらの設定を使いますか。月の入力は自動で統合します。"),
        [{ label: T.t("相手の設定を使う"), sub: T.t("このブラウザで変えた設定は消えます"), value: "theirs", primary: true }, { label: T.t("自分の設定を使う"), sub: T.t("相手が変えた設定は消えます"), value: "mine" }, { label: T.t("何もしない（後で判断）"), value: null, cancel: true }]);
        if (!w || changed()) return false; rulesPick = w; } }
    if (!f.data.rules) rulesPick = "mine";
    // 2) 氏名を、採用する名簿に揃えてから比べる。最後に同期してから手元で改名していたら、
    //    自分の設定を使うとき: 相手の版と共通の元に同じ改名を当てる（相手が旧名のまま持っている入力を、旧名への追加・新名からの削除と誤らない）
    //    相手の設定を使うとき: 手元の月を改名の前の氏名に戻す（相手の名簿の本人に入力が付く）
    //    本体の項目だけでなく、プラグインの独自データも rename フックで追随させる。フックが失敗したら統合を止める（実物の設定・月には触れない）
    const clone = o => JSON.parse(JSON.stringify(o)), ren = T.effectiveRenames(state.renames, state.baseRules && Array.isArray(state.baseRules.doctors) ? state.baseRules.doctors.map(d => d.name) : null, (state.rules.doctors || []).map(d => d.name)), theirs0 = clone(theirs); // theirs0: 相手の保存内容そのまま（氏名を揃える前）。統合の後の共通の元にする
    const namesIn = R => new Set(((R || {}).doctors || []).map(d => d.name)), myRoster = namesIn(state.rules), theirRoster = namesIn(f.data.rules || state.rules), roster = rulesPick === "theirs" ? theirRoster : myRoster;
    // 元から名簿の外だった氏名（名簿から外した人の入力など。手元・相手それぞれの名簿に対して）。氏名を揃える前に数える: 揃えた結果として本人が分からなくなった入力を、元からの名簿外と取り違えない
    const known = new Set([...Object.keys(T.monthNameRefs(state.month)).filter(n => !myRoster.has(n)), ...Object.keys(T.monthNameRefs(theirs)).filter(n => !theirRoster.has(n))]);
    let mine = state.month;
    // ren のうち、名簿から外した人（印の付いた氏名への対応）と、改名は分けて扱う。同期の後に足した人（共通の元に対応する人がいない）は newFolk
    const baseNames = state.baseRules && Array.isArray(state.baseRules.doctors) ? state.baseRules.doctors.map(d => d.name) : null, renamed = ren.filter(([, n]) => !String(n).startsWith(T.GONE)), removed = ren.filter(([, n]) => String(n).startsWith(T.GONE)).map(([o]) => o), newFolk = baseNames ? T.newPersons(state.renames, baseNames, [...myRoster]) : [];
    // 内部の印（NUL）の検出: 生の NUL 文字だけを印とする（メモに書いた「\\u0000」の 6 文字は印ではない）。展開した項目の値は JSON 文字列なので、JSON として戻してから見る。キーは生の文字列。JSON 化する前の物は再帰で見る
    const NUL = "\u0000", markedStr = x => typeof x === "string" && x.includes(NUL), hasMark = v => Array.isArray(v) ? v.some(hasMark) : v && typeof v === "object" ? Object.entries(v).some(([k, x]) => markedStr(k) || hasMark(x)) : markedStr(v);
    const markedVal = s => { try { return hasMark(JSON.parse(s)); } catch (e) { return markedStr(s); } };
    const marked = m => Object.entries(T.flattenMonth(m)).filter(([k, v]) => markedStr(k) || markedVal(v)).sort().map(x => x.join("=")).join("\n"); // 印の付いた氏名に関わる項目
    // 順序: 先に、足した人・外した人の当月の入力を、元の氏名で識別できるうちに印の付いた氏名へ移す。その後で通常の改名をまとめて当てる（改名の先が、足した人・外した人の氏名と同じでも、別人の入力を上書きしない）
    if (ren.length || newFolk.length) { try {
      if (rulesPick === "mine") { base = clone(base); const tr = f.data.rules ? clone(f.data.rules) : null, br = state.baseRules ? clone(state.baseRules) : null;
        // 手元で名簿から外した人: 相手の版と共通の元で、その人の当月の入力（記録は除く）に印を付けて比べる。相手がその人の入力を変えていなければ、印の付いた入力を両方から除いて統合する（手元の削除が通る）。変えていれば自動では統合しない（確認に戻る）
        for (const d of removed) { T.renameMonthName(theirs, d, T.GONE + d, { inputsOnly: true }); T.renameMonthName(base, d, T.GONE + d, { inputsOnly: true }); }
        T.renameAll(tr, theirs, renamed); T.renameAll(br, base, renamed); // まとめて当てる（空いた氏名の再利用・入れ替えでも、別の人の項目を上書きしない）
        if (removed.length) { if (marked(theirs) !== marked(base)) return null; T.purgeMonthNames(theirs, removed.map(d => T.GONE + d)); T.purgeMonthNames(base, removed.map(d => T.GONE + d)); } }
      else { mine = clone(state.month); const mr = clone(state.rules);
        for (const n of newFolk) T.renameMonthName(mine, n, T.NEW + n, { inputsOnly: true }); // 同期の後に足した人は相手の名簿に対応する人がいない: 印を付けて、相手の同じ氏名の人と混ぜない（入力があれば名簿外の氏名として確認に戻る）
        T.renameAll(mr, mine, renamed.map(([o, n]) => [n, o]));
        if (removed.length) { base = clone(base); for (const d of removed) { T.renameMonthName(theirs, d, T.GONE + d, { inputsOnly: true }); T.renameMonthName(base, d, T.GONE + d, { inputsOnly: true }); } } } // 手元で外した人（相手の名簿にはいる）: 相手がその人の入力を変えていれば印が残って確認に戻る。変えていなければ手元の削除が通る
    } catch (e) { A.toast(T.t("別のPCの変更との統合を止めました: プラグインの人ごとのデータを、改名に合わせて読み替えられませんでした（{err}）。プラグインの作成者に知らせてください", { err: e && e.message || e })); return false; } }
    // 採用する名簿にいない氏名が、統合で新しく月データに入るなら自動では統合しない（両方が同じ人を別の氏名に変えたときなど、氏名の対応を推測しない。読み込むか上書きするかを利用者が選ぶ）
    const strangers = m => Object.keys(T.monthNameRefs(m)).filter(n => !roster.has(n) && !known.has(n)).concat(hasMark(m) ? [NUL] : []); // 内部の印（外した人・足した人）が残る結果も採らない
    let pre; try { pre = T.mergeMonth(base, mine, theirs); } catch (e) { return null; }
    if (strangers(pre.merged).length) return null;
    let prefer = "theirs";
    if (pre.conflicts.length) {
      const fmtV = v => { if (v === undefined || v === null) return T.t("（なし）"); if (typeof v === "string" && v.includes("+")) return v.split("+").map(fmtV).join("＋"); // 同じ日に複数の条件（不可と避など）
        const paid = /_paid$/.test(String(v)), b = String(v).replace(/_paid$/, "");
        const t = ({ night: T.t("不可：夜勤"), allday: T.t("不可：日夜両方"), day: T.t("不可：日勤帯"), avoid_night: T.t("避：夜勤"), avoid_day: T.t("避：日勤帯"), avoid_allday: T.t("避：日夜両方") })[b] || (typeof v === "object" ? JSON.stringify(v) : String(v)); return paid ? t + T.t("（有給）") : t; };
      const list = pre.conflicts.slice(0, 12).map(c => T.t("・{item}: 自分「{mine}」／相手「{theirs}」", { item: c.label, mine: fmtV(c.mine), theirs: fmtV(c.theirs) })).join("\n") + (pre.conflicts.length > 12 ? T.t("\n…ほか {n} 件", { n: pre.conflicts.length - 12 }) : "");
      const w = await A.choose(T.t("{ctx}別のPC（または別のウィンドウ）でも {tag} が変更されていました（保存 {at}）。自分の変更 {mine} 件と相手の変更 {theirs} 件を自動で統合しますが、同じ項目を両方が変えた衝突が {n} 件あります。衝突した項目はどちらを採りますか。\n{list}", { ctx: T.t(ctx), tag: A.tag(), at: new Date(f.data.saved_at).toLocaleString(T.dateLocale()), mine: pre.mineChanges, theirs: pre.theirChanges, n: pre.conflicts.length, list }), [{ label: T.t("衝突は相手の値を採る（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。衝突以外の項目は両方の変更がそのまま残ります"), value: "theirs", primary: true }, { label: T.t("衝突は自分の値を採る"), sub: T.t("例: いま本人から直接聞いた不可日を入れたばかりで、相手の値のほうが古いと分かっているとき"), value: "mine" }, { label: T.t("やめる（統合しない）"), sub: T.t("自動保存は止まります。ヘッダーの保存で再確認できます"), value: null, cancel: true }]);
      if (!w) return false; prefer = w;
    }
    if (changed()) return false;
    const r = T.mergeMonth(base, mine, theirs, prefer);
    if (strangers(r.merged).length) return null;
    // 計算結果: 新しい方を採るが、氏名を採用する名簿に揃える（相手の結果＋自分の名簿なら改名を当て、自分の結果＋相手の名簿なら改名の前に戻す。割当・変更前の割当・避けたい日の基準回数とも）。
    // 揃えても名簿に対応しない氏名が残る結果（出どころの名簿にはいた人が、採用する名簿にいない）は採らない。どちらも採れなければ結果なしにして、計算し直してもらう
    const theirResult = f.data.result, mineResult = state.result, fwd = new Map(ren), back = new Map(ren.map(([o, n]) => [n, o]));
    const fit = (res, origin, map) => { if (!res) return null; const rn = x => map.get(x) || x, seen = new Set(); for (const a of [res.asg, res.base_asg]) for (const v of Object.values(a || {})) { for (const n of [].concat((v && v.work) || [])) if (n) seen.add(n); for (const n of (v && v.oc) || []) seen.add(n); } for (const n of Object.keys(res.avoid_ref || {})) seen.add(n);
      for (const n of seen) if (origin.has(n) && !roster.has(rn(n))) return null; if (![...seen].some(n => rn(n) !== n)) return res;
      const out = clone(res), fix = a => { for (const v of Object.values(a || {})) { if (v && v.work !== undefined) v.work = Array.isArray(v.work) ? v.work.map(rn) : rn(v.work); if (v && v.oc) v.oc = v.oc.map(rn); } }; fix(out.asg); fix(out.base_asg); if (out.avoid_ref) out.avoid_ref = Object.fromEntries(Object.entries(out.avoid_ref).map(([k, v]) => [rn(k), v])); return out; };
    for (const n of newFolk) back.set(n, T.NEW + n); // 足した人は相手の名簿の同じ氏名の人ではない
    const theirFit = fit(theirResult, theirRoster, rulesPick === "mine" ? fwd : new Map()), mineFit = fit(mineResult, myRoster, rulesPick === "theirs" ? back : new Map()), theirsNewer = theirResult && (!mineResult || (theirResult.at || "") > (mineResult.at || ""));
    const lostResult = !!(theirResult || mineResult) && !theirFit && !mineFit;
    state.month = r.merged; state.ui.doctor = 0;
    state.result = theirsNewer ? (theirFit || mineFit) : (mineFit || theirFit);
    if (rulesPick === "theirs") { state.rules = f.data.rules; state.renames = []; } // 相手の名簿を採る: 改名の記録は消す
    // 相手の版を「見た」ことにし、次の保存で統合結果を書き戻す（共通の元は相手の版になる）
    A.saveGen++; state.meta = Object.assign({}, state.meta || {}, { savedAt: f.data.saved_at || "", savedTag: A.tag() }); state.base = theirs0; if (f.data.rules) state.baseRules = JSON.parse(JSON.stringify(f.data.rules)); // 共通の元は、相手の保存内容を相手の氏名のまま持つ（共通の元の設定と同じ氏名。改名を当てるのは、比べるときの複製だけ。書き込みに失敗して再び統合するときも、同じ改名を正しく当てられる）
    if (A.clearUndo) A.clearUndo(); // 統合の前の写しへ「元に戻す」と、相手の変更を手元から落としたまま保存してしまう（共通の元は相手の版に進んでいる）
    A.ensureMonth(state.month); A.persist(); A.renderAll();
    A.toast(T.t("別のPCの変更と自動で統合しました（自分 {mine} 件、相手 {theirs} 件、衝突 {n} 件）。入力が変わったので必要なら再計算してください", { mine: r.mineChanges, theirs: r.theirChanges, n: r.conflicts.length })
      + (lostResult ? T.t("。計算結果は、氏名を採用した名簿に対応付けられないので外しました。もう一度「計算する」を押してください") : ""));
    return true;
  }
  // 相手（フォルダ）のデータが別の施設のものか（設定の profile.id か月の profile_id が違う）
  // 手元（設定と月）と相手（設定と月）に記録された施設 id が 1 つに揃っていなければ「別の施設」（設定と月の id が食い違っている状態も含む。自動統合・無確認の上書きの対象にしない）
  // 保存前の読取・確認は、始めた接続先・月・同期基準にだけ有効。
  // フォルダ選択中に予約済みの自動保存が始まることもあるため、切替窓口の待機だけに頼らない。
  function saveGuard() {
    const g = A.switchMark(), guard = { root: A.dirHandle, monthDirs: A.monthDirs.slice(), saveGen: A.saveGen };
    guard.stale = () => A.switchStale(g) || A.dirHandle !== guard.root || A.saveGen !== guard.saveGen;
    return guard;
  }
  const saveFileStamp = f => JSON.stringify([f.where || null, f.data || null, f.corrupt || null]);
  const saveChangedError = () => Object.assign(new Error(T.t("保存の確認後にフォルダの月データが変わったか、読めなくなりました。上書きしないよう保存を止めました。もう一度保存して内容を確認してください")), { saveChanged: true });
  async function verifySaveFile(guard, savedTag) {
    const f = await findMonthData(savedTag, guard.root, guard.monthDirs);
    if (f.corrupt || saveFileStamp(f) !== guard.fileStamp) throw saveChangedError();
  }
  async function checkConflict(guard) {
    const f = await findMonthData(A.tag());
    if (guard.stale()) return false;
    guard.fileStamp = saveFileStamp(f); // 利用者が確認した（または自動統合の元になった）保存先の版
    if (!f.data && f.corrupt) { A.toast(f.unreadable ? T.t("フォルダの {file} を確かめられません（{err}）。相手の内容を上書きしないよう保存を止めました。入力はブラウザ内に残っています。もう一度保存してください", { file: f.corrupt, err: f.error }) : f.mismatch ? T.t("フォルダの {file} は {tag} のデータではありません（{err}）。上書きしないよう保存を止めました。ファイルを退避するか正しい場所に移してから保存してください", { file: f.corrupt, tag: A.tag(), err: f.error }) : T.t("フォルダの {file} が壊れていて読めません（{err}）。上書きしないよう保存を止めました。ファイルを退避してから保存してください", { file: f.corrupt, err: f.error })); return false; }
    if (!f.data) return true; // フォルダにまだ無い月
    const fileAt = f.data.saved_at || "", mineAt = (state.meta && state.meta.savedTag === A.tag() && state.meta.savedAt) || "";
    const other = A.otherFacility(f); // 施設の一致は保存時刻の一致より先に見る（別施設のファイルを複製した場合など、時刻が同じでも別のデータ）
    if (!other && fileAt && fileAt === mineAt) return true; // 自分が最後に同期した版そのもの（時刻の大小は使わない: 別PCの時計がずれていても同じ版でなければ統合か確認に回す）
    const m = other ? null : await tryAutoMerge(f, T.t("保存しようとしたところ、"), guard.stale);
    if (m === true) { guard.saveGen++; return !guard.stale(); } // この統合自身が進めた同期基準だけを採用する
    if (m === false || guard.stale()) return false;
    // 共通の元がなく統合できないときだけ、どちらを採るか聞く
    const opts = [];
    opts.push({ label: T.t("相手の保存データを読み込む（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。このブラウザの未保存の変更は捨てます（必要なら読み込んだあとで入れ直す）"), value: "load", primary: true });
    opts.push({ label: T.t("このブラウザの状態で上書きする"), sub: T.t("相手の変更は消えます。例: 相手の保存が誤操作や古い試作と分かっていて、こちらの入力が最新のとき"), value: "overwrite" });
    opts.push({ label: T.t("何もしない（後で判断）"), sub: T.t("自動保存は止まります。ヘッダーの保存で再確認できます"), value: null, cancel: true });
    const v = await A.choose(T.t("別のPC（または別のウィンドウ）で {tag} が保存されています（保存 {at}）。このブラウザの状態はそれより前のもので、自動統合の元になる版がありません。", { tag: A.tag(), at: new Date(fileAt).toLocaleString(T.dateLocale()) }), opts);
    if (guard.stale()) return false;
    if (v === "load") { applyLoaded(f.data, T.t("{where} を読み込みました", { where: f.where })); return false; }
    return v === "overwrite";
  }
  async function autosaveJson() { return A.serialized(autosaveCore); }
  async function autosaveCore() { // 返り値: "saved" / "skipped" / "failed"
    if (!A.dirHandle || !A.isDirty()) return "skipped";
    const guard = saveGuard();
    if (!(await checkConflict(guard)) || guard.stale()) return "skipped";
    try { const at = new Date().toISOString(), snap = A.snapshot(at); const dir = await guard.root.getDirectoryHandle(snap.tag, { create: true }); await verifySaveFile(guard, snap.tag); await writeFile(dir, A.FILES.data(snap.tag), new Blob([snap.payload], { type: "application/json" })); A.markSaved(undefined, at, snap); return "saved"; }
    catch (e) { renderHeader(); A.toast(T.t("自動保存に失敗しました: {err}。入力はブラウザ内に残っています", { err: e && e.message || e })); return "failed"; }
  }

  // ---------- フォルダ（File System Access API） ----------
  const fsOK = () => typeof window.showDirectoryPicker === "function";

  // フォルダの参照を IndexedDB に保存し、次回はワンクリックで再接続（権限が残っていれば自動）
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open("toban", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { } }
  // file:// で開いているとき: このHTMLがあるフォルダの URL（月フォルダの一覧をブラウザで表示するのに使う）
  function htmlDirUrl() { if (location.protocol !== "file:") return null; return location.href.replace(/[^/]*$/, ""); }
  function htmlFolderName() { try { const parts = decodeURIComponent(location.pathname).split("/").filter(Boolean); return parts.length >= 2 ? parts[parts.length - 2] : ""; } catch (e) { return ""; } }
  // 開始画面: フォルダ接続に必要な「利用者の操作」を開始ボタンで確保する（ページ読込だけでは許可を求められない）
  // msg とボタンの label は文字列か、いまの言語で文面を返す関数。開始画面の言語を切り替えると描き直す
  let gatePaint = null;
  const repaintStartGate = () => { if (gatePaint && !$("#startGate").hidden) gatePaint(); };
  function showStartGate(msg, btns) {
    return new Promise(resolve => {
      const g = $("#startGate"), box = $("#startBtns"), val = v => (typeof v === "function" ? v() : v);
      const paint = () => { $("#startMsg").textContent = val(msg); box.querySelectorAll("button").forEach((el, i) => { el.textContent = val(btns[i].label); }); T.applyI18n(g); };
      gatePaint = paint;
      $("#startMsg").textContent = val(msg); box.innerHTML = "";
      for (const b of btns) {
        const el = document.createElement("button"); el.textContent = val(b.label); if (b.primary) el.className = "primary"; if (b.cancel) el.className = "cancel";
        el.addEventListener("click", async () => { el.disabled = true; let ok = false; try { ok = await b.run(); } catch (e) { ok = false; } el.disabled = false; if (ok) { g.hidden = true; renderFolderBar(); resolve(); } });
        box.appendChild(el);
      }
      g.hidden = false; T.applyI18n(g);
    });
  }
  async function restoreFolder() {
    if (!fsOK()) return renderFolderBar();
    A.storedHandle = (await idbGet(A.DIR_KEY)) || (await idbGet("dir")); // 旧キーも見る
    const noFolder = { label: T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）"), cancel: true, run: async () => true };
    // ブラウザ内に残っている状態（月・設定・結果）を捨てて、同梱のサンプルから始める。フォルダの接続先は残す
    const fresh = { label: () => T.t("ブラウザ内の保存を消して最初から始める"), cancel: true, run: async () => {
      if (!confirm(T.t("このブラウザに残っている入力・設定・計算結果を消して、同梱のサンプルから始めます。フォルダに保存済みのデータは消えません。よろしいですか"))) return false;
      A.resetBrowserState(); location.reload(); return false; } };
    const openOther = { label: T.t("別のフォルダを開く"), run: async () => { await openFolderUI(); return !!A.dirHandle; } };
    if (A.storedHandle) {
      // 権限が残っているときの自動の再接続も、共通の窓口の中で行う（照合が終わるまで、画面からのフォルダの変更・月の切替を受け付けない）
      try { if ((await A.storedHandle.queryPermission({ mode: "readwrite" })) === "granted") { await A.transition("folder", async () => { setDir(A.storedHandle); await refreshMonths(); A.toast(T.t("フォルダ「{name}」に接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); }); renderFolderBar(); if (A.dirHandle) return; } } catch (e) { A.dirHandle = null; A.toast(T.t("前回のフォルダに接続できませんでした: {err}", { err: e && e.message || e })); }
      await showStartGate(() => T.t("前回の保存フォルダ「{name}」に再接続してから始めます。\n「開始」を押すと、ブラウザがフォルダへの保存の許可を求めることがあります。許可してください。", { name: A.storedHandle.name }), [
        { label: () => T.t("開始（フォルダ「{name}」に再接続）", { name: A.storedHandle.name }), primary: true, run: () => A.transition("folder", async () => { try { if ((await A.storedHandle.requestPermission({ mode: "readwrite" })) === "granted") { setDir(A.storedHandle); await refreshMonths(); $("#startGate").hidden = true; A.toast(T.t("フォルダ「{name}」に再接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); return true; } } catch (e) { A.dirHandle = null; } A.toast(T.t("再接続できませんでした。「別のフォルダを開く」で保存フォルダを選び直してください")); return false; }) },
        Object.assign({}, openOther, { label: () => T.t("別のフォルダを開く") }), Object.assign({}, noFolder, { label: () => T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）") }), fresh,
      ]);
    } else {
      await showStartGate(() => T.t("保存フォルダを開いてから始めます。このHTMLと同じ場所にある月ごとのフォルダの親（例: 勤務表）を選んでください。"), [
        { label: () => T.t("フォルダを開いて開始"), primary: true, run: async () => { await openFolderUI(); return !!A.dirHandle; } },
        Object.assign({}, noFolder, { label: () => T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）") }), fresh,
      ]);
    }
    renderFolderBar();
  }
  // 画面からのフォルダの変更・再接続は共通の窓口（A.transition: 計算中は断り、進行中の保存を待つ）を通す。
  // 保存処理の中からの接続（ensureFolder）は窓口を通さない版（openFolder / reconnectFolder）を使う（自分の保存を待つと止まる）
  const setDir = h => { A.dirHandle = h; A.dirGen++; };
  const openFolderUI = () => A.transition("folder", openFolder);
  const reconnectFolderUI = () => A.transition("folder", reconnectFolder);
  async function reconnectFolder() { // 再接続を断られたら別のフォルダを選ぶ。その読込（プラグインの読取りまで）が終わるまで待つ（窓口の保護が途中で切れないように return する）
    if (!A.storedHandle) return openFolder();
    try { if ((await A.storedHandle.requestPermission({ mode: "readwrite" })) === "granted") { setDir(A.storedHandle); await refreshMonths(); A.toast(T.t("フォルダ「{name}」に再接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); return; } } catch (e) { A.dirHandle = null; A.toast(T.t("再接続できませんでした: {err}", { err: e && e.message || e })); }
    return openFolder();
  }
  async function openFolder() {
    if (!fsOK()) return alert(T.t("このブラウザではフォルダを直接開けません（Edge/Chrome で開いてください）。ダウンロードと「データを読込」で代用できます。"));
    let h; try { h = await window.showDirectoryPicker({ id: "toban-root", mode: "readwrite", startIn: A.storedHandle || "documents" }); } catch (e) { return; }
    setDir(h);
    A.storedHandle = A.dirHandle; await idbSet(A.DIR_KEY, A.dirHandle);
    try { await refreshMonths(); await reconcileWithFolder(); } catch (e) { A.dirHandle = null; renderFolderBar(); return A.toast(T.t("フォルダを読めませんでした: {err}", { err: e && e.message || e })); }
    A.toast(T.t("フォルダ「{name}」を開きました", { name: A.dirHandle.name }));
  }
  let pluginsFor = null; // plugins/ を読んだフォルダ（接続したフォルダごとに 1 回）
  async function refreshMonths() {
    A.monthDirs = [];
    if (!A.dirHandle) return renderFolderBar();
    for await (const [name, h] of A.dirHandle.entries()) if (h.kind === "directory" && /^\d{6}/.test(name)) A.monthDirs.push(name);
    A.monthDirs.sort(); renderFolderBar(); renderHeader();
    if (A.solving) { if (pluginsFor !== A.dirHandle) { A.pluginsPending = true; A.toast(T.t("計算中のため、フォルダのプラグインは計算が終わってから読みます")); } } // 計算中は登録を変えない（計算した規則と検算する規則がずれる）。計算後に loadPendingPlugins が読む
    else if (pluginsFor !== A.dirHandle) { pluginsFor = A.dirHandle; A.pluginsPending = false; await loadFolderPlugins(); } // 接続したフォルダごとに 1 回（「プラグインを読み直す」で再読）。保留分もここで済む
  }
  // 接続直後: フォルダのファイルとブラウザ内の状態を照合し、フォルダの方が新しければそちらを読む
  async function reconcileWithFolder() { try { await reconcileCore(); } finally { if (A.dirHandle && A.isDirty()) A.save(); } } // 接続後に未保存の変更があれば自動保存を予約
  async function reconcileCore(again = 0) {
    if (!A.dirHandle) return;
    // 読み取りの前の接続先・月・同期の基準を覚え、読み終えた後と当てる直前に確かめる（待つ間に別のフォルダへ替わっていたら、前のフォルダの応答を今のフォルダのデータとして当てない。
    // 待つ間に自動保存や統合が済んで同期の基準が進んでいたら、その読取結果は保存より前の古い内容なので捨てて、照合し直す）
    const g = A.switchMark(), h0 = A.dirHandle, sg0 = A.saveGen, moved = () => A.saveGen !== sg0, stale = () => A.switchStale(g) || A.dirHandle !== h0 || moved();
    const f = await findMonthData(A.tag());
    if (A.switchStale(g) || A.dirHandle !== h0) return;
    if (moved()) { if (again < 3) return reconcileCore(again + 1); return; }
    if (!f.data && f.corrupt) { A.toast(f.unreadable ? T.t("フォルダの {file} を確かめられません（{err}）。ブラウザ内の状態で続けますが、確かめられるまで保存しません", { file: f.corrupt, err: f.error }) : f.mismatch ? T.t("フォルダの {file} は {tag} のデータではありません（{err}）。ブラウザ内の状態で続けますが、このままでは保存しません", { file: f.corrupt, tag: A.tag(), err: f.error }) : T.t("フォルダの {file} が壊れていて読めません（{err}）。ブラウザ内の状態で続けますが、このままでは保存しません", { file: f.corrupt, err: f.error })); return; }
    if (!f.data) {
      if (!A.monthDirs.length && state.meta && state.meta.savedAt && confirm(T.t("このフォルダには月データがありません。ブラウザ内に残っている {tag} の状態（保存 {at}）を捨てて、同梱のサンプルから始めますか？\n「キャンセル」＝ブラウザ内の状態をこのフォルダに保存して続けます", { tag: A.tag(), at: new Date(state.meta.savedAt).toLocaleString(T.dateLocale()) })))
        { A.resetBrowserState(); location.reload(); await new Promise(() => { }); } // 読み直すまで止める
      if (state.meta) state.meta = null; // この月のファイルが接続先に無い: フォルダ名に関係なく未保存として扱い、自動保存で書く（別のフォルダや同じ名前の別のフォルダに保存済みでも、接続先に無ければ保存済みとは言わない）
      return; }
    const fileAt = f.data.saved_at || "", mineAt = (state.meta && state.meta.savedAt) || "";
    const other = A.otherFacility(f); // 別の施設のフォルダ: 保存時刻が同じでも「同じ版」とはみなさない。未保存の変更が無ければそのフォルダのデータに切り替え、あれば確認する
    const sameSaved = !other && state.meta && state.meta.savedWhere && state.meta.savedWhere.startsWith("フォルダ") && state.meta.savedTag === A.tag() && fileAt && fileAt === mineAt;
    if (sameSaved) return; // 自分が最後に保存したファイルそのもの
    if (other || !mineAt || fileAt !== mineAt) { // 自分が最後に同期した版と違う（時刻の大小は使わない）
      if (A.isDirty()) {
        // 未保存の変更がある: 共通の元があれば自動で統合し、統合結果をフォルダに書き戻す（別の施設なら統合しない）
        const m = other ? null : await tryAutoMerge(f, T.t("開いたとき、"), stale);
        if (m === true) { A.save(); return; } // 統合結果は自動保存の予約で書く（ここが保存の待ち行列の中から呼ばれることがあり、同じ行列を待つと止まる）
        if (m === false) return;
        const atTxt = fileAt ? new Date(fileAt).toLocaleString(T.dateLocale()) : T.t("時刻不明");
        const v = await A.choose((A.otherFacility(f) ? T.t("このフォルダの {tag} は別の施設（{id}）のデータです。", { tag: A.tag(), id: ((f.data.rules || {}).profile || {}).id || (f.data.month || {}).profile_id }) : "") + T.t("フォルダにある {tag} のデータ（保存 {at}）は、このブラウザ内の状態より新しいか別のものです。ブラウザ内には未保存の変更があります。", { tag: A.tag(), at: atTxt }), [{ label: T.t("フォルダのデータを読み込む（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。ブラウザ内の未保存の変更は捨てます（必要なら読み込んだあとで入れ直す）"), value: "file", primary: true }, { label: T.t("ブラウザ内の状態を保持する"), sub: T.t("次に保存するとフォルダ側を上書きします。例: フォルダの版が誤って保存された古い内容と分かっていて、このブラウザの入力が最新のとき"), value: null, cancel: true }]); if (v !== "file") return; }
      if (stale()) return;
      applyLoaded(f.data, T.t("フォルダの {tag} データ（保存 {at}）を読み込みました", { tag: A.tag(), at: fileAt ? new Date(fileAt).toLocaleString(T.dateLocale()) : T.t("時刻不明") }));
    }
  }
  // 計算中に接続したフォルダのプラグインを、計算が終わってから読む（app-solve.js の runSolve が計算の後始末で呼び、読み終わるまで次の計算を受け付けない）
  async function loadPendingPlugins() {
    if (!A.pluginsPending) return 0; A.pluginsPending = false;
    if (!A.dirHandle || A.solving) return 0;
    pluginsFor = A.dirHandle; return loadFolderPlugins();
  }
  // 保存フォルダの plugins/（rules/ calendars/ docx/ lang/ profiles/）を読んで登録する。無ければ何もしない。docs/rule-modules.md §8
  async function loadFolderPlugins(root = A.dirHandle) {
    if (!root) return 0;
    if (A.solving) { A.toast(T.t("計算中はプラグインを読み直せません。計算が終わってからもう一度押してください")); return 0; } // 画面からは窓口（A.transition("plugins")）が先に断る。ここは保存処理の中からの接続など窓口を通らない経路の安全側
    T.plugins.beginFolder(); // 前のフォルダで読んだ分（規則・区分・拡張・暦・様式・文面・訳・プロファイル）を最初の写しへ戻す。保存データが参照する規則が無ければ入力チェック（LINT_PLUGIN_MISSING）が知らせる
    // plugins/ が無いのは正常（NotFoundError）。それ以外（権限・読取り障害）は読み込みの失敗として記録し、直るまで計算・帳票を止める
    let pdir = null; try { pdir = await root.getDirectoryHandle("plugins"); } catch (e) { if (!notFound(e)) { T.plugins.fail("rules", "plugins/", e); A.toast(T.t("フォルダの plugins/ を開けません: {err}", { err: e && e.message || e })); } A.renderAll(); if (typeof A.renderLangs === "function") A.renderLangs(); return 0; }
    let n = 0; const errs = [];
    for (const kind of T.plugins.KINDS) {
      let kd = null; try { kd = await pdir.getDirectoryHandle(kind); } catch (e) { if (!notFound(e)) { T.plugins.fail(kind, `${kind}/`, e); errs.push(`${kind}/: ${e && e.message || e}`); n++; } continue; }
      const files = []; try { for await (const [name, h] of kd.entries()) if (h.kind === "file" && (kind === "lang" || kind === "profiles" ? /\.json$/i : /\.js$/i).test(name)) files.push([name, h]); } catch (e) { T.plugins.fail(kind, `${kind}/`, e); errs.push(`${kind}/: ${e && e.message || e}`); n++; continue; }
      files.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, h] of files) { let text; try { text = await (await h.getFile()).text(); } catch (e) { T.plugins.fail(kind, `${kind}/${name}`, e); errs.push(`${kind}/${name}: ${e && e.message || e}`); n++; continue; } // 本文を読めない（load を通らない）失敗も記録
        const rec = T.plugins.load(kind, `${kind}/${name}`, text, "folder"); n++; if (!rec.ok) errs.push(`${kind}/${name}: ${rec.error}`); }
    }
    if (n) { // 新しい規則の状態・重みを補い、一覧を描き直す
      T.fillDefaultRules(state.rules); A.ensureMonth(state.month); A.renderAll();
      const ver = $("#ver"); if (ver && !/\+plugins/.test(ver.textContent)) ver.textContent += " +plugins";
      A.toast((errs.length ? T.t("フォルダのプラグインを {n} 件読み込みました（うち {e} 件は読めませんでした。設定タブの管理者向けを確認）", { n, e: errs.length }) : T.t("フォルダのプラグインを {n} 件読み込みました", { n }))
        + (state.result && state.result.asg ? T.t("。いまの結果はこの規則を使っていないので、もう一度「計算する」を押してください") : "")); // 読み込んだ規則は既存の結果に入っていない
    }
    if (typeof A.renderLangs === "function") A.renderLangs(); // 訳のプラグインで言語が増えた・減った（フォルダを替えた）ときに、言語の選択肢を作り直す
    return n;
  }
  function renderFolderBar() {
    const el = $("#folderBar");
    if (!A.dirHandle) {
      const hn = htmlFolderName();
      if (A.storedHandle) el.innerHTML = `<button id="btnReconnect">${esc(T.t("フォルダ「{name}」に再接続", { name: A.storedHandle.name }))}</button> <button id="btnOpenFolder" title="${esc(T.t("保存フォルダを変更します。通常は不要です"))}">${esc(T.t("保存フォルダを変更（管理者）"))}</button>`;
      else el.innerHTML = `<button id="btnOpenFolder">${esc(T.t("フォルダを開く"))}</button> <span class="note">${esc(fsOK() ? T.t("保存先＝このHTMLがあるフォルダ{name}", { name: hn ? "「" + hn + "」" : "" }) : T.t("この環境ではフォルダに直接保存できません（JSONダウンロードで運用）"))}</span>`;
    }
    else el.innerHTML = `<span>📁 <b>${esc(A.dirHandle.name)}</b></span> ${htmlDirUrl() ? `<button id="btnShowFolder" title="${esc(T.t("このHTMLと同じ場所にある当月フォルダのファイル一覧を別タブで表示します"))}">${esc(T.t("{tag} フォルダを表示", { tag: A.tag() }))}</button>` : ""} <button id="btnOpenFolder" title="${esc(T.t("保存フォルダを変更します。通常は不要です"))}">${esc(T.t("保存フォルダを変更（管理者）"))}</button>`;
    $("#btnOpenFolder").addEventListener("click", openFolderUI);
    const rc = $("#btnReconnect"); if (rc) rc.addEventListener("click", reconnectFolderUI);
    const sf = $("#btnShowFolder"); if (sf) sf.addEventListener("click", () => { const base = htmlDirUrl(); if (!base) return; window.open(base + encodeURIComponent(A.tag()) + "/", "_blank"); });
    renderHeader();
  }
  function monthSelectHtml() {
    const cur = A.tag(); const tags = [...new Set(A.monthDirs.map(x => x.slice(0, 6)))].sort();
    const base = tags.length ? tags[tags.length - 1] : cur; const lastTag = base > cur ? base : cur; const lastY = +lastTag.slice(0, 4), lastM = +lastTag.slice(4, 6);
    const ny = lastM === 12 ? lastY + 1 : lastY, nm = lastM === 12 ? 1 : lastM + 1, nextTag = `${ny}${String(nm).padStart(2, "0")}`;
    const ym = (y, m2) => T.t("{y}年{m}月", { y, m: m2 });
    const opts = tags.map(x => [x, ym(x.slice(0, 4), +x.slice(4, 6))]).concat(tags.includes(cur) ? [] : [[cur, ym(cur.slice(0, 4), +cur.slice(4)) + (A.dirHandle ? T.t("（未保存）") : "")]]);
    if (!tags.includes(nextTag) && nextTag !== cur) opts.push([nextTag, T.t("＋ 翌月（{ym}）を作成", { ym: ym(ny, nm) })]);
    opts.push(["__other__", T.t("別の年月を指定…")]);
    return A.sel(opts, cur, `id="monthSel" title="${esc(T.t("月の切替"))}"`);
  }
  function bindMonthSelect() {
    $("#monthSel").addEventListener("change", async ev => {
      let t = ev.target.value; if (t === A.tag()) return;
      const r = await A.transition("month", async () => { // 共通の窓口（計算中は断る・進行中の保存を待つ・ほかの切替と並行させない）
        if (t === "__other__") { ev.target.value = A.tag(); const y = +prompt(T.t("年"), state.month.year); if (!y) return true; const mo = +prompt(T.t("月（1〜12）"), state.month.month); if (!mo || mo < 1 || mo > 12) return true; t = `${y}${String(mo).padStart(2, "0")}`; if (t === A.tag()) return true; }
        await openMonth(t); ev.target.value = A.tag(); return true;
      });
      if (r === false) ev.target.value = A.tag(); // 計算中・ほかの切替の処理中で断られた
    });
  }
  // 年月 t（YYYYMM）を開く: 接続中のフォルダに保存データがあれば開き、無ければ作り方を聞く（onMonthChange）。
  // 読み取りの前の年月と接続の世代を覚え、読み終えた後と当てる直前に確かめる（待つ間に接続先や月が替わっていたら、古い読取結果を別のフォルダのデータとして当てない）
  async function openMonth(t) {
    if (A.dirHandle) { const g = A.switchMark(), f = await findMonthData(t); const stale = () => { if (!A.switchStale(g)) return false; A.toast(T.t("月の切替を中止しました（読み取りの間に月か保存フォルダが切り替わりました）。もう一度選んでください")); renderHeader(); return true; };
      if (stale()) return false;
      if (!f.data && f.corrupt) { A.toast(f.mismatch ? T.t("フォルダの {file} は {tag} のデータではありません（{err}）。月を開けません。ファイルを退避するか正しい場所に移してください", { file: f.corrupt, tag: t, err: f.error }) : T.t("フォルダの {file} を読めません（{err}）。月を開けません", { file: f.corrupt, err: f.error })); renderHeader(); return false; } // 壊れている・別の月の中身: 「無い」として新しく作らない（自動保存で上書きしないため）
      if (f.data) { if (!(await saveBeforeSwitch())) return false; if (stale()) return false; applyLoaded(f.data, T.t("{where} を開きました", { where: f.where })); return true; } }
    await A.onMonthChange(+t.slice(0, 4), +t.slice(4)).catch(e => A.toast(T.t("月の切替に失敗しました: {err}", { err: e && e.message || e }))); return true; // 保存の確認は onMonthChange 側で行う
  }
  // 月データを探す: YYYYMM フォルダ内 → フォルダ直下 → YYYYMM で始まる名前のフォルダ内
  async function findMonthData(t, root = A.dirHandle, candidateDirs = A.monthDirs) {
    if (!root) return { data: null, tried: [] };
    const fname = A.FILES.data(t), tried = [];
    // 読めたら中身も見る: 勤務表データ（year / month を持つ）で、年月がファイル名と合うものだけを「その月のデータ」とする。別の月の中身（コピーや改名の誤り）は「壊れている」と同じ扱い（新規扱いで上書きしない・自動で統合しない）
    const inspect = o => { const mo = A.isMonthObj(o.month) ? o.month : A.isMonthObj(o) ? o : null; if (!mo) return T.t("勤務表データではありません（year / month がありません）"); const tg = A.tag(mo); return tg === t ? null : T.t("中身は {y}年{m}月 のデータです", { y: mo.year, m: mo.month }); };
    const pick = async (dir, prefix) => { const o = await readJson(dir, fname); tried.push(prefix + fname); if (o && o.__corrupt) return { data: null, corrupt: prefix + fname, unreadable: !!o.unreadable, error: o.error, tried }; if (!o) return null;
      const bad = inspect(o); if (bad) return { data: null, corrupt: prefix + fname, mismatch: true, error: bad, tried }; return { data: o, where: prefix + fname, tried }; };
    const dirsToTry = [t, ...candidateDirs.filter(x => x !== t && x.startsWith(t))];
    for (const dn of dirsToTry) { let dir = null; try { dir = await root.getDirectoryHandle(dn); } catch (e) { if (!notFound(e) && e && e.name !== "TypeMismatchError") return { data: null, corrupt: `${dn}/`, unreadable: true, error: e && e.message || String(e), tried }; } // 月のフォルダを開けない（無いのではない）: 無いものとして新規保存しない
      if (!dir) { tried.push(`${dn}/`); continue; } const r = await pick(dir, `${dn}/`); if (r) return r; }
    const r = await pick(root, ""); if (r) return r;
    return { data: null, tried };
  }
  // 無ければ null（NotFoundError だけを「無い」とみなす）。あるのに読めない（壊れている）・あるかどうかを確かめられない（権限・読取り障害）ときは { __corrupt: true, error } を返し、呼ぶ側は新規扱いで上書きしない
  const notFound = e => !!e && e.name === "NotFoundError";
  async function readJson(dir, name) { let fh; try { fh = await dir.getFileHandle(name); } catch (e) { if (notFound(e)) return null; return { __corrupt: true, unreadable: true, error: e && e.message || String(e) }; } let text; try { const f = await fh.getFile(); text = await f.text(); } catch (e) { return { __corrupt: true, unreadable: true, error: e && e.message || String(e) }; } // 読めない（権限・読取り障害）は「壊れている」ではない
    let v; try { v = JSON.parse(text); } catch (e) { return { __corrupt: true, error: e && e.message || String(e) }; }
    if (!v || typeof v !== "object" || Array.isArray(v)) return { __corrupt: true, error: T.t("勤務表データではありません（year / month がありません）") }; // JSON として有効な null・数値・文字列・配列は「ファイルなし」ではない（存在するが勤務表データでない）
    return v; }
  async function writeFile(dir, name, blob) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
  async function ensureFolder() {
    if (A.dirHandle) return true;
    if (!fsOK()) return false;
    if (A.storedHandle) await reconnectFolder(); else await openFolder();
    return !!A.dirHandle;
  }
  // 月を切り替える前に現在の月を保存する。未接続なら接続を求め、断られたら「保存せずに切替」を確認
  async function saveBeforeSwitch() {
    await A.awaitSaves(); // 進行中の保存（帳票の生成・書込み）が終わってから判定する（呼ぶ側が窓口を通していても、ここで待つのは安全側。未保存でなくても書込み中に月を替えると保存の基準が混ざる）
    A.readAll();
    if (!A.isDirty()) return true;
    if (!A.dirHandle) {
      const ymT = T.t("{y}年{m}月", { y: state.month.year, m: state.month.month });
      if (!fsOK()) return (await A.choose(T.t("{ym} の入力（計算結果を含む）はフォルダに保存されていません。", { ym: ymT }), [{ label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: "go" }, { label: T.t("やめる（今の月のまま）"), sub: T.t("残す場合は設定タブの「JSONとしてダウンロード」"), value: null, cancel: true, primary: true }])) === "go";
      A.toast(T.t("切り替える前に現在の月を保存します。フォルダを接続してください"));
      if (!(await ensureFolder())) return (await A.choose(T.t("{ym} の入力（計算結果を含む）は保存されていません。", { ym: ymT }), [{ label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: "go" }, { label: T.t("やめる（今の月のまま）"), value: null, cancel: true, primary: true }])) === "go";
      A.readAll();
    }
    let r = "skipped";
    for (let i = 0; i < 3; i++) { r = await saveToFolder(); if (!(r === "saved" || r === "downloaded")) break; A.readAll(); if (!A.isDirty()) return true; } // 書込み中に増えた入力があれば、もう一度保存する
    if (r === "saved" && A.isDirty()) r = "dirty";
    const ymT2 = T.t("{y}年{m}月", { y: state.month.year, m: state.month.month });
    const v = await A.choose(T.t("{ym} を保存できませんでした（{why}）。切り替えると未保存の入力が失われます。", { ym: ymT2, why: r === "skipped" ? T.t("保存を見送ったか、統合の確認で中止") : r === "dirty" ? T.t("保存中にも入力が続き、未保存の入力が残っている") : T.t("書き込みに失敗") }),
      [{ label: T.t("切り替えを中止する（推奨）"), value: false, primary: true }, { label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: true }]);
    return v === true;
  }
  async function saveToFolder() { clearTimeout(A.autosaveTimer); return A.serialized(saveToFolderCore); }
  // フォルダへの保存は 3 段階。1) prepareSave: 写しを取り、出力（勤務表・説明資料・月データ）を作る（state は読むだけ） 2) writeSave: フォルダへ書く 3) commitSave: 保存済みにする
  // saveToFolderCore はその並べ方（接続の確保・競合の確認・3 段階・一覧の更新・知らせ）だけを持つ
  async function saveToFolderCore() {
    A.readAll();
    if (!A.dirHandle) {
      if (!(await ensureFolder())) { if (!fsOK()) { const at = new Date().toISOString(); A.download(A.dataFileName(), new Blob([A.payloadJson(at)], { type: "application/json" })); A.markSaved("ダウンロード", at); return "downloaded"; A.toast(T.t("この環境ではフォルダに直接保存できないため、JSONをダウンロードしました")); } else A.toast(T.t("保存先のフォルダを選ぶと保存できます")); return; }
      A.readAll();
    }
    const guard = saveGuard();
    if (!(await checkConflict(guard)) || guard.stale()) { A.toast(T.t("保存を見送りました")); return "skipped"; } // ここで自動統合が入ることがある（統合後の内容を書く）
    try {
      const root = guard.root, prep = await prepareSave();
      await verifySaveFile(guard, prep.S.tag); // 帳票生成の待ち時間に別のウィンドウが保存していれば、書込み前に止める
      await writeSave(root, prep, () => verifySaveFile(guard, prep.S.tag));
      commitSave(prep);
      await refreshMonths();
      A.toast(T.t("{tag} フォルダに保存しました", { tag: prep.S.tag }) + (prep.hasAsg ? prep.note : T.t("（データのみ。計算後に保存すると勤務表と説明資料も出ます）")));
      return "saved";
    } catch (e) { renderHeader(); A.toast(T.t("フォルダに保存できませんでした: {err}。入力はブラウザ内に残っています", { err: e && e.message || e })); return "failed"; }
  }
  // 勤務表・説明資料を出してよいかの確認（フォルダ保存と直接ダウンロードで共通。写し S に対して判定する）。どれかに当たれば止める文（stop）を返す
  // （順に: 入力を読めない／プラグインが欠けた・読めない・変換に失敗（計算ボタンと同じ判定）／計算した後にプラグインが変わった（結果の印 result.plugins と今の印。印の無い旧形式の結果は通す）／検算に違反がある・検算が完了しない）。
  // 検算は印の有無によらず必ず行う。戻り値 { stop, P }（P は写しから作った Problem。通ったときの生成に使う）
  function outputCheck(S) {
    if (!(S.result && S.result.asg)) return { stop: T.t("（まだ計算していません）"), P: null };
    let P = null, stop = null;
    try { P = new T.Problem(S.rules, S.month); } catch (e) { stop = T.t("（入力を読み取れないため勤務表と説明資料は書き出しません: {err}）", { err: e && e.message || e }); }
    if (!stop) { let pl = null; try { pl = T.lintPlugins(P).filter(x => ["LINT_PLUGIN_MISSING", "LINT_PLUGIN_ERROR", "LINT_PLUGIN_STALE", "LINT_PLUGIN_HOOK", "LINT_NAME_DUP"].includes(x.code)); } catch (e) { pl = null; }
      if (!pl || pl.length) stop = T.t("（施設のプラグインが足りない・読めない、または名簿の氏名が重なっているため勤務表と説明資料は書き出しません。入力チェックを確認してください）"); }
    if (!stop) { const stampNow = JSON.stringify(T.plugins && T.plugins.stamp ? T.plugins.stamp() : []), stampRes = Array.isArray(S.result.plugins) ? JSON.stringify(S.result.plugins) : null;
      if (stampRes !== null && stampRes !== stampNow) stop = T.t("（計算した後にプラグインが変わったため勤務表と説明資料は書き出しません。もう一度「計算する」を押してください）"); }
    if (!stop) { let viol = -1; try { viol = T.check(P, S.result.asg).V.length; } catch (e) { viol = -1; }
      if (viol !== 0) stop = T.t("（検算に違反が{n}ため勤務表と説明資料は書き出しません。入力を直して再計算してください）", { n: viol < 0 ? T.t("確認できない") : T.t("{n} 件", { n: viol }) }); }
    return { stop, P };
  }
  // 1) 写しから出力を作る。この時点の写し（月・設定・結果・年月・言語・接続の世代）を 1 つ取り、保存先のファイル名・検算・版の署名・勤務表・説明資料をすべてその写しから作る。
  // 生成の間に入った編集は写しに入らず未保存として残る。戻り値 { S, at, docs: [{name, blob}], version, note, hasAsg }。docs は勤務表と説明資料（版の記録 version は書けたときだけ 2) で写しに足す）。state は変えない
  async function prepareSave(at = new Date().toISOString()) {
    const S = A.snapshot(at), hasAsg = !!(S.result && S.result.asg), prep = { S, at, docs: [], version: null, note: "", hasAsg, docsWritten: false };
    if (!hasAsg) return prep;
    const { stop, P } = outputCheck(S);
    if (stop) prep.note = stop;
    else {
      // 配布物は上書きせず版を追加する。出力に関わるもの（versionSig）が前回と同じなら新しい版は作らない
      const label = S.month.doc_label || "確認版", vsig = versionSig(label, S);
      const versS = S.month.doc_versions || [], last = versS[versS.length - 1]; // 写しには足さない（書けたときに writeSave が足す）
      Object.assign(prep, { P, label, vsig }); // writeSave が保存先の版の記録と照らして番号を付け直す（同じ番号で別の内容の帳票を上書きしない）ときに使う
      if (!last || last.sig !== vsig) {
        const ver = (last ? last.ver : 0) + 1;
        try { // 様式のプラグインが無いなどで作れなくても、月データの保存は続ける
          prep.docs = await makeDocs(S, P, ver, label);
          prep.version = { ver, at, label, sig: vsig, docx: prep.docs[0].name, html: prep.docs[1].name }; // 版の記録は、書けたときだけ writeSave が写しに足す
          prep.note = T.t("（勤務表 v{v} を追加）", { v: ver });
        } catch (e) { prep.note = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); }
      } else { prep.note = T.t("（勤務表は v{v} のまま。出力に関わる変更なし）", { v: last.ver }); prep.reuse = { ver: last.ver, label, P }; } // 同じ版。保存先の記録が同じ内容だと確かめられて帳票もあれば再利用、無ければ writeSave が同じ内容・版で書き直す
    }
    return prep;
  }
  // 勤務表・説明資料を写しから作る（版の番号と表題を付けて）
  async function makeDocs(S, P, ver, label) {
    const docx = await T.makeDocx(P, S.result.asg, `${label} v${ver}`, { baseAsg: S.result.mark_changes ? S.result.base_asg : null });
    const html = new Blob([A.reportHtml(P, `${label} v${ver}`, S)], { type: "text/html" });
    return [{ name: A.FILES.roster(S.tag, ver, label), blob: docx }, { name: A.FILES.report(S.tag, ver, label), blob: html }];
  }
  // 2) フォルダへ書く。写しの年月のフォルダに、直前の月データを 1 世代退避してから、勤務表・説明資料、次に月データを書く。
  // 勤務表・説明資料だけが書けなかったときは版の記録を足さずに月データを保存する（月データが書けなければ例外＝保存失敗）
  async function writeSave(root, prep, verify = null) {
    const dir = await root.getDirectoryHandle(prep.S.tag, { create: true });
    // 保存先にいまある月データの版の記録（同じ番号で別の内容の帳票がこのフォルダにあるかを、これで見る）。退避の書込みとは切り離して先に読む（退避に失敗しても記録は使う）
    const prev = await readJson(dir, A.FILES.data(prep.S.tag)); let prevVers = [];
    if (prev && prev.__corrupt) throw saveChangedError(); // 読めない状態を「ファイルなし」として上書きしない
    if (prev && !prev.__corrupt && prev.month && Array.isArray(prev.month.doc_versions)) prevVers = prev.month.doc_versions.filter(v => v && typeof v === "object");
    try { if (prev && !prev.__corrupt) await writeFile(dir, A.FILES.dataPrev(prep.S.tag), new Blob([JSON.stringify(prev, null, 1)], { type: "application/json" })); } catch (e) { } // 誤操作や統合の取り違えからの復元用
    // 版の番号: 保存先の記録に同じ番号で別の署名の版があれば、その番号の帳票は別の内容（別のフォルダから持ち込んだ月データなど）。同じ名前の帳票が片方でもあるのに記録で「この番号＝この内容」と確かめられないときも同じ。
    // どちらも上書きせず、記録にも帳票にも無い番号を付け直す
    const exists = async n => { try { await dir.getFileHandle(n); return true; } catch (e) { if (notFound(e)) return false; throw e; } }, namesOf = (ver, label) => [A.FILES.roster(prep.S.tag, ver, label), A.FILES.report(prep.S.tag, ver, label)]; // 存在確認の失敗は「無い」ではない。既存帳票を上書きしないよう保存を止める
    const clash = ver => prevVers.some(v => +v.ver === ver && v.sig !== prep.vsig), verified = ver => prevVers.some(v => +v.ver === ver && v.sig === prep.vsig);
    const anyExists = async (ver, label) => { for (const n of namesOf(ver, label)) if (await exists(n)) return true; return false; }, allExist = async (ver, label) => { for (const n of namesOf(ver, label)) if (!(await exists(n))) return false; return true; };
    const taken = async (ver, label) => clash(ver) || (!verified(ver) && await anyExists(ver, label)); // この番号は別の内容の帳票に使われている（かもしれない）
    const freeVer = async label => { let v = Math.max(0, ...prevVers.map(x => +x.ver || 0), ...(prep.S.month.doc_versions || []).map(x => +x.ver || 0)) + 1; while (await taken(v, label)) v++; return v; };
    if (prep.docs.length && prep.version && await taken(prep.version.ver, prep.label)) {
      try { const old = prep.version.ver, ver = await freeVer(prep.label); prep.docs = await makeDocs(prep.S, prep.P, ver, prep.label); prep.version = Object.assign({}, prep.version, { ver, docx: prep.docs[0].name, html: prep.docs[1].name }); prep.note = T.t("（勤務表 v{v} を追加。このフォルダの v{old} は別の内容なので上書きしていません）", { v: ver, old }); }
      catch (e) { prep.docs = []; prep.note = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); } }
    if (prep.docs.length) {
      try { if (verify) await verify(); for (const f of prep.docs) await writeFile(dir, f.name, f.blob); prep.docsWritten = true; (prep.S.month.doc_versions ||= []).push(prep.version); }
      catch (e) { if (e && e.saveChanged) throw e; prep.docsWritten = false; prep.note = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); }
    } else if (prep.reuse) { // 同じ版でも、保存先（別のフォルダに移した・消した）に勤務表か説明資料が無ければ、同じ内容・同じ版で書き直す。その番号が別の内容の帳票に使われている（かもしれない）なら、再利用も上書きもせず新しい番号で書く
      const { ver, label, P } = prep.reuse;
      if (await taken(ver, label)) {
        try { const nv = await freeVer(label), docs = await makeDocs(prep.S, P, nv, label); if (verify) await verify(); for (const f of docs) await writeFile(dir, f.name, f.blob); prep.version = { ver: nv, at: prep.at, label, sig: prep.vsig, docx: docs[0].name, html: docs[1].name }; prep.docsWritten = true; (prep.S.month.doc_versions ||= []).push(prep.version); prep.note = T.t("（勤務表 v{v} を追加。このフォルダの v{old} は別の内容の可能性があるので上書きしていません）", { v: nv, old: ver }); }
        catch (e) { if (e && e.saveChanged) throw e; prep.note = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); } }
      else if (!(await allExist(ver, label))) {
        try { const docs = await makeDocs(prep.S, P, ver, label); if (verify) await verify(); for (const f of docs) await writeFile(dir, f.name, f.blob); prep.note = T.t("（勤務表 v{v} がこのフォルダに無かったので書き直しました）", { v: ver }); }
        catch (e) { if (e && e.saveChanged) throw e; prep.note = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); } }
    }
    prep.S.refresh(); // 版の記録（書けたときだけ）を反映した署名と中身
    if (verify) await verify(); // 版番号の変更・不足帳票の再生成にも await があるため、月JSONの上書き直前にも照合
    await writeFile(dir, A.FILES.data(prep.S.tag), new Blob([prep.S.payload], { type: "application/json" }));
  }
  // 3) 保存済みにする。書いた写しの署名だけを保存済みにする（生成・書込み中の入力は未保存のまま）。版の記録は、書けていて、写しと現在の月・接続先が同じときだけ現在の状態にも足す
  // （ほかに編集が無ければ署名が一致して「保存済み」になる。月や接続先が替わっていたら markSaved も基準を更新しない）
  function commitSave(prep) {
    const S = prep.S;
    if (prep.docsWritten && prep.version && A.tag() === S.tag && S.dirGen === A.dirGen) (state.month.doc_versions ||= []).push(JSON.parse(JSON.stringify(prep.version)));
    A.markSaved(undefined, prep.at, S);
  }
  // 当直表の版の識別。保存時の版付与とダウンロード時の版表示で共通。出力に使うものを全部含める:
  // 設定（規則・重み・様式・名簿）、月の条件（メモ・日ごとの予定など。版の履歴は除く）、割当と変更表示の基準、表題、表示言語、本体の印（T.BUILD_ID）、実行時に読んだプラグインの中身。
  // 保存時刻・計算時間・計算日時は含めない（保存のたびに版が増える循環を避ける）。S は月・設定・結果の組（省略時は現在の状態。保存では写しを渡す）
  const versionSig = (label, S = state) => { const m = Object.assign({}, S.month); delete m.doc_versions; const r = S.result || {};
    return A.sigOf(JSON.stringify([A.canon(S.rules), A.canon(m), A.canon({ asg: r.asg, base_asg: r.mark_changes ? r.base_asg : null, avoid_ref: r.avoid_ref, status: r.status }), label, S.lang || T.lang(), T.BUILD_ID || null, T.plugins && T.plugins.stamp ? T.plugins.stamp() : null])); };
  // 月データを状態に当てる。opts.fromFolder（既定 true）: 接続中のフォルダから読んだ内容だけを「そのフォルダに保存済み」にする。外部の JSON（「JSONを読込」）は接続先に対する変更なので未保存のまま
  // （自動保存・統合の確認を経てフォルダに書かれる）。どちらもヘッダーの「元に戻す」の履歴は捨てる（別の月・別の内容に対して古い写しを当てない）
  // 現在の月を JSON としてダウンロードする。フォルダ接続中は、フォルダへの保存の状態（保存済みか・統合の共通の元）を進めない（ダウンロードは別の出口。未保存の変更は自動保存でフォルダに書かれる）
  function downloadMonthJson() {
    A.readAll(); const at = new Date().toISOString(); A.download(A.dataFileName(), new Blob([A.payloadJson(at)], { type: "application/json" }));
    if (!A.dirHandle) A.markSaved("ダウンロード", at); else A.toast(T.t("JSON をダウンロードしました（フォルダへの保存とは別です。未保存の変更は自動保存でフォルダに書かれます）"));
  }
  // 「JSONを読込」: 読み取り・検証の後、当てる直前にもう一度保存の確認をする（読み取りを待つ間に加えた入力を、無確認で置き換えない）
  async function loadJsonFile(f) {
    if (!f) return; if (!(await saveBeforeSwitch())) return;
    let o; try { o = JSON.parse(await f.text()); } catch (e) { return alert(T.t("読み込み失敗: {err}", { err: e })); }
    if (!(await saveBeforeSwitch())) return; // 読み取りの間の入力
    applyLoaded(o, T.t("読み込みました"), { fromFolder: false });
  }
  // 「前月のデータから作成」: 同じく当てる直前に保存の確認
  // 読み込む JSON の形の検証（「JSONを読込」と「前月のデータから作成」で共用）: 勤務表データ（year / month を持つ月。{rules, month, result} の形か月そのもの）で、設定があれば名簿の要素が氏名を持つ物であること。問題があれば理由の文を返す
  function loadedShape(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return { error: T.t("勤務表データではありません（year / month がありません）") };
    let month, rules = null, result = null;
    if (A.isMonthObj(o.month)) { month = o.month; rules = o.rules || null; result = o.result || null; } else if (A.isMonthObj(o)) { month = o; } else return { error: T.t("勤務表データではありません（year / month がありません）") };
    if (rules && (typeof rules !== "object" || !Array.isArray(rules.doctors))) return { error: T.t("勤務表データの設定（rules）に{person}一覧がありません") };
    if (rules && !rules.doctors.every(d => d && typeof d === "object" && typeof d.name === "string" && d.name)) return { error: T.t("勤務表データの設定（rules）の{person}一覧に、氏名の無い要素があります") };
    if (result !== null && typeof result !== "object") result = null;
    return { month, rules, result };
  }
  // 前月のデータから新しい月を作る（「前月のデータから作成」のファイル選択と、ヘッダーの「…のデータから引き継いで作成」で共用）:
  // 形の検査（loadedShape）→ 複製の設定で変換（fromPrevious は state.rules を見るので一時的に差し替え、必ず戻す）→ 作った月の検査。成功したときだけ { month, rules } を返し、失敗は { error }（状態には触れない）
  function buildFromPrevious(o, ny, nm) {
    const shape = loadedShape(o); if (shape.error) return { error: shape.error };
    try { const clone = x => JSON.parse(JSON.stringify(x)); let rules2 = null, month2; if (shape.rules) { rules2 = clone(shape.rules); T.fillDefaultRules(rules2); }
      const R0 = state.rules; if (rules2) state.rules = rules2; try { month2 = A.fromPrevious({ rules: shape.rules, month: shape.month, result: shape.result }, ny, nm); } finally { state.rules = R0; }
      if (!A.isMonthObj(month2)) throw new Error(T.t("勤務表データではありません（year / month がありません）")); T.normalizeMonth(month2, rules2 || state.rules); // 作った月も採用する前に確かめる
      return { month: month2, rules: rules2 }; }
    catch (e) { return { error: e && e.message || String(e) }; }
  }
  // 作った月を採用する（設定・月・結果・同期の基準・改名の記録をまとめて置き換える。buildFromPrevious が成功したときだけ）
  function adoptNewMonth(b) {
    state.renames = []; if (b.rules) state.rules = b.rules; state.meta = null; state.base = null; state.baseRules = null; state.month = b.month; state.result = null; state.ui.doctor = 0; A.clearUndo(); A.save(); A.renderAll(); A.showTab("input");
    A.toast(T.t("{y}年{m}月 を作成しました。祝日・不可日・希望を記入し、業務を確認してください", { y: state.month.year, m: state.month.month }));
  }
  async function createFromPrevFile(f) {
    if (!f) return; if (!(await saveBeforeSwitch())) return;
    let o; try { o = JSON.parse(await f.text()); } catch (e) { return alert(T.t("読み込み失敗: {err}", { err: e })); }
    const shape = loadedShape(o); if (shape.error) return alert(T.t("読み込み失敗: {err}", { err: shape.error }));
    if (!(await saveBeforeSwitch())) return;
    const b = buildFromPrevious(o); if (b.error) return alert(T.t("読み込み失敗: {err}", { err: b.error }));
    adoptNewMonth(b);
  }
  function applyLoaded(o, msg, opts = {}) {
    const fromDir = opts.fromFolder !== false; const shape = loadedShape(o); if (shape.error) return alert(shape.error); const { month, rules, result } = shape;
    // 型検査・既定値の補完・月の整形は複製の上で済ませ、成功したときだけ状態をまとめて差し替える（途中で失敗しても、読み込む前の設定・月・結果・改名の記録・統合の基準は変わらない）
    let month2, rules2; try { const clone = x => JSON.parse(JSON.stringify(x)); rules2 = clone(rules || state.rules); T.fillDefaultRules(rules2); month2 = clone(month); T.normalizeMonth(month2, rules2); }
    catch (e) { return alert(T.t("読み込み失敗: {err}", { err: e && e.message || e })); }
    state.renames = []; // 丸ごと読み込むので、手元の改名の記録は消す
    state.month = month2; if (rules) state.rules = rules2; state.result = result;
    state.ui.doctor = 0; A.ensureMonth(state.month); A.persist();
    if (fromDir && A.dirHandle && o.month && o.rules) A.markSaved("フォルダ " + A.dirHandle.name, o.saved_at || undefined); else { state.meta = null; state.base = null; state.baseRules = null; } // 外部の JSON・フォルダ未接続は未保存
    if (A.clearUndo) A.clearUndo(); A.save(); A.renderAll(); if (typeof A.renderLangs === "function") A.renderLangs(); A.showTab("input"); A.toast(msg); // save: 未保存なら自動保存を予約（接続先との競合確認を経てフォルダに書く）
  }

  Object.assign(A, { openMonth, repaintStartGate, renderHeader, openFolderUI, reconnectFolderUI, outputCheck, downloadMonthJson, loadJsonFile, createFromPrevFile, prepareSave, writeSave, commitSave, autosaveJson, fsOK, restoreFolder, refreshMonths, loadFolderPlugins, loadPendingPlugins, reconcileWithFolder, renderFolderBar, findMonthData, writeFile, ensureFolder, saveBeforeSwitch, saveToFolder, versionSig, applyLoaded, buildFromPrevious, adoptNewMonth }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});
