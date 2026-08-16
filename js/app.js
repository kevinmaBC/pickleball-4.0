/* ============ 导航 Navigation ============ */
function go(t){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('v-'+t).classList.add('active');
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  window.scrollTo({top:0,behavior:'instant'});
}

/* ============ 数据 Data ============ */
const WEEKS=[
 {wk:'W1',focus:'规则内化+基本功',en:'Rules & Fundamentals',items:[
   ['Rally-scoring 冻结情景模拟','冻结判断零失误'],
   ['偶右奇左站位练习','连续 10 组站位零错误'],
   ['发球稳定性','发球成功率 ≥ 90%'],
   ['深接发 deep return','深接发落后 1/3 场区 ≥ 70%']]},
 {wk:'W2',focus:'减少非受迫失误',en:'Error Reduction',items:[
   ['厨房线 dink 对拉','连续 dink ≥ 15 拍不失误'],
   ['第三拍落球 3rd shot drop','drop 落厨房 ≥ 60%'],
   ['连续控制球','每局非受迫失误 ≤ 5']]},
 {wk:'W3',focus:'混双专项 I',en:'Mixed Doubles I',items:[
   ['X 打法中路分工','中路球接管无让球 ≥ 90%'],
   ['中路球归属演练','中路失分 ≤ 2 / 局'],
   ['女网前封网 poach','封网成功 ≥ 5 次/组']]},
 {wk:'W4',focus:'混双专项 II + 叠站',en:'Mixed II + Stacking',items:[
   ['stacking 切换 + 宣布流程','切换零延误 + 宣布到位'],
   ['配对轮换 A男+C女 / B男+D女','两套配对各打满 2 局'],
   ['第三拍下压 drive','下压得分率 ≥ 40%']]},
 {wk:'W5',focus:'单打耐力 I',en:'Singles Endurance I',items:[
   ['全场覆盖跑动 20×44 ft (6.10×13.41 m)','场地折返 8 趟/组'],
   ['单打变向','变向不失衡'],
   ['4 拍轮转演练','轮转即时进入状态']]},
 {wk:'W6',focus:'单打耐力 II',en:'Singles Endurance II',items:[
   ['单打对抗补短板','最弱单打点守到 ≥ 11 分'],
   ['P1→P4 轮转顺序模拟','轮转失误 = 0'],
   ['底线深球压制','深球落后区 ≥ 65%']]},
 {wk:'W7',focus:'节奏与体能',en:'Pace & Conditioning',items:[
   ['连打 4 局中间仅 2 分钟','4 局连打完成不减速'],
   ['热身模板 ≤ 3 分钟','热身 ≤ 3 分钟完成'],
   ['恢复演练','局间心率可恢复']]},
 {wk:'W8',focus:'战术与实战模拟',en:'Strategy & Match Sim',items:[
   ['暂停时机演练','暂停用在对手连得 3–4 分'],
   ['主客场排兵推演','阵容博弈全程无误'],
   ['完整 match 模拟（含 DreamBreaker）','完整模拟赛 ≥ 2 场']]}
];

const GLOSSARY=[
 ['第三拍吊球','Third Shot Drop','发球方第三拍的过渡软球，帮助上网'],
 ['重置','Reset','被动时把快球卸力软送回厨房、消压'],
 ['抽球','Drive','低平快速进攻球，多为下一拍铺垫'],
 ['半抽半吊','Drip','约 40% 力量，介于抽与吊之间打脚下'],
 ['不打/放出界','Leave','判断出界主动让球，高级防守选择'],
 ['丁克/放小球','Dink','厨房线附近轻击落入对方厨房的软球'],
 ['截击','Volley','球落地前的凌空击球'],
 ['加速球','Speed-up','网前相持中突然提速的攻击'],
 ['分腿垫步','Split Step','对手击球瞬间的微跳制动步'],
 ['叠阵','Stacking','固定强侧站位的战术性排位'],
 ['抢网','Poach','越过己方半区拦截本属搭档的球'],
 ['非截击区/厨房','NVZ / Kitchen','网前 7 ft (2.13 m) 区，内不可截击']
];

