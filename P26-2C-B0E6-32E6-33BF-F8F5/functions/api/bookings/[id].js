import { json } from "../../../lib/session.js";
import { secured } from "../../../lib/api.js";

// DELETE /api/bookings/:id -> cancelamento prévio (aluno dono ou monitor do slot)
export const onRequestDelete = secured(async ({ env, params }, user) => {
  const id = Number(params.id);
  const b = await env.DB.prepare(
    "SELECT b.student_id, s.monitor_id, s.start_ts FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id = ?"
  ).bind(id).first();
  if (!b) return json({ error: "Agendamento não encontrado." }, 404);
  if (b.student_id !== user.id && b.monitor_id !== user.id) return json({ error: "Sem permissão para cancelar." }, 403);
  if (b.start_ts <= Date.now()) return json({ error: "Só é possível cancelar antes do início." }, 400);
  await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(id).run();
  return json(null, 204);
});
