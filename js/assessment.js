/* ============================================================
 * assessment.js — Pickleball App 2.0 Alpha · S1 UI + S2 增强
 * S1：New Assessment 全流程（Tier → Target → T01–T07 Session → 逐 Trial S/P/F/I → 导出）
 * S2-A：详情页显示每项 ball-quality 主指标 %（raw，不判级）
 * S2-B：建 Session 用正式表单（不再弹窗输序号）；评估/Session 可删除
 * i18n：全部用户可见文案通过全局 LANG（js/i18n.js）做中/EN 切换。
 * ============================================================ */
(function () {
  'use strict';
  var ROOT_ID = 'a1-app';
  var el = null;
  var ui = { screen: 'home', draft: {}, assessment_id: null, session: null, pendingTestId: null, sessDraft: {} };
  var LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];

  function TIER_LABEL(k) {
    var M = {
      lite: LANG === 'en' ? 'Lite · Weekly Check' : 'Lite 周度快检',
      standard: LANG === 'en' ? 'Standard · Level Check' : 'Standard 等级检查',
      full: LANG === 'en' ? 'Full · Quarterly/Promotion' : 'Full 季度/晋级'
    };
    return M[k] || k;
  }
  function FEED_LABEL(k) {
    var M = {
      machine: LANG === 'en' ? 'Machine' : '发球机 Machine',
      calibrated_human: LANG === 'en' ? 'Calibrated Human Feed' : '标定喂球 Calibrated',
      partner: LANG === 'en' ? 'Partner' : '搭档 Partner',
      live_match: LANG === 'en' ? 'Live Match' : '实战 Live match'
    };
    return M[k] || k;
  }
  function OUT_LABEL(k) {
    var M = {
      S: LANG === 'en' ? 'S Success' : 'S 成功',
      P: LANG === 'en' ? 'P Partial' : 'P 部分',
      F: LANG === 'en' ? 'F Fail' : 'F 失败',
      I: LANG === 'en' ? 'I Invalid' : 'I 无效'
    };
    return M[k] || k;
  }

  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function h(html){ el.innerHTML = html; }
  function metricLine(m){
    if(!m || m.quality_pct==null) return '<span class="a1-mut">'+ (m?esc(m.metric_key):'') +(LANG==='en'?' — (no valid trials)':' —（无有效 trial）') +'</span>';
    var c=m.counts||{};
    var parts=['S'+(c.S||0)]; if(c.P)parts.push('P'+c.P); parts.push('F'+(c.F||0)); if(c.I)parts.push('I'+c.I);
    return '<b>'+m.quality_pct+'%</b> <span class="a1-mut">'+esc(m.metric_key)+' · n'+m.n_valid+' ('+parts.join('/')+')</span>';
  }

  function render() {
    if (!el) return;
    if (ui.screen === 'home')        return renderHome();
    if (ui.screen === 'new')         return renderNew();
    if (ui.screen === 'detail')      return renderDetail();
    if (ui.screen === 'session-new') return renderSessionNew();
    if (ui.screen === 'preview')     return renderPreview();
    if (ui.screen === 'match')       return renderMatch();
    if (ui.screen === 'record')      return renderRecord();
  }

  function renderHome() {
    Promise.all([PBStore.listAssessments(), PBStore.listPlayers()]).then(function (r) {
      var list=r[0], players=r[1];
      var pmap={}; players.forEach(function(p){pmap[p.player_id]=p.display_name;});
      list.sort(function(a,b){return (b.created_at||'').localeCompare(a.created_at||'');});
      var rows = list.length ? list.map(function (a) {
        return '<div class="a1-row"><div><b>'+esc(pmap[a.player_id]||'—')+'</b> '+
          '<span class="a1-mut">· '+esc(a.assessment_tier)+' · '+(LANG==='en'?'Target ':'目标 ')+a.target_training_level.toFixed(1)+' · '+esc(a.assessment_date)+'</span></div>'+
          '<div><button class="btn" data-act="open" data-id="'+a.assessment_id+'">'+(LANG==='en'?'Open':'打开')+'</button> '+
          '<button class="btn solid" data-act="export" data-id="'+a.assessment_id+'">'+(LANG==='en'?'Export':'导出')+'</button> '+
          '<button class="btn" data-act="del-asm" data-id="'+a.assessment_id+'" style="color:var(--fail)">'+(LANG==='en'?'Delete':'删')+'</button></div></div>';
      }).join('') : '<div class="a1-mut">'+(LANG==='en'?'No assessments yet. Tap the button above to create one.':'还没有评估记录。点上方按钮新建。')+'</div>';
      h('<div class="a1-h">'+(LANG==='en'?'Assessment Data Core':'评估数据核心 <span class="en">Assessment Data Core</span>')+'</div>'+
        '<div class="a1-sub">V2.3.1 · schema '+PBConfig.versions.schema_version+' / benchmark '+PBConfig.versions.benchmark_version+' / protocol '+PBConfig.versions.protocol_version+'</div>'+
        '<button class="btn solid" data-act="new" style="margin-bottom:12px">'+(LANG==='en'?'＋ New Assessment':'＋ 新建评估 New Assessment')+'</button>'+ rows);
    });
  }

  function chip(label, act, key, val, selected) {
    return '<span class="a1-chip'+(selected?' sel':'')+'" data-act="'+act+'" data-'+key+'="'+val+'">'+esc(label)+'</span>';
  }

  function renderNew() {
    PBStore.listPlayers().then(function (players) {
      var d = ui.draft;
      var playerChips = players.map(function (p) { return chip(p.display_name,'pick-player','pid',p.player_id,d.player_id===p.player_id); }).join('');
      var tierChips = PBConfig.tierIds.map(function (t) { return chip(TIER_LABEL(t),'pick-tier','tier',t,d.tier===t); }).join('');
      var lvlChips  = LEVELS.map(function (L) { return chip(L.toFixed(1),'pick-level','lvl',L,d.target===L); }).join('');
      var canCreate = (d.player_id || (d.newName && d.newName.trim())) && d.tier && d.target;
      h('<div class="a1-h">'+(LANG==='en'?'New Assessment':'新建评估 New Assessment')+'</div>'+
        '<label class="a1-mut">'+(LANG==='en'?'① Player':'① 球员 Player')+'</label><div>'+(playerChips||'')+
          '</div><input class="fld" id="a1-newname" placeholder="'+(LANG==='en'?'Or add a new player: enter display name':'或新建球员：输入姓名 display_name')+'" style="margin:8px 0" value="'+esc(d.newName||'')+'">'+
        '<label class="a1-mut">'+(LANG==='en'?'② Tier':'② 层级 Tier')+'</label><div>'+tierChips+'</div>'+
        '<label class="a1-mut" style="display:block;margin-top:10px">'+(LANG==='en'?'③ Target Level':'③ 目标等级 Target Level')+'</label><div>'+lvlChips+'</div>'+
        '<div class="a1-row" style="border:none;margin-top:14px"><button class="btn" data-act="home">'+(LANG==='en'?'Cancel':'取消')+'</button>'+
          '<button class="btn solid" data-act="create-asm"'+(canCreate?'':' disabled style="opacity:.5"')+'>'+(LANG==='en'?'Create Assessment':'创建 Assessment')+'</button></div>');
      var nameInput = document.getElementById('a1-newname');
      if (nameInput) nameInput.oninput = function(){ ui.draft.newName=this.value; ui.draft.player_id=null; };
    });
  }

  function renderDetail() {
    var aid = ui.assessment_id;
    Promise.all([PBStore.get('assessments',aid), PBStore.sessionsByAssessment(aid), PBMetrics.computeAssessment(aid)])
      .then(function (r) {
        var a=r[0], sessions=r[1]||[], metrics=r[2].per_test||{}, match=r[2].match||null;
        var byTest={}; sessions.forEach(function(s){ if(!byTest[s.test_id]) byTest[s.test_id]=s; });
        var rows = PBConfig.testIds.map(function (tid) {
          var t=PBConfig.tests[tid]||{name:tid}; var s=byTest[tid]; var m=metrics[tid];
          var pflag=PBConfig.partialAllowed(tid)?'':(LANG==='en'?' <span class="a1-mut">(no P)</span>':' <span class="a1-mut">(无 P)</span>');
          var right, second='';
          if(s){
            right='<button class="btn solid" data-act="record" data-sid="'+s.test_session_id+'">'+(LANG==='en'?'Record':'记录')+'</button> '+
                  '<button class="btn" data-act="del-session" data-sid="'+s.test_session_id+'" style="color:var(--fail)">'+(LANG==='en'?'Delete':'删')+'</button>';
            var comp='';
            if(m && m.sample_target){ comp=' · '+(LANG==='en'?'Sampling ':'抽样 ')+m.n_valid+'/'+m.sample_target+(m.sample_complete?' ✓':''); }
            second='<div class="a1-mut" style="padding:2px 0 0">'+FEED_LABEL(s.feed_mode)+' · '+metricLine(m)+comp+'</div>';
          } else {
            right='<button class="btn" data-act="new-session" data-tid="'+tid+'">'+(LANG==='en'?'Create Session':'创建 Session')+'</button>';
          }
          return '<div class="a1-row" style="flex-wrap:wrap"><div style="flex:1 1 55%"><b>'+tid+'</b> '+esc(t.name)+pflag+second+'</div><div>'+right+'</div></div>';
        }).join('');
        h('<div class="a1-h"><button class="btn" data-act="home" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+esc(a?a.assessment_tier:'')+' · '+(LANG==='en'?'Target ':'目标 ')+(a?a.target_training_level.toFixed(1):'')+'</div>'+
          '<div class="a1-sub">'+aid+'</div>'+ rows +
          '<div class="a1-mut" style="margin-top:10px">'+(LANG==='en'
            ? 'Each row shows the raw primary metric % (weighted success/valid trials) + sampling completeness (recorded/target). Includes T08 Decision / T09 Pressure. Still no level rating, no composite score, no gate thresholds.'
            : '各项显示"原始主指标%（加权成功/有效试验）+ 抽样完整度（已录/目标）"。含 T08 决策 / T09 抗压；仍不判级、不算综合分、不设门槛。')+'</div>'+
          '<div class="a1-row" style="border:none;margin-top:8px"><div class="a1-mut">'+(LANG==='en'?'Match T10-lite: ':'实战 T10-lite：')+(match&&match.ue_per_game!=null?((LANG==='en'?'UE/game ':'每局UE ')+match.ue_per_game):(LANG==='en'?'UE not recorded':'UE 未录'))+' · '+(match&&match.match_transfer_score!=null?((LANG==='en'?'Transfer score ':'转化分 ')+match.match_transfer_score):(LANG==='en'?'Transfer score not recorded':'转化分 未录'))+'</div>'+
            '<button class="btn" data-act="match" data-id="'+aid+'">'+(LANG==='en'?'Match Entry':'实战录入')+'</button></div>'+
          '<div class="a1-row" style="border:none;margin-top:12px">'+
            '<button class="btn" data-act="preview" data-id="'+aid+'">'+(LANG==='en'?'Readiness Preview':'就绪度预览')+'</button>'+
            '<button class="btn solid" data-act="export" data-id="'+aid+'">'+(LANG==='en'?'Export JSON':'导出 JSON')+'</button></div>');
      });
  }

  function renderSessionNew() {
    var tid=ui.pendingTestId; var t=PBConfig.tests[tid]||{name:tid}; var d=ui.sessDraft;
    var modeChips = PBConfig.feedModes.map(function(m){ return chip(FEED_LABEL(m),'pick-feed','feed',m,d.feed_mode===m); }).join('');
    var showFeeder = d.feed_mode && d.feed_mode!=='machine';
    var showCal = d.feed_mode==='calibrated_human';
    h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+ui.assessment_id+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+(LANG==='en'?'New Session · ':'新建 Session · ')+tid+' '+esc(t.name)+'</div>'+
      '<label class="a1-mut">'+(LANG==='en'?'Feed Mode':'喂球方式 Feed Mode')+'</label><div>'+modeChips+'</div>'+
      (showFeeder?'<input class="fld" id="a1-feeder" placeholder="'+(LANG==='en'?'feeder_id — feeder identifier (optional)':'feeder_id 喂球者标识（可留空）')+'" style="margin:8px 0" value="'+esc(d.feeder_id||'')+'">':'')+
      (showCal?'<input class="fld" id="a1-cal" placeholder="'+(LANG==='en'?'feeder_calibration_id — calibration ID (optional)':'feeder_calibration_id 标定编号（可留空）')+'" style="margin:0 0 8px" value="'+esc(d.cal||'')+'">':'')+
      '<div class="a1-row" style="border:none;margin-top:12px"><button class="btn" data-act="open" data-id="'+ui.assessment_id+'">'+(LANG==='en'?'Cancel':'取消')+'</button>'+
        '<button class="btn solid" data-act="create-session"'+(d.feed_mode?'':' disabled style="opacity:.5"')+'>'+(LANG==='en'?'Create Session':'创建 Session')+'</button></div>');
    var fi=document.getElementById('a1-feeder'); if(fi) fi.oninput=function(){ui.sessDraft.feeder_id=this.value;};
    var ci=document.getElementById('a1-cal'); if(ci) ci.oninput=function(){ui.sessDraft.cal=this.value;};
  }

  function renderPreview() {
    var aid = ui.assessment_id;
    el.innerHTML = '<div class="a1-mut">'+(LANG==='en'?'Computing readiness…':'计算就绪度…')+'</div>';
    PBPreview.forAssessment(aid).then(function (P) {
      if (P.unsupported) { h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button></div><div class="a1-mut">'+(LANG==='en'?'No gate table yet for target level ':'目标等级 ')+esc(P.target)+(LANG==='en'?'.':' 暂无门槛表。')+'</div>'); return; }
      var STAT = LANG==='en'
        ? { met:['Met ✓','var(--pass)'], borderline:['Borderline ~','var(--part)'], not_met:['Not Met ✗','var(--fail)'], no_data:['No Data','var(--muted)'], not_captured:['Not Captured · Pending T10','var(--muted)'] }
        : { met:['达标 ✓','var(--pass)'], borderline:['边缘 ~','var(--part)'], not_met:['未达 ✗','var(--fail)'], no_data:['无数据','var(--muted)'], not_captured:['未采集·待T10','var(--muted)'] };
      var rows = P.rows.map(function (x) {
        var s = STAT[x.status] || ['?','var(--muted)']; var op = x.direction==='max' ? '≤' : '≥'; var mid='';
        if (x.status==='not_captured') mid='';
        else if (x.status==='no_data') mid='<span class="a1-mut">'+op+x.threshold+(LANG==='en'?' (not recorded)':'（未录）')+'</span>';
        else { var samp = x.min_required ? (' · '+(LANG==='en'?'Sample ':'样本 ')+x.n_valid+'/'+x.min_required+(x.sample_ok?'':(LANG==='en'?' ⚠ insufficient':' ⚠不足'))) : ''; mid='<b>'+x.current+'%</b> <span class="a1-mut">'+op+x.threshold+samp+'</span>'; }
        return '<div class="a1-row"><div style="flex:1 1 58%"><b>'+esc(x.key)+'</b><div class="a1-mut" style="padding:2px 0 0">'+mid+'</div></div><div style="color:'+s[1]+';font-weight:700;white-space:nowrap">'+s[0]+'</div></div>';
      }).join('');
      var t = P.tally;
      var summary = LANG==='en'
        ? ('Target '+esc(P.target)+' ('+esc(P.tier)+'): '+t.total+' comparable → Met '+t.met+' · Borderline '+t.borderline+' · Not Met '+t.not_met+(t.no_data?(' · No Data '+t.no_data):'')+(t.not_captured?(' · Not Captured '+t.not_captured):'')+(t.sample_short?(' · Sample Short '+t.sample_short):''))
        : ('目标 '+esc(P.target)+'（'+esc(P.tier)+'）：可比 '+t.total+' 项 → 达标 '+t.met+' · 边缘 '+t.borderline+' · 未达 '+t.not_met+(t.no_data?(' · 无数据 '+t.no_data):'')+(t.not_captured?(' · 未采集 '+t.not_captured):'')+(t.sample_short?(' · 样本不足 '+t.sample_short):''));
      h('<div style="background:var(--ink);color:#fff;padding:8px 12px;border-radius:10px;font-weight:800;margin-bottom:10px;line-height:1.35">'+(LANG==='en'
          ? 'Readiness Preview<br><span style="font-weight:600;font-size:12px">NOT an official rating</span>'
          : '就绪度预览 · 非官方评级<br><span style="font-weight:600;font-size:12px">Readiness Preview — NOT an official rating</span>')+'</div>'+
        '<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button></div>'+
        rows +
        '<div class="a1-mut" style="margin-top:10px">'+esc(summary)+'</div>'+
        '<div class="a1-mut" style="margin-top:6px">'+(LANG==='en'
          ? 'Item-by-item comparison only — no composite score, no official level. Capability composite and UE / match_transfer are pending (T10). Percentages are indicative only when sample size is short.'
          : '仅逐项比对，不综合、不判官方等级；capability 综合分与 UE / match_transfer 均待后续（T10）。样本不足时百分比仅供参考。')+'</div>');
    }).catch(function (e) { el.innerHTML='<div class="a1-mut">'+(LANG==='en'?'Preview failed: ':'预览失败：')+esc(e.message)+'</div>'; });
  }

  function renderMatch() {
    var aid = ui.assessment_id;
    PBStore.get('assessments', aid).then(function (a) {
      var ue = a.ue || { games: 0, counts: {} };
      var mt = a.match_transfer || {};
      ui.matchDraft = {
        games: ue.games || 0,
        counts: Object.assign({ serve:0, return:0, drive:0, drop:0, dink:0, reset:0, other:0 }, ue.counts || {}),
        decision: mt.decision||0, transition: mt.transition||0, pressure: mt.pressure||0, attack: mt.attack||0
      };
      var d = ui.matchDraft;
      var ueTypes = LANG==='en'
        ? [['serve','Serve'],['return','Return'],['drive','Drive'],['drop','Drop'],['dink','Dink'],['reset','Reset'],['other','Other']]
        : [['serve','发球'],['return','接发'],['drive','Drive'],['drop','Drop'],['dink','Dink'],['reset','Reset'],['other','其它']];
      var ueInputs = ueTypes.map(function (t) {
        return '<div class="a1-row"><div>'+t[1]+'</div><input class="fld" style="width:84px" type="number" min="0" data-ue="'+t[0]+'" value="'+(d.counts[t[0]]||0)+'"></div>';
      }).join('');
      var dims = LANG==='en'
        ? [['decision','Decision'],['transition','Transition'],['pressure','Pressure'],['attack','Attack Conversion']]
        : [['decision','决策 Decision'],['transition','过渡 Transition'],['pressure','抗压 Pressure'],['attack','进攻转化 Attack']];
      var dimInputs = dims.map(function (t) {
        return '<div class="a1-row"><div>'+t[1]+'</div><input class="fld" style="width:84px" type="number" min="0" max="100" data-mt="'+t[0]+'" value="'+(d[t[0]]||0)+'"></div>';
      }).join('');
      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+(LANG==='en'?'Match Entry (T10-lite)':'实战录入 Match (T10-lite)')+'</div>'+
        '<div class="a1-sub">'+(LANG==='en'
          ? 'Simplified version: only captures UE and a transfer verification score, to complete the readiness preview — not rally-by-rally coding, not an official rating.'
          : '简化版：只采 UE 与转化验证分，用于补全就绪度预览；非逐拍编码，非官方评级。')+'</div>'+
        '<div class="a1-h" style="font-size:13px">'+(LANG==='en'?'① Unforced Errors (UE, by type)':'① 非受迫失误 UE（按类型计数）')+'</div>'+
        '<div class="a1-row"><div>'+(LANG==='en'?'Games':'局数 Games')+'</div><input class="fld" style="width:84px" type="number" min="0" id="ue-games" value="'+(d.games||0)+'"></div>'+
        ueInputs +
        '<div class="a1-row"><div><b>'+(LANG==='en'?'UE per game':'每局 UE ue_per_game')+'</b></div><div id="ue-pg"><b>—</b></div></div>'+
        '<div class="a1-h" style="font-size:13px;margin-top:14px">'+(LANG==='en'?'② Transfer Verification Score (0–100, self/coach rated)':'② 转化验证分（0–100，自评/教练评）')+'</div>'+
        dimInputs +
        '<div class="a1-row"><div><b>'+(LANG==='en'?'match_transfer_score (avg. of 4)':'match_transfer_score（4 项均值）')+'</b></div><div id="mt-score"><b>—</b></div></div>'+
        '<div class="a1-row" style="border:none;margin-top:12px"><button class="btn" data-act="open" data-id="'+aid+'">'+(LANG==='en'?'Cancel':'取消')+'</button>'+
          '<button class="btn solid" data-act="save-match" data-id="'+aid+'">'+(LANG==='en'?'Save':'保存')+'</button></div>'+
        '<div class="a1-mut" style="margin-top:8px">'+(LANG==='en'
          ? 'After saving, you\'ll return to details; the readiness preview will use these values for ue_per_game_max and match_transfer_score.'
          : '保存后回详情；就绪度预览里 ue_per_game_max 与 match_transfer_score 两格将用这里的值。')+'</div>');
      function recompute() {
        var dd = ui.matchDraft;
        var tot = Object.keys(dd.counts).reduce(function (s, k) { return s + (dd.counts[k]||0); }, 0);
        var pg = (dd.games > 0) ? (Math.round(tot / dd.games * 10) / 10) : null;
        var pgEl = document.getElementById('ue-pg');
        if (pgEl) pgEl.innerHTML = '<b>'+(pg==null?'—':pg)+'</b>'+(pg==null?'':' <span class="a1-mut">('+tot+'/'+dd.games+')</span>');
        var mean = Math.round((dd.decision + dd.transition + dd.pressure + dd.attack) / 4);
        var mtEl = document.getElementById('mt-score');
        if (mtEl) mtEl.innerHTML = '<b>'+mean+'</b>';
      }
      el.querySelectorAll('[data-ue]').forEach(function (inp) { inp.oninput = function () { ui.matchDraft.counts[this.getAttribute('data-ue')] = Math.max(0, parseInt(this.value||'0',10)||0); recompute(); }; });
      el.querySelectorAll('[data-mt]').forEach(function (inp) { inp.oninput = function () { ui.matchDraft[this.getAttribute('data-mt')] = Math.max(0, Math.min(100, parseInt(this.value||'0',10)||0)); recompute(); }; });
      var g = document.getElementById('ue-games'); if (g) g.oninput = function () { ui.matchDraft.games = Math.max(0, parseInt(this.value||'0',10)||0); recompute(); };
      recompute();
    });
  }

  function saveMatch(aid) {
    var d = ui.matchDraft || {};
    var mean = Math.round(((d.decision||0) + (d.transition||0) + (d.pressure||0) + (d.attack||0)) / 4);
    PBStore.updateAssessment(aid, {
      ue: { games: d.games||0, counts: d.counts||{} },
      match_transfer: { decision:d.decision||0, transition:d.transition||0, pressure:d.pressure||0, attack:d.attack||0, score: mean }
    }).then(function () { ui.screen='detail'; render(); });
  }

  function renderRecord() {
    var s=ui.session; var tid=s.test_id; var t=PBConfig.tests[tid]||{name:tid};
    var outs=PBConfig.outcomesFor(tid); var target=PBConfig.sampleTarget(tid,s.assessment_tier);
    PBStore.trialsBySession(s.test_session_id).then(function (trials) {
      trials.sort(function(a,b){return a.trial_no-b.trial_no;});
      var m=PBMetrics.computeTrials(trials);
      var log=trials.map(function(tr){return tr.trial_no+':'+tr.outcome;}).join('  ')||(LANG==='en'?'(none yet)':'（暂无）');
      var btns=outs.map(function(o){var wt=PBConfig.scoreWeight(tid,o);
        return '<button class="btn" data-act="trial" data-o="'+o+'" style="margin:4px 6px 4px 0">'+OUT_LABEL(o)+(wt==null?'':' ·'+wt)+'</button>';}).join('');
      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+s.assessment_id+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+tid+' '+esc(t.name)+'</div>'+
        '<div class="a1-sub">'+FEED_LABEL(s.feed_mode)+(s.feeder_id?(' · feeder '+esc(s.feeder_id)):'')+' · Tier '+esc(s.assessment_tier)+(target?(' · '+(LANG==='en'?'target ':'参考目标 ')+target+' trials'):'')+'</div>'+
        '<div>'+(LANG==='en'?'Record trial (raw data):':'逐 Trial 记录（原始数据）：')+'</div><div style="margin-top:8px">'+btns+'</div>'+
        '<div style="margin-top:6px">'+(LANG==='en'?'Recorded ':'已记录 ')+'<b>'+trials.length+'</b> · '+(LANG==='en'?'Current ':'当前 ')+metricLine(m)+'</div><div class="a1-list">'+esc(log)+'</div>'+
        '<div class="a1-row" style="border:none;margin-top:12px"><span></span><button class="btn solid" data-act="open" data-id="'+s.assessment_id+'">'+(LANG==='en'?'Done':'完成 Done')+'</button></div>');
    });
  }

  function onClick(e) {
    var node=e.target.closest('[data-act]'); if(!node) return;
    var act=node.getAttribute('data-act');
    if(act==='home'){ui.screen='home';return render();}
    if(act==='new'){ui.screen='new';ui.draft={};return render();}
    if(act==='pick-player'){ui.draft.player_id=node.getAttribute('data-pid');ui.draft.newName='';return render();}
    if(act==='pick-tier'){ui.draft.tier=node.getAttribute('data-tier');return render();}
    if(act==='pick-level'){ui.draft.target=parseFloat(node.getAttribute('data-lvl'));return render();}
    if(act==='create-asm')return createAssessment();
    if(act==='open'){ui.assessment_id=node.getAttribute('data-id');ui.screen='detail';return render();}
    if(act==='export')return exportJSON(node.getAttribute('data-id'));
    if(act==='preview'){ui.assessment_id=node.getAttribute('data-id');ui.screen='preview';return render();}
    if(act==='match'){ui.assessment_id=node.getAttribute('data-id');ui.screen='match';return render();}
    if(act==='save-match')return saveMatch(node.getAttribute('data-id'));
    if(act==='del-asm')return delAssessment(node.getAttribute('data-id'));
    if(act==='new-session'){ui.pendingTestId=node.getAttribute('data-tid');ui.sessDraft={};ui.screen='session-new';return render();}
    if(act==='pick-feed'){ui.sessDraft.feed_mode=node.getAttribute('data-feed');return render();}
    if(act==='create-session')return createSession();
    if(act==='del-session')return delSession(node.getAttribute('data-sid'));
    if(act==='record')return openRecord(node.getAttribute('data-sid'));
    if(act==='trial')return recordTrial(node.getAttribute('data-o'));
  }

  function createAssessment() {
    var d=ui.draft;
    var pPromise=d.player_id?Promise.resolve({player_id:d.player_id}):PBStore.createPlayer(d.newName);
    pPromise.then(function(p){return PBStore.createAssessment({player_id:p.player_id,assessment_tier:d.tier,target_training_level:d.target});})
      .then(function(a){ui.assessment_id=a.assessment_id;ui.screen='detail';render();});
  }

  function createSession() {
    var d=ui.sessDraft, tid=ui.pendingTestId;
    PBStore.get('assessments',ui.assessment_id).then(function(a){
      return PBStore.createTestSession({assessment_id:ui.assessment_id,test_id:tid,assessment_tier:a.assessment_tier,
        feed_mode:d.feed_mode, feeder_id:(d.feed_mode==='machine'?null:(d.feeder_id||null)),
        feeder_calibration_id:(d.feed_mode==='calibrated_human'?(d.cal||null):null)});
    }).then(function(s){ui.session=s;ui.screen='record';render();});
  }

  function openRecord(sid){ PBStore.get('test_sessions',sid).then(function(s){ui.session=s;ui.screen='record';render();}); }

  function recordTrial(outcome) {
    var s=ui.session;
    if(outcome==='P' && !PBConfig.partialAllowed(s.test_id)){alert(s.test_id+(LANG==='en'?' does not allow Partial (P)':' 不允许 Partial(P)'));return;}
    PBStore.trialsBySession(s.test_session_id).then(function(trials){
      return PBStore.addTrialEvent({test_session_id:s.test_session_id,trial_no:trials.length+1,scenario_id:null,
        outcome:outcome,score_weight:PBConfig.scoreWeight(s.test_id,outcome),
        raw_json:{test_id:s.test_id,entered_via:'a1_ui'},review_flag:false,video_timestamp_ms:null});
    }).then(function(){render();});
  }

  function delAssessment(aid){
    if(!window.confirm(LANG==='en'?'Delete this entire assessment and all its sessions/trials? This cannot be undone.':'删除整份评估及其全部 Session/Trial？此操作不可撤销。')) return;
    PBStore.deleteAssessment(aid).then(function(){ui.screen='home';render();});
  }
  function delSession(sid){
    if(!window.confirm(LANG==='en'?'Delete this session and all its trials?':'删除该 Session 及其全部 Trial？')) return;
    PBStore.deleteSession(sid).then(function(){render();});
  }

  function exportJSON(aid) {
    Promise.all([PBStore.exportAssessment(aid), PBMetrics.computeAssessment(aid)]).then(function(r){
      var data=r[0]; data.metrics=r[1];
      var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      var url=URL.createObjectURL(blob); var a=document.createElement('a');
      a.href=url; a.download='assessment_'+aid+'.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},1500);
    }).catch(function(err){alert((LANG==='en'?'Export failed: ':'导出失败: ')+err.message);});
  }

  function init() {
    el=document.getElementById(ROOT_ID); if(!el) return;
    el.addEventListener('click',onClick);
    if(typeof PBConfig==='undefined'||typeof PBStore==='undefined'||typeof PBMetrics==='undefined'||typeof PBPreview==='undefined'){
      el.innerHTML='<div class="a1-mut">'+(LANG==='en'?'Modules not ready (PBConfig/PBStore/PBMetrics/PBPreview not loaded).':'模块未就绪（PBConfig/PBStore/PBMetrics/PBPreview 未加载）。')+'</div>';return;}
    PBConfig.load('./data/').then(function(){render();})
      .catch(function(err){el.innerHTML='<div class="a1-mut">'+(LANG==='en'?'Config load failed: ':'配置加载失败：')+esc(err.message)+'</div>';});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  window.PBAssessment = { refresh: function(){ if(el) render(); } };
})();
