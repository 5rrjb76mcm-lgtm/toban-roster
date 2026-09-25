import base64, pathlib
js = pathlib.Path("package/build/highs.js").read_text()
wasm_b64 = base64.b64encode(pathlib.Path("package/build/highs.wasm").read_bytes()).decode()
html = r'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>当直表アプリ 動作検査</title>
<style>
body{font-family:"Yu Gothic UI","Meiryo",system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px} .ok{color:#137333} .ng{color:#b3261e} .pending{color:#777}
table{border-collapse:collapse;margin:8px 0} td,th{border:1px solid #bbb;padding:4px 10px;text-align:left}
button{padding:6px 14px;margin:4px 6px 4px 0} pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}
</style></head><body>
<h1>当直表アプリ 動作検査（このファイル1枚で完結）</h1>
<p>ファイルサーバー上のHTMLをEdgeで開いた状態で、計算エンジン（WASM）・ファイル読み込み・ダウンロード・保存領域が使えるかを確認します。<b>結果をコピー</b>で得た文字列を送ってください。</p>
<table id="t">
<tr><th>項目</th><th>結果</th><th>詳細</th></tr>
<tr><td>1 ブラウザ</td><td id="r1" class="pending">…</td><td id="d1"></td></tr>
<tr><td>2 WebAssembly 対応</td><td id="r2" class="pending">…</td><td id="d2"></td></tr>
<tr><td>3 計算エンジン読込（HiGHS 3.4MB 埋込）</td><td id="r3" class="pending">…</td><td id="d3"></td></tr>
<tr><td>4 小さな最適化問題</td><td id="r4" class="pending">…</td><td id="d4"></td></tr>
<tr><td>5 当直表と同規模の整数計画（速度）</td><td id="r5" class="pending">…</td><td id="d5"></td></tr>
<tr><td>6 保存領域（localStorage）</td><td id="r6" class="pending">…</td><td id="d6"></td></tr>
<tr><td>7 ファイル読み込み</td><td id="r7" class="pending">未実施</td><td id="d7"><input type="file" id="f7"> 任意のファイルを選んでください</td></tr>
<tr><td>8 ダウンロード</td><td id="r8" class="pending">未実施</td><td id="d8"><button id="b8">テスト用ファイルをダウンロード</button> 保存ダイアログまたは自動保存が起きればOK</td></tr>
</table>
<button id="copy">結果をコピー</button> <span id="copied"></span>
<pre id="log"></pre>
<script>
''' + js + r'''
</script>
<script>
const WASM_B64 = "''' + wasm_b64 + r'''";
const log = (s)=>{document.getElementById('log').textContent += s + "\n";};
const set = (n, ok, detail)=>{const r=document.getElementById('r'+n); r.textContent = ok===null?'―':(ok?'OK':'NG'); r.className = ok===null?'pending':(ok?'ok':'ng'); if(detail!==undefined) document.getElementById('d'+n).textContent = detail;};
function b64ToBytes(b64){const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;}
function synthLP(){
  // 41枠×13人。各枠1人、各人回数[q-1,q+1]、連日禁止、不可日、ランダム費用
  const days=30, holidays=new Set([1,3,7,8,14,15,21,22,23,28,29]);
  const slots=[]; for(let d=1;d<=days;d++){ if(holidays.has(d)) slots.push([d,'D']); slots.push([d,'N']); }
  const docs=13, quota=[2,2,2,3,2,2,4,4,5,5,5,5,5];
  let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff;};
  const v=(s,k)=>`x_${s}_${k}`;
  let obj=[], cons=[], bins=[], bounds=[];
  slots.forEach((sl,si)=>{ for(let k=0;k<docs;k++){ obj.push(`${(1+Math.floor(rnd()*9))} ${v(si,k)}`); bins.push(v(si,k)); if(rnd()<0.15) bounds.push(`${v(si,k)} = 0`);} });
  slots.forEach((sl,si)=>{ cons.push(`c_slot${si}: ` + Array.from({length:docs},(_,k)=>v(si,k)).join(' + ') + ' = 1'); });
  for(let k=0;k<docs;k++){ const t=slots.map((sl,si)=>v(si,k)).join(' + '); cons.push(`c_qlo${k}: ${t} >= ${quota[k]-1}`); cons.push(`c_qhi${k}: ${t} <= ${quota[k]+1}`); }
  for(let k=0;k<docs;k++){ for(let d=1;d<days;d++){ const a=slots.map((sl,si)=>sl[0]===d?v(si,k):null).filter(Boolean), b=slots.map((sl,si)=>sl[0]===d+1?v(si,k):null).filter(Boolean); cons.push(`c_cons${k}_${d}: ${a.concat(b).join(' + ')} <= 1`); } }
  return `Minimize\n obj: ${obj.join(' + ')}\nSubject To\n${cons.join('\n')}\nBounds\n${bounds.join('\n')}\nBinary\n${bins.join('\n')}\nEnd\n`;
}
(async()=>{
  set(1, true, navigator.userAgent + ' | URL: ' + location.protocol + ' | ' + new Date().toLocaleString('ja-JP'));
  set(2, typeof WebAssembly === 'object', typeof WebAssembly === 'object' ? 'WebAssembly オブジェクトあり' : '未対応');
  let highs=null;
  try{
    const t0=performance.now();
    highs = await Module({ wasmBinary: b64ToBytes(WASM_B64), print:()=>{}, printErr:()=>{} });
    set(3, true, `読込 ${((performance.now()-t0)/1000).toFixed(2)} 秒`);
  }catch(e){ set(3, false, String(e)); log('HiGHS load error: '+e); }
  if(highs){
    try{
      const sol = highs.solve("Maximize\n obj: x + 2 y\nSubject To\n c1: x + y <= 4\n c2: x - y >= -2\nBounds\n 0 <= x <= 3\n 0 <= y\nEnd\n");
      const ok = sol.Status==='Optimal' && Math.abs(sol.ObjectiveValue-7)<1e-6;
      set(4, ok, `状態 ${sol.Status}、目的関数 ${sol.ObjectiveValue}（期待 7）`);
    }catch(e){ set(4,false,String(e)); }
    try{
      const lp = synthLP(); const t0=performance.now();
      const sol = highs.solve(lp, { time_limit: 120 });
      const sec=(performance.now()-t0)/1000;
      set(5, sol.Status==='Optimal' || sol.Status==='Time limit reached', `状態 ${sol.Status}、${sec.toFixed(1)} 秒、目的関数 ${sol.ObjectiveValue}`);
    }catch(e){ set(5,false,String(e)); log('MIP error: '+e); }
  } else { set(4,null,'エンジン未読込'); set(5,null,'エンジン未読込'); }
  try{ localStorage.setItem('toban_probe', 'ok'); const v=localStorage.getItem('toban_probe'); set(6, v==='ok', v==='ok'?'読み書き可':'読み戻し失敗'); }catch(e){ set(6,false,String(e)); }
})();
document.getElementById('f7').addEventListener('change', (ev)=>{
  const f=ev.target.files[0]; if(!f) return; const rd=new FileReader();
  rd.onload=()=>{ set(7,true,`${f.name}（${f.size} バイト）先頭16バイト読み取り可`); };
  rd.onerror=()=>set(7,false,String(rd.error)); rd.readAsArrayBuffer(f.slice(0,16));
});
document.getElementById('b8').addEventListener('click', ()=>{
  try{ const blob=new Blob(["当直表アプリ ダウンロード検査 "+new Date().toISOString()],{type:'text/plain'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='toban-probe.txt'; document.body.appendChild(a); a.click(); a.remove();
    set(8,true,'ダウンロードを開始しました（保存されたか確認してください）'); }catch(e){ set(8,false,String(e)); }
});
document.getElementById('copy').addEventListener('click', async()=>{
  const rows=[...document.querySelectorAll('#t tr')].slice(1).map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | '));
  const text=rows.join('\n'); try{ await navigator.clipboard.writeText(text); document.getElementById('copied').textContent='コピーしました'; }catch(e){ document.getElementById('log').textContent=text; document.getElementById('copied').textContent='下の欄に表示しました（手動でコピー）'; }
});
</script></body></html>
'''
pathlib.Path("toban-probe.html").write_text(html)
print("written", pathlib.Path("toban-probe.html").stat().st_size, "bytes")
