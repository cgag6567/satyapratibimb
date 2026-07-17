const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'satya-gallery';
const BLOB_KEY = 'gallery.json';
const EDITOR_PIN = 'Satya@2026';

const MAX_ITEMS = 5;
const MAX_CAPTION_LEN = 200;
const MAX_IMG_LEN = 900000;

function getGalleryStore() {
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
    store = getGalleryStore();
  } catch (e) {
    return cors({ error: 'स्टोर उपलब्ध नहीं है: ' + e.message }, 500);
  }

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(BLOB_KEY, { type: 'json' });
      return cors({ gallery: data || null });
    } catch (e) {
      return cors({ gallery: null });
    }
  }

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

    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (rawItems.length === 0) {
      return cors({ error: 'कम से कम एक फ़ोटो आवश्यक है।' }, 400);
    }

    const items = rawItems.map((it) => {
      let img = typeof it.img === 'string' ? it.img : '';
      if (img.length > MAX_IMG_LEN) img = '';
      return {
        img,
        caption: sanitizeText(it.caption, MAX_CAPTION_LEN),
      };
    });

    const gallery = { items, updatedAt: new Date().toISOString() };
    await store.setJSON(BLOB_KEY, gallery);
    return cors({ gallery });
  }

  return cors({ error: 'विधि समर्थित नहीं' }, 405);
};
