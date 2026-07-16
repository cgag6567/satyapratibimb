const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'satya-editorial';
const BLOB_KEY = 'editorial.json';
const EDITOR_PIN = 'Satya@2026'; // यही PIN जो index.html में EDITOR_PIN है — दोनों जगह एक जैसा रखें

const MAX_TITLE_LEN = 300;
const MAX_QUOTE_LEN = 400;
const MAX_BODY_LEN = 20000; // HTML सहित
const MAX_PHOTO_LEN = 1200000; // ~900KB decoded

function getEditorialStore() {
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
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
    store = getEditorialStore();
  } catch (e) {
    return cors({ error: 'स्टोर उपलब्ध नहीं है: ' + e.message }, 500);
  }

  // ── GET: वर्तमान संपादकीय लौटाएँ (null अगर अभी तक कोई सेव नहीं हुआ) ──
  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(BLOB_KEY, { type: 'json' });
      return cors({ editorial: data || null });
    } catch (e) {
      return cors({ editorial: null });
    }
  }

  // ── PUT: संपादकीय अपडेट करें — सिर्फ़ संपादक PIN के साथ ──
  if (event.httpMethod === 'PUT') {
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
    const quote = sanitizeText(body.quote, MAX_QUOTE_LEN);
    const bodyHTML = sanitizeText(body.bodyHTML, MAX_BODY_LEN);
    const category = sanitizeText(body.category, 60);
    const date = sanitizeText(body.date, 60);
    let photo = typeof body.photo === 'string' ? body.photo : '';

    if (!title || !bodyHTML) {
      return cors({ error: 'शीर्षक और लेख आवश्यक हैं।' }, 400);
    }
    if (photo && photo.length > MAX_PHOTO_LEN) {
      return cors({ error: 'फ़ोटो का आकार बहुत बड़ा है।' }, 413);
    }
    if (photo && !photo.startsWith('data:image/')) {
      photo = '';
    }

    const editorial = {
      title,
      quote,
      bodyHTML,
      category,
      date,
      photo,
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(BLOB_KEY, editorial);
    return cors({ editorial });
  }

  return cors({ error: 'विधि समर्थित नहीं' }, 405);
};
