import { makeCookie } from "../../../lib/session.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DISCORD_CLIENT_ID) return new Response("DISCORD_CLIENT_ID não configurado.", { status: 500 });

  const state = crypto.randomUUID();
  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", new URL("/api/auth/discord/callback", url.origin).href);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: { Location: authorize.href, "Set-Cookie": makeCookie(request, "oauth_state", state, 600) },
  });
}
