import { deflateRawSync, inflateRawSync } from "node:zlib";

const TTL_SECONDS = 24 * 60 * 60;
const MAX_BODY_BYTES = 200_000;
const ALLOWED_ORIGIN = "https://rorocrate.github.io";

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) } });
}
function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64url(bytes) {
  let binary = "";
  for (let i=0; i<bytes.length; i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4-normalized.length%4)%4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (!origin || origin !== ALLOWED_ORIGIN) return json({ error: "Origin is not allowed." }, 403, origin);

    if (url.pathname === "/api/share" && request.method === "POST") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > MAX_BODY_BYTES) return json({ error: "共有データが大きすぎます。" }, 413, origin);
      let payload;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "共有データが大きすぎます。" }, 413, origin);
        payload = JSON.parse(raw);
      } catch { return json({ error: "JSON形式のデータを送信してください。" }, 400, origin); }
      if (!payload || payload.version !== 1 || !["analysis-preview", "sync-preview"].includes(payload.kind) || typeof payload.name !== "string") {
        return json({ error: "共有データの形式が正しくありません。" }, 400, origin);
      }
      const id = makeId();
      const expiresAt = Date.now() + TTL_SECONDS * 1000;
      try {
        const compact = JSON.stringify({ expiresAt, payload });
        const compressed = deflateRawSync(Buffer.from(compact, "utf8"));
        await env.SHARES.put(id, base64url(compressed), { expirationTtl: TTL_SECONDS });
        return json({ id, expiresAt, ttlSeconds: TTL_SECONDS }, 201, origin);
      } catch (e) {
        return json({ error: "共有データを保存できませんでした。" }, 500, origin);
      }
    }

    const match = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{12})$/);
    if (match && request.method === "GET") {
      try {
        const token = await env.SHARES.get(match[1]);
        if (!token) return json({ error: "共有データの有効期限が切れたか、存在しません。" }, 404, origin);
        const packed = inflateRawSync(Buffer.from(fromBase64url(token)));
        const record = JSON.parse(packed.toString("utf8"));
        if (!record || !record.expiresAt || Date.now() >= record.expiresAt) {
          await env.SHARES.delete(match[1]);
          return json({ error: "共有データの有効期限が切れました。" }, 404, origin);
        }
        return json({ payload: record.payload, expiresAt: record.expiresAt }, 200, origin);
      } catch {
        return json({ error: "共有データを取得できませんでした。" }, 500, origin);
      }
    }
    return json({ error: "Not found." }, 404, origin);
  }
};
