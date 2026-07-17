const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'satya-news';
const BLOB_KEY = 'news.json';
const EDITOR_PIN = 'Satya@2026';

const MAX_HEADLINES = 5;
const MAX_BRIEFS = 6;
const MAX_TITLE_LEN = 200;
const MAX_KICKER_LEN = 80;
const MAX_SUMMARY_LEN = 600;
const MAX_BRIEF_LEN = 300;
const MAX_IMG_LEN = 900000;

function getNewsStore() {
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
    store = getNewsStore();
  } catch (e) {
    return cors({ error: 'स्टोर उपलब्ध नहीं है: ' + e.message }, 500);
  }

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(BLOB_KEY, { type: 'json' });
      return cors({ news: data || null });
    } catch (e) {
      return cors({ news: null });
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

    let existing;
    try {
      existing = await store.get(BLOB_KEY, { type: 'json' });
    } catch (e) {
      existing = null;
    }
    const current = existing || { headlines: [], briefs: [] };

    if (Array.isArray(body.headlines)) {
      const rawHeadlines = body.headlines.slice(0, MAX_HEADLINES);
      const headlines = [];
      for (let i = 0; i < rawHeadlines.length; i++) {
        const h = rawHeadlines[i] || {};
        let img = typeof h.img === 'string' ? h.img : '';
        if (img.length > MAX_IMG_LEN) {
          return cors({ error: 'खबर ' + (i + 1) + ' की फ़ोटो का आकार बहुत बड़ा है — कृपया छोटी/compressed फ़ोटो चुनें।' }, 413);
        }
        headlines.push({
          kicker: sanitizeText(h.kicker, MAX_KICKER_LEN),
          title: sanitizeText(h.title, MAX_TITLE_LEN),
          summary: sanitizeText(h.summary, MAX_SUMMARY_LEN),
          img,
        });
      }
      current.headlines = headlines;
    }

    if (Array.isArray(body.briefs)) {
      current.briefs = body.briefs.slice(0, MAX_BRIEFS).map((b) => sanitizeText(b, MAX_BRIEF_LEN));
    }

    current.updatedAt = new Date().toISOString();
    await store.setJSON(BLOB_KEY, current);
    return cors({ news: current });
  }

  return cors({ error: 'विधि समर्थित नहीं' }, 405);
};
