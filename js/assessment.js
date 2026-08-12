/* ============================================================
 * assessment.js — Pickleball App 2.0 Alpha · S1 UI 控制器
 * 在 Measure 标签内提供 New Assessment 全流程：
 *   选 Tier → 选 Target Level → 建 T01–T07 Test Session → 逐 Trial 记 S/P/F/I → 导出 JSON
 * 只做数据录入，不判级、不算分（本 Sprint 禁止 Gate/Capability/Validated Level）。
 * ============================================================ */
(function () {
  'use strict';
  var ROOT_ID = 'a1-app';
  var el = null;
  var ui = { screen: 'home', draft: {}, assessment_id: null, session: null };
  var LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];
  var TIER_LABEL = { lite: 'Lite 周度快检', standard: 'Standard 等级检查', full: 'Full 季度/晋级' };
  var FEED_LABEL = { machine: '发球机 Machine', calibrated_human: '标定喂球 Calibrated', partner: '搭档 Partner', live_match: '实战 Live match' };
  var OUT_LABEL = { S: 'S 成功', P: 'P 部分', F: 'F 失败', I: 'I 无效' };

  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function h(html){ el.innerHTML = html; }

  // ---------- 渲染 ----------
  function render() {
    if (!el) return;
    if (ui.screen === 'home')    return renderHome();
    if (ui.screen === 'new')     return renderNew();
    if (ui.screen === 'detail')  return renderDetail();
    if (ui.screen === 'record')  return renderRecord();
  }

  function renderHome() {
    PBStore.listAssessments().then(function (list) {
      return PBStore.listPlayers().then(function (players) {
        var pmap = {}; players.forEach(function (p){ pmap[p.player_id]=p.display_name; });
        list.sort(function(a,b){return (b.created_at||'').localeCompare(a.created_at||'');});
        var rows = list.length ? list.map(function (a) {
          return '<div class="a1-row"><div><b>'+esc(pmap[a.player_id]||'—')+'</b> '+
            '<span class="a1-mut">· '+esc(a.assessment_tier)+' · 目标 '+a.target_training_level.toFixed(1)+' · '+esc(a.assessment_date)+'</span></div>'+
            '<div><button class="btn" data-act="open" data-id="'+a.assessment_id+'">打开</button> '+
            '<button class="btn solid" data-act="export" data-id="'+a.assessment_id+'">导出 JSON</button></div></div>';
        }).join('') : '<div class="a1-mut">还没有评估记录。点上方按钮新建。</div>';
        h('<div class="a1-h">评估数据核心 <span class="en">Assessment Data Core</span></div>'+
          '<div class="a1-sub">V2.3.1 · schema '+PBConfig.versions.schema_version+' / benchmark '+PBConfig.versions.benchmark_version+' / protocol '+PBConfig.versions.protocol_version+'</div>'+
          '<button class="btn solid" data-act="new" style="margin-bottom:12px">＋ 新建评估 New Assessment</button>'+
          rows);
      });
    });
  }

  function chip(label, act, key, val, selected) {
    return '<span class="a1-chip'+(selected?' sel':'')+'" data-act="'+act+'" data-'+key+'="'+val+'">'+esc(label)+'</span>';
  }

  function renderNew() {
    PBStore.listPlayers().then(function (players) {
      var d = ui.draft;
      var playerChips = players.map(function (p) {
        return chip(p.display_name, 'pick-player', 'pid', p.player_id, d.player_id===p.player_id);
      }).join('');
      var tierChips = PBConfig.tierIds.map(function (t) { return chip(TIER_LABEL[t]||t, 'pick-tier', 'tier', t, d.tier===t); }).join('');
      var lvlChips  = LEVELS.map(function (L) { return chip(L.toFixed(1), 'pick-level', 'lvl', L, d.target===L); }).join('');
      var canCreate = (d.player_id || (d.newName && d.newName.trim())) && d.tier && d.target;
      h('<div class="a1-h">新建评估 New Assessment</div>'+
        '<label class="a1-mut">① 球员 Player</label><div>'+ (playerChips||'') +
          '</div><input class="fld" id="a1-newname" placeholder="或新建球员：输入姓名 display_name" style="margin:8px 0" value="'+esc(d.newName||'')+'">'+
        '<label class="a1-mut">② 层级 Tier</label><div>'+tierChips+'</div>'+
        '<label class="a1-mut" style="display:block;margin-top:10px">③ 目标等级 Target Level</label><div>'+lvlChips+'</div>'+
        '<div class="a1-row" style="border:none;margin-top:14px">'+
          '<button class="btn" data-act="home">取消</button>'+
          '<button class="btn solid" data-act="create-asm"'+(canCreate?'':' disabled style="opacity:.5"')+'>创建 Assessment</button>'+
        '</div>');
      var nameInput = document.getElementById('a1-newname');
      if (nameInput) nameInput.oninput = function(){ ui.draft.newName = this.value; ui.draft.player_id=null; };
    });
  }

  function renderDetail() {
    var aid = ui.assessment_id;
    Promise.all([PBStore.get('assessments', aid), PBStore.sessionsByAssessment(aid)])
      .then(function (r) {
        var a = r[0], sessions = r[1] || [];
        var byTest = {}; 
        return Promise.all(sessions.map(function(s){
          return PBStore.trialsBySession(s.test_session_id).then(function(tr){ s._n = tr.length; byTest[s.test_id]=s; });
        })).then(function(){
          var rows = PBConfig.testIds.map(function (tid) {
            var t = PBConfig.tests[tid] || { name: tid };
            var s = byTest[tid];
            var right = s
              ? '<span class="a1-mut">'+FEED_LABEL[s.feed_mode]+' · '+s._n+' trials</span> <button class="btn solid" data-act="record" data-sid="'+s.test_session_id+'">记录 Record</button>'
              : '<button class="btn" data-act="new-session" data-tid="'+tid+'">创建 Session</button>';
            var pflag = PBConfig.partialAllowed(tid) ? '' : ' <span class="a1-mut">(无 P)</span>';
            return '<div class="a1-row"><div><b>'+tid+'</b> '+esc(t.name)+pflag+'</div><div>'+right+'</div></div>';
          }).join('');
          h('<div class="a1-h"><button class="btn" data-act="home" style="padding:4px 10px">‹ 返回</button> &nbsp; '+esc(a?a.assessment_tier:'')+' · 目标 '+(a?a.target_training_level.toFixed(1):'')+'</div>'+
            '<div class="a1-sub">'+aid+'</div>'+ rows +
            '<div class="a1-row" style="border:none;margin-top:14px"><span></span>'+
              '<button class="btn solid" data-act="export" data-id="'+aid+'">导出完整 Assessment JSON</button></div>');
        });
      });
  }

  function renderRecord() {
    var s = ui.session;
    var tid = s.test_id;
    var t = PBConfig.tests[tid] || { name: tid };
    var outs = PBConfig.outcomesFor(tid); // T01 => 无 P
    var target = PBConfig.sampleTarget(tid, s.assessment_tier);
    PBStore.trialsBySession(s.test_session_id).then(function (trials) {
      trials.sort(function(a,b){return a.trial_no-b.trial_no;});
      var log = trials.map(function(tr){return tr.trial_no+':'+tr.outcome;}).join('  ') || '（暂无）';
      var btns = outs.map(function (o) {
        var wt = PBConfig.scoreWeight(tid, o);
        return '<button class="btn" data-act="trial" data-o="'+o+'" style="margin:4px 6px 4px 0">'+OUT_LABEL[o]+(wt==null?'':' ·'+wt)+'</button>';
      }).join('');
      h('<div class="a1-h"><button class="btn" data-act="open" data-id="'+s.assessment_id+'" style="padding:4px 10px">‹ 返回</button> &nbsp; '+tid+' '+esc(t.name)+'</div>'+
        '<div class="a1-sub">'+FEED_LABEL[s.feed_mode]+(s.feeder_id?(' · feeder '+esc(s.feeder_id)):'')+' · Tier '+esc(s.assessment_tier)+(target?(' · 参考目标 '+target+' trials'):'')+'</div>'+
        '<div>逐 Trial 记录（原始数据）：</div><div style="margin-top:8px">'+btns+'</div>'+
        '<div>已记录 <b>'+trials.length+'</b> trials</div><div class="a1-list">'+esc(log)+'</div>'+
        '<div class="a1-row" style="border:none;margin-top:12px"><span></span><button class="btn solid" data-act="open" data-id="'+s.assessment_id+'">完成 Done</button></div>');
    });
  }

  // ---------- 事件 ----------
  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'home')  { ui.screen='home'; return render(); }
    if (act === 'new')   { ui.screen='new'; ui.draft={}; return render(); }
    if (act === 'pick-player') { ui.draft.player_id=node.getAttribute('data-pid'); ui.draft.newName=''; return render(); }
    if (act === 'pick-tier')   { ui.draft.tier=node.getAttribute('data-tier'); return render(); }
    if (act === 'pick-level')  { ui.draft.target=parseFloat(node.getAttribute('data-lvl')); return render(); }
    if (act === 'create-asm')  return createAssessment();
    if (act === 'open')  { ui.assessment_id=node.getAttribute('data-id'); ui.screen='detail'; return render(); }
    if (act === 'export'){ return exportJSON(node.getAttribute('data-id')); }
    if (act === 'new-session') { return newSession(node.getAttribute('data-tid')); }
    if (act === 'record'){ return openRecord(node.getAttribute('data-sid')); }
    if (act === 'trial') { return recordTrial(node.getAttribute('data-o')); }
  }

  function createAssessment() {
    var d = ui.draft;
    var pPromise = d.player_id ? Promise.resolve({ player_id: d.player_id })
                               : PBStore.createPlayer(d.newName);
    pPromise.then(function (p) {
      return PBStore.createAssessment({ player_id: p.player_id, assessment_tier: d.tier, target_training_level: d.target });
    }).then(function (a) {
      ui.assessment_id = a.assessment_id; ui.screen='detail'; render();
    });
  }

  function newSession(tid) {
    // 简单内联：用 prompt 选 feed_mode 与 feeder_id（第一版可用为主）
    var modes = PBConfig.feedModes;
    var pick = window.prompt('Feed Mode（喂球方式）——输入序号：\n'+
      modes.map(function(m,i){return (i+1)+') '+FEED_LABEL[m];}).join('\n'), '1');
    if (pick==null) return;
    var idx = parseInt(pick,10)-1; if (isNaN(idx)||idx<0||idx>=modes.length) idx=0;
    var feed_mode = modes[idx];
    var feeder_id = (feed_mode==='machine') ? null : (window.prompt('feeder_id（喂球者标识，可留空）', '')||null);
    var cal = (feed_mode==='calibrated_human') ? (window.prompt('feeder_calibration_id（标定编号，可留空）','')||null) : null;
    PBStore.get('assessments', ui.assessment_id).then(function (a) {
      return PBStore.createTestSession({ assessment_id: ui.assessment_id, test_id: tid,
        assessment_tier: a.assessment_tier, feed_mode: feed_mode, feeder_id: feeder_id, feeder_calibration_id: cal });
    }).then(function (s) { ui.session=s; ui.screen='record'; render(); });
  }

  function openRecord(sid) {
    PBStore.get('test_sessions', sid).then(function (s) { ui.session=s; ui.screen='record'; render(); });
  }

  function recordTrial(outcome) {
    var s = ui.session;
    // T01 不允许 P：双保险（UI 已不出该按钮）
    if (outcome==='P' && !PBConfig.partialAllowed(s.test_id)) { alert(s.test_id+' 不允许 Partial(P)'); return; }
    PBStore.trialsBySession(s.test_session_id).then(function (trials) {
      var nextNo = trials.length + 1;
      return PBStore.addTrialEvent({
        test_session_id: s.test_session_id, trial_no: nextNo, scenario_id: null,
        outcome: outcome, score_weight: PBConfig.scoreWeight(s.test_id, outcome),
        raw_json: { test_id: s.test_id, entered_via: 'a1_ui' }, review_flag: false, video_timestamp_ms: null
      });
    }).then(function () { render(); });
  }

  function exportJSON(aid) {
    PBStore.exportAssessment(aid).then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'assessment_' + aid + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    }).catch(function(err){ alert('导出失败: '+err.message); });
  }

  // ---------- 初始化 ----------
  function init() {
    el = document.getElementById(ROOT_ID);
    if (!el) return; // 不在含该容器的页面则跳过
    el.addEventListener('click', onClick);
    if (typeof PBConfig === 'undefined' || typeof PBStore === 'undefined') {
      el.innerHTML = '<div class="a1-mut">模块未就绪（PBConfig/PBStore 未加载）。</div>'; return;
    }
    PBConfig.load('./data/').then(function () { render(); })
      .catch(function (err) { el.innerHTML = '<div class="a1-mut">配置加载失败：'+esc(err.message)+'</div>'; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
