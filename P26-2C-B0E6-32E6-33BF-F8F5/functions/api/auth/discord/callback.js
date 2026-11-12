import { makeCookie, parseCookies, signSession } from "../../../../lib/session.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const back = (e) => Response.redirect(new URL("/?auth_error=" + e, url.origin).href, 302);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error") || !code) return back("cancelado");
  if (!state || state !== parseCookies(request).oauth_state) return back("state_invalido");
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) return back("config_ausente");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code", code,
        redirect_uri: new URL("/api/auth/discord/callback", url.origin).href,
      }),
    });
    if (!tokenRes.ok) return back("troca_token");
    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + access_token } });
    if (!userRes.ok) return back("perfil");
    const u = await userRes.json();

    const avatar = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

    await env.DB.prepare(
      `INSERT INTO discord_users (user_id, username, avatar, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, updated_at = CURRENT_TIMESTAMP`
    ).bind(u.id, u.global_name || u.username, avatar).run();

    const week = 7 * 24 * 3600;
    const sid = await signSession(env.SESSION_SECRET, { uid: u.id, exp: Date.now() + week * 1000 });
    const h = new Headers({ Location: "/" });
    h.append("Set-Cookie", makeCookie(request, "discord_session", sid, week));
    h.append("Set-Cookie", makeCookie(request, "oauth_state", "", 0));
    return new Response(null, { status: 302, headers: h });
  } catch (e) {
    console.error(e);
    return back("erro_interno");
  }
}
