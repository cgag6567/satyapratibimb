const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'satya-reader-posts';
const BLOB_KEY = 'posts.json';
const MAX_POSTS = 300;
const MAX_CONTENT_LEN = 4000;
const MAX_TITLE_LEN = 200;
const MAX_PHOTO_LEN = 900000; // ~650KB decoded, guards against huge payloads
const EDITOR_PIN = 'Satya@2026'; // यही PIN जो index.html में EDITOR_PIN है — दोनों जगह एक जैसा रखें

function getPostsStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore(STORE_NAME);
}

function cors(body, status, extraHeaders) {
  return {
    statusCode: status || 200,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-editor-pin',
        'Cache-Control': 'no-store',
      },
      extraHeaders || {}
    ),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function sanitizeText(s, max) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max);
}

function isPinValid(event) {
  const headerPin = event.headers['x-editor-pin'] || event.headers['X-Editor-Pin'];
  return headerPin === EDITOR_PIN;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return cors('', 204);
  }

  let store;
  try {
    store = getPostsStore();
  } catch (e) {
    return cors({ error: 'स्टोर उपलब्ध नहीं है: ' + e.message + ' — README.txt में "Blobs सेटअप" सेक्शन देखें।' }, 500);
  }

  const loadPosts = async () => {
    try {
      const data = await store.get(BLOB_KEY, { type: 'json' });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  };
  const savePosts = async (posts) => {
    await store.setJSON(BLOB_KEY, posts);
  };

  // ── GET: सभी साझा पाठक पोस्ट लौटाएँ ──
  if (event.httpMethod === 'GET') {
    const posts = await loadPosts();
    return cors({ posts });
  }

  // ── POST: नई पोस्ट जोड़ें (कोई भी विज़िटर) ──
  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return cors({ error: 'अमान्य डेटा' }, 400);
    }

    const name = sanitizeText(body.name, 80);
    const city = sanitizeText(body.city, 80);
    const type = ['news', 'article', 'opinion'].includes(body.type) ? body.type : 'article';
    const title = sanitizeText(body.title, MAX_TITLE_LEN);
    const content = sanitizeText(body.content, MAX_CONTENT_LEN);
    let photo = typeof body.photo === 'string' ? body.photo : '';

    if (!name || !title || !content) {
      return cors({ error: 'नाम, शीर्षक और सामग्री आवश्यक हैं।' }, 400);
    }
    if (photo && photo.length > MAX_PHOTO_LEN) {
      return cors({ error: 'फ़ोटो का आकार बहुत बड़ा है। कृपया छोटी फ़ोटो चुनें।' }, 413);
    }
    if (photo && !photo.startsWith('data:image/')) {
      photo = '';
    }

    const post = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      city,
      type,
      title,
      content,
      photo,
      likes: 0,
      promoted: false,
      createdAt: new Date().toISOString(),
    };

    const posts = await loadPosts();
    posts.unshift(post);
    if (posts.length > MAX_POSTS) posts.length = MAX_POSTS;
    await savePosts(posts);

    return cors({ post }, 201);
  }

  // ── PUT: पोस्ट संपादित करें / लाइक बढ़ाएँ / प्रमोट करें ──
  if (event.httpMethod === 'PUT') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return cors({ error: 'अमान्य डेटा' }, 400);
    }
    const id = body.id;
    if (!id) return cors({ error: 'id आवश्यक है' }, 400);

    const posts = await loadPosts();
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) return cors({ error: 'पोस्ट नहीं मिली' }, 404);

    if (body.action === 'like') {
      posts[idx].likes = (posts[idx].likes || 0) + 1;
      await savePosts(posts);
      return cors({ post: posts[idx] });
    }

    if (!isPinValid(event)) {
      return cors({ error: 'अस्वीकृत — संपादक PIN ग़लत या अनुपस्थित है।' }, 401);
    }

    if (typeof body.title === 'string') posts[idx].title = sanitizeText(body.title, MAX_TITLE_LEN);
    if (typeof body.content === 'string') posts[idx].content = sanitizeText(body.content, MAX_CONTENT_LEN);
    if (typeof body.promoted === 'boolean') posts[idx].promoted = body.promoted;
    posts[idx].editedAt = new Date().toISOString();

    await savePosts(posts);
    return cors({ post: posts[idx] });
  }

  // ── DELETE: पोस्ट हटाएँ — सिर्फ़ संपादक PIN के साथ ──
  if (event.httpMethod === 'DELETE') {
    if (!isPinValid(event)) {
      return cors({ error: 'अस्वीकृत — संपादक PIN ग़लत या अनुपस्थित है।' }, 401);
    }
    const id = (event.queryStringParameters || {}).id;
    if (!id) return cors({ error: 'id आवश्यक है' }, 400);

    const posts = await loadPosts();
    const next = posts.filter((p) => p.id !== id);
    await savePosts(next);
    return cors({ ok: true, removed: posts.length !== next.length });
  }

  return cors({ error: 'विधि समर्थित नहीं' }, 405);
};
