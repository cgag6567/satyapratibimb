// Netlify Function: /rss.xml
// Generates RSS 2.0 feed from वाक ऋचा posts
import { getStore } from "@netlify/blobs";

const SITE_URL = "https://vaak-richa-new.netlify.app";
const SITE_NAME = "वाक ऋचा — रचनात्मक अभिव्यक्ति का राष्ट्रीय मंच";

function escapeXml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, context) {
  const store = getStore({ name: "vaakricha-posts", consistency: "strong", ...context });
  let posts = [];
  try {
    const raw = await store.get("posts");
    posts = raw ? JSON.parse(raw) : [];
  } catch { posts = []; }

  const items = posts.slice(0, 20).map(post => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${SITE_URL}/?post=${encodeURIComponent(post.id)}</link>
      <guid isPermaLink="true">${SITE_URL}/?post=${encodeURIComponent(post.id)}</guid>
      <description>${escapeXml((post.content || "").slice(0, 300))}</description>
      <author>${escapeXml(post.name || "वाक ऋचा")}</author>
      <category>${escapeXml(post.category || "सामान्य")}</category>
      <pubDate>${new Date(post.timestamp).toUTCString()}</pubDate>
    </item>`).join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${SITE_URL}</link>
    <description>साहित्य, राजनीति, खेल, स्वास्थ्य और अन्य विषयों पर रचनाएं।</description>
    <language>hi</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/icons/icon-192.png</url>
      <title>वाक ऋचा</title>
      <link>${SITE_URL}</link>
    </image>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export const config = { path: "/rss.xml" };
