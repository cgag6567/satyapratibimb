const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'satya-promoted-news';
const BLOB_KEY = 'promoted.json';
const EDITOR_PIN = 'Satya@2026'; // यही PIN जो index.html में EDITOR_PIN है — दोनों जगह एक जैसा रखें

const MAX_ITEMS = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 घंटे बाद अपने आप हट जाएँ
const MAX_TITLE_LEN = 200;
const MAX_SUMMARY_LEN = 500;
const MAX_CATEGORY_LEN = 60;
const MAX_AUTHOR_LEN = 100;
const MAX_CITY_LEN = 80;
const MAX_PHOTO_LEN = 900000; // ~650KB decoded

function getPromotedStore() {
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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
    store = getPromotedStore();
  } catch (e) {
    return cors({ error: 'स्टोर उपलब्ध नहीं है: ' + e.message }, 500);
  }

  const loadItems = async () => {
    try {
      const data = await store.get(BLOB_KEY, { type: 'json' });
      const items = Array.isArray(data) ? data : [];
      const now = Date.now();
      const fresh = items.filter((it) => {
        const age = now - new Date(it.createdAt).getTime();
        return isFinite(age) ? age < MAX_AGE_MS : true;
      });
      if (fresh.length !== items.length) {
        // पुराने (24 घंटे से ज़्यादा) आइटम हमेशा के लिए हटा दें
        await store.setJSON(BLOB_KEY, fresh);
      }
      return fresh;
    } catch (e) {
      return [];
    }
  };

  // ── GET: सभी प्रकाशित (promoted) पाठक-समाचार लौटाएँ ──
  if (event.httpMethod === 'GET') {
    const items = await loadItems();
    return cors({ items });
  }

  // ── POST: नया प्रकाशित समाचार जोड़ें — सिर्फ़ संपादक PIN के साथ ──
  if (event.httpMethod === 'POST') {
    if (!isPinValid(event)) {
      return cors({ error: 'अस्वीकृत — संपादक PIN ग़लत या अनुपस्थित है।' }, 401);
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return cors({ error: 'अमान्य डेटा' }, 400);
    }

    const title = sanitizeText(body.title, MAX_TITLE_LEN);
    const summary = sanitizeText(body.summary, MAX_SUMMARY_LEN);
    const category = sanitizeText(body.category, MAX_CATEGORY_LEN);
    const author = sanitizeText(body.author, MAX_AUTHOR_LEN);
    const city = sanitizeText(body.city, MAX_CITY_LEN);
    let photoSrc = typeof body.photoSrc === 'string' ? body.photoSrc : '';

    if (!title || !summary) {
      return cors({ error: 'शीर्षक और सारांश आवश्यक हैं।' }, 400);
    }
    if (photoSrc && photoSrc.length > MAX_PHOTO_LEN) {
      return cors({ error: 'फ़ोटो का आकार बहुत बड़ा है।' }, 413);
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title,
      summary,
      category,
      author,
      city,
      photoSrc,
      createdAt: new Date().toISOString(),
    };

    const items = await loadItems();
    items.unshift(item);
    if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    await store.setJSON(BLOB_KEY, items);

    return cors({ item }, 201);
  }

  // ── DELETE: कोई प्रकाशित समाचार हटाएँ — सिर्फ़ संपादक PIN के साथ ──
  if (event.httpMethod === 'DELETE') {
    if (!isPinValid(event)) {
      return cors({ error: 'अस्वीकृत — संपादक PIN ग़लत या अनुपस्थित है।' }, 401);
    }
    const id = (event.queryStringParameters || {}).id;
    if (!id) return cors({ error: 'id आवश्यक है' }, 400);

    const items = await loadItems();
    const next = items.filter((it) => it.id !== id);
    await store.setJSON(BLOB_KEY, next);
    return cors({ ok: true, removed: items.length !== next.length });
  }

  return cors({ error: 'विधि समर्थित नहीं' }, 405);
};
