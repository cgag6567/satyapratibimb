/* ═══════════════════════════════════════════════════════════════
   सत्य प्रतिबिम्ब — संपादक पैनल के साझा बदलाव (Netlify Function + Blobs)

   संपादक पैनल के टैब (प्रमुख खबरें, संक्षिप्त समाचार, संपादकीय, जोड़े गए लेख)
   में किए गए बदलाव यहाँ सेव होते हैं, ताकि हर डिवाइस पर वही दिखें।

   GET  /.netlify/functions/sharedstate          → {state:{news,briefs,editorial,customEditorials}, updated}
   GET  /.netlify/functions/sharedstate?img=0..4 → प्रमुख खबर की सेव की गई फ़ोटो
   POST /.netlify/functions/sharedstate          → हेडर x-editor-pin ज़रूरी
        { key:"news",      value:{items:[{index,kicker,title,summary,image?,imageData?}]} }
        { key:"briefs",    value:{items:[str|null ×6]} }
        { key:"editorial", value:{title,quote,body} }
        { key:"customEditorials", value:[{category,title,quote,body}] }
        { key:"promoted",  value:[{key,title,summary,category,author,city,postId?,photoSrc?,ts}] }  ← पाठक पोस्ट → समाचार
        { key:"postEdits", value:{ "<पोस्ट key>": {title,content} } }   ← संपादित डेमो/पूल पोस्ट
        { key:"<ऊपर में से कोई>", reset:true }   → ऑटो मोड पर वापस

   PIN: Netlify → Environment variables में EDITOR_PIN (न हो तो नीचे का डिफ़ॉल्ट)
   ═══════════════════════════════════════════════════════════════ */
import { getStore } from "@netlify/blobs";

const PIN = process.env.EDITOR_PIN || "Satya@2026";
const KEYS = ["news", "briefs", "editorial", "customEditorials", "promoted", "postEdits"];
const MAX_IMG_BYTES = 1.5 * 1024 * 1024;
const OWN_IMG = /^\/\.netlify\/functions\/sharedstate\?img=[0-4](&v=\d+)?$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/* custom लेख की body (HTML) — सिर्फ़ सुरक्षित टैग रहने दें */
function cleanHtml(h) {
  return String(h || "")
    .slice(0, 20000)
    .replace(/<(?!\/?(?:p|span|br|b|i|strong|em)\b)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export default async (req) => {
  const store = getStore({ name: "satya-state", consistency: "strong" });
  const url = new URL(req.url);

  /* ── GET ── */
  if (req.method === "GET") {
    const imgIdx = url.searchParams.get("img");
    if (imgIdx !== null) {
      if (!/^[0-4]$/.test(imgIdx)) return new Response("bad index", { status: 400 });
      const r = await store.getWithMetadata("news-img-" + imgIdx, { type: "arrayBuffer" });
      if (!r) return new Response("not found", { status: 404 });
      return new Response(r.data, {
        headers: {
          "Content-Type": (r.metadata && r.metadata.contentType) || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    const all = (await store.get("state", { type: "json" })) || { state: {}, updated: 0 };
    return json(all);
  }

  /* ── POST ── */
  if (req.method === "POST") {
    if (req.headers.get("x-editor-pin") !== PIN) return json({ ok: false, error: "गलत PIN" }, 401);

    let body;
    try { body = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }

    const key = body.key;
    if (!KEYS.includes(key)) return json({ ok: false, error: "अज्ञात key" }, 400);

    const all = (await store.get("state", { type: "json" })) || { state: {}, updated: 0 };
    all.state = all.state || {};

    if (body.reset) {
      delete all.state[key];
    } else if (key === "news") {
      const cur = all.state.news && Array.isArray(all.state.news.items) ? all.state.news.items : [];
      const items = Array.from({ length: 5 }, (_, i) => cur[i] || null);
      for (const ch of Array.isArray(body.value && body.value.items) ? body.value.items : []) {
        const idx = Number(ch.index);
        if (!Number.isInteger(idx) || idx < 0 || idx > 4) continue;
        const it = Object.assign({}, items[idx] || {});
        const title = str(ch.title, 300);   if (title !== undefined) it.title = title;
        const kicker = str(ch.kicker, 80);  if (kicker !== undefined) it.kicker = kicker;
        const summary = str(ch.summary, 1500); if (summary !== undefined) it.summary = summary;

        if (typeof ch.imageData === "string") {
          const m = ch.imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
          if (!m) return json({ ok: false, error: "फ़ोटो का फ़ॉर्मेट ठीक नहीं (jpeg/png/webp चाहिए)" }, 400);
          const buf = Buffer.from(m[2], "base64");
          if (buf.length > MAX_IMG_BYTES) return json({ ok: false, error: "फ़ोटो बहुत बड़ी है" }, 413);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          await store.set("news-img-" + idx, ab, { metadata: { contentType: m[1] } });
          it.image = "/.netlify/functions/sharedstate?img=" + idx + "&v=" + Date.now();
        } else if (typeof ch.image === "string" && ch.image) {
          if (/^https?:\/\//i.test(ch.image) || OWN_IMG.test(ch.image)) it.image = ch.image.slice(0, 1000);
        }
        items[idx] = it;
      }
      all.state.news = { items };
    } else if (key === "briefs") {
      const src = Array.isArray(body.value && body.value.items) ? body.value.items : [];
      all.state.briefs = {
        items: Array.from({ length: 6 }, (_, i) => (typeof src[i] === "string" && src[i].trim() ? src[i].trim().slice(0, 300) : null)),
      };
    } else if (key === "editorial") {
      const v = body.value || {};
      all.state.editorial = {
        title: str(v.title, 300) || "",
        quote: str(v.quote, 500) || "",
        body: str(v.body, 12000) || "",
      };
    } else if (key === "customEditorials") {
      const list = Array.isArray(body.value) ? body.value.slice(0, 30) : [];
      all.state.customEditorials = list
        .map((a) => ({
          category: str(a && a.category, 80) || "विशेष लेख",
          title: str(a && a.title, 300) || "",
          quote: str(a && a.quote, 500) || "",
          body: cleanHtml(a && a.body),
        }))
        .filter((a) => a.title && a.body);
    }

    else if (key === "promoted") {
      const list = Array.isArray(body.value) ? body.value.slice(0, 30) : [];
      all.state.promoted = list
        .map((a) => ({
          key: str(a && a.key, 300) || "",
          title: str(a && a.title, 300) || "",
          summary: str(a && a.summary, 800) || "",
          category: str(a && a.category, 80) || "पाठक रिपोर्ट",
          author: str(a && a.author, 120) || "पाठक संवाददाता",
          city: str(a && a.city, 120) || "",
          postId: str(a && a.postId, 120) || "",
          photoSrc: /^https?:\/\//i.test((a && a.photoSrc) || "") ? String(a.photoSrc).slice(0, 1000) : "",
          ts: Number(a && a.ts) || Date.now(),
        }))
        .filter((a) => a.title && a.summary);
    } else if (key === "postEdits") {
      const src = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : {};
      const out = {};
      for (const k of Object.keys(src).slice(0, 60)) {
        const v = src[k] || {};
        const title = str(v.title, 300), content = str(v.content, 5000);
        if (title && content) out[String(k).slice(0, 300)] = { title, content };
      }
      all.state.postEdits = out;
    }

    all.updated = Date.now();
    await store.setJSON("state", all);
    return json({ ok: true, state: all.state, updated: all.updated });
  }

  return new Response("method not allowed", { status: 405 });
};