const TOC=[
 '第一篇 基础知识：第1章 概念与规则 · 第2章 握拍与准备姿势',
 '第二篇 身体基础：第3章 姿态重心呼吸 · 第4章 步法体系',
 '第三篇 技术篇：第5章 发球 · 第6章 接发 · 第7章 丁克 · 第8章 第三拍吊球 · 第9章 抽球 · 第10章 截击与快手 · 第11章 重置 · 第12章 冒高/高压/挑高',
 '第四篇 战术篇：第13章 逐拍战术流程 · 第14章 双打配合与沟通',
 '第五篇 训练篇：第15章 训练库 · 第16章 等级能力标准 · 第17章 12周计划'
];

const MODULES=[
 {n:'发球 Serve',en:'Serve',w:8,tgt:98,cur:0},
 {n:'接发 Return（高质量率）',en:'Return (High-Quality Rate)',w:14,tgt:80,cur:0},
 {n:'Drive 有效率',en:'Drive Effectiveness',w:10,tgt:75,cur:0},
 {n:'第三拍 Drop',en:'Third Shot Drop',w:14,tgt:75,cur:0},
 {n:'Reset 过渡区',en:'Reset (Transition Zone)',w:12,tgt:70,cur:0},
 {n:'Kitchen Dink（高质量）',en:'Kitchen Dink (High-Quality)',w:10,tgt:80,cur:0},
 {n:'Counter 有效率',en:'Counter Effectiveness',w:6,tgt:50,cur:0},
 {n:'Leave 判断',en:'Leave Judgment',w:6,tgt:85,cur:0},
 {n:'Shot Selection',en:'Shot Selection',w:10,tgt:85,cur:0}
];
let UE_SCORE=95, UE_PER=2;

/* 六门槛定义：读取对应模块 index 的 cur 与门槛值 */
const GATES=[
 {lab:'发球成功率',en:'Serve Success Rate',thr:'≥95%',mod:0,min:95},
 {lab:'高质量接发',en:'High-Quality Return',thr:'≥75%',mod:1,min:75},
 {lab:'Drop 成功率',en:'Drop Success Rate',thr:'≥70%',mod:3,min:70},
 {lab:'Reset 成功率',en:'Reset Success Rate',thr:'≥65%',mod:4,min:65},
 {lab:'Shot Selection',en:'Shot Selection',thr:'≥80%',mod:8,min:80},  // index 8 = Shot Selection（模块数组最后一项）
 {lab:'每局 UE',en:'UE / game',thr:'≤5 次',thrEn:'≤5/game',ue:true}
];

/* ============ 存储 Storage (localStorage) ============ */
const KEY='pb40_v1';
let STATE={tracker:{},kpi:{cur:{},ue:2}};
function load(){try{const s=localStorage.getItem(KEY);if(s)STATE=JSON.parse(s);}catch(e){}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(STATE));}catch(e){} maybeSync();}

/* ============ 渲染术语与目录 ============ */
function renderStatic(){
  document.getElementById('glossary').innerHTML=
    '<thead><tr><th>中文</th><th>英文</th><th>说明</th></tr></thead><tbody>'+
    GLOSSARY.map(g=>`<tr><td>${g[0]}</td><td class="en">${g[1]}</td><td style="color:var(--muted)">${g[2]}</td></tr>`).join('')+
    '</tbody>';
  document.getElementById('toc-note').innerHTML=
    '<b style="color:var(--ink)">全书录入进度：</b><br>'+
    '<span style="color:var(--pass)">✅ 第一篇 基础知识（第1–2章）</span><br>'+
    '<span style="color:var(--pass)">✅ 第二篇 身体基础（第3–4章）</span><br>'+
    '<span style="color:var(--pass)">✅ 第三篇 技术（第5–12章）</span><br>'+
    '<span style="color:var(--pass)">✅ 第四篇 战术（第13–14章）</span><br>'+
    '<span style="color:var(--pass)">✅ 第五篇 训练（第15–17章）+ 附录</span><br>'+
    '<span style="color:var(--pass)">✅ 决策系统 SSS 全文</span><br><br>'+
    '<b style="color:var(--ink)">🎉 全书内容已全部录入 App</b>';
}

