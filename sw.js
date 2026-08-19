/* Service Worker — Pickleball App 2.0 Alpha (Phase 0)
 * 版本升级：pb40-v8 -> pb40-v14 -> pb40-v15（新增 js/i18n.js 中/EN 切换）
 *   -> pb40-v16（S7-A 新增 js/namespace.js 规范命名空间兼容层）
 *   -> pb40-v17（S7-B 新增 js/review-engine.js Review Snapshot 引擎）
 *   -> pb40-v18（S7-C 新增 js/trend-engine.js 纵向趋势引擎）
 *   -> pb40-v19（S7-D 新增 js/retest-engine.js 处方/复测链接引擎）
 *   -> pb40-v20（S7-E 新增 js/review-ui.js 复盘/趋势 UI）
 *   -> pb40-v21（S8-0/TD-SW-01：code/data 资源改为 network-first，
 *       不再依赖人工记得升版本号才能避免陈旧缓存；见 docs/SW-CACHE-POLICY.md）。
 * 策略（见 docs/SW-CACHE-POLICY.md 完整说明）：
 *   - 导航(HTML) 与 代码/数据资源(js/css/json)：network-first
 *     （在线时始终取最新；离线才回退缓存 —— 陈旧内容不会被静默长期提供）。
 *   - 其它静态资源（图标等，内容极少变化）：stale-while-revalidate。
 *   - activate 阶段清除所有非当前 CACHE 版本（陈旧缓存自动移除）。 */
const CACHE='pb40-v21';
const CORE=[
  './','./index.html','./manifest.json',
  './css/app.css',
  './js/i18n.js','./js/namespace.js','./js/config-loader.js','./js/storage.js','./js/metrics.js','./js/review-engine.js','./js/trend-engine.js','./js/retest-engine.js','./js/review-ui.js','./js/preview.js','./js/app.js','./js/assessment.js',
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
