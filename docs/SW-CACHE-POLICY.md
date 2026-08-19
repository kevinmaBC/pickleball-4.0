# Service Worker Cache/Version Policy (TD-SW-01 resolution)

## Problem this resolves

Before S8-0, every asset except navigation used **stale-while-revalidate**
(SWR): the cached copy was served immediately and refreshed in the
background. Cache invalidation depended on a human bumping the `CACHE`
constant in `sw.js` on every deploy that changed a cached file. When a
fix-only commit changed `js/*.js` but not `sw.js` (as happened for three
post-S7-E commits — see `docs/S7-FINAL-ACCEPTANCE.md`), the browser never
saw `sw.js` change, so the old service worker kept running with the old
`CACHE` object. Devices that already had that service worker installed
served one stale reload of the changed file before self-healing.

## Policy (current: `pb40-v21`)

Requests are split into two groups by the fetch handler in `sw.js`:

| Group | Matches | Strategy |
|---|---|---|
| **Navigation + code/data** | HTML navigations, `*.js`, `*.css`, `*.json` | **network-first**: always try the network; only fall back to cache when offline. |
| **Static assets** | icons, `apple-touch-icon.png`, everything else in `CORE` not matched above | **stale-while-revalidate**: serve cached copy instantly, refresh in background. |

This removes the dependency on remembering to bump `CACHE` for
*content freshness*: any file that can affect app logic, methodology
constants, or UI (js/css/json) is re-fetched from the network whenever the
device is online, so a deploy cannot silently remain stale indefinitely.
The cache for these files still exists and is still used — but only as an
**offline fallback**, never as the default source while online.

Icons/images are left on SWR because they are large, essentially static,
and staleness there has no methodology or correctness impact.

## Version bump (`CACHE` constant)

Still bump `CACHE` (`pb40-vNN`) whenever the `CORE` file list itself
changes (a file added/removed) or a clean-slate cache reset is wanted.
This is no longer required just to avoid serving stale JS/CSS/JSON — that
is now handled automatically by the network-first strategy above — but it
remains the mechanism for pruning obsolete cache entries.

## Obsolete cache cleanup

Unchanged from prior versions: on `activate`, every cache key that is not
the current `CACHE` is deleted:

```js
self.addEventListener('activate', e => { e.waitUntil((async () => {
  const ks = await caches.keys();
  await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()); });
```

Combined with `self.skipWaiting()` on install, a new service worker takes
control immediately and purges old cache versions — no manual cleanup step
is required.

## Offline/PWA behavior

Unaffected. Every strategy above still falls back to the cache when
`fetch` fails (offline), and navigation still falls back to
`./index.html` for SPA-style offline loads.
