import { json, makeCookie } from "../../../lib/session.js";

export async function onRequestPost({ request }) {
  const o = request.headers.get("Origin");
  if (o && o !== new URL(request.url).origin) return json({ error: "Origem inválida." }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": makeCookie(request, "discord_session", "", 0) });
}
