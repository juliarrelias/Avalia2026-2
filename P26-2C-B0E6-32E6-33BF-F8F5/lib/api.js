import { getUser, json } from "./session.js";

export const secured = (fn, { body = false } = {}) => async (ctx) => {
  try {
    const { request } = ctx;
    if (request.method !== "GET" && request.method !== "HEAD" &&
        request.headers.get("Origin") !== new URL(request.url).origin)
      return json({ error: "Origem inválida." }, 403);
    const user = await getUser(ctx);
    if (!user) return json({ error: "Faça login com o Discord." }, 401);
    let data = {};
    if (body) {
      if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "Corpo muito grande." }, 413);
      try { data = await request.json(); } catch { return json({ error: "JSON inválido." }, 400); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "JSON inválido." }, 400);
    }
    return await fn(ctx, user, data);
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
};