/* ============ 打卡表 Tracker ============ */
function itemId(w,i){return WEEKS[w].wk+'_'+i;}
function renderWeeks(){
  const box=document.getElementById('weeks');
  // 记住当前展开的周次，重绘后恢复 preserve open state
  const openSet=new Set([...box.querySelectorAll('details.week')].map((d,i)=>d.open?i:-1));
  const hadRendered=box.children.length>0;
  box.innerHTML='';
  WEEKS.forEach((W,w)=>{
    const d=document.createElement('details');d.className='acc week';
    d.open = hadRendered ? openSet.has(w) : (w===0);
    let pass=0,tot=W.items.length;
    W.items.forEach((_,i)=>{if((STATE.tracker[itemId(w,i)]||{}).pass==='pass')pass++;});
    d.innerHTML=`<summary><span><span class="wk">${W.wk}</span>${W.focus}</span>
      <span class="rate">${pass}/${tot} <span class="chev">▸</span></span></summary>
      <div class="body" style="padding:6px 14px 12px">
        <div style="font-size:11px;color:var(--muted);font-family:var(--mono);margin:6px 0 4px">${W.en}</div>
        ${W.items.map((it,i)=>renderItem(w,i,it)).join('')}
      </div>`;
    box.appendChild(d);
  });
}
function renderItem(w,i,it){
  const id=itemId(w,i);const s=STATE.tracker[id]||{};
  const seg=(field,opts)=>`<div class="seg">`+opts.map(o=>
    `<button data-v="${o.v}" class="${s[field]===o.v?'on':''}" onclick="setItem('${id}','${field}','${o.v}')">${o.t}</button>`).join('')+`</div>`;
  return `<div class="item">
    <div class="name">${it[0]}</div>
    <div class="target">🎯 ${it[1]}</div>
    <div class="item-row">
      <input class="fld date" type="date" value="${s.date||''}" onchange="setField('${id}','date',this.value)">
      ${seg('done',[{v:'done',t:'完成 ✔'},{v:'skip',t:'— 未做'}])}
      ${seg('pass',[{v:'pass',t:'达标'},{v:'part',t:'部分'},{v:'fail',t:'否'}])}
      <input class="fld" type="text" placeholder="实测 Result（如 92% / 18 拍）" value="${s.result||''}" onchange="setField('${id}','result',this.value)">
    </div>
    <textarea class="fld" placeholder="备注 Notes" onchange="setField('${id}','notes',this.value)">${s.notes||''}</textarea>
  </div>`;
}
function setItem(id,field,v){
  STATE.tracker[id]=STATE.tracker[id]||{};
  STATE.tracker[id][field]=STATE.tracker[id][field]===v?'':v; // toggle
  save();renderWeeks();updateTrackerStats();
}
function setField(id,field,v){STATE.tracker[id]=STATE.tracker[id]||{};STATE.tracker[id][field]=v;save();}
function updateTrackerStats(){
  let total=0,done=0,pass=0;
  WEEKS.forEach((W,w)=>W.items.forEach((_,i)=>{
    total++;const s=STATE.tracker[itemId(w,i)]||{};
    if(s.done==='done')done++;if(s.pass==='pass')pass++;
  }));
  document.getElementById('t-done').innerHTML=(done/total*100).toFixed(0)+'%';
  document.getElementById('t-pass').innerHTML=(pass/total*100).toFixed(0)+'%';
  document.getElementById('t-items').innerHTML=`<span class="num">${done}</span>/25`;
}

