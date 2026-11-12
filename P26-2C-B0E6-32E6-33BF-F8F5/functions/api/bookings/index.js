import { json } from "../../../lib/session.js";
import { secured } from "../../../lib/api.js";

// GET /api/bookings -> minhas reservas futuras (como aluno)
export const onRequestGet = secured(async ({ env }, user) => {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.topic, s.start_ts, s.end_ts, m.username AS monitor_name
       FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN discord_users m ON m.user_id = s.monitor_id
      WHERE b.student_id = ? AND s.start_ts > ? ORDER BY s.start_ts`
  ).bind(user.id, Date.now()).all();
  return json({ bookings: results });
});

// POST /api/bookings {slot_id, topic}
// Uma única instrução atômica (INSERT ... SELECT ... WHERE NOT EXISTS) + UNIQUE(slot_id):
// sob corrida, só uma linha entra; as demais recebem 409.
export const onRequestPost = secured(async ({ env }, user, { slot_id, topic }) => {
  topic = typeof topic === "string" ? topic.trim() : "";
  if (!Number.isInteger(slot_id)) return json({ error: "Horário inválido." }, 400);
  if (topic.length < 3 || topic.length > 300) return json({ error: "Descreva o tema da dúvida (3 a 300 caracteres)." }, 400);

  const now = Date.now();
  const conflict = () => json({ error: "Não foi possível reservar: o horário foi ocupado por outra pessoa, conflita com outra reserva sua ou você atingiu o limite de 10 reservas futuras." }, 409);
  try {
    const r = await env.DB.prepare(
      `INSERT INTO bookings (slot_id, student_id, topic, created_at)
       SELECT s.id, ?, ?, ? FROM slots s
        WHERE s.id = ? AND s.monitor_id <> ? AND s.start_ts > ?
                   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM bookings b2 JOIN slots s2 ON s2.id = b2.slot_id
                           WHERE b2.student_id = ? AND s2.start_ts < s.end_ts AND s2.end_ts > s.start_ts)
          AND (SELECT COUNT(*) FROM bookings b3 JOIN slots s3 ON s3.id = b3.slot_id
                WHERE b3.student_id = ? AND s3.start_ts > ?) < 10`
    ).bind(user.id, topic, now, slot_id, user.id, now, user.id, user.id, now).run();

    if (r.meta.changes === 1) return json({ id: r.meta.last_row_id }, 201);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return conflict();
    throw e;
  }
  // nada foi inserido: descobrir o motivo
  const s = await env.DB.prepare("SELECT monitor_id, start_ts FROM slots WHERE id = ?").bind(slot_id).first();
  if (!s) return json({ error: "Horário não encontrado." }, 404);
  if (s.monitor_id === user.id) return json({ error: "Você não pode reservar o seu próprio horário." }, 403);
  if (s.start_ts <= now) return json({ error: "Este horário já passou." }, 400);
  return conflict();
}, { body: true });
