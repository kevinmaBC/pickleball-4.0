/* Service Worker — Pickleball App 2.0 Alpha (Phase 0)
 * 版本升级：pb40-v8 -> pb40-v13（新增 css/js/data 核心资源）。
 * 策略：导航(HTML)请求 network-first（避免部署后持续加载旧版代码）；
 *       其它静态资源 stale-while-revalidate；换版本即清旧缓存。 */
const CACHE='pb40-v13';
const CORE=[
  './','./index.html','./manifest.json',
  './css/app.css',
  './js/config-loader.js','./js/storage.js','./js/metrics.js','./js/preview.js','./js/app.js','./js/assessment.js',
  './data/versions.json','./data/test_definitions_v2_3_1.json','./data/assessment_tiers_v2_3_1.json',
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
