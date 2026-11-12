import { getUser, json } from "../../lib/session.js";

export async function onRequestGet(ctx) {
  const user = await getUser(ctx);
  return json({ user: user || null });
}
