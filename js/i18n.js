/* ============================================================
 * i18n.js — Pickleball App 2.0 Alpha · 中/EN 切换（第一期）
 * 范围：App 外壳（头/footer/导航）+ 总览(v-home) + 测·Measure 全套评估界面。
 * 学/练/赛/队 四个教学标签仅翻标题/副标题骨架，正文教材留待第二期。
 * 用法：静态文案用 data-i18n / data-i18n-html / data-i18n-ph 标记；
 *       动态渲染（app.js / assessment.js）里用全局 LANG + t() 判断。
 * ============================================================ */
(function () {
  'use strict';
  var LKEY = 'pb40_lang';

  var I18N = {
    zh: {
      'shell.footer': '整理 by Kevin Ma　|　所有记录仅保存在本设备浏览器 · 请定期"导出备份"<br>规则依据 The Dink MiLP 官方手册 2025-10-21',
      'shell.feedbackBtn': '💬 反馈 Feedback',

      'home.lead': '不靠力量打穿对手，而是用<b>弧线、旋转与判断</b>让对手无力回击。',
      'home.desc': '从 3.0 到稳定 4.0 冲 5.0 的一套闭环培训手册：学教材 → 练打卡 → 测评级 → 赛规则。全部记录只存在你自己的设备上。',
      'home.gatesH3': '稳定 4.0 · 六道硬门槛 <span class="en">Six Hard Gates</span>',
      'home.gatesSub': '全绿才算稳定 4.0 —— 不能靠单项特别强来抵消短板。数据来自「测」页，实时联动。',
      'home.mapH3': '五份资料如何组成一套体系 <span class="en">System Map</span>',
      'home.tblDoc': '资料 Doc',
      'home.tblLayer': '层级 Layer',
      'home.tblRole': '作用',
      'home.doc.textbook': '匹克球大全',
      'home.role.textbook': '学什么：技术+战术+训练全书（第1–17章）',
      'home.doc.sss': '决策系统 SSS',
      'home.role.sss': '这一拍打什么、怎么打（Drive/Drop/Reset/Leave）',
      'home.role.kpi': '量化现在几分、哪个模块最弱',
      'home.doc.milpTrack': 'MiLP 打卡表',
      'home.role.milpTrack': '练了没、达标没、趋势如何',
      'home.doc.milpRules': 'MiLP 规则+规划',
      'home.role.milpRules': '团体赛怎么打、团队练什么',

      'measure.h2': '测 · 4.0 KPI',
      'measure.sub': '10 模块加权综合分（满分 100）+ 水平判定 + 六道硬门槛。拖动滑块填入每场录像统计的当前%。<span class="en">Composite KPI Dashboard</span>',
      'measure.levelLabel': '当前水平 <span class="en">Level</span>',
      'measure.gatesH3': '六道硬门槛 <span class="en">Hard Gates</span>',
      'measure.ueCallout': 'UE 特殊项：<b>每局非受迫失误</b> <span class="en">(UE/game)</span> 单独输入，自动映射为分数（≤2→95, ≤4→85, ≤6→77, ≤8→68, ≤10→58, &gt;10→45）。门槛为 ≤5 次/局。',
      'measure.ueLabel': '每局非受迫失误 UE/game',
      'measure.ueMapped': '映射分数',

      'learn.h2': '学 · 教材主干',
      'learn.sub': '《匹克球大全》五段式教学：定义 → 技术分解 → 常见错误 → 实战 → 训练。<span class="en">Definition → Breakdown → Errors → Cases → Drills</span>',
      'drill.h2': '练 · 8 周打卡',
      'drill.sub': 'MiLP 团队 8 周训练（DUPR 16 组）。逐项选达标状态，自动统计。<span class="en">8-Week Team Log</span>',
      'compete.h2': '赛 · MiLP 规则',
      'compete.sub': 'The Dink 小联盟 MLPlay™ 团体赛（2男2女）。<span class="en">Rules Digest & Pre-Match Flow</span>',
      'team.h2': '队 · 同步',
      'team.sub': '连云端后你的记录自动上传，教练可一处看全队。<span class="en">Cloud Sync via Supabase</span>'
    },
    en: {
      'shell.footer': 'Curated by Kevin Ma&nbsp;&nbsp;|&nbsp;&nbsp;All records stay only in this device\'s browser · Export backups regularly<br>Rules based on The Dink MiLP Official Handbook 2025-10-21',
      'shell.feedbackBtn': '💬 Feedback',

      'home.lead': 'Don\'t overpower your opponent with raw strength — use <b>arc, spin, and judgment</b> to leave them unable to counter.',
      'home.desc': 'A closed-loop training system from 3.0 to a stable 4.0 and on to 5.0: Learn the material → Drill and log → Measure your level → Compete by the rules. All records stay only on your own device.',
      'home.gatesH3': 'Stable 4.0 · Six Hard Gates',
      'home.gatesSub': 'All six must be green to count as a stable 4.0 — one strong skill can\'t offset a weak one. Data is live-linked from the Measure tab.',
      'home.mapH3': 'How the Five Documents Form One System',
      'home.tblDoc': 'Document',
      'home.tblLayer': 'Layer',
      'home.tblRole': 'Role',
      'home.doc.textbook': 'Pickleball Compendium',
      'home.role.textbook': 'What to learn: the full technique + tactics + training book (Ch. 1–17)',
      'home.doc.sss': 'SSS Decision System',
      'home.role.sss': 'What to hit this shot and how (Drive / Drop / Reset / Leave)',
      'home.role.kpi': 'Quantify your current score and weakest module',
      'home.doc.milpTrack': 'MiLP Tracker',
      'home.role.milpTrack': 'Whether you\'ve trained, hit target, and the trend',
      'home.doc.milpRules': 'MiLP Rules & Planning',
      'home.role.milpRules': 'How to play team matches and what the team should drill',

      'measure.h2': 'Measure · 4.0 KPI',
      'measure.sub': 'A 10-module weighted composite score (out of 100) + level rating + six hard gates. Drag the sliders to enter your current % from match footage.',
      'measure.levelLabel': 'Level',
      'measure.gatesH3': 'Six Hard Gates',
      'measure.ueCallout': 'UE is a special module: enter <b>unforced errors per game</b> <span class="en">(UE/game)</span> directly — it auto-maps to a score (≤2→95, ≤4→85, ≤6→77, ≤8→68, ≤10→58, &gt;10→45). Gate threshold: ≤5 per game.',
      'measure.ueLabel': 'Unforced Errors / game (UE)',
      'measure.ueMapped': 'Mapped score',

      'learn.h2': 'Learn · Core Curriculum',
      'learn.sub': 'The Pickleball Compendium\'s five-part method: Definition → Breakdown → Errors → Cases → Drills.',
      'drill.h2': 'Drill · 8-Week Log',
      'drill.sub': 'MiLP team\'s 8-week training program (DUPR 16 division). Mark each item\'s status; totals update automatically.',
      'compete.h2': 'Compete · MiLP Rules',
      'compete.sub': 'The Dink Minor League MLPlay™ team event (2 men, 2 women).',
      'team.h2': 'Team · Sync',
      'team.sub': 'Once connected to the cloud, your records upload automatically so coaches can see the whole team in one place.'
    }
  };

  var LANG = 'zh';
  try { LANG = localStorage.getItem(LKEY) || 'zh'; } catch (e) {}

  function t(key, fallback) {
    var d = I18N[LANG] || I18N.zh;
    if (Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    if (Object.prototype.hasOwnProperty.call(I18N.zh, key)) return I18N.zh[key];
    return fallback != null ? fallback : key;
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-html]').forEach(function (e) { e.innerHTML = t(e.getAttribute('data-i18n-html')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (e) { e.setAttribute('placeholder', t(e.getAttribute('data-i18n-ph'))); });
    document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
    var btn = document.getElementById('lang-btn');
    if (btn) btn.innerHTML = LANG === 'en' ? '<b>EN</b> / 中' : '中 / <b>EN</b>';
  }

  function refreshDynamic() {
    if (typeof renderModules === 'function') renderModules();
    if (typeof renderGates === 'function') renderGates();
    if (typeof computeKPI === 'function') computeKPI();
    if (window.PBAssessment && typeof window.PBAssessment.refresh === 'function') window.PBAssessment.refresh();
    if (window.PBTrainingUI && typeof window.PBTrainingUI.refresh === 'function') window.PBTrainingUI.refresh();
  }

  function setLang(lang) {
    if (lang !== LANG) {
      LANG = lang;
      try { localStorage.setItem(LKEY, LANG); } catch (e) {}
    }
    applyI18n();
    refreshDynamic();
  }
  function toggleLang() { setLang(LANG === 'zh' ? 'en' : 'zh'); }

  window.t = t;
  window.applyI18n = applyI18n;
  window.setLang = setLang;
  window.toggleLang = toggleLang;
  Object.defineProperty(window, 'LANG', { get: function () { return LANG; } });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyI18n);
  else applyI18n();
})();
