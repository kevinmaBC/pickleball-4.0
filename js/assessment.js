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
  // POST-S11-R4-A: player-facing test names. Internal T01-T10 IDs are never renamed anywhere in
  // the data model — this is a presentation-only label, always shown alongside (never replacing)
  // the raw tid so diagnostics stay traceable.
  function TEST_LABEL(tid) {
    var M = {
      T01: LANG === 'en' ? 'Serve' : '发球 Serve',
      T02: LANG === 'en' ? 'Return' : '接发 Return',
      T03: LANG === 'en' ? 'Drive' : '平抽 Drive',
      T04: LANG === 'en' ? 'Third-Shot Drop' : '三档小球 Third-Shot Drop',
      T05: LANG === 'en' ? 'Transition Reset' : '过渡缓冲 Transition Reset',
      T06: LANG === 'en' ? 'Dink' : '搓球 Dink',
      T07: LANG === 'en' ? 'Volley & Counter' : '截击与反击 Volley & Counter',
      T08: LANG === 'en' ? 'Shot Decision' : '击球决策 Shot Decision',
      T09: LANG === 'en' ? 'Pressure & Transition' : '抗压与过渡 Pressure & Transition',
      T10: LANG === 'en' ? 'Match Transfer' : '实战转化 Match Transfer'
    };
    return M[tid] || tid;
  }
  // POST-S11-R4-A: short player-facing explanation of each feed mode (§8). Feed modes themselves
  // are unchanged (machine/calibrated_human/partner/live_match).
  function FEED_DESC(k) {
    var M = {
      machine: LANG === 'en' ? 'Ball machine feed.' : '发球机喂球。',
      calibrated_human: LANG === 'en' ? 'Repeatable protocol-based feed by a person.' : '按标定协议由人工喂球，可重复。',
      partner: LANG === 'en' ? 'Normal partner-fed test.' : '搭档正常喂球测试。',
      live_match: LANG === 'en' ? 'Evidence observed during live play.' : '在实战中观察记录的证据。'
    };
    return M[k] || '';
  }
  // POST-S11-R4-A (§5): per-test progress bucket, derived only from already-computed fields
  // (PBMetrics' m.n_total / m.sample_complete) — no new completion logic, never fabricated.
  function TEST_PROGRESS(session, m) {
    if (!session) return 'not_started';
    if (m && m.sample_complete === true) return 'complete';
    return 'in_progress';
  }
  function PROGRESS_LABEL(status) {
    var M = LANG === 'en'
      ? { not_started: 'Not Started', in_progress: 'In Progress', complete: 'Complete · Evidence Ready' }
      : { not_started: '未开始', in_progress: '进行中', complete: '完成 · 证据充分' };
    return M[status];
  }
  function PROGRESS_COLOR(status) {
    return status === 'complete' ? 'var(--pass)' : (status === 'in_progress' ? 'var(--part)' : 'var(--muted)');
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
    if (ui.screen === 'result')      return renderResult();
  }

  function renderHome() {
    Promise.all([PBStore.listAssessments(), PBStore.listPlayers()]).then(function (r) {
      var list=r[0], players=r[1];
      var pmap={}; players.forEach(function(p){pmap[p.player_id]=p.display_name;});
      list.sort(function(a,b){return (b.created_at||'').localeCompare(a.created_at||'');});
      // POST-S11-R4-A (§12): assessment list prioritizes Player/Type/Target/Date/state over the
      // opaque assessment_id (which stays out of the primary label entirely — same as before).
      // The per-row state chip reuses PBMetrics' own already-computed per_test fields; no new
      // completion logic.
      return Promise.all(list.map(function (a) { return PBMetrics.computeAssessment(a.assessment_id); })).then(function (metricsList) {
        var rows = list.length ? list.map(function (a, i) {
          var per = metricsList[i].per_test || {};
          var startedN = PBConfig.testIds.filter(function (tid) { return per[tid] && per[tid].n_total > 0; }).length;
          var completeN = PBConfig.testIds.filter(function (tid) { return per[tid] && per[tid].sample_complete === true; }).length;
          var stateLabel = completeN === PBConfig.testIds.length ? (LANG==='en'?'Evidence Ready':'证据充分')
            : (startedN > 0 ? (LANG==='en'?'In Progress':'进行中') : (LANG==='en'?'Not Started':'未开始'));
          // POST-S11-R4-B (§15): History/result access — the Assessment Data Core's own list is
          // the accepted "history" surface for assessments (there is no separate assessment
          // history architecture; extending the S9/S10 History/Explainability feature, S11-E,
          // would cross into an unrelated subsystem — see the R4-B report for why that was not
          // done). "View Result" appears once evidence exists; presentation only, no recompute.
          var resultBtn = startedN > 0 ? ('<button class="btn" data-act="result" data-id="'+a.assessment_id+'">'+(LANG==='en'?'View Result':'查看结果')+'</button> ') : '';
          return '<div class="a1-row"><div><b>'+esc(pmap[a.player_id]||'—')+'</b> '+
            '<span class="a1-mut">· '+esc(TIER_LABEL(a.assessment_tier))+' · '+(LANG==='en'?'Target ':'目标 ')+a.target_training_level.toFixed(1)+' · '+esc(a.assessment_date)+' · '+stateLabel+'</span></div>'+
            '<div>'+resultBtn+'<button class="btn" data-act="open" data-id="'+a.assessment_id+'">'+(LANG==='en'?'Open':'打开')+'</button> '+
            '<button class="btn solid" data-act="export" data-id="'+a.assessment_id+'">'+(LANG==='en'?'Export':'导出')+'</button> '+
            '<button class="btn" data-act="del-asm" data-id="'+a.assessment_id+'" style="color:var(--fail)">'+(LANG==='en'?'Delete':'删')+'</button></div></div>';
        }).join('') : '<div class="a1-mut">'+(LANG==='en'?'No assessments yet. Tap the button above to create one.':'还没有评估记录。点上方按钮新建。')+'</div>';
        h('<div class="a1-h">'+(LANG==='en'?'Assessment Data Core':'评估数据核心 <span class="en">Assessment Data Core</span>')+'</div>'+
          '<div class="a1-sub">V2.3.1 · schema '+PBConfig.versions.schema_version+' / benchmark '+PBConfig.versions.benchmark_version+' / protocol '+PBConfig.versions.protocol_version+'</div>'+
          '<button class="btn solid" data-act="new" style="margin-bottom:12px">'+(LANG==='en'?'＋ New Assessment':'＋ 新建评估 New Assessment')+'</button>'+ rows);
      });
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
        var startedCount = 0;
        var rows = PBConfig.testIds.map(function (tid) {
          var t=PBConfig.tests[tid]||{name:tid}; var s=byTest[tid]; var m=metrics[tid];
          var status = TEST_PROGRESS(s, m);
          if (status !== 'not_started') startedCount++;
          var pflag=PBConfig.partialAllowed(tid)?'':(LANG==='en'?' <span class="a1-mut">(no P)</span>':' <span class="a1-mut">(无 P)</span>');
          var right, second='';
          if(s){
            right='<button class="btn solid" data-act="record" data-sid="'+s.test_session_id+'">'+(LANG==='en'?'Record':'记录')+'</button> '+
                  '<button class="btn" data-act="del-session" data-sid="'+s.test_session_id+'" style="color:var(--fail)">'+(LANG==='en'?'Delete':'删')+'</button>';
            // POST-S11-R4-A (§6): player-facing "X of Y observations recorded" wording — the
            // technical "Sampling n/target" phrasing stays available in Readiness Preview
            // (js/preview.js), unchanged, for diagnostic use.
            var comp='';
            if(m && m.sample_target){ comp=' · '+(LANG==='en' ? (m.n_valid+' of '+m.sample_target+' observations recorded') : (m.n_valid+' / '+m.sample_target+' 次观测已记录'))+(m.sample_complete?' ✓':''); }
            second='<div class="a1-mut" style="padding:2px 0 0">'+FEED_LABEL(s.feed_mode)+comp+'</div>'+
                   '<div class="a1-mut" style="padding:2px 0 0">'+metricLine(m)+'</div>';
          } else {
            right='<button class="btn" data-act="new-session" data-tid="'+tid+'">'+(LANG==='en'?'Start Test':'开始测试')+'</button>';
          }
          var statusBadge = '<span style="color:'+PROGRESS_COLOR(status)+';font-weight:700;font-size:12px;white-space:nowrap">'+PROGRESS_LABEL(status)+'</span>';
          // Internal tid stays visible (small, secondary) — never removed, never the primary label.
          return '<div class="a1-row" style="flex-wrap:wrap"><div style="flex:1 1 55%"><b>'+esc(TEST_LABEL(tid))+'</b> <span class="a1-mut" style="font-size:11px">'+tid+'</span>'+pflag+second+'</div><div style="text-align:right">'+statusBadge+'<div style="margin-top:6px">'+right+'</div></div></div>';
        }).join('');
        var progressSummary = '<div style="font-weight:700;margin:2px 0 10px">'+
          (LANG==='en' ? (startedCount+' of '+PBConfig.testIds.length+' skill tests started') : (startedCount+' / '+PBConfig.testIds.length+' 项技术测试已开始'))+'</div>';
        var matchStatus = (match && match.match_transfer_score!=null)
          ? ((LANG==='en'?'Transfer score ':'转化分 ')+match.match_transfer_score)
          : (LANG==='en'?'Not Yet Validated':'尚未验证');
        h('<div class="a1-h"><button class="btn" data-act="home" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+esc(a?TIER_LABEL(a.assessment_tier):'')+' · '+(LANG==='en'?'Target ':'目标 ')+(a?a.target_training_level.toFixed(1):'')+'</div>'+
          '<div class="a1-sub">'+aid+'</div>'+
          progressSummary + rows +
          '<div class="a1-mut" style="margin-top:10px">'+(LANG==='en'
            ? 'Each row shows the raw primary metric % (weighted success/valid trials) + sampling completeness (recorded/target). Includes T08 Decision / T09 Pressure. Still no level rating, no composite score, no gate thresholds.'
            : '各项显示"原始主指标%（加权成功/有效试验）+ 抽样完整度（已录/目标）"。含 T08 决策 / T09 抗压；仍不判级、不算综合分、不设门槛。')+'</div>'+
          '<div class="a1-row" style="border:none;margin-top:8px"><div class="a1-mut"><b>'+esc(TEST_LABEL('T10'))+'</b> · '+(match&&match.ue_per_game!=null?((LANG==='en'?'UE/game ':'每局UE ')+match.ue_per_game):(LANG==='en'?'UE not recorded':'UE 未录'))+' · '+matchStatus+'</div>'+
            '<button class="btn" data-act="match" data-id="'+aid+'">'+(LANG==='en'?'Record Match Evidence':'记录实战证据')+'</button></div>'+
          '<div class="a1-row" style="border:none;margin-top:12px">'+
            '<button class="btn solid" data-act="result" data-id="'+aid+'">'+(LANG==='en'?'View Result':'查看结果')+'</button>'+
            '<button class="btn" data-act="preview" data-id="'+aid+'">'+(LANG==='en'?'Readiness Preview':'就绪度预览')+'</button>'+
            '<button class="btn" data-act="export" data-id="'+aid+'">'+(LANG==='en'?'Export JSON':'导出 JSON')+'</button></div>');
      });
  }

  function renderSessionNew() {
    var tid=ui.pendingTestId; var t=PBConfig.tests[tid]||{name:tid}; var d=ui.sessDraft;
    var modeChips = PBConfig.feedModes.map(function(m){ return chip(FEED_LABEL(m),'pick-feed','feed',m,d.feed_mode===m); }).join('');
    var showFeeder = d.feed_mode && d.feed_mode!=='machine';
    var showCal = d.feed_mode==='calibrated_human';
    // POST-S11-R4-A (§8): short player-facing explanation of the selected feed mode. Live Match
    // is explicitly called out as skill-test evidence only — never Match Transfer validation.
    var feedNote = d.feed_mode ? ('<div class="a1-mut" style="margin:2px 0 8px">'+esc(FEED_DESC(d.feed_mode))+
      (d.feed_mode==='live_match' ? (' '+(LANG==='en'
        ? 'This records evidence for this skill test only — it is not the same as Match Transfer validation.'
        : '此项仅为该技能测试的证据，不等同于"实战转化 Match Transfer"验证。')) : '')+'</div>') : '';
    h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+ui.assessment_id+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+(LANG==='en'?'New Session · ':'新建 Session · ')+esc(TEST_LABEL(tid))+' <span class="a1-mut" style="font-size:11px">'+tid+'</span></div>'+
      '<label class="a1-mut">'+(LANG==='en'?'Feed Mode':'喂球方式 Feed Mode')+'</label>'+
      '<div class="a1-mut" style="margin:2px 0 6px">'+(LANG==='en'?'How is the ball being supplied for this test?':'这项测试的来球方式是？')+'</div>'+
      '<div>'+modeChips+'</div>'+ feedNote +
      (showFeeder?'<input class="fld" id="a1-feeder" placeholder="'+(LANG==='en'?'feeder_id — feeder identifier (optional)':'feeder_id 喂球者标识（可留空）')+'" style="margin:8px 0" value="'+esc(d.feeder_id||'')+'">':'')+
      (showCal?'<input class="fld" id="a1-cal" placeholder="'+(LANG==='en'?'feeder_calibration_id — calibration ID (optional)':'feeder_calibration_id 标定编号（可留空）')+'" style="margin:0 0 8px" value="'+esc(d.cal||'')+'">':'')+
      '<div class="a1-row" style="border:none;margin-top:12px"><button class="btn" data-act="open" data-id="'+ui.assessment_id+'">'+(LANG==='en'?'Cancel':'取消')+'</button>'+
        '<button class="btn solid" data-act="create-session"'+(d.feed_mode?'':' disabled style="opacity:.5"')+'>'+(LANG==='en'?'Start Test':'开始测试')+'</button></div>');
    var fi=document.getElementById('a1-feeder'); if(fi) fi.oninput=function(){ui.sessDraft.feeder_id=this.value;};
    var ci=document.getElementById('a1-cal'); if(ci) ci.oninput=function(){ui.sessDraft.cal=this.value;};
  }

  function renderPreview() {
    var aid = ui.assessment_id;
    el.innerHTML = '<div class="a1-mut">'+(LANG==='en'?'Computing readiness…':'计算就绪度…')+'</div>';
    PBPreview.forAssessment(aid).then(function (P) {
      if (P.unsupported) { h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button></div><div class="a1-mut">'+(LANG==='en'?'No gate table yet for target level ':'目标等级 ')+esc(P.target)+(LANG==='en'?'.':' 暂无门槛表。')+'</div>'); return; }
      var STAT = LANG==='en'
        ? { met:['Met ✓','var(--pass)'], borderline:['Borderline ~','var(--part)'], not_met:['Not Met ✗','var(--fail)'], no_data:['No Data','var(--muted)'], not_captured:['Not Captured','var(--muted)'] }
        : { met:['达标 ✓','var(--pass)'], borderline:['边缘 ~','var(--part)'], not_met:['未达 ✗','var(--fail)'], no_data:['无数据','var(--muted)'], not_captured:['未采集','var(--muted)'] };
      var rows = P.rows.map(function (x) {
        var s = STAT[x.status] || ['?','var(--muted)']; var op = x.direction==='max' ? '≤' : '≥'; var mid='';
        // Fix C: "Pending T10" is only accurate when the row is genuinely T10-dependent
        // (PBPreview sets t10_pending from levelCfg.source_tests) — otherwise a neutral
        // "Not Captured" avoids misattributing a T01-T09 gap (e.g. a key-mapping miss) to T10.
        if (x.status==='not_captured') { s = [s[0] + (x.t10_pending ? (LANG==='en' ? ' · Pending T10' : '·待T10') : ''), s[1]]; mid=''; }
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

  // ============================================================
  // POST-S11-R4-B — Assessment Result Summary. PRESENTATION / INTERPRETATION ONLY.
  // Every field here is read from already-computed, already-accepted sources
  // (PBMetrics.computeAssessment / PBPreview.forAssessment / PBHomeDashboardAdapter
  // .loadHomeDashboard) — never recalculated, never a new rating/recommendation/
  // prescription/journey/match-transfer computation. Section order: A Completion,
  // B Overall Result (provisional), C Skill Results, D Six Hard Gates (cross-
  // reference only — see below), E Match Transfer, F Next Action (read-only).
  // ============================================================
  function renderResult() {
    var aid = ui.assessment_id;
    el.innerHTML = '<div class="a1-mut">'+(LANG==='en'?'Loading result…':'加载结果…')+'</div>';
    PBStore.get('assessments', aid).then(function (a) {
      // §14: next_action must come from the existing Journey projection, read-only. A soft
      // dependency (PBHomeDashboardAdapter loads after assessment.js in index.html's script
      // chain, so it is always present in the browser; the guard is defensive only) — its
      // absence/failure must degrade to an honest "not available yet", never a guessed CTA.
      var homeDashboardPromise = (typeof PBHomeDashboardAdapter !== 'undefined')
        ? PBHomeDashboardAdapter.loadHomeDashboard(a.player_id).catch(function () { return null; })
        : Promise.resolve(null);
      return Promise.all([
        Promise.resolve(a),
        PBMetrics.computeAssessment(aid),
        PBPreview.forAssessment(aid).catch(function () { return { unsupported: true }; }),
        homeDashboardPromise
      ]);
    }).then(function (r) {
      var a = r[0], M = r[1], P = r[2], homeResult = r[3];
      var metrics = M.per_test || {}, match = M.match || null;
      var totalTests = PBConfig.testIds.length;
      var completeN = PBConfig.testIds.filter(function (tid) { return metrics[tid] && metrics[tid].sample_complete === true; }).length;
      var startedN = PBConfig.testIds.filter(function (tid) { return metrics[tid] && metrics[tid].n_total > 0; }).length;
      var assessmentComplete = completeN === totalTests;
      var previewOk = P && !P.unsupported;
      // §4: RESULT_READY != VALIDATED_LEVEL — this only signals "enough evidence exists to show a
      // meaningful comparison against Target Level", reusing PBPreview's own tally verbatim.
      var resultReady = assessmentComplete && previewOk && P.tally.no_data === 0 && P.tally.sample_short === 0;

      // ---- A. Completion ----
      var completionLabel = assessmentComplete ? (LANG==='en'?'Assessment Complete':'评估已完成')
        : (startedN > 0 ? (LANG==='en'?'Assessment In Progress':'评估进行中') : (LANG==='en'?'Not Started':'未开始'));
      var sectionA = '<div style="font-weight:800;font-size:16px">'+completionLabel+'</div>'+
        '<div class="a1-mut" style="margin:2px 0 8px">'+esc(TIER_LABEL(a.assessment_tier))+' · '+(LANG==='en'?'Target ':'目标 ')+a.target_training_level.toFixed(1)+'</div>'+
        '<div style="margin-bottom:4px">'+(LANG==='en' ? (completeN+' of '+totalTests+' skill tests complete') : (completeN+' / '+totalTests+' 项技术测试完成'))+'</div>';

      // ---- B. Overall Assessment Result (Provisional Assessment Score) ----
      var sectionB;
      if (!previewOk) {
        sectionB = '<div class="a1-mut">'+(LANG==='en'?'No gate table yet for target level ':'目标等级 ')+esc(a.target_training_level.toFixed(1))+(LANG==='en'?'.':' 暂无门槛表。')+'</div>';
      } else if (!resultReady) {
        // §16 fail-safe: incomplete/insufficient evidence -> honest "not ready", never a fabricated result.
        sectionB = '<div class="a1-mut">'+(LANG==='en'
          ? ('Result not ready yet — complete all '+totalTests+' skill tests with sufficient evidence for Target '+P.target+' to see the overall result.')
          : ('结果尚未就绪——需完成全部 '+totalTests+' 项技术测试且证据充分（针对目标 '+P.target+'）才能查看总体结果。'))+'</div>';
      } else {
        var t = P.tally;
        sectionB = '<div style="font-weight:700">'+(LANG==='en'?'Provisional Assessment Score':'评估参考分')+'</div>'+
          '<div style="margin:4px 0">'+(LANG==='en'
            ? ('Met '+t.met+' · Borderline '+t.borderline+' · Not Met '+t.not_met+' (of '+t.total+' comparable)')
            : ('达标 '+t.met+' · 边缘 '+t.borderline+' · 未达 '+t.not_met+'（共 '+t.total+' 项可比）'))+'</div>'+
          '<div class="a1-mut">'+(LANG==='en'?'Reference only — not an official or validated player rating.':'仅供参考——非官方或已验证的球员评级。')+'</div>';
      }

      // ---- C. Skill Results (relabels PBPreview's own rows; §10 — "Near Target" reuses the
      // existing accepted borderline band, never a new threshold rule) ----
      var sectionC = '<div class="a1-mut">'+(LANG==='en'?'Not available yet.':'暂不可用。')+'</div>';
      if (previewOk) {
        var SKILL_STATUS = LANG==='en'
          ? { met:['Meets Target','var(--pass)'], borderline:['Near Target','var(--part)'], not_met:['Below Target','var(--fail)'], no_data:['Insufficient Evidence','var(--muted)'] }
          : { met:['达到目标','var(--pass)'], borderline:['接近目标','var(--part)'], not_met:['未达目标','var(--fail)'], no_data:['证据不足','var(--muted)'] };
        var skillRows = P.rows.filter(function (x) { return x.test_id && PBConfig.testIds.indexOf(x.test_id) !== -1; }).map(function (x) {
          var s = SKILL_STATUS[x.status]; if (!s) return '';
          var curTxt = x.current != null ? (x.current+'%') : '—';
          return '<div class="a1-row"><div><b>'+esc(TEST_LABEL(x.test_id))+'</b> <span class="a1-mut" style="font-size:11px">'+x.test_id+'</span></div>'+
            '<div style="text-align:right"><span class="a1-mut">'+curTxt+' / '+(x.direction==='max'?'≤':'≥')+x.threshold+'</span><br>'+
            '<span style="color:'+s[1]+';font-weight:700;font-size:12px">'+s[0]+'</span></div></div>';
        }).join('');
        if (skillRows) sectionC = skillRows;
      }

      // ---- D. Six Hard Gates — an honest cross-reference, not a fabricated per-assessment
      // computation: the existing Six Hard Gates tracker (js/app.js, this Measure tab) is a
      // separate self-rated slider system, never derived from this assessment's own trial
      // evidence. Unifying the two would be a domain-architecture change, out of R4-B's scope.
      var sectionD = '<div class="a1-mut">'+(LANG==='en'
        ? 'Stable 4.0 Readiness is tracked separately below on this page (Six Hard Gates), from self-rated module sliders — not derived from this assessment’s own trial evidence.'
        : '稳定 4.0 就绪度在本页下方"六道硬门槛"单独跟踪（基于自评滑块），并非由本次评估的原始试验证据推算。')+'</div>';

      // ---- E. Match Transfer (T10 stays architecturally distinct — unchanged from renderDetail) ----
      var matchStatus = (match && match.match_transfer_score!=null)
        ? ((LANG==='en'?'Transfer score ':'转化分 ')+match.match_transfer_score)
        : (LANG==='en'?'Not Yet Validated':'尚未验证');
      var sectionE = '<div><b>'+esc(TEST_LABEL('T10'))+'</b> · '+(match&&match.ue_per_game!=null?((LANG==='en'?'UE/game ':'每局UE ')+match.ue_per_game):(LANG==='en'?'UE not recorded':'UE 未录'))+' · '+matchStatus+'</div>'+
        '<div class="a1-mut" style="margin-top:2px">'+(LANG==='en'?'Training performance alone does not validate match transfer.':'仅训练表现不能验证实战转化。')+'</div>'+
        '<button class="btn" data-act="match" data-id="'+aid+'" style="margin-top:6px">'+(LANG==='en'?'Record Match Evidence':'记录实战证据')+'</button>';

      // ---- F. Recommended Next Action — read-only from the existing Journey projection.
      // Never computed locally; §16 fail-safe: unavailable Journey data -> neutral state, never a
      // guessed CTA. ----
      var homeDashboard = homeResult && homeResult.home_dashboard;
      var na = homeDashboard && homeDashboard.next_action;
      var focus = homeDashboard && homeDashboard.focus;
      var recommendationLine = focus
        ? ((LANG==='en'?'Recommendation: ':'训练建议：')+esc(focus.recommendation_code || focus.skill || (LANG==='en'?'available':'可用')))
        : (LANG==='en'?'Recommendation not available yet.':'暂无可用的训练建议。');
      var sectionF;
      if (na && typeof PBHomeDashboardUI !== 'undefined') {
        var ctaLabel = PBHomeDashboardUI.nextActionLabel(na.code, LANG==='en');
        var route = PBHomeDashboardUI.routeForNextAction(na.code);
        sectionF = '<div class="a1-mut" style="margin-bottom:6px">'+recommendationLine+'</div>'+
          '<button class="btn solid" data-act="result-cta" data-route="'+esc(route||'')+'"'+(na.enabled?'':' disabled style="opacity:.5"')+'>'+esc(ctaLabel)+'</button>';
      } else {
        sectionF = '<div class="a1-mut" style="margin-bottom:6px">'+recommendationLine+'</div>'+
          '<div class="a1-mut">'+(LANG==='en'?'Next action not available yet.':'暂无可用的下一步操作。')+'</div>';
      }

      function section(label, body) {
        return '<div class="a1-row" style="border:none;flex-direction:column;align-items:flex-start;padding:10px 0"><div class="a1-h" style="font-size:13px;margin-bottom:4px">'+label+'</div>'+body+'</div>';
      }

      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+(LANG==='en'?'Assessment Result':'评估结果')+'</div>'+
        sectionA +
        section(LANG==='en'?'Overall Assessment Result':'总体评估结果', sectionB) +
        section(LANG==='en'?'Skill Results':'技能结果', sectionC) +
        section(LANG==='en'?'Six Hard Gates':'六道硬门槛', sectionD) +
        section(LANG==='en'?'Match Transfer':'实战转化', sectionE) +
        section(LANG==='en'?'Recommended Next Action':'建议下一步', sectionF));
    }).catch(function (e) { el.innerHTML = '<div class="a1-mut">'+(LANG==='en'?'Result failed: ':'结果加载失败：')+esc(e.message)+'</div>'; });
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
      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+aid+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+esc(TEST_LABEL('T10'))+' <span class="a1-mut" style="font-size:11px">T10-lite</span></div>'+
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
      // POST-S11-R4-A (§7): concise player guidance for Success/Fail/Invalid, wording only —
      // the underlying S/P/F/I data semantics and scoring are unchanged.
      var sfiGuide = LANG==='en'
        ? 'Success: valid attempt meeting the criterion · Fail: valid attempt not meeting it · Invalid: excluded from the count.'
        : '成功：有效尝试且达标 · 失败：有效尝试未达标 · 无效：不计入统计。';
      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+s.assessment_id+'" style="padding:4px 10px">'+(LANG==='en'?'‹ Back':'‹ 返回')+'</button> &nbsp; '+esc(TEST_LABEL(tid))+' <span class="a1-mut" style="font-size:11px">'+tid+'</span></div>'+
        '<div class="a1-sub">'+FEED_LABEL(s.feed_mode)+(s.feeder_id?(' · feeder '+esc(s.feeder_id)):'')+' · Tier '+esc(s.assessment_tier)+(target?(' · '+(LANG==='en'?'target ':'参考目标 ')+target+' trials'):'')+'</div>'+
        '<div>'+(LANG==='en'?'Record this attempt:':'记录本次尝试：')+'</div><div style="margin-top:8px">'+btns+'</div>'+
        '<div class="a1-mut" style="margin-top:6px">'+esc(sfiGuide)+'</div>'+
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
    if(act==='result'){ui.assessment_id=node.getAttribute('data-id');ui.screen='result';return render();}
    if(act==='result-cta'){var route=node.getAttribute('data-route'); if(route && typeof go==='function') go(route); return;}
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
  window.PBAssessment = {
    refresh: function(){ if(el) render(); },
    // POST-S11-R4-A: pure label/progress helpers + a minimal screen-navigation hook, exposed for
    // Node testability (tests/r4a-assessment-ux.test.js) — no new player-visible behavior, no
    // change to onClick/data-act routing, no domain logic.
    TEST_LABEL: TEST_LABEL, FEED_DESC: FEED_DESC, TEST_PROGRESS: TEST_PROGRESS,
    PROGRESS_LABEL: PROGRESS_LABEL, PROGRESS_COLOR: PROGRESS_COLOR,
    _goto: function (screen, assessment_id) { ui.screen = screen; if (assessment_id != null) ui.assessment_id = assessment_id; render(); }
  };
})();
