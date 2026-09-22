/*  Hakli AFD — offline app shell (service worker)
 *  ------------------------------------------------------------------
 *  WHY: in the field (Khor Kharfot, the jebel) there is often no signal. The
 *  recorder already keeps every take in IndexedDB and uploads when it can — but
 *  without this file the PAGE itself won't open offline, so none of that helps.
 *  This makes the pages open from the phone once they've been visited online.
 *
 *  POLICY — chosen so it can never serve stale code to someone WITH signal:
 *   • Pages (navigations): NETWORK-FIRST. Online → always the live page (and the
 *     cached copy is refreshed). Only when the network fails or stalls past
 *     NAV_TIMEOUT_MS does the last cached copy open instead.
 *   • Same-origin files with a ?v= stamp: cache-first. The stamp changes every
 *     publish (sync-stamp.sh), so a stamped URL's bytes never change — safe to
 *     reuse. Older stamps of the same file are pruned as new ones arrive.
 *   • Other same-origin files (icons, images): network-first, cache fallback.
 *   • Firebase SDK (www.gstatic.com/firebasejs/<version>/…) and Google Fonts:
 *     cache-first — versioned, immutable URLs.
 *   • EVERYTHING ELSE passes straight through, untouched: Firestore, Storage
 *     audio, Auth, the afd-embed matcher, any non-GET request. Data is never
 *     cached here; this file only holds the app's own code and chrome.
 *
 *  KILL SWITCH: if this ever misbehaves, replace the body of this file with
 *      self.addEventListener("install",()=>self.skipWaiting());
 *      self.addEventListener("activate",e=>e.waitUntil((async()=>{
 *        for(const k of await caches.keys()) await caches.delete(k);
 *        await self.registration.unregister(); })()));
 *  and publish. Browsers re-check sw.js on every visit (it is never served from
 *  the HTTP cache for update checks), so phones pick the kill switch up on their
 *  next online visit.
 */
const CACHE = "afd-shell-v1";
const NAV_TIMEOUT_MS = 4000;
// Opened once at install so a phone that visited any page can open these offline.
const CORE = ["./", "index.html", "recorder.html", "welcome.html", "manifest.webmanifest", "favicon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Best-effort per file: one missing page must not abort the whole install.
    await Promise.all(CORE.map(async (u) => {
      try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) await c.put(u, r); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isImmutableExternal(url) {
  return (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))
      || url.hostname === "fonts.gstatic.com"
      || url.hostname === "fonts.googleapis.com";
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;   // pass through
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate" && sameOrigin) { e.respondWith(navigate(e)); return; }
  if (sameOrigin && url.searchParams.has("v")) { e.respondWith(cacheFirst(req, true)); return; }
  if (sameOrigin && !url.pathname.endsWith("sw.js")) { e.respondWith(networkFirst(req)); return; }
  if (isImmutableExternal(url)) { e.respondWith(cacheFirst(req, false)); return; }
  // anything else: not ours — let the browser handle it normally
});

async function navigate(e) {
  const req = e.request;
  const c = await caches.open(CACHE);
  const net = fetch(req).then(async (r) => {
    if (r && r.ok) await c.put(stripQuery(req.url), r.clone());   // one copy per page, ignoring ?query/#hash
    return r;
  });
  e.waitUntil(net.catch(() => {}));                                // let the refresh finish even after we answer
  const timeout = new Promise((res) => setTimeout(() => res(null), NAV_TIMEOUT_MS));
  try {
    const r = await Promise.race([net, timeout]);
    if (r) return r;
  } catch (_) { /* offline — fall through to cache */ }
  const cached = await c.match(stripQuery(req.url))
              || await c.match(new URL("./", self.registration.scope).href);
  if (cached) return cached;
  return net;                                                      // nothing cached: wait on the network after all
}

async function cacheFirst(req, pruneOlderStamps) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && (r.ok || r.type === "opaque")) {
    await c.put(req, r.clone());
    if (pruneOlderStamps) prune(c, req.url);
  }
  return r;
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r && r.ok) await c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

// Drop cached copies of the same file under an older ?v= stamp.
async function prune(c, keepUrl) {
  const keep = new URL(keepUrl);
  for (const k of await c.keys()) {
    const u = new URL(k.url);
    if (u.origin === keep.origin && u.pathname === keep.pathname
        && u.searchParams.has("v") && u.searchParams.get("v") !== keep.searchParams.get("v")) {
      await c.delete(k);
    }
  }
}

function stripQuery(href) { const u = new URL(href); u.search = ""; u.hash = ""; return u.href; }
