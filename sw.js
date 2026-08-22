/* Service Worker — Pickleball App 2.0 Alpha (Phase 0)
 * 版本升级：pb40-v8 -> pb40-v14 -> pb40-v15（新增 js/i18n.js 中/EN 切换）
 *   -> pb40-v16（S7-A 新增 js/namespace.js 规范命名空间兼容层）
 *   -> pb40-v17（S7-B 新增 js/review-engine.js Review Snapshot 引擎）
 *   -> pb40-v18（S7-C 新增 js/trend-engine.js 纵向趋势引擎）
 *   -> pb40-v19（S7-D 新增 js/retest-engine.js 处方/复测链接引擎）
 *   -> pb40-v20（S7-E 新增 js/review-ui.js 复盘/趋势 UI）
 *   -> pb40-v21（S8-0/TD-SW-01：code/data 资源改为 network-first，
 *       不再依赖人工记得升版本号才能避免陈旧缓存；见 docs/SW-CACHE-POLICY.md）
 *   -> pb40-v22（S8-E 新增 js/session-execution-engine.js /
 *       js/training-readiness-engine.js / js/training-ui.js）。
 *   -> pb40-v23（S10-B-R1：把既有 S9-B~F 引擎 + S10-B Dashboard 适配器接入
 *       浏览器脚本链，供 js/review-ui.js Section 7 "Recommendation /
 *       Training Focus" 使用——js/match-observation-engine.js /
 *       js/performance-analysis-engine.js / js/diagnosis-engine.js /
 *       js/recommendation-priority-engine.js /
 *       js/training-prescription-engine.js / js/dashboard-integration-engine.js。
 *       无判定/评分/处方逻辑改动，纯粹是脚本加载清单的增量新增）。
 *   -> pb40-v24（S11-B：新增 js/product-journey-orchestrator.js（S11-A）/
 *       js/home-dashboard-adapter.js / js/home-priority-dashboard-ui.js
 *       （S11-B Home / Priority Dashboard）。同样无判定/评分/处方逻辑改动，
 *       纯粹是脚本加载清单的增量新增）。
 *   -> pb40-v25（S11-C：新增 js/workflow-integration-engine.js（S10-A）/
 *       js/prescription-workflow-engine.js（S10-C）/
 *       js/session-evidence-engine.js（S10-D）/
 *       js/session-evidence-persistence.js（S10-D-R1）/
 *       js/guided-training-action-controller.js /
 *       js/guided-training-ui.js（S11-C Guided Training Action Flow）。
 *       同样无判定/评分/处方逻辑改动，纯粹是脚本加载清单的增量新增）。
 *   -> pb40-v26（S11-D：新增 js/cycle-baseline-engine.js（S10-E-R1）/
 *       js/progress-tracking-engine.js（S10-E-R1）/
 *       js/reassessment-engine.js（S10-E-R1）/
 *       js/progress-reassessment-persistence.js（S10-E-R1）/
 *       js/progress-reassessment-adapter.js /
 *       js/progress-reassessment-ui.js（S11-D Progress / Reassessment
 *       Experience）。同样无判定/评分/处方逻辑改动，纯粹是脚本加载清单的
 *       增量新增）。
 *   -> pb40-v27（S11-E：新增 js/history-explainability-adapter.js /
 *       js/history-explainability-ui.js（S11-E History / Explainability /
 *       Recovery）。同样无判定/评分/处方逻辑改动，无新增持久化，纯粹是
 *       脚本加载清单的增量新增）。
 *   -> pb40-v28（S11-F0-R1：新增 js/decision-cycle-registration-controller.js
 *       ——把 js/review-ui.js 已在内存中算出的 S9 Recommendation/Prescription
 *       经由既有 js/session-evidence-persistence.js 新增的
 *       registerDecisionCycleDurable 登记为持久化的 S10-A Development Cycle /
 *       S10-C Prescription Workflow。无新增 store，无 DB_VERSION 变更，
 *       无判定/评分/处方逻辑改动，纯粹是脚本加载清单的增量新增）。
 * 策略（见 docs/SW-CACHE-POLICY.md 完整说明）：
 *   - 导航(HTML) 与 代码/数据资源(js/css/json)：network-first
 *     （在线时始终取最新；离线才回退缓存 —— 陈旧内容不会被静默长期提供）。
 *   - 其它静态资源（图标等，内容极少变化）：stale-while-revalidate。
 *   - activate 阶段清除所有非当前 CACHE 版本（陈旧缓存自动移除）。 */
const CACHE='pb40-v28';
const CORE=[
  './','./index.html','./manifest.json',
  './css/app.css',
  './js/i18n.js','./js/namespace.js','./js/config-loader.js','./js/storage.js','./js/metrics.js','./js/review-engine.js','./js/trend-engine.js','./js/retest-engine.js','./js/match-observation-engine.js','./js/performance-analysis-engine.js','./js/diagnosis-engine.js','./js/recommendation-priority-engine.js','./js/training-prescription-engine.js','./js/dashboard-integration-engine.js','./js/workflow-integration-engine.js','./js/prescription-workflow-engine.js','./js/session-evidence-engine.js','./js/session-evidence-persistence.js','./js/cycle-baseline-engine.js','./js/progress-tracking-engine.js','./js/reassessment-engine.js','./js/progress-reassessment-persistence.js','./js/product-journey-orchestrator.js','./js/home-dashboard-adapter.js','./js/home-priority-dashboard-ui.js','./js/guided-training-action-controller.js','./js/guided-training-ui.js','./js/progress-reassessment-adapter.js','./js/progress-reassessment-ui.js','./js/history-explainability-adapter.js','./js/history-explainability-ui.js','./js/decision-cycle-registration-controller.js','./js/review-ui.js','./js/session-execution-engine.js','./js/training-readiness-engine.js','./js/training-ui.js','./js/preview.js','./js/app.js','./js/assessment.js',
  './data/versions.json','./data/test_definitions_v2_3_1.json','./data/assessment_tiers_v2_3_1.json','./data/level_gates_v2_3_1.json','./data/evidence_confidence_v2_3_1.json',
  './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png'
];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  const isNav = req.mode==='navigate' || (req.headers.get('accept')||'').includes('text/html');
  const isCodeOrData = /\.(js|css|json)$/i.test(url.pathname); // 方法学相关代码/数据：绝不陈旧提供
  if(isNav || isCodeOrData){ // network-first：在线始终取最新；离线回退缓存
    e.respondWith((async()=>{try{const res=await fetch(req);if(res&&res.status===200){const cc=res.clone();caches.open(CACHE).then(c=>c.put(req,cc));}return res;}catch(_){return (await caches.match(req))||(isNav?await caches.match('./index.html'):undefined);}})());
    return;
  }
  e.respondWith((async()=>{const cached=await caches.match(req); // 静态资源（图标等）：stale-while-revalidate
    const net=fetch(req).then(res=>{if(res&&res.status===200){const cc=res.clone();caches.open(CACHE).then(c=>c.put(req,cc));}return res;}).catch(()=>cached);
    return cached||net;})());});
