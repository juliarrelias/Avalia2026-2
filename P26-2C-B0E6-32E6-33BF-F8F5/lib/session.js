const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function signSession(secret, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + "." + (await hmac(secret, body));
}
export async function verifySession(secret, token) {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEq(await hmac(secret, body), sig)) return null;
  try {
    const p = JSON.parse(unb64u(body));
    return typeof p.uid === "string" && typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function parseCookies(request) {
  const out = {};
  (request.headers.get("Cookie") || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return out;
}

export function makeCookie(request, name, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

/** Usuário autenticado (lido do D1 a partir do cookie assinado) ou null. */
export async function getUser({ request, env }) {
  const sess = await verifySession(env.SESSION_SECRET, parseCookies(request).discord_session);
  if (!sess) return null;
  return env.DB.prepare("SELECT user_id AS id, username AS name, avatar FROM discord_users WHERE user_id = ?").bind(sess.uid).first();
}
