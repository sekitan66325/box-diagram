/* 箱ダイヤ描画システム PWA Service Worker (v1.2.0) */
const CACHE_NAME = "hakodiagram-v1.2.0";

const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/analytics.js",
  "./js/sample-data.js",
  "./js/data-model.js",
  "./js/oud-parser.js",
  "./js/diagram-renderer.js",
  "./js/table-editor.js",
  "./js/app.js",
  "./assets/favicon.svg",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./TERMS.md"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        APP_SHELL_URLS.map(async (url) => {
          try {
            const req = new Request(url, { cache: "reload" });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(url, res);
            }
          } catch (_) {
            // 個別取得失敗時も他アセットのインストールを継続
          }
        })
      );
    } finally {
      self.skipWaiting();
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("hakodiagram-") && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  let reqUrl;
  try {
    reqUrl = new URL(req.url);
  } catch (_) {
    return;
  }

  // 外部オリジン（Google Analytics / 外部フォーム等）は素通しする
  if (reqUrl.origin !== self.location.origin) return;

  // Network-First + Cache Fallback（オフライン・電波不安定時も起動可能）
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const netRes = await fetch(req);
      if (netRes && netRes.ok && netRes.type === "basic") {
        cache.put(req, netRes.clone()).catch(() => {});
      }
      return netRes;
    } catch (_) {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