/* ============ KPI Dashboard ============ */
function renderModules(){
  MODULES.forEach((m,i)=>{if(STATE.kpi.cur[i]!=null)m.cur=STATE.kpi.cur[i];});
  const box=document.getElementById('modules');box.innerHTML='';
  const wLabel = LANG==='en' ? 'Weight' : '权重';
  const tLabel = LANG==='en' ? '4.0 Target: ' : '目标 4.0：';
  MODULES.forEach((m,i)=>{
    const div=document.createElement('div');div.className='mod';
    const name = LANG==='en' ? m.en : m.n;
    div.innerHTML=`<div class="top"><span class="mn">${name}</span><span class="mw">${wLabel} ${m.w}</span></div>
      <div class="meter"><div class="fill" id="fill-${i}" style="width:${m.cur}%"></div>
        <div class="tgt" style="left:${m.tgt}%"></div></div>
      <div class="mt">${tLabel}${m.tgt}%</div>
      <div class="ctl"><input type="range" min="0" max="100" step="1" value="${m.cur}"
        oninput="setMod(${i},this.value)"><span class="pct" id="pct-${i}">${m.cur}%</span></div>`;
    box.appendChild(div);
  });
}
function setMod(i,v){v=+v;MODULES[i].cur=v;STATE.kpi.cur[i]=v;save();
  document.getElementById('fill-'+i).style.width=v+'%';
  document.getElementById('pct-'+i).textContent=v+'%';
  computeKPI();
}
function setUE(v){
  v=+v;UE_PER=v;STATE.kpi.ue=v;save();
  UE_SCORE = v<=2?95 : v<=4?85 : v<=6?77 : v<=8?68 : v<=10?58 : 45;
  document.getElementById('ue-val').textContent = LANG==='en' ? `${v} → ${UE_SCORE}` : `${v} 次 → ${UE_SCORE}`;
  computeKPI();
}
function levelOf(s){
  if(s>=90)return['4.5 及以上','4.5+'];
  if(s>=84)return['稳定 4.0','STABLE 4.0'];
  if(s>=77)return['3.75','3.75'];
  if(s>=68)return['稳定 3.5','STABLE 3.5'];
  if(s>=58)return['3.0–3.25','3.0-3.25'];
  return['基础需加强','FOUNDATION'];
}
function computeKPI(){
  // composite: sum(weight * cur/100) for 9 modules + UE module (weight 10)
  let comp=0;
  MODULES.forEach(m=>comp+=m.w*m.cur/100);
  comp += 10*UE_SCORE/100;
  const score=comp.toFixed(1);
  document.getElementById('k-score').innerHTML=score+'<small>/100</small>';
  const lv=levelOf(comp);
  document.getElementById('k-level').textContent = LANG==='en' ? lv[1] : lv[0];
  renderGates();
}
function renderGates(){
  const curLabel = LANG==='en' ? 'current' : '当前';
  ['kpi-gates','home-gates'].forEach(gid=>{
    const box=document.getElementById(gid);box.innerHTML='';
    let allOk=true;
    GATES.forEach(g=>{
      let ok,cur,thr,curTxt;
      if(g.ue){cur=UE_PER;ok=UE_PER<=5;thr=LANG==='en'?(g.thrEn||g.thr):g.thr;curTxt=LANG==='en'?String(UE_PER):(UE_PER+' 次');}
      else{cur=MODULES[g.mod].cur;ok=cur>=g.min;thr=g.thr;curTxt=cur+'%';}
      if(!ok)allOk=false;
      const el=document.createElement('div');
      el.className='gate '+(ok?'ok':(cur>0||g.ue?'no':''));
      const lab=LANG==='en'?g.en:g.lab;
      el.innerHTML=`<div class="lab">${lab}</div><div class="thr">${thr} · ${curLabel} ${curTxt}</div><div class="dot"></div>`;
      box.appendChild(el);
    });
    const vid=gid==='kpi-gates'?'kpi-verdict':'home-verdict';
    document.getElementById(vid).innerHTML= allOk
      ? (LANG==='en' ? '✅ All 6 gates green · Certified Stable 4.0' : '✅ 六门槛全绿 · 已达稳定 4.0<span class="en">CERTIFIED STABLE 4.0</span>')
      : (LANG==='en' ? '⛔ Not all green yet · Clear the red items for Stable 4.0' : '⛔ 尚未全绿 · 补齐红色项才算稳定 4.0<span class="en">GATES NOT ALL GREEN</span>');
    document.getElementById(vid).style.color=allOk?'var(--pass)':'var(--fail)';
  });
}

