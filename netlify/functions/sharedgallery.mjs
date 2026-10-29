/* ═══════════════════════════════════════════════════════════════
   सत्य प्रतिबिम्ब — साझा फ़ोटो गैलरी (Netlify Function + Netlify Blobs)

   संपादक पैनल से बदली गई गैलरी की फ़ोटो/कैप्शन यहाँ सर्वर पर सेव होती हैं,
   ताकि हर डिवाइस पर वही दिखें।

   GET  /.netlify/functions/sharedgallery          → {items:[{img,cap}×5], updated}
   GET  /.netlify/functions/sharedgallery?img=0..4 → सेव की गई फ़ोटो (image)
   POST /.netlify/functions/sharedgallery          → बदलाव सेव (हेडर x-editor-pin ज़रूरी)
        body: { items:[{index, caption?, imageData?(dataURL), imageUrl?}], reset?:true }

   PIN: Netlify → Environment variables में EDITOR_PIN रखें; न रखें तो नीचे का
   डिफ़ॉल्ट इस्तेमाल होगा (वही जो index.html और posts.js में है)।
   ═══════════════════════════════════════════════════════════════ */
import { getStore } from "@netlify/blobs";

const PIN = process.env.EDITOR_PIN || "Satya@2026";
const SLOTS = 5;
const MAX_IMG_BYTES = 1.5 * 1024 * 1024;           // संपीड़ित फ़ोटो की सीमा
const OWN_IMG = /^\/\.netlify\/functions\/sharedgallery\?img=[0-4](&v=\d+)?$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export default async (req) => {
  const store = getStore({ name: "satya-gallery", consistency: "strong" });
  const url = new URL(req.url);

  /* ── GET ── */
  if (req.method === "GET") {
    const imgIdx = url.searchParams.get("img");
    if (imgIdx !== null) {
      if (!/^[0-4]$/.test(imgIdx)) return new Response("bad index", { status: 400 });
      const r = await store.getWithMetadata("img-" + imgIdx, { type: "arrayBuffer" });
      if (!r) return new Response("not found", { status: 404 });
      return new Response(r.data, {
        headers: {
          "Content-Type": (r.metadata && r.metadata.contentType) || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable", // URL में ?v=… बदलने पर नई फ़ोटो
        },
      });
    }
    const meta = (await store.get("meta", { type: "json" })) || { items: [], updated: 0 };
    return json(meta);
  }

  /* ── POST ── */
  if (req.method === "POST") {
    if (req.headers.get("x-editor-pin") !== PIN) return json({ ok: false, error: "गलत PIN" }, 401);

    let body;
    try { body = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }

    if (body.reset) {
      await store.setJSON("meta", { items: [], updated: Date.now() });
      return json({ ok: true, meta: { items: [], updated: Date.now() } });
    }

    const meta = (await store.get("meta", { type: "json" })) || { items: [], updated: 0 };
    const items = Array.from({ length: SLOTS }, (_, i) => (meta.items && meta.items[i]) || null);

    for (const ch of Array.isArray(body.items) ? body.items : []) {
      const idx = Number(ch.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= SLOTS) continue;
      const it = Object.assign({}, items[idx] || {});

      if (typeof ch.caption === "string") it.cap = ch.caption.trim().slice(0, 300);

      if (typeof ch.imageData === "string") {
        const m = ch.imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return json({ ok: false, error: "फ़ोटो का फ़ॉर्मेट ठीक नहीं (jpeg/png/webp चाहिए)" }, 400);
        const buf = Buffer.from(m[2], "base64");
        if (buf.length > MAX_IMG_BYTES) return json({ ok: false, error: "फ़ोटो बहुत बड़ी है" }, 413);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        await store.set("img-" + idx, ab, { metadata: { contentType: m[1] } });
        it.img = "/.netlify/functions/sharedgallery?img=" + idx + "&v=" + Date.now();
      } else if (typeof ch.imageUrl === "string" && ch.imageUrl) {
        if (/^https?:\/\//i.test(ch.imageUrl) || OWN_IMG.test(ch.imageUrl)) it.img = ch.imageUrl.slice(0, 1000);
      }
      items[idx] = it;
    }

    const out = { items, updated: Date.now() };
    await store.setJSON("meta", out);
    return json({ ok: true, meta: out });
  }

  return new Response("method not allowed", { status: 405 });
};
