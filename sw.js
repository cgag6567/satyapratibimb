/* ═══════════════════════════════════════════════
   सत्य प्रतिबिम्ब — Service Worker v2
   HTML/navigation: नेटवर्क-पहले (हमेशा ताज़ा कोड)
   बाकी static assets: cache-पहले (तेज़)
   API (shared posts, RSS): हमेशा सीधा नेटवर्क
═══════════════════════════════════════════════ */
const CACHE = 'satya-v2';

const PRECACHE = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ── Install: cache static shell (index.html अब यहाँ शामिल नहीं — network-first) ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: पुराने सभी cache हटाएँ (पुराने satya-v1 सहित) ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  /* शेयर्ड पोस्ट API और समाचार फ़ीड — कभी cache नहीं, हमेशा live नेटवर्क */
  if (url.includes('rss2json.com') || url.includes('rss') || url.includes('news.google') || url.includes('/.netlify/functions/')) {
    return;
  }

  /* नेविगेशन (index.html खोलना) — नेटवर्क-पहले, ताकि नया कोड डिप्लॉय होते ही
     सभी डिवाइस पर तुरंत दिखे। ऑफ़लाइन होने पर ही पुराना cached संस्करण दिखे। */
  if (event.request.mode === 'navigate' || url.endsWith('/index.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  /* बाकी static assets (icons, manifest आदि) — cache-पहले, तेज़ लोडिंग के लिए */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
