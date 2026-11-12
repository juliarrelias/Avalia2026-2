import { json } from "../../../lib/session.js";
import { secured } from "../../../lib/api.js";

// DELETE /api/slots/:id -> só o monitor autor remove, e só se não houver aluno agendado
export const onRequestDelete = secured(async ({ env, params }, user) => {
  const id = Number(params.id);
  const slot = await env.DB.prepare("SELECT monitor_id FROM slots WHERE id = ?").bind(id).first();
  if (!slot) return json({ error: "Horário não encontrado." }, 404);
  if (slot.monitor_id !== user.id) return json({ error: "Você não é o autor deste horário." }, 403);
  const r = await env.DB.prepare(
    `DELETE FROM slots WHERE id = ? AND monitor_id = ?
       AND NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id = slots.id)`
  ).bind(id, user.id).run();
  if (r.meta.changes === 0)
    return json({ error: "Este horário tem um aluno agendado. Cancele o agendamento antes de remover." }, 409);
  return json(null, 204);
});