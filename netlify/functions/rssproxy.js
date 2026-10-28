/* ═══════════════════════════════════════════════════════════════
   सत्य प्रतिबिम्ब — RSS → JSON प्रॉक्सी (Netlify Function)
   rss2json.com की जगह अपना खुद का, मुफ़्त और बिना API-key वाला समाधान।

   उपयोग:  /.netlify/functions/rssproxy?rss_url=<एन्कोडेड RSS URL>
   जवाब :  rss2json जैसा ही format → { status:"ok", feed:{...}, items:[...] }
   ═══════════════════════════════════════════════════════════════ */

/* सिर्फ़ इन्हीं (और इनके subdomains) से फ़ीड लेने की अनुमति — ताकि कोई
   आपके फ़ंक्शन को "ओपन प्रॉक्सी" की तरह इस्तेमाल न कर सके */
const ALLOWED_DOMAINS = [
  'google.com', 'indiatimes.com', 'thehindu.com', 'feedburner.com',
  'bhaskar.com', 'jagran.com', 'livehindustan.com', 'india.com',
  'patrika.com', 'bbci.co.uk', 'bbc.co.uk', 'bbc.com',
];

const MAX_ITEMS = 15;

function hostAllowed(host) {
  return ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function unCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/* tag का भीतरी कच्चा टेक्स्ट (पहला match) */
function rawTag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i'));
    if (m) return unCdata(m[1]).trim();
  }
  return '';
}

/* किसी tag की attribute (जैसे <media:thumbnail url="...">) */
function tagAttr(block, tag, attr, filter) {
  const re = new RegExp('<' + tag + '\\s[^>]*>', 'gi');
  let m;
  while ((m = re.exec(block))) {
    if (filter && !filter(m[0])) continue;
    const a = m[0].match(new RegExp(attr + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
    if (a) return decodeEntities(a[1]);
  }
  return '';
}

/* HTML हटाकर साफ़ सादा टेक्स्ट (XSS-सुरक्षित: < और > पूरी तरह हटा दिए जाते हैं) */
function toPlain(html) {
  let t = decodeEntities(html);
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

function toHttps(u) {
  return u ? u.replace(/^http:\/\//i, 'https://') : '';
}

function parseFeed(xml) {
  const feedHead = xml.split(/<(?:item|entry)[\s>]/i)[0] || '';
  const feed = { title: toPlain(rawTag(feedHead, ['title'])), link: '' };

  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = blocks.slice(0, MAX_ITEMS).map(block => {
    const title = toPlain(rawTag(block, ['title']));

    /* link: RSS → <link>url</link>, Atom → <link href="url"/> */
    let link = toPlain(rawTag(block, ['link']));
    if (!/^https?:\/\//i.test(link)) {
      link = tagAttr(block, 'link', 'href', t => !/rel\s*=\s*["']?(self|enclosure)/i.test(t)) || rawTag(block, ['guid']);
    }
    if (!/^https?:\/\//i.test(link)) link = '';

    const descRaw = rawTag(block, ['content:encoded', 'description', 'summary', 'content']);
    /* <img> खोजने के लिए सभी संभावित body tags देखें */
    const descHtml = decodeEntities(
      rawTag(block, ['content:encoded']) + ' ' + rawTag(block, ['content']) + ' ' + descRaw
    );

    /* thumbnail: media:thumbnail → media:content → enclosure(image) → <img> */
    let thumb =
      tagAttr(block, 'media:thumbnail', 'url') ||
      tagAttr(block, 'media:content', 'url', t => /medium\s*=\s*["']image|type\s*=\s*["']image|\.(jpe?g|png|webp)/i.test(t)) ||
      tagAttr(block, 'enclosure', 'url', t => /type\s*=\s*["']image|\.(jpe?g|png|webp)/i.test(t));
    if (!thumb) {
      const im = descHtml.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (im) thumb = im[1];
    }
    thumb = toHttps(thumb);

    let description = toPlain(descRaw);
    /* Google News आदि: description में सिर्फ़ शीर्षक दोहराया होता है — उसे हटा दें */
    const titleBase = title.replace(/\s[-–]\s[^-–]{2,40}$/, '').trim();
    for (const t of [title, titleBase]) {
      if (t && description.startsWith(t)) { description = description.slice(t.length).trim(); break; }
    }
    if (description.length < 15) description = '';

    return {
      title,
      link,
      description: description.slice(0, 500),
      pubDate: toPlain(rawTag(block, ['pubDate', 'published', 'updated', 'dc:date'])),
      thumbnail: thumb,
      enclosure: thumb ? { link: thumb } : {},
    };
  }).filter(i => i.title);

  return { status: 'ok', feed, items };
}

function reply(statusCode, obj, extra = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});

  const target = (event.queryStringParameters || {}).rss_url;
  if (!target) return reply(400, { status: 'error', message: 'rss_url missing' });

  let u;
  try { u = new URL(target); } catch (e) { return reply(400, { status: 'error', message: 'bad url' }); }
  if (!/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname)) {
    return reply(403, { status: 'error', message: 'host not allowed: ' + u.hostname });
  }

  try {
    const res = await fetch(u.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return reply(502, { status: 'error', message: 'upstream HTTP ' + res.status });

    const xml = (await res.text()).slice(0, 3 * 1024 * 1024);
    const out = parseFeed(xml);
    if (!out.items.length) return reply(502, { status: 'error', message: 'no items in feed' });

    /* CDN पर 5 मिनट कैश — हर विज़िटर पर स्रोत साइट को परेशान न करें, और तेज़ भी */
    return reply(200, out, {
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=900',
    });
  } catch (e) {
    return reply(502, { status: 'error', message: 'fetch failed: ' + (e && e.message) });
  }
};

exports._parseFeed = parseFeed; // परीक्षण के लिए