/* ============ 备份 Export / Import / Reset ============ */
function exportData(){
  const blob=new Blob([JSON.stringify(STATE,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='pickleball-4.0-备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();
}
function importData(e){
  const f=e.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=()=>{try{STATE=JSON.parse(r.result);save();initAll();alert('导入成功 Imported ✓');}
    catch(err){alert('文件格式有误 Invalid file');}};r.readAsText(f);
}
function resetAll(){
  if(confirm('清空全部打卡与 KPI 记录？此操作不可撤销。\nClear all records? Cannot be undone.')){
    STATE={tracker:{},kpi:{cur:{},ue:2}};save();initAll();
  }
}

/* ============ 初始化 Init ============ */
function initAll(){
  MODULES.forEach(m=>m.cur=0);
  if(STATE.kpi&&STATE.kpi.cur)MODULES.forEach((m,i)=>{if(STATE.kpi.cur[i]!=null)m.cur=STATE.kpi.cur[i];});
  UE_PER=(STATE.kpi&&STATE.kpi.ue!=null)?STATE.kpi.ue:2;
  renderWeeks();updateTrackerStats();renderModules();
  document.getElementById('ue-range').value=UE_PER;setUE(UE_PER);
}

/* ============ 阶段4 · Supabase 团队同步 ============ */
// Kevin 可把下面两行填好并重新部署，队友即零设置；留空则用 App 内「连接设置」。
let SB_URL='https://whaohhimckgryuuxxlps.supabase.co';   // Kevin 的项目 URL（已填）
let SB_KEY='https://supabase.com/dashboard/project/whaohhimckgryuuxxlps/settings/api-keys';   // anon public key

const CFG_KEY='pb40_cfg';
let CFG={url:'',key:'',team:'',player:'',autosync:true,lastSync:0};
let syncTimer=null;
const PLAYER_PRESETS=['男1','男2','女1','女2'];

function loadCfg(){
  try{const s=localStorage.getItem(CFG_KEY);if(s)CFG=Object.assign(CFG,JSON.parse(s));}catch(e){}
  if(!CFG.url&&SB_URL)CFG.url=SB_URL;
  if(!CFG.key&&SB_KEY)CFG.key=SB_KEY;
}
function saveCfg(){try{localStorage.setItem(CFG_KEY,JSON.stringify(CFG));}catch(e){}}
function sbReady(){return !!(CFG.url&&CFG.key);}
function identReady(){return sbReady()&&!!CFG.team&&!!CFG.player;}
function sbHeaders(extra){const h={'apikey':CFG.key,'Content-Type':'application/json'};if(/^eyJ/.test(CFG.key))h['Authorization']='Bearer '+CFG.key;return Object.assign(h,extra||{});}

function val(id){const e=document.getElementById(id);return e?e.value:'';}
function setSyncMsg(m){const e=document.getElementById('sync-msg');if(e)e.textContent=m;}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pad2(n){return n<10?'0'+n:''+n;}
function timeNow(ms){const d=ms?new Date(ms):new Date();return pad2(d.getHours())+':'+pad2(d.getMinutes());}
function fmtDate(iso){try{const d=new Date(iso);return (d.getMonth()+1)+'/'+d.getDate()+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());}catch(e){return '';}}

function renderPlayerSeg(){
  const box=document.getElementById('player-seg');if(!box)return;
  box.innerHTML='<div class="seg">'+PLAYER_PRESETS.map(p=>
    '<button class="'+(CFG.player===p?'on':'')+'" data-v="done" onclick="pickPlayer(\''+p+'\')">'+p+'</button>').join('')+'</div>';
}
function pickPlayer(p){CFG.player=p;const n=document.getElementById('name-custom');if(n)n.value='';renderPlayerSeg();}

function renderSyncStatus(){
  const el=document.getElementById('sync-status');if(!el)return;
  if(!sbReady()){el.innerHTML='① 先在「连接设置」填 Supabase URL 与 key。';return;}
  if(!CFG.team||!CFG.player){el.innerHTML='② 已连接。请填队伍代码并选择"我是"。';return;}
  const t=CFG.lastSync?('最后同步 '+timeNow(CFG.lastSync)):'尚未同步';
  el.innerHTML='已连接 · 队伍 <b>'+escapeHtml(CFG.team)+'</b> · 球员 <b>'+escapeHtml(CFG.player)+'</b><br>自动同步 '+(CFG.autosync?'开':'关')+' · '+t;
}
function renderTeam(){
  const g=id=>document.getElementById(id);
  if(g('sb-url'))g('sb-url').value=CFG.url||'';
  if(g('sb-key'))g('sb-key').value=CFG.key||'';
  if(g('team-code'))g('team-code').value=CFG.team||'';
  if(g('name-custom'))g('name-custom').value=(PLAYER_PRESETS.includes(CFG.player)?'':(CFG.player||''));
  if(g('autosync'))g('autosync').checked=!!CFG.autosync;
  renderPlayerSeg();renderSyncStatus();
  const acc=g('conn-acc');if(acc)acc.open=!sbReady();
}

function saveConn(){
  let u=val('sb-url').trim();while(u.endsWith('/'))u=u.slice(0,-1);
  CFG.url=u;CFG.key=val('sb-key').trim();saveCfg();renderSyncStatus();
  setSyncMsg(sbReady()?'✅ 连接已保存。':'请填完整 URL 与 key。');
  const acc=document.getElementById('conn-acc');if(acc&&sbReady())acc.open=false;
}
function saveIdent(){
  CFG.team=val('team-code').trim();const c=val('name-custom').trim();if(c)CFG.player=c;
  if(!CFG.team||!CFG.player){setSyncMsg('请填队伍代码并选择/输入球员。');return;}
  saveCfg();renderSyncStatus();setSyncMsg('身份已保存，正在上传…');pushMine(false);
}

async function pushMine(silent){
  if(!identReady()){if(!silent)setSyncMsg('请先保存连接与身份。');return;}
  try{
    const body=[{team:CFG.team,player:CFG.player,data:STATE,updated_at:new Date().toISOString()}];
    const r=await fetch(CFG.url+'/rest/v1/records?on_conflict=team,player',{method:'POST',
      headers:sbHeaders({'Prefer':'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(body)});
    if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,120));
    CFG.lastSync=Date.now();saveCfg();renderSyncStatus();if(!silent)setSyncMsg('✅ 已上传 '+timeNow());
  }catch(e){setSyncMsg('⚠️ 上传失败：'+e.message);}
}
async function pullMine(){
  if(!identReady()){setSyncMsg('请先保存连接与身份。');return;}
  if(!confirm('从云端拉取会覆盖本设备当前记录，确定？')) return;
  try{
    const url=CFG.url+'/rest/v1/records?team=eq.'+encodeURIComponent(CFG.team)+'&player=eq.'+encodeURIComponent(CFG.player)+'&select=data,updated_at';
    const r=await fetch(url,{headers:sbHeaders()});if(!r.ok)throw new Error(r.status);
    const rows=await r.json();
    if(!rows.length){setSyncMsg('云端还没有你的记录，先上传一次。');return;}
    STATE=rows[0].data||{tracker:{},kpi:{cur:{},ue:2}};save();initAll();
    CFG.lastSync=Date.now();saveCfg();renderSyncStatus();setSyncMsg('✅ 已从云拉取 '+timeNow());
  }catch(e){setSyncMsg('⚠️ 拉取失败：'+e.message);}
}
function maybeSync(){
  if(!(CFG.autosync&&identReady()))return;
  clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushMine(true),1200);
}

function ueScoreOf(v){return v<=2?95:v<=4?85:v<=6?77:v<=8?68:v<=10?58:45;}
function summaryOf(st){
  st=st||{};const tr=st.tracker||{};const kp=st.kpi||{};const cur=kp.cur||{};const ue=(kp.ue!=null)?kp.ue:2;
  let tot=0,pass=0;
  WEEKS.forEach((W,w)=>W.items.forEach((_,i)=>{tot++;const s=tr[W.wk+'_'+i]||{};if(s.pass==='pass')pass++;}));
  let comp=0;MODULES.forEach((m,i)=>comp+=m.w*((cur[i]||0)/100));comp+=10*ueScoreOf(ue)/100;
  const gates=[(cur[0]||0)>=95,(cur[1]||0)>=75,(cur[3]||0)>=70,(cur[4]||0)>=65,(cur[8]||0)>=80,ue<=5];
  return {passRate:Math.round(pass/tot*100),comp:comp.toFixed(1),level:levelOf(comp)[0],gates:gates.filter(Boolean).length};
}
async function loadCoach(){
  const cm=document.getElementById('coach-table');
  if(!sbReady()||!CFG.team){cm.innerHTML='<div style="font-size:13px;color:var(--muted)">先填连接设置与队伍代码。</div>';return;}
  cm.innerHTML='<div style="font-size:13px;color:var(--muted)">加载中…</div>';
  try{
    const url=CFG.url+'/rest/v1/records?team=eq.'+encodeURIComponent(CFG.team)+'&select=player,data,updated_at&order=player';
    const r=await fetch(url,{headers:sbHeaders()});if(!r.ok)throw new Error(r.status);
    renderCoach(await r.json());
  }catch(e){cm.innerHTML='<div style="font-size:13px;color:var(--fail)">⚠️ 加载失败：'+escapeHtml(e.message)+'</div>';}
}
function renderCoach(rows){
  const cm=document.getElementById('coach-table');
  if(!rows||!rows.length){cm.innerHTML='<div style="font-size:13px;color:var(--muted)">该队伍云端暂无记录。</div>';return;}
  let h='<table class="tbl"><thead><tr><th>球员</th><th>达标</th><th>KPI</th><th>水平</th><th>门槛</th><th>更新</th></tr></thead><tbody>';
  rows.forEach(r=>{const s=summaryOf(r.data);
    const gc=s.gates===6?'var(--pass)':(s.gates>=4?'var(--part)':'var(--fail)');
    h+='<tr><td>'+escapeHtml(r.player)+'</td><td class="num">'+s.passRate+'%</td><td class="num">'+s.comp+'</td><td style="font-size:12px">'+s.level+'</td><td class="num" style="color:'+gc+';font-weight:700">'+s.gates+'/6</td><td style="font-size:11px;color:var(--muted)">'+fmtDate(r.updated_at)+'</td></tr>';});
  h+='</tbody></table>';cm.innerHTML=h;
}



/* ============ 反馈 Feedback ============ */
let FB_RATE=0;
function renderFbRate(){
  const opts=[['👍 好',5],['😐 一般',3],['👎 差',1]];
  document.getElementById('fb-rate').innerHTML=opts.map(o=>
    '<button data-v="done" class="'+(FB_RATE===o[1]?'on':'')+'" onclick="FB_RATE='+o[1]+';renderFbRate()">'+o[0]+'</button>').join('');
}
function openFeedback(){document.getElementById('fb-bg').classList.add('on');renderFbRate();
  document.getElementById('fb-status').textContent='';}
function closeFeedback(){document.getElementById('fb-bg').classList.remove('on');}
async function submitFeedback(){
  const msg=(document.getElementById('fb-msg').value||'').trim();
  const st=document.getElementById('fb-status');
  if(!msg){st.textContent='请先写点内容 :)';return;}
  if(!sbReady()){st.textContent='⚠️ 反馈通道未配置（需管理员在「队 · 连接设置」填入连接）。';return;}
  st.textContent='提交中…';
  try{
    const body=[{rating:FB_RATE||null,message:msg,
      contact:(document.getElementById('fb-contact').value||'').trim()||null,
      context:'view:'+((document.querySelector('nav.tabs button.on')||{}).dataset||{}).t+' team:'+(CFG.team||''),
      ua:navigator.userAgent.slice(0,180)}];
    const r=await fetch(CFG.url+'/rest/v1/feedback',{method:'POST',headers:sbHeaders({'Prefer':'return=minimal'}),body:JSON.stringify(body)});
    if(!r.ok)throw new Error(r.status+' '+(await r.text()).slice(0,100));
    st.textContent='✅ 已提交，谢谢！';
    document.getElementById('fb-msg').value='';document.getElementById('fb-contact').value='';FB_RATE=0;
    setTimeout(closeFeedback,900);
  }catch(e){st.textContent='⚠️ 提交失败：'+e.message;}
}

load();loadCfg();renderStatic();initAll();renderTeam();
