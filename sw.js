/* Service Worker — Pickleball App 2.0 Alpha (Phase 0)
 * 版本升级：pb40-v8 -> pb40-v14 -> pb40-v15（新增 js/i18n.js 中/EN 切换）
 *       -> pb40-v16（S1：新增 canonical runtime js/masters-repo.js + js/canonical-runtime.js
 *          与运行时种子 data/canonical/seed_data.json 预缓存）
 *       -> pb40-v17（S2：新增 js/training-evidence.js — 训练证据核心，绑定冻结 canonical
 *          Drill/Master，不做判级/推荐/晋级）
 *       -> pb40-v18（S3：新增 js/training-analytics.js — 只读证据聚合与 KPI 观测核心，
 *          按需计算描述性统计快照，不持久化、不判级/推荐/晋级）
 *       -> pb40-v19（S4：新增 js/player-training-state.js — 只读球员训练状态复合视图，
 *          白名单透传 Assessment 字段 + 组合 S3 训练分析快照，不判级/推荐/晋级）
 *       -> pb40-v20（S5：新增 js/assessment-classifier.js — 只读、纯函数式的正式评估
 *          判级计算核心（capability_score / hard-gate / INCOMPLETE·LOW_CONFIDENCE·
 *          PASS·BORDERLINE·FAIL / 3.0–5.0 最高 PASS 档位），与其配置权威
 *          data/level_gates_v2_3_1.json 一并预缓存；不依赖 PBStore，不做瓶颈/
 *          推荐/处方/P0–P6/晋级/DUPR 解读，不持久化任何结果）。
 *       -> pb40-v21（S6：新增 js/assessment-explainer.js — 只读、纯函数式的评估
 *          解释核心，把调用方显式传入的 S5 结果 + 原始 metrics/levelConfig 翻译成
 *          summary/capability/evidence/hard_gates/match_validation 解释；不重新
 *          分类、不推导 evidence_confidence、不做瓶颈/推荐/处方/P0–P6/晋级/DUPR，
 *          不 fetch 任何配置、不依赖 PBStore，不持久化任何结果）。
 * 策略：导航(HTML)请求 network-first（避免部署后持续加载旧版代码）；
 *       其它静态资源 stale-while-revalidate；换版本即清旧缓存。 */
const CACHE='pb40-v21';
const CORE=[
  './','./index.html','./manifest.json',
  './css/app.css',
  './js/i18n.js','./js/config-loader.js','./js/storage.js','./js/metrics.js','./js/preview.js','./js/app.js','./js/assessment.js',
  './js/masters-repo.js','./js/canonical-runtime.js','./js/training-evidence.js','./js/training-analytics.js','./js/player-training-state.js',
  './js/assessment-classifier.js','./js/assessment-explainer.js',
  './data/versions.json','./data/test_definitions_v2_3_1.json','./data/assessment_tiers_v2_3_1.json',
  './data/level_gates_v2_3_1.json',
  './data/canonical/seed_data.json',
  './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png'
];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;
  const isNav = req.mode==='navigate' || (req.headers.get('accept')||'').includes('text/html');
  if(isNav){ // network-first：始终尝试最新页面，离线回退缓存
    e.respondWith((async()=>{try{const res=await fetch(req);if(res&&res.status===200){const cc=res.clone();caches.open(CACHE).then(c=>c.put(req,cc));}return res;}catch(_){return (await caches.match(req))||(await caches.match('./index.html'));}})());
    return;
  }
  e.respondWith((async()=>{const cached=await caches.match(req);
    const net=fetch(req).then(res=>{if(res&&res.status===200){const cc=res.clone();caches.open(CACHE).then(c=>c.put(req,cc));}return res;}).catch(()=>cached);
    return cached||net;})());});
